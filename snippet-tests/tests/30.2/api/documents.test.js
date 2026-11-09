// Tests for the examples on docs-site/content/30.2/api/documents.md
//
// Each key in `snippets` is a snippet ID: the anchor of the heading above the
// example, with --2, --3 for later examples under the same heading. Examples
// run top to bottom against a fresh Typesense server, once per language.
// See snippet-tests/README.md for everything a test can do.

const { commandExists } = require('../../../lib/env')

module.exports = {
  snippets: {
    'index-a-single-document': {
      // Guessed from the curl example: POST /collections/companies/documents
      async setup({ ensureCollection, dropDocument }) {
        await ensureCollection('companies')
        await dropDocument('companies', '124')
      },
      async verify({ expectExists }) {
        await expectExists('/collections/companies/documents/124')
      },
    },
    'upsert-a-single-document': {
      // Guessed from the curl example: POST /collections/companies/documents?action
      async setup({ ensureCollection }) {
        await ensureCollection('companies')
      },
      async verify({ response, expectKeys, expectExists }) {
        await expectExists('/collections/companies/documents/124')
        expectKeys(response, ['id', 'company_name', 'num_employees', 'country'])
      },
    },
    'action-modes-create-upsert-update-emplace': {
      // Guessed from the curl example: POST /collections/companies/documents/import?action
      async setup({ ensureCollection, dropDocument }) {
        await ensureCollection('companies')
        await dropDocument('companies', '124')
        await dropDocument('companies', '125')
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/companies')
        assert.ok(collection.num_documents > 0, 'expected documents to be imported')
      },
    },
    'returning-the-id-of-the-imported-documents': {
      xfail: {
        shell: "Docs bug: the example's output is inside the code block, so pasting it runs `{\"success\": true, ...}` as shell commands",
      },
      // Guessed from the curl example: POST /collections/companies/documents/import?return_id
      async setup({ fixtures, ensureCollection, writeFile, toJsonl }) {
        await ensureCollection('companies')
        writeFile('documents.jsonl', toJsonl(fixtures.companies.documents))
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/companies')
        assert.ok(collection.num_documents > 0, 'expected documents to be imported')
      },
    },
    'configure-batch-size': {
      // Guessed from the curl example: POST /collections/companies/documents/import?batch_size
      // The import uses the default "create" action, so the IDs must be free.
      async setup({ fixtures, ensureCollection, dropDocument, writeFile, toJsonl }) {
        await ensureCollection('companies')
        for (const doc of fixtures.companies.documents) await dropDocument('companies', doc.id)
        writeFile('documents.jsonl', toJsonl(fixtures.companies.documents))
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/companies')
        assert.ok(collection.num_documents > 0, 'expected documents to be imported')
      },
    },
    'indexing-a-document-with-dirty-data': {
      // Guessed from the curl example: POST /collections/titles/documents?dirty_values
      async setup({ ensureCollection }) {
        await ensureCollection('titles')
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/titles')
        assert.ok(collection.num_documents > 0, 'expected the collection to have documents')
      },
    },
    'import-a-jsonl-file': {
      skip: { shell: commandExists('parallel') ? false : 'needs GNU parallel installed' },
      // Guessed from the curl example: POST /collections/companies/documents/import?action
      async setup({ fixtures, ensureCollection, dropDocument, writeFile, toJsonl }) {
        await ensureCollection('companies')
        for (const doc of fixtures.companies.documents) await dropDocument('companies', doc.id)
        writeFile('documents.jsonl', toJsonl(fixtures.companies.documents))
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/companies')
        assert.ok(collection.num_documents > 0, 'expected documents to be imported')
      },
    },
    'import-a-json-file': {
      // No API call recognised. The example only has to run without errors.
    },
    'import-a-csv-file': {
      // No API call recognised. The example only has to run without errors.
    },
    'retrieve-a-document': {
      xfail: { shell: 'Docs bug: the command starts with a `$ ` prompt, which fails when pasted into a shell' },
      // Guessed from the JavaScript example: GET /collections/companies/documents/124
      async setup({ ensureDocument }) {
        await ensureDocument('companies', '124')
      },
      async verify({ assert, response, expectKeys }) {
        assert.equal(response.id, '124')
        expectKeys(response, ['id', 'company_name', 'num_employees', 'country'])
      },
    },
    'update-a-single-document': {
      // Guessed from the curl example: PATCH /collections/companies/documents/124
      async setup({ ensureDocument }) {
        await ensureDocument('companies', '124')
      },
      async verify({ assert, expectExists }) {
        const doc = await expectExists('/collections/companies/documents/124')
        assert.deepEqual(doc['company_name'], 'Stark Industries')
        assert.deepEqual(doc['num_employees'], 5500)
      },
    },
    'update-by-query': {
      // Guessed from the curl example: PATCH /collections/companies/documents?filter_by
      async setup({ ensureCollection }) {
        await ensureCollection('companies')
      },
      async verify({ assert, response }) {
        assert.equal(typeof response.num_updated, 'number')
      },
    },
    'delete-a-single-document': {
      // Guessed from the curl example: DELETE /collections/companies/documents/124
      async setup({ ensureDocument }) {
        await ensureDocument('companies', '124')
      },
      async verify({ expectGone }) {
        await expectGone('/collections/companies/documents/124')
      },
    },
    'delete-by-query': {
      // Guessed from the curl example: DELETE /collections/companies/documents?filter_by&batch_size
      async setup({ ensureCollection }) {
        await ensureCollection('companies')
      },
      async verify({ assert, response }) {
        assert.equal(typeof response.num_deleted, 'number')
      },
    },
    'delete-all-documents': {
      // Guessed from the curl example: DELETE /collections/companies/documents?truncate
      async setup({ ensureCollection }) {
        await ensureCollection('companies')
      },
      async verify({ assert, response }) {
        assert.equal(typeof response.num_deleted, 'number')
      },
    },
    'export-documents': {
      // Guessed from the curl example: GET /collections/companies/documents/export
      async setup({ ensureCollection }) {
        await ensureCollection('companies')
      },
      // No specific check guessed: the example passes if it runs without errors.
    },
  },
}
