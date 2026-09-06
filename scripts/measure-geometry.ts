/**
 * What the reading view's **geometry** costs while a reader scrolls.
 *
 * This is the driving half of A8's Stage 1. `src/web/geometry-cost.ts` records
 * the numbers inside the browser; this file drives a real Chrome against a
 * production build, performs a **pinned** scroll gesture, and reads them out
 * beside two things the page cannot tell you about itself: the **frame
 * intervals** it actually got, and Chrome's own **layout counters** over CDP.
 *
 * The plan is
 * docs/plans/260906d-share-measured-geometry-after-profiling-scroll-and-layout-reads.md,
 * and its § "Decision rule" is what these numbers are for. Read that before
 * quoting anything here: the thresholds were written down before the
 * measurement, and this script deliberately reports more than they ask for so
 * that a comfortable median cannot carry a verdict on its own.
 *
 * Modelled closely on scripts/measure-annotation.ts (A7), which already solved
 * local sign-in, counting the population before timing anything, discarding a
 * warm-up, printing raw per-repetition vectors, and refusing to report when the
 * page did not render. Everything it learned the hard way is repeated here
 * rather than rediscovered — in particular:
 *
 * > **Every `page.evaluate` here is passed a *string*, never a closure.**
 * > tsx/esbuild injects `__name(...)` helpers into named function expressions,
 * > those helpers travel inside the source Playwright serialises to the
 * > browser, and `__name` does not exist there. Do not "tidy" these into arrow
 * > functions.
 *
 * ## Three numbers, because a self-timer cannot establish ownership
 *
 * Sol's F1 on the plan: an inclusive `performance.now()` timer charges a forced
 * layout to whichever read flushed it, not to the write that dirtied it. So
 * every gesture is reported three ways and never one:
 *
 * 1. **end-to-end** — the wall clock the reader waits, and for the scroll the
 *    **frame intervals**, p50/p95/max, so a sparse 20ms stall is visible. That
 *    shape produces *zero* `longtask` entries (that API starts at 50ms) and a
 *    perfectly comfortable median, and it is plainly visible to a reader.
 * 2. **sampler JavaScript time** — the geometry buckets, inclusive, per site.
 * 3. **Chrome's own counters** — `LayoutCount`, `LayoutDuration`,
 *    `RecalcStyleCount`, `RecalcStyleDuration`, `TaskDuration`, as deltas taken
 *    across each gesture over a CDP `Performance` session.
 *
 * The spike behind the plan (Chrome 152 on this box, 2,000-row synthetic table,
 * three sessions) established why the third one is not optional and not a
 * footnote:
 *
 * - a **pure scroll does not dirty layout at all**, even with sticky
 *   positioning — `LayoutCount` delta was **0** in every run;
 * - `LayoutCount` was **exact and identical across three runs** while the JS
 *   timings swung by up to 5× on this contended box;
 * - `LayoutDuration`/`RecalcStyleDuration` **undercount** against the JS timer
 *   while `TaskDuration` reconciles with it.
 *
 * So: **`TaskDuration` for magnitude, `LayoutCount` for ownership**, and
 * `LayoutCount` is the least noisy number this script produces.
 *
 * ## A parent bucket and a leaf bucket may never be added together
 *
 * `stickyOffset` runs *inside* `readingPosition`'s timed interval, so adding
 * them double-counts. That is prevented by construction rather than by comment:
 * there is **no function in this file that sums an arbitrary list of sites**.
 * The only sum that exists is `pilotMs`, over the two duplicated section-top
 * scans, and its argument type is `readonly PilotSite[]` — a subset of the
 * parents. Every other site is reported on its own line and never added to
 * anything. `assertSiteKinds` re-checks the partition at run time so a future
 * edit that widens a union still fails loudly.
 *
 * ## Which buckets may decide (Sol F4)
 *
 * Seven parent sites are instrumented; **two** may authorise Stage 3 —
 * `readingPosition` and `columnContext`, the duplicated section-top scans. The
 * report labels everything else `diagnostic`, and this file computes no
 * combined figure that could be mistaken for the pilot's.
 *
 * ## The pinned scroll, and why nothing about it may vary
 *
 * Two runs of the same article must be comparable, and a run of build A with a
 * run of build B. So the gesture fixes and **records**: start position, wheel
 * delta, number of steps, total distance, requested cadence, the mode and
 * columns that were enabled, and the settling time after the last wheel. It
 * uses Playwright's `mouse.wheel` — real trusted input through CDP — rather
 * than `window.scrollTo`, which does not exercise the same path.
 *
 * It is run **twice per article**: once from the very top, where
 * `ContextPanel.place` is live while the sticky header is still settling, and
 * once from the middle, where it is not. They are reported separately and are
 * not averaged together.
 *
 * The **achieved** cadence is reported next to the requested one, because a
 * CDP round trip per wheel is not free and the honest number is the one that
 * happened. A repetition that did not travel the pinned distance — the article
 * ran out — is marked suspect and kept out of every median: it is not the
 * pinned gesture, so it is not comparable with one.
 *
 * ## Population before timing, and a control before any zero
 *
 * A gesture over a page that did not render costs nothing and reads exactly
 * like a page where geometry is free. A7 lost time to signing in as the wrong
 * owner, which gives a 404 that renders fast and reports beautiful numbers for
 * a page that does not exist. So before anything is timed this prints, out of
 * the **loaded page**: the `tr[data-block]` count, the gist column headers
 * present, the tree's leaf depth and the section depth derived from it, the
 * section cells on screen, and whether `window.__perf.geometryCost` exists —
 * and it **refuses to report at all** if the blocks are zero or the instrument
 * is missing.
 *
 * Then a **control**: a short scroll that must move `readingPosition.calls`.
 * A zero is not a result until something that must move has moved
 * (docs/reusable/silent-success.md). Two independent witnesses of the section
 * count are printed side by side — the section cells counted in the DOM, and
 * `readingPosition.reads / calls` from the instrument, which knows nothing
 * about `<td>` elements. They should agree to within the sticky-line reads.
 *
 * ## `--baseline` takes the calibration run, and can measure nothing else
 *
 * The plan requires, on each viewport and **before** the geometry buckets are
 * read: the machine's actual refresh cadence, and an uninstrumented
 * fixed-scroll baseline. `--baseline` takes exactly those. It drops `?perf=1`
 * entirely, so no probe is patched and no geometry bucket exists to report —
 * which is what makes its output impossible to mistake for a geometry number.
 * It is the one mode that runs without `src/web/geometry-cost.ts` being
 * present.
 *
 * ## The workload
 *
 * **Production build only.** `npm run build` (not `build:api`, which refuses a
 * stale client shell after a commit), then `npx vite preview`. Never the dev
 * server: `main.tsx` wraps the app in `<StrictMode>` unconditionally and A7
 * measured ~3× inflation from that.
 *
 * ## Usage
 *
 *     # build once
 *     npm run build
 *     npx vite preview --port 5310 --strictPort
 *
 *     # the calibration run, on the same build with no probe at all
 *     npx tsx scripts/measure-geometry.ts --slug m1-kuhn-spya-a2zrjb \
 *       --url http://localhost:5310 --baseline \
 *       --local-sign-in --sign-in-via http://localhost:5275 \
 *       --email dev-admin@spideryarn.local
 *
 *     # the decision run: three sessions, six repetitions, one discarded
 *     npx tsx scripts/measure-geometry.ts --slug m1-kuhn-spya-a2zrjb \
 *       --url http://localhost:5310 --sessions 3 --repeats 6 --warmup 1 \
 *       --local-sign-in --sign-in-via http://localhost:5275 \
 *       --email dev-admin@spideryarn.local --json /tmp/geo-kuhn.json
 *
 * The box is heavily contended, so **at least three sessions per
 * configuration**, compared at the median — the spike needed three to see
 * through the noise, and this repo's standing note is that a slow result here
 * is usually the box.
 */
import { writeFileSync } from "node:fs";

import { chromium } from "playwright-core";
import type { Browser, BrowserContext, CDPSession, Page } from "playwright-core";

import { isMain } from "../src/is-main.js";
import { chromePath } from "./browser-sign-in.js";
import { localMagicLink } from "./seed-local-session.js";

/* ------------------------------------------------------------- the sites --
   The contract src/web/geometry-cost.ts publishes, restated here as two
   disjoint tuples. The split is not decorative: a leaf runs inside a parent's
   timed interval, so the two kinds are never summed and there is no function
   below that could. */

/** Inclusive intervals, timed in every mode. */
export const PARENT_SITES = [
  "readingPosition",
  "columnContext",
  "diagramReaderRow",
  "contextPanelPlace",
  "spineMeasure",
  "spineApply",
  "barVisibility",
] as const;

/** Counted always, timed only in `"full"` — and `"full"` perturbs the parent
 *  it sits inside, so its ms are diagnostic and never decisive. */
export const LEAF_SITES = ["stickyOffset", "safeAreaInsets", "measureRow"] as const;

export type ParentSite = (typeof PARENT_SITES)[number];
export type LeafSite = (typeof LEAF_SITES)[number];
export type GeometrySite = ParentSite | LeafSite;

/**
 * The two consumers whose duplicated section-top scan is what A8 would change,
 * and **the only sites whose combined cost may authorise Stage 3** (Sol F4).
 * Every other instrumented site is diagnostic.
 */
export const PILOT_SITES = ["readingPosition", "columnContext"] as const;
export type PilotSite = (typeof PILOT_SITES)[number];

/**
 * One site's numbers, exactly as `geometryCost()` hands them out.
 *
 * `writes` is the field that decides Sol's F8: `ContextPanel.place` reads four
 * geometry properties and then **writes `p.scrollTop`**, once per mounted gist
 * panel, and the plan needs to know whether that interleave is real here rather
 * than inferred from call order. A site with `writes > 0` inside a frame that
 * other sites also read in is where a forced reflow would live, so it is
 * printed on its own line and never folded into a total.
 *
 * `since` is optional because the implementation does not publish it. A field
 * this file merely *read* would be an undefined it silently formatted as 0.
 */
