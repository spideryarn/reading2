/**
 * Wait for the database's single `running` slot instead of failing on it.
 *
 * ## Why this exists
 *
 * `jobs_only_one_running` is a unique index on the constant `(true)`, so at
 * most one row in the whole table may be `running` — global concurrency 1, on
 * purpose. `jobs_active_slug` is narrower and covers `queued` too: it fires
 * when that *article* already has a job in flight.
 *
 * Vitest runs test files concurrently, and a second `npm test` beside yours (or
 * a dev server mid-ingest) is another claimant again. So any suite that inserts
 * a `running` row is racing every other one, and the loser does not get a
 * useful failure — it gets `duplicate key value violates unique constraint`
 * from whichever insert happened to be second, pointing at the test that lost
 * rather than at the contention.
 *
 * That is not hypothetical. On 2026-08-28 a full-suite run failed three cases
 * in `tests/store-job-draft.test.ts` this way while its own logic was fine:
 * the file passed alone, passed beside its neighbours, and failed only under
 * the load of all 266 files. `tests/helpers/load-article.ts` had already met
 * this and grown the retry below; this is that code, lifted out so there is one
 * of it rather than one per suite that gets bitten.
 *
 * ## Why retry as well as a lock
 *
 * This used to say "why retry *rather than* a lock", on the grounds that the
 * advisory lock in `tests/store-jobs-parity.test.ts` "covers copies of this file
 * and nothing else". Both halves are still true — a lock only excludes the
 * holders that agree to take it, and a real ingest on the same laptop never
 * will — but the conclusion was wrong, because waiting has a failure mode of its
 * own: **polling is unfair**, so under enough contention one caller starves and
 * spends the whole budget below. That is what the 20-second failures on
 * 2026-08-29 were.
 *
 * So the two now divide the work, and `./run-lock.ts` explains the split:
 *
 * - the **lock** removes contention *between suites*, which is nearly all of it,
 *   and is the only thing that can serialise two copies of a file that shares
 *   fixed fixture slugs with itself;
 * - this **retry** covers everything that never took the lock — a dev server
 *   mid-ingest, a real job, a suite nobody has got to yet.
 *
 * Keep both. Removing this one leaves the suites defenceless against anything
 * outside the test run; removing the lock brings the starvation back.
 *
 * ## Why the timeout message says what it says
 *
 * Waiting clears a *contended* slot but never a **wedged** one, and "try again
 * later" is useless advice when the answer is "delete the stuck row". So the
 * message has to name both readings.
 */
import { violatesConstraint } from "../../src/store/db-errors.js";

/** 40 × 500ms. Long enough for another suite's fixture, short enough to report. */
const ATTEMPTS = 40;
const GAP_MS = 500;

/**
 * Run `insert` and, if it lost the running slot, wait and run it again.
 *
 * `insert` is called afresh on every attempt rather than being retried as a
 * value, because a job wants a new id per attempt — and because an insert that
 * threw on the constraint wrote nothing, so there is nothing to undo.
 *
 * `what` names the thing being started, and appears in the timeout.
 */
export async function insertWhenSlotFree<T>(
  what: string,
  insert: () => Promise<T>,
  /* Only the tests for this file pass these. They exist so the timeout case is
     testable at all: at the real numbers it takes 20 seconds to reach, and a
     branch nobody can afford to run is a branch nobody has seen work. */
  { attempts = ATTEMPTS, gapMs = GAP_MS }: { attempts?: number; gapMs?: number } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await insert();
    } catch (err) {
      /* `violatesConstraint` walks the whole error chain. Reading
         `err.cause.constraint` at one level misses Drizzle's wrapper, and a miss
         here rethrows a contended slot as though it were a bug. */
      const contended =
        violatesConstraint(err, "jobs_only_one_running") ||
        violatesConstraint(err, "jobs_active_slug");
      if (!contended) throw err;
      if (attempt >= attempts) {
        throw new Error(
          `could not start a job for "${what}" in ${(attempts * gapMs) / 1000}s: either ` +
            "another job holds the single running slot, or this article already has one " +
            "queued or running. If nothing is actually working, a row is wedged and waiting " +
            "will not clear it — look for a `queued` or `running` row in `jobs` and remove it.",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  }
}
