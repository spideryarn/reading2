// @vitest-environment jsdom
/**
 * **The geometry instrument has to be provably off, provably on, and provably
 * in the middle state.**
 *
 * src/web/geometry-cost.ts exists to decide one branch — whether the reading
 * view's duplicated per-frame layout reads are worth building a shared-snapshot
 * service for, or whether Stage 1 of
 * docs/plans/260906d-share-measured-geometry-after-profiling-scroll-and-layout-reads.md
 * closes as **deferred with evidence**. Defer is a legitimate outcome, which is
 * exactly what makes a silently dead counter dangerous: ten zeroed tallies is
 * the shape of "geometry is cheap, close the job" *and* the shape of "nobody
 * wired the probe up", and only a paired control tells them apart.
 *
 * Its failure modes are mirror images and all of them are quiet:
 *
 * - a probe that never switched on reports zeroes, and zeroes read as "defer";
 * - a probe that cannot be switched off is permanent instrumentation in code
 *   that runs on every scroll frame, and is then part of what it measures
 *   (perf.ts makes the same argument for the globals it does patch);
 * - `"counts"` — the mode the 4ms/8ms/10% rule is applied to — is *defined* by
 *   three zeroed leaf timers, which is indistinguishable from a probe that
 *   cannot time anything unless the leaf **counts** are checked beside them;
 * - and a read count that is quietly one-per-call where the code loops over a
 *   thousand rows reports a comfortable number for the wrong reason.
 *
 * So every assertion here is paired: a zero is believed only next to a nonzero
 * control taken from the *same* calls, and every count is exact rather than
 * "greater than zero", because an inequality is what an undercounting probe
 * passes. docs/reusable/silent-success.md.
 *
 * jsdom, and a fake table, because the three leaves and the two `Spine`
 * parents are real DOM code — the point is to drive the shipped functions
 * rather than a re-implementation of them, so that a `noteGeometry` dropped in
 * a merge goes red here.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* The other probe, mocked rather than started — starting it patches timers, rAF
   and fetch globally, and it is also the thing that switches *this* probe on in
   a browser, so a test that started it would be measuring its own scaffolding.
   Copied from tests/spine-scroll.test.ts. */
vi.mock("../src/web/perf.js", () => ({
  useRenderCount: () => {},
  mark: (_l: string, fn: () => unknown) => fn(),
}));

/* Floating UI does real geometry and is not what is under test. */
vi.mock("../src/web/Tooltip.js", () => ({
  Tooltip: ({ children }: { children: unknown }) => children,
  TooltipGroup: ({ children }: { children: unknown }) => children,
}));

import {
  geometryCost,
  type GeometryCost,
  GEOMETRY_LEAVES,
  type GeometrySite,
  resetGeometryCost,
  setGeometryCostMode,
  startGeometryCost,
  stopGeometryCost,
} from "../src/web/geometry-cost.js";
import { measureRow } from "../src/web/keynav.js";
import type { Section } from "../src/web/position.js";
import { stickyOffset, watchBarVisibility } from "../src/web/scroll.js";
import { Spine } from "../src/web/Spine.js";
import { useColumnContext } from "../src/web/useColumnContext.js";
import type { OutlineEntry } from "../src/web/tree.js";
import type { NodeId, TreeNode } from "../src/types.js";

/** Every site the snapshot carries, so a new one cannot be left unasserted. */
const SITES: GeometrySite[] = [
  "readingPosition",
  "columnContext",
  "diagramReaderRow",
  "contextPanelPlace",
  "spineMeasure",
  "spineApply",
  "barVisibility",
  "stickyOffset",
  "safeAreaInsets",
  "measureRow",
];

/** Rows are 100px tall and stacked; that is the whole geometry this needs.
 *  As tests/spine-scroll.test.ts. */
const ROWS = 20;
const ROW_H = 100;

/** How many times the leaf driver reaches each leaf. */
const ROUNDS = 4;

/**
 * The three leaf sites, exercised through the real functions — and with **no
 * assertion inside**, so the window can be watched by a `performance.now` spy
 * without vitest's own machinery landing in the count. The guard lives in
 * `callTheLeaves` below, outside that window.
 *
 * `measureRow` calls `stickyOffset`, which calls `safeAreaInsets`, so one round
 * reaches all three. That nesting is the point: it is what the exclusive read
 * accounting has to get right.
 */
