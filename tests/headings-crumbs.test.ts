/**
 * **The headings breadcrumb's path** — `crumbPath`, which is pure.
 *
 * Hand-built trees, never `data/`, for the reason tests/structure-projection.test.ts
 * gives — and one built by the real `buildTree`, because the ragged shape it
 * guards is that builder's. Every case asserts on content, not only on absence.
 *
 * docs/plans/261002h-headings-breadcrumb-at-the-top-of-the-reading-view.md
 */
import { describe, expect, it } from "vitest";
import { buildTree } from "../src/structure.js";
import { crumbPath } from "../src/web/crumbs.js";
import { sectionDepth } from "../src/web/position.js";
import { buildGeometry, buildSummaryTree, type SummaryNode } from "../src/web/tree.js";
import type { Block, BlockId, NodeId, TreeNode } from "../src/types.js";

let seq = 0;

function node(opts: {
  title: string;
  number: string;
  startRow: number;
  endRow: number;
  navLabel?: string;
  sourceHeading?: string;
  gist?: string;
  supplement?: true;
  /** A stored block leaf: nothing beneath it in the tree at all. */
  leaf?: true;
  children?: SummaryNode[];
}): SummaryNode {
  const id = `n${++seq}` as NodeId;
  /* **Stored children, as a real section has.** `buildSummaryTree` empties the
     projected `children` at the depth cut and leaves the stored node alone, so
     a section here is an internal node whose leaves are below the cut — and
     `crumbPath` tells a section from a paragraph by exactly that. */
  const stored = opts.leaf
    ? []
    : opts.children?.length
      ? opts.children.map((c) => c.node.id)
      : [`${id}-p1` as NodeId, `${id}-p2` as NodeId];
  const tree: TreeNode = {
    id,
    depth: 1,
    parent: "n0" as NodeId,
    children: stored,
    range: [`spya-${id}a` as BlockId, `spya-${id}z` as BlockId],
    title: opts.title,
  };
  if (opts.navLabel !== undefined) tree.navLabel = opts.navLabel;
  if (opts.sourceHeading !== undefined) tree.sourceHeading = opts.sourceHeading;
  const summary: SummaryNode = {
    node: tree,
    number: opts.number,
    title: opts.title,
    startRow: opts.startRow,
    endRow: opts.endRow,
    blocks: opts.endRow - opts.startRow + 1,
    children: opts.children ?? [],
  };
  if (opts.gist !== undefined) summary.gist = opts.gist;
  if (opts.supplement === true) {
    summary.supplement = true;
    tree.treatment = "supplement";
  }
  return summary;
}

function root(children: SummaryNode[]): SummaryNode {
  return {
    node: {
      id: "n0" as NodeId,
      depth: 0,
      parent: null,
      children: children.map((c) => c.node.id),
      range: ["spya-root-a" as BlockId, "spya-root-z" as BlockId],
      title: "A piece",
    },
    number: "",
    title: "A piece",
    startRow: 0,
    endRow: 99,
    blocks: 100,
    children,
  };
}

function corpus() {
  return root([
    node({ title: "Opening", number: "1", startRow: 0, endRow: 9, gist: "g1" }),
    node({
      title: "The evidence",
      number: "2",
      startRow: 10,
      endRow: 39,
      gist: "g2",
      children: [
        node({ title: "Trials", number: "2.1", startRow: 10, endRow: 19, gist: "s1" }),
        node({
          title: "What they found",
          number: "2.2",
          startRow: 20,
          endRow: 39,
          sourceHeading: "What they found",
        }),
      ],
    }),
    node({ title: "Notes", number: "", startRow: 40, endRow: 99, supplement: true }),
  ]);
}

