/**
 * The pure half of touch stepping — see src/web/swipe.ts and
 * docs/project/touch.md. The DOM half (pointer bookkeeping, the swallowed
 * click, `touch-action`) is checked by hand on a device; what is deterministic
 * is which way a finished drag counts, and that is what is pinned here.
 */
import { describe, expect, it } from "vitest";
import { swipeStep } from "../src/web/swipe.js";

describe("swipeStep", () => {
  it("reads a drag upwards as going forward", () => {
    // Finger up pulls the article up, which is further in — the same direction
    // the momentum scroll one column to the right would take you.
    expect(swipeStep(0, -60)).toBe(1);
  });

  it("reads a drag downwards as going back", () => {
    expect(swipeStep(0, 60)).toBe(-1);
  });

  it("ignores a tap", () => {
    expect(swipeStep(0, 0)).toBe(null);
  });

  it("ignores a wobble below the threshold", () => {
    // A gist is a click target, so a shaky tap must stay a tap.
    expect(swipeStep(2, -23)).toBe(null);
    expect(swipeStep(2, -25)).toBe(1);
  });

  it("leaves a sideways pan to the browser", () => {
    // The table pans horizontally when it outruns the window, and that gesture
    // is not ours however far it travels. Both of these clear the distance
    // threshold, so they are genuinely testing the axis rule — an earlier
    // version used a 10px drop here and would have passed with AXIS_RATIO
    // deleted, which is a test that pins nothing.
    expect(swipeStep(200, -30)).toBe(null);
    expect(swipeStep(-200, 40)).toBe(null);
  });

  it("leaves an exactly diagonal drag alone", () => {
    // Ambiguous, so it goes to the browser rather than being split down the
    // middle — hence `<=` and not `<` in the axis test.
    expect(swipeStep(50, -50)).toBe(null);
    // 1.2 x 50 is exactly 60, so 60 is still the browser's and 61 is ours.
    expect(swipeStep(50, -60)).toBe(null);
    expect(swipeStep(50, -61)).toBe(1);
  });

  it("takes a diagonal that is clearly more vertical than sideways", () => {
    // Nobody swipes in a straight line; a 30px sideways drift over a 100px
    // vertical drag is a normal thumb arc, not a pan.
    expect(swipeStep(30, -100)).toBe(1);
  });

  it("honours a caller's own threshold", () => {
    expect(swipeStep(0, -15)).toBe(null);
    expect(swipeStep(0, -15, 10)).toBe(1);
  });

  it("counts distance, not speed", () => {
    // There is no velocity term on purpose: a slow deliberate drag and a flick
    // of the same length mean the same thing, which is what stops the feature
    // needing a timer and stops it behaving differently on a tired hand.
    expect(swipeStep(0, -400)).toBe(1);
    expect(swipeStep(0, -25)).toBe(1);
  });
});