function doTheLeafWork(): number[] {
  const rows: number[] = [];
  for (let i = 0; i < ROUNDS; i++) rows.push(measureRow());
  return rows;
}

/** `doTheLeafWork`, with the guard that says it exercised anything at all. */
function callTheLeaves(): void {
  const rows = doTheLeafWork();
  expect(rows, "measureRow did not run ROUNDS times, so this exercises nothing").toHaveLength(
    ROUNDS,
  );
  expect(
    rows.every((r) => Number.isInteger(r)),
    "measureRow returned something that is not a row index — the fixture table is wrong",
  ).toBe(true);
}

/** Every site's numbers, flattened for a whole-snapshot assertion. */
function totals(cost: GeometryCost): { calls: number; reads: number; writes: number; ms: number } {
  /* Summed only to say "nothing at all moved" / "something moved". The header of
     geometry-cost.ts is emphatic that `ms` is inclusive and is not a duration
     when summed — it is not used as one anywhere here. */
  let calls = 0;
  let reads = 0;
  let writes = 0;
  let ms = 0;
  for (const site of SITES) {
    calls += cost[site].calls;
    reads += cost[site].reads;
    writes += cost[site].writes;
    ms += cost[site].ms;
  }
  return { calls, reads, writes, ms };
}

/** The invariants every tally must satisfy in every mode. */
function tallyIsSane(cost: GeometryCost, site: GeometrySite): void {
  const t = cost[site];
  expect(Number.isFinite(t.ms), `${site} accumulated a non-finite ms`).toBe(true);
  expect(t.ms, `${site} accumulated negative time`).toBeGreaterThanOrEqual(0);
  expect(t.reads, `${site} recorded negative reads`).toBeGreaterThanOrEqual(0);
  /* One sample per timed call, so a site can never hold more samples than it
     had calls — and the samples must add up to the total, or `ms` and the
     percentiles the harness takes would be describing different runs. */
  expect(t.samples.length, `${site} has more samples than calls`).toBeLessThanOrEqual(t.calls);
  const summed = t.samples.reduce((a, b) => a + b, 0);
  expect(summed, `${site}: the samples do not add up to ms`).toBeCloseTo(t.ms, 6);
}

/**
 * A clock that only ever goes forward, by one whole millisecond per reading.
 *
 * Wall-clock assertions would be a machine-speed lottery: a timer that never
 * started and one that finished in under a microsecond both round to the same
 * "not negative". With this installed, any interval that read the clock at
 * *both* ends is a positive whole number of ms, and an interval that started at
 * `NO_GEOMETRY_CLOCK` is still exactly zero. That is the difference the mode
 * gate turns on, and it is why the assertions below are exact rather than
 * `toBeGreaterThanOrEqual(0)` — which is what a broken timer passes.
 */
function stepClock(): () => void {
  let t = 1000;
  const spy = vi.spyOn(performance, "now").mockImplementation(() => {
    t += 1;
    return t;
  });
  return () => spy.mockRestore();
}

class FakeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Build the fixture table. `n` rows of `ROW_H`, plus the controls bar that
 *  `stickyOffset` looks for. */
function buildTable(n: number): void {
  document.body.innerHTML = "";
  const bar = document.createElement("div");
  bar.className = "controls";
  document.body.append(bar);

  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  for (let i = 0; i < n; i++) {
    const tr = document.createElement("tr");
    tr.setAttribute("data-block", `b${i}`);
    tbody.append(tr);
  }
  table.append(tbody);
  document.body.append(table);
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
  /* Vitest's jsdom does not run with `pretendToBeVisual`, so there is no
     `requestAnimationFrame` — and every sampler here debounces through one. A
     macrotask stand-in keeps the ordering while making it deterministic.
     tests/spine-scroll.test.ts. */
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (
    cb: (t: number) => void,
  ) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
  (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = (id: number) =>
    clearTimeout(id);

  buildTable(ROWS);

  /* jsdom gives every element a zero rect, which would make the document
     zero-height and the maths meaningless. Each row reports where it would be
     if the page really were `ROWS * ROW_H` tall, relative to the current
     scroll — which is what makes scrolling observable at all. */
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLElement) {
      const block = this.getAttribute("data-block");
      if (!block) return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
      const i = Number(block.slice(1));
      const top = i * ROW_H - window.scrollY;
      return { top, bottom: top + ROW_H, left: 0, right: 0, width: 0, height: ROW_H };
    },
  });
  Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 500, writable: true, configurable: true });

  stopGeometryCost();
  resetGeometryCost();
});

