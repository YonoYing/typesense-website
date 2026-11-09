'use strict'

// Maintains the "Snippet tests" checklist in a pull request's description.
//
// The checklist lives between two HTML comment markers, so the rest of the
// description is never touched. Each item carries a hidden key, which lets a
// re-run keep the boxes the author has already ticked.

const START = '<!-- snippet-tests:start -->'
const END = '<!-- snippet-tests:end -->'
const ITEM_RE = /^- \[( |x|X)\] .*<!-- snippet:(.+?) -->\s*$/

function splitBody(body) {
  const text = body || ''
  const start = text.indexOf(START)
  const end = text.indexOf(END)
  if (start === -1 || end === -1 || end < start) return { before: text, section: null, after: '' }
  return {
    before: text.slice(0, start),
    section: text.slice(start + START.length, end),
    after: text.slice(end + END.length),
  }
}

// Returns Map<key, checked> for the items currently in the description.
function parseChecklist(body) {
  const { section } = splitBody(body)
  const items = new Map()
  if (!section) return items
  for (const line of section.split(/\r?\n/)) {
    const m = line.trim().match(ITEM_RE)
    if (m) items.set(m[2], m[1].toLowerCase() === 'x')
  }
  return items
}

function itemNote(item, stubsInComment) {
  if (item.state === 'missing') return stubsInComment ? 'add the stub from the bot comment to' : 'add a test to'
  if (item.state === 'todo') return 'finish the test (and remove its `todo` line) in'
  return 'test written in'
}

// Works out the new description and whether the PR is blocked.
//   coverage: output of bin/coverage.js
// Returns { body, changed, blocking: string[], items }
function updateBody(body, coverage, { stubsInComment = false } = {}) {
  const previous = parseChecklist(body)
  const items = coverage.items.filter(i => i.state !== 'done' || previous.has(i.key))
  const blocking = []

  const lines = items.map(item => {
    const checked = previous.get(item.key) === true
    if (!checked) blocking.push(`${item.page} › ${item.id}: box not ticked`)
    if (item.state === 'missing') blocking.push(`${item.page} › ${item.id}: no test in ${item.testFile}`)
    if (item.state === 'todo') blocking.push(`${item.page} › ${item.id}: test still marked todo in ${item.testFile}`)
    return (
      `- [${checked ? 'x' : ' '}] \`${item.page}\` › \`${item.id}\`: ` +
      `${itemNote(item, stubsInComment)} \`${item.testFile}\` <!-- snippet:${item.key} -->`
    )
  })

  const { before, section, after } = splitBody(body)
  let next
  if (!items.length) {
    next = section === null ? body || '' : (before.trimEnd() + '\n' + after.trimStart()).trim()
  } else {
    const block = [
      START,
      '### Snippet tests',
      '',
      'This PR adds code examples that need a test. For each one, make sure its test proves the example works and remove the `todo` line, then tick the box. The snippet test coverage check stays red until every box is ticked.',
      '',
      ...lines,
      END,
    ].join('\n')
    next = section === null ? `${(body || '').trimEnd()}\n\n${block}\n` : `${before}${block}${after}`
  }
  return { body: next, changed: next !== (body || ''), blocking, items }
}

// Body for the bot comment that carries stubs when they cannot be committed
// to the PR branch (for example, PRs from forks).
function stubComment(coverage) {
  const missing = coverage.items.filter(i => i.state === 'missing' && i.stub)
  if (!missing.length) return null
  const byFile = new Map()
  for (const item of missing) {
    if (!byFile.has(item.testFile)) byFile.set(item.testFile, [])
    byFile.get(item.testFile).push(item)
  }
  const parts = [
    '<!-- snippet-tests:stubs -->',
    '### Test stubs for new code examples',
    '',
    'Add these entries to the `snippets` object in each file (create the file if it does not exist; see `snippet-tests/README.md`). They are guesses: adjust them until they prove the example works, then delete the `todo` line.',
    '',
  ]
  for (const [file, list] of byFile) {
    parts.push(`**\`${file}\`**`, '', '```js', ...list.map(i => i.stub), '```', '')
  }
  return parts.join('\n')
}

module.exports = { parseChecklist, updateBody, stubComment, START, END }
