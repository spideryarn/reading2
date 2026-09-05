/**
 * One suite at a time may load `data/`'s real articles into Postgres.
 *
 * ## Why this exists
 *
 * `tests/store-parity.test.ts` and `tests/store-roundtrip.test.ts` both take
 * every complete article in `data/`, delete its revisions, and load it again
 * through the real write path. Vitest runs test *files* concurrently, and two
 * processes can run them at once — a peer's `npm test` beside yours. So:
 *
 * 1. parity deletes `writes`'s revisions;
 * 2. roundtrip loads `writes` and publishes it;
 * 3. parity loads `writes` and finds `basedOn` pointing at roundtrip's revision.
 *
 * The assertion that fires is *"built every article from nothing, rather than
 * carrying one forward"*, which is exactly right and says nothing useful, and
 * the run before it was green. Five clean runs then fourteen meaningless
 * failures is the shape this repo keeps meeting.
 *
 * `jobs_active_slug` already stops two *loads* of the same article overlapping
 * (as `jobs_only_one_running` did for any two loads at all, until it was dropped
 * on 2026-08-30). What neither covers is the window between one suite's wipe and
 * its assertions, which is most of the suite.
 *
 * ## Why a session lock and its own connection
 *
 * `pg_advisory_lock` is held by a **session**, so it has to be taken on a
 * connection nobody else can be handed. Borrowing one from the pool means the
 * unlock may run on a different backend and quietly do nothing, leaving the
 * lock held until the process exits — which looks exactly like a deadlock to
 * whoever runs the suite next.
 *
 * The number is arbitrary and only has to be unique among whatever else takes
 * advisory locks here. Since 2026-08-30 that is `RUN_LOCK` (918_273_645) in
 * `./run-lock.ts`, which serialises the suites that run a job.
 *
 * **Some files take both, and the order is corpus outside, run inside.**
 * `tests/store-parity.test.ts` and `tests/store-roundtrip.test.ts` take this one
 * at module scope and reach the run lock inside `loadArticleIntoPg`, for one
 * fixture load at a time (`LoadOptions.serialise`); `scripts/db-seed-dev.ts`
 * takes this one too. What none of them does is the reverse, and **keep it that
 * way**: no file-scope holder of the run lock ever wants this one, so there is
 * no cycle, and a pair of locks acquired in two orders is the one way this can
 * genuinely deadlock. The reason the nesting goes this way round rather than
 * the other is that this key is held across a whole corpus walk —
 * `tests/store-roundtrip.test.ts` runs for 63 seconds — and a file that held
 * the *run* lock for that long would starve every job-running suite waiting on
 * it. `./run-lock.ts` § `RUN_LOCK` says the same thing from the other side.
 *
 * (This paragraph used to say no file took both and told you to take the run
 * lock first. Both halves were wrong from the day the window-scoped take
 * landed, and following the instruction would have built the cycle both files
 * warn about — GPT Sol, 2026-09-02.)
 *
 * ## Take it at MODULE SCOPE, not inside `beforeAll`
 *
 * Both holders used to call `takeCorpusLock()` as the first line of a
 * `beforeAll` with a 300s timeout — so the *wait for the lock* and the ~150s of
 * work it protects were charged to one clock. Two files, forked concurrently,
 * start their two clocks at the same instant, so the waiter spent ~150s waiting
 * and had ~150s left to do ~150s of work: about 10% margin, which is why the
 * same tree passed on one run and failed on the next with
 * `Hook timed out in 300000ms`. Two concurrent `npm test` failed outright.
 * Measured with `pg_locks` sampling, 2026-09-02 —
 * docs/plans/260902c-make-the-test-suite-pass-reliably.md § "Cause 4".
 *
 * So the take lives at the top level of the file, after `pgReady`, exactly as
 * `./run-lock.ts` § "Call it AFTER `pgReady`" describes for the other key:
 *
 * ```ts
 * await pgReady({ suite: "…", tables: […] });
 * await takeCorpusLock("tests/my-suite.test.ts");
 * afterAll(async () => { await releaseCorpusLock(); });
 * ```
 *
 * A top-level `await` puts the wait in vitest's **import** phase, which has no
 * hook timeout, and leaves each `beforeAll`'s 300s covering only its own work.
 * That also means the wait is invisible in the `tests` figure and shows up in
 * `import` — `./run-lock.ts` § "Measuring this lock: read the `import` phase,
 * not `tests`" has the measurement, and it applies here word for word.
 *
 * **The `reachable` guard that used to stand in front of the take is gone**, and
 * so is the case it was for: `pgReady` throws now rather than reporting a
 * boolean, so a file that cannot use the database never reaches this line at
 * all. 2026-09-05.
 *
 * ## Why `pg_try_advisory_lock` in a loop rather than `pg_advisory_lock`
 *
 * This header used to warn, of the blocking form it then used, that it "waits
 * for ever rather than reporting". With the take in the import phase there is no
 * hook timeout behind it at all, so waiting for ever would hang a whole run in
 * silence — worse than the flake being fixed. So: poll against a deadline and
 * throw, naming the file that was waiting, the same way `takeRunLock` does.
 *
 * **Polling is not a queue, and this is not FIFO.** The blocking form would at
 * least make Postgres queue the waiters on the key; a `pg_try_advisory_lock`
 * loop has no ordering guarantee whatever. Of two waiters the one that happens
 * to ask in the right half-second wins, arriving first buys nothing, and a
 * waiter can in principle be starved right up to its deadline while others come
 * and go. That is the price of being able to *report* rather than hang, and it
 * is why the deadline below is sized with headroom rather than to the exact
 * number of holders. Where the word "queue" appears here it means "how much
 * holding I might have to sit behind", not a line anybody is keeping.
 *
 * ## The wait is bounded end to end, not only inside the loop
 *
 * A deadline wrapped around a `select` is worth nothing if the `connect()` or
 * the `select` itself can hang for ever — that is the same "hangs module
 * collection in silence" failure, arriving through a different door, and this
 * file was written with exactly that hole in it until 2026-09-02. So the
 * connection carries `connectionTimeoutMillis`, every query carries
 * `query_timeout` (client-side, so it fires even when the server never answers),
 * the deadline starts *before* connecting, and it is checked *before* each
 * attempt — a key acquired past the deadline would be a key acquired by
 * something that already promised to give up. Every exit throws an error naming
 * the file, the poll query's own failures included.
 *
 * **`waitMs` is a bounded wait, not a hard deadline**, for the reasons set out
 * in `./run-lock.ts` § "The wait is bounded end to end" — the check is `>=`, so
 * no attempt begins past the deadline, but an attempt that began just inside it
 * may take up to `QUERY_TIMEOUT_MS` to answer and is accepted if it comes back
 * with the key. So 600s of budget is really about 610s of wall clock, worst
 * case, and that is the deliberate trade rather than an oversight.
 *
 * Every exit from a failed take closes its connection, in a `finally`. A leaked
 * client is not merely a socket: if the leak happens *after* the key is in hand,
 * the key stays held until the worker process dies, which is the deadlock this
 * whole file exists to prevent.
 */
