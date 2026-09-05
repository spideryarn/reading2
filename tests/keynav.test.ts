/**
 * Arrow-key navigation — the pure half: which row a keypress lands on, given
 * where the reader is and which level the pointer has aimed at.
 *
 * The stepping keys are ↑ / ↓; `dir` here is -1 for up and 1 for down. ← / →
 * choose which level they step by, which is the ladder arithmetic at the bottom. The arithmetic is
 * about document order, not about the keyboard, which is why switching the keys
 * from ← / → to ↑ / ↓ changed nothing below.
 *
 * The DOM half (reading the pointer's zone, measuring the current row, the
 * chaining of rapid presses) is not tested here because it needs a real layout;
 * it's covered by hand, per docs/project/browser-testing.md.
 *
 * See docs/project/keyboard.md for what the keys are supposed to mean.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Block, Tree } from "../src/types.js";
import { buildGeometry } from "../src/web/tree.js";
import { itemStarts, navPlan, nextAim, stepTarget } from "../src/web/keynav.js";

const blocks: Block[] = JSON.parse(
  readFileSync("example/blocks.json", "utf8"),
).blocks;
const tree: Tree = JSON.parse(readFileSync("example/tree.json", "utf8"));
const geometry = buildGeometry(tree, blocks);

const startsAt = (depth: number) => itemStarts(geometry.cells[depth] ?? []);

describe("itemStarts", () => {
  it("tiles the article: every level starts at row 0 and ends inside it", () => {
    for (const depth of geometry.columnDepths) {
      const starts = startsAt(depth);
      expect(starts[0]).toBe(0);
      expect(starts[starts.length - 1]).toBeLessThan(blocks.length);
      // Strictly increasing — a repeated start would be an item of zero rows,
      // which the arrows could never leave.
      expect(starts.every((s, i) => i === 0 || s > starts[i - 1]!)).toBe(true);
    }
  });

  it("gets finer as the columns get finer", () => {
    const counts = geometry.columnDepths.map((d) => startsAt(d).length);
    expect(counts[0]).toBe(1); // depth 0 is the whole article, one item
    expect(counts.every((n, i) => i === 0 || n >= counts[i - 1]!)).toBe(true);
    // The leaf level is one node per block (src/hierarchy.ts grows it that way), so
    // over the prose column the arrows step one paragraph at a time.
    expect(startsAt(geometry.leafDepth)).toEqual(blocks.map((_, i) => i));
  });
});

describe("stepTarget", () => {
  const starts = [0, 4, 9, 15];

  it("steps forward one item at a time", () => {
    expect(stepTarget(starts, 0, 1)).toBe(4);
    expect(stepTarget(starts, 4, 1)).toBe(9);
    // Part-way through an item, forward still means the next one.
    expect(stepTarget(starts, 6, 1)).toBe(9);
  });

  // The track-skip rule: ↑ goes to the top of what you are reading first, and
  // only then to the item before it.
  it("goes to the top of the current item before leaving it", () => {
    expect(stepTarget(starts, 6, -1)).toBe(4);
    expect(stepTarget(starts, 4, -1)).toBe(0);
  });

  // Why that rule and not the mirror image: it is what makes the pair
  // reversible, because a forward step always lands on an item's first row.
  it("is reversible — ↓ then ↑ returns you where you were", () => {
    for (const depth of geometry.columnDepths) {
      const s = startsAt(depth);
      for (const row of s) {
        const forward = stepTarget(s, row, 1);
        if (forward === null) continue;
        expect(stepTarget(s, forward, -1)).toBe(row);
      }
    }
  });

  // Nothing to do is reported as nothing, not as a no-op scroll: the caller
  // leaves the keypress to the browser rather than swallowing it.
  it("returns null at the ends of the article", () => {
    expect(stepTarget(starts, 15, 1)).toBeNull();
    expect(stepTarget(starts, 0, -1)).toBeNull();
    expect(stepTarget([], 0, 1)).toBeNull();
    expect(stepTarget([], 0, -1)).toBeNull();
  });

  // Above the first item there is still an item you are in — the same clamp
  // position.ts makes for the reading position.
  it("clamps above the first item rather than reading off the front", () => {
    expect(stepTarget(starts, -3, 1)).toBe(4);
    expect(stepTarget(starts, -3, -1)).toBeNull();
  });

  it("walks the whole of a real column and stops exactly once", () => {
    const s = startsAt(2);
    let row = 0;
    const visited = [row];
    for (;;) {
      const next = stepTarget(s, row, 1);
      if (next === null) break;
      row = next;
      visited.push(row);
    }
    expect(visited).toEqual(s);
  });
});

/* ------------------------------------------------------- ← / →: the aim -- */

