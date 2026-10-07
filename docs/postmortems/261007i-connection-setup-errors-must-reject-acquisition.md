# Connection setup errors must reject acquisition

Caught in review on 2026-10-07 before deployment; nothing reached a reader. The proposed
[migration runner](../../scripts/db-migrate.ts) timeout setup could fail after giving its caller
a connection without the intended limits.

**Introduced:** the uncommitted patch under review, based on HEAD `09a2f8e3f9a0948979d261db29644927c5297b00`;
the original file blob was `82070da5f`. No committed version introduced this defect.

**Class: connection initialization published before success was validated.** A synchronous
`connect` listener queued the `SET` ahead of later queries, but discarded its promise with `void`.
Query ordering was mistaken for an initialization success gate. Queueing first does not stop the
next query when setup fails; successful setup and failure propagation are separate obligations.
The repository sweep found no sibling pool `connect` setup listener under `scripts/`, `src/`, or `tests/`.

**Evidence:** the review's injected SET failure made the original `Pool.connect()` resolve and
produced one unhandled rejection. With the fix, acquisition rejected, the failed client was
closed, and the count was zero. A two-client deferred-setup probe also failed before and passed
after: both connections must finish setup before acquisition resolves. No production write was run.

**Countermeasures, ranked by ease against value:**

1. Await safety-critical initialization through the acquisition hook — implemented with pg's `onConnect`, which destroys the client and rejects acquisition on failure. This is the long-term fix.
2. Inject setup rejection and delayed completion at the connection boundary — done in the review probes; a successful `SHOW` alone exercises neither failure nor acquisition timing.
3. Add a logging `.catch()` to detached setup — rejected: it handles the promise but still hands out an unsafe connection. A global unhandled-rejection handler has the same gap.

Up: [Postmortems](../project/postmortems.md).
