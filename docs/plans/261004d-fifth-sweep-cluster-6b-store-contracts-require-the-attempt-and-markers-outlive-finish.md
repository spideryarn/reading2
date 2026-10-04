# Fifth sweep, cluster 6b: the store contracts require the attempt, and Referee's live markers outlive `finish`

Cluster 6b of [the fifth codebase sweep](261003f-fifth-codebase-sweep-umbrella.md). Two items:
**DP-D3** ([evidence](../investigations/261003b-fifth-sweep-data-and-pipeline.md), § D3, and the
Opus review beside it) and **XZ-X5**
([evidence](../investigations/261003b-fifth-sweep-deploy-scripts-and-cross-zone-leads.md), § X5).
Its prerequisite, 6a, landed as [261003h](261003h-referee-answers-are-not-lost-or-overwritten.md).

Up: [plans.md](../project/plans.md).

## What is wrong, in plain words

A model call that answers a search, a comment, a chat turn or a referee criterion is given an
**attempt token** when it starts, and has to show it when it writes its answer. That is what stops
a slow, abandoned call writing over the retry the reader is watching.

**D3.** The store contracts in `src/store/contracts.ts` still say the token is optional. It was
optional for the filesystem store, which had no tokens and was deleted on 2026-09-05. The one store
left refuses a write without a token, at run time. So the compiler approves a call that the only
implementation rejects, and a test double can leave the token out and still satisfy the contract.
This is the unfinished Stage H of
[260903f](260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md) § Two things it omits
entirely. Search's and Criteria's `finish` also take a `Partial` of the whole row, while the store
writes four fields and refuses any status but `done` or `error`, again only at run time.

Re-checked against today's tree (`b8a8e1c3c`): every optional signature the audit named is still
there, at `contracts.ts` lines 508, 618, 1081, 1145, 1260, 1279, 1350 and 1364. Claims was already
made strict by 6a.

**X5.** While a criterion or a claims run is in flight, this process keeps a marker (`refereeing`,
`pullingClaims` in `src/routes.ts`) so that a page load's sweep does not declare the run dead. Both
handlers drop the marker when the model call ends, **before** the answer is stored, and they add it
before a step that could throw. Search had both shapes and they were fixed in `1714d1aa3`: one outer
`finally` from the marker to the stored answer, and a map from key to holder so that an older run
finishing cannot drop a newer run's marker. The Opus review found the model-to-store gap narrow for
Criteria (a run has to have outlived its own timeout plus thirty seconds). The holder check fixes
overlap in both handlers: Claims allows two tabs to start runs for the same article; Criteria
allows a pending row to be deleted and its supplied id reused while the deleted request still
runs. The first request to finish must not remove the marker the second still needs.

## What changes

### Stage 1: X5, the markers (`src/routes.ts`, two handlers)

`refereeing` and `pullingClaims` become `Map<string, symbol>`, as `searching` is. In each handler:
the marker is set straight after `begin`, everything after that is inside one `try`, and the
`finally` deletes the key only if this request is still its holder. `sse(res)` moves inside the
`try`. `liveCriteria` reads the map's keys; `pullingClaims.has(slug)` keeps working.

Red first, in `tests/referee-stream-lifetime.test.ts`, which already holds a stream open and ages a
row past the grace so only the marker can spare it:

1. **Criteria: the marker is held while `finish` runs.** Wrap `refereeCriteriaStore.finish` so that,
   before the real write, it ages the row and issues a `GET` (which sweeps). Today the sweep buries
   the row and the stored status is `error`; after, `done`.
2. **Claims: the same**, through `refereeClaimsStore.finish`.
3. **Claims: an older run finishing does not release a newer one.** Two overlapping POSTs; the first
   finishes; the run is aged; a `GET` must still find it `pending`. Today it is swept to `error`.
4. **Criteria and Claims: a response that throws while the stream is opened does not pin the
   marker.** A fake response whose `on` throws; afterwards an aged `pending` row must be
   swept. Today the marker stays for the life of the process.

