/**
 * One suite at a time may hold the database's single `running` job slot.
 *
 * ## Why this exists
 *
 * `jobs_only_one_running` is a unique index on the constant `(true)`, so at most
 * one row in the whole `spideryarn.jobs` table may be `running` — global
 * concurrency 1, on purpose. It is not scoped to an owner, a slug or a process,
 * so **every suite that starts a job is racing every other one**, including a
 * peer's `npm test` in another process and a dev server mid-ingest.
 *
 * Vitest runs test *files* concurrently, in separate forks. Before this helper
 * there were two answers to that in the repo and neither covered the case:
 *
 * - `tests/helpers/running-slot.ts` waits on the constraint itself. That needs
 *   no agreement from anybody, which is its whole point, but it is **unfair**:
 *   it polls, so under enough contention one loser starves. Its budget is 40 ×
 *   500ms, and a starved caller fails at 20s with an error about a wedged row.
 *   The 20,468ms / 20,438ms / 20,589ms failures on 2026-08-29 were that budget
 *   running out — the clock is the tell, not the assertion.
 * - `tests/store-jobs-parity.test.ts` took a session advisory lock, and its own
 *   docstring said "nothing else in the repo takes an advisory lock". That was
 *   true when one file needed it. It stopped being true, and a lock that only
 *   one of the claimants takes serialises nothing: parity held the lock and
 *   still failed `expected 'busy' to be 'claimed'`, because the file it was
 *   racing had never heard of the key.
 *
 * So: one key, taken by everybody who needs the slot.
 *
 * ## What the lock covers that the constraint does not
 *
 * Measured on 2026-08-30, two concurrent `npx vitest run` processes over the
 * same seven job-slot files, with the key neutralised so the lock excludes
 * nobody: **23 to 50 failures per run** across four runs, four to six of the
 * seven files red, where every one of those files is green alone. With the lock
 * live: **0 failures**, across four concurrent pairs and a wider nine-file set,
 * confirmed independently on a second reading at 162 passed / 162 passed.
 *
 * The spread is the point and the first measurement here did not have it — it
 * read "39 failures in each", a suspiciously equal pair, and was replaced after
 * re-measuring on the current tree. Contention does not produce tidy numbers,
 * so a tidy one is the reading to distrust.
 *
 * Two distinct causes, and the lock is the only thing that answers both:
 *
 * 1. **The slot.** `duplicate key … jobs_only_one_running`, `jobs_active_slug`,
 *    and `claim` answering `busy` where the test wanted `claimed`.
 * 2. **Fixed fixture identity.** Most of these files use a constant slug —
 *    `articles_slug_unique` on `test-artefacts-pg` — and a constant owner, so
 *    two copies of one file share rows: one copy's cleanup deletes the other's
 *    `article_revisions` mid-flight and the reader sees `23503` foreign-key
 *    violations against a revision that existed a moment ago. Waiting on the
 *    running-slot constraint cannot help with that at all, because the window
 *    that matters is the whole suite, not the insert.
 *
 * Serialising whole *files* is what covers (2), which is why this is taken at
 * module load and held to teardown rather than around each insert.
 *
 * ## Why it does not replace `running-slot.ts`
 *
 * A lock only excludes the holders that agree to take it. A real ingest on the
 * same laptop never will. Keep `insertWhenSlotFree` where it is: this helper
 * removes contention *between suites*, and that one survives everything else.
 *
 * ## Why a session lock, on its own connection
 *
 * `pg_advisory_lock` is held by a **session**, so it has to be taken on a
 * connection nobody else can be handed — borrow one from a shared pool and the
 * unlock may run on a different backend and quietly do nothing, leaving the lock
 * held until the process exits, which looks exactly like a deadlock to whoever
 * runs next. Postgres drops it when the connection goes, so a killed run
 * releases it without anybody's teardown having to run.
 *
 * ## Why `pg_try_advisory_lock` in a loop rather than `pg_advisory_lock`
 *
 * `pg_advisory_lock` waits for ever, and a run that hangs at module load looks
 * like a hung machine rather than like a sibling that will not let go. So: poll,
 * with a deadline, and fail with a message that names the file still waiting.
 *
 * ## Call it AFTER `pgReady`, and only when reachable
 *
 * `pgReady` is probed at module scope with a top-level `await` and gates a real
 * `describe.skip`. A file that is about to skip must not sit holding the lock:
 * it would serialise every other run for no reason, and on a machine with no
 * database at all it would spend the deadline finding that out. So the order is
 * probe, then — only if reachable — lock:
 *
 * ```ts
 * const { reachable } = await pgReady({ suite: "…", tables: ["spideryarn.jobs"] });
 * const lock = reachable ? await takeRunLock("tests/my-suite.test.ts") : undefined;
 * const when = reachable ? describe : describe.skip;
 * afterAll(async () => { await lock?.release(); });
 * ```
 *
 * ## One take per file
 *
 * A file must take this **once**. Two takes in one file are two different
 * connections asking for the same key — Postgres re-entrancy does not apply
 * across sessions, so the second one polls until the deadline and then throws.
 * That is why there is no `withRunLock(body)` wrapper here and why the fixture
 * loader in `./load-article.ts` does not take it: several of its callers hold
 * this lock already, and a nested take would deadlock every one of them.
 *
 * ## Why `store-roundtrip` and `store-parity` do not take this
 *
 * Because the lock is held for the **whole file**, the budget above is a sum
 * over its holders, and `tests/store-roundtrip.test.ts` runs for **63 seconds**
 * (measured 2026-08-30; 190 cases over every article in `data/`). Holding the
 * lock across that would leave 57s of the 120s for everybody else, and two
 * concurrent runs would exceed the deadline outright — turning today's flake
 * into a hard, confident failure, which is worse.
 *
 * Those two already have what they need: `./corpus-lock.ts` serialises the pair
 * that actually collides, and `insertWhenSlotFree` inside `./load-article.ts`
 * waits out the slot. Their slot window is one fixture load, not the suite.
 *
 * That is the rule for anything added later: **take this if you hold the slot,
 * unless holding it for your whole file would dominate the budget.** If a
 * locked file ever grows to that size, it wants the corpus-lock treatment
 * instead, not a bigger deadline.
 */
