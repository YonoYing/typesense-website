'use strict'

// Finds identifiers an example uses but never declares, when a declared
// identifier is a near-miss (different case, an underscore, or a one or two
// letter typo). In compiled languages that is an "undefined symbol" compile
// error; in Dart and JavaScript it is also a compile or runtime error.
//
// Only near-misses are reported, so names that come from an earlier example
// or from the surrounding program (client, documents, api) stay quiet.

const { codeOnly } = require('./lexer')

const LANGS = new Set(['java', 'dart', 'js', 'ts', 'swift', 'go', 'csharp'])

const DECL = [
  // Java / C#: Type name = ...;  List<Foo> name = ...;  Foo name;
  /\b[A-Z]\w*(?:<[^;=()]*>)?(?:\[\])?\s+([a-z_]\w*)\s*(?:=|;)/g,
  // Java: float[] name = { ... }
  /\b(?:int|long|float|double|boolean|char|byte|short|var)(?:\[\])?\s+([a-z_]\w*)\s*(?:=|;)/g,
  // JS / Dart / Swift: let/const/var/final name
  /\b(?:let|const|var|final)\s+(?:\w+\s+)?([A-Za-z_$]\w*)\s*(?:=|;|:)/g,
  // Go: name := ...
  /\b([a-z_]\w*)\s*:=/g,
  // Loop variables and parameters are rare in docs; good enough.
]

// An identifier in use: before a `.`, a call, or as an argument.
const USE = /\b([A-Za-z_$][\w$]*)\b(?=\s*[.(,)])/g

const KEYWORDS = new Set([
  'new', 'return', 'if', 'else', 'for', 'while', 'await', 'async', 'function', 'const', 'let', 'var', 'final',
  'client', 'typesense', 'context', 'api', 'pointer', 'fmt', 'console', 'Math', 'JSON', 'System', 'String', 'Duration',
  'Arrays', 'List', 'Map', 'HashMap', 'ArrayList', 'require', 'import', 'print', 'println', 'try', 'catch', 'throw',
  'struct', 'map', 'string', 'int', 'float64', 'true', 'false', 'null', 'nil', 'super', 'this', 'self',
])

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return dp[a.length][b.length]
}

const normal = s => s.toLowerCase().replace(/_/g, '')

function nearMiss(used, declared) {
  if (used === declared) return false
  if (normal(used) === normal(declared)) return true
  if (declared.length >= 6 && used.length >= 6) {
    if (editDistance(used, declared) <= 2) return true
    // A declared name wrapped in a typo prefix/suffix, e.g. datdocumentsInJsonl.
    if (used.includes(declared) && used.length - declared.length <= 3) return true
  }
  return false
}

function checkIdentifiers(code, lang) {
  if (!LANGS.has(lang)) return []
  const src = codeOnly(code, lang)
  const declared = new Set()
  for (const re of DECL) for (const m of src.matchAll(re)) declared.add(m[1])
  if (!declared.size) return []

  const used = new Map()
  for (const m of src.matchAll(USE)) {
    const name = m[1]
    if (KEYWORDS.has(name) || declared.has(name)) continue
    // Skip type names and method names after a dot.
    if (/^[A-Z]/.test(name) && lang !== 'go') continue
    const before = src[m.index - 1]
    if (before === '.') continue
    if (!used.has(name)) used.set(name, m.index)
  }

  const problems = []
  for (const [name, index] of used) {
    const match = [...declared].find(d => nearMiss(name, d))
    if (!match) continue
    const line = src.slice(0, index).split('\n').length
    problems.push({
      rule: 'undeclared-identifier',
      line,
      message: `\`${name}\` is never declared (the example declares \`${match}\`), so this does not compile`,
      fix: `${match}`,
    })
  }
  return problems
}

module.exports = { checkIdentifiers, nearMiss, editDistance }
