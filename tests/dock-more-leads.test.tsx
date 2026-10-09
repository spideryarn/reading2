// @vitest-environment jsdom
/**
 * **On a phone, More is never off the edge of the bar** (queue item
 * `qi-t22r9mt4`). Measured in WebKit on 2026-10-09: every phone width is on the
 * last rung with the row at its 44px floor, and with Diagram drawn — Diagram
 * open, or Experimental on — More's place after Skim is x 354–398, past a 390,
 * 375 or 360 window. No label rung fits 360, so More moves to the front of the
 * bands' frame when, and only when, its own place is out of view.
 * docs/plans/261009c-phone-bottom-bar-more-leads-the-bands-frame-when-its-place-is-off-screen.md.
 *
 * jsdom has no layout, so the fake below lays the bar out **by DOM order**,
 * each button `W` wide from the bar's left edge. That is what makes the test
 * honest about the one property the design depends on: once More has moved,
 * its own rect is in view, and only the answer measured from its *home* says
 * whether it should stay moved. A fake that pinned More's rect would not see
 * the bar flip back.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODE_LABEL } from "../src/title-text.js";
import { Dock } from "../src/web/Dock.js";
import { EXPERIMENTAL_OFF, EXPERIMENTAL_ON } from "./helpers/experimental-fixtures.js";

/** One button's width in the fake layout. */
const W = 50;
/** Everything in the row the fake lays out, in order. */
const LAID_OUT = ".dock-home, .dock-btn";

let width = 360;
let host: HTMLDivElement;
let root: Root;

function rect(left: number, w: number): DOMRect {
  return { left, right: left + w, width: w, top: 0, bottom: 52, height: 52, x: left, y: 0, toJSON: () => ({}) };
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, "", "/read/a-piece");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const isDock = (el: Element) => el.classList.contains("dock");
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return isDock(this) ? width : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
    if (!isDock(this)) return 0;
    return Math.max(width, this.querySelectorAll(LAID_OUT).length * W);
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const dock = this.closest(".dock");
    if (dock === null) return rect(0, 0);
    if (this === dock) return rect(0, width);
    const i = [...dock.querySelectorAll(LAID_OUT)].indexOf(this);
    return i < 0 ? rect(0, 0) : rect(i * W - dock.scrollLeft, W);
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const DRAWER = {
  comments: [],
  paragraphs: new Map(),
  loaded: true,
  loadError: null,
  error: null,
  panel: null,
  onPanel: () => {},
  onOpenComment: () => {},
};

function reading(props: Record<string, unknown> = {}): void {
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: the two arms of the bar differ by which props are present, the same cast tests/dock-more.test.tsx makes
      createElement(Dock as any, {
        slug: "a-piece",
        view: "article",
        mode: "plain",
        onMode: () => {},
        experimental: EXPERIMENTAL_OFF,
        drawer: DRAWER,
        ...props,
      }),
    );
  });
}

function loose(props: Record<string, unknown> = {}): void {
  history.replaceState(null, "", "/read/a-piece/metadata");
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: as above
      createElement(Dock as any, { slug: "a-piece", view: "metadata", experimental: EXPERIMENTAL_OFF, ...props }),
    );
  });
}

/** The bands' frame, by accessible name, left to right. */
const bands = () =>
  [...(host.querySelectorAll<HTMLElement>(".dock-modes .dock-frame")[1]?.querySelectorAll(".dock-btn") ?? [])].map(
    (b) => b.getAttribute("aria-label"),
  );

const L = MODE_LABEL;

/** Exercise the hook's resize path without changing its content signature. */
function resize(nextWidth: number): void {
  let frame: FrameRequestCallback | undefined;
  const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    frame = cb;
    return 1;
  });
  act(() => {
    width = nextWidth;
    window.dispatchEvent(new Event("resize"));
    expect(frame, "resize scheduled no measurement").toBeDefined();
    frame?.(0);
  });
  raf.mockRestore();
}

/* The fake row: Spideryarn, Commands, Plain, then the bands' frame. With the
   switch on, More's home is the eighth slot — [350, 400] — past a 360 bar. With
   it off it is the seventh — [300, 350] — inside one. */

