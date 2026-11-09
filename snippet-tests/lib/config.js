'use strict'

const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..', '..')

module.exports = {
  REPO_ROOT,
  DOCS_ROOT: path.join(REPO_ROOT, 'docs-site', 'content'),
  TESTS_ROOT: path.join(REPO_ROOT, 'snippet-tests', 'tests'),
  API_KEY: process.env.SNIPPET_TESTS_API_KEY || 'xyz',
  // Fixed: docs examples hard-code localhost:8108.
  PORT: 8108,
  // Languages the runner can execute today. Others are still tracked for test
  // coverage, and get run as soon as an executor exists for them.
  EXECUTABLE_LANGUAGES: ['js', 'shell'],
}
