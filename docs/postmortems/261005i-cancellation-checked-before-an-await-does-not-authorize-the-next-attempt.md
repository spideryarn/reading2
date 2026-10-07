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

> **Note, 2026-10-07.** The paragraph above records validation as outstanding, but the
> [transport plan's gates](../plans/261005j-the-other-ai-wires-fail-a-whole-call-on-one-dropped-connection-a-countable-retry-on-the-openrouter-seams.md#gates) already recorded
> the six cases red and green before this sweep (see the
> [Sol cross-review](../investigations/261006d-seventh-sweep-depth-pipeline-review-sol-on-opus.md#pqo6-tests-allegedly-never-seen-red)).
> They were run again here. With `if (n > 1) options?.signal?.throwIfAborted()`
> deleted from `asTransportAttempts`, the four non-stream seams' *opens no attempt when the signal
> aborts as the backoff finishes* fail (`expected undefined to be DOMException`). With
> `if (attempt > 1) options.signal.throwIfAborted()` deleted from `acceptedStream`, the stream's
> case of that name and *opens no retry if the activity callback aborts after the wait* fail
> (`expected 2 to be 1`). All 260 pass with both lines back. The Messages loop's check now has a
> test of its own too: *a Stop as the backoff finishes leaves one row, and opens no attempt 2* in
> [messages-stream.test.ts](../../tests/messages-stream.test.ts), red with that line deleted.
> [The plan](../plans/261007e-seventh-sweep-pipeline-tidy-one-successor-rule-and-the-dead-filesystem-session.md#item-3-pqo6-two-tests-seen-red-and-the-missing-one) has the runs.

Countermeasures, ranked by cost and value:

1. Check cancellation immediately before retry resource creation. Applied here.
2. Exercise cancellation after successful suspension and intervening callbacks,
   measuring both network attempts and accounting. Tests added; execution pending.
3. Moving the check solely into the wait helper is insufficient: later
   continuations and callbacks remain outside it.
4. A new cancellation framework is unnecessary for this class; explicit checks
   at resource creation close the boundary with fewer moving parts.
