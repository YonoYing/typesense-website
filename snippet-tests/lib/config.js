'use strict'

const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..', '..')

module.exports = {
  REPO_ROOT,
  // SNIPPET_DOCS_ROOT points the harness at another copy of the docs (the
  // audit self-test uses the docs as they were when the audit was written).
  DOCS_ROOT: process.env.SNIPPET_DOCS_ROOT || path.join(REPO_ROOT, 'docs-site', 'content'),
  // The commit (on typesense/typesense-website master) whose 30.2 docs the
  // example audit in audit/ reviewed. Fixed examples no longer show the
  // audited problems, so the self-test checks the harness against this copy.
  AUDIT_DOCS_REF: 'f4cea1d1932735bd8d4d3e52b1b9de7ef51405fe',
  TESTS_ROOT: path.join(REPO_ROOT, 'snippet-tests', 'tests'),
  API_KEY: process.env.SNIPPET_TESTS_API_KEY || 'xyz',
  // Fixed: docs examples hard-code localhost:8108.
  PORT: 8108,
  // Languages the runner can execute today. Others are still tracked for test
  // coverage, and get run as soon as an executor exists for them.
  EXECUTABLE_LANGUAGES: ['js', 'shell'],
}
