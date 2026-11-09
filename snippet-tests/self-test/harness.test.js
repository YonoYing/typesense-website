'use strict'

// Tests for the harness itself (no Typesense server needed):
//   npm run self-test

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const { extractFromMarkdown, slugify } = require('../lib/extract')
const { transform } = require('../lib/executors/js')
const { opsFromShell, renderEntry } = require('../lib/guess')
const { parseJsonValues } = require('../lib/json-stream')
const { updateBody, parseChecklist, stubComment } = require('../lib/checklist')
const { readTestKeys } = require('../lib/test-file')
const { addMissingEntries } = require('../lib/stub-writer')
const { compare } = require('../bin/latest-tag')

const PAGE = `
# Documents

## Index a document

<Tabs :tabs="['JavaScript','Shell']">
  <template v-slot:JavaScript>

\`\`\`js
client.collections('companies').documents().create({id: '1'})
\`\`\`

  </template>
  <template v-slot:Shell>

\`\`\`bash
# a comment that looks like a heading
curl "http://localhost:8108/collections/companies/documents" -X POST \\
  -H "X-TYPESENSE-API-KEY: \${TYPESENSE_API_KEY}" \\
  -d '{"id": "1", "company_name": "Stark"}'
\`\`\`

  </template>
</Tabs>

#### Sample Response

<Tabs :tabs="['JSON']">
  <template v-slot:JSON>

\`\`\`json
{"id": "1", "company_name": "Stark"}
\`\`\`

  </template>
</Tabs>

## Index a document

\`\`\`bash
curl "\${TYPESENSE_HOST}/collections/companies/documents/1" -X DELETE
\`\`\`

<!-- snippet-id: custom-id -->
\`\`\`shell
curl "\${TYPESENSE_HOST}/health"
\`\`\`
`

test('extracts groups with stable IDs, responses and pinned IDs', () => {
  const groups = extractFromMarkdown(PAGE)
  assert.deepEqual(groups.map(g => g.id), ['index-a-document', 'index-a-document-1', 'custom-id'])
  assert.deepEqual(groups[0].blocks.map(b => b.lang), ['js', 'shell'])
  assert.equal(groups[0].responses.length, 1)
})

test('slugify matches VuePress anchors', () => {
  assert.equal(slugify('Role-based access <Badge text="Advanced"/>'), 'role-based-access')
  assert.equal(slugify('Counter rule (multiple events ➜ multiple rules)'), 'counter-rule-multiple-events-➜-multiple-rules')
  assert.equal(slugify('`filter_by` options'), 'filter-by-options')
})

test('JS transform awaits calls and returns the last value', () => {
  const out = transform("let schema = {}\nclient.collections().create(schema)")
  assert.match(out, /return await \(client\.collections\(\)\.create\(schema\)\)/)
  const decl = transform("let r = client.collections('c').retrieve()")
  assert.match(decl, /let r = await \(client/)
  assert.match(decl, /return r;/)
  assert.match(transform("import Typesense from 'typesense'\nclient.x()"), /require\("typesense"\)/)
})

test('parses curl commands', () => {
  const [op] = opsFromShell(`curl "\${TYPESENSE_HOST}/collections?src_name=a" -X POST -d '{"name": "b"}'`)
  assert.equal(op.method, 'POST')
  assert.equal(op.path, '/collections')
  assert.equal(op.query.src_name, 'a')
  assert.deepEqual(op.body, { name: 'b' })
  const [imp] = opsFromShell('curl -X POST --data-binary @documents.jsonl "http://localhost:8108/collections/c/documents/import"')
  assert.equal(imp.file, 'documents.jsonl')
})

test('parses concatenated JSON and JSON Lines', () => {
  assert.deepEqual(parseJsonValues('{"a":1}{"b":"}"}'), [{ a: 1 }, { b: '}' }])
  assert.deepEqual(parseJsonValues('{"success":true}\n{"success":false}'), [{ success: true }, { success: false }])
})

test('rendered entries are valid JavaScript with guessed checks', () => {
  const groups = extractFromMarkdown(PAGE)
  const src = `module.exports = { snippets: {\n${groups.map(g => renderEntry(g, { todo: true })).join('\n')}\n} }`
  assert.doesNotThrow(() => new Function('module', src)({}))
  assert.match(src, /expectExists\('\/collections\/companies\/documents\/1'\)/)
  assert.match(src, /expectGone\('\/collections\/companies\/documents\/1'\)/)
  assert.match(src, /assert\.equal\(response\.ok, true\)/)
})

test('stub writer inserts entries in page order and keeps existing ones', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stub-'))
  const file = path.join(dir, 'page.test.js')
  fs.writeFileSync(file, "module.exports = {\n  snippets: {\n    'custom-id': { skip: 'keep me' },\n  },\n}\n")
  const groups = extractFromMarkdown(PAGE)
  const added = addMissingEntries({ testFile: file, docRel: '30.2/api/page.md', allGroups: groups, groups, todo: true })
  assert.deepEqual(added, ['index-a-document', 'index-a-document-1'])
  const info = readTestKeys(file)
  assert.deepEqual([...info.keys.keys()], ['index-a-document', 'index-a-document-1', 'custom-id'])
  assert.equal(info.keys.get('index-a-document').todo, true)
  assert.equal(info.keys.get('custom-id').skip, true)
  assert.match(fs.readFileSync(file, 'utf8'), /keep me/)
})

