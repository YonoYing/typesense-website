// Tests for the examples on docs-site/content/30.2/api/api-keys.md
//
// Each key in `snippets` is a snippet ID: the anchor of the heading above the
// example, with --2, --3 for later examples under the same heading. Examples
// run top to bottom against a fresh Typesense server, once per language.
// See snippet-tests/README.md for everything a test can do.

// Key ids are assigned in order from 0. The retrieve and delete examples use
// key 1, which exists once the page's first two examples have created keys.
async function ensureKey(api, id) {
  for (let i = 0; i <= id + 1; i++) {
    if ((await api.get(`/keys/${id}`)).ok) return
    const res = await api.post('/keys', { description: 'snippet test key', actions: ['documents:search'], collections: ['*'] })
    if (!res.ok) throw new Error(`could not create an API key: ${JSON.stringify(res.body)}`)
  }
  throw new Error(`key ${id} still does not exist (ids already used, e.g. a deleted key 1)`)
}

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
      async setup({ api }) {
        await ensureKey(api, 1)
      },
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
      async setup({ api }) {
        await ensureKey(api, 1)
      },
      async verify({ expectGone }) {
        await expectGone('/keys/1')
      },
    },
    'usage': {
      // No API call recognised. The example only has to run without errors.
    },
  },
}
