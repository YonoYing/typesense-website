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
      // These tabs hold shell install commands (pip, composer) or an HTML
      // script tag, not code in the tab's language, so the syntax checks do
      // not apply. The Java and Swift tabs show real imports and are checked.
      static: { js: false, python: false, php: false, ruby: false, dart: false, go: false },
    },
  },
}
