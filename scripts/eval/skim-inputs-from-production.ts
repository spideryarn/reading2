/**
 * **One production article's Skim inputs, read-only, into a local JSON file**
 * — so scripts/eval/skim-coverage-eval.ts can measure a prompt on the article
 * a reader's report was about when that article is not in the local database
 * (`--file=<slug>=<json>` there).
 *
 *     npx tsx scripts/eval/skim-inputs-from-production.ts <slug> <out.json>
 *
 * **It writes nothing to any database.** The same path as
 * scripts/feedback-reporter.ts: `.env.prod` through `productionClient`, one
 * `begin read only` transaction, rolled back, and a `Target:` line. It reads
 * the current revision's tree, Quotes and Ideas and its blocks in order,
 * leaving out each block's HTML, which no Skim input uses.
 *
 * The file holds a reader's article. Write it to a scratch directory, not into
 * the repository.
 */
import { writeFileSync } from "node:fs";
import { productionClient } from "../feedback-reporter.js";

const [slug, out] = process.argv.slice(2);
if (!slug || !out) throw new Error("usage: skim-inputs-from-production.ts <slug> <out.json>");

const { client, target } = productionClient();
console.log(`Target: ${target} (read only)`);
await client.connect();
try {
  await client.query("begin read only");
  const rev = await client.query<{ id: string; tree: unknown; quotes: unknown; ideas: unknown }>(
    `select r.id, r.tree, r.quotes, r.ideas
       from spideryarn.articles a
       join spideryarn.article_revisions r on r.id = a.current_revision_id
      where a.slug = $1`,
    [slug],
  );
  const row = rev.rows[0];
  if (!row) throw new Error(`no article "${slug}" in production`);
  if (!row.tree || !row.quotes || !row.ideas) {
    throw new Error(`"${slug}" lacks a tree, Quotes or Ideas (tree ${!!row.tree}, quotes ${!!row.quotes}, ideas ${!!row.ideas})`);
  }
  const blocks = await client.query(
    `select block_id as id, tag, kind, level, text, words, gistable, role, treatment
       from spideryarn.revision_blocks where revision_id = $1 order by ordinal`,
    [row.id],
  );
  await client.query("rollback");
  /* Postgres hands back `null` for an unset column; a `Block`'s optional keys are absent, not null. */
  const cleaned = blocks.rows.map((b: Record<string, unknown>) => ({
    ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== null)),
    html: "",
  }));
  writeFileSync(out, JSON.stringify({ slug, blocks: cleaned, tree: row.tree, quotes: row.quotes, ideas: row.ideas }));
  console.log(`${slug}: ${cleaned.length} blocks → ${out}`);
} finally {
  await client.end();
}
