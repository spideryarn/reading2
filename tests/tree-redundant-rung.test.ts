/**
 * **No rung of the tree may restate the one above it.**
 *
 * A node with exactly one child whose range is identical to its own buys the
 * reader nothing: two adjacent gist columns of identical extent, neither marked
 * `continuation`, so both render in full and both are fisheye items. One rung
 * finer is supposed to be a *compression* of the rung below it
 * (docs/project/granularity-zoom.md), and a restatement of the same paragraphs
 * is the opposite of that.
 *
 * Measured on 2026-09-05 across every saved tree under `evals/` and `data/`:
 * 243 unary internal nodes, **every one of them** with a child covering the
 * parent's whole range and not one covering only part of it. 35 of the 243 have
 * an internal child — those are the redundant rungs. The other 208 have a
 * *leaf* child, which is the benign shape: a one-block section grows exactly
 * one leaf over its whole range, and that is what `buildTree` is supposed to do.
 * docs/plans/260904d-deepen-fat-sections.md § The unary internal node was a bug
 * in `buildTree`.
 *
 * So the rule is a **range** statement with a leaf exemption, and it is tested
 * at both ends:
 *
 * - `buildTree` splices the grandchildren up and deletes the rung, keeping the
 *   parent's title and gist — it never *refuses*, because `planChildRanges`'s
 *   whole design is that nothing about the derivation can refuse
 *   (src/hierarchy.ts).
 * - `checkTree` says so about a *stored* tree, which it never did before
 *   2026-09-05 (src/tree-invariants.ts, in the children-tile-the-parent loop).
 */
import { describe, expect, it } from "vitest";
import { buildTree, type BuildReport, type ModelNode } from "../src/hierarchy.js";
import { checkTree } from "../src/tree-invariants.js";
import type { Block, Tree, TreeNode } from "../src/types.js";

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

const report = (): BuildReport => ({
  repairs: [],
  droppedChildren: [],
  droppedHeadings: [],
  collapsedRungs: [],
  droppedQuestions: [],
});

/** A node by the title the model gave it. */
function titled(tree: Tree, title: string): TreeNode | undefined {
  return Object.values(tree.nodes).find((n) => n.title === title);
}

/** Every leaf's block, in tree order — what the reader can actually reach. */
function leafBlocks(tree: Tree): string[] {
  return Object.values(tree.nodes)
    .filter((n) => n.children.length === 0)
    .map((n) => n.range[0]);
}

/**
 * Every rung this file exists to remove: a child covering its parent's whole
 * range, where the child is not a leaf. Read off the built tree, so it sees
 * whatever `buildTree` actually produced rather than what it was asked for.
 */
function redundantRungs(tree: Tree): string[] {
  const out: string[] = [];
  for (const node of Object.values(tree.nodes)) {
    for (const childId of node.children) {
      const child = tree.nodes[childId];
      if (!child || child.children.length === 0) continue;
      if (child.range[0] === node.range[0] && child.range[1] === node.range[1]) {
        out.push(`${node.id} "${node.title}" -> ${child.id} "${child.title}"`);
      }
    }
  }
  return out;
}

const WHOLE: Pick<ModelNode, "title" | "gist" | "range"> = {
  title: "Whole piece",
  gist: "The article argues something.",
  range: ["spya-aaaaaa", "spya-ffffff"],
};

