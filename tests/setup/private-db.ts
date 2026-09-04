/**
 * Point one test file at the run's private database — and prove it landed there.
 *
 * The `private-postgres` project's per-file setup. The database itself is made
 * once by [`private-db-global.ts`](private-db-global.ts); this runs in every
 * worker, before the file it precedes registers a test.
 *
 * ## The ordering is the whole thing
 *
 * [`src/env.ts`](../../src/env.ts) snapshots the environment at module load and
 * then makes `.env.local` beat the shell — *except* where the current value
 * differs from that snapshot, which it reads as "this process meant it". So a
 * test process **cannot** be redirected with `DATABASE_URL=… npx vitest`: that
 * value *is* the snapshot, `.env.local` wins, and every test quietly runs
 * against the shared database while the harness reports success. The assignment
 * has to happen after `src/env.ts` has been **loaded** — which a static `import`
 * at the top of this file guarantees, so the assignment below is safe on either
 * side of the `loadEnvLocal()` call. Measured all three ways on 2026-09-04, in
 * [`unit-no-database.ts`](unit-no-database.ts) § *The ordering is the whole
 * thing*; the boundary is the module load, not the call, and the plan's own
 * wording ("after `.env.local` has loaded") is loose about which.
 *
 * It stays below `loadEnvLocal()` anyway, because that is the order 260903e's
 * spike setup established — `tests/setup/spike-db.ts`, which this file replaces
 * and which was deleted with this stage — and there is nothing to gain from a
 * second one.
 *
 * ## Two controls, and neither is optional
 *
 * `current_database()`, over `process.env.DATABASE_URL`, not the name in the URL
 * we just wrote: the failure this guards against is a redirect that silently did
 * not happen, and neither a string we chose ourselves nor a connection we opened
 * from it can tell us which database the *suite* reached. See the note on the
 * `Client` below, which is where that distinction was found the hard way.
 *
 * The **lease**, because the private database's safety against the scavenger
 * rests on one connection being held for the whole run
 * ([`private-db-global.ts`](private-db-global.ts) says why). An absent lease is
 * not visible from inside a test — everything passes — so it is asserted here,
 * per file, by looking for its `application_name` in `pg_stat_activity`.
 *
 * ## When there is no private database
 *
 * `provide`d as `null` when the stack was unreachable and `REQUIRE_POSTGRES=1`
 * was not set. `DATABASE_URL` is then poisoned rather than left alone: a suite
 * that cannot have its private database must not fall back to the shared one,
 * and `pgReady` turns an unreachable URL into the skip and the warning it
 * already prints today.
 */
import { Client } from "pg";
import { inject } from "vitest";

import { loadEnvLocal } from "../../src/env.js";
import type { PrivateDatabase } from "./private-db-global.js";

loadEnvLocal();

/**
 * `null` is "there was no reachable stack and none was required" — a state
 * `private-db-global.ts` provides on purpose. **`undefined` is different**: it
 * means this setup file ran without that global setup having run at all, which
 * is a harness fault rather than a missing database, and the bare symptom would
 * be `Cannot read properties of undefined (reading 'url')` three lines down.
 * The cast is because `inject`'s declared type cannot express "not provided".
 */
const db = inject("privateDatabase") as PrivateDatabase | null | undefined;

if (db === undefined) {
  throw new Error(
    "the private lane's setup ran without its globalSetup — nothing provided `privateDatabase`. " +
      "Check that vitest.config.ts still lists ./tests/setup/private-db-global.ts as this " +
      "project's globalSetup, and that this setup file is not being used by another config.",
  );
}

if (db === null) {
  /* Refused fast — port 1 answers ECONNREFUSED immediately — and named so that
     the reason appears in `pgReady`'s warning rather than only in this file. */
  process.env.DATABASE_URL =
    "postgresql://spideryarn:none@127.0.0.1:1/no_private_test_database_was_created";
} else {
  /* AFTER loadEnvLocal(). See the header; this line either works or does
     nothing at all, and only the control below can tell the two apart. */
  process.env.DATABASE_URL = db.url;

  /**
   * **`process.env.DATABASE_URL`, and not `db.url`.** They are the same string
   * on a good day and that is exactly the point: the control has to connect the
   * way the *suite* will, or it cannot see the failure it exists for.
   *
   * Found by mutation on 2026-09-04. Written with `db.url` here, this control
   * passed with the redirect deliberately broken — it was opening its own
   * connection to the private database and asking that connection what its name
   * was, which is a question with only one possible answer. The spike setup
   * this promotes had the same shape, so 260903e's *"positive control"* could
   * not in fact have caught the ordering trap it was written for.
   */
  const control = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
  });
  await control.connect();
  try {
    const seen = await control.query<{ db: string; leases: number }>(
      `select current_database() as db,
              (select count(*) from pg_stat_activity
                where datname = current_database()
                  and application_name = $1
                  and pid <> pg_backend_pid())::int as leases`,
      [db.lease],
    );
    const reached = seen.rows[0]?.db ?? "(nothing)";
    if (reached !== db.name) {
      throw new Error(`this setup wrote ${db.name} and the suite reached ${reached}`);
    }
    if ((seen.rows[0]?.leases ?? 0) < 1) {
      throw new Error(
        `no lease connection is inside ${reached}: nothing in pg_stat_activity is called ` +
          `${db.lease}, so the scavenger's non-forced DROP DATABASE would not refuse and ` +
          "this database is not protected from a peer's run",
      );
    }
  } finally {
    await control.end();
  }
}
