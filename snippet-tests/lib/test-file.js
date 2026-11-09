'use strict'

// Locates and reads test files.
//
// Test files live in snippet-tests/tests/, mirroring the docs folders:
//   docs-site/content/30.2/api/documents.md
//   snippet-tests/tests/30.2/api/documents.test.js
//
// loadTests() executes the file (used when running tests). readTestKeys()
// only parses it and never runs it, so it is safe on untrusted PR code.

const acorn = require('acorn')
const fs = require('fs')
const path = require('path')
const { DOCS_ROOT, TESTS_ROOT } = require('./config')

function relativeDocPath(docFile, docsRoot = DOCS_ROOT) {
  return path.relative(docsRoot, path.resolve(docFile)).split(path.sep).join('/')
}

function testFileFor(docRelPath, testsRoot = TESTS_ROOT) {
  return path.join(testsRoot, docRelPath.replace(/\.md$/, '.test.js'))
}

function loadTests(testFile) {
  if (!fs.existsSync(testFile)) return null
  delete require.cache[require.resolve(testFile)]
  const mod = require(testFile)
  return { ...mod, snippets: mod.snippets || {} }
}

function propertyName(prop) {
  if (prop.type !== 'Property') return null
  if (prop.key.type === 'Identifier') return prop.key.name
  if (prop.key.type === 'Literal') return String(prop.key.value)
  return null
}

function findExportsObject(ast) {
  for (const node of ast.body) {
    const e = node.type === 'ExpressionStatement' && node.expression
    if (
      e &&
      e.type === 'AssignmentExpression' &&
      e.left.type === 'MemberExpression' &&
      e.left.object.name === 'module' &&
      e.left.property.name === 'exports' &&
      e.right.type === 'ObjectExpression'
    ) {
      return e.right
    }
  }
  return null
}

// Returns { exists, keys: Map<id, { todo, skip, start, end }>, source, snippetsNode }
// without executing the file.
function readTestKeys(testFile) {
  if (!fs.existsSync(testFile)) return { exists: false, keys: new Map(), source: null, snippetsNode: null }
  const source = fs.readFileSync(testFile, 'utf8')
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' })
  const exportsObj = findExportsObject(ast)
  const keys = new Map()
  let snippetsNode = null
  if (exportsObj) {
    const snippetsProp = exportsObj.properties.find(p => propertyName(p) === 'snippets')
    if (snippetsProp && snippetsProp.value.type === 'ObjectExpression') {
      snippetsNode = snippetsProp.value
      for (const prop of snippetsNode.properties) {
        const id = propertyName(prop)
        if (!id) continue
        const flags = { todo: false, skip: false, start: prop.start, end: prop.end }
        if (prop.value.type === 'ObjectExpression') {
          for (const inner of prop.value.properties) {
            const name = propertyName(inner)
            const isFalse =
              inner.value.type === 'Literal' && (inner.value.value === false || inner.value.value === null)
            if (name === 'todo' && !isFalse) flags.todo = true
            if (name === 'skip' && !isFalse) flags.skip = true
          }
        }
        keys.set(id, flags)
      }
    }
  }
  return { exists: true, keys, source, snippetsNode }
}

module.exports = { relativeDocPath, testFileFor, loadTests, readTestKeys }
