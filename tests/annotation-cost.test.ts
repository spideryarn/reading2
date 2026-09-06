// @vitest-environment jsdom
/**
 * **The instrument has to be provably off, provably on, and provably in the
 * middle state.**
 *
 * src/web/annotation-cost.ts exists to answer one question — how much of a
 * gesture in the reading view the annotation pipeline is responsible for
 * (docs/plans/260905i-measure-annotation-computation-before-optimising-it.md).
 * Its failure modes are all silent, and they are mirror images:
 *
 * - a probe that never switched on reports zeroes, and zeroes read as "this is
 *   cheap, defer" — which is the answer this job would most like to hear and
 *   the one it must not be handed by accident;
 * - a probe that cannot be switched off is permanent instrumentation in code
 *   that runs thousands of times per render, and is then part of what it is
 *   measuring (perf.ts makes the same argument for the globals it patches);
 * - and `"counts"` mode — the one the decision is actually made in — is
 *   *defined* by four zeroed leaf timers, which is indistinguishable from a
 *   broken probe unless the leaf **counts** are checked at the same time.
 *
 * So every assertion here is paired. A zero is only believed next to a nonzero
 * control taken from the *same* calls. One-sided, either counter — always zero,
 * or always counting — passes half of this file and fails the other.
 * docs/reusable/silent-success.md.
 *
 * jsdom because `host()` in annotate.ts builds a real `<div>`, and because the
 * memo test below mounts the real `TableView`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/* The other probe, mocked rather than started — starting it patches timers,
   rAF and fetch globally. Copied from tests/prose-not-rebuilt.test.tsx. */
vi.mock("../src/web/perf.js", () => ({
  useRenderCount: () => {},
  mark: (_l: string, fn: () => unknown) => fn(),
}));

/* Floating UI does real geometry and is not what is under test. */
vi.mock("../src/web/Tooltip.js", () => ({
  Tooltip: ({ children }: { children: unknown }) => children,
  TooltipGroup: ({ children }: { children: unknown }) => children,
}));

import { annotateHtml, renderedText, resolveMark, type Mark } from "../src/web/annotate.js";
import {
  annotationCost,
  type AnnotationCost,
  type CostSite,
  resetAnnotationCost,
  setAnnotationCostMode,
  startAnnotationCost,
  stopAnnotationCost,
} from "../src/web/annotation-cost.js";
import { addZoomHandles } from "../src/web/zoomable.js";
import { TableView } from "../src/web/TableView.js";
import { buildGeometry } from "../src/web/tree.js";
import { fitView } from "../src/web/layout.js";
import { readArticleFromDir } from "./helpers/article-from-dir.js";
import type { Article, Comment } from "../src/types.js";

/** Every site the snapshot carries, so a new one cannot be left unasserted. */
const SITES: CostSite[] = [
  "renderedText",
  "resolveMark",
  "annotateHtml",
  "addZoomHandles",
  "marksByBlock",
  "proseHtml",
];

/** The four whose timers are switched off in `"counts"` mode. */
const LEAVES = ["renderedText", "resolveMark", "annotateHtml", "addZoomHandles"] as const;

/** How many times `callTheLeaves` reaches each leaf. */
const ROUNDS = 5;

/**
 * The four leaf sites, exercised in exactly the same way in every mode — and
 * with **no assertion inside the loop**, so the window can be watched by a
 * `performance.now` spy without vitest's own machinery landing in the count.
 * The guards live in `callTheLeaves` below, outside that window.
 */
function doTheLeafWork(): { resolved: number; marked: number; handled: number } {
  const html =
    "<p>Tea and toast, and a <em>figure</em> below.</p><figure><img width='400'></figure>";
  let resolved = 0;
  let marked = 0;
  let handled = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const text = renderedText(html);
    const found = resolveMark(text, { quote: "toast", start: 8 });
    if (found) resolved += 1;
    const marks: Mark[] = [{ id: `c${i}`, start: found?.start ?? 0, end: found?.end ?? 0 }];
    const annotated = annotateHtml(html, marks);
    if (annotated.includes("<mark")) marked += 1;
    if (addZoomHandles(annotated).includes("zoom-btn")) handled += 1;
  }
  return { resolved, marked, handled };
}

