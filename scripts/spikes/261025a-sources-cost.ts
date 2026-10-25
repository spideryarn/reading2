/**
 * Trial 261025a: what the trial spent, from the local `ai_calls` ledger, by article and step,
 * from the moment it started (2026-10-25 11:14 UTC). Local only.
 *
 *     npx tsx scripts/spikes/261025a-sources-cost.ts
 */
import { loadEnvLocal } from "../../src/env.js";

loadEnvLocal();
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? "")) throw new Error("261025a: local only");
const { getDb } = await import("../../src/db/client.js");
const { sql } = await import("drizzle-orm");
const rows = (
  await getDb().execute(sql`
    select article_slug, step_name, count(*)::int as calls,
           round(sum(coalesce(credits_used_nanos, computed_cost_nanos, 0)) / 1e9, 3) as usd,
           round(sum(duration_ms) / 1000.0) as s
    from spideryarn.ai_calls where created_at >= '2026-10-25 11:14:00+00'
    group by 1, 2 order by 1, 2`)
).rows as { article_slug: string | null; step_name: string | null; calls: number; usd: string; s: string }[];
let total = 0;
for (const r of rows) {
  total += Number(r.usd);
  console.log(`${(r.article_slug ?? "-").slice(0, 40).padEnd(41)} ${(r.step_name ?? "-").padEnd(16)} ${String(r.calls).padStart(3)} calls  $${r.usd}`);
}
console.log(`TOTAL $${total.toFixed(3)}`);
process.exit(0);
