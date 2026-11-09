// Tests for the examples on docs-site/content/30.2/api/api-clients.md
//
// Each key in `snippets` is a snippet ID: the anchor of the heading above the
// example, with --2, --3 for later examples under the same heading. Examples
// run top to bottom against a fresh Typesense server, once per language.
// See snippet-tests/README.md for everything a test can do.

module.exports = {
  snippets: {
    'libraries': {
      skip: 'installation instructions, not runnable code',
      // No API call recognised. The example only has to run without errors.
    },
  },
}
