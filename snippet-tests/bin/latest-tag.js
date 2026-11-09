#!/usr/bin/env node
'use strict'

// Prints the newest Typesense server image tag on Docker Hub, including
// release candidates, so docs examples are checked before a release ships.
//
//   node bin/latest-tag.js            -> e.g. 31.0.rc25
//   node bin/latest-tag.js --github   -> also writes tag= and line= to $GITHUB_OUTPUT

const fs = require('fs')

const REPO = 'typesense/typesense'
const TAG_RE = /^(\d+)\.(\d+)(?:\.(\d+))?(?:\.rc(\d+))?$/

// Sort key: major, minor, patch, then final releases above their RCs.
function versionKey(tag) {
  const m = tag.match(TAG_RE)
  if (!m) return null
  const rc = m[4] === undefined ? Number.MAX_SAFE_INTEGER : Number(m[4])
  return [Number(m[1]), Number(m[2]), Number(m[3] || 0), rc]
}

function compare(a, b) {
  const ka = versionKey(a)
  const kb = versionKey(b)
  for (let i = 0; i < 4; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]
  return 0
}

async function fetchTags(pages = 3) {
  const tags = []
  let url = `https://hub.docker.com/v2/repositories/${REPO}/tags?page_size=100&ordering=last_updated`
  for (let i = 0; i < pages && url; i++) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Docker Hub returned HTTP ${res.status}`)
    const data = await res.json()
    tags.push(...data.results.map(r => r.name))
    url = data.next
  }
  return tags
}

async function main() {
  const tags = (await fetchTags()).filter(t => versionKey(t))
  if (!tags.length) throw new Error('No version tags found on Docker Hub')
  const latest = tags.sort(compare).pop()
  const line = latest.replace(/\.rc\d+$/, '').split('.').slice(0, 2).join('.')
  console.log(latest)
  if (process.argv.includes('--github') && process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag=${latest}\nline=${line}\n`)
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err.message)
    process.exit(1)
  })
}

module.exports = { versionKey, compare }