describe("buildTree collapses a rung that restates its parent", () => {
  /**
   * **Case A** — the model itself proposes a node with exactly one child, and
   * the child's range is the parent's. This is the shape 34 of the 35 corpus
   * instances have.
   */
  const proposed: ModelNode = {
    ...WHOLE,
    children: [
      {
        title: "Writing at Work",
        gist: "The coarser name, which is the one to keep.",
        range: ["spya-aaaaaa", "spya-cccccc"],
        children: [
          {
            title: "The Pressure to Write",
            gist: "A sub-section's name, standing over the same three paragraphs.",
            range: ["spya-aaaaaa", "spya-cccccc"],
            children: [
              { title: "Opening", gist: "It opens.", range: ["spya-aaaaaa", "spya-bbbbbb"] },
              { title: "Body", gist: "It continues.", range: ["spya-cccccc", "spya-cccccc"] },
            ],
          },
        ],
      },
      { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
    ],
  };

  it("deletes the rung and splices the grandchildren up", () => {
    const tree = buildTree(proposed, {}, BLOCKS, "test", report());
    expect(redundantRungs(tree)).toEqual([]);
    expect(titled(tree, "The Pressure to Write")).toBeUndefined();
    const parent = titled(tree, "Writing at Work")!;
    expect(parent.children.map((id) => tree.nodes[id]!.title)).toEqual(["Opening", "Body"]);
    expect(checkTree(BLOCKS, tree).problems).toEqual([]);
    expect(leafBlocks(tree).sort()).toEqual(BLOCKS.map((b) => b.id).sort());
  });

  /**
   * **The parent's title and gist survive; the child's are discarded.** Settled
   * from evidence rather than taste: in the nine corpus cases where the two
   * titles differ, the parent is the coarser name every time — "Writing at
   * Work" over "The Pressure to Write", "The Disappearing Writers" over "Few
   * People Who Can Write" — which is what that rung is for.
   */
  it("keeps the parent's name, which is the coarser one", () => {
    const tree = buildTree(proposed, {}, BLOCKS, "test", report());
    const parent = titled(tree, "Writing at Work")!;
    expect(parent.gist).toBe("The coarser name, which is the one to keep.");
  });

  it("counts every rung it discarded, by position in the model's own proposal", () => {
    const r = report();
    buildTree(proposed, {}, BLOCKS, "test", r);
    expect(r.collapsedRungs).toEqual(["root > child 1 > child 1"]);
    /* A collapse moves no blocks — the two ranges are identical — so it must
       not show up as a boundary repair, which is measured in blocks moved. */
    expect(r.repairs).toEqual([]);
  });

  /**
   * **Case B** — the same shape arriving the other way: the model proposed
   * three children, two of them started where the first did and were dropped,
   * and the survivor is pinned to the parent's whole range. The drops are still
   * a real loss and are still counted.
   */
  it("collapses a sole survivor of dropped siblings, and still counts the drops", () => {
    const dropped: ModelNode = {
      ...WHOLE,
      children: [
        {
          title: "First",
          gist: "It opens.",
          range: ["spya-aaaaaa", "spya-cccccc"],
          children: [
            {
              title: "Survivor",
              /* Backwards on purpose: it makes the end ineligible as a fallback
                 split point, which is what leaves the two later children with
                 nothing to start at. src/hierarchy.ts § `planChildRanges`. */
              range: ["spya-bbbbbb", "spya-aaaaaa"],
              gist: "The only one of the three that marks a split point.",
              children: [
                { title: "Opening", gist: "It opens.", range: ["spya-aaaaaa", "spya-bbbbbb"] },
                { title: "Body", gist: "It continues.", range: ["spya-cccccc", "spya-cccccc"] },
              ],
            },
            { title: "Dropped one", gist: "d1", range: ["spya-aaaaaa", "spya-bbbbbb"] },
            { title: "Dropped two", gist: "d2", range: ["spya-aaaaaa", "spya-cccccc"] },
          ],
        },
        { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
      ],
    };
    const r = report();
    const tree = buildTree(dropped, {}, BLOCKS, "test", r);
    expect(redundantRungs(tree)).toEqual([]);
    expect(titled(tree, "Survivor")).toBeUndefined();
    expect(r.collapsedRungs).toEqual(["root > child 1 > child 1"]);
    expect(r.droppedChildren).toEqual([
      "root > child 1 > child 2",
      "root > child 1 > child 3",
    ]);
    expect(checkTree(BLOCKS, tree).problems).toEqual([]);
  });

  /**
   * **Case C, the benign one, which must keep working.** A one-block section
   * grows exactly one leaf over its whole range — 208 of the corpus's 243 unary
   * internal nodes are this, and none of them is a fault. It is why the rule
   * excepts a leaf child rather than counting children.
   */
  it("leaves a one-block section and its single grown leaf alone", () => {
    const oneBlock: ModelNode = {
      ...WHOLE,
      children: [
        { title: "One block", gist: "A single paragraph.", range: ["spya-aaaaaa", "spya-aaaaaa"] },
        { title: "The rest", gist: "Everything else.", range: ["spya-bbbbbb", "spya-ffffff"] },
      ],
    };
    const r = report();
    const tree = buildTree(oneBlock, {}, BLOCKS, "test", r);
    const section = titled(tree, "One block")!;
    expect(section.children).toHaveLength(1);
    expect(tree.nodes[section.children[0]!]!.range).toEqual(["spya-aaaaaa", "spya-aaaaaa"]);
    expect(r.collapsedRungs).toEqual([]);
    expect(checkTree(BLOCKS, tree).problems).toEqual([]);
  });

  /**
   * **It iterates to a fixpoint.** A chain of rungs over the same range is real:
   * `waves.fowler-phrenology.r1` holds `n0053 → n0054 → n0055`, all three
   * `[spya-y7fuv5, spya-y7fuv5]`. One pass would leave a two-deep one.
   */
  it("collapses a whole chain, not just its outermost rung", () => {
    const chain: ModelNode = {
      ...WHOLE,
      children: [
        {
          title: "Outermost",
          gist: "The name the reader should see.",
          range: ["spya-aaaaaa", "spya-cccccc"],
          children: [
            {
              title: "Middle",
              gist: "m",
              range: ["spya-aaaaaa", "spya-cccccc"],
              children: [
                {
                  title: "Innermost",
                  gist: "i",
                  range: ["spya-aaaaaa", "spya-cccccc"],
                  children: [
                    { title: "Opening", gist: "It opens.", range: ["spya-aaaaaa", "spya-bbbbbb"] },
                    { title: "Body", gist: "It continues.", range: ["spya-cccccc", "spya-cccccc"] },
                  ],
                },
              ],
            },
          ],
        },
        { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
      ],
    };
    const r = report();
    const tree = buildTree(chain, {}, BLOCKS, "test", r);
    expect(redundantRungs(tree)).toEqual([]);
    expect(titled(tree, "Middle")).toBeUndefined();
    expect(titled(tree, "Innermost")).toBeUndefined();
    expect(titled(tree, "Outermost")!.children.map((id) => tree.nodes[id]!.title)).toEqual([
      "Opening",
      "Body",
    ]);
    expect(r.collapsedRungs).toEqual([
      "root > child 1 > child 1",
      "root > child 1 > child 1 > child 1",
    ]);
    expect(checkTree(BLOCKS, tree).problems).toEqual([]);
  });

  /**
   * **The root is a node like any other.** Nothing about the collapse is keyed
   * on having a parent, and a model that wraps the whole article in one section
   * produces exactly this.
   */
  it("collapses a root whose only child is the whole article", () => {
    const wrapped: ModelNode = {
      ...WHOLE,
      children: [
        {
          title: "The article",
          gist: "A restatement of the root.",
          range: ["spya-aaaaaa", "spya-ffffff"],
          children: [
            { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-cccccc"] },
            { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
          ],
        },
      ],
    };
    const r = report();
    const tree = buildTree(wrapped, {}, BLOCKS, "test", r);
    expect(redundantRungs(tree)).toEqual([]);
    expect(tree.nodes[tree.rootId]!.title).toBe("Whole piece");
    expect(tree.nodes[tree.rootId]!.children.map((id) => tree.nodes[id]!.title)).toEqual([
      "First",
      "Second",
    ]);
    expect(r.collapsedRungs).toEqual(["root > child 1"]);
  });

  /**
   * **A sole child that is itself a model leaf.** The rung is still redundant —
   * the child would have grown the same leaves the parent now grows — and the
   * range statement catches it where a count over model children would need a
   * second case.
   */
  it("collapses a sole child with no children of its own, and grows the leaves itself", () => {
    const soleLeaf: ModelNode = {
      ...WHOLE,
      children: [
        {
          title: "First",
          gist: "It opens.",
          range: ["spya-aaaaaa", "spya-cccccc"],
          children: [{ title: "Restated", gist: "The same three paragraphs.", range: ["spya-aaaaaa", "spya-cccccc"] }],
        },
        { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
      ],
    };
    const r = report();
    const tree = buildTree(soleLeaf, {}, BLOCKS, "test", r);
    expect(redundantRungs(tree)).toEqual([]);
    expect(titled(tree, "Restated")).toBeUndefined();
    const parent = titled(tree, "First")!;
    expect(parent.children.map((id) => tree.nodes[id]!.range[0])).toEqual([
      "spya-aaaaaa",
      "spya-bbbbbb",
      "spya-cccccc",
    ]);
    expect(r.collapsedRungs).toEqual(["root > child 1 > child 1"]);
  });

  /**
   * **The parent adopts the child's `sourceHeading` where it has none.** Both
   * nodes hold the same range, so a claim backed for one is backed for the
   * other — and `buildTree` drops it anyway if nothing in the range backs it.
   */
  it("adopts the discarded rung's sourceHeading when the parent has none", () => {
    const claimed: ModelNode = {
      ...WHOLE,
      children: [
        {
          title: "First",
          gist: "It opens.",
          range: ["spya-aaaaaa", "spya-cccccc"],
          children: [
            {
              title: "Restated",
              gist: "r",
              sourceHeading: "The First Part",
              range: ["spya-aaaaaa", "spya-cccccc"],
              children: [
                { title: "Opening", gist: "It opens.", range: ["spya-aaaaaa", "spya-bbbbbb"] },
                { title: "Body", gist: "It continues.", range: ["spya-cccccc", "spya-cccccc"] },
              ],
            },
          ],
        },
        { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
      ],
    };
    const tree = buildTree(claimed, {}, BLOCKS, "test", report());
    expect(titled(tree, "First")!.sourceHeading).toBe("The First Part");
  });

  it("never overwrites a sourceHeading the parent already has", () => {
    const both: ModelNode = {
      ...WHOLE,
      children: [
        {
          title: "First",
          gist: "It opens.",
          sourceHeading: "The First Part",
          range: ["spya-aaaaaa", "spya-cccccc"],
          children: [
            {
              title: "Restated",
              gist: "r",
              sourceHeading: "The Second Part",
              range: ["spya-aaaaaa", "spya-cccccc"],
              children: [
                { title: "Opening", gist: "It opens.", range: ["spya-aaaaaa", "spya-bbbbbb"] },
                { title: "Body", gist: "It continues.", range: ["spya-cccccc", "spya-cccccc"] },
              ],
            },
          ],
        },
        { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
      ],
    };
    const tree = buildTree(both, {}, BLOCKS, "test", report());
    expect(titled(tree, "First")!.sourceHeading).toBe("The First Part");
  });
});

describe("checkTree rejects a rung that restates its parent", () => {
  /**
   * Hand-built rather than produced by `buildTree`, deliberately: after the
   * collapse `buildTree` cannot make this shape, and the invariant exists for
   * every *other* producer of a tree — the cascade, `heading-tree.ts`, a stored
   * artefact from before this rule existed, and whatever comes next.
   */
  function node(over: Partial<TreeNode> & Pick<TreeNode, "id" | "range">): TreeNode {
    return {
      depth: 0,
      parent: null,
      children: [],
      title: "",
      ...over,
    };
  }

  /** root → a → (grown leaves), with `a` covering everything the root does. */
  function treeWithRung(): Tree {
    return {
      version: "toc/1",
      generator: "test",
      slug: "test",
      rootId: "n0001",
      nodes: {
        n0001: node({
          id: "n0001",
          range: ["spya-aaaaaa", "spya-bbbbbb"],
          title: "Whole piece",
          gist: "g",
          children: ["n0002"],
        }),
        n0002: node({
          id: "n0002",
          depth: 1,
          parent: "n0001",
          range: ["spya-aaaaaa", "spya-bbbbbb"],
          title: "A restatement",
          gist: "g",
          children: ["n0003", "n0004"],
        }),
        n0003: node({ id: "n0003", depth: 2, parent: "n0002", range: ["spya-aaaaaa", "spya-aaaaaa"] }),
        n0004: node({ id: "n0004", depth: 2, parent: "n0002", range: ["spya-bbbbbb", "spya-bbbbbb"] }),
      },
    };
  }

  const TWO = [BLOCKS[0]!, BLOCKS[1]!];

  it("names the rung and says what the reader would get", () => {
    const { problems } = checkTree(TWO, treeWithRung());
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("n0001 → n0002");
    expect(problems[0]).toMatch(/covers its parent's whole range/);
  });

  it("says nothing about a one-block node and its single grown leaf", () => {
    const tree = treeWithRung();
    /* The 208: a section spanning one block, whose grown leaf legitimately
       covers the whole of it. */
    tree.nodes.n0002!.range = ["spya-aaaaaa", "spya-aaaaaa"];
    tree.nodes.n0002!.children = ["n0003"];
    tree.nodes.n0001!.children = ["n0002", "n0004"];
    tree.nodes.n0004!.depth = 1;
    tree.nodes.n0004!.parent = "n0001";
    expect(checkTree(TWO, tree).problems).toEqual([]);
  });

  it("says nothing about a supplement holding exactly one note block", () => {
    const notes = block("spya-bbbbbb", "1. A single endnote.");
    notes.treatment = "supplement";
    const tree = treeWithRung();
    tree.nodes.n0002!.range = ["spya-bbbbbb", "spya-bbbbbb"];
    tree.nodes.n0002!.title = "Notes";
    tree.nodes.n0002!.treatment = "supplement";
    delete tree.nodes.n0002!.gist;
    tree.nodes.n0002!.children = ["n0004"];
    tree.nodes.n0004!.depth = 2;
    tree.nodes.n0001!.children = ["n0003", "n0002"];
    tree.nodes.n0003!.depth = 1;
    tree.nodes.n0003!.parent = "n0001";
    expect(checkTree([BLOCKS[0]!, notes], tree).problems).toEqual([]);
  });
});