export interface GeometryTally {
  calls: number;
  reads: number;
  writes: number;
  ms: number;
  samples: number[];
}

/** The snapshot. `mode` first, always — it says whether the rest means
 *  anything, the same way `annotationCost().mode` does. */
export type GeometryCost = Record<GeometrySite, GeometryTally> & {
  mode: "off" | "counts" | "full";
  since?: number;
};

const EMPTY_TALLY: GeometryTally = { calls: 0, reads: 0, writes: 0, ms: 0, samples: [] };

/**
 * The partition, re-checked at run time.
 *
 * The type system already refuses a mixed list, but a union widened in a later
 * edit would silently move a site from one kind to the other and every sum in
 * the report would quietly start double-counting. So the invariant is asserted
 * rather than assumed: disjoint, and the pilot inside the parents.
 */
export function assertSiteKinds(): void {
  const leaves = new Set<string>(LEAF_SITES);
  const overlap = PARENT_SITES.filter((s) => leaves.has(s));
  if (overlap.length > 0) {
    throw new Error(
      `${overlap.join(", ")} is listed as both a parent and a leaf — a leaf runs ` +
        "inside its parent's timed interval, so any sum over both double-counts",
    );
  }
  const parents = new Set<string>(PARENT_SITES);
  const stray = PILOT_SITES.filter((s) => !parents.has(s));
  if (stray.length > 0) {
    throw new Error(`pilot site(s) ${stray.join(", ")} are not parent sites`);
  }
}

/** A site's tally, or a zero one — with the miss recorded, never swallowed. */
function tally(cost: GeometryCost, site: GeometrySite, missing?: Set<string>): GeometryTally {
  const t = (cost as Partial<Record<GeometrySite, GeometryTally>>)[site];
  if (!t) {
    missing?.add(site);
    return EMPTY_TALLY;
  }
  return t;
}

/**
 * Every layout read the frame performed, summed across all ten sites.
 *
 * **`reads` is exclusive where `ms` is inclusive, and this asymmetry is the
 * instrument's, not an accident of this file.** A parent counts only the reads
 * it performs *itself*; a nested leaf owns its own. So the ten `reads` numbers
 * add up to the real total with nothing double-counted — which is exactly what
 * the ten `ms` numbers must never do, and why there is a `totalReads` here and
 * no `totalMs` anywhere.
 *
 * Two consequences worth stating before anybody reads a zero as a fault:
 *
 * - `diagramReaderRow` reports **0 reads** and that is the accounting working.
 *   Everything it causes happens inside `measureRow`, which owns those reads.
 * - This total is an upper bound on *work*, not a count of *reflows*. Inside
 *   one rAF callback with no interleaved write, `S` rect reads cost **one**
 *   forced layout plus `S` cheap lookups. Quote it as a diagnostic; quote
 *   `LayoutCount` for how many flushes there were.
 */
export function totalReads(cost: GeometryCost): number {
  let reads = 0;
  for (const s of [...PARENT_SITES, ...LEAF_SITES]) reads += tally(cost, s).reads;
  return reads;
}

/**
 * The pilot's non-overlapping cost: the two duplicated section-top scans.
 *
 * **This is the only function in this file that adds two buckets together.**
 * Its argument type admits nothing but the pilot pair, both of which are
 * parents and neither of which runs inside the other — they are separate rAF
 * callbacks on the same scroll. There is deliberately no general
 * `sum(cost, sites)`: that function is how a leaf gets added to its parent.
 */
export function pilotMs(cost: GeometryCost, sites: readonly PilotSite[] = PILOT_SITES): number {
  let ms = 0;
  for (const s of sites) ms += tally(cost, s).ms;
  return ms;
}

/** Per-call ms for the pilot pair, concatenated — the vector p50/p95/max come
 *  from. Concatenated rather than summed: they are separate calls. */
export function pilotSamples(cost: GeometryCost): number[] {
  return PILOT_SITES.flatMap((s) => tally(cost, s).samples);
}

/**
 * **The number the decision rule is applied to**, and it is not the per-call
 * time and not the per-gesture total.
 *
 * The plan's clause 1 reads *"the p50 scroll frame spends ≥ 4ms in the two
 * pilot samplers"* — a **frame**, in which each of the two samplers runs at
 * most once. So the quantity is the pair's total for the gesture divided by
 * the frames the browser actually served during it. Dividing by the sampler's
 * own call count instead would flatter a run in which the samplers ran more
 * often than the page painted, and dividing by nothing at all gives a
 * per-gesture figure that grows with how long you scrolled.
 *
 * NaN when no frame was served, which is a repetition `suspectReason` has
 * already thrown out.
 */
export function pilotMsPerFrame(cost: GeometryCost, framesServed: number): number {
  return framesServed > 0 ? pilotMs(cost) / framesServed : Number.NaN;
}

/**
 * The same quantity over the frames the samplers actually ran in, rather than
 * over every frame the browser served.
 *
 * Both are reported and neither is dropped, because the clause says *"the p50
 * **scroll** frame"* and the two denominators disagree about what that is. The
 * settling half-second after the last wheel serves frames in which nothing
 * scrolls and the samplers do not run, so dividing by served frames dilutes
 * the figure; dividing by sampler calls answers "what does a frame *in which
 * the reader is scrolling* cost", which is the clause's plain reading and the
 * stricter of the two. A rAF-batched sampler runs at most once per frame, so
 * this can only ever be the larger number — quote it, and print the other one
 * beside it so the dilution is visible rather than argued about.
 */
export function pilotMsPerSamplingFrame(cost: GeometryCost): number {
  const calls = Math.max(...PILOT_SITES.map((s) => tally(cost, s).calls));
  return calls > 0 ? pilotMs(cost) / calls : Number.NaN;
}

/**
 * Clause 2: what fraction of the wall clock the two pilot samplers occupied.
 *
 * A7's definition, kept exactly: total sampler ms over wall time from the
 * first scroll event to the final painted frame — the denominator is wall
 * time and the numerator is the sum over however many frames actually ran,
 * never per-frame arithmetic.
 */
export function pilotDutyCycle(cost: GeometryCost, wallMs: number): number {
  return wallMs > 0 ? (pilotMs(cost) / wallMs) * 100 : Number.NaN;
}

/* --------------------------------------------------------------- numbers -- */

/** Nearest-rank percentile. NaN for an empty vector, which no comparison
 *  reads as a good number. */
export function pct(xs: readonly number[], p: number): number {
  if (xs.length === 0) return Number.NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))] ?? Number.NaN;
}

export const median = (xs: readonly number[]): number => pct(xs, 50);
const maxOf = (xs: readonly number[]): number => (xs.length === 0 ? Number.NaN : Math.max(...xs));
const num = (n: number, places = 2): string => (Number.isFinite(n) ? n.toFixed(places) : "—");

/**
 * Frame intervals that missed the refresh.
 *
 * Not "over 16.7ms": the machine's real cadence is measured rather than
 * assumed (`--baseline` records it), and a box under load can serve 30Hz all
 * afternoon without anything in the page being at fault. `budgetMs` is that
 * measured cadence, and an interval is counted as dropped when it exceeds
 * 1.5× of it — one whole frame late.
 */
export function droppedFrames(intervals: readonly number[], budgetMs: number): number {
  return intervals.filter((ms) => ms > budgetMs * 1.5).length;
}

/* ------------------------------------------------------------ CDP metrics --
   Chrome's own accounting, which is the half a self-timer cannot supply. */

export interface LayoutMetrics {
  LayoutCount: number;
  LayoutDuration: number;
  RecalcStyleCount: number;
  RecalcStyleDuration: number;
  TaskDuration: number;
}

const METRIC_NAMES = [
  "LayoutCount",
  "LayoutDuration",
  "RecalcStyleCount",
  "RecalcStyleDuration",
  "TaskDuration",
] as const;

const ZERO_METRICS: LayoutMetrics = {
  LayoutCount: 0,
  LayoutDuration: 0,
  RecalcStyleCount: 0,
  RecalcStyleDuration: 0,
  TaskDuration: 0,
};

async function readMetrics(cdp: CDPSession): Promise<LayoutMetrics> {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const by = new Map(metrics.map((m): [string, number] => [m.name, m.value]));
  const out = { ...ZERO_METRICS };
  for (const name of METRIC_NAMES) out[name] = by.get(name) ?? 0;
  return out;
}

/**
 * After minus before, with the two `*Duration` fields turned into
 * milliseconds — CDP reports them in seconds, and a table mixing the two units
 * is a table nobody can read.
 */
export function metricsDelta(before: LayoutMetrics, after: LayoutMetrics): LayoutMetrics {
  return {
    LayoutCount: after.LayoutCount - before.LayoutCount,
    RecalcStyleCount: after.RecalcStyleCount - before.RecalcStyleCount,
    LayoutDuration: (after.LayoutDuration - before.LayoutDuration) * 1000,
    RecalcStyleDuration: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000,
    TaskDuration: (after.TaskDuration - before.TaskDuration) * 1000,
  };
}

/* ------------------------------------------------------- the page's side --
   Every one of these is a string. See the header.

   `__geoRun` is the harness's own namespace, injected after each navigation,
   and it is deliberately not part of the app: it records frame intervals, which
   the page has no reason to know about. It calls `requestAnimationFrame`, which
   src/web/perf.ts patches under `?perf=1`, so its own ticks land in
   `__perf.state.*.frames`. Disclosed rather than corrected: the alternative is
   an unpatched frame source the app does not have. */

const INSTALL_RECORDER = `(() => {
  const st = { frames: [], on: false, last: 0, id: 0 };
  window.__geoRun = {
    start() {
      st.frames = [];
      st.last = performance.now();
      st.on = true;
      const tick = (t) => {
        st.frames.push(t - st.last);
        st.last = t;
        if (st.on) st.id = requestAnimationFrame(tick);
      };
      st.id = requestAnimationFrame(tick);
    },
    stop() {
      st.on = false;
      cancelAnimationFrame(st.id);
      return st.frames.slice();
    },
  };
  return 'ok';
})()`;

