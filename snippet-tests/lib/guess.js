'use strict'

// Writes a first-guess test for a snippet group.
//
// It works out which API calls the example makes (from its curl version, or
// its JavaScript version when there is no curl), then guesses:
//   setup():  the state the call needs, e.g. the collection or document it
//             touches, so the example does not depend on earlier ones;
//   verify(): what should be true afterwards, e.g. a deleted document is gone.
//
// The output is ordinary test code meant to be read and tightened by a person.

const { parseJsonValues } = require('./json-stream')

const HOST_VARS = /\$\{?TYPESENSE_HOST\}?/g
const KEY_VARS = /\$\{?TYPESENSE_API_KEY\}?/g
const LOCAL_URL = 'http://localhost:8108'

// ---------------------------------------------------------------------------
// Shell parsing

// Splits a shell script into commands, each a list of tokens, honouring
// quotes and line continuations. Good enough for docs examples, not a shell.
function shellCommands(code) {
  // Like bash, a backslash-newline is removed entirely, inside quotes too.
  const src = code.replace(/\\\r?\n/g, '')
  const commands = []
  let tokens = []
  let token = null
  let i = 0
  const push = () => {
    if (token !== null) tokens.push(token)
    token = null
  }
  const endCommand = () => {
    push()
    if (tokens.length) commands.push(tokens)
    tokens = []
  }
  const expand = s => s.replace(HOST_VARS, LOCAL_URL).replace(KEY_VARS, 'xyz')
  while (i < src.length) {
    const c = src[i]
    if (c === "'") {
      const end = src.indexOf("'", i + 1)
      const stop = end === -1 ? src.length : end
      token = (token || '') + src.slice(i + 1, stop)
      i = stop + 1
    } else if (c === '"') {
      let j = i + 1
      let s = ''
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < src.length) {
          s += src[j + 1]
          j += 2
        } else {
          s += src[j++]
        }
      }
      token = (token || '') + expand(s)
      i = j + 1
    } else if (c === '#' && token === null) {
      while (i < src.length && src[i] !== '\n') i++
    } else if (c === '\n' || c === ';' || c === '|' || c === '&') {
      endCommand()
      i++
    } else if (/\s/.test(c)) {
      push()
      i++
    } else {
      let j = i
      while (j < src.length && !/[\s'";|&]/.test(src[j])) j++
      token = (token || '') + expand(src.slice(i, j))
      i = j
    }
  }
  endCommand()
  return commands
}

function tryJson(text) {
  if (typeof text !== 'string') return undefined
  try {
    return JSON.parse(text)
  } catch (_) {
    return undefined
  }
}

function opFromUrl(method, url, data) {
  let parsed
  try {
    parsed = new URL(url)
  } catch (_) {
    return null
  }
  const op = {
    method,
    path: decodeURIComponent(parsed.pathname).replace(/\/+$/, '') || '/',
    query: Object.fromEntries(parsed.searchParams),
    body: undefined,
    file: null,
  }
  if (data !== undefined) {
    if (data.startsWith('@')) op.file = data.slice(1)
    else {
      op.body = tryJson(data)
      // JSON Lines bodies (imports): keep the documents for their IDs.
      if (op.body === undefined) {
        const docs = parseJsonValues(data)
        if (docs.length > 1) op.body = docs
      }
    }
  }
  return op
}

function opsFromShell(code) {
  const ops = []
  for (const tokens of shellCommands(code)) {
    if (tokens[0] !== 'curl') continue
    let method = null
    let url = null
    let data
    let get = false
    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i]
      if (t === '-G' || t === '--get') get = true
      else if (t === '-X' || t === '--request') method = tokens[++i]
      else if (/^-X[A-Z]+$/.test(t)) method = t.slice(2)
      else if (['-d', '--data', '--data-raw', '--data-binary', '--data-urlencode', '--json'].includes(t)) data = tokens[++i]
      else if (['-H', '--header', '-o', '--output', '-u', '--user', '-w', '--write-out'].includes(t)) i++
      else if (/^https?:\/\//.test(t)) url = t
    }
    if (!url) continue
    if (get) data = undefined // -G sends the data as query parameters
    const op = opFromUrl((method || (data !== undefined ? 'POST' : 'GET')).toUpperCase(), url, data)
    if (op) ops.push(op)
  }
  return ops
}

// ---------------------------------------------------------------------------
// JavaScript parsing (fallback when an example has no curl version)

