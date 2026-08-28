/**
 * The invariants a tree has to hold, as a function anything can call.
 *
 * The client renders the tree as an HTML table with `rowSpan`
 * (src/web/tree.ts), which only works if every node covers a contiguous range
 * and a node's children exactly partition it
 * (docs/project/granularity-zoom.md#the-tree). A tree that breaks those
 * invariants doesn't crash the client — it silently draws a wrong article.
 *
 * ## Why this is a module and not just the CLI it came out of
 *
 * All of this lived inside src/validate-tree.ts, which reads `process.argv` at
 * the top level and calls `process.exit`. So it could only ever be *run*, never
 * *called* — and the one place that most needs it is
 * `publishRevision` (src/store/pg-revisions.ts), which must refuse to make a
 * draft current when its tree does not describe its blocks.
 *
 * A review of the step 11 design caught the shape of the mistake that would
 * have followed: the publication guard as designed checked only that every
 * `range` endpoint names a block that exists, which proves *tree ids ⊆ block
 * ids* and nothing more. Two ways to pass it and still be wrong — append a
 * block, keeping every old id, and no leaf covers the new one; reorder the same
 * ids, and every endpoint still resolves while the ranges stop partitioning.
 * The full check was already written here; it simply was not reachable.
 * docs/plans/postgres-storage-implementation.md § What the review found.
 *
 * **The asymmetry worth remembering:** a valid tree is never rejected by the
 * stronger check, so the dangerous outcome is acceptance, not rejection.
 *
 * src/validate-tree.ts is now the CLI over this:
 *
 *   npm run validate-tree -- example
 *   npm run validate-tree -- data/<slug>
 */
import { isStructural } from "./block-policy.js";
import type { Block, Tree, TreeNode } from "./types.js";

/**
 * Are these two heading strings the same heading?
 *
 * Not `===`, and the reason is worth stating because the obvious version of
 * this check was wrong for a year's worth of articles that simply never had the
 * character in them.
 *
 * `sourceHeading` is the author's heading text **quoted back by a model**, and a
 * model quoting text does not reproduce bytes — it reproduces the heading. Ask
 * one to repeat `Claude’s Constitution` and a fair share of the time you get
 * `Claude's Constitution`: same heading, straight apostrophe. Publishers emit
 * the curly one (U+2019) because their CMS does, so the mismatch is between two
 * spellings of the same punctuation mark and nothing else.
 *
 * That is not a hypothetical. The first article to reach this check with
 * apostrophes in its headings — the Anthropic constitution, 36 headings — failed
 * on **eleven** of them, and every one of the eleven was an apostrophe. Zero of
 * the failures were a heading the model had got wrong, which is what this check
 * is for. A validator whose errors are all false is worse than no validator: it
 * teaches whoever reads it to stop reading it.
 *
 * So the comparison folds the characters that have a typographic and a
 * typewriter spelling — quotes, apostrophes, the dashes, the ellipsis — and
 * collapses runs of whitespace. It deliberately does **not** fold case or strip
 * words: a heading rewritten rather than quoted is exactly what should still
 * fail here, and this stays strict about every part of the text that carries
 * meaning.
 */
export function sameHeading(a: string, b: string): boolean {
  return normalisePunctuation(a) === normalisePunctuation(b);
}

function normalisePunctuation(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What one pass over a tree found.
 *
 * **`problems` and `advice` are not two severities of the same thing.** A
 * problem means the article would render wrongly — a gap in the partition, a
 * range that names a block that is not there. Advice means a label reads badly.
 * Failing a build, or refusing a publication, over prose would train everyone
 * to route around the check, so only `problems` is ever allowed to stop
 * anything.
 */
export interface TreeCheck {
  /** Structural. Non-empty means the tree must not be rendered or published. */
  readonly problems: string[];
  /** Editorial. Worth printing, never worth failing. */
  readonly advice: string[];
  /** How many nodes at each depth, for the CLI's summary line. */
  readonly byDepth: ReadonlyMap<number, number>;
}

/**
 * Check a tree against its blocks. Pure: it reads nothing and writes nothing.
 *
 * The messages are the CLI's, word for word, because tests/validate-tree.test.ts
 * and tests/validate-tree-rows.test.ts match on them — and because a publication
 * refusal is read by the same person who reads the CLI output.
 */
export function checkTree(blocks: Block[], tree: Tree): TreeCheck {
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

  /** Which blocks may never anchor a navigable row — `isStructural`, src/block-policy.ts. */
  const structural = new Map(blocks.map((b) => [b.id, isStructural(b)]));
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
      fail(
        `root ${root.id}: covers indices ${rootSpan[0]}–${rootSpan[1]}, expected 0–${blocks.length - 1}`,
      );
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
        fail(
          `${node.id}: leaf carries a gist — leaves render verbatim text (granularity-zoom.md#node-shape)`,
        );

      /* Every block must be tiled by some leaf, media included — so a media
         block legitimately HAS a leaf, and so does a footnote. What neither
         must have is a navigable row: a sidebar entry captioning an image, or
         one per endnote, is the phantom-row failure `isStructural` exists to
         prevent. The tree's *shape* is unchanged by that predicate — only which
         leaves carry a label. */
      const blockId = blocks[mySpan[0]]?.id;
      if (blockId && structural.get(blockId) === false && node.navLabel)
        fail(
          `${node.id}: carries a navLabel but anchors ${blockId} ` +
            `(${blockKind.get(blockId)}, isStructural:false) — leave it unlabelled`,
        );
      if (blockId && structural.get(blockId) === true && !node.navLabel)
        warn(`${node.id}: labellable leaf ${blockId} has no navLabel — it will be unreachable in the ToC`);

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
        const heading = node.sourceHeading;
        const inRange = blocks
          .slice(mySpan[0], mySpan[1] + 1)
          .some((b) => b.kind === "heading" && sameHeading(b.text, heading));
        if (!inRange)
          fail(
            `${node.id}: sourceHeading ${JSON.stringify(heading)} ` +
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

  // A bad range is reported once by the node itself and once by its parent's
  // tiling check; the reader only needs to be told once.
  const unique = (xs: string[]) => [...new Set(xs)];

  return { problems: unique(problems), advice: unique(advice), byDepth };
}
