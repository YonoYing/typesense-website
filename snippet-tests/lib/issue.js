'use strict'

// Builds and files the GitHub issue that lists docs examples failing against
// a new Typesense release. Used by .github/workflows/snippet-compat.yml.
//
// There is one issue per release line (e.g. "31.0"), updated in place as new
// release candidates come out, and closed once every example passes.

const { counts, failureList } = require('./report')

const LABEL = 'docs-examples'

function issueTitle(line) {
  return `Docs code examples failing on Typesense ${line}`
}

function issueBody({ report, tag, docsVersion, runUrl }) {
  const failures = report.results.filter(r => r.status === 'fail')
  const c = counts(report.results)
  const lines = [
    `The code examples in the **${docsVersion}** docs were run against \`typesense/typesense:${tag}\`.`,
    '',
    `**${failures.length} example run(s) failed.** ${c.pass} passed, ${c.xfail} were already known to fail, ${c.skip} were skipped.`,
    '',
    'Each failure below shows the error and links to the example on the site and in the source. Fix the example (or its test in `snippet-tests/tests/`), and this issue closes automatically once everything passes.',
    '',
    '### Failures',
    '',
    failureList(failures),
    '',
    '---',
    `Last checked ${new Date().toISOString().slice(0, 10)}${runUrl ? ` in [this workflow run](${runUrl})` : ''}.`,
  ]
  return lines.join('\n')
}

// Creates, updates or closes the issue. `github` and `context` are the
// objects actions/github-script provides.
async function fileIssue({ github, context, report, tag, line, docsVersion, runUrl }) {
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
    const body = issueBody({ report, tag, docsVersion, runUrl })
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
