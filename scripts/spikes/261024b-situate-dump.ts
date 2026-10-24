/**
 * Spike 261024b: dump one production article's current text, Bibliography and
 * Claims to output/situate-spike/<slug>.json, **read-only** (a read-only
 * transaction, verified TLS, `.env.prod` through `readEnvProd`), so the Situate
 * spike can run against a real article without touching production.
 *
 *     npx tsx scripts/spikes/261024b-situate-dump.ts <slug>
 *
 * docs/investigations/261024b-situate-spike-searches-into-one-read-cost-and-quality.md
 */
import { mkdirSync, writeFileSync } from "node:fs";
import pg from "pg";
import { parse as parseConnectionString, toClientConfig } from "pg-connection-string";
import { sslDecisionFor } from "../../src/db/ssl.js";
import { readEnvProd } from "../../src/env.js";

const slug = process.argv[2];
if (!slug) throw new Error("usage: 261024b-situate-dump.ts <slug>");
const prod = readEnvProd();
const url = prod?.values.DATABASE_URL;
if (!url) throw new Error("no DATABASE_URL in .env.prod");
const ssl = sslDecisionFor(url);
if (ssl.mode !== "verified") throw new Error(`TLS not verified: ${ssl.why}`);
const parsed = toClientConfig(parseConnectionString(url)) as pg.ClientConfig;
console.log(`Target: ${prod?.file} → ${parsed.host}`);
const client = new pg.Client({ ...parsed, ssl: ssl.ssl });
await client.connect();
try {
  await client.query("begin transaction read only");
  if (slug === "--list") {
    const l = await client.query(
      `select a.slug, r.title, r.published_year, (select count(*) from spideryarn.revision_blocks b where b.revision_id = r.id) as n
         from spideryarn.articles a join spideryarn.article_revisions r on r.id = a.current_revision_id
        order by a.created_at desc limit 80`,
    );
    for (const r of l.rows) console.log(`${r.n}\t${r.published_year ?? ""}\t${r.slug}\t${(r.title ?? "").slice(0, 70)}`);
    process.exit(0);
  }
  const a = await client.query(
    `select a.id, a.slug, a.current_revision_id, r.title, r.authors, r.published_at, r.published_year,
            r.doi, r.journal, r.abstract, r.final_url, r.bibliography, r.sources_claims
       from spideryarn.articles a join spideryarn.article_revisions r on r.id = a.current_revision_id
      where a.slug = $1`,
    [slug],
  );
  const art = a.rows[0];
  if (!art) throw new Error(`no article ${slug}`);
  const b = await client.query(
    `select block_id, kind, tag, level, text, role from spideryarn.revision_blocks
      where revision_id = $1 order by ordinal`,
    [art.current_revision_id],
  );
  await client.query("rollback");
  mkdirSync("output/situate-spike", { recursive: true });
  const out = `output/situate-spike/${slug}.json`;
  writeFileSync(out, JSON.stringify({ ...art, blocks: b.rows }, null, 1));
  console.log(`${out}: ${b.rows.length} blocks`);
} finally {
  await client.end();
}
