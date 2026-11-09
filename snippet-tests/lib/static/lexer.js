'use strict'

// A small, language-aware scanner shared by the static checks.
//
// It walks a code example once and classifies every character as code,
// string or comment, so the other checks can ignore text inside strings and
// comments (a `}` in a JSON string is not a bracket, a `#` in a URL is not a
// comment). It is deliberately approximate: good enough for docs examples,
// not a real tokenizer for any of these languages.

const LINE_COMMENT = {
  js: ['//'],
  ts: ['//'],
  dart: ['//'],
  java: ['//'],
  go: ['//'],
  swift: ['//'],
  php: ['//', '#'],
  python: ['#'],
  ruby: ['#'],
  shell: ['#'],
  csharp: ['//'],
  rust: ['//'],
}

const BLOCK_COMMENT = new Set(['js', 'ts', 'dart', 'java', 'go', 'swift', 'php', 'csharp', 'rust'])
const TRIPLE_QUOTES = new Set(['python', 'dart'])
const BACKTICK_STRINGS = new Set(['js', 'ts', 'go', 'shell'])

// Returns an array of the same length as `code`, where each entry is
// 'code', 'string' or 'comment'.
function classify(code, lang) {
  const kinds = new Array(code.length).fill('code')
  const lineComments = LINE_COMMENT[lang] || []
  let i = 0
  while (i < code.length) {
    const c = code[i]
    const two = code.slice(i, i + 2)
    const three = code.slice(i, i + 3)

    // Comments
    if (lineComments.some(m => code.startsWith(m, i))) {
      // In shell, `#` only starts a comment at a word boundary ("$#" and
      // "a#b" are not comments). In other languages `#` is rare in code.
      const prev = code[i - 1]
      const wordy = c === '#' && prev !== undefined && !/\s|[;({\[,]/.test(prev)
      if (!wordy) {
        while (i < code.length && code[i] !== '\n') kinds[i++] = 'comment'
        continue
      }
    }
    if (BLOCK_COMMENT.has(lang) && two === '/*') {
      const end = code.indexOf('*/', i + 2)
      const stop = end === -1 ? code.length : end + 2
      while (i < stop) kinds[i++] = 'comment'
      continue
    }

    // Strings
    if (TRIPLE_QUOTES.has(lang) && (three === '"""' || three === "'''")) {
      const end = code.indexOf(three, i + 3)
      const stop = end === -1 ? code.length : end + 3
      while (i < stop) kinds[i++] = 'string'
      continue
    }
    const isQuote = c === '"' || c === "'" || (c === '`' && BACKTICK_STRINGS.has(lang))
    // Ruby/Shell/Perl-ish: a quote right after a word character is rarely a
    // string start (e.g. don't in a comment), but comments are already out.
    if (isQuote) {
      const quote = c
      kinds[i++] = 'string'
      while (i < code.length) {
        const ch = code[i]
        if (ch === '\\' && quote !== "'" && i + 1 < code.length) {
          kinds[i++] = 'string'
          kinds[i++] = 'string'
          continue
        }
        // Shell single quotes have no escapes; other languages escape with \.
        if (ch === '\\' && quote === "'" && lang !== 'shell' && i + 1 < code.length) {
          kinds[i++] = 'string'
          kinds[i++] = 'string'
          continue
        }
        kinds[i++] = 'string'
        if (ch === quote) break
        // Single-quoted strings in most languages do not span lines; shell,
        // python triple-quotes and JS template strings do. Stop at a newline
        // for the others so one stray quote cannot swallow the whole example.
        if (ch === '\n' && !(lang === 'shell' || quote === '`')) break
      }
      continue
    }
    i++
  }
  return kinds
}

// The code with every string and comment replaced by spaces (newlines kept),
// so regular expressions can look at structure only.
function codeOnly(code, lang) {
  const kinds = classify(code, lang)
  let out = ''
  for (let i = 0; i < code.length; i++) out += kinds[i] === 'code' || code[i] === '\n' ? code[i] : ' '
  return out
}

// The code with comments blanked but strings kept, for rules that need to see
// string literals (collection names, parameter keys) but not comments.
function withoutComments(code, lang) {
  const kinds = classify(code, lang)
  let out = ''
  for (let i = 0; i < code.length; i++) out += kinds[i] !== 'comment' || code[i] === '\n' ? code[i] : ' '
  return out
}

function lineOf(code, index) {
  let line = 1
  for (let i = 0; i < index && i < code.length; i++) if (code[i] === '\n') line++
  return line
}

module.exports = { classify, codeOnly, withoutComments, lineOf }
