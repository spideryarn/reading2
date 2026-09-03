/**
 * Reconcile a finished run's paid calls against OpenRouter's own records.
 *
 *   npx tsx evals/hierarchy-structure/verify-costs.ts evals/results/hierarchy-structure/<run-dir>
 *
 * **A run is not quotable until this passes.** Every call in `run.json`
 * stores the in-band cost the response reported (`costUsd`) and the id the
 * generation endpoint answers to; this asks that endpoint — the provider's
 * own number, not our arithmetic — writes the answer back into `run.json` as
 * `providerCostUsd`, and exits non-zero on any call whose two figures
 * disagree by more than 10% or where the provider has no record at all. "It
 * did not throw during the run" is exactly the evidence this exists to not
 * rely on: the observer seam maps Messages-shaped usage into
 * OpenRouter-shaped rows, and the failure mode of that mapping is a cost
 * that lands as zero with nothing red anywhere
 * (docs/reusable/silent-success.md).
 *
 * **A separate file, and GET-only, on purpose.** The spend scan
 * (tests/no-undeclared-spend.test.ts) rightly forbids a raw `fetch` inside a
 * declared-bypass file — a metered declaration covers only what
 * `declaredFetch` guards — so the reconciliation cannot live in
 * model-arms.ts. This file can name the endpoint because it is on the scan's
 * allow-list with its reason: it reads generation records and can spend
 * nothing.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isMain } from "../../src/is-main.js";
import { loadEnvLocal } from "../../src/env.js";
import { parseJsonFrom } from "../../src/parse-json.js";
import type { CallStats } from "./model-arms.js";

interface RunLike {
  /**
   * Set by the runner only when every cell it set out to fill produced a
   * result. Absent means the process died partway, and the results present are
   * the survivors of whatever killed it — see `RunFile.expected` in run.ts.
   */
  completedAt?: string;
  expected?: { arm: string; slug: string }[];
  results: { arm: string; slug: string; calls?: CallStats[] }[];
}

/**
 * The provider's figure for one generation. Records lag the response by a
 * moment; three tries a second apart before "no record" is believed.
 */
async function generationCostUsd(id: string, key: string): Promise<number | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(
        `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`,
        { headers: { Authorization: `Bearer ${key}` } },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as { data?: { total_cost?: number | null } };
      if (typeof json.data?.total_cost === "number") return json.data.total_cost;
    } catch {
      // A read that failed is retried; the null after three tries is the answer.
    }
  }
  return null;
}

async function main(): Promise<void> {
  const runDir = process.argv[2];
  if (!runDir) {
    console.error("Usage: tsx evals/hierarchy-structure/verify-costs.ts <run directory>");
    process.exit(1);
  }
  loadEnvLocal();
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.error("verify-costs needs OPENROUTER_API_KEY, and there is none set. Nothing was checked.");
    process.exit(1);
  }

  const runFile = path.join(runDir, "run.json");
  const run = parseJsonFrom<RunLike>(await readFile(runFile, "utf-8"), runFile);

  /* **Reconciling a partial run is worse than not reconciling it**, because it
     ends in a tick. A panel that died on cell six leaves five reconciled arms
     and a file that looks finished, and the arms most likely to be missing are
     the ones that failed — so the survivors read as the whole field. Refused
     before a single generation is fetched. GPT Sol's review, finding 1. */
  if (!run.completedAt) {
    console.error(
      `${runFile} has no completedAt: the run did not finish every cell it set out to fill` +
        (run.expected ? ` (${run.expected.length} expected, ${run.results.length} recorded)` : "") +
        `. Reconciling the survivors would put a tick on a partial panel; re-run it.`,
    );
    process.exit(1);
  }

  const failures: string[] = [];
  let checked = 0;

  for (const result of run.results) {
    for (const [i, call] of (result.calls ?? []).entries()) {
      const label = `${result.arm}/${result.slug} call ${i + 1}`;
      if (!call.generationId) {
        failures.push(`${label}: no generation id was stored — nothing to reconcile against`);
        continue;
      }
      const provider = await generationCostUsd(call.generationId, key);
      call.providerCostUsd = provider;
      checked++;
      if (provider === null) {
        failures.push(
          `${label}: the provider has no record of ${call.generationId} — ` +
            `either the id is not a generation id (the flagged Skin fact) or the call is not ours`,
        );
        continue;
      }
      if (call.costUsd === null) {
        console.log(`${label}: in-band cost was absent; provider says $${provider.toFixed(6)}`);
        continue;
      }
      const gap = Math.abs(call.costUsd - provider) / Math.max(provider, 1e-9);
      if (gap > 0.1) {
        failures.push(
          `${label}: in-band $${call.costUsd.toFixed(6)} vs provider $${provider.toFixed(6)} ` +
            `(${(gap * 100).toFixed(0)}% apart)`,
        );
      } else {
        console.log(`${label}: $${call.costUsd.toFixed(6)} ≈ $${provider.toFixed(6)} ✓`);
      }
    }
  }

  /* The provider's answers are written back whatever the verdict, so a failed
     reconciliation leaves the evidence in the artefact rather than only in a
     scrollback. */
  await writeFile(runFile, `${JSON.stringify(run, null, 2)}\n`, "utf-8");

  if (checked === 0 && failures.length === 0) {
    console.log("No paid calls in this run — nothing to reconcile.");
    return;
  }
  if (failures.length > 0) {
    console.error(`\nNOT RECONCILED (${failures.length} of ${checked + failures.length}):`);
    for (const f of failures) console.error(`  ${f}`);
    console.error("\nThis run is not quotable until the accounting is fixed and this passes.");
    process.exit(1);
  }
  console.log(`\nAll ${checked} paid call(s) reconciled against the provider's own records.`);
}

if (isMain(import.meta.url)) {
  await main();
}
