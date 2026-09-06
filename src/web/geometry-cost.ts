/**
 * What the reading view spends reading its own geometry.
 *
 * The sibling of annotation-cost.ts, and deliberately its twin: same three
 * modes, same sentinel, same "read module state once on the way in" call-site
 * pattern, so the two read alike and a person who has understood one has
 * understood both. What it measures is different — not the annotation pipeline
 * but the **layout reads**: `getBoundingClientRect`, `offsetTop`,
 * `getComputedStyle`, `window.scrollY`, and the rest of the accesses that can
 * force the browser to flush style and layout before they can answer.
 *
 * It exists to decide a real branch. Stage 1 of
 * docs/plans/260906d-share-measured-geometry-after-profiling-scroll-and-layout-reads.md
 * profiles the scroll and layout reads and is **willing to close the job as
 * deferred** — a shared-snapshot service has a maintenance cost and has to be
 * convicted before it is built. So the failure mode this module is guarding
 * against is not inaccuracy, it is a counter that quietly reports nothing:
 * zeroes are the shape of "geometry is cheap, defer", which is the answer the
 * job would most like to hear and the one it must not be handed by accident.
 * tests/geometry-cost.test.ts pairs every zero with a control that moves.
 * docs/reusable/silent-success.md.
 *
 * ## Three states, not two — and the middle one is where the decision is made
 *
 * `setGeometryCostMode` is the one switch and the mode is a union rather than a
 * pair of booleans, so "leaf timers on while the outer timers are off" cannot
 * be written down at all.
 *
 * - **`"off"`** — the default, and free. No `performance.now()`, no allocation,
 *   no closure per call. It has to be: `stickyOffset` runs two to four times
 *   per scroll frame across three consumers, and a probe that costs anything
 *   when off is part of what it measures. Same argument perf.ts makes for not
 *   patching the globals unasked.
 * - **`"counts"`** — the parents are timed; the leaves are counted but **do not
 *   read the clock**. This is the mode the plan's 4ms/8ms/10% rule is applied
 *   to, and the reason is A7's, unchanged: `readingPosition` calls
 *   `stickyOffset` twice per frame and `stickyOffset` calls `safeAreaInsets`,
 *   so leaf timing puts four extra clock reads *inside* the very interval the
 *   threshold is compared against — and `measureRow`, called per frame by
 *   `DiagramPanel`, is an `O(all blocks)` interval nested inside another one.
 *   Against a 4ms budget that overhead is not negligible, and it inflates in
 *   exactly the direction that argues for optimising.
 * - **`"full"`** — everything, leaf timers included. A separate diagnostic run
 *   that says where inside a parent the time went, and **whose absolute numbers
 *   are not the ones the decision rule is applied to.** Say so whenever they
 *   are quoted.
 *
 * A leaf's `ms` of 0 under `"counts"` is therefore **not a measurement of
 * zero**. Read `mode` off the snapshot before reading anything else — it
 * travels with the numbers for exactly that reason.
 *
 * ## Reads are exclusive. Time is inclusive. Only one of them may be summed.
 *
 * This is the one thing to hold on to, and the two halves are deliberately
 * different:
 *
 * - **`reads` is counted at the site that physically performs the access.** A
 *   parent counts only its own; the leaves it calls count theirs. So the reads
 *   across all ten sites **add up** to the layout reads the frame performed,
 *   with nothing double-counted — which is what makes "N reads per frame"
 *   a number worth printing, and what makes Stage 2's acceptance checkable
 *   (hoisting `readingPosition`'s second `stickyOffset()` must take
 *   `stickyOffset.calls` from 2 to 1 and its `reads` from 4 to 2 per frame).
 * - **`ms` is an inclusive interval**, exactly as annotation-cost's memos are.
 *   `readingPosition`'s ms contains the two `stickyOffset` calls and the four
 *   `safeAreaInsets` reads inside them; `diagramReaderRow`'s ms is almost
 *   entirely `measureRow`'s. **Do not add the ten `ms` numbers up.**
 *
 * One consequence looks like a bug and is not: **`diagramReaderRow` reports
 * zero reads.** Its `measure` does nothing but call `measureRow()` and hand the
 * answer to `setRow`, so every read it causes belongs to the `measureRow` leaf.
 * Its *time* is the interesting number there, and its count of calls; a zero in
 * its `reads` column means the accounting worked.
 *
 * ## A count of reads is not a count of reflows
 *
 * The plan's own caveat and the easiest way to misquote this module. Inside one
 * rAF callback with no interleaved write, `S` rect reads cost **one** forced
 * layout and `S − 1` cheap lookups off the flushed tree — the browser-side
 * spike measured 1,237 already-clean rect reads at 3.7–5.3ms with a
 * `LayoutCount` delta of **zero**. So `reads` is an upper bound on work and
 * says nothing about reflows on its own.
 *
 * What costs a reflow is a **read after a write**, which is why `writes` is
 * counted too — see below. The trace, not this module, establishes ownership.
 *
 * ## Why `writes`, and why only three sites report any
 *
 * A write is what dirties layout, so a write between two reads is what turns
 * `S` cheap lookups into `S` forced layouts. Three sites in this file set write
 * anything at all during a frame:
 *
 * - `contextPanelPlace` writes `p.scrollTop` **once per mounted gist panel per
 *   call**, immediately after reading four layout properties. The spike found
 *   the interleaved shape costing 378–400ms per frame against 4–5ms for the
 *   clean one, so whether this really interleaves here is the single most
 *   valuable thing this module can report;
 * - `spineApply` writes one `style.top`, and reads only `window.scrollY`;
 * - `barVisibility` writes `dataset.bars` **only on a transition**, so its
 *   `writes` is usually 0 and occasionally 1 — a low number there is a real
 *   finding rather than a broken counter.
 *
 * Everything else reports `writes: 0` because it genuinely writes nothing.
 *
 * ## `samples`, and why there is no `maxMs` here
 *
 * annotation-cost keeps a running `maxMs` because it is charged per gesture and
 * one comparison per sample was cheaper than keeping the distribution. This
 * job's decision rule asks for **p50, p95 and the maximum** of per-frame times
 * (Sol F6: a median hides the sparse bad frame, and `longtask` cannot see
 * anything under 50ms), so the array is what is wanted and a scalar could not
 * answer it. The harness takes its own percentiles.
 *
 * `samples` holds one entry per **timed** call, so `samples.length` equals
 * `calls` at a parent and is 0 at a leaf under `"counts"`. It grows without
 * bound — about 60 entries per second per active site, so a few thousand across
 * a scripted scroll, which is nothing. Call `resetGeometryCost()` between
 * measured windows rather than leaving one running for an hour.
 *
 * ## What the counts are and are not
 *
 * `calls` is honest: it includes calls that took a fast path — `measure` during
 * a glide, which skips the rect loop entirely and correctly reports 0 rect
 * reads, or `place` on a panel with no current item. Those are real costs and
 * hiding them would flatter the result. `ms` is wall clock, so it includes
 * whatever else the machine was doing; a single run is an anecdote and the plan
 * asks for at least three sessions compared by median.
 */