/** Renders seen by `useRenderCount`, from a probe that knows nothing about
 *  geometry — a witness of a different kind, exactly as A7 used it. */
const RENDERS = `(window.__perf ? window.__perf.state.visible.renders + window.__perf.state.hidden.renders : 0)`;

/** Reset the counters and open the window. Instrumented runs only. */
const OPEN_WINDOW = `JSON.stringify((() => {
  if (window.__perf && window.__perf.resetGeometryCost) window.__perf.resetGeometryCost();
  window.__geoRun.start();
  return { t0: performance.now(), scrollY: window.scrollY, renders: ${RENDERS} };
})())`;

/** Close it and take everything at once, so nothing lands between the reads. */
const CLOSE_WINDOW = `JSON.stringify((() => {
  const frames = window.__geoRun.stop();
  return {
    t1: performance.now(),
    scrollY: window.scrollY,
    frames,
    renders: ${RENDERS},
    cost: (window.__perf && window.__perf.geometryCost) ? window.__perf.geometryCost() : null,
  };
})())`;

interface OpenReading {
  t0: number;
  scrollY: number;
  renders: number;
}

interface CloseReading {
  t1: number;
  scrollY: number;
  frames: number[];
  renders: number;
  cost: GeometryCost | null;
}

/** `page.evaluate` with the result parsed. The expression must be a string and
 *  must return a JSON string — see the header. */
async function evalJson<T>(page: Page, code: string): Promise<T> {
  const raw = await page.evaluate<string>(code);
  return JSON.parse(raw) as T;
}

/* ------------------------------------------------------------ population -- */

/**
 * What is actually on the loaded page.
 *
 * `sections` has two independent readings on purpose. `sectionCells` counts
 * `<td>` at the section depth, which only exist while that gist column is on
 * screen; `readsPerCall` comes from the instrument and is one rect read per
 * section plus the sticky-line reads, whatever the columns are doing. Two
 * methods that share no assumption is what makes a number evidence rather than
 * a restatement (docs/reusable/silent-success.md).
 */
export interface Population {
  blocks: number;
  totalNodes: number;
  /** Depths whose gist column header is in the DOM — where `useColumnContext`
   *  reads its rectangles from. Empty means the fisheye has no geometry. */
  gistColumns: number[];
  /** The prose column's `data-nav-depth`, i.e. `geometry.leafDepth`. */
  leafDepth: number;
  /** `max(1, leafDepth - 1)` — position.ts § `sectionDepth`. */
  sectionDepth: number;
  /**
   * `<td>` cells at the section depth, or 0 when that column is off.
   *
   * An **upper bound** on `sections.length`, not an equal: `buildSections`
   * runs the column through `navigableItems`, which collapses a run of
   * supplements — forty endnote cells become one section called "Notes"
   * (position.ts). On an article with no supplements the two agree exactly
   * (m1-kuhn: 1,237 cells, 1,238 reads per call including the sticky line);
   * on `replication-crisis` the DOM has 327 cells over 51 sections, and that
   * gap is the collapsing rather than a fault in either witness.
   */
  sectionCells: number;
  /** The reading table's own class list, and every `<th>` in its head with the
   *  attributes the two geometry consumers key off. Printed because "no gist
   *  columns" has two very different causes — the fit dropped them, or the page
   *  is not the reading table at all — and the population line is the only
   *  place that difference is visible before the numbers are believed. */
  tableClass: string;
  headCells: string[];
  /** Comment marks in the prose — `comment-open` measures nothing without one. */
  commentMarks: number;
  /** Whether the probe and the geometry instrument are live, and in what mode. */
  perf: boolean;
  geometry: boolean;
  mode: string | null;
  /** The account the page thinks it is. A 404 for the wrong owner renders
   *  fast and reports beautifully; A7 lost time to exactly that. */
  signedInAs: string | null;
}

const POPULATION = `JSON.stringify((() => {
  const leafHead = document.querySelector('thead th.text[data-nav-depth]');
  const cols = [...document.querySelectorAll('thead th[data-col]')]
    .map((th) => Number(th.getAttribute('data-col')))
    .filter((n) => Number.isInteger(n));
  const navDepths = [...document.querySelectorAll('[data-nav-depth]')]
    .map((el) => Number(el.getAttribute('data-nav-depth')))
    .filter((n) => Number.isInteger(n));
  const leafDepth = leafHead
    ? Number(leafHead.getAttribute('data-nav-depth'))
    : (navDepths.length ? Math.max(...navDepths) : 0);
  const sectionDepth = Math.max(1, leafDepth - 1);
  let who = null;
  try {
    who = localStorage.getItem('spideryarn.lastUser');
  } catch (e) { who = null; }
  const g = window.__perf && window.__perf.geometryCost;
  return {
    blocks: document.querySelectorAll('tr[data-block]').length,
    totalNodes: document.querySelectorAll('*').length,
    gistColumns: cols,
    leafDepth,
    sectionDepth,
    sectionCells: document.querySelectorAll('td[data-nav-depth="' + sectionDepth + '"]').length,
    commentMarks: document.querySelectorAll('mark[data-comment]').length,
    tableClass: document.querySelector('table.zoom')?.className ?? '(no table.zoom)',
    headCells: [...document.querySelectorAll('thead th')].map((th) =>
      (th.className || '(no class)') + '/col=' + th.getAttribute('data-col') +
      '/nav=' + th.getAttribute('data-nav-depth')),
    perf: !!window.__perf,
    geometry: !!g,
    mode: g ? window.__perf.geometryCost().mode : null,
    signedInAs: who,
  };
})())`;

/**
 * Refuse, in words, when the page cannot carry a measurement.
 *
 * Pure, so the refusals can be reasoned about without a browser — and so the
 * one that matters most, *the instrument is not there*, is a sentence rather
 * than a stack trace.
 */
export function populationVerdict(p: Population, baseline: boolean): string | null {
  if (p.blocks === 0 || p.totalNodes === 0) {
    return (
      `the page rendered ${p.blocks} blocks and ${p.totalNodes} nodes — refusing to time ` +
      "anything over it. A signed-out page, or one signed in as the wrong owner, renders " +
      "a 404 fast and reports beautiful numbers for a page that does not exist."
    );
  }
  if (baseline) return null;
  if (!p.perf) {
    return (
      "window.__perf is not defined — nothing was measured. It is switched on by ?perf=1, " +
      "which this script appends; if it is still absent the page is not the reading view, " +
      "or the build predates src/web/perf.ts § startPerf."
    );
  }
  if (!p.geometry) {
    return (
      "window.__perf.geometryCost is missing — the geometry instrument is not in this build.\n" +
      "  It is src/web/geometry-cost.ts, exposed through src/web/perf.ts, and its contract is\n" +
      "    geometryCost() / resetGeometryCost() / setGeometryCostMode('off'|'counts'|'full')\n" +
      "  There is deliberately no fallback here: a plausible-looking number from a stub is\n" +
      "  worse than no number at all. Rebuild once the instrument has landed."
    );
  }
  if (p.mode === "off") {
    return (
      'the geometry instrument reports mode "off" — every bucket would be a zero that ' +
      "means nothing. Call setGeometryCostMode('counts')."
    );
  }
  return null;
}

/* ---------------------------------------------------------- the gestures -- */

/** Where a pinned scroll starts from. Reported separately, never averaged. */
export type ScrollStart = "top" | "middle";

/**
 * The pinned scroll, in full. Every field is recorded in the output, because a
 * gesture that varied in any of them gives a run-to-run range that swamps the
 * effect being measured.
 */
export interface PinnedScroll {
  start: ScrollStart;
  /** Wheel delta per step, px. */
  deltaY: number;
  steps: number;
  /** Requested wall gap between wheels, ms. The achieved one is measured. */
  cadenceMs: number;
  /** How long after the last wheel the recorder keeps running. */
  settleMs: number;
}

/**
 * The gesture, fixed here rather than on the command line — a workload a caller
 * can vary is a workload two runs cannot be compared across.
 *
 * Thirty wheels of 100px is 3,000px, about three screenfuls on the desktop
 * viewport: a reader's flick down a long article rather than a synthetic
 * flight. The requested 16ms cadence is one wheel per refresh; on this box each
 * dispatch actually takes far longer than that because Chrome acks it on the
 * main thread and the main thread is busy, which is why the **achieved**
 * cadence is measured and reported next to the requested one rather than
 * assumed.
 */
const PINNED: Omit<PinnedScroll, "start"> = {
  deltaY: 100,
  steps: 30,
  cadenceMs: 16,
  settleMs: 500,
};

/** Total travel the gesture asks for. */
export const pinnedDistance = (s: Pick<PinnedScroll, "deltaY" | "steps">): number =>
  s.deltaY * s.steps;

/**
 * A repetition of the scroll that is not the pinned gesture, or null.
 *
 * The article running out is the case this catches: the wheels are dispatched,
 * the page stops moving, and the repetition is shorter than the one before it.
 * That is a different gesture, so it is kept out of every median rather than
 * averaged with the real ones.
 */
export function scrollVerdict(travelled: number, wanted: number): string | null {
  if (travelled <= 0) {
    return `the page did not move (${travelled}px) — the wheel reached nothing scrollable`;
  }
  if (travelled < wanted * 0.8) {
    return (
      `travelled ${Math.round(travelled)}px of the pinned ${wanted}px — the article ran out, ` +
      "so this is not the same gesture as the other repetitions"
    );
  }
  return null;
}

/**
 * One discrete gesture: a press, and what must become true afterwards.
 *
 * The same shape as measure-annotation.ts's `Effect`, and for the same reason —
 * a gesture that did nothing costs nothing and reads as a fast one. The
 * predicate lives here in TypeScript rather than inside the `evaluate` string
 * so it can be checked without running a browser.
 */
