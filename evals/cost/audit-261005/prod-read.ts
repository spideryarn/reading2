/* Read-only production reader for the cost-tracking audit.
   Run:  npx tsx evals/cost/audit-261005/prod-read.ts evals/cost/audit-261005/01-schema.sql
   Statements are split on ";\n". Runs inside BEGIN READ ONLY, rolled back. */
import { readFileSync } from "node:fs";

import { productionClient } from "../../../scripts/feedback-reporter.js";

const file = process.argv[2];
if (!file) throw new Error("usage: prod-read.ts <file.sql>");

const { client, target } = productionClient();
console.log("Target:", target);
const statements = readFileSync(file, "utf8")
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter(Boolean);
await client.connect();
try {
  await client.query("begin read only");
  for (const s of statements) {
    const first = s.split("\n")[0] ?? "";
    console.log("\n##", first.startsWith("--") ? first : "");
    await client.query("savepoint s");
    try {
      const rows = (await client.query(s)).rows;
      console.log(JSON.stringify(rows).replace(/\},\{/g, "},\n{"));
      console.log(`(${rows.length} rows)`);
    } catch (err) {
      console.log("QUERY FAILED:", (err as Error).message);
      await client.query("rollback to savepoint s");
    }
  }
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
