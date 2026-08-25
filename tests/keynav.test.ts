/**
 * Arrow-key navigation — the pure half: which row a keypress lands on, given
 * where the reader is and which level the pointer has aimed at.
 *
 * The keys are ↑ / ↓; `dir` here is -1 for up and 1 for down. The arithmetic is
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
import { itemStarts, stepTarget } from "../src/web/keynav.js";

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
    // The leaf level is one node per block (src/toc.ts grows it that way), so
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
