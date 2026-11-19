/**
 * Copy the staged corpus's blocks out of the **local** database, once, into
 * gitignored `data/structure-fourth-level/corpus/`. Read-only. Plan 261101d.
 *
 *   npx tsx evals/structure-fourth-level/staged-dump.ts
 *
 * Refuses any database that is not on this machine: this harness never reads
 * production.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { loadEnvLocal } from "../../src/env.js";
import { blockOf } from "../../src/store/block-rows.js";
import { STAGED_DOCS } from "./staged-corpus.js";

loadEnvLocal();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing a non-local database (${host})`);
console.log(`Target: ${host}`);

const OUT = path.resolve(import.meta.dirname, "../../data/structure-fourth-level/corpus");
mkdirSync(OUT, { recursive: true });
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query("set default_transaction_read_only = on");
for (const { slug } of STAGED_DOCS) {
  const { rows } = await client.query(
    `select b.block_id as id, b.tag, b.kind, b.level, b.text, b.words, b.html, b.gistable, b.note,
            b.role, b.treatment, b.note_id as "noteId", b.context_id as "contextId", b.context_type as "contextType"
       from spideryarn.articles a
       join spideryarn.revision_blocks b on b.revision_id = a.current_revision_id
      where a.slug = $1
      order by b.ordinal`,
    [slug],
  );
  if (rows.length === 0) throw new Error(`${slug}: no blocks in the local database`);
  const blocks = rows.map((r) => blockOf(r.id, r));
  writeFileSync(path.join(OUT, `${slug}.json`), JSON.stringify({ blocks }));
  console.log(`${slug}: ${blocks.length} blocks`);
}
await client.end();
