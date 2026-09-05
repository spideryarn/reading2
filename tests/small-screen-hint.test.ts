// @vitest-environment jsdom
/**
 * **Who gets told the window is too small, and who is spared.**
 *
 * `src/web/small-screen-hint.ts` is a predicate over three facts and a second
 * one over two numbers, and every one of the interesting cases is a machine
 * rather than a state of the app — which is why the module takes them as
 * arguments instead of measuring. This file writes those machines down.
 *
 * The one that would be easy to get wrong and impossible to notice is the
 * laptop dragged narrow: it hits the identical layout, and a banner explaining
 * a reader's own window drag back to them is noise. `coarsePointer` is the only
 * thing standing between it and them, so it has a test of its own rather than
 * riding along in a table.
 *
 * The second is the iPad, and it is the reason `bandCovers` is a fact from
 * layout.ts rather than a width compared here. Portrait is **834px**, which is
 * *above* `MODE_MIN + PROSE_MIN` — so the first draft of this feature, which
 * compared against that sum and called the 12px of rail a harmless
 * approximation, showed the banner on every phone and on no iPad at all. The
 * device it was most obviously for was the one it missed, by two pixels.
 *
 * **The widths below are windows, not phones.** `useWindowWidth` in App.tsx
 * subtracts the safe-area insets before any of this arithmetic runs, so a named
 * device is never quite the number on its spec sheet. Where a case is close to
 * the boundary it is named as arithmetic; where it is comfortably past it, the
 * device name is safe and is used.
 *
 * The seam these cannot reach — `matchMedia`, `localStorage`, and whether the
 * banner draws at all — is `tests/small-screen-banner.test.tsx`.
 *
 * docs/plans/260905e-a-small-screen-banner-on-a-phone.md.
 */
import { describe, expect, it } from "vitest";
import { bandCoversProse, MODE_MIN, PROSE_MIN, SPINE_W } from "../src/web/layout.js";
import {
  moreRoomSideways,
  readMachine,
  rememberDismissed,
  shouldWarnSmallScreen,
  wasDismissed,
} from "../src/web/small-screen-hint.js";

/** A phone in portrait, undismissed — the case the banner exists for. */
const PHONE = { bandCovers: true, coarsePointer: true, dismissed: false };

/**
 * What `App.tsx` passes: the layout's own answer, and the raw `?spine=` value
 * rather than the resolved one. `null` is *nobody has chosen*, which means the
 * rail is on — the default, and the case every viewport below is written in.
 */
const covers = (windowWidth: number, showSpine: boolean | null = null) =>
  bandCoversProse(windowWidth, showSpine);

