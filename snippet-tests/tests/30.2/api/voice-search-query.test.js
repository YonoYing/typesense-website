// Tests for the examples on docs-site/content/30.2/api/voice-search-query.md
//
// Each key in `snippets` is a snippet ID: the anchor of the heading above the
// example, with --2, --3 for later examples under the same heading. Examples
// run top to bottom against a fresh Typesense server, once per language.
// See snippet-tests/README.md for everything a test can do.

module.exports = {
  snippets: {
    'multi-search-using-voice-query': {
      // No API call recognised. The example only has to run without errors.
    },
    'multi-search-using-voice-query--2': {
      skip: 'needs sox, a recorded audio file and a speech-to-text model',
      // Guessed from the curl example: POST /multi_search
      async setup({ ensureCollection }) {
        await ensureCollection('products')
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.results), 'expected one result per search')
      },
    },
  },
}