describe("crumbPath", () => {
  it("is part then section, outermost first, with numbers, gists and first blocks", () => {
    const path = crumbPath(corpus(), 25);
    expect(path.map((c) => `${c.number} ${c.text}`)).toEqual(["2 The evidence", "2.2 What they found"]);
    expect(path[0]?.gist).toBe("g2");
    expect(path[1]?.gist).toBeUndefined();
    expect(path[1]?.blockId).toMatch(/^spya-n\d+a$/);
  });

  it("puts each title in its own voice — the author's heading kept, else the model's", () => {
    const path = crumbPath(corpus(), 25);
    expect(path.map((c) => c.voice)).toEqual(["ai", "author"]);
  });

  it("marks the first row of a section as inside it (inclusive bounds)", () => {
    expect(crumbPath(corpus(), 20).map((c) => c.text)).toEqual(["The evidence", "What they found"]);
    expect(crumbPath(corpus(), 19).map((c) => c.text)).toEqual(["The evidence", "Trials"]);
  });

  it("stops at a part with no sections, and at the apparatus, which is one crumb", () => {
    expect(crumbPath(corpus(), 3).map((c) => c.text)).toEqual(["Opening"]);
    const notes = crumbPath(corpus(), 70);
    expect(notes.map((c) => `${c.number}|${c.text}`)).toEqual(["|Notes"]);
  });

  it("falls back to the navLabel, and skips a node with no words at all", () => {
    const tree = root([
      node({
        title: "",
        number: "1",
        startRow: 0,
        endRow: 9,
        children: [
          node({ title: "", number: "1.1", startRow: 0, endRow: 4, navLabel: "Setting the scene" }),
        ],
      }),
    ]);
    expect(crumbPath(tree, 2).map((c) => `${c.number} ${c.text}`)).toEqual(["1.1 Setting the scene"]);
  });

  it("stops above a stored block leaf, but keeps a cut section and a childless apparatus", () => {
    const tree = root([
      node({
        title: "Afterword",
        number: "1",
        startRow: 0,
        endRow: 9,
        children: [
          node({ title: "", number: "1.1", startRow: 0, endRow: 0, navLabel: "A paragraph", leaf: true }),
          // A section cut at the depth limit: no projected children, stored ones.
          node({ title: "Thanks", number: "1.2", startRow: 1, endRow: 9 }),
        ],
      }),
      node({ title: "Notes", number: "", startRow: 10, endRow: 10, supplement: true, leaf: true }),
    ]);
    expect(crumbPath(tree, 0).map((c) => c.text)).toEqual(["Afterword"]);
    expect(crumbPath(tree, 5).map((c) => c.text)).toEqual(["Afterword", "Thanks"]);
    expect(crumbPath(tree, 10).map((c) => c.text)).toEqual(["Notes"]);
  });

  it("is empty with no tree, or for a row no part contains", () => {
    expect(crumbPath(null, 5)).toEqual([]);
    expect(crumbPath(corpus(), 500)).toEqual([]);
  });

  /* The real builders, because the shape is theirs: a model's tree is ragged,
     and `sectionDepth` is one number for the whole piece. A chapter with no
     sections keeps its paragraphs as its children at the cut, and each has a
     navLabel — so the crumb read "Afterword › para label 9".
     docs/plans/261005c-long-document-follow-ups-… § (g). */
  it("shows a chapter with no sections alone, never one of its paragraphs", () => {
    const blocks: Block[] = Array.from({ length: 12 }, (_, i) => ({
      id: `spya-p${String(i).padStart(4, "0")}` as BlockId,
      tag: "p",
      kind: "text",
      text: `Paragraph ${i} has several plain words in it for a title.`,
      words: 11,
      html: "",
      gistable: true,
    }));
    const id = (i: number) => blocks[i]!.id;
    const answer = {
      title: "Book",
      gist: "g",
      range: [id(0), id(11)],
      children: [
        {
          title: "Chapter One",
          gist: "g",
          range: [id(0), id(7)],
          children: [
            { title: "First section", gist: "g", range: [id(0), id(3)] },
            { title: "Second section", gist: "g", range: [id(4), id(7)] },
          ],
        },
        { title: "Afterword", gist: "g", range: [id(8), id(11)] },
      ],
    };
    const navLabels = Object.fromEntries(blocks.map((b, i) => [b.id, `para label ${i}`]));
    const tree = buildTree(answer as Parameters<typeof buildTree>[0], navLabels, blocks, "crumbs-ragged");
    const summary = buildSummaryTree(tree, blocks, sectionDepth(buildGeometry(tree, blocks)));

    // The fixture is the ragged one: the Afterword's paragraphs survive the cut.
    expect(summary?.children[1]?.children.length).toBe(4);

    expect(crumbPath(summary, 1).map((c) => c.text)).toEqual(["Chapter One", "First section"]);
    expect(crumbPath(summary, 9).map((c) => c.text)).toEqual(["Afterword"]);
  });
});
