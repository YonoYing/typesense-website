'use strict'

// Static checks for docs examples in every client language.
//
// The runner executes JavaScript and curl examples against a real server.
// Examples in the other languages cannot be run here, but most docs bugs are
// visible without running anything: unbalanced brackets, a keyword used as a
// method name, a call the client library does not have, a tab that searches a
// different collection from its siblings. These checks find those, and also
// run on the executable languages so a JavaScript example that happens to
// succeed at runtime is still flagged when its sibling tabs show it is wrong.
//
// A problem is { rule, message, fix?, line? }; `line` is relative to the
// code block (1 = first line of the block).

const { checkBrackets } = require('./brackets')
const tools = require('./tools')
const { applyRules } = require('./rules')
const { checkIdentifiers } = require('./identifiers')
const { checkTerminators } = require('./terminators')
const { checkShell } = require('./shell')
const consistency = require('./consistency')
const { CLIENT_LANGUAGES } = require('../extract')

function dedupe(problems) {
  const seen = new Set()
  return problems.filter(p => {
    const key = `${p.rule}|${p.line || ''}|${p.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Checks one code block on its own.
function checkBlock(block) {
  const { code, lang } = block
  const problems = []
  if (lang === 'shell') {
    // Shell blocks without curl are parameter fragments or install commands.
    if (!/\bcurl\b/.test(code)) return []
    problems.push(...(tools.checkShellSyntax(code) || []))
    problems.push(...checkShell(code))
    return dedupe(problems)
  }
  problems.push(...checkBrackets(code, lang))
  if (lang === 'python') problems.push(...(tools.checkPython(code) || []))
  if (lang === 'ruby') problems.push(...(tools.checkRuby(code) || []))
  if (lang === 'php') problems.push(...(tools.checkPhp(code) || []))
  if (lang === 'go') problems.push(...(tools.checkGo(code) || []))
  if (lang === 'js') problems.push(...checkJsSyntax(code)) // acorn does not parse TypeScript
  problems.push(...applyRules(code, lang))
  problems.push(...checkIdentifiers(code, lang))
  problems.push(...checkTerminators(code, lang))
  return dedupe(problems)
}

function checkJsSyntax(code) {
  // Reuse the executor's parser so the static view matches what would run.
  const { transform } = require('../executors/js')
  try {
    transform(code)
    return []
  } catch (err) {
    return [{ rule: 'js-syntax', line: err.loc && err.loc.line, message: `JavaScript syntax error: ${err.message.replace(/ \(\d+:\d+\)$/, '')}` }]
  }
}

// Checks every client-language block on a page. Returns a Map keyed by
// `${group.id}|${lang}` with the problems for that block, including the
// cross-tab and page-level ones.
function checkPage(groups, { version } = {}) {
  const pageFacts = consistency.pageFactsFor(groups, version)
  const out = new Map()
  const put = (id, lang, problems) => {
    if (!problems || !problems.length) return
    const key = `${id}|${lang}`
    out.set(key, dedupe([...(out.get(key) || []), ...problems]))
  }
  for (const g of groups) {
    for (const b of g.blocks) {
      if (!CLIENT_LANGUAGES.has(b.lang)) continue
      put(g.id, b.lang, checkBlock(b))
    }
    for (const [lang, problems] of consistency.checkGroup(g, pageFacts)) put(g.id, lang, problems)
  }
  for (const [key, problems] of consistency.checkPage(groups, pageFacts)) {
    const [id, lang] = key.split('|')
    put(id, lang, problems)
  }
  return out
}

function formatProblems(problems) {
  return problems
    .map(p => {
      const where = p.line ? `line ${p.line}: ` : ''
      const fix = p.fix ? ` (fix: ${p.fix})` : ''
      return `${where}${p.message}${fix}`
    })
    .join('\n')
}

module.exports = { checkBlock, checkPage, formatProblems }
