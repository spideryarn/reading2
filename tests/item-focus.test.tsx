// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ItemFocus, useLandOnItem } from "../src/web/item-focus.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, left: 0, right: 300, width: 300, height, x: 0, y: top } as DOMRect;
}

function Harness({ onTaken }: { onTaken(focus: ItemFocus): void }) {
  const scope = useRef<HTMLOListElement>(null);
  useLandOnItem({
    focus: { id: "wanted", n: 1 },
    ready: true,
    known: true,
    drawn: true,
    scope,
    attribute: "data-item-id",
    onTaken,
  });
  return (
    <aside className="mode-band">
      <div className="scroller">
        <div className="positioned">
          <ol ref={scope}>
            <li data-item-id="wanted">Wanted</li>
          </ol>
        </div>
      </div>
    </aside>
  );
}

describe("useLandOnItem geometry", () => {
  let host: HTMLDivElement;
  let root: Root;
  let style: HTMLStyleElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    style = document.createElement("style");
    style.textContent = ".scroller { overflow-y: auto; }";
    document.head.append(style);
  });

  afterEach(() => {
    act(() => root.unmount());
    style.remove();
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("centres against the scroller's inner edge, across its border and nested positioned content", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.classList.contains("scroller")) return rect(20, 208);
      if (this.hasAttribute("data-item-id")) return rect(524, 40);
      return rect(0, 0);
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("scroller") ? 200 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientTop", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("scroller") ? 4 : 0;
    });

    act(() => root.render(<Harness onTaken={() => {}} />));

    /* The row begins 500px inside the padding edge: 524 - (20 + 4).
       Its centre belongs at 100px, so the scrollTop is 420. */
    expect(host.querySelector<HTMLElement>(".scroller")?.scrollTop).toBe(420);
  });

  it("does not spend the focus while the scroller has no layout, then lands when it appears", () => {
    let visible = false;
    let resize: ResizeObserverCallback | undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.classList.contains("scroller")) return rect(0, visible ? 200 : 0);
      if (this.hasAttribute("data-item-id")) return rect(500, 40);
      return rect(0, 0);
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("scroller") && visible ? 200 : 0;
    });
    const taken: ItemFocus[] = [];

    act(() => root.render(<Harness onTaken={(focus) => taken.push(focus)} />));
    const row = host.querySelector<HTMLElement>("[data-item-id=wanted]")!;
    expect(taken).toEqual([]);
    expect(row.classList.contains("element-flash")).toBe(false);

    visible = true;
    act(() => resize?.([], {} as ResizeObserver));
    expect(host.querySelector<HTMLElement>(".scroller")?.scrollTop).toBe(420);
    expect(row.classList.contains("element-flash")).toBe(true);
    expect(taken).toEqual([{ id: "wanted", n: 1 }]);
  });
});