/**
 * How much of the instrument is running. One union rather than two booleans, so
 * leaf timing cannot be switched on without the outer timing it sits inside.
 */
export type GeometryCostMode = "off" | "counts" | "full";

/**
 * The ten places worth charging a layout read to.
 *
 * **Parents are inclusive intervals and are timed in every mode that is on.
 * Leaves are counted always and timed only in `"full"`.** Adding a site here
 * breaks `zero()` and `geometryCost()` until both are updated, which is the
 * point.
 */
export type GeometrySite =
  /* ---- parents: inclusive intervals, timed whenever the probe is on ---- */
  /** App.tsx § `useReadingPosition`'s per-frame `measure`. The `O(sections)`
   *  sampler that runs on every scroll frame of every article. */
  | "readingPosition"
  /** useColumnContext.ts § `measure`. The other `O(sections)` sampler, plus the
   *  sticky gist-header rects, live whenever a gist column or outline mode is. */
  | "columnContext"
  /** DiagramPanel.tsx § `useReaderRow`'s `measure`. `O(all blocks)` per frame in
   *  a scatter mode — and it reads nothing itself; see the header. */
  | "diagramReaderRow"
  /** ContextPanel.tsx § `place`. The read → `scrollTop` write interleave, once
   *  per mounted gist panel, on most frames near the masthead. */
  | "contextPanelPlace"
  /** Spine.tsx § `measure`. The `O(all rows)` scan at invalidation time — the
   *  control that must move, since it is the shipped design Stage 3 would port. */
  | "spineMeasure"
  /** Spine.tsx § the scroll effect's `apply`. Cached document-space arithmetic;
   *  it should read `window.scrollY` and nothing else. */
  | "spineApply"
  /** scroll.ts § `watchBarVisibility`'s `apply`. Cheap to read, and the one
   *  place a style write lands in the middle of the frame's reads. */
  | "barVisibility"
  /* ---- leaves: counted always, timed only in "full" ---- */
  /** scroll.ts § `stickyOffset`. Called two to four times a frame across
   *  consumers, and each call is a rect plus a `getComputedStyle`. */
  | "stickyOffset"
  /** safe-area.ts § `safeAreaInsets`. One `getComputedStyle`, inside every
   *  `stickyOffset`. */
  | "safeAreaInsets"
  /** keynav.ts § `measureRow`. `O(all blocks)` rect reads, on a key press, a
   *  swipe release — and, via `DiagramPanel`, on a scroll frame. */
  | "measureRow";

