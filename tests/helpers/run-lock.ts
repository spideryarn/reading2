/**
 * One suite at a time may run a job against the shared test database.
 *
 * ## Why this exists
 *
 * **Every suite that starts a job is racing every other one**, including a
 * peer's `npm test` in another process and a dev server mid-ingest.
 *
 * It used to be racing on a global slot: `jobs_only_one_running` was a unique
 * index on the constant `(true)`, so one row in the whole `spideryarn.jobs`
 * table could be `running`, scoped to no owner, slug or process. That index went
 * on 2026-08-30, replaced by a counted cap. The race did not go with it. What is
 * left is `jobs_active_slug` — one job in flight per article — and, bigger,
 * cause (2) below: these suites share fixed fixture slugs and a fixed owner, so
 * two copies of one file are reading and deleting the same rows.
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
 * So: one key, taken by everybody who runs a job.
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
 * 1. **Two jobs at once.** `duplicate key … jobs_active_slug`, and `claim`
 *    answering `busy` where the test wanted `claimed`. The measurement above was
 *    taken while `jobs_only_one_running` still existed, so its
 *    `duplicate key … jobs_only_one_running` failures are the dropped index's
 *    and would not recur; the other two would.
 * 2. **Fixed fixture identity.** Most of these files use a constant slug —
 *    `articles_slug_unique` on `test-artefacts-pg` — and a constant owner, so
 *    two copies of one file share rows: one copy's cleanup deletes the other's
 *    `article_revisions` mid-flight and the reader sees `23503` foreign-key
 *    violations against a revision that existed a moment ago. The per-insert
 *    retry in `./running-slot.ts` cannot help with that at all, because the
 *    window that matters is the whole suite, not the insert.
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
 * **Which makes this unfair too, and the paragraph above owes `running-slot.ts`
 * that admission.** Polling is not a queue and it is not FIFO: there is no
 * ordering, arriving first buys nothing, and a waiter can in principle be
 * starved right up to its deadline while others come and go. This one contends
 * for a key that changes hands in milliseconds rather than across a whole
 * insert's worth of constraint, so starvation is far less likely here — but
 * "less likely" is the honest claim, and "fair" was never one. `RUN_LOCK_WAIT_MS`
 * below therefore says "queue depth" in the sense of *how much holding I might
 * have to sit behind*, not of a line anybody is keeping. Same in
 * `./corpus-lock.ts` § "Polling is not a queue, and this is not FIFO".
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
 * across sessions, so a second overlapping take would poll until the deadline
 * and then throw, blaming a sibling that does not exist.
 *
 * There are two guards against that, and they are for different callers.
 * `takeRunLock` **throws immediately** when this process already holds the key,
 * because a direct second take has nothing sensible to hand back and waiting
 * two minutes to say so is the worst of both. `withRunLock` instead **returns
 * early** and runs its body under the hold this process already has, because
 * that is what a nested window wants. Sequential takes are untouched by either:
 * `release()` clears the flag, so only an *overlapping* take is refused.
 *
 * That early return is why the fixture loader in `./load-article.ts` takes this
 * **only when its caller asks** (`LoadOptions.serialise`): several of its
 * callers hold this lock for their file already, and an unconditional nested
 * take would deadlock every one of them.
 *
 * (This paragraph said there was no `withRunLock` wrapper and that the loader
 * never took the lock. Both halves stopped being true when the window-scoped
 * take landed, and the correction sat unmade long enough for two other
 * paragraphs here to contradict this one.)
 *
 * ## Why `store-roundtrip` and `store-parity` take this by the window, not the file
 *
 * Because a file-scope take is held for the **whole file**, the budget above is
 * a sum over its holders, and `tests/store-roundtrip.test.ts` runs for **63
 * seconds** (measured 2026-08-30; 190 cases over every article in `data/`).
 * Holding the lock across that would leave 57s of the 120s for everybody else,
 * and two concurrent runs would exceed the deadline outright — turning a flake
 * into a hard, confident failure, which is worse.
 *
 * So those two take it through `withRunLock` inside `loadArticleIntoPg` — by
 * passing `serialise: true` — for the length of one fixture load rather than
 * one suite. Same key, same exclusion, a hold measured in hundreds of
 * milliseconds. They are the only two callers that pass it, because they are
 * the only two that load a fixed slug without holding this lock for their file.
 *
 * That is the rule for anything added later: **take this if you run a job under
 * a name something else also uses; take it by the file if your fixtures are
 * named the same on every run, and by the window if holding it for your whole
 * file would dominate the budget.**
 *
 * **And a seed under a slug nobody else uses does not take it at all.** That is
 * `serialise`'s default, and it is a change of 2026-09-01 rather than an
 * omission: unconditional, the loader made every seed in the run queue behind
 * every other one at ~380ms a caller, which ~48 converted sub-stage B suites
 * would have turned into ~24s of strictly serial demand against the 120s
 * budget. The numbers, and **the one collision a unique slug does not
 * separate**, are in `./load-article.ts` § `LoadOptions.serialise` and
 * `tests/load-article-serialisation.test.ts`.
 *
 * ## The wait is bounded end to end, not only inside the loop
 *
 * A deadline wrapped around a `select` is worth nothing if the `connect()` or
 * the `select` itself can hang for ever — the same "hangs module collection in
 * silence" failure arriving through a different door, and this file was written
 * with exactly that hole in it until 2026-09-02. It matters more here than for
 * `./corpus-lock.ts`, because this take runs at module scope in every file that
 * takes it — `grep -rn takeRunLock tests/` for today's list, and it has only
 * ever grown — where a stalled connect hangs the import phase, which has no
 * hook timeout behind it at all.
 *
 * So the connection carries `connectionTimeoutMillis`, every query carries
 * `query_timeout` (client-side, so it fires even when the server never
 * answers), the deadline starts *before* connecting, and it is checked *before*
 * each attempt — a key acquired past the deadline would be a key acquired by
 * something that already promised to give up. Every exit throws an error naming
 * the file, the poll query's own failures included.
 *
 * **`waitMs` is a bounded wait, not a hard deadline, and the difference is one
 * query timeout.** The check before each attempt is `>=`, so no attempt ever
 * *begins* past the deadline and a `waitMs` of zero acquires nothing at all;
 * but an attempt that began a millisecond before it may take up to
 * `QUERY_TIMEOUT_MS` to answer, and if it comes back holding the key, the key
 * is kept. The bound is therefore about `max(waitMs, CONNECT_TIMEOUT_MS)` plus
 * one `QUERY_TIMEOUT_MS`: 120s of budget is really 130s of wall clock, worst
 * case.
 *
 * That overshoot is deliberate rather than unnoticed (GPT Sol, 2026-09-02,
 * docs/plans/260902c-make-the-test-suite-pass-reliably-review2-sol.md § 2). The
 * alternative is to re-check the clock after the query and *unlock a key we
 * have just been granted* — which buys ten seconds of punctuality by inventing
 * a new way for a suite that had the lock to fail. What this deadline is for is
 * "never hang in silence, always name the file", and a bound of `waitMs` plus
 * one query timeout delivers that exactly. Anything that needs the stronger
 * promise should say so here first.
 *
 * Every exit from a failed take destroys its connection and ends its pool. A
 * leaked client is not merely a socket: `max: 1` means a client left checked out
 * also stops `pool.end()` ever resolving, and if the leak happens *after* the
 * key is in hand the key stays held until the worker dies — the deadlock this
 * file exists to prevent. Same reason the release path cleans up in a `finally`:
 * it used to mark itself released and then unlock, so an unlock that threw left
 * the connection open and the key held.
 *
 * ## Measuring this lock: read the `import` phase, not `tests`
 *
 * `takeRunLock` is called at module load, under a top-level `await`, so the wait
 * lands entirely in vitest's **import** phase. The `tests` figure cannot see it.
 * Measured 2026-08-30 on `store-job-draft`, with the key held from an outside
 * `psql` session for 25s:
 *
 * ```
 * solo        import 35.31s   tests 2.47s
 * key held    import 62.72s   tests 2.56s
 * ```
 *
 * The whole +27.4s is import; the test phase moved by 0.09s. Read the `tests`
 * number and you would conclude the lock does nothing, having measured a phase
 * it cannot touch.
 *
 * That split is also what tells a lock wait from ordinary contention, in a
 * single pair of runs and without a quiet machine: background contention is
 * *database* contention, so it inflates `tests`, where the queries are. A delay
 * sitting wholly in `import` with query time flat is not something a busy tree
 * can produce. (A dose-response confirms it too — hold for 10s and 30s and see
 * the import track the hold — but the phase split does not need a second trial.)
 */
