/**
 * The ToC is derived from the tree, never stored alongside it — see
 * docs/project/table-of-contents.md. flattenTree is that derivation.
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { flattenTree } from "../src/toc-flatten.js";
import type { Tree, TreeNode } from "../src/types.js";

/** A three-level toy tree over blocks b0…b3, tiled exactly. */
function toyTree(overrides: Record<string, Partial<TreeNode>> = {}): Tree {
  const node = (n: TreeNode): TreeNode => ({ ...n, ...overrides[n.id] });
  const nodes: TreeNode[] = [
    node({ id: "n0", depth: 0, parent: null, children: ["n1", "n2"], range: ["b0", "b3"], title: "Whole article", gist: "All of it." }),
    node({ id: "n1", depth: 1, parent: "n0", children: ["n3", "n4"], range: ["b0", "b1"], title: "First half", gist: "The first half." }),
    node({ id: "n2", depth: 1, parent: "n0", children: ["n5", "n6"], range: ["b2", "b3"], title: "Second half", gist: "The second half." }),
    node({ id: "n3", depth: 2, parent: "n1", children: [], range: ["b0", "b0"], title: "b0", navLabel: "The opening paragraph sets out the problem" }),
    node({ id: "n4", depth: 2, parent: "n1", children: [], range: ["b1", "b1"], title: "b1", navLabel: "The second paragraph names the two camps" }),
    node({ id: "n5", depth: 2, parent: "n2", children: [], range: ["b2", "b2"], title: "b2", navLabel: "A diagram is discussed at some length" }),
    // No navLabel: a media block, tiled by the tree but never a row.
    node({ id: "n6", depth: 2, parent: "n2", children: [], range: ["b3", "b3"], title: "b3" }),
  ];
  return {
    version: "1", generator: "test", slug: "toy", rootId: "n0",
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
  };
}

describe("flattenTree", () => {
  it("walks depth-first in document order", () => {
    expect(flattenTree(toyTree()).map((r) => r.label)).toEqual([
      "Whole article",
      "First half",
      "The opening paragraph sets out the problem",
      "The second paragraph names the two camps",
      "Second half",
      "A diagram is discussed at some length",
    ]);
  });

  it("skips leaves with no navLabel — that absence is deliberate, not missing data", () => {
    const rows = flattenTree(toyTree());
    expect(rows.some((r) => r.startsAt === "b3")).toBe(false);
  });

  it("labels internal nodes from title and leaves from navLabel, never the other way", () => {
    const rows = flattenTree(toyTree());
    const internal = rows.filter((r) => r.hasChildren);
    const leaves = rows.filter((r) => !r.hasChildren);
    expect(internal.map((r) => r.label)).toEqual(["Whole article", "First half", "Second half"]);
    expect(leaves.every((r) => r.label.split(" ").length >= 6)).toBe(true);
  });

  it("carries the extent, not just the start", () => {
    const root = flattenTree(toyTree())[0];
    expect([root.startsAt, root.endsAt]).toEqual(["b0", "b3"]);
  });

  it("honours maxDepth", () => {
    expect(flattenTree(toyTree(), { maxDepth: 1 }).map((r) => r.depth)).toEqual([0, 1, 1]);
    expect(flattenTree(toyTree(), { maxDepth: 0 }).map((r) => r.label)).toEqual(["Whole article"]);
  });

  it("passes sourceHeading through only when the node has one", () => {
    const rows = flattenTree(toyTree({ n1: { sourceHeading: "First half" } }));
    expect(rows.find((r) => r.label === "First half")!.sourceHeading).toBe("First half");
    expect(rows.find((r) => r.label === "Second half")).not.toHaveProperty("sourceHeading");
  });
});

describe("the example fixture", () => {
  it("flattens to a sidebar with rows at every depth", async () => {
    const tree: Tree = JSON.parse(await readFile("example/tree.json", "utf8"));
    const rows = flattenTree(tree);
    expect(rows.length).toBeGreaterThan(10);
    expect(new Set(rows.map((r) => r.depth)).size).toBeGreaterThan(2);
    expect(rows.every((r) => r.label.trim().length > 0)).toBe(true);
  });
});
