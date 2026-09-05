/**
 * How much of a gesture the annotation pipeline is actually responsible for.
 *
 * The reading view rebuilds its marks from two `useMemo`s in TableView.tsx —
 * `marksByBlock`, which re-resolves every comment and chat anchor, and
 * `proseHtml`, which walks every block in the article and re-annotates the
 * marked ones. Both are *proved* from source to re-run more often than they
 * need to (docs/plans/260905i-measure-annotation-computation-before-optimising-it.md);
 * neither has ever been timed. An end-to-end "opening a comment takes 948ms"
 * says nothing about which subsystem spent it, and optimising on that number
 * would be guessing. This module is the instrument that turns it into a share.
 *
 * ## Three states, not two
 *
 * `setAnnotationCostMode` is the one switch, and the mode is a union rather
 * than a pair of booleans so that "leaf timers on while the outer timers are
 * off" cannot be written down at all.
 *
 * - **`"off"`** — the default, and free. No `performance.now()`, no
 *   allocation, no closure per call. That matters more here than it usually
 *   would: `renderedText` runs thousands of times per article per re-render,
 *   so a probe that costs anything when off becomes part of what it measures —
 *   the same argument perf.ts makes for not patching the globals unasked.
 * - **`"counts"` — the mode the decision is made in.** The two memo timers
 *   run; the four leaf sites increment their `n` but **do not read the clock**.
 *   This exists because the leaf timers perturb the very interval they explain:
 *   `proseHtml` calls `addZoomHandles` once per block, so on a 551-block
 *   article leaf timing adds over a thousand `performance.now()` reads *inside*
 *   `proseHtml`'s own interval, before `renderedText`, `resolveMark` and
 *   `annotateHtml` are counted at all. The plan's threshold is 8ms; that
 *   overhead is not small against it, and it inflates in exactly the direction
 *   that would argue for optimising.
 * - **`"full"`** — everything, leaf timers included. A separate diagnostic run:
 *   its leaf breakdown says where the time goes, and its **absolute numbers are
 *   not the ones the decision rule is applied to.**
 *
 * A leaf's `ms` of 0 under `"counts"` is therefore *not* a measurement of zero.
 * Read `mode` off the snapshot before reading anything else — it travels with
 * the numbers for exactly that reason.
 *
 * ## The call-site pattern, and why there is no `timed(…)` helper
 *
 * A closure passed to `timed(label, () => …)` is allocated whether the probe is
 * on or off, and at these call counts that is the wrong default. So each site
 * branches on module state instead:
 *
 * ```ts
 * const counting = costOn();          // false unless the mode is on
 * const t0 = leafClock();             // reads the clock only in "full"
 * const out = …the real work…;
 * if (counting) noteCost("renderedText", t0);
 * return out;
 * ```
 *
 * The two memo sites time unconditionally whenever the probe is on, so they
 * use `performance.now()` directly and `NO_CLOCK` for the off case. Both flavours
 * read module state *once, on the way in*, rather than asking again at the
 * bottom: cheaper, and a site that saw "off" on entry can never charge a `t0`
 * of zero against a clock that started at page load.
 *
 * Where a function has more than one `return`, the measurement wraps a private
 * worker rather than being repeated before each of them, so a `return` added
 * later cannot escape it. That is a silent-success guard
 * (docs/reusable/silent-success.md): an undercounting probe reports a small
 * number, and a small number is the answer this job would most like to hear.
 *
 * ## The six numbers overlap. Do not add them up.
 *
 * Four leaf sites and two memo sites, and **the memos contain the leaves**:
 *
 * - `proseHtml`'s ms **includes** the `annotateHtml` and `addZoomHandles` time
 *   spent inside it;
 * - `marksByBlock`'s ms **includes** the `renderedText` and `resolveMark` time
 *   spent inside it;
 * - `termMarks` calls `renderedText` too, from its own memo, which is not
 *   timed — so `renderedText`'s total is not wholly inside `marksByBlock`
 *   either.
 *
 * So the memo numbers are the **attributable total** — the pair the plan's
 * decision rule is applied to — and the leaf numbers are the **breakdown** that
 * says where inside them the time went. Summing all six double-counts most of
 * it and produces a figure that means nothing.
 *
 * ## Why each site keeps a `maxMs` as well as a total
 *
 * The decision rule asks two different questions of the same stream of samples:
 * what share of a second of streaming annotation occupies (a total), and what
 * the **worst single delta** cost (a maximum). An accumulated total cannot
 * answer the second, and a mean is worse than useless here — `annotateHtml`'s
 * cost varies with html size, text-node count and mark overlap, so averaging
 * destroys the distribution the question is about. One comparison per sample
 * buys the answer.
 *
 * ## What the counts are and are not
 *
 * `n` is honest: it is calls, including the ones that took a fast path
 * (`addZoomHandles` on a block with no figure, `annotateHtml` with no live
 * mark). "2,046 calls that each did nothing" is a real cost on a long article
 * and hiding it would flatter the result. `ms` is wall-clock and therefore
 * includes whatever else the machine was doing, so a single run is an anecdote;
 * the plan asks for three.
 */

/**
 * How much of the instrument is running. See the header — the three states are
 * one union rather than two booleans so that leaf timing cannot be switched on
 * without the outer timing it sits inside.
 */