/** `doTheLeafWork`, with the guards that say it exercised anything at all. */
function callTheLeaves(): void {
  const did = doTheLeafWork();
  expect(did, "the leaves did not all do their work, so this exercises nothing").toEqual({
    resolved: ROUNDS,
    marked: ROUNDS,
    handled: ROUNDS,
  });
}

/** Every site's numbers, flattened for a whole-snapshot assertion. */
function totals(cost: AnnotationCost): { calls: number; ms: number } {
  /* Summed only to say "nothing at all moved" / "something moved". The header
     of annotation-cost.ts is emphatic that these six overlap and that a sum is
     not a duration — it is not used as one anywhere here. */
  let calls = 0;
  let ms = 0;
  for (const site of SITES) {
    calls += cost[site].n;
    ms += cost[site].ms;
  }
  return { calls, ms };
}

/** The two invariants every tally must satisfy in every mode. */
function tallyIsSane(cost: AnnotationCost, site: CostSite): void {
  const tally = cost[site];
  expect(Number.isFinite(tally.ms), `${site} accumulated a non-finite ms`).toBe(true);
  expect(tally.ms, `${site} accumulated negative time`).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(tally.maxMs), `${site} has a non-finite maxMs`).toBe(true);
  expect(tally.maxMs, `${site} has a negative maxMs`).toBeGreaterThanOrEqual(0);
  /* The worst single sample is one of the samples that make up the total, so it
     can never exceed it — and with any call at all it must be at least the
     average. Both directions, because a `maxMs` stuck at zero and a `maxMs`
     that is really a running total both pass one of them. */
  expect(tally.maxMs, `${site}: maxMs exceeds the accumulated ms`).toBeLessThanOrEqual(tally.ms);
  if (tally.ms > 0) {
    expect(tally.maxMs, `${site}: maxMs is below the mean, so it is not a maximum`)
      .toBeGreaterThanOrEqual(tally.ms / tally.n);
  }
}

/**
 * A clock that only ever goes forward, by one whole millisecond per reading.
 *
 * Wall-clock assertions here would be a machine-speed lottery — a memo whose
 * timer never started and a memo that finished in under a microsecond both
 * round to the same "not negative". With this installed, any interval that read
 * the clock at *both* ends is a positive whole number of milliseconds, and an
 * interval that started at `NO_CLOCK` is still exactly zero. That is the
 * difference the memo assertions turn on, and it is why they are exact rather
 * than an inequality: `toBeGreaterThanOrEqual(0)` is the assertion a broken
 * timer passes.
 */
function stepClock(): () => void {
  let t = 1000;
  const spy = vi.spyOn(performance, "now").mockImplementation(() => {
    t += 1;
    return t;
  });
  return () => spy.mockRestore();
}

beforeEach(() => {
  stopAnnotationCost();
  resetAnnotationCost();
});

afterEach(() => {
  vi.restoreAllMocks();
  stopAnnotationCost();
  resetAnnotationCost();
});

it("records nothing at all while it is off", () => {
  callTheLeaves();
  const off = annotationCost();
  expect(off.mode, "the probe must start off — a reader pays for it otherwise").toBe("off");
  for (const site of SITES) {
    expect(off[site], `${site} must be untouched while the probe is off`).toEqual({
      n: 0,
      ms: 0,
      maxMs: 0,
    });
  }

  /* The control that makes those zeroes mean something. Identical calls, probe
     on: if these were also zero the block above would have proved nothing. */
  startAnnotationCost("full");
  callTheLeaves();
  const on = annotationCost();
  for (const site of LEAVES) {
    expect(on[site].n, `${site} was never counted — the probe is wired up wrong`).toBe(ROUNDS);
    tallyIsSane(on, site);
  }
});

