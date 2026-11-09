'use strict'

// Groups a run's failures into findings, the unit the example audit uses: one
// problem, written up once, however many tabs or pages it appears in (C1 is
// the same wrong call in four JavaScript tabs). The run counts one result per
// example per language; the report counts findings.
//
// When the docs version has an audit (audit/<version>-...md), each audit row
// the run detects becomes a finding with the row's id and severity, and
// failures on the blocks it maps to belong to it. A failure on another block
// joins an audit finding on the same page that already shows the same
// problem (as the audit's "and others"); anything left is a new finding,
// grouped by page and problem, numbered N1, N2...

const path = require('path')
const fs = require('fs')
const { DOCS_ROOT } = require('./config')
const audit = require('./audit')

// Severity for a new finding, by rule. Runtime failures are BREAK.
const COSMETIC = new Set([
  'stale-comment', 'jsonl-invalid-line', 'swift-trailing-comma-arguments', 'field-list-trailing-comma', 'shell-gnu-base64',
  'shell-api-key-variable', 'js-unknown-client-variable', 'js-html-in-fence', 'dart-old-version-constraint', 'unknown-field',
])
const WRONG = new Set([
  'tab-collection-differs', 'tab-schema-name-differs', 'tab-resource-differs', 'tab-missing-item', 'tab-value-differs',
  'tab-value-type-differs', 'tab-embed-from-differs', 'event-type-mismatch', 'resource-not-created', 'misspelt-parameter',
  'php-items-assoc-array', 'swift-decode-delete-response', 'swift-package-old-version',
])
function severityOf(rule) {
  if (!rule || rule === 'runtime') return 'BREAK'
  if (COSMETIC.has(rule) || /^(json|prose)-/.test(rule)) return 'COSMETIC'
  if (WRONG.has(rule)) return 'WRONG'
  return 'BREAK'
}

// The server's own message, without the HTTP or shell wrapping, so the same
// rejection from the JavaScript and curl versions groups together.
function runtimeKey(error) {
  const text = String(error || '')
  const said = text.match(/Server said: ([^\n]+)/) || text.match(/"message"\s*:\s*"([^"]+)"/) || text.match(/multi-search failed: ([^\n]+)/)
  if (said) return said[1].trim()
  return text
    .split('\n')[0]
    .replace(/^HTTP \d+:\s*/, '')
    .replace(/^exited with code \d+:\s*/, '')
    .replace(/(\/usr)?\/bin\/bash: line \d+: /, '')
    .trim()
}

// Problems of one failing result, each with a grouping key.
function problemsOf(r) {
  const out = (r.problems || []).map(p => ({ ...p, key: p.rule }))
  if (r.runtimeError) {
    out.push({ rule: 'runtime', key: `runtime:${runtimeKey(r.runtimeError)}`, message: runtimeKey(r.runtimeError), runtime: true })
  }
  if (!out.length && r.error) out.push({ rule: 'runtime', key: `runtime:${runtimeKey(r.error)}`, message: runtimeKey(r.error), runtime: true })
  return out
}

const resultKey = r => `${r.page}|${r.id}|${r.lang}`

// The code of a result's block, to quote the offending line.
const codeCache = new Map()
function blockFor(r) {
  const key = resultKey(r)
  if (codeCache.has(key)) return codeCache.get(key)
  const all = audit.pageCandidates(r.page) || []
  const c = all.find(x => x.group.id === r.id && x.block.lang === r.lang)
  codeCache.set(key, c ? c.block : null)
  return codeCache.get(key)
}

// Absolute docs line of a problem, and the code on that line.
function locate(r, p) {
  const block = blockFor(r)
  if (!block) return { line: r.line, text: '' }
  if (r.lang === 'prose') {
    const line = p && p.line ? p.line : block.line
    const text = (fs.readFileSync(path.join(DOCS_ROOT, r.page), 'utf8').split('\n')[line - 1] || '').trim()
    return { line, text }
  }
  const lines = block.code.split('\n')
  const rel = p && p.line ? p.line : lines.findIndex(l => l.trim()) + 1 || 1
  return { line: block.line + rel, text: (lines[rel - 1] || '').trim() }
}

function pageName(docRel) {
  return docRel.replace(/^[\d.]+\/(api\/)?/, '')
}

