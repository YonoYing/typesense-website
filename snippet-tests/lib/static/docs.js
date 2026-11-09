'use strict'

// Checks for the parts of a docs page that are not client code: JSON / JSON
// Lines blocks (sample responses, request bodies, schema fragments) and the
// prose around the examples (links, numbered lists, statements that
// contradict each other).
//
// Results use the language keys `json` and `prose`. A JSON block's id is the
// heading slug with `--json`, `--json2`... appended; a prose problem's id is
// the slug of the section it is in.

const { slugify } = require('../extract')

const JSON_LANGS = /^(json|jsonc|jsonl|json5|json\s+lines)\b/i

// ---------------------------------------------------------------------------
// Extraction

function extractDocItems(markdown) {
  const lines = markdown.split(/\r?\n/)
  const items = []
  const usedSlugs = new Map()
  const jsonPerHeading = new Map()
  let heading = { slug: 'top', title: '(top of page)', line: 1 }
  let section = { id: 'top', title: heading.title, line: 1, text: [] }
  let fence = null
  const sections = [section]

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const lineNo = i + 1
    if (fence) {
      if (new RegExp(`^\\s*${fence.marker}\\s*$`).test(raw)) {
        if (fence.json) {
          const n = (jsonPerHeading.get(heading.slug) || 0) + 1
          jsonPerHeading.set(heading.slug, n)
          items.push({
            kind: 'json',
            lang: 'json',
            jsonl: /l|lines/i.test(fence.info.replace(/^json/i, '').split(/[{\s]/)[0]) || /json\s+lines/i.test(fence.info),
            id: `${heading.slug}--json${n === 1 ? '' : n}`,
            heading: heading.title,
            line: fence.line,
            endLine: lineNo,
            code: fence.body.join('\n'),
          })
        }
        fence = null
      } else {
        fence.body.push(raw.slice(fence.indent))
      }
      section.text.push('') // keep line positions; code is not prose
      continue
    }
    const open = raw.match(/^(\s*)(```+|~~~+)\s*(.*)$/)
    if (open) {
      const info = open[3].trim()
      fence = { marker: open[2], info, json: JSON_LANGS.test(info), line: lineNo, body: [], indent: open[1].length }
      section.text.push('')
      continue
    }
    const h = raw.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (h) {
      let slug = slugify(h[2])
      const seen = usedSlugs.get(slug) || 0
      usedSlugs.set(slug, seen + 1)
      if (seen > 0) slug = `${slug}-${seen}`
      heading = { slug, title: h[2].replace(/<[^>]+>/g, '').trim(), line: lineNo }
      section = { id: slug, title: heading.title, line: lineNo, text: [] }
      sections.push(section)
      continue
    }
    section.text.push(raw)
  }

  for (const s of sections) {
    items.push({
      kind: 'prose',
      lang: 'prose',
      id: s.id,
      heading: s.title,
      line: s.line,
      endLine: s.line + s.text.length,
      code: s.text.join('\n'),
    })
  }
  return items
}

// ---------------------------------------------------------------------------
// JSON

function lineAt(text, index) {
  return text.slice(0, index).split('\n').length
}

// Why a JSON text does not parse, in terms a docs writer can act on.
function diagnoseJson(text) {
  const problems = []
  const add = (rule, re, message) => {
    const m = text.match(re)
    if (m) problems.push({ rule, line: lineAt(text, m.index), message })
  }
  add('json-ellipsis', /^\s*\.\.\.|[[{,]\s*\.\.\.|\.\.\.\s*[,}\]]/m, 'contains `...`, so it is not valid JSON (a reader who copies it gets a parse error)')
  add('json-comment', /(^|[\s,[{])\/\/[^\n]*/m, 'contains a `//` comment, which JSON does not allow')
  add('json-trailing-comma', /,\s*[}\]]/, 'has a trailing comma before a closing bracket, which JSON does not allow')
  add('json-unquoted-key', /[{,]\s*[A-Za-z_][\w$]*\s*:/, 'has an unquoted key; JSON keys must be in double quotes')
  add('json-single-quotes', /[{,[]\s*'[^'\n]*'\s*:/, 'uses single quotes; JSON strings must use double quotes')
  return problems
}

function walk(value, visit, path = []) {
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, visit, [...path, i]))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      visit(k, v, path)
      walk(v, visit, [...path, k])
    }
  }
}

