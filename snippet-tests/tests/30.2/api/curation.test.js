// Tests for the examples on docs-site/content/30.2/api/curation.md
//
// Each key in `snippets` is a snippet ID: the anchor of the heading above the
// example, with --2, --3 for later examples under the same heading. Examples
// run top to bottom against a fresh Typesense server, once per language.
// See snippet-tests/README.md for everything a test can do.

const ITEM = {
  id: 'dynamic-sort-filter',
  rule: { query: 'shoes', match: 'exact' },
  sort_by: 'num_employees:desc',
}

async function ensureCurationSet(api, name = 'curate_products', items = []) {
  const res = await api.put(`/curation_sets/${name}`, { items })
  if (!res.ok) throw new Error(`could not create curation set ${name}: ${JSON.stringify(res.body)}`)
}

module.exports = {
  snippets: {
    'create-or-update-a-curation-set': {
      // Guessed from the curl example: PUT /curation_sets/curate_products
      async verify({ expectExists }) {
        await expectExists('/curation_sets/curate_products')
      },
    },
    'including-or-excluding-documents': {
      // Guessed from the curl example: PUT /curation_sets/curate_products
      async verify({ response, expectKeys, expectExists }) {
        await expectExists('/curation_sets/curate_products')
        expectKeys(response, ['name', 'items'])
      },
    },
    'dynamic-filtering': {
      // Guessed from the curl example: PUT /curation_sets/curate_products
      async verify({ expectExists }) {
        await expectExists('/curation_sets/curate_products')
      },
    },
    'dynamic-sorting': {
      // Guessed from the curl example: PUT /curation_sets/curate_products
      async verify({ expectExists }) {
        await expectExists('/curation_sets/curate_products')
      },
    },
    'dynamic-sorting--2': {
      // Guessed from the curl example: PUT /curation_sets/curate_products
      async verify({ expectExists }) {
        await expectExists('/curation_sets/curate_products')
      },
    },
    'retrieve-a-curation-set': {
      // Guessed from the curl example: GET /curation_sets/curate_products
      async setup({ api }) {
        await ensureCurationSet(api, 'curate_products', [ITEM])
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.items), 'expected the curation set items')
      },
    },
    'list-all-curation-sets': {
      // Guessed from the curl example: GET /curation_sets
      async setup({ api }) {
        await ensureCurationSet(api)
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response), 'expected a list of curation sets')
      },
    },
    'delete-a-curation-set': {
      // Guessed from the curl example: DELETE /curation_sets/curate_products
      async setup({ api }) {
        await ensureCurationSet(api)
      },
      async verify({ expectGone }) {
        await expectGone('/curation_sets/curate_products')
      },
    },
    'altering-an-existing-collection': {
      // Guessed from the curl example: PATCH /collections/products
      async setup({ api, ensureCollection }) {
        await ensureCollection('products')
        await ensureCurationSet(api, 'clothing_curation')
        await ensureCurationSet(api, 'tech_curation')
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/products')
        assert.deepEqual(collection.curation_sets, ['clothing_curation', 'tech_curation'])
      },
    },
    'upsert-a-curation-set-item': {
      // Guessed from the curl example: PUT /curation_sets/curate_products/items/dynamic-sort-filter
      async setup({ api }) {
        await ensureCurationSet(api)
      },
      async verify({ expectExists }) {
        await expectExists('/curation_sets/curate_products/items/dynamic-sort-filter')
      },
    },
    'retrieve-a-curation-set-item': {
      // Guessed from the curl example: GET /curation_sets/curate_products/items/dynamic-sort-filter
      async setup({ api }) {
        await ensureCurationSet(api, 'curate_products', [ITEM])
      },
      async verify({ assert, response }) {
        assert.equal(response.id, 'dynamic-sort-filter')
      },
    },
    'list-all-curation-set-items': {
      // Guessed from the curl example: GET /curation_sets/curate_products/items
      async setup({ api }) {
        await ensureCurationSet(api, 'curate_products', [ITEM])
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response), 'expected a list of items')
      },
    },
    'delete-a-curation-set-item': {
      // Guessed from the curl example: DELETE /curation_sets/curate_products/items/dynamic-sort-filter
      async setup({ api }) {
        await ensureCurationSet(api, 'curate_products', [ITEM])
      },
      async verify({ expectGone }) {
        await expectGone('/curation_sets/curate_products/items/dynamic-sort-filter')
      },
    },
  },
}
