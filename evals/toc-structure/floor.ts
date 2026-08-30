/**
 * The noise floor, per document, from a run of repeats — the number that
 * decides whether any arm-to-arm gap is a result at all.
 *
 *   npx tsx evals/toc-structure/floor.ts evals/results/toc-structure/<run-dir>
 *
 * Reads a run.json produced with `--repeat`, and for each document reports:
 * every scalar measure's range and MAD (median absolute deviation) across the
 * repeats, and the pairwise tree agreements between the repeats themselves
 * (exact Jaccard AND the tolerant nearest-cut distance, because a one-block
 * wobble reads as total disagreement under Jaccard alone).
 *
 * **Per document, never pooled** — the team lead's condition, and Sol's: a
 * pooled threshold would let the constitution's stability vouch for fowler's
 * volatility. What the floor measures is the incumbent recipe's OWN
 * run-to-run spread under this exact configuration; a challenger's variance
 * may differ, which the finalist-stage repeats check.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { isMain } from "../../src/is-main.js";
import { parseJsonFrom } from "../../src/parse-json.js";
import type { Block } from "../../src/types.js";
import type { Tree } from "../../src/types.js";
import { compareTrees, type StructureScore } from "./score.js";

interface RunLike {
  results: {
    arm: string;
    slug: string;
    run: number;
    score: StructureScore;
    calls?: { ms: number; costUsd: number | null }[];
  }[];
}

/** The scalars worth a floor, each read off a score. */
const MEASURES: Record<string, (s: StructureScore) => number | null> = {
  parts: (s) => s.parts.count,
  balanceCv: (s) => s.parts.balanceCv,
  maxInternalDepth: (s) => s.depth.maxInternal,
  modalLeafDepthShare: (s) => s.depth.modalLeafDepthShare,
  fanoutMean: (s) => s.fanout.mean,
  fanoutWithin5to9: (s) => s.fanout.within5to9,
  boundariesOnHeadings: (s) => s.headings.boundariesOnHeadings,
  headingsCut: (s) => s.headings.headingsCut,
  titleRetention: (s) => s.titles.retention,
  gistRetention: (s) => s.gists.retention,
  gistTemplate: (s) => s.gists.templateRepetition,
};

const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** Median absolute deviation — the spread statistic one outlier cannot own. */
const mad = (xs: number[]): number => {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
};

async function main(): Promise<void> {
  const runDir = process.argv[2];
  if (!runDir) {
    console.error("Usage: tsx evals/toc-structure/floor.ts <run directory produced with --repeat>");
    process.exit(1);
  }
  const run = parseJsonFrom<RunLike>(
    await readFile(path.join(runDir, "run.json"), "utf-8"),
    "run.json",
  );

  const slugs = [...new Set(run.results.map((r) => r.slug))];
  for (const slug of slugs) {
    const rows = run.results.filter((r) => r.slug === slug);
    const arms = [...new Set(rows.map((r) => r.arm))];
    for (const arm of arms) {
      const repeats = rows.filter((r) => r.arm === arm).sort((a, b) => a.run - b.run);
      if (repeats.length < 2) continue;

      console.log(`\n${slug}  [${arm}] × ${repeats.length}`);
      console.log("─".repeat(slug.length + arm.length + 8));
      for (const [name, read] of Object.entries(MEASURES)) {
        const values = repeats
          .map((r) => read(r.score))
          .filter((v): v is number => v !== null);
        if (values.length < 2) continue;
        const lo = Math.min(...values);
        const hi = Math.max(...values);
        console.log(
          `  ${name.padEnd(22)} ${values.map((v) => v.toFixed(2)).join("  ")}   ` +
            `range ${(hi - lo).toFixed(3)}  MAD ${mad(values).toFixed(3)}`,
        );
      }
      const costs = repeats.flatMap((r) => (r.calls ?? []).map((c) => c.costUsd ?? 0));
      const times = repeats.flatMap((r) => (r.calls ?? []).map((c) => c.ms / 1000));
      if (times.length > 0) {
        console.log(
          `  ${"latency (s)".padEnd(22)} ${times.map((t) => t.toFixed(0)).join("  ")}   ` +
            `range ${(Math.max(...times) - Math.min(...times)).toFixed(0)}s`,
        );
        console.log(
          `  ${"cost ($)".padEnd(22)} ${costs.map((c) => c.toFixed(4)).join("  ")}`,
        );
      }

      /* The trees themselves: how differently did the SAME recipe carve the
         SAME bytes, run to run. This is the resolution of the instrument. */
      const { blocks } = parseJsonFrom<{ blocks: Block[] }>(
        await readFile(blocksPathFor(runDir, slug), "utf-8"),
        "blocks.json",
      );
      const trees: Tree[] = [];
      for (const r of repeats) {
        const suffix = repeats.length > 1 ? `.r${r.run}` : "";
        trees.push(
          parseJsonFrom<Tree>(
            await readFile(path.join(runDir, "trees", `${arm}.${slug}${suffix}.json`), "utf-8"),
            "tree",
          ),
        );
      }
      const pairs: string[] = [];
      for (let i = 0; i < trees.length; i++) {
        for (let j = i + 1; j < trees.length; j++) {
          const a = compareTrees(blocks, trees[i]!, trees[j]!);
          pairs.push(
            `r${repeats[i]!.run}~r${repeats[j]!.run}: L1 ${(a.l1Boundaries * 100).toFixed(0)}% ` +
              `all ${(a.allBoundaries * 100).toFixed(0)}%` +
              (a.boundaryDistance
                ? ` ±1blk ${(a.boundaryDistance.within1Block * 100).toFixed(0)}%`
                : ""),
          );
        }
      }
      console.log(`  ${"tree agreement".padEnd(22)} ${pairs.join("   ")}`);
    }
  }
  console.log(
    "\nRead each document's rows on their own; a pooled threshold would let one " +
      "document's stability vouch for another's volatility.",
  );
}

/** The blocks the run measured — from the corpus dirs, matching run.ts's loading. */
function blocksPathFor(_runDir: string, slug: string): string {
  return path.join(slug === "example" ? "example" : path.join("data", slug), "blocks.json");
}

if (isMain(import.meta.url)) {
  await main();
}
