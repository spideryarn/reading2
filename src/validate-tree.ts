/**
 * Check a tree.json against the invariants the granularity view depends on.
 *
 *   npm run validate-tree -- example
 *   npm run validate-tree -- data/<slug>
 *
 * **The checks themselves are in [src/tree-invariants.ts](./tree-invariants.ts)
 * and this file is only the CLI over them.** They were here, and being here
 * meant nothing could call them: this module reads `process.argv` at the top
 * level and calls `process.exit`, so importing it runs it. `publishRevision`
 * (src/store/pg-revisions.ts) needs the same checks to refuse a draft whose
 * tree does not describe its blocks, and a second implementation of "does this
 * tree partition these blocks" is exactly the divergence that would let one of
 * the two be quietly wrong.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkTree } from "./tree-invariants.js";
import type { Block, Tree } from "./types.js";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: tsx src/validate-tree.ts <dir containing blocks.json + tree.json>");
  process.exit(1);
}

const { blocks } = JSON.parse(
  await readFile(path.join(dir, "blocks.json"), "utf8"),
) as { blocks: Block[] };
const tree = JSON.parse(await readFile(path.join(dir, "tree.json"), "utf8")) as Tree;

const { problems, advice, byDepth } = checkTree(blocks, tree);

console.log(`${dir}: ${blocks.length} blocks, ${Object.keys(tree.nodes).length} nodes`);
console.log(
  "  depths: " +
    [...byDepth.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => `L${d}=${n}`).join("  "),
);

if (advice.length) {
  console.warn(`\n${advice.length} warning(s) — editorial, not structural:`);
  for (const w of advice) console.warn(`  ! ${w}`);
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const msg of problems) console.error(`  ✗ ${msg}`);
  process.exit(1);
}
console.log(advice.length ? "\n  ✓ structure is sound" : "  ✓ all invariants hold");
