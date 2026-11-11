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

test('docs checks: JSON blocks and prose', () => {
  const { checkJsonBlock, checkProse } = require('../lib/static/docs')
  const json = code => checkJsonBlock({ code }, { version: '30.2' }).map(p => p.rule)
  assert.deepEqual(json('{"a": 1}'), [])
  assert.ok(json('{"a": 1,}').includes('json-trailing-comma'))
  assert.ok(json('{\n  ...\n  "a": 1\n}').includes('json-ellipsis'))
  assert.ok(json('{ fields: [] }').includes('json-unquoted-key'))
  assert.ok(json('{"hits": [{"document": {"id": 0}}]}').includes('json-numeric-document-id'))
  assert.ok(json('{"state": 1, "version": "28.0"}').includes('json-version-mismatch'))
  assert.deepEqual(json('{"GET /collections": 3}'), [])
  assert.ok(checkJsonBlock({ code: '{"id": "1", ",first_name": "JK"}', jsonl: true }).some(p => p.rule === 'json-mangled-key'))
  const prose = (text, page = text) => checkProse({ code: text, line: 1 }, page).map(p => p.rule)
  assert.ok(prose('See [keys](./api-keys.md##generate)').includes('prose-double-hash-link'))
  assert.ok(prose('1. a\n2. b\n3. c\n3. d').includes('prose-list-numbering'))
  assert.deepEqual(prose('1. a\n1. b\n1. c'), [])
  assert.ok(prose('applies the default Porter stemmer', 'Snowball stemmer ... applies the default Porter stemmer').includes('prose-stemmer-name'))
})

test('stale comments and cosmetic code rules', () => {
  const r = (lang, code) => rules(checkBlock({ lang, code }))
  assert.ok(r('python', "cs = {'items': []}\n# Creates an override in the `companies` collection\nclient.curation_sets['curate_products'].upsert(cs)").includes('stale-comment'))
  assert.ok(!r('python', "# Upserts `curate_products`\nclient.curation_sets['curate_products'].upsert(cs)").includes('stale-comment'))
  assert.ok(r('swift', 'let c = Company(\n  name: "x",\n)').includes('swift-trailing-comma-arguments'))
  assert.ok(r('java', 'p.queryBy("product_name,embedding,");').includes('field-list-trailing-comma'))
  assert.ok(r('shell', 'x=$(echo -n "$a" | base64 -w0)').includes('shell-gnu-base64'))
  assert.ok(r('shell', 'curl "http://localhost:8108/x" -H "X-TYPESENSE-API-KEY: ${API_KEY}"').includes('shell-api-key-variable'))
  assert.ok(r('ts', 'await test.multiSearch.perform(r, {})').includes('js-unknown-client-variable'))
  assert.ok(r('js', '// Browser\n<script src="dist/typesense.min.js"></script>').includes('js-html-in-fence'))
  assert.ok(r('dart', '//   typesense: ^0.3.0').includes('dart-old-version-constraint'))
})