afterEach(() => {
  vi.restoreAllMocks();
  stopGeometryCost();
  resetGeometryCost();
});

/* ------------------------------------------------------- off, on, reset -- */

it("records nothing at all while it is off", () => {
  callTheLeaves();
  const off = geometryCost();
  expect(off.mode, "the probe must start off — a reader pays for it otherwise").toBe("off");
  for (const site of SITES) {
    expect(off[site], `${site} must be untouched while the probe is off`).toEqual({
      calls: 0,
      reads: 0,
      writes: 0,
      ms: 0,
      samples: [],
    });
  }

  /* The control that makes those zeroes mean something. Identical calls, probe
     on: if these were also zero the block above would have proved nothing. */
  startGeometryCost("full");
  callTheLeaves();
  const on = geometryCost();
  for (const site of GEOMETRY_LEAVES) {
    expect(on[site].calls, `${site} was never counted — the probe is wired up wrong`).toBe(ROUNDS);
    expect(on[site].reads, `${site} counted no reads`).toBeGreaterThan(0);
    tallyIsSane(on, site);
  }
});

it("stops recording again, and reset returns it to zero without switching it off", () => {
  startGeometryCost("full");
  callTheLeaves();
  const running = totals(geometryCost());
  expect(running.calls, "nothing was counted, so nothing is being tested").toBeGreaterThan(0);
  expect(running.reads, "no reads were counted, so nothing is being tested").toBeGreaterThan(0);

  resetGeometryCost();
  const cleared = geometryCost();
  expect(totals(cleared)).toEqual({ calls: 0, reads: 0, writes: 0, ms: 0 });
  for (const site of SITES) {
    expect(cleared[site].samples, `${site} kept its samples through a reset`).toEqual([]);
  }
  expect(cleared.mode, "reset must not switch the probe off — that is stop's job").toBe("full");

  /* And the control for that zero: the same calls still count, so `reset`
     cleared the counters rather than breaking them. */
  callTheLeaves();
  expect(totals(geometryCost()).calls, "nothing counted after a reset").toBe(running.calls);

  stopGeometryCost();
  callTheLeaves();
  const after = geometryCost();
  expect(after.mode).toBe("off");
  expect(totals(after), "calls after stop were still counted").toEqual({
    calls: 0,
    reads: 0,
    writes: 0,
    ms: 0,
  });
});

it("zeroes the counters when the mode changes, and not when it is merely restated", () => {
  startGeometryCost("full");
  callTheLeaves();
  const running = totals(geometryCost());
  expect(running.calls, "nothing was counted, so nothing is being tested").toBeGreaterThan(0);

  startGeometryCost("full");
  expect(totals(geometryCost()), "re-starting the same mode wiped a run").toEqual(running);
  setGeometryCostMode("full");
  expect(totals(geometryCost()), "re-setting the same mode wiped a run").toEqual(running);

  /* A real change zeroes them, so `"counts"` can never report leaf totals
     accumulated while the leaf timers were on. */
  setGeometryCostMode("counts");
  const switched = geometryCost();
  expect(switched.mode).toBe("counts");
  expect(totals(switched), '"counts" inherited samples taken in "full"').toEqual({
    calls: 0,
    reads: 0,
    writes: 0,
    ms: 0,
  });
});

/* ----------------------------------------------------------- the gate ---- */

