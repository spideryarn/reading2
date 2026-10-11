// Read-only dump of PDF transcription rows from ai_calls. Usage: tsx dump.ts local|prod out.json
import { writeFileSync } from "node:fs";
import { readSnapshot, localTarget } from "../../../../scripts/cost-analysis.js";
import { productionClient } from "../../../../scripts/feedback-reporter.js";

const which = process.argv[2];
const out = process.argv[3]!;
const t =
  which === "prod"
    ? (() => {
        const p = productionClient();
        return { client: p.client, description: p.target, kind: "PRODUCTION (read-only)" };
      })()
    : (() => {
        const l = localTarget();
        return { client: l.client, description: l.description, kind: "local" };
      })();
console.log(`Target: ${t.kind} — ${t.description}`);
const result = await readSnapshot(t.client, async () => {
  const ro = await t.client.query("show transaction_read_only");
  console.log("transaction_read_only =", ro.rows[0].transaction_read_only);
  const purposes = await t.client.query(
    `select purpose, step_name, scope_kind, count(*)::int n, min(started_at) first, max(started_at) last
       from spideryarn.ai_calls where purpose ilike '%pdf%' group by 1,2,3 order by 1,2,3`,
  );
  const rows = await t.client.query(
    `select id, run_id, scope_kind, article_id, article_slug, job_id, step_name, purpose, wire,
            requested_model, answered_model, upstream, started_at, finished_at, duration_ms,
            outcome, attempt, failure_phase, failure_class, failure_status,
            reported_input_tokens, output_tokens, reasoning_tokens, cache_read_tokens,
            credits_used_nanos, byok_upstream_nanos, is_byok
       from spideryarn.ai_calls where purpose = 'pdf' order by started_at`,
  );
  return { purposes: purposes.rows, rows: rows.rows };
});
writeFileSync(out, JSON.stringify(result));
console.log("purposes:");
console.table(result.purposes);
console.log("pdf rows:", result.rows.length);