5. **Criteria: an older deleted run finishing does not release its replacement's marker.** DELETE
   can remove a pending row without cancelling its model call, and POST can reuse that now-absent
   supplied id. Those requests overlap in one process. The holder map is a fix here too, rather
   than only consistency with Search. This case was added during code review; its execution is
   pending because the review sandbox denies connections to local Postgres.

### Stage 2: D3, the contracts

| Contract | Today | After |
|---|---|---|
| `CommentStore.beginAnswer` | `attempt: string \| undefined` | `attempt: string` |
| `CommentStore.patch` | `patch: AnswerPatch, attempt?: string` | `patch: AnswerFinish, attempt: string` |
| `Turn` (Chat) | `attempt: string \| undefined` | `attempt: string` |
| `ChatStore.appendSpoken` | returns `Turn` with `attempt: undefined` | returns `StoredExchange`: thread, user, reply, no attempt |
| `ChatStore.finish` | `opts?: { attempt?: string \| undefined; now? }` | `opts: { attempt: string; now? }` |
| `SearchStore.begin` / `finish` | `string \| undefined` / `patch: Partial<SearchRun>, attempt?` | `string` / `patch: SearchFinish, attempt: string` |
| `RefereeCriteriaStore.begin` / `finish` | the same | `string` / `patch: CriterionFinish, attempt: string` |
| `ClaimsFinish` | `Partial<ClaimsRun> & { status }` | the four writable fields, and the status |

`SearchFinish` is `{ status: "done"; hits; model? } | { status: "error"; error }`, and
`CriterionFinish` the same with `results`. `AnswerFinish` is `AnswerPatch` with a required
`"done" | "error"` status. `Turn` becomes `StoredExchange & { attempt: string }`, which is the split
Sol asked for in 260903f.

The four adapters take the new types. **The run-time refusals stay** (`MissingAttempt`, and the
three "must end a …" errors), for a caller that got round the types with a cast; their comments stop
citing the filesystem store. `MissingAttempt`'s docstring predicted its own removal here, and it
gets a sentence saying why it stayed.

Chat's patch stays `Partial<ChatMessage>`. Its store has no "must be terminal" rule to move into the
type, and the audit says to handle Chat separately. Named here so it is a decision.

Red first: a new `tests/store-contracts-require-attempts.test.ts` of `@ts-expect-error` lines, one
per signature above: a call with no attempt, a `pending` finish, a `finish` that sets `criterion`,
and reading `.attempt` off `appendSpoken`'s result. It is red against the old contracts under
`npm run typecheck`: newly enforced calls leave unused directives and required return guarantees
fail their typed assignments. It cannot go red under `npm test`, which does not type-check; the file says
so. Existing tests that exercise the run-time refusals keep doing so through an explicit cast.

Comments (`contracts.ts`, the four adapters, the handlers) that explain the optional token by the
filesystem store are rewritten to say what is true now.

