'use strict'

// Runs a curl / shell example with bash. A curl() wrapper records each
// request's HTTP status to a side file, so the example's own stdout (and any
// pipes such as `| jq`) stay untouched.

const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { API_KEY, PORT } = require('../config')
const { parseJsonValues } = require('../json-stream')

function bashPath() {
  if (process.env.SNIPPET_TESTS_BASH) return process.env.SNIPPET_TESTS_BASH
  if (process.platform === 'win32') {
    // Avoid C:\Windows\System32\bash.exe, which is WSL, not Git Bash.
    const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe'
    if (fs.existsSync(gitBash)) return gitBash
  }
  return 'bash'
}

function isRunnable(code) {
  return /\bcurl\b/.test(code)
}

function run(code, { cwd, timeoutMs = 60000, vars = {} }) {
  const statusFile = path.join(os.tmpdir(), `snippet-status-${process.pid}-${Date.now()}.txt`)
  const script = [
    `export TYPESENSE_API_KEY='${API_KEY}'`,
    `export TYPESENSE_HOST='http://localhost:${PORT}'`,
    `__status_file='${statusFile.replace(/\\/g, '/')}'`,
    'curl() { command curl -sS --write-out "%output{>>$__status_file}%{http_code}\\n" "$@"; }',
    code,
    '',
  ].join('\n')

  return new Promise(resolve => {
    // `vars` become environment variables (objects as JSON).
    const env = { ...process.env }
    for (const [k, v] of Object.entries(vars)) env[k] = typeof v === 'string' ? v : JSON.stringify(v)
    const child = spawn(bashPath(), ['-c', script], { cwd, env })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', d => (stdout += d))
    child.stderr.on('data', d => (stderr += d))
    child.on('close', exitCode => {
      clearTimeout(timer)
      let statuses = []
      try {
        statuses = fs
          .readFileSync(statusFile, 'utf8')
          .split(/\s+/)
          .filter(Boolean)
          .map(Number)
        fs.unlinkSync(statusFile)
      } catch (_) {}

      const responses = parseJsonValues(stdout)
      const badStatus = statuses.find(s => !(s >= 200 && s < 300))
      let error = null
      if (exitCode !== 0) {
        error = `exited with code ${exitCode}${stderr ? `: ${stderr.trim()}` : ''}`
      } else if (badStatus !== undefined) {
        error = `HTTP ${badStatus === 0 ? 'connection failure' : badStatus}: ${stdout.trim().slice(0, 500)}`
      }
      resolve({
        ok: !error,
        error,
        output: stdout,
        stderr,
        statuses,
        responses,
        response: responses.length === 1 ? responses[0] : responses.length ? responses : undefined,
      })
    })
  })
}

module.exports = { lang: 'shell', isRunnable, run }
