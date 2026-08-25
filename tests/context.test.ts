/**
 * Column context — the pure half (src/web/context.ts): what each mode lists
 * around the item the reader is in. Run against the `example/` fixture — two
 * parts, eight sections — so every assertion is written in terms of the shape
 * it finds rather than a count it assumes.
 *
 * The DOM half — which cell is under the reading line, the sticky-bottom
 * pinning, the panel's centring — needs a real layout and is checked by hand
 * per docs/project/browser-testing.md.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Block, Tree } from "../src/types.js";
import { buildGeometry } from "../src/web/tree.js";
import { itemStarts } from "../src/web/keynav.js";
import {
  currentIndex,
  isContextMode,
  itemsFromCells,
  levelList,
  neighbours,
  siblingList,
} from "../src/web/context.js";

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

describe("siblingList", () => {
  it("at the part level lists every part and no group markers", () => {
    const cur = parts.length - 1;
    const list = siblingList(parts, cur, tree.nodes);
    expect(list.every((e) => e.kind === "item")).toBe(true);
    expect(list.length).toBe(parts.length);
    expect(list.filter((e) => e.tier === "cur").map((e) => e.index)).toEqual([cur]);
    expect(list.filter((e) => e.tier === "near").map((e) => e.index)).toEqual([cur - 1]);
    // "before" is document order, which is what fades the ones already read.
    expect(list.filter((e) => e.before).map((e) => e.index)).toEqual(
      parts.slice(0, cur).map((_, i) => i),
    );
  });

  it("at the section level lists only siblings, bracketed by the neighbouring parts", () => {
    // The first section of the second part, so there is a part before it.
    const cur = sections.findIndex((s) => s.node.parent === parts[1]!.node.id);
    expect(cur).toBeGreaterThan(0);
    const parent = sections[cur]!.node.parent;
    const list = siblingList(sections, cur, tree.nodes);
    const items = list.filter((e) => e.kind === "item");
    expect(items.every((e) => e.item.node.parent === parent)).toBe(true);
    expect(items.length).toBe(sections.filter((s) => s.node.parent === parent).length);
    // Contiguous: children partition their parent, so no stranger interrupts.
    const idx = items.map((e) => e.index);
    expect(idx).toEqual(idx.map((_, i) => idx[0]! + i));

    // The leading marker names the part before — never this section's own part.
    const lead = list[0]!;
    expect(lead.kind).toBe("group");
    expect(lead.item.node.id).toBe(parts[0]!.node.id);
    expect(lead.item.node.depth).toBe(1);
    expect(lead.before).toBe(true);
    // And a trailing one only if there is a part after.
    const tail = list[list.length - 1]!;
    const hasNextPart = parts.length > 2;
    expect(tail.kind).toBe(hasNextPart ? "group" : "item");
  });

  it("has no leading marker in the first part, and the trailing one names the next", () => {
    const list = siblingList(sections, 0, tree.nodes);
    expect(list[0]!.kind).toBe("item");
    const tail = list[list.length - 1]!;
    expect(tail.kind).toBe("group");
    expect(tail.item.node.id).toBe(parts[1]!.node.id);
    expect(tail.before).toBe(false);
    const last = siblingList(sections, sections.length - 1, tree.nodes);
    expect(last[last.length - 1]!.kind).toBe("item");
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

  it("at the part level has no headings at all — the root is not a group", () => {
    expect(levelList(parts, 0, tree.nodes).every((e) => e.kind === "item")).toBe(true);
  });
});

describe("neighbours", () => {
  it("is null at the ends and the adjacent items in between", () => {
    expect(neighbours(parts, 0).prev).toBeNull();
    expect(neighbours(parts, parts.length - 1).next).toBeNull();
    const mid = neighbours(sections, 3);
    expect(mid.prev).toBe(sections[2]);
    expect(mid.next).toBe(sections[4]);
  });
});

describe("isContextMode", () => {
  it("accepts the five spellings and nothing else", () => {
    for (const m of ["off", "siblings", "neighbours", "panel", "centred"]) {
      expect(isContextMode(m)).toBe(true);
    }
    expect(isContextMode("neighbors")).toBe(false);
    expect(isContextMode("")).toBe(false);
  });
});

describe("continuation cells", () => {
  // An unbalanced tree, by hand: at this column the branch under `A` bottomed
  // out one level up, so its rows repeat `A` as a continuation *between* two
  // real siblings of the same parent. Listing it would put a shallower node
  // among this level's items and break siblingList's contiguous run.
  const node = (id: string, depth: number, parent: string | null) =>
    ({ id, depth, parent, children: [], range: [`spya-${id}`, `spya-${id}`], title: id }) as unknown as import("../src/types.js").TreeNode;
  const P = node("P", 1, "root");
  const cells: import("../src/web/tree.js").Cell[] = [
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

  it("so siblings on either side of one are still one contiguous run", () => {
    const list = siblingList(items, 0, { P } as never);
    expect(list.filter((e) => e.kind === "item").map((e) => e.item.node.id)).toEqual(["b1", "b2"]);
  });

  it("and a row inside one is current for nothing at this level", () => {
    // Row 3 is under the continuation; the item before it is b1, which starts
    // at 0 — TableView compares start rows, so no cell at this level matches.
    expect(starts.includes(3)).toBe(false);
    expect(currentIndex(starts, 3)).toBe(0);
  });
});

describe("the ctx and prog parsers", () => {
  it("accept the four modes, default to off, and reject anything else", async () => {
    const { ctxParam, progParam } = await import("../src/web/params.js");
    expect(ctxParam.parse("siblings")).toBe("siblings");
    expect(ctxParam.parse("centred")).toBe("centred");
    expect(ctxParam.parse("fisheye")).toBeNull();
    expect(ctxParam.defaultValue).toBe("off");
    expect(ctxParam.serialize("panel")).toBe("panel");
    expect(progParam.parse("1")).toBe(true);
    expect(progParam.parse("yes")).toBeNull();
    expect(progParam.defaultValue).toBe(false);
  });
});
