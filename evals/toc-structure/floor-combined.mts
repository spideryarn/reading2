/**
 * One-off: the calibration floor across SEVERAL run directories.
 *
 * The calibration's attempts ended up spread over three runs — the first was
 * killed by a tiling throw before throw-as-outcome existed, the second by the
 * laptop sleeping — and floor.ts reads one directory. This gathers every
 * incumbent cell from the named dirs, adds the one thrown attempt that only
 * the spend ledger recorded (the pre-fix crash), and prints the same
 * per-document report floor.ts would have: throw anatomy first, then ranges
 * and MADs, then pairwise tree agreement. Kept as a script beside the runs it
 * describes, because the numbers quoted in the floor report must be
 * recomputable from committed artefacts.
 *
 *   npx tsx evals/toc-structure/floor-combined.mts <run-dir> [<run-dir>…]
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Block, Tree } from "../../src/types.js";
import { compareTrees, type StructureScore } from "./score.js";
import { throwAnatomy } from "./floor.js";

interface Cell {
  slug: string;
  outcome: string;
  /* Present-and-undefined, which is what exactOptionalPropertyTypes
     distinguishes from omittable. The loop below always writes the `error` and
     `treeFile` keys — undefined for a row that has neither — and the synthetic
     cell writes `score: undefined` outright. */
  error?: string | undefined;
  score?: StructureScore | undefined;
  costUsd: number | null;
  seconds: number | null;
  treeFile?: string | undefined;
}

const dirs = process.argv.slice(2);
const cells: Cell[] = [];
for (const dir of dirs) {
  const run = JSON.parse(readFileSync(path.join(dir, "run.json"), "utf-8"));
  for (const r of run.results) {
    if (r.arm !== "incumbent") continue;
    const call = (r.calls ?? [])[0] ?? {};
    let treeFile: string | undefined;
    if (r.outcome !== "threw") {
      for (const name of readdirSync(path.join(dir, "trees"))) {
        if (name.startsWith(`incumbent.${r.slug}`)) {
          // Multiple repeats in one dir carry .rN; match this row's run.
          if (name.includes(".r") ? name.includes(`.r${r.run}.`) : true) {
            treeFile = path.join(dir, "trees", name);
            break;
          }
        }
      }
    }
    cells.push({
      slug: r.slug,
      outcome: r.outcome ?? "ok",
      error: r.error,
      score: r.score,
      costUsd: call.costUsd ?? null,
      seconds: call.ms ? call.ms / 1000 : null,
      treeFile,
    });
  }
}

/* The pre-fix crash: constitution, 2026-08-30 09:18:52, $0.4067, 279s — the
   call is in data/_ai-calls.jsonl; the cell died with the runner. Recorded
   here so the floor covers the recipe, not the survivors. */
cells.push({
  slug: "constitution",
  outcome: "threw",
  error:
    "The children of the node at root > child 2 do not tile it: child 1 leaves a gap of 1 block(s). " +
    "Children must cover their parent in order, with no gaps and no overlaps — an overlap grows two " +
    "leaves for one paragraph, and a gap grows none.",
  score: undefined,
  costUsd: 0.4067,
  seconds: 279,
});

const MEASURES: Record<string, (s: StructureScore) => number | null> = {
  parts: (s) => s.parts.count,
  balanceCv: (s) => s.parts.balanceCv,
  fanoutWithin5to9: (s) => s.fanout.within5to9,
  boundariesOnHeadings: (s) => s.headings.boundariesOnHeadings,
  headingsCut: (s) => s.headings.headingsCut,
  titleRetention: (s) => s.titles.retention,
  gistRetention: (s) => s.gists.retention,
  gistTemplate: (s) => s.gists.templateRepetition,
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const mad = (xs: number[]) => median(xs.map((x) => Math.abs(x - median(xs))));

for (const slug of [...new Set(cells.map((c) => c.slug))]) {
  const mine = cells.filter((c) => c.slug === slug);
  const ok = mine.filter((c) => c.outcome !== "threw" && c.score);
  console.log(`\n${slug} — ${mine.length} attempts, ${mine.length - ok.length} threw`);
  console.log("─".repeat(slug.length + 24));
  for (const t of mine.filter((c) => c.outcome === "threw")) {
    const a = throwAnatomy(t.error ?? "");
    console.log(
      a.kind === "unparsed"
        ? `  THREW, UNPARSED — raw: ${(t.error ?? "").slice(0, 100)}`
        : `  THREW — ${a.kind} of ${a.size} block(s), children of a depth-${a.depth} node ($${t.costUsd} spent)`,
    );
  }
  for (const [name, read] of Object.entries(MEASURES)) {
    const values = ok.map((c) => read(c.score!)).filter((v): v is number => v !== null);
    if (values.length < 2) continue;
    console.log(
      `  ${name.padEnd(22)} ${values.map((v) => v.toFixed(2)).join("  ")}   range ${(Math.max(...values) - Math.min(...values)).toFixed(3)}  MAD ${mad(values).toFixed(3)}`,
    );
  }
  const secs = mine.map((c) => c.seconds).filter((s): s is number => s !== null);
  const costs = mine.map((c) => c.costUsd).filter((c): c is number => c !== null);
  console.log(`  ${"latency (s)".padEnd(22)} ${secs.map((s) => s.toFixed(0)).join("  ")}   range ${(Math.max(...secs) - Math.min(...secs)).toFixed(0)}s`);
  console.log(`  ${"cost ($)".padEnd(22)} ${costs.map((c) => c.toFixed(4)).join("  ")}   total $${costs.reduce((a, b) => a + b, 0).toFixed(4)}`);

  const { blocks } = JSON.parse(
    readFileSync(path.join("data", slug, "blocks.json"), "utf-8"),
  ) as { blocks: Block[] };
  const trees = ok
    .filter((c) => c.treeFile)
    .map((c) => JSON.parse(readFileSync(c.treeFile!, "utf-8")) as Tree);
  const pairs: string[] = [];
  for (let i = 0; i < trees.length; i++) {
    for (let j = i + 1; j < trees.length; j++) {
      const a = compareTrees(blocks, trees[i]!, trees[j]!);
      pairs.push(
        `${i + 1}~${j + 1}: L1 ${(a.l1Boundaries * 100).toFixed(0)}% all ${(a.allBoundaries * 100).toFixed(0)}%` +
          (a.boundaryDistance ? ` ±1blk ${(a.boundaryDistance.within1Block * 100).toFixed(0)}%` : ""),
      );
    }
  }
  if (pairs.length) console.log(`  ${"tree agreement".padEnd(22)} ${pairs.join("   ")}`);
}
console.log(
  "\nPer document, never pooled. The floor is the incumbent recipe's own run-to-run spread; a challenger's variance may differ.",
);