/** Which sites are leaves, in one place, so the rule is data rather than a
 *  convention repeated at ten call sites. Exported because the browser harness
 *  and the suite both need to know which `ms` of 0 is a deliberate one. */
export const GEOMETRY_LEAVES = ["stickyOffset", "safeAreaInsets", "measureRow"] as const;

/** One site's running total. Not exported: `GeometryCost` below is the shape
 *  callers hold, and it carries this structurally. */
interface GeometryTally {
  /** How many times the site ran, fast-path calls included. */
  calls: number;
  /** Layout-reading DOM accesses performed **directly** inside it — see the
   *  header on why these are exclusive and may be summed. */
  reads: number;
  /** Layout-**dirtying** writes performed inside it. Zero at seven of the ten
   *  sites, because they write nothing. */
  writes: number;
  /** Inclusive wall time in ms across those calls. Zero for a leaf outside
   *  `"full"`, where the clock is deliberately never read — that zero is not a
   *  measurement. */
  ms: number;
  /** Per-call ms, in order, so the harness can take p50/p95/max itself. One
   *  entry per *timed* call, so this is empty wherever `ms` is 0. */
  samples: number[];
}

/**
 * A snapshot, detached from the live counters so a caller can hold two and
 * subtract them — which is exactly what a browser measurement does across a
 * gesture.
 *
 * `mode` travels with the numbers and is not decoration. Ten zeroed tallies is
 * the shape of "geometry costs nothing" *and* of "nobody switched the probe
 * on"; three zeroed leaf timers is the shape of "the leaves are free" *and* of
 * `"counts"` working exactly as designed. Neither pair is the same answer and
 * only `mode` tells them apart.
 *
 * That only works if `mode` really does describe these numbers, so it is an
 * invariant rather than a hope: **the counters always belong to the mode the
 * snapshot reports**, because every change of mode zeroes them. See
 * `setGeometryCostMode`.
 */
