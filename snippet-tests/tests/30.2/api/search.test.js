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
      // GET /collections/products/documents/search with a $Customers(...) filter
      // and facet: needs a "Customers" collection that references "products".
      async setup({ createCollection, importDocuments, dropCollection }) {
        await dropCollection('Customers')
        await createCollection({ name: 'products', fields: [{ name: 'product_name', type: 'string' }] })
        await importDocuments('products', [{ id: 'p1', product_name: 'Phone' }, { id: 'p2', product_name: 'Laptop' }])
        await createCollection({
          name: 'Customers',
          fields: [
            { name: 'customer_id', type: 'string' },
            { name: 'product_price', type: 'float', facet: true },
            { name: 'product_id', type: 'string', reference: 'products.id' },
          ],
        })
        await importDocuments('Customers', [
          { id: 'c1', customer_id: 'customer_a', product_price: 100, product_id: 'p1' },
          { id: 'c2', customer_id: 'customer_b', product_price: 900, product_id: 'p2' },
        ])
      },
      async verify({ assert, response }) {
        assert.equal(response.found, 1, "expected only customer_a's product")
        assert.ok(Array.isArray(response.facet_counts) && response.facet_counts.length, 'expected facet counts from Customers')
      },
    },
    'sorting-null-empty-or-missing-values': {
      // No API call recognised. The example only has to run without errors.
    },
    'sorting-null-empty-or-missing-values--2': {
      // No API call recognised. The example only has to run without errors.
    },
    'example': {
      // GET /collections/products/documents/search with a decay function sort:
      // the page's sample records, with product_name and timestamp.
      async setup({ createCollection, importDocuments, dropCollection }) {
        await dropCollection('Customers')
        await createCollection({
          name: 'products',
          fields: [
            { name: 'product_name', type: 'string' },
            { name: 'timestamp', type: 'int64' },
          ],
        })
        await importDocuments('products', [
          { product_name: 'Samsung Smartphone', timestamp: 1728383250 },
          { product_name: 'Vivo Smartphone', timestamp: 1728384250 },
          { product_name: 'Oneplus Smartphone', timestamp: 1728385250 },
          { product_name: 'Pixel Smartphone', timestamp: 1728386250 },
          { product_name: 'Moto Smartphone', timestamp: 1728387250 },
        ])
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.hits) && response.hits.length, 'expected search hits')
        // The page says the record at the origin ranks first.
        assert.equal(response.hits[0].document.product_name, 'Oneplus Smartphone')
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
      async setup({ createCollection, importDocuments, dropCollection }) {
        // The preset sorts products by popularity.
        await dropCollection('Customers')
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
