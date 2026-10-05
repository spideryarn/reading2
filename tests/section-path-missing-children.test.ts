/**
 * **A stored tree node with no `children` key is a leaf, not a crash.**
 *
 * A tree is JSON out of the database, and the `Tree` type is a claim about it
 * rather than a check. The client mends such a tree where it receives it
 * (src/web/tree.ts § `withChildLists`, tests/tree-missing-children.test.ts), but
 * `sectionNodesOf` is also reached on the server, from Skim, with a tree that
 * has been nowhere near that door. Review finding C-5 on plan 261005h.
 */

import { describe, expect, it } from "vitest";

import { blockIndex, sectionNodesOf, sectionPathOf } from "../src/section-path.js";
import type { Block, BlockId, NodeId, Tree, TreeNode } from "../src/types.js";

const bid = (i: number) => `spya-b${String(i).padStart(5, "0")}` as BlockId;
const blocks = Array.from({ length: 4 }, (_, i) => ({
  id: bid(i),
  type: "p",
  html: `<p>${i}</p>`,
  text: String(i),
})) as unknown as Block[];
const index = blockIndex(blocks);

/** A node as the store might hand it back: the `children` key simply absent. */
function withoutChildren(node: TreeNode): TreeNode {
  const { children: _dropped, ...rest } = node;
  return rest as TreeNode;
}

const node = (
  id: string,
  depth: number,
  parent: string | null,
  children: string[],
  lo: number,
  hi: number,
): TreeNode => ({
  id: id as NodeId,
  depth,
  parent: parent as NodeId | null,
  children: children as NodeId[],
  range: [bid(lo), bid(hi)],
  title: `Title of ${id}`,
});

const tree = (nodes: TreeNode[]): Tree =>
  ({
    version: "1",
    generator: "test",
    slug: "t",
    rootId: "n0" as NodeId,
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
  }) as unknown as Tree;

describe("a section path through a tree whose node has no children list", () => {
  it("treats a root without one as a leaf: no path, and no throw", () => {
    const t = tree([withoutChildren(node("n0", 0, null, [], 0, 3))]);
    expect(sectionNodesOf(bid(1), index, t)).toEqual([]);
    expect(sectionPathOf(bid(1), index, t)).toEqual([]);
  });

  it("treats an inner node without one as a leaf hanging off the root", () => {
    const t = tree([node("n0", 0, null, ["n1"], 0, 3), withoutChildren(node("n1", 1, "n0", [], 0, 3))]);
    expect(sectionPathOf(bid(1), index, t)).toEqual(["Title of n1"]);
  });

  it("keeps the ancestors of a deeper node without one, and drops that leaf itself", () => {
    const t = tree([
      node("n0", 0, null, ["n1"], 0, 3),
      node("n1", 1, "n0", ["n2"], 0, 3),
      withoutChildren(node("n2", 2, "n1", [], 0, 1)),
    ]);
    expect(sectionPathOf(bid(1), index, t)).toEqual(["Title of n1"]);
  });
});
