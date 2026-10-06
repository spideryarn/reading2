# Server request path: Sol review of Opus

Reviewed at `bf78e90c7f718fb042d51f9aa394c72c335514a5`, 2026-10-06. No tracked files changed.

I traced the relevant route, store, schema and client paths. Probes used actual helpers or extracted current handler bodies with mocked dependencies; they do not establish deployed frequency or reproduce a complete request through Postgres. I did not repeat the database-dependent tests.

Verification:

```text
tests/chat-origin-transaction.test.ts: 15 passed
tests/store-guard-idempotent.test.ts:  13 passed
```

## Verdicts, in Opus ID order

### SVO1 — Criterion deletion and automatic trimming fail on placed notes

**Confirmed · C · Tier 0.**

The DELETE row calls `pgRefereeCriteriaStore.remove`, which deletes without translating errors. `comments_criterion_fk` prevents deleting a referenced criterion. `guardDbStore` produces a statusless `StoreFailure`; `serveApi` answers 500.

`begin` inserts and trims in one transaction. Its trim excludes pending criteria, but includes finished criteria referenced by comments. Deleting one rolls back the insertion. This can repeatedly block new criteria; “the 21st” is conditional on which rows fall beyond the offset, rather than universal.

The client removes criteria optimistically and does not restore the row when DELETE fails.

**Fix:** Translating this named foreign-key violation to a useful 409 is small, preserves existing protection and is safe without the owner. Add the matcher beside the existing cause-chain matchers in `db-errors.ts`; catch before the store guard removes the constraint name.

Skipping referenced criteria during trimming would fix the wedge without losing notes, but changes retention to “twenty plus protected criteria.” That affects the visible list and is a policy choice. **Owner decision required for retention, detachment or deletion semantics.** Do not change the foreign key to cascade.

### SVO2 — Malformed live-session UUID produces a 500

**Confirmed · C · Tier 0.**

The three route patterns accept `not-a-uuid`. Each handler calls `find` first; `find` binds the string directly against `realtime_sessions.id`, a UUID column. There is no validation between the URL and the database.

A local Drizzle probe produced:

```text
predicate: "spideryarn"."realtime_sessions"."id" = $1
params: ["not-a-uuid"]
```

The guard and error boundary then classify the database rejection as a 500. This review independently establishes the path, not Opus’s database reproduction.

**Fix:** Reuse `isUuid` in `find` and return `null`. The handlers already convert that to 404. Server-minted IDs pass; malformed requests newly receive the existing missing-session answer. **Safe without the owner.** No new validator or error helper is needed.

### SVO3 — The API catch attempts JSON after streaming headers

**Confirmed, with an overstated cleanup-site claim · R for the boundary, C for reachability · Tier 0.**

I extracted the actual `serveApi` and `send`, supplied a handler that completed an SSE response and then threw, and used a real `ServerResponse` attached to an in-memory socket:

```text
escaped=ERR_HTTP_HEADERS_SENT
wire=HTTP/1.1 200 OK
logged=500
captures=1
```

The unguarded `send` changes `statusCode` before `setHeader` throws. Vercel’s outer catch can consequently report the secondary failure.

The deep-comment path genuinely awaits `freeDig` after `res.end`; `admitDig` awaits the database lease update without swallowing failure.

The citation description needs qualification. Its generator normally frees the lease in its own `finally`; that rejection reaches the route’s catch, and the outer release is then a no-op. The outer release can still escape when `connection.alive()` is false and iteration never starts.

Count checked:

```text
git grep -n headersSent -- src/routes.ts
# no matches

AST CallExpression count:
sse(res): 10
plus streamChat’s separate header writer: 11 streams
```

**Fix:** Keep capture of the original failure, then return without JSON when headers have gone out; end only an unfinished, undestroyed response. This also prevents the status mutation. **Safe without the owner.**

Do not delete the handlers’ local catches: they still supply terminal frames and storage reconciliation. The central guard does not replace those responsibilities.

### SVO4 — Anchor and help checks remain process-local

**Confirmed · R for `withTurn`, C for the cross-process schedule · Tier 0, not Tier 1.**

`streamChat` checks anchor, origin, kind and first-turn help under `inTurnOrder`. That lock is a process-local map. `pgChatStore.begin` subsequently locks the article and reads current threads, but `withTurn` checks only kind and origin.

Actual helper execution:

```text
offered=spya-cccccc stored=spya-bbbbbb messages=4
accepted_later_help=true
```

