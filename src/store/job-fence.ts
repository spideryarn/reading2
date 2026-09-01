/**
 * **What it means for a claim to still be live, written once.**
 *
 * Four conditions, and the fourth is the one this repo had missing everywhere
 * until 2026-09-01:
 *
 *     id = $id  and  attempt_id = $attempt  and  status = 'running'
 *                                          and  lease_expires_at > clock_timestamp()
 *
 * The first three say *this claimant was given the job and the job has not
 * ended*. Only the fourth says *and it is still allowed to write*. Without it
 * expiry revoked nothing: a claimant whose lease had lapsed could still commit,
 * as long as it reached the row before Stop or `settleExpired` did — and in the
 * ignored-abort path it could commit an `error`/INTERRUPTED ending over a
 * reader's Stop. GPT Sol, 2026-09-01, finding 1 on the built stage 2.
 *
 * ## Why this is a module rather than a function in src/store/pg-jobs.ts
 *
 * Because there are five call sites in two files — the three job transitions in
 * src/store/pg-jobs.ts and the three draft fences in src/store/pg-revisions.ts
 * — and the whole history of this fence is one copy of it drifting from
 * another. src/store/pg-revisions.ts cannot import src/store/pg-jobs.ts without
 * risking the cycle `npm run check` gates on, so the predicate lives on its own
 * with nothing but the schema behind it.
 *
 * ## `clock_timestamp()`, never `now()`
 *
 * `now()` is **transaction start time** and does not move for the life of the
 * transaction. That is wrong at both ends of a lease:
 *
 * - **Minting.** A claim that waited — for the `queue_state` lock, for a
 *   connection, for the planner — gets a lease dated from before it waited, so
 *   its real deadline is shorter than the `leaseMs` it asked for while the
 *   claimant's own self-abort timer is counting from later. That gap is
 *   precisely the window where the process is alive and the row says it is not.
 * - **Fencing.** A statement that blocks on a row lock and crosses the expiry
 *   while it waits would still see its own pre-expiry `now()` and be allowed
 *   through — which is the same bug arriving through patience rather than
 *   through skew. `clock_timestamp()` is volatile, so Postgres re-reads it when
 *   it re-checks the qualifier after taking the lock.
 *
 * ## The boundary, and it agrees with the filesystem adapter
 *
 * **Live is `lease > clock_timestamp()`; over is `lease <= clock_timestamp()`
 * or a lease that is missing altogether.** Exactly complementary, so there is
 * no instant at which a job is neither writable by its claimant nor settleable
 * by the sweep. src/store/jobs-fs.ts has always treated its `expires` the same
 * way (`held.expires > now` is live), and until this the Postgres side used
 * `<`, which is a one-microsecond disagreement between two adapters that
 * `tests/store-jobs-parity.test.ts` is supposed to hold to one contract.
 *
 * ## A missing lease is *over*, not *live*
 *
 * `jobs_running_is_fenced` (src/db/schema.ts) makes `running` with a NULL lease
 * impossible, so this arm is unreachable — but a predicate has to answer for it
 * anyway, and the two possible answers are not equally good. Treating NULL as
 * *live* is what `coalesce(…, false)` used to do in `requestCancel`, and it
 * leaves a corrupt row that no claimant can advance and no sweep can settle:
 * "Stopping…", disabled, for ever. Treating it as *over* makes the same corrupt
 * row recoverable by the machinery that already exists, and matches the
 * filesystem adapter, where *no entry in the `attempts` map at all* has always
 * meant lapsed. GPT Sol raised it as hardening, 2026-09-01; this is the choice.
 */

import { and, eq, sql } from "drizzle-orm";

import { jobs } from "../db/schema.js";

/**
 * The lease has run out — or was never there. True for exactly the rows
 * `liveAttempt` refuses on lease grounds, so the sweep's reach and the fence's
 * refusal are the same set.
 *
 * Never NULL, which is why no `coalesce` wraps it: `is null` answers for the
 * one input that would have made the comparison unknown.
 */
export const leaseIsOver = sql`(${jobs.leaseExpiresAt} is null or ${jobs.leaseExpiresAt} <= clock_timestamp())`;

/** The lease is still running. The negation of `leaseIsOver`, spelled out. */
export const leaseIsLive = sql`${jobs.leaseExpiresAt} > clock_timestamp()`;

/**
 * **The fence.** This job, this attempt, still running, and still inside its
 * lease — the whole of what entitles a claimant to write.
 *
 * Zero rows out of a statement carrying this is not "nothing to do": it is the
 * fence doing its job, and every caller turns it into a thrown refusal rather
 * than a quiet success (docs/reusable/silent-success.md).
 */
export function liveAttempt(id: string, attempt: string) {
  return and(
    eq(jobs.id, id),
    eq(jobs.attemptId, attempt),
    eq(jobs.status, "running"),
    leaseIsLive,
  );
}
