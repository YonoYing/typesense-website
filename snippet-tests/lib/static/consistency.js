'use strict'

// Cross-language consistency: the tabs of one example are the same request
// written in several languages, so the collection they touch, the resource
// names they use and the values they send must agree. A tab that disagrees
// with the others is wrong even though it runs (it searches the wrong
// collection, sends a misspelt parameter, swaps two ids).
//
// Also page-level checks that need more than one example: an analytics event
// must name a rule the page created, a resource must be created before an
// example reads it.

const { withoutComments } = require('./lexer')
const { editDistance } = require('./identifiers')
const { requestBodies, parseJson } = require('./shell')
const fs = require('fs')
const path = require('path')
const { DOCS_ROOT } = require('../config')

const STR = `["']([^"'\\n]+)["']`

// Every parameter name documented in the api pages of a docs version: the
// first cell of each table row, every snake_case name in backticks, and any
// key that two or more separate examples use (one example with a typo in
// every tab is still one example).
const documentedCache = new Map()
function documentedNames(version) {
  if (documentedCache.has(version)) return documentedCache.get(version)
  const names = new Set()
  const dir = path.join(DOCS_ROOT, version, 'api')
  if (fs.existsSync(dir)) {
    const { extractFromFile } = require('../extract')
    const groupsUsing = new Map()
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue
      const text = fs.readFileSync(path.join(dir, f), 'utf8')
      for (const m of text.matchAll(/^\|\s*`?([a-z][a-z0-9_]*)`?\s*\|/gm)) names.add(m[1])
      for (const m of text.matchAll(/`([a-z][a-z0-9]*_[a-z0-9_]+)`/g)) names.add(m[1])
      for (const g of extractFromFile(path.join(dir, f))) {
        const keys = new Set()
        for (const b of g.blocks) for (const m of b.code.matchAll(/["']?([a-z][a-z0-9]*_[a-z0-9_]+)["']?\s*(?:=>|:)/g)) keys.add(m[1])
        for (const k of keys) groupsUsing.set(k, (groupsUsing.get(k) || 0) + 1)
      }
    }
    for (const [k, n] of groupsUsing) if (n >= 2) names.add(k)
  }
  documentedCache.set(version, names)
  return names
}

// The schemas a page's examples run against: the ones the page's own curl
// examples create, else the shared `companies` example schema the docs use
// throughout. Map name -> Set of field names, or null when the schema takes
// any field (`.*`, `auto`, nested objects). Different pages create different
// `products` collections, so a schema from another page is never used.
function pageSchemas(groups) {
  const schemas = new Map()
  const record = schema => {
    if (!schema || typeof schema.name !== 'string' || !Array.isArray(schema.fields)) return
    const open =
      schema.enable_nested_fields ||
      !schema.fields.length ||
      schema.fields.some(f => !f || /[.*]/.test(f.name) || ['auto', 'object', 'object[]'].includes(f.type))
    const fields = open ? null : new Set(['id', ...schema.fields.map(f => f.name)])
    if (!schemas.has(schema.name)) schemas.set(schema.name, fields)
    else {
      const prev = schemas.get(schema.name)
      if (prev && fields) for (const f of fields) prev.add(f)
      else schemas.set(schema.name, null)
    }
  }
  for (const g of groups) {
    for (const b of g.blocks) {
      if (b.lang !== 'shell' || !/\/collections["'?\s]/.test(b.code)) continue
      for (const body of requestBodies(b.code)) {
        const parsed = parseJson(body.text)
        if (parsed.ok) record(parsed.value)
      }
    }
  }
  if (!schemas.has('companies')) record(require('../fixtures').companies.schema)
  return schemas
}

// Field names a block passes in include_fields, query_by, sort_by, facet_by
// or group_by, in any client's spelling.
const FIELD_PARAMS = 'include_fields|query_by|sort_by|facet_by|group_by'
function fieldRefsIn(code, lang) {
  const values = []
  for (const m of code.matchAll(new RegExp(`["']?(?:${FIELD_PARAMS})["']?\\s*(?:=>|:)\\s*(?:pointer\\.\\w+\\()?["']([^"'\\n]+)["']`, 'g'))) values.push(m[1])
  for (const m of code.matchAll(/\.(?:set)?(?:[iI]ncludeFields|[qQ]ueryBy|[sS]ortBy|[fF]acetBy|[gG]roupBy)\(\s*"([^"]+)"/g)) values.push(m[1])
  for (const m of code.matchAll(/\b(?:IncludeFields|QueryBy|SortBy|FacetBy|GroupBy):\s*pointer\.\w+\(\s*"([^"]+)"/g)) values.push(m[1])
  if (lang === 'shell') {
    for (const m of code.matchAll(new RegExp(`[?&](?:${FIELD_PARAMS})=([^&"'\\s\\\\]+)`, 'g'))) values.push(decodeURIComponent(m[1]))
    for (const m of code.matchAll(new RegExp(`--data-urlencode\\s+["'](?:${FIELD_PARAMS})=([^"']*)["']`, 'g'))) values.push(m[1])
  }
  const names = new Set()
  for (const v of values) {
    for (let part of v.split(',')) {
      part = part.trim().replace(/:(asc|desc)$/i, '')
      if (!part || /^[$_*]|[()\[\]{}<>]|\./.test(part)) continue
      names.add(part)
    }
  }
  return [...names]
}

// A snake_case key that is not documented anywhere in this docs version but
// is one or two edits away from a documented one is a typo the server ignores.
function misspeltKey(key, documented) {
  if (!documented || documented.has(key) || key.length < 6 || !key.includes('_') || !/^[a-z][a-z0-9_]*$/.test(key)) return null
  let best = null
  for (const name of documented) {
    if (Math.abs(name.length - key.length) > 3 || !name.includes('_')) continue
    const d = editDistance(name, key)
    // Two edits, or three on a long name (remote_embedding_num_try vs _tries).
    const close = d >= 1 && (d <= 2 || (d === 3 && key.length >= 15))
    if (close && (!best || d < best.d)) best = { name, d }
  }
  if (!best) return null
  return {
    rule: 'misspelt-parameter',
    message: `sends \`${key}\`, which is not a parameter Typesense knows; the documented one is \`${best.name}\` (an unknown parameter is silently ignored, so this setting has no effect)`,
    fix: best.name,
  }
}

// ---------------------------------------------------------------------------
// Facts about one block

function collectionsIn(code, lang) {
  const names = []
  const add = re => {
    for (const m of code.matchAll(re)) names.push(m[1])
  }
  if (lang === 'shell') {
    add(/\/collections\/([\w.-]+)(?=[/?"'\s\\]|$)/g)
  }
  add(new RegExp(`\\bcollections?\\(\\s*${STR}\\s*\\)`, 'g')) // js, dart, java
  add(new RegExp(`\\bcollections?\\[\\s*${STR}\\s*\\]`, 'g')) // python, php, ruby
  add(new RegExp(`\\bCollection\\(\\s*${STR}\\s*\\)`, 'g')) // go
  add(new RegExp(`\\bcollection\\(name:\\s*${STR}\\s*\\)`, 'g')) // swift
  add(new RegExp(`["']?collection["']?\\s*(?:=>|:)\\s*(?:pointer\\.\\w+\\()?${STR}`, 'g')) // search bodies
  add(new RegExp(`\\bCollection:\\s*(?:pointer\\.\\w+\\()?${STR}`, 'g')) // go structs
  add(new RegExp(`["']?(?:destination_collection|source_collection)["']?\\s*(?:=>|:)\\s*${STR}`, 'g'))
  return [...new Set(names.filter(n => !/[$*{}]/.test(n)))]
}

// The collection a "create collection" example creates: the first `name`.
function createdCollection(code, lang) {
  const isCreate =
    /\/collections["']?\s*(?:\\\n\s*)?-X\s*POST|-X\s*POST[^\n]*\/collections["']\s*$/m.test(code) ||
    /collections\(\)\.create\(|\.collections\.create\(|Collections\(\)\.Create\(|collections->create\(|collections\.create\(schema|CollectionSchema\(/.test(code) ||
    (lang === 'shell' && /\/collections["']/.test(code) && /-d\s/.test(code) && !/\/collections\/\w/.test(code))
  if (!isCreate) return null
  const m =
    code.match(new RegExp(`["']?name["']?\\s*(?:=>|:)\\s*${STR}`)) ||
    code.match(new RegExp(`\\.name\\(\\s*${STR}\\s*\\)`)) ||
    code.match(new RegExp(`\\bName:\\s*${STR}`)) ||
    code.match(new RegExp(`CollectionSchema\\(\\s*name:\\s*${STR}`))
  return m ? m[1] : null
}

// Named resources other than collections, by kind.
const RESOURCE_KINDS = {
  preset: [/\/presets\/([\w.-]+)/g, new RegExp(`\\b[pP]resets?(?:\\(\\))?(?:\\[|\\(|\\.(?:upsert|Upsert|retrieve|delete)\\(\\s*(?:context\\.Background\\(\\)\\s*,\\s*)?)\\s*${STR}`, 'g'), new RegExp(`["']?preset["']?\\s*(?:=>|:)\\s*(?:pointer\\.\\w+\\()?${STR}`, 'g'), new RegExp(`\\.preset\\(\\s*${STR}\\s*\\)`, 'g'), new RegExp(`\\bPreset:\\s*(?:pointer\\.\\w+\\()?${STR}`, 'g')],
  curation_set: [/\/curation_sets\/([\w.-]+)/g, new RegExp(`\\b(?:curationSets?|curation_sets|CurationSets?)(?:\\(\\))?(?:\\[|\\(|\\.(?:upsert|retrieve|delete)\\()\\s*${STR}`, 'g')],
  synonym_set: [/\/synonym_sets\/([\w.-]+)/g, new RegExp(`\\b(?:synonymSets?|synonym_sets|SynonymSets?)(?:\\(\\))?(?:\\[|\\(|\\.(?:upsert|retrieve|delete)\\()\\s*${STR}`, 'g')],
  alias: [/\/aliases\/([\w.-]+)/g, new RegExp(`\\baliases(?:\\(\\))?(?:\\[|\\(|\\.(?:upsert|retrieve|delete)\\()\\s*${STR}`, 'g'), new RegExp(`\\bAliases?\\(\\)\\.\\w+\\(\\s*context\\.Background\\(\\)\\s*,\\s*${STR}`, 'g')],
  stopwords: [/\/stopwords\/([\w.-]+)/g, new RegExp(`\\bstopwords(?:\\(\\))?(?:\\[|\\()\\s*${STR}`, 'g')],
  item: [/\/items\/([\w.-]+)/g, new RegExp(`\\.items?\\(\\s*${STR}\\s*\\)`, 'g'), new RegExp(`\\bitems\\[\\s*${STR}\\s*\\]`, 'g'), new RegExp(`\\.(?:upsert|get|delete)_item\\(\\s*${STR}`, 'g'), new RegExp(`getItems\\(\\)\\[\\s*${STR}\\s*\\]`, 'g')],
}

function resourcesIn(code) {
  const out = {}
  for (const [kind, res] of Object.entries(RESOURCE_KINDS)) {
    const names = new Set()
    for (const re of res) for (const m of code.matchAll(re)) if (!/[$*{}]/.test(m[1])) names.add(m[1])
    if (names.size) out[kind] = [...names]
  }
  return out
}

// Key/value pairs from literal maps, builders and JSON bodies.
const VALUE = `(?:["']([^"'\\n]*)["']|(-?\\d+(?:\\.\\d+)?)|(true|false|True|False|null|nil|None))`
function pairsIn(code, lang) {
  const pairs = new Map() // key -> [values in order]
  const push = (k, v) => {
    const key = k.replace(/^["']|["']$/g, '')
    if (!pairs.has(key)) pairs.set(key, [])
    pairs.get(key).push(normalise(v))
  }
  const normalise = v => {
    if (v === undefined || v === null) return null
    const s = String(v)
    if (/^(true|True)$/.test(s)) return 'true'
    if (/^(false|False)$/.test(s)) return 'false'
    if (/^(null|nil|None)$/.test(s)) return 'null'
    if (/^-?\d+(\.\d+)?$/.test(s)) return String(Number(s))
    // Spacing inside a value and the order of a comma-separated list are
    // presentation, not meaning (query_by weights aside).
    const parts = s.split(',').map(p => p.trim()).filter(Boolean)
    return parts.length > 1 && !/[()\[\]]/.test(s) ? parts.sort().join(',') : s.replace(/\s+/g, '')
  }
  // "key": value  /  'key' => value  /  key: value
  const re1 = new RegExp(`(?:^|[,{\\s])(["']?[A-Za-z_][\\w.-]*["']?)\\s*(?:=>|:)\\s*(?:pointer\\.\\w+\\()?${VALUE}`, 'gm')
  for (const m of code.matchAll(re1)) {
    const key = m[1]
    // Skip "http: //" style false positives and Go struct field types.
    if (/^["']?https?["']?$/.test(key)) continue
    push(key, m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4])
  }
  // "key": ["a", "b"]  /  'key' => ['a', 'b']  -> key: "a,b"  (flat lists of
  // strings only; a list of objects is compared through its own keys)
  for (const m of code.matchAll(/(?:^|[,{\s])(["']?[A-Za-z_][\w.-]*["']?)\s*(?:=>|:)\s*\[([^\]{}[]*)\]/gm)) {
    if (/=>|:/.test(m[2])) continue
    const items = [...m[2].matchAll(/["']([^"']+)["']/g)].map(x => x[1])
    if (items.length) push(m[1], items.sort().join(','))
  }
  if (lang === 'java') {
    for (const m of code.matchAll(new RegExp(`\\.put\\(\\s*${STR}\\s*,\\s*${VALUE}`, 'g'))) push(m[1], m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4])
    // List<String> x = ...; x.add("a"); builder.key(x)  -> key: "a"
    for (const m of code.matchAll(/\.(\w+)\(\s*([a-z]\w*)\s*\)/g)) {
      const items = [...code.matchAll(new RegExp(`\\b${m[2]}\\.add\\(\\s*"([^"]+)"\\s*\\)`, 'g'))].map(x => x[1])
      if (items.length) push(m[1], items.sort().join(','))
    }
  }
  if (lang === 'go') {
    // Struct fields: Key: pointer.String("v") / Key: "v" / Key: 1
    for (const m of code.matchAll(new RegExp(`\\b([A-Z]\\w*):\\s*(?:pointer\\.\\w+\\()?${VALUE}`, 'g'))) {
      const key = m[1].replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
      push(key, m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4])
    }
  }
  if (lang === 'shell') {
    // URL query parameters: ?q=*&filter_by=...
    for (const m of code.matchAll(/[?&]([a-z_]+)=([^&"'\s\\]+)/g)) push(m[1], decodeURIComponent(m[2]))
    for (const m of code.matchAll(/--data-urlencode\s+["']([a-z_]+)=([^"']*)["']/g)) push(m[1], m[2])
  }
  return pairs
}

function embedFromIn(code, lang) {
  const m = code.match(/["']?from["']?\s*(?:=>|:)\s*\[([^\]]*)\]/) || code.match(/\bFrom:\s*\[\]string\{([^}]*)\}/)
  if (m) return [...m[1].matchAll(/["']([^"']+)["']/g)].map(x => x[1]).sort()
  if (lang === 'java') {
    const adds = [...code.matchAll(/\bembedFrom\.add\(\s*"([^"]+)"\s*\)/g)].map(x => x[1])
    if (adds.length) return adds.sort()
  }
  return null
}

function identifierLiterals(code) {
  const out = new Set()
  for (const m of code.matchAll(/["']([A-Za-z][\w-]{3,})["']/g)) out.add(m[1])
  return out
}

// Every string and number literal, to tell "the same example with one name
// wrong" from "a different example altogether" (a tab with its own data).
function allLiterals(code) {
  const out = new Set()
  for (const m of code.matchAll(/["']([^"'\n]{2,})["']/g)) out.add(m[1])
  for (const m of code.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/g)) out.add(m[1])
  return out
}

// Share of this tab's literals that the other tabs also use.
function overlap(f, others) {
  const mine = [...f.literals.all]
  if (!mine.length) return 1
  const pool = new Set(others.flatMap(o => [...o.literals.all]))
  return mine.filter(l => pool.has(l)).length / mine.length
}

function factsFor(block) {
  const code = withoutComments(block.code, block.lang)
  return {
    lang: block.lang,
    line: block.line,
    collections: collectionsIn(code, block.lang),
    created: createdCollection(code, block.lang),
    resources: resourcesIn(code),
    pairs: pairsIn(code, block.lang),
    embedFrom: embedFromIn(code, block.lang),
    literals: { ids: identifierLiterals(code), all: allLiterals(code) },
    fieldRefs: fieldRefsIn(code, block.lang),
  }
}

// ---------------------------------------------------------------------------
// Group-level comparison

function majority(values) {
  const counts = new Map()
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1)
  let best = null
  for (const [v, n] of counts) if (!best || n > best.n) best = { v, n }
  return best
}

const CLIENT_LANGS = new Set(['js', 'ts', 'python', 'ruby', 'php', 'dart', 'java', 'go', 'swift', 'shell', 'csharp', 'rust'])

// Keys whose values legitimately differ between tabs, or that are not data.
const IGNORED_KEYS = new Set(['api_key', 'apiKey', 'host', 'port', 'protocol', 'nodes', 'connectionTimeoutSeconds', 'url', 'access_token', 'refresh_token', 'client_id', 'client_secret', 'project_id', 'http', 'https'])

// Keys whose value selects what a request acts on; a tab that differs here
// does something else than its siblings.
const SIGNIFICANT_KEYS = new Set([
  'name', 'collection', 'collection_name', 'destination_collection', 'source_collection', 'collections',
  'query_by', 'event_type', 'type', 'model_name', 'doc_id', 'user_id', 'preset', 'rule_tag', 'from', 'facet_by',
  'group_by', 'include_fields', 'exclude_fields', 'vector_query', 'embed', 'locale', 'stopwords', 'curation_tags',
  'filter_by', 'sort_by',
])

function checkGroup(group, pageFacts) {
  const blocks = group.blocks.filter(b => CLIENT_LANGS.has(b.lang))
  const facts = blocks.map(factsFor)
  const problems = new Map() // lang -> [problems]
  const add = (lang, p) => {
    if (!problems.has(lang)) problems.set(lang, [])
    problems.get(lang).push(p)
  }

  // Fields that the collection's schema (as the docs create it) does not have.
  if (pageFacts.schemas) {
    for (const f of facts) {
      if (f.collections.length !== 1 || !f.fieldRefs.length) continue
      const schema = pageFacts.schemas.get(f.collections[0])
      if (!schema) continue
      const unknown = f.fieldRefs.filter(n => !schema.has(n))
      if (unknown.length) {
        const fields = [...schema].filter(n => n !== 'id')
        add(f.lang, {
          rule: 'unknown-field',
          message: `refers to field${unknown.length > 1 ? 's' : ''} \`${unknown.join('`, `')}\`, which the \`${f.collections[0]}\` schema in these docs does not have (fields: ${fields.join(', ')})`,
          fix: fields.join(','),
        })
      }
    }
  }

  // Misspelt parameter names (checked per tab against the documentation).
  for (const f of facts) {
    const seen = new Set()
    for (const key of f.pairs.keys()) {
      const p = misspeltKey(key, pageFacts.documented)
      if (p && !seen.has(key)) {
        seen.add(key)
        add(f.lang, p)
      }
    }
  }
  if (blocks.length < 3) return problems

  // Collections: prefer a name this page creates; otherwise the majority.
  const withCollections = facts.filter(f => f.collections.length)
  if (withCollections.length >= 3) {
    const all = withCollections.flatMap(f => f.collections)
    const created = pageFacts.createdCollections
    const createdHere = [...new Set(all)].filter(n => created.has(n))
    let expected
    if (createdHere.length) expected = new Set(createdHere)
    else {
      const best = majority(withCollections.map(f => f.collections.slice().sort().join(',')))
      if (best && best.n > withCollections.length / 2) expected = new Set(best.v.split(','))
    }
    if (expected) {
      for (const f of withCollections) {
        const unexpected = f.collections.filter(c => !expected.has(c))
        // A tab with its own data (different documents, different fields) is a
        // different example, not the same one with the wrong collection.
        const sameExample = overlap(f, withCollections.filter(o => o !== f)) >= 0.5
        if (unexpected.length && !f.collections.some(c => expected.has(c)) && sameExample) {
          add(f.lang, {
            rule: 'tab-collection-differs',
            message: `uses collection \`${unexpected[0]}\`; the other tabs${createdHere.length ? ' and the collection this page creates' : ''} use \`${[...expected].join('`, `')}\``,
            fix: [...expected][0],
          })
        }
      }
    }
  }

  // Create-collection examples: the schema name must agree.
  const creates = facts.filter(f => f.created)
  if (creates.length >= 3) {
    const best = majority(creates.map(f => f.created))
    if (best && best.n > creates.length / 2) {
      for (const f of creates) if (f.created !== best.v && overlap(f, creates.filter(o => o !== f)) >= 0.5) add(f.lang, { rule: 'tab-schema-name-differs', message: `creates collection \`${f.created}\`; the other tabs create \`${best.v}\`, which the following examples use`, fix: best.v })
    }
  }

  // Other named resources.
  for (const kind of Object.keys(RESOURCE_KINDS)) {
    const have = facts.filter(f => f.resources[kind])
    if (have.length < 3) continue
    const best = majority(have.map(f => f.resources[kind].slice().sort().join(',')))
    if (!best || best.n <= have.length / 2) continue
    const expected = new Set(best.v.split(','))
    for (const f of have) {
      const mine = f.resources[kind]
      if (!mine.some(n => expected.has(n))) {
        add(f.lang, { rule: 'tab-resource-differs', message: `uses ${kind.replace('_', ' ')} \`${mine[0]}\`; the other tabs use \`${[...expected].join('`, `')}\``, fix: [...expected][0] })
      }
    }
    // A tab that acts on the whole set where the others act on one item.
    if (kind === 'item') {
      for (const f of facts) {
        if (!f.resources.item && have.length >= facts.length - 1 && facts.length >= 4) {
          add(f.lang, { rule: 'tab-missing-item', message: `the other tabs act on item \`${[...expected][0]}\`; this tab acts on the whole set`, fix: [...expected][0] })
        }
      }
    }
  }

  // Key/value pairs: same key, different value. Only keys whose value picks a
  // target (a rule, a collection, a field, a model) are compared by value; a
  // different sample price or id is cosmetic. Any key is compared by type: a
  // number where the other tabs send a string (or the reverse) changes what
  // the server stores.
  const keyCount = new Map()
  for (const f of facts) for (const k of f.pairs.keys()) keyCount.set(k, (keyCount.get(k) || 0) + 1)
  const isNumber = v => /^-?\d+(\.\d+)?$/.test(String(v))
  for (const [key, n] of keyCount) {
    if (n < 3 || IGNORED_KEYS.has(key) || key === 'id') continue
    const have = facts.filter(f => f.pairs.has(key))
    const best = majority(have.map(f => JSON.stringify(f.pairs.get(key))))
    if (!best || best.n <= have.length / 2 || best.n < 2) continue
    const b = JSON.parse(best.v)
    for (const f of have) {
      const a = f.pairs.get(key)
      if (JSON.stringify(a) === best.v || a.length !== b.length) continue
      const typeMismatch = a.some((v, i) => isNumber(v) !== isNumber(b[i]) && b[i] !== 'null' && v !== 'null')
      if (!SIGNIFICANT_KEYS.has(key) && !typeMismatch) continue
      add(f.lang, {
        rule: typeMismatch ? 'tab-value-type-differs' : 'tab-value-differs',
        message: `sends \`${key}\` = ${a.map(v => JSON.stringify(v)).join(', ')}; the other tabs send ${b.map(v => JSON.stringify(v)).join(', ')}${typeMismatch ? ' (a different type, so the server stores or rejects something else)' : ''}`,
        fix: b.join(', '),
      })
    }
  }

  // Embedding source fields.
  const embeds = facts.filter(f => f.embedFrom)
  if (embeds.length >= 3) {
    const best = majority(embeds.map(f => f.embedFrom.join(',')))
    if (best && best.n > embeds.length / 2) {
      for (const f of embeds) if (f.embedFrom.join(',') !== best.v) add(f.lang, { rule: 'tab-embed-from-differs', message: `embeds from [${f.embedFrom.join(', ')}]; the other tabs embed from [${best.v.split(',').join(', ')}]`, fix: best.v })
    }
  }

  return problems
}

// ---------------------------------------------------------------------------
// Page-level checks

const RULE_TYPES = /["']?type["']?\s*(?:=>|:)\s*["'](popular_queries|nohits_queries|counter|log)["']/

function pageFactsFor(groups, version) {
  const documented = version ? documentedNames(version) : null
  const schemas = pageSchemas(groups)
  const createdCollections = new Set()
  const rules = new Map() // name -> event_type
  const createdResources = [] // { kind, name, line }
  for (const g of groups) {
    for (const b of g.blocks) {
      if (!CLIENT_LANGS.has(b.lang)) continue
      const code = withoutComments(b.code, b.lang)
      const created = createdCollection(code, b.lang)
      if (created) createdCollections.add(created)
      if (RULE_TYPES.test(code)) {
        // Every "name" in a rules payload, with its event_type when given.
        for (const m of code.matchAll(/["']?name["']?\s*(?:=>|:)\s*["']([\w-]+)["'][\s\S]{0,400}?["']?event_type["']?\s*(?:=>|:)\s*["'](\w+)["']/g)) {
          rules.set(m[1], m[2])
        }
        for (const m of code.matchAll(/["']?name["']?\s*(?:=>|:)\s*["']([\w-]+)["']/g)) if (!rules.has(m[1])) rules.set(m[1], null)
        // Ruby/Go: name => rule_name variable
        for (const m of code.matchAll(/\b(?:rule_name|ruleName)\s*(?::=|=)\s*["']([\w-]+)["']/g)) if (!rules.has(m[1])) rules.set(m[1], null)
      }
      if (b.lang === 'shell') {
        for (const m of code.matchAll(/\/(stopwords|curation_sets|synonym_sets|presets|aliases)\/([\w.-]+)["']?[\s\S]{0,80}?-X\s*(PUT|POST)|-X\s*(PUT|POST)[\s\S]{0,120}?\/(stopwords|curation_sets|synonym_sets|presets|aliases)\/([\w.-]+)/g)) {
          const kind = m[1] || m[5]
          const name = m[2] || m[6]
          createdResources.push({ kind, name, line: b.line })
        }
      }
    }
  }
  return { createdCollections, rules, createdResources, documented, schemas }
}

function checkPage(groups, pageFacts) {
  const problems = new Map() // `${groupId}|${lang}` -> [problems]
  const add = (g, lang, p) => {
    const key = `${g.id}|${lang}`
    if (!problems.has(key)) problems.set(key, [])
    problems.get(key).push(p)
  }

  for (const g of groups) {
    for (const b of g.blocks) {
      if (!CLIENT_LANGS.has(b.lang)) continue
      const code = withoutComments(b.code, b.lang)

      // Analytics events must name a rule the page created, with its event type.
      const isEvent = /analytics\/events|\.events\(\)\.create\(|\.events\.create\(|Events\(\)\.Create\(/.test(code)
      if (isEvent && pageFacts.rules.size) {
        const name = code.match(/["']?name["']?\s*(?:=>|:)\s*["']([\w-]+)["']/)
        const type = code.match(/["']?event_type["']?\s*(?:=>|:)\s*["'](\w+)["']/)
        if (name && !pageFacts.rules.has(name[1])) {
          const near = [...pageFacts.rules.keys()].sort((a, c) => editDistance(a, name[1]) - editDistance(c, name[1]))[0]
          add(g, b.lang, { rule: 'event-rule-not-found', message: `sends an event to rule \`${name[1]}\`, but no rule with that name is created on this page (the rule created above is \`${near}\`), so the server answers 400 Rule not found`, fix: near })
        } else if (name && type && pageFacts.rules.get(name[1]) && pageFacts.rules.get(name[1]) !== type[1]) {
          add(g, b.lang, { rule: 'event-type-mismatch', message: `sends event_type \`${type[1]}\` to rule \`${name[1]}\`, which this page creates with event_type \`${pageFacts.rules.get(name[1])}\``, fix: pageFacts.rules.get(name[1]) })
        }
      }

      // Reading (or "updating") a named resource that no earlier example on
      // the page created: following the page top to bottom, the read is a 404
      // and the update silently creates a second resource.
      if (b.lang === 'shell') {
        const isWrite = /-X\s*(PUT|POST|PATCH)/.test(code) || /\s-d\s/.test(code)
        const claimsUpdate = /updat/i.test(g.heading.title)
        const m = code.match(/\/(stopwords|curation_sets|synonym_sets|presets|aliases)\/([\w.-]+)/)
        if (m && (!isWrite || claimsUpdate)) {
          const [, kind, name] = m
          const createdBefore = pageFacts.createdResources.some(r => r.kind === kind && r.name === name && r.line < b.line)
          const others = pageFacts.createdResources.filter(r => r.kind === kind && r.name !== name && r.line < b.line)
          if (!createdBefore && others.length) {
            const verb = isWrite ? 'updates' : 'reads'
            add(g, b.lang, {
              rule: 'resource-not-created',
              message: `${verb} ${kind.replace('_', ' ')} \`${name}\`, which no earlier example on this page creates; the one created above is \`${others[0].name}\`, so following the page this ${isWrite ? 'creates a second set instead of updating' : 'answers 404'}`,
              fix: others[0].name,
            })
          }
        }
      }
    }
  }
  return problems
}

module.exports = { checkGroup, checkPage, pageFactsFor, factsFor, collectionsIn, pairsIn }
