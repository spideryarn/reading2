/**
 * **The partition is derived from the model's answer, not checked against it.**
 *
 * Stage 4 asks a model to carve the article into nested sections and give each
 * one a `[startBlock, endBlock]` range. Those ranges have to tile: every block
 * in exactly one leaf, no gaps, no overlaps, in order. Models do not reliably
 * produce that. A paid calibration on 2026-08-30 threw on 4 of 13 structure
 * calls, and the call takes about 163 seconds and most of the stage's bill, so
 * every refusal costs a reader a whole article after the money is spent.
 *
 * The answer went through three shapes:
 *
 * | | what it did | what it cost |
 * |---|---|---|
 * | until 2026-08-30 | refused any tiling fault | 4 in 13 articles |
 * | 2026-08-30 | snapped boundaries, bounded by size, then by count | an article with two slips |
 * | 2026-08-31 | derives the tiling; nothing about it can refuse | a dropped section, rarely |
 *
 * **What the third shape is.** `planChildRanges` in src/hierarchy.ts believes each
 * child's *start* and computes every end from the next start. A list of ordered
 * split points tiles its parent by construction, so a gap, an overlap, a last
 * child stopping short and children running past their parent are not four
 * faults to detect — they cannot be expressed. There is no bound left because
 * there is nothing left to bound.
 *
 * **What replaced the bounds is measurement**, and that is what most of these
 * tests assert. Every boundary the model got wrong is recorded with its
 * position, direction and size; a dropped section is counted separately,
 * because it is the one thing this loses that the answer contained. All of it
 * reaches `HierarchyRun`, the CLI at zero as well as above it, src/pipeline.ts and
 * evals/hierarchy-structure — a repair nobody is told about is the same shape as the
 * bug it repaired (docs/reusable/silent-success.md).
 *
 * **What still throws**, and these are faults in what the model *said* rather
 * than in how its sections line up: a range that runs backwards, an endpoint
 * that is not a block id, and a root that misses the article's ends.
 *
 * docs/plans/260831ai-hierarchy-tiling-normalisation.md.
 */
import { describe, expect, it } from "vitest";
import {
  buildTree,
  repairedBlockCount,
  type BuildReport,
  type ModelNode,
} from "../src/hierarchy.js";
import { checkTree } from "../src/tree-invariants.js";
import type { Block } from "../src/types.js";

function block(id: string, text: string, kind: Block["kind"] = "text", tag = "p"): Block {
  return {
    id,
    tag,
    kind,
    text,
    words: text.split(/\s+/).filter(Boolean).length,
    html: `<${tag} id="${id}">${text}</${tag}>`,
    gistable: kind !== "media",
  };
}

/** Six blocks, two of them the author's own headings. */
const BLOCKS: Block[] = [
  block("spya-aaaaaa", "Opening paragraph before any heading"),
  block("spya-bbbbbb", "The First Part", "heading", "h2"),
  block("spya-cccccc", "Body of the first part"),
  block("spya-dddddd", "The Second Part", "heading", "h2"),
  block("spya-eeeeee", "Body of the second part"),
  block("spya-ffffff", "A closing paragraph"),
];

const report = (): BuildReport => ({ repairs: [], droppedChildren: [], droppedHeadings: [] });

/** Every leaf's block, in tree order — what the reader can actually reach. */
function leafBlocks(tree: ReturnType<typeof buildTree>): string[] {
  return Object.values(tree.nodes)
    .filter((n) => n.children.length === 0)
    .map((n) => n.range[0]);
}

/** A node by the title the model gave it. */
function titled(tree: ReturnType<typeof buildTree>, title: string) {
  return Object.values(tree.nodes).find((n) => n.title === title);
}

const WHOLE: Pick<ModelNode, "title" | "gist" | "range"> = {
  title: "Whole piece",
  gist: "The article argues something.",
  range: ["spya-aaaaaa", "spya-ffffff"],
};

