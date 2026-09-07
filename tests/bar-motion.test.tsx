// @vitest-environment jsdom
/**
 * **What has to happen when the bar moves, and only when the bar moves.**
 *
 * The controls bar slides out of the way while you read forwards. Everything
 * pinned under it is moved by a CSS token and slides with it — except the
 * fisheye panels, which are placed by JavaScript from a measured rect
 * (useColumnContext.ts) and therefore have to be *told*. Until 2026-09-07 they
 * were not told, and narrow-window.css § a small device carried a comment
 * saying so and predicting this file:
 *
 * > the column-context panels are positioned by JS … so for up to 180ms after
 * > the bar moves a panel can sit up to 44px out of step … If it ever looks
 * > wrong, the fix is to re-sample on `transitionend` rather than to drop the
 * > slide.
 *
 * That was written when only a phone hid its bars, and a portrait phone has no
 * panels. A **landscape** phone has both — 844×390 matches `max-height: 620px`
 * while 844 is past the 732 a gist column needs beside the prose — so the
 * defect was already reachable, and
 * docs/plans/260907b-the-top-bar-leaves-while-you-read-at-every-width.md makes
 * it reachable on every laptop.
 *
 * ## What is pinned here, and why each one is a test rather than a sentence in
 * ## a comment
 *
 * 1. **A panel re-samples when `data-bars` changes, with no scroll event at
 *    all.** The reader who stops scrolling on the very frame the bar gives way
 *    gets no further sample, and that is the *only* case where the transient
 *    becomes a resting state. It cannot be left to `apply()` in scroll.ts and
 *    `measure()` here happening to run in the right order: both are
 *    `requestAnimationFrame` callbacks in the same frame and the order is
 *    whichever effect registered first.
 *
 * 2. **`data-bar-moving` is cleared even when no `transitionend` ever
 *    arrives.** It scopes the panels' slide to the one case that should have
 *    one, so a latched attribute means every panel animates its `top` for ever
 *    — including through the first 150px of ordinary scrolling, where the
 *    sticky head is settling out from under the masthead and a lagging panel is
 *    exactly the defect this scoping exists to avoid. A transition that never
 *    starts never ends: reduced motion, a background tab, or a rule somebody
 *    deletes.
 *
 * 3. **A pill's colour fade is not the bar arriving.** `transitionend` bubbles,
 *    and `.controls` is full of 120ms transitions (pill.ts), so a listener that
 *    took any of them ended the slide a third of the way through.
 *
 * 4. **Focus is a fourth way the bar moves, and `data-bars` cannot describe
 *    it.** The `:focus-within` guard in shell.css puts the bar back while the
 *    attribute stays `"hidden"` — see § focus moves the bar. GPT Sol F6.
 *
 * ## Why the rects are stubbed
 *
 * jsdom has no layout, so every `getBoundingClientRect` is zeroes and a test
 * built out of real elements would pass against any implementation whatsoever
 * — docs/reusable/silent-success.md, and the same reasoning
 * tests/mobile-chrome.test.ts gives at greater length. Posing the numbers is
 * the only way to state "a header whose bottom edge is at 44, and then at 0".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createElement, useRef } from "react";

import { useColumnContext, type ColumnRect } from "../src/web/useColumnContext.js";
import { BAR_MOVE_MAX_MS, watchBarVisibility } from "../src/web/scroll.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The bar's height, and so the whole of the distance every panel has to move. */
const BAR_H = 44;

let host: HTMLElement;
let root: Root;
let stop: (() => void) | undefined;

/**
 * Set to pose a head position that `data-bars` does **not** predict — the focus
 * guard's case, where the bar comes back down while the attribute stays
 * `"hidden"`. `null` means "follow `data-bars`", which is every other case.
 */
let barBottomOverride: number | null = null;

/**
 * A table with one gist column, posed so the header's bottom edge answers to
 * `data-bars` the way the stylesheet makes it answer.
 *
 * The `<th>` is the measuring stick every panel's `top` comes from, and the
 * point of posing it this way is that it reads the attribute *synchronously* —
 * exactly as a browser would, where the token switch is a style recalculation
 * forced by the `getBoundingClientRect()` call itself.
 */
