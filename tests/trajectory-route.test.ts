/**
 * **The arithmetic of walking a Trajectory** — src/web/trajectory-route.ts.
 *
 * Every rule here is quoted from the plan's § The mode (client)
 * (docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md), and
 * the depth-change rule most of all: it is the one a reader feels, and the one a
 * plausible implementation gets subtly wrong at the end of a pass.
 */
import { describe, expect, it } from "vitest";
import type { Block, BlockId, TrajectoryStop } from "../src/types.js";
import {
  countAt,
  doorAfter,
  effectiveDepth,
  currentStop,
  offeredDepths,
  positionOf,
  positionsOf,
  stepStop,
  stopAfterDepthChange,
  visibleRoute,
} from "../src/web/trajectory-route.js";

/**
 * The route used throughout, in route order:
 *
 *   route  a1 b3 c2 d1 e3 f2 g1 h3
 *   Gist   a        d        g         → a d g
 *   More   a     c  d     f  g         → a c d f g
 *   Most   a  b  c  d  e  f  g  h      → all eight
 */
const ROUTE: TrajectoryStop[] = [
  { quoteId: "a", depth: 1, role: "The headline result" },
  { quoteId: "b", depth: 3, role: null },
  { quoteId: "c", depth: 2, role: "How they measured it" },
  { quoteId: "d", depth: 1, role: "What earlier work missed" },
  { quoteId: "e", depth: 3, role: null },
  { quoteId: "f", depth: 2, role: "Does it hold outside the lab?" },
  { quoteId: "g", depth: 1, role: "What it means" },
  { quoteId: "h", depth: 3, role: null },
];

const ids = (stops: readonly TrajectoryStop[]) => stops.map((s) => s.quoteId);

describe("the visible route", () => {
  it("shows every stop at or above the depth, in route order", () => {
    expect(ids(visibleRoute(ROUTE, 1))).toEqual(["a", "d", "g"]);
    expect(ids(visibleRoute(ROUTE, 2))).toEqual(["a", "c", "d", "f", "g"]);
    expect(ids(visibleRoute(ROUTE, 3))).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
    expect([countAt(ROUTE, 1), countAt(ROUTE, 2), countAt(ROUTE, 3)]).toEqual([3, 5, 8]);
  });

  it("offers only the depths that add stops", () => {
    expect(offeredDepths(ROUTE)).toEqual([1, 2, 3]);
    /* A short spiral: More adds nothing, so there is no More button. */
    const short: TrajectoryStop[] = [
      { quoteId: "x", depth: 1, role: null },
      { quoteId: "y", depth: 3, role: null },
    ];
    expect(offeredDepths(short)).toEqual([1, 3]);
    expect(offeredDepths([{ quoteId: "x", depth: 1, role: null }])).toEqual([1]);
    expect(offeredDepths([])).toEqual([]);
  });

  it("draws the asked depth if offered, else the deepest offered below it", () => {
    const short: TrajectoryStop[] = [
      { quoteId: "x", depth: 1, role: null },
      { quoteId: "y", depth: 2, role: null },
    ];
    expect(effectiveDepth(ROUTE, null)).toBe(1);
    expect(effectiveDepth(ROUTE, 2)).toBe(2);
    expect(effectiveDepth(short, 3)).toBe(2);
    expect(effectiveDepth([], 2)).toBeNull();
  });

  it("falls back to the first stop when ?stop= names nothing on this pass", () => {
    const gist = visibleRoute(ROUTE, 1);
    expect(currentStop(gist, "d")?.quoteId).toBe("d");
    expect(currentStop(gist, "gone")?.quoteId).toBe("a");
    /* On the route, but not on this pass. */
    expect(currentStop(gist, "b")?.quoteId).toBe("a");
    expect(currentStop(gist, null)?.quoteId).toBe("a");
    expect(currentStop([], "a")).toBeNull();
  });
});

describe("next and previous", () => {
  const more = visibleRoute(ROUTE, 2);

  it("steps one stop along the pass", () => {
    expect(stepStop(more, "c", 1)).toBe("d");
    expect(stepStop(more, "c", -1)).toBe("a");
  });

  it("does not wrap at either end", () => {
    expect(stepStop(more, "g", 1)).toBeNull();
    expect(stepStop(more, "a", -1)).toBeNull();
  });

  it("steps from a stop that is not on this pass to the first", () => {
    expect(stepStop(more, "b", 1)).toBe("a");
    expect(stepStop([], "a", 1)).toBeNull();
  });
});

