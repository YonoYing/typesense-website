'use strict'

// Starts a throwaway Typesense server in Docker. Every page gets a fresh
// server (and so an empty data dir) for every language, so examples cannot
// leak state into each other.

const { execFileSync } = require('child_process')
const { API_KEY, PORT } = require('./config')

const CONTAINER = process.env.SNIPPET_TESTS_CONTAINER || 'typesense-snippet-tests'

function docker(args, opts = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()
}

function stopServer() {
  try {
    docker(['rm', '-f', CONTAINER])
  } catch (_) {
    // not running
  }
}

async function waitForHealth(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${PORT}/health`)
      if (res.ok) return
      lastError = new Error(`health returned ${res.status}`)
    } catch (err) {
      lastError = err
    }
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error(`Typesense did not become healthy: ${lastError && lastError.message}`)
}

async function startServer({ image, args = [] }) {
  stopServer()
  docker([
    'run', '-d', '--rm',
    '--name', CONTAINER,
    '-p', `${PORT}:8108`,
    image,
    '--data-dir', '/tmp',
    `--api-key=${API_KEY}`,
    '--enable-cors',
    ...args,
  ])
  try {
    await waitForHealth()
  } catch (err) {
    let logs = ''
    try {
      logs = docker(['logs', '--tail', '30', CONTAINER])
    } catch (_) {}
    throw new Error(`${err.message}\n${logs}`)
  }
}

function pullImage(image) {
  execFileSync('docker', ['pull', '--quiet', image], { stdio: 'inherit' })
}

module.exports = { startServer, stopServer, pullImage }
