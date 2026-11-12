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

### Static checks

Every client-language block on a page is also checked without running it (`lib/static/`). The checks find what a reader would hit when pasting the example into a project:

- **Syntax**: unbalanced brackets in any language; Python, Ruby, PHP, Go and shell parsed with the real tool when it is installed (`python3`, `ruby`, `php`, `gofmt`, `bash`); JavaScript parsed with acorn; `true`/`false`/`null` in Python; a missing `;` in Java or PHP; an identifier that is never declared but is a near-miss of one that is (`collectionschema` for `collectionSchema`).
- **Client API** (`lib/static/rules.js`): calls the client library does not have, checked against the client sources (`client.curationSets().upsert(name, set)` in typesense-js, `.items[...]` on a Python curation set, `client.keys(1)` in Java, `client.SynonymSets(...)` in typesense-go 3.2.0...). Each rule names the client version it was checked against and the call that works.
- **curl**: an option on its own line without a `\` on the line before, a body that is not valid JSON, a multi-search without `collection` or `query_by`, a URL without the port, `--data-urlencode` without `-G`, a shell variable spliced into a JSON body.
- **Cross-tab consistency** (`lib/static/consistency.js`): the tabs of one example are the same request in several languages, so a tab that searches a different collection, names a different preset or rule, sends a misspelt parameter (`remote_embedding_num_try`) or a value of a different type is wrong even though it runs. The page as a whole is checked too: an analytics event must name a rule the page created, and a read of a named resource must come after the example that creates it.

Languages without an executor get a result from the static checks alone. For JavaScript and curl the static problems are added to the runtime result, and a static problem fails the example even when it ran, because the sibling tabs or the client's real API say it is wrong.

Beyond client code, the page itself is checked: every JSON or JSON Lines block (sample responses, request bodies, schema fragments) must be valid JSON with sane keys, document ids that are strings and a version that matches the docs version; prose must not link to a doubled `##` anchor, number a list item twice or contradict itself (a fact table in `lib/static/docs.js`); code comments must not name a resource the code no longer uses; and fields in `include_fields`, `query_by`, `sort_by` and friends must exist in the schema the page creates (or the shared `companies` schema). These results use the languages `json` and `prose`.

`audit/` holds an independent review of the 30.2 examples, and it is the source of truth for what is wrong. `node bin/audit.js` maps every one of its 127 findings (BREAK, WRONG and COSMETIC) to its code block, JSON block or prose section and checks that the harness flags it; the self-test runs it, so a change to the checks cannot silently stop catching a known problem. Once an example is fixed it no longer shows the audited problem, so the self-test runs the cross-check against the docs as they were when the audit was written (the commit `AUDIT_DOCS_REF` in `lib/config.js`, read with `git archive`; set `SNIPPET_DOCS_ROOT` to point the harness at any other copy of the docs). Against the current docs, `node bin/audit.js` shows which audited problems are still there. `--extra` lists flagged blocks the review does not mention, to look for false positives.

### The report

The final report (console, run summary and the compatibility issue) counts **findings**, in the audit's format: one row per problem, however many tabs or pages it appears in, with the columns `# | Sev | Page | Lang | Snippet | Problem | Fix`. `lib/findings.js` builds it:

- Each audit row the run detects becomes a finding with the audit's id and severity (C1, K1...).
- A failure on a block no audit row maps to joins an audit finding on the same page that already shows the same problem, as the audit's "and others" does (three more PHP alias statements missing `;` join AL3).
- Anything left is a new finding, grouped by page and problem and numbered N1, N2... These are problems the audit does not list, most of them found by running the example against the server. Once confirmed, add them to the audit file so the next run reports them under their own id.
- Audit rows on the examples the run checked that no longer show their problem are listed under "Fixed audit findings" and not counted.

