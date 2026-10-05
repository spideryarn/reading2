/* Census, not a sample: every PRODUCTION ledger row that (a) reported no money
   and has a generation id, or (b) is a chat-wire row with is_byok null and a
   provider cost (the shape whose sampled lookups came back as zero), asked of
   OpenRouter's own record of the call (scripts/openrouter-generation.ts: free,
   buys no inference). Read-only both sides.
   Run:  npx tsx evals/cost/audit-261005/unpriced-census.ts [result.json]
   The result file holds production ids: it defaults to
   logs/cost-audit/unpriced-census-result.json (gitignored). Do not commit it. */
// biome-ignore-all lint/suspicious/noExplicitAny: a one-off audit script over untyped database and API rows
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { productionClient } from "../../../scripts/feedback-reporter.js";
import { localOpenRouterKey, lookupGeneration } from "../../../scripts/openrouter-generation.js";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const OUT = path.resolve(
  process.argv[2] ?? path.join(ROOT, "logs/cost-audit/unpriced-census-result.json"),
);

const key = localOpenRouterKey();
if (!key) throw new Error("no OpenRouter key in .env.local");

const { client, target } = productionClient();
console.log("Target:", target);

const Q = `
select id, generation_id, wire, purpose, step_name, requested_model, is_byok, outcome, cost_source,
       credits_used_nanos, byok_upstream_nanos, web_searches, started_at,
       case when cost_source <> 'computed'
             and case when is_byok is true then byok_upstream_nanos is null else credits_used_nanos is null end
            then 'unpriced' else 'priced-byok-null' end kind
  from spideryarn.ai_calls
 where generation_id is not null
   and ( (cost_source <> 'computed'
          and case when is_byok is true then byok_upstream_nanos is null else credits_used_nanos is null end)
      or (is_byok is null and cost_source = 'provider') )
 order by started_at`;

await client.connect();
let rows: Record<string, any>[] = [];
try {
  await client.query("begin read only");
  rows = (await client.query(Q)).rows;
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
console.log("rows to ask about:", rows.length);

const out: Record<string, any>[] = [];
for (const r of rows) {
  const g = await lookupGeneration(String(r.generation_id), key);
  const d = g.kind === "found" ? g.record : null;
  out.push({
    id: String(r.id).slice(0, 8),
    kind: r.kind,
    day: r.started_at.toISOString().slice(0, 10),
    wire: r.wire,
    job: r.purpose,
    model: r.requested_model,
    outcome: r.outcome,
    webSearches: r.web_searches,
    rowCredits: r.credits_used_nanos === null ? null : Number(r.credits_used_nanos),
    /* 200 a record, 404 none, anything else (or -1: no response) could not check. */
    http: g.kind === "found" ? 200 : g.kind === "no-record" ? 404 : (g.status ?? -1),
    orTotal: g.kind === "found" ? g.totalCostNanos : null,
    orUpstream: g.kind === "found" ? g.upstreamCostNanos : null,
    orByok: d?.is_byok ?? null,
    orNativeIn: d?.native_tokens_prompt ?? null,
    orNativeOut: d?.native_tokens_completion ?? null,
    orCancelled: d?.cancelled ?? null,
    orApiType: d?.api_type ?? null,
    orNumSearch: d?.num_search_results ?? null,
    idPrefix: String(r.generation_id).slice(0, 4),
  });
}
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log("result file:", OUT);

const groups = new Map<
  string,
  { n: number; answered: number; notFound: number; orCredits: number; orUpstream: number; rowCredits: number; orZero: number }
>();
for (const x of out) {
  const k = [x.kind, x.wire, x.job, x.model, x.outcome, `idprefix=${x.idPrefix}`].join(" | ");
  const g = groups.get(k) ?? { n: 0, answered: 0, notFound: 0, orCredits: 0, orUpstream: 0, rowCredits: 0, orZero: 0 };
  g.n++;
  if (x.orTotal === null) g.notFound++;
  else {
    g.answered++;
    g.orCredits += x.orTotal;
    g.orUpstream += x.orUpstream ?? 0;
    if (x.orTotal === 0 && (x.orUpstream ?? 0) === 0) g.orZero++;
  }
  g.rowCredits += x.rowCredits ?? 0;
  groups.set(k, g);
}
for (const [k, g] of [...groups].sort()) {
  console.log(
    k,
    "=>",
    `rows ${g.n}, answered ${g.answered}, no record ${g.notFound}, provider said zero ${g.orZero},`,
    `ledger $${(g.rowCredits / 1e9).toFixed(4)}, OpenRouter credits $${(g.orCredits / 1e9).toFixed(4)}, OpenRouter BYOK upstream $${(g.orUpstream / 1e9).toFixed(4)}`,
  );
}
const unpriced = out.filter((x) => x.kind === "unpriced");
console.log("UNPRICED TOTAL:", {
  rows: unpriced.length,
  answered: unpriced.filter((x) => x.orTotal !== null).length,
  openrouter_credits_usd: unpriced.reduce((s, x) => s + (x.orTotal ?? 0), 0) / 1e9,
  openrouter_byok_upstream_usd: unpriced.reduce((s, x) => s + (x.orUpstream ?? 0), 0) / 1e9,
});
