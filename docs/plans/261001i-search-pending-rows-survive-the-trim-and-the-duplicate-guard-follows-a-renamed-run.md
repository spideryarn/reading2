# Search: a running search survives the trim, and the duplicate guard follows a renamed run

Two follow-ups that [260930f-parallel-searches.md](260930f-parallel-searches.md) § Deferred wrote
down and did not fix. Parallel searches made both easier to reach. Feedback 5V
([note](../user-feedback/260930_1047-several-searches-at-once.md)) stays **shipped**, and its note
gets a line saying these two were built.

## 1. A `pending` row is never trimmed

**What happens today.** `begin` in [`src/store/pg-searches.ts`](../../src/store/pg-searches.ts)
inserts the new run, then deletes every row past the 29 newest others (`MAX_RUNS` = 30). The only
row it spares is the one it has just written. If a search is still running and enough newer
searches are begun, the trim deletes the running one. Its fenced `finish` then updates nothing, the
route sends no `done`, the reader sees "The search stopped arriving", and the paid answer is gone
after a reload.

**The change.** The trim ranks every other row exactly as now (newest first, `created_at desc, id
desc`), takes those past position 29, and **deletes only the ones that are not `pending`**. A
running search is skipped this time and becomes trimmable once it finishes or the sweep marks it
failed. The next `begin` after that removes it.

```
before:  [new] [29 newest others] | [older …]            ← all older deleted
after:   [new] [29 newest others] | [older, not pending]  ← deleted
                                  | [older, pending]      ← kept, for now
```

What this gives up: "at most thirty rows" becomes "at most thirty, plus any older rows still
marked `pending`". **That is a soft bound, not a hard one** (GPT Sol's plan review corrected an
earlier claim here). A live search ends within the model's timeout. An orphan, left by a process
that died, stays `pending` until a GET runs the sweep (`sweepPending`, 90-second grace), which marks
it `error`, and it is trimmed at the next `begin` after that. Nothing sweeps on `begin` itself, so a
tab that keeps POSTing while every process it reaches dies can pile up orphans until somebody
reloads. That needs servers dying mid-search over and over, and the cost of it is rows, not money.
If it ever matters, the fix is for the trim to treat a `pending` row older than the grace as fair
game, the same test the sweep uses.

`withRun` in [`src/searches.ts`](../../src/searches.ts) returns the trimmed list for the old
filesystem store's sake. Its `runs` output is now only read by tests. It applies the same rule, so
the two descriptions of the trim agree.

**The existing tests need changing, on purpose.** `tests/store-searches-pg.test.ts` begins 33 runs
and never finishes them, so under the new rule nothing gets trimmed. Both trim tests will finish
each run as they go. A new test covers the bug itself: an old run left `pending`, then 30 newer runs
begun and finished, and the old run still there and still `pending`. It fails before the change.

**Simpler option passed over: raise `MAX_RUNS`.** It only moves the cliff. **Also passed over:
leave pending rows out of the ranking as well**, so thirty finished rows are always kept beside any
number of running ones. That keeps more and is no simpler.

## 2. The duplicate guard follows the id the server actually used

