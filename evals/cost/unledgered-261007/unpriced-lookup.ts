/* What the local ledger's unpriced rows on the dev key really cost, by
   OpenRouter's generation endpoint (scripts/openrouter-generation.ts: free,
   buys no inference). Reads the local database read-only; prints totals by
   scope, job, outcome and day, never an id.
   Run: npx tsx evals/cost/unledgered-261007/unpriced-lookup.ts [since=2026-09-01] */
import { readFileSync } from "node:fs";
import pg from "pg";

import { localOpenRouterKey, lookupGeneration } from "../../../scripts/openrouter-generation.js";

const env = readFileSync("/home/greg/code/spideryarn2/.env.local", "utf8");
const url = env.match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1];
const key = localOpenRouterKey();
if (!url || !key) throw new Error("need DATABASE_URL and the OpenRouter key in .env.local");
const since = process.argv[2] ?? "2026-09-01";

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query("begin read only");
const { rows } = await client.query<{ generation_id: string | null; scope_kind: string; purpose: string; outcome: string; day: string }>(
  `select generation_id, scope_kind, purpose, outcome, to_char(started_at at time zone 'utc','YYYY-MM-DD') as day
     from spideryarn.ai_calls
    where credential_fingerprint = '66c3cdfc178e' and started_at >= $1
      and credits_used_nanos is null and byok_upstream_nanos is null and computed_cost_nanos is null`,
  [since],
);
await client.query("rollback");
await client.end();

type Sum = { rows: number; noId: number; looked: number; missing: number; credits: number; upstream: number };
const by = new Map<string, Sum>();
const add = (k: string) => by.get(k) ?? (by.set(k, { rows: 0, noId: 0, looked: 0, missing: 0, credits: 0, upstream: 0 }), by.get(k)!);
const total = add("TOTAL");
for (const r of rows) {
  const groups = [total, add(`${r.scope_kind} / ${r.purpose} / ${r.outcome}`), add(`day ${r.day}`)];
  for (const g of groups) g.rows++;
  if (!r.generation_id) {
    for (const g of groups) g.noId++;
    continue;
  }
  const found = await lookupGeneration(r.generation_id, key);
  for (const g of groups) {
    if (found.kind !== "found") {
      g.missing++;
      continue;
    }
    g.looked++;
    g.credits += found.isByok ? 0 : (found.totalCostNanos ?? 0) / 1e9;
    g.upstream += (found.upstreamCostNanos ?? 0) / 1e9;
  }
}
console.log(`unpriced rows on 66c3cdfc178e since ${since}`);
for (const [k, s] of [...by].sort((a, b) => b[1].credits - a[1].credits))
  console.log(
    `${k.padEnd(60)} rows ${String(s.rows).padStart(4)}  no id ${String(s.noId).padStart(3)}  no record ${String(s.missing).padStart(3)}  credits $${s.credits.toFixed(4)}  upstream $${s.upstream.toFixed(4)}`,
  );
