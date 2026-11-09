'use strict'

// Tests for the static checks (lib/static) and the audit cross-check.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { spawnSync } = require('child_process')
const { checkBlock, checkPage } = require('../lib/static')
const { checkBrackets } = require('../lib/static/brackets')
const { extractFromMarkdown } = require('../lib/extract')
const { withStatic } = require('../lib/runner')

const rules = problems => problems.map(p => p.rule)

test('brackets: mismatches and unclosed brackets, strings and comments ignored', () => {
  assert.deepEqual(checkBrackets('a = { "x": "}" }  // (', 'js'), [])
  assert.match(checkBrackets('foo(a, b};', 'dart')[0].message, /`}` on line 1 closes the `\(`/)
  assert.match(checkBrackets('f(\n  g()\n', 'java')[0].message, /never closed/)
  assert.deepEqual(checkBrackets('"embed" => [\n  "x" => 1\n]', 'ruby'), [])
  assert.match(checkBrackets('"embed" => [\n  "x" => 1\n}', 'ruby')[0].message, /closes the `\[`/)
})

test('client API rules know what the clients do not have', () => {
  assert.ok(rules(checkBlock({ lang: 'js', code: "client.curationSets().upsert('x', cs)" })).includes('js-curation-sets-upsert'))
  assert.ok(rules(checkBlock({ lang: 'js', code: "client.collections('products').create(schema)" })).includes('js-collection-create'))
  assert.ok(rules(checkBlock({ lang: 'python', code: "client.curation_sets['x'].items['y'].upsert(i)" })).includes('py-set-items-attribute'))
  assert.ok(rules(checkBlock({ lang: 'ruby', code: "client.synonym_sets['x'].upsert(s)" })).includes('rb-synonym-set-upsert'))
  assert.ok(rules(checkBlock({ lang: 'php', code: "$client->curationSets['x']->items['y']->delete();" })).includes('php-curation-set-items'))
  assert.ok(rules(checkBlock({ lang: 'dart', code: "await client.curation_sets.retrieve('x');" })).includes('dart-snake-case-client-field'))
  assert.ok(rules(checkBlock({ lang: 'java', code: 'ApiKey k = client.keys(1).retrieve();' })).includes('java-keys-int-literal'))
  assert.ok(rules(checkBlock({ lang: 'go', code: 'client.SynonymSets("x").Retrieve(context.Background())' })).includes('go-synonym-sets'))
  assert.ok(rules(checkBlock({ lang: 'swift', code: 'let (c, r) = try await client.collections().retrieveAll()' })).includes('swift-collections-call'))
  // Correct calls stay quiet.
  assert.deepEqual(checkBlock({ lang: 'js', code: "client.curationSets('x').upsert(cs)\nclient.collections().create(schema)" }), [])
  assert.deepEqual(checkBlock({ lang: 'java', code: 'ApiKey k = client.keys(1L).retrieve();' }), [])
})

test('language mix-ups and typos', () => {
  assert.ok(rules(checkBlock({ lang: 'python', code: 'let schema = {"a": 1}\nclient.collections.create(schema)' })).some(r => /py-js-let|python-syntax/.test(r)))
  assert.ok(rules(checkBlock({ lang: 'python', code: 'client.collections["c"].documents.delete({"truncate": true})' })).some(r => /py-js-booleans|python-syntax/.test(r)))
  assert.ok(rules(checkBlock({ lang: 'php', code: "client.collections['c'].documents.import($d);" })).includes('php-js-syntax'))
  assert.ok(rules(checkBlock({ lang: 'ruby', code: "collections['c'].documents.import(d)" })).includes('rb-missing-client-receiver'))
  assert.ok(rules(checkBlock({ lang: 'dart', code: "# comment\nfinal x = 1;" })).includes('dart-hash-comment'))
  const java = checkBlock({ lang: 'java', code: 'CollectionSchema collectionSchema = new CollectionSchema();\ncollectionschema.name("c");' })
  assert.ok(rules(java).includes('undeclared-identifier'))
  assert.ok(rules(checkBlock({ lang: 'dart', code: "final aliasedCollection = {'a': 1};\nawait client.aliases.upsert('c', aliased_collection);" })).includes('undeclared-identifier'))
  assert.ok(rules(checkBlock({ lang: 'java', code: 'Map<String, Object> d = client.collections("c").documents("1").retrieve()' })).includes('missing-semicolon'))
  assert.ok(rules(checkBlock({ lang: 'php', code: "$a = [\n  'x' => 1\n]\n$client->aliases->upsert('c', $a)" })).includes('missing-semicolon'))
})