test('findings group failures the way the audit does', () => {
  const { buildFindings, findingsTable, headline, runtimeKey } = require('../lib/findings')
  const fail = (id, lang, extra) => ({ page: '99.9/api/p.md', id, lang, line: 10, status: 'fail', ...extra })
  const results = [
    // The same client-API problem in two examples: one finding.
    fail('a', 'python', { problems: [{ rule: 'py-import-keyword', message: 'm1', line: 1 }] }),
    fail('b', 'python', { problems: [{ rule: 'py-import-keyword', message: 'm1', line: 1 }] }),
    // The server rejects the JavaScript and curl versions alike: one finding.
    fail('c', 'js', { runtimeError: 'HTTP 400: Request failed with HTTP code 400 | Server said: The `match` field requires a `query` field to be present.' }),
    fail('c', 'shell', { runtimeError: 'HTTP 400: {"message":"The `match` field requires a `query` field to be present."}' }),
    // A different problem: its own finding.
    fail('d', 'json', { problems: [{ rule: 'json-trailing-comma', message: 'm2', line: 2 }] }),
    { page: '99.9/api/p.md', id: 'e', lang: 'js', status: 'pass' },
  ]
  const { findings } = buildFindings(results)
  assert.equal(findings.length, 3)
  assert.deepEqual(findings.map(f => f.severity).sort(), ['BREAK', 'BREAK', 'COSMETIC'])
  assert.match(headline(findings), /^3 findings = 2 BREAK, 0 WRONG, 1 COSMETIC/)
  assert.match(findingsTable(findings), /^\| # \| Sev \| Page \| Lang \| Snippet \| Problem \| Fix \|/)
  assert.equal(runtimeKey('exited with code 127: /usr/bin/bash: line 5: $: command not found'), '$: command not found')

  // A bracket and a parser error on the same line are one bug.
  const { problemsOf } = require('../lib/findings')
  const ruby = fail('r', 'ruby', { problems: [{ rule: 'brackets', line: 1, message: 'b' }, { rule: 'ruby-syntax', line: 1, message: 's' }] })
  assert.deepEqual(problemsOf(ruby).map(p => p.rule), ['ruby-syntax'])
})

test('a pull request runs only the snippets its diff touches', () => {
  const fs = require('fs')
  const os = require('os')
  const { parseDiff, snippetsForDiff } = require('../lib/changes')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changes-'))
  const docsRoot = path.join(root, 'docs')
  const testsRoot = path.join(root, 'tests')
  fs.mkdirSync(path.join(docsRoot, '99.9', 'api'), { recursive: true })
  fs.mkdirSync(path.join(testsRoot, '99.9', 'api'), { recursive: true })
  const page = [
    '# Page', // 1
    '', // 2
    '## First', // 3
    '', // 4
    '```js', // 5
    'client.collections().retrieve()', // 6
    '```', // 7
    '', // 8
    '## Second', // 9
    '', // 10
    '```js', // 11
    "client.collections('c').retrieve()", // 12
    '```', // 13
    '',
  ].join('\n')
  fs.writeFileSync(path.join(docsRoot, '99.9', 'api', 'p.md'), page)
  fs.writeFileSync(
    path.join(testsRoot, '99.9', 'api', 'p.test.js'),
    "const X = 1\n\nmodule.exports = {\n  snippets: {\n    'first': {\n      skip: 'a',\n    },\n    'second': {\n      skip: 'b',\n    },\n  },\n}\n",
  )
  const opts = { docsRoot, testsRoot }
  const run = diff => snippetsForDiff(parseDiff(diff), opts)

  // An edit inside the second example runs only that example.
  const docDiff = '+++ b/docs-site/content/99.9/api/p.md\n@@ -12 +12 @@\n'
  assert.deepEqual(run(docDiff), [{ page: '99.9/api/p.md', only: ['second'] }])
  // Renaming a heading runs the example under it.
  assert.deepEqual(run('+++ b/docs-site/content/99.9/api/p.md\n@@ -3 +3 @@\n'), [{ page: '99.9/api/p.md', only: ['first'] }])
  // A prose edit outside any example runs only that section's prose check.
  assert.deepEqual(run('+++ b/docs-site/content/99.9/api/p.md\n@@ -2,0 +2,1 @@\n').map(r => r.only), [['page']])
  // A changed test entry runs that example; a change outside the entries runs the page.
  assert.deepEqual(run('+++ b/snippet-tests/tests/99.9/api/p.test.js\n@@ -9 +9 @@\n'), [{ page: '99.9/api/p.md', only: ['second'] }])
  assert.deepEqual(run('+++ b/snippet-tests/tests/99.9/api/p.test.js\n@@ -1 +1 @@\n'), [{ page: '99.9/api/p.md', only: null }])
  // Pages of an uncovered version, and other files, run nothing.
  assert.deepEqual(run('+++ b/docs-site/content/1.0/api/p.md\n@@ -1 +1 @@\n+++ b/README.md\n@@ -1 +1 @@\n'), [])
  fs.rmSync(root, { recursive: true, force: true })
})

test('the issue links the findings table instead of inlining it', () => {
  const { issueBody } = require('../lib/issue')
  const { findingsDoc } = require('../lib/report')
  const results = [{ page: '99.9/api/p.md', id: 'a', lang: 'python', line: 10, status: 'fail', problems: [{ rule: 'py-import-keyword', message: 'm1', line: 1 }] }]
  const linked = issueBody({ report: { results }, tag: '99.9', docsVersion: '99.9', runUrl: 'https://run', findingsUrl: 'https://artifact' })
  assert.match(linked, /1 findings = 1 BREAK/)
  assert.match(linked, /\[findings\.md\]\(https:\/\/artifact\)/)
  assert.doesNotMatch(linked, /\| # \| Sev \|/)
  assert.match(issueBody({ report: { results }, tag: '99.9', docsVersion: '99.9' }), /\| # \| Sev \|/, 'no link: table inline')
  const doc = findingsDoc(results)
  assert.match(doc, /^# /)
  assert.match(doc, /\| N1 \| BREAK \|/)
})

test('the PR comment carries the findings table and is updated in place', async () => {
  const { commentBody, postComment, MARKER } = require('../lib/pr-comment')
  const fs = require('fs')
  const os = require('os')
  const results = [{ page: '99.9/api/p.md', id: 'a', lang: 'python', line: 10, status: 'fail', problems: [{ rule: 'py-import-keyword', message: 'm1', line: 1 }] }]
  const body = commentBody({ report: { results }, runUrl: 'https://run' })
  assert.ok(body.startsWith(MARKER))
  assert.match(body, /\| N1 \| BREAK \|/)
  assert.match(body, /does not block the merge/)
  assert.match(commentBody({ report: { results: [{ ...results[0], status: 'pass' }] } }), /No findings/)

  // Fake GitHub API: the second run updates the first run's comment.
  const comments = []
  const github = {
    paginate: async () => comments,
    rest: {
      issues: {
        listComments: () => {},
        createComment: async ({ body }) => { comments.push({ id: 1, body, user: { type: 'Bot' } }); return { data: { id: 1 } } },
        updateComment: async ({ comment_id, body }) => { comments.find(c => c.id === comment_id).body = body },
      },
    },
  }
  const context = { repo: { owner: 'o', repo: 'r' }, payload: { pull_request: { number: 7 } } }
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prc-')), 'report.json')
  fs.writeFileSync(file, JSON.stringify({ results }))
  assert.equal((await postComment({ github, context, reportFile: file })).action, 'created')
  fs.writeFileSync(file, JSON.stringify({ results: [{ ...results[0], status: 'pass' }] }))
  assert.equal((await postComment({ github, context, reportFile: file })).action, 'updated')
  assert.equal(comments.length, 1)
  assert.match(comments[0].body, /No findings/)
})

// The audit describes the docs as they were when it was written; a fixed
// example no longer shows its problem. So the harness is checked against the
// docs at that commit (config AUDIT_DOCS_REF), extracted from git.
function auditedDocs() {
  const fs = require('fs')
  const os = require('os')
  const { REPO_ROOT, AUDIT_DOCS_REF } = require('../lib/config')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audited-docs-'))
  const tar = spawnSync('git', ['archive', '--format=tar', AUDIT_DOCS_REF, 'docs-site/content'], { cwd: REPO_ROOT, maxBuffer: 1 << 30 })
  if (tar.status !== 0) throw new Error(`git archive ${AUDIT_DOCS_REF} failed (a shallow clone needs fetch-depth: 0): ${tar.stderr}`)
  // cwd rather than -C: GNU tar reads "C:\..." as a remote host on Windows.
  const x = spawnSync('tar', ['-x'], { cwd: dir, input: tar.stdout, maxBuffer: 1 << 30 })
  if (x.status !== 0) throw new Error(`tar failed: ${x.stderr}`)
  return path.join(dir, 'docs-site', 'content')
}

test('the harness flags every finding in the audit (BREAK, WRONG and COSMETIC)', { timeout: 300000 }, () => {
  const env = { ...process.env, SNIPPET_DOCS_ROOT: auditedDocs() }
  const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'audit.js')], { encoding: 'utf8', env })
  const summary = (res.stdout.split('\n').find(l => /audit findings flagged/.test(l)) || '').trim()
  assert.match(summary, /^127 of 127 audit findings flagged/, summary)
  assert.equal(res.status, 0, `${summary}\n${res.stdout.split('\n').filter(l => /^(MISSED|PARTIAL|UNMAPPED)/.test(l)).join('\n')}`)
})