The second request therefore uses the stored anchor while accepting another anchor, or records a later help turn. `converse` receives that stored anchor and the accepted user help flag.

**Fix:** Move and reuse `sameAnchor`; enforce both rules in `withTurn` before minting messages. Preserve identical-anchor resends and follow-ups that omit an anchor. Preserve the existing refusal semantics, including help’s current 400 versus anchor’s 409.

Ordinary competing first sends can reach these refusals; that is the defective schedule being closed. Existing stored threads need no migration. **Safe without the owner.** This is the independent agreement with Sol SV3.

### SVO5 — Redundant minimal-paper gate

**Confirmed · C · Tier 1.**

Both callers immediately follow `refuseAPaperNotReadYet` with `loadArticle`. The first uses `processingOf`; the second independently checks minimal processing before loading blocks or spending on generation.

`NotProcessed.paper` is optional. `declaredFields` already handles both forms. The client reader of the refusal’s `details.paper` is article access; the search and criterion consumers do not use it. `minimal-paper.test.ts` pins the article refusal with a paper, but I found no pin requiring these two refusals to omit it.

**Fix:** Delete the helper and its two calls. This removes two request paths’ preliminary queries and retains the authoritative refusal. The JSON gains an optional field for the owner’s own paper. **Safe without the owner**, with request tests preserving 409 and no model call.

### SVO6 — Comment unique-violation retry is dead

**Confirmed · C · Tier 1.**

The minted-ID insert uses `onConflictDoNothing` targeting `(article_id, id)`. That primary key is the table’s sole uniqueness constraint. A collision yields no row and already retries through `if (!stored) continue`.

The secondary assertion that a top-level SQLSTATE test can *never* match is too broad for arbitrary transaction failures; the targeted insert’s conflict handling is sufficient evidence for deletion.

The quoted grep actually has **five hits**, including a comment, and **four executable comparisons**:

```sh
git grep -n -E '"(23505|23503|23514)"' -- src
```

```text
db-errors.ts:238       comment
db-errors.ts:279       23505 comparison
db-errors.ts:288       23514 comparison
pg-billing.ts:1203     23505 comparison
pg-comments.ts:321     23505 comparison
```

**Fix:** Delete the catch and its rationale; retain the bounded no-row retry. Do not replace it with another matcher. **Safe without the owner.**

### SVO7 — Illustrated is missing from the remaining-404 lists

**Confirmed · C · Tier 1.**

AST inspection of loader bodies found:

```text
6 plain “not made” 404 loaders:
loadTweets, loadRelations, loadSkim,
loadSketch, loadIllustrated, loadArc
```

The two source comments and plan’s “Not one convention yet” paragraph omit Illustrated.

**Fix:** Correct the lists or replace repeated inventories with a signpost to one maintained location. No runtime conversion is part of this finding. **Safe without the owner.** Completing the client/server conversion is separate work.

### SVO8 — Obsolete filesystem-store comments

**Confirmed · C · Tier 1.**

The named present-tense descriptions in `pg.ts` and `pg-reader.ts` describe a second adapter that no longer exists. The public-comment assertion is also false: `PUBLIC_COMMENTS_WHERE` admits both `none` and `done`. `publicComments` drops status, so the latter is a comment defect, not a demonstrated DTO defect.

Count corrections:

```sh
rg -c filesystem src/store/pg.ts
# 39

rg -n 'while the filesystem store called it stale' src/store/pg.ts
# one exact occurrence, not four
```

There are other historical comparisons, but they are not four occurrences of that wording.

**Fix:** Correct the present-tense descriptions and the public predicate claim; retain useful historical reasons. **Safe without the owner.** Do not change public status projection merely to make the old comment true.

### SVO9 — Repeated chat transcript loads

**Confirmed, with query-total qualification · R for handler load counts, C for SQL counts · Tier 1.**

The actual handler, stopped at `begin`, produced:

```text
plain:               pre-begin loads=1, load queries=3
origin+anchor:       pre-begin loads=4, load queries=12
help+origin+anchor:  pre-begin loads=5, load queries=15
```

Each `load` performs an ownership query and two article-wide selects. `begin` then reads the threads again under the database lock. Thus 12 is the repeated-load subtotal for the given anchored request, **not the complete query total before the first token**.

**Fix:** Share one conditional snapshot among the four checks inside `inTurnOrder`. An unconditional new read would add work to plain follow-ups. Retain the earlier kind read unless its input-validation dependencies are deliberately changed.

