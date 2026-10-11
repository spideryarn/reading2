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
 * Since 2026-10-11 More's place is after Summary (spya-hdde62, plan 261011x),
 * two buttons earlier, which every measured phone shows. The fake's buttons
 * are wide enough that the move is still exercised.
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
/** Everything in the row the fake lays out, in order. */
const LAID_OUT = ".dock-home, .dock-btn";

let width = 360;
let host: HTMLDivElement;
let root: Root;

function rect(left: number, w: number): DOMRect {
  return { left, right: left + w, width: w, top: 0, bottom: 52, height: 52, x: left, y: 0, toJSON: () => ({}) };
}

beforeEach(() => {
  W = WIDE;
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

/* The fake row: Spideryarn, Commands, Plain, then the bands' frame. More's
   home, after Summary, is the sixth slot — [350, 420] — past a 360 or a 410 bar
   and inside a 430 one, with the switch on or off: Diagram is drawn after it. */

describe("More stays on the bar where its own place is off the edge", () => {
  it("leads the bands' frame when its place after Summary is past the bar's edge", () => {
    width = 360;
    reading({ experimental: EXPERIMENTAL_ON });
    expect(bands().slice(0, 5)).toEqual(["More", L.structure, L.summary, L.diagram, L.skim]);
  });

  it("stays after Summary where its place is in view — Greg's placement holds wherever it can be seen", () => {
    width = 430;
    reading({ experimental: EXPERIMENTAL_OFF });
    expect(bands().slice(0, 4)).toEqual([L.structure, L.summary, "More", L.skim]);
    width = 1440;
    reading({ experimental: EXPERIMENTAL_ON, mode: "summary" });
    expect(bands().slice(0, 5)).toEqual([L.structure, L.summary, "More", L.diagram, L.skim]);
  });

  it("Diagram drawn, open or by the switch, no longer pushes More's place out: it stands after More", () => {
    width = 430;
    reading({ experimental: EXPERIMENTAL_OFF, mode: "diagram" });
    expect(bands().slice(0, 4)).toEqual([L.structure, L.summary, "More", L.diagram]);
    reading({ experimental: EXPERIMENTAL_ON });
    expect(bands()[2]).toBe("More");
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
    expect(bands().slice(0, 5)).toEqual([L.structure, L.summary, "More", L.diagram, L.skim]);
  });

  it("repositions on resize even when the rung and content stay the same, in both arms", () => {
    for (const render of [reading, loose]) {
      width = 390;
      render({ experimental: EXPERIMENTAL_ON });
      expect(bands()[0]).toBe("More");
      resize(430);
      expect(host.querySelector(".dock")?.classList.contains("dock-fit-4")).toBe(true);
      expect(bands()[2]).toBe("More");
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
    width = 430;
    reading({ experimental: EXPERIMENTAL_ON });
    expect(bands()[2]).toBe("More");
    const dock = host.querySelector<HTMLElement>(".dock");
    expect(dock).not.toBeNull();
    if (dock) dock.style.paddingRight = "20px";
    resize(430);
    expect(bands()[0]).toBe("More");
  });

  it("preserves the last placement while the bar has no layout", () => {
    width = 360;
    reading({ experimental: EXPERIMENTAL_ON });
    resize(0);
    expect(bands()[0]).toBe("More");
    resize(430);
    expect(bands()[2]).toBe("More");
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
    expect(bands()[2]).toBe("More");
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

/* **What a phone actually draws since 2026-10-11** (plan 261011x): every
   button at the 44px floor, as measured in WebKit on 2026-10-09, so More's
   home after Summary ends at 6 × 44 = 264 — inside 360 with Diagram drawn,
   which is exactly the state that used to send it to the front. */
describe("on a phone's 44px floor, More stays after Summary", () => {
  it("with Experimental on, or Diagram open, at 360 and 390, in both arms", () => {
    W = 44;
    for (const w of [360, 390]) {
      width = w;
      reading({ experimental: EXPERIMENTAL_ON });
      expect(bands().slice(0, 4), `${w}, switch on`).toEqual([L.structure, L.summary, "More", L.diagram]);
      reading({ experimental: EXPERIMENTAL_OFF, mode: "diagram" });
      expect(bands().slice(0, 4), `${w}, Diagram open`).toEqual([L.structure, L.summary, "More", L.diagram]);
      loose({ experimental: EXPERIMENTAL_ON });
      expect(bands().slice(0, 4), `${w}, links arm`).toEqual([L.structure, L.summary, "More", L.diagram]);
    }
  });
});
