'use strict'

// Turns runner results into plain-text and Markdown reports.

const SITE = 'https://typesense.org/docs'
const REPO_BLOB = 'https://github.com/typesense/typesense-website/blob/master/docs-site/content'

const LANG_NAMES = { js: 'JavaScript', shell: 'curl' }

function counts(results) {
  const c = { pass: 0, fail: 0, skip: 0, xfail: 0, xpass: 0, untested: 0, todo: 0 }
  for (const r of results) {
    c[r.status] = (c[r.status] || 0) + 1
    if (r.untested) c.untested++
    if (r.todo) c.todo++
  }
  return c
}

function pageUrl(r) {
  return `${SITE}/${r.page.replace(/\.md$/, '.html')}#${r.id.replace(/--\d+$/, '')}`
}

function sourceUrl(r) {
  return `${REPO_BLOB}/${r.page}#L${r.line}`
}

function consoleLine(r) {
  const icon = { pass: 'PASS ', fail: 'FAIL ', skip: 'skip ', xfail: 'xfail', xpass: 'XPASS' }[r.status]
  const flags = [r.untested && 'no test', r.todo && 'todo'].filter(Boolean)
  const detail = r.status === 'fail' ? `\n        ${r.error}` : r.reason ? ` (${r.reason})` : ''
  return `  ${icon} ${r.lang.padEnd(5)} ${r.page} › ${r.id}${flags.length ? ` [${flags.join(', ')}]` : ''}${detail}`
}

function truncate(text, max = 600) {
  const s = String(text || '').trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

function failureTable(failures) {
  const rows = failures.map(
    r =>
      `| [${r.page} › ${r.id}](${pageUrl(r)}) | ${LANG_NAMES[r.lang] || r.lang} | [line ${r.line}](${sourceUrl(r)}) |`,
  )
  return ['| Example | Language | Source |', '| --- | --- | --- |', ...rows].join('\n')
}

function failureDetails(failures) {
  return failures
    .map(
      r =>
        `<details><summary><code>${r.page} › ${r.id}</code> (${LANG_NAMES[r.lang] || r.lang})</summary>\n\n` +
        '```\n' +
        truncate(r.error, 1500).replace(/```/g, "'''") +
        '\n```\n</details>',
    )
    .join('\n')
}

function toMarkdown(results, { title = 'Docs snippet tests', image } = {}) {
  const c = counts(results)
  const failures = results.filter(r => r.status === 'fail')
  const xpasses = results.filter(r => r.status === 'xpass')
  const untested = results.filter(r => r.untested)
  const lines = [`## ${title}`, '']
  if (image) lines.push(`Server image: \`${image}\``, '')
  lines.push(
    `**${c.pass} passed**, **${c.fail} failed**, ${c.xfail} known failures, ${c.skip} skipped.`,
    '',
  )
  if (failures.length) {
    lines.push('### Failures', '', failureTable(failures), '', failureDetails(failures), '')
  }
  if (xpasses.length) {
    lines.push(
      '### Known failures that now pass',
      '',
      'These examples are marked `xfail` but passed. Remove the `xfail` line from their tests.',
      '',
      ...xpasses.map(r => `- \`${r.page} › ${r.id}\` (${r.lang})`),
      '',
    )
  }
  if (untested.length) {
    const ids = [...new Set(untested.map(r => `${r.page} › ${r.id}`))]
    lines.push(
      '### Examples without a test',
      '',
      'These ran with the default check only (no errors, HTTP 2xx).',
      '',
      ...ids.map(id => `- \`${id}\``),
      '',
    )
  }
  return lines.join('\n')
}

module.exports = { counts, consoleLine, toMarkdown, failureTable, failureDetails, pageUrl, sourceUrl, LANG_NAMES }
