# Seventh sweep, depth: the server request path  (Opus, read-only, 2026-10-06)

Umbrella: [261006m](../plans/261006m-seventh-codebase-sweep-depth-umbrella.md). Briefs:
[common](261006d-seventh-sweep-depth-prompt-common.md),
[zone](261006d-seventh-sweep-depth-prompt-server.md). Extends
[261003b](261003b-fifth-sweep-server-request-layer.md); its R1, R4, R5, R7, R9, R10 and R11 have
landed (`f050be585`) and are not repeated. Tree: `origin/dev` at `bf78e90c7`. Nothing tracked was
changed. Finding IDs are `SVO<n>`; line numbers are today's and will go stale, so each finding
also quotes an identifier.

## What I read

`src/routes.ts` is 11,672 lines, of which 4,874 carry code (a comment stripper in the scratchpad;
the rest is prose). I read **all 4,874 code lines**, and the comments wherever the code raised a
question.

| Read | How |
|---|---|
| `src/routes.ts` | all code; comments at `serveApi`, `serveAuthenticatedApi`, the table types, `orNullWhenNotMadeYet`, `refuseAPaperNotReadYet`, the chat pre-checks, the orphan-grace constants, about twenty rows |
| `src/store/pg.ts` | the seventeen readers from `loadTweets` to `loadAssets` in full with comments (lines 3623-4405), `loadArticle` as code, the header, `currentRevision`, `articleIdForOwned`, the hash queries, `ProfileCarrying`; `REVISION_READ_POLICY`, `listArticles` and `articleMetadata` not read |
| `src/store/pg-chat.ts`, `pg-comments.ts`, `pg-searches.ts`, `pg-referee-criteria.ts`, `pg-referee-claims.ts`, `db-errors.ts`, `index.ts`, `public-reader.ts`, `pg-rate-limit.ts` | all code, comments where it mattered |
| `pg-glossary.ts`, `pg-glossary-hidden.ts`, `pg-reading-time.ts`, `pg-quiz-attempts.ts`, `pg-reader.ts`, `pg-high-power.ts`, `pg-tags.ts`, `pg-share-link.ts`, `realtime-sessions-pg.ts` (first half), `artefact-not-made-yet.ts` | all code |
| `src/public/routes.ts`, `src/stream-run.ts`, `src/searches.ts` | all code |
| `src/chat.ts` § `withTurn`, `src/quiz-mark.ts` § the abort path, `src/vercel.ts` § the last-resort catch, `src/sanitize.ts` § `sanitizeStoredBlocks`, `src/db/schema.ts` § `comments`, `referee_criteria`, `chat_threads`, `search_runs`, `realtime_sessions` | in part |

Chosen by fix-commit count since 2026-09-20 (`git log --since=2026-09-20 --format= --name-only -i
--grep=fix -- <zone> | sort | uniq -c | sort -rn`): `routes.ts` 41, `pg.ts` 24, `contracts.ts` 14,
`simple-summary.ts` 14, `citations.ts` 11, `citation-investigate.ts` 11, `public-reader.ts` 8,
`converse.ts` 8.

**Skipped, and why.** `src/store/contracts.ts` (3,028 lines, almost all interface prose; grepped,
not read). `src/store/pg-revisions.ts`, `pg-jobs.ts`, `jobs.ts`, `artifacts*.ts`,
`pg-billing.ts`, `pg-shelf*.ts`, `pg-visibility.ts`, `pg-vouchers.ts`: the write side of the
pipeline and billing, which belong to the pipeline and schema readers. The bodies of the runners
(`converse.ts`, `search.ts`, `citation-investigate.ts`, `simple-summary.ts`, `citations.ts`,
`glossary.ts`, `ideas.ts`, `quotes.ts`, `timeline.ts`, `faq.ts`, `debate.ts`, `quiz.ts`): I read
only where a route's behaviour depended on them. Feedback parsing in `routes.ts` (7285-7800) was
read as code and not questioned. Postmortems: I read the titles of all 134 dated 261003-261006 and
the body of four that name this zone (261005h ×2, 261006b, 261003g).

