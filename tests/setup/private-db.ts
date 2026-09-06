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
 * ## There is always a private database, since 2026-09-05
 *
 * It used to be `provide`d as `null` when the stack was unreachable and
 * `REQUIRE_POSTGRES=1` was not set, and this file then poisoned `DATABASE_URL`
 * so that a suite skipped rather than falling back to the shared one. The
 * preflight in [`private-db-global.ts`](private-db-global.ts) fails the whole
 * command now, so that state cannot arrive — `null` is gone from the provided
 * type, and `undefined` still means the harness fault it always meant.
 */
import { Client } from "pg";
import { inject } from "vitest";

import { loadEnvLocal, PINNED } from "../../src/env.js";
import type { PrivateDatabase } from "./private-db-global.js";

loadEnvLocal();

/**
 * **Name `DATABASE_URL` as this process's own, so a module reset cannot take it
 * back.** Both assignments below are invisible to `src/env.ts`'s snapshot rule
 * the moment anything calls `vi.resetModules()`: the reloaded copy takes a
 * *fresh* `INHERITED` snapshot, our value is already in it, so nothing "differs
 * from what was inherited" and `.env.local` wins the next `loadEnvLocal()`.
 *
 * The next pool then opens somewhere else entirely. Measured on 2026-09-04 by
 * [`private-lane-survives-a-module-reset.test.ts`](../private-lane-survives-a-module-reset.test.ts),
 * which without this line lands in **`postgres`** — the maintenance database —
 * and a suite that only *writes* would have written there and passed. Found
 * while converting `tests/jobs-walk.test.ts`, where it surfaced as a job reading
 * `gone` instead of `busy`.
 *
 * `PINNED` is `src/env.ts`'s answer to exactly this and
 * [`unit-no-database.ts`](unit-no-database.ts) has always used it; this lane
 * never did. **`DATABASE_URL` only**: this lane mints a database, it does not
 * mint a Supabase project, so `SUPABASE_URL` should still come from the file.
 *
 * Above the branch, so the poison URL is pinned too — otherwise a reset in a
 * lane that deliberately has *no* database would replace "refused fast" with a
 * live connection to the shared one, which is the same bug wearing a worse face.
 */
process.env[PINNED] = "DATABASE_URL";

/**
 * **`undefined` means this setup file ran without its global setup**, which is a
 * harness fault rather than a missing database — the bare symptom would be
 * `Cannot read properties of undefined (reading 'url')` three lines down. The
 * cast is because `inject`'s declared type cannot express "not provided".
 *
 * There is no `null` any more: an unreachable stack fails the command in the
 * global setup, so a worker that gets here has a database.
 */
const db = inject("privateDatabase") as PrivateDatabase | undefined;

if (db === undefined) {
  throw new Error(
    "the private lane's setup ran without its globalSetup — nothing provided `privateDatabase`. " +
      "Check that vitest.config.ts still lists ./tests/setup/private-db-global.ts as this " +
      "project's globalSetup, and that this setup file is not being used by another config.",
  );
}

{
  /* AFTER loadEnvLocal(). See the header; this line either works or does
     nothing at all, and only the control below can tell the two apart. */
  process.env.DATABASE_URL = db.url;

  /**
   * **Name every connection this worker is about to open**, so that the run's
   * teardown can tell its own leftover pools from a stranger
   * ([`private-db-global.ts`](private-db-global.ts) § *Four verdicts*).
   *
   * `pg` reads `PGAPPNAME` when a connection is *configured*
   * (`node_modules/pg/lib/connection-parameters.js`), and
   * [`src/db/client.ts`](../../src/db/client.ts) § `applicationName` honours it
   * ahead of its own name. A setup file runs before the test file it precedes
   * imports anything, so no pool exists yet — **and that ordering is asserted
   * below rather than assumed**, because it is the whole reason this works.
   */
  process.env.PGAPPNAME = db.runTag;

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
    const seen = await control.query<{ db: string; leases: number; me: string }>(
      `select current_database() as db,
              (select count(*) from pg_stat_activity
                where datname = current_database()
                  and application_name = $1
                  and pid <> pg_backend_pid())::int as leases,
              (select application_name from pg_stat_activity
                where pid = pg_backend_pid()) as me`,
      [db.lease],
    );
    const reached = seen.rows[0]?.db ?? "(nothing)";
    if (reached !== db.name) {
      throw new Error(`this setup wrote ${db.name} and the suite reached ${reached}`);
    }
    /**
     * **The ordering, asserted rather than assumed.** This client was built
     * after the `PGAPPNAME` assignment above and passes no `application_name` of
     * its own, so Postgres telling us what *this very backend* is called is a
     * direct measurement that the variable was in effect when a `pg` connection
     * was configured in this worker. If the assignment ever moves below
     * something that connects — or `pg` stops reading the variable — this fails
     * here, per file, instead of turning up as a false POLLUTED at teardown.
     * **Watched failing 2026-09-04** by moving the assignment below this block.
     */
    if (seen.rows[0]?.me !== db.runTag) {
      throw new Error(
        `this worker's connections are called ${seen.rows[0]?.me || "(nothing)"} and not ` +
          `${db.runTag}, so PGAPPNAME was not in effect when pg configured this client. ` +
          "The run's teardown would read this worker's leftover pool as a stranger and " +
          "fail the run as POLLUTED — see tests/setup/private-db-global.ts.",
      );
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
