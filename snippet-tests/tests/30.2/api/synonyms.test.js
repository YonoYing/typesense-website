// Tests for the examples on docs-site/content/30.2/api/synonyms.md
//
// Each key in `snippets` is a snippet ID: the anchor of the heading above the
// example, with --2, --3 for later examples under the same heading. Examples
// run top to bottom against a fresh Typesense server, once per language.
// See snippet-tests/README.md for everything a test can do.

async function ensureSynonymSets({ api }, ...names) {
  for (const name of names) {
    const res = await api.put(`/synonym_sets/${name}`, { items: [{ id: 'example', synonyms: ['controller', 'gamepad'] }] })
    if (!res.ok) throw new Error(`could not create synonym set ${name}: ${JSON.stringify(res.body)}`)
  }
}

module.exports = {
  snippets: {
    'multi-way-synonym': {
      // Guessed from the curl example: PUT /synonym_sets/clothing-synonyms
      async verify({ response, expectKeys, expectExists }) {
        await expectExists('/synonym_sets/clothing-synonyms')
        expectKeys(response, ['name', 'items'])
      },
    },
    'one-way-synonym': {
      // Guessed from the curl example: PUT /synonym_sets/tech-synonyms
      async verify({ response, expectKeys, expectExists }) {
        await expectExists('/synonym_sets/tech-synonyms')
        expectKeys(response, ['name', 'items'])
      },
    },
    'retrieve-a-synonym-set': {
      // Guessed from the curl example: GET /synonym_sets/clothing-synonyms
      async verify({ response, expectKeys }) {
        expectKeys(response, ['name', 'items'])
      },
    },
    'list-all-synonym-sets': {
      // Guessed from the curl example: GET /synonym_sets
      // No specific check guessed: the example passes if it runs without errors.
    },
    'delete-a-synonym-set': {
      // Guessed from the curl example: DELETE /synonym_sets/clothing-synonyms
      async verify({ expectGone }) {
        await expectGone('/synonym_sets/clothing-synonyms')
      },
    },
    'altering-an-existing-collection': {
      // Guessed from the curl example: PATCH /collections/products
      async setup(ctx) {
        await ctx.ensureCollection('products')
        await ensureSynonymSets(ctx, 'clothing-synonyms', 'tech-synonyms')
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/products')
        assert.deepEqual(collection.synonym_sets, ['clothing-synonyms', 'tech-synonyms'])
      },
    },
    'using-synonym-sets-in-search': {
      // Guessed from the curl example: GET /collections/products/documents/search?q&query_by&synonym_sets
      async setup(ctx) {
        await ctx.createCollection({ name: 'products', fields: [{ name: 'name', type: 'string' }] })
        await ctx.importDocuments('products', [{ id: '1', name: 'Wireless gamepad' }])
        await ensureSynonymSets(ctx, 'tech-synonyms', 'electronics-synonyms')
      },
      async verify({ assert, response }) {
        // "controller" only matches "gamepad" through the synonym sets.
        assert.equal(response.found, 1)
      },
    },
    'upsert-a-synonym-set-item': {
      // Guessed from the curl example: PUT /synonym_sets/tech-synonyms/items/smart-phone-synonyms
      async verify({ expectExists }) {
        await expectExists('/synonym_sets/tech-synonyms/items/smart-phone-synonyms')
      },
    },
    'retrieve-a-synonym-set-item': {
      // Guessed from the curl example: GET /synonym_sets/tech-synonyms/items/smart-phone-synonyms
      // No specific check guessed: the example passes if it runs without errors.
    },
    'list-all-synonym-set-items': {
      // Guessed from the curl example: GET /synonym_sets/tech-synonyms/items
      // No specific check guessed: the example passes if it runs without errors.
    },
    'delete-a-synonym-set-item': {
      // Guessed from the curl example: DELETE /synonym_sets/tech-synonyms/items/smart-phone-synonyms
      async verify({ expectGone }) {
        await expectGone('/synonym_sets/tech-synonyms/items/smart-phone-synonyms')
      },
    },
  },
}
