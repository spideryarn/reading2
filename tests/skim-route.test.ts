/**
 * **The arithmetic of walking a Skim** — src/web/skim-route.ts.
 *
 * The rules were first quoted from the plan's § The mode (client)
 * (docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md);
 * since plan 260929e each pass is the stops first placed at its depth — and,
 * since plan 261003l (spya-ms9d69), any shallower stop the route carries into it
 * with `again`. A route with no `again`, which is every route before `skim/9`,
 * still never walks the reader through a stop a shallower pass already did.
 */
import { describe, expect, it } from "vitest";
import type { Block, BlockId, SkimDepth, SkimFigureStop, SkimStop } from "../src/types.js";
import {
  doorAfter as doorAfterWalk,
  effectiveDepth,
  firstStopOf as firstStopOfWalk,
  locate as locateWalk,
  offeredDepths,
  passCount,
  passRoute,
  positionOf,
  positionsOf,
  stepStop as stepStopWalk,
  walkedIn,
  type WalkStop,
  walkOf,
} from "../src/web/skim-route.js";

/* The walk is over `WalkStop`s since plan 261017d; these quote-only routes go
   through `walkOf`, which keys each stop by its quote id. */
const locate = (stops: readonly SkimStop[], ...rest: [SkimDepth | null, string | null]) => locateWalk(walkOf(stops), ...rest);
const stepStop = (stops: readonly SkimStop[], ...rest: [string | null, -1 | 1]) => stepStopWalk(walkOf(stops), ...rest);
const firstStopOf = (stops: readonly SkimStop[], depth: SkimDepth) => firstStopOfWalk(walkOf(stops), depth);
const doorAfter = (stops: readonly SkimStop[], ...rest: [SkimDepth, string | null]) => doorAfterWalk(walkOf(stops), ...rest);

/**
 * The route used throughout, in route order:
 *
 *   route  a1 b3 c2 d1 e3 f2 g1 h3
 *   Gist   a        d        g         → a d g
 *   More         c        f            → c f
 *   Most      b        e        h      → b e h
 *
 * **Each pass is only its own stops** (plan 260929e, SPIDERYARN-READING2-4P):
 * a reader who has walked Gist is not walked through a, d and g again at More.
 */
const ROUTE: SkimStop[] = [
  { quoteId: "a", depth: 1, role: "The headline result" },
  { quoteId: "b", depth: 3, role: null },
  { quoteId: "c", depth: 2, role: "How they measured it" },
  { quoteId: "d", depth: 1, role: "What earlier work missed" },
  { quoteId: "e", depth: 3, role: null },
  { quoteId: "f", depth: 2, role: "Does it hold outside the lab?" },
  { quoteId: "g", depth: 1, role: "What it means" },
  { quoteId: "h", depth: 3, role: null },
];

const ids = (stops: readonly (SkimStop | WalkStop)[]) => stops.map((s) => ("key" in s ? s.key : s.quoteId));
const stop = (quoteId: string, depth: 1 | 2 | 3): SkimStop => ({ quoteId, depth, role: null });

describe("a pass", () => {
  it("is only the stops with exactly that depth, in route order", () => {
    expect(ids(passRoute(ROUTE, 1))).toEqual(["a", "d", "g"]);
    expect(ids(passRoute(ROUTE, 2))).toEqual(["c", "f"]);
    expect(ids(passRoute(ROUTE, 3))).toEqual(["b", "e", "h"]);
    expect([passCount(ROUTE, 1), passCount(ROUTE, 2), passCount(ROUTE, 3)]).toEqual([3, 2, 3]);
  });

  it("never walks a stop twice across the three passes, on a route with no `again`", () => {
    const walked = ([1, 2, 3] as const).flatMap((d) => ids(passRoute(ROUTE, d)));
    expect(new Set(walked).size).toBe(walked.length);
    expect(walked).toHaveLength(ROUTE.length);
  });

  it("offers every depth that has a stop, even when a deeper pass is no bigger (Sol F1)", () => {
    expect(offeredDepths(ROUTE)).toEqual([1, 2, 3]);
    /* 2 / 2 / 4 — a real route's pass sizes; More must not vanish for being no bigger. */
    const equal = [stop("a", 1), stop("b", 2), stop("c", 1), stop("d", 2), stop("e", 3), stop("f", 3), stop("g", 3), stop("h", 3)];
    expect(offeredDepths(equal)).toEqual([1, 2, 3]);
    /* Shrinking: 3 / 2 / 1. */
    const shrinking = [stop("a", 1), stop("b", 1), stop("c", 1), stop("d", 2), stop("e", 2), stop("f", 3)];
    expect(offeredDepths(shrinking)).toEqual([1, 2, 3]);
    expect(offeredDepths([stop("x", 1), stop("y", 3)])).toEqual([1, 3]);
    expect(offeredDepths([stop("x", 1)])).toEqual([1]);
    expect(offeredDepths([])).toEqual([]);
  });

  it("draws the asked depth if offered, else the deepest offered below it", () => {
    const short = [stop("x", 1), stop("y", 2)];
    expect(effectiveDepth(ROUTE, null)).toBe(1);
    expect(effectiveDepth(ROUTE, 2)).toBe(2);
    expect(effectiveDepth(short, 3)).toBe(2);
    expect(effectiveDepth([stop("x", 1), stop("y", 3)], 2)).toBe(1);
    expect(effectiveDepth([], 2)).toBeNull();
  });
});

