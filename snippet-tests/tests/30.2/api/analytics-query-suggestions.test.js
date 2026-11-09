// Tests for the examples on docs-site/content/30.2/api/analytics-query-suggestions.md
//
// Each key in `snippets` is a snippet ID: the anchor of the heading above the
// example, with --2, --3 for later examples under the same heading. Examples
// run top to bottom against a fresh Typesense server, once per language.
// See snippet-tests/README.md for everything a test can do.

const RULES = {
  product_queries_aggregation: {
    name: 'product_queries_aggregation',
    type: 'popular_queries',
    collection: 'products',
    event_type: 'search',
    params: { destination_collection: 'product_queries', limit: 1000 },
  },
  product_clicks: {
    name: 'product_clicks',
    type: 'counter',
    collection: 'products',
    event_type: 'click',
    params: { destination_collection: 'products', counter_field: 'popularity', weight: 1 },
  },
  products_purchases: {
    name: 'products_purchases',
    type: 'counter',
    collection: 'products',
    event_type: 'conversion',
    params: { destination_collection: 'products', counter_field: 'popularity', weight: 2 },
  },
  product_events_log: {
    name: 'product_events_log',
    type: 'log',
    collection: 'products',
    event_type: 'click',
  },
}

// Removes rules so an example can create them from scratch.
async function dropRules(api, ...names) {
  for (const name of names) await api.delete(`/analytics/rules/${name}`)
}

// Creates a rule (and the collections it needs) unless it already exists.
async function ensureRule(ctx, name) {
  const rule = RULES[name]
  await ctx.ensureCollection(rule.collection)
  if (rule.params && rule.params.destination_collection) await ctx.ensureCollection(rule.params.destination_collection)
  const existing = await ctx.api.get(`/analytics/rules/${name}`)
  if (existing.ok) return
  const res = await ctx.api.post('/analytics/rules', rule)
  if (!res.ok) throw new Error(`could not create rule ${name}: ${JSON.stringify(res.body)}`)
}

async function expectRules({ expectExists }, ...names) {
  for (const name of names) await expectExists(`/analytics/rules/${name}`)
}

