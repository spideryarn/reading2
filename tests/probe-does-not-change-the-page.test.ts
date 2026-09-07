// @vitest-environment jsdom
/**
 * **The geometry probe must not change what the page does.**
 *
 * geometry-cost.ts exists to decide whether A8's shared-snapshot service is
 * worth building. A probe that alters the behaviour it is measuring cannot
 * settle that question in either direction: it measures a page that does not
 * exist, and every number it produces describes that other page.
 *
 * The module's own header already says so, about the thing it refuses to do:
 *
 * > **Nothing here patches `getBoundingClientRect` or any other DOM accessor**,
 * > and it must not start: a patched accessor is a probe that changes the
 * > behaviour of the thing it measures.
 *
 * It did not patch an accessor. It read the clock — and the clock is a shared
 * resource too, because `scroll.ts § apply` makes a decision by comparing
 * `performance.now()` against a deadline. Reading it once for the timer and
 * again for the decision means the decision is made a little later with the
 * probe on than with it off, and near the boundary "a little later" is the
 * other side. Found by GPT Sol reviewing Stage 1, 2026-09-06, as F14; the
 * write-up is docs/postmortems/260907a-a-probe-that-read-the-same-clock-twice.md.
 *
 * The bar's quiet window is where this bites. `markOurScroll` suppresses the
 * hide-on-scroll bar for the length of a jump we started, because chrome that
 * answered to our own scrolling would move the ground under a destination
 * already computed. One tick of the clock decides whether a frame is still
 * inside that window — so with the probe on, a frame that should have been
 * ignored instead hides the bar, and that is a **write** to
 * `documentElement.dataset`, mid-gesture, in the file whose whole point is that
 * writes between reads are what force layout.
 *
 * The assertion is a comparison, not a value: the same gesture against the same
 * clock must reach the same page state with the probe off and on. The two
 * controls beneath it exist because "identical" is also what you get from a
 * harness that never ran the listener at all — silent-success.md.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startGeometryCost, stopGeometryCost } from "../src/web/geometry-cost.js";
import { BAR_KEEP_UNTIL, scrollToTop, watchBarVisibility } from "../src/web/scroll.js";

/**
 * A scripted clock. Each call returns the next entry and then holds the last
 * one, so a run that reads the clock more times than the script anticipated
 * degrades to "no further time passed" rather than to `undefined`.
 *
 * Scripting it per *call* rather than per millisecond is the honest model of
 * the defect: the extra `performance.now()` the probe performs costs real time,
 * so every later read in that frame happens later than it would have. The two
 * runs below are handed the identical script — the only difference is who
 * consumes which entry.
 */
let script: number[] = [];
let reads = 0;
function scriptedNow(): number {
  const v = script[Math.min(reads, script.length - 1)] ?? 0;
  reads += 1;
  return v;
}

/** The rAF callback `watchBarVisibility` parks, so the test decides when a frame runs. */
let frame: FrameRequestCallback | null = null;

function setScrollY(y: number): void {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true, writable: true });
}

const realNow = performance.now;
const realRaf = window.requestAnimationFrame;
const realCancel = window.cancelAnimationFrame;
const realMatchMedia = window.matchMedia;
const realScrollTo = window.scrollTo;

beforeEach(() => {
  performance.now = scriptedNow;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    frame = cb;
    return 1; // non-zero: `pending` is tested for truthiness
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => {
    frame = null;
  }) as typeof window.cancelAnimationFrame;
  // The listener only attaches on a small device, and this suite is about the
  // listener. A `matches: false` stub would make every assertion below vacuous.
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  // jsdom has no layout, and its `scrollTo` logs "not implemented" on every call.
  window.scrollTo = (() => {}) as typeof window.scrollTo;
});

afterEach(() => {
  stopGeometryCost();
  performance.now = realNow;
  window.requestAnimationFrame = realRaf;
  window.cancelAnimationFrame = realCancel;
  window.matchMedia = realMatchMedia;
  window.scrollTo = realScrollTo;
  frame = null;
  delete document.documentElement.dataset.bars;
});

/**
 * One jump, then one scroll frame, and what the bar did.
 *
 * `clock` is consumed in order: entry 0 by `markOurScroll` inside
 * `scrollToTop`, which sets the quiet window to that value plus 150. What the
 * frame then reads depends on how many times it asks.
 */
function gesture(probe: "off" | "counts", clock: number[]): string | undefined {
  script = clock;
  reads = 0;
  setScrollY(0);
  delete document.documentElement.dataset.bars;
  if (probe === "counts") startGeometryCost("counts");
  else stopGeometryCost();

  const stop = watchBarVisibility(); // `from` starts at scrollY, which is 0
  scrollToTop(); // markOurScroll(150): quietUntil = clock[0] + 150
  setScrollY(BAR_KEEP_UNTIL + 1000); // far enough down, and far enough moved, to hide
  window.dispatchEvent(new Event("scroll"));
  frame?.(0); // run `apply`

  // Read before teardown: the teardown calls `show()`, which is what stops a
  // rotation leaving the bar stuck off screen — and would erase the evidence.
  const bars = document.documentElement.dataset.bars;
  stop();
  return bars;
}

/** clock[0] = 100, so the quiet window ends at 250. */
const JUMP_AT = 100;

describe("the quiet window behaves the same whether or not anything is counting", () => {
  it("does not let the probe decide whether the bar hides", () => {
    // One entry either side of the deadline. With the probe off the frame's
    // single clock read is 249 — inside the window, so the bar is left alone.
    // With the probe on, `parentGeometryClock` takes 249 and the quiet-window
    // test gets 251, which is outside, so the same frame hides the bar.
    const clock = [JUMP_AT, 249, 251, 251];
    expect(gesture("counts", clock)).toBe(gesture("off", clock));
  });

  it("does not let the probe decide it on the way out of the window either", () => {
    // The mirror case, one tick earlier, so this cannot pass by the boundary
    // happening to sit where the probe's extra read is harmless.
    const clock = [JUMP_AT, 248, 250, 250];
    expect(gesture("counts", clock)).toBe(gesture("off", clock));
  });
});

describe("the controls that stop the comparison above being vacuous", () => {
  it("hides the bar once the quiet window has passed", () => {
    // Proves the frame really runs and `stepBar` really fires: without this, a
    // stub that never invoked the listener would satisfy every equality above.
    expect(gesture("off", [JUMP_AT, 9000])).toBe("hidden");
  });

  it("leaves the bar alone inside the quiet window", () => {
    // The other half: proves the quiet branch is reachable with these inputs,
    // so "identical" above is two live paths agreeing rather than one dead one.
    expect(gesture("off", [JUMP_AT, 101])).toBeUndefined();
  });
});