const STR = `['"\`]([^'"\`]+)['"\`]`

function opsFromJs(code) {
  const found = []
  const add = (re, make) => {
    const g = new RegExp(re, 'g')
    let m
    while ((m = g.exec(code))) {
      const op = make(m)
      if (op) found.push({ index: m.index, op: { query: {}, body: undefined, file: null, ...op } })
    }
  }
  const nameIn = () => {
    const m = code.match(new RegExp(`['"]?name['"]?\\s*:\\s*${STR}`))
    return m && m[1]
  }
  const idIn = () => {
    const m = code.match(new RegExp(`['"]?id['"]?\\s*:\\s*${STR}`))
    return m && m[1]
  }
  add(`client\\.collections\\(\\s*\\)\\.create\\(`, () => ({ method: 'POST', path: '/collections', body: { name: nameIn() } }))
  add(`client\\.collections\\(\\s*\\)\\.retrieve\\(`, () => ({ method: 'GET', path: '/collections' }))
  add(`client\\.collections\\(\\s*${STR}\\s*\\)\\.(retrieve|delete|update)\\(`, m => ({
    method: { retrieve: 'GET', delete: 'DELETE', update: 'PATCH' }[m[2]],
    path: `/collections/${m[1]}`,
  }))
  add(`client\\.collections\\(\\s*${STR}\\s*\\)\\.documents\\(\\s*\\)\\.(create|upsert|import|search|update|delete|export)\\(`, m => {
    const base = `/collections/${m[1]}/documents`
    switch (m[2]) {
      case 'create':
      case 'upsert':
        return { method: 'POST', path: base, body: idIn() ? { id: idIn() } : undefined }
      case 'import':
        return { method: 'POST', path: `${base}/import` }
      case 'search':
        return { method: 'GET', path: `${base}/search` }
      case 'update':
        return { method: 'PATCH', path: base, query: { filter_by: '?' } }
      case 'delete':
        return { method: 'DELETE', path: base, query: { filter_by: '?' } }
      default:
        return { method: 'GET', path: `${base}/export` }
    }
  })
  add(`client\\.collections\\(\\s*${STR}\\s*\\)\\.documents\\(\\s*${STR}\\s*\\)\\.(retrieve|update|delete)\\(`, m => ({
    method: { retrieve: 'GET', update: 'PATCH', delete: 'DELETE' }[m[3]],
    path: `/collections/${m[1]}/documents/${m[2]}`,
  }))
  add(`client\\.multiSearch\\.perform\\(`, () => {
    const collections = [...code.matchAll(new RegExp(`collection['"]?\\s*:\\s*${STR}`, 'g'))].map(m => m[1])
    return { method: 'POST', path: '/multi_search', body: { searches: collections.map(collection => ({ collection })) } }
  })
  add(`client\\.aliases\\(\\s*\\)\\.upsert\\(\\s*${STR}`, m => {
    const target = code.match(new RegExp(`collection_name['"]?\\s*:\\s*${STR}`))
    return { method: 'PUT', path: `/aliases/${m[1]}`, body: target ? { collection_name: target[1] } : undefined }
  })
  add(`client\\.aliases\\(\\s*\\)\\.retrieve\\(`, () => ({ method: 'GET', path: '/aliases' }))
  add(`client\\.keys\\(\\s*\\)\\.create\\(`, () => ({ method: 'POST', path: '/keys' }))
  add(`client\\.keys\\(\\s*\\)\\.retrieve\\(`, () => ({ method: 'GET', path: '/keys' }))
  const files = [...code.matchAll(new RegExp(`readFile(?:Sync)?\\(\\s*${STR}`, 'g'))].map(m => m[1])
  const ops = found.sort((a, b) => a.index - b.index).map(f => f.op)
  if (files.length && ops.length) ops[ops.length - 1].file = files[0]
  const action = code.match(new RegExp(`action['"]?\\s*:\\s*${STR}`))
  for (const op of ops) {
    if (op.path.endsWith('/import')) {
      op.body = [...code.matchAll(new RegExp(`['"]?id['"]?\\s*:\\s*${STR}`, 'g'))].map(m => ({ id: m[1] }))
      if (action) op.query = { action: action[1] }
    }
  }
  return ops
}

// ---------------------------------------------------------------------------
// Guessing

