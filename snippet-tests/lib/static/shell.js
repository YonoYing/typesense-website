'use strict'

// Static checks for curl examples: things that make the command misbehave
// when pasted into a shell, independently of the server.

const { classify } = require('./lexer')

// Lines of a multi-line curl command that start with an option or a URL must
// be reached through a trailing backslash on the previous line; otherwise the
// shell runs them as separate commands (an unauthenticated request, or
// `-H: command not found`).
function checkContinuations(code) {
  const kinds = classify(code, 'shell')
  const lines = code.split('\n')
  const problems = []
  let offset = 0
  let sawCurl = false
  let previous = null // { text, index }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    const startKind = kinds[offset + (line.length - line.trimStart().length)]
    if (trimmed && startKind === 'code') {
      if (/\bcurl\b/.test(trimmed)) sawCurl = true
      const looksLikeOption = /^(?:-[A-Za-z]|--[a-z])/.test(trimmed) || /^["']https?:\/\//.test(trimmed)
      if (looksLikeOption && sawCurl && previous && !/\\\s*$/.test(previous.text) && !/\bcurl\b/.test(trimmed)) {
        problems.push({
          rule: 'curl-missing-continuation',
          line: i + 1,
          message: `line ${i + 1} (\`${trimmed.slice(0, 40)}\`) continues the curl command, but line ${previous.index + 1} has no trailing \`\\\`, so the shell runs it as a separate command`,
          fix: `end line ${previous.index + 1} with \\`,
        })
      }
      previous = { text: line, index: i }
    } else if (trimmed && startKind !== 'code') {
      // Inside a multi-line string (a JSON body): still part of the command.
      previous = { text: line, index: i }
    }
    offset += line.length + 1
  }
  return problems
}

// Pulls the bodies passed to -d / --data / --data-binary / --data-raw.
function requestBodies(code) {
  const kinds = classify(code, 'shell')
  const bodies = []
  const re = /(?:^|\s)(?:-d|--data|--data-raw|--data-binary|--json)\s+/g
  let m
  while ((m = re.exec(code))) {
    const start = m.index + m[0].length
    if (kinds[start] !== 'string') continue
    const quote = code[start]
    let end = start + 1
    while (end < code.length && kinds[end] === 'string' && !(code[end] === quote && end > start)) end++
    const inner = code.slice(start + 1, end)
    // A shell variable spliced in right after the closing quote: '...'${X}'...'
    const spliced = /^\s*["$]/.test(code.slice(end + 1, end + 3)) && /\$/.test(code.slice(end + 1, end + 4))
    bodies.push({ text: inner, spliced, line: code.slice(0, start).split('\n').length })
  }
  return bodies
}

function parseJson(text) {
  const t = text.trim()
  if (!t) return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(t) }
  } catch (err) {
    // JSON Lines: every non-blank line must be a JSON value.
    const lines = t.split('\n').filter(l => l.trim())
    if (lines.length > 1) {
      try {
        return { ok: true, value: lines.map(l => JSON.parse(l)) }
      } catch (_) {}
    }
    return { ok: false, error: err.message.replace(/ in JSON at position \d+.*$/, '') }
  }
}

function checkBodies(code) {
  const problems = []
  const urls = [...code.matchAll(/https?:\/\/[^\s'"\\]+/g)].map(m => m[0])
  const url = urls[0] || ''
  for (const body of requestBodies(code)) {
    if (body.spliced) {
      problems.push({
        rule: 'curl-spliced-variable',
        line: body.line,
        message: 'a shell variable is spliced into the JSON body between quotes; its value (here base64 output with newlines) is word-split and breaks both the JSON and the curl arguments',
        fix: 'write the body to a file first and send it with --data-binary @body.json',
      })
      continue
    }
    const trimmed = body.text.trim()
    if (!/^[\[{]/.test(trimmed)) continue
    const parsed = parseJson(body.text)
    if (!parsed.ok) {
      problems.push({ rule: 'curl-invalid-json', line: body.line, message: `the request body is not valid JSON (${parsed.error}), so the server answers 400 Bad JSON` })
      continue
    }
    const searches = parsed.value && Array.isArray(parsed.value.searches) ? parsed.value.searches : null
    if (searches && /\/multi_search/.test(url)) {
      searches.forEach((s, i) => {
        if (!s || typeof s !== 'object') return
        // A preset can carry the collection, so only a search without one is checked.
        if (!('collection' in s) && !('preset' in s) && !/[?&](collection|preset)=/.test(url)) {
          problems.push({ rule: 'multi-search-no-collection', line: body.line, message: `search #${i + 1} in the multi_search has no "collection" (and the URL does not set one), so the server answers 404 Collection not found`, fix: '"collection": "products"' })
        }
        if ('q' in s && s.q !== '*' && !('query_by' in s) && !('preset' in s) && !/[?&](query_by|preset)=/.test(url)) {
          problems.push({ rule: 'search-without-query-by', line: body.line, message: `search #${i + 1} has "q": "${s.q}" but no "query_by", so the server answers 400 "No search fields specified for the query."`, fix: '"query_by": "title"' })
        }
      })
    }
  }
  return problems
}

function checkUrls(code) {
  const problems = []
  const noPort = code.match(/https?:\/\/localhost\/(?!\s)/)
  if (noPort) {
    problems.push({ rule: 'curl-no-port', line: code.slice(0, noPort.index).split('\n').length, message: 'the URL has no port, so curl talks to localhost:80 instead of the Typesense port (8108 in every other example)', fix: 'http://localhost:8108/multi_search' })
  }
  if (/--data-urlencode/.test(code) && /\/documents\/search/.test(code) && !/(^|\s)(-G|--get)(\s|$)/.test(code)) {
    problems.push({ rule: 'curl-urlencode-without-get', message: '--data-urlencode without -G makes curl send a POST body, but the search endpoint only accepts GET, so the request hits no handler (404)', fix: 'add -G' })
  }
  // A quoted URL continued on an indented next line keeps the indentation.
  const kinds = classify(code, 'shell')
  for (let i = 0; i < code.length; i++) {
    if (kinds[i] !== 'string' || code[i] !== '"') continue
    let end = i + 1
    while (end < code.length && kinds[end] === 'string' && code[end] !== '"') end++
    const inner = code.slice(i + 1, end)
    if (/^https?:\/\//.test(inner) && /\\\n[ \t]+\S/.test(inner)) {
      problems.push({ rule: 'curl-url-split-with-indent', line: code.slice(0, i).split('\n').length, message: 'the quoted URL is split across lines and the next line is indented, so the spaces become part of the URL', fix: 'put the URL on one line, or pass the query with -G --data-urlencode' })
      break
    }
    i = end
  }
  if (/^\$\s+\w/m.test(code)) {
    problems.push({ rule: 'shell-prompt-prefix', message: 'the command starts with a `$ ` prompt, which fails when pasted into a shell' })
  }
  return problems
}

function checkShell(code) {
  if (!/\bcurl\b/.test(code)) return []
  return [...checkContinuations(code), ...checkBodies(code), ...checkUrls(code)]
}

module.exports = { checkShell, requestBodies, parseJson }