import type { Pool, PoolClient, QueryResult } from "pg";

/**
 * The key. Arbitrary, but it must be the same number everywhere — the whole
 * point is that these files exclude *each other*.
 *
 * Distinct from `CORPUS_LOCK` (823_117_001) in `./corpus-lock.ts`, which is a
 * different resource: the real articles in `data/`.
 *
 * **Two files hold both**, and the order matters. `store-parity` and
 * `store-roundtrip` take the corpus lock at module scope and reach this one
 * inside `loadArticleIntoPg`, so for them it is corpus-then-run. No file-scope
 * holder of this lock ever wants the corpus lock, so there is no cycle —
 * **corpus outside, run inside**, and keep it that way. A pair of locks taken in
 * two orders is the one way this can genuinely deadlock; both keys now poll
 * against a deadline and name the file that was waiting, so it would at least
 * be reported rather than hang.
 *
 * (An earlier version of this comment said no file held both and told you to
 * take this one first. Both halves were wrong once the window-scoped take
 * landed; the ordering above is the one that is actually true.)
 */
export const RUN_LOCK = 918_273_645;

/**
 * Long enough for a whole run of every file that takes this, several times
 * over. Measured 2026-08-30, when twelve files took it: about 25s of solo
 * runtime between them, so 120s absorbs a peer's `npm test` running the same
 * set beside yours and still reports rather than hangs. More files take it now
 * — the measurement is a historical reading, not a running total, and the
 * budget wants re-measuring when it starts expiring.
 *
 * This is a queue depth, not a timeout papering over slowness: exceeding it
 * means somebody is *holding* the lock, and the message says who to look for.
 */
