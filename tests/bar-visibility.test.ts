/**
 * The controls bar's hide-on-scroll decision — scroll.ts § stepBar.
 *
 * This file exists because the browser cannot check it. The reading view is
 * driven through a Chrome that is not the frontmost window, so its
 * `visibilityState` is `hidden`, and **`requestAnimationFrame` does not run in
 * a hidden tab**: the listener never fires, the attribute is never set, and a
 * completely broken implementation is indistinguishable from a working one. On
 * 2026-08-27 it was indistinguishable from a working one for ten minutes.
 *
 * So the arithmetic lives outside the listener and is pinned here instead.
 */
import { describe, expect, it } from "vitest";
import { BAR_HIDE_AFTER, BAR_KEEP_UNTIL, stepBar } from "../src/web/scroll.js";

const SHOWN = false;
const HIDDEN = true;

describe("the bar gives way to a deliberate scroll down", () => {
  it("hides once the reader has pushed past the threshold", () => {
    const y = BAR_KEEP_UNTIL + 500;
    expect(stepBar(SHOWN, y, y - BAR_HIDE_AFTER - 1)).toEqual({ hidden: true, from: y });
  });

  it("does not hide on a nudge", () => {
    const y = BAR_KEEP_UNTIL + 500;
    const from = y - BAR_HIDE_AFTER;
    // Exactly at the threshold is still a nudge — and `from` does NOT advance,
    // which is what makes the threshold cumulative rather than per-event.
    expect(stepBar(SHOWN, y, from)).toEqual({ hidden: false, from });
  });

  it("adds nudges up until they amount to a push", () => {
    // Ten 5px scroll events: nothing until the total crosses the threshold,
    // then it goes. A per-event threshold would never hide at all here, which
    // is exactly how a slow reader would find the feature simply absent.
    let state = { hidden: SHOWN, from: BAR_KEEP_UNTIL };
    let y = BAR_KEEP_UNTIL;
    for (let i = 0; i < 10; i++) {
      y += 5;
      state = stepBar(state.hidden, y, state.from);
    }
    expect(state.hidden).toBe(true);
  });
});

describe("the bar comes straight back", () => {
  it("returns on any upward movement at all, however small", () => {
    const y = BAR_KEEP_UNTIL + 500;
    expect(stepBar(HIDDEN, y, y + 1)).toEqual({ hidden: false, from: y });
  });

  it("is asymmetric on purpose: down needs 24px, up needs 1", () => {
    const y = BAR_KEEP_UNTIL + 500;
    expect(stepBar(HIDDEN, y, y + 1).hidden).toBe(false);
    expect(stepBar(SHOWN, y, y - 1).hidden).toBe(false);
  });
});

describe("near the top of the article the bar always stays", () => {
  it("shows inside the first screenful whatever the reader is doing", () => {
    // A big downward delta that ends up above the line still shows the bar:
    // up there it has not finished sticking, and hiding something mid-slide
    // reads as a glitch rather than as an affordance.
    expect(stepBar(HIDDEN, BAR_KEEP_UNTIL - 1, 0)).toEqual({
      hidden: false,
      from: BAR_KEEP_UNTIL - 1,
    });
  });

  it("takes effect from the boundary and not before", () => {
    expect(stepBar(SHOWN, BAR_KEEP_UNTIL, 0).hidden).toBe(true);
    expect(stepBar(SHOWN, BAR_KEEP_UNTIL - 1, 0).hidden).toBe(false);
  });
});

describe("it settles rather than oscillating", () => {
  it("holds its state when nothing moves", () => {
    const y = BAR_KEEP_UNTIL + 500;
    expect(stepBar(HIDDEN, y, y)).toEqual({ hidden: true, from: y });
    expect(stepBar(SHOWN, y, y)).toEqual({ hidden: false, from: y });
  });

  it("never flips twice for one continuous gesture", () => {
    // A steady scroll down: one transition, then nothing but repeats of it.
    let state = { hidden: SHOWN, from: 0 };
    const flips: number[] = [];
    for (let y = 0; y <= 3000; y += 30) {
      const next = stepBar(state.hidden, y, state.from);
      if (next.hidden !== state.hidden) flips.push(y);
      state = next;
    }
    // 150 is still inside the first screenful, so 180 is the first sample that
    // can hide anything — and it is the only flip in the whole gesture.
    expect(flips).toEqual([180]);
  });
});
