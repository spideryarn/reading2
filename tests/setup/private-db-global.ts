/**
 * **One private database for the whole run, and a lease that says it is alive.**
 *
 * The `private-postgres` project's `globalSetup`. It runs once, in vitest's own
 * process, before any worker starts and after every worker has finished — which
 * is the only place in a vitest run where a connection can be held open for the
 * *run's* lifetime rather than a file's.
 *
 * What it does, in order:
 *
 * 1. scavenges databases left behind by runs that were killed (best effort —
 *    never fatal, because a scavenger that fails is a tidiness problem and a
 *    suite that will not start is not);
 * 2. mints `spideryarn_test_<stamp>_<uuid>` with
 *    [`scripts/db-test-create.ts`](../../scripts/db-test-create.ts);
 * 3. **takes the lease**;
 * 4. seeds the two things a clone has not got and a migration cannot supply —
 *    the accounts a local database is expected to have
 *    ([`seed-local-accounts.ts`](../helpers/seed-local-accounts.ts)) and a
 *    placeholder Stripe price on each active tier
 *    ([`seed-private-billing-prices.ts`](../helpers/seed-private-billing-prices.ts)).
 *    Once, on the lease's own connection, because the rows persist for the whole
 *    run;
 * 5. hands the URL and the lease's `application_name` to every worker through
 *    vitest's `provide`/`inject`, which [`private-db.ts`](private-db.ts) reads.
 *
 * ## The lease is the whole safety argument, and it belongs here
 *
 * GPT Sol's blocking finding on T-B (`260903f-test-database-factory-review-sol.md`):
 * the scavenger's "older than six hours *and* nobody inside it" rule samples
 * `pg_stat_activity`, and a sample is a statement about one instant. A run whose
 * pools are all lazily closed between two files has **zero sessions** while
 * being entirely alive, so age plus emptiness cannot mean "unowned".
 *
 * A dedicated connection, opened before the first test file and closed after the
 * last, makes *"somebody is inside it"* continuously true. The scavenger's
 * non-forced `DROP DATABASE` then refuses — Postgres itself refuses it — for the
 * whole life of the owning run, and the refusal is recorded as one more spared
 * database. `dropStaleTestDatabase` in the factory explains the other half.
 *
 * **A factory function cannot hold this**, which is why T-B left it here: a
 * function that returned would either close the connection or leak it, and
 * neither is a lease.
 *
 * ## Why the workers check it too
 *
 * A lease nobody observes is a lease that can quietly not exist —
 * `docs/reusable/silent-success.md`. So the `application_name` is provided
 * alongside the URL, and every private-lane file asserts in
 * [`private-db.ts`](private-db.ts) that a session bearing it is inside the
 * database it just reached. **Watched failing on 2026-09-04** by adding
 * `await lease.end()` immediately before the `provide` below — the lease taken
 * and then dropped, which is what "sampled rather than held" looks like from a
 * worker. One private-lane file, and it failed before collecting a test:
 *
 * ```
 * Error: no lease connection is inside spideryarn_test_260904055937_0c3e1cc3…:
 *   nothing in pg_stat_activity is called spideryarn-test-lease-199448, so the
 *   scavenger's non-forced DROP DATABASE would not refuse …
 * ```
 *
 * ## `POLLUTED`: who else was inside it, and why the teardown must not `throw`
 *
 * T-E. The lease makes *"somebody is inside it"* continuously true for this run;
 * the teardown below asks whether anybody **else** was, and treats a single
 * stranger as a verdict rather than as noise. It can, because nothing outside
 * this run has any business in a database minted for it — a baseline the shared
 * `postgres` can never have, where the platform floor alone moves between 11 and
 * 12. *"Stranger"* is doing real work in that sentence; see *Four verdicts*
 * below.
 *
 * Two questions, not one, because the first is a sample and only the second is
 * atomic:
 *
 * 1. enumerate the other sessions **on the lease's own connection**, before it
 *    closes — `pid`, `application_name`, `usename`, `state`, `backend_start`,
 *    `query_start`, `wait_event`, and deliberately **not** `query`, which
 *    carries article prose (`tests/helpers/db-sessions.ts` says why);
 * 2. **terminate this run's own leftover backends by pid** (`closeOurBackends`),
 *    so that the next step has nothing of ours to trip over;
 * 3. then close the lease and try an **ordinary, non-forced `DROP DATABASE`**.
 *    If anybody appeared between the sample and the drop, Postgres refuses it
 *    itself, atomically. `WITH (FORCE)` — which is what `dropTestDatabase` does
 *    and what this teardown used to do unconditionally — would have *terminated*
 *    that session and erased the evidence.
 *
 * ### Four verdicts, because our own workers are in there too
 *
 * The first build of this failed the run on *any* session, on the strength of a
 * measurement that said the minted database is empty at teardown every time —
 * 3, 15 and 99 files, zero each. It fired immediately, on clean runs. **Both
 * measurements were right and neither statement was**, and the missing condition
 * is this: **vitest tears down `globalSetup` before it closes its worker pool**,
 * and about 29 of this lane's ~101 files never call `closeDb()`. So the *last*
 * file's pool is still open here — and only the last file's, because the worker
 * is recycled when the next file starts. Measured 2026-09-04: two known leakers
 * run together leave **2** sessions rather than 4, and either of them followed by
 * a file that closes its pool leaves **0**. The full-lane runs all happened to
 * end on a closer; the single-file runs did not.
 *
 * So the sample is partitioned three ways — the lease, **this run's own workers**
 * (`application_name === runTag`, assigned in [`private-db.ts`](private-db.ts)),
 * and **strangers** — and these are the verdicts:
 *
 * | what was in there | verdict |
 * | --- | --- |
 * | a stranger | **POLLUTED**, `process.exitCode = 1` |
 * | only this run's own workers | one informational line, run stays green |
 * | nothing | silent |
 * | *we could not tell* | **TEARDOWN FAILED**, `process.exitCode = 1` |
 *
 * The database is dropped in every one of those, `WITH (FORCE)` wherever the
 * ordinary drop did not land, so no verdict ever also leaks 12 MB.
 *
 * ### Keeping the drop atomic, which took a second pass
 *
 * The first version of the partition left our own leftover pool *in place* and
 * classified the refusal afterwards. **That silently gave up the atomic claim**,
 * GPT Sol on the built stage, 2026-09-04: one surviving pool of ours guarantees
 * the refusal anyway, so a stranger could arrive after the sample, contribute
 * nothing distinguishable, disconnect before the re-read, and the run went
 * green. A re-read in the right place is still only a second sample.
 *
 * Terminating our own by pid first (step 2) restores it: with nothing of ours
 * inside, `55006` means an unexpected client, decided by Postgres in the same
 * statement as the drop. The re-read then only has to say *who*, and it comes
 * from the **base** database — `pg_stat_activity` is cluster-wide, and opening a
 * connection to the database being dropped would block the very thing being
 * measured.
 *
 * ### "We could not tell" is not "nobody was there"
 *
 * Sol's other blocking finding, and the same class as everything else here.
 * `dropStaleTestDatabase` used to turn *every* error into `{ dropped: false }`,
 * so a permission or network failure was indistinguishable from a refusal for
 * occupancy — and with our own connections in the sample it produced no stranger
 * and a **green run on a drop that never happened**. It now returns
 * [`DropOutcome`](../../scripts/db-test-create.ts), `dropped | in-use | failed`,
 * and only `in-use` may be reasoned about as occupancy. Every other step the
 * verdict rests on — the sample, the lease close, the re-read, the forced
 * cleanup — records its own failure and fails the run under a **different**
 * banner, because "somebody was inside" and "the check did not run" are
 * different claims.
 *
 * ### `process.exitCode = 1`, and never `throw`
 *
 * **Measured on 2026-09-04, both ways, because this is the exact silent-success
 * shape the stage exists to remove.** A `throw` from here does *not* fail the
 * run: vitest's `close()` collects every global-teardown rejection into
 * `teardownErrors` and does one thing with them — `this.logger.error("error
 * during close", …)`. Nothing sets an exit code.
 *
 * ```
 *  Test Files  1 passed (1)
 * error during close Error: TEMPORARY PROBE: does a teardown throw fail the run?
 *     at Object.teardown (tests/setup/private-db-global.ts:182:9)
 * EXIT=0
 * ```
 *
 * The banner prints *after* the summary, so in a seven-minute run it scrolls
 * past while the exit code says green — **and the throw skipped the drop**,
 * leaking a database the scavenger would not touch for six hours. The same probe
 * written as `process.exitCode = 1` gave `EXIT=1` with the drop still running.
 * So: set the exit code, finish the teardown, and do not throw.
 *
 * ## When there is no local stack
 *
 * An unreachable stack is fatal under `REQUIRE_POSTGRES=1` (which `npm run
 * check` sets). Otherwise this provides `null`, and the per-file setup poisons
 * `DATABASE_URL` so that a suite skips loudly instead of quietly finding the
 * shared database. Making the database mandatory is the hinge's job,
 * docs/plans/260903f… § *Making the database required*.
 *
 * **This used to say that `npm test` with Docker off "skips the Postgres suites
 * and says so", and that was not true when it was written.** Measured
 * 2026-09-04 with `DATABASE_URL` on a dead port: twelve private-lane files fail
 * rather than skip, because their fixtures reach the database outside any
 * `pgReady` gate — and nine of the same ten sampled fail identically under the
 * single-project config from *before* the lanes existed. So the lanes did not
 * cause it and this stage cannot claim to have preserved it. `health.test.ts`
 * was the one file that could have been laid at the lanes' door, and it has a
 * gate now. docs/project/testing.md § *With Docker off*.
 *
 * ## Only "the stack is not running" may become a skip
 *
 * See the `catch` below. Every other failure is a broken factory and is fatal.
 */
