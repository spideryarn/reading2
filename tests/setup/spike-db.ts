/**
 * SPIKE (throwaway): point the suite at a private database.
 *
 * The ordering here is the entire point, and it is the opposite of the one in
 * `scripts/spike-migrate-to.ts`. `src/env.ts` snapshots the environment at
 * module load (`INHERITED`) and then makes `.env.local` beat anything that came
 * from the shell — *except* a value that differs from the snapshot, which it
 * reads as "this process meant it".
 *
 * A test process therefore cannot be redirected with `DATABASE_URL=… npx
 * vitest`: that value IS the snapshot, so `.env.local` wins and every test
 * quietly runs against the shared database while the harness believes it did
 * something. It has to be assigned *after* `src/env.ts` has loaded, which is
 * what this file does.
 *
 * The positive control at the bottom is not optional. Without it a harness that
 * gets this backwards builds a perfect private database, runs nothing against
 * it, and reports green — docs/reusable/silent-success.md.
 */
import { readFileSync } from "node:fs";

import { loadEnvLocal } from "../../src/env.js";

loadEnvLocal();

const file = process.env.SPIKE_DB_URL_FILE;
if (!file) throw new Error("SPIKE_DB_URL_FILE unset — the spike setup cannot pick a database");

const url = readFileSync(file, "utf8").trim();

/* AFTER loadEnvLocal(), so the value differs from the snapshot and wins. */
process.env.DATABASE_URL = url;

const name = new URL(url).pathname.slice(1);
if (!name.startsWith("spideryarn_test_")) {
  throw new Error(`refusing to run against ${name}: not a spideryarn_test_* database`);
}

/**
 * The positive control, and the accounts a local database is expected to have.
 *
 * Both on one connection this file owns, before the suite registers a test.
 *
 * `current_database()` rather than the string we just wrote: the whole point of
 * the ordering above is that getting it backwards leaves `.env.local` in charge
 * while everything reports success, and the name in a URL we set ourselves
 * cannot tell us which database the suite actually reached.
 *
 * `seedLocalAccounts` is stage T-C's answer to the tail of suites that assume
 * `SPIDERYARN_OWNER_ID` already has an `auth.users` row —
 * tests/helpers/seed-local-accounts.ts says why it is one place rather than
 * fifty. **T-D promotes both halves of this into the real private lane's
 * setup**; this file is still the throwaway it says it is at the top.
 */
const { Pool } = await import("pg");
const { seedLocalAccounts } = await import("../helpers/seed-local-accounts.js");
const control = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
try {
  const seen = await control.query<{ db: string }>("select current_database() as db");
  const reached = seen.rows[0]?.db ?? "(nothing)";
  if (reached !== name) {
    throw new Error(`the spike setup wrote ${name} and the suite reached ${reached}`);
  }
  const rows = await seedLocalAccounts(control);
  process.stderr.write(`[spike] ${reached}, ${rows.length} local accounts\n`);
} finally {
  await control.end();
}
