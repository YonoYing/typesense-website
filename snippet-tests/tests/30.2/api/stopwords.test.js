// Tests for the examples on docs-site/content/30.2/api/stopwords.md
//
// Each key in `snippets` is a snippet ID: the anchor of the heading above the
// example, with --2, --3 for later examples under the same heading. Examples
// run top to bottom against a fresh Typesense server, once per language.
// See snippet-tests/README.md for everything a test can do.

module.exports = {
  snippets: {
    'adding-stopwords': {
      // Guessed from the curl example: PUT /stopwords/stopword_set1
      async verify({ response, expectKeys, expectExists }) {
        await expectExists('/stopwords/stopword_set1')
        expectKeys(response, ['id', 'locale', 'stopwords'])
      },
    },
    'using-stopwords-during-search': {
      // Guessed from the curl example: POST /multi_search
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.results), 'expected one result per search')
      },
    },
    'getting-all-stopwords-sets': {
      // Guessed from the curl example: GET /stopwords
      // No specific check guessed: the example passes if it runs without errors.
    },
    'get-a-specific-stopwords-set': {
      // Guessed from the curl example: GET /stopwords/countries
      // The page creates "stopword_set1" but reads back "countries", so make it here.
      async setup({ api }) {
        await api.put('/stopwords/countries', { stopwords: ['Germany', 'France'], locale: 'en' })
      },
      async verify({ assert, response }) {
        assert.equal(response.stopwords.id, 'countries')
      },
    },
    'updating-stopwords': {
      // Guessed from the curl example: PUT /stopwords/countries
      async verify({ expectExists }) {
        await expectExists('/stopwords/countries')
      },
    },
  },
}
