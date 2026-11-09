'use strict'

// Facts about the machine running the tests, for tests that need a tool to be
// installed. CI installs these; locally a test is skipped when one is missing.
//
//   const { commandExists } = require('../../../lib/env')
//   skip: { shell: commandExists('parallel') ? false : 'needs GNU parallel' },

const { spawnSync } = require('child_process')

const cache = new Map()

function commandExists(name) {
  if (!cache.has(name)) {
    const probe = process.platform === 'win32' ? spawnSync('where', [name]) : spawnSync('sh', ['-c', `command -v ${name}`])
    cache.set(name, probe.status === 0)
  }
  return cache.get(name)
}

module.exports = { commandExists }
