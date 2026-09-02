/* Dump the non-fixture rows of the LOCAL Postgres ledger to JSON, camelCased
   to match the filesystem ledger's field names. */
import pgMod from "/home/greg/code/spideryarn2/node_modules/pg/lib/index.js";
import { writeFileSync } from "node:fs";
const { Client } = pgMod;
const url = process.env.DATABASE_URL;
if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error("refusing non-local DATABASE_URL");
const c = new Client({ connectionString: url });
await c.connect();
const { rows } = await c.query(`
  select run_id, scope_kind, owner_id, article_slug, job_id, step_name, purpose,
         requested_model, answered_model, outcome,
         credits_used_nanos, upstream_inference_nanos, is_byok, cost_source, computed_cost_nanos,
         reported_input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
         started_at, finished_at, duration_ms
  from spideryarn.ai_calls
  where article_slug is null or article_slug not like 'test-%-fixture'
  order by started_at`);
const camel = (s) => s.replace(/_([a-z])/g, (_, x) => x.toUpperCase());
const num = (v) => (v === null || v === undefined ? null : Number(v));
const out = rows.map((r) => {
  const o = {};
  for (const [k, v] of Object.entries(r)) o[camel(k)] = v instanceof Date ? v.toISOString() : v;
  o.creditsUsedNanos = num(o.creditsUsedNanos);
  o.upstreamInferenceNanos = num(o.upstreamInferenceNanos);
  o.computedCostNanos = num(o.computedCostNanos);
  /* The Postgres ledger has no `job` column; `purpose` carries the same value. */
  o.job = o.purpose;
  return o;
});
writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
console.log("wrote", out.length, "rows");
await c.end();
