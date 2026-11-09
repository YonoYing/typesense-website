# Docs snippet tests

This folder runs the code examples in the Typesense docs against a real Typesense server, so broken examples are caught before readers find them.

Each example is run as written in the docs. Its test then checks that it really did what the docs say. Even without a test, an example fails if it throws, gets a non-2xx response, or gets an error inside a 200 response, such as a failed search within a multi-search.

## How it works

The harness reads each docs page and finds its **snippet groups**. A group is one example operation, usually a `<Tabs>` block with the same call in several languages. One test covers every language version of the example.

Each group's **snippet ID** is the anchor of the heading above it. A second or third example under the same heading gets `--2` or `--3` added. To give an example a fixed ID that survives edits around it, put this comment on the line before it:

```md
<!-- snippet-id: create-companies-collection -->
```

Pages run top to bottom against a fresh server, once per language. Examples that build on earlier ones work naturally, and a test's `setup()` can make an example stand on its own.

JavaScript and curl examples run today. Tests are written per group rather than per language, so other languages will start running against the same tests once they get an executor in `lib/executors/`.

## Writing tests

Tests live in `tests/`, mirroring the docs folders. The examples in `docs-site/content/30.2/api/documents.md` are tested by `tests/30.2/api/documents.test.js`:

```js
module.exports = {
  // Optional, runs once per language before the page's examples.
  async beforeAll({ createCollection, fixtures }) {
    await createCollection(fixtures.companies.schema)
  },

  snippets: {
    'delete-a-single-document': {
      async setup({ ensureDocument }) {
        await ensureDocument('companies', '124')
      },
      async verify({ expectGone }) {
        await expectGone('/collections/companies/documents/124')
      },
    },
  },
}
```

A test entry can use these keys:

| Key | What it does |
| --- | --- |
| `setup(ctx)` | Runs before the example. |
| `verify(ctx)` | Runs after the example succeeds. Throw (or fail an `assert`) to fail the test. |
| `skip` | A reason string to skip the example, or `{ js: 'reason' }` to skip one language. |
| `xfail` | Marks a known failure, with a reason. It is reported but does not fail the run. |
| `expectError` | `true`, a string or a RegExp: the example is meant to fail, with a matching error. |
| `allowEmbeddedErrors` | Don't fail on errors reported inside a 200 response (a failed search in a multi-search, or a failed line in an import). |
| `langs` | Only run these languages, e.g. `['shell']`. |
| `vars` | Variables the example expects to exist, e.g. `{ documents: [...] }`. JavaScript gets them as variables, curl as environment variables. |
| `timeout` | Milliseconds before the example is stopped (default 60000). |
| `todo` | Marks a stub that still needs checking. It blocks the PR until removed. |

A page's test file can also set `skip` for the whole page, `image` to pin a server image, and `server: { args: [...] }` for extra server flags.

`verify` and `setup` receive a context object with:

- **`response`**: what the example returned. For JavaScript, the value of its last expression. For curl, the parsed JSON body (an array when it printed several values).
- **`responses`** and **`output`**: every parsed JSON value, and the raw output.
- **`client`** and **`api`**: a typesense-js client, and a raw HTTP helper (`api.get(path)` and friends) that never throws.
- **`lang`**: `js` or `shell`, for the rare check that differs by language.
- **Helpers**: `assert`, `expectKeys`, `expectExists`, `expectGone`, `ensureCollection`, `ensureDocument`, `dropCollection`, `createCollection`, `importDocuments`, `writeFile`, `toJsonl` and `fixtures`. See `lib/helpers.js`.

Prefer checks that inspect server state through `client` or `api`. Those work the same for every language.

The first tests in `tests/30.2/` were generated as best guesses from each example's curl command. Tighten them freely.

## Running locally

You need Node 20+ and Docker.

```bash
cd snippet-tests
npm ci
node bin/run.js 30.2/api/documents.md
```

Other useful commands:

```bash
node bin/run.js 30.2                          # every page in a docs version
node bin/run.js 30.2/api/search.md --langs shell --only basic-search
node bin/run.js 30.2 --image typesense/typesense:31.0.rc25
node bin/seed.js 30.2/api/documents.md        # guess tests for examples that have none
npm run self-test                             # tests for the harness itself
```

## Automation

Three workflows in `.github/workflows/` use this harness.

- **Snippet tests** runs on every PR that touches docs or tests. It runs the examples on each changed page, and every covered page when the harness itself changes.
- **Snippet test coverage** runs on every PR. For each new example without a finished test, it writes a guessed test marked `todo` and adds a checkbox to the PR description. The check fails until every box is ticked and no `todo` is left. It uses `pull_request_target`, so it only takes effect once merged to the default branch.
- **Snippet compatibility with new Typesense releases** runs daily. It tests the latest docs version against the newest server image on Docker Hub, release candidates included. Failures go into one issue per release line, which closes itself once everything passes.

By default the coverage check posts stubs in a PR comment, ready to paste. To have them committed to the PR branch instead, add a `SNIPPET_TESTS_PUSH_TOKEN` repository secret. Use a fine-grained token or app token with contents write access. Commits pushed with the default `GITHUB_TOKEN` would not trigger the PR's other checks. Stubs are never pushed to forks.

To make the checks blocking, mark **Snippet tests** and **Snippet test coverage** as required in the branch protection rules.

## Limitations

- The server always listens on `localhost:8108`, because the examples hard-code that address. Only one run can happen at a time on a machine.
- When a group has several blocks in the same language, such as one tab per LLM provider, only the first one runs.
- Examples that call hosted AI models, or need large model downloads, are skipped with a reason. Search the tests for `skip:` to see them.

## Covering a new docs version

Only docs versions with a folder in `tests/` are covered. When a new version folder is added to the docs, copy the previous version's tests:

```bash
cp -r snippet-tests/tests/30.2 snippet-tests/tests/31.0
```