function poseTable(): void {
  const table = document.createElement("table");
  table.className = "zoom";
  const thead = document.createElement("thead");
  const tr = document.createElement("tr");
  const th = document.createElement("th");
  th.setAttribute("data-col", "1");
  th.getBoundingClientRect = () => {
    const hidden = document.documentElement.dataset.bars === "hidden";
    const bottom = barBottomOverride ?? (hidden ? 0 : BAR_H);
    return { top: bottom, bottom, left: 0, right: 230, width: 230, height: 0 } as DOMRect;
  };
  tr.append(th);
  thead.append(tr);
  table.append(thead);
  document.body.append(table);
}

/** A `.controls` that never fires `transitionend` — the latching case. */
function poseSilentBar(): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "controls";
  bar.getBoundingClientRect = () =>
    ({ top: 0, bottom: BAR_H, left: 0, right: 1440, width: 1440, height: BAR_H }) as DOMRect;
  document.body.append(bar);
  return bar;
}

/* **Module constants, not literals in the render.** `useColumnContext`'s effect
   lists `sections` and `depths` among its dependencies, so fresh arrays every
   render would tear the effect down and rebuild it on each one — and since the
   effect's own `measure()` sets state, that is an infinite loop rather than a
   slow test. Caught by this file hanging, 2026-09-07. */
const SECTIONS = [{ blockId: "spya-aaaaaa", row: 0 }] as never;
const DEPTHS = [1];

/** Drives the hook and reports every `ColumnRect` it has produced, in order. */
function Harness({ seen }: { seen: ColumnRect[] }) {
  const live = useColumnContext({
    sections: SECTIONS,
    depths: DEPTHS,
    enabled: true,
    layoutKey: "k",
  });
  const last = useRef<ColumnRect | undefined>(undefined);
  const r = live.rects.get(1);
  if (r && (!last.current || last.current.top !== r.top)) {
    last.current = r;
    seen.push(r);
  }
  return null;
}

/* jsdom has neither of these, and both are incidental to what is being tested:
   the hook observes the table for a late image or a font swap (nothing here
   resizes), and `watchBarVisibility` no longer asks the breakpoint at all —
   the stub only exists so a call that has gone does not throw if it comes
   back. See the `matches: false` note below for why the value matters. */
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  /* **`matches: false`, and that is load-bearing.** `watchBarVisibility` used to
     hold a copy of § a small device's media query and attach its listener only
     while it matched; the gate went on 2026-09-07 so the bar could hide on a
     laptop. Stubbing `true` — which this file did at first — would let anybody
     reintroduce that gate under any name and still pass every test here, which
     is the whole regression this change is about. Stubbed `false`, a
     wide-screen gate fails these functionally rather than by spelling. GPT Sol
     F9, 2026-09-07. `tests/spine-width.test.ts` keeps the spelling check as
     well, against a dead constant left sitting there to mislead. */
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  stop?.();
  stop = undefined;
  delete document.documentElement.dataset.bars;
  delete document.documentElement.dataset.barMoving;
  document.body.innerHTML = "";
  barBottomOverride = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  /* **`watchBarVisibility` reads `window.scrollY` once, at attach, as its
     baseline.** Leave 1000 behind and the next test's listener starts from
     there, its scroll event carries a delta of zero, and the bar never gives
     way — a test that fails saying the attribute is missing when what is
     actually missing is the scroll. Cost twenty minutes on 2026-09-07. */
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
});

