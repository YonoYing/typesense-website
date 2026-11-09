#!/usr/bin/env node
'use strict'

// Checks the harness against an independent audit of the docs examples.
//
// audit/<file>.md lists what a reviewer found wrong with the examples
// (BREAK: fails to run or compile; WRONG: runs but does the wrong thing;
// COSMETIC: stale comments, inconsistent values, invalid sample JSON, prose
// slips). The audit is the source of truth: this script maps every row to its
// code block(s), JSON block or prose section and checks that the harness
// flags each one, so a change to the checks can never silently stop catching
// a known problem.
//
//   node bin/audit.js                              static checks only (no Docker)
//   node bin/audit.js --report report.json         use a run's results (fail = flagged)
//   node bin/audit.js --audit audit/other.md       another audit file
//   node bin/audit.js --verbose                    show how each row was matched
//   node bin/audit.js --extra                      also list flags no row mentions
//   node bin/audit.js --summary file.md            append the result as Markdown
//
// Exit code 1 when a row is not flagged.

const fs = require('fs')
const path = require('path')
const { DOCS_ROOT } = require('../lib/config')
const { extractFromFile, CLIENT_LANGUAGES } = require('../lib/extract')
const staticChecks = require('../lib/static')
const { loadTests, testFileFor } = require('../lib/test-file')
const { staticDisabled } = require('../lib/runner')

const DEFAULT_AUDIT = path.join(__dirname, '..', 'audit', '30.2-code-example-audit.md')

const LANG_NAMES = {
  js: 'js', javascript: 'js', ts: 'ts', typescript: 'ts', python: 'python', py: 'python', ruby: 'ruby', rb: 'ruby',
  php: 'php', dart: 'dart', java: 'java', go: 'go', swift: 'swift', shell: 'shell', curl: 'shell', bash: 'shell',
  json: 'json', jsonl: 'json', prose: 'prose',
}

function parseArgs(argv) {
  const opts = { audit: DEFAULT_AUDIT }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--report') opts.report = argv[++i]
    else if (a === '--audit') opts.audit = argv[++i]
    else if (a === '--verbose' || a === '-v') opts.verbose = true
    else if (a === '--extra') opts.extra = true
    else if (a === '--version') opts.version = argv[++i]
    else if (a === '--summary') opts.summary = argv[++i]
  }
  return opts
}

