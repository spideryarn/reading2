# Sweep cluster 17: boundary types and false comments

Cluster 17 of the fifth codebase sweep
([261003f umbrella § The clusters](261003f-fifth-codebase-sweep-umbrella.md#the-clusters)). Five
small items, none of which changes what a reader sees. Two make a wrong value something the
compiler refuses; three correct comments that say things the code stopped doing.

Evidence for each id is in
[deploy-scripts-and-cross-zone-leads](../investigations/261003b-fifth-sweep-deploy-scripts-and-cross-zone-leads.md)
(X13b, X13c, X13l),
[data-and-pipeline](../investigations/261003b-fifth-sweep-data-and-pipeline.md) (D4) and
[knowledge-and-postmortem-classes](../investigations/261003b-fifth-sweep-knowledge-and-postmortem-classes.md)
(K12). All five were re-checked against the tree at `b8a8e1c3c` on 2026-10-04 and all five are
still live.

## What is wrong today

| Item | Where | What is wrong |
|---|---|---|
| X13b | `src/fetch.ts` § `FetchedDocument` | One interface with `kind: "html" \| "pdf"`, `text: string \| null`, `encoding: string \| null`. A PDF with text, or a web page with `text: null`, type-checks. `storedDocumentBytes` covers the second with `doc.text ?? ""`, which would store an empty document and say nothing. |
| X13c | `src/db/schema.ts` § `revisionBlocks` | `kind`, `role`, `treatment` are plain `text(...)`, so every reader casts: 17 casts in 5 files today (the audit counted 15; `pg.ts` § `relationsFingerprintInputs` arrived since). Each column has a CHECK whose value list equals the TypeScript union exactly. |
| D4 | `src/step-order.ts`, `src/types.ts` § `StepName`, `src/models.ts` | Comments say Glossary/Quotes and Ideas/Timeline/Quiz/FAQ/Simple "share one cached prefix". They do not: since each stage got its own output schema, `sharesArticleCache` (`src/pipeline.ts`) is false for every distinct pair, and `tests/article-cache-group.test.ts` asserts the pair list is `[]`. |
| X13l | `src/web/useOrderedRead.ts` § `discard` | "**Nothing calls this today.**" `useClaims.ts` returns it as an effect cleanup. |
| K12 | `src/types.ts` header | "`TreeNode` must stay in sync with granularity-zoom.md#node-shape". Nothing enforces it and the doc copy has already drifted (`question` is missing). The doc half is cluster 14's; this cluster owns the comment. |

## What we will do

### Stage 1 — X13b: `FetchedDocument` becomes a union

```ts
interface FetchedBase { requestedUrl; url; chain; status; contentType; bytes; fetchedAt }
export interface FetchedHtml extends FetchedBase { kind: "html"; text: string; encoding: string }
export interface FetchedPdf  extends FetchedBase { kind: "pdf";  text: null;   encoding: null }
export type FetchedDocument = FetchedHtml | FetchedPdf;
```

- `readDocument` (the one producer) returns one arm or the other from a branch on `kind`, not
  `decoded?.text ?? null`. HTML decoding still precedes the `fetchedAt` clock read, as at HEAD.
- `storedDocumentBytes` takes `Pick<FetchedPdf, "kind" | "bytes"> | Pick<FetchedHtml, "kind" | "text">`
  and loses `?? ""`. A `Pick` over the union itself would erase the correlation (Sol's note on the
  audit), which is why the parameter is spelled as two arms.
- `fetchHtml` loses `|| doc.text === null`.
- **Callers outside the original audit file:** `acquireUpload` in `src/pipeline.ts` builds the argument
  as `{ kind, bytes, text: decoded?.text ?? null }` with `kind` a variable, which the correlated
  parameter refuses. It becomes a branch on whether HTML was decoded. That is the upload caller
  the audit names. `fixtureFetch` in `evals/cost/harness.ts` constructs the corresponding full arm;
  `tests/source-scan.test.ts` drops the unneeded `bytes` property from HTML storage arguments.
- Left alone: `src/link-previews.ts`, `src/chat-tools.ts`, `src/paper-text.ts` each carry a
  now-redundant `doc.text === null` / `?? ""`. They still compile, they are outside this cluster's
  files, and other clusters are in flight. Listed in the debrief.

**Red first:** `tests/fetched-document-is-a-union.test.ts`, a type-level test (run by
`npm run typecheck`, which covers `tests/`): `@ts-expect-error` on PDFs carrying text or an encoding,
on web pages missing text or encoding, and on storage arguments missing the arm's required payload.
Reverting the union makes the four document directives unused; reverting the storage signature
makes the argument with HTML `text: null` valid when `bytes` is also supplied. Positive type
assertions pin narrowing, and runtime assertions pin decoded HTML and unchanged PDF bytes.

### Stage 2 — X13c: `$type` on three columns

`kind: text("kind").$type<BlockKind>().notNull()`, and `$type<NonNullable<Block["role"]>>()` /
`$type<NonNullable<Block["treatment"]>>()` on the two nullable ones. Then delete the 17 casts in
`src/store/{pg,pg-revisions,public-reader,export,artifacts-pg}.ts`, and the comments in
`public-reader.ts` that explain them.

Five existing test files construct insertion rows through `.map`, which widens their `kind`
strings; literal `kind` annotations in those fixtures retain the now-required union members.

`$type` changes no SQL, so no migration and no schema change. **It is not runtime validation**: it
says what the CHECK constraint already guarantees. The schema comment will say so and name the
three constraints, so a future edit to a union and its CHECK are visibly one change.

`src/public/dto.ts` § `publicBlock` has `block.kind as BlockKind` on a value already typed
`BlockKind`; not a row read, not in the file set, left alone.

**Red first:** a type-level assertion in `tests/revision-block-columns-are-typed.test.ts` that
`typeof revisionBlocks.$inferSelect` has `kind: BlockKind`, `role: NonNullable<Block["role"]> | null`,
`treatment` likewise. Red today (they are `string`).

**The check that the types and the CHECKs agree** is a runtime test in the same file: read the
three constraint SQL strings off the Drizzle table config and compare their value lists with
arrays checked in both directions by `allOf`: its generic constraint refuses extra values and
`Exclude` refuses missing union members. This check was built; the fallback comment alone was
not used.

### Stage 3 — D4, X13l, K12: comments

- **D4.** `types.ts` § `StepName`: delete the cache-membership sentences; keep what each step *is*
  and one pointer to `sharesArticleCache`. `step-order.ts`: keep ordering reasons that are still
  true (prerequisites, "beside the step it paints"), rewrite the "one cache group" claims as what
  is true now — the steps render the same bytes at the same effort, each has its own output
  schema, so no pair shares, and position affects no cache pair. `models.ts`: fix the remaining
  "joins that prefix" / "that cached prefix" / "lets the two share" lines in `Task` (inside `AiJob`),
  `ARTICLE_RENDERER` and the `tweets`-is-in-`ideas`'-group aside. No code changes;
  `cacheArticleForStep` and the marker plumbing stay (the umbrella defers removing them pending a
  cost measurement).
- **X13l.** Rewrite `discard`'s docblock: one caller, `useClaims`, as effect cleanup on a slug
  change; keep the history of `useGlossary.clear()` in a sentence.
- **K12.** Replace the sync sentence with "`TreeNode` here is the authority; granularity-zoom.md
  § Node shape explains `gist` and `navLabel`". True whether or not cluster 14 has removed the
  doc's copy yet.

No test for stage 3: these are comments. The existing `tests/article-cache-group.test.ts` is the
executable statement the D4 prose is being brought into line with.

## Build review corrections

The code review restored HTML decoding before the `fetchedAt` clock read: hoisting the shared
fields into `base` had moved `opts.now()` ahead of `decodeHtml`. Never committed, and a few
milliseconds on a timestamp, so it is recorded here rather than in a postmortem.

The review also corrected surviving comment drift in the three D4 files: Relations' fingerprint
is not FAQ's; Illustrated is not last or the only artefact-consuming step; Debate still reads
the article; labels must follow Structure even though immediate adjacency is optional; and the
renderer table has three `text` stages. Ordering reasons for prerequisites and adjacency remain.
Token comparisons against HEAD confirm that those three files and `useOrderedRead.ts` still
have identical non-comment code, including their unions and tables. The two new tests' type
checks belong to `npm run typecheck`; their runtime portions alone pass with the type changes
reverted and are not evidence that the boundary types stayed narrow.

The fetched-document test's null-HTML storage argument originally lacked `bytes`, so the old
signature still rejected it for a missing field. The review supplied `bytes` through a variable:
now the directive specifically catches a flattened nullable payload type, without an excess
property error masking it. The column test's helper comment now names its actual generic
constraint rather than claiming it uses `satisfies`.

## The simpler option passed over

For X13b: keep the interface and only delete `?? ""`, throwing instead. Cheaper, but the bad
state stays representable and each consumer keeps its own null check. The union is about twenty
lines and removes the question.

For X13c: leave the casts and add a comment. That is what `public-reader.ts` already does, three
times, and it is how the count grew from 15 to 17 in a day.

## Gates

`npm run typecheck`, `npm test`, `npm run lint` on touched files. GPT Sol reviews this plan
(read-only) and then the code (workspace-write).