export interface Discrete {
  readonly label: string;
  /** Appended after `?perf=1`. */
  readonly query: string;
  /** Waited for after navigating; absent means the page never got there. */
  readonly waitFor: string;
  /** Why this gesture is meaningless on this page, or null. */
  readonly refuseIf: (p: Population) => string | null;
  /**
   * Statements that put the page into the state the gesture starts from,
   * **outside** the timed region. May await as much as it likes.
   *
   * `comment-open` is why this exists. Without it the second repetition
   * presses a mark whose comment is already open, which closes it — `grew`
   * correctly fails, and five of six repetitions are thrown away. Closing
   * first, untimed, makes every repetition an *open* rather than a toggle.
   */
  readonly setup?: string;
  /** In-page expression read either side, and the pure judgment over the two. */
  readonly probe: string;
  readonly describe: string;
  readonly happened: (before: string, after: string) => boolean;
  /** Statements that re-query the target and press it. No awaits before the
   *  dispatch — a reference carried across a paint can be detached, and a
   *  dispatch at a detached node is a successful call that does nothing. */
  readonly act: (i: number) => string;
}

const moved = (before: string, after: string): boolean => after !== before;
const grew = (before: string, after: string): boolean => Number(after) > Number(before);

/** Which gist columns are on, as a sorted list — the granularity toggle's
 *  effect, and a set rather than a count because a press can add or remove. */
const COLUMNS_ON = `JSON.stringify([...document.querySelectorAll('thead th[data-col]')]
  .map((th) => th.getAttribute('data-col')).sort())`;

/** Which mode owns the band, from the pressed radio in the Dock. */
const MODE_ON = `String(document.querySelector('.dock-modes button[aria-checked="true"]')
  ?.getAttribute('aria-label') ?? '(none)')`;

/** How many comment marks are drawn as pressed — src/web/annotate.ts sets
 *  `data-cmt-open` on exactly the mark whose comment is open. */
const OPEN_COMMENTS = `String(document.querySelectorAll('mark[data-cmt-open]').length)`;

export const DISCRETE: Readonly<Record<string, Discrete>> = {
  "column-toggle": {
    label: "toggle a granularity column",
    /* **`mode=hierarchy`, always**, whatever `--view` says. The pills render
       under `{!inMode && …}` and `inMode` is `mode !== "hierarchy"`
       (App.tsx), so in every other mode — the default `plain` included —
       there is no pill to press and the gesture would time a click on
       nothing. */
    query: "mode=hierarchy",
    waitFor: ".controls button",
    refuseIf: (p) =>
      p.leafDepth < 2 ? "the tree is too shallow to have a gist column to toggle" : null,
    probe: COLUMNS_ON,
    describe: "the set of gist columns on screen changes",
    happened: moved,
    /* The first pill, pressed repeatedly: odd repetitions take a column away
       and even ones put it back, so every repetition is a real layout change
       and none of them is a no-op. */
    act: () => `
      const pills = document.querySelectorAll('.controls button[data-state]');
      const el = pills[0];
      if (!el) return JSON.stringify({ error: 'no granularity pill in .controls' });
      if (!el.isConnected) return JSON.stringify({ error: 'the pill is detached' });
      el.click();`,
  },
  "mode-switch": {
    label: "switch the mode the band shows",
    query: "",
    waitFor: ".dock-modes button",
    refuseIf: () => null,
    probe: MODE_ON,
    describe: "the pressed mode in the Dock changes",
    happened: moved,
    /* Alternating between two neighbours, so every repetition is a switch
       rather than a press on the mode already showing. */
    act: (i) => `
      const btns = [...document.querySelectorAll('.dock-modes button[role="radio"]')];
      const off = btns.filter((b) => b.getAttribute('aria-checked') !== 'true');
      const el = off[${i % 2} % Math.max(1, off.length)];
      if (!el) return JSON.stringify({ error: 'no unpressed mode button in the Dock' });
      if (!el.isConnected) return JSON.stringify({ error: 'the mode button is detached' });
      el.click();`,
  },
  "comment-open": {
    label: "open a comment",
    query: "",
    waitFor: "tr[data-block]",
    refuseIf: (p) => (p.commentMarks === 0 ? "the article has no stored comments" : null),
    probe: OPEN_COMMENTS,
    describe: "a mark[data-cmt-open] appears",
    happened: grew,
    /* Untimed, and before the `before` reading is taken: every repetition then
       times an **open** rather than a toggle. The settle is A7's — the dialog
       and its re-annotation land after the paint. */
    setup: `
      document.querySelector('.cmt-close')?.click();
      await nextPaint();
      await new Promise((r) => setTimeout(r, 250));`,
    /* `mouseup`, which is the event the mark listens for, and the close is in
       `act` rather than a setup so the grab happens after it — closing
       replaces the very node the dispatch aims at, and grabbing first produced
       A7's vector of alternating real samples and exact zeroes. */
    act: () => `
      const el = document.querySelector('mark[data-comment]');
      if (!el) return JSON.stringify({ error: 'the article has no stored comments' });
      if (!el.isConnected) return JSON.stringify({ error: 'the comment mark is detached' });
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));`,
  },
};

const DEFAULT_DISCRETE = ["column-toggle", "mode-switch", "comment-open"];

/* ------------------------------------------------------------- one sample -- */

/** Everything one repetition produced. */
export interface Sample {
  rep: number;
  /** Wall clock across the gesture, from the page's own clock. */
  ms: number;
  cost: GeometryCost | null;
  metrics: LayoutMetrics;
  /** Every frame interval inside the window, in order. */
  frames: number[];
  /** How far the page actually moved. 0 for a discrete gesture. */
  travelled: number;
  /** Achieved wall gap between wheels, ms — 0 for a discrete gesture. */
  achievedCadenceMs: number;
  renders: number;
  before: string;
  after: string;
}

export interface Failed {
  rep: number;
  error: string;
}

export type Attempt = Sample | Failed;
export const failed = (a: Attempt): a is Failed => "error" in a;

/**
 * Why this repetition may not be quoted, or null.
 *
 * Pure and exported so the rules can be tested without a browser. Every one of
 * them is a way a gesture can cost nothing by not happening.
 */
export function suspectReason(s: Sample, wantedPx: number): string | null {
  if (s.frames.length === 0) {
    return "the recorder saw no animation frame at all — nothing was rendered during it";
  }
  if (wantedPx > 0) return scrollVerdict(s.travelled, wantedPx);
  if (s.renders === 0) {
    return "window.__perf counted no React render, so nothing reacted to the press";
  }
  return null;
}

export interface Classified {
  samples: Sample[];
  suspect: Map<number, string>;
  failures: Failed[];
  warmups: Set<number>;
  warmed: Sample[];
}

export function classify(attempts: Attempt[], warmup: number, wantedPx: number): Classified {
  const failures = attempts.filter(failed);
  const samples = attempts.filter((a): a is Sample => !failed(a));
  const suspect = new Map<number, string>();
  for (const s of samples) {
    const why = suspectReason(s, wantedPx);
    if (why) suspect.set(s.rep, why);
  }
  /* Warm-ups counted among the *confirmed* samples rather than by repetition
     number, so a failed first attempt cannot silently promote a cold run into
     the summary. A7's rule, kept. */
  const warmups = new Set(samples.slice(0, warmup).map((s) => s.rep));
  const warmed = samples.filter((s) => !warmups.has(s.rep) && !suspect.has(s.rep));
  return { samples, suspect, failures, warmups, warmed };
}

/* ------------------------------------------------------------- the driver -- */

const flag = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next === undefined || next.startsWith("--") ? fallback : next;
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);

/** Refuse to carry a real session anywhere but this machine — parsed hostname
 *  rather than a substring, because `http://localhost.attacker.example/`
 *  contains "localhost" and is not it. */
function assertLocalOrigin(u: string, flagName: string): void {
  const { hostname, protocol } = new URL(u);
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  if (!local || (protocol !== "http:" && protocol !== "https:")) {
    throw new Error(
      `${flagName} points at ${u} — a session may only be carried between local origins`,
    );
  }
}

export interface Viewport {
  name: string;
  width: number;
  height: number;
}

/** Desktop, and a phone small enough to match `(max-width: 731px)` — which is
 *  the media query `watchBarVisibility` attaches under (scroll.ts
 *  § `SMALL_DEVICE`). On a laptop that listener is not there at all, so the
 *  read/write interleave it would cause cannot be measured on one. */
export const VIEWPORTS: Readonly<Record<string, Viewport>> = {
  desktop: { name: "desktop", width: 1280, height: 900 },
  phone: { name: "phone", width: 390, height: 844 },
};

function namedViewports(csv: string): Viewport[] {
  return csv
    .split(",")
    .filter(Boolean)
    .map((n) => {
      const v = VIEWPORTS[n];
      if (!v) throw new Error(`unknown viewport ${n} — known: ${Object.keys(VIEWPORTS).join(", ")}`);
      return v;
    });
}

function namedGestures(csv: string): string[] {
  const wanted = csv.split(",").filter(Boolean);
  const unknown = wanted.filter((g) => !(g in DISCRETE));
  if (unknown.length > 0) {
    throw new Error(
      `unknown gesture(s) ${unknown.join(", ")} — known: ${Object.keys(DISCRETE).join(", ")}`,
    );
  }
  return wanted;
}

interface Options {
  slug: string;
  base: string;
  via: string;
  repeats: number;
  warmup: number;
  sessions: number;
  mode: "counts" | "full";
  baseline: boolean;
  /** Land, print the population, and stop. Seconds rather than minutes, and
   *  the only thing worth doing first: a workload that is not what you think
   *  it is produces a whole run of numbers about the wrong page. */
  populationOnly: boolean;
  viewports: Viewport[];
  discrete: string[];
  cols: string;
  /**
   * Which mode owns the band while the scroll is measured.
   *
   * **This is not cosmetic and it decides half the pilot.** `plain` is the
   * default reading view — the article on its own since 2026-08-31 — and
   * App.tsx § `plainCols` hands `fitView` an empty `chosen` in it, which
   * *overrides* `?cols=` outright. So in the view a reader lands on there are
   * no gist columns, `useColumnContext` is not enabled, and its bucket is a
   * legitimate zero. The duplicated section-top scan A8 is about exists in
   * `hierarchy` (gist columns) and in `outline` (via `outlineLive`), and
   * nowhere else.
   *
   * Hence the default here is `hierarchy` rather than the reader's default:
   * a run that measured `plain` would report that the duplication costs
   * nothing, which is true and is not an answer to the question. Measure
   * `plain` deliberately, as its own run, and say which one a number came from.
   */
  view: string;
  json: string;
}

