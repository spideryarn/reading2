// @vitest-environment jsdom
/**
 * **On a phone, More is never off the edge of the bar** (queue item
 * `qi-t22r9mt4`). Measured in WebKit on 2026-10-09: every phone width is on the
 * last rung with the row at its 44px floor, and with Diagram drawn — Diagram
 * open, or Experimental on — More's place after Skim was x 354–398, past a
 * 390, 375 or 360 window. No label rung fits 360, so More moves to the front of
 * the bands' frame when, and only when, its own place is out of view.
 * docs/plans/261009c-phone-bottom-bar-more-leads-the-bands-frame-when-its-place-is-off-screen.md.
 *
 * From 2026-10-11 to 2026-10-18 More's place was after Summary (spya-hdde62,
 * plan 261011x), two buttons earlier, which every measured phone showed. Since
 * 2026-10-18 it is after Skim again (spya-c0va9e, plan 261018f), so with
 * Diagram drawn on a phone More's place is past the edge once more and More
 * leads — the guard this file holds is live again, not a fallback.
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

/**
 * One button's width in the fake layout: wide by default, so More's place can
 * be past the edge and the fallback is still exercised. The last `describe`
 * sets it to the phone's 44px floor.
 */
const WIDE = 70;
let W = WIDE;
/**
 * Plain's width, when it is not `W`: Plain keeps its word on a phone, so it is
 * wider than the 44px floor. The last `describe` sets it to 90, which with
 * Spideryarn and Commands at 44 puts everything left of the bands' frame at
 * 178px, as plan 261009c measured in WebKit.
 */
let PLAIN_W: number | null = null;
/** Everything in the row the fake lays out, in order. */
const LAID_OUT = ".dock-home, .dock-btn";

let width = 360;
let host: HTMLDivElement;
let root: Root;

function rect(left: number, w: number): DOMRect {
  return { left, right: left + w, width: w, top: 0, bottom: 52, height: 52, x: left, y: 0, toJSON: () => ({}) };
}

/** One laid-out thing's width: Plain may differ, the rest are `W`. */
const widthOf = (el: Element) => (el.getAttribute("aria-label") === MODE_LABEL.plain && PLAIN_W !== null ? PLAIN_W : W);
const widthOfAll = (els: Iterable<Element>) => [...els].reduce((sum, el) => sum + widthOf(el), 0);