const q = s => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
function literal(v) {
  if (Array.isArray(v)) return `[${v.map(literal).join(', ')}]`
  if (v && typeof v === 'object') {
    const props = Object.entries(v).map(([k, x]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : q(k)}: ${literal(x)}`)
    return props.length ? `{ ${props.join(', ')} }` : '{}'
  }
  if (typeof v === 'string') return q(v)
  return JSON.stringify(v)
}
const isPlain = s => typeof s === 'string' && s.length > 0 && !/[$`{}<>?*]/.test(s)

function segments(path) {
  return path
    .split('/')
    .map(s => s.trim())
    .filter(Boolean)
}

// Keys in request bodies that name a collection the request needs.
const COLLECTION_KEYS = new Set(['collection', 'collection_name', 'source_collection', 'destination_collection'])

function bodyCollections(value, out = []) {
  if (Array.isArray(value)) value.forEach(v => bodyCollections(v, out))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (COLLECTION_KEYS.has(k) && typeof v === 'string') out.push(v)
      else if (COLLECTION_KEYS.has(k) && Array.isArray(v)) out.push(...v.filter(x => typeof x === 'string'))
      else bodyCollections(v, out)
    }
  }
  return out
}

function collectionsTouched(op) {
  const seg = segments(op.path)
  const out = []
  if (seg[0] === 'collections' && seg[1]) out.push(seg[1])
  if (op.query && op.query.src_name) out.push(op.query.src_name)
  if (op.body && typeof op.body === 'object' && !(seg[0] === 'collections' && seg[2] === 'documents')) {
    out.push(...bodyCollections(op.body))
  }
  return [...new Set(out)].filter(isPlain)
}

function documentIds(body) {
  const docs = Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : []
  return docs.map(d => d && d.id).filter(id => isPlain(typeof id === 'number' ? String(id) : id)).map(String)
}

function sampleResponseKeys(group) {
  for (const block of group.responses) {
    const values = parseJsonValues(block.code)
    if (values.length === 1 && values[0] && typeof values[0] === 'object' && !Array.isArray(values[0])) {
      return Object.keys(values[0]).slice(0, 8)
    }
  }
  return null
}

