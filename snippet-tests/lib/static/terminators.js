'use strict'

// Finds statements that are missing their `;` in languages that require one
// (Java, PHP). A statement is a run of lines at bracket depth zero; it is
// complete when its last line ends with `;`, `{`, `}` or a comma, or when the
// next line continues it (starts with `.`, `->`, `)`, an operator...).

const { classify } = require('./lexer')

const LANGS = new Set(['java', 'php', 'csharp'])

function checkTerminators(code, lang) {
  if (!LANGS.has(lang)) return []
  const kinds = classify(code, lang)
  // Blank strings and comments so we only look at code characters, keep newlines.
  let src = ''
  for (let i = 0; i < code.length; i++) src += kinds[i] === 'code' || code[i] === '\n' ? code[i] : ' '
  const lines = src.split('\n')
  const original = code.split('\n')

  const problems = []
  let depth = 0
  let statementStart = -1
  let lastCodeLine = -1
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim()
    if (!text) continue
    if (statementStart === -1) statementStart = i
    let lineDepth = depth
    for (const ch of text) {
      if ('([{'.includes(ch)) lineDepth++
      else if (')]}'.includes(ch)) lineDepth--
    }
    const endsStatement = /[;{},]$/.test(text) || /^\}/.test(text) || /^(?:\/\/|#)/.test(text)
    const continues = (next => next && /^(?:\.|->|\)|\]|\}|\+|-|\*|\/|&&|\|\||\?|:|,|=|;)/.test(next))(nextCode(lines, i))
    const opensBlock = /\{\s*$/.test(text)
    if (lineDepth === 0 && !endsStatement && !continues && !opensBlock && !/^(?:import|package)\b/.test(text) && !/^\s*(?:if|else|for|while|try|catch|switch)\b/.test(text) && !/^@/.test(text)) {
      // Statement ends here without a terminator.
      if (/[\w)\]"']$/.test(text)) {
        problems.push({ rule: 'missing-semicolon', line: i + 1, message: `the statement on line ${i + 1} has no \`;\` at the end (syntax error)`, fix: `${original[i].trim()};` })
      }
    }
    depth = lineDepth
    lastCodeLine = i
    if (lineDepth === 0 && (endsStatement || !continues)) statementStart = -1
  }
  void lastCodeLine
  return problems
}

function nextCode(lines, i) {
  for (let j = i + 1; j < lines.length; j++) {
    const t = lines[j].trim()
    if (t) return t
  }
  return null
}

module.exports = { checkTerminators }
