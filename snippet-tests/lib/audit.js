'use strict'

// Reads an example audit (audit/<version>-code-example-audit.md) and maps each
// of its findings to the code blocks, JSON blocks or prose sections it is
// about. Used by the run report (lib/findings.js), which groups the harness's
// failures into findings the same way the audit does, and by bin/audit.js.
//
// An audit row looks like:
//   | C1 | BREAK | curation.md:53,221 | JS | `client.curationSets().upsert(...)` | problem | fix |

const fs = require('fs')
const path = require('path')
const { DOCS_ROOT } = require('./config')
const { extractFromFile, CLIENT_LANGUAGES } = require('./extract')

const AUDIT_DIR = path.join(__dirname, '..', 'audit')

const LANG_NAMES = {
  js: 'js', javascript: 'js', ts: 'ts', typescript: 'ts', python: 'python', py: 'python', ruby: 'ruby', rb: 'ruby',
  php: 'php', dart: 'dart', java: 'java', go: 'go', swift: 'swift', shell: 'shell', curl: 'shell', bash: 'shell',
  json: 'json', jsonl: 'json', prose: 'prose',
}

// The audit file for a docs version, if there is one.
function auditFileFor(version) {
  if (!fs.existsSync(AUDIT_DIR)) return null
  const file = fs.readdirSync(AUDIT_DIR).find(f => f.startsWith(`${version}-`) && f.endsWith('.md'))
  return file ? path.join(AUDIT_DIR, file) : null
}

