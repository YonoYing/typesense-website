#!/usr/bin/env node
'use strict'

// Finds examples a PR adds and checks each one has a finished test.
//
//   node bin/coverage.js --base <base checkout> --head <PR checkout> [--write-stubs] [--out coverage.json]
//
// An example is "new" when its snippet ID exists on the PR's version of a page
// but not on the base version. Each new example gets one of these states:
//   missing  no entry in the page's test file
//   todo     an entry exists but is still marked `todo`
//   done     an entry exists and is not marked `todo`
//
// With --write-stubs, a guessed test marked `todo` is written for every
// missing example, into the head checkout's test files.
//
// This script never executes code from the head checkout: test files are only
// parsed. That makes it safe to run on pull requests from forks.

const fs = require('fs')
const path = require('path')
const { extractFromMarkdown } = require('../lib/extract')
const { readTestKeys, testFileFor } = require('../lib/test-file')
const { coveredVersions, pagesInVersion } = require('../lib/pages')
const { addMissingEntries } = require('../lib/stub-writer')
const { renderEntry } = require('../lib/guess')

function parseArgs(argv) {
  const opts = { writeStubs: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--base') opts.base = argv[++i]
    else if (a === '--head') opts.head = argv[++i]
    else if (a === '--out') opts.out = argv[++i]
    else if (a === '--write-stubs') opts.writeStubs = true
  }
  if (!opts.base || !opts.head) {
    console.error('Usage: node bin/coverage.js --base <dir> --head <dir> [--write-stubs] [--out file]')
    process.exit(1)
  }
  return opts
}

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const baseDocs = path.resolve(opts.base, 'docs-site', 'content')
  const headRoot = path.resolve(opts.head)
  const headDocs = path.join(headRoot, 'docs-site', 'content')
  const headTests = path.join(headRoot, 'snippet-tests', 'tests')

  const items = []
  const stubsWritten = []

  for (const version of coveredVersions(headTests)) {
    for (const page of pagesInVersion(version, headDocs)) {
      const headText = read(path.join(headDocs, page))
      const baseText = read(path.join(baseDocs, page))
      if (headText === baseText) continue

      const headGroups = extractFromMarkdown(headText)
      const baseIds = new Set(extractFromMarkdown(baseText).map(g => g.id))
      const newGroups = headGroups.filter(g => !baseIds.has(g.id))
      if (!newGroups.length) continue

      const testFile = testFileFor(page, headTests)
      const testFileRel = path.relative(headRoot, testFile).split(path.sep).join('/')
      let keys = readTestKeys(testFile).keys

      const missing = newGroups.filter(g => !keys.has(g.id))
      if (opts.writeStubs && missing.length) {
        const added = addMissingEntries({ testFile, docRel: page, allGroups: headGroups, groups: missing, todo: true })
        if (added.length) stubsWritten.push(testFileRel)
        keys = readTestKeys(testFile).keys
      }

      for (const g of newGroups) {
        const entry = keys.get(g.id)
        const state = !entry ? 'missing' : entry.todo ? 'todo' : 'done'
        items.push({
          key: `${page}#${g.id}`,
          page,
          id: g.id,
          heading: g.heading.title,
          line: g.line,
          state,
          stubWritten: missing.includes(g) && state !== 'missing',
          testFile: testFileRel,
          stub: state === 'missing' ? renderEntry(g, { todo: true }) : null,
        })
      }
    }
  }

  const result = { items, stubsWritten }
  if (opts.out) fs.writeFileSync(opts.out, JSON.stringify(result, null, 2))
  for (const item of items) console.log(`${item.state.padEnd(7)} ${item.page} › ${item.id}`)
  console.log(`${items.length} new example(s); stubs written to ${stubsWritten.length} file(s).`)
}

main()
