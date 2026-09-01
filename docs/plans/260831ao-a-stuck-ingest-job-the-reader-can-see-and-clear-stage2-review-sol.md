Verdict: I would request changes before Stage 3. The atomic SQL transitions are sound and I found no new permanently stuck legal state, but lease expiry does not actually revoke the claimant’s write authority. Stage 3 would make that race easier to hit.

## Findings

1. High — an expired claimant can still write.

The central fences check only `id`, `attempt_id`, and `status = 'running'`: [pg-jobs.ts](/home/greg/code/spideryarn2/src/store/pg-jobs.ts:800), [jobs-fs.ts](/home/greg/code/spideryarn2/src/store/jobs-fs.ts:526). The draft and publication fences repeat the omission: [pg-revisions.ts](/home/greg/code/spideryarn2/src/store/pg-revisions.ts:540), [pg-revisions.ts](/home/greg/code/spideryarn2/src/store/pg-revisions.ts:970).

Consequently, expiration itself does not revoke the token. Only Stop or `settleExpired` winning the row first does.

If the claimant gets the lock after expiry but before settlement, its write succeeds. In the ignored-abort path it can commit an `error`/INTERRUPTED ending, so a concurrent Stop again produces the wrong reader-facing outcome. A delayed timer or direct `done` transition could publish after expiry. Postgres remains atomic; the filesystem adapter can write artifacts before its final job fence rejects the claimant.

This is compounded by two timing details:

- The self-abort timer starts only after the awaited session setup: [jobs.ts](/home/greg/code/spideryarn2/src/jobs.ts:1260).
- PostgreSQL `now()` is transaction-start time, so a claim delayed behind locks receives a backdated lease: [pg-jobs.ts](/home/greg/code/spideryarn2/src/store/pg-jobs.ts:194).

Use one live-attempt predicate everywhere, including lease freshness evaluated with `clock_timestamp()`. The filesystem fence should also require `held.expires > Date.now()`. Add a test that expires a claim without sweeping it and proves claimant writes are rejected.

2. Medium — `pending` is right for cancellation, but wrong for an unrequested interruption.

The implementation uses the same `settledSteps()` for both endings. That loses the distinction the UI needs:

- Cancelled: reset the abandoned running step to `pending`, with no error.
- Expired/interrupted: settle it as `error`, with `INTERRUPTED.message` and a terminal timestamp.

The stated duplication argument does not match the built UI. `JobCard` never renders `job.error`; it renders only steps: [AddArticle.tsx](/home/greg/code/spideryarn2/src/web/AddArticle.tsx:370), [AddArticle.tsx](/home/greg/code/spideryarn2/src/web/AddArticle.tsx:453). Thus an expired job currently shows a muted pending step and Retry, but no explanation.

The data model also describes `job.error` as repeated from the failing step: [types.ts](/home/greg/code/spideryarn2/src/types.ts:1976). Another renderer displays the job error and not the terminal step, so storing both does not currently duplicate the sentence on either surface.

3. Medium — the tests prove the main transitions, but several comments claim more than they pin.

| Test | What it genuinely catches | Broken implementation that still passes |
|---|---|---|
| Cancelling sweep | Old always-INTERRUPTED ending | Retaining stale `error`, `failureKind`, token, lease, pointer, or missing `finishedAt` |
| Stop on lapsed claim | Asking instead of immediately cancelling | Read-then-write implementation; retained token/lease/error metadata |
| Running-step settlement | `pending` and removal of `startedAt` | Rewriting non-running siblings; losing labels/details; retaining other stale fields |
| Database clock | Application time in claim and finish | Application time in `settleExpired`; wrong timestamps far in the past |
| Draft pointer | A real pointer is nulled | Non-atomic multi-statement clearing |

The clock test never invokes `settleExpired` or `requestCancel` under skew. Its timestamp assertions are upper bounds only, so epoch or substantially old timestamps pass.

## Answers to the eight questions

1. `over` is correct for every legal `ACTIVE` state.

Queued is over; running with an expired non-null lease is over; running with a live lease is asking. The database constraint prevents running with a null lease.