Below the table, the per-example counts (one result per example per language) stay for reference; they are higher than the number of findings, because one finding often covers several examples.

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
| `skip` | A reason string to skip running the example, or `{ js: 'reason' }` to skip one language. The static checks still run; a skip is for what the environment cannot run (a hosted model, a missing tool), never for a broken example. |
| `static` | `false`, or `{ python: false }`, turns the static checks off for an example whose block is not code in that language (install commands, a parameter fragment). |
| `xfail` | Marks a known failure, with a reason. It is reported but does not fail the run. Use it for a harness or server limitation, not for a broken example: a broken example must fail, that is what the suite is for. |
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
node bin/run.js 30.2 --no-static              # runtime only, no static checks
node bin/run.js --changed origin/master       # only the snippets a branch touches, as a PR run does
node bin/run.js 30.2 --isolated --no-static   # every snippet alone: finds tests that lean on earlier examples
node bin/seed.js 30.2/api/documents.md        # guess tests for examples that have none
node bin/audit.js --extra                     # check the harness against the example audit (no Docker)
npm run self-test                             # tests for the harness itself
```

The static checks use `python3`, `ruby`, `php`, `gofmt` and `bash` when they are on the PATH and skip that language's syntax check otherwise (the pattern-based checks always run). GitHub's Ubuntu runners have all of them.

## Automation

Three workflows in `.github/workflows/` use this harness. Nothing runs on a plain push.

- **Snippet tests** runs on every PR that touches docs or tests, and runs only the snippets the PR touches (`lib/changes.js`): an example whose lines or heading changed, a JSON block or prose section that changed, or an example whose test entry changed. A change elsewhere in a test file (`beforeAll`, a helper) runs that page, and a change to the harness runs everything. A new example is a changed example, so it runs too, against the stub test the coverage workflow writes. The selected snippets run on a fresh server, so each test's `setup()` must give its example what it needs; `--isolated` checks that for every snippet. The check reports and does not block: broken examples keep it green, and the findings go into one comment on the PR (`lib/pr-comment.js`), in the same table format as the compatibility issue's findings.md, updated on every push. Only a broken harness (its self-test) fails it. On a PR from a fork the token cannot comment, so the findings stay in the run summary.
- **Snippet test coverage** runs on every PR. For each new example without a finished test, it writes a guessed test marked `todo` and adds a checkbox to the PR description. The check fails until every box is ticked and no `todo` is left. It uses `pull_request_target`, so it runs the workflow and scripts of the PR's base branch.
- **Snippet compatibility with new Typesense releases** runs daily, polling Docker Hub for the newest server image, release candidates included, and does nothing when that tag was already tested against the same docs and tests. On a new tag it tests the latest docs version and files one issue per release line (updated by later release candidates, closed once everything passes), linking the findings table. GitHub runs scheduled workflows only from the default branch, so the poll starts once this is merged there.

Both test workflows end with the audit cross-check, which adds a line like "127 of 127 audit findings flagged" to the run summary.

By default the coverage check posts stubs in a PR comment, ready to paste. To have them committed to the PR branch instead, add a `SNIPPET_TESTS_PUSH_TOKEN` repository secret. Use a fine-grained token or app token with contents write access. Commits pushed with the default `GITHUB_TOKEN` would not trigger the PR's other checks. Stubs are never pushed to forks.

**Snippet tests** is report-only by design; marking it required in branch protection only guards against a broken harness. To make new examples require a finished test, mark **Snippet test coverage** as required.

## Limitations

- The server always listens on `localhost:8108`, because the examples hard-code that address. Only one run can happen at a time on a machine.
- When a group has several blocks in the same language, such as one tab per LLM provider, only the first one runs.
- Examples that call hosted AI models, or need large model downloads, are skipped with a reason. Search the tests for `skip:` to see them. Their static checks still run.
- Python, Ruby, PHP, Dart, Java, Go and Swift examples are checked statically only. A call the client does not have is caught when a rule in `lib/static/rules.js` knows about it; a wrong argument type or a renamed model class is caught only where a rule exists. Running them for real needs an executor per language.

## Covering a new docs version

Only docs versions with a folder in `tests/` are covered. When a new version folder is added to the docs, copy the previous version's tests:

```bash
cp -r snippet-tests/tests/30.2 snippet-tests/tests/31.0
```