import type { Pool, PoolClient } from "pg";

/**
 * The key. Arbitrary, but it must be the same number everywhere — the whole
 * point is that these files exclude *each other*.
 *
 * Distinct from `CORPUS_LOCK` (823_117_001) in `./corpus-lock.ts`, which is a
 * different resource: the real articles in `data/`. **No file holds both**, and
 * that is deliberate rather than incidental — see "Why store-roundtrip does not
 * take this" below. If you ever do give one file both, take this one first, at
 * module load, before its `beforeAll` reaches the corpus lock: a pair of locks
 * taken in two orders is the one way this can genuinely deadlock, and the
 * corpus lock uses the blocking `pg_advisory_lock`, which waits for ever.
 */
export const RUN_LOCK = 918_273_645;

/**
 * Long enough for a whole run of every file that takes this, several times
 * over. Measured 2026-08-30: the twelve locked files total about 25s of solo
 * runtime, so 120s absorbs a peer's `npm test` running the same set beside
 * yours and still reports rather than hangs.
 *
 * This is a queue depth, not a timeout papering over slowness: exceeding it
 * means somebody is *holding* the lock, and the message says who to look for.
 */
const RUN_LOCK_WAIT_MS = 120_000;

/** How often to ask. Short enough to be prompt, long enough not to spin. */
const POLL_MS = 200;

export interface HeldRunLock {
  /**
   * The connection holding the lock.
   *
   * Exposed because a suite's own setup — sweeping its rubble, seeding its
   * owner — has to happen *while* the lock is held, and running it on this
   * connection is the way to be sure of that.
   */
  client: PoolClient;
  /** Unlock, hand the connection back, end the pool. Safe to call twice. */
  release(): Promise<void>;
}

/**
 * Wait for the run lock, and say so out loud if it never comes.
 *
 * `suite` is this file's path, and it appears in the timeout — the point of the
 * message is that the reader learns which files are in the queue rather than
 * being told "a lock timed out".
 */
export async function takeRunLock(suite: string): Promise<HeldRunLock> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    /* Callers are supposed to have run `pgReady` first, which returns
       unreachable with no DATABASE_URL. Reaching here means that order was got
       wrong, and silently handing back a lock that locks nothing is exactly the
       shape of failure docs/reusable/silent-success.md is about. */
    throw new Error(
      `${suite} asked for the run lock with no DATABASE_URL — call pgReady first ` +
        "and take the lock only when it reports reachable.",
    );
  }

  const { Pool } = await import("pg");
  const pool: Pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();

  const deadline = Date.now() + RUN_LOCK_WAIT_MS;
  for (;;) {
    const got = await client.query<{ got: boolean }>("select pg_try_advisory_lock($1) as got", [
      RUN_LOCK,
    ]);
    if (got.rows[0]?.got === true) break;
    if (Date.now() > deadline) {
      client.release();
      await pool.end();
      throw new Error(
        `Waited ${RUN_LOCK_WAIT_MS}ms for advisory lock ${RUN_LOCK}: ${suite} could not get the ` +
          "single running job slot. Another suite that takes this lock is still running against " +
          "this database — a second `npm test`, or a copy of one of those files. If nothing is " +
          "actually running, a connection is wedged holding the lock; it goes when that process " +
          "does.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  let released = false;
  return {
    client,
    async release() {
      /* Idempotent because `afterAll` runs even when `beforeAll` threw, and a
         suite may also release explicitly. Unlocking twice is harmless in
         Postgres but ending an ended pool is not. */
      if (released) return;
      released = true;
      /* Explicit unlock first, so the lock is gone the moment this returns
         rather than whenever the socket closes. `pool.end()` would do it too;
         doing both means a slow teardown cannot delay the next file. */
      await client.query("select pg_advisory_unlock($1)", [RUN_LOCK]);
      client.release();
      await pool.end();
    },
  };
}
