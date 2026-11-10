// Tests for the examples on docs-site/content/30.2/api/collections.md
//
// Each key in `snippets` is a snippet ID: the anchor of the heading above the
// example, with --2, --3 for later examples under the same heading. Examples
// run top to bottom against a fresh Typesense server, once per language.
// See snippet-tests/README.md for everything a test can do.

module.exports = {
  snippets: {
    'with-pre-defined-schema': {
      // Guessed from the curl example: POST /collections
      async setup({ dropCollection }) {
        await dropCollection('companies')
      },
      async verify({ assert, response, expectKeys, expectExists }) {
        const collection = await expectExists('/collections/companies')
        for (const field of ['company_name', 'num_employees', 'country']) {
          assert.ok(collection.fields.some(f => f.name === field), `missing field ${field}`)
        }
        expectKeys(response, ['name', 'num_documents', 'fields', 'default_sorting_field'])
      },
    },
    'cloning-a-collection-schema': {
      // Guessed from the curl example: POST /collections?src_name
      async setup({ ensureCollection, dropCollection }) {
        await ensureCollection('existing_coll')
        await dropCollection('new_coll')
      },
      async verify({ expectExists }) {
        await expectExists('/collections/new_coll')
      },
    },
    'clone-collection-with-documents': {
      // Guessed from the curl example: POST /collections?src_name&copy_documents
      async setup({ ensureCollection, dropCollection }) {
        await ensureCollection('source_collection')
        await dropCollection('new_collection_with_docs')
      },
      async verify({ expectExists }) {
        await expectExists('/collections/new_collection_with_docs')
      },
    },
    'indexing-nested-fields': {
      // Guessed from the curl example: POST /collections
      async setup({ dropCollection }) {
        await dropCollection('docs')
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/docs')
        for (const field of ['person', 'details']) {
          assert.ok(collection.fields.some(f => f.name === field), `missing field ${field}`)
        }
      },
    },
    'indexing-nested-fields--2': {
      // Guessed from the curl example: POST /collections
      async setup({ dropCollection }) {
        await dropCollection('docs')
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/docs')
        for (const field of ['name']) {
          assert.ok(collection.fields.some(f => f.name === field), `missing field ${field}`)
        }
      },
    },
    'indexing-nested-fields--3': {
      // Guessed from the curl example: POST /collections
      async setup({ dropCollection }) {
        await dropCollection('docs')
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/docs')
        for (const field of ['name']) {
          assert.ok(collection.fields.some(f => f.name === field), `missing field ${field}`)
        }
      },
    },
    'retrieve-a-collection': {
      // Guessed from the curl example: GET /collections/companies
      async setup({ ensureCollection }) {
        await ensureCollection('companies')
      },
      async verify({ assert, response, expectKeys }) {
        assert.equal(response.name, 'companies')
        expectKeys(response, ['name', 'num_documents', 'fields', 'default_sorting_field'])
      },
    },
    'list-all-collections': {
      // Guessed from the curl example: GET /collections
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response), 'expected a list of collections')
      },
    },
    'drop-a-collection': {
      // Guessed from the curl example: DELETE /collections/companies
      async setup({ ensureCollection }) {
        await ensureCollection('companies')
      },
      async verify({ expectGone }) {
        await expectGone('/collections/companies')
      },
    },
    'truncate-a-collection': {
      // Guessed from the curl example: DELETE /collections/companies/documents?truncate
      async setup({ ensureCollection }) {
        await ensureCollection('companies')
      },
      async verify({ assert, response }) {
        assert.equal(typeof response.num_deleted, 'number')
      },
    },
    'update-or-alter-a-collection': {
      // Guessed from the curl example: PATCH /collections/companies
      // The example adds a required field, which the server only accepts when
      // no document lacks it: the collection must be empty, as it is when the
      // page runs in order.
      async setup({ createCollection, fixtures }) {
        await createCollection(fixtures.companies.schema)
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/companies')
        assert.ok(collection.fields.some(f => f.name === 'company_category'), 'field company_category should exist')
        assert.ok(!collection.fields.some(f => f.name === 'num_employees'), 'field num_employees should be dropped')
      },
    },
    'modifying-an-existing-field': {
      // Guessed from the curl example: PATCH /collections/companies
      // The example redefines `company_category`, which the previous example
      // adds: start from an empty `companies` that has it.
      async setup({ createCollection, fixtures }) {
        const schema = fixtures.companies.schema
        await createCollection({ ...schema, fields: [...schema.fields, { name: 'company_category', type: 'string' }] })
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/companies')
        assert.ok(collection.fields.some(f => f.name === 'company_category'), 'field company_category should exist')
      },
    },
    'get-schema-change-status': {
      // Guessed from the curl example: GET /operations/schema_changes
      // No specific check guessed: the example passes if it runs without errors.
    },
  },
}
