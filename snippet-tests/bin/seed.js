#!/usr/bin/env node
'use strict'

// Writes guessed tests for every example that has none yet. Existing tests are
// never touched.
//
//   node bin/seed.js 30.2                     every page in a docs version
//   node bin/seed.js docs-site/content/30.2/api/documents.md
//   node bin/seed.js --todo <page>            mark new entries as todo

const path = require('path')
const { DOCS_ROOT } = require('../lib/config')
const { extractFromFile } = require('../lib/extract')
const { testFileFor } = require('../lib/test-file')
const { pagesForArgs } = require('../lib/pages')
const { addMissingEntries } = require('../lib/stub-writer')

const args = process.argv.slice(2)
const todo = args.includes('--todo')
const targets = args.filter(a => a !== '--todo')
if (!targets.length) {
  console.error('Usage: node bin/seed.js [--todo] <version | page.md> ...')
  process.exit(1)
}

let total = 0
for (const docRel of pagesForArgs(targets)) {
  const groups = extractFromFile(path.join(DOCS_ROOT, docRel))
  if (!groups.length) continue
  const testFile = testFileFor(docRel)
  const added = addMissingEntries({ testFile, docRel, allGroups: groups, groups, todo })
  if (added.length) console.log(`${docRel}: added ${added.length} test(s)`)
  total += added.length
}
console.log(`Added ${total} test(s).`)
