/**
 * **What the shelf costs**, against the local database.
 *
 *     npx tsx scripts/bench-shelf-reads.ts
 *
 * Times `pgArticleReader.listArticles()` and counts the statements it sends.
 * Run it before and after any change to the homepage's reads —
 * docs/plans/260828c-library-read-latency.md records what it said on 2026-08-28:
 *
 * ```
 *                          before      after
 *   statements per call    13 (1+2N)   2
 *   row JSON per call      640,893 B   4,055 B
 *   wall clock (median)    558 ms      3 ms
 * ```
 *
 * **It fails rather than shrugging.** A benchmark that cannot find the pool and
 * reports zero statements, or that measures an empty shelf, is the shape of
 * check this repo keeps writing postmortems about
 * (docs/reusable/silent-success.md) — and GPT Sol found exactly that hole in
 * the first draft of this file. Every way it could report nothing throws.
 */
import { loadEnvLocal } from "../src/env.js";
loadEnvLocal();
process.env.STORE = "postgres";
const { pgArticleReader } = await import("../src/store/pg.js");
const { closeDb, getDb } = await import("../src/db/client.js");

const db = getDb();
const pool = (db as unknown as { $client?: { query?: unknown } }).$client;
if (!pool || typeof pool.query !== "function") {
  throw new Error("cannot reach the pg pool through db.$client — nothing would be counted");
}

let statements = 0;
/* NOT wire bytes and NOT memory: the JSON length of the decoded rows. A proxy
   for "how much came back", comparable between runs of this script and nothing
   else. */
let jsonBytes = 0;
const client = pool as { query: (...a: unknown[]) => Promise<unknown> };
const original = client.query.bind(client);
client.query = async (...args: unknown[]) => {
  statements++;
  const out = (await original(...args)) as { rows?: unknown[] };
  if (out?.rows) jsonBytes += Buffer.byteLength(JSON.stringify(out.rows));
  return out;
};

const runs = 5;
const times: number[] = [];
let entries = 0;
for (let i = 0; i < runs; i++) {
  statements = 0;
  jsonBytes = 0;
  const t0 = performance.now();
  const list = await pgArticleReader.listArticles({ archived: false });
  times.push(performance.now() - t0);
  entries = list.length;
}
if (!entries) throw new Error("the shelf came back empty — this would measure nothing");
if (!statements) throw new Error("no statements counted — the wrapper did not take");

times.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      entries,
      statementsPerCall: statements,
      rowJsonBytesPerCall: jsonBytes,
      msMedian: Math.round(times[Math.floor(runs / 2)]!),
      msMin: Math.round(times[0]!),
      msMax: Math.round(times[runs - 1]!),
    },
    null,
    2,
  ),
);
await closeDb();
