/**
 * **What one *Dig deeper* press on a cited work costs** — plan 261001p,
 * stage 2 (docs/plans/261001p-dig-deeper-one-action-always-searches-bigger-model.md
 * § The cost line). A measurement, not the build: nothing in `src/` imports it.
 *
 *   npx tsx scripts/probes/261001p-investigate-cost.ts <slug>:<entryId> ...
 *
 * Runs the production `investigateCitation` (src/store/index.ts) as the
 * environment owner, inside `collectSpend`, and prints each paid call's job,
 * model, tokens and cost, and the press total. It writes a real investigation
 * row to the local database, which is what a reader's press would do, and one
 * `ai_calls` row per paid call (`eval` scope; an eval's spend is refused
 * without a ledger).
 */
import { collectSpend } from "../../src/ai-spend.js";
import { closeDb } from "../../src/db/client.js";
import { loadEnvLocal } from "../../src/env.js";
import { environmentOwnerId, runAsOwner } from "../../src/owner.js";
import { costStore } from "../../src/store/ai-calls.js";
import { investigateCitation } from "../../src/store/index.js";

async function main(): Promise<void> {
  loadEnvLocal();
  const targets = process.argv.slice(2);
  if (targets.length === 0) throw new Error("usage: <slug>:<entryId> ...");
  for (const target of targets) {
    const [slug, entryId] = target.split(":");
    if (!slug || !entryId) throw new Error(`not <slug>:<entryId>: ${target}`);
    const started = Date.now();
    const { result, report } = await collectSpend(() =>
      runAsOwner(environmentOwnerId(), async () => {
        const run = await investigateCitation(slug, entryId, null);
        const stages: string[] = [];
        let ending = "no done";
        for await (const event of run.stream()) {
          if (event.type === "stage") stages.push(event.stage);
          if (event.type === "done") ending = "done";
        }
        return { stages, ending };
      }),
      {
        attribution: { scopeKind: "eval", ownerId: environmentOwnerId(), articleSlug: slug },
        sink: (row) => costStore.record(row),
      },
    );
    console.log(`\n${target} — ${result.ending}, ${((Date.now() - started) / 1000).toFixed(1)} s, stages ${result.stages.join(" → ")}`);
    let total = 0;
    for (const c of report.calls) {
      const r = c as unknown as Record<string, unknown> & { cost?: { costNanos?: number } };
      const nanos = r.cost?.costNanos ?? 0;
      total += nanos;
      const tokens = Object.fromEntries(Object.entries(r).filter(([k]) => /tokens|searches|duration/i.test(k)));
      console.log(`  ${String(r.job).padEnd(24)} ${String(r.answeredBy ?? r.model).padEnd(28)} $${(nanos / 1e9).toFixed(4)} ${JSON.stringify(tokens)}`);
    }
    console.log(`  press total $${(total / 1e9).toFixed(4)}`);
  }
  await closeDb();
}
main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