The shared snapshot is an early-refusal aid; SVO4 supplies the transactional guarantee. **Safe without the owner**, preferably built with SVO4.

### SVO10 — Cache headers vary across authenticated routes

**Confirmed facts; proposed default is overbroad · C · Tier 1 observation, policy held.**

AST counts independently match:

```text
route rows:                         116
GET rows:                            51
rows setting private, no-store:       20
rows using the null-on-absence helper:10
GET JSON rows without either:        25
named binary GET rows:                4
```

Of those binary routes, **two** use immutable caching: assets and plates. Export uses `private, no-store`; source deliberately sets no cache header.

There is no demonstrated leak. The proposed default would change source-PDF policy. `sendSource` explicitly points to `source-route.test.ts`, whose exact-header assertion requires no cache header.

**Fix:** Do not install the proposed blanket default unchanged. **Owner decision required for a new cache policy.** If a JSON default is approved, setting it in `send` only when no policy already exists would preserve the binary and streaming policies without adding route flags.

### SVO11 — Five filesystem readers are dead code

**Overstated · C · Tier 1 candidate, not accepted as presented.**

The five functions have no production importer in the inspected `src`, `api`, `scripts`, `tools` or `evals` tree. They are nevertheless live fixture infrastructure.

Static import inspection found **ten import specifiers in six test files**, including `tests/store-parity.test.ts` importing `loadShelf`. That caller is omitted from Opus’s importer summary.

All five module headers explicitly identify their fixture readers. In particular, `comments.ts` says:

> It is a fixture reader, not a store.

So “a reader cannot tell” is wrong.

**Fix:** Moving them is possible but does not eliminate their parsing or fallback rules. It also changes the meaning of `import.meta.dirname` for four roots unless handled deliberately; `loadLookups` uses `process.cwd()` instead. Preserve chat’s legacy-kind normalisation and the distinct malformed-file behaviour.

No new drift justifies a relocation stage. **Reject from the build list.** A carefully scoped future move would be safe without the owner.

### SVO12 — Comments reparses the URL

**Confirmed · C · Tier 1.**

The GET row reparses `req.url` solely to read `anchors`; the dispatcher already supplies `query`. Ten rows destructure `query`; the comments row is an additional consumer through the raw URL.

Those ten include admin feedback, admin costs, library routes, feedback, reader, link preview, link summary and chat, so the old four-family description is stale.

**Fix:** Use `query.get("anchors")`, preserving the filter, and remove the stale count. **Safe without the owner.** Removing the compatibility filter remains an owner decision.

### SVO13 — Reader state requires three row reads

**Confirmed · C · Tier 2, low priority.**

GET reads profile, experimental date and auto-mode state through three separate selects. With a slug, `resolveProfileParts` performs the profile read alongside the shelf read; it does not remove that profile query. PATCH writes one field and reads the other two.

**Fix:** No combined reader-store method already exists. A combined read needs a contract change, adapter implementation and route integration. Reuse or relocate the existing three-field `ReaderState` shape rather than defining it twice.

Preserve profile normalisation, ISO dates, and absent-row defaults `(null, null, true)`. Keep column-specific writes; replacing them with a whole-row write would reopen lost updates. Characterise GET before extracting; do not automatically broaden PATCH.

**Safe without the owner, but defer pending measurement.** Repeated queries alone do not prove enough value for a new interface.

### SVO14 — Upload claim handling duplicates its existing helper

**Confirmed · R for outcome equivalence · Tier 1.**

Both paths use the same owner, queries, outcome order and fixed errors. Extracted current functions produced:

```text
unknown: equal=true → 404
expired: equal=true → 410
job:     equal=true → existing job
article: equal=true → existing slug
other:   equal=true → 409
```

**Fix:** Call `answerALostClaim`. It already owns the behaviour; this deletes a copy without adding machinery. **Safe without the owner.** Bundle it with other route edits; no separate stage is warranted.

### SVO15 — Article reads re-sanitise stored HTML

**Confirmed mechanism; performance value remains unverified · C/R for cleaning, H for expense · Tier 2 held.**

`loadArticle → blocksFor → cleanedForReading` always supplies an undefined stamp. `sanitizeStoredBlocks` consequently maps every block through DOMPurify. The public reader independently does the same.

AST count confirms **16 `loadArticle` calls in `routes.ts`**. This is a call-site count, not request frequency.

