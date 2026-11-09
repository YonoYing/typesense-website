// Tests for the examples on docs-site/content/30.2/api/api-keys.md
//
// Each key in `snippets` is a snippet ID: the anchor of the heading above the
// example, with --2, --3 for later examples under the same heading. Examples
// run top to bottom against a fresh Typesense server, once per language.
// See snippet-tests/README.md for everything a test can do.

module.exports = {
  snippets: {
    'admin-key': {
      // Guessed from the curl example: POST /keys
      async verify({ assert, response }) {
        assert.equal(typeof response.value, 'string', 'expected the new key value')
      },
    },
    'search-only-api-key': {
      // Guessed from the curl example: POST /keys
      async verify({ assert, response, expectKeys }) {
        assert.equal(typeof response.value, 'string', 'expected the new key value')
        expectKeys(response, ['actions', 'collections', 'description', 'expires_at', 'id', 'value'])
      },
    },
    'retrieve-an-api-key': {
      // Guessed from the curl example: GET /keys/1
      async verify({ response, expectKeys }) {
        expectKeys(response, ['actions', 'collections', 'description', 'expires_at', 'id', 'value_prefix'])
      },
    },
    'list-all-keys': {
      // Guessed from the curl example: GET /keys
      async verify({ assert, response, expectKeys }) {
        assert.ok(Array.isArray(response.keys), 'expected a list of keys')
        expectKeys(response, ['keys'])
      },
    },
    'delete-api-key': {
      // Guessed from the curl example: DELETE /keys/1
      // No specific check guessed: the example passes if it runs without errors.
    },
    'usage': {
      // No API call recognised. The example only has to run without errors.
    },
  },
}
