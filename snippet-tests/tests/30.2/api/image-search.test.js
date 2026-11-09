// Tests for the examples on docs-site/content/30.2/api/image-search.md
//
// Each key in `snippets` is a snippet ID: the anchor of the heading above the
// example, with --2, --3 for later examples under the same heading. Examples
// run top to bottom against a fresh Typesense server, once per language.
// See snippet-tests/README.md for everything a test can do.

module.exports = {
  snippets: {
    'search-for-images-using-text': {
      skip: 'needs the CLIP image model (a large download) and an images collection the page only describes',
      // Guessed from the curl example: POST /multi_search
      async setup({ ensureCollection }) {
        await ensureCollection('images')
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.results), 'expected one result per search')
      },
    },
    'search-for-similar-images-within-dataset': {
      skip: 'needs the CLIP image model (a large download) and an images collection the page only describes',
      // Guessed from the curl example: POST /multi_search
      async setup({ ensureCollection }) {
        await ensureCollection('images')
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.results), 'expected one result per search')
      },
    },
    'search-for-similar-images-with-dynamic-image': {
      skip: 'needs the CLIP image model (a large download) and an images collection the page only describes',
      // Guessed from the curl example: POST /multi_search
      async setup({ ensureCollection }) {
        await ensureCollection('images')
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.results), 'expected one result per search')
      },
    },
  },
}
