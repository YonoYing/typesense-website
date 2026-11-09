// Tests for the examples on docs-site/content/30.2/api/federated-multi-search.md
//
// Each key in `snippets` is a snippet ID: the anchor of the heading above the
// example, with --2, --3 for later examples under the same heading. Examples
// run top to bottom against a fresh Typesense server, once per language.
// See snippet-tests/README.md for everything a test can do.

// The union examples search posts and comments by user_name and group by content.
async function createSocialCollections({ createCollection, importDocuments }, names) {
  const docs = [
    { id: '124', user_name: 'stark_industry', content: 'USA', likes: 5215 },
    { id: '125', user_name: 'stark_industry', content: 'UK', likes: 1232 },
    { id: '126', user_name: 'rogers_steve', content: 'USA', likes: 531 },
  ]
  for (const name of names) {
    await createCollection({
      name,
      fields: [
        { name: 'user_name', type: 'string', facet: true },
        { name: 'content', type: 'string', facet: true },
        { name: 'likes', type: 'int32' },
      ],
    })
    await importDocuments(name, docs)
  }
}

module.exports = {
  snippets: {
    'federated-search': {
      // Guessed from the curl example: POST /multi_search?query_by
      async setup({ createCollection, importDocuments }) {
        await createCollection({
          name: 'products',
          fields: [
            { name: 'name', type: 'string' },
            { name: 'brand', type: 'string' },
            { name: 'price', type: 'float' },
          ],
        })
        await importDocuments('products', [{ id: '1', name: 'Blue shoe', brand: 'Adidas', price: 75 }])
        await createCollection({ name: 'brands', fields: [{ name: 'name', type: 'string' }] })
        await importDocuments('brands', [{ id: '1', name: 'Nike' }])
      },
      async verify({ assert, response }) {
        assert.equal(response.results.length, 2, 'expected one result per search')
        assert.equal(response.results[0].hits[0].document.name, 'Blue shoe')
        assert.equal(response.results[1].hits[0].document.name, 'Nike')
      },
    },
    'union-search': {
      // Guessed from the curl example: POST /multi_search?page&per_page
      async setup(ctx) {
        await createSocialCollections(ctx, ['posts'])
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.hits), 'expected union search hits')
        assert.equal(response.found, 3)
      },
    },
    'union-search--2': {
      // No API call recognised. The example only has to run without errors.
    },
    'grouping-with-union': {
      // Guessed from the curl example: POST /multi_search?page&per_page
      async setup(ctx) {
        await createSocialCollections(ctx, ['posts', 'comments'])
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.grouped_hits), 'expected grouped union hits')
      },
    },
  },
}
