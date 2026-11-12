// Tests for the examples on docs-site/content/30.2/api/stopwords.md
//
// Each key in `snippets` is a snippet ID: the anchor of the heading above the
// example, with --2, --3 for later examples under the same heading. Examples
// run top to bottom against a fresh Typesense server, once per language.
// See snippet-tests/README.md for everything a test can do.

// The set the page creates in "Adding stopwords" and uses from then on.
async function ensureStopwordSet({ api }) {
  await api.put('/stopwords/stopword_set1', { stopwords: ['Germany', 'France'], locale: 'en' })
}

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
      // The example searches a "books" collection the page never creates.
      async setup(ctx) {
        await ensureStopwordSet(ctx)
        await ctx.ensureCollection('books', { name: 'books', fields: [{ name: 'title', type: 'string' }] })
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.results), 'expected one result per search')
      },
    },
    'getting-all-stopwords-sets': {
      // Guessed from the curl example: GET /stopwords
      // No specific check guessed: the example passes if it runs without errors.
    },
    'get-a-specific-stopwords-set': {
      // GET /stopwords/stopword_set1
      async setup(ctx) {
        await ensureStopwordSet(ctx)
      },
      async verify({ assert, response }) {
        assert.equal(response.stopwords.id, 'stopword_set1')
      },
    },
    'updating-stopwords': {
      // PUT /stopwords/stopword_set1
      async verify({ assert, api }) {
        const res = await api.get('/stopwords/stopword_set1')
        assert.deepEqual(res.body.stopwords.stopwords.slice().sort(), ['france', 'germany', 'italy'])
      },
    },
  },
}