describe("navPlan", () => {
  const leaf = geometry.leafDepth;
  const ladder = (columns: number[], showText: boolean) =>
    navPlan(geometry, columns, showText).ladder;

  it("is the columns on screen, coarsest first", () => {
    expect(ladder([1, 2], true)).toEqual([1, 2, leaf]);
  });

  /**
   * **← stops at Parts.** Greg, 2026-08-26: "I need to be able to hit left all
   * the way to be able to select L0 (the Argument), and to be able to hit
   * right all the way to select the Text." Half of that was reversed on
   * 2026-09-05 — "let's get rid of the 'Arg' button and functionality
   * altogether" — and the later instruction wins: there is no L0 column left
   * to select, so the coarse end of the ladder is Parts. The other half stands
   * exactly as it did: → still runs all the way out to the prose.
   *
   * The arc artefact is untouched by this; Outline mode still renders it
   * (docs/project/keyboard.md § Choosing the level without a mouse).
   */
  it("runs from the parts to the prose, and offers no argument rung", () => {
    expect(ladder([0, 1, 2], true)).toEqual([1, 2, leaf]);
  });

  // Depth 0 is one cell spanning the article, so both arrows are dead ends
  // there — which is why a stray `?cols=0` cannot conjure a rung even though
  // the tree still has a root.
  it("drops a column with nothing to step through", () => {
    expect(ladder([0, 1, 2], false)).toEqual([1, 2]);
    expect(navPlan(geometry, [0], false).starts[0]).toEqual([0]);
  });

  // Outline mode: the leaf column is in `columns` already, and the prose is off.
  it("does not invent a prose rung when the prose is hidden", () => {
    expect(ladder([2, leaf], false)).toEqual([2, leaf]);
  });

  // The prose and the leaf column beside it are one paragraph either way, so
  // they are one rung — → must not need two presses to leave them.
  it("gives the prose and the leaf column the same rung", () => {
    expect(ladder([1, leaf], true)).toEqual([1, leaf]);
  });

  // A mode owns the middle band, so there are no gist columns at all.
  it("is the prose alone when a mode has taken the band", () => {
    expect(ladder([], true)).toEqual([leaf]);
  });

  // The pointer can aim at a level the ladder does not carry — the spine is L1
  // whether or not the Parts column survived the fit — so the rows are kept for
  // every level, not just the rungs.
  it("keeps rows for levels that are off the ladder", () => {
    const plan = navPlan(geometry, [], true);
    expect(plan.ladder).toEqual([leaf]);
    expect(plan.starts[1]).toEqual(itemStarts(geometry.cells[1] ?? []));
  });
});

describe("nextAim", () => {
  const ladder = [1, 2, 5];

  it("moves one column at a time", () => {
    expect(nextAim(ladder, 1, 1)).toBe(2);
    expect(nextAim(ladder, 2, 1)).toBe(5);
    expect(nextAim(ladder, 5, -1)).toBe(2);
  });

  // Null rather than wrapping, so the caller can hand the key back to the
  // browser and ← / → still pan a table wider than the window.
  it("returns null at the ends rather than wrapping", () => {
    expect(nextAim(ladder, 1, -1)).toBeNull();
    expect(nextAim(ladder, 5, 1)).toBeNull();
    expect(nextAim([], 2, 1)).toBeNull();
    expect(nextAim([2], 2, 1)).toBeNull();
  });

  // The pointer can be aiming at a level with no column — the spine is L1 even
  // when the Parts column has been dropped — so an off-ladder aim sits between
  // rungs and the key takes the one on its side.
  it("steps to the neighbour when the aim is not on the ladder", () => {
    expect(nextAim(ladder, 3, 1)).toBe(5);
    expect(nextAim(ladder, 3, -1)).toBe(2);
    expect(nextAim(ladder, 0, 1)).toBe(1);
    expect(nextAim(ladder, 0, -1)).toBeNull();
    expect(nextAim(ladder, 9, -1)).toBe(5);
    expect(nextAim(ladder, 9, 1)).toBeNull();
  });

  it("walks the ladder end to end and stops exactly once", () => {
    const seen = [ladder[0]!];
    for (;;) {
      const next = nextAim(ladder, seen[seen.length - 1]!, 1);
      if (next === null) break;
      seen.push(next);
    }
    expect(seen).toEqual(ladder);
  });
});
