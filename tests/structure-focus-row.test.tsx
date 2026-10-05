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
let frames: FrameRequestCallback[] = [];

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
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const top = this.dataset.block === B ? topOfB : 0;
    return { top, bottom: top + 20, height: 20 } as DOMRect;
  });
  topOfB = 50;
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames[id - 1] = () => {};
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
    topOfB = 100; // the middle of the window; the focus line is at 80
    act(() => root.render(<Harness sections={FIRST} layoutKey="k" />));
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("0");

    scrollToBlock(B, "auto", undefined, { align: "centre" });
    expect(arrivalAnchor()?.id).toBe(B);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
      for (const cb of frames.splice(0)) cb(0);
    });
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("5");

    /* The reader moves, the hold ends, and the line answers again. */
    act(() => {
      Object.defineProperty(window, "scrollY", { value: 7, writable: true, configurable: true });
      window.dispatchEvent(new Event("scroll"));
      for (const cb of frames.splice(0)) cb(0);
    });
    expect(arrivalAnchor()).toBeNull();
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("0");
  });
});
