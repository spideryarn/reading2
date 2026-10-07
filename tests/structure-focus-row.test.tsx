// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId } from "../src/types.js";
import { clearFoldArticle, setFoldArticle, toggleFold } from "../src/web/fold.js";
import type { Section } from "../src/web/position.js";
import { arrivalAnchor, clearArrivalAnchor, scrollToBlock } from "../src/web/scroll.js";
import { useColumnContext } from "../src/web/useColumnContext.js";

class NoResizeObserver {
  observe() {}
  disconnect() {}
}

const A = "spya-aaaaaa";
const B = "spya-bbbbbb";
const FIRST = [
  { row: 0, blockId: A, nodeId: "n0001", title: "First", titleVoice: "ai" },
  { row: 5, blockId: B, nodeId: "n0002", title: "Second", titleVoice: "ai" },
] as Section[];
const REFLOWED = [FIRST[0] as Section];

let host: HTMLDivElement;
let root: Root;
/** Where `B`'s row sits in the 200px window; a test may move it. */
let topOfB = 50;
let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;

function flushFrames(): void {
  for (const [id, cb] of [...frames]) {
    if (frames.delete(id)) cb(0);
  }
}

function Harness({ sections, layoutKey }: { sections: Section[]; layoutKey: string }): ReactNode {
  const { focusRow } = useColumnContext({ sections, enabled: true, layoutKey });
  return (
    <>
      <output data-focus-row>{focusRow}</output>
      <table className="zoom">
        <tbody>
          {sections.map((section) => (
            <tr data-block={section.blockId} key={section.blockId}>
              <td>{section.title}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", NoResizeObserver);
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 200 });
  Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
  Object.defineProperty(document.documentElement, "scrollHeight", { value: 1000, configurable: true });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const top = this.dataset.block === B ? topOfB : 0;
    return { top, bottom: top + 20, height: 20 } as DOMRect;
  });
  topOfB = 50;
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.set(++nextFrame, cb);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
  vi.stubGlobal("CSS", { escape: (v: string) => v });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  clearArrivalAnchor();
  clearFoldArticle();
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Structure's current-row measurement", () => {
  it("publishes row zero after a layout change replaces a later current section", () => {
    act(() => root.render(<Harness sections={FIRST} layoutKey="before" />));
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("5");

    act(() => root.render(<Harness sections={REFLOWED} layoutKey="after" />));
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("0");
  });

  /* qi-d7pxe8z7. A jump lands its block centred, which is *below* the 40%
     line this hook reads at, so Structure marked the part before the one the
     reader had just clicked. A centred arrival is where the reader is
     (scroll.ts § `anchor`), here as for `?at=`. */
  it("names the section of a centred arrival, though its heading sits below the focus line", () => {
    topOfB = 90; // a 20px row centred in the window; the focus line is at 80
    act(() => root.render(<Harness sections={FIRST} layoutKey="k" />));
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("0");

    scrollToBlock(B, "auto", undefined, { align: "centre" });
    expect(arrivalAnchor()?.id).toBe(B);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
      flushFrames();
    });
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("5");

    /* The reader moves, the hold ends, and the line answers again. */
    act(() => {
      Object.defineProperty(window, "scrollY", { value: 7, writable: true, configurable: true });
      window.dispatchEvent(new Event("scroll"));
      flushFrames();
    });
    expect(arrivalAnchor()).toBeNull();
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("0");
  });

  it("names an already centred arrival without a scroll event", () => {
    topOfB = 90; // a 20px row centred in the 200px window
    const scroll = vi.spyOn(window, "scrollTo");
    act(() => root.render(<Harness sections={FIRST} layoutKey="k" />));
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("0");

    act(() => {
      scrollToBlock(B, "auto", undefined, { align: "centre" });
      flushFrames();
    });
    expect(arrivalAnchor()?.id).toBe(B);
    expect(scroll).not.toHaveBeenCalled();
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("5");
  });

  it("returns to the focus line when the arrival ends without a scroll event", () => {
    topOfB = 90;
    act(() => root.render(<Harness sections={FIRST} layoutKey="k" />));
    act(() => {
      scrollToBlock(B, "auto", undefined, { align: "centre" });
      window.dispatchEvent(new Event("scroll"));
      flushFrames();
    });
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("5");

    act(() => {
      clearArrivalAnchor();
      flushFrames();
    });
    expect(arrivalAnchor()).toBeNull();
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("0");
  });
});

