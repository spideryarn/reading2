/**
 * Delete link previews that stopped being answers a long time ago.
 *
 *     npx tsx scripts/link-previews-sweep.ts             # what it would delete
 *     npx tsx scripts/link-previews-sweep.ts --days 7
 *     npx tsx scripts/link-previews-sweep.ts --delete
 *
 * **This is the retention, and the retention is a privacy decision.**
 * `link_previews` is the one ownerless table in this schema — a row in it
 * outlives the article that introduced it, which is exactly the property the
 * comment above `checkpoints` protects by keeping that table article-scoped. The
 * bargain was that ownerless rows get a *defined* retention rather than living
 * for ever by default (GPT Sol, 2026-09-05, finding P1-7), and this script is
 * what makes that a fact rather than a sentence.
 *
 * **Nothing schedules it**, and that is stated rather than hidden. A row costs
 * one outbound fetch to create and the per-reader limiter bounds those, so the
 * table cannot grow quickly; housekeeping nobody runs leaves a growing table
 * rather than a broken one. The same reasoning `scripts/checkpoints-sweep.ts`
 * records, and this script is deliberately its twin.
 *
 * **It reports before it deletes, and that is the default.** A sweep whose
 * cutoff nobody has seen the effect of is one you find out about by refetching
 * everything. `--delete` is the opt-in.
 *
 * The cutoff is `expires_at` plus a grace period, not `created_at`. A row whose
 * expiry has just passed is refreshed in place by the next hover, and taking it
 * away in that window would trade an update for a delete and an insert.
 *
 * `console.log`, not `log()` — this is a CLI and the destination is a terminal.
 * CLAUDE.md § Writing code.
 */

import { loadEnvLocal } from "../src/env.js";
import { PREVIEW_RETENTION_DAYS } from "../src/store/pg-link-previews.js";

loadEnvLocal();

const args = process.argv.slice(2);
const daysAt = args.indexOf("--days");
const days = daysAt === -1 ? PREVIEW_RETENTION_DAYS : Number(args[daysAt + 1]);
const dryRun = !args.includes("--delete");

if (!Number.isFinite(days) || days <= 0) {
  console.error(`--days wants a positive number, and got ${JSON.stringify(args[daysAt + 1])}.`);
  process.exit(1);
}

const graceMs = days * 24 * 60 * 60 * 1000;

/**
 * **A zero has two meanings and they need telling apart**, which is the trap
 * `docs/reusable/silent-success.md` is about and the one the deleted filesystem
 * checkpoint sweep fell into for a year.
 *
 * Here a zero means *nothing is that far past its expiry*. The way to check that
 * it means that rather than "this swept the wrong thing" is to look at whether
 * there are any rows at all: `select count(*) from spideryarn.link_previews`.
 */
async function main(): Promise<void> {
  const { sweepLinkPreviews } = await import("../src/store/pg-link-previews.js");
  const { closeDb } = await import("../src/db/client.js");
  console.log(`Link previews expired more than ${days} days ago${dryRun ? "" : " — DELETING"}`);
  try {
    const swept = await sweepLinkPreviews(graceMs, { dryRun });
    if (swept === 0) {
      console.log("Nothing that old. Nothing to do.");
      return;
    }
    console.log(
      dryRun
        ? `${swept} rows. Nothing deleted — pass --delete to do it.`
        : `Deleted ${swept} rows.`,
    );
  } finally {
    await closeDb();
  }
}

await main();
