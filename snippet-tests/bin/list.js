#!/usr/bin/env node
'use strict'

// Lists the snippet IDs on a docs page, or prints one example's code.
//
//   node bin/list.js 30.2/api/documents.md
//   node bin/list.js 30.2/api/documents.md index-a-single-document [shell]

const path = require('path')
const { DOCS_ROOT } = require('../lib/config')
const { extractFromFile } = require('../lib/extract')
const { testFileFor, readTestKeys } = require('../lib/test-file')
const { pagesForArgs } = require('../lib/pages')

const [target, id, lang] = process.argv.slice(2)
if (!target) {
  console.error('Usage: node bin/list.js <page.md> [snippet-id] [language]')
  process.exit(1)
}
const [docRel] = pagesForArgs([target])
const groups = extractFromFile(path.join(DOCS_ROOT, docRel))

if (!id) {
  const { keys } = readTestKeys(testFileFor(docRel))
  for (const g of groups) {
    const t = keys.get(g.id)
    const state = !t ? 'no test' : t.todo ? 'todo' : t.skip ? 'skipped' : 'tested'
    console.log(`${g.id.padEnd(60)} line ${String(g.line).padEnd(5)} ${state.padEnd(8)} ${g.blocks.map(b => b.lang).join(',')}`)
  }
} else {
  const group = groups.find(g => g.id === id)
  if (!group) {
    console.error(`No snippet "${id}" on ${docRel}`)
    process.exit(1)
  }
  for (const block of group.blocks.filter(b => !lang || b.lang === lang)) {
    console.log(`--- ${block.lang} (line ${block.line})\n${block.code}\n`)
  }
  for (const block of group.responses) console.log(`--- response (line ${block.line})\n${block.code}\n`)
}
