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
  createTestDatabase,
  scavengeTestDatabases,
  StackUnreachable,
} from "../../scripts/db-test-create.js";
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

    provide("privateDatabase", { name: db.name, url: db.url, lease: leaseName() });
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
    /* End the lease first: `dropTestDatabase` forces, and forcing a connection
       this process owns is pointless where closing it is polite and certain. */
    await lease.end().catch(() => {});
    await db.drop();
    say(`dropped ${db.name}`);
  };
}
