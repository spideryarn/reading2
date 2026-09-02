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
 * on 2026-08-30, replaced by a counted cap. The race did not go with it, and the
 * cap is still counted across the whole table — so any file holding a `running`
 * row can still make another file's cap case answer `busy`.
 *
 * `jobs_active_slug` — one job in flight per article — went on 2026-09-02, when
 * an article gained a line. `jobs_one_running_per_slug` is what is left of it,
 * and it covers `running` rows only: two *queued* jobs on one fixture slug no
 * longer collide at all. So the per-article half of this is now enforced by
 * `./running-slot.ts` looking before it inserts rather than by a constraint
 * refusing afterwards.
 *
 * Bigger than either is cause (2) below: these suites share fixed fixture slugs
 * and a fixed owner, so two copies of one file are reading and deleting the same
 * rows.
 *
 * Vitest runs test *files* concurrently, in separate forks. Before this helper
 * there were two answers to that in the repo and neither covered the case:
 *
 * - `tests/helpers/running-slot.ts` waits on the article's own line — is
 *   anything queued or running for this slug — and retries whichever unique
 *   index refuses it if somebody lands in between. That needs no agreement from
 *   anybody, which is its whole point, but it is **unfair**:
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
 *    `duplicate key … jobs_only_one_running` failures are that dropped index's
 *    and would not recur. `jobs_active_slug` has since gone the same way, so its
 *    duplicate keys would not recur either — but the `busy` would, from the
 *    counted cap and from an article's order rule, and those are the ones that
 *    matter. Two files each holding a `running` row is still two files racing.
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
 *
 * That is what `withRunLock`'s early return below is for, and it is why the
 * fixture loader in `./load-article.ts` takes this **only when its caller asks**
 * (`LoadOptions.serialise`): several of its callers hold this lock for their
 * file already, and an unconditional nested take would deadlock every one of
 * them.
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
import type { Pool, PoolClient } from "pg";

/**
 * The key. Arbitrary, but it must be the same number everywhere — the whole
 * point is that these files exclude *each other*.
 *
 * Distinct from `CORPUS_LOCK` (823_117_001) in `./corpus-lock.ts`, which is a
 * different resource: the real articles in `data/`.
 *
 * **Two files hold both**, and the order matters. `store-parity` and
 * `store-roundtrip` take the corpus lock in `beforeAll` and reach this one
 * inside `loadArticleIntoPg`, so for them it is corpus-then-run. No file-scope
 * holder of this lock ever wants the corpus lock, so there is no cycle —
 * **corpus outside, run inside**, and keep it that way. A pair of locks taken in
 * two orders is the one way this can genuinely deadlock, and the corpus lock
 * uses the blocking `pg_advisory_lock`, which waits for ever rather than
 * reporting.
 *
 * (An earlier version of this comment said no file held both and told you to
 * take this one first. Both halves were wrong once the window-scoped take
 * landed; the ordering above is the one that is actually true.)
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

/**
 * **Does this process already hold the lock?**
 *
 * Module-level, so it is per *file*: vitest runs each test file in its own fork
 * with a fresh module graph (`pool: "forks"`, `isolate: true`, both defaults),
 * so this flag is never shared between two files, and two files can never see
 * each other's. It exists only to answer "have *I* already got it".
 *
 * `withRunLock` needs it because the twelve file-scope holders also call
 * `loadArticleIntoPg`, which takes the lock for its load window. Without the
 * flag that is a second connection asking for a key the first connection holds
 * — Postgres advisory locks are re-entrant within a *session* and these are two
 * sessions — so it would poll until the deadline and then throw, in every one
 * of those twelve files. Hence the guard, and hence the test that drives
 * exactly that path.
 */
let heldByThisProcess = false;

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
}

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
export async function takeRunLock(
  suite: string,
  { waitMs = RUN_LOCK_WAIT_MS }: RunLockOptions = {},
): Promise<HeldRunLock> {
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

  const deadline = Date.now() + waitMs;
  for (;;) {
    const got = await client.query<{ got: boolean }>("select pg_try_advisory_lock($1) as got", [
      RUN_LOCK,
    ]);
    if (got.rows[0]?.got === true) break;
    if (Date.now() > deadline) {
      client.release();
      await pool.end();
      throw new Error(
        `Waited ${waitMs}ms for advisory lock ${RUN_LOCK}: ${suite} could not get its turn ` +
          "at running a job. Another suite that takes this lock is still running against " +
          "this database — a second `npm test`, or a copy of one of those files. If nothing is " +
          "actually running, a connection is wedged holding the lock; it goes when that process " +
          "does.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  /* Set only once the key is actually in hand, never before the loop — a flag
     set optimistically would make `withRunLock` skip the take on the strength
     of a lock this process failed to get. */
  heldByThisProcess = true;

  let released = false;
  return {
    client,
    async release() {
      /* Idempotent because `afterAll` runs even when `beforeAll` threw, and a
         suite may also release explicitly. Unlocking twice is harmless in
         Postgres but ending an ended pool is not. */
      if (released) return;
      released = true;
      heldByThisProcess = false;
      /* Explicit unlock first, so the lock is gone the moment this returns
         rather than whenever the socket closes. `pool.end()` would do it too;
         doing both means a slow teardown cannot delay the next file. */
      await client.query("select pg_advisory_unlock($1)", [RUN_LOCK]);
      client.release();
      await pool.end();
    },
  };
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
 * `store-roundtrip` hold `CORPUS_LOCK` across their `beforeAll` and reach this
 * one through the fixture loader, so the order there is corpus-then-run; no
 * file-scope holder of this lock ever wants the corpus lock, so there is no
 * cycle. Keep it that way: **corpus outside, run inside.**
 */
export async function withRunLock<T>(
  what: string,
  body: () => Promise<T>,
  options: RunLockOptions = {},
): Promise<T> {
  if (heldByThisProcess) return await body();
  const lock = await takeRunLock(what, options);
  try {
    return await body();
  } finally {
    await lock.release();
  }
}
