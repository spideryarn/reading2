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
console.log(`[spike] tests target ${name}`);
