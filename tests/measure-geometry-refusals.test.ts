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
import { describe, expect, it, vi } from "vitest";

import {
  assertSiteKinds,
  classify,
  droppedFrames,
  type Expectation,
  expectationFor,
  FIXED_WORKLOADS,
  frameTagVerdict,
  type GestureRun,
  LEAF_SITES,
  metricsDelta,
  MIN_WARMED_REPETITIONS,
  PARENT_SITES,
  PILOT_SITES,
  pct,
  pilotFrameMs,
  pilotMs,
  pilotMsPerSamplingFrame,
  PINNED_TOLERANCE_PX,
  populationVerdict,
  publicationVerdict,
  report,
  type Attempt,
  type GeometryCost,
  type GeometrySite,
  type GeometryTally,
  type Population,
  type Sample,
  scrollVerdict,
  suspectReason,
  totalReads,
  VIEWPORTS,
} from "../scripts/measure-geometry.js";
import { NO_FRAME } from "../src/web/geometry-cost.js";

const tally = (over: Partial<GeometryTally> = {}): GeometryTally => ({
  calls: 0,
  reads: 0,
  writes: 0,
  ms: 0,
  samples: [],
  frames: [],
  ...over,
});

/**
 * A parent's tally written as the per-frame costs it recorded: `[frameId, ms]`
 * pairs.
 *
 * This way round because every assertion about F11 is about *which frame* a
 * sample belongs to, and two parallel literal arrays are exactly the shape an
 * off-by-one hides in.
 */
const timed = (pairs: readonly (readonly [number, number])[]): GeometryTally =>
  tally({
    calls: pairs.length,
    ms: pairs.reduce((a, [, ms]) => a + ms, 0),
    samples: pairs.map(([, ms]) => ms),
    frames: pairs.map(([f]) => f),
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
  resolvedSections: 1237,
  pathname: "/read/m1-kuhn-spya-a2zrjb",
  docTitle: "The Structure of Scientific Revolutions",
  commentMarks: 4,
  tableClass: "zoom reading",
  headCells: [],
  perf: true,
  geometry: true,
  mode: "counts",
  signedInAs: "someone",
  ...over,
});

/** What the run asked for, so the gate has something to check the page
 *  against. The default is the heavy desktop workload the pilot verdict was
 *  taken on, and every case below changes exactly one thing about it. */