import type { Client as PgClient, QueryResult } from "pg";

const CORPUS_LOCK = 823_117_001;

/**
 * Sized for the queue, then given headroom because there is no queue.
 *
 * One holder keeps the key for about **150 seconds** — the two suites measured
 * 135s and 139s on 2026-09-02 — because each reloads the whole 35-article corpus
 * through the real write path. Two test files take it, so a peer's `npm test`
 * beside yours makes **four takers**, and four takers are at most **three**
 * holds in front of the unluckiest one, not four: 3 × 150s = **450s** is the
 * wait to beat. (`scripts/db-seed-dev.ts` takes it as well, but somebody runs
 * that by hand, so it is not part of the steady-state arithmetic.) 600s is that plus one hold's headroom — and it needs the headroom,
 * because the poll is not FIFO (above), so "fourth in" is not a promise of
 * "fourth out".
 *
 * Measured again a few hours later, on a tree carrying the in-flight fix to
 * `src/store/blobs.ts`, the same two suites held it for **~9 seconds** each and
 * ran in 32s together. Both numbers are real; the deadline is sized for the
 * worse one, because whatever made it 150s can come back and a deadline is only
 * ever a report of "somebody is holding this".
 *
 * **The hold grows linearly with `data/`.** Every article added lengthens both
 * suites, so this number walks back towards the wall as the corpus grows; when
 * it starts expiring, the answer is not a bigger number but one of the options
 * deferred in docs/plans/260902c-make-the-test-suite-pass-reliably.md § "Deferred"
 * — merge the two suites so the corpus loads once, or give each its own copy.
 */