## What the method could not see

- **Nothing here ran against a served request.** A new test file gets a database only if it is
  entered in `TEST_LANES`, a tracked file, so I could not write a route-level reproduction. Two
  things were executed: a read-only `tsx` script calling `pgRealtimeSessionStore.find` and
  `pgUploadStore.read` against the local Postgres (SVO2), and `tests/db-referee-criteria.test.ts`
  (14 passed), which pins the database half of SVO1. A plain `node` script reproduced the
  mechanism of SVO3. Everything else is proved from code or marked H.
- **No production data was read**, so I cannot say how many criteria have a note placed on them
  (SVO1's reach) or how often a lease release fails after a stream (SVO3's).
- **No timing.** SVO9, SVO13 and SVO15 are counts of queries, not measurements.
- **Two-process behaviour** (two Vercel instances) is reasoned about, never observed.
- Client code was read only to answer "does anything call this" or "does anything read this
  field".

## Findings

Ranked by ease × value, Tier 0 first. Evidence: **R** reproduced, **C** proved from code, **H**
hypothesis. Ease and value are 1-5, 5 best.

### SVO1 — Deleting a referee criterion that has a note placed on it is a 500, and so is adding the 21st criterion  (T0 · C, database half R · ease 4 · value 4 · risk low)

- **Where.** `src/store/pg-referee-criteria.ts` § `remove` (a bare `db.delete(refereeCriteria)`)
  and § `begin`, the block under *"Trim to MAX_CRITERIA"*. `src/db/schema.ts` §
  `comments_criterion_fk`, whose comment says *"Deleting a criterion on its own still fails,
  loudly, with rows to point at"*.
