/**
 * Which hosts do readers' imported articles come from? Counts only: a hostname
 * and how many articles and how many owners, never an address, a title or an
 * owner id. Read-only: one query inside `begin read only`, then `rollback`.
 *
 *   node evals/paper-sources/host-census.mjs /home/greg/code/spideryarn2/.env.prod
 *
 * Written for docs/research/261005d (which paper sources are worth an import
 * optimisation). The requested address is counted as well as the final one,
 * because a doi.org link is only visible in the first.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const require = createRequire(join(root, "package.json"));
const pg = require("pg");

const envFile = process.argv[2];
if (!envFile) {
  console.error("usage: node evals/paper-sources/host-census.mjs <env file holding DATABASE_URL>");
  process.exit(2);
}
const line = readFileSync(envFile, "utf8")
  .split("\n")
  .find((l) => l.startsWith("DATABASE_URL="));
if (!line) {
  console.error("no DATABASE_URL in that file");
  process.exit(2);
}
const connectionString = line.slice("DATABASE_URL=".length).replace(/^["']|["']$/g, "");
const ca = readFileSync(join(root, "certs", "supabase-ca.crt"), "utf8");

const client = new pg.Client({ connectionString, ssl: { ca } });
await client.connect();
try {
  await client.query("begin read only");
  for (const column of ["requested_url", "final_url"]) {
    const { rows } = await client.query(
      `select lower(substring(r.${column} from '^https?://([^/:?#]+)')) as host,
              count(distinct r.article_id)::int as articles,
              count(distinct a.owner_id)::int as owners
         from spideryarn.article_revisions r
         join spideryarn.articles a on a.id = r.article_id
        where r.${column} is not null
        group by 1
        order by 2 desc, 1`,
    );
    const total = rows.reduce((n, r) => n + r.articles, 0);
    console.log(`\n## ${column}: ${rows.length} hosts, ${total} article-host pairs`);
    for (const r of rows) console.log(`${String(r.articles).padStart(5)}  ${String(r.owners).padStart(3)} owners  ${r.host}`);
  }
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
