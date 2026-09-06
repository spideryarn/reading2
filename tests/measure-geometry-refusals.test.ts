/**
 * The judgments `scripts/measure-geometry.ts` makes, without a browser.
 *
 * Every one of these decides whether a number may be quoted, and every one of
 * them is the difference between a measurement and a zero that means nothing.
 * They live in TypeScript rather than inside a `page.evaluate` string precisely
 * so they can be checked here — a branch buried in a browser expression can
 * only be checked by running a browser, and this harness runs for two hours.
 *
 * The mirror of `tests/a-gesture-that-did-nothing-is-not-a-fast-one.test.ts`,
 * which does the same job for the annotation harness.
 */
import { describe, expect, it } from "vitest";

import {
  assertSiteKinds,
  classify,
  droppedFrames,
  LEAF_SITES,
  metricsDelta,
  PARENT_SITES,
  PILOT_SITES,
  pct,
  pilotMs,
  populationVerdict,
  type Attempt,
  type GeometryCost,
  type GeometrySite,
  type GeometryTally,
  type Population,
  type Sample,
  scrollVerdict,
  suspectReason,
  totalReads,
} from "../scripts/measure-geometry.js";

const tally = (over: Partial<GeometryTally> = {}): GeometryTally => ({
  calls: 0,
  reads: 0,
  writes: 0,
  ms: 0,
  samples: [],
  ...over,
});

function cost(over: Partial<Record<GeometrySite, GeometryTally>> = {}): GeometryCost {
  const all = {} as Record<GeometrySite, GeometryTally>;
  for (const s of [...PARENT_SITES, ...LEAF_SITES]) all[s] = tally();
  return { ...all, ...over, mode: "counts" } as GeometryCost;
}

const population = (over: Partial<Population> = {}): Population => ({
  blocks: 2046,
  totalNodes: 50_000,
  gistColumns: [1, 2],
  leafDepth: 3,
  sectionDepth: 2,
  sectionCells: 1237,
  commentMarks: 4,
  tableClass: "zoom reading",
  headCells: [],
  perf: true,
  geometry: true,
  mode: "counts",
  signedInAs: "someone",
  ...over,
});

const sample = (over: Partial<Sample> = {}): Sample => ({
  rep: 1,
  ms: 100,
  cost: cost(),
  metrics: { LayoutCount: 0, LayoutDuration: 0, RecalcStyleCount: 0, RecalcStyleDuration: 0, TaskDuration: 0 },
  frames: [16, 17, 16],
  travelled: 0,
  achievedCadenceMs: 0,
  renders: 3,
  before: "a",
  after: "b",
  ...over,
});

describe("a parent bucket and a leaf bucket are never added together", () => {
  it("keeps the two kinds disjoint, and the pilot inside the parents", () => {
    expect(() => assertSiteKinds()).not.toThrow();
    const leaves = new Set<string>(LEAF_SITES);
    expect(PARENT_SITES.filter((s) => leaves.has(s))).toEqual([]);
    for (const p of PILOT_SITES) expect(PARENT_SITES).toContain(p);
  });

  it("sums only the pilot pair, and does not reach the leaf that runs inside it", () => {
    const c = cost({
      readingPosition: tally({ calls: 10, reads: 12_380, ms: 40 }),
      columnContext: tally({ calls: 10, reads: 12_400, ms: 30 }),
      // Runs *inside* readingPosition's timed interval. Adding it would
      // double-count, and there is no function here that can.
      stickyOffset: tally({ calls: 20, reads: 40, ms: 9 }),
    });
    expect(pilotMs(c)).toBe(70);
  });

  it("sums reads across every site, because reads are exclusive where ms is not", () => {
    const c = cost({
      readingPosition: tally({ calls: 10, reads: 12_370, ms: 40 }),
      columnContext: tally({ calls: 10, reads: 12_400, ms: 30 }),
      stickyOffset: tally({ calls: 20, reads: 40, ms: 9 }),
      safeAreaInsets: tally({ calls: 20, reads: 20 }),
      // The accounting working, not a dead counter: measureRow owns them.
      diagramReaderRow: tally({ calls: 10, reads: 0, ms: 5 }),
      measureRow: tally({ calls: 10, reads: 2046 }),
    });
    expect(totalReads(c)).toBe(12_370 + 12_400 + 40 + 20 + 0 + 2046);
  });

  it("refuses a leaf site at the type level", () => {
    // @ts-expect-error stickyOffset is a leaf; pilotMs takes only pilot parents.
    expect(() => pilotMs(cost(), ["stickyOffset"])).not.toThrow();
    // @ts-expect-error spineMeasure is a parent but not one that may decide.
    expect(() => pilotMs(cost(), ["spineMeasure"])).not.toThrow();
  });
});