- **The path.** `comments.criterion_id` references `referee_criteria` with `no action`. So
  `DELETE /api/referee/criteria/:slug/:id` on a criterion any comment is placed on raises 23503.
  `remove` does not catch it; `guardDbStore` turns it into `StoreFailure` with no status;
  `serveApi` answers 500 `[db-failed]` (*"That is a bug here rather than anything you did… It has
  been recorded"*) and reports it to Sentry. The client removes the row optimistically
  (`src/web/useCriteria.ts` § `remove`), shows that sentence, and the criterion is back after a
  reload. `CriteriaPanel.tsx`'s Delete button has no pre-check.
- **The second path, which is a wedge.** `begin` deletes the finished criteria past
  `MAX_CRITERIA` (20) in the same transaction as the insert. If the oldest one has a placed note,
  that delete raises the same 23503, the transaction rolls back, and `POST
  /api/referee/criteria/:slug` is a 500 **every time**. The referee can then neither add a
  criterion nor delete the one in the way.
- **Failing input.** Create a criterion; `POST /api/comments/:slug` with `{ blockId, quote, start,
  criterionId: <it> }` (or `PATCH …/mark`); `DELETE /api/referee/criteria/:slug/<it>` → 500.
- **How I know.** The database refusal is pinned and green:
  `tests/db-referee-criteria.test.ts` § *refuses to delete a criterion the referee has written
  against*, whose own comment reads *"So the delete fails and the UI has to offer to detach the
  marks first."* Nothing offers that: `grep -rn "comments_criterion_fk" src docs/project` outside
  `schema.ts` finds it in `routes.ts` and `types.ts`, both about the *insert* direction, and no
  handler for the delete; the hits in `tests/` are fixtures deleting comments first to avoid it. The rest is read from the four files above.
  Not run through a route (see § What the method could not see).
- **The class.** A constraint designed to refuse, with the refusal's reader-facing half never
  written. `routes.ts` § `tidyMark` already says of the insert direction that *"a foreign-key
  error becomes a generic store failure … rather than this useful bad-request answer"* and checks
  first; the delete direction has neither the check nor the sentence.
- **Smallest change that closes the 500** (a separate claim): `remove` catches the violation by
  constraint name and throws a 409 with fixed words; `begin`'s trim skips a criterion a comment
  still references, the way it already skips a `pending` one. `db-errors.ts` has
  `violatesConstraint` (23505) and `violatesCheckConstraint` (23514) and no 23503 twin, so this
  needs a third sibling there, by name, over the `cause` chain. `pg-tags.ts` §
  `rethrowTagWriteError` is the pattern to copy. Red test first: a store test in the shape of
  `tests/store-comments.test.ts`, which already seeds a criterion and a comment.
- **What Delete should do instead of refusing is a product call** — § For the owner 1.

### SVO2 — A live-session id that is not a UUID is a 500  (T0 · R at the store, C at the route · ease 5 · value 2 · risk none)

- **Where.** `src/store/realtime-sessions-pg.ts` § `find` (`eq(realtimeSessions.id, id)` on a
  `uuid` column). Routes `liveConnected`, `liveUsage`, `liveClose` in `routes.ts`, whose patterns
  admit `[\w-]+`.
- **Failing input.** `POST /api/live/not-a-uuid/connected` (or `/usage`, `/close`) from any
  signed-in account.
- **Reproduced** at the store, read-only, against local Postgres:
  `pgRealtimeSessionStore.find("not-a-uuid", owner)` throws `StoreFailure`, SQLSTATE `22P02`,
  routine `string_to_uuid`, and logs `database call failed` at error. Each of the three handlers
  calls `find` first and has no catch, so the route answers 500 `[db-failed]` and reports to
  Sentry where it means 404.
- **The sibling that got it right.** `pgUploadStore.read("not-a-uuid", owner)` returns `null` in
  the same script: `pg-uploads.ts` guards six methods with `isUploadId`. The admin rows check
  `isUuid` in the route. Three ways to handle one shape; the live store has none.
- **Reach.** The client only ever sends an id the server minted, so this needs a hand-made
  request. Low value, but it is a reported "bug here" for a typo.
- **Fix:** `find` returns `null` for a non-UUID, as the upload store does. The routes already turn
  `null` into *"No such live session."* Nothing duplicates it.

### SVO3 — `serveApi`'s catch writes a JSON error onto a stream that has already gone out  (T1, kills a class · mechanism R, sites C · ease 5 · value 3 · risk low)

- **Where.** `routes.ts` § `serveApi`, the catch's `send(res, status, { error: said, … })`, with
  no `res.headersSent` test. `git grep -n headersSent -- src/routes.ts` → 0; `src/vercel.ts` has
  one, in its last-resort catch.
- **What happens.** If a handler throws after `sse(res)`, the catch sets `res.statusCode = 500`
  and calls `setHeader`, which throws `ERR_HTTP_HEADERS_SENT`. Reproduced in plain `node`: the
  client saw 200, `res.statusCode` then reads 500, and the second throw escapes. So `logRequest`
  writes a 500 for a request that answered 200, and `vercel.ts`'s catch files a second Sentry
  event about headers instead of about the fault.
- **Two reachable sites today**, both a lease release that is a database write awaited after the
  stream has ended: `answer` § the outer `finally { release(); await freeDig?.(); }`, and
  `streamCitationInvestigation` § `finally { try { await release(); } finally { res.end(); } }`.
  `streamChat` guards itself and says why at length (*"Nothing in here may throw"*); `search`,
  `runRefereeCriterion` and `runRefereeClaims` wrap their post-stream store write for the same
  reason. Each stream keeps the rule by hand.
- **Fix:** one guard in the one catch — if `res.headersSent`, end the response if it is not ended
  and return, after the existing log and capture. Then "a stream may not throw after its headers"
  stops being a rule eleven handlers each have to keep (ten `sse(res)` callers and `streamChat`). A test: a handler that calls `sse(res)` and
  throws, driven through `handleApi`; assert it resolves and the log line says 200.

### SVO4 — The fix that made a thread's kind and origin transactional did not reach its anchor or its `help` flag  (T1, sibling drift · C · ease 4 · value 3 · risk low)

- **Where.** `src/chat.ts` § `withTurn`: an existing thread is refused for a different `kind`
  (*"That conversation is already a different kind."*) and a different `origin`, and nothing
  else. `routes.ts` § `streamChat`, the four checks inside `inTurnOrder`.
- **The fix it missed.** Postmortem
  [261005h](../postmortems/261005h-a-per-process-origin-check-leaves-the-transaction-accepting-another-origin.md)
  names the class — *"a process-local check mistaken for a transactional invariant"* — and says
  the origin check *"copied the route's anchor check"*. Its fix put origin into `withTurn`. The
  anchor check it was copied from is still route-only, and its comment still makes the claim the
  postmortem refuted: *"Read under `inTurnOrder`, so the thread cannot be created between the look
  and the write."* The `help` check beside it calls itself *"the guarantee"* for the same reason.
  `inTurnOrder` is a per-process `Map`.
- **Failing input.** Two server instances; two sends naming one new `threadId` with different
  anchors (or the second with `help: true`). The second is accepted: a question about passage B
  in a conversation stored as about passage A, or a `help` press recorded on a follow-up, which
  then gets the teaching prompt.
- **Evidence.** Proved from `withTurn`'s code. Not run across two processes; the postmortem's own
  fix was verified by a pure test for the same reason.
- **Fix:** two more refusals in `withTurn`, in the shape of
  `tests/chat-origin-transaction.test.ts`. `sameAnchor` lives in `routes.ts` and would move to
  `chat.ts`, where `sameOrigin` already is. The route checks stay for their status and sentence.

### SVO5 — `refuseAPaperNotReadYet` is a second gate kept to leave one field out of a 409  (T1, deletion · C · ease 5 · value 2 · risk low)

- **Where.** `routes.ts` § `refuseAPaperNotReadYet`, called by `search` and `runRefereeCriterion`
  one line before `loadArticle(slug)`.
- **What.** `loadArticle` refuses a minimal paper itself (`pg.ts`: *"every reader of one is told
  so the same way"*). The helper's comment says it stays ahead only because `loadArticle`'s
  refusal *"also carries the paper … which is a different 409 body from the one these two have
  always sent."* Nothing reads that difference: `git grep -n -E "not-processed|\.paper\b" --
  src/web` finds one reader of `details.paper`, `src/web/article/access.ts`, which is the article
  load. So two of the streamed routes pay one extra query to send a slightly smaller body than
  chat, claims, quiz-mark and Mirror send for the same paper.
- **Fix:** delete the function and its two calls. Check `tests/minimal-paper.test.ts` for a pin on
  the body shape first; I did not find one by grep (`refuseAPaperNotReadYet` → 0 hits in
  `tests/`).

### SVO6 — The unique-violation retry in `pgCommentStore.create` cannot run  (T1, dead code and a false comment · C · ease 5 · value 2 · risk none)

- **Where.** `src/store/pg-comments.ts` § `create`, the `catch` under *"23505 is
  unique_violation…"*: `const code = (err as { code?: string }).code; if (code !== "23505" …)
  throw err`.
- **Dead twice.** (a) The insert is `onConflictDoNothing` on `(article_id, id)`, and that primary
  key is the only unique index on `comments` (read from `schema.ts`), so the insert cannot raise
  23505; a collision returns no row and is retried by the `if (!stored) continue` above. (b) If it
  could, `db-errors.ts` § `violatesConstraint` records that *"Drizzle's wrapper carries neither
  the SQLSTATE nor the constraint name"*, so a top-level `.code` test never matches. It is the
  only bare SQLSTATE test in `src/`: `git grep -n -E '"(23505|23503|23514)"' -- src` → four hits,
  two in `db-errors.ts`, one in `pg-billing.ts` that reads `e.code ?? e.cause?.code`, and this.
- **Fix:** delete the `try`/`catch`; keep the loop.

### SVO7 — The list of artefact reads "not moved" to `200 null` names five; there are six  (T1, false count in three places · C · ease 5 · value 2)

- **Where.** `src/store/artefact-not-made-yet.ts` (*"The loaders for tweets, relations, Skim,
  Sketch and Arc still throw a plain error"*), `src/types.ts` § `NONE_YET_AS_NULL_HEADER` (same
  five), and plan 261006h § *Not one convention yet* (same five).
- **Counted.** The loaders in `pg.ts` that throw `Object.assign(new Error(…), { status: 404 })`
  for "not made": `loadTweets`, `loadRelations`, `loadSkim`, `loadSketch`, `loadIllustrated`,
  `loadArc`. **Illustrated is the sixth** and is in none of the three lists.
- **Why it matters.** The lists are the checklist for whoever finishes the move. The split itself
  (ten reads answer `200 null` on request, six a red 404) is known and left open by 261006h; I add
  only the missing name. Finishing it is § For the owner 3.

### SVO8 — The store's most-edited file opens by describing a store that was deleted a month ago  (T1, false comments · C · ease 5 · value 2)

The sixth sweep's S2 fixed a named list of filesystem-store comments. These are present-tense and
were not on it. `src/store/fs.ts` and `src/api.ts` do not exist (`ls`).

- `src/store/pg.ts:1-30`: *"Same questions as src/store/fs.ts, same answers"*, *"tests/store-parity.test.ts
  asks both stores"* (that test's own header says the second arm went on 2026-09-05), *"Nothing in
  this file may … call into src/store/fs.ts"*.
- `pg.ts` § above `rawPgArticleReader`: *"`fsArticleReader` in src/store/fs.ts is annotated the
  same way, and the twin adapters should read the same."*
- `pg.ts` § `cleanedForReading`: *"the store that is in the middle of *replacing* the filesystem
  serves old HTML unchecked."*
- `src/store/pg-reader.ts:1-3`: *"src/store/fs.ts's `fsReaderStore` … is the other."*
- Several loaders in `pg.ts` justify a fingerprint input by what the other store would have
  answered (*"while the filesystem store called it stale"*, 4 times in those words;
  `grep -c filesystem src/store/pg.ts` → 39 lines in all). Those read as history once the header
  stops saying there are two stores; I would leave them.
- Unrelated but the same kind: `src/store/public-reader.ts` § the `status: "done" as const` note
  says the value is *"constant by construction: the query refuses every other value"*, while
  `PUBLIC_COMMENTS_WHERE` admits `'none'` and `'done'`. Harmless (the DTO drops the field), false.

### SVO9 — A first chat question reads every conversation of the article up to five times before it begins  (T1, mechanical · C · ease 4 · value 2 · risk low)

- **Where.** `routes.ts` § `streamChat`: `chatStore.load(slug)` at *"const storedKind"*, then
  inside `inTurnOrder` once each under `if (wanted)`, `if (wantedOrigin)`, `if (beginKind)` and
  `if (help === true)`, each followed by the same `.find((t) => t.id === threadId)`; then
  `chatStore.begin` reads the threads again under the article lock.
- **Counted.** `load` is `articleIdForOwned` plus two selects (every thread, every message of the
  article). An anchored question started from another mode's item (`wanted`, `wantedOrigin`, so
  `beginKind` too) does four loads and `begin`: 12 queries and four full transcripts before the
  first token. A plain follow-up does one load and `begin`.
- **Why it is safe to fold.** The four checks run back to back under one lock with no write
  between them, and none is reachable on a retry or an edit (each is refused earlier for those).
- **Fix:** one `existing` read at the top of the `inTurnOrder` callback, used four times. With
  SVO4 the four checks become "the sentence", and `withTurn` the guarantee, for all four alike.

### SVO10 — `Cache-Control: private, no-store` is a habit, not a rule  (T1 · C · ease 4 · value 2 · risk low)

- **Counted** (a script over the stripped table, `rows.cjs` in the scratchpad): of 116 rows, 20
  set `private, no-store` by hand, 10 get it from `orNullWhenNotMadeYet`, and 4 send bytes, three
  of which set their own (`sendSource` sets none). Of the 51 GET rows, **25 JSON ones set
  nothing**: among them `GET /api/reader` (the reader's profile), `/api/chat/:slug` (transcripts),
  `/api/comments/:slug`, `/api/article/:slug`, `/api/library`. `GET /api/library/tags` sets it;
  `GET /api/library` does not.
- **No leak shown.** Every request carries `Authorization`, which shared caches must not store by
  default, and no validator is sent. The finding is the shape: 20 hand-written lines keep a rule
  for some rows that nobody wrote down for the rest.
- **Fix:** one `res.setHeader` in `serveAuthenticatedApi` before the dispatch, as the public
  branch of `serveApi` already does for `no-store`; delete the 20; the three binary routes that
  want `immutable` set theirs afterwards, as now. Then a new row cannot forget.

### SVO11 — Five filesystem readers are still in `src/`, kept alive by one test helper  (T1, dead code · C · ease 3 · value 2)

- `loadRuns` (`src/searches.ts`), `loadThreads` (`src/chat.ts`), `loadComments`
  (`src/comments.ts`), `loadShelf` (`src/shelf.ts`), `loadLookups` (`src/glossary-lookups.ts`):
  each reads `data/<slug>/<name>.json` with `readFile`.
- **Counted.** `git grep -n -E "\b(loadRuns|loadThreads|loadComments|loadShelf|loadLookups)\(" --
  src` leaves, after the five definitions, only `src/web/chat/controller.ts` and
  `src/web/link-facts.ts`, which are different functions with the same names. No importer in
  `scripts/`, `tools/` or `evals/` (single-line import grep; `evals/shelf-topic-clusters/hier.ts`
  defines its own). Importers in `tests/`: `helpers/seed-reader-state.ts` and the five modules'
  own unit tests.
- The fifth sweep's R9 passed this to "the store zone"; the sixth's S1 did not take it. A reader
  of `src/comments.ts` meets two ways to load comments and cannot tell from the file that one is
  a test fixture loader.
- **Fix** (a separate claim, and I have not read the helper's 400 lines): move the five into
  `tests/helpers/`, or have the helper parse the fixture files itself. `routes.ts` already records
  why no `readFile` belongs on the request path.

### SVO12 — `GET /api/comments/:slug` parses `req.url` again, and two comments say no handler does  (T1 · C · ease 5 · value 1)

- **Where.** The `COMMENTS_PATTERN` GET row: `new URL(req.url ?? "/", "http://local").searchParams.get("anchors")`,
  with `query` available on the same context.
- `serveApi` (*"no handler below has a reason to hold a URL string at all"*) and `ApiRequest`
  (*"the four route families that take parameters"*) are both out of date: `grep -c "request: {[^}]*query"`
  over the table → 10 rows read `query`, and this one reads the raw URL.
- **Fix:** `query.get("anchors")`, and "four" out of both comments. Whether the filter itself can
  go is § For the owner 2.

### SVO13 — `GET /api/reader` reads one `reader_profiles` row three times  (T1 · C · ease 4 · value 1)

`readProfile`, `readExperimental` and `readAutoModes` (`src/store/pg-reader.ts`) each select one
column of the same row; the `READER_PATH` GET row calls all three in sequence, and `patchReader`
calls the two it did not write. One `read()` returning the three columns removes two round trips
from a request every article page makes. Not measured.

### SVO14 — `queueAnUpload` hand-rolls `answerALostClaim`  (T1 · C · ease 5 · value 1)

`routes.ts` § `queueAnUpload`, the `if (!claim.ok)` block, answers `unknown` → 404, `expired` →
410, an existing job, an existing slug, else 409. `answerALostClaim`, forty lines below, is those
five outcomes in that order and is what `queueAMinimalUpload` calls. No drift today; one call
replaces the block and keeps its comments.

### SVO15 — Every `loadArticle` re-sanitises every block's HTML  (T2 · H, needs measuring · ease 2 · value ?)

`pg.ts` § `cleanedForReading` passes `undefined` as the sanitiser stamp *"until the column
exists"*, so `sanitizeStoredBlocks` re-parses each block on each load. `routes.ts` calls
`loadArticle(` 16 times (`grep -c` over the stripped file), and several callers want only ids or
text: `createFree` (is this block in the article), `spokenChat` (the set of ids), `markOneAnswer`,
`search`, the referee runners. Named and sized only: the fix is the `sanitizer_version` column the
comment already describes, on `article_revisions`. Measure one large article first.

## Siblings compared

**Artefact reads** (`GET /api/<name>/:slug`). All sixteen go through `currentRevision` →
`ownedSlug`, so ownership is uniform, and none has a public twin: a visitor gets every shared
artefact inside the one public article payload (`public-reader.ts`).

| | "Not made yet" | `Cache-Control` | `profileChanged` | Written reason for the difference |
|---|---|---|---|---|
| glossary, ideas, quotes, timeline, quiz, faq, crossrefs, simple, debate, citations | `ArtefactNotMadeYet`: 404, or `200 null` on request | `private, no-store` | yes for the five that carry a profile stamp; quotes also counts a cleared profile | yes (261006g/h; `withProfileChanged`'s parameter) |
| tweets, relations, skim, sketch, illustrated, arc | plain 404 | none | tweets, sketch, illustrated yes; skim by its own stricter rule | partly: five are listed as "not moved", Illustrated is not (SVO7); skim's rule is explained in its row; no reason for the header (SVO10) |

The set that sends `profileChanged` matches `ProfileCarrying` plus quiz exactly. That one is sound.

**Streams a reader waits on.**

| Stream | Stops the model when the tab closes | Result stored | Rate bucket | Not-read-yet gate |
|---|---|---|---|---|
| comment explanation (`answer`) | no | comment row | `dig-deeper`, deep only | `loadArticle` |
| chat | its own stop/cancel; not on close | message row | none | `loadArticle` |
| search, quick / meaning | yes / no | run row | none | own helper, then `loadArticle` (SVO5) |
| referee criterion | no | criterion row | none | own helper, then `loadArticle` (SVO5) |
| referee claims | no | one row per article | none | `loadArticle` |
| Mirror | yes | nothing | none | `loadArticle` |
| quiz mark | yes | attempt row, after | none | `loadArticle` |
| glossary ask / lookup | yes / no | lookup row | none / `dig-deeper` | `loadArticle` |
| citation investigate | no | investigation row | `citation-investigate` | `loadArticle` |
| link summary | yes | summary row | `link-summary-fill` | `loadArticle` |

The stored-result-runs-on rule the fifth sweep's R10 asked for holds except for chat (explicit
controls instead) and is unchanged. The bucket column is § For the owner 4.

**Rows that are `pending` while a model runs.**

| | Double press | Orphan rule | Whose clock | Told what when its write lost the fence |
|---|---|---|---|---|
| comment | 409 (`running`) unless the lease has expired | `lease_expires_at` on the row | database | the stored row |
| chat message | serialised per thread | `attempt_started_at` older than 150 s, or `created_at` if null | app cutoff against a database stamp | `done` with its own answer; `finish` returns nothing |
| search run | resets only an `error` run | `attempt_started_at` older than 90 s; null is swept at once | same | nothing; the stream ends |
| criterion | same as search | same, with its own window | same | nothing |
| claims | replaces the running run | `created_at` older than the window | app both sides | the current row, or `CLAIMS_SUPERSEDED` |

Each difference has a comment behind it except chat's `finish` returning `void`. I could not find
an input where that shows the reader a kept answer that was not kept, short of a turn outliving
its 150 s window, which an import-time assertion guards. Not a finding.

**A malformed id from the URL or body.** Uploads: the store returns `null`. Admin vouchers and
feedback: the route checks `isUuid`. Search runs, criteria, chat threads, comments: a bad id is
replaced by a minted one or simply matches nothing (text columns with a format `CHECK`). Live
sessions: 500 (SVO2).

## For the owner

1. **What should Delete do on a criterion you have placed notes on?** Today it fails with a
   message that says we have a bug (SVO1). Three honest answers. *Refuse and say why*: "3 notes
   are placed on this; move or clear them first" — nothing is lost, and the referee has an extra
   step. *Detach*: the notes stay, and lose their place on the scale — one click, and a placement
   somebody made is silently gone. *Delete the notes too*: the schema comment already rules this
   out (*"the referee's own sentences about the paper, which are theirs"*). The same choice
   decides what the twenty-criteria cap does when the oldest criterion has notes; skipping it, so
   the cap is "twenty plus any with notes", costs nothing a reader sees.
2. **The `?anchors=whole-block` filter on `GET /api/comments`.** Added 2026-09-12 so a tab running
   older code would not crash on a bookmark with no quote; its comment says *"Delete the filter
   once no client can be older than the parameter."* That is 24 days. Removing it deletes a
   parameter and a branch; the cost is that a tab open since before 12 September breaks. Postmortem
   261003f says a home-screen app can outlive every deploy, so this is a judgement, not a cleanup.
3. **Finishing "none yet is not a 404"** for tweets, relations, Skim, Sketch, Illustrated and Arc.
   Each is a class at the throw, the helper at the route, a header and a `null` branch in its
   hook. It removes six red console lines on an ordinary page load and one of two conventions;
   it costs six small client changes that a tab open across the deploy has to survive, which is
   why the first ten took the header.
4. **Paid calls with no per-reader limit.** The buckets that exist (`RateBucket` in
   `contracts.ts`) cover fetches and the two web-searching answers. Chat, meaning search, a
   referee criterion, a claims run, Mirror, a quiz mark, the command bar's two calls and
   dictation take none, and `POST /api/jobs { slug, steps, force }` re-runs any step on an
   existing article without a slot (billing.md: a URL spends a slot, a slug is free). I found no
   statement that this is decided; `handleApi`'s comment quotes *"spend limit per user"* as the
   reason spend is collected at all. Not designed here.

## Considered and not proposed

- **One `notFound(slug)` for the store.** Five definitions (`git grep -n "function notFound(" --
  src/store`), one exported, same words. Identical and stable; the same case as the nine
  `httpError`s the fifth sweep refused to move.
- **A shared sweep for chat, search and criteria.** The three `sweepPending` bodies differ in what
  a null `attempt_started_at` means, and each says why. Comments use a lease on the row instead,
  also explained. No drift proved.
- **Making `ChatStore.finish` report whether it wrote**, to match the other four. No input shows a
  wrong answer (table above).
- **A route-side stream shell**, again. SVO3 removes the one hazard the shell was wanted for.
- **Splitting `routes.ts`**, again. Nothing new: the cross-region references I met were the two
  the fifth sweep's review named (`refuseAPaperNotReadYet`, which SVO5 deletes, and the search
  grace constant).
- **Migrating the seven hand-rolled model loops to `runStream`.** Still two callers and seven
  loops (`git grep -c "classifyEnd(" -- src`), still no drift.
- **Reporting on abort.** Glossary ask guards `captureFailure` with `!gone.aborted` and quiz mark
  and link summary do not, which looked like drift. It is not: both runners end an abandoned
  stream by returning, not throwing (`quiz-mark.ts` § `case "abandoned"`).
- **Chat resolving the reader's profile after `begin`**, where `answer` resolves it before
  (`pg-comments.ts` says why). Chat's catch records the failure and the margin is 30 s; a
  hypothesis with no input.
- **`slugPart` used for a glossary entry id and a citation entry id** (the lookup and investigate
  rows). The store re-checks with `isSpideryarnId`; the only cost is a 400 that says "Not a slug".

## One level up

The approach is sound and I would not move any of it: one gate that mints the only `VerifiedUser`,
one ordered table with one dispatch, an owner filter inside every store read rather than in the
routes, attempt tokens on every row a model fills, and `guardDbStore` between Drizzle and the
reader. What this read found is the same thing three times at different sizes: **a refusal that
exists at one layer and was never carried to the next.** The database refuses to orphan a
referee's note and nothing tells the referee (SVO1); Postgres refuses a malformed UUID and one
store of three translates that (SVO2); a fix made the transaction own two of a thread's four
write-once facts and left the other two to a per-process lock (SVO4). `db-errors.ts` is the place
that turns a database refusal into words, and it has helpers for two of the three constraint
kinds this schema uses. The cheapest structural step is the third helper and a habit: when a
constraint is written to refuse, the sentence the reader gets is part of the same change.
