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

function outline(): OutlineEntry[] {
  // Two parts, ten rows each, so there is exactly one boundary to cross.
  return [
    { node: node("a", "b0"), startRow: 0, endRow: 9, words: 100, children: [] },
    { node: node("b", "b10"), startRow: 10, endRow: 19, words: 100, children: [] },
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
      const top = i * ROW_H - window.scrollY;
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

describe("the spine during a scroll", () => {
  it("moves the viewport band without re-rendering", async () => {
    const band = await mount();

    const settled = renders.get("Spine") ?? 0;
    expect(settled).toBeGreaterThan(0);
    const before = band.style.top;

    // Four frames of scrolling, all inside the first part.
    for (const y of [50, 100, 150, 200]) await scrollTo(y);

    expect(band.style.top, "the band must actually move").not.toBe(before);
    expect(
      renders.get("Spine"),
      "scrolling within one part must not re-render the rail",
    ).toBe(settled);
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