// Rows of the findings table.
function parseAudit(file) {
  const text = fs.readFileSync(file, 'utf8')
  const version = (text.match(/docs-site\/content\/([\d.]+)\//) || [])[1] || '30.2'
  const rows = []
  for (const line of text.split('\n')) {
    if (!/^\|\s*[A-Z]+\d+\s*\|/.test(line)) continue
    // Split on unescaped pipes; `\|` inside a cell is part of the text.
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map(s => s.trim().replace(/\\\|/g, '|'))
    const [id, severity, where, lang, snippet, problem, fix] = cells
    rows.push({ id, severity, where, lang, snippet, problem, fix })
  }
  return { version, rows }
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

// Returns `slots`: the places a row points at. Each slot is a list of
// candidate blocks; usually one, two when a cited line sits exactly between
// two blocks (then either being flagged satisfies the slot).
function blocksFor(row, version) {
  const langs = langsOf(row.lang)
  const fragments = fragmentsOf(row.snippet)
  const slots = []
  const notes = []
  for (const loc of locationsOf(row.where)) {
    const docRel = `${version}/api/${loc.page}`
    const file = path.join(DOCS_ROOT, docRel)
    if (!fs.existsSync(file)) {
      notes.push(`${loc.page}: not found`)
      continue
    }
    const groups = extractFromFile(file)
    const candidates = []
    for (const g of groups) for (const b of g.blocks) if (langs.includes(b.lang)) candidates.push({ group: g, block: b, docRel })
    // JSON blocks and prose sections.
    for (const item of staticChecks.extractDocItems(fs.readFileSync(file, 'utf8'))) {
      if (langs.includes(item.lang)) candidates.push({ group: { id: item.id, heading: { title: item.heading } }, block: item, docRel })
    }

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
  const keyOf = c => `${c.docRel}|${c.group.id}|${c.block.lang}`
  const seen = new Set()
  return {
    slots: slots.filter(s => {
      const key = s.map(keyOf).sort().join(' or ')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }),
    notes,
    keyOf,
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const { version: auditVersion, rows } = parseAudit(opts.audit)
  const version = opts.version || auditVersion
  let relevant = rows
  const outOfScope = rows.filter(r => !langsOf(r.lang).length)

  // Flags: Set of `${docRel}|${groupId}|${lang}` the harness marked as failing.
  const flagged = new Map() // key -> text
  let skippedRows = 0
  if (opts.report) {
    const report = JSON.parse(fs.readFileSync(opts.report, 'utf8'))
    for (const r of report.results) {
      if (r.status === 'fail') flagged.set(`${r.page}|${r.id}|${r.lang}`, r.error || '')
    }
    // A run that covered only some pages (a PR run) is checked on those pages.
    const ran = new Set(report.results.map(r => r.page))
    const before = relevant.length
    relevant = relevant.filter(r => locationsOf(r.where).some(l => ran.has(`${version}/api/${l.page}`)))
    skippedRows = before - relevant.length
  } else {
    const pages = new Set(relevant.flatMap(r => locationsOf(r.where).map(l => `${version}/api/${l.page}`)))
    for (const docRel of pages) {
      const file = path.join(DOCS_ROOT, docRel)
      if (!fs.existsSync(file)) continue
      const groups = extractFromFile(file)
      const markdown = fs.readFileSync(file, 'utf8')
      // Honour the test file's `static` opt-outs, as the runner does.
      const tests = loadTests(testFileFor(docRel)) || { snippets: {} }
      for (const [key, problems] of staticChecks.checkPage(groups, { version, markdown })) {
        const [id, lang] = key.split('|')
        if (staticDisabled(tests.snippets[id], lang)) continue
        flagged.set(`${docRel}|${id}|${lang}`, staticChecks.formatProblems(problems))
      }
    }
  }
  const covered = new Set()

  let missed = 0
  let unmapped = 0
  const lines = []
  for (const row of relevant) {
    const { slots, notes, keyOf } = blocksFor(row, version)
    if (!slots.length) {
      unmapped++
      lines.push(`UNMAPPED ${row.id.padEnd(4)} ${row.severity.padEnd(13)} ${row.where} [${row.lang}] (${notes.join('; ')})`)
      continue
    }
    const results = slots.map(slot => {
      for (const c of slot) covered.add(keyOf(c))
      const hit = slot.find(c => flagged.has(keyOf(c)))
      return { slot, hit, text: hit && flagged.get(keyOf(hit)) }
    })
    const hits = results.filter(r => r.hit)
    const status = hits.length === results.length ? 'FLAGGED' : hits.length ? 'PARTIAL' : 'MISSED'
    if (status !== 'FLAGGED') missed++
    const label = c => `${c.group.id}[${c.block.lang}]`
    const where = results.map(r => (r.hit ? label(r.hit) : `${r.slot.map(label).join(' or ')}?`)).join(', ')
    lines.push(`${status.padEnd(8)} ${row.id.padEnd(4)} ${row.severity.padEnd(13)} ${row.where} [${row.lang}]: ${where}`)
    if (opts.verbose) {
      for (const r of hits) lines.push(`         -> ${r.text.split('\n')[0].slice(0, 160)}`)
      if (status !== 'FLAGGED') lines.push(`         (${notes.join('; ')}) problem: ${row.problem.slice(0, 140)}`)
    }
  }
  console.log(lines.join('\n'))
  const total = relevant.length
  const bySeverity = sev => relevant.filter(r => r.severity.startsWith(sev)).length
  const headline = `${total - missed - unmapped} of ${total} audit findings flagged (${bySeverity('BREAK')} BREAK, ${bySeverity('WRONG')} WRONG, ${bySeverity('COSMETIC')} COSMETIC)`
  console.log(`\n${headline}, ${missed} missed or partial, ${unmapped} could not be mapped${opts.report ? ' (from report)' : ' (static checks only)'}`)
  if (skippedRows) console.log(`${skippedRows} finding(s) are on pages this run did not test`)
  if (outOfScope.length) console.log(`${outOfScope.length} row(s) name no language the harness knows: ${outOfScope.map(r => `${r.id} ${r.lang}`).join(', ')}`)
  if (opts.summary) {
    const bad = lines.filter(l => /^(MISSED|PARTIAL|UNMAPPED)/.test(l))
    const md = [
      '### Audit cross-check',
      '',
      `**${headline}.**${skippedRows ? ` ${skippedRows} finding(s) are on pages this run did not test.` : ''}`,
      '',
      ...(bad.length ? ['Not flagged:', '', '```', ...bad, '```', ''] : []),
    ]
    fs.appendFileSync(opts.summary, md.join('\n') + '\n')
  }

  // Flags on blocks no audit row mentions: either a bug the audit missed or a
  // false positive worth a look.
  if (opts.extra) {
    const extra = [...flagged].filter(([key]) => !covered.has(key))
    console.log(`\n${extra.length} flagged block(s) not covered by an audit row:`)
    for (const [key, text] of extra) console.log(`  ${key}\n    ${text.split('\n').join('\n    ')}`)
  }
  process.exitCode = missed || unmapped ? 1 : 0
}

main()