`coalesce(..., false)` is the conservative answer for a corrupt null-lease row, but it would leave that row permanently “Stopping…” because neither the claimant nor the sweep can resolve it. I would either make the impossible state explicit or treat null as abandoned for recovery. This is hardening, not a reachable schema-valid bug.

There is also a tiny adapter mismatch: PostgreSQL uses `<`; the filesystem adapter effectively uses `<=`.

2. Use different step endings.

`pending` for reader-requested cancellation; `error` plus `INTERRUPTED` for unrequested expiry. The current in-process cancellation path’s red step is the inconsistent behavior to normalize later.

3. “No entry in `attempts`” is safely treated as lapsed within the supported single-process filesystem adapter.

No local claimant can pass `fenced` without the map entry. It would not be proof in a hypothetical second Node process sharing the same files, but that is already outside the adapter’s synchronization model. “Two dev tabs” is therefore a misleading comment; tabs normally share one server process.

4. The row transitions themselves close the old stuck races.

- Stop versus sweep: whichever updates first wins; the other rechecks `ACTIVE` and does nothing.
- Stop versus release: Stop-first sets `cancelling`, which release resolves as cancelled; release-first produces queued, which Stop immediately cancels.
- Two Stops: idempotent on live work; one terminalizes an expired claim and the other no-ops.
- Claimant after settlement: status/token fences reject it.
- Claimant after lease expiry but before settlement: currently still accepted. That is Finding 1.

I found no legal interleaving that leaves an immovable job. A corrupt running row with a null lease is the exception created by the `coalesce(false)` recovery choice.

5. Within the job lease lifecycle, the three moved sites cover the application/database-clock mixing.

There is no remaining production caller passing an application `Date` to `settleExpired`. However, `clock_timestamp()` is needed for minting and fencing because `now()` is frozen at transaction start.

The same broader bug shape remains elsewhere:

- [pg-searches.ts](/home/greg/code/spideryarn2/src/store/pg-searches.ts:444)
- [pg-chat.ts](/home/greg/code/spideryarn2/src/store/pg-chat.ts:662)
- [pg-referee-criteria.ts](/home/greg/code/spideryarn2/src/store/pg-referee-criteria.ts:409)
- The currently latent draft sweeper: [pg-revisions.ts](/home/greg/code/spideryarn2/src/store/pg-revisions.ts:1574)

Those compare application cutoffs against database-written timestamps.

6. The tests mostly pin their headline transition, but not the full field-set, atomicity, database-clock comparison, or concurrency claims.

The most important missing tests are:

- Expire without sweeping, then assert every claimant write is stale.
- Cross expiry while blocked on a database lock.
- Sweep and Stop under ±1-hour application-clock skew.
- A cancelling fixture with real stale error metadata.
- A mixed step list proving non-running steps remain byte-for-byte unchanged.
- A rendered card proving the interrupted explanation is visible.
- Simultaneous Stop/sweep/release tests.

7. The Stage 3 API shape is good.

The neutral name and `{id, status}` result are better for owner-scoped settlement and logging. Add the owner predicate to the same atomic update and test that listing owner A cannot settle owner B’s expired job.

The optional test date before owner may make calls look like `settleExpired(undefined, owner)`; an options object would age better, but this is not a blocker.

I would fix the lease fence before or with Stage 3 because calling settlement from `listJobs()` increases the chance that it races a late claimant.

8. Other code-review observations:

- `requestCancel` correctly mirrors all important terminal fields, including the draft pointer.
- All `CASE` expressions see the pre-update row, so basing status/error/failure-kind on the original `cancelling` value is correct.
- PostgreSQL row locking makes Stop, release, and sweep linearizable.
- If `requestCancel` loses its update race, `cancelJob` can briefly return its stale pre-read job, though the client immediately polls and recovers.

I made no changes. Server and web TypeScript checks passed. The tests TypeScript project currently has three unrelated shared-tree errors. Runtime Vitest could not create its temporary files in the read-only sandbox, so I could not independently rerun the reported passing suites.