export type GeometryCost = Readonly<Record<GeometrySite, Readonly<GeometryTally>>> & {
  readonly mode: GeometryCostMode;
};

/**
 * The `t0` that means "no clock was read for this call" — a leaf under
 * `"counts"`, or any site while the probe is off. A sentinel rather than an
 * `undefined`, so the hot path passes a number and allocates nothing.
 *
 * Exported so the ten call sites do not each invent their own.
 */
export const NO_GEOMETRY_CLOCK = -1;

const zero = (): Record<GeometrySite, GeometryTally> => ({
  readingPosition: { calls: 0, reads: 0, writes: 0, ms: 0, samples: [] },
  columnContext: { calls: 0, reads: 0, writes: 0, ms: 0, samples: [] },
  diagramReaderRow: { calls: 0, reads: 0, writes: 0, ms: 0, samples: [] },
  contextPanelPlace: { calls: 0, reads: 0, writes: 0, ms: 0, samples: [] },
  spineMeasure: { calls: 0, reads: 0, writes: 0, ms: 0, samples: [] },
  spineApply: { calls: 0, reads: 0, writes: 0, ms: 0, samples: [] },
  barVisibility: { calls: 0, reads: 0, writes: 0, ms: 0, samples: [] },
  stickyOffset: { calls: 0, reads: 0, writes: 0, ms: 0, samples: [] },
  safeAreaInsets: { calls: 0, reads: 0, writes: 0, ms: 0, samples: [] },
  measureRow: { calls: 0, reads: 0, writes: 0, ms: 0, samples: [] },
});

let mode: GeometryCostMode = "off";
let counters = zero();

/**
 * Whether to record anything at all. **A leaf's guard** — read once, on the way
 * in, and remembered; a parent asks `parentGeometryClock()` instead and reads
 * the answer off its own `t0`.
 *
 * Once rather than twice because it is cheaper, and because a site that saw
 * "off" on entry can then never charge a `t0` of zero against a clock that
 * started at page load. A function rather than an exported `let`, so the state
 * has one writer and a bundler cannot decide it is a constant.
 */
export function geometryCostOn(): boolean {
  return mode !== "off";
}

/**
 * A leaf site's start time: the clock in `"full"`, and the "do not time this"
 * sentinel otherwise.
 *
 * The whole three-state design lives in this one line. A leaf calls it
 * unconditionally, which is why it must stay this cheap — `"off"` and
 * `"counts"` both cost one string comparison and no clock read.
 *
 * **Parents use `parentGeometryClock` instead**, because for them "the clock
 * ran" and "we are counting" are the same condition and a leaf's are not.
 */
export function leafGeometryClock(): number {
  return mode === "full" ? performance.now() : NO_GEOMETRY_CLOCK;
}

/**
 * A parent site's start time: the clock whenever the probe is on at all, and
 * the sentinel when it is off.
 *
 * annotation-cost's two memo sites write `costOn() ? performance.now() :
 * NO_CLOCK` inline, and this is that expression with a name. Naming it buys two
 * things beyond the repetition. It reads module state **once** — which that
 * header asks for and an inline version only nearly achieves — and it lets a
 * parent guard its `noteGeometry` on `t0 !== NO_GEOMETRY_CLOCK` rather than
 * carrying a second `counting` flag, so a parent call site is one branch
 * instead of two. (That is not only tidiness: at `Spine`'s `apply`, two
 * branches inside two levels of closure pushed the function past biome's
 * cognitive-complexity ceiling, and a probe should not be the reason a function
 * needs refactoring.)
 *
 * For a **leaf** the two conditions genuinely differ — counted in `"counts"`,
 * timed only in `"full"` — which is why leaves keep both calls.
 */
export function parentGeometryClock(): number {
  return mode === "off" ? NO_GEOMETRY_CLOCK : performance.now();
}