function options(): Options {
  const slug = flag("slug", "");
  if (!slug) throw new Error("--slug is required — which article to measure");
  const base = flag("url", "http://localhost:5310").replace(/\/$/, "");
  new URL(base); // throws on a --url that is not one
  const repeats = Number(flag("repeats", "6"));
  const warmup = Number(flag("warmup", "1"));
  const sessions = Number(flag("sessions", "1"));
  const mode = flag("mode", "counts");
  if (!Number.isInteger(repeats) || repeats < 1) throw new Error(`--repeats ${repeats} is not a count`);
  if (!Number.isInteger(warmup) || warmup < 0) throw new Error(`--warmup ${warmup} is not a count`);
  if (warmup >= repeats) {
    throw new Error(`--warmup ${warmup} discards every one of --repeats ${repeats}`);
  }
  if (!Number.isInteger(sessions) || sessions < 1) throw new Error(`--sessions ${sessions} is not a count`);
  if (mode !== "counts" && mode !== "full") {
    throw new Error(`--mode ${mode} is neither "counts" nor "full"`);
  }
  const viewports = namedViewports(flag("viewports", "desktop,phone"));
  const discrete = namedGestures(flag("gestures", DEFAULT_DISCRETE.join(",")));
  return {
    slug,
    base,
    via: flag("sign-in-via", ""),
    repeats,
    warmup,
    sessions,
    mode,
    baseline: has("baseline"),
    populationOnly: has("population-only"),
    viewports,
    discrete,
    /* `auto` leaves `?cols=` off, which is what a reader normally has: the
       app fits columns to the window (layout.ts). A literal list forces them,
       and is how a phone-sized viewport can be made to show gist columns it
       would otherwise drop. It matters because `useColumnContext` measures
       nothing while every gist column is off — half the pilot would report a
       comfortable zero for having been switched off rather than for being
       cheap, which the population line and the control both call out. */
    cols: flag("cols", "auto"),
    view: flag("view", "hierarchy"),
    json: has("json") ? flag("json", "") : "",
  };
}

/**
 * Sign in on a dev-server origin and carry the session to where we measure.
 *
 * The dev server is needed because the trick imports `/src/web/lib/supabase.ts`
 * so the app's own SDK stores the session in the shape its own version reads,
 * and only a dev server serves a module at its source path — `vite preview`
 * throws. Both origins are asserted local separately, because they are
 * separately dangerous. Copied from measure-annotation.ts, which copied it from
 * measure-cpu.ts, where the reasoning is written out at length.
 */
async function signInAndCarry(page: Page, o: Options, hashedToken: string): Promise<void> {
  /* One token, one session — see `mintToken`. */
  const origin = new URL(o.via || o.base).origin;
  assertLocalOrigin(origin, o.via ? "--sign-in-via" : "--url");
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  const said = await page.evaluate<string>(`(async () => {
    try {
      const m = await import('/src/web/lib/supabase.ts');
      const r = await m.supabase.auth.verifyOtp({
        type: 'magiclink', token_hash: ${JSON.stringify(hashedToken)} });
      if (r.error) return 'error: ' + r.error.message;
      return r.data.session ? 'ok:' + (r.data.user?.email ?? '?') : 'no session';
    } catch (e) { return 'threw: ' + (e && e.message); }
  })()`);
  if (!said.startsWith("ok:")) {
    throw new Error(
      `local sign-in failed — ${said}\n` +
        "  This step needs a **dev server** origin: it imports the app's own SDK at\n" +
        "  /src/web/lib/supabase.ts, which `vite preview` does not serve. Pass\n" +
        "  --sign-in-via <dev origin> when --url is a preview build.",
    );
  }
  console.log(`signed in locally (${said.slice(3)})`);

  const target = new URL(o.base).origin;
  if (origin === target) return;
  assertLocalOrigin(target, "--url");
  const dump = await page.evaluate<string>(
    `JSON.stringify(Object.fromEntries(Object.entries(localStorage)
      .filter(([k]) => k.startsWith('sb-') || k === 'spideryarn.lastUser')))`,
  );
  const carried = JSON.parse(dump) as Record<string, string>;
  if (Object.keys(carried).length === 0) {
    throw new Error("nothing to carry — the SDK stored no session");
  }
  await page.goto(`${target}/favicon.ico`, { waitUntil: "domcontentloaded" });
  await page.evaluate(`(() => { const s = ${JSON.stringify(JSON.stringify(carried))};
    for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); })()`);
  console.log(`carried ${Object.keys(carried).length} storage keys to ${target}`);
}

/** The query string for a run: the probe, the columns, and the gesture's own. */
function readUrl(o: Options, extra: string): string {
  /* A map rather than a list, so a gesture's own `mode=` **replaces** the
     run's rather than appending a second one — two `mode=` params in a query
     string is a coin toss over which the app reads. */
  const q = new Map<string, string>();
  if (!o.baseline) q.set("perf", "1");
  if (o.view !== "plain") q.set("mode", o.view);
  if (o.cols !== "auto") q.set("cols", o.cols);
  for (const pair of extra.split("&").filter(Boolean)) {
    const at = pair.indexOf("=");
    q.set(at === -1 ? pair : pair.slice(0, at), at === -1 ? "" : pair.slice(at + 1));
  }
  /* Written out rather than percent-encoded: `?cols=1,2` is a URL a person
     pastes, and nuqs parses the comma either way. */
  const query = [...q].map(([k, v]) => (v === "" ? k : `${k}=${v}`)).join("&");
  return `${o.base}/read/${o.slug}${query ? `?${query}` : ""}`;
}

/**
 * Load the article, install the recorder, and count what is on the page.
 *
 * The settle is not a nicety: the app finishes after first paint — fetches
 * land, memos re-run — and measuring through that measures the page load,
 * which is the easiest way to measure the wrong thing.
 */
async function landAndCount(page: Page, url: string, waitFor: string): Promise<Population> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  } catch (e) {
    throw new Error(
      `could not reach ${url} — ${(e as Error).message}\n` +
        "  Is `vite preview` running, and on that port?",
    );
  }
  /* Five minutes, and that is not paranoia. `GET /api/article/<heavy slug>`
     was measured at 11.9s and 20.5s against the local Postgres on this box
     before React has laid out a single one of 2,046 rows, and the box's load
     average moved from 43 to 110 inside twenty minutes while other agents
     worked. A 45-second wait failed a run that was working; so did 120s. The
     cost of a generous wait is a slow failure, and the cost of a mean one is
     three sessions thrown away. */
  await page.waitForSelector(waitFor, { timeout: 300_000 }).catch(() => {
    throw new Error(
      `${url} never rendered ${waitFor}.\n` +
        "  A signed-out page, and a page signed in as the wrong owner, both render fine\n" +
        "  and cost nothing — which reads as a good result. Pass --local-sign-in\n" +
        "  --sign-in-via <dev origin> --email <the article's owner>.",
    );
  });
  await page.waitForTimeout(2500);
  await page.evaluate(INSTALL_RECORDER);
  return evalJson<Population>(page, POPULATION);
}

/** Put the page where the pinned gesture starts, and let it settle there. */
async function seek(page: Page, start: ScrollStart): Promise<void> {
  await page.evaluate(
    start === "top"
      ? `window.scrollTo(0, 0)`
      : `window.scrollTo(0, Math.floor((document.documentElement.scrollHeight - window.innerHeight) / 2))`,
  );
  /* Long enough for the glide suppression in scroll.ts and the URL debounce
     (POSITION_SETTLE_MS = 300) to be over before the timed window opens. */
  await page.waitForTimeout(900);
}

/**
 * One repetition of the pinned scroll.
 *
 * The wheels come from Playwright — real trusted input through CDP — because
 * `window.scrollTo` does not exercise the same path. The window is opened and
 * closed inside the page so the clock, the frames and the counters all come
 * from one side; the CDP metrics are read outside it, which is the only place
 * they can be read from.
 */
async function scrollOnce(
  page: Page,
  cdp: CDPSession,
  pin: PinnedScroll,
  rep: number,
): Promise<Attempt> {
  try {
    await seek(page, pin.start);
    const size = page.viewportSize() ?? { width: 1280, height: 900 };
    /* Pinned: the pointer sits at the centre of the viewport for every
       repetition, so the wheel lands on the same element every time. */
    await page.mouse.move(Math.floor(size.width / 2), Math.floor(size.height / 2));
    const before = await readMetrics(cdp);
    const open = await evalJson<OpenReading>(page, OPEN_WINDOW);
    const wall0 = Date.now();
    for (let i = 0; i < pin.steps; i++) {
      await page.mouse.wheel(0, pin.deltaY);
      await page.waitForTimeout(pin.cadenceMs);
    }
    const wheelMs = Date.now() - wall0;
    await page.waitForTimeout(pin.settleMs);
    const close = await evalJson<CloseReading>(page, CLOSE_WINDOW);
    const after = await readMetrics(cdp);
    return {
      rep,
      ms: close.t1 - open.t0,
      cost: close.cost,
      metrics: metricsDelta(before, after),
      frames: close.frames,
      travelled: close.scrollY - open.scrollY,
      achievedCadenceMs: wheelMs / pin.steps,
      renders: close.renders - open.renders,
      before: String(open.scrollY),
      after: String(close.scrollY),
    };
  } catch (e) {
    return { rep, error: `threw: ${(e as Error).message}` };
  }
}

