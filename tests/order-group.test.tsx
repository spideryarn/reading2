// @vitest-environment jsdom
/**
 * `OrderGroup` keeps the pressed order in view when the row scrolls sideways
 * (plan 261001o). jsdom has no layout, so the rects are stubbed: a 200px-wide
 * group from x=0, and buttons wherever each case puts them. What this proves is
 * the arithmetic and the wiring; that the row really scrolls on a phone is the
 * Playwright pass in the plan.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OrderGroup, revealPressed } from "../src/web/OrderGroup.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function rect(left: number, width: number): DOMRect {
  return { left, right: left + width, width, top: 0, bottom: 40, height: 40, x: left, y: 0 } as DOMRect;
}

/** A group 200px wide whose pressed button sits at `left` (already scrolled). */
function group(left: number, width = 80): HTMLElement {
  const g = document.createElement("div");
  const b = document.createElement("button");
  b.setAttribute("aria-pressed", "true");
  g.append(b);
  g.getBoundingClientRect = () => rect(0, 200);
  b.getBoundingClientRect = () => rect(left - g.scrollLeft, width);
  return g;
}

describe("revealPressed", () => {
  it("scrolls right just far enough to show a pressed button past the right edge", () => {
    const g = group(300);
    revealPressed(g);
    expect(g.scrollLeft).toBe(180); // its right edge, 380, lands on 200
  });

  it("scrolls left to show a pressed button before the left edge", () => {
    const g = group(20);
    g.scrollLeft = 100; // the button is now at -80
    revealPressed(g);
    expect(g.scrollLeft).toBe(20);
  });

  it("leaves a button already in view alone", () => {
    const g = group(50);
    g.scrollLeft = 10;
    revealPressed(g);
    expect(g.scrollLeft).toBe(10);
  });

  it("does nothing when no button is pressed", () => {
    const g = group(300);
    g.querySelector("button")?.removeAttribute("aria-pressed");
    revealPressed(g);
    expect(g.scrollLeft).toBe(0);
  });
});

describe("OrderGroup", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("is the named group, and reveals the pressed order when it opens and when it changes", () => {
    /* Stubbed on the prototype, because the reveal runs in a layout effect —
       before a test could reach the element to stub it. Button `i` sits at
       100·i, 80 wide; the group is 200 wide. */
    const groupRect = HTMLDivElement.prototype.getBoundingClientRect;
    const buttonRect = HTMLButtonElement.prototype.getBoundingClientRect;
    HTMLDivElement.prototype.getBoundingClientRect = () => rect(0, 200);
    HTMLButtonElement.prototype.getBoundingClientRect = function (this: HTMLButtonElement) {
      const i = Number(this.dataset.i);
      const scrolled = (this.parentElement as HTMLElement).scrollLeft;
      return rect(100 * i - scrolled, 80);
    };
    try {
      const draw = (selected: number) =>
        (
          <OrderGroup label="Order the terms by" selected={String(selected)}>
            {[0, 1, 2, 3].map((i) => (
              <button key={i} type="button" data-i={i} aria-pressed={i === selected} />
            ))}
          </OrderGroup>
        );
      act(() => root.render(draw(3)));
      const g = host.querySelector<HTMLElement>('[role="group"]');
      expect(g?.getAttribute("aria-label")).toBe("Order the terms by");
      expect(g?.className).toBe("gloss-sort-group");
      expect(g?.scrollLeft).toBe(180); // button 3 is 300–380; its right edge lands on 200
      act(() => root.render(draw(0)));
      expect(g?.scrollLeft).toBe(0);
    } finally {
      HTMLDivElement.prototype.getBoundingClientRect = groupRect;
      HTMLButtonElement.prototype.getBoundingClientRect = buttonRect;
    }
  });

  it("reveals again when an option is inserted before the unchanged pressed order", async () => {
    const groupRect = HTMLDivElement.prototype.getBoundingClientRect;
    const buttonRect = HTMLButtonElement.prototype.getBoundingClientRect;
    HTMLDivElement.prototype.getBoundingClientRect = () => rect(0, 200);
    HTMLButtonElement.prototype.getBoundingClientRect = function (this: HTMLButtonElement) {
      const siblings = [...(this.parentElement?.children ?? [])];
      const i = siblings.indexOf(this);
      const scrolled = (this.parentElement as HTMLElement).scrollLeft;
      return rect(100 * i - scrolled, 80);
    };
    try {
      const draw = (keys: readonly string[]) =>
        (
          <OrderGroup label="Order the terms by" selected="selected">
            {keys.map((key) => (
              <button key={key} type="button" aria-pressed={key === "selected"} />
            ))}
          </OrderGroup>
        );
      await act(() => root.render(draw(["first", "selected"])));
      const g = host.querySelector<HTMLElement>('[role="group"]');
      expect(g?.scrollLeft).toBe(0);
      await act(() => root.render(draw(["new", "first", "selected"])));
      expect(g?.scrollLeft).toBe(80);
    } finally {
      HTMLDivElement.prototype.getBoundingClientRect = groupRect;
      HTMLButtonElement.prototype.getBoundingClientRect = buttonRect;
    }
  });

  it("reveals again after a resize or a font load", () => {
    const NativeResizeObserver = globalThis.ResizeObserver;
    const groupRect = HTMLDivElement.prototype.getBoundingClientRect;
    const buttonRect = HTMLButtonElement.prototype.getBoundingClientRect;
    let resize: ResizeObserverCallback | null = null;
    let fontChanged: (() => void) | null = null;
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, "ResizeObserver", {
      value: FakeResizeObserver,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(document, "fonts", {
      value: {
        addEventListener(_type: string, callback: () => void) {
          fontChanged = callback;
        },
        removeEventListener() {},
      },
      configurable: true,
    });
    HTMLDivElement.prototype.getBoundingClientRect = () => rect(0, 200);
    let pressedLeft = 300;
    HTMLButtonElement.prototype.getBoundingClientRect = function (this: HTMLButtonElement) {
      const scrolled = (this.parentElement as HTMLElement).scrollLeft;
      return rect(pressedLeft - scrolled, 80);
    };
    try {
      act(() =>
        root.render(
          <OrderGroup label="Order the terms by" selected="selected">
            <button type="button" aria-pressed="true" />
          </OrderGroup>,
        ),
      );
      const g = host.querySelector<HTMLElement>('[role="group"]');
      expect(g?.scrollLeft).toBe(180);

      g!.scrollLeft = 0;
      pressedLeft = 260;
      act(() => resize?.([], {} as ResizeObserver));
      expect(g?.scrollLeft).toBe(140);

      g!.scrollLeft = 0;
      pressedLeft = 240;
      act(() => fontChanged?.());
      expect(g?.scrollLeft).toBe(120);
    } finally {
      if (NativeResizeObserver === undefined) Reflect.deleteProperty(globalThis, "ResizeObserver");
      else globalThis.ResizeObserver = NativeResizeObserver;
      Reflect.deleteProperty(document, "fonts");
      HTMLDivElement.prototype.getBoundingClientRect = groupRect;
      HTMLButtonElement.prototype.getBoundingClientRect = buttonRect;
    }
  });
});
