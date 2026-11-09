// Tests for the examples on docs-site/content/30.2/api/vector-search.md
//
// Each key in `snippets` is a snippet ID: the anchor of the heading above the
// example, with --2, --3 for later examples under the same heading. Examples
// run top to bottom against a fresh Typesense server, once per language.
// See snippet-tests/README.md for everything a test can do.
//
// Examples that call OpenAI, Google or other hosted models are skipped: CI has
// no API keys for them. The built-in models (ts/...) are downloaded by the
// server on first use, so those examples need network access.

const JS_CREATE_BUG =
  "Docs bug: calls client.collections('products').create(schema), but typesense-js creates collections with client.collections().create(schema)"

// The "products" collection most search examples use: product names with an
// auto-embedding field from a built-in model.
const PRODUCTS = {
  name: 'products',
  fields: [
    { name: 'product_name', type: 'string' },
    { name: 'categories', type: 'string[]', optional: true },
    {
      name: 'embedding',
      type: 'float[]',
      embed: { from: ['product_name', 'categories'], model_config: { model_name: 'ts/e5-small' } },
    },
  ],
}
const PRODUCT_DOCS = [
  { id: '1', product_name: 'Ergonomic office chair', categories: ['furniture'] },
  { id: '2', product_name: 'Mechanical keyboard', categories: ['electronics'] },
  { id: '3', product_name: 'Standing desk', categories: ['furniture'] },
]

// The "docs" collection with 4-dimension vectors from the first examples.
const DOCS = {
  name: 'docs',
  fields: [
    { name: 'title', type: 'string' },
    { name: 'points', type: 'int32' },
    { name: 'embedding', type: 'float[]', num_dim: 4 },
    // Not in the page's schema, but the brute-force example filters on it.
    { name: 'category', type: 'string', optional: true },
  ],
  default_sorting_field: 'points',
}
const DOCS_DOCS = [
  { id: 'foobar', points: 1, title: 'Louvre Museuem', embedding: [0.04, 0.234, 0.113, 0.001] },
  { id: '2', points: 2, title: 'Eiffel Tower', embedding: [0.96826, 0.94, 0.39557, 0.306488], category: 'shoes' },
]

// Makes sure the collection has this schema's fields and the sample
// documents, recreating it when earlier examples left a different shape.
async function ensureWithDocs({ api, createCollection, importDocuments }, schema, docs) {
  const existing = await api.get(`/collections/${schema.name}`)
  const wanted = schema.fields.map(f => f.name).sort().join(',')
  const have = existing.ok ? existing.body.fields.map(f => f.name).sort().join(',') : null
  if (have !== wanted) await createCollection(schema)
  await importDocuments(schema.name, docs)
}

const ensureProducts = ctx => ensureWithDocs(ctx, PRODUCTS, PRODUCT_DOCS)
const ensureDocs = ctx => ensureWithDocs(ctx, DOCS, DOCS_DOCS)

