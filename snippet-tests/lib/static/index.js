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
const docs = require('./docs')
const { classify } = require('./lexer')
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
    // Shell blocks without curl are parameter fragments, install commands or
    // helper scripts: only the pattern rules apply, not the curl checks.
    if (!/\bcurl\b/.test(code)) return dedupe(applyRules(code, lang))
    problems.push(...(tools.checkShellSyntax(code) || []))
    problems.push(...checkShell(code))
    problems.push(...applyRules(code, lang))
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
  problems.push(...checkComments(code, lang))
  return dedupe(problems)
}

// A comment that names a resource the code never uses was left behind when
// the example changed (e.g. "creates an override in the `companies`
// collection" above code that upserts a curation set).
function checkComments(code, lang) {
  const kinds = classify(code, lang)
  let comments = ''
  let rest = ''
  for (let i = 0; i < code.length; i++) {
    if (kinds[i] === 'comment') comments += code[i]
    else rest += code[i]
  }
  const problems = []
  for (const m of comments.matchAll(/`([A-Za-z][\w-]{2,})`/g)) {
    const name = m[1]
    if (new RegExp(`(^|[^\\w-])${name.replace(/-/g, '\\-')}([^\\w-]|$)`).test(rest)) continue
    const line = code.slice(0, code.indexOf(m[0])).split('\n').length
    problems.push({ rule: 'stale-comment', line, message: `the comment mentions \`${name}\`, which the code never uses (left over from an older version of the example)`, fix: 'update the comment to match the code' })
  }
  return problems
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
// `markdown`, when given, adds the JSON blocks and the prose of the page
// (keys `${id}|json` and `${id}|prose`).
function checkPage(groups, { version, markdown } = {}) {
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
  if (markdown) {
    for (const [key, problems] of docs.checkDocs(markdown, { version }).problems) {
      const [id, lang] = key.split('|')
      put(id, lang, problems)
    }
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

module.exports = { checkBlock, checkPage, checkComments, formatProblems, extractDocItems: docs.extractDocItems }