A probe demonstrated the stamp’s security significance:

```text
undefined stamp → script removed, stale=true
current stamp   → original script retained, stale=false
```

**Fix:** A column alone is insufficient. Every writer must earn the stamp by cleaning the exact stored HTML, and copied revisions must preserve or invalidate it correctly. Never backfill current stamps onto unchecked legacy HTML. Integrate both owner and public readers.

The existing sanitizer already supports stamps; reuse it. **Safe without the owner only after measurement and a verified write/stamp design.** Until then, retain the safe cleaning default.

## Agreements

| Opus | Sol | Independent conclusion |
|---|---|---|
| SVO4 | SV3 | Anchor and first-turn help lack transactional enforcement. |

This is the direct independently reached finding.

Both documents also enumerate the same ten opt-in null reads and six remaining plain-404 reads. That supports SVO7’s count, though Sol did not nominate the stale lists as a finding.

## Disagreements and coverage differences

- **SVO4’s tier:** Sol is right to classify it as Tier 0. The helper demonstrably accepts the conflicting turn; this is more than prospective invariant cleanup.
- **SVO11’s description:** The readers are used and explicitly documented as fixtures. They are not an ambiguous second live store.
- **Criterion refusal protection:** The route’s pre-check does not make placement safe against deletion between validation and writing; see below.
- **Sol SV1, absent from Opus:** Independently reproduced with the actual `withEdit`, `requireTail` and extracted `settleThread`:

  ```text
  aborted=true
  rejection=This conversation has moved on since you opened it. Reload before editing.
  ```

  Validate the existing expected tail before aborting; retain the transactional check.

- **Sol SV2, absent from Opus:** Independently reproduced from the actual explanation handler:

  ```text
  current:  body=new note, colour=blue
  terminal: body=old note, colour=yellow
  ```

  The successful store patch already returns current comments. Send the matching returned row rather than the beginning snapshot.

Sol SV4’s glossary comment correction also survives: Ask calls `addTerm`, and Lookup calls `admitDig`. Its scope is independent of Opus’s filesystem-comment cleanup.

## Missed by both

**SVR1 — Placement can race criterion deletion · P1 · C · Tier 0.**

`tidyMark` reads the criterion, then comment creation or `patchMark` performs a separate write. Neither shares a transaction with criterion deletion.

An ordinary two-tab schedule suffices:

1. Placement validation reads an existing criterion.
2. Another tab deletes that criterion while it has no referencing comments.
3. The placement INSERT or UPDATE reaches `comments_criterion_fk`.
4. The unhandled violation becomes a 500.

Reuse SVO1’s named foreign-key matcher in the comment write paths and return a fixed stale-placement refusal. Keep the early validation. This preserves data and requires no owner decision. Not reproduced against Postgres.

## Build order and overlaps

Tier 0 first; all items touching `routes.ts` should share one worktree or land sequentially.

| Order | Work | File overlap |
|---|---|---|
| 1 | SVO1 useful DELETE refusal + SVR1 placement refusal | `pg-referee-criteria.ts`, `pg-comments.ts`, `db-errors.ts`, store tests. Same worktree. Retention policy held. |
| 2 | Sol SV1 stale-edit abort + SVO4/SV3 transactional anchor/help; fold SVO9 reads | `routes.ts`, `chat.ts`, chat tests; store verification also covers `pg-chat.ts`. |
| 3 | Sol SV2 current comment completion + SVO3 streamed-error boundary | `routes.ts`, explanation/boundary tests. |
| 4 | SVO2 malformed live ID | `realtime-sessions-pg.ts`, existing `ids.ts` helper, focused tests. Disjoint from the route edits if validation stays in the store. |
| 5 | SVO5, SVO6, SVO12, SVO14 | `routes.ts` and `pg-comments.ts`: overlap with orders 1–3; bundle after those fixes. |
| 6 | SVO7, SVO8, Sol SV4 factual corrections | `pg.ts`, `pg-reader.ts`, `public-reader.ts`, `types.ts`, artefact error comment, plan, `routes.ts`. |
| Held | SVO10 cache default; SVO1 retention | Owner decisions. |
| Held | SVO13 combined reader read; SVO15 sanitizer stamp | Measurement and characterisation first. Both overlap earlier store/comment work. |
| Rejected | SVO11 relocation | No new defect or drift justifies it. |

The live-defect fixes fit the existing error matchers, returned store data and transaction boundaries. None requires a route split, registry or stream shell.