export type CostMode = "off" | "counts" | "full";

/** The six places worth charging time to. Adding one here breaks `zero()` and
 *  `annotationCost()` until both are updated, which is the point. */
export type CostSite =
  | "renderedText"
  | "resolveMark"
  | "annotateHtml"
  | "addZoomHandles"
  | "marksByBlock"
  | "proseHtml";

/** One site's running total. */
export interface CostTally {
  /** Calls, fast-path ones included. Counted in `"counts"` as well as `"full"`. */
  n: number;
  /** Wall-clock ms across those calls. Zero for a leaf under `"counts"`, where
   *  the clock is deliberately never read — that zero is not a measurement. */
  ms: number;
  /** The largest single sample, for the "worst delta" half of the decision
   *  rule. Zero wherever `ms` is zero, and never larger than `ms`. */
  maxMs: number;
}

/**
 * A snapshot, detached from the live counters so a caller can hold two and
 * subtract them — which is exactly what a browser measurement does across a
 * gesture.
 *
 * `mode` travels with the numbers on purpose, and not as decoration. Six zeroes
 * is the shape of "annotation costs nothing" *and* of "nobody switched the probe
 * on"; four zeroed leaf timers is the shape of "the leaves are free" *and* of
 * `"counts"` mode working exactly as intended. Neither pair is the same answer,
 * and only `mode` tells them apart.
 */
export type AnnotationCost = Readonly<Record<CostSite, Readonly<CostTally>>> & {
  readonly mode: CostMode;
};

/**
 * The `t0` that means "no clock was read for this call" — a leaf under
 * `"counts"`, or either memo site while the probe is off. A sentinel rather
 * than an `undefined`, so the hot path passes a number and allocates nothing.
 *
 * Exported so the two memo sites in TableView.tsx do not each invent their own.
 */
export const NO_CLOCK = -1;

const zero = (): Record<CostSite, CostTally> => ({
  renderedText: { n: 0, ms: 0, maxMs: 0 },
  resolveMark: { n: 0, ms: 0, maxMs: 0 },
  annotateHtml: { n: 0, ms: 0, maxMs: 0 },
  addZoomHandles: { n: 0, ms: 0, maxMs: 0 },
  marksByBlock: { n: 0, ms: 0, maxMs: 0 },
  proseHtml: { n: 0, ms: 0, maxMs: 0 },
});

let mode: CostMode = "off";
let counters = zero();

/**
 * Whether to record anything at all. Read once per call site and remembered —
 * see the header.
 *
 * A function rather than an exported `let`, so the state has exactly one writer
 * and a bundler cannot decide it is a constant.
 */
export function costOn(): boolean {
  return mode !== "off";
}

/** The current mode, for a caller that wants to restore it afterwards. */
export function annotationCostMode(): CostMode {
  return mode;
}

/**
 * A leaf site's start time: the clock in `"full"`, and the "do not time this"
 * sentinel otherwise.
 *
 * The whole three-state design lives in this one line. A leaf calls it
 * unconditionally, which is why it must stay this cheap — off and `"counts"`
 * both cost one string comparison and no clock read.
 */
export function leafClock(): number {
  return mode === "full" ? performance.now() : NO_CLOCK;
}

/**
 * Charge one call to `site`, having started its clock at `t0` — or at `NO_CLOCK`
 * for a call that is counted but not timed.
 *
 * Only ever reached under `if (costOn())`, so it may read the clock freely;
 * when the probe is off nothing here runs at all.
 */
export function noteCost(site: CostSite, t0: number): void {
  const tally = counters[site];
  tally.n += 1;
  if (t0 === NO_CLOCK) return;
  const ms = performance.now() - t0;
  tally.ms += ms;
  if (ms > tally.maxMs) tally.maxMs = ms;
}

/**
 * Turn the instrument on. Does **not** reset — a caller that wants a clean
 * window says so with `resetAnnotationCost()`, which keeps "switch it on" and
 * "start a measurement" as two separate decisions.
 *
 * `"counts"` by default, because that is the mode the decision is made in and a
 * caller who has not thought about it should get the honest number rather than
 * the perturbed one. Ask for `"full"` deliberately.
 */
export function startAnnotationCost(next: Exclude<CostMode, "off"> = "counts"): void {
  mode = next;
}

/** Stop recording, keeping whatever has been accumulated so far. */
export function stopAnnotationCost(): void {
  mode = "off";
}

/** The one setter, for a caller that wants to name the state including `"off"`. */
export function setAnnotationCostMode(next: CostMode): void {
  mode = next;
}

/** Back to six zeroes, leaving the mode alone. */
export function resetAnnotationCost(): void {
  counters = zero();
}

/** The numbers so far, copied out. Read `mode` first, and read the header
 *  before adding the six of them up. */
export function annotationCost(): AnnotationCost {
  return {
    mode,
    renderedText: { ...counters.renderedText },
    resolveMark: { ...counters.resolveMark },
    annotateHtml: { ...counters.annotateHtml },
    addZoomHandles: { ...counters.addZoomHandles },
    marksByBlock: { ...counters.marksByBlock },
    proseHtml: { ...counters.proseHtml },
  };
}
