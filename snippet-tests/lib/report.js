'use strict'

// Turns runner results into plain-text and Markdown reports.

const SITE = 'https://typesense.org/docs'
const REPO_BLOB = 'https://github.com/typesense/typesense-website/blob/master/docs-site/content'

const LANG_NAMES = {
  js: 'JavaScript', ts: 'TypeScript', shell: 'curl', python: 'Python', ruby: 'Ruby', php: 'PHP', dart: 'Dart',
  java: 'Java', go: 'Go', swift: 'Swift', csharp: 'C#', rust: 'Rust', json: 'JSON', prose: 'text',
}

function counts(results) {
  const c = { pass: 0, fail: 0, skip: 0, xfail: 0, xpass: 0, untested: 0, todo: 0, staticOnly: 0 }
  for (const r of results) {
    if (r.quiet) continue // a passing prose section: checked, not counted
    c[r.status] = (c[r.status] || 0) + 1
    if (r.untested) c.untested++
    if (r.todo) c.todo++
    if (r.check === 'static' && r.status === 'pass') c.staticOnly++
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
  const flags = [r.check === 'static' && 'static', r.untested && 'no test', r.todo && 'todo'].filter(Boolean)
  const detail = r.status === 'fail' ? `\n        ${String(r.error).replace(/\n/g, '\n        ')}` : r.reason ? ` (${r.reason})` : ''
  return `  ${icon} ${r.lang.padEnd(6)} ${r.page} › ${r.id}${flags.length ? ` [${flags.join(', ')}]` : ''}${detail}`
}

function truncate(text, max = 600) {
  const s = String(text || '').trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

// One section per failure, with the error shown in full (not collapsed), so
// a reader sees what went wrong without clicking anything.
function failureList(failures) {
  return failures
    .map(r =>
      [
        `#### \`${r.page}\` › \`${r.id}\` (${LANG_NAMES[r.lang] || r.lang})`,
        '',
        `[See it on the site](${pageUrl(r)}) · [Source, line ${r.line}](${sourceUrl(r)})`,
        '',
        '```',
        truncate(r.error, 1500).replace(/```/g, "'''"),
        '```',
      ].join('\n'),
    )
    .join('\n\n')
}

// The findings table, in the example audit's format (see lib/findings.js),
// followed by the per-example counts. `found` is buildFindings()'s result; it
// is computed here when not given. With `tableLink`, the table itself is left
// out and linked instead (the issue links a downloadable findings.md).
function findingsSection(results, found, { tableLink } = {}) {
  const { buildFindings, findingsTable, headline } = require('./findings')
  const { findings, undetected, auditFiles } = found || buildFindings(results)
  const c = counts(results)
  const lines = []
  lines.push(
    findings.length ? `**${headline(findings)}.**` : '**No findings.**',
    '',
    `Per example and language: ${c.fail} failed, ${c.pass} passed, ${c.xfail} known failures, ${c.skip} skipped.` +
      (c.staticOnly ? ` ${c.staticOnly} of the passes are static checks only (languages without an executor).` : '') +
      ' One finding often covers several examples, so the two counts differ.',
    '',
  )
  if (findings.length) {
    lines.push(
      '### Findings',
      '',
      'BREAK: the code throws, fails to compile, or the server rejects it. WRONG: it runs but does the wrong thing. COSMETIC: stale comments, inconsistent values, invalid sample JSON, prose slips.' +
        (auditFiles.length ? ` Ids are the example audit's (\`snippet-tests/audit/\`); N1, N2... are problems the audit does not list.` : ''),
      '',
      tableLink
        ? `The table of all ${findings.length} findings is in **[findings.md](${tableLink})** (download; GitHub delivers it as a zip).`
        : findingsTable(findings),
      '',
    )
  }
  if (undetected.length) {
    lines.push(
      '### Fixed audit findings',
      '',
      'Problems the example audit lists on the examples this run checked, which those examples no longer show. For languages without an executor, the static checks are the evidence.',
      '',
      ...undetected.map(u => `- **${u.row.id}** (${u.row.severity}) ${u.row.where} [${u.row.lang}]: ${u.row.problem.replace(/\s+/g, ' ').slice(0, 200)}`),
      '',
    )
  }
  return lines
}

function toMarkdown(results, { title = 'Docs snippet tests', image, found } = {}) {
  const xpasses = results.filter(r => r.status === 'xpass')
  const untested = results.filter(r => r.untested)
  const lines = [`## ${title}`, '']
  if (image) lines.push(`Server image: \`${image}\``, '')
  lines.push(...findingsSection(results, found))
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
      `<details><summary>Examples without a test (${ids.length})</summary>`,
      '',
      'These ran with the default checks only (no errors, HTTP 2xx, and the static checks).',
      '',
      ...ids.map(id => `- \`${id}\``),
      '',
      '</details>',
      '',
    )
  }
  return lines.join('\n')
}

// A standalone Markdown document with the findings table, in the same shape
// as the example audit (written by `bin/run.js --findings <file>`).
// `scope` replaces the default "docs-site/content/<version>/**" description,
// e.g. for a PR run that tested only the examples it touches.
function findingsDoc(results, found, { title = 'Docs code example findings', image, scope } = {}) {
  const { buildFindings, findingsTable, headline } = require('./findings')
  const { findings, undetected } = found || buildFindings(results)
  const versions = [...new Set(results.map(r => r.page.split('/')[0]))]
  const docs = scope || versions.map(v => `docs-site/content/${v}/**`).join(', ')
  const lines = [
    `# ${title}`,
    '',
    `Docs: ${docs}${image ? `. Server: \`${image}\`` : ''}. Generated ${new Date().toISOString().slice(0, 10)} by snippet-tests.`,
    `Count: ${findings.length ? headline(findings) : 'no findings'}.`,
    '',
    'Severity:',
    '- BREAK: the code throws, fails to compile, or the server rejects it.',
    '- WRONG: it runs but does the wrong thing.',
    '- COSMETIC: stale comments, inconsistent values, invalid sample JSON, prose slips.',
    '',
    'Ids are the example audit\'s (`snippet-tests/audit/`); N1, N2... are problems the audit does not list.',
    '',
    '## Findings',
    '',
    findingsTable(findings),
    '',
  ]
  if (undetected.length) {
    lines.push('## Fixed audit findings', '', 'Problems the example audit lists on the examples this run checked, which those examples no longer show. For languages without an executor, the static checks are the evidence.', '', ...undetected.map(u => `- **${u.row.id}** (${u.row.severity}) ${u.row.where} [${u.row.lang}]`), '')
  }
  return lines.join('\n')
}

module.exports = { counts, consoleLine, toMarkdown, findingsSection, findingsDoc, failureList, pageUrl, sourceUrl, LANG_NAMES }
