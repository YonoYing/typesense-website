'use strict'

// Runs every snippet group on a docs page, in page order, for each language.
//
// Pages are run top to bottom against a fresh server because docs examples
// build on each other (create a collection, index into it, search it). A test
// entry can add setup() to make an example independent of earlier ones.
//
// Every client-language block on the page is also checked statically
// (lib/static): syntax, calls the client library does not have, tabs that
// disagree with their siblings. Languages without an executor get a result
// from the static checks alone; executable languages get both, and a static
// problem fails the example even when it happened to run.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { DOCS_ROOT, TESTS_ROOT, EXECUTABLE_LANGUAGES } = require('./config')
const { extractFromFile, CLIENT_LANGUAGES } = require('./extract')
const { loadTests, testFileFor } = require('./test-file')
const { createApi, createHelpers } = require('./helpers')
const { startServer } = require('./server')
const staticChecks = require('./static')
const fixtures = require('./fixtures')
const executors = {
  js: require('./executors/js'),
  shell: require('./executors/shell'),
}

function forLang(value, lang) {
  if (value == null || value === false) return null
  if (typeof value === 'string' || value === true) return value === true ? 'yes' : value
  if (typeof value === 'object' && !(value instanceof RegExp)) return value[lang] || null
  return value
}

// `static: false` or `static: { python: false }` turns the static checks off
// for an example (an install command in a code block, a deliberate fragment).
function staticDisabled(entry, lang) {
  if (!entry || entry.static === undefined) return false
  if (entry.static === false) return true
  return typeof entry.static === 'object' && entry.static[lang] === false
}

function latestVersion() {
  const versions = require(path.join(DOCS_ROOT, '..', '..', 'typesenseVersions.json'))
  return versions.typesenseLatestVersion
}

function docsVersionOf(docRel) {
  const first = docRel.split('/')[0]
  return /^\d/.test(first) ? first : latestVersion()
}

function defaultImageFor(docRel) {
  return `typesense/typesense:${docsVersionOf(docRel)}`
}

function errorText(err) {
  if (!err) return 'unknown error'
  return err.message || String(err)
}

