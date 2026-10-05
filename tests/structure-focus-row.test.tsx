// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
