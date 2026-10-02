# A later abort state does not explain an earlier failure

Up: [postmortems.md](../project/postmortems.md) · feature:
[261002e quick search](../plans/261002e-quick-search-v1.md)

Found in review on 2026-10-02, before the requested landing. Mocked requests reproduced a provider
failure reported as a timeout. No paid call or reader-data write was needed; no reader incident is
known.

## The class: current cancellation state substituted for the first cause

In [`src/quick-search.ts`](../../src/quick-search.ts), a chunk fails promptly with HTTP 502. The
outer catch cancels its peers and awaits their cleanup. If cleanup crosses the deadline, the later
`deadline.aborted` check reports a timeout instead of the refusal that ended the search. A later
reader disconnect can similarly replace its cause with abandonment.

The checks asked what was true **after cleanup**, although their error messages claimed what
caused the failure. An abort flag records state; it does not establish causal order. Introduced by
**`c549dda30`**, the original quick-search feature commit, confirmed by blame on the catch's
`signal?.aborted` and `deadline.aborted` branches.

This differs from [the recursive-drain bug](261002e-an-aggregate-rejection-does-not-settle-its-descendant-work.md):
it occurs with top-level chunks alone, even when every request is correctly drained and accounted
for. One defect ends ownership too soon; this one explains an earlier event using later state.

## Why nothing went red

The original failure test cancelled peers immediately; the timeout test started with a stalled
provider. Neither crossed the deadline **during cleanup of another failure**.

The new “does not relabel a provider refusal” regression in
[`tests/quick-search.test.ts`](../../tests/quick-search.test.ts) uses a 30 ms deadline and 60 ms
cancellation cleanup. Red-first, it expected status 502 and received an `ai-slow` error instead.
It now requires the original 502 plus both accounting outcomes, one error and one aborted.

## The fix and countermeasures, ranked by ease against value

1. **Cross a deadline during failure cleanup in a test.** Added; it distinguishes the first cause
   from later state without network access or real delays of twenty seconds.
2. **Classify the first composite abort reason.** Implemented with the existing composed signal.
   Its retained reason decides whether reader cancellation or the deadline ended the work; an
   internal cancellation preserves its original failure. This is the long-term fix too.
3. **Skip draining to report errors sooner — rejected.** It restores the accounting defect.
4. **A general event-history framework — rejected.** The existing signal already retains the
   ordering fact needed here; a second chronology would add machinery without improving evidence.

Error classification must use the cause captured when work stops, even when cleanup takes longer.
