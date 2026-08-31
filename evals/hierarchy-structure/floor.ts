/**
 * The noise floor, per document, from a run of repeats — the number that
 * decides whether any arm-to-arm gap is a result at all.
 *
 *   npx tsx evals/hierarchy-structure/floor.ts evals/results/hierarchy-structure/<run-dir>
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
    outcome?: "ok" | "threw";
    error?: string;
    score?: StructureScore;
    calls?: { ms: number; costUsd: number | null }[];
    repaired?: {
      ranges: number;
      blocks: number;
      largest: number;
      droppedChildren: string[];
      droppedHeadings: string[];
    };
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

/**
 * **The scalars that say how badly the answer tiled** — read off the result's
 * `repaired` block rather than its score, because a repaired answer has a
 * perfect score.
 *
 * These exist because this file's tiling instrument stopped working.
 * `throwAnatomy` below parses the anatomy of a *throw*, and it was the whole
 * measure of how often and how badly an arm failed to tile — which was fine
 * while a tiling fault threw. It does not any more: since 2026-08-31 the
 * partition is derived from the answer rather than checked against it
 * (src/hierarchy.ts § `planChildRanges`), so every one of those answers is now
 * `outcome: "ok"` with `validity.otherProblems` necessarily zero and no throw to
 * anatomise. **Without these rows the floor would be measuring the spread of the
 * normaliser's output rather than the spread of the model's.** GPT Sol's review
 * of the tiling change, finding 4 — and it is the third time this eval has had
 * to be told that a repair inside the code under measurement redefines the
 * measurement.
 *
 * `throwAnatomy` is kept: it still reads historical result files, and the faults
 * that are still refused — a backwards range, an invented id — still throw.
 */
const REPAIRED: Record<string, (r: NonNullable<RunLike["results"][number]["repaired"]>) => number> = {
  repairedRanges: (r) => r.ranges,
  repairedBlocks: (r) => r.blocks,
  largestRepair: (r) => r.largest,
  droppedSections: (r) => r.droppedChildren.length,
};

/**
 * The anatomy of a tiling throw, parsed back out of the message
 * `assertChildrenPartition` (src/hierarchy.ts) wrote — kind, size in blocks, and
 * the depth of the node whose children failed to tile.
 *
 * **It was written to answer a question that has since been answered, and then
 * settled the other way.** The question (team lead, 2026-08-30) was whether the
 * size distribution justified a *bounded* repair: off by one block mostly, and
 * snapping a child's start would recover most of a ~20% failure rate; large, and
 * a repair would mask a badly wrong answer. The measurement said off by one, the
 * repair was built and bounded — and then both bounds were overridden within two
 * days by articles they cost, until the partition stopped being checked at all
 * (src/hierarchy.ts § `planChildRanges`, 2026-08-31).
 *
 * **So a tiling fault no longer arrives here.** This still runs, and still
 * earns its place, for two reasons: historical result files were written when
 * those faults threw, and the faults that are still refused — a backwards range,
 * an invented id, a root that misses the article's ends — still throw with
 * messages this parses. What replaced it for tiling is `REPAIRED` above.
 */
export interface ThrowAnatomy {
  kind: "gap" | "overlap" | "short-at-end" | "unparsed";
  size: number | null;
  /** Depth of the node whose children failed to tile (root = 0). */
  depth: number | null;
}

/**
 * Refuses on SHAPE: a throw either matches one of the three known message
 * forms wholly, or it is `unparsed` — counted and shown raw, never dropped
 * and never fished into a bin by a stray keyword. A reworded message, or a
 * genuinely new fourth failure mode, must surface as `unparsed` rather than
 * making "no tiling failures" and "the parser stopped working" the same
 * report (docs/reusable/silent-success.md, with the parser on our side of
 * the line). tests/hierarchy-structure-eval.test.ts holds the reworded control.
 */