import { Client } from "pg";
import type { TestProject } from "vitest/node";

import {
  baseUrl,
  createTestDatabase,
  type DropOutcome,
  dropStaleTestDatabase,
  scavengeTestDatabases,
  StackUnreachable,
} from "../../scripts/db-test-create.js";
import {
  type DbSession,
  describeSession,
  isClient,
  type Queryable,
  sessionsIn,
} from "../helpers/db-sessions.js";
import { postgresRequired } from "../helpers/pg-ready.js";
import { seedLocalAccounts } from "../helpers/seed-local-accounts.js";
import { seedPrivateBillingPrices } from "../helpers/seed-private-billing-prices.js";

/** What a worker needs in order to reach — and to verify — the private database. */
export interface PrivateDatabase {
  name: string;
  /** Carries the local password. Never logged; `name` is what gets printed. */
  url: string;
  /**
   * The lease connection's `application_name`, so a worker can prove the lease
   * is there without knowing anything else about this process.
   */
  lease: string;
  /**
   * What every connection a **worker** opens calls itself: `private-db.ts`
   * assigns it to `PGAPPNAME` before the test file it precedes imports anything,
   * and [`src/db/client.ts`](../../src/db/client.ts) § `applicationName` honours
   * that variable ahead of its own name.
   *
   * It exists so the teardown can tell *this run's own leftover pools* from a
   * stranger. It carries vitest's main pid, so two concurrent runs on this box
   * never claim each other's connections.
   */
  runTag: string;
}