/**
 * **Block 0 is the first section's start and the masthead's echo at once.**
 * It is hidden through the fold store, and its section is still on screen, so
 * it is not skipped the way a folded section's start is (fold.ts §
 * `isFoldedAway`; Greg, spya-t6cdve;
 * docs/plans/261007b-the-title-is-drawn-once-and-the-masthead-loses-its-back-arrow.md).
 */
describe("Structure's current row when the first section starts on the masthead's echo", () => {
  const blocks = [
    { id: A, kind: "heading", tag: "h1", level: 1 },
    { id: B, kind: "text", tag: "p" },
  ] as Block[];

  it("is the first section while the reader is in it", () => {
    topOfB = 150; // the second section has not reached the focus line at 80
    setFoldArticle("slug", blocks, new Set([A as BlockId]));
    act(() => root.render(<Harness sections={FIRST} layoutKey="k" />));
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("0");
  });

  it("is still never a section whose start a fold hides (the control)", () => {
    /* `B` is under the folded heading `A`: no height, tying with whatever is
       next, and past the focus line. Unskipped it would be the answer. */
    topOfB = 50;
    setFoldArticle("slug", blocks);
    toggleFold(A as BlockId);
    act(() => root.render(<Harness sections={FIRST} layoutKey="k" />));
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("0");
  });
});

/**
 * **A section that starts inside the shut front matter** (front-matter.ts;
 * Greg, spya-duh4w3;
 * docs/plans/261007d-front-matter-folded-by-default-and-arxiv-html-authors.md
 * § Sections that start inside the run). A front-matter row is hidden through
 * the fold store without being folded away, so a section that starts on one
 * and carries on past it is still the one in focus, and one wholly inside the
 * run loses the tie to the section whose row is on screen.
 */
describe("Structure's current row when a section starts in the shut front matter", () => {
  const T = "spya-tttttt";
  const R = "spya-rrrrrr";
  const V = "spya-vvvvvv";
  const blocks = [
    { id: T, kind: "heading", tag: "h1", level: 1 },
    { id: R, kind: "text", tag: "p" },
    { id: V, kind: "text", tag: "p" },
    { id: B, kind: "text", tag: "p" },
  ] as Block[];
  const at = (row: number, blockId: string, n: number) =>
    ({ row, blockId, nodeId: `n000${n}`, title: `S${n}`, titleVoice: "ai" }) as Section;

  /** The hidden rows `T` and `R` sit, at no height, at the top of `V`. */
  function place(tops: Record<string, number>): void {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const top = tops[this.dataset.block ?? ""] ?? 0;
      return { top, bottom: top + 20, height: 20 } as DOMRect;
    });
  }

  beforeEach(() => setFoldArticle("slug", blocks, new Set([T as BlockId]), [R as BlockId]));

  it("is that section while the reader is in the part of it that shows", () => {
    /* The section is R and V. Its hidden start ties with V, above the line at 80. */
    place({ [T]: 20, [R]: 20, [V]: 20, [B]: 150 });
    act(() => root.render(<Harness sections={[at(0, T, 1), at(1, R, 2), at(3, B, 3)]} layoutKey="k" />));
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("1");
  });

  it("is never a section that is wholly inside the run", () => {
    /* The section is R alone. V starts the next one, on the same pixel. */
    place({ [T]: 20, [R]: 20, [V]: 20, [B]: 150 });
    act(() => root.render(<Harness sections={[at(0, T, 1), at(1, R, 2), at(2, V, 3), at(3, B, 4)]} layoutKey="k" />));
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("2");
  });
});
