// @vitest-environment jsdom
/**
 * **The two numbers that go wrong when a bar moves without shrinking.**
 *
 * The bottom bar learnt to slide out of the way on a small device
 * (docs/plans/mobile-screen-real-estate.md § 3), by `transform` — which moves
 * where an element is drawn and does not change its height. Every measurement
 * taken with `.height` therefore goes on reporting a confident number for a bar
 * that is entirely off screen, and nothing errors: a screenful step simply
 * delivers a screen that is a bar short, and the lines in the gap are never
 * read.
 *
 * `stickyOffset` had already met this once and was fixed for it (see its own
 * comment); `dockOffset` had not, and GPT Sol found it reviewing the plan
 * before the CSS was written. **Both of these tests fail against the previous
 * implementation** — the first because `.height` ignores the transform, the
 * second because there was no clamp at all.
 *
 * ## Why the rects are stubbed
 *
 * jsdom has no layout: every `getBoundingClientRect` is zeroes, so a test that
 * built real elements and scrolled them would pass against any implementation
 * whatsoever — the thing this repo keeps meeting
 * (docs/reusable/silent-success.md). Posing the rect directly is the only way
 * to state "a bar of height 52 whose top edge is at the bottom of the window",
 * which is the case that matters and the one no browser pass would think to set
 * up.
 */
import { afterEach, describe, expect, it } from "vitest";

import { dockOffset, stickyOffset } from "../src/web/scroll.js";
import { shouldOfferInstall } from "../src/web/install-hint.js";
import { safeAreaInsets } from "../src/web/safe-area.js";

const VIEWPORT_H = 800;
const DOCK_H = 52;

/**
 * A `.dock` in the document whose rect says what we tell it to.
 *
 * `top` is the whole input: everything `dockOffset` may correctly return is a
 * function of where the bar's top edge is relative to the bottom of the window.
 */
function poseDock(top: number): void {
  const el = document.createElement("div");
  el.className = "dock";
  el.getBoundingClientRect = () =>
    ({
      top,
      bottom: top + DOCK_H,
      height: DOCK_H,
      width: 390,
      left: 0,
      right: 390,
      x: 0,
      y: top,
    }) as DOMRect;
  document.body.appendChild(el);
}

const BAR_H = 44;
const HEAD_H = 40;

/**
 * A `.controls` bar and a `thead th`, both with posed rects, plus a status-bar
 * inset the machine running this does not have.
 *
 * `barBottom` is the input: where the bar's bottom edge currently is. That is
 * the one thing `stickyOffset` can measure, and the three cases below are the
 * three values it takes — far down the page (not stuck yet), at rest under the
 * clock, and negative (slid off the top).
 */
function poseBar(barBottom: number, safeTop: number): void {
  /* The inset is posed by writing real pixels onto the probe safe-area.ts
     makes. jsdom has no `env()`, so this is the only way to say "this machine
     has a 47px status bar" — and without it every assertion below would hold
     against a `stickyOffset` that ignored the inset entirely, which is the
     whole regression. */
  safeAreaInsets();
  const probe = document.querySelector<HTMLElement>('div[aria-hidden="true"]');
  probe?.style.setProperty("padding-top", `${safeTop}px`);

  const bar = document.createElement("div");
  bar.className = "controls";
  bar.getBoundingClientRect = () =>
    ({ top: barBottom - BAR_H, bottom: barBottom, height: BAR_H }) as DOMRect;
  document.body.appendChild(bar);

  const table = document.createElement("table");
  const head = document.createElement("thead");
  const th = document.createElement("th");
  th.getBoundingClientRect = () => ({ top: 0, bottom: HEAD_H, height: HEAD_H }) as DOMRect;
  head.appendChild(th);
  table.appendChild(head);
  document.body.appendChild(table);
}

afterEach(() => {
  document.body.innerHTML = "";
});

/**
 * **The chrome a jump has to clear, on a phone with a status bar.**
 *
 * Every number here is 47px different from what this function returned before
 * `viewport-fit=cover`, and 47 is `env(safe-area-inset-top)` on an installed
 * app on a notched iPhone — which is zero on every machine that can run this
 * suite. Posing it is the only way to have an opinion about it at all.
 */