declare module "vitest" {
  interface ProvidedContext {
    /** `null` when there was no reachable stack and none was required. */
    privateDatabase: PrivateDatabase | null;
  }
}

/**
 * Identifies this run's lease in `pg_stat_activity`, for a person reading it as
 * much as for the workers' assertion. The pid makes two concurrent runs on this
 * box distinguishable; nothing depends on its shape beyond being unique.
 */
function leaseName(): string {
  return `spideryarn-test-lease-${process.pid}`;
}

/**
 * What this run's **workers** call themselves. Same pid, so the two names pair
 * up in `pg_stat_activity` and a reader can see at a glance that a leftover pool
 * belongs to the run that is finishing rather than to a stranger.
 *
 * **The trust assumption, plainly:** `application_name` is chosen by the client,
 * so the pid makes this tag collision-resistant between *cooperative* concurrent
 * runs and nothing more. A process that set the same string would be filed as
 * ours. That is not an adversarial boundary and cannot be one while every
 * worktree on this box connects with the same local superuser credential.
 */
function runTag(): string {
  return `spideryarn-test-private-${process.pid}`;
}

/** Who was inside the minted database at teardown, sorted into three kinds. */
interface Occupants {
  /** This run's own workers, by `application_name` — expected, never a failure. */
  ours: DbSession[];
  /** Anybody else who connected. One of these makes the run POLLUTED. */
  strangers: DbSession[];
  /** Postgres's own workers, which are nobody's session. */
  background: DbSession[];
  /**
   * The ordinary drop was refused and there was nobody at all to pin it on.
   * Counted with the strangers: our own tagged backends were terminated before
   * the drop was attempted, so a refusal we cannot attribute is a client that
   * came and went.
   */
  ghostRefusal: boolean;
}

/**
 * **Postgres's own workers first, and that is not a formality.** An autovacuum
 * worker inside a freshly restored database has a null `usename`, an empty
 * `application_name` and this database's `datname`, so it reads exactly like an
 * anonymous intruder — one turned up beside the real intruder in the first
 * report this check ever printed, 2026-09-04.
 */