describe("the crossover the banner describes", () => {
  it("is layout.ts's, and moves with the rail", () => {
    // 832 with `?spine=0`, 844 without it. Written out as the two boundaries
    // rather than as the sum, because the whole point of `bandCoversProse` is
    // that a caller must not have to know which of the two applies.
    expect(covers(MODE_MIN + PROSE_MIN - 1, false)).toBe(true);
    expect(covers(MODE_MIN + PROSE_MIN, false)).toBe(false);
    expect(covers(MODE_MIN + PROSE_MIN + SPINE_W - 1)).toBe(true);
    expect(covers(MODE_MIN + PROSE_MIN + SPINE_W)).toBe(false);
  });

  it("treats an unset rail as an on rail, the way an opening band will find it", () => {
    // `null` and `true` must answer alike: `?spine=0` is the only thing that
    // takes the rail away in a mode, and the banner has to describe the band
    // the reader is about to open rather than the layout they are looking at.
    // A caller that read `Fit.spine` instead would get "off" in outline mode,
    // where there is no band, and the banner would blink as they switched.
    expect(covers(838, null)).toBe(true);
    expect(covers(838, true)).toBe(true);
    expect(covers(838, false)).toBe(false);
  });

  it("catches an iPad in portrait and leaves one in landscape alone", () => {
    // 834 × 1194 and back again. This is the case that made `bandCovers` a fact
    // rather than an approximation — see the header. Portrait warns, and *turn
    // it sideways* is right there precisely because landscape does not.
    expect(shouldWarnSmallScreen({ ...PHONE, bandCovers: covers(834) })).toBe(true);
    expect(shouldWarnSmallScreen({ ...PHONE, bandCovers: covers(1194) })).toBe(false);
  });

  it("gives way at 844 exactly, on a window with nothing taken out of it", () => {
    // 844 − 12 of rail = 832 = `MODE_MIN + PROSE_MIN`: the band fits beside the
    // prose with nothing to spare. Pinned because it is the single width at
    // which a `>=` written for a `>` would be invisible.
    //
    // **This is arithmetic, not a device.** It is tempting to call it "an
    // iPhone 14 in landscape", and that would be false: `useWindowWidth` in
    // App.tsx hands `bandCoversProse` the width *minus the notch*, and a
    // notched phone sideways spends tens of pixels on safe-area insets — so a
    // real 844pt landscape phone is fed something well under 844 and keeps the
    // banner. The runtime behaviour is right either way (the band really does
    // cover there); the false thing would be the name. GPT Sol, 2026-09-05.
    expect(shouldWarnSmallScreen({ ...PHONE, bandCovers: covers(390) })).toBe(true);
    expect(shouldWarnSmallScreen({ ...PHONE, bandCovers: covers(844) })).toBe(false);
    // Well below it, no inset arithmetic can rescue the band: an iPhone SE is
    // 667pt sideways. The banner stays; what goes is the sentence telling them
    // to turn it, which is `moreRoomSideways` below and the whole reason the
    // two are separate.
    expect(shouldWarnSmallScreen({ ...PHONE, bandCovers: covers(667) })).toBe(true);
  });
});

describe("who is spared", () => {
  it("a laptop window dragged narrow, at a width a phone would be warned at", () => {
    // Same layout, same lost article, no banner: the fix is the corner of the
    // window and the reader is the one who moved it.
    expect(shouldWarnSmallScreen({ ...PHONE, coarsePointer: false })).toBe(false);
  });

  it("anyone who has already pressed the ×", () => {
    expect(shouldWarnSmallScreen({ ...PHONE, dismissed: true })).toBe(false);
  });

  it("anyone whose window is wide enough, however they are pointing at it", () => {
    expect(shouldWarnSmallScreen({ ...PHONE, bandCovers: false })).toBe(false);
  });
});

describe("moreRoomSideways", () => {
  it("is true in portrait and false in landscape", () => {
    expect(moreRoomSideways({ width: 390, height: 844 })).toBe(true);
    expect(moreRoomSideways({ width: 844, height: 390 })).toBe(false);
  });

  it("is false on a square window, because rotating buys nothing", () => {
    expect(moreRoomSideways({ width: 700, height: 700 })).toBe(false);
  });
});

describe("the machine, when the browser will not answer", () => {
  /**
   * **jsdom has neither `matchMedia` nor a `window.localStorage` these guards
   * can reach** — Node's own global shadows the second, so an unguarded
   * `.getItem` is a `TypeError` here rather than in a browser. That makes this
   * suite a real test of the fallback rather than a formality: it is the exact
   * shape of a browser in Safari's private mode, or one with site data blocked.
   *
   * The assertion that matters is the *direction* of both fallbacks. Neither may
   * answer `true`: a `matchMedia` that cannot be asked must not put a strip of
   * chrome over somebody's article, and a `localStorage` that cannot be read
   * must not mark the banner dismissed for a reader who never saw it.
   */
  it("cannot tell, and therefore never warns and never claims a dismissal", () => {
    expect(wasDismissed()).toBe(false);
    expect(readMachine()).toEqual({ coarsePointer: false, dismissed: false });
    // And the write is swallowed rather than thrown — the banner simply comes
    // back on the next visit, which is the smaller of the two failures.
    expect(() => rememberDismissed()).not.toThrow();
    expect(wasDismissed()).toBe(false);
    expect(shouldWarnSmallScreen({ ...readMachine(), bandCovers: true })).toBe(false);
  });
});
