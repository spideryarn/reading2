/**
 * SPIKE (throwaway): hold `spideryarn.queue_state` in a named database, the way
 * a dev server mid-ingest does, for a fixed number of seconds. Rolls back.
 *
 *   npx tsx scripts/spike-hold-singleton.ts <file-with-url> <seconds>
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";

const [, , file, secondsRaw] = process.argv;
if (!file) throw new Error("usage: spike-hold-singleton.ts <file-with-url> <seconds>");
const seconds = Number(secondsRaw ?? 30);

const url = readFileSync(file, "utf8").trim();
const name = new URL(url).pathname.slice(1);

const client = new Client({ connectionString: url });
await client.connect();
await client.query("begin");
await client.query("select 1 from spideryarn.queue_state where id = 1 for update");
console.log(`[hold] ${name}: singleton held for ${seconds}s`);

await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

await client.query("rollback");
await client.end();
console.log(`[hold] ${name}: released, nothing committed`);