**What happens today.** `SearchBand` ([`SearchMode.tsx`](../../src/web/modes/search/SearchMode.tsx))
records the id it sent in a `started` map (id → question) and refuses to send the same question
again while that id is running. But `begin` can answer with a different id. A retry of a run the
client thinks has failed, whose server row is actually still `pending` or already `done` (the
stream dropped on the client's side), is not a retry by `withRun`'s three-condition rule. So the
server mints a new id. `useSearch` swaps its row to the server's id, the old id drops out of `runs`,
and `SearchBand` prunes it from `started` on the next render. The same question can then be asked
again while it is still running, which pays for it twice. The ticked set (`?runs=`) also still names
the old id, so the search the reader is watching is unticked and its marks disappear.

**The change: the hook that knows the live id keeps the in-flight list.** `useSearch` already
tracks `liveId` inside `send`. It will also keep a ref-backed map of the requests in flight
(live id → trimmed question). An entry is added when `send` starts, re-keyed when `begin` answers
with another id, and removed when the request ends (on `done`, on an error, or on a silent end after
a delete). It exposes:

- `inFlight: ReadonlyMap<string, string>`, a snapshot for rendering. A small version counter in
  state is bumped on every change so the panel re-renders.
- `isRunning(question): boolean`, which reads the ref. It has to be synchronous, because two presses
  in one batch must both see the first one, which is why the current code uses a ref.
- An optional `onRenamed(from, to)` option on `useSearch(slug, { onRenamed })`, called once when
  `begin` answers with a different id. `SearchBand` uses it to swap the id in `?runs=` through
  `setActive`'s updater (held in a ref, because `useSearchMode` is called after `useSearch`).

`SearchBand` drops its `started` ref, and the `useMemo` that pruned it (it mutated a ref inside a
memo). `running` becomes `inFlight`'s keys. `onAsk` and `onRetry` ask `isRunning`.

**Simpler option passed over: have `SearchBand` re-key `started` itself** by diffing `runs` for a
row that disappeared and a new one with the same question. It is guesswork from the outside about
something the hook knows exactly, and two runs can share a question.

**Not in scope.** `useCriteria.ts` (referee criteria) is a copy of this hook with the same
`liveId` swap. Whether it has the same guard gap is noted here, not fixed.

## Tests, red first

- `tests/store-searches-pg.test.ts`: the pending-survives case above (red today).
- `tests/searches.test.ts`: `withRun` keeps a `pending` run past the cap (red today).
- `tests/search-parallel-finds.test.tsx`: a retry whose `begin` answers with a new id. The same
  question pressed again while that run is still open sends **no** second POST, with a positive
  control (a different question does send one). The new id is in the ticked set and the old one is
  not. Red today on both counts.

## Plan review (GPT Sol, 2026-10-01) and what was done

[Review](261001i-search-reliability-plan-review-sol.md): approve with changes. The trim shape and the
ref-backed registry were judged sound.

1. **P1: a rename has to move every per-id thing, not two.** A row deleted in the gap before `begin`
   answers left its tombstone on the old id, so `done` brought it back. Our DELETE named an id the
   server never had. A colour chosen in that gap was lost. **Done:** `follow` in `useSearch` moves
   the tombstone (and DELETEs the server's row at once), moves the colour choice through `recolour`,
   moves the in-flight entry, and only then tells the caller. The `?runs=` swap only replaces the old
   id if it is still there, so an untick or delete in the gap is not undone. Hook-level tests for
   the delete and the colour, both seen red with the two migrations taken out.
2. **P2: the route released its sweep protection before storing the answer.** `searching.delete`
   ran straight after the model call, so a GET landing before `finish` could sweep a row that was
   over the grace, and the answer then stored nothing. **Done:** moved into the outer `finally` in
   `search` (`src/routes.ts`). **Not tested.** It needs a request longer than 90 seconds and a GET
   in a gap of milliseconds, and there is no route-level harness for search to put it in.
3. **P2: the bound was overclaimed.** Rewritten above as the soft bound it is.
4. **P2: the test could not see a stale id left in the URL.** `ticked()` reads rows by question.
   **Done:** the panel test now reads `?runs=` itself after nuqs's throttle, and was seen red when
   the swap appended instead of replacing. The two assertions are separate. The Postgres test also
   checks that, once the slow search finishes, the next `begin` trims it.
5. **P3: the old comment said `withRun` "reset a different existing id".** It mints one. Rewritten
   on `follow`, which also names the commonest cause.

**Passed over: Sol's simpler shape**, a registry keyed by request rather than by row id, which never
needs re-keying. The panel's `running` is a set of row ids (`SearchPanel` matches it against
`runs`), so the row id has to be tracked anyway, and the re-key is five lines in the one place that
learns the new id.

## Docs

[search.md](../project/search.md) gets a sentence where it describes the cap. The 260930f
plan's Deferred items get a pointer to this plan.
