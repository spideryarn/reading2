// @vitest-environment jsdom
/**
 * `OrderGroup` keeps the pressed order in view when the row scrolls sideways
 * (plan 261001o). jsdom has no layout, so the rects are stubbed: a 200px-wide
 * group from x=0, and buttons wherever each case puts them. What this proves is
 * the arithmetic and the wiring; that the row really scrolls on a phone is the
 * Playwright pass in the plan.
 */
import { act, createElement } from "react";
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
        createElement(OrderGroup, {
          label: "Order the terms by",
          selected: String(selected),
          children: [0, 1, 2, 3].map((i) =>
            createElement("button", { key: i, type: "button", "data-i": i, "aria-pressed": i === selected }),
          ),
        });
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
});
