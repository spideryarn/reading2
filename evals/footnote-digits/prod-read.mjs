// Read-only production reader. Every query runs inside BEGIN READ ONLY and is
// rolled back. Never a bare SET. Prints no credentials.
// usage: node fd-prod-read.mjs <sql-file> <out-json>
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
/* Where .env.prod and certs/ live: the primary checkout, not a worktree. */
const ROOT = process.env.SPIDERYARN_PRIMARY ?? "/home/greg/code/spideryarn2";
const require = createRequire(import.meta.url);
const pg = require("pg");

const env = readFileSync(`${ROOT}/.env.prod`, "utf8");
const m = env.match(/^DATABASE_URL=(.*)$/m);
if (!m) throw new Error("no DATABASE_URL in .env.prod");
const url = m[1].trim().replace(/^["']|["']$/g, "");
const host = new URL(url).host;
console.log(`Target: ${host} (production, read only)`);

const [sqlFile, outFile] = process.argv.slice(2);
const statements = readFileSync(sqlFile, "utf8")
  .split(/^-- name: (\S+)\s*$/m)
  .slice(1);
const client = new pg.Client({
  connectionString: url.replace(/[?&]sslmode=[^&]*/, ""),
  ssl: { ca: readFileSync(`${ROOT}/certs/supabase-ca.crt`, "utf8") },
});
const out = {};
await client.connect();
try {
  await client.query("begin isolation level repeatable read read only");
  try {
    for (let i = 0; i < statements.length; i += 2) {
      const name = statements[i];
      const sql = statements[i + 1];
      const r = await client.query(sql);
      out[name] = r.rows;
      console.log(`${name}: ${r.rows.length} rows`);
    }
  } finally {
    await client.query("rollback");
  }
} finally {
  await client.end();
}
writeFileSync(outFile, JSON.stringify(out));
console.log(`wrote ${outFile}`);
