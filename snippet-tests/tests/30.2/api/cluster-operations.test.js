// Tests for the examples on docs-site/content/30.2/api/cluster-operations.md
//
// Each key in `snippets` is a snippet ID: the anchor of the heading above the
// example, with --2, --3 for later examples under the same heading. Examples
// run top to bottom against a fresh Typesense server, once per language.
// See snippet-tests/README.md for everything a test can do.

module.exports = {
  snippets: {
    'create-snapshot-for-backups': {
      // Guessed from the curl example: POST /operations/snapshot?snapshot_path
      async verify({ assert, response, expectKeys }) {
        assert.equal(response.success, true)
        expectKeys(response, ['success'])
      },
    },
    'compacting-the-on-disk-database': {
      // Guessed from the curl example: POST /operations/db/compact
      async verify({ assert, response }) {
        assert.equal(response.success, true)
      },
    },
    're-elect-leader': {
      // Guessed from the curl example: POST /operations/vote
      async verify({ assert, response }) {
        // A single-node test server answers success: false, as there is no
        // other node to hand leadership to.
        assert.equal(typeof response.success, 'boolean')
      },
    },
    'toggle-slow-request-log': {
      // Guessed from the curl example: POST /config
      async verify({ response, expectKeys }) {
        expectKeys(response, ['success'])
      },
    },
    'clear-cache': {
      // Guessed from the curl example: POST /operations/cache/clear
      async verify({ assert, response }) {
        assert.equal(response.success, true)
      },
    },
    'cluster-metrics': {
      // Guessed from the curl example: GET /metrics.json
      async verify({ response, expectKeys }) {
        expectKeys(response, ['system_cpu1_active_percentage', 'system_cpu2_active_percentage', 'system_cpu3_active_percentage', 'system_cpu4_active_percentage', 'system_cpu_active_percentage', 'system_disk_total_bytes', 'system_disk_used_bytes', 'system_memory_total_bytes'])
      },
    },
    'api-stats': {
      // Guessed from the curl example: GET /stats.json
      async verify({ response, expectKeys }) {
        expectKeys(response, ['latency_ms', 'requests_per_second'])
      },
    },
    'health': {
      // Guessed from the curl example: GET /health
      async verify({ assert, response, expectKeys }) {
        assert.equal(response.ok, true)
        expectKeys(response, ['ok'])
      },
    },
    'debug': {
      // Guessed from the curl example: GET /debug
      async verify({ response, expectKeys }) {
        expectKeys(response, ['state', 'version'])
      },
    },
  },
}
