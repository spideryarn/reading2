// @vitest-environment jsdom
/**
 * **The two numbers that go wrong when a bar moves without shrinking.**
 *
 * The bottom bar learnt to slide out of the way on a small device
 * (docs/plans/260828av-mobile-screen-real-estate.md § 3), by `transform` — which moves
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

/**
 * A `.controls` bar with a posed rect, plus a status-bar inset the machine
 * running this does not have.
 *
 * `barBottom` is the input: where the bar's bottom edge currently is. That is
 * the one thing `stickyOffset` can measure, and the three cases below are the
 * three values it takes — far down the page (not stuck yet), at rest under the
 * clock, and negative (slid off the top).
 *
 * **This used to pose a `thead th` too**, because the answer used to be the bar
 * plus the table head. Since 2026-09-05 the head has no height (styles.css
 * § the head with no row) and `stickyOffset` does not look for one at all — so a
 * head posed here could only hide a regression. `poseArticleHead` below is the
 * deliberate opposite: a head that is emphatically *not* ours, sitting on the
 * page, so the cases can state that the function cannot be confused by one.
 */
function poseBar(barBottom: number, safeTop: number): void {
  poseInset(safeTop);

  const bar = document.createElement("div");
  bar.className = "controls";
  bar.getBoundingClientRect = () =>
    ({ top: barBottom - BAR_H, bottom: barBottom, height: BAR_H }) as DOMRect;
  document.body.appendChild(bar);
}

/**
 * The status bar on its own, for the cases that pose no `.controls`.
 *
 * Written as real pixels onto the probe safe-area.ts makes. jsdom has no
 * `env()`, so this is the only way to say "this machine has a 47px status
 * bar" — and without it every assertion below would hold against a
 * `stickyOffset` that ignored the inset entirely, which is the whole
 * regression.
 */
function poseInset(safeTop: number): void {
  safeAreaInsets();
  document
    .querySelector<HTMLElement>('div[aria-hidden="true"]')
    ?.style.setProperty("padding-top", `${safeTop}px`);
}

/**
 * **A `<thead>` belonging to the *article*, which is a thing that exists.**
 *
 * An author's own prose can contain a table, and `src/sanitize.ts` keeps its
 * head — checked by running the sanitiser over one rather than by reading the
 * allowlist. `stickyOffset` used to finish with
 * `document.querySelector("thead th")`, a query with no scope on it whatever,
 * so a decoy like this one was always a candidate answer; only document order
 * kept it from being picked. The rect here is 300px tall at y=900, which is
 * nothing like any number the function may correctly return, so a version that
 * went back to reading a head could not pass by coincidence.
 */
