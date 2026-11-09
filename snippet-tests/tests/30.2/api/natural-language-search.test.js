// Tests for the examples on docs-site/content/30.2/api/natural-language-search.md
//
// Each key in `snippets` is a snippet ID: the anchor of the heading above the
// example, with --2, --3 for later examples under the same heading. Examples
// run top to bottom against a fresh Typesense server, once per language.
// See snippet-tests/README.md for everything a test can do.

module.exports = {
  snippets: {
    'create-a-natural-language-search-model': {
      skip: 'needs a Google Gemini (or other LLM provider) API key',
      // Guessed from the curl example: POST /nl_search_models
      // No specific check guessed: the example passes if it runs without errors.
    },
    'single-search': {
      skip: 'needs a natural language search model, which needs an LLM API key',
      // Guessed from the curl example: POST /collections/products/documents/search
      async setup({ ensureCollection }) {
        await ensureCollection('products')
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.hits), 'expected search hits')
        assert.equal(typeof response.found, 'number')
      },
    },
    'single-search--2': {
      skip: 'needs a natural language search model, which needs an LLM API key',
      // Guessed from the curl example: POST /collections/products/documents/search
      async setup({ ensureCollection }) {
        await ensureCollection('products')
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.hits), 'expected search hits')
        assert.equal(typeof response.found, 'number')
      },
    },
    'multi-search': {
      skip: 'needs a natural language search model, which needs an LLM API key',
      // Guessed from the curl example: POST /multi_search
      async setup({ ensureCollection }) {
        await ensureCollection('products')
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.results), 'expected one result per search')
      },
    },
    'list-all-models': {
      // Guessed from the curl example: GET /nl_search_models
      // No specific check guessed: the example passes if it runs without errors.
    },
    'get-model-details': {
      skip: 'needs a natural language search model, which needs an LLM API key',
      // Guessed from the curl example: GET /nl_search_models/{model_id}
      // No specific check guessed: the example passes if it runs without errors.
    },
    'update-model': {
      skip: 'needs a natural language search model, which needs an LLM API key',
      // Guessed from the curl example: PUT /nl_search_models/{model_id}
      async verify({ expectExists }) {
        await expectExists('/nl_search_models/{model_id}')
      },
    },
    'delete-model': {
      skip: 'needs a natural language search model, which needs an LLM API key',
      // Guessed from the curl example: DELETE /nl_search_models/{model_id}
      async verify({ expectGone }) {
        await expectGone('/nl_search_models/{model_id}')
      },
    },
    'debug-mode': {
      skip: 'needs a natural language search model, which needs an LLM API key',
      // Guessed from the curl example: POST /collections/products/documents/search
      async setup({ ensureCollection }) {
        await ensureCollection('products')
      },
      async verify({ assert, response, expectKeys }) {
        assert.ok(Array.isArray(response.hits), 'expected search hits')
        assert.equal(typeof response.found, 'number')
        expectKeys(response, ['parsed_nl_query'])
      },
    },
    'schema-prompt-cache': {
      xfail: 'Docs bug: uses --data-urlencode without -G, so curl sends a POST that the search endpoint answers with 404; it also reads ${API_KEY} instead of ${TYPESENSE_API_KEY}',
      // Guessed from the curl example: POST /collections/products/documents/search
      async setup({ ensureCollection }) {
        await ensureCollection('products')
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.hits), 'expected search hits')
        assert.equal(typeof response.found, 'number')
      },
    },
  },
}
