/**
 * Wait until Postgres says other backends are queued behind `pid` — or say so
 * and fail. **Elapsed time is never evidence that a call blocked.**
 *
 * A lock test holds a row from a connection of its own, starts the call under
 * test, and has to know the call reached the lock before it asserts or
 * releases. A sleep cannot make that claim: "not settled after 400 ms" is true
 * of a call that is waiting on the row and of one that is merely slower than
 * the sleep, which on a busy box is an ordinary call
 * (docs/reusable/silent-success.md).
 *
 * `pg_blocking_pids` rather than a count of ungranted locks: vitest runs test
 * files at the same time, so "somebody somewhere is waiting" is a condition
 * another suite can satisfy for us. This names the blocker, so the answer is
 * about the test's own holding backend.
 *
 * ## Why it follows the chain
 *
 * Two calls contending for one row do not both name the holder. The second can
 * queue behind the first's tuple lock:
 *
 * ```text
 * request 2 → request 1 → holder
 * ```
 *
 * so "two backends directly blocked by the holder" can time out on correct
 * code, and two calls to a one-waiter probe can both be answered by the same
 * waiter (GPT Sol, PF9 of docs/plans/261004b-…-plan-review-sol.md). The query
 * therefore counts the **distinct** backends whose blocking chain *reaches*
 * `pid`. For one waiter that is the same question as the direct one — a chain
 * that reaches the holder has a first link.
 *
 * It was three private copies (store-job-draft, store-pg-session,
 * store-tags-pg) until 2026-10-04.
 */
import { sql } from "drizzle-orm";

import { getDb } from "../../src/db/client.js";

export interface BlockedByOptions {
  /** How many distinct backends must be waiting behind `pid`. Default one. */
  readonly waiters?: number;
  /** What was supposed to block, for the failure message: "the tag edit". */
  readonly what?: string;
}

/** 200 polls, 25 ms apart: five seconds of sleeping, plus the queries. */
const POLLS = 200;
const POLL_MS = 25;

export async function waitUntilBlockedBy(pid: number, options: BlockedByOptions = {}): Promise<void> {
  const { waiters = 1, what = "the call under test" } = options;
  let seen = 0;
  for (let i = 0; i < POLLS; i++) {
    /* `union`, not `union all`: it is what makes the count distinct, and what
       ends the recursion if a deadlock ever closed the chain into a loop. */
    const found = await getDb().execute(sql`
      with recursive behind(pid) as (
        select a.pid from pg_stat_activity a where ${pid} = any(pg_blocking_pids(a.pid))
        union
        select a.pid from pg_stat_activity a join behind b on b.pid = any(pg_blocking_pids(a.pid))
      )
      select count(*)::int as n from behind`);
    seen = Number((found.rows[0] as { n: number | string }).n);
    if (seen >= waiters) return;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(
    `${what} never blocked behind backend ${pid}: wanted ${waiters} backend(s) queued behind it, last saw ${seen}`,
  );
}
