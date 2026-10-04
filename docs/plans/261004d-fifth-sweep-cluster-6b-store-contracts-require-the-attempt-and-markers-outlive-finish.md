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
finishing cannot drop a newer run's marker. The Opus review found the harm narrow for Criteria (a
run has to have outlived its own timeout plus thirty seconds), so this is a **consistency repair**,
not a counted defect. For Claims the overlap is reachable in one process: two tabs each start a run
for the same article, and the first to finish removes the marker the second still needs.

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
   marker.** A fake response whose `writeHead` throws; afterwards an aged `pending` row must be
   swept. Today the marker stays for the life of the process.

Not tested: a Criteria holder overlap. One process cannot produce it (a retry needs the row to be
`error`, and only another process's sweep can make it so while this one holds the marker). The map
is still used, so the three handlers have one shape.

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
and reading `.attempt` off `appendSpoken`'s result. It is red today under `npm run typecheck` (every
directive is unused) and cannot go red under `npm test`, which does not type-check; the file says
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
diff. Passed over because the umbrella names the `Partial` patch as part of the item, the callers
already build exactly the two shapes the union names, and a union lets the adapters drop four
`=== undefined` spreads each. If the union turns out to cost more than that at the call sites, this
falls back to `Pick` plus a required status, which is what `AnswerFinish` is.

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

(filled in at the end)
