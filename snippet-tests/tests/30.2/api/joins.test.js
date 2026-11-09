// Tests for the examples on docs-site/content/30.2/api/joins.md
//
// Each key in `snippets` is a snippet ID: the anchor of the heading above the
// example, with --2, --3 for later examples under the same heading. Examples
// run top to bottom against a fresh Typesense server, once per language.
// See snippet-tests/README.md for everything a test can do.

// The books -> authors relation the page describes.
module.exports = {
  async beforeAll({ createCollection, importDocuments }) {
    await createCollection({
      name: 'authors',
      fields: [
        { name: 'first_name', type: 'string' },
        { name: 'last_name', type: 'string' },
        // The document-retrieval example asks for $authors(name).
        { name: 'name', type: 'string' },
      ],
    })
    await importDocuments('authors', [{ id: '0', first_name: 'Enid', last_name: 'Blyton', name: 'Enid Blyton' }])
    await createCollection({
      name: 'books',
      fields: [
        { name: 'title', type: 'string' },
        { name: 'author_id', type: 'string', reference: 'authors.id' },
      ],
    })
    await importDocuments('books', [
      { id: '0', title: 'Famous Five', author_id: '0' },
      { id: '1', title: 'Secret Seven', author_id: '0' },
    ])
  },

  snippets: {
    'one-to-one-relation': {
      xfail: 'Docs bug: the search has no `query_by`, so Typesense answers "No search fields specified for the query."',
      // Guessed from the curl example: POST /multi_search
      async verify({ assert, response }) {
        const hit = response.results[0].hits[0]
        assert.equal(hit.document.title, 'Famous Five')
        assert.deepEqual(hit.document.authors, { first_name: 'Enid', last_name: 'Blyton' })
      },
    },
    'reference-fields-in-document-retrieval': {
      // Guessed from the curl example: GET /collections/books/documents/1?include_fields
      async verify({ assert, response }) {
        assert.equal(response.id, '1')
        assert.deepEqual(response.authors, { name: 'Enid Blyton' })
      },
    },
  },
}
