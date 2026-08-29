/**
 * Delete checkpoints nothing has asked for in a long time.
 *
 *     npx tsx scripts/checkpoints-sweep.ts                 # what it would delete
 *     npx tsx scripts/checkpoints-sweep.ts --days 30
 *     npx tsx scripts/checkpoints-sweep.ts --delete
 *
 * **Nothing schedules this**, and docs/plans/delete-the-importer.md § B3 says
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
 * `console.log`, not `log()` — this is a CLI and the destination is a terminal.
 * CLAUDE.md § Writing code.
 */

import path from "node:path";

import { loadEnvLocal } from "../src/env.js";
import {
  CHECKPOINT_RETENTION_DAYS,
  checkpointCutoff,
} from "../src/store/checkpoints.js";
import { sweepFsCheckpoints } from "../src/store/checkpoints-fs.js";
import { STORE } from "../src/store/live.js";

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
 * The store flag, not a flag of its own. Sweeping the store nobody is reading
 * would report a number that is true about a directory nothing writes to any
 * more — a check agreeing with itself, which is the failure this repo keeps
 * finding. docs/reusable/silent-success.md.
 */
async function main(): Promise<void> {
  console.log(
    `Checkpoints last used before ${before.toISOString()} (${days} days), ` +
      `store: ${STORE}${dryRun ? "" : " — DELETING"}`,
  );
  if (STORE === "postgres") {
    const { sweepPgCheckpoints } = await import("../src/store/checkpoints-pg.js");
    const { closeDb } = await import("../src/db/client.js");
    try {
      const { swept, bytes } = await sweepPgCheckpoints(before, { dryRun });
      report(swept, bytes);
    } finally {
      await closeDb();
    }
    return;
  }
  const root = path.resolve(import.meta.dirname, "..", "data");
  const { swept, bytes } = await sweepFsCheckpoints(root, before, { dryRun });
  report(swept, bytes);
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