module.exports = {
  snippets: {
    'option-a-importing-externally-generated-embeddings-into-typesense': {
      // Guessed from the curl example: POST /collections
      async setup({ dropCollection }) {
        await dropCollection('docs')
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/docs')
        for (const field of ['title', 'points', 'embedding']) {
          assert.ok(collection.fields.some(f => f.name === field), `missing field ${field}`)
        }
      },
    },
    'option-a-importing-externally-generated-embeddings-into-typesense--2': {
      // Guessed from the curl example: POST /collections/docs/documents
      async setup({ api, createCollection }) {
        if (!(await api.get('/collections/docs')).ok) await createCollection(DOCS)
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/docs')
        assert.ok(collection.num_documents > 0, 'expected the collection to have documents')
      },
    },
    'creating-an-auto-embedding-field': {
      xfail: { js: JS_CREATE_BUG },
      timeout: 300000, // first use downloads the model
      // Guessed from the curl example: POST /collections
      async setup({ dropCollection }) {
        await dropCollection('products')
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/products')
        for (const field of ['product_name', 'categories', 'embedding']) {
          assert.ok(collection.fields.some(f => f.name === field), `missing field ${field}`)
        }
      },
    },
    'using-built-in-models': {
      xfail: { js: JS_CREATE_BUG },
      timeout: 300000, // first use downloads the model
      // Guessed from the curl example: POST /collections
      async setup({ dropCollection }) {
        await dropCollection('products')
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/products')
        for (const field of ['brand', 'categories', 'embedding']) {
          assert.ok(collection.fields.some(f => f.name === field), `missing field ${field}`)
        }
      },
    },
    'using-openai-api': {
      skip: { shell: 'needs an OpenAI API key' },
      xfail: { js: JS_CREATE_BUG },
      async setup({ dropCollection }) {
        await dropCollection('products')
      },
    },
    'using-azure-openai-api': {
      xfail: { js: `${JS_CREATE_BUG} (it also needs an Azure OpenAI key)` },
    },
    'using-openai-compatible-apis': {
      skip: { shell: 'needs an OpenAI-compatible API endpoint and key' },
      xfail: { js: JS_CREATE_BUG },
      async setup({ dropCollection }) {
        await dropCollection('products')
      },
    },
    'using-google-palm-api': {
      skip: { shell: 'needs a Google API key' },
      xfail: { js: JS_CREATE_BUG },
      async setup({ dropCollection }) {
        await dropCollection('products')
      },
    },
    'updating-remote-model-api-key': {
      xfail:
        'Possible docs bug: the server rejects this field definition ("Wrong format for `fields`"), probably because `type` is missing. Updating a real key would also need an OpenAI API key.',
      async setup(ctx) {
        await ensureProducts(ctx)
      },
    },
    'oauth-authentication': {
      skip: { shell: 'needs Google OAuth credentials' },
      xfail: { js: JS_CREATE_BUG },
      async setup({ dropCollection }) {
        await dropCollection('products')
      },
    },
    'during-search': {
      // Guessed from the curl example: POST /multi_search
      async setup(ctx) {
        await ensureProducts(ctx)
      },
      async verify({ assert, response }) {
        const result = response.results ? response.results[0] : response
        assert.ok(result.found > 0, 'expected semantic matches for "chair"')
      },
    },
    'during-indexing': {
      // Guessed from the curl example: POST /collections/products/documents/import?remote_embedding_batch_size
      // The JavaScript example imports a `documents` array defined elsewhere.
      vars: { documents: PRODUCT_DOCS },
      async setup(ctx) {
        await ctx.createCollection(PRODUCTS)
        ctx.writeFile('documents.jsonl', ctx.toJsonl(PRODUCT_DOCS))
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/products')
        assert.ok(collection.num_documents > 0, 'expected documents to be imported')
      },
    },
    'model-config-file': {
      skip: { shell: 'needs custom model files on the server' },
      xfail: { js: JS_CREATE_BUG },
      async setup({ dropCollection }) {
        await dropCollection('products')
      },
    },
    'indexing-prefix-and-query-prefix': {
      skip: { shell: 'needs custom model files on the server' },
      xfail: { js: JS_CREATE_BUG },
      async setup({ dropCollection }) {
        await dropCollection('products')
      },
    },
    'nearest-neighbor-vector-search': {
      // Guessed from the curl example: POST /multi_search
      async setup(ctx) {
        await ensureDocs(ctx)
      },
      async verify({ assert, response, expectKeys }) {
        const result = response.results[0]
        expectKeys(result, ['facet_counts', 'found', 'hits', 'out_of', 'page', 'request_params', 'search_time_ms'])
        assert.equal(result.hits[0].document.title, 'Eiffel Tower', 'expected the identical vector first')
      },
    },
    'pagination': {
      // Guessed from the curl example: POST /multi_search
      async setup(ctx) {
        await ensureProducts(ctx)
      },
      async verify({ assert, response }) {
        assert.ok(response.results[0].found > 0, 'expected matches')
      },
    },
    'querying-for-similar-documents': {
      // Guessed from the curl example: POST /multi_search
      async setup(ctx) {
        await ensureDocs(ctx)
      },
      async verify({ assert, response }) {
        const ids = response.results[0].hits.map(h => h.document.id)
        assert.ok(!ids.includes('foobar'), 'the query document itself should not be returned')
        assert.ok(ids.length > 0, 'expected similar documents')
      },
    },
    'semantic-search': {
      // Guessed from the curl example: POST /multi_search
      async setup(ctx) {
        await ensureProducts(ctx)
      },
      async verify({ assert, response }) {
        const result = response.results ? response.results[0] : response
        const names = result.hits.map(h => h.document.product_name)
        assert.ok(names.includes('Ergonomic office chair'), `expected the chair among ${names.join(', ')}`)
      },
    },
    'hybrid-search': {
      xfail: { shell: 'Docs bug: the search has no `collection`, so Typesense answers "Collection not found"' },
      // Guessed from the curl example: POST /multi_search
      async setup(ctx) {
        await ensureProducts(ctx)
      },
      async verify({ assert, response }) {
        const result = response.results ? response.results[0] : response
        const names = result.hits.map(h => h.document.product_name)
        assert.ok(names.includes('Ergonomic office chair'), `expected the chair among ${names.join(', ')}`)
      },
    },
    'hybrid-search--2': {
      xfail: { shell: 'Docs bug: the search has no `collection`, so Typesense answers "Collection not found"' },
      // Guessed from the curl example: POST /multi_search
      async setup(ctx) {
        await ensureProducts(ctx)
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.results), 'expected one result per search')
      },
    },
    'weightage-for-semantic-vs-keyword-matches': {
      // Guessed from the curl example: POST /multi_search
      async setup(ctx) {
        await ensureProducts(ctx)
      },
      async verify({ assert, response }) {
        assert.ok(response.results[0].found > 0, 'expected matches')
      },
    },
    're-ranking-hybrid-matches': {
      // Guessed from the curl example: POST /multi_search
      async setup(ctx) {
        await ensureProducts(ctx)
      },
      async verify({ assert, response }) {
        assert.ok(response.results[0].found > 0, 'expected matches')
      },
    },
    'distance-threshold': {
      // Guessed from the curl example: POST /multi_search
      async setup(ctx) {
        await ensureProducts(ctx)
      },
      async verify({ assert, response }) {
        const result = response.results ? response.results[0] : response
        assert.ok(Array.isArray(result.hits), 'expected hits')
      },
    },
    'brute-force-searching': {
      // Guessed from the curl example: POST /multi_search
      async setup(ctx) {
        await ensureDocs(ctx)
      },
      async verify({ assert, response }) {
        assert.ok(response.results[0].found > 0, 'expected matches')
      },
    },
  },
}
