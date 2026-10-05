/* Accuracy check: a stratified sample of PRODUCTION ledger rows that carry a
   generation id, each compared with OpenRouter's own record of it
   (scripts/openrouter-generation.ts: free, buys no inference).
   Read-only on both sides: BEGIN READ ONLY on Postgres, a GET on theirs.
   Prints ids, models, counts and amounts only. Never prints the key.
   Run:  npx tsx evals/cost/audit-261005/accuracy-sample.ts [result.json]
   The result file holds production ids: it defaults to
   logs/cost-audit/accuracy-result.json (gitignored). Do not commit it. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { productionClient } from "../../../scripts/feedback-reporter.js";
import { localOpenRouterKey, lookupGeneration } from "../../../scripts/openrouter-generation.js";
import { keyFingerprint } from "../../../src/ai-spend.js";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, "logs/cost-audit/accuracy-result.json"));

const key = localOpenRouterKey();
if (!key) throw new Error("no OpenRouter key in .env.local");
console.log("local key fingerprint:", keyFingerprint(key));

const { client, target } = productionClient();
console.log("Target:", target);

const SAMPLE = `
with c as (
  select id, generation_id, wire, purpose, requested_model, answered_model, upstream, is_byok, outcome,
         cost_source, credits_used_nanos, byok_upstream_nanos, reported_input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, reasoning_tokens, started_at, credential_fingerprint,
         row_number() over (partition by wire, requested_model, is_byok, (outcome = 'ok')
                            order by coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0) desc, id) big,
         row_number() over (partition by wire, requested_model, is_byok, (outcome = 'ok')
                            order by md5(id::text)) rnd,
         row_number() over (partition by wire order by started_at) oldest
    from spideryarn.ai_calls
   where generation_id is not null
)
select * from c where big <= 2 or rnd <= 2 or oldest <= 1 order by wire, requested_model, started_at`;

await client.connect();
let rows: Record<string, unknown>[] = [];
try {
  await client.query("begin read only");
  rows = (await client.query(SAMPLE)).rows;
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
console.log("sampled rows:", rows.length);

const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
interface Result {
  id: string;
  day: string;
  wire: unknown;
  job: unknown;
  model: unknown;
  outcome: unknown;
  costSource: unknown;
  rowByok: unknown;
  rowCredits: number | null;
  rowByokUpstream: number | null;
  rowIn: number | null;
  rowOut: number | null;
  rowCacheRead: number | null;
  rowCacheWrite: number | null;
  rowFingerprint: unknown;
  http: number;
  orTotal: number | null;
  orUpstream: number | null;
  orByok: boolean | null;
  orModel: string | null;
  orNativeIn: number | null;
  orNativeOut: number | null;
  orNativeCached: number | null;
  orCancelled: boolean | null;
  orFinish: string | null;
}
const results: Result[] = [];
for (const r of rows) {
  const g = await lookupGeneration(String(r.generation_id), key);
  const d = g.kind === "found" ? g.record : null;
  const providerNanos = g.kind === "found" ? g.totalCostNanos : null;
  const providerUpstreamNanos = g.kind === "found" ? g.upstreamCostNanos : null;
  /* 200 a record, 404 none, anything else (or -1: no response) could not check. */
  const http = g.kind === "found" ? 200 : g.kind === "no-record" ? 404 : (g.status ?? -1);
  results.push({
    id: String(r.id).slice(0, 8),
    day: (r.started_at as Date).toISOString().slice(0, 10),
    wire: r.wire,
    job: r.purpose,
    model: r.requested_model,
    outcome: r.outcome,
    costSource: r.cost_source,
    rowByok: r.is_byok,
    rowCredits: n(r.credits_used_nanos),
    rowByokUpstream: n(r.byok_upstream_nanos),
    rowIn: n(r.reported_input_tokens),
    rowOut: n(r.output_tokens),
    rowCacheRead: n(r.cache_read_tokens),
    rowCacheWrite: n(r.cache_write_tokens),
    rowFingerprint: r.credential_fingerprint,
    http,
    orTotal: providerNanos,
    orUpstream: providerUpstreamNanos,
    orByok: d?.is_byok ?? null,
    orModel: d?.model ?? null,
    orNativeIn: d?.native_tokens_prompt ?? null,
    orNativeOut: d?.native_tokens_completion ?? null,
    orNativeCached: d?.native_tokens_cached ?? null,
    orCancelled: d?.cancelled ?? null,
    orFinish: d?.finish_reason ?? null,
  });
}
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(results, null, 1));
console.log("result file:", OUT);

let checked = 0;
let match = 0;
let mismatch = 0;
let couldNot = 0;
let rowNullProviderHas = 0;
let rowSum = 0;
let orSum = 0;
let missedNanos = 0;
for (const x of results) {
  if (x.orTotal === null) {
    couldNot++;
    continue;
  }
  checked++;
  if (x.rowCredits === null) {
    rowNullProviderHas++;
    missedNanos += x.orTotal + (x.orUpstream ?? 0);
    continue;
  }
  rowSum += x.rowCredits;
  orSum += x.orTotal;
  if (Math.abs(x.rowCredits - x.orTotal) <= 1) match++;
  else mismatch++;
}
console.log({
  sampled: results.length,
  could_not_check: couldNot,
  checked,
  credits_match_to_1_nano: match,
  credits_mismatch: mismatch,
  row_has_no_money_but_provider_answered: rowNullProviderHas,
  matched_rows_ledger_usd: rowSum / 1e9,
  matched_rows_openrouter_usd: orSum / 1e9,
  money_on_unpriced_rows_usd: missedNanos / 1e9,
});
for (const x of results) {
  console.log(
    [
      x.id,
      x.day,
      x.wire,
      x.job,
      x.model,
      x.outcome,
      `byok=${x.rowByok}/${x.orByok}`,
      `http=${x.http}`,
      `credits ${x.rowCredits} vs ${x.orTotal}`,
      `upstream ${x.rowByokUpstream} vs ${x.orUpstream}`,
      `in ${x.rowIn}+cr${x.rowCacheRead}+cw${x.rowCacheWrite} vs ${x.orNativeIn} (cached ${x.orNativeCached})`,
      `out ${x.rowOut} vs ${x.orNativeOut}`,
      x.orCancelled ? "cancelled" : "",
      x.orFinish ?? "",
    ].join(" | "),
  );
}

/* The key's own month, for the reconciliation, is `npm run cost -- --reconcile`.
   This script used to read it too; it no longer names the endpoint itself. */