/** One repetition of a discrete gesture — a press, timed to the second paint. */
async function discreteOnce(
  page: Page,
  cdp: CDPSession,
  g: Discrete,
  rep: number,
  i: number,
): Promise<Attempt> {
  const expr = `(async () => {
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    const nextPaint = async () => { await raf(); await raf(); };
    try {
      ${g.setup ?? ""}
      await nextPaint();
      const before = String(${g.probe});
      const r0 = ${RENDERS};
      if (window.__perf && window.__perf.resetGeometryCost) window.__perf.resetGeometryCost();
      window.__geoRun.start();
      const t0 = performance.now();
      ${g.act(i)}
      await nextPaint();
      const t1 = performance.now();
      const frames = window.__geoRun.stop();
      return JSON.stringify({ ms: t1 - t0, frames, before, after: String(${g.probe}),
        renders: ${RENDERS} - r0,
        cost: (window.__perf && window.__perf.geometryCost) ? window.__perf.geometryCost() : null });
    } catch (e) { return JSON.stringify({ error: 'threw: ' + (e && e.message) }); }
  })()`;
  type Raw = { error: string } | Omit<Sample, "rep" | "metrics" | "travelled" | "achievedCadenceMs">;
  let raw: Raw;
  let before: LayoutMetrics;
  let after: LayoutMetrics;
  try {
    before = await readMetrics(cdp);
    raw = await evalJson<Raw>(page, expr);
    after = await readMetrics(cdp);
  } catch (e) {
    return { rep, error: `threw: ${(e as Error).message}` };
  }
  if ("error" in raw) return { rep, error: raw.error };
  if (!g.happened(raw.before, raw.after)) {
    return {
      rep,
      error:
        `the declared effect did not occur — ${g.describe}` +
        ` (before ${JSON.stringify(raw.before)}, after ${JSON.stringify(raw.after)})`,
    };
  }
  return { rep, ...raw, metrics: metricsDelta(before, after), travelled: 0, achievedCadenceMs: 0 };
}

/* --------------------------------------------------------------- reports -- */

/** Everything one gesture produced in one session, kept whole for `--json`. */
export interface GestureRun {
  key: string;
  label: string;
  viewport: string;
  session: number;
  declared: string;
  refused?: string;
  /** Non-zero only for the pinned scroll; the yardstick `scrollVerdict` uses. */
  wantedPx: number;
  pinned?: PinnedScroll;
  population?: Population;
  attempts: Attempt[];
}

/** The machine's own frame cadence, measured rather than assumed. */
export interface Cadence {
  viewport: string;
  intervals: number[];
  p50: number;
  p95: number;
  max: number;
}

/** Frame intervals with nothing happening — the noise floor every other frame
 *  number is read against. On a box at load 80 this is not 16.7ms and pretending
 *  it is would convict the page of the machine's contention. */
async function refreshCadence(page: Page, viewport: string): Promise<Cadence> {
  await page.evaluate(`window.__geoRun.start()`);
  await page.waitForTimeout(1500);
  const frames = await evalJson<number[]>(page, `JSON.stringify(window.__geoRun.stop())`);
  /* The first interval spans the gap between `start()` and the first served
     frame, which is not a frame interval. Dropped rather than explained away. */
  const intervals = frames.slice(1);
  return {
    viewport,
    intervals,
    p50: median(intervals),
    p95: pct(intervals, 95),
    max: maxOf(intervals),
  };
}

const pad = (s: string, w: number): string => s.padStart(w);

/** Print every repetition, failures included, then what may be quoted. */
export function report(run: GestureRun, warmup: number, budgetMs: number): string | null {
  const head = `${run.label} · ${run.viewport} · session ${run.session}`;
  console.log(`\n── ${head} ${"─".repeat(Math.max(0, 60 - head.length))}`);
  if (run.refused) {
    console.log(`  REFUSED: ${run.refused} — this gesture measures nothing here.`);
    return `refused — ${run.refused}`;
  }
  if (run.pinned) {
    const p = run.pinned;
    console.log(
      `  pinned: start=${p.start} ${p.steps}×${p.deltaY}px = ${run.wantedPx}px` +
        ` · cadence ${p.cadenceMs}ms requested · settle ${p.settleMs}ms`,
    );
  }
  console.log(`  requires: ${run.declared}`);

  const c = classify(run.attempts, warmup, run.wantedPx);
  printVectors(run, c);
  printProblems(run, c);
  if (c.warmed.length === 0) {
    console.log(`  NOTHING QUOTABLE out of ${run.attempts.length} repetitions.`);
    return `nothing quotable out of ${run.attempts.length} repetitions`;
  }
  printSummary(c.warmed, budgetMs);
  const parts: string[] = [];
  if (c.failures.length > 0) parts.push(`${c.failures.length} did not happen`);
  if (c.suspect.size > 0) parts.push(`${c.suspect.size} suspect`);
  return parts.length > 0 ? `${parts.join(", ")} of ${run.attempts.length} repetitions` : null;
}

/** The raw per-repetition vectors — the whole point of the printout. A7's
 *  Stage 1a kept only medians, so "stable across samples" could not be checked
 *  by anybody who had not been in the room. */
function printVectors(run: GestureRun, c: Classified): void {
  const rows: readonly (readonly [string, (s: Sample) => string])[] = [
    ["end-to-end ms", (s) => num(s.ms, 1)],
    ["pilot ms", (s) => (s.cost ? num(pilotMs(s.cost)) : "—")],
    ["pilot ms/scrollfrm", (s) => (s.cost ? num(pilotMsPerSamplingFrame(s.cost)) : "—")],
    ["pilot ms/anyframe", (s) => (s.cost ? num(pilotMsPerFrame(s.cost, s.frames.length)) : "—")],
    ["pilot duty %", (s) => (s.cost ? num(pilotDutyCycle(s.cost, s.ms), 1) : "—")],
    ["frame p50 ms", (s) => num(median(s.frames), 1)],
    ["frame max ms", (s) => num(maxOf(s.frames), 1)],
    ["LayoutCount", (s) => String(s.metrics.LayoutCount)],
    ["TaskDuration ms", (s) => num(s.metrics.TaskDuration, 1)],
    ["scrolled px", (s) => String(Math.round(s.travelled))],
    ["renders", (s) => String(s.renders)],
  ];
  const cell = (rep: number, of: (s: Sample) => string): string => {
    const s = c.samples.find((x) => x.rep === rep);
    if (!s) return "FAILED";
    const v = of(s);
    if (c.warmups.has(rep)) return `(${v})`;
    return c.suspect.has(rep) ? `${v}!` : v;
  };
  const reps = run.attempts.map((a) => a.rep);
  const labelW = Math.max(10, ...rows.map(([l]) => l.length));
  const widths = reps.map((rep) =>
    Math.max(String(rep).length, ...rows.map(([, of]) => cell(rep, of).length)),
  );
  const line = (label: string, cells: string[]): string =>
    `    ${label.padEnd(labelW)}  ${cells.map((v, i) => pad(v, widths[i] ?? 0)).join("  ")}`;
  console.log("  every repetition; warm-ups bracketed and excluded, ! = suspect and excluded:");
  console.log(line("repetition", reps.map(String)));
  for (const [label, of] of rows) console.log(line(label, reps.map((rep) => cell(rep, of))));
}

function printProblems(run: GestureRun, c: Classified): void {
  if (c.failures.length > 0) {
    console.log(
      `  ✗ ${c.failures.length} of ${run.attempts.length} repetition(s) did not happen,` +
        " and are NOT reported as fast ones:",
    );
    for (const f of c.failures) console.log(`      rep ${f.rep}: ${f.error}`);
  }
  for (const [rep, why] of c.suspect) {
    console.log(`  ⚠ rep ${rep} is SUSPECT and excluded from the summary: ${why}`);
  }
}

/**
 * The three numbers, kept apart.
 *
 * Per-site lines are printed individually and **never added together** — only
 * the pilot pair has a sum, and `pilotMs` is the only function that takes one.
 * A leaf's line carries its call and read counts; its ms is meaningless outside
 * `"full"` and says so.
 */
function printSummary(warmed: Sample[], budgetMs: number): void {
  const e2e = warmed.map((s) => s.ms);
  const frames = warmed.flatMap((s) => s.frames);
  const dropped = warmed.map((s) => droppedFrames(s.frames, budgetMs));
  console.log(
    `  quotable ${warmed.length}: end-to-end p50/p95/max ` +
      `${num(median(e2e), 1)}/${num(pct(e2e, 95), 1)}/${num(maxOf(e2e), 1)} ms` +
      `   achieved cadence ${num(median(warmed.map((s) => s.achievedCadenceMs)), 1)} ms`,
  );
  console.log(
    `  FRAME INTERVALS p50/p95/max ${num(median(frames), 1)}/${num(pct(frames, 95), 1)}/` +
      `${num(maxOf(frames), 1)} ms over ${frames.length} frames` +
      `   dropped (>1.5× the measured ${num(budgetMs, 1)}ms cadence): ` +
      `${dropped.join(", ")} per repetition`,
  );
  printMetrics(warmed);
  printSites(warmed);
}

function printMetrics(warmed: Sample[]): void {
  const g = (of: (s: Sample) => number): string => {
    const xs = warmed.map(of);
    return `${num(median(xs), 1)} [${num(Math.min(...xs), 1)}–${num(maxOf(xs), 1)}]`;
  };
  console.log(
    "  CHROME (median [min–max]): " +
      `LayoutCount ${g((s) => s.metrics.LayoutCount)}` +
      `  RecalcStyleCount ${g((s) => s.metrics.RecalcStyleCount)}` +
      `  LayoutDuration ${g((s) => s.metrics.LayoutDuration)}ms` +
      `  RecalcStyleDuration ${g((s) => s.metrics.RecalcStyleDuration)}ms` +
      `  TaskDuration ${g((s) => s.metrics.TaskDuration)}ms`,
  );
  console.log(
    "    LayoutCount is the least noisy number here and answers ownership; " +
      "TaskDuration is the one that reconciles with the JS timer for magnitude.",
  );
}