it("counts the leaves without timing them in the mode the decision is made in", () => {
  const realClock = stepClock();
  startGeometryCost();
  expect(geometryCost().mode, "startGeometryCost() must default to the decision mode").toBe(
    "counts",
  );
  callTheLeaves();
  const counted = geometryCost();
  realClock();

  /* The point of the mode: `measureRow` calls `stickyOffset` calls
     `safeAreaInsets`, so leaf timing puts six clock reads inside an interval
     compared against a 4ms budget. */
  for (const site of GEOMETRY_LEAVES) {
    expect(counted[site].calls, `${site} lost its count in "counts" mode`).toBe(ROUNDS);
    expect(counted[site].reads, `${site} lost its reads in "counts" mode`).toBeGreaterThan(0);
    expect(counted[site].ms, `${site} read the clock in "counts" mode`).toBe(0);
    expect(counted[site].samples, `${site} recorded a sample in "counts" mode`).toEqual([]);
  }

  /* And the control for *that* zero, which is otherwise the exact shape of a
     probe that cannot time anything at all: the same three leaves, the same
     calls, diagnostic mode, and now they must move. */
  const scripted = stepClock();
  startGeometryCost("full");
  callTheLeaves();
  const full = geometryCost();
  scripted();

  expect(full.mode).toBe("full");
  for (const site of GEOMETRY_LEAVES) {
    expect(full[site].calls, `${site} lost its count in "full" mode`).toBe(ROUNDS);
    expect(full[site].reads, `${site} lost its reads in "full" mode`).toBe(counted[site].reads);
    tallyIsSane(full, site);
    /* Under a clock that cannot stand still, a leaf that timed itself records a
       positive integer and one whose `t0` was the sentinel records exactly 0.
       `calls > 0` cannot tell those apart — `noteGeometry` counts either way. */
    expect(
      full[site].ms,
      `${site} recorded no time under a clock that cannot stand still — its timer never started`,
    ).toBeGreaterThan(0);
    expect(full[site].samples.length, `${site} timed itself without recording samples`).toBe(
      ROUNDS,
    );
  }
});

/**
 * The test above reads the *recorded values*, and a recorded zero is exactly
 * what a leaf that read the clock and threw the reading away would produce.
 * `"counts"` is defined by an absence — no clock read at a leaf — and an
 * absence has to be watched for directly. GPT Sol mutation-tested the
 * equivalent file for annotation-cost and got a green suite out of a
 * `performance.now()` added to `leafClock()`; this is the assertion that
 * catches it. docs/reusable/silent-success.md.
 */
it('reads no clock at a leaf in "counts" mode, and exactly two per call in "full"', () => {
  const now = vi.spyOn(performance, "now");

  startGeometryCost();
  now.mockClear();
  const inCounts = doTheLeafWork();
  const readsInCounts = now.mock.calls.length;

  startGeometryCost("full");
  now.mockClear();
  const inFull = doTheLeafWork();
  const readsInFull = now.mock.calls.length;
  now.mockRestore();

  /* The same work both times, so the two read counts are comparable and the
     zero below is about the clock rather than about a leaf that did nothing. */
  expect(inCounts, '"counts" mode did no work').toHaveLength(ROUNDS);
  expect(inFull, '"full" mode did no work').toHaveLength(ROUNDS);

  expect(
    readsInCounts,
    '"counts" mode read the clock at a leaf — that mode exists precisely so it does not',
  ).toBe(0);
  /* Two reads per call — `leafGeometryClock()` in, `noteGeometry()` out — and
     one round reaches all three leaves. Exact rather than "more than zero",
     because a site that quietly lost its timer takes two off this number and an
     inequality would not notice. */
  expect(readsInFull, 'a leaf timer did not run in "full" mode').toBe(
    GEOMETRY_LEAVES.length * ROUNDS * 2,
  );
});

/* ------------------------------------------------------- the read counts -- */

/**
 * The number this whole module is for, and the one an inequality would let
 * quietly collapse to 1.
 *
 * `measureRow` reads one rect per row and then calls `stickyOffset`, which
 * reads one rect of its own and calls `safeAreaInsets`, which reads one
 * computed style. Charged **exclusively** — each read to the site that performs
 * it — those are `ROWS`, 1 and 1, and they sum to the frame's real total with
 * nothing counted twice.
 *
 * The control is the article's own size: `reads` at the leaf must track the row
 * count and the other two must not move at all. A probe that counted one read
 * per call, or that charged the nested leaves to their caller as well, passes
 * neither half.
 */
