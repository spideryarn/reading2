/**
 * **Boundary recall and precision of stage 2's planner against an independent
 * annotation**, on a run's saved stage-1 trees. Free: the planner is pure, and
 * which sub-sections exist depends on it alone (a call only writes their
 * titles and gists). Plan 261101d, gate 5.
 *
 *   npx tsx evals/structure-fourth-level/staged-plan-recall.ts staged-2 data/scratch/annotation-staged-2.json
 *
 * The annotation is `{ slug: { "<section lo>": [child starts, first = lo] } }`
 * over the body indices of that run's stage-1 trees, written by a reader who
 * saw only each section's headings, never the planner's rule.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { planSubsections } from "../../src/structure-subsections.js";
import { splitBlocks } from "../../src/supplement.js";
import type { Block, Tree } from "../../src/types.js";
import { STAGED_DOCS } from "./staged-corpus.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const [label, file] = process.argv.slice(2) as [string, string];
const want = JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<string, number[]>>;
let expected = 0;
let hit = 0;
let made = 0;
let right = 0;
for (const { slug } of STAGED_DOCS) {
  const { blocks } = JSON.parse(readFileSync(path.join(ROOT, "data/structure-fourth-level/corpus", `${slug}.json`), "utf8")) as { blocks: Block[] };
  const { body } = splitBlocks(blocks);
  let tree: Tree;
  try {
    tree = JSON.parse(readFileSync(path.join(ROOT, "data/structure-fourth-level/staged", label, `${slug}.control.json`), "utf8")) as Tree;
  } catch {
    continue;
  }
  const sections = want[slug] ?? {};
  const got = new Map(planSubsections(tree, body).plans.map((p) => [p.lo, new Set(p.children.map((c) => c.lo).filter((s) => s !== p.lo))]));
  for (const [lo, starts] of Object.entries(sections)) {
    const g = got.get(Number(lo));
    for (const s of starts.filter((s) => s !== Number(lo))) {
      expected += 1;
      if (g?.has(s)) hit += 1;
      else console.log(`  missed ${slug.slice(0, 24)} [${lo}] → [${s}]${g ? "" : " (section not divided)"}`);
    }
  }
  for (const [lo, g] of got) {
    for (const s of g) {
      made += 1;
      if (sections[String(lo)]?.includes(s)) right += 1;
      else console.log(`  extra  ${slug.slice(0, 24)} [${lo}] → [${s}]`);
    }
  }
}
console.log(`${label}: recall ${hit}/${expected} = ${((100 * hit) / expected).toFixed(0)}%, precision ${right}/${made} = ${((100 * right) / made).toFixed(0)}%`);
