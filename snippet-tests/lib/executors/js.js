'use strict'

// Runs a JavaScript example in-process with the official typesense-js client.
//
// Docs examples are fragments: they use an implicit `client`, rarely `await`
// their calls, and end with a bare expression. To run them faithfully we parse
// the code and rewrite it so that:
//   - every top-level expression and call initialiser is awaited, so a failed
//     request fails the example instead of becoming an unhandled rejection;
//   - the final expression (or the last declared variable) is returned, which
//     becomes the `response` handed to the test's verify().

const acorn = require('acorn')
const fs = require('fs')
const Typesense = require('typesense')
const { API_KEY, PORT } = require('../config')

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

// Most examples call `client.…`; a few name the client `typesense`.
function isRunnable(code) {
  return /\bclient\b|\bTypesense\b|\btypesense\./.test(code)
}

function createClient() {
  return new Typesense.Client({
    nodes: [{ host: 'localhost', port: PORT, protocol: 'http' }],
    apiKey: API_KEY,
    connectionTimeoutSeconds: 60,
    numRetries: 0,
    logLevel: 'silent',
  })
}

function parse(code) {
  const base = { ecmaVersion: 'latest', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true }
  try {
    return acorn.parse(code, { ...base, sourceType: 'script' })
  } catch (scriptError) {
    try {
      return acorn.parse(code, { ...base, sourceType: 'module', allowImportExportEverywhere: true })
    } catch (_) {
      throw scriptError
    }
  }
}

function importToRequire(node) {
  const source = JSON.stringify(node.source.value)
  if (node.specifiers.length === 0) return `require(${source});`
  const parts = []
  const named = []
  for (const s of node.specifiers) {
    if (s.type === 'ImportDefaultSpecifier') parts.push(`const ${s.local.name} = (m => m && m.default ? m.default : m)(require(${source}));`)
    else if (s.type === 'ImportNamespaceSpecifier') parts.push(`const ${s.local.name} = require(${source});`)
    else named.push(s.imported.name === s.local.name ? s.local.name : `${s.imported.name}: ${s.local.name}`)
  }
  if (named.length) parts.push(`const { ${named.join(', ')} } = require(${source});`)
  return parts.join(' ')
}

function transform(code) {
  const ast = parse(code)
  const edits = [] // { at, remove, text }
  const wrapAwait = node => {
    if (node.type === 'AwaitExpression') return
    edits.push({ at: node.start, remove: 0, text: 'await (' })
    edits.push({ at: node.end, remove: 0, text: ')' })
  }

  const body = ast.body
  body.forEach((node, index) => {
    const isLast = index === body.length - 1
    if (node.type === 'ImportDeclaration') {
      edits.push({ at: node.start, remove: node.end - node.start, text: importToRequire(node) })
    } else if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
      edits.push({ at: node.start, remove: node.declaration.start - node.start, text: '' })
    } else if (node.type === 'ExpressionStatement' && !node.directive) {
      if (isLast) edits.push({ at: node.start, remove: 0, text: 'return ' })
      wrapAwait(node.expression)
    } else if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) {
        if (d.init && /CallExpression|NewExpression/.test(d.init.type)) wrapAwait(d.init)
      }
      const last = node.declarations[node.declarations.length - 1]
      if (isLast && last.id.type === 'Identifier') {
        edits.push({ at: node.end, remove: 0, text: `\nreturn ${last.id.name};` })
      }
    }
  })

  // Apply from the end so earlier offsets stay valid. Insertions at the same
  // offset keep their original relative order.
  let out = code
  edits
    .map((e, i) => ({ ...e, i }))
    .sort((a, b) => b.at - a.at || b.i - a.i)
    .forEach(e => {
      out = out.slice(0, e.at) + e.text + out.slice(e.at + e.remove)
    })
  return out
}

async function run(code, { cwd, timeoutMs = 60000, vars = {} }) {
  const logs = []
  const sandboxConsole = {
    log: (...a) => logs.push(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
  }
  sandboxConsole.info = sandboxConsole.warn = sandboxConsole.error = sandboxConsole.debug = sandboxConsole.log

  let transformed
  try {
    transformed = transform(code)
  } catch (err) {
    return { ok: false, error: `JavaScript syntax error: ${err.message}`, output: '' }
  }

  const unhandled = []
  const onUnhandled = reason => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  const previousCwd = process.cwd()
  process.chdir(cwd)

  const sandboxFs = { ...fs, ...fs.promises }
  // `vars` lets a test provide variables an example expects to exist already,
  // such as a `documents` array defined in an earlier example.
  const client = createClient()
  const ctx = { client, typesense: client, Typesense, fs: sandboxFs, require, console: sandboxConsole, process, ...vars }
  const names = Object.keys(ctx).filter(n => /^[A-Za-z_$][\w$]*$/.test(n))
  const fn = new AsyncFunction(
    '__ctx',
    `const { ${names.join(', ')} } = __ctx;\n` + 'return (async () => {\n' + transformed + '\n})()',
  )

  let timer
  try {
    const response = await Promise.race([
      fn(ctx),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
    await new Promise(r => setTimeout(r, 50))
    if (unhandled.length) throw unhandled[0]
    return { ok: true, error: null, response, responses: [response], output: logs.join('\n') }
  } catch (err) {
    const status = err && err.httpStatus ? `HTTP ${err.httpStatus}: ` : ''
    return { ok: false, error: `${status}${(err && err.message) || err}`, output: logs.join('\n') }
  } finally {
    clearTimeout(timer)
    process.chdir(previousCwd)
    process.off('unhandledRejection', onUnhandled)
  }
}

module.exports = { lang: 'js', isRunnable, run, transform, createClient }