it("charges every read once, at the site that performs it, and scales with the article", () => {
  startGeometryCost();
  callTheLeaves();
  const small = geometryCost();

  expect(small.measureRow.calls).toBe(ROUNDS);
  expect(small.measureRow.reads, "measureRow does not read one rect per row").toBe(ROUNDS * ROWS);
  expect(small.stickyOffset.calls, "stickyOffset is called once per measureRow").toBe(ROUNDS);
  expect(small.stickyOffset.reads, "stickyOffset reads exactly its own bar rect").toBe(ROUNDS);
  expect(small.safeAreaInsets.calls, "safeAreaInsets is called once per stickyOffset").toBe(ROUNDS);
  expect(small.safeAreaInsets.reads, "safeAreaInsets reads one computed style").toBe(ROUNDS);

  /* Nothing writes on this path, so a nonzero `writes` here would mean the
     `contextPanelPlace` accounting had leaked into a leaf. */
  expect(totals(small).writes, "a leaf recorded a layout write").toBe(0);

  /* The changed-input control: triple the rows, and only the per-row site moves
     — by exactly the factor the article did. */
  const BIG = ROWS * 3;
  buildTable(BIG);
  resetGeometryCost();
  callTheLeaves();
  const big = geometryCost();

  expect(big.measureRow.reads, "the rect loop did not follow the row count").toBe(ROUNDS * BIG);
  expect(big.stickyOffset.reads, "stickyOffset is not per-row and must not have moved").toBe(
    ROUNDS,
  );
  expect(big.safeAreaInsets.reads, "safeAreaInsets is not per-row and must not have moved").toBe(
    ROUNDS,
  );
});

/**
 * A `stickyOffset` on a page with no controls bar returns early, and the early
 * return is instrumented too — a call with zero reads of its own. Paired with
 * the bar present, since "0" and "the return was never charged" are the same
 * number otherwise.
 */
it("charges the early return in stickyOffset as a call that read nothing", () => {
  startGeometryCost();
  stickyOffset();
  const withBar = geometryCost();
  expect(withBar.stickyOffset).toMatchObject({ calls: 1, reads: 1 });

  document.querySelector(".controls")?.remove();
  resetGeometryCost();
  stickyOffset();
  const without = geometryCost();
  expect(without.stickyOffset.calls, "the early return was not charged at all").toBe(1);
  expect(without.stickyOffset.reads, "there was no bar to read").toBe(0);
  /* `safeAreaInsets` still ran, which is what says the call happened at all
     rather than the function having been skipped. */
  expect(without.safeAreaInsets, "the early return skipped its inset read").toMatchObject({
    calls: 1,
    reads: 1,
  });
});

/* --------------------------------------------------- the column sampler -- */

/**
 * One half of the A8 pilot verdict, driven through the real hook.
 *
 * `useColumnContext` is the other `O(sections)` per-frame scan, and its read
 * count is what Stage 2's `innerHeight` hoist has to move — so a number that
 * silently did not include the duplicate would make that stage unfalsifiable.
 * Exact: two `innerHeight`s, one `svh` probe `clientHeight`, and one rect per
 * resolved section row, with no gist headers and no pinned column in this
 * fixture.
 *
 * The control is the section list: measure the same page against half as many
 * sections and only the per-row term may move.
 */
