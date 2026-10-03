// @vitest-environment jsdom
/**
 * **Scrolling must not re-render the spine.**
 *
 * Greg, 2026-08-27: *"it looks like CPU usage spikes briefly e.g. when I scroll
 * in the main Contents & Text view."*
 *
 * The rail used to hold the scroll position in React state — a rAF-debounced
 * `setScrollY(window.scrollY)`, which is the ordinary way to do it and costs a
 * full re-render of every band, tick and tooltip, sixty times a second, to move
 * one div. Measured on a 22,000-word article: **894 Spine renders across 30
 * seconds of scrolling**, against 124 after the fix.
 *
 * So this pins the two halves of that fix, which are easy to undo by accident
 * because the obvious way to write this component is the slow way:
 *
 * 1. A scroll moves the viewport band **without a render**.
 * 2. Crossing into another part **does** render, because it changes what is
 *    drawn — but once per crossing, not once per frame.
 *
 * ## How the render count is read
 *
 * `perf.js` is mocked rather than started. The real probe is off unless
 * `?perf=1`, and starting it patches `setTimeout`, `rAF` and `fetch`
 * globally — far more than this test needs, and it would make the test depend
 * on the thing it is trying to measure. A four-line stand-in for
 * `useRenderCount` counts commits directly. See docs/project/performance.md.
 */
import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const renders = new Map<string, number>();
vi.mock("../src/web/perf.js", () => ({
  useRenderCount: (label: string) => {
    renders.set(label, (renders.get(label) ?? 0) + 1);
  },
  mark: (_l: string, fn: () => unknown) => fn(),
}));

/* Floating UI does real geometry and is not what is under test; the rail's
   tooltips are chrome around the bands. */
vi.mock("../src/web/Tooltip.js", () => ({
  Tooltip: ({ children }: { children: unknown }) => children,
  TooltipGroup: ({ children }: { children: unknown }) => children,
}));

import { Spine } from "../src/web/Spine.js";
import type { OutlineEntry } from "../src/web/tree.js";
import type { NodeId, TreeNode } from "../src/types.js";

/** Rows are 100px tall and stacked; that is the whole geometry this needs. */
const ROWS = 20;
const ROW_H = 100;

function node(id: string, first: string): TreeNode {
  return {
    id: id as NodeId,
    parent: null,
    children: [],
    depth: 1,
    title: id,
    gist: id,
    range: [first, first],
  } as unknown as TreeNode;
}

/**
 * Two parts of ten rows, **each split into two sections of five**.
 *
 * The sections are not decoration and this file was blind without them. Until
 * 2026-08-28 both parts had `children: []`, which makes `measure`'s `hits`
 * identical to its `l1` — so there was no L2 boundary anywhere in the fixture,
 * and the case below asserting that scrolling *within one part* costs no render
 * could not have encountered one. That mattered the moment the rail started
 * tracking the current **section** as well as the current part: the new cost is
 * invisible to a fixture with no sections in it. GPT Sol found it reviewing the
 * built code.
 */
function outline(): OutlineEntry[] {
  const section = (id: string, first: string, startRow: number): OutlineEntry => ({
    node: node(id, first),
    startRow,
    endRow: startRow + 4,
    words: 50,
    children: [],
  });
  return [
    {
      node: node("a", "b0"),
      startRow: 0,
      endRow: 9,
      words: 100,
      children: [section("a1", "b0", 0), section("a2", "b5", 5)],
    },
    {
      node: node("b", "b10"),
      startRow: 10,
      endRow: 19,
      words: 100,
      children: [section("b1", "b10", 10), section("b2", "b15", 15)],
    },
  ];
}

let root: Root;
let host: HTMLDivElement;

/* jsdom ships no ResizeObserver, and the rail observes `document.body`. Without
   this its layout effect throws and the component never measures — which shows
   up as "the spine rendered once and drew nothing", not as a missing global. */
class FakeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/**
 * Where the article starts on the page, in px. Zero for every case but the one
 * that pins the band's exact translation — a `docTop` of zero would let a
 * formula that forgot to subtract it pass, and the other cases' scroll
 * positions are written against a zero.
 */
let docOffset = 0;

