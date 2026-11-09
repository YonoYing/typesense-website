// Tests for the examples on docs-site/content/30.2/api/stemming.md
//
// Each key in `snippets` is a snippet ID: the anchor of the heading above the
// example, with --2, --3 for later examples under the same heading. Examples
// run top to bottom against a fresh Typesense server, once per language.
// See snippet-tests/README.md for everything a test can do.

const DICTIONARY = [
  { word: 'people', root: 'person' },
  { word: 'children', root: 'child' },
]

async function ensureDictionary({ api, toJsonl }) {
  const res = await api.post('/stemming/dictionaries/import?id=irregular-plurals', toJsonl(DICTIONARY))
  if (!res.ok) throw new Error(`could not create the stemming dictionary: ${JSON.stringify(res.body)}`)
}

module.exports = {
  snippets: {
    'basic-stemming': {
      // Guessed from the curl example: POST /collections
      async setup({ dropCollection }) {
        await dropCollection('companies')
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/companies')
        for (const field of ['description']) {
          assert.ok(collection.fields.some(f => f.name === field), `missing field ${field}`)
        }
      },
    },
    'creating-a-stemming-dictionary': {
      // Guessed from the curl example: POST /stemming/dictionaries/import?id
      async setup({ writeFile, toJsonl }) {
        writeFile('dictionary.jsonl', toJsonl(DICTIONARY))
      },
      async verify({ expectExists }) {
        await expectExists('/stemming/dictionaries/irregular-plurals')
      },
    },
    'using-a-stemming-dictionary': {
      // Guessed from the curl example: POST /collections
      async setup(ctx) {
        await ensureDictionary(ctx)
        await ctx.dropCollection('companies')
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/companies')
        for (const field of ['title']) {
          assert.ok(collection.fields.some(f => f.name === field), `missing field ${field}`)
        }
      },
    },
    'retrieve-a-dictionary': {
      // Guessed from the curl example: GET /stemming/dictionaries/irregular-plurals
      async setup(ctx) {
        await ensureDictionary(ctx)
      },
      async verify({ assert, response }) {
        assert.equal(response.id, 'irregular-plurals')
        assert.ok(response.words.some(w => w.word === 'people' && w.root === 'person'), 'expected the people -> person entry')
      },
    },
    'list-all-dictionaries': {
      // Guessed from the curl example: GET /stemming/dictionaries
      async verify({ response, expectKeys }) {
        expectKeys(response, ['dictionaries'])
      },
    },
  },
}