export function throwAnatomy(error: string): ThrowAnatomy {
  const forms = [
    {
      kind: "gap",
      re: /The children of the node at (root(?: > child \d+)*) do not tile it: child \d+ leaves a gap of (\d+) block\(s\)/,
    },
    {
      kind: "overlap",
      re: /The children of the node at (root(?: > child \d+)*) do not tile it: child \d+ overlaps the one before it by (\d+) block\(s\)/,
    },
    {
      kind: "short-at-end",
      re: /The children of the node at (root(?: > child \d+)*) stop (\d+) block\(s\) before it ends/,
    },
  ] as const;
  for (const f of forms) {
    const m = f.re.exec(error);
    if (m) {
      return {
        kind: f.kind,
        size: Number(m[2]),
        depth: m[1]!.match(/child/g)?.length ?? 0,
      };
    }
  }
  return { kind: "unparsed", size: null, depth: null };
}

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
    console.error("Usage: tsx evals/hierarchy-structure/floor.ts <run directory produced with --repeat>");
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
      /* The throw rate comes FIRST: a floor computed over the surviving runs
         alone is the variance of the survivors, and an arm that fails a fifth
         of its attempts is not better for carving consistently when it does
         not. Roughly 1-in-5 measured on HEAD, 2026-08-30. */
      const scored = repeats.filter((r) => r.outcome !== "threw" && r.score);
      const threw = repeats.length - scored.length;

      console.log(`\n${slug}  [${arm}] — ${repeats.length} attempts, ${threw} threw`);
      console.log("─".repeat(slug.length + arm.length + 8));
      if (threw > 0) {
        const kinds = new Map<string, number>();
        for (const r of repeats.filter((x) => x.outcome === "threw")) {
          const a = throwAnatomy(r.error ?? "");
          kinds.set(a.kind, (kinds.get(a.kind) ?? 0) + 1);
          console.log(
            a.kind === "unparsed"
              ? `  r${r.run} THREW, UNPARSED — raw: ${(r.error ?? "").slice(0, 110)}`
              : `  r${r.run} THREW — ${a.kind} of ${a.size} block(s), children of a depth-${a.depth} node`,
          );
        }
        console.log(
          `  throw kinds: ${[...kinds.entries()].map(([k, n]) => `${k}×${n}`).join(", ")}`,
        );
      }
      /* Before the score measures, because a run whose answers all needed
         mending has a stable-looking floor for a reason that is not stability.
         Printed only when something was mended — unlike the pipeline's own
         `Repaired:` line, which is at zero every run, this is a per-document
         table and a row of zeros on every document would bury the rest. */
      const repairedRows = repeats.filter((r) => r.repaired);
      if (repairedRows.some((r) => r.repaired!.ranges > 0 || r.repaired!.droppedChildren.length > 0)) {
        for (const [name, read] of Object.entries(REPAIRED)) {
          const values = repairedRows.map((r) => read(r.repaired!));
          const lo = Math.min(...values);
          const hi = Math.max(...values);
          console.log(
            `  ${name.padEnd(22)} ${values.map((v) => v.toFixed(0)).join("  ")}   ` +
              `range ${(hi - lo).toFixed(0)}  MAD ${mad(values).toFixed(3)}`,
          );
        }
      }
      for (const [name, read] of Object.entries(MEASURES)) {
        const values = scored
          .map((r) => read(r.score!))
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
      /* Only the runs that produced a tree have one to compare; the thrown
         attempts are already on the record above. A tree file may carry an
         .rN suffix (a --repeat run) or not (a single run) — try both. */
      const trees: { run: number; tree: Tree }[] = [];
      for (const r of scored) {
        for (const name of [`${arm}.${slug}.r${r.run}.json`, `${arm}.${slug}.json`]) {
          try {
            trees.push({
              run: r.run,
              tree: parseJsonFrom<Tree>(
                await readFile(path.join(runDir, "trees", name), "utf-8"),
                "tree",
              ),
            });
            break;
          } catch {
            // Try the other spelling.
          }
        }
      }
      const pairs: string[] = [];
      for (let i = 0; i < trees.length; i++) {
        for (let j = i + 1; j < trees.length; j++) {
          const a = compareTrees(blocks, trees[i]!.tree, trees[j]!.tree);
          pairs.push(
            `r${trees[i]!.run}~r${trees[j]!.run}: L1 ${(a.l1Boundaries * 100).toFixed(0)}% ` +
              `all ${(a.allBoundaries * 100).toFixed(0)}%` +
              (a.boundaryDistance
                ? ` ±1blk ${(a.boundaryDistance.within1Block * 100).toFixed(0)}%`
                : ""),
          );
        }
      }
      if (pairs.length > 0) console.log(`  ${"tree agreement".padEnd(22)} ${pairs.join("   ")}`);
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
