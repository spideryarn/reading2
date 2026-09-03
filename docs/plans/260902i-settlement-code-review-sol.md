## Verdict

**Do not ship this stage as complete.** The normal `pgStoreSession` path is atomic and its cancel/publication fencing is sound, but the “five sites” claim is false at the exported `JobStore` boundary. There are two additional terminal paths that leave reservations unsettled, after which retention can delete the only provenance.

All findings below are **reasoned**, not reproduced: the required suite failed loudly because this sandbox denies the local Postgres connection (`EPERM 127.0.0.1:54362`). I did run the complete TypeScript coverage check successfully: all three projects passed, covering 1,097 source files.

## Findings

### 1. High — exported `finish` and `releaseStep` are sixth and seventh terminal paths, with no settlement

Files: [pg-jobs.ts:760](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/store/pg-jobs.ts:760), [pg-jobs.ts:1131](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/store/pg-jobs.ts:1131), [jobs.ts:345](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/store/jobs.ts:345)

`pgJobStore` still publicly implements:

- `finish()` → `finishIn(getDb(), ...)`, which always makes the job terminal.
- `releaseStep()` → `releaseStepIn(getDb(), ...)`, which makes it terminal when `cancelling` is true.

Neither settles `ingest_event_id`. Only callers going through `pgStoreSession` add settlement around these primitives.

Concrete failure:

1. A reserved job is claimed.
2. Any caller uses the exported `pgJobStore.finish(...)`.
3. The job becomes `done`, `error`, or `cancelled`; its reservation remains unsettled.
4. `forget()` or `trimFinished()` at [pg-jobs.ts:1004](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/store/pg-jobs.ts:1004) deletes the terminal job.
5. The reservation remains permanently `in_flight`, with its job provenance gone.

There are no current production `src/` callers—the coordinator correctly uses `pgStoreSession`—but this is still the advertised `JobStore` API, and the stage claims every terminal transition is covered.

What I would do: remove these methods from the Postgres-facing public capability, or make reserved rows refuse raw settlement and require a `pgStoreSession`. Add direct tests for `pgJobStore.finish` and the cancelling branch of `pgJobStore.releaseStep`, followed by `forget`/`trimFinished`.

A now-false comment exposes the problem:

> “A job transition is one fenced `UPDATE`: it is atomic on its own, which is why `rawPgJobStore` may keep passing the pool.”

[pg-jobs.ts:94](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/store/pg-jobs.ts:94). Once terminal transitions also mutate `ingest_events`, the update is no longer the whole operation.

### 2. High — `releaseReservation` can race an uncommitted job insert and release a slot that subsequently gains a job

Files: [pg-billing.ts:344](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/store/pg-billing.ts:344), [pg-jobs.ts:158](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/store/pg-jobs.ts:158)

The `NOT EXISTS` guard only sees the statement snapshot. This interleaving is possible during an ambiguous enqueue failure:

1. T1 inserts a job referencing reservation R but has not committed.
2. T2 runs `releaseReservation(R)`.
3. T2’s `NOT EXISTS` cannot see T1’s uncommitted job and sets `released_at`.
4. T1 commits its job, because the FK requires only that R exists—not that it remains unsettled.