describe("the gist column's per-frame sampler", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  /** No gist columns on screen — this fixture is the section scan on its own.
   *  **Hoisted, and it has to be**: the hook's effect depends on `depths` by
   *  identity, so a `[]` written inline in the render body re-runs the effect on
   *  every commit, which the effect itself causes. That is an infinite loop, and
   *  the way it presents is a test run that never returns. */
  const NO_DEPTHS: number[] = [];

  /** A harness component whose only job is to run the hook. */
  function Harness({ sections }: { sections: Section[] }) {
    useColumnContext({ sections, depths: NO_DEPTHS, enabled: true, layoutKey: "x" });
    return null;
  }

  function sectionsOf(n: number): Section[] {
    return Array.from({ length: n }, (_, i) => ({
      row: i,
      blockId: `b${i}` as Section["blockId"],
      nodeId: `n${i}` as Section["nodeId"],
      title: `s${i}`,
    }));
  }

  async function run(sections: Section[]): Promise<void> {
    await act(async () => {
      root.render(createElement(Harness, { sections }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 32));
    });
  }

  it("reads three fixed properties and one rect per resolved section", async () => {
    /* Three fixed reads, plus one rect per section row. Named here so the
       control below is a subtraction rather than a second guess. */
    const FIXED = 3;

    startGeometryCost();
    await run(sectionsOf(ROWS));
    const all = geometryCost();

    expect(all.columnContext.calls, "the hook never measured").toBeGreaterThan(0);
    expect(
      all.columnContext.reads,
      "the sampler is not reading three fixed properties and one rect per section",
    ).toBe(all.columnContext.calls * (FIXED + ROWS));
    expect(all.columnContext.writes, "a reads-only sampler wrote something").toBe(0);

    /* The changed-input control: half the sections, and only the per-row term
       moves. A probe that counted one read per call passes neither line. */
    const HALF = ROWS / 2;
    act(() => root.unmount());
    root = createRoot(host);
    resetGeometryCost();
    await run(sectionsOf(HALF));
    const half = geometryCost();

    expect(half.columnContext.calls, "the hook never measured the shorter list").toBeGreaterThan(0);
    expect(half.columnContext.reads, "the rect loop did not follow the section count").toBe(
      half.columnContext.calls * (FIXED + HALF),
    );
  });

  /**
   * A section whose row is not in the DOM is a hole — `rowsForBlockIds` returns
   * `null` and the sampler skips it without a read. Counting it anyway would
   * report a busy sampler on an article whose tree never resolved, which is the
   * comfortable-number-for-the-wrong-reason the whole plan is guarding against.
   */
  it("does not charge a read for a section with no row in the DOM", async () => {
    const real = sectionsOf(ROWS);
    const withHoles: Section[] = [
      ...real,
      { row: 99, blockId: "missing-1" as Section["blockId"], nodeId: "n99" as Section["nodeId"], title: "x" },
      { row: 98, blockId: "missing-2" as Section["blockId"], nodeId: "n98" as Section["nodeId"], title: "y" },
    ];

    startGeometryCost();
    await run(withHoles);
    const cost = geometryCost();

    expect(cost.columnContext.calls, "the hook never measured").toBeGreaterThan(0);
    expect(
      cost.columnContext.reads,
      "two unresolvable sections were charged a rect read each",
    ).toBe(cost.columnContext.calls * (3 + ROWS));
  });
});

/* -------------------------------------------------- the bar's own frame -- */

/**
 * The one site that writes into the middle of the frame everything else reads
 * rects in. It only attaches while the small-device media query matches, so a
 * laptop pays nothing — which is also why the query is stubbed here rather than
 * left to jsdom, which has no `matchMedia` at all.
 */
it("charges the bar watcher one read a frame, and a write only on a transition", async () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
  /** rAF is a `setTimeout` stand-in here, so a frame is one macrotask away. */
  const frame = () => new Promise((r) => setTimeout(r, 8));

  startGeometryCost();
  const stop = watchBarVisibility();
  try {
    /* A frame at the top of the page: the bar is never hidden inside the first
       screenful (`stepBar`), so this is a read with no write — the shape that
       must not be mistaken for a broken counter. */
    window.dispatchEvent(new Event("scroll"));
    await frame();
    const idle = geometryCost();
    expect(idle.barVisibility.calls, "the bar watcher's frame never ran").toBeGreaterThan(0);
    expect(idle.barVisibility.reads, "the watcher reads window.scrollY, and once").toBe(
      idle.barVisibility.calls,
    );
    expect(idle.barVisibility.writes, "nothing moved, so the bar cannot have changed state").toBe(
      0,
    );

    /* The control for that zero: scroll far enough down to hide the bar, and
       exactly one write must appear. */
    (window as unknown as { scrollY: number }).scrollY = 2000;
    window.dispatchEvent(new Event("scroll"));
    await frame();
    const moved = geometryCost();
    expect(
      moved.barVisibility.writes,
      "the bar never changed state, so the zero above proves nothing",
    ).toBe(1);
    expect(moved.barVisibility.reads, "still one read a frame").toBe(moved.barVisibility.calls);
    expect(
      document.documentElement.dataset.bars,
      "the write counter moved without the bar actually hiding",
    ).toBe("hidden");
  } finally {
    stop();
  }
});

/* ------------------------------------------------------------ the spine -- */

/* Two real parents, and the pair the whole shared-snapshot design rests on:
   `measure` is the `O(all rows)` scan at invalidation time, `apply` is what a
   scroll frame costs once the answer is cached in document space. */

function node(id: string, first: string): TreeNode {
  return {
    id: id as NodeId,
    parent: null,
    children: [],
    depth: 1,
    title: id,
    gist: id,
    range: [first, first],
  } as unknown as TreeNode;
}

