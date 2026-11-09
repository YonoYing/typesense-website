#!/usr/bin/env node
'use strict'

// Checks the harness against an independent audit of the docs examples.
//
// audit/<file>.md lists examples a reviewer found broken (BREAK: fails to run
// or compile; WRONG: runs but does the wrong thing). This script maps every
// BREAK and WRONG row to its code block(s) and checks that the harness flags
// each of them, so a fix to the harness can never silently stop catching a
// known class of bug.
//
//   node bin/audit.js                              static checks only (no Docker)
//   node bin/audit.js --report report.json         use a run's results (fail = flagged)
//   node bin/audit.js --audit audit/other.md       another audit file
//   node bin/audit.js --verbose                    show how each row was matched
//
// Exit code 1 when a BREAK or WRONG row is not flagged.

const fs = require('fs')
const path = require('path')
const { DOCS_ROOT } = require('../lib/config')
const { extractFromFile, CLIENT_LANGUAGES } = require('../lib/extract')
const staticChecks = require('../lib/static')

const DEFAULT_AUDIT = path.join(__dirname, '..', 'audit', '30.2-code-example-audit.md')

const LANG_NAMES = {
  js: 'js', javascript: 'js', ts: 'ts', typescript: 'ts', python: 'python', py: 'python', ruby: 'ruby', rb: 'ruby',
  php: 'php', dart: 'dart', java: 'java', go: 'go', swift: 'swift', shell: 'shell', curl: 'shell', bash: 'shell',
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
    const cells = line.split('|').slice(1, -1).map(s => s.trim())
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
    .filter(f => f.length >= 6 && /[^\w\s-]/.test(f))
}

const squash = s => s.replace(/\s+/g, ' ')

// The pages a row names, with the line numbers or heading hints given for each.
function locationsOf(where) {
  const out = []
  for (const part of where.split(';')) {
    const m = part.trim().match(/^([\w-]+\.md)\s*:?\s*(.*)$/)
    if (!m) continue
    const [, page, rest] = m
    const lines = [...rest.matchAll(/(\d{2,5})/g)].map(x => Number(x[1]))
    const hints = [...rest.matchAll(/\(([^)]+)\)/g)].map(x => x[1])
    out.push({ page, lines, hints })
  }
  return out
}

function blocksFor(row, version) {
  const langs = langsOf(row.lang)
  const fragments = fragmentsOf(row.snippet)
  const found = []
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
    if (loc.lines.length) narrow(c => loc.lines.some(n => n >= c.block.line - 3 && n <= c.block.endLine + 3), 'by line number')
    if (loc.hints.length) {
      const words = loc.hints.flatMap(h => h.split(',')).map(w => w.trim().toLowerCase().replace(/ tab$/, '')).filter(w => w.length > 3)
      narrow(c => words.some(w => c.group.heading.title.toLowerCase().includes(w)), 'by heading hint')
    }
    if (fragments.length) narrow(c => fragments.some(f => squash(c.block.code).includes(f)), 'by fragment')
    if (hits === candidates && !loc.lines.length && !fragments.length && !loc.hints.length) hits = []
    if (hits === candidates && hits.length > 3) {
      // Nothing narrowed a whole page of candidates: the row is too vague.
      notes.push(`${loc.page}: nothing narrowed the ${hits.length} ${langs.join('/')} blocks`)
      hits = []
    }
    if (!hits.length) notes.push(`${loc.page}: no ${langs.join('/')} block matched`)
    found.push(...hits)
  }
  // One entry per (page, group, lang).
  const seen = new Set()
  return {
    blocks: found.filter(c => {
      const key = `${c.docRel}|${c.group.id}|${c.block.lang}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }),
    notes,
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const { version: auditVersion, rows } = parseAudit(opts.audit)
  const version = opts.version || auditVersion
  // JSON, JSONL and prose rows are not client code and are outside the harness.
  const relevant = rows.filter(r => /BREAK|WRONG/.test(r.severity) && langsOf(r.lang).length)
  const outOfScope = rows.filter(r => /BREAK|WRONG/.test(r.severity) && !langsOf(r.lang).length)

  // Flags: Set of `${docRel}|${groupId}|${lang}` the harness marked as failing.
  const flagged = new Map() // key -> text
  if (opts.report) {
    const report = JSON.parse(fs.readFileSync(opts.report, 'utf8'))
    for (const r of report.results) {
      if (r.status === 'fail') flagged.set(`${r.page}|${r.id}|${r.lang}`, r.error || '')
    }
  } else {
    const pages = new Set(relevant.flatMap(r => locationsOf(r.where).map(l => `${version}/api/${l.page}`)))
    for (const docRel of pages) {
      const file = path.join(DOCS_ROOT, docRel)
      if (!fs.existsSync(file)) continue
      const groups = extractFromFile(file)
      for (const [key, problems] of staticChecks.checkPage(groups, { version })) {
        const [id, lang] = key.split('|')
        flagged.set(`${docRel}|${id}|${lang}`, staticChecks.formatProblems(problems))
      }
    }
  }
  const covered = new Set()

  let missed = 0
  let unmapped = 0
  const lines = []
  for (const row of relevant) {
    const { blocks, notes } = blocksFor(row, version)
    if (!blocks.length) {
      unmapped++
      lines.push(`UNMAPPED ${row.id.padEnd(4)} ${row.severity.padEnd(13)} ${row.where} [${row.lang}] (${notes.join('; ')})`)
      continue
    }
    const results = blocks.map(c => ({ c, text: flagged.get(`${c.docRel}|${c.group.id}|${c.block.lang}`) }))
    for (const c of blocks) covered.add(`${c.docRel}|${c.group.id}|${c.block.lang}`)
    const hit = results.filter(r => r.text !== undefined)
    const status = hit.length === results.length ? 'FLAGGED' : hit.length ? 'PARTIAL' : 'MISSED'
    if (status !== 'FLAGGED') missed++
    const where = results.map(r => `${r.c.group.id}[${r.c.block.lang}]${r.text !== undefined ? '' : '?'}`).join(', ')
    lines.push(`${status.padEnd(8)} ${row.id.padEnd(4)} ${row.severity.padEnd(13)} ${row.where} [${row.lang}]: ${where}`)
    if (opts.verbose) {
      for (const r of hit) lines.push(`         -> ${r.text.split('\n')[0].slice(0, 160)}`)
      if (status !== 'FLAGGED') lines.push(`         (${notes.join('; ')}) problem: ${row.problem.slice(0, 140)}`)
    }
  }
  console.log(lines.join('\n'))
  const total = relevant.length
  console.log(`\n${total - missed - unmapped} of ${total} BREAK/WRONG rows flagged, ${missed} missed or partial, ${unmapped} could not be mapped to a code block${opts.report ? ' (from report)' : ' (static checks only)'}`)
  if (outOfScope.length) console.log(`${outOfScope.length} row(s) are not client code (${outOfScope.map(r => `${r.id} ${r.lang}`).join(', ')}) and are outside the harness`)

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
