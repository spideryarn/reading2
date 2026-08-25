/**
 * Column context — the pure half (src/web/context.ts): what a gist column
 * lists around the item the reader is in. Run against the `example/` fixture —
 * two parts, eight sections — so every assertion is written in terms of the
 * shape it finds rather than a count it assumes.
 *
 * The DOM half — which cell is under the focus line, the panel's centring —
 * needs a real layout and is checked by hand per docs/project/browser-testing.md.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Block, Tree, TreeNode } from "../src/types.js";
import { buildGeometry, type Cell } from "../src/web/tree.js";
import { itemStarts } from "../src/web/keynav.js";
import { currentIndex, itemsFromCells, levelList } from "../src/web/context.js";

const blocks: Block[] = JSON.parse(readFileSync("example/blocks.json", "utf8")).blocks;
const tree: Tree = JSON.parse(readFileSync("example/tree.json", "utf8"));
const geometry = buildGeometry(tree, blocks);
const blockAt = (row: number) => blocks[row]?.id;

const parts = itemsFromCells(geometry.cells[1]!, blockAt).items;
const sections = itemsFromCells(geometry.cells[2]!, blockAt).items;

describe("itemsFromCells", () => {
  it("makes one item per cell, pointing at the cell's first block", () => {
    expect(parts.length).toBe(geometry.cells[1]!.length);
    expect(parts[0]!.blockId).toBe(blocks[0]!.id);
    const { starts } = itemsFromCells(geometry.cells[2]!, blockAt);
    expect(starts).toEqual(itemStarts(geometry.cells[2]!)); // balanced tree: no continuations
    for (const [i, s] of sections.entries()) expect(s.blockId).toBe(blocks[starts[i]!]!.id);
  });
});

describe("currentIndex", () => {
  const starts = [0, 4, 9, 15];
  it("is the last item starting at or before the row", () => {
    expect(currentIndex(starts, 0)).toBe(0);
    expect(currentIndex(starts, 4)).toBe(1);
    expect(currentIndex(starts, 8)).toBe(1);
    expect(currentIndex(starts, 15)).toBe(3);
    expect(currentIndex(starts, 999)).toBe(3);
  });
});

describe("levelList", () => {
  it("lists the whole level with a heading wherever the part changes", () => {
    const list = levelList(sections, 3, tree.nodes);
    expect(list.filter((e) => e.kind === "item").length).toBe(sections.length);
    const headings = list.filter((e) => e.kind === "group");
    expect(headings.length).toBe(new Set(sections.map((s) => s.node.parent)).size);
    // A heading comes immediately before the first section of its part.
    for (const [i, e] of list.entries()) {
      if (e.kind !== "group") continue;
      expect(list[i + 1]!.item.node.parent).toBe(e.item.node.id);
    }
  });

  it("tiers step with distance and stop at 'far'", () => {
    expect(sections.length).toBeGreaterThanOrEqual(7);
    const list = levelList(sections, 3, tree.nodes).filter((e) => e.kind === "item");
    const tierOf = (i: number) => list.find((e) => e.index === i)!.tier;
    expect(tierOf(3)).toBe("cur");
    expect(tierOf(2)).toBe("near");
    expect(tierOf(4)).toBe("near");
    expect(tierOf(5)).toBe("mid");
    expect(tierOf(6)).toBe("far");
    expect(tierOf(0)).toBe("far");
  });

  it("fades what has been read, by document order rather than distance", () => {
    const list = levelList(sections, 3, tree.nodes).filter((e) => e.kind === "item");
    expect(list.filter((e) => e.before).map((e) => e.index)).toEqual([0, 1, 2]);
  });

  it("marks the heading whose run holds the current item", () => {
    const list = levelList(sections, 3, tree.nodes);
    const holding = list.filter((e) => e.kind === "group" && e.holdsCurrent);
    expect(holding.length).toBe(1);
    expect(holding[0]!.item.node.id).toBe(sections[3]!.node.parent);
  });

  it("at the part level has no headings at all — the root is not a group", () => {
    expect(levelList(parts, 0, tree.nodes).every((e) => e.kind === "item")).toBe(true);
  });
});

describe("continuation cells", () => {
  // An unbalanced tree, by hand: at this column the branch under `A` bottomed
  // out one level up, so its rows repeat `A` as a continuation *between* two
  // real siblings of the same parent. Listing it would put a shallower node
  // among this level's items.
  const node = (id: string, depth: number, parent: string | null) =>
    ({ id, depth, parent, children: [], range: [`spya-${id}`, `spya-${id}`], title: id }) as unknown as TreeNode;
  const P = node("P", 1, "root");
  const cells: Cell[] = [
    { node: node("b1", 2, "P"), rowSpan: 2, continuation: false },
    { node: node("A", 1, "root"), rowSpan: 3, continuation: true },
    { node: node("b2", 2, "P"), rowSpan: 1, continuation: false },
  ];
  const ids = ["r0", "r1", "r2", "r3", "r4", "r5"];
  const { items, starts } = itemsFromCells(cells, (row) => ids[row]);

  it("are not items, and the starts stay paired with the items that remain", () => {
    expect(items.map((i) => i.node.id)).toEqual(["b1", "b2"]);
    expect(starts).toEqual([0, 5]);
    expect(items[1]!.blockId).toBe("r5");
  });

  it("so the level lists the two real siblings under one heading", () => {
    const list = levelList(items, 0, { P } as never);
    expect(list.map((e) => `${e.kind}:${e.item.node.id}`)).toEqual(["group:P", "item:b1", "item:b2"]);
  });

  it("and a row inside one counts as the last real item before it", () => {
    expect(starts.includes(3)).toBe(false);
    expect(currentIndex(starts, 3)).toBe(0);
  });
});
