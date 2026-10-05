/**
 * SPIKE helper (throwaway): read the saved slice answers and the stitched tree
 * and print what a person needs to judge them. Free; local database read-only.
 *
 *   npx tsx evals/long-documents/spike-inspect.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../../src/env.js";
import { parseWholeDocumentAnswer, type BuildReport } from "../../src/structure.js";
import type { Block, Tree } from "../../src/types.js";

const OUT = path.resolve("evals/results/long-documents-2026-10-05");
loadEnvLocal();
if (new URL(process.env.DATABASE_URL ?? "postgres://missing").hostname !== "127.0.0.1") {
  throw new Error("not the local database; refusing");
}
const { loadArticle } = await import("../../src/store/index.js");
const article = (await loadArticle("s3-doctorow-250p-spya-jg872v")) as unknown as { blocks: Block[] };
const blocks = article.blocks;
const at = new Map(blocks.map((b, i) => [b.id, i]));

const summary = JSON.parse(readFileSync(path.join(OUT, "stitched-summary.json"), "utf8"));
console.log(JSON.stringify({ ...summary, depth1: undefined }, null, 1));

const plan = JSON.parse(readFileSync(path.join(OUT, "plan.json"), "utf8")).plans[0].slices as { lo: number; hi: number }[];
plan.forEach((s, i) => {
  const raw = readFileSync(path.join(OUT, `slice-${i}-answer.json`), "utf8");
  const answer = JSON.parse(raw) as { root: { title: string; children: { start: string; title: string; sourceHeading?: string; children?: { start: string; title: string }[] }[] } };
  const report: BuildReport = { repairs: [], droppedChildren: [], rangelessChildren: [], droppedHeadings: [], collapsedRungs: [], droppedQuestions: [] };
  parseWholeDocumentAnswer(raw, blocks.slice(s.lo, s.hi + 1), report);
  console.log(`\nSLICE ${i} (${s.lo}-${s.hi}) root "${answer.root.title}" dropped ${JSON.stringify(report.droppedChildren)}`);
  for (const c of answer.root.children) {
    console.log(`  ${String(at.get(c.start)).padStart(5)} ${c.title} | sourceHeading: ${c.sourceHeading ?? "-"} | sections ${c.children?.length ?? 0}`);
    if (process.argv[2] === "deep") for (const g of c.children ?? []) console.log(`        ${String(at.get(g.start)).padStart(5)} ${g.title}`);
  }
});

const tree = JSON.parse(readFileSync(path.join(OUT, "stitched-tree.json"), "utf8")) as Tree;
const nodes = Object.values(tree.nodes);
const d1 = nodes.filter((n) => n.depth === 1);
const d2 = nodes.filter((n) => n.depth === 2 && n.children.length > 0);
const pick = <T,>(xs: T[], n: number) => Array.from({ length: n }, (_, i) => xs[Math.floor(((i + 0.5) * xs.length) / n)]!);
console.log("\nDEPTH 1 gists (evenly spaced):");
for (const n of pick(d1, 5)) console.log(`  [${n.title}] ${n.gist}\n      Q: ${n.question}`);
console.log("\nDEPTH 2 gists (evenly spaced):");
for (const n of pick(d2, 5)) console.log(`  [${n.title}] ${n.gist}`);
const words = (s?: string) => (s ?? "").trim().split(/\s+/).filter(Boolean).length;
console.log("\nword counts: root", words(tree.nodes[tree.rootId]!.gist), "| depth1 max", Math.max(...d1.map((n) => words(n.gist))), "| depth2 min/max", Math.min(...d2.map((n) => words(n.gist))), Math.max(...d2.map((n) => words(n.gist))));
process.exit(0);