function outline(): OutlineEntry[] {
  const section = (id: string, first: string, startRow: number): OutlineEntry => ({
    node: node(id, first),
    startRow,
    endRow: startRow + 4,
    words: 50,
    children: [],
  });
  return [
    {
      node: node("a", "b0"),
      startRow: 0,
      endRow: 9,
      words: 100,
      children: [section("a1", "b0", 0), section("a2", "b5", 5)],
    },
    {
      node: node("b", "b10"),
      startRow: 10,
      endRow: 19,
      words: 100,
      children: [section("b1", "b10", 10), section("b2", "b15", 15)],
    },
  ];
}

describe("the spine's two geometry parents", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  async function settle(): Promise<void> {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 32));
    });
  }

  async function mount(): Promise<HTMLElement> {
    await act(async () => {
      root.render(createElement(Spine, { outline: outline(), layoutKey: "x", onJump: () => {} }));
    });
    /* A **second** act, deliberately: React flushes layout effects as the first
       one exits, so the frame the rail asks for is only *requested* by then.
       Its absence looks exactly like a component that never measures. */
    await settle();
    const band = host.querySelector<HTMLElement>(".spine-viewport");
    expect(band, "the rail should have measured and drawn before anything is counted").not.toBeNull();
    return band as HTMLElement;
  }

  async function scrollTo(y: number): Promise<void> {
    await act(async () => {
      (window as unknown as { scrollY: number }).scrollY = y;
      window.dispatchEvent(new Event("scroll"));
    });
    await settle();
  }

  it("charges the invalidation scan per row and the scroll frame for one read", async () => {
    startGeometryCost();
    await mount();
    const mounted = geometryCost();

    expect(mounted.spineMeasure.calls, "the rail never measured").toBeGreaterThan(0);
    /* One `window.scrollY` plus one rect per row, every time. Exact, and
       expressed against the call count so a second measure on mount does not
       make this brittle. */
    expect(mounted.spineMeasure.reads, "the rail's scan is not one rect per row").toBe(
      mounted.spineMeasure.calls * (ROWS + 1),
    );
    expect(mounted.spineMeasure.writes, "the measuring scan wrote something").toBe(0);

    const before = mounted.spineApply.calls;
    await scrollTo(400);
    await scrollTo(900);
    const scrolled = geometryCost();

    /* The control that makes the numbers below mean something: scrolling really
       did reach `apply`. */
    expect(scrolled.spineApply.calls, "scrolling never reached the rail's frame callback")
      .toBeGreaterThan(before);
    /* **The property the whole shared-snapshot design rests on**: a scroll frame
       reads `window.scrollY` and nothing else, because everything about the
       article's shape is cached in document space. More than one read per call
       here is a finding, not a number. */
    expect(
      scrolled.spineApply.reads,
      "a scroll frame read more than window.scrollY — the document-space cache has leaked",
    ).toBe(scrolled.spineApply.calls);
    /* And the write that lands in the middle of the frame other consumers read
       rects in: one `style.top` per call. */
    expect(scrolled.spineApply.writes, "the viewport band was not moved").toBe(
      scrolled.spineApply.calls,
    );
    /* Scrolling must not re-run the `O(all rows)` scan — if it did, the rail
       would be the expensive thing rather than the model for fixing the others. */
    expect(
      scrolled.spineMeasure.calls,
      "a scroll re-ran the invalidation scan",
    ).toBe(mounted.spineMeasure.calls);
  });

  it("charges the parents in every mode, unlike the leaves", async () => {
    /* Parents are timed whenever the probe is on — that is what makes
       `"counts"` the mode the decision rule is applied to. Under a stepping
       clock a timed parent records a positive whole number; the leaves inside
       the same run record exactly zero. Both halves, in one run, or "the
       parents are timed" and "the leaves are not" are each half a proof. */
    const realClock = stepClock();
    startGeometryCost();
    await mount();
    await scrollTo(400);
    const cost = geometryCost();
    realClock();

    expect(cost.mode).toBe("counts");
    expect(cost.spineMeasure.ms, 'a parent was not timed in "counts" mode').toBeGreaterThan(0);
    expect(cost.spineApply.ms, 'a parent was not timed in "counts" mode').toBeGreaterThan(0);
    expect(cost.spineMeasure.samples.length).toBe(cost.spineMeasure.calls);
    tallyIsSane(cost, "spineMeasure");
    tallyIsSane(cost, "spineApply");
  });
});