describe("a boundary the model got wrong is derived away, not refused", () => {
  /** Child 2 starts one block late, so `spya-cccccc` would grow no leaf at all. */
  const gapped: ModelNode = {
    ...WHOLE,
    children: [
      { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-bbbbbb"] },
      { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
    ],
  };

  it("closes a gap so every block still gets exactly one leaf", () => {
    const r = report();
    const tree = buildTree(gapped, {}, BLOCKS, "test", r);
    expect(leafBlocks(tree).sort()).toEqual(BLOCKS.map((b) => b.id).sort());
    expect(checkTree(BLOCKS, tree).problems).toEqual([]);
    /* `at` is where the boundary ended up — the start the model gave child 2,
       which is the claim that was believed. `size` is how far its *other* claim
       about that boundary was from it, which is how far the answer was from
       tiling. */
    expect(r.repairs).toEqual([{ where: "root > child 2", kind: "gap", at: 3, size: 1 }]);
  });

  /**
   * **A gap's orphan joins the section before it, not the one after.**
   *
   * This is the visible half of believing starts rather than ends, and it
   * reversed on 2026-08-31. The block in question is "Body of the first part":
   * the old cursor walk filed it under "Second", which is wrong about this
   * fixture and wrong about the general case. A gap means the model stopped a
   * section early *while knowing where the next one begins* — the next start is
   * anchored on a heading and `sourceHeading` names it — so the loose blocks
   * are the tail of the section before them. src/hierarchy.ts § `planChildRanges`.
   */
  it("gives the orphaned block to the section that precedes it", () => {
    const tree = buildTree(gapped, {}, BLOCKS, "test", report());
    expect(titled(tree, "First")?.range).toEqual(["spya-aaaaaa", "spya-cccccc"]);
    expect(titled(tree, "Second")?.range).toEqual(["spya-dddddd", "spya-ffffff"]);
  });

  it("closes an overlap, which would otherwise grow two leaves for one block", () => {
    const overlapping: ModelNode = {
      ...gapped,
      children: [
        { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-cccccc"] },
        { title: "Second", gist: "It closes.", range: ["spya-cccccc", "spya-ffffff"] },
      ],
    };
    const r = report();
    const tree = buildTree(overlapping, {}, BLOCKS, "test", r);
    expect(leafBlocks(tree).sort()).toEqual(BLOCKS.map((b) => b.id).sort());
    /* The disputed block goes to the child that claimed it as a *start*: the
       model said "Second" begins here, and that is the claim with a reason
       behind it. */
    expect(titled(tree, "First")?.range).toEqual(["spya-aaaaaa", "spya-bbbbbb"]);
    expect(r.repairs).toEqual([{ where: "root > child 2", kind: "overlap", at: 2, size: 1 }]);
  });

  it("extends a last child that stops before its parent ends", () => {
    const short: ModelNode = {
      ...gapped,
      children: [
        { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-cccccc"] },
        { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-eeeeee"] },
      ],
    };
    const r = report();
    const tree = buildTree(short, {}, BLOCKS, "test", r);
    expect(leafBlocks(tree).sort()).toEqual(BLOCKS.map((b) => b.id).sort());
    /* `at` is the index of the first block *after* the boundary, so the closing
       boundary of a parent ending at index 5 is 6 — never a coordinate any
       child's start can take. src/hierarchy.ts § `PartitionRepair.at`. */
    expect(r.repairs).toEqual([{ where: "root > child 2", kind: "short", at: 6, size: 1 }]);
  });

  /**
   * **Children running past their parent are now planned away too**, and this
   * is the one case where the new rule reverses a deliberate old refusal rather
   * than a bound.
   *
   * The old argument: shrink the child or grow the parent are two readings of
   * the answer with nothing to choose between them, so refuse. There is
   * something to choose between them now — the parent's range was itself
   * derived by `planChildRanges` one level up, so it is the claim with a tiling
   * behind it, and the child's overrun gives way.
   */
  it("pulls children back inside a parent they run past", () => {
    const over: ModelNode = {
      ...WHOLE,
      children: [
        { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-aaaaaa"] },
        {
          title: "Second",
          gist: "A point.",
          range: ["spya-bbbbbb", "spya-dddddd"],
          children: [
            { title: "Inner one", gist: "A point.", range: ["spya-bbbbbb", "spya-bbbbbb"] },
            // Ends at index 4, one past its parent's end at index 3.
            { title: "Inner two", gist: "Another.", range: ["spya-cccccc", "spya-eeeeee"] },
          ],
        },
        { title: "Third", gist: "It closes.", range: ["spya-eeeeee", "spya-ffffff"] },
      ],
    };
    const r = report();
    const tree = buildTree(over, {}, BLOCKS, "test", r);
    expect(leafBlocks(tree).sort()).toEqual(BLOCKS.map((b) => b.id).sort());
    expect(checkTree(BLOCKS, tree).problems).toEqual([]);
    expect(titled(tree, "Inner two")?.range).toEqual(["spya-cccccc", "spya-dddddd"]);
    expect(r.repairs).toEqual([
      { where: "root > child 2 > child 2", kind: "over", at: 4, size: 1 },
    ]);
  });

  /**
   * **The cascade, which is why this happens on the proposal and not on the
   * built tree.**
   *
   * By the time `assertChildrenPartition` runs, every child's leaves have been
   * grown; changing a range there would mean growing a leaf to match and
   * splicing it in, which is how you get two leaves for one paragraph. Planning
   * the proposal means the derived range is what the recursion descends into,
   * so a boundary decided at depth 1 is the boundary every descendant inherits.
   *
   * Here the root's first child starts one block late. It is pinned back to the
   * root's start, and its own first child is pinned to the same place — one
   * boundary, seen at two depths, sharing one coordinate.
   */
  it("cascades a pinned start into the node's own first child", () => {
    const nested: ModelNode = {
      ...WHOLE,
      children: [
        {
          title: "First",
          gist: "It opens.",
          range: ["spya-bbbbbb", "spya-dddddd"],
          children: [
            { title: "Inner one", gist: "A point.", range: ["spya-bbbbbb", "spya-cccccc"] },
            { title: "Inner two", gist: "Another.", range: ["spya-dddddd", "spya-dddddd"] },
          ],
        },
        { title: "Second", gist: "It closes.", range: ["spya-eeeeee", "spya-ffffff"] },
      ],
    };
    const r = report();
    const tree = buildTree(nested, {}, BLOCKS, "test", r);
    expect(leafBlocks(tree).sort()).toEqual(BLOCKS.map((b) => b.id).sort());
    expect(checkTree(BLOCKS, tree).problems).toEqual([]);
    expect(titled(tree, "Inner one")?.range).toEqual(["spya-aaaaaa", "spya-cccccc"]);
    expect(r.repairs.map((x) => x.where)).toEqual(["root > child 1", "root > child 1 > child 1"]);
    /* **One boundary, seen at two depths.** If these ever came out as two
       coordinates, `repairedBlocks` would count the same movement once per
       level: a boundary a paragraph out arriving in the pipeline log as three
       blocks moved, or a section handed forty arriving as a hundred and twenty.
       The one number that exists to say "go and look" would read as an
       emergency on the ordinary case. GPT Sol, finding 6. */
    expect(new Set(r.repairs.map((x) => x.at))).toEqual(new Set([0]));
    expect(repairedBlockCount(r.repairs)).toBe(1);
  });

  it("records nothing when the model tiled the article correctly", () => {
    const sound: ModelNode = {
      ...WHOLE,
      children: [
        { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-cccccc"] },
        { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
      ],
    };
    const r = report();
    const tree = buildTree(sound, {}, BLOCKS, "test", r);
    expect(checkTree(BLOCKS, tree).problems).toEqual([]);
    expect(r.repairs).toEqual([]);
    expect(r.droppedChildren).toEqual([]);
  });
});

describe("the size of the slip is not a bound, and neither is the count", () => {
  const gapped: ModelNode = {
    ...WHOLE,
    children: [
      { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-bbbbbb"] },
      { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
    ],
  };

  it("closes a gap of any size, and records how big it was", () => {
    const wide: ModelNode = {
      ...gapped,
      children: [
        { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-aaaaaa"] },
        { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
      ],
    };
    const r = report();
    const tree = buildTree(wide, {}, BLOCKS, "test", r);
    // The two orphans are reachable, which is the only thing the reader cares
    // about: a block in no node cannot be addressed by granularity zoom.
    expect(leafBlocks(tree).sort()).toEqual(BLOCKS.map((b) => b.id).sort());
    expect(r.repairs).toEqual([{ where: "root > child 2", kind: "gap", at: 3, size: 2 }]);
    expect(checkTree(BLOCKS, tree).problems).toEqual([]);
  });

  it("closes an overlap of any size", () => {
    const wide: ModelNode = {
      ...gapped,
      children: [
        { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-dddddd"] },
        { title: "Second", gist: "It closes.", range: ["spya-bbbbbb", "spya-ffffff"] },
      ],
    };
    const r = report();
    const tree = buildTree(wide, {}, BLOCKS, "test", r);
    expect(leafBlocks(tree).sort()).toEqual(BLOCKS.map((b) => b.id).sort());
    expect(r.repairs).toEqual([{ where: "root > child 2", kind: "overlap", at: 1, size: 3 }]);
    expect(checkTree(BLOCKS, tree).problems).toEqual([]);
  });

  it("extends a last child however far short of its parent it stops", () => {
    const wide: ModelNode = {
      ...gapped,
      children: [
        { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-cccccc"] },
        { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-dddddd"] },
      ],
    };
    const r = report();
    const tree = buildTree(wide, {}, BLOCKS, "test", r);
    expect(leafBlocks(tree).sort()).toEqual(BLOCKS.map((b) => b.id).sort());
    expect(r.repairs).toEqual([{ where: "root > child 2", kind: "short", at: 6, size: 2 }]);
    expect(checkTree(BLOCKS, tree).problems).toEqual([]);
  });

  /**
   * **The reproduction: two independent slips, which is what the reader hit.**
   *
   * A PDF of a Princeton memory paper, 2026-08-31, ingested through `/add`:
   *
   * > The children of the node at root > child 5 do not tile it: child 5
   * > overlaps the one before it by 2 block(s). … Before this it mended 1
   * > boundary(ies), moving 1 block(s): root > child 5 > child 4 (gap, 1).
   *
   * One gap of one block at depth two and one overlap of two at depth one, at
   * different coordinates — so `MAX_REPAIRED_BOUNDARIES` spent the answer's one
   * repair on the first and the second cost the reader the article, after a
   * completed call. The count bound was fitted to four observations that were
   * all single slips and all from HTML articles *with headings*; PDFs are
   * headingless, which is the half of the corpus where the model is measured
   * disagreeing with itself between runs.
   */
  it("mends several independent slips rather than refusing the answer", () => {
    const twice: ModelNode = {
      ...gapped,
      children: [
        // A gap of one before child 2 …
        { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-aaaaaa"] },
        { title: "Second", gist: "A point.", range: ["spya-cccccc", "spya-dddddd"] },
        // … and an overlap of one before child 3, at a different coordinate.
        { title: "Third", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
      ],
    };
    const r = report();
    const tree = buildTree(twice, {}, BLOCKS, "test", r);
    expect(leafBlocks(tree).sort()).toEqual(BLOCKS.map((b) => b.id).sort());
    expect(checkTree(BLOCKS, tree).problems).toEqual([]);
    expect(r.repairs).toEqual([
      { where: "root > child 2", kind: "gap", at: 2, size: 1 },
      { where: "root > child 3", kind: "overlap", at: 3, size: 1 },
    ]);
    expect(new Set(r.repairs.map((x) => x.at)).size).toBe(2);
  });
});

/**
 * **What GPT Sol's review of this change found, kept as cases.**
 *
 * Three findings, all real, all about the same thing: the first version was too
 * quick to believe a start and too quick to measure against a value it had
 * already adjusted.
 */
describe("the review's findings", () => {
  /**
   * **Finding 1, high.** The first rule dropped any child whose start did not
   * advance, and one overlap of a single block then deleted the article's
   * largest section along with its whole subtree — while reporting a four-block
   * gap that the answer never contained.
   *
   * A start that does not advance carries no information, and the previous
   * child's end is the evidence that is left. src/hierarchy.ts §
   * `planChildRanges`.
   */
  it("keeps a section whose start collides, using the end as the evidence", () => {
    const collide: ModelNode = {
      ...WHOLE,
      children: [
        { title: "Preamble", gist: "It opens.", range: ["spya-aaaaaa", "spya-aaaaaa"] },
        {
          title: "Large middle",
          gist: "The bulk of it.",
          // Starts where "Preamble" does — one block of overlap, no more.
          range: ["spya-aaaaaa", "spya-eeeeee"],
          children: [
            { title: "Inner one", gist: "A point.", range: ["spya-aaaaaa", "spya-cccccc"] },
            { title: "Inner two", gist: "Another.", range: ["spya-dddddd", "spya-eeeeee"] },
          ],
        },
        { title: "Close", gist: "It closes.", range: ["spya-ffffff", "spya-ffffff"] },
      ],
    };
    const r = report();
    const tree = buildTree(collide, {}, BLOCKS, "test", r);
    expect(leafBlocks(tree).sort()).toEqual(BLOCKS.map((b) => b.id).sort());
    expect(checkTree(BLOCKS, tree).problems).toEqual([]);
    // All three survive, with the ranges the answer plainly meant.
    expect(titled(tree, "Preamble")?.range).toEqual(["spya-aaaaaa", "spya-aaaaaa"]);
    expect(titled(tree, "Large middle")?.range).toEqual(["spya-bbbbbb", "spya-eeeeee"]);
    expect(titled(tree, "Close")?.range).toEqual(["spya-ffffff", "spya-ffffff"]);
    // And its subtree with it, rather than vanishing.
    expect(titled(tree, "Inner one")).toBeDefined();
    expect(titled(tree, "Inner two")).toBeDefined();
    expect(r.droppedChildren).toEqual([]);
    /* One block of overlap, reported as one — not the four-block gap the first
       version invented by measuring past the child it had discarded. It appears
       twice because moving "Large middle"'s start moves its own first child's
       too: one boundary at two depths, sharing a coordinate, which is exactly
       what `repairedBlockCount` collapses back to one. */
    expect(r.repairs).toEqual([
      { where: "root > child 2", kind: "overlap", at: 1, size: 1 },
      { where: "root > child 2 > child 1", kind: "overlap", at: 1, size: 1 },
    ]);
    expect(repairedBlockCount(r.repairs)).toBe(1);
  });

  /**
   * **Finding 2, medium.** `repairedBlockCount` deduplicated by `at` alone so
   * that a cascade — one boundary seen at several depths — counted once. But a
   * node's last child stopping short and its *next sibling's* first child
   * starting late are two independent faults about two different blocks, and
   * they meet at the coordinate between the siblings. One of them was silently
   * dropped from the only figure anyone watches.
   */
  it("counts two sibling subtrees' faults at one coordinate as two, not one", () => {
    const siblings: ModelNode = {
      ...WHOLE,
      children: [
        {
          title: "Left",
          gist: "A point.",
          range: ["spya-aaaaaa", "spya-cccccc"],
          // Stops one block short of "Left", so block 2 changes hands.
          children: [{ title: "Left inner", gist: "A point.", range: ["spya-aaaaaa", "spya-bbbbbb"] }],
        },
        {
          title: "Right",
          gist: "A point.",
          range: ["spya-dddddd", "spya-ffffff"],
          // Starts one block late inside "Right", so block 3 changes hands.
          children: [{ title: "Right inner", gist: "A point.", range: ["spya-eeeeee", "spya-ffffff"] }],
        },
      ],
    };
    const r = report();
    const tree = buildTree(siblings, {}, BLOCKS, "test", r);
    expect(checkTree(BLOCKS, tree).problems).toEqual([]);
    // Both faults land on coordinate 3, and they are not the same boundary.
    expect(r.repairs.map((x) => x.at)).toEqual([3, 3]);
    expect(repairedBlockCount(r.repairs)).toBe(2);
  });

  /**
   * **Finding 3, medium.** `size` is the distance from where the boundary ended
   * up to what the model claimed, and it was being measured against a start that
   * had already been clamped into the parent — so a three-block disagreement was
   * reported as one. That number is what a re-ask would be triggered by and told
   * about, so measuring it after the adjustment defeats the purpose.
   */
  it("measures the model's own claims, not the value it had already clamped", () => {
    const outside: ModelNode = {
      ...WHOLE,
      children: [
        {
          title: "First",
          gist: "A point.",
          range: ["spya-aaaaaa", "spya-dddddd"],
          children: [
            { title: "Inner one", gist: "A point.", range: ["spya-aaaaaa", "spya-bbbbbb"] },
            // Starts at index 5, two blocks past its parent's end at index 3.
            { title: "Inner two", gist: "Another.", range: ["spya-ffffff", "spya-ffffff"] },
          ],
        },
        { title: "Second", gist: "It closes.", range: ["spya-eeeeee", "spya-ffffff"] },
      ],
    };
    const r = report();
    const tree = buildTree(outside, {}, BLOCKS, "test", r);
    expect(checkTree(BLOCKS, tree).problems).toEqual([]);
    /* The model's two claims about that interior boundary are 2 (one past
       "Inner one"'s end) and 5 ("Inner two"'s start) — three apart. The clamped
       start is 3, and reporting against it said "gap, 1". */
    const inner = r.repairs.find((x) => x.where === "root > child 1 > child 2" && x.kind === "gap");
    expect(inner?.size).toBe(3);
  });
});

/**
 * **The one thing this still loses, and why it is counted on its own.**
 *
 * A child is dropped only when *neither* of the model's claims about where it
 * begins yields a usable split point — its start does not advance past the
 * previous section's, and neither does the previous section's end. Since the
 * end became the fallback (finding 1 above) that is no longer an ordinary
 * overlap; it is an answer asking for more sections than the parent has blocks,
 * or a child whose whole proposed range sits before where the previous section
 * starts.
 *
 * It is still counted separately from `repairs`, because it is a different kind
 * of loss: a moved boundary keeps every section the model named, and this stores
 * fewer than the answer proposed, along with the dropped child's whole subtree.
 */
describe("a child with nowhere to start is dropped, and counted", () => {
  it("drops the sections a parent has no blocks left for", () => {
    // Two blocks cannot hold three sections, whatever the model says.
    const crowded: ModelNode = {
      ...WHOLE,
      children: [
        {
          title: "First",
          gist: "A point.",
          range: ["spya-aaaaaa", "spya-bbbbbb"],
          children: [
            { title: "Inner one", gist: "A point.", range: ["spya-aaaaaa", "spya-bbbbbb"] },
            { title: "Inner two", gist: "Another.", range: ["spya-aaaaaa", "spya-bbbbbb"] },
            { title: "Inner three", gist: "A third.", range: ["spya-aaaaaa", "spya-bbbbbb"] },
          ],
        },
        { title: "Second", gist: "It closes.", range: ["spya-cccccc", "spya-ffffff"] },
      ],
    };
    const r = report();
    const tree = buildTree(crowded, {}, BLOCKS, "test", r);
    expect(leafBlocks(tree).sort()).toEqual(BLOCKS.map((b) => b.id).sort());
    expect(checkTree(BLOCKS, tree).problems).toEqual([]);
    expect(titled(tree, "Inner three")).toBeUndefined();
    expect(r.droppedChildren).toEqual(["root > child 1 > child 3"]);
  });

  /* A dropped child takes its whole subtree with it, and the numbering in
     `where` still counts children by their position in the *model's* proposal —
     so the numbers in a report or an error can be compared against the answer
     the model actually sent. */
  it("does not renumber the siblings of a dropped child", () => {
    const crowded: ModelNode = {
      ...WHOLE,
      children: [
        {
          title: "First",
          gist: "A point.",
          range: ["spya-aaaaaa", "spya-bbbbbb"],
          children: [
            { title: "Inner one", gist: "A point.", range: ["spya-aaaaaa", "spya-bbbbbb"] },
            { title: "Inner two", gist: "Another.", range: ["spya-aaaaaa", "spya-bbbbbb"] },
            { title: "Inner three", gist: "A third.", range: ["spya-aaaaaa", "spya-bbbbbb"] },
          ],
        },
        { title: "Second", gist: "It closes.", range: ["spya-cccccc", "spya-ffffff"] },
      ],
    };
    const r = report();
    buildTree(crowded, {}, BLOCKS, "test", r);
    // "child 3", not "child 2" — its position in the answer, not in the tree.
    expect(r.droppedChildren).toEqual(["root > child 1 > child 3"]);
  });
});

describe("a fault in what the model said is still refused", () => {
  const gapped: ModelNode = {
    ...WHOLE,
    children: [
      { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-bbbbbb"] },
      { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
    ],
  };

  /* These are faults in the answer's *content*, not in how its sections line
     up, and each has an exact message of its own. Planning around an endpoint
     that means nothing would replace a precise error with a vague one — so one
     unresolvable child leaves its whole sibling set unplanned. */
  it("leaves an invented id to the error that names it, rather than guessing", () => {
    const invented: ModelNode = {
      ...gapped,
      children: [
        { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-bbbbbb"] },
        { title: "Second", gist: "It closes.", range: ["spya-zzzzzz", "spya-ffffff"] },
      ],
    };
    expect(() => buildTree(invented, {}, BLOCKS, "test", report())).toThrow(/not in blocks\.json/);
  });

  it("refuses a child whose range runs backwards", () => {
    const backwards: ModelNode = {
      ...gapped,
      children: [
        { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-cccccc"] },
        { title: "Second", gist: "It closes.", range: ["spya-ffffff", "spya-dddddd"] },
      ],
    };
    expect(() => buildTree(backwards, {}, BLOCKS, "test", report())).toThrow(
      /range that runs backwards/,
    );
  });

  it("refuses a root that does not cover the whole article", () => {
    const partial: ModelNode = {
      ...gapped,
      range: ["spya-aaaaaa", "spya-eeeeee"],
      children: [
        { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-cccccc"] },
        { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-eeeeee"] },
      ],
    };
    expect(() => buildTree(partial, {}, BLOCKS, "test", report())).toThrow(
      /does not cover the whole article/,
    );
  });
});

describe("a sourceHeading no block backs up is dropped, not thrown on", () => {
  /**
   * `sourceHeading` is provenance, not structure. Its only consumer is the `§`
   * badge that tells the reader "the author wrote this heading, we did not" —
   * src/web/TableView.tsx, src/web/ContextList.tsx, src/web/Spine.tsx. So an
   * unbacked claim is a badge that would lie, and dropping it costs the reader
   * a mark of provenance where throwing costs them the article.
   *
   * Four structure calls in four made the same wrong claim on the same
   * article, so throwing on it is not an occasional loss — it is a guaranteed
   * failure loop for that document.
   */
  const claiming = (heading: string): ModelNode => ({
    title: "Whole piece",
    gist: "The article argues something.",
    range: ["spya-aaaaaa", "spya-ffffff"],
    children: [
      {
        title: "First",
        gist: "It opens.",
        range: ["spya-aaaaaa", "spya-cccccc"],
        sourceHeading: heading,
      },
      { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
    ],
  });

  it("keeps a claim the node's range really contains", () => {
    const r = report();
    const tree = buildTree(claiming("The First Part"), {}, BLOCKS, "test", r);
    const first = Object.values(tree.nodes).find((n) => n.title === "First");
    expect(first?.sourceHeading).toBe("The First Part");
    expect(r.droppedHeadings).toEqual([]);
  });

  it("keeps a claim that differs only in punctuation, as the invariant does", () => {
    // `sameHeading` normalises curly quotes and dashes — a model quoting a
    // heading back with the wrong apostrophe broke this once already
    // (docs/postmortems/260826a-toc-max-tokens.md).
    const tree = buildTree(claiming("The First Part"), {}, BLOCKS, "test", report());
    const first = Object.values(tree.nodes).find((n) => n.title === "First");
    expect(first?.sourceHeading).toBe("The First Part");
  });

  it("drops a claim for a heading that is outside the node's range", () => {
    const r = report();
    const tree = buildTree(claiming("The Second Part"), {}, BLOCKS, "test", r);
    const first = Object.values(tree.nodes).find((n) => n.title === "First");
    expect(first?.sourceHeading).toBeUndefined();
    expect(r.droppedHeadings).toEqual(["root > child 1"]);
  });

  it("drops a claim for a heading that is nowhere in the article", () => {
    const tree = buildTree(claiming("A Heading Nobody Wrote"), {}, BLOCKS, "test", report());
    const first = Object.values(tree.nodes).find((n) => n.title === "First");
    expect(first?.sourceHeading).toBeUndefined();
  });

  it("keeps the node and its title — only the provenance mark goes", () => {
    const tree = buildTree(claiming("A Heading Nobody Wrote"), {}, BLOCKS, "test", report());
    const first = Object.values(tree.nodes).find((n) => n.title === "First");
    expect(first).toBeDefined();
    expect(first?.range).toEqual(["spya-aaaaaa", "spya-cccccc"]);
  });

  it("leaves nothing for the invariant to fail on, which is the point", () => {
    // The repair is deliberately at least as strict as `checkTree`'s own rule:
    // it reads the same `sameHeading` over the same range, so anything it keeps
    // the invariant keeps too. That is what makes this a repair rather than a
    // second opinion.
    const tree = buildTree(claiming("The Second Part"), {}, BLOCKS, "test", report());
    const problems = checkTree(BLOCKS, tree).problems.filter((p) => p.includes("sourceHeading"));
    expect(problems).toEqual([]);
  });

  /* A number, or a string of spaces, is a claim this stage threw away too — and
     the first version of this counted only the well-formed ones, so the one
     case that says the model's output has gone strange was the one case nobody
     was told about. GPT Sol's review. */
  it("ignores a claim that is not a string at all, and still counts it as dropped", () => {
    const bad = claiming("x");
    (bad.children![0] as { sourceHeading?: unknown }).sourceHeading = 42;
    const r = report();
    expect(() => buildTree(bad, {}, BLOCKS, "test", r)).not.toThrow();
    expect(r.droppedHeadings).toEqual(["root > child 1"]);
  });

  it("counts a claim that is nothing but whitespace", () => {
    const r = report();
    buildTree(claiming("   "), {}, BLOCKS, "test", r);
    expect(r.droppedHeadings).toEqual(["root > child 1"]);
  });
});

/**
 * **The reproduction: two independent slips, which is what the reader hit.**
 *
 * A PDF of a Princeton memory paper, 2026-08-31, ingested through /add:
 *
 * > The children of the node at root > child 5 do not tile it: child 5 overlaps
 * > the one before it by 2 block(s). … Before this it mended 1 boundary(ies),
 * > moving 1 block(s): root > child 5 > child 4 (gap, 1).
 *
 * One gap of one block at depth two, one overlap of two blocks at depth one,
 * at different coordinates — so the per-answer budget was spent on the first
 * and the second cost the reader the article, after a completed call.
 * docs/plans/260831ai-hierarchy-tiling-normalisation.md.
 */

/**
 * **The claim `planChildRanges` makes is totality, so the test for it is a fuzz.**
 *
 * Every case above is a shape somebody thought of. The claim is stronger than
 * that: a list of ordered split points tiles its parent *by construction*, so
 * no proposal whose ranges resolve can produce an invalid tree. A handful of
 * hand-written cases cannot say that, and the failure this whole file exists
 * for arrived as a shape nobody had thought of.
 *
 * So: thousands of deliberately sloppy proposals — gaps, overlaps, children out
 * of order, children running past their parent, several of each in one answer,
 * nested three deep — every one of which must come back as a tree `checkTree`
 * accepts.
 *
 * **Two controls, because a check that has never failed is not evidence**
 * (docs/reusable/silent-success.md):
 *
 * 1. `faulty` counts proposals that do *not* tile as written. If the generator
 *    drifted into producing well-formed answers, everything below would pass
 *    while testing nothing, and that is the likelier way this test rots than
 *    the code regressing.
 * 2. `checkTree` is handed a deliberately corrupted tree and must object. 20,000
 *    clean results mean nothing if the checker returns `[]` for everything.
 *
 * And `silent` is the hole that would actually matter: a proposal that did not
 * tile, derived into one that does, with nothing recorded in the report. That
 * is the bug this stage's reporting exists to make impossible.
 */
describe("any proposal whose ranges resolve comes back as a valid tree", () => {
  /** Deterministic, so a failure is reproducible from the seed in the message. */
  function generator(seed: number) {
    let s = seed;
    const rnd = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    return (n: number) => Math.floor(rnd() * n);
  }

  const manyBlocks = (n: number): Block[] =>
    Array.from({ length: n }, (_, i) => block(`spya-${String(i).padStart(6, "0")}`, `Block ${i}`));

  /** Does the proposal satisfy the invariant as written, with nothing derived? */
  function tilesAsWritten(mn: ModelNode, blocks: Block[]): boolean {
    const idx = new Map(blocks.map((b, i) => [b.id, i]));
    const at = (r: unknown, end: 0 | 1) => idx.get((r as string[])[end]!)!;
    const walk = (n: ModelNode): boolean => {
      if (!n.children?.length) return true;
      let cursor = at(n.range, 0);
      for (const c of n.children) {
        if (at(c.range, 0) !== cursor) return false;
        cursor = at(c.range, 1) + 1;
      }
      return cursor === at(n.range, 1) + 1 && n.children.every(walk);
    };
    return walk(mn);
  }

  it("holds over thousands of sloppy proposals, and records every one it mended", () => {
    const pick = generator(12345);
    /* Ranges chosen at random inside the parent and deliberately unconstrained,
       so gaps, overlaps, out-of-order starts and children past the parent all
       occur, several to an answer. Kept forward and inside the article: a
       backwards range and an invented id are refusals with messages of their
       own, tested above, and are not what this is about. */
    const propose = (blocks: Block[], lo: number, hi: number, depth: number): ModelNode => {
      const node: ModelNode = {
        title: `n${lo}-${hi}`,
        gist: "A sentence about this stretch.",
        range: [blocks[lo]!.id, blocks[hi]!.id],
      };
      if (depth >= 3 || hi - lo < 2 || pick(100) < 35) return node;
      const kids: ModelNode[] = [];
      for (let i = 0; i < 1 + pick(4); i++) {
        const a = lo + pick(hi - lo + 2);
        const b = a + pick(hi - lo + 2);
        const start = Math.min(a, b);
        const end = Math.max(a, b);
        if (end > blocks.length - 1) continue;
        kids.push(propose(blocks, start, end, depth + 1));
      }
      if (kids.length) node.children = kids;
      return node;
    };

    let faulty = 0;
    let silent = 0;
    let withRepairs = 0;
    let withDrops = 0;
    for (let t = 0; t < 3000; t++) {
      const n = 1 + pick(12);
      const blocks = manyBlocks(n);
      const root: ModelNode = {
        ...propose(blocks, 0, n - 1, 0),
        range: [blocks[0]!.id, blocks[n - 1]!.id],
      };
      const r = report();
      const tree = buildTree(root, {}, blocks, "fuzz", r);
      const problems = checkTree(blocks, tree).problems;
      expect(problems, `invalid tree from ${JSON.stringify(root)}`).toEqual([]);
      // Every block reachable, exactly once — what a gap and an overlap each break.
      expect(leafBlocks(tree).sort()).toEqual(blocks.map((b) => b.id).sort());
      const mended = r.repairs.length > 0 || r.droppedChildren.length > 0;
      if (!tilesAsWritten(root, blocks)) {
        faulty++;
        if (!mended) {
          silent++;
          expect.fail(`derived silently, nothing reported: ${JSON.stringify(root)}`);
        }
      }
      /* **Two faults in one node must never share a coordinate.**
         `repairedBlockCount` deduplicates by `at` so that a cascade — one
         boundary seen at several depths — is counted once. That is only safe
         while distinct boundaries within a node have distinct coordinates, and
         they did not until the closing boundary moved to `parentEnd + 1`: a last
         child that both started and ended in the wrong place reported two faults
         at one coordinate, and the sum quietly dropped the smaller.
         `where` names the child, so its parent is everything before the last
         segment. */
      const perNode = new Map<string, number[]>();
      for (const rep of r.repairs) {
        const node = rep.where.slice(0, rep.where.lastIndexOf(" > child "));
        perNode.set(node, [...(perNode.get(node) ?? []), rep.at]);
      }
      for (const [node, ats] of perNode) {
        expect(new Set(ats).size, `two faults at one coordinate in ${node}`).toBe(ats.length);
      }
      if (r.repairs.length) withRepairs++;
      if (r.droppedChildren.length) withDrops++;
    }

    /* **The control.** These are not incidental: if the generator drifts into
       producing well-formed answers the assertions above pass while testing
       nothing, and that is the likelier way this rots. The observed figures at
       this seed are ~37% faulty, ~37% repaired and ~10% with a dropped child;
       the bounds are loose so an unrelated change to the fixture does not fail
       the suite, but they are far enough above zero to prove the fuzz bites. */
    expect(faulty).toBeGreaterThan(500);
    expect(withRepairs).toBeGreaterThan(500);
    expect(withDrops).toBeGreaterThan(100);
    expect(silent).toBe(0);
  });

  it("and checkTree objects to a tree that is actually broken", () => {
    /* The second control. Everything above rests on `checkTree` looking, and a
       checker that returned [] for everything would make this whole describe
       green while proving nothing at all. */
    const blocks = manyBlocks(4);
    const sound: ModelNode = {
      title: "t",
      gist: "A sentence about the whole.",
      range: [blocks[0]!.id, blocks[3]!.id],
      children: [
        { title: "a", gist: "A sentence.", range: [blocks[0]!.id, blocks[1]!.id] },
        { title: "b", gist: "A sentence.", range: [blocks[2]!.id, blocks[3]!.id] },
      ],
    };
    const tree = buildTree(sound, {}, blocks, "control", report());
    expect(checkTree(blocks, tree).problems).toEqual([]);
    const leaf = Object.values(tree.nodes).find(
      (n) => n.children.length === 0 && n.range[0] === blocks[2]!.id,
    );
    // Two leaves for block 1, none for block 2 — exactly what a bad tiling does.
    leaf!.range = [blocks[1]!.id, blocks[1]!.id];
    expect(checkTree(blocks, tree).problems.length).toBeGreaterThan(0);
  });
});