/**
 * The same route, with two stops carried into deeper passes (plan 261003l,
 * spya-ms9d69):
 *
 *   route  a1+2 b3 c2 d1 e3 f2+3 g1 h3
 *   Gist   a          d          g      → a d g
 *   More   a       c        f           → a c f
 *   Most        b        e  f       h   → b e f h
 */
const SHARED: SkimStop[] = ROUTE.map((s) =>
  s.quoteId === "a" ? { ...s, again: [2] } : s.quoteId === "f" ? { ...s, again: [3] } : s,
);

describe("a stop carried into a deeper pass (261003l)", () => {
  it("is walked in its own pass and in each pass `again` names", () => {
    const a = SHARED[0]!;
    expect([walkedIn(SHARED, a, 1), walkedIn(SHARED, a, 2), walkedIn(SHARED, a, 3)]).toEqual([true, true, false]);
    const d = SHARED[3]!;
    expect([walkedIn(SHARED, d, 1), walkedIn(SHARED, d, 2), walkedIn(SHARED, d, 3)]).toEqual([true, false, false]);
  });

  it("keeps its one place in the route order in every pass it is in", () => {
    expect(ids(passRoute(SHARED, 1))).toEqual(["a", "d", "g"]);
    expect(ids(passRoute(SHARED, 2))).toEqual(["a", "c", "f"]);
    expect(ids(passRoute(SHARED, 3))).toEqual(["b", "e", "f", "h"]);
    expect([passCount(SHARED, 1), passCount(SHARED, 2), passCount(SHARED, 3)]).toEqual([3, 3, 4]);
  });

  it("can be stop 1 of the deeper pass", () => {
    expect(firstStopOf(SHARED, 2)).toBe("a");
    expect(firstStopOf(SHARED, 3)).toBe("b");
  });

  it("does not make a depth offered: only a stop first placed there does (Sol F1)", () => {
    /* One Gist stop carried into More, and no More stop of its own: More would
       be the same one stop again, so it is not offered and not walked. */
    const one: SkimStop[] = [{ ...stop("x", 1), again: [2] }];
    expect(offeredDepths(one)).toEqual([1]);
    expect(walkedIn(one, one[0]!, 2)).toBe(false);
    expect(passRoute(one, 2)).toEqual([]);
    expect(passCount(one, 2)).toBe(0);
    expect(firstStopOf(one, 2)).toBeNull();
    expect(effectiveDepth(one, 2)).toBe(1);
    expect(doorAfter(one, 1, "x")).toEqual({ kind: "end", deeper: null });
    /* The same for a skipped depth between two offered ones. */
    const gap: SkimStop[] = [{ ...stop("x", 1), again: [2, 3] }, stop("y", 3)];
    expect(offeredDepths(gap)).toEqual([1, 3]);
    expect(ids(passRoute(gap, 2))).toEqual([]);
    expect(ids(passRoute(gap, 3))).toEqual(["x", "y"]);
  });

  it("leaves a route with no `again` walking exactly as before", () => {
    for (const d of [1, 2, 3] as const) {
      expect(ids(passRoute(ROUTE, d))).toEqual(ids(ROUTE.filter((s) => s.depth === d)));
      expect(passCount(ROUTE, d)).toBe(ROUTE.filter((s) => s.depth === d).length);
    }
    const empty = ROUTE.map((s) => ({ ...s, again: [] }));
    expect(ids(passRoute(empty, 2))).toEqual(["c", "f"]);
  });

  describe("in a link (Sol F5)", () => {
    it("draws the asked depth when the stop is walked there", () => {
      const at = locate(SHARED, 2, "a");
      expect(at.depth).toBe(2);
      expect(ids(at.route)).toEqual(["a", "c", "f"]);
      expect(at.current?.key).toBe("a");
      /* The object the pass holds, so the band can find its position in it. */
      expect(at.route.indexOf(at.current!)).toBe(0);
      expect(locate(SHARED, 3, "f").depth).toBe(3);
    });

    it("draws the stop's own depth when the asked depth does not walk it", () => {
      const at = locate(SHARED, 3, "a");
      expect(at.depth).toBe(1);
      expect(ids(at.route)).toEqual(["a", "d", "g"]);
      expect(at.current?.key).toBe("a");
      expect(locate(SHARED, 1, "f").depth).toBe(2);
    });

    it("draws the stop's own depth when no depth is asked", () => {
      expect(locate(SHARED, null, "a").depth).toBe(1);
      expect(locate(SHARED, null, "f").depth).toBe(2);
    });
  });

  it("the door at the end of Gist leads to it when it is stop 1 of More", () => {
    expect(doorAfter(SHARED, 1, "g")).toEqual({ kind: "end", deeper: { depth: 2, first: "a" } });
    /* Standing on it in More, the door is the next stop of More. */
    expect(doorAfter(SHARED, 2, "a")).toEqual({ kind: "next", key: "c" });
    expect(doorAfter(SHARED, 2, "f")).toEqual({ kind: "end", deeper: { depth: 3, first: "b" } });
    /* A one-stop Gist whose stop is carried and first in More: *More detail ›*
       lands on the stop the reader is standing at. */
    const carried: SkimStop[] = [{ ...stop("x", 1), again: [2] }, stop("y", 2)];
    expect(doorAfter(carried, 1, "x")).toEqual({ kind: "end", deeper: { depth: 2, first: "x" } });
    expect(doorAfter(carried, 2, "x")).toEqual({ kind: "next", key: "y" });
  });
});