beforeEach(() => {
  W = WIDE;
  PLAIN_W = null;
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
    return Math.max(width, widthOfAll(this.querySelectorAll(LAID_OUT)));
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const dock = this.closest(".dock");
    if (dock === null) return rect(0, 0);
    if (this === dock) return rect(0, width);
    const laid = [...dock.querySelectorAll(LAID_OUT)];
    const i = laid.indexOf(this);
    return i < 0 ? rect(0, 0) : rect(widthOfAll(laid.slice(0, i)) - dock.scrollLeft, widthOf(this));
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

/* The fake row: Spideryarn, Commands, Plain, then the bands' frame. More's
   home, after Skim, ends at 7 x 70 = 490 with Diagram not drawn, and at
   8 x 70 = 560 with it drawn (the switch on, or Diagram open): past a 360, 390
   or 430 bar either way, inside a 500 bar only without Diagram, and inside a
   600 one with or without. */

describe("More stays on the bar where its own place is off the edge", () => {
  it("leads the bands' frame when its place after Skim is past the bar's edge", () => {
    width = 360;
    reading({ experimental: EXPERIMENTAL_ON });
    expect(bands().slice(0, 5)).toEqual(["More", L.structure, L.summary, L.diagram, L.skim]);
  });

  it("stays after Skim where its place is in view — Greg's placement holds wherever it can be seen", () => {
    width = 500;
    reading({ experimental: EXPERIMENTAL_OFF });
    expect(bands().slice(0, 4)).toEqual([L.structure, L.summary, L.skim, "More"]);
    width = 1440;
    reading({ experimental: EXPERIMENTAL_ON, mode: "summary" });
    expect(bands().slice(0, 5)).toEqual([L.structure, L.summary, L.diagram, L.skim, "More"]);
  });

  /* The reverse of 2026-10-11 to 2026-10-18, when Diagram drawn no longer
     pushed More's place out: after Skim it does again (spya-c0va9e). */
  it("Diagram drawn, open or by the switch, pushes More's place out again, so More leads", () => {
    width = 500;
    reading({ experimental: EXPERIMENTAL_OFF });
    expect(bands()[0], "no Diagram: 490 is inside a 500 bar").toBe(L.structure);
    reading({ experimental: EXPERIMENTAL_OFF, mode: "diagram" });
    expect(bands().slice(0, 4), "Diagram open: 560 is not").toEqual(["More", L.structure, L.summary, L.diagram]);
    reading({ experimental: EXPERIMENTAL_ON });
    expect(bands()[0], "the switch on").toBe("More");
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
      resize(600);
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
    width = 570;
    reading({ experimental: EXPERIMENTAL_ON });
    expect(bands()[4]).toBe("More");
    const dock = host.querySelector<HTMLElement>(".dock");
    expect(dock).not.toBeNull();
    if (dock) dock.style.paddingRight = "20px";
    resize(570);
    expect(bands()[0]).toBe("More");
  });

  it("preserves the last placement while the bar has no layout", () => {
    width = 360;
    reading({ experimental: EXPERIMENTAL_ON });
    resize(0);
    expect(bands()[0]).toBe("More");
    resize(600);
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

/* **What a phone actually draws**: every button at the 44px floor except
   Plain, which keeps its word (90px), as measured in WebKit on 2026-10-09
   (plan 261009c): 178px of Spideryarn, Commands and Plain, so More's place
   after Skim is x 354-398 with Diagram drawn (past 360, 375 and 390) and
   310-354 without it (inside all three). From 2026-10-11 to 2026-10-18, after
   Summary, it was 44px nearer and never left; since 2026-10-18 (spya-c0va9e,
   plan 261018f) the Diagram state sends it to the front again, which is why
   this block exists. */
describe("on a phone's 44px floor, More leads only when Diagram is drawn", () => {
  it("reproduces plan 261009c's measured More positions before testing the cutoff", () => {
    W = 44;
    PLAIN_W = 90;
    width = 500;
    reading({ experimental: EXPERIMENTAL_OFF });
    expect(host.querySelector(".dock-more-trigger")?.getBoundingClientRect()).toMatchObject({
      left: 310,
      right: 354,
    });
    reading({ experimental: EXPERIMENTAL_ON });
    expect(host.querySelector(".dock-more-trigger")?.getBoundingClientRect()).toMatchObject({
      left: 354,
      right: 398,
    });
  });

  it("with Experimental on, or Diagram open, at 360, 375 and 390, in both arms, More leads", () => {
    W = 44;
    PLAIN_W = 90;
    for (const w of [360, 375, 390]) {
      width = w;
      reading({ experimental: EXPERIMENTAL_ON });
      expect(bands().slice(0, 4), `${w}, switch on`).toEqual(["More", L.structure, L.summary, L.diagram]);
      reading({ experimental: EXPERIMENTAL_OFF, mode: "diagram" });
      expect(bands().slice(0, 4), `${w}, Diagram open`).toEqual(["More", L.structure, L.summary, L.diagram]);
      loose({ experimental: EXPERIMENTAL_ON });
      expect(bands().slice(0, 4), `${w}, links arm`).toEqual(["More", L.structure, L.summary, L.diagram]);
    }
  });

  it("without Diagram More stays after Skim at 360, 375 and 390, in both arms, and with it at 400", () => {
    W = 44;
    PLAIN_W = 90;
    for (const w of [360, 375, 390]) {
      width = w;
      reading({ experimental: EXPERIMENTAL_OFF });
      expect(bands().slice(0, 4), `${w}, reading view`).toEqual([L.structure, L.summary, L.skim, "More"]);
      loose({ experimental: EXPERIMENTAL_OFF });
      expect(bands().slice(0, 4), `${w}, links arm`).toEqual([L.structure, L.summary, L.skim, "More"]);
    }
    width = 400;
    reading({ experimental: EXPERIMENTAL_ON });
    expect(bands().slice(0, 5)).toEqual([L.structure, L.summary, L.diagram, L.skim, "More"]);
  });
});