test('checklist keeps ticked boxes and blocks until done', () => {
  const coverage = {
    items: [
      { key: 'p.md#a', page: 'p.md', id: 'a', state: 'todo', testFile: 't.js' },
      { key: 'p.md#b', page: 'p.md', id: 'b', state: 'done', testFile: 't.js' },
    ],
  }
  const first = updateBody('My PR', coverage)
  assert.equal(first.items.length, 1, 'done items are only kept once listed')
  assert.ok(first.blocking.length >= 2)
  assert.match(first.body, /^My PR\n\n<!-- snippet-tests:start -->/)

  const ticked = first.body.replace('- [ ]', '- [x]')
  assert.equal(parseChecklist(ticked).get('p.md#a'), true)
  const stillTodo = updateBody(ticked, coverage)
  assert.deepEqual(stillTodo.blocking, ['p.md › a: test still marked todo in t.js'])

  const finished = updateBody(ticked, { items: [{ ...coverage.items[0], state: 'done' }] })
  assert.deepEqual(finished.blocking, [])
  assert.equal(finished.changed, true)

  const removed = updateBody(ticked, { items: [] })
  assert.equal(removed.body, 'My PR')
})

test('stub comment lists missing tests per file', () => {
  const body = stubComment({ items: [{ state: 'missing', testFile: 't.js', stub: "    'a': {}," }] })
  assert.match(body, /snippet-tests:stubs/)
  assert.match(body, /'a': \{\},/)
  assert.equal(stubComment({ items: [] }), null)
})

test('errors inside 200 responses are caught', () => {
  const { embeddedError } = require('../lib/runner')
  assert.match(embeddedError([{ results: [{ hits: [] }, { code: 400, error: 'No search fields' }] }]), /No search fields/)
  const importCode = 'curl -X POST "$TYPESENSE_HOST/collections/c/documents/import"'
  assert.match(embeddedError([{ success: true }, { success: false, error: 'Bad JSON.' }], importCode), /Bad JSON/)
  assert.equal(embeddedError([{ success: false }], 'curl -X POST "$TYPESENSE_HOST/operations/vote"'), null)
  assert.equal(embeddedError([{ results: [{ hits: [] }] }, { success: true }], importCode), null)
})

test('latest tag ordering puts releases above their RCs', () => {
  const tags = ['30.2', '31.0.rc9', '31.0.rc25', '0.25.2', '30.10']
  assert.equal(tags.sort(compare).pop(), '31.0.rc25')
  assert.equal(['31.0.rc25', '31.0'].sort(compare).pop(), '31.0')
})

test('coverage finds new examples and writes todo stubs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-'))
  const base = path.join(root, 'base')
  const head = path.join(root, 'head')
  const page = 'docs-site/content/30.2/api/page.md'
  for (const dir of [base, head]) fs.mkdirSync(path.join(dir, path.dirname(page)), { recursive: true })
  fs.mkdirSync(path.join(head, 'snippet-tests/tests/30.2'), { recursive: true })
  const groupsText = PAGE.split('## Index a document')
  fs.writeFileSync(path.join(base, page), groupsText.slice(0, 2).join('## Index a document'))
  fs.writeFileSync(path.join(head, page), PAGE)
  const out = path.join(root, 'coverage.json')
  execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'coverage.js'), '--base', base, '--head', head, '--write-stubs', '--out', out], { stdio: 'pipe' })
  const result = JSON.parse(fs.readFileSync(out, 'utf8'))
  assert.deepEqual(result.items.map(i => `${i.id}:${i.state}`), ['index-a-document-1:todo', 'custom-id:todo'])
  assert.deepEqual(result.stubsWritten, ['snippet-tests/tests/30.2/api/page.test.js'])
})
