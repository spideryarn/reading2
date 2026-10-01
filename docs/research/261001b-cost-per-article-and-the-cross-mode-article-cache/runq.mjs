// usage: node runq.mjs file.sql  -- read-only: the whole file is run inside BEGIN READ ONLY ... ROLLBACK
import fs from "node:fs";
import pg from "/home/greg/code/spideryarn2/node_modules/pg/lib/index.js";
const env = fs.readFileSync("/home/greg/code/spideryarn2/.env.prod", "utf8");
const m = env.match(/^DATABASE_URL=(.*)$/m);
const url = m[1].trim().replace(/^["']|["']$/g, "");
const sql = fs.readFileSync(process.argv[2], "utf8");
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  await c.query("BEGIN READ ONLY");
  const res = await c.query(sql);
  const arr = Array.isArray(res) ? res : [res];
  for (const r of arr) {
    if (!r.fields || r.fields.length === 0) continue;
    console.log(r.fields.map((f) => f.name).join(" | "));
    for (const row of r.rows) console.log(Object.values(row).map((v) => (v instanceof Date ? v.toISOString() : v)).join(" | "));
    console.log("");
  }
} finally {
  await c.query("ROLLBACK").catch(() => {});
  await c.end();
}
