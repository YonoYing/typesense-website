'use strict'

// Works out which snippets a pull request touches, so its run tests only
// those (bin/run.js --changed <base>).
//
//   docs page changed    -> the snippets whose lines (or heading) changed, plus
//                           the JSON blocks and prose sections that changed
//   test file changed    -> the snippets whose test entry changed; a change
//                           outside the entries (beforeAll, a helper) -> the page
//   harness changed      -> everything
//
// A snippet that is new in the PR is a changed snippet too, so it runs (with
// the stub test the coverage workflow writes for it).

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { REPO_ROOT, DOCS_ROOT, TESTS_ROOT } = require('./config')
const { extractFromFile } = require('./extract')
const { extractDocItems } = require('./static/docs')
const { readTestKeys } = require('./test-file')
const { coveredVersions, pagesInVersion, isCovered, DOCS_PREFIX, TESTS_PREFIX } = require('./pages')

const HARNESS_PREFIXES = ['snippet-tests/lib/', 'snippet-tests/bin/', 'snippet-tests/package', 'snippet-tests/audit/']

// Parses `git diff -U0` output into Map<path, Set<new-side line>>. A deletion
// marks the lines on both sides of where the text was.
function parseDiff(text) {
  const files = new Map()
  let current = null
  for (const line of text.split('\n')) {
    const file = line.match(/^\+\+\+ (?:b\/)?(.+)$/)
    if (file) {
      current = file[1] === '/dev/null' ? null : file[1].trim()
      if (current && !files.has(current)) files.set(current, new Set())
      continue
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
    if (hunk && current) {
      const start = Number(hunk[1])
      const count = hunk[2] === undefined ? 1 : Number(hunk[2])
      const lines = files.get(current)
      if (count === 0) {
        lines.add(start)
        lines.add(start + 1)
      } else for (let n = start; n < start + count; n++) lines.add(n)
    }
  }
  return files
}

function gitDiff(baseRef) {
  return execFileSync('git', ['diff', '--no-color', '-U0', `${baseRef}...HEAD`], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

const touches = (lines, from, to) => [...lines].some(n => n >= from && n <= to)

// Snippet ids on a docs page that the changed lines touch.
function idsForDocChange(docFile, lines) {
  const ids = new Set()
  for (const g of extractFromFile(docFile)) {
    const end = Math.max(...g.blocks.map(b => b.endLine || b.line))
    if (touches(lines, g.line, end) || lines.has(g.heading.line)) ids.add(g.id)
  }
  for (const item of extractDocItems(fs.readFileSync(docFile, 'utf8'))) {
    // A prose section changes with any text edit; only its own lines count.
    if (touches(lines, item.line, item.endLine)) ids.add(item.id)
  }
  return ids
}

// Snippet ids whose entry in a test file the changed lines touch, or null when
// a change is outside every entry (the whole page then runs).
function idsForTestChange(testFile, lines) {
  const { exists, keys, source } = readTestKeys(testFile)
  if (!exists) return null
  const lineOf = offset => source.slice(0, offset).split('\n').length
  const ranges = [...keys].map(([id, k]) => ({ id, from: lineOf(k.start), to: lineOf(k.end) }))
  const ids = new Set()
  for (const n of lines) {
    const hit = ranges.find(r => n >= r.from && n <= r.to)
    if (!hit) return null
    ids.add(hit.id)
  }
  return ids
}

// Returns [{ page, only }]: `only` is the list of snippet ids to run, or null
// to run the whole page.
function snippetsForDiff(files, { docsRoot = DOCS_ROOT, testsRoot = TESTS_ROOT } = {}) {
  const paths = [...files.keys()]
  if (paths.some(p => HARNESS_PREFIXES.some(prefix => p.startsWith(prefix)))) {
    return coveredVersions(testsRoot).flatMap(v => pagesInVersion(v, docsRoot)).map(page => ({ page, only: null }))
  }
  const byPage = new Map() // page -> Set of ids, or null for all
  const add = (page, ids) => {
    if (ids === null) return byPage.set(page, null)
    if (byPage.get(page) === null) return
    const set = byPage.get(page) || new Set()
    for (const id of ids) set.add(id)
    byPage.set(page, set)
  }
  for (const [p, lines] of files) {
    const norm = p.split(path.sep).join('/')
    if (norm.startsWith(DOCS_PREFIX) && norm.endsWith('.md')) {
      const page = norm.slice(DOCS_PREFIX.length)
      const file = path.join(docsRoot, page)
      if (!isCovered(page, testsRoot) || !fs.existsSync(file)) continue
      const ids = idsForDocChange(file, lines)
      if (ids.size) add(page, ids)
    } else if (norm.startsWith(TESTS_PREFIX) && norm.endsWith('.test.js')) {
      const page = norm.slice(TESTS_PREFIX.length).replace(/\.test\.js$/, '.md')
      if (!fs.existsSync(path.join(docsRoot, page))) continue
      add(page, idsForTestChange(path.join(testsRoot, page.replace(/\.md$/, '.test.js')), lines))
    }
  }
  return [...byPage]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([page, ids]) => ({ page, only: ids === null ? null : [...ids] }))
}

function changedSnippets(baseRef) {
  return snippetsForDiff(parseDiff(gitDiff(baseRef)))
}

module.exports = { parseDiff, snippetsForDiff, changedSnippets, idsForDocChange, idsForTestChange, HARNESS_PREFIXES }
