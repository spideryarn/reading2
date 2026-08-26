/**
 * Import `data/<slug>/` into Postgres.
 *
 *     npm run db:import            # every article with blocks.json + tree.json
 *     npm run db:import writes     # just this one
 *
 * `console.log` rather than the logger, deliberately: this is a CLI talking to
 * a person at a terminal, which docs/project/logging.md is explicit is not
 * logging. The importer itself logs one line per article, because that runs
 * server-side too.
 *
 * Safe to run repeatedly — see the note on idempotence in src/store/import.ts.
 * It does NOT delete anything from `data/`; the files stay as the backup and as
 * the input to the parity test.
 */

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { importableSlugs, importArticle } from "../src/store/import.js";

loadEnvLocal();

const requested = process.argv.slice(2);
const slugs = requested.length ? requested : await importableSlugs();

if (!slugs.length) {
  console.log("Nothing to import: no directory under data/ has both blocks.json and tree.json.");
  process.exit(0);
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
} finally {
  await closeDb();
}