function checkJsonValue(value, text, { version } = {}) {
  const problems = []
  walk(value, (key, v, path) => {
    // A key with stray punctuation or whitespace at either end, e.g.
    // ",first_name". Keys with inner spaces ("GET /collections") are fine.
    if (/^[\s,;:]|[\s,;:]$/.test(key)) {
      const at = text.indexOf(JSON.stringify(key))
      problems.push({ rule: 'json-mangled-key', line: at >= 0 ? lineAt(text, at) : undefined, message: `has the key ${JSON.stringify(key)}, which looks mangled (stray punctuation or spaces)`, fix: key.replace(/^[^\w$]+|[^\w$]+$/g, '').trim() })
    }
    // Document ids are strings in Typesense.
    if (key === 'id' && typeof v === 'number' && path[path.length - 1] === 'document') {
      const at = text.search(/"id"\s*:\s*\d/)
      problems.push({ rule: 'json-numeric-document-id', line: at >= 0 ? lineAt(text, at) : undefined, message: `shows a document with "id": ${v}; document ids are strings in Typesense`, fix: `"id": "${v}"` })
    }
  })
  // A sample version that does not match the docs version.
  if (version && value && typeof value === 'object' && !Array.isArray(value) && typeof value.version === 'string') {
    const major = version.split('.')[0]
    if (/^\d+\.\d+/.test(value.version) && value.version.split('.')[0] !== major) {
      const at = text.indexOf('"version"')
      problems.push({ rule: 'json-version-mismatch', line: at >= 0 ? lineAt(text, at) : undefined, message: `shows "version": "${value.version}" on a page for Typesense ${version}`, fix: `"version": "${version}"` })
    }
  }
  return problems
}

function checkJsonBlock(item, opts = {}) {
  const text = item.code
  if (!text.trim()) return []
  const docs = []
  if (item.jsonl) {
    const lines = text.split('\n')
    const problems = []
    lines.forEach((l, i) => {
      if (!l.trim()) return
      try {
        docs.push({ value: JSON.parse(l), text: l, offset: i })
      } catch (err) {
        problems.push({ rule: 'jsonl-invalid-line', line: i + 1, message: `line ${i + 1} is not valid JSON` })
      }
    })
    for (const d of docs) for (const p of checkJsonValue(d.value, d.text, opts)) problems.push({ ...p, line: d.offset + 1 })
    return problems
  }
  try {
    return checkJsonValue(JSON.parse(text), text, opts)
  } catch (err) {
    // A JSON Lines block labelled as json.
    const lines = text.split('\n').filter(l => l.trim())
    if (lines.length > 1 && lines.every(l => { try { JSON.parse(l); return true } catch (_) { return false } })) {
      return checkJsonBlock({ ...item, jsonl: true }, opts)
    }
    const problems = diagnoseJson(text)
    return problems.length ? problems : [{ rule: 'json-invalid', message: `is not valid JSON (${err.message.replace(/ in JSON at position \d+.*$/, '')})` }]
  }
}

// ---------------------------------------------------------------------------
// Prose

// Statements that contradict another statement on the same page. Each entry:
// a phrase that is wrong when the page elsewhere states `truth`.
const CONTRADICTIONS = [
  {
    rule: 'prose-stemmer-name',
    wrong: /\bPorter stemmer\b/i,
    truth: /\bSnowball\b/i,
    message: 'calls the default stemmer "Porter", while the same page (and the server, which uses libstemmer per locale) says Snowball',
    fix: 'the Snowball stemmer for the field\'s locale',
  },
]

function checkProse(item, page) {
  const text = item.code
  const problems = []
  const lines = text.split('\n')

  // Links whose anchor has a doubled `#`.
  for (const m of text.matchAll(/\]\(([^)\s]*##[^)\s]*)\)/g)) {
    problems.push({ rule: 'prose-double-hash-link', line: item.line + lineAt(text, m.index), message: `links to \`${m[1]}\`; the doubled \`#\` breaks the anchor`, fix: m[1].replace(/##+/, '#') })
  }

  // Explicitly numbered lists that repeat a number (a list numbered 1. 1. 1.
  // is auto-numbered by markdown and fine).
  let run = []
  const flush = () => {
    const nums = run.map(r => r.n)
    if (nums.length > 1 && !nums.every(n => n === 1)) {
      for (let k = 1; k < run.length; k++) {
        if (run[k].n === run[k - 1].n) {
          problems.push({ rule: 'prose-list-numbering', line: item.line + run[k].i + 1, message: `two items of the same numbered list are both numbered ${run[k].n}.`, fix: `renumber the second one ${run[k].n + 1}.` })
        }
      }
    }
    run = []
  }
  lines.forEach((l, i) => {
    const m = l.match(/^\s{0,3}(\d+)\.\s+\S/)
    if (m) {
      const n = Number(m[1])
      if (n === 1 && run.length && !run.every(r => r.n === 1)) flush()
      run.push({ n, i })
    } else if (/^#{1,6}\s/.test(l)) flush()
  })
  flush()

  for (const c of CONTRADICTIONS) {
    const m = text.match(c.wrong)
    if (m && c.truth.test(page)) {
      problems.push({ rule: c.rule, line: item.line + lineAt(text, m.index), message: c.message, fix: c.fix })
    }
  }
  return problems
}

// ---------------------------------------------------------------------------

// Returns a Map `${id}|json` / `${id}|prose` -> problems, plus the items.
function checkDocs(markdown, { version } = {}) {
  const items = extractDocItems(markdown)
  const out = new Map()
  for (const item of items) {
    const problems = item.kind === 'json' ? checkJsonBlock(item, { version }) : checkProse(item, markdown)
    if (problems.length) out.set(`${item.id}|${item.lang}`, problems)
  }
  return { problems: out, items }
}

module.exports = { extractDocItems, checkDocs, checkJsonBlock, checkProse, diagnoseJson }