it("counts the leaves without timing them in the mode the decision is made in", () => {
  startAnnotationCost();
  expect(annotationCost().mode, "startAnnotationCost() must default to the decision mode").toBe(
    "counts",
  );
  callTheLeaves();
  const counted = annotationCost();

  /* The point of the mode: `proseHtml` calls `addZoomHandles` once per block,
     so leaf timing would put a thousand clock reads inside the interval it is
     supposed to explain. */
  for (const site of LEAVES) {
    expect(counted[site].n, `${site} lost its count in "counts" mode`).toBe(ROUNDS);
    expect(counted[site].ms, `${site} read the clock in "counts" mode`).toBe(0);
    expect(counted[site].maxMs, `${site} read the clock in "counts" mode`).toBe(0);
  }

  /* And the control for *that* zero, which is otherwise the exact shape of a
     probe that cannot time anything at all: the same four leaves, same calls,
     diagnostic mode, and now they must move. */
  resetAnnotationCost();
  startAnnotationCost("full");
  callTheLeaves();
  const full = annotationCost();
  expect(full.mode).toBe("full");
  for (const site of LEAVES) {
    expect(full[site].n, `${site} lost its count in "full" mode`).toBe(ROUNDS);
    tallyIsSane(full, site);
  }
  /* At least one leaf must have registered measurable time, or "the timers are
     on" is an unverified claim. `annotateHtml` over five marked blocks is the
     most expensive of the four and the safest to insist on. */
  const timed = LEAVES.some((site) => full[site].ms > 0);
  expect(timed, 'no leaf accumulated any time in "full" mode — the timers never ran').toBe(true);
});

/**
 * The test above reads the *recorded values*, and a recorded zero is exactly
 * what a leaf that read the clock and threw the reading away would also
 * produce. `"counts"` mode is defined by an absence — no clock read at a leaf —
 * and an absence has to be watched for directly. GPT Sol mutation-tested the
 * first version of this file and got a green suite out of a `performance.now()`
 * added to `leafClock()` in `"counts"` mode; this is the assertion that would
 * have caught it. docs/reusable/silent-success.md.
 */
it('reads no clock at a leaf in "counts" mode, and exactly two per call in "full"', () => {
  const now = vi.spyOn(performance, "now");

  startAnnotationCost();
  now.mockClear();
  const inCounts = doTheLeafWork();
  const readsInCounts = now.mock.calls.length;

  startAnnotationCost("full");
  now.mockClear();
  const inFull = doTheLeafWork();
  const readsInFull = now.mock.calls.length;
  now.mockRestore();

  /* The same work both times, so the two read counts are comparable and a zero
     below is about the clock rather than about a leaf that did nothing. */
  const all = { resolved: ROUNDS, marked: ROUNDS, handled: ROUNDS };
  expect(inCounts, "the leaves did no work in \"counts\" mode").toEqual(all);
  expect(inFull, 'the leaves did no work in "full" mode').toEqual(all);

  expect(
    readsInCounts,
    '"counts" mode read the clock at a leaf — that mode exists precisely so it does not',
  ).toBe(0);
  /* Two reads per call: `leafClock()` on the way in, `noteCost()` on the way
     out. Four leaves, ROUNDS calls each. Exact rather than "more than zero",
     because a site that quietly lost its timer takes eight off this number and
     an inequality would not notice. */
  expect(readsInFull, 'a leaf timer did not run in "full" mode').toBe(4 * ROUNDS * 2);
});

/**
 * `maxMs` under a clock we wrote ourselves.
 *
 * The inequalities in `tallyIsSane` are satisfied by an accumulated total as
 * well as by a maximum — Sol replaced one with the other and the suite stayed
 * green. Three deliberately unequal samples separate them: only a real maximum
 * is 20 when the total is 32.
 */
it("records each sample exactly, and keeps the largest one rather than the total", () => {
  /* One sample per pair of readings, since `leafClock()` takes the first and
     `noteCost()` the second: 5ms, then 20ms, then 7ms. The count is knowable
     because the test above pins it at two reads per leaf call. */
  const readings = [1000, 1005, 2000, 2020, 3000, 3007];
  let reads = 0;
  const spy = vi.spyOn(performance, "now").mockImplementation(() => {
    /* Runs past the end of the script rather than throwing: a throw from
       inside a mocked global escapes mid-render and leaves the spy installed
       for every test after this one, which turns one clear failure into five
       confusing ones. The overrun is asserted below instead. */
    const t = readings[reads++];
    return t ?? 9000 + reads;
  });

  startAnnotationCost("full");
  for (let k = 0; k < 3; k++) renderedText("<p>Tea and toast.</p>");
  spy.mockRestore();

  const cost = annotationCost();
  expect(
    reads,
    "three leaf calls did not read the scripted clock exactly twice each",
  ).toBe(readings.length);
  expect(cost.renderedText.n).toBe(3);
  expect(cost.renderedText.ms, "the three samples must total 5 + 20 + 7").toBe(32);
  expect(
    cost.renderedText.maxMs,
    "maxMs is 32, so it is the accumulated total and not the largest single sample",
  ).toBe(20);
});