describe("where the reader is (Sol F4)", () => {
  it("a link's stop wins over its depth: a pass the stop is not walked in gives way to its own", () => {
    /* ?depth=2&stop=d — d is a Gist stop, as links from before 260929e can say. */
    const at = locate(ROUTE, 2, "d");
    expect(at.depth).toBe(1);
    expect(ids(at.route)).toEqual(["a", "d", "g"]);
    expect(at.current?.key).toBe("d");
    expect(locate(ROUTE, 1, "h").depth).toBe(3);
  });

  it("with a stop on the asked pass, is exactly that", () => {
    const at = locate(ROUTE, 2, "f");
    expect(at.depth).toBe(2);
    expect(at.current?.key).toBe("f");
  });

  it("with no stop, or one on no pass, is the asked depth's first stop", () => {
    expect(locate(ROUTE, 2, null).current?.key).toBe("c");
    const gone = locate(ROUTE, 3, "gone");
    expect(gone.depth).toBe(3);
    expect(gone.current?.key).toBe("b");
    expect(locate(ROUTE, null, null).current?.key).toBe("a");
  });

  it("with no route, is nowhere", () => {
    expect(locate([], 2, "a")).toEqual({ depth: null, route: [], current: null });
  });
});

describe("next and previous", () => {
  const more = passRoute(ROUTE, 2);

  it("steps one stop along the pass, skipping the shallower pass's stops", () => {
    expect(stepStop(more, "c", 1)).toBe("f");
    expect(stepStop(more, "f", -1)).toBe("c");
  });

  it("does not wrap at either end", () => {
    expect(stepStop(more, "f", 1)).toBeNull();
    expect(stepStop(more, "c", -1)).toBeNull();
  });

  it("steps from a stop that is not on this pass to the first", () => {
    expect(stepStop(more, "b", 1)).toBe("c");
    expect(stepStop([], "a", 1)).toBeNull();
  });
});

describe("changing depth", () => {
  it("lands on stop 1 of the new pass, either way (plan 260929e)", () => {
    expect(firstStopOf(ROUTE, 2)).toBe("c");
    expect(firstStopOf(ROUTE, 3)).toBe("b");
    expect(firstStopOf(ROUTE, 1)).toBe("a");
  });

  it("is null for a pass with no stops", () => {
    expect(firstStopOf([stop("x", 1)], 2)).toBeNull();
  });
});

