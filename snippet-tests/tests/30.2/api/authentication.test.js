// Tests for the examples on docs-site/content/30.2/api/authentication.md
//
// Each key in `snippets` is a snippet ID: the anchor of the heading above the
// example, with --2, --3 for later examples under the same heading. Examples
// run top to bottom against a fresh Typesense server, once per language.
// See snippet-tests/README.md for everything a test can do.

module.exports = {
  snippets: {
    'authentication': {
      skip: { js: 'shows two alternative client setups (CommonJS and ES modules) in one block, so it cannot run as a whole', shell: 'sets TYPESENSE_API_KEY to the <API_KEY> placeholder on purpose' },
      // Guessed from the curl example: GET /collections/companies/documents/search?q&query_by&filter_by&sort_by&x-typesense-api-key
      async setup({ ensureCollection }) {
        await ensureCollection('companies')
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.hits), 'expected search hits')
        assert.equal(typeof response.found, 'number')
      },
    },
  },
}