beforeEach(() => {
  /* Without this React does not treat `act` as authoritative and its updates
     are not flushed — the component mounts, its layout effect runs, and the
     state it sets never arrives. It shows up as a rail that measured nothing.
     Same line as tests/use-search.test.ts. */
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
  /* Vitest's jsdom does not run with `pretendToBeVisual`, so there is no
     `requestAnimationFrame` — and the rail debounces every measurement through
     one. A macrotask stand-in keeps the ordering (effect schedules, test
     flushes) while making it deterministic. */
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (
    cb: (t: number) => void,
  ) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
  (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = (
    id: number,
  ) => clearTimeout(id);
  renders.clear();
  docOffset = 0;
  document.body.innerHTML = "";

  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  for (let i = 0; i < ROWS; i++) {
    const tr = document.createElement("tr");
    tr.setAttribute("data-block", `b${i}`);
    tbody.append(tr);
  }
  table.append(tbody);
  document.body.append(table);

  /* jsdom gives every element a zero rect, which would make the whole document
     zero-height and the maths meaningless. Each row reports where it would be
     if the page really were `ROWS * ROW_H` tall — and, crucially, **relative to
     the current scroll**, which is what makes scrolling observable at all. */
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLElement) {
      const block = this.getAttribute("data-block");
      if (!block) return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
      const i = Number(block.slice(1));
      const top = docOffset + i * ROW_H - window.scrollY;
      return { top, bottom: top + ROW_H, left: 0, right: 0, width: 0, height: ROW_H };
    },
  });

  Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 500, writable: true, configurable: true });

  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
});

/** Let the requested animation frame run, and React commit what it sets. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 32));
  });
}

/** Scroll, then run the frame the listener asked for. */
async function scrollTo(y: number): Promise<void> {
  await act(async () => {
    (window as unknown as { scrollY: number }).scrollY = y;
    window.dispatchEvent(new Event("scroll"));
  });
  await settle();
}

/**
 * Mount and wait until the rail has actually measured.
 *
 * **Asserting this before counting is the point.** With no metrics the
 * component renders an empty `<aside>` and its scroll effect returns
 * immediately — so "scrolling caused no renders" would pass on a rail that had
 * never drawn anything, and "crossing a boundary rendered" would pass on the
 * late arrival of the first measurement. Both of those happened while writing
 * this.
 */
async function mount(): Promise<HTMLElement> {
  await act(async () => {
    root.render(createElement(Spine, { outline: outline(), layoutKey: "x", onJump: () => {} }));
  });
  /* A **second** act, deliberately. React flushes layout effects as the first
     one exits, so the frame the rail asks for is only *requested* by then —
     awaiting inside that same act waits before the request exists, not after.
     This is the step whose absence looks exactly like a component that never
     measures. */
  await settle();
  const band = host.querySelector<HTMLElement>(".spine-viewport");
  expect(band, "the rail should have measured and drawn before anything is counted").not.toBeNull();
  return band as HTMLElement;
}

/** The wrapper the viewport band rides in — the element that actually moves. */
const mover = () => host.querySelector<HTMLElement>(".spine-viewport-track");

