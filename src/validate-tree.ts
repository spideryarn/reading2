/**
 * Check a tree.json against the invariants the granularity view depends on.
 *
 * The client renders the tree as an HTML table with `rowSpan`
 * (src/web/tree.ts), which only works if every node covers a contiguous range
 * and a node's children exactly partition it
 * (docs/project/granularity-zoom.md#the-tree). A tree that breaks those
 * invariants doesn't crash the client — it silently draws a wrong article. So
 * check explicitly.
 *
 *   npm run validate-tree -- example
 *   npm run validate-tree -- data/<slug>
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Block, Tree, TreeNode } from "./types.js";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: tsx src/validate-tree.ts <dir containing blocks.json + tree.json>");
  process.exit(1);
}

const { blocks } = JSON.parse(
  await readFile(path.join(dir, "blocks.json"), "utf8"),
) as { blocks: Block[] };
const tree = JSON.parse(await readFile(path.join(dir, "tree.json"), "utf8")) as Tree;

/** Document order lives here and nowhere else — see block-ids.md. */
const index = new Map(blocks.map((b, i) => [b.id, i]));
const problems: string[] = [];
const fail = (msg: string) => problems.push(msg);

/**
 * Editorial complaints, not structural ones. A tree that trips these still
 * renders correctly, so they must not fail the build — but they are how a
 * drifting prompt shows up before a human notices the sidebar reads badly.
 */
const advice: string[] = [];
const warn = (msg: string) => advice.push(msg);

const wordsIn = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Which blocks may never anchor a navigable row — see blocks.ts `gistable`. */
const gistable = new Map(blocks.map((b) => [b.id, b.gistable]));
const blockKind = new Map(blocks.map((b) => [b.id, b.kind]));

const span = (n: TreeNode): [number, number] | null => {
  const lo = index.get(n.range[0]);
  const hi = index.get(n.range[1]);
  if (lo === undefined) {
    fail(`${n.id}: range start "${n.range[0]}" not in blocks.json`);
    return null;
  }
  if (hi === undefined) {
    fail(`${n.id}: range end "${n.range[1]}" not in blocks.json`);
    return null;
  }
  if (lo > hi) {
    fail(`${n.id}: range is reversed (index ${lo} > ${hi})`);
    return null;
  }
  return [lo, hi];
};

const root = tree.nodes[tree.rootId];
if (!root) fail(`rootId "${tree.rootId}" is not in nodes`);
else {
  if (root.depth !== 0) fail(`root ${root.id}: depth is ${root.depth}, expected 0`);
  if (root.parent !== null) fail(`root ${root.id}: parent should be null`);
  const rootSpan = span(root);
  if (rootSpan && (rootSpan[0] !== 0 || rootSpan[1] !== blocks.length - 1))
    fail(`root ${root.id}: covers indices ${rootSpan[0]}–${rootSpan[1]}, expected 0–${blocks.length - 1}`);
}

const covered = new Map<number, string>(); // block index -> leaf node id