describe("the population refusals", () => {
  it("refuses an empty page before it refuses anything else", () => {
    expect(populationVerdict(population({ blocks: 0 }), false)).toMatch(/refusing to time/);
    // And in a baseline run too: a page that did not render is never a
    // calibration either.
    expect(populationVerdict(population({ blocks: 0 }), true)).toMatch(/refusing to time/);
  });

  it("refuses when the geometry instrument is not in the build, and names it", () => {
    const said = populationVerdict(population({ geometry: false }), false);
    expect(said).toMatch(/geometry-cost\.ts/);
    expect(said).toMatch(/no fallback/);
  });

  it("refuses a probe that is present but switched off", () => {
    expect(populationVerdict(population({ mode: "off" }), false)).toMatch(/zero that means nothing/);
  });

  it("asks nothing of the instrument in a baseline run, which has none", () => {
    expect(populationVerdict(population({ perf: false, geometry: false, mode: null }), true)).toBe(
      null,
    );
  });

  it("passes a page that rendered with the instrument live", () => {
    expect(populationVerdict(population(), false)).toBe(null);
  });
});

describe("a repetition that was not the pinned gesture is not a fast one", () => {
  it("fails a scroll that did not move", () => {
    expect(scrollVerdict(0, 3000)).toMatch(/did not move/);
  });

  it("fails a scroll that ran out of article", () => {
    expect(scrollVerdict(1200, 3000)).toMatch(/not the same gesture/);
  });

  it("passes the pinned distance", () => {
    expect(scrollVerdict(3000, 3000)).toBe(null);
  });

  it("distrusts a window in which no frame was served", () => {
    expect(suspectReason(sample({ frames: [] }), 0)).toMatch(/no animation frame/);
  });

  it("distrusts a press nothing rendered for", () => {
    expect(suspectReason(sample({ renders: 0 }), 0)).toMatch(/no React render/);
  });

  it("does not apply the render rule to a scroll, which need not re-render", () => {
    expect(suspectReason(sample({ renders: 0, travelled: 3000 }), 3000)).toBe(null);
  });
});

describe("classify", () => {
  const attempts = (): Attempt[] => [
    sample({ rep: 1 }),
    sample({ rep: 2 }),
    { rep: 3, error: "the declared effect did not occur" },
    sample({ rep: 4, frames: [] }),
    sample({ rep: 5 }),
  ];

  it("counts the warm-up among the confirmed samples, not by repetition number", () => {
    const c = classify(attempts(), 1, 0);
    expect([...c.warmups]).toEqual([1]);
    expect(c.failures.map((f) => f.rep)).toEqual([3]);
    expect([...c.suspect.keys()]).toEqual([4]);
    expect(c.warmed.map((s) => s.rep)).toEqual([2, 5]);
  });

  it("quotes nothing when every repetition is suspect", () => {
    const c = classify([sample({ rep: 1, frames: [] }), sample({ rep: 2, frames: [] })], 1, 0);
    expect(c.warmed).toEqual([]);
  });
});

describe("the statistics", () => {
  it("takes nearest-rank percentiles and NaN for nothing", () => {
    expect(pct([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(pct([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(Number.isNaN(pct([], 50))).toBe(true);
  });

  it("counts a dropped frame against the measured cadence, not against 16.7", () => {
    // A box serving 30Hz drops nothing at 33ms; the same vector at 60Hz does.
    expect(droppedFrames([16, 33, 60], 33)).toBe(1);
    expect(droppedFrames([16, 33, 60], 16.7)).toBe(2);
  });

  it("turns CDP's seconds into milliseconds and leaves the counts alone", () => {
    const d = metricsDelta(
      { LayoutCount: 10, LayoutDuration: 1, RecalcStyleCount: 5, RecalcStyleDuration: 0.5, TaskDuration: 2 },
      { LayoutCount: 14, LayoutDuration: 1.02, RecalcStyleCount: 9, RecalcStyleDuration: 0.51, TaskDuration: 2.3 },
    );
    expect(d.LayoutCount).toBe(4);
    expect(d.RecalcStyleCount).toBe(4);
    expect(d.LayoutDuration).toBeCloseTo(20, 6);
    expect(d.RecalcStyleDuration).toBeCloseTo(10, 6);
    expect(d.TaskDuration).toBeCloseTo(300, 6);
  });
});
