// @vitest-environment jsdom
/**
 * **A jump in flight has to be stopped, not merely overtaken.**
 *
 * `glide` (src/web/scroll.ts) runs its own `requestAnimationFrame` loop, and
 * that loop does not notice when something else moves the page: its next tick
 * carries on toward the destination it was given. So a reader who presses Back
 * while a jump is still animating arrives at the top of the article and is then
 * dragged forward again to the place they had just undone. `cancel()` is what
 * says the jump is over, and `scrollToTop` exists to make it.
 *
 * GPT Sol found this reviewing the fix for a different bug in the same hook
 * (docs/postmortems/260830b-the-spy-wrote-a-section-over-the-paragraph.md). It predates
 * that fix: the `at === null` branch of the URL → page effect has always
 * scrolled raw.
 *
 * This is the one animation in `scroll.ts` with a test, and the reason is that
 * the bug is *in the frame after the one you can see* — by hand, the page goes
 * to the top and comes back, which reads as a mis-click rather than as a rule.
 * The rest of the file's DOM and animation work is still checked by hand
 * (tests/scroll.test.ts, docs/project/testing.md).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { glideTarget, scrollToBlock, scrollToTop } = await import("../src/web/scroll.js");

/** The frames `glide` has queued, flushed by hand so the test owns the clock. */
let frames: FrameRequestCallback[] = [];
/** Every `scrollTo` the module made, in order. */
let scrolled: number[] = [];
let now = 0;

const DESTINATION = 4000;

beforeEach(() => {
  frames = [];
  scrolled = [];
  now = 0;
  /* A row 4000px down a long article. `stickyOffset()` returns 0 with no
     `.controls` and no `thead th` in the document, so the glide's target is the
     row's own top. */
  /* jsdom has no `CSS.escape`, which `scrollToBlock` uses to build its
     selector. The ids here are `[a-z0-9-]` by construction (block-ids.md), so
     identity is the honest stand-in. */
  globalThis.CSS = { escape: (s: string) => s } as unknown as typeof globalThis.CSS;
  document.body.innerHTML = `<table><tbody><tr data-block="spya-k3m9qt"></tr></tbody></table>`;
  const row = document.querySelector("tr")!;
  row.getBoundingClientRect = () => ({ top: DESTINATION, height: 20 }) as DOMRect;
  Object.defineProperty(document.documentElement, "scrollHeight", {
    value: 20_000,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
  Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
  window.scrollTo = ((o: { top: number }) => {
    scrolled.push(o.top);
    Object.defineProperty(window, "scrollY", { value: o.top, writable: true, configurable: true });
  }) as typeof window.scrollTo;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) => {
    frames[id - 1] = () => {};
  }) as typeof window.cancelAnimationFrame;
  globalThis.requestAnimationFrame = window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
});

afterEach(() => {
  scrollToTop(); // leave no animation running for the next test
});

/**
 * Run whatever frames are queued, `t` ms past the start of the animation.
 *
 * `glide` reads `performance.now()` for its own zero and is handed the frame
 * timestamp, so the two have to share a clock — passing a bare `50` puts the
 * animation's progress hugely negative and the first frame moves nowhere.
 */
let started = 0;
function flush(t: number) {
  now = started + t;
  const queued = frames;
  frames = [];
  for (const cb of queued) cb(now);
}

describe("scrollToTop", () => {
  it("stops a jump that is still in flight", () => {
    started = performance.now();
    scrollToBlock("spya-k3m9qt");
    expect(glideTarget()).toBe(DESTINATION);
    flush(50); // one frame of travel, so the page is genuinely part-way there
    const partWay = scrolled.at(-1)!;
    expect(partWay).toBeGreaterThan(0);
    expect(partWay).toBeLessThan(DESTINATION);

    scrollToTop();
    expect(glideTarget()).toBeNull();
    expect(scrolled.at(-1)).toBe(0);

    /* **The frame after the one you can see.** Without `cancel()` the queued
       tick runs, finds itself part-way through its own easing, and scrolls the
       reader back toward the destination they just left. */
    flush(500);
    expect(scrolled.at(-1)).toBe(0);
    expect(glideTarget()).toBeNull();
  });

  it("is harmless when nothing is in flight", () => {
    scrollToTop();
    expect(scrolled).toEqual([0]);
    expect(glideTarget()).toBeNull();
  });
});