const CORPUS_LOCK_WAIT_MS = 600_000;

/** How often to ask. Short enough to be prompt, long enough not to spin. */
const POLL_MS = 500;

/**
 * Caps on the two operations that would otherwise have no cap at all.
 *
 * Both are generous next to what they bound — a local `connect()` is tens of
 * milliseconds and `pg_try_advisory_lock` never blocks — because they are not
 * tuning. They are the difference between "gave up and said which file was
 * waiting" and "hung in the import phase, in silence, for ever".
 */
const CONNECT_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 10_000;

/**
 * The lock's connection, or null when this process is not holding it.
 *
 * The key travels with it, because it is not always `CORPUS_LOCK`:
 * `tests/corpus-lock.test.ts` takes a key of its own, and a release that
 * unlocked the constant would unlock a key it never took.
 */
let held: { client: PgClient; key: number; suite: string } | null = null;

/** How the holder announces itself in `pg_stat_activity`. */
function applicationName(suite: string): string {
  /* Postgres truncates this at 63 bytes, silently, so keep the suite path —
     the half worth reading — and let the prefix be short. */
  return `corpus-lock ${suite}`;
}

/** Options only the tests for this file pass. */
export interface CorpusLockOptions {
  /**
   * Overrides `CORPUS_LOCK_WAIT_MS`. Tests only — at the real number the
   * expiry branch takes ten minutes to check, and a branch nobody can afford to
   * run is a branch nobody has seen work.
   */
  waitMs?: number;
  /**
   * Overrides `CORPUS_LOCK`. **Tests only, and load-bearing.**
   *
   * `tests/corpus-lock.test.ts` has to hold the key from a rival session and
   * watch this function fail to get it. Doing that on the real key would mean a
   * test that takes the production lock: if a genuine corpus suite released
   * mid-case the take would *succeed*, the assertion would fail, and the case
   * would walk away holding the key that serialises everybody else until the
   * worker exits. So the test brings its own key, minted per run, and never
   * touches 823_117_001.
   */
  key?: number;
  /** Overrides `CONNECT_TIMEOUT_MS`. Tests only. */
  connectTimeoutMs?: number;
  /** Overrides `QUERY_TIMEOUT_MS`. Tests only. */
  queryTimeoutMs?: number;
}

/**
 * Wait for the corpus lock, and say so out loud if it never comes.
 *
 * `suite` is this file's path, and it appears in the timeout: the reader should
 * learn which files are in the queue rather than be told "a lock timed out".
 *
 * Call it at **module scope**, after `pgReady` and only when reachable — see the
 * header. Calling it inside a timed hook is the bug this shape exists to avoid.
 */