describe("More stays on the bar where its own place is off the edge", () => {
  it("leads the bands' frame when its place after Skim is past the bar's edge", () => {
    width = 360;
    reading({ experimental: EXPERIMENTAL_ON });
    expect(bands().slice(0, 5)).toEqual(["More", L.structure, L.summary, L.diagram, L.skim]);
  });

  it("stays after Skim where its place is in view — Greg's placement holds wherever it can be seen", () => {
    width = 360;
    reading({ experimental: EXPERIMENTAL_OFF });
    expect(bands().slice(0, 4)).toEqual([L.structure, L.summary, L.skim, "More"]);
    width = 1440;
    reading({ experimental: EXPERIMENTAL_ON, mode: "summary" });
    expect(bands().slice(0, 5)).toEqual([L.structure, L.summary, L.diagram, L.skim, "More"]);
  });

  it("Diagram open with the switch off pushes More out too, and More leads", () => {
    width = 390;
    reading({ experimental: EXPERIMENTAL_OFF, mode: "diagram" });
    expect(bands()[0]).toBe("More");
  });

  it("the links arm (the metadata page) moves More the same way", () => {
    width = 360;
    loose({ experimental: EXPERIMENTAL_ON });
    expect(bands()[0]).toBe("More");
  });

  it("goes home again when the window widens", async () => {
    width = 360;
    reading({ experimental: EXPERIMENTAL_ON });
    expect(bands()[0]).toBe("More");
    width = 1440;
    /* A re-render with a changed signature re-measures; a resize would do the
       same through the ResizeObserver jsdom does not have. */
    reading({ experimental: EXPERIMENTAL_ON, mode: "summary" });
    expect(bands().slice(0, 5)).toEqual([L.structure, L.summary, L.diagram, L.skim, "More"]);
  });

  it("repositions on resize even when the rung and content stay the same, in both arms", () => {
    for (const render of [reading, loose]) {
      width = 390;
      render({ experimental: EXPERIMENTAL_ON });
      expect(bands()[0]).toBe("More");
      resize(410);
      expect(host.querySelector(".dock")?.classList.contains("dock-fit-4")).toBe(true);
      expect(bands()[4]).toBe("More");
      resize(390);
      expect(bands()[0]).toBe("More");
    }
  });

  it("measures the home edge at rest after the reader scrolls the bar", () => {
    width = 360;
    reading({ experimental: EXPERIMENTAL_ON });
    const dock = host.querySelector<HTMLElement>(".dock");
    expect(dock).not.toBeNull();
    if (dock) dock.scrollLeft = 100;
    reading({ experimental: EXPERIMENTAL_ON, mode: "summary" });
    expect(bands()[0]).toBe("More");
  });

  it("keeps More ahead of the protected right padding", () => {
    width = 410;
    reading({ experimental: EXPERIMENTAL_ON });
    expect(bands()[4]).toBe("More");
    const dock = host.querySelector<HTMLElement>(".dock");
    expect(dock).not.toBeNull();
    if (dock) dock.style.paddingRight = "20px";
    resize(410);
    expect(bands()[0]).toBe("More");
  });

  it("preserves the last placement while the bar has no layout", () => {
    width = 360;
    reading({ experimental: EXPERIMENTAL_ON });
    resize(0);
    expect(bands()[0]).toBe("More");
    resize(410);
    expect(bands()[4]).toBe("More");
  });

  /* One keyed array (`bandsInOrder`), so a re-order moves nodes rather than
     remounting them — focus and an open tooltip survive a rotation. */
  it("moves the buttons rather than remounting them", () => {
    width = 360;
    reading({ experimental: EXPERIMENTAL_ON });
    const skim = host.querySelector(`[aria-label="${L.skim}"]`);
    const more = host.querySelector<HTMLElement>(".dock-more-trigger");
    act(() => more?.focus());
    width = 1440;
    reading({ experimental: EXPERIMENTAL_ON, mode: "summary" });
    expect(bands()[4]).toBe("More");
    expect(host.querySelector(`[aria-label="${L.skim}"]`)).toBe(skim);
    expect(host.querySelector(".dock-more-trigger")).toBe(more);
    expect(document.activeElement).toBe(more);
    width = 360;
    reading({ experimental: EXPERIMENTAL_ON, mode: "plain" });
    expect(bands()[0]).toBe("More");
    expect(host.querySelector(`[aria-label="${L.skim}"]`)).toBe(skim);
    expect(host.querySelector(".dock-more-trigger")).toBe(more);
    expect(document.activeElement).toBe(more);
  });

  it("does not flip back on a second measurement once moved", () => {
    width = 360;
    /* After every measurement, not just the last: a bar that measured More
       where it is drawn would flip each time and be right every other time. */
    for (const mode of ["plain", "structure", "summary", "skim"]) {
      reading({ experimental: EXPERIMENTAL_ON, mode });
      expect(bands()[0], mode).toBe("More");
    }
  });
});