describe("stickyOffset with a status bar", () => {
  const SAFE_TOP = 47;

  it("predicts the resting bar while it is still scrolling down the page", () => {
    // Not stuck yet: bottom is far down, so the clamp's ceiling answers.
    poseBar(300, SAFE_TOP);
    expect(stickyOffset()).toBe(SAFE_TOP + BAR_H + HEAD_H); // 131
  });

  it("measures the bar once it is stuck under the clock", () => {
    poseBar(SAFE_TOP + BAR_H, SAFE_TOP);
    expect(stickyOffset()).toBe(SAFE_TOP + BAR_H + HEAD_H); // 131
  });

  it("still clears the status bar once the bar has slid off the top", () => {
    /* The bar is translated to just above the screen, so its `bottom` is
       negative. **This is the assertion the floor exists for.** With
       `Math.max(0, …)` the answer was 40 — the table head's height alone — for
       a head that is in fact pinned at 47 and whose bottom edge is at 87. Every
       deep link and arrow-key step would have landed 47px under the clock, in
       the state a reader spends most of their time in, on the one device this
       feature is for. */
    poseBar(-3, SAFE_TOP);
    expect(stickyOffset()).toBe(SAFE_TOP + HEAD_H); // 87, not 40
  });

  it("is unchanged on a machine with no status bar", () => {
    // The control: all three cases collapse to what this returned before.
    poseBar(BAR_H, 0);
    expect(stickyOffset()).toBe(BAR_H + HEAD_H); // 84
    document.body.innerHTML = "";
    poseBar(-BAR_H, 0);
    expect(stickyOffset()).toBe(HEAD_H); // 40
  });

  it("is zero before the table exists, whatever the inset", () => {
    safeAreaInsets();
    document.querySelector<HTMLElement>('div[aria-hidden="true"]')
      ?.style.setProperty("padding-top", "47px");
    expect(stickyOffset()).toBe(0);
  });
});

describe("dockOffset", () => {
  it("reports the bar's height while the bar is at rest", () => {
    window.innerHeight = VIEWPORT_H;
    poseDock(VIEWPORT_H - DOCK_H);
    expect(dockOffset()).toBe(DOCK_H);
  });

  it("reports nothing once the bar has slid off the bottom", () => {
    window.innerHeight = VIEWPORT_H;
    // Translated down by its own height: drawn entirely below the window.
    poseDock(VIEWPORT_H);
    /* **This is the assertion that was worth writing.** The old implementation
       returned `rect.height` and would say 52 here — for a bar covering
       nothing — so every screenful step would have stopped 52px short of the
       screen it promised. */
    expect(dockOffset()).toBe(0);
  });

  it("never reports a negative coverage, however far past the edge the bar is", () => {
    window.innerHeight = VIEWPORT_H;
    poseDock(VIEWPORT_H + 200);
    expect(dockOffset()).toBe(0);
  });

  it("is zero when there is no bar on the page at all", () => {
    expect(dockOffset()).toBe(0);
  });
});

/**
 * The install hint's four conditions.
 *
 * The interesting one is `standalone`: a reader who has already installed the
 * app is the one most likely to be irritated by being told to install it, so
 * every combination that includes it must come out false.
 */
describe("shouldOfferInstall", () => {
  const ONLY_CASE = { coarsePointer: true, ios: true, standalone: false, dismissed: false };

  it("offers on an uninstalled iOS device that has not dismissed it", () => {
    expect(shouldOfferInstall(ONLY_CASE)).toBe(true);
  });

  it("says nothing on a desktop, an Android, an installed app, or after a dismissal", () => {
    expect(shouldOfferInstall({ ...ONLY_CASE, coarsePointer: false })).toBe(false);
    expect(shouldOfferInstall({ ...ONLY_CASE, ios: false })).toBe(false);
    expect(shouldOfferInstall({ ...ONLY_CASE, standalone: true })).toBe(false);
    expect(shouldOfferInstall({ ...ONLY_CASE, dismissed: true })).toBe(false);
  });
});

/**
 * The probe that reads the insets.
 *
 * jsdom does not implement `env()`, so it resolves the probe's padding to
 * nothing — which is exactly the "browser that has never heard of this"
 * case, and the answer has to be zero rather than `NaN`. A `NaN` here would
 * propagate into `fitView`'s width and `stickyOffset`'s ceiling and turn a
 * layout into blank space.
 *
 * The second test is the control: it overwrites the probe's own padding with
 * real pixels and checks the number comes back, so a `safeAreaInsets` that had
 * stopped reading anything at all could not pass this file by returning zeroes.
 */
describe("safeAreaInsets", () => {
  it("is all zeroes where env() is not understood, and never NaN", () => {
    const insets = safeAreaInsets();
    expect(insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    for (const v of Object.values(insets)) expect(Number.isNaN(v)).toBe(false);
  });

  it("reads back real pixels, so zeroes above mean zero rather than blind", () => {
    safeAreaInsets(); // makes the probe
    const el = document.querySelector<HTMLElement>('div[aria-hidden="true"]');
    expect(el).not.toBeNull();
    el?.style.setProperty("padding-top", "47px");
    el?.style.setProperty("padding-left", "21px");
    expect(safeAreaInsets().top).toBe(47);
    expect(safeAreaInsets().left).toBe(21);
  });
});
