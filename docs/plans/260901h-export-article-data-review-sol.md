## Verdict

Do not build the plan unchanged.

The central goal—one owner-scoped query path feeding both rollback export and ZIP export—is right. But `ExportSink` is not as mechanical as the plan claims. The existing exporter is a projection into the legacy filesystem format, not a complete representation of an article. Sharing its `put()` calls would share its current omissions and two data-loss bugs.

I would keep the shared path, but make it a typed stream of logical export artefacts, with separate filesystem and ZIP renderers.

## Main findings

### 1. Not every gathered value passes through `put()`

There are only two direct payload writes outside `put()`—raw-document output and stamped HTML—plus filesystem setup. That narrow claim is accurate.

The broader claim is false. `exportArticle()` selects the entire article and current-revision rows, then projects only selected columns into files ([export.ts:453](/home/greg/code/spideryarn2/src/store/export.ts:453)). Values that are gathered but never reach `put()` include:

- `revision.extractedHtml`, despite the proposed `content/extracted.html`.
- Article identity and state such as `shortId`, `createdAt`, `visibility`, and `publicAt` ([schema.ts:153](/home/greg/code/spideryarn2/src/db/schema.ts:153)).
- Revision identity, lineage and several scalar fields.
- Any older revisions.

There are also existing lossy projections:

- A `candidates` chat thread is exported as `chat` because only `remember` is preserved ([export.ts:744](/home/greg/code/spideryarn2/src/store/export.ts:744), [schema.ts:2259](/home/greg/code/spideryarn2/src/db/schema.ts:2259)).
- Chat-message `passages` and `interrupted` are absent from the export projection ([export.ts:745](/home/greg/code/spideryarn2/src/store/export.ts:745), [schema.ts:2338](/home/greg/code/spideryarn2/src/db/schema.ts:2338), [schema.ts:2350](/home/greg/code/spideryarn2/src/db/schema.ts:2350)).

A shared sink would faithfully reproduce these omissions in both outputs.

### 2. The coverage guard is table-level, not a complete export contract

The existing test is strong at what it does: it discovers article-related tables and injects a sentinel into every table declared exported ([store-export-covers-tables.test.ts:21](/home/greg/code/spideryarn2/tests/store-export-covers-tables.test.ts:21), [store-export-covers-tables.test.ts:436](/home/greg/code/spideryarn2/tests/store-export-covers-tables.test.ts:436)).

It cannot detect:

- A newly added column being omitted.
- `candidates` becoming `chat`.
- `passages` or `interrupted` disappearing.
- `extractedHtml` never being written.
- A ZIP sink dropping content after receiving a `put()`.

The proposed ZIP assertion—“every table in `ExportResult.tables` lands somewhere”—is weaker than the existing sentinel test. `ExportResult.tables` records that a `put()` call occurred, not that the row’s data survived into the ZIP.

Run the same sentinel fixtures through both renderers and search the unzipped, declared destination for each table’s sentinel. Add focused fidelity tests for discriminated values and important columns.

### 3. Use a logical export core, not legacy filenames as the abstraction

The better third option is:

```text
owner-scoped queries
        ↓
typed logical entries
        ↓
filesystem rollback renderer | ZIP renderer
```

For example, the core could emit entries such as `articleMetadata`, `currentRevision`, `blocks`, `chat`, and `stampedHtml`, each with its source tables. The filesystem renderer maps them to today’s exact rollback filenames; the ZIP renderer maps them to the documented bundle layout.

That retains one query set and one coverage mechanism without treating `meta.json`, `shelf.json`, and other rollback filenames as the canonical data model.

At minimum, `ExportSink.put()` should accept a logical artefact identifier, not merely `name: string`.

There is also an important raw-document trap: currently `writeRawDocument()` reads the bucket before writing ([export.ts:349](/home/greg/code/spideryarn2/src/store/export.ts:349)). A ZIP sink whose `rawDocument()` is a no-op must not still cause that read. Put `RawSourceStore` inside the filesystem renderer, or pass a lazy loader that the ZIP renderer never invokes. Otherwise the plan’s “no bucket access at all” claim is false.

## Security

The application-level ownership model is sound.

- Auth runs before the authenticated route table ([routes.ts:5211](/home/greg/code/spideryarn2/src/routes.ts:5211)).
- The verified user is installed as the request owner before route work begins ([routes.ts:5359](/home/greg/code/spideryarn2/src/routes.ts:5359)).
- `ownedSlug()` predicates on both slug and the current owner ([owned-slug.ts:45](/home/greg/code/spideryarn2/src/store/owned-slug.ts:45)).
- `exportArticle()` begins with that predicate and all subsequent reads use the resulting article and revision IDs ([export.ts:453](/home/greg/code/spideryarn2/src/store/export.ts:453)).

Therefore the route does not need a second shelf read for authorization. It does need either that read or a typed not-found error for correct behaviour: `exportArticle()` currently throws an ordinary `Error` for another owner’s slug, which becomes a 500 rather than a 404 ([export.ts:461](/home/greg/code/spideryarn2/src/store/export.ts:461)).

`/api/public/export/:slug` cannot fall through to the authenticated exporter. The public namespace is dispatched separately ([routes.ts:5184](/home/greg/code/spideryarn2/src/routes.ts:5184)) and unknown public routes terminate with 404 ([public/routes.ts:316](/home/greg/code/spideryarn2/src/public/routes.ts:316)).

`reader_profiles` is reader-global, but the exporter does not query it. Keep it that way. Be careful if `jobs` is ever added: job rows contain a reader-profile snapshot.

ZIP transport itself is safe with `application/zip` and `nosniff`, provided entry paths are fixed by code. The dangerous part is Stage E:

- `extractedHtml` is not safe to render directly.
- Every title, comment, chat message, and publisher field must be HTML-escaped.
- The offline page should carry a restrictive CSP blocking scripts and network requests.
- Add adversarial fixtures containing `<script>`, event handlers, closing tags, and URLs.

I would make `index.html` a simple escaped file index in v1. Rendering every feature recreates a second reading client inside a ZIP.

## Factual errors in the plan

- `contentDisposition` currently accepts one argument and always returns `inline`; `contentDisposition(filename, "attachment")` will not compile ([routes.ts:504](/home/greg/code/spideryarn2/src/routes.ts:504)). Refactor it to accept an explicit disposition and test that the PDF route stays inline.
- `ownedSlug` is defined in `src/store/owned-slug.ts`, not `src/store/pg.ts`.
- `SourceLink` demonstrates authenticated blob fetching and object-URL cleanup, but it is not itself the complete ZIP-download implementation. The ZIP button needs an `<a download="…">`, because the response’s filename header is lost after conversion to a blob URL.
- `hasShelfRow` is not an ownership gate. Ownership has already been established server-side; it is UI/load state.
- “Only `current_revision_id` is a first-class concept” and “history would mean inventing it” are false. Revisions have IDs, `articleId`, `basedOnRevisionId`, and timestamps ([schema.ts:403](/home/greg/code/spideryarn2/src/db/schema.ts:403)). The product may choose to export only current state, but that is a deliberate omission of existing history.
- The `DeleteArticle` line reference is stale; the component begins around [Metadata.tsx:1234](/home/greg/code/spideryarn2/src/web/Metadata.tsx:1234), not 1393.
- `fflate` is a sensible zero-dependency ESM choice. `zipSync` is reasonable only after bounding size; [fflate’s own documentation](https://github.com/101arrowz/fflate/blob/master/docs/functions/zipSync.md) recommends the asynchronous API for more than one file.

## Response-size decision

The local measurements are useful evidence, but they do not establish safety.

Vercel’s buffered request/response limit remains 4.5 MB, and its documented escape is streaming ([Vercel Functions limits](https://vercel.com/docs/functions/limitations), [Vercel’s payload-limit guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)). Meanwhile, individual stored HTML artefacts can be up to 32 MiB ([artifacts-fs.ts:243](/home/greg/code/spideryarn2/src/store/artifacts-fs.ts:243)). Text-only does not mean below 4.5 MB after compression, especially with HTML, blocks, chats, comments, and duplicated text.

A 3.5 MB log is observability, not a guardrail: the reader’s request still fails.

Choose explicitly:

- For bounded v1: assemble the ZIP, reject oversized output with a readable 413, and test that path.
- For “every article works”: stream the ZIP response.
- Supabase Storage plus a signed URL is robust but adds more machinery than this feature presently needs.

Also remember that `zipSync` holds source strings, encoded bytes, compression buffers, and the final ZIP concurrently and blocks the event loop.

## Completeness

If the button says “all of this article’s data,” these are missing or need explicit treatment:

- Current article identity and sharing state: `shortId`, timestamps, visibility and `publicAt`.
- `article_visibility_changes`, if sharing history counts.
- `extractedHtml`, already promised by the layout.
- `block_identities`. They cannot always be reconstructed from current stamped HTML: comments and chat anchors can reference identities whose blocks disappeared from the current revision ([schema.ts:868](/home/greg/code/spideryarn2/src/db/schema.ts:868)).
- Correct chat kinds, `passages`, and `interrupted`.
- Older revisions and their blocks/artefacts.
- Operational/cache tables currently excluded by `ARTICLE_TABLE_COVERAGE`: checkpoints, jobs, queue state and revision-step runs. They may properly remain omitted, but the bundle manifest should say so.
- Directly article-linked `ai_calls`. Nullable `article_id` makes cost totals incomplete; it does not make rows with a matching `article_id` unexportable.
- Upload provenance. `uploads.slug` is loose, but owner plus slug can still identify records. Omitting bytes is reasonable; omitting all mention needs a product reason rather than “the schema walk cannot see it.”

The agreed omission of original bytes and image bytes is reasonable. Feedback is also reasonably treated as a product-support record rather than article state. Whole-library export is correctly out of scope.

If older revisions and AI records stay out, name the format “current article snapshot,” not “all article data.”

## Staging

The present six stages are not all safe stopping points.

- **A is safe** if it preserves exact rollback output, proves the Postgres coverage test actually ran, and includes a test showing the ZIP/no-op renderer never accesses the blob store.
- **B is not safe as written.** First define completeness, fix current projection loss, run sentinels through the ZIP, and implement an enforceable size policy.
- **C needs more tests:** successful owner download and valid ZIP; unauthenticated 401; other-owner 404; public-namespace 404; malformed encoding and traversal 400; correct attachment header; oversized response.
- **D needs a component test** for pending state, error text, authenticated fetch, download-anchor click and URL revocation. A manual browser check is additional evidence, not the only evidence.
- **E is too ambitious for a safe v1.** Reduce it to an escaped index/README, or defer it.
- **F should not be last.** Document the format and omissions when they become stable, before exposing the button.

I would order the work:

1. Shared logical export core plus byte-for-byte rollback compatibility.
2. Complete current-snapshot contract and fidelity/sentinel tests.
3. ZIP renderer, safe minimal index, and hard size behaviour.
4. Authenticated route and route tests.
5. Format/project documentation.
6. UI, component tests, and browser verification.

That preserves the plan’s strongest idea—one owner-scoped data walk—without making the rollback format the permanent definition of “my article data.”