const expected = (over: Partial<Expectation> = {}): Expectation => ({
  slug: "m1-kuhn-spya-a2zrjb",
  requireSections: true,
  fixed: FIXED_WORKLOADS["m1-kuhn-spya-a2zrjb"] ?? null,
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
    expect(populationVerdict(population({ blocks: 0 }), false, expected())).toMatch(/refusing to time/);
    // And in a baseline run too: a page that did not render is never a
    // calibration either.
    expect(populationVerdict(population({ blocks: 0 }), true, expected())).toMatch(/refusing to time/);
  });

  it("refuses when the geometry instrument is not in the build, and names it", () => {
    const said = populationVerdict(population({ geometry: false }), false, expected());
    expect(said).toMatch(/geometry-cost\.ts/);
    expect(said).toMatch(/no fallback/);
  });

  it("refuses a probe that is present but switched off", () => {
    expect(populationVerdict(population({ mode: "off" }), false, expected())).toMatch(/zero that means nothing/);
  });

  it("asks nothing of the instrument in a baseline run, which has none", () => {
    expect(
      populationVerdict(population({ perf: false, geometry: false, mode: null }), true, expected()),
    ).toBe(null);
  });

  it("passes a page that rendered with the instrument live", () => {
    expect(populationVerdict(population(), false, expected())).toBe(null);
  });

  /* ---------------------------------------------------------------- F12 --
     The gate used to refuse only an empty page, a missing instrument and a
     probe switched off. Everything below is a page that would have passed it
     and produced numbers about something other than the workload. */

  it("refuses a page that is not the article the run asked for", () => {
    /* A redirect to another *valid* article renders perfectly, counts blocks,
       runs the samplers, and answers a question nobody asked. The pathname is
       the cheapest thing that can tell them apart, and it was not read at
       all. */
    const elsewhere = population({ pathname: "/read/some-other-article-spya-zzzzzz" });
    const said = populationVerdict(elsewhere, false, expected());
    expect(said).toMatch(/some-other-article-spya-zzzzzz/);
    expect(said).toMatch(/m1-kuhn-spya-a2zrjb/);

    // And in a baseline run: identity is a property of the page, not of the
    // probe, so the calibration is equally void.
    expect(populationVerdict(elsewhere, true, expected())).toMatch(/not the article/i);
  });

  it("refuses a page whose section tree did not render, with the columns on screen", () => {
    /* The F12 case exactly: `readingPosition` still records one call and one
       `scrollY` read per frame with zero sections, so the run reports a
       comfortably cheap pilot for a page that has no section loop to pay for.
       `resolvedSections` comes out of the DOM rather than off the counters, so
       the gate and the thing it gates share no assumption. */
    const said = populationVerdict(
      population({ resolvedSections: 0, sectionCells: 0 }),
      false,
      expected(),
    );
    expect(said).toMatch(/no section rows/i);

    /* The changed-input control: the same page with the tree rendered passes,
       so the refusal above is about the sections and not about something else
       in the fixture. */
    expect(populationVerdict(population(), false, expected())).toBe(null);
  });

  it("refuses a configuration that should have gist columns and has none", () => {
    const said = populationVerdict(population({ gistColumns: [] }), false, expected());
    expect(said).toMatch(/gist column/i);

    /* The control, and it is the whole reason `requireSections` exists: a phone
       or a `plain` run legitimately has no gist columns and no section cells,
       and half the pilot is then a zero that means what it says. Refusing
       those would be the mirror-image error. */
    expect(
      populationVerdict(
        population({ gistColumns: [], sectionCells: 0, resolvedSections: 0 }),
        false,
        expected({ requireSections: false, fixed: null }),
      ),
      "a run with no section column was refused for not having one",
    ).toBe(null);
  });

  it("refuses a fixed workload whose shape is not the one it was named for", () => {
    /* The three articles in the plan are fixed, and their fingerprints have been
       identical across every recorded session. A page claiming to be m1-kuhn
       with a tenth of the sections is not m1-kuhn, whatever the URL says. */
    const thin = populationVerdict(population({ resolvedSections: 120 }), false, expected());
    expect(thin).toMatch(/120/);
    expect(thin).toMatch(/section/i);

    const shallow = populationVerdict(population({ leafDepth: 2 }), false, expected());
    expect(shallow).toMatch(/depth/i);

    const short = populationVerdict(population({ blocks: 300 }), false, expected());
    expect(short).toMatch(/block/i);
  });

  it("asks nothing extra of an article that is not one of the three fixed workloads", () => {
    /* The harness takes a `--slug`, and measuring a fourth article is a
       legitimate thing to do. What it must not do is invent a fingerprint for
       it — only the general checks apply. */
    expect(
      populationVerdict(
        population({ pathname: "/read/whatever-spya-abc123", blocks: 40, resolvedSections: 6 }),
        false,
        expected({ slug: "whatever-spya-abc123", fixed: null }),
      ),
    ).toBe(null);
  });

  it("knows the three fixed workloads, and which configurations must show sections", () => {
    /* The fingerprints are the recorded ones, and the desktop/phone split is
       the observed one: 1,237 section cells and columns [1, 2] on a 1280px
       desktop, and `section cells on screen=0` with no columns at all on a
       390px phone. */
    expect(Object.keys(FIXED_WORKLOADS).sort()).toEqual([
      "evaldeepen-e5aq8o9s-book-spya-yynkqz",
      "m1-kuhn-spya-a2zrjb",
      "replication-crisis-spya-hrjamq",
    ]);

    const desktop = VIEWPORTS.desktop as (typeof VIEWPORTS)[string];
    const phone = VIEWPORTS.phone as (typeof VIEWPORTS)[string];
    const args = { slug: "m1-kuhn-spya-a2zrjb", view: "hierarchy", cols: "auto" };
    expect(expectationFor(args, desktop).requireSections).toBe(true);
    expect(expectationFor(args, phone).requireSections).toBe(false);
    // `plain` empties the gist columns outright (App.tsx § plainCols), so a
    // desktop `plain` run has no section column either.
    expect(expectationFor({ ...args, view: "plain" }, desktop).requireSections).toBe(false);
    // Forced columns put them back, which is how a phone is made to show them.
    expect(expectationFor({ ...args, cols: "1,2" }, phone).requireSections).toBe(true);
    expect(expectationFor(args, desktop).fixed?.leafDepth).toBe(3);
    expect(expectationFor({ ...args, slug: "nobody" }, desktop).fixed).toBe(null);
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

  /* ---------------------------------------------------------------- F13 --
     "Pinned" used to mean "within 20%", which let a 2,400px repetition into
     the median alongside the 3,000px gesture it is not. The recorded logs show
     what the real distribution is: exactly 3000, exactly 2900 where a wheel
     was swallowed, once 2976 — so nothing legitimate needs more slack than
     rounding, and a workload that is not pinned is not a workload. */

  it("refuses a repetition that lost a wheel, however nearly it travelled", () => {
    /* 2,900px is 96.7% of the pinned distance and passed the old gate. It is a
       29-wheel gesture, and a 29-wheel gesture is not a 30-wheel one: it reads
       fewer frames' worth of geometry over a shorter page. */
    expect(scrollVerdict(2900, 3000)).toMatch(/not the same gesture/);
    expect(scrollVerdict(2976, 3000)).toMatch(/not the same gesture/);

    /* And the control that says the tolerance is not simply zero: subpixel
       rounding on a fractional device pixel ratio is real, and refusing a
       2,999.6px repetition would throw away a gesture that did happen. */
    expect(scrollVerdict(3000 - PINNED_TOLERANCE_PX, 3000)).toBe(null);
    expect(scrollVerdict(3000 + PINNED_TOLERANCE_PX, 3000)).toBe(null);
    expect(PINNED_TOLERANCE_PX, "the tolerance is meant to be rounding, not slack").toBeLessThan(2);
  });

  it("refuses a repetition that travelled further than the pinned gesture", () => {
    /* The old rule had no upper bound at all, so momentum or a smooth-scroll
       overshoot could double the distance and still be quoted. */
    expect(scrollVerdict(3400, 3000)).toMatch(/past the pinned/);
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

/* ------------------------------------------------------------------ F11 --
   The distribution the decision rule is applied to.

   The rule says *"the p50 **scroll frame** spends ≥ 4ms in the two pilot
   samplers"*, and Sol's F11 found the harness answering a different question:
   it divided each repetition's total by its call count and took p50/p95 across
   those five **means**. A mean over 200 frames cannot have a p95 — averaging is
   what destroys the sparse expensive frame the rule exists to catch, and the
   published tail was therefore the tail of five averages.

   The samples now carry the rAF timestamp of the frame they ran in, so a frame
   can be reassembled from the two samplers that ran in it. */

describe("the pilot's per-frame vector", () => {
  it("adds the two samplers within one frame and keeps distinct frames apart", () => {
    /* The two sites are separate rAF callbacks on the same scroll and neither
       runs inside the other, so summing them **within a frame** is the one
       addition of `ms` this instrument allows — it is what a frame cost, not a
       parent's interval counted twice. */
    const c = cost({
      readingPosition: timed([
        [101, 8],
        [102, 9],
        [103, 40],
      ]),
      columnContext: timed([
        [101, 2],
        [102, 3],
        [103, 5],
      ]),
    });
    expect(pilotFrameMs(c).sort((a, b) => a - b)).toEqual([10, 12, 45]);
  });

  it("keeps the sparse expensive frame that a mean over repetitions flattened", () => {
    /* Nine ordinary frames and one that cost 40× as much — the shape the whole
       measurement was reshaped around (Sol F6: a median hides the sparse bad
       frame and `longtask` cannot see anything under 50ms). */
    const frames: (readonly [number, number])[] = [];
    for (let i = 0; i < 9; i++) frames.push([i, 1]);
    frames.push([9, 40]);
    const c = cost({ readingPosition: timed(frames), columnContext: timed(frames) });

    const vec = pilotFrameMs(c);
    expect(vec, "one entry per frame, not one per call").toHaveLength(10);
    expect(pct(vec, 95), "the expensive frame did not survive to the p95").toBe(80);

    /* The control, and the finding restated as an assertion: the number the
       report used to publish for this run is under a third of the frame the
       reader actually waited through. If these two ever agree, the vector has
       collapsed back into a mean. */
    const wasPublished = pilotMsPerSamplingFrame(c);
    expect(wasPublished).toBeCloseTo(9.8, 6);
    expect(
      pct(vec, 95),
      "the per-frame p95 has become the per-repetition mean again",
    ).toBeGreaterThan(wasPublished * 2);
  });

  it("treats every call made outside a frame callback as its own frame", () => {
    /* `measure()` at effect setup runs in no frame at all — a column toggle
       reflows every row without the reader scrolling. Two of those are two
       costs, and merging them under one sentinel id would invent a frame that
       never happened and then report it as an expensive one. */
    const c = cost({
      readingPosition: timed([
        [NO_FRAME, 5],
        [NO_FRAME, 7],
      ]),
    });
    expect(pilotFrameMs(c).sort((a, b) => a - b)).toEqual([5, 7]);
  });

  it("refuses to compute a frame vector from a build that does not tag its samples", () => {
    /* An older bundle left in `dist/` publishes `samples` and no `frames`. Every
       number derived from it would look entirely reasonable and would be the
       thing F11 rejected, so it is a refusal rather than a fallback. */
    const untagged = cost({
      readingPosition: tally({ calls: 2, ms: 9, samples: [4, 5], frames: [] }),
    });
    expect(frameTagVerdict([untagged])).toMatch(/frame ids/);
    expect(() => pilotFrameMs(untagged)).toThrow(/frame/i);

    /* The changed-input control: the same shape, tagged, is accepted — so the
       refusal is about the tagging and not about the fixture. */
    expect(
      frameTagVerdict([
        cost({
          readingPosition: timed([
            [1, 4],
            [2, 5],
          ]),
        }),
      ]),
    ).toBe(null);
  });
});

/* ------------------------------------------------------------------ F13 --
   How many repetitions it takes before anything may be published. */

describe("publication needs the repetitions the rule asked for", () => {
  it("refuses below five warmed repetitions, and says how many there were", () => {
    const said = publicationVerdict(4, 6);
    expect(said).toMatch(/\b4\b/);
    expect(said).toMatch(new RegExp(`\\b${MIN_WARMED_REPETITIONS}\\b`));
    expect(publicationVerdict(0, 6)).toMatch(/\b0\b/);

    // The control: the rule is satisfied at five and nothing is refused.
    expect(publicationVerdict(MIN_WARMED_REPETITIONS, 6)).toBe(null);
    expect(publicationVerdict(6, 6)).toBe(null);
  });

  /**
   * And the rule is actually *reached* — a pure verdict nobody calls is the
   * exact silent success this suite exists to catch, and `report` is where the
   * statistics are printed from.
   */
  it("prints no summary for a run that fell short, and does for one that did not", () => {
    const run = (n: number): GestureRun => ({
      key: "scroll-top",
      label: "pinned scroll from the top",
      viewport: "desktop",
      session: 1,
      declared: "the page moves the pinned 3000px",
      wantedPx: 3000,
      population: population(),
      attempts: Array.from({ length: n }, (_, i) =>
        sample({
          rep: i + 1,
          travelled: 3000,
          cost: cost({
            readingPosition: timed([
              [1, 6],
              [2, 7],
            ]),
            columnContext: timed([
              [1, 3],
              [2, 4],
            ]),
          }),
        }),
      ),
    });

    const said: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      said.push(a.join(" "));
    });
    try {
      /* Five attempts, one of them the warm-up: four warmed, which is what
         rejecting the 2,900px repetitions leaves some recorded sessions with. */
      const short = report(run(5), 1, 16.7);
      expect(short, "a four-repetition run was published as if it were the pinned five").toMatch(
        /\b4\b/,
      );
      expect(
        said.some((l) => l.includes("PILOT")),
        "statistics were printed for a run that may not be quoted",
      ).toBe(false);
      /* The raw per-repetition vectors are still printed — refusing to publish
         a median is not refusing to show what was measured. */
      expect(said.some((l) => l.includes("repetition"))).toBe(true);

      said.length = 0;
      const full = report(run(6), 1, 16.7);
      expect(full, "a complete run was refused").toBe(null);
      expect(
        said.some((l) => l.includes("PILOT")),
        "the control did not publish either, so the refusal above proves nothing",
      ).toBe(true);

      /* A stale bundle refuses in a sentence, not a stack trace — and still
         prints the raw table, which is where the reader sees that the samples
         are there and only the frame ids are missing. */
      said.length = 0;
      const stale = report(
        {
          ...run(6),
          attempts: Array.from({ length: 6 }, (_, i) =>
            sample({
              rep: i + 1,
              travelled: 3000,
              cost: cost({
                readingPosition: tally({ calls: 2, ms: 9, samples: [4, 5], frames: [] }),
              }),
            }),
          ),
        },
        1,
        16.7,
      );
      expect(stale, "an untagged build was published as though it were tagged").toMatch(
        /frame ids/,
      );
      expect(said.some((l) => l.includes("PILOT"))).toBe(false);
      expect(said.some((l) => l.includes("repetition"))).toBe(true);
    } finally {
      log.mockRestore();
    }
  });
});
