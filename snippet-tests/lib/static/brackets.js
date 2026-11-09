'use strict'

// Checks that (), [] and {} balance in a code example, ignoring strings and
// comments. A mismatch is a syntax error in every client language.

const { classify, lineOf } = require('./lexer')

const OPEN = { '(': ')', '[': ']', '{': '}' }
const CLOSE = { ')': '(', ']': '[', '}': '{' }

function checkBrackets(code, lang) {
  const kinds = classify(code, lang)
  const stack = []
  for (let i = 0; i < code.length; i++) {
    if (kinds[i] !== 'code') continue
    const c = code[i]
    if (OPEN[c]) {
      stack.push({ c, i })
    } else if (CLOSE[c]) {
      const top = stack.pop()
      if (!top) {
        return [{ rule: 'brackets', line: lineOf(code, i), message: `unexpected \`${c}\` with nothing open` }]
      }
      if (top.c !== CLOSE[c]) {
        return [
          {
            rule: 'brackets',
            line: lineOf(code, i),
            message: `\`${c}\` on line ${lineOf(code, i)} closes the \`${top.c}\` opened on line ${lineOf(code, top.i)}`,
          },
        ]
      }
    }
  }
  if (stack.length) {
    const top = stack[stack.length - 1]
    return [{ rule: 'brackets', line: lineOf(code, top.i), message: `\`${top.c}\` opened on line ${lineOf(code, top.i)} is never closed` }]
  }
  return []
}

module.exports = { checkBrackets }
