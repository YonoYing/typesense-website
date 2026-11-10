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
const { extractFromFile } = require('../lib/extract')
const staticChecks = require('../lib/static')
const { loadTests, testFileFor } = require('../lib/test-file')
const { staticDisabled } = require('../lib/runner')
const { auditFileFor, parseAudit, langsOf, locationsOf, mapRow, keyOf } = require('../lib/audit')
const { ranRow } = require('../lib/findings')

function parseArgs(argv) {
  const opts = { audit: auditFileFor('30.2') }
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

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const { version: auditVersion, rows } = parseAudit(opts.audit)
  const version = opts.version || auditVersion
  let relevant = rows
  const outOfScope = rows.filter(r => !langsOf(r.lang).length)

  // Flags: `${docRel}|${groupId}|${lang}` the harness marked as failing.
  const flagged = new Map() // key -> text
  let skippedRows = 0
  if (opts.report) {
    const report = JSON.parse(fs.readFileSync(opts.report, 'utf8'))
    for (const r of report.results) {
      if (r.status === 'fail') flagged.set(`${r.page}|${r.id}|${r.lang}`, r.error || '')
    }
    // A run that covered only some snippets (a PR run) is checked on those.
    const ranKeys = new Set(report.results.map(r => `${r.page}|${r.id}|${r.lang}`))
    const before = relevant.length
    relevant = relevant.filter(r => ranRow(mapRow(r, version).slots, ranKeys))
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
    const { slots, notes } = mapRow(row, version)
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
  if (skippedRows) console.log(`${skippedRows} finding(s) are on snippets this run did not test`)
  if (outOfScope.length) console.log(`${outOfScope.length} row(s) name no language the harness knows: ${outOfScope.map(r => `${r.id} ${r.lang}`).join(', ')}`)
  if (opts.summary) {
    const bad = lines.filter(l => /^(MISSED|PARTIAL|UNMAPPED)/.test(l))
    const md = [
      '### Audit cross-check',
      '',
      `**${headline}.**${skippedRows ? ` ${skippedRows} finding(s) are on snippets this run did not test.` : ''}`,
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
