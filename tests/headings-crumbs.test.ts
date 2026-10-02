/**
 * **The headings breadcrumb's path** — `crumbPath`, which is pure.
 *
 * Hand-built trees, never `data/`, for the reason tests/structure-projection.test.ts
 * gives. Every case asserts on content, not only on absence.
 *
 * docs/plans/261002h-headings-breadcrumb-at-the-top-of-the-reading-view.md
 */
import { describe, expect, it } from "vitest";
import { crumbPath } from "../src/web/crumbs.js";
import type { SummaryNode } from "../src/web/tree.js";
import type { BlockId, NodeId, TreeNode } from "../src/types.js";

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
  children?: SummaryNode[];
}): SummaryNode {
  const id = `n${++seq}` as NodeId;
  const tree: TreeNode = {
    id,
    depth: 1,
    parent: "n0" as NodeId,
    children: [],
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
  if (opts.supplement === true) summary.supplement = true;
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

  it("is empty with no tree, or for a row no part contains", () => {
    expect(crumbPath(null, 5)).toEqual([]);
    expect(crumbPath(corpus(), 500)).toEqual([]);
  });
});
