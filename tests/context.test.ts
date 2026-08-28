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
import {
  currentIndex,
  itemsFromCells,
  landmarkLines,
  levelList,
  type ContextEntry,
} from "../src/web/context.js";

const blocks: Block[] = JSON.parse(readFileSync("example/blocks.json", "utf8")).blocks;
const tree: Tree = JSON.parse(readFileSync("example/tree.json", "utf8"));
const geometry = buildGeometry(tree, blocks);
const blockAt = (row: number) => blocks[row]?.id;

const parts = itemsFromCells(geometry.cells[1]!, blockAt, geometry.supplementOf).items;
const sections = itemsFromCells(geometry.cells[2]!, blockAt, geometry.supplementOf).items;

describe("itemsFromCells", () => {
  it("makes one item per cell, pointing at the cell's first block", () => {
    expect(parts.length).toBe(geometry.cells[1]!.length);
    expect(parts[0]!.blockId).toBe(blocks[0]!.id);
    const { starts } = itemsFromCells(geometry.cells[2]!, blockAt, geometry.supplementOf);
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

  it("is -1 above the level's first item, rather than claiming the first one", () => {
    expect(currentIndex([4, 9], 0)).toBe(-1);
    expect(currentIndex([4, 9], 3)).toBe(-1);
    expect(currentIndex([], 0)).toBe(-1);
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
  const { items, starts } = itemsFromCells(cells, (row) => ids[row], new Map());

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

  it("and a leading one leaves the level with no current item at all", () => {
    // The mirror image of the fixture above: the first branch bottoms out
    // above this column, so at row 0 there is no item here yet. Marking the
    // first one current would say "you are in section 1 of part 2" while the
    // reader is still in part 1.
    const leading: Cell[] = [
      { node: node("A", 1, "root"), rowSpan: 2, continuation: true },
      { node: node("b1", 2, "P"), rowSpan: 2, continuation: false },
    ];
    const { starts: st, items: it2 } = itemsFromCells(leading, (row) => ids[row], new Map());
    expect(st).toEqual([2]);
    const cur = currentIndex(st, 0);
    expect(cur).toBe(-1);
    const list = levelList(it2, cur, { P } as never);
    expect(list.some((e) => e.tier === "cur")).toBe(false);
    expect(list.some((e) => e.before)).toBe(false);
  });
});

describe("landmarkLines", () => {
  /**
   * The budget reads four things off the list — how many items, how many
   * headings, whether one of them is current, and whether the level is the arc
   * — so a list of the right shape is enough; no tree, no fixture.
   */
  const list = (
    items: number,
    { groups = 0, current = true, arc = false } = {},
  ): ContextEntry[] =>
    [
      ...Array.from({ length: groups }, () => ({ kind: "group", tier: "far", item: {} })),
      ...Array.from({ length: items }, (_, i) => ({
        kind: "item",
        tier: current && i === 0 ? "cur" : "far",
        item: arc ? { step: { index: i + 1, total: items } } : {},
      })),
    ] as ContextEntry[];

  /**
   * These assertions are deliberately about *shape* rather than about the
   * numbers the constants happen to produce. A test that says
   * `landmarkLines(five, 1200) === 4` re-asserts the arithmetic it is checking
   * and would stay green if every constant were visually wrong — the
   * shared-assumption failure in docs/reusable/silent-success.md, which GPT
   * Sol's review of this change pointed out the first version of these tests
   * was an example of. What can honestly be checked here is that the budget
   * moves the right way, stays inside its bounds, and never returns something
   * a renderer cannot use. Whether four lines actually *fit* is a question
   * about wrapped text at a real width, and is answered in a browser against
   * `data-ctx-lines` — see docs/project/browser-testing.md.
   */
  const CASES = [4, 5, 6, 8, 12, 20, 40];
  const HEIGHTS = [400, 700, 900, 1100, 1300, 1600, 2400];

  it("is a whole number of lines, never negative, never past the cap", () => {
    for (const h of HEIGHTS)
      for (const n of CASES)
        for (const arc of [false, true]) {
          const v = landmarkLines(list(n, { groups: Math.ceil(n / 6), arc }), h);
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(4);
        }
  });

  it("never grows as the level gets longer", () => {
    for (const h of HEIGHTS) {
      const seen = CASES.map((n) => landmarkLines(list(n), h));
      for (const [i, v] of seen.entries()) if (i) expect(v).toBeLessThanOrEqual(seen[i - 1]!);
    }
  });

  it("never shrinks as the panel gets taller", () => {
    for (const n of CASES) {
      const seen = HEIGHTS.map((h) => landmarkLines(list(n), h));
      for (const [i, v] of seen.entries()) if (i) expect(v).toBeGreaterThanOrEqual(seen[i - 1]!);
    }
  });

  it("gives a short level lines and a long one none", () => {
    // The two ends of the ladder, which is the whole point of it: the arc's
    // five parts were the complaint, and forty sections were already fine.
    expect(landmarkLines(list(5), 1200)).toBeGreaterThan(0);
    expect(landmarkLines(list(40, { groups: 6 }), 1200)).toBe(0);
  });

  it("charges headings for the room they take", () => {
    // Same items, more part headings between them: never more generous.
    expect(landmarkLines(list(12, { groups: 6 }), 1200)).toBeLessThanOrEqual(
      landmarkLines(list(12), 1200),
    );
  });

  it("counts every item as a landmark when none of them is current", () => {
    // A level with no item under the focus line (context.ts § currentIndex)
    // has no open entry and one more landmark. It correctly comes out MORE
    // generous, not less — an open entry costs several landmarks' worth of
    // room and there isn't one — and that is the point: such a panel is pinned
    // at scrollTop 0 and cannot be scrolled, so what the budget gets wrong at
    // the foot is gone with nothing to see. What has to hold is that the extra
    // landmark is charged, which shows up as the same downward step with the
    // level's length.
    for (const h of HEIGHTS) {
      const seen = CASES.map((n) => landmarkLines(list(n, { current: false }), h));
      for (const [i, v] of seen.entries()) if (i) expect(v).toBeLessThanOrEqual(seen[i - 1]!);
      expect(landmarkLines(list(9, { current: false }), h)).toBeLessThanOrEqual(
        landmarkLines(list(8, { current: false }), h),
      );
    }
  });

  it("is 0 when nothing on the level is a landmark", () => {
    expect(landmarkLines(list(1), 1200)).toBe(0);
    expect(landmarkLines([], 1200)).toBe(0);
  });
});