function classify(rows: readonly DbSession[], tag: string, inUse: boolean): Occupants {
  const clients = rows.filter(isClient);
  return {
    ours: clients.filter((s) => s.application_name === tag),
    strangers: clients.filter((s) => s.application_name !== tag),
    background: rows.filter((s) => !isClient(s)),
    ghostRefusal: inUse && rows.length === 0,
  };
}

/**
 * **Close this run's own leftover backends, so that a refusal means somebody
 * else.**
 *
 * GPT Sol's blocking finding on the built stage, 2026-09-04: with one of our own
 * pools still inside, the ordinary `DROP DATABASE` was *going to* be refused
 * anyway, so a stranger who arrived after the sample and left before the re-read
 * contributed nothing distinguishable and the run went green. The re-read was in
 * the right place but it is a second sample, and two samples are not an atomic
 * decision.
 *
 * Terminating our own first restores the property: with nothing of ours inside,
 * `55006` means an unexpected client, decided by Postgres in the same statement
 * as the drop.
 *
 * **By pid, and only the pids already classified as ours.** Never a `where
 * datname = …` sweep, which would take a stranger too and destroy the evidence
 * exactly as `WITH (FORCE)` did. `pg_terminate_backend` returns false for a pid
 * that has already gone, which is a normal outcome here and not an error.
 */
async function closeOurBackends(db: Queryable, ours: readonly DbSession[]): Promise<void> {
  if (ours.length === 0) return;
  await db.query("select pg_terminate_backend(pid) from pg_stat_activity where pid = any($1)", [
    ours.map((s) => s.pid),
  ]);
}

/** Where a line of the teardown's report goes. */
type Say = (line: string) => void;

/**
 * Nobody was in there but us. Informational only; the run stays green.
 *
 * **It says what was observed, not what caused it.** The tag identifies a
 * connection this run made; it does not prove which file made it, nor that any
 * particular file is missing a `closeDb()` — Sol's advisory on the built stage.
 * An unclosed pool in the last file to run is the likely explanation, and
 * `docs/project/testing.md` § `POLLUTED` owns that account.
 */
function reportExpected(say: Say, who: Occupants, inUse: boolean): void {
  if (who.ours.length > 0) {
    say(
      `${who.ours.length} of this run's own tagged connection(s) remained at teardown ` +
        "and were closed. Likely an unclosed pool in the last file to run;",
    );
    say("bounded to that one worker either way, and not pollution.");
  }
  if (who.background.length > 0 && inUse) {
    say(
      `${who.background.length} of Postgres's own worker(s) were inside it ` +
        `(${who.background.map((s) => s.backend_type ?? "?").join(", ")}). Not pollution.`,
    );
  }
}

/**
 * **We could not tell, which is a different claim from "somebody was inside".**
 *
 * Sol's second blocking finding: a `DROP DATABASE` that fails for a permission,
 * network or internal reason used to be indistinguishable from one refused for
 * occupancy, and with our own connections in the sample it produced no stranger
 * and a green run. So every step the verdict rests on — the sample, the lease
 * close, the drop, the re-read, the forced cleanup — reports its own failure
 * here, and any of them fails the run. It does **not** print POLLUTED: that
 * banner is a claim about an intruder and needs evidence this run has not got.
 */
function reportTeardownFailed(say: Say, name: string, problems: readonly string[]): void {
  say("");
  say("============================= TEARDOWN FAILED =============================");
  say(`${name}: the teardown could not establish who was inside it.`);
  for (const p of problems) say(`  ${p}`);
  say("This is not POLLUTED — nothing here says a stranger was there, only that");
  say("the check that would have told us did not run. See tests/setup/private-db-global.ts.");
  say("===========================================================================");
  say("");
}

/**
 * Steps 1 and 2 of the teardown: who is inside, and then get our own out.
 *
 * Both failures are recorded rather than thrown, because a broken probe must
 * never become a leaked database — and both are fatal to the run, because the
 * verdict rests on them.
 */
async function enumerateAndClearOurs(
  lease: Queryable,
  name: string,
  tag: string,
  problems: string[],
): Promise<DbSession[]> {
  let rows: DbSession[];
  try {
    rows = await sessionsIn(lease, name);
  } catch (err) {
    problems.push(`the sample on the lease connection failed: ${(err as Error).message}`);
    return [];
  }
  try {
    await closeOurBackends(
      lease,
      rows.filter((s) => isClient(s) && s.application_name === tag),
    );
  } catch (err) {
    problems.push(`could not close this run's own backends: ${(err as Error).message}`);
  }
  return rows;
}

