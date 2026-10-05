# Cancellation checked before an await does not authorize the next attempt

Up: [postmortems.md](../project/postmortems.md)

Review of `949fa80ba` found a cancellation boundary missing from the new
OpenRouter retry. No reader incident or additional provider charge was established.
The reachable consequence is a completed spend row for a request that an
already-aborted fetch never sends. It does not leave a pending row.

The retry checked cancellation before waiting. If the wait resolved and the
signal then aborted before the continuation, another meter could open. The
stream also called `onActivity` after the wait; that callback could abort before
the next iteration opened its meter. Successful completion of an abortable wait
was treated as continuing permission to create resources.

The fix checks cancellation at retry entry, before meter creation, in
`asTransportAttempts` and `acceptedStream` in [ai-call.ts](../../src/ai-call.ts).
It preserves the first attempt's existing behavior. The older Messages loop has
the same missing check after its wait, introduced by `64a76dff32`. The review
reported it rather than fixing it, because the candidate only moved that loop's
policy helpers; the same check was then added there
([messages-stream.ts](../../src/messages-stream.ts)), with no test of its own.

Existing tests stopped during the wait or before retry eligibility. Neither
crossed a successfully resolved wait. Six new cases in
[ai-call-transport-retry.test.ts](../../tests/ai-call-transport-retry.test.ts)
inject cancellation after wait resolution across all five seams, and from the
stream's second activity callback. They assert reason identity, request count,
spend outcomes and absence of pending rows. They were written before the fix;
they have not been observed red or green because the locked test command could
not acquire the shared lock. Source inspection establishes the missing check;
runtime validation remains outstanding.

Countermeasures, ranked by cost and value:

1. Check cancellation immediately before retry resource creation. Applied here.
2. Exercise cancellation after successful suspension and intervening callbacks,
   measuring both network attempts and accounting. Tests added; execution pending.
3. Moving the check solely into the wait helper is insufficient: later
   continuations and callbacks remain outside it.
4. A new cancellation framework is unnecessary for this class; explicit checks
   at resource creation close the boundary with fewer moving parts.
