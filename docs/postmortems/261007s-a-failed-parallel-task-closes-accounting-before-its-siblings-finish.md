# A failed parallel task closes accounting before its siblings finish

Up: [postmortems.md](../project/postmortems.md).

Found during review of `f3367eed1`, before this review's fixes were committed. No reader
request is involved, and no paid API or database was used to reproduce it. The converted
evals could still lose ledger rows when one parallel generator failed; the amount previously
lost through this path is unknown.

## The class: fail-fast completion mistaken for completion of owned work

`Promise.all` rejects as soon as one task rejects. The remaining tasks still run. Opening
`withLedger` around that aggregate gives it ownership of those calls, but closes the collector
when the first failure returns. [`collectSpend`](../../src/ai-spend.ts) deliberately rejects
late records after closing; awaiting its existing writes cannot drain calls that have not
finished yet.

The ordinary trigger in [`plain-words/answers.ts`](../../evals/plain-words/answers.ts) is an
answer rejected for an unacceptable ending while its explanation and chat siblings are still
being generated. The same shape occurs in the summary/glossary pair and parallel glossary
runs, and when one article in a multi-article eval fails to load or finds an existing output.
The two long-document spikes also put parallel slice calls inside one collector; a preflight
failure in one slice can close that collector while another slice's call is running.

The collector wrappers in `f3367eed1` introduced this lifecycle mismatch. `git log -S` on
the glossary-people wrapper confirms that commit; its `Promise.all` itself dates to
`468a82e6c0`. The commit correctly added durable sinks, but carrying the old aggregate into
the new resource scope made failure return before that scope's work was complete.

## Why the checks missed it

The refusal tests exercise missing, sinkless and closed collectors. They establish that a
call starts with a sink, but cannot establish that its owner stays open until the call ends.
Successful parallel runs satisfy both conditions, so happy-path readback also misses this.

## Fix and countermeasures, ranked by ease against value

1. **Drain already-started siblings before returning failure.** Applied to the seven converted
   evals using the existing [`allOrStop`](../../src/concurrency.ts), with a no-op stop because
   these calls are already bought. The heterogeneous summary/glossary tuple uses
   `Promise.allSettled` and rethrows a rejection after both finish. This is the long-term
   ownership fix, rather than allowing records to enter a collector that has already reported.
2. **Test a real converted entry point with a failed task and a delayed paid sibling.**
   [`eval-ledger-failure-drain.test.ts`](../../tests/eval-ledger-failure-drain.test.ts) mocks
   providers and persistence, while using the real collector. It failed before the fix
   because the entry finished before the sibling; after the fix both rows reach the sink
   and `lateCalls()` remains zero.
   [`long-document-ledger-failure-drain.test.ts`](../../tests/long-document-ledger-failure-drain.test.ts)
   covers the same failure ownership in both long-document spikes. These catch the lifecycle
   class without buying a call.
3. **A blanket ban on `Promise.all` inside evals — rejected.** Independent per-task
   collectors and tasks that convert errors into values already drain correctly. A text scan
   cannot distinguish those from an aggregate owning unfinished paid work.
4. **Let closed collectors accept later rows — rejected.** That would publish a total before
   its rows settle, and resurrect the drain race documented in `collectSpend`. Ownership
   belongs at the parallel work boundary.

The practical check is whether failure means all owned work finished, not merely whether the
awaited expression has settled.
