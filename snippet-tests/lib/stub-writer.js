'use strict'

// Adds test entries to a page's test file without disturbing what is already
// there. New entries are placed in page order, after the entry for the
// snippet that comes before them on the page.

const fs = require('fs')
const path = require('path')
const { readTestKeys } = require('./test-file')
const { renderEntry } = require('./guess')

function newFileSource(docRel) {
  return [
    `// Tests for the examples on docs-site/content/${docRel}`,
    '//',
    '// Each key in `snippets` is a snippet ID: the anchor of the heading above the',
    '// example, with --2, --3 for later examples under the same heading. Examples',
    '// run top to bottom against a fresh Typesense server, once per language.',
    '// See snippet-tests/README.md for everything a test can do.',
    '',
    'module.exports = {',
    '  snippets: {',
    '  },',
    '}',
    '',
  ].join('\n')
}

// Inserts `text` (one rendered entry) after the entry for `afterId`, or at
// the start of the snippets object when afterId is null.
function insertEntry(source, info, afterId, text) {
  const { snippetsNode, keys } = info
  if (!snippetsNode) throw new Error('test file has no `snippets: { ... }` object in module.exports')
  if (afterId && keys.has(afterId)) {
    const end = keys.get(afterId).end
    let p = end
    while (p < source.length && /[ \t]/.test(source[p])) p++
    if (source[p] === ',') return source.slice(0, p + 1) + '\n' + text + source.slice(p + 1)
    return source.slice(0, end) + ',\n' + text + source.slice(end)
  }
  const open = snippetsNode.start + 1
  return source.slice(0, open) + '\n' + text + source.slice(open)
}

// Adds entries for `groups` whose IDs are missing from the test file.
// `allGroups` is every group on the page, used to keep page order.
// Returns the IDs that were added.
function addMissingEntries({ testFile, docRel, allGroups, groups, todo }) {
  let source = fs.existsSync(testFile) ? fs.readFileSync(testFile, 'utf8') : newFileSource(docRel)
  const tmp = `${testFile}.tmp-${process.pid}`
  const added = []
  const order = allGroups.map(g => g.id)

  for (const group of groups) {
    fs.mkdirSync(path.dirname(testFile), { recursive: true })
    fs.writeFileSync(tmp, source)
    const info = readTestKeys(tmp)
    if (info.keys.has(group.id)) continue
    const before = order.slice(0, order.indexOf(group.id)).reverse().find(id => info.keys.has(id)) || null
    source = insertEntry(source, info, before, renderEntry(group, { todo }))
    added.push(group.id)
  }
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
  if (added.length) {
    fs.mkdirSync(path.dirname(testFile), { recursive: true })
    fs.writeFileSync(testFile, source)
  }
  return added
}

module.exports = { addMissingEntries, newFileSource }
