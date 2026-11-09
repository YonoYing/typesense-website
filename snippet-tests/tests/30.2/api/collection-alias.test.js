// Tests for the examples on docs-site/content/30.2/api/collection-alias.md
//
// Each key in `snippets` is a snippet ID: the anchor of the heading above the
// example, with --2, --3 for later examples under the same heading. Examples
// run top to bottom against a fresh Typesense server, once per language.
// See snippet-tests/README.md for everything a test can do.

// An alias can't share a name with a collection, so drop any "companies"
// collection left by earlier examples before pointing the alias at the new one.
async function ensureAlias({ api, dropCollection, ensureCollection }) {
  await dropCollection('companies')
  await ensureCollection('companies_june11')
  const res = await api.put('/aliases/companies', { collection_name: 'companies_june11' })
  if (!res.ok) throw new Error(`could not create alias: ${JSON.stringify(res.body)}`)
}

module.exports = {
  snippets: {
    'use-case': {
      // Guessed from the curl example: POST /multi_search
      async setup({ ensureCollection }) {
        await ensureCollection('companies')
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.results), 'expected one result per search')
      },
    },
    'create-or-update-an-alias': {
      // Guessed from the curl example: PUT /aliases/companies
      async setup({ dropCollection, ensureCollection }) {
        await dropCollection('companies')
        await ensureCollection('companies_june11')
      },
      async verify({ assert, expectExists }) {
        const alias = await expectExists('/aliases/companies')
        assert.equal(alias.collection_name, 'companies_june11')
      },
    },
    'retrieve-an-alias': {
      // Guessed from the curl example: GET /aliases/companies
      async setup(ctx) {
        await ensureAlias(ctx)
      },
      async verify({ assert, response }) {
        assert.equal(response.collection_name, 'companies_june11')
      },
    },
    'list-all-aliases': {
      // Guessed from the curl example: GET /aliases
      async verify({ assert, response, expectKeys }) {
        assert.ok(Array.isArray(response.aliases), 'expected a list of aliases')
        expectKeys(response, ['aliases'])
      },
    },
    'delete-an-alias': {
      // Guessed from the curl example: DELETE /aliases/companies
      async setup(ctx) {
        await ensureAlias(ctx)
      },
      async verify({ expectGone }) {
        await expectGone('/aliases/companies')
      },
    },
  },
}
