// Tests for the examples on docs-site/content/30.2/api/geosearch.md
//
// Each key in `snippets` is a snippet ID: the anchor of the heading above the
// example, with --2, --3 for later examples under the same heading. Examples
// run top to bottom against a fresh Typesense server, once per language.
// See snippet-tests/README.md for everything a test can do.

const PLACES = {
  name: 'places',
  fields: [
    { name: 'title', type: 'string' },
    { name: 'points', type: 'int32' },
    { name: 'location', type: 'geopoint' },
  ],
  default_sorting_field: 'points',
}

const PLACES_DOCS = [
  { id: '1', title: 'Louvre Museuem', points: 1, location: [48.86093481609114, 2.33698396872901] },
  { id: '2', title: 'Eiffel Tower', points: 2, location: [48.8584, 2.2945] },
]

// Creates the places collection with its geopoint field and sample places,
// unless an earlier example already made it.
async function ensurePlaces({ api, createCollection, importDocuments }) {
  const existing = await api.get('/collections/places')
  if (existing.ok && existing.body.num_documents > 0) return
  await createCollection(PLACES)
  await importDocuments('places', PLACES_DOCS)
}

module.exports = {
  snippets: {
    'geosearch': {
      async setup({ dropCollection }) {
        await dropCollection('places')
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/places')
        assert.ok(collection.fields.some(f => f.name === 'location' && f.type === 'geopoint'), 'expected a geopoint field')
      },
    },
    'geosearch--2': {
      // Guessed from the curl example: POST /collections/places/documents
      async setup({ api, createCollection }) {
        if (!(await api.get('/collections/places')).ok) await createCollection(PLACES)
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/places')
        assert.ok(collection.num_documents > 0, 'expected the collection to have documents')
      },
    },
    'searching-within-a-radius': {
      async setup(ctx) {
        await ensurePlaces(ctx)
      },
      async verify({ assert, response, expectKeys }) {
        assert.ok(Array.isArray(response.hits), 'expected search hits')
        assert.ok(response.found > 0, 'expected the Louvre within 5.1 km')
        expectKeys(response, ['facet_counts', 'found', 'hits', 'out_of', 'page', 'request_params', 'search_time_ms'])
      },
    },
    'searching-within-a-geo-polygon': {
      // No API call recognised. The example only has to run without errors.
    },
    'creating-a-collection-with-geopolygons': {
      // Guessed from the curl example: POST /collections
      async setup({ dropCollection }) {
        await dropCollection('territories')
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/territories')
        for (const field of ['name', 'area']) {
          assert.ok(collection.fields.some(f => f.name === field), `missing field ${field}`)
        }
      },
    },
    'adding-polygon-areas': {
      // Guessed from the curl example: POST /collections/territories/documents
      async setup({ api, createCollection }) {
        if ((await api.get('/collections/territories')).ok) return
        await createCollection({
          name: 'territories',
          fields: [
            { name: 'name', type: 'string' },
            { name: 'area', type: 'geopolygon' },
          ],
        })
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/territories')
        assert.ok(collection.num_documents > 0, 'expected the collection to have documents')
      },
    },
    'searching-points-in-polygons': {
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.hits), 'expected search hits')
        assert.equal(response.found, 1)
      },
    },
    'exclude-radius': {
      // No API call recognised. The example only has to run without errors.
    },
    'precision': {
      // No API call recognised. The example only has to run without errors.
    },
  },
}
