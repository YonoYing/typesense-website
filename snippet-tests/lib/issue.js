'use strict'

// Builds and files the GitHub issue that lists docs examples failing against
// a new Typesense release. Used by .github/workflows/snippet-compat.yml.
//
// There is one issue per release line (e.g. "31.0"), updated in place as new
// release candidates come out, and closed once every example passes.

const { findingsSection } = require('./report')

const LABEL = 'docs-examples'

function issueTitle(line) {
  return `Docs code examples failing on Typesense ${line}`
}

// The issue gives the findings count and links the table, which the workflow
// uploads as findings.md (`findingsUrl`). Without a link the table is inline.
// GitHub caps an issue body at 65536 characters.
function issueBody({ report, tag, docsVersion, runUrl, findingsUrl }) {
  const lines = [
    `The code examples in the **${docsVersion}** docs were run against \`typesense/typesense:${tag}\`.`,
    '',
    ...findingsSection(report.results, null, { tableLink: findingsUrl }),
    'Fix the example (or its test in `snippet-tests/tests/`), and this issue closes automatically once everything passes.',
    '',
    '---',
    `Last checked ${new Date().toISOString().slice(0, 10)}${runUrl ? ` in [this workflow run](${runUrl})` : ''}.`,
  ]
  const body = lines.join('\n')
  if (body.length <= 65000) return body
  const note = `\n\n_The table was cut to fit an issue; the full list is in the [workflow run summary](${runUrl || '#'})._`
  return body.slice(0, 65000 - note.length).replace(/\n[^\n]*$/, '') + note
}

// Creates, updates or closes the issue. `github` and `context` are the
// objects actions/github-script provides.
async function fileIssue({ github, context, report, tag, line, docsVersion, runUrl, findingsUrl }) {
  const { owner, repo } = context.repo
  const title = issueTitle(line)
  const failures = report.results.filter(r => r.status === 'fail')

  try {
    await github.rest.issues.createLabel({ owner, repo, name: LABEL, color: 'd93f0b', description: 'Docs code examples that fail against a Typesense release' })
  } catch (_) {
    // already exists
  }

  const open = await github.paginate(github.rest.issues.listForRepo, { owner, repo, state: 'open', labels: LABEL, per_page: 100 })
  const existing = open.find(i => i.title === title && !i.pull_request)

  if (failures.length) {
    const body = issueBody({ report, tag, docsVersion, runUrl, findingsUrl })
    if (existing) {
      await github.rest.issues.update({ owner, repo, issue_number: existing.number, body })
      return { action: 'updated', number: existing.number }
    }
    const created = await github.rest.issues.create({ owner, repo, title, body, labels: [LABEL] })
    return { action: 'created', number: created.data.number }
  }

  if (existing) {
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: existing.number,
      body: `Every docs example now passes against \`typesense/typesense:${tag}\`${runUrl ? ` ([run](${runUrl}))` : ''}. Closing.`,
    })
    await github.rest.issues.update({ owner, repo, issue_number: existing.number, state: 'closed', state_reason: 'completed' })
    return { action: 'closed', number: existing.number }
  }
  return { action: 'none' }
}

module.exports = { fileIssue, issueBody, issueTitle, LABEL }
