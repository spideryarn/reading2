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
 *
 * ## And it reads the database you named, which took until 2026-09-03
 *
 * The header above worries about writing to the wrong *place* and never worried
 * about reading from the wrong *database*. This called `loadEnvLocal()` and
 * nothing else, so `.env.local` beat the command line — which is the file's
 * documented rule and the right one for the app — and
 * `DATABASE_URL=<remote> npm run db:export` exported **the laptop**, printing
 * `✓ <slug>` per article the whole way. A directory that looks like a backup of
 * production and is a backup of a developer machine, produced by the one tool
 * anybody reaches for after losing something.
 * docs/reusable/silent-success.md. Six of eleven `db-*` scripts had already
 * been given `resolveTargetUrl`; this one had been *named* as sharing the trap
 * in docs/project/database.md since 2026-09-01 and left alone, which is
 * docs/plans/260903e-sweep-recorded-rather-than-fixed-defects.md's whole subject.
 */

import { closeDb } from "../src/db/client.js";
import type { RawSourceStore } from "../src/store/blobs.js";
import { withoutPassword } from "../src/db/ssl.js";
import { loadEnvLocal, resolveTargetUrl } from "../src/env.js";
import { exportArticle, exportBlobStore, exportableSlugs } from "../src/store/export.js";
import path from "node:path";

/* Kept explicit even though `resolveTargetUrl` calls it too: this script reads
   other variables out of `.env.local` as well, and the load being visible here
   is what says so. It memoises, so the second call costs nothing. */
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

/**
 * **The shell's `DATABASE_URL` wins**, as it does for `db-migrate` and
 * `db-check` and for the same reason: the target of a rollback is an
 * **argument**, not configuration. src/env.ts § `resolveTargetUrl` holds the
 * rule and the two camps it settles.
 *
 * Below the `--out` check so that a bare `npm run db:export` answers the
 * question it was actually asked, and above everything that opens anything.
 */
const url = resolveTargetUrl({ shellWins: true });
if (!url) {
  console.error(
    "DATABASE_URL is not set.\n" +
      "  Local: npm run db:start, then it comes from .env.local.\n" +
      "  See docs/project/supabase-local.md.",
  );
  process.exit(1);
}

/**
 * **Written back, and this line is the fix rather than the `Target:` one below.**
 *
 * Unlike its siblings this script builds no pool of its own: `getDb()`
 * (src/db/client.ts) and `postgresBlobStore()` (src/store/blobs.ts) each read
 * `process.env.DATABASE_URL` for themselves, so resolving a URL into a local
 * `const` and printing it would announce one database and export another —
 * which is a worse bug than the one being fixed, and the exact shape
 * docs/reusable/silent-success.md is about. One resolution, written where every
 * reader of it looks. tests/db-export-target.test.ts asserts a *downstream*
 * consumer saw this value, not merely that the line was printed.
 *
 * Safe after the load above: `loadEnvLocal` memoises, so nothing will put
 * `.env.local`'s value back over the top of this.
 */
process.env.DATABASE_URL = url;

/**
 * Say out loud which database is about to be read. The same line `db-migrate`
 * and `db-check` print, and the one CLAUDE.md tells every agent to read instead
 * of the success line — a rollback that quietly exported the wrong database
 * announces itself here or not at all.
 */
console.log(`Target: ${withoutPassword(url) ?? "(a DATABASE_URL that is not a parsable URL)"}`);

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