describe("a panel re-samples when the bar moves, with nobody scrolling", () => {
  it("takes a fresh measurement from a `data-bars` change alone", async () => {
    poseTable();
    const seen: ColumnRect[] = [];
    await act(async () => {
      root.render(createElement(Harness, { seen }));
    });
    expect(seen.at(-1)?.top, "the resting measurement").toBe(BAR_H);

    /* No scroll event, no resize, and the table does not change size — the
       reader stopped moving on the frame the bar gave way. This is the whole
       test: without a watcher on the attribute, nothing here schedules a
       measurement and the panel stays 44px below where the column now starts. */
    await act(async () => {
      document.documentElement.dataset.bars = "hidden";
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });

    expect(seen.at(-1)?.top, "the measurement after the bar left").toBe(0);
  });

  /**
   * **And the same for a move that `data-bars` cannot describe.** The focus
   * guard puts the bar back while the attribute stays `"hidden"` — see § focus
   * moves the bar below for the four-step sequence — so `data-bar-moving`,
   * which scroll.ts writes on *every* announced move, is the second signal the
   * sampler has to watch. Posed here directly rather than through
   * `watchBarVisibility`, because what is being tested is the observer's filter.
   */
  it("takes a fresh measurement from a `data-bar-moving` change alone", async () => {
    poseTable();
    document.documentElement.dataset.bars = "hidden";
    const seen: ColumnRect[] = [];
    await act(async () => {
      root.render(createElement(Harness, { seen }));
    });
    expect(seen.at(-1)?.top, "hidden at mount").toBe(0);

    /* The guard has started matching: the head is back at 44 and nothing about
       `data-bars` has changed. Only the announcement can say so. */
    barBottomOverride = BAR_H;
    await act(async () => {
      document.documentElement.dataset.barMoving = "";
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });

    expect(seen.at(-1)?.top, "the measurement after focus brought the bar back").toBe(BAR_H);
  });
});

/**
 * **The bar can move without `data-bars` changing, and the panels have to hear
 * about it.**
 *
 * `:root:has(.controls:focus-within, .mode-band)` in shell.css puts
 * `--bar-bottom` and `--bar-hide` back **while `data-bars` is still `"hidden"`**
 * — that is the whole point of the guard, so a keyboard reader tabbing the
 * granularity pills does not lose the control they are standing on. But it
 * means focus alone moves the bar and the table head 44px, twice, with no
 * attribute on `<html>` changing at either end:
 *
 *   1. scroll down until the bar gives way (`data-bars="hidden"`)
 *   2. let the backstop clear `data-bar-moving`
 *   3. Tab into a pill — the guard matches, the bar comes back down
 *   4. Tab out again — the guard stops matching, the bar leaves
 *
 * At (3) and (4) an observer watching only `data-bars` sees nothing, so every
 * panel stays 44px out of step until the reader happens to scroll. That is the
 * keyboard reader, in Hierarchy, which is the mode the whole feature is for.
 * GPT Sol F6, 2026-09-07.
 *
 * The fix is in two halves and needs both: scroll.ts announces the move
 * (`startMoving` on `focusin`/`focusout` inside the bar, so the panels *slide*
 * rather than snapping), and useColumnContext observes `data-bar-moving` as
 * well as `data-bars`, so the announcement is also what triggers the
 * re-measurement.
 */
describe("focus moves the bar, and the panels are told", () => {
  it("announces a move when focus enters and leaves the bar while it is hidden", async () => {
    vi.useFakeTimers();
    const bar = poseSilentBar();
    const pill = document.createElement("button");
    bar.append(pill);
    stop = watchBarVisibility();

    Object.defineProperty(window, "scrollY", { value: 1000, configurable: true });
    window.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(20);
    expect(document.documentElement.dataset.bars).toBe("hidden");

    // The slide finishes and the attribute goes, as it should.
    await vi.advanceTimersByTimeAsync(BAR_MOVE_MAX_MS + 50);
    expect(document.documentElement.dataset.barMoving).toBeUndefined();

    // Tab in. `data-bars` does not change — the guard is a CSS pseudo-class —
    // but the bar comes back down, so this has to be announced.
    pill.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(
      document.documentElement.dataset.barMoving,
      "focus entering a hidden bar brings it back",
    ).toBe("");
    expect(document.documentElement.dataset.bars, "and it is still hidden").toBe("hidden");

    await vi.advanceTimersByTimeAsync(BAR_MOVE_MAX_MS + 50);

    // And tab out, which takes it away again.
    pill.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(
      document.documentElement.dataset.barMoving,
      "focus leaving a hidden bar takes it away again",
    ).toBe("");
  });

  it("says nothing when the bar is not hidden, because then focus moves nothing", async () => {
    vi.useFakeTimers();
    const bar = poseSilentBar();
    const pill = document.createElement("button");
    bar.append(pill);
    stop = watchBarVisibility();

    /* At rest the guard changes no value — `--bar-bottom` is already
       `--bar-h + --safe-top`. Announcing a move here would put every panel into
       a 180ms transition for a bar that is not going anywhere, every time the
       reader tabbed through the pills. */
    pill.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(document.documentElement.dataset.barMoving).toBeUndefined();
  });
});

