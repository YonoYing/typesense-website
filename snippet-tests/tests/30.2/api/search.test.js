// Tests for the examples on docs-site/content/30.2/api/search.md
//
// Each key in `snippets` is a snippet ID: the anchor of the heading above the
// example, with --2, --3 for later examples under the same heading. Examples
// run top to bottom against a fresh Typesense server, once per language.
// See snippet-tests/README.md for everything a test can do.

module.exports = {
  snippets: {
    'search': {
      // Guessed from the curl example: GET /collections/companies/documents/search?q&query_by&filter_by&sort_by
      async setup({ ensureCollection }) {
        await ensureCollection('companies')
      },
      async verify({ assert, response, expectKeys }) {
        assert.ok(Array.isArray(response.hits), 'expected search hits')
        assert.equal(typeof response.found, 'number')
        expectKeys(response, ['facet_counts', 'found', 'out_of', 'page', 'request_params', 'search_time_ms', 'hits'])
      },
    },
    'facet-referencing': {
      // No API call recognised. The example only has to run without errors.
    },
    'facet-referencing--2': {
      // No API call recognised. The example only has to run without errors.
    },
    'sorting-null-empty-or-missing-values': {
      // No API call recognised. The example only has to run without errors.
    },
    'sorting-null-empty-or-missing-values--2': {
      // No API call recognised. The example only has to run without errors.
    },
    'example': {
      // Guessed from the curl example: GET /collections/products/documents/search?q&query_by&sort_by
      async setup({ ensureCollection }) {
        await ensureCollection('products')
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.hits), 'expected search hits')
        assert.equal(typeof response.found, 'number')
      },
    },
    'group-results': {
      // Guessed from the JavaScript example: GET /collections/companies/documents/search
      async setup({ ensureCollection }) {
        await ensureCollection('companies')
      },
      async verify({ assert, response, expectKeys }) {
        assert.ok(Array.isArray(response.grouped_hits), 'expected grouped hits')
        assert.ok(response.grouped_hits.every(g => g.hits.length <= 1), 'group_limit 1 should cap each group at one hit')
        expectKeys(response, ['facet_counts', 'found', 'out_of', 'page', 'request_params', 'search_time_ms', 'grouped_hits'])
      },
    },
    'presets': {
      // Guessed from the curl example: PUT /presets/listing_view
      async setup({ createCollection, importDocuments }) {
        // The preset sorts products by popularity.
        await createCollection({
          name: 'products',
          fields: [
            { name: 'name', type: 'string' },
            { name: 'popularity', type: 'int32' },
          ],
        })
        await importDocuments('products', [{ id: '1', name: 'Shoe', popularity: 10 }])
      },
      async verify({ expectExists }) {
        await expectExists('/presets/listing_view')
      },
    },
    'presets--2': {
      // Guessed from the curl example: POST /multi_search
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.results), 'expected one result per search')
      },
    },
    'presets--3': {
      // No API call recognised. The example only has to run without errors.
    },
  },
}
