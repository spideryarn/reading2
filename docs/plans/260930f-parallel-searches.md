# Several meaning-searches running at once

**Status: built, on `dev`** (see § Outcome). From feedback SPIDERYARN-READING2-5V (report
`spya-xxt0z5`), sent by Greg from an admin account on
`/read/dongetal25-spya-vfmvmm?mode=search`:

> In the search mode, I want to be able to kick off multiple searches in parallel.
>
> — Greg, 2026-09-29

Note: [docs/user-feedback/260930_1047-several-searches-at-once.md](../user-feedback/260930_1047-several-searches-at-once.md).

## What "a search" is today, and what stops a second

A **search** is one saved meaning-search: a `SearchRun` row (`search_runs`), minted client-side by
`useSearch.ask`, answered by one streamed `POST /api/search/<slug>`. It is not a queued job, so the
job queue's parallelism work from report 4C
([260929c](260929c-modes-generate-in-parallel-on-one-article.md)) and its
`SPIDERYARN_JOB_CONCURRENCY` limit do not reach it.

Every layer below the button already handles several at once:

- **Server** (`search` in `src/routes.ts`): each POST is its own stream and its own row, keyed
  `slug/runId` in `searching`. `searchStore.begin` takes the article lock only for the insert, never
  across the model call. No per-reader or per-article cap.
- **Client hook** (`src/web/useSearch.ts`): `send` is per id — tombstones, `liveId`, colour choices
  and PATCH chains are all keyed by run id. Nothing in it is single-flight.
- **Wiring** (`SearchBand` in `src/web/modes/search/SearchMode.tsx`): a new ask *appends* its id to
  `?runs=`, so the first search stays ticked and streaming.

The one thing that stops a second is in `Box` in `src/web/SearchPanel.tsx`:

```ts
const ready = matcher === "meaning" && loaded && draft.trim().length > 0 && !busy;
```

where `busy` is "any **ticked** search is still pending". So Find and Enter are refused while a
search runs — unless the reader unticks it first, which already let a second one start. That
workaround is the proof the rest of the stack copes.

## The change

1. **Find no longer waits for a running search.** `!busy` comes out of `ready`. The spinner in the
   box stays: it still says something is out.
2. **The one refusal kept: the same question twice while it is still running.** The draft stays in
   the box after Find — that is the current behaviour, and it is what lets a reader edit
   "arguments against X" into "arguments for X" without retyping (the same workflow ↺ exists for).
   With the busy gate gone, a second Enter or double-click on an unchanged box would spend a second
   model call on an identical question. So `ready` also requires that no run *this tab started and
   is still waiting for* (ticked or not) has the same trimmed criterion. The retry button follows
   the same rule. A persisted `pending` row cannot count: the opening GET may have left a fresh
   orphan inside the 90-second sweep grace, and without polling it would wedge that question in
   this tab until reload. The button's tooltip says why when that is the reason it is off.
   Case-sensitive, exact, trimmed — the same `criterion.trim()` `ask` sends.

No server change, no schema change, no change to streaming: each search still streams its own
hits as they arrive.

### The simpler option passed over

Only delete `!busy`. It is one token, but it turns an impatient double-press into two identical paid
searches with two rows and two colours — the thing the busy gate was incidentally preventing. The
duplicate check is one `some()` over runs the panel already has.

### Also passed over: clear the box after Find