/**
 * F18: the counters belong to the mode the snapshot reports.
 *
 * Both halves, because the cheap fix for one breaks the other — resetting on
 * every call to the setter would wipe a run whenever a harness re-asserted the
 * mode it was already in.
 */
it("zeroes the counters when the mode changes, and not when it is merely restated", () => {
  startAnnotationCost("full");
  callTheLeaves();
  const running = totals(annotationCost());
  expect(running.calls, "nothing was counted, so nothing is being tested").toBeGreaterThan(0);

  startAnnotationCost("full");
  expect(totals(annotationCost()), "re-starting the same mode wiped a run").toEqual(running);
  setAnnotationCostMode("full");
  expect(totals(annotationCost()), "re-setting the same mode wiped a run").toEqual(running);

  /* A real change zeroes them, so `"counts"` can never report leaf totals
     accumulated while the leaf timers were on. */
  setAnnotationCostMode("counts");
  const switched = annotationCost();
  expect(switched.mode).toBe("counts");
  expect(totals(switched), '"counts" inherited samples taken in "full"').toEqual({
    calls: 0,
    ms: 0,
  });

  /* And the same for stopping, which used to leave nonzero numbers wearing the
     label that means "nobody switched the probe on". */
  callTheLeaves();
  expect(totals(annotationCost()).calls).toBeGreaterThan(0);
  stopAnnotationCost();
  const stopped = annotationCost();
  expect(stopped.mode).toBe("off");
  expect(totals(stopped), 'counters survived into a snapshot labelled "off"').toEqual({
    calls: 0,
    ms: 0,
  });
});

it("stops recording again, and reset returns it to zero", () => {
  startAnnotationCost("full");
  callTheLeaves();
  expect(
    totals(annotationCost()).calls,
    "nothing was counted, so nothing is being tested",
  ).toBeGreaterThan(0);

  resetAnnotationCost();
  const cleared = annotationCost();
  expect(totals(cleared)).toEqual({ calls: 0, ms: 0 });
  for (const site of SITES) expect(cleared[site].maxMs, `${site} kept its maxMs`).toBe(0);
  expect(cleared.mode, "reset must not switch the probe off — that is stop's job").toBe("full");

  stopAnnotationCost();
  callTheLeaves();
  const after = annotationCost();
  expect(after.mode).toBe("off");
  expect(totals(after), "calls after stop were still counted").toEqual({ calls: 0, ms: 0 });
});

/* ------------------------------------------------------------ the memos --
   The two numbers the plan's decision rule is actually applied to. They live
   in TableView.tsx rather than in annotate.ts, so nothing above would notice
   if their `noteCost` were dropped in a merge. */

const DIR = "tests/fixtures/data-root/data/openai-huggingface";

class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoResize as unknown as typeof ResizeObserver;

let mountPoint: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mountPoint = document.createElement("div");
  document.body.appendChild(mountPoint);
  root = createRoot(mountPoint);
});

afterEach(() => {
  act(() => root.unmount());
  mountPoint.remove();
});

/** As tests/prose-not-rebuilt.test.tsx § `propsFor`. */
function propsFor(
  loaded: Awaited<ReturnType<typeof readArticleFromDir>>,
  over: Record<string, unknown> = {},
) {
  if (!loaded.meta) throw new Error(`${DIR} has no meta.json — the fixture is incomplete`);
  const article: Article = {
    meta: loaded.meta,
    blocks: loaded.blocks,
    tree: loaded.tree,
    assets: undefined,
    navLabelStatus: "ready",
  };
  const geometry = buildGeometry(article.tree, article.blocks);
  const gistDepths = geometry.columnDepths.filter((d) => d < geometry.leafDepth);
  const fit = fitView({
    windowWidth: 1400,
    gistDepths,
    leafDepth: geometry.leafDepth,
    showText: true,
    chosen: null,
  });
  return {
    article,
    geometry,
    columns: fit.columns,
    layout: fit,
    showText: true,
    comments: [],
    openComment: null,
    chats: [],
    chatCounts: new Map<string, number>(),
    openChat: null,
    sections: [],
    layoutKey: "test",
    ...over,
  };
}

