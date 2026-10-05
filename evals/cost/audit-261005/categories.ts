/* Production ledger grouped by (scope, job, step), each group run through
   costCategoryOf from src/cost-categories.ts. Read-only.
   Run:  npx tsx evals/cost/audit-261005/categories.ts */
import { costCategoryOf } from "../../../src/cost-categories.js";
import { productionClient } from "../../../scripts/feedback-reporter.js";

const { client, target } = productionClient();
console.log("Target:", target);
await client.connect();
let rows: Record<string, unknown>[] = [];
try {
  await client.query("begin read only");
  rows = (
    await client.query(`select scope_kind, purpose, step_name, count(*) calls,
     sum(coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)+coalesce(computed_cost_nanos,0)) nanos
     from spideryarn.ai_calls group by 1,2,3`)
  ).rows;
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
const by = new Map<string, { calls: number; nanos: number }>();
for (const r of rows) {
  const c = costCategoryOf({
    scopeKind: r.scope_kind,
    job: r.purpose,
    stepName: r.step_name,
  } as Parameters<typeof costCategoryOf>[0]);
  const t = by.get(c) ?? { calls: 0, nanos: 0 };
  t.calls += Number(r.calls);
  t.nanos += Number(r.nanos);
  by.set(c, t);
  if (c === "unknown") console.log("UNKNOWN:", r.scope_kind, r.purpose, r.step_name, r.calls);
}
for (const [c, t] of by) console.log(c, t.calls, `$${(t.nanos / 1e9).toFixed(4)}`);