function parseAudit(file) {
  const text = fs.readFileSync(file, 'utf8')
  const version = (text.match(/docs-site\/content\/([\d.]+)\//) || [])[1] || path.basename(file).split('-')[0]
  const rows = []
  for (const line of text.split('\n')) {
    if (!/^\|\s*[A-Z]+\d+\s*\|/.test(line)) continue
    // Split on unescaped pipes; `\|` inside a cell is part of the text.
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map(s => s.trim().replace(/\\\|/g, '|'))
    const [id, severity, where, lang, snippet, problem, fix] = cells
    rows.push({ id, severity, where, lang, snippet, problem, fix })
  }
  return { version, rows, file }
}

function langsOf(cell) {
  const text = cell.toLowerCase()
  if (/\ball\b/.test(text)) return [...CLIENT_LANGUAGES]
  const out = new Set()
  for (const word of text.split(/[\s,/]+/)) if (LANG_NAMES[word]) out.add(LANG_NAMES[word])
  return [...out]
}

// Code fragments quoted in the Snippet column, e.g. `client.keys(1).retrieve()`.
// A fragment such as `.items[...].upsert/retrieve/delete` is also tried up to
// its first `/`. Short or word-only fragments are too generic to use.
function fragmentsOf(snippet) {
  const frags = [...snippet.matchAll(/`([^`]+)`/g)].map(m => m[1])
  return frags
    .flatMap(f => (f.includes('/') && !/https?:/.test(f) ? [f, f.split('/')[0]] : [f]))
    .map(f => f.replace(/\.\.\./g, '').replace(/\s+/g, ' ').trim())
    .filter(f => f.length >= 6 && (/[^\w\s-]/.test(f) || /\w[_-]\w/.test(f)))
}

const squash = s => s.replace(/\s+/g, ' ')

// The pages a row names, with the line numbers or heading hints given for each.
function locationsOf(where) {
  const out = []
  let page = null
  for (const part of where.split(';')) {
    // "geosearch.md:417; 455": a part without a page name continues the last one.
    const m = part.trim().match(/^(?:([\w-]+\.md)\s*:?)?\s*(.*)$/)
    if (m[1]) page = m[1]
    if (!page) continue
    // "122 vs :20" names the place to compare with, not a second bug site.
    const rest = m[2].replace(/\s+vs\.?\s+:?\d+(?:-\d+)?/g, '')
    const lines = [...rest.matchAll(/(\d{2,5})/g)].map(x => Number(x[1]))
    const hints = [...rest.matchAll(/\(([^)]+)\)/g)].map(x => x[1])
    const existing = out.find(o => o.page === page)
    if (existing) {
      existing.lines.push(...lines)
      existing.hints.push(...hints)
    } else out.push({ page, lines, hints })
  }
  return out
}

// Every block on a page the audit can point at: client code, JSON, prose.
const pageCache = new Map()
function pageCandidates(docRel) {
  if (pageCache.has(docRel)) return pageCache.get(docRel)
  const file = path.join(DOCS_ROOT, docRel)
  let out = null
  if (fs.existsSync(file)) {
    const { extractDocItems } = require('./static/docs')
    out = []
    for (const g of extractFromFile(file)) for (const b of g.blocks) out.push({ group: g, block: b, docRel })
    for (const item of extractDocItems(fs.readFileSync(file, 'utf8'))) {
      out.push({ group: { id: item.id, heading: { title: item.heading } }, block: item, docRel })
    }
  }
  pageCache.set(docRel, out)
  return out
}

const keyOf = c => `${c.docRel}|${c.group.id}|${c.block.lang}`

// Returns `slots`: the places a row points at. Each slot is a list of
// candidate blocks; usually one, two when a cited line sits exactly between
// two blocks (then either being flagged satisfies the slot).
function mapRow(row, version) {
  const langs = langsOf(row.lang)
  const fragments = fragmentsOf(row.snippet)
  const slots = []
  const notes = []
  for (const loc of locationsOf(row.where)) {
    const docRel = `${version}/api/${loc.page}`
    const all = pageCandidates(docRel)
    if (!all) {
      notes.push(`${loc.page}: not found`)
      continue
    }
    const candidates = all.filter(c => langs.includes(c.block.lang))

    // Narrow the candidates step by step: by the listed line numbers (the
    // audit's lines may be off by a few when the docs changed since), then by
    // a heading hint such as "(Delete all, Java tab)", then by a quoted code
    // fragment. A step that would leave nothing is skipped.
    let hits = candidates
    const narrow = (filter, note) => {
      const next = hits.filter(filter)
      if (next.length && next.length < hits.length) {
        hits = next
        notes.push(`${loc.page}: ${note}`)
      }
    }
    const matchesFragment = c => fragments.some(f => squash(c.block.code).includes(f))
    const lineSlots = []
    if (loc.lines.length) {
      // Each listed line picks the block that holds it, or the nearest one
      // (the docs may have shifted a few lines since the audit; a cited line
      // can also land on the tab markup between two blocks). A quoted
      // fragment breaks a tie between neighbours.
      const distance = (c, n) => (n < c.block.line ? c.block.line - n : n > c.block.endLine ? n - c.block.endLine : 0)
      for (const n of loc.lines) {
        let near = candidates.filter(c => distance(c, n) <= 6)
        if (!near.length) near = candidates.filter(c => distance(c, n) <= 20)
        if (!near.length) continue
        const withFragment = near.filter(matchesFragment)
        const pool = withFragment.length ? withFragment : near
        const best = Math.min(...pool.map(c => distance(c, n)))
        lineSlots.push(pool.filter(c => distance(c, n) === best))
      }
      if (lineSlots.length) {
        hits = [...new Set(lineSlots.flat())]
        notes.push(`${loc.page}: by line number`)
      }
    }
    if (loc.hints.length) {
      // "(Update single, Swift tab)": a phrase matches a heading when all its
      // words appear in the heading ("Update a single document").
      const phrases = loc.hints
        .flatMap(h => h.split(','))
        .map(p => p.trim().toLowerCase().replace(/\btabs?\b/g, '').split(/\s+/).filter(w => w.length > 2 && !LANG_NAMES[w] && !/^(and|the)$/.test(w)))
        .filter(ws => ws.length)
      const headingWords = c => c.group.heading.title.toLowerCase().split(/[^a-z0-9]+/)
      narrow(c => phrases.some(ws => ws.every(w => headingWords(c).some(hw => hw.startsWith(w)))), 'by heading hint')
    }
    if (fragments.length && !loc.lines.length) narrow(matchesFragment, 'by fragment')
    if (hits === candidates && !loc.lines.length && !fragments.length && !loc.hints.length) hits = []
    if (hits === candidates && hits.length > 3) {
      // Nothing narrowed a whole page of candidates: the row is too vague.
      notes.push(`${loc.page}: nothing narrowed the ${hits.length} ${langs.join('/')} blocks`)
      hits = []
    }
    if (!hits.length) notes.push(`${loc.page}: no ${langs.join('/')} block matched`)
    if (lineSlots.length && hits.length) {
      // Keep the per-line slots, minus anything a heading hint ruled out.
      const kept = new Set(hits)
      for (const s of lineSlots) {
        const slot = s.filter(c => kept.has(c))
        if (slot.length) slots.push(slot)
      }
    } else {
      for (const c of hits) slots.push([c])
    }
  }
  // One slot per (page, group, lang) set.
  const seen = new Set()
  return {
    slots: slots.filter(s => {
      const key = s.map(keyOf).sort().join(' or ')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }),
    notes,
  }
}

module.exports = { auditFileFor, parseAudit, langsOf, locationsOf, fragmentsOf, mapRow, keyOf, pageCandidates, LANG_NAMES }