export async function takeCorpusLock(
  suite: string,
  {
    waitMs = CORPUS_LOCK_WAIT_MS,
    key = CORPUS_LOCK,
    connectTimeoutMs = CONNECT_TIMEOUT_MS,
    queryTimeoutMs = QUERY_TIMEOUT_MS,
  }: CorpusLockOptions = {},
): Promise<void> {
  if (held) {
    throw new Error(
      `${suite} asked for the corpus lock, which ${held.suite} already holds in this process`,
    );
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    /* Callers are supposed to have run `pgReady` first, which reports
       unreachable with no DATABASE_URL. Reaching here means that order was got
       wrong, and quietly proceeding without a lock is exactly the shape of
       failure docs/reusable/silent-success.md is about. */
    throw new Error(
      `${suite} asked for the corpus lock with no DATABASE_URL — call pgReady first ` +
        "and take the lock only when it reports reachable.",
    );
  }

  /* Started before the connection, so a slow connect spends the budget it is
     actually spending rather than a fresh one. */
  const deadline = Date.now() + waitMs;

  const { Client } = await import("pg");
  const client = new Client({
    connectionString: url,
    application_name: applicationName(suite),
    connectionTimeoutMillis: connectTimeoutMs,
    /* Client-side, deliberately: a `statement_timeout` is the server's promise,
       and the case being guarded against is the server not answering. */
    query_timeout: queryTimeoutMs,
  });

  try {
    await client.connect();
  } catch (cause) {
    await client.end().catch(() => {});
    throw new Error(
      `${suite} could not connect within ${connectTimeoutMs}ms to take advisory lock ${key}. ` +
        "The database this suite needs is not answering; nothing is being waited on and no " +
        "lock is held.",
      { cause },
    );
  }

  try {
    for (;;) {
      /* Before the attempt, never after it, and `>=` rather than `>`: a take
         whose budget has run out to the millisecond must not get one more ask,
         because that ask can come back holding a key it had already promised to
         stop wanting. */
      if (Date.now() >= deadline) throw new Error(timedOut(suite, key, waitMs));
      let got: QueryResult<{ got: boolean }>;
      try {
        got = await client.query<{ got: boolean }>("select pg_try_advisory_lock($1) as got", [key]);
      } catch (cause) {
        /* Wrapped, because the header promises that a failed take always names
           the file that was waiting, and a raw `Query read timeout` arriving
           out of vitest's import phase names nothing at all. The cleanup is the
           outer `catch`'s job. */
        throw new Error(
          `${suite} failed while polling for advisory lock ${key}: the query itself errored, so ` +
            "nothing is being waited on and no lock is held. A `Query read timeout` here means " +
            `the database took the statement and did not answer within ${queryTimeoutMs}ms.`,
          { cause },
        );
      }
      if (got.rows[0]?.got === true) break;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(timedOut(suite, key, waitMs));
      await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_MS, left)));
    }
  } catch (err) {
    /* Covers the deadline *and* a query that threw — a broken connection, a
       `query_timeout` firing, the database going away. The old shape closed the
       client on the deadline only, so every other way out of this loop leaked a
       backend. */
    await client.end().catch(() => {});
    throw err;
  }

  /* Set only once the key is in hand, never before the loop: a flag set
     optimistically would have `releaseCorpusLock` unlock a key this process
     failed to get. */
  held = { client, key, suite };
}

/** The message, in one place, because two exits from the loop throw it. */
function timedOut(suite: string, key: number, waitMs: number): string {
  return (
    `Waited ${waitMs}ms for advisory lock ${key}: ${suite} never got its turn at ` +
    "loading the real articles in data/. Something else that takes this key is holding it — " +
    "tests/store-parity.test.ts and tests/store-roundtrip.test.ts (a second `npm test`, or a " +
    "copy of one of those files) and scripts/db-seed-dev.ts are the ones that do today, and " +
    "the suites hold it for up to about 150 seconds each. `grep -rn takeCorpusLock` for the " +
    "current list. If nothing is actually running, a connection is wedged holding it; look " +
    "for the `corpus-lock …` application_name in pg_stat_activity, and it goes when that " +
    "process does."
  );
}

/**
 * Give it back. Safe to call when it was never taken, because `afterAll` runs
 * even when `beforeAll` threw.
 *
 * `held` is cleared before the unlock rather than after, and that is safe only
 * because the `finally` below always closes the connection: a session advisory
 * lock dies with its session, so the key is gone by the time this returns
 * whatever the `select` did. Leaving `held` set through the await would instead
 * invite a second caller to unlock on a client that is already going away.
 *
 * A *failed* unlock still throws, after cleaning up. The lock is released
 * either way, so the message says so — the point of the throw is that a
 * database which cannot run `pg_advisory_unlock` is worth hearing about, not
 * that anything is still held.
 */
export async function releaseCorpusLock(): Promise<void> {
  const current = held;
  if (!current) return;
  held = null;
  try {
    await current.client.query("select pg_advisory_unlock($1)", [current.key]);
  } catch (cause) {
    throw new Error(
      `${current.suite} could not unlock advisory lock ${current.key}. Its connection is being ` +
        "closed regardless, and a session advisory lock goes with its session, so the key is " +
        "free — but the database failed a trivial query, which is the part worth chasing.",
      { cause },
    );
  } finally {
    await current.client.end().catch(() => {});
  }
}
