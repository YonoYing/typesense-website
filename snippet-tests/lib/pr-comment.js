'use strict'

// Posts the findings of a pull request's snippet run as a comment on the PR,
// in the same table format as the compatibility issue's findings.md. There is
// one such comment per PR, found by a marker and updated by every run. The
// check itself never blocks the PR: this comment is the report.
//
// Used by .github/workflows/snippet-tests.yml through actions/github-script.

const fs = require('fs')
const { findingsDoc } = require('./report')
const { buildFindings } = require('./findings')

const MARKER = '<!-- snippet-tests:findings -->'
const MAX = 65000 // GitHub's comment limit is 65536 characters

function commentBody({ report, runUrl }) {
  const results = report.results || []
  const run = runUrl ? ` ([workflow run](${runUrl}))` : ''
  if (!results.length) {
    return `${MARKER}\n# Docs snippet tests\n\nThis pull request changes no covered code example${run}.\n`
  }
  const found = buildFindings(results)
  if (!found.findings.length && !found.undetected.length) {
    return `${MARKER}\n# Docs snippet tests\n\nNo findings: every code example this pull request touches passes${run}.\n`
  }
  const doc = findingsDoc(results, found, { title: 'Docs snippet tests', image: report.image, scope: 'the code examples this pull request touches' })
  const footer = `\n---\nThis check reports problems and does not block the merge. Updated on every push${run}.\n`
  let body = `${MARKER}\n${doc}${footer}`
  if (body.length > MAX) {
    const note = `\n\n_The table was cut to fit a comment; the full list is in the workflow run summary${run}._\n`
    body = body.slice(0, MAX - note.length).replace(/\n[^\n]*$/, '') + note
  }
  return body
}

// Creates or updates the PR's findings comment. A PR from a fork gets a
// read-only token, so a failure to comment is reported, not thrown.
async function postComment({ github, context, core, reportFile, runUrl }) {
  const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : { results: [] }
  const { owner, repo } = context.repo
  const issue_number = context.payload.pull_request.number
  const body = commentBody({ report, runUrl })
  try {
    const comments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number, per_page: 100 })
    const existing = comments.find(c => c.user && c.user.type === 'Bot' && c.body && c.body.includes(MARKER))
    // Nothing to say on a PR that never had a report: stay quiet.
    if (!existing && !(report.results || []).length) return { action: 'none' }
    if (existing) {
      if (existing.body !== body) await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body })
      return { action: 'updated', id: existing.id }
    }
    const created = await github.rest.issues.createComment({ owner, repo, issue_number, body })
    return { action: 'created', id: created.data.id }
  } catch (err) {
    if (core) core.warning(`Could not comment on the pull request (${err.status || ''} ${err.message}). The findings are in the run summary.`)
    return { action: 'failed', error: err.message }
  }
}

module.exports = { commentBody, postComment, MARKER }