test('curl checks: continuations, JSON bodies, ports, search parameters', () => {
  assert.ok(rules(checkBlock({ lang: 'shell', code: 'curl "http://localhost:8108/aliases/c" -X DELETE\n    -H "X-TYPESENSE-API-KEY: x"' })).includes('curl-missing-continuation'))
  assert.deepEqual(checkBlock({ lang: 'shell', code: 'curl "http://localhost:8108/aliases/c" -X DELETE \\\n    -H "X-TYPESENSE-API-KEY: x"' }), [])
  assert.ok(rules(checkBlock({ lang: 'shell', code: `curl "http://localhost:8108/multi_search" -X POST -d '{"searches": [{"collection": "b", "q": "the" "query_by": "t"}]}'` })).includes('curl-invalid-json'))
  const r = rules(checkBlock({ lang: 'shell', code: `curl "http://localhost:8108/multi_search" -X POST -d '{"searches": [{"q": "famous"}]}'` }))
  assert.ok(r.includes('multi-search-no-collection') && r.includes('search-without-query-by'))
  assert.deepEqual(checkBlock({ lang: 'shell', code: `curl "http://localhost:8108/multi_search" -X POST -d '{"searches": [{"preset": "p"}]}'` }), [])
  assert.ok(rules(checkBlock({ lang: 'shell', code: "curl 'http://localhost/multi_search' -X POST" })).includes('curl-no-port'))
  assert.ok(rules(checkBlock({ lang: 'shell', code: 'curl "http://localhost:8108/collections/c/documents/search" --data-urlencode "q=x"' })).includes('curl-urlencode-without-get'))
  assert.deepEqual(checkBlock({ lang: 'shell', code: 'curl -G "http://localhost:8108/collections/c/documents/search" --data-urlencode "q=x"' }), [])
  assert.ok(rules(checkBlock({ lang: 'shell', code: 'curl "http://localhost:8108/collections/c/documents/search\\\n      ?q=*"' })).includes('curl-url-split-with-indent'))
  // Not a command: nothing to check.
  assert.deepEqual(checkBlock({ lang: 'shell', code: 'sort_by=title(missing_values: first):asc' }), [])
})

const PAGE = `
## Create a collection

<Tabs :tabs="['JavaScript','Python','Ruby','Shell']">
  <template v-slot:JavaScript>

\`\`\`js
client.collections().create({ "name": "places", "fields": [] })
\`\`\`

  </template>
  <template v-slot:Shell>

\`\`\`bash
curl "http://localhost:8108/collections" -X POST -d '{"name": "places", "fields": []}'
\`\`\`

  </template>
</Tabs>

## Search

<Tabs :tabs="['JavaScript','Python','Ruby','Dart','Shell']">
  <template v-slot:JavaScript>

\`\`\`js
let p = { 'q': '*', 'query_by': 'title' }
client.collections('companies').documents().search(p)
\`\`\`

  </template>
  <template v-slot:Python>

\`\`\`py
p = { 'q': '*', 'query_by': 'title' }
client.collections['places'].documents.search(p)
\`\`\`

  </template>
  <template v-slot:Ruby>

\`\`\`rb
p = { 'q' => '*', 'query_by' => 'title' }
client.collections['places'].documents.search(p)
\`\`\`

  </template>
  <template v-slot:Shell>

\`\`\`bash
curl -G "http://localhost:8108/collections/places/documents/search" --data-urlencode 'q=*' --data-urlencode 'query_by=title'
\`\`\`

  </template>
</Tabs>
`

test('cross-tab checks: a tab that uses a different collection from the one the page creates', () => {
  const groups = extractFromMarkdown(PAGE)
  const problems = checkPage(groups)
  const js = problems.get('search|js') || []
  assert.ok(js.some(p => p.rule === 'tab-collection-differs'), JSON.stringify([...problems]))
  assert.equal(problems.get('search|python'), undefined)
  assert.equal(problems.get('search|shell'), undefined)
})

test('static problems fail an example that ran, unless the test disables them', () => {
  const pass = { id: 'x', status: 'pass' }
  const problems = [{ rule: 'r', message: 'm' }]
  assert.equal(withStatic(pass, problems, null, 'js').status, 'fail')
  assert.equal(withStatic(pass, [], null, 'js').status, 'pass')
  assert.equal(withStatic({ id: 'x', status: 'skip', reason: 'no sox' }, problems, null, 'shell').status, 'fail')
  assert.equal(withStatic(pass, problems, { xfail: 'known' }, 'js').status, 'xfail')
})

test('the harness flags every BREAK and WRONG example in the audit', { timeout: 300000 }, () => {
  const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'audit.js')], { encoding: 'utf8' })
  const summary = (res.stdout.split('\n').find(l => /BREAK\/WRONG rows flagged/.test(l)) || '').trim()
  assert.equal(res.status, 0, `${summary}\n${res.stdout.split('\n').filter(l => /^(MISSED|PARTIAL|UNMAPPED)/.test(l)).join('\n')}`)
})