for (const node of Object.values(tree.nodes)) {
  const mySpan = span(node);
  if (!mySpan) continue;

  if (node.parent !== null) {
    // Same shape as the child loop below: look the node up once, and let the
    // "not in nodes" case be the thing that narrows the type.
    const parent = tree.nodes[node.parent];
    if (!parent) fail(`${node.id}: parent "${node.parent}" is not in nodes`);
    else {
      if (!parent.children.includes(node.id))
        fail(`${node.id}: parent ${parent.id} does not list it as a child`);
      if (node.depth !== parent.depth + 1)
        fail(`${node.id}: depth ${node.depth} but parent ${parent.id} is depth ${parent.depth}`);
    }
  }

  if (node.children.length === 0) {
    // Leaf: exactly one block, no gist (a summary must never replace real prose).
    if (mySpan[0] !== mySpan[1])
      fail(`${node.id}: leaf spans ${mySpan[1] - mySpan[0] + 1} blocks, expected 1`);
    if (node.gist)
      fail(`${node.id}: leaf carries a gist — leaves render verbatim text (granularity-zoom.md#node-shape)`);

    // Every block must be tiled by some leaf, media included — so a media block
    // legitimately HAS a leaf. What it must never have is a navigable row: a
    // sidebar entry captioning an image or a rule is the phantom-row failure
    // that `gistable` exists to prevent.
    const blockId = blocks[mySpan[0]]?.id;
    if (blockId && gistable.get(blockId) === false && node.navLabel)
      fail(
        `${node.id}: carries a navLabel but anchors ${blockId} ` +
          `(${blockKind.get(blockId)}, gistable:false) — leave it unlabelled`,
      );
    if (blockId && gistable.get(blockId) === true && !node.navLabel)
      warn(`${node.id}: gistable leaf ${blockId} has no navLabel — it will be unreachable in the ToC`);

    // Deep rows are long on purpose: a paragraph has no name of its own, and
    // its siblings are numerous and similar. See table-of-contents.md. A
    // heading leaf is exempt — its label is the author's own title, and
    // "Soul Machine" is exactly right at two words.
    if (node.navLabel && blockId && blockKind.get(blockId) !== "heading") {
      const n = wordsIn(node.navLabel);
      if (n < 6 || n > 20)
        warn(`${node.id}: navLabel is ${n} words, expected 6–20 — ${JSON.stringify(node.navLabel)}`);
    }

    for (let i = mySpan[0]; i <= mySpan[1]; i++) {
      if (covered.has(i)) fail(`block index ${i} covered by both ${covered.get(i)} and ${node.id}`);
      covered.set(i, node.id);
    }
  } else {
    if (!node.gist) fail(`${node.id}: internal node has no gist — nothing to render at its level`);

    // Titles stay short at every internal depth; it is navLabel that grows.
    const t = wordsIn(node.title ?? "");
    if (t === 0) fail(`${node.id}: internal node has no title`);
    else if (t > 8) warn(`${node.id}: title is ${t} words, expected 2–6 — ${JSON.stringify(node.title)}`);
    // Only our own titles are held to this. An authored heading reproduced
    // verbatim keeps its punctuation — "What (Not) To Do?" is the author's.
    if (!node.sourceHeading && /[.!?]$/.test(node.title ?? ""))
      warn(`${node.id}: title ends with sentence punctuation — it is a label, not a sentence`);

    // A node claiming an authored heading must actually contain one.
    if (node.sourceHeading) {
      const inRange = blocks
        .slice(mySpan[0], mySpan[1] + 1)
        .some((b) => b.kind === "heading" && b.text.trim() === node.sourceHeading!.trim());
      if (!inRange)
        fail(
          `${node.id}: sourceHeading ${JSON.stringify(node.sourceHeading)} ` +
            `does not match any heading block in its range`,
        );
    }

    // Children must tile the parent exactly, in order.
    let cursor = mySpan[0];
    for (const childId of node.children) {
      const child = tree.nodes[childId];
      if (!child) {
        fail(`${node.id}: child "${childId}" is not in nodes`);
        continue;
      }
      const childSpan = span(child);
      if (!childSpan) continue;
      if (childSpan[0] !== cursor)
        fail(
          `${node.id} → ${childId}: starts at index ${childSpan[0]}, expected ${cursor}` +
            (childSpan[0] > cursor ? " (gap)" : " (overlap)"),
        );
      cursor = childSpan[1] + 1;
    }
    if (cursor !== mySpan[1] + 1)
      fail(`${node.id}: children end at index ${cursor - 1}, parent ends at ${mySpan[1]}`);
  }
}

blocks.forEach((block, i) => {
  if (!covered.has(i)) fail(`block ${block.id} (index ${i}) is not covered by any leaf`);
});

const byDepth = new Map<number, number>();
for (const n of Object.values(tree.nodes)) byDepth.set(n.depth, (byDepth.get(n.depth) ?? 0) + 1);

console.log(`${dir}: ${blocks.length} blocks, ${Object.keys(tree.nodes).length} nodes`);
console.log(
  "  depths: " +
    [...byDepth.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => `L${d}=${n}`).join("  "),
);

// A bad range is reported once by the node itself and once by its parent's
// tiling check; the reader only needs to be told once.
const unique = (xs: string[]) => [...new Set(xs)];

if (advice.length) {
  const a = unique(advice);
  console.warn(`\n${a.length} warning(s) — editorial, not structural:`);
  for (const w of a) console.warn(`  ! ${w}`);
}

if (problems.length) {
  const p = unique(problems);
  console.error(`\n${p.length} problem(s):`);
  for (const msg of p) console.error(`  ✗ ${msg}`);
  process.exit(1);
}
console.log(advice.length ? "\n  ✓ structure is sound" : "  ✓ all invariants hold");
