/**
 * **What code would add to each stored citations list** — the measurement in
 * docs/investigations/261027a-how-often-citations-are-missed.md (plan 261027b,
 * feedback spya-ez2vus).
 *
 * ```
 * npx tsx scripts/spikes/261027a-citations-filled-from-text.ts          # every local article with a list
 * npx tsx scripts/spikes/261027a-citations-filled-from-text.ts -v       # and every row code would add
 * ```
 *
 * Reads the local stack only (it refuses a `DATABASE_URL` that is not
 * 127.0.0.1), read-only: for each article's current revision, the stored list
 * stands in for the model's rows, and `rowsFromText` says which author–year
 * citations in the body none of them covers. No model is called.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { bodyAuthorYearCites, emptyDrops, rowsFromText } from "../../src/bibliography.js";
import { citeKey } from "../../src/citation-author-year.js";
import type { Bibliography, Block } from "../../src/types.js";

const verbose = process.argv.includes("-v");
const url = /^DATABASE_URL=["']?([^"'\n]+)/m.exec(readFileSync(".env.local", "utf8"))?.[1];
if (!url || !url.includes("127.0.0.1")) throw new Error("This spike reads the local stack only.");

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query("begin read only");
const articles = await client.query<{ slug: string; rev: string; bibliography: Bibliography }>(
  `select a.slug, a.current_revision_id rev, r.bibliography
     from spideryarn.articles a join spideryarn.article_revisions r on r.id = a.current_revision_id
    where r.bibliography is not null order by a.slug`,
);
for (const { slug, rev, bibliography } of articles.rows) {
  const rows = await client.query<{ block_id: string; kind: Block["kind"]; role: Block["role"] | null; note_id: string | null; text: string }>(
    "select block_id, kind, role, note_id, text from spideryarn.revision_blocks where revision_id = $1 order by ordinal",
    [rev],
  );
  const blocks = rows.rows.map(
    (b) =>
      ({
        id: b.block_id,
        kind: b.kind,
        text: b.text,
        tag: "p",
        html: "",
        words: 1,
        gistable: true,
        ...(b.role ? { role: b.role } : {}),
        ...(b.note_id ? { noteId: b.note_id } : {}),
      }) as Block,
  );
  const model = bibliography.citations.filter((c) => c.listedBy === undefined);
  const drops = emptyDrops();
  const filled = rowsFromText(model, blocks, drops);
  const authorYear = new Set(bodyAuthorYearCites(blocks).map(({ cite }) => citeKey(cite))).size;
  console.log(JSON.stringify({ slug, modelRows: model.length, authorYear, filled: filled.length, overCap: drops.textOverCap }));
  if (verbose) for (const r of filled) console.log(`    ${r.title}  —  “${r.mentions[0]?.quote}”`);
}
await client.query("rollback");
await client.end();