function printSites(warmed: Sample[]): void {
  const costs = warmed.map((s) => s.cost).filter((c): c is GeometryCost => c !== null);
  if (costs.length === 0) {
    console.log("  GEOMETRY: no snapshot — this was a --baseline run, so there is nothing to read.");
    return;
  }
  const mode = costs[costs.length - 1]?.mode ?? "?";
  const missing = new Set<string>();
  const pilotVec = costs.flatMap(pilotSamples);
  const perFrame = warmed
    .filter((s) => s.cost !== null)
    .map((s) => pilotMsPerSamplingFrame(s.cost as GeometryCost));
  const perServed = warmed
    .filter((s) => s.cost !== null)
    .map((s) => pilotMsPerFrame(s.cost as GeometryCost, s.frames.length));
  const duty = warmed
    .filter((s) => s.cost !== null)
    .map((s) => pilotDutyCycle(s.cost as GeometryCost, s.ms));
  console.log(
    "  PILOT (readingPosition + columnContext — the only pair that may authorise Stage 3):",
  );
  console.log(
    `      DECISION per SCROLL frame ms p50/p95/max ${num(median(perFrame))}/` +
      `${num(pct(perFrame, 95))}/${num(maxOf(perFrame))}` +
      "   [plan clause 1: optimise at p50 >= 4 or p95 >= 8]",
  );
  console.log(
    `      the same over every served frame, settling included: p50 ${num(median(perServed))}` +
      `  p95 ${num(pct(perServed, 95))}`,
  );
  console.log(
    `      DECISION duty cycle % p50 ${num(median(duty), 1)} of wall clock` +
      `   [plan clause 2: optimise at >= 10]`,
  );
  console.log(
    `      total per gesture p50 ${num(median(costs.map((c) => pilotMs(c))))} ms` +
      `   per-call p50/p95/max ${num(median(pilotVec))}/${num(pct(pilotVec, 95))}/` +
      `${num(maxOf(pilotVec))} ms over ${pilotVec.length} calls`,
  );
  const reads = costs.map(totalReads);
  console.log(
    `  LAYOUT READS across all ten sites (exclusive, so they DO sum): p50 ${num(median(reads), 0)}` +
      ` per gesture — an upper bound on work, not a count of reflows. LayoutCount above is the` +
      " count of flushes.",
  );
  console.log(
    `  per site [mode=${mode}] — reads are exclusive and sum; ms are inclusive and never do:`,
  );
  for (const site of PARENT_SITES) {
    const ts = costs.map((c) => tally(c, site, missing));
    const calls = median(ts.map((t) => t.calls));
    const reads = median(ts.map((t) => t.reads));
    const ms = median(ts.map((t) => t.ms));
    const per = ts.flatMap((t) => t.samples);
    const writes = median(ts.map((t) => t.writes));
    const tag = (PILOT_SITES as readonly string[]).includes(site) ? "PILOT " : "diag  ";
    console.log(
      `      ${tag}${site.padEnd(18)} calls ${pad(num(calls, 0), 5)}  reads ${pad(num(reads, 0), 7)}` +
        `  writes ${pad(num(writes, 0), 5)}  ms ${pad(num(ms), 8)}` +
        `  per-call p50/p95/max ${num(median(per))}/${num(pct(per, 95))}/${num(maxOf(per))}`,
    );
  }
  for (const site of LEAF_SITES) {
    const ts = costs.map((c) => tally(c, site, missing));
    console.log(
      `      leaf  ${site.padEnd(18)} calls ${pad(num(median(ts.map((t) => t.calls)), 0), 5)}` +
        `  reads ${pad(num(median(ts.map((t) => t.reads)), 0), 7)}` +
        `  writes ${pad(num(median(ts.map((t) => t.writes)), 0), 5)}` +
        (mode === "full"
          ? `  ms ${pad(num(median(ts.map((t) => t.ms))), 8)} [DIAGNOSTIC, perturbs its parent]`
          : "  ms not read in \"counts\" mode — that zero is not a measurement"),
    );
  }
  console.log(
    "      diagramReaderRow reporting 0 reads is the accounting working, not a dead counter:" +
      " everything it causes happens inside the measureRow leaf, which owns them.",
  );
  if (missing.size > 0) {
    console.log(
      `  ⚠ the instrument published no bucket for: ${[...missing].join(", ")} —` +
        " those lines are zeroes because the site is not instrumented, not because it is free.",
    );
  }
}

/* ----------------------------------------------------------------- a run -- */

/** What one session on one viewport produced. */
interface SessionResult {
  cadence: Cadence;
  population: Population;
  control: { calls: Record<string, number>; readsPerCall: number; travelled: number };
  runs: GestureRun[];
}

const EMPTY_CONTROL: SessionResult["control"] = { calls: {}, readsPerCall: 0, travelled: 0 };

/**
 * The control: a short scroll that **must** move the counters.
 *
 * Nothing below is believed until this has. A zero from a sampler that never
 * ran and a zero from a sampler that ran for free are the same number, and this
 * script exists to produce numbers somebody will act on.
 */
async function control(page: Page, population: Population): Promise<SessionResult["control"]> {
  await seek(page, "top");
  await page.evaluate(`window.__perf.resetGeometryCost()`);
  const y0 = await page.evaluate<number>(`window.scrollY`);
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(400);
  const cost = await evalJson<GeometryCost>(page, `JSON.stringify(window.__perf.geometryCost())`);
  const y1 = await page.evaluate<number>(`window.scrollY`);
  const calls: Record<string, number> = {};
  for (const s of [...PARENT_SITES, ...LEAF_SITES]) calls[s] = tally(cost, s).calls;
  const rp = tally(cost, "readingPosition");
  const readsPerCall = rp.calls > 0 ? rp.reads / rp.calls : 0;
  const travelled = y1 - y0;
  if (travelled <= 0) {
    throw new Error(
      `the control scroll did not move the page (${travelled}px) — nothing below could be a` +
        " measurement of scrolling.",
    );
  }
  if ((calls.readingPosition ?? 0) === 0) {
    throw new Error(
      "the control scroll moved the page and readingPosition.calls stayed at 0 —\n" +
        "  the instrument is not wired to the site the decision rests on, so every\n" +
        "  number below would be a zero that means nothing. Refusing to report.",
    );
  }
  if (population.gistColumns.length > 0 && (calls.columnContext ?? 0) === 0) {
    throw new Error(
      `the control scroll ran with gist columns ${population.gistColumns.join(",")} on and\n` +
        "  columnContext.calls stayed at 0 — half the pilot is not being measured.",
    );
  }
  return { calls, readsPerCall, travelled };
}

function printPopulation(p: Population, cadence: Cadence, url: string): void {
  console.log(`\nPOPULATION  ${url}`);
  console.log(
    `  blocks=${p.blocks}  nodes=${p.totalNodes}  leafDepth=${p.leafDepth}` +
      `  sectionDepth=${p.sectionDepth}  section cells on screen=${p.sectionCells}`,
  );
  console.log(`  table.zoom class="${p.tableClass}"  thead: ${p.headCells.join("  ") || "(empty)"}`);
  console.log(
    `  gist column headers present: [${p.gistColumns.join(", ") || "none"}]` +
      `  (useColumnContext reads its rectangles from these; none means the fisheye` +
      ` has no geometry and its bucket is legitimately zero)`,
  );
  console.log(
    `  window.__perf=${p.perf}  geometryCost=${p.geometry}  mode=${p.mode ?? "—"}` +
      `  signed in as ${p.signedInAs ?? "(unknown)"}`,
  );
  console.log(
    `  refresh cadence with nothing happening: p50 ${num(cadence.p50, 1)}ms` +
      `  p95 ${num(cadence.p95, 1)}ms  max ${num(cadence.max, 1)}ms` +
      ` over ${cadence.intervals.length} frames — this is the noise floor, not 16.7ms.`,
  );
}

/** Take every gesture on one viewport, in one browser session. */
async function oneSession(
  page: Page,
  cdp: CDPSession,
  o: Options,
  viewport: Viewport,
  session: number,
  onRun: (run: GestureRun, budgetMs: number) => void,
): Promise<SessionResult> {
  const url = readUrl(o, "");
  const population = await landAndCount(page, url, "tr[data-block]");
  const cadence = await refreshCadence(page, viewport.name);
  printPopulation(population, cadence, url);
  const refusal = populationVerdict(population, o.baseline);
  if (refusal) throw new Error(refusal);
  if (o.populationOnly) return { cadence, population, control: EMPTY_CONTROL, runs: [] };
  if (!o.baseline && o.mode === "full") {
    await page.evaluate(`window.__perf.setGeometryCostMode('full')`);
  }

  const ctl = o.baseline ? EMPTY_CONTROL : await control(page, population);
  if (!o.baseline) {
    console.log(
      `CONTROL  a short scroll moved ${ctl.travelled}px and the counters moved with it: ` +
        [...PARENT_SITES].map((s) => `${s}=${ctl.calls[s] ?? 0}`).join(" "),
    );
    console.log(
      `  two independent witnesses of the section loop: ${population.sectionCells} section cells` +
        ` in the DOM, and ${num(ctl.readsPerCall, 1)} layout reads per readingPosition call from` +
        " the instrument, which knows nothing about <td> elements. The cells are an upper" +
        " bound — supplements collapse into one section — so the reads are the count the hook" +
        " actually pays, and the cells are the check that it is the right order of magnitude.",
    );
  }

  /* Reported as each one finishes rather than at the end of the session. A
     scroll repetition costs minutes on this box, and the first version of this
     file lost two of them to a gesture that failed to land afterwards — the
     numbers had been taken and were never printed. */
  const runs: GestureRun[] = [];
  const keep = (run: GestureRun): void => {
    runs.push(run);
    onRun(run, cadence.p50);
  };
  for (const start of ["top", "middle"] as const) {
    keep(await scrollRun(page, cdp, o, viewport, session, start, population));
  }
  if (!o.baseline) {
    for (const key of o.discrete) {
      keep(await discreteRun(page, cdp, o, viewport, session, key, population));
    }
  }
  return { cadence, population, control: ctl, runs };
}

async function scrollRun(
  page: Page,
  cdp: CDPSession,
  o: Options,
  viewport: Viewport,
  session: number,
  start: ScrollStart,
  population: Population,
): Promise<GestureRun> {
  const pinned: PinnedScroll = { ...PINNED, start };
  const attempts: Attempt[] = [];
  for (let i = 0; i < o.repeats; i++) {
    attempts.push(await scrollOnce(page, cdp, pinned, i + 1));
    await page.waitForTimeout(300);
  }
  return {
    key: `scroll-${start}`,
    label: `pinned scroll from the ${start}`,
    viewport: viewport.name,
    session,
    declared: `the page moves the pinned ${pinnedDistance(pinned)}px`,
    wantedPx: pinnedDistance(pinned),
    pinned,
    population,
    attempts,
  };
}

