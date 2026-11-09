'use strict'

// Client API surface rules: calls that do not exist in the official client
// library an example is written for. Each rule is a pattern that only matches
// code the client cannot run (a method that is not there, a wrong type, a
// keyword used as a method name). The message says what the client actually
// offers, with the client version the fact was checked against.
//
// Patterns run against the example with comments blanked out, so a mention
// in a comment never triggers a rule. String literals are kept because the
// names inside them (collection names, ids) are part of the call shape.
//
// Client versions: typesense-js 3.2.0, typesense-python 2.1.1,
// typesense-ruby 5.0.0, typesense-php 6.0.0, typesense-dart 0.6.0,
// typesense-java 2.1.0, typesense-go 3.2.0, typesense-swift 1.0.1.

const { withoutComments, codeOnly, lineOf } = require('./lexer')

// Each rule: { id, re, message, fix, where } where `where` is 'code' (match
// on code with comments AND strings blanked) or 'source' (comments blanked,
// strings kept; the default).
const RULES = {
  js: [
    {
      id: 'js-curation-sets-upsert',
      re: /\bcurationSets\(\s*\)\s*\.upsert\(/,
      message: 'client.curationSets() has only retrieve() in typesense-js 3.2.0; a set is upserted through client.curationSets(name).upsert(set)',
      fix: "client.curationSets('curate_products').upsert(curation_set)",
    },
    {
      id: 'js-snake-case-method',
      re: /\b(?:client|typesense)\.[a-z]+_[a-z_]+\s*\(/,
      message: 'typesense-js methods are camelCase; there is no snake_case method on the client',
      fix: 'client.curationSets(...) / client.synonymSets(...)',
    },
    {
      id: 'js-synonym-item-upsert',
      re: /\.synonymSets\([^)]*\)\s*\.items\(\s*['"`][^'"`]+['"`]\s*\)\s*\.upsert\(/,
      message: 'a synonym set item has no upsert() in typesense-js 3.2.0; upsert goes through .items().upsert(itemId, item)',
      fix: "client.synonymSets('tech-synonyms').items().upsert('smart-phone-synonyms', item)",
    },
    {
      id: 'js-collection-create',
      re: /\bcollections\(\s*['"`][^'"`]+['"`]\s*\)\s*\.create\(/,
      message: 'client.collections(name) returns one collection, which has no create(); collections are created with client.collections().create(schema)',
      fix: 'client.collections().create(schema)',
    },
    {
      id: 'js-analytics-rules-retrieve-object',
      re: /\.analytics\.rules\(\s*\)\s*\.retrieve\(\s*\{/,
      message: 'analytics.rules().retrieve() takes the rule tag as a string in typesense-js 3.2.0, not an object',
      fix: "client.analytics.rules().retrieve('homepage')",
    },
    {
      id: 'js-html-in-fence',
      re: /^\s*<\/?[a-zA-Z][\w-]*(?:\s[^>]*)?>/m,
      message: 'an HTML tag inside a JavaScript code block is not JavaScript',
      fix: 'move the <script> tag to an html code block',
      where: 'raw',
    },
    {
      id: 'js-unknown-client-variable',
      re: /\b(?!client\b|this\b)([a-z]\w*)\.(?:multiSearch|collections|aliases|keys|analytics|presets|stopwords|curationSets|synonymSets|conversations|nlSearchModels)\b/,
      message: 'calls the API on a variable this example never declares; the docs name the client `client`',
      fix: 'client.multiSearch.perform(...)',
      when: (code, m) => !new RegExp(`\\b(?:let|const|var)\\s+${m[1]}\\b`).test(code),
    },
    {
      id: 'js-mixed-module-styles',
      re: /\brequire\(\s*['"]typesense['"]\s*\)[\s\S]*^\s*import\s[\s\S]*\bfrom\s+['"]typesense['"]/m,
      message: 'the block mixes CommonJS require() with an ES module import, so it cannot run as one file',
      fix: 'show the two client setups in separate code blocks',
    },
  ],

  python: [
    {
      id: 'py-curation-sets-upsert',
      re: /\bcuration_sets\.upsert\(/,
      message: 'client.curation_sets has no upsert() in typesense-python 2.1.1; a set is upserted through client.curation_sets[name].upsert(set)',
      fix: "client.curation_sets['curate_products'].upsert(curation_set)",
    },
    {
      id: 'py-set-items-attribute',
      re: /\b(?:curation_sets|synonym_sets)\[[^\]]+\]\s*\.items\b/,
      message: 'CurationSet and SynonymSet have no .items in typesense-python 2.1.1; items are managed with .upsert_item(id, item), .get_item(id), .delete_item(id) and .list_items()',
      fix: "client.curation_sets['curate_products'].upsert_item('dynamic-sort-filter', item)",
    },
    {
      id: 'py-analytics-rules-call',
      re: /\banalytics\.rules\s*\(/,
      message: 'client.analytics.rules is an object, not a function, in typesense-python 2.1.1; a rule is addressed with client.analytics.rules[name]',
      fix: "client.analytics.rules['product_queries_aggregation'].delete()",
    },
    {
      id: 'py-import-keyword',
      re: /\.documents\.import\(/,
      message: '`import` is a Python keyword, so documents.import(...) is a syntax error; the method is import_()',
      fix: 'client.collections[name].documents.import_(documents, params)',
    },
    {
      id: 'py-js-let',
      re: /^\s*let\s+\w+\s*=/m,
      message: '`let` is JavaScript; in Python the assignment has no keyword',
      fix: 'schema = {...}',
      where: 'code',
    },
    {
      id: 'py-js-booleans',
      re: /(?<![\w.'"])(true|false|null)(?![\w'"])/,
      message: "Python spells booleans and null as True, False and None; a bare `true`, `false` or `null` raises NameError",
      fix: 'True / False / None',
      where: 'code',
    },
  ],

  ruby: [
    {
      id: 'rb-synonym-set-upsert',
      re: /\bsynonym_sets\[[^\]]+\]\s*\.upsert\b/,
      message: 'a synonym set has only retrieve and delete in typesense-ruby 5.0.0; upsert is client.synonym_sets.upsert(name, set)',
      fix: 'client.synonym_sets.upsert("clothing-synonyms", synonym_set)',
    },
    {
      id: 'rb-synonym-set-items',
      re: /\bsynonym_sets\[[^\]]+\]\s*\.items\b/,
      message: 'typesense-ruby 5.0.0 has no synonym set item API (.items); upsert the whole set instead',
      fix: 'client.synonym_sets.upsert("tech-synonyms", synonym_set)',
    },
    {
      id: 'rb-missing-client-receiver',
      re: /^\s*collections\[/m,
      message: '`collections[...]` has no receiver, so Ruby raises NameError; the call starts with `client.`',
      fix: "client.collections['companies'].documents.import(...)",
      where: 'code',
    },
    {
      id: 'rb-analytics-rules-upsert',
      re: /\banalytics\.rules\.upsert\(/,
      message: 'analytics.rules has only create, retrieve and [] in typesense-ruby 5.0.0; a rule is created with .create(config) or updated with client.analytics.rules[name].update(config)',
      fix: 'client.analytics.rules[rule_name].update(rule_configuration)',
    },
    {
      id: 'rb-analytics-rules-retrieve-args',
      re: /\banalytics\.rules\.retrieve\(\s*\w+:/,
      message: 'analytics.rules.retrieve takes no arguments in typesense-ruby 5.0.0 (ArgumentError)',
      fix: 'client.analytics.rules.retrieve',
    },
  ],

  php: [
    {
      id: 'php-curation-set-items',
      re: /->curationSets\[[^\]]+\]\s*->items\b/,
      message: 'CurationSet::$items is private in typesense-php 6.0.0; items are reached through ->getItems()',
      fix: "$client->curationSets['curate_products']->getItems()['dynamic-sort-filter']->upsert($item)",
    },
    {
      id: 'php-synonym-set-items',
      re: /->synonymSets\[[^\]]+\]\s*->items\b/,
      message: 'typesense-php 6.0.0 has no synonym set item API; a SynonymSet has only upsert, retrieve and delete',
      fix: "$client->synonymSets['tech-synonyms']->upsert($synonym_set)",
    },
    {
      id: 'php-items-assoc-array',
      re: /["']items["']\s*=>\s*\[\s*["']id["']\s*=>/,
      message: '"items" is an associative array here, which serialises to a JSON object; the server expects a list of items ([[ ... ]])',
      fix: '"items" => [[ "id" => ..., "rule" => ... ]]',
    },
    {
      id: 'php-js-syntax',
      re: /^\s*client\.\w+/m,
      message: 'this is JavaScript syntax inside the PHP example ($client->... in PHP)',
      fix: "$client->collections['companies']->documents->import($documentsInJsonl, ['batch_size' => 100])",
      where: 'code',
    },
    {
      id: 'php-colon-separator',
      re: /["'][\w-]+["']\s*:\s*(?:["'][^"']*["']|\d|true|false|null|\[)/,
      message: '`:` is not a PHP array separator (JSON syntax inside a PHP array); PHP uses =>',
      fix: '"region" => "us-central1"',
    },
  ],

  dart: [
    {
      id: 'dart-snake-case-client-field',
      re: /\bclient\.(curation_sets|synonym_sets|nl_search_models|multi_search)\b/,
      message: 'the Dart client has no snake_case fields; curation sets are client.curationSets (all) and client.curationSet(name) (one set), and CurationSet.upsert takes a CurationSetUpsertSchema, not a Map',
      fix: "await client.curationSet('curate_products').upsert(CurationSetUpsertSchema(...))",
    },
    {
      id: 'dart-collections-call',
      re: /\bclient\.collections\(/,
      message: 'client.collections is a field in typesense-dart 0.6.0, not a method; one collection is client.collection(name)',
      fix: "client.collection('places').documents.search(searchParameters)",
    },
    {
      id: 'dart-documents-call',
      re: /\.documents\(\)/,
      message: 'documents is a getter in typesense-dart 0.6.0, not a method: .documents, not .documents()',
      fix: '.documents.search(...)',
    },
    {
      id: 'dart-document-update',
      re: /\.document\.update\(/,
      message: 'document is a method that takes an id in typesense-dart 0.6.0; update-by-query is .documents.update(document, options: {...})',
      fix: "client.collection('companies').documents.update(document, options: {'filter_by': 'num_employees:>1000'})",
    },
    {
      id: 'dart-unquoted-map-key',
      re: /\{\s*filter_by\s*:/,
      message: 'a bare `filter_by` is an undefined identifier in Dart; map keys are strings',
      fix: "{'filter_by': 'num_employees:>1000'}",
      where: 'code',
    },
    {
      id: 'dart-bool-in-string-map',
      re: /\.documents\.delete\(\s*\{\s*['"]truncate['"]\s*:\s*true\s*\}/,
      message: 'documents.delete() takes a Map<String, String> in typesense-dart 0.6.0, so a bool value does not compile',
      fix: "documents.delete({'truncate': 'true'})",
    },
    {
      id: 'dart-update-schema-field',
      re: /UpdateSchema\(\s*\{\s*Field\(/,
      message: 'UpdateSchema takes a Set<UpdateField> in typesense-dart 0.6.0 (not Field); the drop flag is shouldDrop: and type is a named parameter',
      fix: "UpdateSchema({UpdateField('num_employees', shouldDrop: true), UpdateField('company_category', type: Type.string)})",
    },
    {
      id: 'dart-old-version-constraint',
      re: /\btypesense:\s*\^0\.([0-5])\.\d+/,
      message: 'the pubspec constraint excludes the current typesense-dart release (0.6.0): ^0.x.y only allows versions below 0.(x+1).0',
      fix: 'typesense: ^0.6.0',
      where: 'raw',
    },
    {
      id: 'dart-hash-comment',
      re: /^\s*#\s*\w/m,
      message: '`#` does not start a comment in Dart (compile error); comments use //',
      fix: '// Search parameters that are common to all searches go here',
      where: 'raw',
    },
  ],

  java: [
    {
      id: 'java-synonym-sets-arg',
      re: /\bclient\.synonymSets\(\s*"/,
      message: 'synonymSets() takes no arguments in typesense-java 2.1.0; one set is client.synonymSet(name)',
      fix: 'client.synonymSet("clothing-synonyms").upsert(synonymSet)',
    },
    {
      id: 'java-synonym-items',
      re: /\bsynonymSets?\([^)]*\)\s*\.items\(/,
      message: 'typesense-java 2.1.0 has no synonym set item API (.items())',
      fix: 'upsert the whole set with client.synonymSet(name).upsert(set)',
    },
    {
      id: 'java-synonym-set-return-type',
      re: /\bSynonymSet\s+\w+\s*=\s*client\.synonymSets?\(/,
      message: 'synonymSet(name).retrieve() returns SynonymSetCreateSchema in typesense-java 2.1.0, not SynonymSet (incompatible types)',
      fix: 'SynonymSetCreateSchema synonymSet = client.synonymSet("clothing-synonyms").retrieve();',
    },
    {
      id: 'java-synonym-sets-list-type',
      re: /\bList<SynonymSetSchema>\s+\w+\s*=\s*client\.synonymSets\(\)\.retrieve\(/,
      message: 'synonymSets().retrieve() returns SynonymSetSchema[] in typesense-java 2.1.0, not a List',
      fix: 'SynonymSetSchema[] synonymSets = client.synonymSets().retrieve();',
    },
    {
      id: 'java-misspelt-type',
      re: /\b(Hashmap|HaashMap|Arraylist|Hashset)\b/,
      message: 'misspelt type name (Java types are case-sensitive: HashMap, ArrayList, HashSet)',
      fix: 'HashMap<String, Object>',
      where: 'code',
    },
    {
      id: 'java-document-return-type',
      re: /\bHashMap<[^>]+>\s+\w+\s*=\s*client\.collections\([^)]*\)\.documents\([^)]*\)\.(?:update|delete|retrieve)\(/,
      message: 'documents(...).update()/delete()/retrieve() return Map in typesense-java 2.1.0 (Map<String,Object>, or Map<String,Integer> for update-by-query), not HashMap: incompatible types',
      fix: 'Map<String, Object> updatedDocument = ...;',
    },
    {
      id: 'java-delete-return-type',
      re: /\bCollectionResponse\s+\w+\s*=\s*client\.collections\([^)]*\)\.documents\(\)\.delete\(/,
      message: 'documents().delete() returns Map<String, Object> in typesense-java 2.1.0, not CollectionResponse',
      fix: 'Map<String, Object> response = client.collections("companies").documents().delete(...);',
    },
    {
      id: 'java-keys-int-literal',
      re: /\bclient\.keys\(\s*\d+\s*\)/,
      message: 'client.keys(Long id): an int literal does not box to Long, so this does not compile',
      fix: 'client.keys(1L).retrieve()',
    },
    {
      id: 'java-models-package',
      re: /\bimport\s+org\.typesense\.models\./,
      message: 'the package is org.typesense.model (singular) in typesense-java 2.1.0; a wildcard import of a missing package does not compile',
      fix: 'import org.typesense.model.*;',
    },
    {
      id: 'java-import-parameters-class',
      re: /\bImportDocumentParameters\b/,
      message: 'the class is ImportDocumentsParameters in typesense-java 2.1.0',
      fix: 'ImportDocumentsParameters importDocumentsParameters = new ImportDocumentsParameters();',
      where: 'code',
    },
    {
      id: 'java-import-keyword',
      re: /\.documents\(\)\.import\(/,
      message: '`import` is a reserved word in Java; the method is import_()',
      fix: 'client.collections("products").documents().import_(documents, params)',
    },
    {
      id: 'java-float-array-doubles',
      re: /\bfloat\[\]\s+\w+\s*=\s*\{[^}]*\d\.\d+(?![\dfF])/,
      message: 'double literals in a float[] initialiser do not compile without an f suffix',
      fix: 'float[] embedding = {0.04f, 0.234f, 0.113f, 0.001f};',
      where: 'code',
    },
    {
      id: 'java-client-collection-singular',
      re: /\bclient\.collection\(/,
      message: 'the Java client has collections(String name), not collection()',
      fix: 'client.collections("docs").documents().create(document)',
    },
    {
      id: 'java-documents-field',
      re: /\)\.documents\.(?:create|upsert|search|import_?|delete|update)\(/,
      message: 'documents() is a method in typesense-java 2.1.0, not a field',
      fix: 'client.collections("docs").documents().create(document)',
    },
    {
      id: 'java-hashmap-add',
      re: /\b(\w+)\.add\(\s*"[^"]*"\s*,/,
      message: 'HashMap has put(key, value), not add()',
      fix: 'document.put("title", "Louvre Museuem")',
      when: (code, m) => new RegExp(`\\bHa?a?sh[Mm]ap<[^>]*>\\s+${m[1]}\\b`).test(code),
    },
    {
      id: 'java-alias-return-type',
      re: /\bCollectionAliasSchema\s+\w+\s*=\s*client\.aliases\(/,
      message: 'aliases(name).retrieve() and .delete() return CollectionAlias in typesense-java 2.1.0, not CollectionAliasSchema',
      fix: 'CollectionAlias collectionAlias = client.aliases("companies").retrieve();',
    },
    {
      id: 'java-multisearch-hashmap',
      re: /\bHashMap<[^;]*>\s+(\w+)\s*=[^;]*;[\s\S]*\bmultiSearch\.perform\(\s*\1\b/,
      message: 'multiSearch.perform() takes a MultiSearchSearchesParameter in typesense-java 2.1.0, not a HashMap: incompatible types',
      fix: 'new MultiSearchSearchesParameter().addSearchesItem(new MultiSearchCollectionParameters().preset("listing_view"))',
    },
  ],

  go: [
    {
      id: 'go-synonym-sets',
      re: /\bclient\.SynonymSets\(/,
      message: 'typesense-go 3.2.0 has no SynonymSets; on v4 (alpha) SynonymSets() takes no arguments and one set is client.SynonymSet(name)',
      fix: 'client.SynonymSet("clothing-synonyms").Upsert(ctx, set)  // needs typesense-go v4+',
    },
    {
      id: 'go-synonym-items',
      re: /\bSynonymSets?\([^)]*\)\s*\.Items\(/,
      message: 'no Go client version has a synonym set item wrapper (.Items())',
      fix: 'upsert the whole set, or call the generated API client',
    },
    {
      id: 'go-string-into-pointer-field',
      re: /\b(Collection|Preset|Q|QueryBy|FilterBy|SortBy):\s*"/,
      message: 'this field is a *string in api.MultiSearchCollectionParameters (typesense-go 3.2.0); a string literal does not compile',
      fix: 'Collection: pointer.String("products")',
      when: code => /MultiSearchCollectionParameters|MultiSearchSearchesParameter/.test(code),
    },
    {
      id: 'go-model-config-extra-fields',
      re: /\b(DocumentTask|QueryTask|Region)\b/,
      message: 'ModelConfig has no DocumentTask, QueryTask or Region field in typesense-go 3.2.0 (nor on master); an anonymous struct literal must match api.Field exactly, so this does not compile',
      fix: 'drop the DocumentTask/QueryTask/Region lines (or use api.FieldEmbed on a client that has them)',
      where: 'code',
    },
    {
      id: 'go-analytics-maps',
      re: /\bAnalytics\(\)\.(?:Rules|Events)\(\)\.\w+\(/,
      message: 'the Go client takes typed structs for analytics (api.AnalyticsRuleUpsertSchema, api.AnalyticsEventCreateSchema), not map[string]interface{}: compile error',
      fix: 'client.Analytics().Rules().Upsert(ctx, name, &api.AnalyticsRuleUpsertSchema{...})',
      when: code => /map\[string\]interface\{\}/.test(code),
    },
    {
      id: 'go-analytics-rules-create',
      re: /\bAnalytics\(\)\.Rules\(\)\.Create\(/,
      message: 'Rules() has only Upsert(ctx, name, schema) and Retrieve(ctx) in typesense-go 3.2.0 (Create exists only on master, with typed input)',
      fix: 'client.Analytics().Rules().Upsert(ctx, name, &api.AnalyticsRuleUpsertSchema{...})',
    },
    {
      id: 'go-analytics-rules-retrieve-args',
      re: /\bAnalytics\(\)\.Rules\(\)\.Retrieve\(\s*context\.Background\(\)\s*,/,
      message: 'Rules().Retrieve(ctx) takes only the context in typesense-go 3.2.0',
      fix: 'client.Analytics().Rules().Retrieve(context.Background())',
    },
    {
      id: 'go-analytics-events-retrieve',
      re: /\bAnalytics\(\)\.Events\(\)\.Retrieve\(/,
      message: 'Events() has only Create in typesense-go 3.2.0; there is no Events().Retrieve',
      fix: 'use the generated API client, or drop the example',
    },
  ],

  swift: [
    {
      id: 'swift-collections-call',
      re: /\bclient\.collections\(\)/,
      message: 'collections is a property in typesense-swift 1.0.1, not a method',
      fix: 'client.collections.retrieveAll()',
    },
    {
      id: 'swift-collection-update',
      re: /\bclient\.collections\.update\(/,
      message: 'typesense-swift 1.0.1 has no collection update API (Collections has create and retrieveAll only)',
      fix: 'drop the Swift tab or mark it unsupported',
    },
    {
      id: 'swift-delete-parameters',
      re: /\.delete\(\s*parameters:|\bDeleteDocumentsParams\b/,
      message: 'documents().delete takes options: DeleteDocumentsParameters(filterBy:..., truncate:) in typesense-swift; there is no parameters: label or DeleteDocumentsParams type',
      fix: 'documents().delete(options: DeleteDocumentsParameters(filterBy: "...", truncate: true))',
    },
    {
      id: 'swift-decode-delete-response',
      re: /\.delete\(\s*filter:[^\n]*\n[^\n]*decoder\.decode\(\s*\w+\.self/,
      message: 'delete-by-query returns {"num_deleted": N}, not a document, so decoding it as the document type throws',
      fix: 'decode a struct with num_deleted, or drop the decode line',
    },
    {
      id: 'swift-trailing-comma-arguments',
      re: /,\s*\)/,
      message: 'a trailing comma in an argument list only compiles on Swift 6.1 and later',
      fix: 'drop the comma before `)`',
      where: 'code',
    },
    {
      id: 'swift-package-old-version',
      re: /upToNextMajor\(\s*from:\s*"0\.1\.0"\s*\)/,
      message: 'from: "0.1.0" resolves to 0.1.0 ..< 1.0.0, which excludes the current typesense-swift release (1.0.1)',
      fix: '.upToNextMajor(from: "1.0.1")',
    },
  ],
}

// TypeScript examples use the same client as JavaScript.
RULES.ts = RULES.js.filter(r => r.id !== 'js-html-in-fence')

// Rules for curl examples (the shell checks in shell.js cover request shape).
RULES.shell = [
  {
    id: 'shell-gnu-base64',
    re: /\bbase64\s+-w\s*\d/,
    message: '`base64 -w0` is a GNU coreutils flag; macOS base64 rejects it',
    fix: 'base64 | tr -d \'\\n\'  (or openssl base64 -A)',
    where: 'raw',
  },
  {
    id: 'shell-api-key-variable',
    re: /X-TYPESENSE-API-KEY:\s*\$\{?(?!TYPESENSE_API_KEY\b)([A-Za-z_]\w*)/i,
    message: 'reads the API key from a variable every other example calls TYPESENSE_API_KEY',
    fix: '${TYPESENSE_API_KEY}',
    where: 'raw',
  },
]

// Rules for every client language.
const COMMON = [
  {
    id: 'field-list-trailing-comma',
    re: /["']((?:[a-z_][\w.]*,)+)["']/,
    message: 'a comma-separated field list ends with a comma',
    fix: 'drop the trailing comma',
  },
]

function applyRules(code, lang) {
  const rules = [...(RULES[lang] || []), ...COMMON]
  if (!rules.length) return []
  const views = {
    source: withoutComments(code, lang),
    code: codeOnly(code, lang),
    raw: code,
  }
  const problems = []
  for (const rule of rules) {
    const view = views[rule.where || 'source']
    const m = view.match(rule.re)
    if (!m) continue
    if (rule.when && !rule.when(views.source, m)) continue
    problems.push({ rule: rule.id, line: lineOf(view, m.index), message: rule.message, fix: rule.fix })
  }
  return problems
}

module.exports = { applyRules, RULES }
