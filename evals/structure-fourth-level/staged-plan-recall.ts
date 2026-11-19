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
const corpus = new Set(STAGED_DOCS.map(({ slug }) => slug));
const annotated = new Set(Object.keys(want));
const missing = [...corpus].filter((slug) => !annotated.has(slug));
const unexpected = [...annotated].filter((slug) => !corpus.has(slug));
if (missing.length || unexpected.length) {
  throw new Error(`the annotation has the wrong corpus: ${missing.length} missing, ${unexpected.length} unexpected`);
}
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
    throw new Error(`${label} has no saved control tree for ${slug}; recall cannot silently omit it`);
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
if (expected === 0) throw new Error(`${label}: the annotation contains no expected boundaries`);
if (made === 0) throw new Error(`${label}: the planner made no boundaries, so precision is undefined`);
const recall = hit / expected;
const precision = right / made;
console.log(`${label}: recall ${hit}/${expected} = ${(100 * recall).toFixed(0)}%, precision ${right}/${made} = ${(100 * precision).toFixed(0)}%`);
if (recall < 0.9 || precision < 1) process.exitCode = 1;
