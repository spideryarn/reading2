# An aggregate rejection does not settle its descendant work

Up: [postmortems.md](../project/postmortems.md) · feature:
[261002e quick search](../plans/261002e-quick-search-v1.md)

Found in review on 2026-10-02, before the requested landing. Mocked provider responses reproduced a
missing accounting row; no paid call or reader-data write was needed. No reader incident is known.

## What happened

Jev refuses an oversized chunk, so `askChunk` in
[`src/quick-search.ts`](../../src/quick-search.ts) splits it into two concurrent children. If one
child fails, its `Promise.all` rejects immediately while the other child's cancellation cleanup is
still running. The generator aborts and drains its **top-level** tasks, but the split's aggregate
promise has already rejected: draining that promise does not wait for its surviving child.

The generator can therefore throw before the child's meter finishes. `collectSpend` closes its
scope then, and `recordSpend` rejects a late finish rather than writing its ledger row
([`src/ai-spend.ts`](../../src/ai-spend.ts), `collectSpend` and `recordSpend`). The search correctly
reports failure while its accounting quietly loses a request.

Introduced by **`c549dda30`**, “261002e: quick search — a meaning search in about a second, on Jev”,
confirmed by `git log -S` and blame. Its outer catch promised that every meter would finish before
the generator threw; that promise covered the first level only.

## The class: an aggregate rejection mistaken for descendant completion

An aggregate's rejection does not end the work it started. A parent must keep its promise unsettled
until its children finish cleanup, at every level. Cancellation and draining are separate operations.

The nearby [`allOrStop`](../../src/concurrency.ts) already documents this for immediate peers.
Its contract would not rescue a nested aggregate whose promise stops representing its descendants.

## Why nothing went red

The existing failed-chunk test covered only top-level siblings, whose cancellation rejected
immediately. The halving test covered a successful retry. Both passed while the combination was
broken: a failed child of a split, with another child taking time to stop.

The new “drains a halved chunk's aborted sibling” regression in
[`tests/quick-search.test.ts`](../../tests/quick-search.test.ts) failed red-first: `finishedAtClose`
expected `true`, received `false`. It checks scope closure, no pending call, and three recorded
outcomes — one aborted and two errors. Reading a mutable report after cleanup would weaken that
evidence.

## The fix and countermeasures, ranked by ease against value

1. **Delay cancellation cleanup in a nested-failure regression.** Added red-first; it checks
   ownership at scope closure without a provider or database.
2. **Drain at each recursive fan-out boundary.** Implemented in `askChunk`: abort the search,
   await both children with `allSettled`, then rethrow. This is the long-term fix as well as the
   narrow review patch; top-level draining now reaches every descendant.
3. **Preserve the cause before cancellation starts.** The first drain patch exposed another race:
   a fast unrelated top-level abort could reach the outer catch before the split finished draining
   its original 502. The second regression received `DOMException: Aborted` instead of status 502.
   The controller now retains the original failure as its abort reason; the test requires the 502
   and all four accounting outcomes.
4. **A new task-tree framework or a collector that waits for arbitrary detached work — rejected.**
   Both widen the change and move ownership away from the code creating the children. Existing
   cancellation machinery plus recursive draining closes the demonstrated class with fewer parts.

Both new focused regressions passed against the final review patch. Ask whether every awaited
promise still represents all the work its caller believes it owns after an error.