// Multi-search and import answer HTTP 200 even when a search or a document
// failed, reporting the error inside the body. Returns the first such error.
// The import check only applies to examples that import documents, since
// other endpoints (e.g. /operations/vote) also answer {"success": false}.
function embeddedError(responses, code = '') {
  const isImport = /documents\/import|\.import\(/.test(code)
  for (const response of responses || []) {
    if (response && Array.isArray(response.results)) {
      const bad = response.results.find(r => r && r.error)
      if (bad) return `a search inside the multi-search failed: ${bad.error}`
    }
    if (!isImport) continue
    const lines = Array.isArray(response) ? response : [response]
    const failed = lines.find(l => l && typeof l === 'object' && l.success === false)
    if (failed) return `an imported document failed: ${failed.error || JSON.stringify(failed)}`
  }
  return null
}

function matchesExpectedError(expectError, error) {
  if (expectError === true) return true
  if (expectError instanceof RegExp) return expectError.test(error || '')
  if (typeof expectError === 'string') return (error || '').includes(expectError)
  return false
}

async function runGroup({ group, entry, lang, baseCtx }) {
  const block = group.blocks.find(b => b.lang === lang)
  const executor = executors[lang]
  const result = { id: group.id, line: block ? block.line : group.line, heading: group.heading.title }

  if (!executor.isRunnable(block.code)) {
    return { ...result, status: 'skip', reason: 'example makes no API call' }
  }
  if (entry && entry.langs && !entry.langs.includes(lang)) {
    return { ...result, status: 'skip', reason: `test limited to ${entry.langs.join(', ')}` }
  }
  const skip = entry && forLang(entry.skip, lang)
  if (skip) return { ...result, status: 'skip', reason: skip }

  const xfail = entry && forLang(entry.xfail, lang)
  const started = Date.now()
  let failure = null
  try {
    const ctx = { ...baseCtx, lang, group, code: block.code }
    if (entry && entry.setup) await entry.setup(ctx)
    const exec = await executor.run(block.code, {
      cwd: baseCtx.cwd,
      timeoutMs: (entry && entry.timeout) || 60000,
      vars: (entry && entry.vars) || {},
    })
    Object.assign(ctx, {
      response: exec.response,
      responses: exec.responses || [],
      output: exec.output,
      result: exec,
    })
    const expectError = entry && entry.expectError
    if (expectError) {
      if (exec.ok) throw new Error('expected the example to fail, but it succeeded')
      if (!matchesExpectedError(expectError, exec.error)) {
        throw new Error(`example failed with an unexpected error: ${exec.error}`)
      }
    } else if (!exec.ok) {
      throw new Error(exec.error)
    } else if (!(entry && entry.allowEmbeddedErrors)) {
      const inner = embeddedError(exec.responses, block.code)
      if (inner) throw new Error(inner)
    }
    if (entry && entry.verify) await entry.verify(ctx)
  } catch (err) {
    failure = errorText(err)
  }
  const durationMs = Date.now() - started
  if (xfail) {
    return failure
      ? { ...result, status: 'xfail', reason: xfail, error: failure, durationMs }
      : { ...result, status: 'xpass', reason: xfail, durationMs }
  }
  return failure ? { ...result, status: 'fail', error: failure, durationMs } : { ...result, status: 'pass', durationMs }
}

// Folds the static problems of a block into its runtime result. A static
// problem is a failure even when the example ran: the sibling tabs, or the
// client library's real API, say the example is wrong.
function withStatic(result, problems, entry, lang) {
  if (!problems || !problems.length) return result
  const text = staticChecks.formatProblems(problems)
  const error = result.error ? `${result.error}\n${text}` : text
  const xfail = entry && forLang(entry.xfail, lang)
  if (result.status === 'skip' || result.status === 'pass' || result.status === 'xpass') {
    const status = xfail ? 'xfail' : 'fail'
    return { ...result, status, error, check: 'static', reason: xfail || undefined }
  }
  return { ...result, error, check: result.status === 'xfail' ? 'static' : 'runtime+static' }
}

async function runPage({
  docRel,
  image,
  langs = EXECUTABLE_LANGUAGES,
  only,
  log = () => {},
  docsRoot = DOCS_ROOT,
  testsRoot = TESTS_ROOT,
  static: runStatic = true,
}) {
  const docFile = path.join(docsRoot, docRel)
  const groups = extractFromFile(docFile).filter(g => !only || only.includes(g.id))
  const testFile = testFileFor(docRel, testsRoot)
  const tests = loadTests(testFile) || { snippets: {} }
  const resolvedImage = image || tests.image || defaultImageFor(docRel)
  const results = []
  const base = { page: docRel }

  if (tests.skip) {
    for (const g of groups) results.push({ ...base, id: g.id, line: g.line, heading: g.heading.title, lang: '*', status: 'skip', reason: tests.skip })
    return results
  }

  const staticProblems = runStatic ? staticChecks.checkPage(groups, { version: docsVersionOf(docRel) }) : new Map()
  const problemsFor = (group, lang) => {
    const entry = tests.snippets[group.id]
    if (staticDisabled(entry, lang)) return []
    return staticProblems.get(`${group.id}|${lang}`) || []
  }

  // Languages without an executor (or not selected to run): static only.
  const executed = new Set(langs.filter(l => executors[l]))
  for (const group of groups) {
    for (const block of group.blocks) {
      if (!CLIENT_LANGUAGES.has(block.lang) || executed.has(block.lang)) continue
      const entry = tests.snippets[group.id]
      const problems = problemsFor(group, block.lang)
      const xfail = entry && forLang(entry.xfail, block.lang)
      let r = { id: group.id, line: block.line, heading: group.heading.title, lang: block.lang, check: 'static' }
      if (!problems.length) r = { ...r, status: 'pass' }
      else if (xfail) r = { ...r, status: 'xfail', reason: xfail, error: staticChecks.formatProblems(problems) }
      else r = { ...r, status: 'fail', error: staticChecks.formatProblems(problems) }
      r = { ...base, ...r, untested: !entry, todo: !!(entry && entry.todo) }
      results.push(r)
      log(r)
    }
  }

  for (const lang of langs) {
    if (!executors[lang]) continue
    const runnable = groups.filter(g => g.blocks.some(b => b.lang === lang))
    if (runnable.length === 0) continue

    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'snippet-'))
    const api = createApi()
    const baseCtx = {
      client: executors.js.createClient(),
      api,
      cwd,
      fixtures,
      lang,
      ...createHelpers({ api, cwd }),
    }

    let setupError = null
    try {
      await startServer({ image: resolvedImage, args: (tests.server && tests.server.args) || [] })
      if (tests.beforeAll) await tests.beforeAll(baseCtx)
    } catch (err) {
      setupError = errorText(err)
    }

    for (const group of runnable) {
      const entry = tests.snippets[group.id]
      let r
      if (setupError) {
        r = { id: group.id, line: group.line, heading: group.heading.title, status: 'fail', error: `page setup failed: ${setupError}` }
      } else {
        r = await runGroup({ group, entry, lang, baseCtx })
      }
      r = withStatic(r, problemsFor(group, lang), entry, lang)
      r = { ...base, ...r, lang, untested: !entry, todo: !!(entry && entry.todo) }
      results.push(r)
      log(r)
    }
    fs.rmSync(cwd, { recursive: true, force: true })
  }
  return results
}

module.exports = { runPage, defaultImageFor, latestVersion, embeddedError, withStatic }
