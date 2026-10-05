# A live hold before the cleanup boundary survives stream setup failure

Review of [261005i](../plans/261005i-q-yeses-four-store-and-route-correctness-fixes.md) reproduced
a comment-answer marker surviving a failed SSE header or begin-frame write. The next comments GET
still handed that id to the abandonment sweep's keep set. No production incident was established;
the reproduction used the real route with store leaves replaced, without Postgres or a model call.

Up: [postmortems.md](../project/postmortems.md).

## Acquisition before the cleanup boundary

`answer` in [routes.ts](../../src/routes.ts) acquired its live hold, then opened SSE and wrote the
begin frame, before entering the `try/finally` that released it. Either setup write could throw.
The request then ended while the process kept claiming it was answering the comment. Even an
expired database lease could not make that row collectable on this process: the keep set spared it.
The deep-search allowance's release lived behind the same boundary.

The gap is present in `f862af5e8`, which added the counted `beganAnswering` helper to an answer
route whose cleanup covered the model loop. `d5a445c32` extracted that count into `liveKeys` and
retained the placement. Search, Criteria and Claims already protected setup with an outer
`try/finally`; the comment lifetime tests exercised successful setup and overlapping calls only.
The abstraction's own release tests could not detect a handler that never called its release.

## Fix and checks

The hold now sits immediately before an outer `try` enclosing SSE setup and the existing stream
handling. Its `finally` releases the hold and the deep-search allowance. Response ending stays
with the model loop, so a setup failure still reaches the existing HTTP error handling.

[comment-answer-marker.test.ts](../../tests/comment-answer-marker.test.ts) fails the header and
begin-frame writes separately, confirms that each failure was reached without calling the model,
then observes the actual keep set supplied by the subsequent GET. Both cases were red with the
retained id, then green after the boundary moved. This checks the route's cleanup, not database
sweep behavior or delivery over a real socket.

Countermeasures, ranked by cost against value:

1. Exercise setup failure as well as success for each acquired resource. The two new cases are
   cheap, and complement the existing stream lifetime tests.
2. Put acquisition immediately before its cleanup `try`, including setup inside the boundary.
   This is the long-term fix here, with no replacement abstraction needed.
3. Reject a new generic stream runner for this stage. It would change several handlers' error
   and cancellation policies to repair one missing boundary. A syntax-only adjacency check
   would also be weaker than the route tests: it cannot prove the right key is released.
