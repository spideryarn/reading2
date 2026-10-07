# Seventh sweep, C6: small server request-path defects and dead branches

Up: [plans.md](../project/plans.md) ·
umbrella: [261006m](261006m-seventh-codebase-sweep-depth-umbrella.md), cluster **C6**, as changed by
its § What the review changed (U7, U13, U16, U18).

Eight small things on the server's request path: two requests that answered 500 and should not
have, three pieces of code that could not run or ran twice, one URL parsed twice, the unfinished
half of "none yet is not a 404", and comments describing a store that was deleted a month ago.
Evidence:
[the Opus finding](../investigations/261006d-seventh-sweep-depth-server-request-path-opus.md)
(SVO2, 3, 5, 6, 7, 8, 12, 14),
[Sol's review of it](../investigations/261006d-seventh-sweep-depth-server-review-sol-on-opus.md) and
[Opus's review of Sol](../investigations/261006d-seventh-sweep-depth-server-review-opus-on-sol.md)
§ SVO2. Where a review corrected a finding, the review was followed.

**The rule for the whole cluster:** the two fixes change what a failing request gets and nothing a
successful one gets; each deletion had a characterisation test green before and after; and nothing
under `src/web/` was touched.

## What landed

| # | Item | Was | Is | Shown first? |
|---|---|---|---|---|
| 1 | **SVO2.** `POST /api/live/<not-a-uuid>/connected`, `/usage`, `/close` | 500 `[db-failed]` and a Sentry report (SQLSTATE 22P02: a string compared with a `uuid` column) | 404 *No such live session.*, the answer a well-formed unknown id already got | Red at the route on all three |
| 2 | **SVO3.** A handler that throws after its response has started | `serveApi`'s catch wrote JSON anyway: `ERR_HTTP_HEADERS_SENT` escaped, the request line said 500 for a 200, and a second Sentry event was filed | The fault is captured once; the response is not written to and its status is not changed; it is ended only if nobody ended or destroyed it | Red with a real `ServerResponse`, four cases |
| 3 | **SVO6.** The 23505 retry `catch` in `pgCommentStore.create` | Could not run | Deleted. The no-row retry beside it is the one that works | Characterised: green before and after |
| 4 | **SVO5.** `refuseAPaperNotReadYet` | A second gate before `loadArticle` in search and in a referee criterion, one extra read each | Deleted. `loadArticle` refuses the same paper | Characterised on both routes |
| 5 | **SVO12.** `GET /api/comments/:slug` | Parsed `req.url` again for `?anchors=` | Reads the parsed `query` | Existing test covers both answers |
| 6 | **SVO14.** `queueAnUpload`'s lost-claim block | A copy of `answerALostClaim` | Calls it | Characterised through the route, six cases |
| 7 | **"None yet is not a 404", the other six reads** | Plain `Error` with `status: 404` | **Half done: see below.** The six loaders throw `ArtefactNotMadeYet`; the routes still answer 404 whatever is sent | Loader type red on all six; route 404s pinned |
| 7 | **SVO7.** The list of reads not moved | Three copies (four with `web-client.md`), each naming five of six | One list, in `src/store/artefact-not-made-yet.ts`; the others point at it | — |
| 8 | **SVO8.** Comments describing the filesystem store in the present tense | — | See § 8 | — |

## 1. A live-session id that is not a UUID

`find` in [`src/store/realtime-sessions-pg.ts`](../../src/store/realtime-sessions-pg.ts) returns
`null` for an id that fails `isUuid` ([`src/ids.ts`](../../src/ids.ts)). All three handlers call
`find` first and already answer `null` with the 404, so the store's writes below it are covered by
the one guard. Only a hand-made request can send such an id: the client sends back what the server
minted.

**The same shape elsewhere: none found that is unguarded.** Every other route that binds a
URL-supplied string to a `uuid` column already checks it:

- `/api/uploads/:id` and `POST /api/jobs { uploadId }`: `isUploadId`, in the route and again in six
  methods of `pg-uploads.ts`.
- `/api/admin/vouchers/:id`, `/api/admin/voucher-emails/:id/retry`: `isUuid` in the handler.
- `/api/admin/feedback/:owner/:id` and its `/screenshot`: `isUuid(owner)` and `isSpideryarnId(id)`;
  the feedback cursor in `?before=` checks its owner part with `isUuid` (`src/types.ts`).

Every other captured id is a slug or a `spya-` id held in a `text` column. Not checked: ids that
arrive in a request **body** and reach a `uuid` column other than `uploadId` (I found none by
grepping `routes.ts` for `body.*Id`; a body parsed in another module would not show there).

## 2. A throw after the headers are out

One guard in `serveApi`'s catch, after the capture: `if (res.headersSent)`, end the response if it
is neither ended nor destroyed, and return. No handler's own catch was touched; those send the
terminal frame and reconcile what was stored, and this cannot do either.

[`tests/serve-api-after-headers.test.ts`](../../tests/serve-api-after-headers.test.ts) uses a real
`ServerResponse` on an in-memory socket. Every other route test hands `handleApi` an object whose
`setHeader` does nothing, and a function that does nothing cannot throw `ERR_HTTP_HEADERS_SENT`,
which is why no existing test could have seen this.

**Corrected in code review:** the first build logged such a fault at `info`, because its level
followed the status the reader received (200). The review keeps that wire status in the line but
uses the catch's failure status for severity, as `logging.md` requires. Four new assertions were
red before the fix; the successful-stream control remains `info`.
[sentry-error-monitoring.md § What reaches it](../project/sentry-error-monitoring.md#what-reaches-it-and-what-does-not)
says so.

## 3. The retry that could not run

The insert is `on conflict (article_id, id) do nothing`, and that primary key is the table's only
unique index, so a minted id that collides returns no row. The loop's `if (!stored) continue`
already retries that, three times. The `catch` tested a top-level `.code === "23505"` that
Drizzle's wrapper does not carry.

Characterised by steering `mintUniqueId` onto an id that is already a row
([`tests/store-comments.test.ts`](../../tests/store-comments.test.ts) § *a minted id that is already
a row*): minted again with the existing row untouched; `CommentIdTaken` after exactly three tries; a
failure that is not a collision is not retried. A fourth case pins the premise, that `comments` has
one unique index. `rethrowPlacementError` (cluster C5) is untouched.

## 4. One minimal-paper gate

`loadArticle` gives a paper not yet read through the same 409, sentence and code. The only
difference was that the helper's body left out `paper`, and the one reader of that field under
`src/web` is the article load (`article/access.ts`). So search and a referee criterion now send
exactly what chat sends for the same paper. Pinned on both routes in
[`tests/minimal-paper.test.ts`](../../tests/minimal-paper.test.ts), including that no `search_runs`
or `referee_criteria` row is written.

**Code review found a case that pin missed:** an article born minimal has no published revision
until metadata finishes. The old gate saw its processing state; `loadArticle`'s revision join
did not, so these two routes changed from 409 to 404. `loadArticle` now asks the existing
owner-scoped `processingOf` only when the revision read finds nothing, preserving the saved read
on the successful path. The pure reader regression was red first and is green; two Postgres
route cases also pin the refusal, zero written runs and the other owner's 404, but were not run
in the review sandbox.

## 5. One parse of the query string

`query.get("anchors")`. The two comments that said "four route families" read a query string lost
the number; ten rows do, and the next one would have made any number wrong again.

## 6. One answer to a lost claim

The block's comments moved onto `answerALostClaim`, where both callers now read them.

**Two things the characterisation found:**

- **An elapsed grant alone cannot produce `expired` on the full-import path.** That path
  claims with `arrived: true`, which drops the grant's expiry from the `WHERE`, so a pending row
  always wins despite an elapsed grant. The test forces the claim's answer to cover that branch
  independently of Stop; an already `expired` row now returns `expired` below.
- **A Stop that landed between the route's look and the claim was answered with the wrong sentence**:
  409 *"That upload is already being turned into an article."* `claimUploadIn`
  (`src/store/pg-uploads.ts`) read every status but `pending` as `taken`, an upload the reader
  cancelled included. `resolveExistingUpload` answers the same row 410 when it gets there first.
  **Fixed in code review, with explicit review authorization:** `claimUploadIn` now answers
  `expired` for an expired row, and the Stop test expects the same 410 and existing sentence as
  the earlier lookup. That Postgres test was updated but not run in the review sandbox.

## 7. "None yet is not a 404": half done, and why

**The brief was: add the opt-in header to the six remaining reads, on the server only. That is not
possible on the server only.** A route that answers `x-spideryarn-none-yet-as-null` with `200 null`
needs its name in `NONE_YET_AS_NULL` in `src/web/lib/api.ts` in the same change, so the browser's
offline cache does not keep the `null` and replay it to a tab that never asked for one.
`tests/api-fetch-offline.test.ts` reads `routes.ts` and fails when the two lists differ; plan
261006h put that guard there on purpose. `src/web/` was out of this cluster's scope, so the route
half was not done.

What did land:

- **The loader half.** `loadTweets`, `loadRelations`, `loadSkim`, `loadSketch`, `loadIllustrated`
  and `loadArc` throw `ArtefactNotMadeYet` where they threw a plain `Error` with `status: 404`. The
  status, the sentence and every response are unchanged; nothing catches the type on these routes
  yet.
- **The six pinned as they are**: 404 with the header and without it, the same body, and a
  different one from "no such article"
  ([`tests/none-yet-is-not-a-404-route.test.ts`](../../tests/none-yet-is-not-a-404-route.test.ts)
  § `STILL_404`).
- **No reason for any of the six to stay a 404 is written anywhere** in the code or in
  `docs/project/`.

**What is left, for whoever may touch `src/web/lib/api.ts`** — two edits per read, together:
`orNullWhenNotMadeYet` around the store read in its GET row, and its name in `NONE_YET_AS_NULL`.
Then move the name from `STILL_404` to `ROUTES` in the route test and add it to `NONE_YET_READS` in
`tests/api-fetch-offline.test.ts`. No hook has to send the header for that to be safe; until one
does, the six behave exactly as now. Three of the six rows wrap their load in another helper
(`withProfileChanged` for tweets, sketch and illustrated) and Skim reads beside `resolveProfile`,
so "only `load`" needs care there.

**SVO7.** The list of reads not moved existed in `artefact-not-made-yet.ts`, `types.ts`, plan
261006h and `web-client.md`, each naming five when there were six (Illustrated was missing). It is
now in `artefact-not-made-yet.ts` alone, and the other three point at it.

## 8. Comments that described a deleted store

Comment-only. `src/store/fs.ts`, `src/api.ts` and `src/store/realtime-sessions-fs.ts` were all
deleted on 2026-09-05 (`86a4ef7c0`, `f8798186c`); these comments spoke of them in the present
tense. Each rewrite was checked against the code it sits on, and each keeps the history, since the
history is still the reason.

| Where | Said | Now says |
|---|---|---|
| `src/store/pg.ts`, header | "Same questions as src/store/fs.ts"; the parity test "asks both stores"; nothing "may … call into src/store/fs.ts" | The only store since 2026-09-05; what the second one was; and that the many "the filesystem store called it stale" comments below are history and still the reason |
| `src/store/pg.ts` § `cleanedForReading` | "the store that is in the middle of *replacing* the filesystem serves old HTML unchecked" | Past tense, and that this is the one `loadArticle` now |
| `src/store/pg.ts` § `rawPgArticleReader` | "`fsArticleReader` … is annotated the same way, and the twin adapters should read the same" | The reason that still holds (a test parses the annotation), with the other as history |
| `src/store/pg-reader.ts`, header | "`fsReaderStore` … is the other"; a pointer to `patchReaderFile`, which does not exist | Past tense; the dead pointer removed |
| `src/store/realtime-sessions-pg.ts`, header | "The filesystem half is realtime-sessions-fs.ts … the store flag picks one at boot" | The only implementation. **Not on the investigation's list**; found while fixing item 1 |
| `src/store/public-reader.ts`, the comments' `status: "done"` | "constant by construction: the query refuses every other value" | The query admits `'none'` and `'done'`, this writes `done` for both, and that is harmless only because the DTO drops the field. The code is unchanged, as the review said it should be |
| `src/routes.ts`, above `GET /api/metadata/:slug` | "stat-ing every file for it" | What `articleMetadata` costs today: the step rows, and every block read, cleaned and hashed |

**Checked in code review:** `readSketchFile` still exists in `src/sketch.ts` and rejects empty
scenes, so its reference stays. The Sketch and Illustrated descriptions of a current second
store, the nonexistent `sameMark` pointer and the constant public-comment status claim were
corrected. Moved upload comments now describe the deletion race, the interval before `noteSlug`
and the in-flight winner correctly; the comment retry explanation no longer assigns every
23503 to reminted block ids.

The review's root causes and the checks that would catch these lifecycle gaps are in
[261007d](../postmortems/261007d-the-tested-state-is-not-the-whole-lifecycle.md).

## Mutations

Each fix or pin was broken on purpose at the end, and its test watched red:

| # | Mutation | Went red |
|---|---|---|
| 1 | `find`'s `isUuid` guard switched off | the three non-UUID cases in `live-session-routes`, 500 each |
| 2 | the `res.headersSent` guard absent (the state before the fix) | four of five in `serve-api-after-headers`; the control stayed green |
| 2 | `!res.destroyed` dropped from the guard | *a response the reader already dropped is not ended a second time* |
| 3 | the no-row retry gives up after two tries, not three | *gives up after three tries* in `store-comments` |
| 4 | `loadArticle` stops refusing a minimal paper | both *refuses … as chat is refused, and stores nothing* cases in `minimal-paper` |
| 5 | `query.get("anchorz")` | *shows whole-block bookmarks only to a client that opts into their anchor shape* in `routes` |
| 6 | `answerALostClaim`: `unknown` → 400, `expired` → 409, the winner's job not returned | the 404, 410 and job cases in `uploads-api` |
| 7 | `loadSkim` back to a plain `Error` with `status: 404` | *skim: the loader says "not made yet" with the type the helper reads* |
| 7 | `GET /api/arc` wrapped in `orNullWhenNotMadeYet` with no name in the offline list | *arc: a 404 with the header and without it* (it answered `200 null`), **and** `api-fetch-offline` § *matches exactly the GET routes that go through orNullWhenNotMadeYet* — the guard that stopped the route half of item 7 |

Not mutated: item 6's *article* and *409* answers and its pinned Stop case (three of the helper's
six outcomes were, in one run); item 3's *is minted again* and *does not retry a failure that is
not a collision* cases; item 8, which is comments.

## Gates

Run on 2026-10-07 after merging `origin/dev`, by file, never the full suite:

- `npm run typecheck`: clean, all three projects.
- 32 files, 1,381 tests, all passed: every test that reads `src/routes.ts`, `src/store/pg.ts` or
  another touched source file as text, `doc-links`, `store-migration-registry`,
  `api-fetch-offline`, `serve-api-after-headers`, the two other `none-yet` suites.
- 13 files, 355 tests, all passed: `routes`, the live-session and live-GPT route suites,
  `store-realtime-sessions`, `store-comments` and the comment route suites.
- 17 files, 353 tests, all passed: `minimal-paper`, the upload suites, `none-yet-is-not-a-404-route`,
  the artefact-read suites, `store-parity`, `public-visibility-pg`, the referee Postgres suites.
- Biome on the touched files: no errors (seven pre-existing complexity notes in `routes.ts` and
  `pg.ts`).

This plan was `261007c` in the first commits of the branch, and their messages still say so; the
schema cluster's plan took that letter on `dev` while this one was being built.
