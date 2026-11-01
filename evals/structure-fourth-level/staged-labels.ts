/**
 * **What stage 2 does to the labels step**: production's `generateLabels` on
 * one run's control and staged trees, for a few touched articles, cost and
 * time from the ledger, and the labels dropped. Plan 261101d, gate 7.
 *
 *   npx tsx evals/structure-fourth-level/staged-labels.ts staged-1b slugA,slugB,…
 */
import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { collectSpend, totalSpend, type AiCallRow } from "../../src/ai-spend.js";
import { loadEnvLocal } from "../../src/env.js";
import { generateLabels } from "../../src/labels.js";
import { nullCheckpointStore } from "../../src/store/checkpoints.js";
import { splitBlocks } from "../../src/supplement.js";
import type { Block, Tree } from "../../src/types.js";
import { evalSpend, Ledger, POWER } from "../long-structure/calls.js";

loadEnvLocal();
const ROOT = path.resolve(import.meta.dirname, "../..");
const [label, slugs] = process.argv.slice(2) as [string, string];
const ledger = new Ledger(path.join(ROOT, "data/structure-fourth-level/staged", label, "labels-ledger.jsonl"), 6, false);
const out: Record<string, unknown>[] = [];
for (const slug of slugs.split(",")) {
  const { blocks } = JSON.parse(readFileSync(path.join(ROOT, "data/structure-fourth-level/corpus", `${slug}.json`), "utf8")) as { blocks: Block[] };
  const { body } = splitBlocks(blocks);
  const row: Record<string, unknown> = { slug };
  for (const arm of ["control", "staged"] as const) {
    const tree = JSON.parse(readFileSync(path.join(ROOT, "data/structure-fourth-level/staged", label, `${slug}.${arm}.json`), "utf8")) as Tree;
    const rows: AiCallRow[] = [];
    const started = Date.now();
    let dropped = -1;
    let batches = -1;
    const { report } = await collectSpend(async () => {
      const run = await generateLabels({ tree, blocks: body, slug, checkpoints: nullCheckpointStore(), power: POWER });
      dropped = run.dropped.length;
      batches = run.batches;
    }, evalSpend(ledger, slug, rows));
    for (const r of rows) ledger.write(label, `labels-${arm}`, undefined, 1, r);
    row[arm] = { usd: totalSpend(report.calls).nanos / 1e9, ms: Date.now() - started, calls: rows.length, batches, dropped };
  }
  console.log(JSON.stringify(row));
  out.push(row);
}
writeFileSync(path.join(ROOT, "evals/results/structure-fourth-level", `${label}-labels.json`), `${JSON.stringify(out, null, 1)}\n`);
process.exit(0);