/**
 * Charge one call to `site`: `reads` layout reads and `writes` layout writes,
 * having started its clock at `t0` — or at `NO_GEOMETRY_CLOCK` for a call that
 * is counted but not timed.
 *
 * Only ever reached under a guard — `if (counting)` at a leaf, `if (t0 !==
 * NO_GEOMETRY_CLOCK)` at a parent — so it may read the clock freely; when the
 * probe is off nothing here runs at all.
 *
 * `reads` is passed rather than detected. **Nothing here patches
 * `getBoundingClientRect` or any other DOM accessor**, and it must not start:
 * a patched accessor is a probe that changes the behaviour of the thing it
 * measures, which is the argument perf.ts makes at length about the globals it
 * does patch. A hand-counted integer is a number somebody has to keep in step
 * with the code — the cost of that is a comment at each call site saying what
 * the count is, and a test that pins it.
 */
export function noteGeometry(site: GeometrySite, t0: number, reads: number, writes = 0): void {
  const tally = counters[site];
  tally.calls += 1;
  tally.reads += reads;
  tally.writes += writes;
  if (t0 === NO_GEOMETRY_CLOCK) return;
  const ms = performance.now() - t0;
  tally.ms += ms;
  tally.samples.push(ms);
}

/**
 * Turn the instrument on, on a clean set of counters.
 *
 * `"counts"` by default, because that is the mode the decision is made in and a
 * caller who has not thought about it should get the honest number rather than
 * the perturbed one. Ask for `"full"` deliberately, and say so when you quote
 * what it produced.
 */
export function startGeometryCost(next: Exclude<GeometryCostMode, "off"> = "counts"): void {
  setGeometryCostMode(next);
}

/** Stop recording. Zeroes the counters, for the reason `setGeometryCostMode`
 *  gives — read the snapshot *before* stopping, not after. */
export function stopGeometryCost(): void {
  setGeometryCostMode("off");
}

/**
 * The one setter, and the one writer of `mode` — everything else here goes
 * through it.
 *
 * **A real change of mode zeroes the counters**, so that the counters always
 * belong to the mode the snapshot reports. Both of the ways that used not to
 * hold in annotation-cost are avoided here by construction rather than
 * rediscovered: a `stop` that kept its totals would put nonzero numbers under
 * the label meaning "nobody switched the probe on", and a `"counts"` → `"full"`
 * transition that kept them would blend untimed and timed leaf samples under a
 * final `"full"` label with nothing to say so.
 *
 * **Setting the mode it is already in is a no-op**, so this cannot quietly wipe
 * a measurement in progress — `startGeometryCost()` called twice, or a harness
 * re-asserting `"full"` between repetitions, must not lose the run.
 */
export function setGeometryCostMode(next: GeometryCostMode): void {
  if (next === mode) return;
  mode = next;
  counters = zero();
}

/** Back to ten zeroed tallies, leaving the mode alone. The way to start a fresh
 *  window *within* one mode — one measured gesture, then the next. */
export function resetGeometryCost(): void {
  counters = zero();
}

/**
 * The numbers so far, copied out — `samples` included, so a caller holding two
 * snapshots cannot find the older one growing under it.
 *
 * Read `mode` first, and read the header before summing anything: the `reads`
 * column adds up, the `ms` column does not.
 */
export function geometryCost(): GeometryCost {
  const copy = (t: GeometryTally): GeometryTally => ({ ...t, samples: [...t.samples] });
  return {
    mode,
    readingPosition: copy(counters.readingPosition),
    columnContext: copy(counters.columnContext),
    diagramReaderRow: copy(counters.diagramReaderRow),
    contextPanelPlace: copy(counters.contextPanelPlace),
    spineMeasure: copy(counters.spineMeasure),
    spineApply: copy(counters.spineApply),
    barVisibility: copy(counters.barVisibility),
    stickyOffset: copy(counters.stickyOffset),
    safeAreaInsets: copy(counters.safeAreaInsets),
    measureRow: copy(counters.measureRow),
  };
}