**Callers that must change for it to compile** (Sol's plan review, F1): in `src/routes.ts`, Search's
`let patch: Partial<SearchRun>` becomes `SearchFinish`, Criteria's becomes `CriterionFinish`, and the
comment answer's `settle` takes `AnswerFinish`. In `tests/comment-sweep.test.ts` the helper
`nowPending` returns `string`. Valid calls are narrowed; a cast is kept only for the cases whose
subject is the run-time refusal.

**What each compile-time line witnesses** (F2): a returned token is checked by assigning it to a
`string`, since leaving out an argument cannot test a return type; every refused call sits beside
the valid call it differs from by one thing; Claims' new restriction is probed with `sourceHash` and
`createdAt`, because its missing-attempt and `pending` refusals predate this plan and prove nothing
about it. The baseline diagnostic of each line was read, not only the exit code.

## The simpler option passed over

**Only delete the `?`**, leaving the `Partial` patches. It is most of the value for a third of the
diff. Passed over because the umbrella names the `Partial` patch as part of the item and the callers
already build exactly the two shapes the union names. The adapters keep independent defined-field
writes: structurally typed variables can carry additional writable fields, and narrowing the types
must not silently discard fields the store previously persisted. If the union costs more at call
sites, this falls back to `Pick` plus a required status, which is what `AnswerFinish` is.

## Not here

- **The fingerprint order in Criteria and Search**, which 6a left "for 6b or a client cluster":
  both stores read the article's hash inside `begin`, before the handler loads the blocks it sends.
  It changes `begin`'s signature and the order of a 404 against a write, so it is its own slice;
  the debrief recommends it.
- The live panel's stale mark and *Try again*, in `src/web/`: a client cluster.
- `routes.ts` beyond the two Referee handlers and the comments at the fenced call sites. Cluster 8
  follows.

## Gates

`npm test` for the touched suites alone, then `npm run typecheck`, `npm run lint` on touched files.
GPT Sol reviews this plan read-only, then the code with write access.

## What landed

2026-10-04, in two commits: `37a078408` (both stages) and the review fixes after it.

- **X5:** `refereeing` and `pullingClaims` are maps to a holder; both handlers hold the marker from
  the pending row to the stored answer. Six cases in `tests/referee-stream-lifetime.test.ts`.
- **D3:** the table above, as written, with one change from review: the Search and Criteria
  adapters still write every defined field of a patch, so the union constrains what a caller may
  build and not what the store does with a value that got past it.
- **For cluster 8:** nothing in `src/routes.ts` moved except inside `runRefereeCriterion`,
  `runRefereeClaims`, the two marker declarations, three type annotations and one import. No route
  row, pattern or `withSpendAttribution` wrap was touched.
- **Left over:** the marker's ordering assumption (above), and the fingerprint order in Criteria and
  Search (§ Not here).

## Code review, 2026-10-04

The Search and Criteria union-arm SET clauses changed accepted writes: a variable satisfying an
arm can also carry writable fields from the other arm. An isolated probe executing each old and
new `finish` method with a captured query showed four differences (error and done, both adapters).
Restoring defined-field writes made all four comparisons pass. Store regression cases were added
in `store-searches-pg.test.ts` and `referee-stream-lifetime.test.ts`; no existing production caller
with mixed fields was found.

Criteria's one-process overlap was incorrectly ruled out; the DELETE/reuse path is described in
Stage 1 and now has a test. Obsolete filesystem explanations on the affected signatures were
removed. Removing all fourteen compiler directives produced exactly the diagnostics they name.

The review sandbox could not reach local Postgres, so the reviewer could not run its own database
tests or the mutation checks. **They were run afterwards, outside the sandbox:** `npm run typecheck`
green; the lifetime file, `store-searches-pg`, `referee-criteria-store`, `comment-sweep`,
`store-chat-pg` and `routes` green (248 tests). Two mutations, each put back: releasing the Criteria
marker without the holder check turns *a deleted run finishing does not release its replacement's
lock* red (`expected 'error' to be 'pending'`), and writing `error` only on the error arm turns
Search's *keeps carried writable fields* red. The five original marker cases were each seen red
before the fix existed, which is the stronger form of the same check.

A wider, pre-existing scheduling risk remains for the shared Search/Referee marker design:
`begin` responses need not resolve in database commit order. A delayed older response could replace
a newer request's marker and then remove it when its fenced finish matches nothing. This is
reasoned, not reproduced against Postgres here. Tracking every active request per key would avoid
that ordering assumption; this review leaves that shared design change for the parent to decide.

**Decided: not here.** It is in `search` as much as in the two Referee handlers, it predates this
plan, and the harm needs two `begin` calls to answer out of order *and* the newer run to outlive
its grace. The repair is small and would replace the holder with a count per key (live while any
request holds it), in all three handlers at once. It goes to the Overseer's queue with that
recommendation, so `routes.ts` is free for cluster 8.
