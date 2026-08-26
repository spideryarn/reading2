/**
 * Import `data/<slug>/` into Postgres.
 *
 *     npm run db:import                  # every article with blocks.json + tree.json
 *     npm run db:import writes           # just this one
 *     npm run db:import -- --prune       # and remove articles whose directory has gone
 *
 * `console.log` rather than the logger, deliberately: this is a CLI talking to
 * a person at a terminal, which docs/project/logging.md is explicit is not
 * logging. The importer itself logs one line per article, because that runs
 * server-side too.
 *
 * Safe to run repeatedly — see the note on idempotence in src/store/import.ts.
 * It does NOT delete anything from `data/`; the files stay as the backup and as
 * the input to the parity test.
 *
 * ## `--prune` deletes, and a plain run tells you what it would delete
 *
 * `importArticle` reconciles the slug it is handed, so an article whose whole
 * directory has gone kept its rows and went on being served. Pruning is
 * opt-in, and the default is not silence: every run lists the orphans and what
 * they hold, so you can never *not* know. Deleting one takes the reader's
 * questions, conversations and saved searches with it, and there is nothing to
 * export them back from — the directory that would receive them is the thing
 * that has gone. That asymmetry is the whole reason the flag exists.
 *
 * `--prune` is refused alongside named slugs: judging what is missing needs the
 * complete picture, and a partial run does not have one.
 */

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { findOrphans, importableSlugs, importArticle, pruneOrphans } from "../src/store/import.js";
import type { Orphan } from "../src/store/import.js";

loadEnvLocal();

const args = process.argv.slice(2);
const prune = args.includes("--prune");
const requested = args.filter((arg) => arg !== "--prune");

if (prune && requested.length) {
  console.error(
    "--prune only works on a full run: deciding that an article has gone needs every\n" +
      "directory under data/ to have been looked at, and naming slugs skips that.",
  );
  process.exit(1);
}

const slugs = requested.length ? requested : await importableSlugs();

if (!slugs.length) {
  console.log("Nothing to import: no directory under data/ has both blocks.json and tree.json.");
  process.exit(0);
}

/** What an orphan holds, so nobody agrees to lose it without seeing it. */
function holdings(orphan: Orphan): string {
  const parts = [
    orphan.comments ? `${orphan.comments} comments` : "",
    orphan.chatThreads ? `${orphan.chatThreads} threads` : "",
    orphan.searchRuns ? `${orphan.searchRuns} searches` : "",
    orphan.glossaryLookups ? `${orphan.glossaryLookups} lookups` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "no reader state";
}

try {
  for (const slug of slugs) {
    const result = await importArticle(slug);
    const extras = [
      `${result.blocks} blocks`,
      `${result.comments} comments`,
      result.chatThreads ? `${result.chatThreads} threads/${result.chatMessages} messages` : "",
      result.searchRuns ? `${result.searchRuns} searches` : "",
      result.glossaryLookups ? `${result.glossaryLookups} lookups` : "",
    ].filter(Boolean);
    console.log(`✓ ${slug} — ${extras.join(", ")}`);
    if (result.absent.length) console.log(`    absent: ${result.absent.join(", ")}`);
    if (result.unrecoverable.length) {
      console.log(`    cannot be recovered from files: ${result.unrecoverable.join(", ")}`);
    }
  }

  // Only after a full run, and only against the complete list — see the header.
  if (!requested.length) {
    const orphans = await findOrphans();
    if (orphans.length && prune) {
      const removed = await pruneOrphans(orphans);
      for (const orphan of removed) {
        console.log(`✗ ${orphan.slug} — pruned (${holdings(orphan)})`);
      }
    } else if (orphans.length) {
      console.log(
        `\n${orphans.length} article${orphans.length === 1 ? "" : "s"} in Postgres whose ` +
          "data/ directory has gone:",
      );
      for (const orphan of orphans) console.log(`    ${orphan.slug} — ${holdings(orphan)}`);
      console.log("Run `npm run db:import -- --prune` to delete them. This cannot be undone.");
    }
  }
} finally {
  await closeDb();
}
