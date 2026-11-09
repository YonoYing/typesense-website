// Tests for the examples on docs-site/content/30.2/api/conversational-search-rag.md
//
// Each key in `snippets` is a snippet ID: the anchor of the heading above the
// example, with --2, --3 for later examples under the same heading. Examples
// run top to bottom against a fresh Typesense server, once per language.
// See snippet-tests/README.md for everything a test can do.

module.exports = {
  snippets: {
    'create-a-conversation-history-collection': {
      // Guessed from the curl example: POST /collections
      async setup({ dropCollection }) {
        await dropCollection('conversation_store')
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/conversation_store')
        for (const field of ['conversation_id', 'model_id', 'timestamp', 'role', 'message']) {
          assert.ok(collection.fields.some(f => f.name === field), `missing field ${field}`)
        }
      },
    },
    'create-a-conversation-model': {
      skip: 'needs an OpenAI (or other LLM provider) API key',
      // Guessed from the curl example: POST /conversations/models
      // No specific check guessed: the example passes if it runs without errors.
    },
    'start-a-conversation': {
      skip: 'needs a conversation model, which needs an LLM API key',
      // Guessed from the curl example: POST /multi_search?q&conversation&conversation_model_id
      async setup({ ensureCollection }) {
        await ensureCollection('tv_shows')
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.results), 'expected one result per search')
      },
    },
    'streaming-conversations': {
      skip: 'needs a conversation model, which needs an LLM API key',
      // Guessed from the curl example: POST /multi_search?q&conversation&conversation_model_id&conversation_stream
      async setup({ ensureCollection }) {
        await ensureCollection('tv_shows')
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.results), 'expected one result per search')
      },
    },
    'streaming-conversations--2': {
      // No API call recognised. The example only has to run without errors.
    },
    'streaming-conversations--3': {
      // No API call recognised. The example only has to run without errors.
    },
    'follow-up-questions': {
      skip: 'needs a conversation model, which needs an LLM API key',
      // Guessed from the curl example: POST /multi_search?q&conversation&conversation_model_id&conversation_id
      async setup({ ensureCollection }) {
        await ensureCollection('tv_shows')
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.results), 'expected one result per search')
      },
    },
    'retrieve-all-models': {
      // Guessed from the curl example: GET /conversations/models
      // No specific check guessed: the example passes if it runs without errors.
    },
    'retrieve-a-single-model': {
      skip: 'needs a conversation model, which needs an LLM API key',
      // Guessed from the curl example: GET /conversations/models/conv-model-1
      // No specific check guessed: the example passes if it runs without errors.
    },
    'update-a-model': {
      skip: 'needs a conversation model, which needs an LLM API key',
      // Guessed from the curl example: PUT /conversations/models/conv-model-1
      async verify({ expectExists }) {
        await expectExists('/conversations/models/conv-model-1')
      },
    },
    'delete-a-model': {
      skip: 'needs a conversation model, which needs an LLM API key',
      // Guessed from the curl example: DELETE /conversations/models/conv-model-1
      async verify({ expectGone }) {
        await expectGone('/conversations/models/conv-model-1')
      },
    },
  },
}