describe("`data-bar-moving` marks the slide, and does not latch", () => {
  it("goes on when the bar gives way and off when the transition never ends", async () => {
    vi.useFakeTimers(); // fakes rAF as well, which is what drives `apply()`
    poseSilentBar();
    stop = watchBarVisibility();

    /* Past BAR_KEEP_UNTIL, and a push bigger than BAR_HIDE_AFTER, so the bar
       gives way and the attribute that scopes the panels' slide goes on. */
    Object.defineProperty(window, "scrollY", { value: 1000, configurable: true });
    window.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(20);

    expect(document.documentElement.dataset.bars, "the bar gave way").toBe("hidden");
    expect(document.documentElement.dataset.barMoving, "and said it was moving").toBe("");

    /* The bar posed here never fires `transitionend` — reduced motion, a
       background tab, or a rule somebody deleted. If that event is the only
       thing that clears the attribute, it is now on for the rest of the session
       and every panel animates its `top` through ordinary scrolling, which is
       the very case the scoping exists to keep instant. */
    await vi.advanceTimersByTimeAsync(BAR_MOVE_MAX_MS + 50);
    expect(document.documentElement.dataset.barMoving).toBeUndefined();
  });

  /**
   * **`transitionend` bubbles, and the bar is full of things that transition.**
   *
   * `.controls` holds the granularity pills, which are shadcn `Toggle`s wearing
   * the PILL string — `transition-[color,background-color,border-color]` over
   * **120ms** (src/web/pill.ts). Hover one, or press one, while the bar is
   * sliding and three `transitionend` events bubble up to `.controls` well
   * before its own 180ms `transform` finishes.
   *
   * A listener that takes any of them for its own ends the slide about a third
   * of the way through, and the symptom is a panel stopping dead in the middle
   * of the screen — not an error, and not reproducible without a pointer on a
   * pill at the right moment. So the listener asks for the bar's own
   * `transform` by name.
   */
  it("ignores a transition that bubbled up from a pill", async () => {
    vi.useFakeTimers();
    const bar = poseSilentBar();
    const pill = document.createElement("button");
    bar.append(pill);
    stop = watchBarVisibility();
    Object.defineProperty(window, "scrollY", { value: 1000, configurable: true });
    window.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(20);
    expect(document.documentElement.dataset.barMoving).toBe("");

    // The pill finishes its 120ms colour fade, 60ms before the bar arrives.
    pill.dispatchEvent(
      new TransitionEvent("transitionend", { bubbles: true, propertyName: "background-color" }),
    );
    expect(
      document.documentElement.dataset.barMoving,
      "a pill's colour fade is not the bar arriving",
    ).toBe("");

    // And the bar's own transform is.
    bar.dispatchEvent(
      new TransitionEvent("transitionend", { bubbles: true, propertyName: "transform" }),
    );
    expect(document.documentElement.dataset.barMoving).toBeUndefined();
  });

  it("clears the attribute on the way out, so a teardown cannot strand it", async () => {
    vi.useFakeTimers();
    poseSilentBar();
    stop = watchBarVisibility();
    Object.defineProperty(window, "scrollY", { value: 1000, configurable: true });
    window.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(20);
    expect(document.documentElement.dataset.barMoving).toBe("");

    stop();
    stop = undefined;
    expect(document.documentElement.dataset.barMoving).toBeUndefined();
    expect(document.documentElement.dataset.bars).toBeUndefined();
  });
});
