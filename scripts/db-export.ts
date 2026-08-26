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
 */

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { exportArticle, exportableSlugs } from "../src/store/export.js";
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

try {
  const slugs = slugsAsked.length ? slugsAsked : await exportableSlugs();
  if (!slugs.length) {
    console.log("Nothing to export: no article in Postgres has a current revision.");
  }
  for (const slug of slugs) {
    /* `output/` is a SIBLING of the data root, mirroring the repo layout, so
       `--out data` puts the id-stamped HTML back where stage 3 looks for it. */
    const result = await exportArticle(slug, {
      dataRoot: outRoot,
      outputRoot: path.join(path.dirname(path.resolve(outRoot)), "output"),
    });
    console.log(`✓ ${slug} → ${outRoot}/${slug} (${result.files.length} files)`);
  }
} finally {
  await closeDb();
}