function guessFromOps(ops, group) {
  const setup = []
  const verify = []
  const created = new Set()
  const ensured = new Set()
  const files = new Set()

  const ensureCollection = c => {
    if (created.has(c) || ensured.has(c)) return
    ensured.add(c)
    setup.push(`await ensureCollection(${q(c)})`)
  }

  for (const op of ops) {
    const seg = segments(op.path)
    if (op.method === 'POST' && op.path === '/collections' && op.body && isPlain(op.body.name)) {
      if (op.query.src_name && isPlain(op.query.src_name)) ensureCollection(op.query.src_name)
      if (!created.has(op.body.name)) setup.push(`await dropCollection(${q(op.body.name)})`)
      created.add(op.body.name)
      continue
    }
    const docId = seg[0] === 'collections' && seg[2] === 'documents' && seg[3] && !['search', 'import', 'export'].includes(seg[3]) && seg[3]
    if (docId && isPlain(seg[1]) && isPlain(docId) && op.method !== 'POST' && !created.has(seg[1])) {
      if (!ensured.has(`${seg[1]}/${docId}`)) setup.push(`await ensureDocument(${q(seg[1])}, ${q(docId)})`)
      ensured.add(`${seg[1]}/${docId}`)
      ensured.add(seg[1])
    } else {
      collectionsTouched(op).forEach(ensureCollection)
    }
    // Creating documents with fixed IDs: make sure those IDs are free (the
    // default action is "create", which fails on an existing ID). Updating:
    // make sure they exist.
    const isDocWrite = seg[0] === 'collections' && seg[2] === 'documents' && op.method === 'POST' && (!seg[3] || seg[3] === 'import')
    if (isDocWrite && isPlain(seg[1]) && !created.has(seg[1])) {
      const action = (op.query && op.query.action) || 'create'
      for (const id of documentIds(op.body)) {
        if (action === 'create') setup.push(`await dropDocument(${q(seg[1])}, ${q(id)})`)
        if (action === 'update') setup.push(`await ensureDocument(${q(seg[1])}, ${q(id)})`)
      }
    }
    if (op.file && isPlain(op.file) && !files.has(op.file)) {
      files.add(op.file)
      const target = isPlain(seg[1]) ? seg[1] : null
      setup.push(
        target === 'companies'
          ? `writeFile(${q(op.file)}, toJsonl(fixtures.companies.documents))`
          : `writeFile(${q(op.file)}, toJsonl([{ id: '1' }]))`,
      )
    }
  }

  const op = ops[ops.length - 1]
  const seg = segments(op.path)
  const c = isPlain(seg[1]) ? seg[1] : null
  const enc = s => s.replace(/'/g, "\\'")
  const summary = `${op.method} ${op.path}${Object.keys(op.query || {}).length ? `?${Object.keys(op.query).join('&')}` : ''}`

  if (seg[0] === 'collections' && seg.length === 1) {
    if (op.method === 'POST' && op.body && isPlain(op.body.name)) {
      const fields = (op.body.fields || []).map(f => f && f.name).filter(n => isPlain(n) && !/[.*]/.test(n)).slice(0, 6)
      verify.push(`${fields.length ? 'const collection = ' : ''}await expectExists('/collections/${enc(op.body.name)}')`)
      if (fields.length) {
        verify.push(`for (const field of ${literal(fields)}) {`)
        verify.push(`  assert.ok(collection.fields.some(f => f.name === field), \`missing field \${field}\`)`)
        verify.push(`}`)
      }
    } else if (op.method === 'GET') {
      verify.push(`assert.ok(Array.isArray(response), 'expected a list of collections')`)
    }
  } else if (seg[0] === 'collections' && seg.length === 2 && c) {
    if (op.method === 'GET') verify.push(`assert.equal(response.name, ${q(c)})`)
    if (op.method === 'DELETE') verify.push(`await expectGone('/collections/${enc(c)}')`)
    if (op.method === 'PATCH') {
      const added = ((op.body && op.body.fields) || []).filter(f => f && !f.drop && isPlain(f.name)).map(f => f.name)
      const dropped = ((op.body && op.body.fields) || []).filter(f => f && f.drop && isPlain(f.name)).map(f => f.name)
      verify.push(`${added.length || dropped.length ? 'const collection = ' : ''}await expectExists('/collections/${enc(c)}')`)
      for (const f of added) verify.push(`assert.ok(collection.fields.some(f => f.name === ${q(f)}), 'field ${enc(f)} should exist')`)
      for (const f of dropped.filter(f => !added.includes(f))) verify.push(`assert.ok(!collection.fields.some(f => f.name === ${q(f)}), 'field ${enc(f)} should be dropped')`)
    }
  } else if (seg[0] === 'collections' && seg[2] === 'documents' && c) {
    const sub = seg[3]
    const base = `/collections/${enc(c)}/documents`
    if (!sub && op.method === 'POST') {
      const id = op.body && op.body.id
      if (isPlain(id)) verify.push(`await expectExists('${base}/${enc(String(id))}')`)
      else {
        verify.push(`const collection = await expectExists('/collections/${enc(c)}')`)
        verify.push(`assert.ok(collection.num_documents > 0, 'expected the collection to have documents')`)
      }
    } else if (sub === 'import') {
      verify.push(`const collection = await expectExists('/collections/${enc(c)}')`)
      verify.push(`assert.ok(collection.num_documents > 0, 'expected documents to be imported')`)
    } else if (sub === 'search') {
      verify.push(`assert.ok(Array.isArray(response.hits), 'expected search hits')`)
      verify.push(`assert.equal(typeof response.found, 'number')`)
    } else if (sub === 'export') {
      // An export has no single response shape across clients; running is enough.
    } else if (!sub && op.method === 'PATCH') {
      verify.push(`assert.equal(typeof response.num_updated, 'number')`)
    } else if (!sub && op.method === 'DELETE') {
      verify.push(`assert.equal(typeof response.num_deleted, 'number')`)
    } else if (sub && op.method === 'GET') {
      verify.push(`assert.equal(response.id, ${q(sub)})`)
    } else if (sub && op.method === 'DELETE') {
      verify.push(`await expectGone('${base}/${enc(sub)}')`)
    } else if (sub && op.method === 'PATCH') {
      verify.push(`const doc = await expectExists('${base}/${enc(sub)}')`)
      const body = op.body && typeof op.body === 'object' && !Array.isArray(op.body) ? op.body : {}
      for (const [k, v] of Object.entries(body).slice(0, 4)) {
        if (k !== 'id' && !/[.]/.test(k)) verify.push(`assert.deepEqual(doc[${q(k)}], ${literal(v)})`)
      }
    }
  } else if (op.path === '/multi_search') {
    if (op.body && op.body.union) verify.push(`assert.ok(Array.isArray(response.hits), 'expected union search hits')`)
    else verify.push(`assert.ok(Array.isArray(response.results), 'expected one result per search')`)
  } else if (seg[0] === 'aliases') {
    if (op.method === 'PUT' && seg[1] && op.body && op.body.collection_name) {
      verify.push(`const alias = await expectExists('/aliases/${enc(seg[1])}')`)
      verify.push(`assert.equal(alias.collection_name, ${q(op.body.collection_name)})`)
    } else if (op.method === 'GET' && !seg[1]) {
      verify.push(`assert.ok(Array.isArray(response.aliases), 'expected a list of aliases')`)
    } else if (op.method === 'DELETE' && seg[1]) {
      verify.push(`await expectGone('/aliases/${enc(seg[1])}')`)
    }
  } else if (seg[0] === 'keys') {
    if (op.method === 'POST') verify.push(`assert.equal(typeof response.value, 'string', 'expected the new key value')`)
    if (op.method === 'GET' && !seg[1]) verify.push(`assert.ok(Array.isArray(response.keys), 'expected a list of keys')`)
  } else if (seg[0] === 'health') {
    verify.push(`assert.equal(response.ok, true)`)
  } else if (seg[0] === 'operations' && op.method === 'POST') {
    verify.push(`assert.equal(response.success, true)`)
  } else if (op.method === 'PUT' && seg.length >= 2) {
    verify.push(`await expectExists('${enc(op.path)}')`)
  } else if (op.method === 'DELETE' && seg.length >= 2) {
    verify.push(`await expectGone('${enc(op.path)}')`)
  }

  // Compare against the documented sample response, when there is one and the
  // example makes a single call that returns it.
  const keys = sampleResponseKeys(group)
  const singleShape = op.path !== '/multi_search' && !op.path.endsWith('/import') && !op.path.endsWith('/export')
  if (keys && keys.length && ops.length === 1 && singleShape && ['GET', 'POST', 'PUT'].includes(op.method)) {
    verify.push(`expectKeys(response, ${literal(keys)})`)
  }

  return { summary, setup, verify }
}

const HELPER_NAMES = [
  'assert', 'response', 'responses', 'output', 'client', 'api', 'fixtures', 'expectKeys', 'expectExists',
  'expectGone', 'ensureCollection', 'ensureDocument', 'dropCollection', 'dropDocument', 'createCollection', 'importDocuments',
  'writeFile', 'toJsonl',
]

function usedNames(lines) {
  const text = lines.join('\n')
  return HELPER_NAMES.filter(n => new RegExp(`(^|[^.\\w])${n}\\b`).test(text))
}

function guess(group) {
  const shell = group.blocks.find(b => b.lang === 'shell')
  const js = group.blocks.find(b => b.lang === 'js')
  let ops = shell ? opsFromShell(shell.code) : []
  let source = 'curl'
  if (!ops.length && js) {
    ops = opsFromJs(js.code)
    source = 'JavaScript'
  }
  if (!ops.length) return { summary: null, source: null, setup: [], verify: [] }
  return { ...guessFromOps(ops, group), source }
}

function renderFn(name, lines, indent) {
  if (!lines.length) return []
  const names = usedNames(lines)
  const pad = ' '.repeat(indent)
  return [
    `${pad}async ${name}({ ${names.join(', ')} }) {`,
    ...lines.map(l => `${pad}  ${l}`),
    `${pad}},`,
  ]
}

// Renders one entry of a test file's `snippets` object.
function renderEntry(group, { todo = false, indent = 4 } = {}) {
  const g = guess(group)
  const pad = ' '.repeat(indent)
  const inner = indent + 2
  const lines = [`${pad}${q(group.id)}: {`]
  if (todo) {
    lines.push(`${' '.repeat(inner)}todo: 'Check that this guessed test proves the example works, then delete this line.',`)
  }
  if (g.summary) {
    lines.push(`${' '.repeat(inner)}// Guessed from the ${g.source} example: ${g.summary}`)
  } else {
    lines.push(`${' '.repeat(inner)}// No API call recognised. The example only has to run without errors.`)
  }
  lines.push(...renderFn('setup', g.setup, inner))
  lines.push(...renderFn('verify', g.verify, inner))
  if (g.summary && !g.verify.length) {
    lines.push(`${' '.repeat(inner)}// No specific check guessed: the example passes if it runs without errors.`)
  }
  lines.push(`${pad}},`)
  return lines.join('\n')
}

module.exports = { guess, renderEntry, opsFromShell, opsFromJs, shellCommands }
