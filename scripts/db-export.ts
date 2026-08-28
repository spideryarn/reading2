/**
 * Write Postgres back out as article directories — the rollback.
 *
 *     npm run db:export -- --out /tmp/rollback
 *     npm run db:export -- --out /tmp/rollback writes
 *
 * `--out` is REQUIRED and has no default. Overwriting `data/` is a real thing
 * to want during a rollback and a terrible thing to do by accident: those files
 * are the backup Greg chose to keep, and clobbering them by default would
 * destroy the only copy that is not in the database you are trying to escape.
 *
 * ## It needs the bucket as well as the database
 *
 * A revision row holds a *reference* to its source document, not the document,
 * so `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are as required as
 * `DATABASE_URL` and must name the same Supabase project it does. Checked here,
 * before the first article is written, by `exportBlobStore()` — see
 * src/store/blobs.ts § `postgresBlobStore`. Without it the export reads
 * `data/_blobs/` and writes a directory that looks like a complete backup and
 * is not.
 */

import { closeDb } from "../src/db/client.js";
import type { RawSourceStore } from "../src/store/blobs.js";
import { loadEnvLocal } from "../src/env.js";
import { exportArticle, exportBlobStore, exportableSlugs } from "../src/store/export.js";
import path from "node:path";

loadEnvLocal();

const argv = process.argv.slice(2);
const outIndex = argv.indexOf("--out");
const outRoot = outIndex >= 0 ? argv[outIndex + 1] : undefined;
const slugsAsked = argv.filter((a, i) => i !== outIndex && i !== outIndex + 1 && !a.startsWith("--"));

if (!outRoot) {
  console.error(
    "--out <dir> is required.\n" +
      "  npm run db:export -- --out /tmp/rollback\n" +
      "  Pass --out data to overwrite the real directories, deliberately.",
  );
  process.exit(1);
}

/* **Before the database is opened and before anything is written.** The refusal
   is only worth having if it arrives while the output directory is still empty:
   a rollback that stops halfway leaves exactly the thing this guards against, a
   directory that looks like a backup. Caught rather than thrown, because the
   message is for a person at a terminal and a stack trace buries it. */
let sources: RawSourceStore;
try {
  sources = exportBlobStore();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

try {
  const slugs = slugsAsked.length ? slugsAsked : await exportableSlugs();
  if (!slugs.length) {
    console.log("Nothing to export: no article in Postgres has a current revision.");
  }
  for (const slug of slugs) {
    /* `output/` is a SIBLING of the data root, mirroring the repo layout, so
       `--out data` puts the id-stamped HTML back where stage 3 looks for it. */
    const result = await exportArticle(
      slug,
      {
        dataRoot: outRoot,
        outputRoot: path.join(path.dirname(path.resolve(outRoot)), "output"),
      },
      /* The one built above, so the check and the reads are the same store
         rather than two constructions that could disagree. */
      sources,
    );
    console.log(`✓ ${slug} → ${outRoot}/${slug} (${result.files.length} files)`);
  }
} finally {
  await closeDb();
}