module.exports = {
  // Click and conversion counters write to a "popularity" field.
  async beforeAll({ createCollection }) {
    await createCollection({
      name: 'products',
      fields: [
        { name: 'product_name', type: 'string' },
        { name: 'popularity', type: 'int32', optional: true },
      ],
    })
  },

  snippets: {
    'when-self-hosting': {
      // No API call recognised. The example only has to run without errors.
    },
    'create-a-single-rule': {
      // Guessed from the curl example: POST /analytics/rules
      async setup({ api, ensureCollection }) {
        await dropRules(api, 'homepage_popular_queries')
        await ensureCollection('products')
        await ensureCollection('product_queries')
      },
      async verify(ctx) {
        await expectRules(ctx, 'homepage_popular_queries')
      },
    },
    'create-multiple-rules-array': {
      // Guessed from the curl example: POST /analytics/rules
      async setup({ api, ensureCollection }) {
        await dropRules(api, 'homepage_popular_queries', 'homepage_nohits_queries')
        await ensureCollection('products')
        await ensureCollection('product_queries')
        await ensureCollection('no_hits_queries')
      },
      async verify(ctx) {
        await expectRules(ctx, 'homepage_popular_queries', 'homepage_nohits_queries')
      },
    },
    'create-a-collection-for-queries': {
      // Guessed from the curl example: POST /collections
      async setup({ dropCollection }) {
        await dropCollection('product_queries')
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/product_queries')
        for (const field of ['q', 'count']) {
          assert.ok(collection.fields.some(f => f.name === field), `missing field ${field}`)
        }
      },
    },
    'create-an-analytics-rule': {
      // Guessed from the curl example: POST /analytics/rules
      async setup({ api, ensureCollection }) {
        await dropRules(api, 'product_queries_aggregation')
        await ensureCollection('products')
        await ensureCollection('product_queries')
      },
      async verify(ctx) {
        await expectRules(ctx, 'product_queries_aggregation')
      },
    },
    'send-events-via-api': {
      // Guessed from the curl example: POST /analytics/rules
      async setup({ api, ensureCollection }) {
        await dropRules(api, 'product_queries_aggregation')
        await ensureCollection('products')
        await ensureCollection('product_queries')
      },
      async verify(ctx) {
        await expectRules(ctx, 'product_queries_aggregation')
      },
    },
    'send-events-via-api--2': {
      // Guessed from the curl example: POST /analytics/events
      async setup(ctx) {
        await ensureRule(ctx, 'product_queries_aggregation')
      },
      async verify({ assert, response }) {
        assert.equal(response.ok, true)
      },
    },
    'query-suggestion-ux': {
      // Guessed from the curl example: POST /multi_search
      async setup({ createCollection, importDocuments }) {
        await createCollection({
          name: 'product_queries',
          fields: [
            { name: 'q', type: 'string' },
            { name: 'count', type: 'int32' },
          ],
        })
        await importDocuments('product_queries', [{ id: '1', q: 'shoe', count: 3 }])
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.results), 'expected one result per search')
      },
    },
    'using-meta-fields-in-search': {
      // Guessed from the curl example: GET /collections/hnstories/documents/search?q&query_by&filter_by&analytics_tag
      async setup({ createCollection, importDocuments }) {
        await createCollection({
          name: 'hnstories',
          fields: [
            { name: 'title', type: 'string' },
            { name: 'points', type: 'int32' },
          ],
        })
        await importDocuments('hnstories', [{ id: '1', title: 'Iron Man suits', points: 120 }])
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.hits), 'expected search hits')
        assert.equal(response.found, 1)
      },
    },
    'create-a-collection-for-queries-1': {
      // Guessed from the curl example: POST /collections
      async setup({ dropCollection }) {
        await dropCollection('no_hits_queries')
      },
      async verify({ assert, expectExists }) {
        const collection = await expectExists('/collections/no_hits_queries')
        for (const field of ['q', 'count']) {
          assert.ok(collection.fields.some(f => f.name === field), `missing field ${field}`)
        }
      },
    },
    'create-an-analytics-rule-1': {
      // Guessed from the curl example: POST /analytics/rules
      async setup({ api, ensureCollection }) {
        await dropRules(api, 'product_no_hits')
        await ensureCollection('products')
        await ensureCollection('no_hits_queries')
      },
      async verify(ctx) {
        await expectRules(ctx, 'product_no_hits')
      },
    },
    'create-an-analytics-rule-2': {
      // Guessed from the curl example: POST /analytics/rules
      async setup({ api, ensureCollection }) {
        await dropRules(api, 'product_clicks')
        await ensureCollection('products')
      },
      async verify(ctx) {
        await expectRules(ctx, 'product_clicks')
      },
    },
    'sending-click-events': {
      // Guessed from the curl example: POST /analytics/events
      async setup(ctx) {
        await ensureRule(ctx, 'product_clicks')
      },
      async verify({ assert, response }) {
        assert.equal(response.ok, true)
      },
    },
    'aggregating-multiple-events': {
      // Guessed from the curl example: POST /analytics/rules
      async setup({ api, ensureCollection }) {
        await dropRules(api, 'product_clicks', 'products_purchases')
        await ensureCollection('products')
      },
      async verify(ctx) {
        await expectRules(ctx, 'product_clicks', 'products_purchases')
      },
    },
    'aggregating-multiple-events--2': {
      // Guessed from the curl example: POST /analytics/events
      async setup(ctx) {
        await ensureRule(ctx, 'products_purchases')
      },
      async verify({ assert, response }) {
        assert.equal(response.ok, true)
      },
    },
    'aggregating-multiple-events--3': {
      // Guessed from the curl example: POST /analytics/events
      async setup(ctx) {
        await ensureRule(ctx, 'product_clicks')
      },
      async verify({ assert, response }) {
        assert.equal(response.ok, true)
      },
    },
    'create-a-log-rule': {
      // Guessed from the curl example: POST /analytics/rules
      async setup({ api, ensureCollection }) {
        await dropRules(api, 'product_events_log')
        await ensureCollection('products')
      },
      async verify(ctx) {
        await expectRules(ctx, 'product_events_log')
      },
    },
    'sending-log-events': {
      // Guessed from the curl example: POST /analytics/events
      async setup(ctx) {
        await ensureRule(ctx, 'product_events_log')
      },
      async verify({ assert, response }) {
        assert.equal(response.ok, true)
      },
    },
    'listing-all-rules': {
      // Guessed from the curl example: GET /analytics/rules?rule_tag
      async verify({ assert, response }) {
        const rules = Array.isArray(response) ? response : response.rules
        assert.ok(Array.isArray(rules), 'expected a list of rules')
      },
    },
    'remove-a-rule': {
      // Guessed from the JavaScript example: DELETE /analytics/rules/product_queries_aggregation
      async setup(ctx) {
        await ensureRule(ctx, 'product_queries_aggregation')
      },
      async verify({ assert, api }) {
        // Typesense answers 400 "Rule not found" (not 404) for a missing rule.
        const res = await api.get('/analytics/rules/product_queries_aggregation')
        assert.ok(!res.ok && /not found/i.test(JSON.stringify(res.body)), `rule still exists: HTTP ${res.status}`)
      },
    },
    'parameters': {
      // Guessed from the curl example: GET /analytics/events?user_id&name&n
      async setup(ctx) {
        await ensureRule(ctx, 'product_queries_aggregation')
      },
      async verify({ assert, response }) {
        assert.ok(Array.isArray(response.events), 'expected a list of events')
      },
    },
  },
}
