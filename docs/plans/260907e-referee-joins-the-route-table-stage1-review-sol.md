Verdict: revise before relying on Stage 1 as complete. No P0s. I found one P1 and three P2s.

- **P1 — claims lock release is untested.** Deleting `pullingClaims.delete(slug)` leaves both claims cases green. Add the claims equivalent of the criteria stale-retry assertion after the request settles. [test](/home/greg/code/spideryarn2/.claude/worktrees/referee-into-the-route-table/tests/referee-stream-lifetime.test.ts:414)
- **P2 — the claims age assumption is not pinned.** Ten minutes currently exceeds `CLAIMS_ORPHAN_GRACE_MS`—210 seconds—but the final tripwire checks only `CRITERION_ORPHAN_GRACE_MS`. If the claims timeout grows beyond ten minutes, its lock test silently becomes invalid. Backdate relative to each exported grace, or assert both constants. [claims grace](/home/greg/code/spideryarn2/.claude/worktrees/referee-into-the-route-table/src/store/pg-referee-claims.ts:101)
- **P2 — `settled` has a one-microtask observational hole.** The exact Stage 2 `void withSpendAttribution(...)` defect still fails, but the boolean can briefly remain false after the underlying promise is fulfilled.
- **P2 — an early pre-generator response becomes a 60-second timeout.** Race `reached()` against `call.promise` so wrong routing or an early failure reports “request settled before entering the generator” immediately.

Answers:

1. **The current lock assertions are causally valid.** Criteria is pending, older than 150 seconds, and therefore survives only through `keep`. Claims is older than its 210-second grace and survives only because `live === true`; there is no third guard. The claims grace drift above is the future false-positive hole.

2. **Not perfectly sound.** Promise fulfillment queues the attached `.then`; it does not run it synchronously. If the gate and request are resolved in the same job, gate first, `settled()` can read false for one microtask. I confirmed that ordering directly. However, the exact launch-and-resolve closure settles well before these generators reach `arrive()` because each route performs awaited database work first, so that mutation is caught. An extra `await Promise.resolve()` after `reached()` removes the named hole.

3. **`arrive()` is correctly placed.** Code after the first `yield` runs only when the route has consumed and handled that frame and requests the next one. But yes: a wrong matcher, wrong handler, or pre-stream failure can settle the request without entering the generator, leaving `reached()` unresolved until the suite timeout. That is a diagnostic weakness, not a false green.

4. **Confirmed:** criteria sweeps on `attemptStartedAt`; claims sweeps on `createdAt`. The claims case catches moving `pullingClaims.delete(slug)` above the blocked work, but **does not** catch deleting it. That is a real coverage gap and the P1.

5. **Yes.** For the Stage 2 launch-and-resolve mirror closure, `handleApi` settles before the blocked generator reaches its checkpoint, making the mid-stream settlement assertion fail. The synchronous `ended` flag and post-release assertions provide additional coverage; mirror has no meaningful store or lock oracle to add.

6. **Safe.** `importOriginal` evaluates each real module, so it does not suppress module-scope side effects. These three modules contain imports, constants and function declarations at module scope; provider access and `loadEnvLocal()` occur inside the replaced generators. Spreading snapshots exports rather than preserving live bindings, but none of the retained exports is mutable in a way these routes depend upon.

7. **The registry entry is correct.** `withSpendAttribution` only overlays context and invokes its callback; it creates no ledger row. Rows arise through gateway `beginSpend`/`recordSpend`, which the three stubs bypass. With zero recorded calls, `collectSpend` never invokes `costStore.record`. `fixture-loader` is therefore the only applicable condemned mechanism. [registry](/home/greg/code/spideryarn2/.claude/worktrees/referee-into-the-route-table/tests/store-migration-registry.ts:1188)

8. **No coupling to the guards’ current form.** The tests enter through `handleApi`, use the public methods and paths, mock the underlying generators, and observe responses and stores. They do not inspect local regex bindings, guard order, private sets, or source form. Moving the routes into `AUTH_ROUTES` should require no test edit.

I attempted the targeted suite, but this environment cannot reach the local Postgres/Docker port (`EPERM 127.0.0.1:54362`), so I could not independently reproduce the green run. No files were changed.