// results: the run's results. Returns { findings, undetected, auditFile }.
function buildFindings(results) {
  const failing = results.filter(r => r.status === 'fail')
  const byKey = new Map(failing.map(r => [resultKey(r), r]))
  const findings = []
  const undetected = []
  const attributed = new Set()

  // 1. Audit findings the run detected.
  const versions = [...new Set(results.map(r => r.page.split('/')[0]))]
  const auditFiles = []
  for (const version of versions) {
    const file = audit.auditFileFor(version)
    if (!file) continue
    auditFiles.push(file)
    const { rows } = audit.parseAudit(file)
    const ran = new Set(results.map(r => r.page))
    for (const row of rows) {
      if (!audit.locationsOf(row.where).some(l => ran.has(`${version}/api/${l.page}`))) continue
      const { slots } = audit.mapRow(row, version)
      const hits = slots.map(slot => slot.filter(c => byKey.has(audit.keyOf(c))))
      if (!slots.length || hits.some(h => !h.length)) {
        undetected.push({ row, slots, hits })
        continue
      }
      const members = [...new Set(hits.flat().map(c => byKey.get(audit.keyOf(c))))]
      for (const m of members) attributed.add(resultKey(m))
      findings.push({ id: row.id, severity: row.severity, source: 'audit', row, members, extra: [] })
    }
  }

  // 2. Failures on other blocks: join an audit finding on the same page that
  // shows the same problem, or form a new finding. An audit finding whose
  // members all share the problem is preferred over one where it is incidental.
  const sharedKeys = f => {
    const sets = f.members.map(m => new Set(problemsOf(m).map(p => p.key)))
    return [...sets[0]].filter(k => sets.every(s => s.has(k)))
  }
  for (const f of findings) f.shared = sharedKeys(f)
  const fresh = new Map() // `${page}|${key}` -> finding
  for (const r of failing) {
    if (attributed.has(resultKey(r))) continue
    const problems = problemsOf(r)
    // Group by the static problems when there are any; a runtime error on the
    // same block is usually their consequence.
    const keys = problems.some(p => !p.runtime) ? problems.filter(p => !p.runtime) : problems
    for (const p of keys) {
      // Prefer the audit finding on this page where the problem is the common
      // thread of the most blocks (C14 "stale comment" over C13, which merely
      // has one too).
      const onPage = findings.filter(f => f.source === 'audit' && f.members.some(m => m.page === r.page))
      const host =
        onPage.filter(f => f.shared.includes(p.key)).sort((a, b) => b.members.length - a.members.length)[0] ||
        onPage.find(f => f.members.some(m => m.page === r.page && problemsOf(m).some(q => q.key === p.key)))
      if (host) {
        if (!host.extra.includes(r)) host.extra.push(r)
        continue
      }
      const gk = `${r.page}|${p.key}`
      if (!fresh.has(gk)) fresh.set(gk, { id: null, severity: severityOf(p.rule), source: 'new', key: p.key, members: [], extra: [] })
      const f = fresh.get(gk)
      if (!f.members.includes(r)) f.members.push(r)
    }
  }
  const news = [...fresh.values()].sort((a, b) => a.members[0].page.localeCompare(b.members[0].page) || a.members[0].line - b.members[0].line)
  news.forEach((f, i) => (f.id = `N${i + 1}`))
  findings.push(...news)

  for (const f of findings) Object.assign(f, describe(f))
  return { findings, undetected, auditFiles }
}

// The table columns for a finding, from the harness's own problems.
function describe(f) {
  const all = [...f.members, ...f.extra]
  const LANGS = require('./report').LANG_NAMES
  // The problems this finding is about: for a new finding, its key; for an
  // audit finding, the problems every member shares, else all of them.
  const per = all.map(r => ({ r, ps: problemsOf(r) }))
  let chosen
  if (f.source === 'new') chosen = per.map(({ r, ps }) => ({ r, ps: ps.filter(p => p.key === f.key) }))
  else {
    const shared = per[0].ps.map(p => p.key).filter(k => per.every(x => x.ps.some(p => p.key === k)))
    chosen = per.map(({ r, ps }) => ({ r, ps: shared.length ? ps.filter(p => shared.includes(p.key)) : ps }))
  }
  const pages = new Map()
  for (const { r, ps } of chosen) {
    const name = pageName(r.page)
    if (!pages.has(name)) pages.set(name, new Set())
    pages.get(name).add(locate(r, ps.find(p => !p.runtime) || ps[0]).line)
  }
  const first = chosen[0]
  const firstProblem = first.ps.find(p => !p.runtime) || first.ps[0]
  const messages = [...new Set(chosen.flatMap(x => x.ps.map(p => p.message)))]
  const fixes = [...new Set(chosen.flatMap(x => x.ps.map(p => p.fix).filter(Boolean)))]
  return {
    page: [...pages].map(([name, lines]) => `${name}:${[...lines].sort((a, b) => a - b).join(',')}`).join('; '),
    langs: [...new Set(all.map(r => LANGS[r.lang] || r.lang))].join(', '),
    snippet: locate(first.r, firstProblem).text,
    problem: messages.join('; '),
    fix: fixes[0] || '',
    blocks: all.length,
  }
}

function counts(findings) {
  const c = { total: findings.length, BREAK: 0, WRONG: 0, COSMETIC: 0, audit: 0, new: 0 }
  for (const f of findings) {
    c[f.severity.split(/\s/)[0]]++
    c[f.source]++
  }
  return c
}

const cell = (s, max = 220) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  const cut = t.length > max ? `${t.slice(0, max)}…` : t
  return cut.replace(/\|/g, '\\|')
}
const code = s => (s ? `\`${cell(s, 90).replace(/`/g, "'")}\`` : '')

// The audit's table format: | # | Sev | Page | Lang | Snippet | Problem | Fix |
function findingsTable(findings) {
  const rows = findings.map(f => `| ${f.id} | ${f.severity} | ${cell(f.page, 120)} | ${f.langs} | ${code(f.snippet)} | ${cell(f.problem)} | ${f.fix ? code(f.fix) : ''} |`)
  return ['| # | Sev | Page | Lang | Snippet | Problem | Fix |', '|---|-----|------|------|---------|---------|-----|', ...rows].join('\n')
}

function headline(findings) {
  const c = counts(findings)
  const split = c.audit && c.new ? ` (${c.audit} from the example audit, ${c.new} new)` : c.audit ? ' (all from the example audit)' : ''
  return `${c.total} findings = ${c.BREAK} BREAK, ${c.WRONG} WRONG, ${c.COSMETIC} COSMETIC${split}`
}

function consoleFindings(findings) {
  return findings.map(f => `  ${f.id.padEnd(4)} ${f.severity.padEnd(13)} ${f.page} [${f.langs}] ${cell(f.problem, 160)}`).join('\n')
}

module.exports = { buildFindings, findingsTable, headline, counts, consoleFindings, severityOf, runtimeKey }
