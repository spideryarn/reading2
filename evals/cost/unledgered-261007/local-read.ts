/* Read-only reader for the local database. Usage: local-read.ts <file.sql> */
import { readFileSync } from "node:fs";
import pg from "pg";

const env = readFileSync("/home/greg/code/spideryarn2/.env.local", "utf8");
const url = env.match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1];
if (!url) throw new Error("no DATABASE_URL");
console.log("Target:", new URL(url).host);
const client = new pg.Client({ connectionString: url });
const statements = readFileSync(process.argv[2]!, "utf8").split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
await client.connect();
try {
  await client.query("begin read only");
  for (const s of statements) {
    console.log("\n##", s.split("\n")[0]);
    await client.query("savepoint s");
    try {
      const rows = (await client.query(s)).rows;
      if (rows.length) console.table(rows);
      else console.log("(0 rows)");
    } catch (err) {
      console.log("QUERY FAILED:", (err as Error).message);
      await client.query("rollback to savepoint s");
    }
  }
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