describe("the door after the current stop", () => {
  it("offers the next stop on the pass", () => {
    expect(doorAfter(ROUTE, 1, "a")).toEqual({ kind: "next", key: "d" });
    expect(doorAfter(ROUTE, 2, "c")).toEqual({ kind: "next", key: "f" });
  });

  it("offers stop 1 of the next deeper pass at the end of a pass — on a route with no `again`, a stop not walked yet", () => {
    expect(doorAfter(ROUTE, 1, "g")).toEqual({ kind: "end", deeper: { depth: 2, first: "c" } });
    expect(doorAfter(ROUTE, 2, "f")).toEqual({ kind: "end", deeper: { depth: 3, first: "b" } });
  });

  it("skips a depth with no stops when offering more detail", () => {
    const short = [stop("x", 1), stop("y", 3)];
    expect(doorAfter(short, 1, "x")).toEqual({ kind: "end", deeper: { depth: 3, first: "y" } });
  });

  it("offers More detail even when the deeper pass is smaller (Sol F1)", () => {
    const shrinking = [stop("a", 1), stop("b", 1), stop("c", 1), stop("d", 2)];
    expect(doorAfter(shrinking, 1, "c")).toEqual({ kind: "end", deeper: { depth: 2, first: "d" } });
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

/**
 * **Figure stops** (plan 261017d; Greg's 1B to q-z27hq2): a figure is a stop of
 * its own, between quotes, walked in one pass and counted in its length.
 * Stored beside the quotes (`Skim.figures`) and merged into one walk by
 * `walkOf`, keyed by its block id.
 */
describe("a route with figures", () => {
  const fig = (blockId: string, depth: 1 | 2 | 3, after: string | null): SkimFigureStop => ({
    blockId: blockId as BlockId,
    depth,
    cue: null,
    after,
  });
  const keys = (stops: readonly WalkStop[]) => stops.map((s) => s.key);

  it("places each figure straight after its anchor, and an unanchored one first", () => {
    const walk = walkOf(ROUTE, [fig("F1", 1, "d"), fig("F0", 3, null), fig("F2", 2, "d")]);
    expect(keys(walk)).toEqual(["F0", "a", "b", "c", "d", "F1", "F2", "e", "f", "g", "h"]);
    expect(walk.find((s) => s.key === "F1")?.kind).toBe("figure");
  });

  it("walks a figure in its own pass, counted in that pass's length, and never carried", () => {
    const walk = walkOf(ROUTE, [fig("F1", 1, "d"), fig("F2", 2, "d")]);
    expect(keys(passRoute(walk, 1))).toEqual(["a", "d", "F1", "g"]);
    expect(keys(passRoute(walk, 2))).toEqual(["c", "F2", "f"]);
    expect([passCount(walk, 1), passCount(walk, 2), passCount(walk, 3)]).toEqual([4, 3, 3]);
  });

  it("never makes a pass: a figure at a depth no quote is at is left out", () => {
    const gistOnly = [stop("a", 1), stop("b", 1)];
    const walk = walkOf(gistOnly, [fig("F1", 2, "a")]);
    expect(keys(walk)).toEqual(["a", "b"]);
    expect(offeredDepths(walkOf(gistOnly))).toEqual([1]);
    /* And `offeredDepths` itself does not count a figure, whatever it is handed. */
    expect(offeredDepths([{ depth: 1 }, { depth: 2, kind: "figure" }])).toEqual([1]);
  });

  it("leaves out a figure whose anchor is not on the route, a repeat, and one whose block id is a quote's (Sol F7)", () => {
    const walk = walkOf(ROUTE, [fig("F1", 1, "gone"), fig("F2", 1, "a"), fig("F2", 1, "d"), fig("c", 1, "a")]);
    expect(keys(walk)).toEqual(["a", "F2", "b", "c", "d", "e", "f", "g", "h"]);
  });

  it("is located, stepped to and offered by the door by its key", () => {
    const walk = walkOf(ROUTE, [fig("F1", 1, "d")]);
    const at = locateWalk(walk, null, "F1");
    expect(at.depth).toBe(1);
    expect(at.current?.kind).toBe("figure");
    expect(keys(at.route)).toEqual(["a", "d", "F1", "g"]);
    expect(stepStopWalk(at.route, "F1", 1)).toBe("g");
    expect(stepStopWalk(at.route, "F1", -1)).toBe("d");
    expect(doorAfterWalk(walk, 1, "d")).toEqual({ kind: "next", key: "F1" });
  });

  it("can be the first stop of a pass, which a change of pass lands on", () => {
    const walk = walkOf(ROUTE, [fig("F0", 2, null)]);
    expect(firstStopOfWalk(walk, 2)).toBe("F0");
    expect(doorAfterWalk(walk, 1, "g")).toEqual({ kind: "end", deeper: { depth: 2, first: "F0" } });
  });

  it("leaves a route with no figures walking exactly as before", () => {
    expect(walkOf(ROUTE, [])).toEqual(walkOf(ROUTE));
    expect(keys(walkOf(ROUTE))).toEqual(ids(ROUTE));
  });
});
