'use strict'

// Turns a docs markdown page into an ordered list of "snippet groups".
//
// A snippet group is one example operation, usually a <Tabs> block holding the
// same call written in several languages. Tests are written per group, so one
// test covers every language version of the example.
//
// Each group gets an ID made from the nearest heading's anchor slug. When a
// heading holds several groups, the 2nd and later get a "--2", "--3" suffix.
// An author can pin an explicit ID by putting this comment on the line before
// the group:   <!-- snippet-id: my-custom-id -->

const fs = require('fs')

// Tab names and fence languages, normalised to one key per language.
const LANGUAGE_ALIASES = {
  javascript: 'js',
  js: 'js',
  typescript: 'ts',
  ts: 'ts',
  shell: 'shell',
  bash: 'shell',
  sh: 'shell',
  curl: 'shell',
  python: 'python',
  py: 'python',
  ruby: 'ruby',
  rb: 'ruby',
  php: 'php',
  dart: 'dart',
  java: 'java',
  go: 'go',
  swift: 'swift',
  csharp: 'csharp',
  'c#': 'csharp',
  cs: 'csharp',
  rust: 'rust',
  rs: 'rust',
}

// Languages whose code blocks count as client examples. JSON, JSONL, INI and
// friends are responses or config, so they never form a snippet group.
const CLIENT_LANGUAGES = new Set(Object.values(LANGUAGE_ALIASES))

function normaliseLanguage(name) {
  if (!name) return null
  return LANGUAGE_ALIASES[name.trim().toLowerCase()] || name.trim().toLowerCase()
}

// Same algorithm as VuePress 1 (@vuepress/shared-utils slugify), so IDs match
// the anchors on the live site.
function slugify(text) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/`/g, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’–—<>,.?/]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase()
}

function extractFromMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/)
  const groups = []
  const usedHeadingSlugs = new Map()
  const groupsPerHeading = new Map()

  let heading = { slug: 'top', title: '(top of page)', line: 1 }
  let inFence = false
  let fence = null
  let tabs = null // the <Tabs> group currently open, if any
  let tabName = null
  let pinnedId = null

  let prose = [] // recent lines of text outside code, used to spot responses
  const lastGroup = () => groups[groups.length - 1]

  function finishGroup(group) {
    const clientBlocks = group.blocks.filter(b => CLIENT_LANGUAGES.has(b.lang))
    if (clientBlocks.length === 0) {
      // A group of JSON / JSONL only: an example response or input file.
      // Only blocks introduced as a response count; others are input data
      // such as an example document.
      const previous = lastGroup()
      const isResponseHeading = /response|output/i.test(group.heading.title)
      const introducedAsResponse = /response|returns?\b|output|result/i.test(group.intro)
      const tabbedAsResponse = group.blocks.some(b => /response|output/i.test(b.tab || ''))
      if (
        previous &&
        (previous.heading.slug === group.heading.slug || isResponseHeading) &&
        (isResponseHeading || introducedAsResponse || tabbedAsResponse)
      ) {
        previous.responses.push(...group.blocks)
      }
      return
    }
    const count = (groupsPerHeading.get(group.heading.slug) || 0) + 1
    groupsPerHeading.set(group.heading.slug, count)
    group.id = group.pinnedId || (count === 1 ? group.heading.slug : `${group.heading.slug}--${count}`)
    delete group.pinnedId
    groups.push(group)
  }

  function newGroup(line) {
    const group = {
      id: null,
      heading: { ...heading },
      line,
      blocks: [],
      responses: [],
      pinnedId,
      intro: prose.slice(-2).join(' '),
    }
    pinnedId = null
    return group
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const lineNo = i + 1
    const trimmed = raw.trim()

    if (inFence) {
      if (/^\s*(```|~~~)\s*$/.test(raw) && trimmed.startsWith(fence.marker)) {
        inFence = false
        const block = {
          lang: fence.lang,
          tab: fence.tab,
          line: fence.line,
          code: fence.body.join('\n'),
        }
        if (tabs) {
          tabs.blocks.push(block)
        } else {
          const group = newGroup(fence.line)
          group.blocks.push(block)
          finishGroup(group)
        }
        fence = null
      } else {
        fence.body.push(raw)
      }
      continue
    }

    const fenceOpen = raw.match(/^\s*(```|~~~)\s*([\w#+-]*)/)
    if (fenceOpen) {
      inFence = true
      fence = {
        marker: fenceOpen[1],
        lang: normaliseLanguage(fenceOpen[2] || tabName),
        tab: tabName,
        line: lineNo,
        body: [],
      }
      // A tab name is more reliable than a fence tag (some JS tabs use ```json).
      if (tabName && CLIENT_LANGUAGES.has(normaliseLanguage(tabName))) {
        fence.lang = normaliseLanguage(tabName)
      }
      continue
    }

    const pin = trimmed.match(/^<!--\s*snippet-id:\s*([\w-]+)\s*-->$/)
    if (pin) {
      pinnedId = pin[1]
      continue
    }

    const headingMatch = raw.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (headingMatch && !tabs) {
      const title = headingMatch[2]
      let slug = slugify(title)
      const seen = usedHeadingSlugs.get(slug) || 0
      usedHeadingSlugs.set(slug, seen + 1)
      if (seen > 0) slug = `${slug}-${seen}`
      heading = { slug, title: title.replace(/<[^>]+>/g, '').trim(), line: lineNo }
      prose = [heading.title]
      continue
    }

    if (/^<Tabs\b/.test(trimmed)) {
      tabs = newGroup(lineNo)
      continue
    }
    if (tabs && /^<\/Tabs>/.test(trimmed)) {
      finishGroup(tabs)
      tabs = null
      tabName = null
      continue
    }
    const slot = trimmed.match(/^<template\s+v-slot:([\w#+-]+)\s*>/)
    if (tabs && slot) {
      tabName = slot[1]
      continue
    }
    if (tabs && /^<\/template>/.test(trimmed)) {
      tabName = null
      continue
    }
    if (!tabs && trimmed && !trimmed.startsWith('<') && !trimmed.startsWith(':::')) {
      prose.push(trimmed)
      if (prose.length > 5) prose.shift()
    }
  }

  return groups
}

function extractFromFile(file) {
  return extractFromMarkdown(fs.readFileSync(file, 'utf8'))
}

module.exports = {
  extractFromMarkdown,
  extractFromFile,
  slugify,
  normaliseLanguage,
  CLIENT_LANGUAGES,
}