describe("changing depth", () => {
  it("depth up from the last stop of a pass keeps your place — going round is the door's (plan 260929a)", () => {
    /* g is the last of Gist and of More; every deeper pass still has it. */
    expect(stopAfterDepthChange(ROUTE, 1, 2, "g")).toBe("g");
    expect(stopAfterDepthChange(ROUTE, 2, 3, "g")).toBe("g");
    expect(stopAfterDepthChange(ROUTE, 1, 3, "g")).toBe("g");
  });

  it("depth up from anywhere else stays on the current stop", () => {
    expect(stopAfterDepthChange(ROUTE, 1, 2, "a")).toBe("a");
    expect(stopAfterDepthChange(ROUTE, 1, 3, "d")).toBe("d");
    expect(stopAfterDepthChange(ROUTE, 2, 3, "f")).toBe("f");
  });

  it("depth down stays when the shallower pass has the stop", () => {
    expect(stopAfterDepthChange(ROUTE, 3, 1, "d")).toBe("d");
    expect(stopAfterDepthChange(ROUTE, 3, 2, "c")).toBe("c");
  });

  it("depth down otherwise goes to the nearest earlier stop the shallower pass has", () => {
    /* e is Most only; the nearest earlier stop at depth ≤ 2 is d, at ≤ 1 is d. */
    expect(stopAfterDepthChange(ROUTE, 3, 2, "e")).toBe("d");
    /* f is More; nearest earlier at Gist is d, not the nearer-in-array e. */
    expect(stopAfterDepthChange(ROUTE, 2, 1, "f")).toBe("d");
    /* h: nearest earlier at More is g. */
    expect(stopAfterDepthChange(ROUTE, 3, 2, "h")).toBe("g");
  });

  it("depth down with nothing earlier goes to the shallower pass's first stop", () => {
    const late: TrajectoryStop[] = [
      { quoteId: "p", depth: 3, role: null },
      { quoteId: "q", depth: 1, role: null },
    ];
    expect(stopAfterDepthChange(late, 3, 1, "p")).toBe("q");
  });

  it("depth up past a pass that adds nothing stays put rather than inventing a stop", () => {
    const flat: TrajectoryStop[] = [
      { quoteId: "x", depth: 1, role: null },
      { quoteId: "y", depth: 1, role: null },
    ];
    expect(stopAfterDepthChange(flat, 1, 3, "y")).toBe("y");
  });

  it("lands on the first stop when there is no current stop", () => {
    expect(stopAfterDepthChange(ROUTE, 1, 2, null)).toBe("a");
    expect(stopAfterDepthChange(ROUTE, 1, 2, "gone")).toBe("a");
  });
});

describe("the door after the current stop", () => {
  it("offers the next stop on the pass", () => {
    expect(doorAfter(ROUTE, 1, "a")).toEqual({ kind: "next", quoteId: "d" });
  });

  it("offers stop 1 of the next deeper pass at the end of a pass (51)", () => {
    /* Gist is a d g; More a c d f g; Most is every stop, a first. */
    expect(doorAfter(ROUTE, 1, "g")).toEqual({ kind: "end", deeper: { depth: 2, first: "a" } });
    expect(doorAfter(ROUTE, 2, "g")).toEqual({ kind: "end", deeper: { depth: 3, first: "a" } });
  });

  it("lands More detail on the deeper pass's own first stop when that is new at it", () => {
    const late: TrajectoryStop[] = [
      { quoteId: "p", depth: 2, role: null },
      { quoteId: "q", depth: 1, role: null },
    ];
    expect(doorAfter(late, 1, "q")).toEqual({ kind: "end", deeper: { depth: 2, first: "p" } });
  });

  it("skips a depth that adds nothing when offering more detail", () => {
    const short: TrajectoryStop[] = [
      { quoteId: "x", depth: 1, role: null },
      { quoteId: "y", depth: 3, role: null },
    ];
    expect(doorAfter(short, 1, "x")).toEqual({ kind: "end", deeper: { depth: 3, first: "x" } });
  });

  it("offers no onward action at the end of the deepest pass (51)", () => {
    expect(doorAfter(ROUTE, 3, "h")).toEqual({ kind: "end", deeper: null });
  });

  it("has no door on a pass with no stops", () => {
    expect(doorAfter([], 1, null)).toBeNull();
  });
});

/* Stage 5b: how far through the article each stop sits, for the dot on its row. */
describe("where a stop sits in the article", () => {
  const block = (id: string, words: number): Block =>
    ({ id: id as BlockId, tag: "p", kind: "text", text: "", words, html: "", gistable: true }) as Block;
  /* 10 + 20 + 60 + 10 = 100 words: a short heading-sized block, then prose. */
  const BLOCKS = [block("spya-pa2abc", 10), block("spya-pb3def", 20), block("spya-pc4ghj", 60), block("spya-pd5kmn", 10)];

  it("is the words before the block plus half its own, over the whole", () => {
    expect(positionOf("spya-pa2abc" as BlockId, BLOCKS)).toBeCloseTo(0.05);
    expect(positionOf("spya-pb3def" as BlockId, BLOCKS)).toBeCloseTo(0.2);
    expect(positionOf("spya-pc4ghj" as BlockId, BLOCKS)).toBeCloseTo(0.6);
    expect(positionOf("spya-pd5kmn" as BlockId, BLOCKS)).toBeCloseTo(0.95);
  });

  it("weighs by words, not by block count", () => {
    /* Third of four blocks, but most of the words come before its middle. */
    expect(positionOf("spya-pc4ghj" as BlockId, BLOCKS)).not.toBeCloseTo(2.5 / 4);
  });

  it("is null for a block it cannot find", () => {
    expect(positionOf("spya-zz9zzz" as BlockId, BLOCKS)).toBeNull();
    expect(positionOf("spya-pa2abc" as BlockId, [])).toBeNull();
  });

  it("falls back to the block's middle by count when the article has no words, never NaN (Sol F36)", () => {
    const wordless = [block("spya-pa2abc", 0), block("spya-pb3def", 0), block("spya-pc4ghj", 0), block("spya-pd5kmn", 0)];
    expect(positionOf("spya-pa2abc" as BlockId, wordless)).toBeCloseTo(0.125);
    expect(positionOf("spya-pc4ghj" as BlockId, wordless)).toBeCloseTo(0.625);
    expect(positionOf("spya-pa2abc" as BlockId, [block("spya-pa2abc", 0)])).toBeCloseTo(0.5);
  });

  it("builds every position in one linear pass for the route rows", () => {
    let reads = 0;
    const counted = BLOCKS.map((original) => ({
      ...original,
      get words() {
        reads += 1;
        return original.words;
      },
    }));

    const positions = positionsOf(counted);

    expect([...positions.values()]).toEqual([0.05, 0.2, 0.6, 0.95]);
    expect(reads).toBeLessThanOrEqual(counted.length * 2);
  });
});