function poseArticleHead(): void {
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const th = document.createElement("th");
  th.getBoundingClientRect = () => ({ top: 900, bottom: 1200, height: 300 }) as DOMRect;
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
 *
 * **Rewritten 2026-09-05**, when the table head lost its height and this
 * function stopped adding it on. The three positions the bar can be in are
 * unchanged; what went is a second term of 40 that used to be in every
 * expectation, and the answer for "no bar at all" moved from `0` to the inset.
 */
describe("stickyOffset with a status bar", () => {
  const SAFE_TOP = 47;

  it("predicts the resting bar while it is still scrolling down the page", () => {
    // Not stuck yet: bottom is far down, so the clamp's ceiling answers.
    poseBar(300, SAFE_TOP);
    expect(stickyOffset()).toBe(SAFE_TOP + BAR_H); // 91
  });

  it("measures the bar once it is stuck under the clock", () => {
    poseBar(SAFE_TOP + BAR_H, SAFE_TOP);
    expect(stickyOffset()).toBe(SAFE_TOP + BAR_H); // 91
  });

  it("still clears the status bar once the bar has slid off the top", () => {
    /* The bar is translated to just above the screen, so its `bottom` is
       negative. **This is the assertion the floor exists for**, and it survived
       the head losing its height: there is a fixed opaque `.reader::before` of
       exactly the inset's height (styles.css `.reader::before`), so a destination has
       to clear the status bar even with every bar gone. A floor of `0` would
       land every deep link and arrow-key step under the clock, in the state a
       reader spends most of their time in, on the one device this feature is
       for. */
    poseBar(-3, SAFE_TOP);
    expect(stickyOffset()).toBe(SAFE_TOP); // 47, not 0
  });

  /**
   * **A bar that is halfway back reserves the room it is going to need.**
   *
   * `stickyOffset` returned the bar's *current* coverage, and that is only the
   * right answer at rest. `scrollToBlock` calls this **once** and hands the
   * number to `glide()` as a fixed destination; `markOurScroll` then stops the
   * bar reacting to the jump, but it cannot stop a CSS transition that is
   * already running. So a reader who scrolls up — starting the 180ms reveal —
   * and clicks a gist 90ms later got a target placed under a bar on its way
   * back to covering it, and the row they asked for finished underneath the
   * chrome.
   *
   * Both directions are posed because they are not symmetrical. Mid-*reveal*
   * the new answer is exactly right. Mid-*hide* it over-reserves by up to a
   * bar's height, and that is the deliberate way round: an over-reserved target
   * lands a little lower than it needed to, an under-reserved one lands
   * invisible.
   *
   * GPT Sol F2, reviewing
   * docs/plans/260907b-the-top-bar-leaves-while-you-read-at-every-width.md,
   * which extends this animation from phones to every laptop.
   */
  it("reserves the whole bar while the bar is still travelling", () => {
    // Halfway through the reveal: 22 of 44 drawn, and climbing.
    poseBar(SAFE_TOP + BAR_H / 2, SAFE_TOP);
    expect(stickyOffset()).toBe(SAFE_TOP + BAR_H); // not 69

    // Halfway through the hide: 22 of 44 drawn, and falling.
    document.body.innerHTML = "";
    poseBar(SAFE_TOP + BAR_H / 2, SAFE_TOP);
    expect(stickyOffset()).toBe(SAFE_TOP + BAR_H);

    /* And a sliver still showing is still "the bar is there". The boundary is
       the inset, not zero, for the same reason the floor is: `.reader::before`
       paints that strip whatever the bar is doing. */
    document.body.innerHTML = "";
    poseBar(SAFE_TOP + 1, SAFE_TOP);
    expect(stickyOffset()).toBe(SAFE_TOP + BAR_H);
  });

  it("is unchanged on a machine with no status bar", () => {
    // The control: every case collapses to the bar and nothing else.
    poseBar(BAR_H, 0);
    expect(stickyOffset()).toBe(BAR_H); // 44
    document.body.innerHTML = "";
    poseBar(-BAR_H, 0);
    expect(stickyOffset()).toBe(0);
  });

  /**
   * **The status bar is still in the way when nothing else is.**
   *
   * This case used to expect `0` and was named "before the table exists". Both
   * halves were wrong by 2026-09-05: there is no table in the answer any more,
   * and `.reader::before` paints an opaque strip of exactly `--safe-top` under
   * the clock whether or not a `.controls` is drawn. Stage 4 of
   * docs/plans/260905d-declutter-the-reading-view-top-bars.md removes the bar
   * outright in most modes, so this stops being a boot-time transient and
   * becomes the resting state.
   */
  it("still clears the notch when there is no bar on the page at all", () => {
    poseInset(SAFE_TOP);
    expect(stickyOffset()).toBe(SAFE_TOP);
  });

  /**
   * **An article's own `<table><thead>` is not our chrome.**
   *
   * The old implementation ended in a global `document.querySelector("thead
   * th")` and added its height to the answer. Ours happened to come first in
   * document order, so this was latent rather than live — but "the right
   * element by luck of ordering" is not a contract, and the head that used to
   * justify the query now measures nothing anyway. Every position of the bar is
   * re-checked with the decoy present, because a regression here would show
   * only on the articles that happen to contain a table.
   */
  it("ignores a <thead> that belongs to the article", () => {
    poseBar(SAFE_TOP + BAR_H, SAFE_TOP);
    poseArticleHead();
    expect(stickyOffset()).toBe(SAFE_TOP + BAR_H);

    document.body.innerHTML = "";
    poseBar(-3, SAFE_TOP);
    poseArticleHead();
    expect(stickyOffset()).toBe(SAFE_TOP);

    document.body.innerHTML = "";
    poseInset(SAFE_TOP);
    poseArticleHead();
    expect(stickyOffset()).toBe(SAFE_TOP);
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