Updating `released_at` takes a non-key row lock, which does not conflict with the key-share lock used to protect a referenced FK key; this follows PostgreSQL’s documented row-lock compatibility. [PostgreSQL row-level locking](https://www.postgresql.org/docs/current/explicit-locking.html)

The resulting job can run, but successful publication will roll back forever because strict charging finds an already-released reservation. This is not a free ingest, but it is a paid job that cannot publish.

The existing test at [billing-quota-race.test.ts:293](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/tests/billing-quota-race.test.ts:293) tests only a job that has already committed, so it cannot expose this race.

What I would do: make attaching a reservation and checking that it remains unsettled one serialized database operation—most cleanly a trigger or transactional primitive that locks the event, verifies both terminal columns are null, and inserts the job. Add a two-connection test with the job insert held uncommitted.

### 3. Medium — tolerant release conflates idempotency with a contradictory charge and is unnecessary for the stated race

Files: [pg-billing.ts:420](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/store/pg-billing.ts:420), [billing-settlement.test.ts:772](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/tests/billing-settlement.test.ts:772)

A zero-row release can mean:

- already released;
- already succeeded;
- missing row;
- unexpected result shape.

The code treats all four alike. The test explicitly blesses the contradictory case: a queued job’s reservation is marked succeeded, then Stop commits the job as cancelled while leaving it charged.

That violates the stated ledger rule: a job ending other than successfully should be released. More importantly, tolerance is not needed for cancel/publication contention:

- If publication wins, `requestCancel` waits, rechecks `status in ACTIVE`, returns no row, and never calls settlement.
- If terminal cancellation wins, the claimant’s fence fails before its settlement.
- If Stop merely sets `cancelling`, it performs no release and the final publication charges.

At `READ COMMITTED`, PostgreSQL re-evaluates an `UPDATE` predicate after waiting on a concurrent updater. [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)

Therefore these comments are false:

> “It is also what makes a cancel racing a final publication settle once…”

[pg-billing.ts:404](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/store/pg-billing.ts:404)

> “the loser’s settlement rolls back with the transition that lost. Tolerance is what keeps the loser from also being a failed request.”

[billing.md:238](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/docs/project/billing.md:238)

The loser does not reach settlement.

What I would do: make job-associated releases strict. If idempotent same-outcome release is genuinely required, inspect the existing row and tolerate only `released_at IS NOT NULL`; treat missing or succeeded reservations as invariant violations.

### 4. Medium — the race tests are sequential and miss the actual locking behavior

File: [billing-settlement.test.ts:793](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/tests/billing-settlement.test.ts:793)

The comment says:

> “Both directions of the race, deterministically.”

Neither test races transactions. They first complete `requestCancel`, then call publication. They prove the two possible pre-existing states are handled, but not that:

- the second writer blocks on the job row;
- the `WHERE` predicate is re-evaluated after the first commits;
- no settlement occurs while one transaction is waiting;
- the chosen lock order completes without deadlock.

This is green for a narrower reason than claimed.

What I would do: use two pinned clients and barriers. Hold the winning transaction after its job update, start the loser, assert it is blocked, commit the winner, then assert final job, publication, and ledger state. Test both directions. Also add coverage for finding 1.

### 5. Low — `settleExpired` holds every updated job lock across N sequential settlement statements

File: [pg-jobs.ts:796](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/store/pg-jobs.ts:796)

The bulk `UPDATE` locks every expired job first; the subsequent loop issues one statement per reservation while retaining every job lock until commit. The global caller at [jobs.ts:1485](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/jobs.ts:1485) can sweep all owners.

The default concurrency cap limits this to three jobs, so this is not presently severe. However, `SPIDERYARN_JOB_CONCURRENCY` accepts any positive integer, making this comment unjustified:

> “usually none, occasionally one”

[pg-jobs.ts:864](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/store/pg-jobs.ts:864)

What I would do: settle the returned reservation IDs in one set-based `UPDATE`, compare returned IDs with expected non-null IDs, and log anomalies afterward. At minimum, add a multi-row expiry test.

## What appears sound

- Publication, job completion, and strict charge are in the same database transaction. I found no path within `pgStoreSession` that can commit one without the others.
- The normal cancel-versus-publication fence is sound at `READ COMMITTED`.
- The `article → job → ingest_event` order does not create a cycle with `requestCancel` or `settleExpired`, because those take `job → ingest_event` and never request the article lock.
- Explicit `READ COMMITTED` is appropriate; stronger isolation adds serialization failures without improving these row-fenced transitions.
- Article archival is a flag, not deletion; jobs do not cascade from articles. Owner deletion is restricted. `forget` and `trimFinished` delete only terminal jobs, but become dangerous after the uncovered raw terminal paths.

## Checks

- Focused Postgres suite: **not runnable here**; failed with `EPERM` reaching `127.0.0.1:54362`, with 13 business tests skipped behind the loud guard.
- Typecheck: **passed**, all three projects and all 1,097 source files.
- Scoped lint: one advisory at `pg-jobs.ts:667`, outside this stage’s diff.