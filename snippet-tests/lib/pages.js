'use strict'

// Works out which docs pages to test.
//
// Only docs versions that have a folder under snippet-tests/tests/ are covered.
// To start covering a new version, copy the previous version's test folder.

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { REPO_ROOT, DOCS_ROOT, TESTS_ROOT } = require('./config')

const DOCS_PREFIX = 'docs-site/content/'
const TESTS_PREFIX = 'snippet-tests/tests/'
const HARNESS_PREFIXES = ['snippet-tests/lib/', 'snippet-tests/bin/', 'snippet-tests/package']

function coveredVersions(testsRoot = TESTS_ROOT) {
  if (!fs.existsSync(testsRoot)) return []
  return fs
    .readdirSync(testsRoot, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
}

function walkMarkdown(dir, root = dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkMarkdown(full, root))
    else if (entry.name.endsWith('.md')) out.push(path.relative(root, full).split(path.sep).join('/'))
  }
  return out.sort()
}

function pagesInVersion(version, docsRoot = DOCS_ROOT) {
  return walkMarkdown(path.join(docsRoot, version)).map(p => `${version}/${p}`)
}

function isCovered(docRel, testsRoot = TESTS_ROOT) {
  return coveredVersions(testsRoot).includes(docRel.split('/')[0])
}

// Maps a repo-relative path to the docs page it affects, or null.
function pageForRepoPath(repoPath) {
  const p = repoPath.split(path.sep).join('/')
  if (p.startsWith(DOCS_PREFIX) && p.endsWith('.md')) return p.slice(DOCS_PREFIX.length)
  if (p.startsWith(TESTS_PREFIX) && p.endsWith('.test.js')) return p.slice(TESTS_PREFIX.length).replace(/\.test\.js$/, '.md')
  return null
}

function changedFiles(baseRef) {
  const out = execFileSync('git', ['diff', '--name-only', `${baseRef}...HEAD`], { cwd: REPO_ROOT, encoding: 'utf8' })
  return out.split('\n').filter(Boolean)
}

// Pages to test for a set of changed files. A change to the harness itself
// re-runs every covered page.
function pagesForChangedFiles(files, { docsRoot = DOCS_ROOT, testsRoot = TESTS_ROOT } = {}) {
  if (files.some(f => HARNESS_PREFIXES.some(prefix => f.startsWith(prefix)))) {
    return coveredVersions(testsRoot).flatMap(v => pagesInVersion(v, docsRoot))
  }
  const pages = new Set()
  for (const f of files) {
    const page = pageForRepoPath(f)
    if (page && isCovered(page, testsRoot) && fs.existsSync(path.join(docsRoot, page))) pages.add(page)
  }
  return [...pages].sort()
}

// Resolves CLI arguments (versions, .md files or .test.js files) to pages.
function pagesForArgs(args, { docsRoot = DOCS_ROOT } = {}) {
  const pages = new Set()
  for (const arg of args) {
    const normal = arg.split(path.sep).join('/')
    if (fs.existsSync(path.join(docsRoot, normal)) && fs.statSync(path.join(docsRoot, normal)).isDirectory()) {
      walkMarkdown(path.join(docsRoot, normal)).forEach(p => pages.add(`${normal}/${p}`))
      continue
    }
    const abs = path.resolve(arg)
    const repoRel = path.relative(REPO_ROOT, abs).split(path.sep).join('/')
    const page = pageForRepoPath(repoRel) || (normal.endsWith('.md') ? normal : null)
    if (!page || !fs.existsSync(path.join(docsRoot, page))) throw new Error(`Not a docs page, test file or version: ${arg}`)
    pages.add(page)
  }
  return [...pages].sort()
}

module.exports = {
  coveredVersions,
  pagesInVersion,
  isCovered,
  pageForRepoPath,
  changedFiles,
  pagesForChangedFiles,
  pagesForArgs,
  DOCS_PREFIX,
  TESTS_PREFIX,
}
