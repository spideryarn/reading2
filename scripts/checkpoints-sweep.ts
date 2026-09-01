/**
 * Delete checkpoints nothing has asked for in a long time.
 *
 *     npx tsx scripts/checkpoints-sweep.ts                 # what it would delete
 *     npx tsx scripts/checkpoints-sweep.ts --days 30
 *     npx tsx scripts/checkpoints-sweep.ts --delete
 *
 * **Nothing schedules this**, and docs/plans/260827aa-delete-the-importer.md § B3 says
 * why that is safe: every checkpoint row costs a paid model call to create, so
 * the table cannot grow faster than the bill, and the one removal that has a
 * deadline — an article being deleted — is already automatic through
 * `on delete cascade`. This is housekeeping, and housekeeping nobody runs
 * leaves a growing table rather than a broken one.
 *
 * **It reports before it deletes, and that is the default.** A sweep whose
 * cutoff nobody has ever seen the effect of is a sweep you find out about by
 * paying for the work again. `--delete` is the opt-in.
 *
 * The cutoff is `last_used_at`, not `created_at`: an article re-read every week
 * is not old, however long ago its checkpoint was written.
 * src/store/checkpoints.ts § Retention.
 *
 * **Postgres only, since 2026-09-01.** This used to branch on `SPIDERYARN_STORE`
 * and sweep `data/<slug>/checkpoints/` when the flag said files. That adapter is
 * gone (docs/plans/260831b-finish-the-database-move.md § Stage 4), and it went
 * without ever having swept anything: nothing in this repository has ever
 * written a `checkpoints/` directory, while the two real checkpoints —
 * `labels-progress.json` and `pdf-chunks/` — sit one directory up from where the
 * sweep looked, and were invisible to it. There is one store now, so there is
 * nothing left to branch on.
 *
 * `console.log`, not `log()` — this is a CLI and the destination is a terminal.
 * CLAUDE.md § Writing code.
 */

import { loadEnvLocal } from "../src/env.js";
import {
  CHECKPOINT_RETENTION_DAYS,
  checkpointCutoff,
} from "../src/store/checkpoints.js";

loadEnvLocal();

const args = process.argv.slice(2);
const daysAt = args.indexOf("--days");
const days = daysAt === -1 ? CHECKPOINT_RETENTION_DAYS : Number(args[daysAt + 1]);
const dryRun = !args.includes("--delete");

if (!Number.isFinite(days) || days <= 0) {
  console.error(`--days wants a positive number, and got ${JSON.stringify(args[daysAt + 1])}.`);
  process.exit(1);
}

const before = checkpointCutoff(days);

/**
 * **A zero here still has two meanings, and they need telling apart.**
 *
 * Both callers write through the store since 2026-09-01 (landing D2), so the
 * table is no longer empty by construction — `src/labels.ts` records one row per
 * label batch and `src/pdf-read.ts` one per transcribed chunk. But a zero is
 * also what a sweep that walked the wrong shape would report, which is exactly
 * what the deleted filesystem sweep did for a year against a
 * `data/<slug>/checkpoints/` directory that never existed. So: a zero means
 * *nothing is ninety days cold*, and the way to check that it means that is to
 * look at whether there are any rows at all — `select count(*) from
 * spideryarn.checkpoints`. docs/reusable/silent-success.md.
 *
 * **Nothing is deleted on success**, deliberately: retention is this script's
 * job and nobody else's. src/store/checkpoints.ts § Retention.
 */
async function main(): Promise<void> {
  console.log(
    `Checkpoints last used before ${before.toISOString()} (${days} days)` +
      `${dryRun ? "" : " — DELETING"}`,
  );
  const { sweepPgCheckpoints } = await import("../src/store/checkpoints-pg.js");
  const { closeDb } = await import("../src/db/client.js");
  try {
    const { swept, bytes } = await sweepPgCheckpoints(before, { dryRun });
    report(swept, bytes);
  } finally {
    await closeDb();
  }
}

function report(swept: number, bytes: number): void {
  const size = `${(bytes / 1024).toFixed(1)} KB`;
  if (swept === 0) {
    console.log("Nothing that old. Nothing to do.");
    return;
  }
  console.log(
    dryRun
      ? `${swept} entries, ${size}. Nothing deleted — pass --delete to do it.`
      : `Deleted ${swept} entries, ${size}.`,
  );
}

await main();