/**
 * Step 4: a refusal is occupancy, so read *whose* — from the base database,
 * because `pg_stat_activity` is cluster-wide and opening a connection to the
 * database being dropped would block the very thing being measured.
 */
async function occupantsFromBase(
  name: string,
  tag: string,
  problems: string[],
): Promise<DbSession[]> {
  const outside = new Client({ connectionString: baseUrl(), application_name: tag });
  try {
    await outside.connect();
    return await sessionsIn(outside, name);
  } catch (err) {
    problems.push(`could not read who refused the drop: ${(err as Error).message}`);
    return [];
  } finally {
    await outside.end().catch(() => {});
  }
}

/**
 * Loud, attributed, and the caller then sets `process.exitCode` — see the
 * header for why this is not a `throw`.
 */
function reportPolluted(
  say: Say,
  name: string,
  tag: string,
  who: Occupants,
  ordinary: DropOutcome,
): void {
  say("");
  say("================================ POLLUTED ================================");
  say(`${name} was minted for this run alone, and it was not this run's alone.`);
  if (who.strangers.length > 0) {
    say(`${who.strangers.length} session(s) that are not this run's (${tag}) were inside it:`);
    for (const s of who.strangers) say(`  ${describeSession(s)}`);
  }
  if (who.ours.length > 0) {
    say(
      `(${who.ours.length} tagged connection(s) of this run's were there too, and were closed.)`,
    );
  }
  if (who.background.length > 0) {
    say(`(${who.background.length} of Postgres's own worker(s) were there too, also expected.)`);
  }
  if (who.ghostRefusal) {
    say("and the ordinary DROP DATABASE was refused with nothing visible inside it a");
    say("moment later — somebody was there at the instant Postgres looked, and left.");
  } else if (ordinary.kind === "in-use") {
    say(`and the ordinary DROP DATABASE was refused: ${ordinary.why}`);
    say("Ours were terminated first, so Postgres decided that atomically about somebody");
    say("else, and it outranks the sample above.");
  }
  say("Something outside this run reached the private database. Nothing should be");
  say("able to — see docs/project/testing.md § POLLUTED.");
  say("==========================================================================");
  say("");
}

/**
 * Vitest 4 hands a `globalSetup` file the `TestProject` itself — the
 * `GlobalSetupContext` of the 2.x-era examples is gone — and `provide` is a
 * bound property on it, so destructuring it is safe.
 */
