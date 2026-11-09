'use strict'

// Helpers handed to every test as part of its context object.

const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { API_KEY, PORT } = require('./config')
const fixtures = require('./fixtures')

function createApi() {
  async function request(method, urlPath, body) {
    const headers = { 'X-TYPESENSE-API-KEY': API_KEY }
    let payload
    if (body !== undefined) {
      if (typeof body === 'string') {
        payload = body
        headers['Content-Type'] = 'text/plain'
      } else {
        payload = JSON.stringify(body)
        headers['Content-Type'] = 'application/json'
      }
    }
    const res = await fetch(`http://localhost:${PORT}${urlPath}`, { method, headers, body: payload })
    const text = await res.text()
    let json
    try {
      json = JSON.parse(text)
    } catch (_) {
      json = undefined
    }
    return { status: res.status, ok: res.ok, body: json === undefined ? text : json }
  }
  return {
    request,
    get: p => request('GET', p),
    delete: p => request('DELETE', p),
    post: (p, b) => request('POST', p, b),
    put: (p, b) => request('PUT', p, b),
    patch: (p, b) => request('PATCH', p, b),
  }
}

function createHelpers({ api, cwd }) {
  const helpers = {
    assert,

    // Fails unless `obj` has every listed key.
    expectKeys(obj, keys) {
      assert.ok(obj && typeof obj === 'object', `expected an object, got ${JSON.stringify(obj)}`)
      const missing = keys.filter(k => !(k in obj))
      assert.deepEqual(missing, [], `response is missing keys: ${missing.join(', ')}`)
    },

    // Fails unless GET <path> returns 2xx. Returns the parsed body.
    async expectExists(urlPath) {
      const res = await api.get(urlPath)
      assert.ok(res.ok, `expected GET ${urlPath} to succeed, got HTTP ${res.status}: ${JSON.stringify(res.body)}`)
      return res.body
    },

    // Fails unless GET <path> returns 404.
    async expectGone(urlPath) {
      const res = await api.get(urlPath)
      assert.equal(res.status, 404, `expected GET ${urlPath} to be 404, got HTTP ${res.status}`)
    },

    // Drops (if present) and creates a collection.
    async createCollection(schema) {
      await api.delete(`/collections/${encodeURIComponent(schema.name)}`)
      const res = await api.post('/collections', schema)
      assert.ok(res.ok, `could not create collection ${schema.name}: ${JSON.stringify(res.body)}`)
      return res.body
    },

    // Drops a collection if it exists.
    async dropCollection(name) {
      await api.delete(`/collections/${encodeURIComponent(name)}`)
    },

    // Deletes a document if it exists.
    async dropDocument(collection, id) {
      await api.delete(`/collections/${encodeURIComponent(collection)}/documents/${encodeURIComponent(id)}`)
    },

    // Creates a collection only if it is missing, so state built up by earlier
    // examples on the page is kept. Known fixture names (e.g. "companies") get
    // their real schema and sample documents; anything else gets auto-schema.
    async ensureCollection(name, schema) {
      const existing = await api.get(`/collections/${encodeURIComponent(name)}`)
      if (existing.ok) return existing.body
      const fixture = fixtures[name]
      const res = await api.post('/collections', schema || (fixture ? fixture.schema : fixtures.autoSchema(name)))
      assert.ok(res.ok, `could not create collection ${name}: ${JSON.stringify(res.body)}`)
      if (!schema && fixture && fixture.documents) await this.importDocuments(name, fixture.documents)
      return res.body
    },

    // Makes sure a document with this ID exists, creating the collection too
    // if needed. Uses the fixture document with that ID when there is one.
    async ensureDocument(collection, id, doc) {
      await this.ensureCollection(collection)
      const docPath = `/collections/${encodeURIComponent(collection)}/documents/${encodeURIComponent(id)}`
      const existing = await api.get(docPath)
      if (existing.ok) return existing.body
      const fixture = fixtures[collection]
      const fallback =
        (fixture && fixture.documents && (fixture.documents.find(d => d.id === id) || { ...fixture.documents[0], id })) ||
        { id }
      await this.importDocuments(collection, [doc || fallback])
      return (await api.get(docPath)).body
    },

    // Imports documents (array of objects) into a collection.
    async importDocuments(collection, docs, action = 'upsert') {
      const jsonl = docs.map(d => JSON.stringify(d)).join('\n')
      const res = await api.post(
        `/collections/${encodeURIComponent(collection)}/documents/import?action=${action}`,
        jsonl,
      )
      assert.ok(res.ok, `import into ${collection} failed: ${JSON.stringify(res.body)}`)
      const text = typeof res.body === 'string' ? res.body : JSON.stringify(res.body)
      const failures = text.split('\n').filter(l => l.includes('"success":false'))
      assert.deepEqual(failures, [], `some documents failed to import into ${collection}: ${failures[0]}`)
    },

    // Writes a file into the page's working directory, for examples that read
    // local files such as documents.jsonl.
    writeFile(name, content) {
      const full = path.join(cwd, name)
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content))
      return full
    },

    toJsonl(docs) {
      return docs.map(d => JSON.stringify(d)).join('\n')
    },
  }
  // Bind so tests can destructure helpers: async setup({ ensureCollection }) {...}
  for (const [name, fn] of Object.entries(helpers)) {
    if (typeof fn === 'function' && name !== 'assert') helpers[name] = fn.bind(helpers)
  }
  return helpers
}

module.exports = { createApi, createHelpers }
