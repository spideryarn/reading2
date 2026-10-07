**Verdict: do not ship. One established P1 remains.**

**F31 — P1, established: a pending peer can expire before its timer runs, yet admission continues.**

In `src/structure-slices.ts:468`, admission checks `stopped`, cancellation and the overall deadline. It does not check the elapsed caps of pending peers.

Reproduction:

1. Start slices A and B together; keep A pending.
2. B returns an invalid answer at `239999 ms`.
3. B’s synchronous parsing crosses the cap boundary, reaching `240001 ms`. A’s timer cannot dispatch during that work.
4. B immediately starts its re-ask, after A’s `240000 ms` cap.

Observed: **three calls**, followed by `out-of-time`. Returning fallback afterward does not undo the forbidden admission.

The runnable regression copies the coordinator into `/tmp`, substitutes the model transport, and uses the real request/parser/builder:

```bash
node --import tsx /tmp/stage-e-expiry-regression.ts
# Fails: 3 !== 2

PROBE_FIX=1 node --import tsx /tmp/stage-e-expiry-regression.ts
# Passes: two calls; all cap timers cleared
```

Smallest demonstrated closure: track active caps and inspect them immediately before every admission.

```ts
// In runSlices:
const activeCaps = new Map<AbortController, number>();

// In ask, before the existing admission checks:
if ([...activeCaps.values()].some(cap => Date.now() > cap)) {
  return refused("out-of-time");
}

// Immediately after creating this call's controller:
activeCaps.set(own, expiresAt);

// In the existing finally:
activeCaps.delete(own);
```

Validation: all **55 existing tests passed** across `structure-slices-adversarial`, `structure-slices-queue` and `structure-step-slices`, run separately. A real streaming-wrapper probe with stubbed `fetch` counted all three transport attempts, including failures, and left no pending ledger entries.

No repository files changed; no network or Postgres access.