async function discreteRun(
  page: Page,
  cdp: CDPSession,
  o: Options,
  viewport: Viewport,
  session: number,
  key: string,
  population: Population,
): Promise<GestureRun> {
  const g = DISCRETE[key];
  if (!g) throw new Error(`unknown gesture ${key}`); // unreachable: options() validated
  const base: Omit<GestureRun, "attempts" | "refused"> = {
    key,
    label: g.label,
    viewport: viewport.name,
    session,
    declared: g.describe,
    wantedPx: 0,
    population,
  };
  const refused = g.refuseIf(population);
  if (refused) return { ...base, refused, attempts: [] };
  try {
    await landAndCount(page, readUrl(o, g.query), g.waitFor);
  } catch (e) {
    /* Its own refusal rather than a fatal: the scroll numbers taken before it
       are the expensive ones and must survive a press that had nowhere to
       land. */
    return { ...base, refused: (e as Error).message.split("\n")[0] ?? "did not land", attempts: [] };
  }
  /* Set **after** the navigation: a fresh load re-runs startPerf(), which puts
     the mode back to "counts", so setting it before goto() is a no-op that
     silently produces a "counts" run labelled as a diagnostic. */
  if (o.mode === "full") await page.evaluate(`window.__perf.setGeometryCostMode('full')`);
  const attempts: Attempt[] = [];
  for (let i = 0; i < o.repeats; i++) {
    attempts.push(await discreteOnce(page, cdp, g, i + 1, i));
    await page.waitForTimeout(400);
  }
  return { ...base, attempts };
}

/* ------------------------------------------------------------------ main -- */

interface Everything {
  slug: string;
  base: string;
  mode: string;
  baseline: boolean;
  repeats: number;
  warmup: number;
  sessions: number;
  pinned: Omit<PinnedScroll, "start">;
  results: (SessionResult & { viewport: string; session: number })[];
}

/** Medians of one gesture across the sessions, so the box's contention is
 *  visible as a range rather than hidden in one number. */
function crossSession(all: Everything, warmup: number): void {
  console.log("\n════ ACROSS SESSIONS ════════════════════════════════════════");
  console.log("Medians per session. A spread wider than the effect is the box, not the code —");
  console.log("the spike behind this plan needed three sessions to see through it.");
  const keys = new Map<string, GestureRun[]>();
  for (const r of all.results) {
    for (const run of r.runs) {
      const k = `${run.viewport} · ${run.key}`;
      keys.set(k, [...(keys.get(k) ?? []), run]);
    }
  }
  for (const [k, runs] of keys) {
    const per = runs.map((run) => {
      const warmed = classify(run.attempts, warmup, run.wantedPx).warmed;
      return {
        e2e: median(warmed.map((s) => s.ms)),
        pilot: median(warmed.map((s) => (s.cost ? pilotMs(s.cost) : Number.NaN))),
        layout: median(warmed.map((s) => s.metrics.LayoutCount)),
        frame95: pct(warmed.flatMap((s) => s.frames), 95),
      };
    });
    const col = (of: (p: (typeof per)[number]) => number): string =>
      per.map((p) => num(of(p), 1)).join(" / ");
    console.log(`  ${k}`);
    console.log(`      end-to-end ms   ${col((p) => p.e2e)}`);
    console.log(`      pilot ms        ${col((p) => p.pilot)}`);
    console.log(`      LayoutCount     ${col((p) => p.layout)}`);
    console.log(`      frame p95 ms    ${col((p) => p.frame95)}`);
  }
}

function helpText(): string {
  return (
    "npx tsx scripts/measure-geometry.ts --slug <slug> [--url http://localhost:5310]\n" +
    "  --sessions 3  --repeats 6  --warmup 1  --mode counts|full\n" +
    "  --viewports desktop,phone   --cols 1,2   --gestures column-toggle,mode-switch,comment-open\n" +
    "  --view hierarchy|plain|outline|…   which mode owns the band during the scroll.\n" +
    "        hierarchy is the default HERE and plain is the default for a reader: plain\n" +
    "        empties the gist columns outright (App.tsx § plainCols), so useColumnContext\n" +
    "        is not enabled and half the pilot is a legitimate zero.\n" +
    "  --baseline            the calibration run: no ?perf=1, no geometry buckets at all\n" +
    "  --population-only     land, print what is on the page, and stop\n" +
    "  --json out.json       every repetition, whole\n" +
    "  --local-sign-in --sign-in-via http://localhost:5275 --email dev-admin@spideryarn.local\n" +
    "  --display             a headed browser (there is no display on the box)\n" +
    "\n" +
    "  Production build only: `npm run build` then `npx vite preview`. There is one store\n" +
    "  and it takes no flag.\n" +
    "  Never the dev server — main.tsx wraps the app in <StrictMode> unconditionally and A7\n" +
    "  measured ~3x inflation from that."
  );
}

async function main(): Promise<void> {
  if (has("help")) {
    console.log(helpText());
    return;
  }
  assertSiteKinds();
  const o = options();
  /* Minted **per browser session**, not once for the run. A magic-link
     `token_hash` is single-use: `verifyOtp` consumes it, and the second
     session gets "Email link is invalid or has expired", signs in nowhere, and
     the whole session is lost. Measured here on 2026-09-06, where it cost the
     phone half of a calibration run. Minting one now anyway, before Chrome is
     launched, so a missing `.env.local` or a stopped Supabase fails in a
     second rather than after a browser launch and a page load. */
  const mintToken = async (): Promise<string | null> =>
    has("local-sign-in") ? (await localMagicLink(o.via || o.base)).hashedToken : null;
  await mintToken();

  console.log(
    `measuring ${o.base}/read/${o.slug}` +
      `  ${o.baseline ? "BASELINE (uninstrumented)" : `probe=${o.mode}`}  view=${o.view}` +
      `  cols=${o.cols}` +
      `  sessions=${o.sessions}  repeats=${o.repeats} (${o.warmup} warm-up)` +
      `  viewports=${o.viewports.map((v) => v.name).join(",")}`,
  );
  if (o.baseline) {
    console.log(
      "BASELINE RUN: ?perf=1 is not appended, so no probe is patched and there is no\n" +
        "geometry bucket to report. This run calibrates the refresh cadence and the\n" +
        "uninstrumented fixed scroll, and nothing in it may be quoted as a geometry cost.",
    );
  }
  if (o.mode === "full") {
    console.log(
      'DIAGNOSTIC RUN: "full" adds two clock reads per leaf call, inside the very interval\n' +
        "the parent bucket measures, so both are perturbed upward and unevenly. Call and read\n" +
        "counts are not perturbed. Do not apply the decision rule to these.",
    );
  }

  const everything: Everything = {
    slug: o.slug,
    base: o.base,
    mode: o.mode,
    baseline: o.baseline,
    repeats: o.repeats,
    warmup: o.warmup,
    sessions: o.sessions,
    pinned: PINNED,
    results: [],
  };
  const complaints: string[] = [];

  for (let s = 1; s <= o.sessions; s++) {
    for (const viewport of o.viewports) {
      console.log(
        `\n███ session ${s}/${o.sessions} · ${viewport.name} ${viewport.width}×${viewport.height}`,
      );
      const onRun = (run: GestureRun, budgetMs: number): void => {
        const gripe = report(run, o.warmup, budgetMs);
        if (gripe) complaints.push(`s${s} ${viewport.name} ${run.key}: ${gripe}`);
      };
      /* One session failing does not end the matrix. On a box this contended a
         page load can time out for reasons that have nothing to do with the
         code, and losing the two sessions that did work to the one that did
         not is the expensive way to find that out. The failure is recorded as
         a complaint and lands in the exit code. */
      try {
        const result = await inBrowser(o, viewport, s, await mintToken(), onRun);
        everything.results.push({ ...result, viewport: viewport.name, session: s });
      } catch (e) {
        console.log(`\n✗ session ${s} on ${viewport.name} did not complete: ${(e as Error).message}`);
        complaints.push(`s${s} ${viewport.name}: ${(e as Error).message.split("\n")[0]}`);
      }
    }
  }

  if (o.sessions > 1) crossSession(everything, o.warmup);
  if (o.json) {
    writeFileSync(o.json, JSON.stringify(everything, null, 2));
    console.log(`\nwrote ${o.json}`);
  }
  if (complaints.length > 0) {
    console.log(`\n${complaints.length} gesture(s) did not measure cleanly:`);
    for (const complaint of complaints) console.log(`  ${complaint}`);
    process.exitCode = 1;
  }
}

/** A fresh browser per session, because a session is what a session is for:
 *  a cold renderer, a cold cache, and no accumulated state from the last one. */
async function inBrowser(
  o: Options,
  viewport: Viewport,
  session: number,
  hashedToken: string | null,
  onRun: (run: GestureRun, budgetMs: number) => void,
): Promise<SessionResult> {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  try {
    browser = await chromium.launch({ executablePath: chromePath(), headless: !has("display") });
    context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      /* A phone-sized window, not a touch device: `hasTouch` would change which
         listeners the app installs, and the media query `watchBarVisibility`
         attaches under is a width, not a pointer type (scroll.ts). */
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(120_000);
    page.setDefaultNavigationTimeout(300_000);
    page.on("pageerror", (e: Error) => console.log("[pageerror]", e.message));
    page.on("console", (m) => {
      if (m.type() === "error") console.log("[console:error]", m.text());
    });
    if (hashedToken) await signInAndCarry(page, o, hashedToken);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
    return await oneSession(page, cdp, o, viewport, session, onRun);
  } finally {
    await context?.close();
    await browser?.close();
  }
}

/* Guarded, so a test importing the pure helpers does not launch a browser. */
if (isMain(import.meta.url)) {
  main().catch((e: Error) => {
    console.error(`FATAL: ${e.message}`);
    process.exit(1);
  });
}
