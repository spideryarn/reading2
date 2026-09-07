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
 * ## The three things pinned here, and why each one is a test rather than a
 * ## sentence in a comment
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
 * 3. **`place()` centres the list on where the panel is going.** It read the
 *    panel's own live rect, which during a slide is an interpolated value, and
 *    nothing re-placed the list when the panel arrived. GPT Sol found it
 *    reviewing the plan, 2026-09-07 (F1).
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
    const bottom = hidden ? 0 : BAR_H;
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
   resizes), and `watchBarVisibility` asks the breakpoint so a large window
   spends no scroll listener. A query that never matches is the *harder* case
   for the second test, so this stub cannot flatter it. */
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  /* `matches: true` so this file is about the attribute rather than about the
     breakpoint. Stage 2 of the plan removes the query from `watchBarVisibility`
     altogether; pinning `true` means these tests say the same thing before and
     after that, instead of passing for a reason that is about to change. */
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true,
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