The chat-composer convention, and it would also stop duplicates. It changes what happens to the
draft on every search, not only the parallel case, and takes away edit-into-the-next-question,
which Greg has protected before (the matcher switch keeps the text: *"if I have text in the input
box when I switch from words to meaning or vice versa, preserve it."* — Greg, 2026-08-26). Named
here so Greg can choose it if he prefers.

## Tests

A new `tests/search-parallel-finds.test.tsx`, mounting the real `SearchBand` over the real
`useSearch` with a mocked `apiFetch` (the harness `tests/opening-read-gates-writes.test.tsx` uses),
POSTs held open so the first search is still pending:

- ask Q1, change the box, ask Q2 → **two POSTs**, both rows on screen as searching, both ids in the
  ticked set. Red before the change (second POST never sent).
- with Q1 still pending and the box unchanged, Find and Enter send **nothing**; positive control:
  after Q1's `done` lands, the same press sends.
- both streams complete in either order and both runs end `done` with their own hits.

## Deferred

- **No cap on how many run at once.** Each is one model call billed to the reader's own use; a
  reader starting ten is a reader asking ten questions. If cost says otherwise, a cap belongs on the
  server beside `searching`, not in the button.
- **HTTP/1.1's six connections per origin.** In local dev (plain HTTP/1.1) each running search
  holds one; six at once plus the page's other streams would queue in the browser. Production on
  Vercel is HTTP/2, one connection. Not worth engineering around.
- **`MAX_RUNS` (30) trims at `begin`**, and the trim protects only the row it has just written. If
  thirty newer searches were begun while one was still running, the trim would delete the running
  one. Its fenced `finish` would then update nothing, the route sends no `done`, the reader sees
  "The search stopped arriving", and the paid search is gone on reload. That needs thirty
  concurrent searches on one article, so it is accepted rather than fixed. The stronger fix is to
  leave `pending` rows out of the trim. (GPT Sol's plan review, finding 4.) **Fixed 2026-10-01**
  that way:
  [261001i](261001i-search-pending-rows-survive-the-trim-and-the-duplicate-guard-follows-a-renamed-run.md).

- **A `begin` that answers with a different id stops the duplicate guard tracking that search.**
  `SearchBand` records the id it minted; when `beginRun` resets an existing row instead
  (`withRun` in `src/searches.ts`), `useSearch` swaps the row to the server's id and the minted one
  drops out of `started` on the next render. The same question could then be asked again while it
  runs. That needs the reset path and an impatient second press together, so it is noted, not fixed.
  **Fixed 2026-10-01**: the in-flight list moved into `useSearch`, which knows the server's id (and
  it is a mint, not a reset) —
  [261001i](261001i-search-pending-rows-survive-the-trim-and-the-duplicate-guard-follows-a-renamed-run.md).

## Plan review (GPT Sol, 2026-09-30) and what was done

[Review](260930f-parallel-searches-plan-review-sol.md): approve with changes.

1. **P1: two asks before a render could untick the first.** `setActive` takes an updater, and every
   active-set write now goes through a ref advanced synchronously before nuqs receives the concrete
   list. nuqs's own functional updater does not close the batched case: it refreshes the ref it
   reads inside a React state updater, which a batch defers. The first built version documented the
   hole and relied on React flushing between discrete events; code review replaced that claim with
   the accumulator and a test that performs two active-set writes in one batch.
2. **P2: one error banner shared by parallel searches.** Accepted as it is. A *transport* failure
   is stored on its row but its message is visible there only as a tooltip, so the shared banner is
   the only place it can be read without hovering. (A model failure arrives as a `done` run and has
   no banner; the first version of this paragraph blurred those two paths.) A new search clearing
   an earlier transport failure's banner is pre-existing behaviour, because a failed run was never
   `busy`. The new case is Q1's transport failing while Q2 runs, and there the banner keeps saying
   Q1 failed after Q2 finishes, which is true and now tested.
3. **P2: tests.** Added: hits interleaving across two streams before either `done`, each traced to
   its own search by the row's `found by …` label, with a "2 still searching" / "1 still searching"
   count. Also model and transport failures while the other search finishes, the duplicate refused
   even when the running search is unticked, persisted pending rows not wedging the box, retry not
   duplicating an in-flight criterion, and two active-set writes composing inside one React batch.
4. **P2: `MAX_RUNS`.** Restated above with its visible failure.

## Outcome

Built as planned plus the reviews' changes. `src/web/SearchPanel.tsx` (`ready`, retry and the
tooltips), `src/web/modes/search/SearchMode.tsx` (this tab's in-flight requests and the active-set
accumulator), `tests/search-parallel-finds.test.tsx` (eight cases; the first was red before the
change), and
[search.md § Asking the next question before the last one answers](../project/search.md).