const RUN_LOCK_WAIT_MS = 120_000;

/** How often to ask. Short enough to be prompt, long enough not to spin. */
const POLL_MS = 200;

/**
 * Caps on the two operations that would otherwise have no cap at all.
 *
 * Both are generous next to what they bound — a local `connect()` is tens of
 * milliseconds and `pg_try_advisory_lock` never blocks — because they are not
 * tuning. They are the difference between "gave up and said which file was
 * waiting" and "hung in the import phase, in silence, for ever". Same numbers
 * as `./corpus-lock.ts`, deliberately: the two helpers are siblings.
 */
const CONNECT_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 10_000;

/** How the holder announces itself in `pg_stat_activity`. */
function applicationName(suite: string): string {
  /* Postgres truncates this at 63 bytes, silently, so keep the suite path —
     the half worth reading — and let the prefix be short. */
  return `run-lock ${suite}`;
}

/**
 * **Who in this process holds the lock**, or null when nobody does.
 *
 * Module-level, so it is per *file*: vitest runs each test file in its own fork
 * with a fresh module graph (`pool: "forks"`, `isolate: true`, both defaults),
 * so this is never shared between two files, and two files can never see each
 * other's. It exists only to answer "have *I* already got it", and it carries
 * the suite name so that both readers of it can say who.
 *
 * `withRunLock` needs it because a file-scope holder may also call
 * `loadArticleIntoPg`, which takes the lock for its load window. Without it
 * that is a second connection asking for a key the first connection holds —
 * Postgres advisory locks are re-entrant within a *session* and these are two
 * sessions — so it would poll until the deadline and then throw, in every
 * file-scope holder. Hence the early return, and hence the test that drives
 * exactly that path.
 *
 * `takeRunLock` reads it for the other half of the same problem: a *direct*
 * second take, which `withRunLock` cannot protect because it never goes
 * through the wrapper. That one throws rather than returning early, because
 * there is nothing sensible to hand back — see the guard at the top of
 * `takeRunLock`.
 */
let heldBy: string | null = null;

/**
 * Options only the tests for this file pass.
 *
 * The deadline is injectable for the same reason `attempts`/`gapMs` are in
 * `./running-slot.ts`: the failure this guards against presents as a **120
 * second** wait naming a sibling that does not exist, and a branch nobody can
 * afford to run twice is a branch nobody has seen work. At one second the
 * re-entrancy case is an ordinary test.
 */
export interface RunLockOptions {
  /** Overrides `RUN_LOCK_WAIT_MS`. Tests only. */
  waitMs?: number;
  /**
   * Overrides `RUN_LOCK`. **Tests only, and load-bearing.**
   *
   * `tests/run-lock.test.ts` has to hold the key from a rival session and watch
   * this function fail to get it, and has to drive a release that throws. On the
   * real key either would mean a test contending with — or walking away holding
   * — the key that serialises every job-running suite and every peer's `npm
   * test`. So the test brings its own key, minted per run, and never touches
   * 918_273_645. The
   * same hazard on `./corpus-lock.ts` was GPT Sol's highest finding on
   * 2026-09-02; this is the other half of that fix.
   */
  key?: number;
  /** Overrides `CONNECT_TIMEOUT_MS`. Tests only. */
  connectTimeoutMs?: number;
  /** Overrides `QUERY_TIMEOUT_MS`. Tests only. */
  queryTimeoutMs?: number;
}

