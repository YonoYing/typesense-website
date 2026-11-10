#!/usr/bin/env node
'use strict'

// Runs docs examples against a real Typesense server (in Docker).
//
//   node bin/run.js 30.2                       every page in a docs version
//   node bin/run.js docs-site/content/30.2/api/documents.md
//   node bin/run.js --changed origin/master    pages touched since a git ref
//
// Options:
//   --image <image>      server image (default: typesense/typesense:<docs version>)
//   --langs js,shell     languages to run (default: all executable languages)
//   --only id1,id2       only these snippet IDs
//   --no-static          skip the static checks (syntax, client API, cross-tab)
//   --report <file>      write results as JSON
//   --findings <file>    write the findings table as a Markdown document
//   --summary <file>     append a Markdown summary (e.g. $GITHUB_STEP_SUMMARY)
//   --title <text>       heading for the Markdown summary

const fs = require('fs')
const { runPage } = require('../lib/runner')
const { stopServer, pullImage } = require('../lib/server')
const { pagesForArgs, pagesForChangedFiles, changedFiles } = require('../lib/pages')
const { counts, consoleLine, toMarkdown, findingsDoc } = require('../lib/report')
const { buildFindings, consoleFindings, headline } = require('../lib/findings')
const { EXECUTABLE_LANGUAGES } = require('../lib/config')
const { defaultImageFor } = require('../lib/runner')

function parseArgs(argv) {
  const opts = { targets: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--image') opts.image = next()
    else if (a === '--langs') opts.langs = next().split(',')
    else if (a === '--only') opts.only = next().split(',')
    else if (a === '--report') opts.report = next()
    else if (a === '--findings') opts.findings = next()
    else if (a === '--summary') opts.summary = next()
    else if (a === '--title') opts.title = next()
    else if (a === '--changed') opts.changed = next()
    else if (a === '--no-static') opts.static = false
    else if (a === '--help' || a === '-h') opts.help = true
    else opts.targets.push(a)
  }
  return opts
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 20).join('\n').replace(/^\/\/ ?/gm, ''))
    return
  }

  let pages = []
  if (opts.changed) pages = pagesForChangedFiles(changedFiles(opts.changed))
  if (opts.targets.length) pages = [...new Set([...pages, ...pagesForArgs(opts.targets)])]
  if (pages.length === 0) {
    console.log('No covered docs pages to test.')
    if (opts.report) fs.writeFileSync(opts.report, JSON.stringify({ image: opts.image || null, results: [] }, null, 2))
    return
  }

  const langs = opts.langs || EXECUTABLE_LANGUAGES
  const images = [...new Set(pages.map(p => opts.image || defaultImageFor(p)))]
  for (const image of images) pullImage(image)

  console.log(`Testing ${pages.length} page(s) in ${langs.join(', ')}\n`)
  const results = []
  try {
    for (const docRel of pages) {
      console.log(docRel)
      const pageResults = await runPage({
        docRel,
        image: opts.image,
        langs,
        only: opts.only,
        static: opts.static !== false,
        log: r => console.log(consoleLine(r)),
      })
      results.push(...pageResults)
    }
  } finally {
    stopServer()
  }

  const c = counts(results)
  console.log(
    `\nPer example and language: ${c.pass} passed, ${c.fail} failed, ${c.xfail} known failures, ${c.xpass} unexpected passes, ${c.skip} skipped` +
      (c.staticOnly ? ` (${c.staticOnly} passes are static checks only)` : ''),
  )

  // The final report counts findings, the way the example audit does.
  const found = buildFindings(results)
  if (found.findings.length) console.log(`\nFindings:\n${consoleFindings(found.findings)}`)
  for (const u of found.undetected) console.log(`  NOT DETECTED ${u.row.id} (${u.row.severity}) ${u.row.where}`)
  console.log(`\n${found.findings.length ? headline(found.findings) : 'No findings'}${found.undetected.length ? `; ${found.undetected.length} audit finding(s) not detected` : ''}`)

  const image = opts.image || images.join(', ')
  const findings = found.findings.map(({ id, severity, source, page, langs, snippet, problem, fix, blocks }) => ({ id, severity, source, page, langs, snippet, problem, fix, blocks }))
  const undetected = found.undetected.map(u => ({ id: u.row.id, severity: u.row.severity, where: u.row.where, lang: u.row.lang, problem: u.row.problem }))
  if (opts.report) fs.writeFileSync(opts.report, JSON.stringify({ image, findings, undetected, results }, null, 2))
  if (opts.summary) fs.appendFileSync(opts.summary, toMarkdown(results, { title: opts.title, image, found }) + '\n')
  if (opts.findings) fs.writeFileSync(opts.findings, findingsDoc(results, found, { title: opts.title, image }) + '\n')
  process.exitCode = c.fail > 0 ? 1 : 0
}

main().catch(err => {
  console.error(err)
  stopServer()
  process.exit(2)
})
