'use strict'

// Parses output that may hold one JSON value, JSON Lines, or several JSON
// values printed back to back (one per curl call). Returns every value found.
function parseJsonValues(text) {
  const values = []
  const s = text.trim()
  if (!s) return values
  try {
    return [JSON.parse(s)]
  } catch (_) {
    // fall through to streaming parse
  }
  let i = 0
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++
    if (i >= s.length) break
    const start = i
    const open = s[i]
    if (open !== '{' && open !== '[') {
      // Not JSON from here on; stop rather than guess.
      break
    }
    let depth = 0
    let inString = false
    for (; i < s.length; i++) {
      const c = s[i]
      if (inString) {
        if (c === '\\') i++
        else if (c === '"') inString = false
        continue
      }
      if (c === '"') inString = true
      else if (c === '{' || c === '[') depth++
      else if (c === '}' || c === ']') {
        depth--
        if (depth === 0) {
          i++
          break
        }
      }
    }
    try {
      values.push(JSON.parse(s.slice(start, i)))
    } catch (_) {
      break
    }
  }
  return values
}

module.exports = { parseJsonValues }