describe("the spine during a scroll", () => {
  it("moves the viewport band without re-rendering", async () => {
    await mount();
    const m = mover();
    expect(m, "the band rides in a track-height wrapper").not.toBeNull();

    const settled = renders.get("Spine") ?? 0;
    expect(settled).toBeGreaterThan(0);
    const before = m?.style.transform;

    /* Four frames of scrolling, all inside the first *section* — rows 0–4, so
       0–500px, and the reading line is `scrollY + 175`. Staying inside one
       section is the claim now; see the case below for what a section boundary
       costs, which is the thing this fixture could not see until it had any. */
    for (const y of [50, 100, 150, 200]) await scrollTo(y);

    expect(m?.style.transform, "the band must actually move").not.toBe(before);
    expect(
      renders.get("Spine"),
      "scrolling within one section must not re-render the rail",
    ).toBe(settled);
  });

  it("slides a track-height wrapper by `translateY(%)`, and never writes `top`", async () => {
    /**
     * **`transform`, not `top`, and it is a battery fix rather than a style
     * preference.** A per-frame `top` write is layout + paint + raster — in a
     * Chrome trace of the whole root layer — on every frame of every scroll; a
     * `transform` on its own layer is none of those.
     * docs/investigations/261003a-what-a-scroll-frame-costs-in-the-reading-view.md
     * has the trace, docs/plans/261003a-ipad-battery-scroll-repaint.md the fix.
     *
     * The translate is a percentage of the *wrapper's* height, which is the
     * track's (`inset: 0`), so it is the same fraction the band's `top` used to
     * be — exactly, with a `docTop` that is not zero so a formula that forgot
     * to subtract it cannot pass. jsdom does no layout, so what this can pin is
     * the number and where it is written; the band landing on the right pixels
     * in a real browser, including through the bar flip, is the browser
     * check's.
     */
    docOffset = 300; // the article starts 300px down; docHeight stays 2000
    await mount();
    const m = mover();
    const band = host.querySelector<HTMLElement>(".spine-viewport");
    expect(m, "the band rides in a track-height wrapper").not.toBeNull();
    expect(band?.parentElement, "…and the band is inside it").toBe(m);

    // Initial placement, before any scroll: (0 − 300) / 2000 = −15%.
    expect(m?.style.transform).toBe("translateY(-15%)");

    // (800 − 300) / 2000 = 25%. The reading line is 800 + 175 − 300 = 675,
    // which crosses from no section into a2 (500–1000): a boundary render.
    const settled = renders.get("Spine") ?? 0;
    await scrollTo(800);
    expect(renders.get("Spine"), "this scroll crosses a section boundary").toBeGreaterThan(settled);
    expect(m?.style.transform, "the boundary's re-render must not clobber it").toBe(
      "translateY(25%)",
    );

    // (1100 − 300) / 2000 = 40%, still inside a2: no render, just the move.
    await scrollTo(1100);
    expect(m?.style.transform).toBe("translateY(40%)");

    for (const el of [m, band]) {
      expect(el?.style.top, "an inline `top` would repaint on every frame").toBe("");
    }
    expect(band?.style.transform, "the band itself stays put inside the wrapper").toBe("");
  });

  it("lets go of every scroll listener it took when it unmounts", async () => {
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    try {
      await mount();
      const taken = added.mock.calls.filter(([type]) => type === "scroll").map(([, fn]) => fn);
      expect(taken.length, "the rail listens to scroll").toBeGreaterThan(0);

      act(() => root.unmount());
      const given = new Set(
        removed.mock.calls.filter(([type]) => type === "scroll").map(([, fn]) => fn),
      );
      for (const fn of taken) expect(given.has(fn), "a scroll listener outlived the rail").toBe(true);
    } finally {
      added.mockRestore();
      removed.mockRestore();
    }
  });

  it("renders once per section crossed, which is what `you are here` costs", async () => {
    /**
     * **The price of the card's *you are here*, measured rather than assumed.**
     *
     * The rail tracks the current section as well as the current part
     * (`hereHit` in Spine.tsx), so the render count now follows L2 boundaries
     * rather than L1 ones — about fifty times across an article instead of
     * seven. That is still nothing beside the sixty-a-second this file exists
     * to prevent, but "still nothing" is a number somebody should have to keep
     * true, so here it is pinned at exactly one render per crossing.
     */
    await mount();
    const settled = renders.get("Spine") ?? 0;

    // Reading line 375 → section a1 (0–500). Same part, same section.
    await scrollTo(200);
    expect(renders.get("Spine"), "still inside a1").toBe(settled);

    // Reading line 575 → section a2 (500–1000). Same part, next section.
    await scrollTo(400);
    expect(
      renders.get("Spine"),
      "crossing into another section of the same part costs one render",
    ).toBe(settled + 1);

    // …and staying in it costs nothing further.
    for (const y of [450, 500, 550]) await scrollTo(y);
    expect(renders.get("Spine"), "staying in one section is free").toBe(settled + 1);
  });

  it("renders once when the reader crosses into another part", async () => {
    await mount();
    const settled = renders.get("Spine") ?? 0;

    /* Reading line is a fraction down the viewport, so this lands well inside
       the second part however that fraction is tuned. */
    await scrollTo(1400);
    const afterCrossing = renders.get("Spine") ?? 0;
    expect(afterCrossing, "crossing a boundary changes what is drawn").toBeGreaterThan(settled);

    // …and staying there costs nothing further.
    for (const y of [1450, 1500, 1550]) await scrollTo(y);
    expect(renders.get("Spine"), "staying in one part is free").toBe(afterCrossing);
  });
});