it('charges the two memos in TableView, in "counts" mode and not when off', async () => {
  const loaded = await readArticleFromDir(DIR);
  const target = loaded.blocks.find((b) => b.gistable && renderedText(b.html).length > 60);
  if (!target) throw new Error("fixture has no ordinary prose block to mark");
  /* A real resolvable anchor, so `marksByBlock` does work rather than skipping
     the one comment it is handed. Taken from `renderedText`, never from
     `block.text` — the two are different strings, and annotate.ts's header is
     entirely about what happens when an offset crosses between them. */
  const text = renderedText(target.html);
  const comments: Comment[] = [
    {
      id: "cost-1",
      blockId: target.id,
      quote: text.slice(10, 25),
      start: 10,
      createdAt: new Date().toISOString(),
      /* A bookmark: the reader marked the words and asked nothing. Enough for
         `marksByBlock`, which reads only the anchor. */
      status: "none",
    },
  ];

  await act(async () => {
    root.render(createElement(TableView, propsFor(loaded, { comments }) as never));
  });
  const off = annotationCost();
  for (const site of ["marksByBlock", "proseHtml"] as const) {
    expect(off[site], `${site} counted while the probe was off`).toEqual({ n: 0, ms: 0, maxMs: 0 });
  }
  /* The guards that make those zeroes mean something: the component really did
     render prose, and the comment really did resolve, so "nothing was counted"
     is about the probe rather than about the mount. */
  expect(
    mountPoint.querySelectorAll(".prose").length,
    "no prose rendered — a zero count would be meaningless",
  ).toBe(loaded.blocks.length);
  expect(
    mountPoint.querySelector("mark.cmt"),
    "the fixture comment never resolved, so marksByBlock did no work",
  ).not.toBeNull();

  /* On a clock of our own for the mounted render, so the memo durations below
     can be asserted as *positive* rather than as "not negative". Sol replaced
     both memo start times with `NO_CLOCK` and the suite stayed green, because
     nothing here ever said a memo must record time. Now it does, and only a
     timer that really started can. */
  const realClock = stepClock();
  startAnnotationCost();
  /* **A fresh mount rather than a re-render, since 2026-09-06.** This used to
     re-render with a fresh-but-identical `comments` array — the streaming-delta
     shape — and that no longer charges anything, because Stage 2 of
     docs/plans/260905i-… made a delta that moves no anchor cost nothing at all.
     Which is the point of it, and tests/annotation-reuse.test.tsx is where that
     zero is asserted and paired with its controls. A first paint is the pass
     that still visits every block, and it is what the count below is about. */
  await act(async () => {
    root.unmount();
  });
  root = createRoot(mountPoint);
  await act(async () => {
    root.render(createElement(TableView, propsFor(loaded, { comments }) as never));
  });
  const on = annotationCost();
  realClock();
  expect(
    on.marksByBlock.n,
    "marksByBlock is not charged — the memo lost its noteCost",
  ).toBeGreaterThan(0);
  expect(on.proseHtml.n, "proseHtml is not charged — the memo lost its noteCost").toBeGreaterThan(
    0,
  );
  for (const site of ["marksByBlock", "proseHtml"] as const) {
    tallyIsSane(on, site);
    /* The step clock moves a whole millisecond per reading, so a memo that
       timed itself records a positive integer and a memo whose `t0` was
       `NO_CLOCK` records exactly 0. `n > 0` above cannot tell those apart —
       `noteCost` counts the call either way. */
    expect(
      on[site].ms,
      `${site} recorded no time under a clock that cannot stand still — its timer never started`,
    ).toBeGreaterThan(0);
    expect(
      Number.isInteger(on[site].ms),
      `${site} recorded ${on[site].ms}ms, which did not come from the scripted clock`,
    ).toBe(true);
  }
  /* The outer timers run in "counts" mode — that is the whole point of the
     mode — while the leaves inside them are counted and not timed. */
  expect(on.addZoomHandles.ms, 'a leaf was timed in "counts" mode').toBe(0);
  /* The overlap the header warns about, asserted rather than merely described:
     `proseHtml` runs `addZoomHandles` on every block, so its call count is at
     least the article's length and its time is inside `proseHtml`'s. */
  expect(on.addZoomHandles.n).toBeGreaterThanOrEqual(loaded.blocks.length);
});