export interface HeldRunLock {
  /**
   * The connection holding the lock.
   *
   * Exposed because a suite's own setup — sweeping its rubble, seeding its
   * owner — has to happen *while* the lock is held, and running it on this
   * connection is the way to be sure of that.
   *
   * **It carries `query_timeout`**, so a caller's query on it gives up after
   * `QUERY_TIMEOUT_MS` rather than hanging. That is the point — this connection
   * is checked out during vitest's import phase, where nothing else would ever
   * time it out — and ten seconds is many times what any setup statement here
   * takes, so a query that hits it is a fault worth being told about. A caller
   * that genuinely needs longer can pass its own on the query.
   */
  client: PoolClient;
  /**
   * Unlock, close the connection, end the pool. Safe to call twice.
   *
   * Throws if the unlock query fails — but cleans up first, so the key is gone
   * either way and the throw is only the news that the database failed a
   * trivial query.
   */
  release(): Promise<void>;
}

/**
 * Wait for the run lock, and say so out loud if it never comes.
 *
 * `suite` is this file's path, and it appears in the timeout — the point of the
 * message is that the reader learns which files are in the queue rather than
 * being told "a lock timed out".
 */
export async function takeRunLock(
  suite: string,
  {
    waitMs = RUN_LOCK_WAIT_MS,
    key = RUN_LOCK,
    connectTimeoutMs = CONNECT_TIMEOUT_MS,
    queryTimeoutMs = QUERY_TIMEOUT_MS,
  }: RunLockOptions = {},
): Promise<HeldRunLock> {
  if (heldBy !== null) {
    /* **Fail fast rather than wait on ourselves.** A second take is a second
       *connection* asking for a key this process already holds on another one;
       advisory locks are re-entrant within a session and these are two
       sessions, so without this the caller would poll for the whole deadline
       and then be told a sibling file is hogging the lock. `release()` clears
       this, so repeated sequential takes are untouched: only an *overlapping*
       take is refused. Code that legitimately wants a nested hold calls
       `withRunLock`, which returns early instead. */
    throw new Error(
      `${suite} asked for the run lock, but ${heldBy} already holds the run lock in this process. ` +
        "A file takes it once, at module scope, and holds it to teardown; anything that needs it " +
        "for a nested window should go through withRunLock, which returns early rather than " +
        "opening a second connection to wait on the first.",
    );
  }
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

  /* Started before the connection, so a slow connect spends the budget it is
     actually spending rather than a fresh one. */
  const deadline = Date.now() + waitMs;

  const { Pool } = await import("pg");
  const pool: Pool = new Pool({
    connectionString: url,
    /* One connection, and it is checked out for the whole hold — so the backend
       that takes the key is the only one this pool can hand to anybody, and the
       unlock below cannot land on a different session. */
    max: 1,
    application_name: applicationName(suite),
    connectionTimeoutMillis: connectTimeoutMs,
    /* Client-side, deliberately: a `statement_timeout` is the server's promise,
       and the case being guarded against is the server not answering. */
    query_timeout: queryTimeoutMs,
  });

  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (cause) {
    await pool.end().catch(() => {});
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
         because that ask can come back holding a key it had already promised
         to stop wanting. `waitMs: 0` therefore never acquires anything, which
         is the branch `tests/run-lock.test.ts` pins. */
      if (Date.now() >= deadline) throw new Error(timedOut(suite, key, waitMs));
      let got: QueryResult<{ got: boolean }>;
      try {
        got = await client.query<{ got: boolean }>("select pg_try_advisory_lock($1) as got", [key]);
      } catch (cause) {
        /* Wrapped, because the headers here promise that a failed take always
           names the file that was waiting, and a raw `Query read timeout` or
           `invalid input syntax` arriving out of vitest's import phase names
           nothing at all. The cleanup is the outer `catch`'s job. */
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
       `query_timeout` firing, the database going away. The old shape cleaned up
       on the deadline only, so every other way out of this loop left the client
       checked out and the pool un-ended, which with `max: 1` is a pool that can
       never be ended at all. `release(true)` destroys rather than returns: the
       connection may be the reason we are here, and it must not be handed to
       anybody else while it might still hold the key. */
    client.release(true);
    await pool.end().catch(() => {});
    throw err;
  }

  /* Set only once the key is actually in hand, never before the loop — set
     optimistically it would make `withRunLock` skip the take, and the guard
     above refuse one, on the strength of a lock this process failed to get. */
  heldBy = suite;

  let released = false;
  return {
    client,
    async release() {
      /* Idempotent because `afterAll` runs even when `beforeAll` threw, and a
         suite may also release explicitly. Unlocking twice is harmless in
         Postgres but ending an ended pool is not. */
      if (released) return;
      released = true;
      heldBy = null;
      try {
        /* Explicit unlock first, so the lock is gone the moment this returns
           rather than whenever the socket closes. Closing the connection would
           do it too; doing both means a slow teardown cannot delay the next
           file. On the same `client` the key was taken on, which is the whole
           reason this connection is checked out and never handed back until
           here — an unlock on a different backend of the pool would quietly do
           nothing and report success. */
        await client.query("select pg_advisory_unlock($1)", [key]);
      } catch (cause) {
        throw new Error(
          `${suite} could not unlock advisory lock ${key}. Its connection is being closed ` +
            "regardless, and a session advisory lock goes with its session, so the key is " +
            "free — but the database failed a trivial query, which is the part worth chasing.",
          { cause },
        );
      } finally {
        /* In a `finally` because the shape before this marked itself released
           and *then* unlocked: an unlock that threw left the client checked out
           and the pool open, so the key stayed held until the worker died —
           exactly the deadlock this file exists to prevent. `release(true)`
           destroys the connection rather than returning a possibly-broken one
           to the pool, and a session advisory lock dies with its session. */
        client.release(true);
        await pool.end().catch(() => {});
      }
    },
  };
}

/** The message, in one place, because two exits from the loop throw it. */
function timedOut(suite: string, key: number, waitMs: number): string {
  return (
    `Waited ${waitMs}ms for advisory lock ${key}: ${suite} could not get its turn ` +
    "at running a job. Another suite that takes this lock is still running against " +
    "this database — a second `npm test`, or a copy of one of those files. If nothing is " +
    "actually running, a connection is wedged holding the lock; look for `run-lock …` in " +
    "pg_stat_activity, and it goes when that process does."
  );
}

/**
 * Hold the run lock for the length of `body`, unless this process already has it.
 *
 * **The window-scoped take**, for code that needs to run a job briefly
 * rather than for a whole file — `loadArticleIntoPg` in `./load-article.ts` is
 * the caller it was written for, and reaches it only when asked
 * (`LoadOptions.serialise`). A fixture load is one insert, some artefact writes
 * and a delete; serialising *that* costs nothing, where serialising the suite
 * around it would cost 63 seconds in `tests/store-roundtrip.test.ts`.
 *
 * **The early return is a guard, not an optimisation.** Taking the key again in
 * a process that holds it would be a second *connection* asking for what the
 * first connection has; advisory locks are re-entrant within a session and
 * these are two sessions, so it would poll to the deadline and then throw,
 * blaming a sibling that does not exist.
 *
 * **No caller reaches it today**, and saying so is better than the claim that
 * was here. Until 2026-09-01 the loader took this lock unconditionally, so the
 * five file-scope holders that also load a fixture went through it on every
 * call; now `serialise` defaults to off and neither of the two suites that
 * passes it holds the lock for its file. It stays because it is the difference
 * between "somebody added `serialise: true` to a file-scope holder" and "a
 * suite hangs for two minutes accusing its neighbour". `tests/run-lock.test.ts`
 * drives the branch directly, which the old wording claimed and no test did.
 *
 * **Lock ordering.** This one is always the *inner* lock. `store-parity` and
 * `store-roundtrip` take `CORPUS_LOCK` at module scope and reach this
 * one through the fixture loader, so the order there is corpus-then-run; no
 * file-scope holder of this lock ever wants the corpus lock, so there is no
 * cycle. Keep it that way: **corpus outside, run inside.**
 */
export async function withRunLock<T>(
  what: string,
  body: () => Promise<T>,
  options: RunLockOptions = {},
): Promise<T> {
  if (heldBy !== null) return await body();
  const lock = await takeRunLock(what, options);
  try {
    return await body();
  } finally {
    await lock.release();
  }
}
