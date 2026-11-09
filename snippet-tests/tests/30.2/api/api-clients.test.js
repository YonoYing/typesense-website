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
      // The Python, PHP and Ruby tabs hold a single shell install command
      // (pip, composer, gem), so their language's syntax checks do not apply.
      // The JavaScript, Dart, Java, Go and Swift tabs show code and are checked.
      static: { python: false, php: false, ruby: false },
    },
  },
}