export default async function setup({ provide }: TestProject): Promise<() => Promise<void>> {
  const say = (line: string) => process.stderr.write(`  [private lane] ${line}\n`);

  /* Killed runs do not clean up after themselves — no teardown runs after a
     SIGKILL — so somebody has to, and the run that is starting is the one with
     a reason to care. Never fatal: `scavengeTestDatabases` refuses to force
     anything, so the worst it can do is leave a database alone. */
  try {
    const swept = await scavengeTestDatabases();
    if (swept.dropped.length > 0) say(`scavenged ${swept.dropped.join(", ")}`);
  } catch (err) {
    say(`could not scavenge (carrying on): ${(err as Error).message}`);
  }

  const started = Date.now();
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  try {
    db = await createTestDatabase();
  } catch (err) {
    /**
     * **Only "the stack is not running" may become a skip**, and it has to say
     * so itself — `StackUnreachable`, raised by the three places in the factory
     * that can mean nothing else.
     *
     * This was `catch (err)` until 2026-09-04, which is to say *every* failure
     * was reported as Docker being off: a failed dump, a failed restore, a
     * cluster-identity mismatch, a failed migration. Each of those is a broken
     * factory, and each one silently skipped ninety Postgres suites while
     * printing a sentence that was not true. GPT Sol found it reviewing T-D,
     * and it is the same shape as everything in
     * docs/reusable/silent-success.md: the check shares an assumption with the
     * bug, because "it threw" was being read as "the machine has no Docker".
     */
    if (postgresRequired() || !(err instanceof StackUnreachable)) throw err;
    /* The laptop-with-Docker-off case. Say it once, loudly, rather than 89
       times: the per-file setup's poisoned URL is what each suite then reports. */
    say(`no private database (${(err as Error).message.split("\n")[0]})`);
    say("the Postgres suites will skip. REQUIRE_POSTGRES=1 makes this a failure.");
    provide("privateDatabase", null);
    return async () => {};
  }

  const lease = new Client({ connectionString: db.url, application_name: leaseName() });
  /* An unhandled 'error' on a pg Client takes the process down. This connection
     is idle for minutes at a time, so a server restart or an administrator
     terminating it must not kill the run — the workers' own assertion is what
     reports a lease that has gone away. */
  lease.on("error", (err) => say(`the lease connection errored: ${err.message}`));

  /* Everything from here to `provide` can throw, and a throw here returns no
     teardown — so this is the one window where a failure would leak a database
     for the scavenger to find in six hours' time. `createTestDatabase` cleans
     up after itself for the same reason; this is the rest of that promise. */
  try {
    await lease.connect();
    await lease.query("select 1");
    await seedLocalAccounts(lease);
    /* The other thing a clone has not got: a Stripe price and its `livemode` on
       either tier, which `stripe-setup --apply` writes and a migration never
       can. Three suites go red without it. The fence against this ever touching
       a real database is inside the helper, and it is a positive proof rather
       than a guess. */
    const tiers = await seedPrivateBillingPrices(lease, db.name);

    provide("privateDatabase", {
      name: db.name,
      url: db.url,
      lease: leaseName(),
      runTag: runTag(),
    });
    say(
      `${db.name} in ${((Date.now() - started) / 1000).toFixed(1)}s, leased as ${leaseName()}` +
        `, priced ${tiers.length > 0 ? tiers.join("/") : "nothing"}`,
    );
  } catch (err) {
    await lease.end().catch(() => {});
    await db.drop().catch(() => {});
    throw err;
  }

  return async () => {
    const tag = runTag();
    /* Every step the verdict rests on records its failure here, and any entry
       fails the run — see `reportTeardownFailed`. "We could not tell" must never
       read as "nobody was there". */
    const problems: string[] = [];
    const seen = new Map<number, DbSession>();
    const remember = (rows: readonly DbSession[]) => {
      for (const s of rows) seen.set(s.pid, s);
    };

    /* 1 and 2 — sample on the lease's own connection, then terminate this run's
       own leftover backends so that a refusal below means somebody else. */
    remember(await enumerateAndClearOurs(lease, db.name, tag, problems));

    /* 3 — end the lease, then the non-forced drop as the atomic backstop.
       Ending it first because `drop database` refuses while *any* session is
       connected, this process's own included, and forcing a connection we own
       is pointless where closing it is polite and certain. */
    try {
      await lease.end();
    } catch (err) {
      problems.push(`the lease connection would not close: ${(err as Error).message}`);
    }
    const ordinary = await dropStaleTestDatabase(db.name);
    if (ordinary.kind === "failed") {
      /* Not occupancy. The drop never got far enough to look, so nothing below
         may reason from it about who was inside. */
      problems.push(`the ordinary DROP DATABASE failed rather than being refused: ${ordinary.why}`);
    }

    /* 4 — a refusal is occupancy, so find out whose. */
    if (ordinary.kind === "in-use") remember(await occupantsFromBase(db.name, tag, problems));

    const who = classify(
      [...seen.values()].sort((a, b) => a.pid - b.pid),
      tag,
      ordinary.kind === "in-use",
    );
    const polluted = who.strangers.length > 0 || who.ghostRefusal;

    /* 5 — the drop happens whatever the verdict: a red run that also leaks a
       12 MB database has cost more than it reported. `FORCE` only where the
       ordinary drop did not land, and a cleanup that fails is itself a problem
       rather than a printed regret. */
    let dropLine = `dropped ${db.name}`;
    if (ordinary.kind !== "dropped") {
      try {
        await db.drop();
        dropLine = `dropped ${db.name} with FORCE`;
      } catch (err) {
        problems.push(`the forced cleanup failed too: ${(err as Error).message}`);
        dropLine =
          `${db.name} is leaked; drop it with ` +
          `npx tsx scripts/db-test-create.ts --drop ${db.name}`;
      }
    }

    /* Verdict first, then what happened to the database — the cleanup's own
       outcome is one of the things a verdict can rest on, so it is decided
       before anything is printed. */
    if (polluted) reportPolluted(say, db.name, tag, who, ordinary);
    else reportExpected(say, who, ordinary.kind === "in-use");
    if (problems.length > 0) reportTeardownFailed(say, db.name, problems);
    if (polluted || problems.length > 0) process.exitCode = 1;
    say(dropLine);
  };
}
