// @vitest-environment jsdom
/**
 * **A row that can scroll further says so: a short fade at that edge.**
 * useRevealChosen.ts marks the scroller with `data-more-start` /
 * `data-more-end` from its scroll metrics, and mode-band.css draws the fade only
 * on a marked edge (plan 261007h § F2, the designer's follow-up). jsdom has no
 * layout, so the metrics and rects are stubbed; what this proves is the
 * arithmetic and the wiring. That the fade is drawn on a phone and absent at
 * 1440 is the Playwright pass in the plan.
 */
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OrderGroup } from "../src/web/OrderGroup.js";
import { MORE_FADE_REM, markMore, revealChosen } from "../src/web/useRevealChosen.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function rect(left: number, width: number): DOMRect {
  return { left, right: left + width, width, top: 0, bottom: 40, height: 40, x: left, y: 0 } as DOMRect;
}

/** Give `el` a content width and a box width, as a browser's layout would. */
function metrics(el: HTMLElement, scrollWidth: number, clientWidth: number): void {
  Object.defineProperty(el, "scrollWidth", { value: scrollWidth, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: clientWidth, configurable: true });
}

function marks(el: HTMLElement): string {
  return `${el.hasAttribute("data-more-start") ? "start" : "-"} ${el.hasAttribute("data-more-end") ? "end" : "-"}`;
}

describe("markMore", () => {
  it("marks nothing when nothing overflows (1440 stays as it was)", () => {
    const g = document.createElement("div");
    metrics(g, 200, 200);
    markMore(g);
    expect(marks(g)).toBe("- -");
  });

  it("marks the end alone at the start of an overflowing row", () => {
    const g = document.createElement("div");
    metrics(g, 400, 300);
    markMore(g);
    expect(marks(g)).toBe("- end");
  });

  it("marks both edges in the middle, and the start alone at the end", () => {
    const g = document.createElement("div");
    metrics(g, 400, 300);
    g.scrollLeft = 50;
    markMore(g);
    expect(marks(g)).toBe("start end");
    g.scrollLeft = 100;
    markMore(g);
    expect(marks(g)).toBe("start -");
  });

  it("ignores a sub-pixel remainder", () => {
    const g = document.createElement("div");
    metrics(g, 400, 300);
    g.scrollLeft = 99.5;
    markMore(g);
    expect(marks(g)).toBe("start -");
  });

  it("clears a mark when the row stops overflowing", () => {
    const g = document.createElement("div");
    metrics(g, 400, 300);
    markMore(g);
    metrics(g, 300, 300);
    markMore(g);
    expect(marks(g)).toBe("- -");
  });
});

describe("revealChosen keeps the chosen button clear of a fade", () => {
  /** A 200px group whose buttons are 80 wide at 100·i, already scrolled. */
  function row(n: number, chosen: number): HTMLElement {
    const g = document.createElement("div");
    g.getBoundingClientRect = () => rect(0, 200);
    for (let i = 0; i < n; i++) {
      const b = document.createElement("button");
      b.setAttribute("aria-pressed", String(i === chosen));
      b.getBoundingClientRect = () => rect(100 * i - g.scrollLeft, 80);
      g.append(b);
    }
    return g;
  }
  const fade = MORE_FADE_REM * 16;

  it("stops the fade's width short of the edge when there are more buttons beyond", () => {
    const g = row(5, 3); // button 3 is 300–380, button 4 lies past it
    revealChosen(g);
    expect(g.scrollLeft).toBe(180 + fade);
  });

  it("scrolls a button sitting under the start fade clear of it", () => {
    const g = row(5, 1); // button 1 is 100–180
    g.scrollLeft = 95; // now at 5–85: in view, but under a 20px fade
    revealChosen(g);
    expect(g.scrollLeft).toBe(100 - fade);
  });
});

describe("useRevealChosen, through OrderGroup", () => {
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

  it("marks the row on opening and again when it is scrolled", () => {
    const sw = Object.getOwnPropertyDescriptor(Element.prototype, "scrollWidth");
    const cw = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth");
    Object.defineProperty(HTMLDivElement.prototype, "scrollWidth", { value: 400, configurable: true });
    Object.defineProperty(HTMLDivElement.prototype, "clientWidth", { value: 300, configurable: true });
    try {
      act(() =>
        root.render(
          <OrderGroup label="Order the terms by" selected="a">
            <button type="button" aria-pressed="true" />
          </OrderGroup>,
        ),
      );
      const g = host.querySelector<HTMLElement>('[role="group"]') as HTMLElement;
      expect(marks(g)).toBe("- end");
      g.scrollLeft = 100;
      act(() => {
        g.dispatchEvent(new Event("scroll"));
      });
      expect(marks(g)).toBe("start -");
    } finally {
      delete (HTMLDivElement.prototype as { scrollWidth?: number }).scrollWidth;
      delete (HTMLDivElement.prototype as { clientWidth?: number }).clientWidth;
      if (sw) Object.defineProperty(Element.prototype, "scrollWidth", sw);
      if (cw) Object.defineProperty(Element.prototype, "clientWidth", cw);
    }
  });

  it("scrolls a focused button out from under the fade", () => {
    const groupRect = HTMLDivElement.prototype.getBoundingClientRect;
    const buttonRect = HTMLButtonElement.prototype.getBoundingClientRect;
    HTMLDivElement.prototype.getBoundingClientRect = () => rect(0, 200);
    HTMLButtonElement.prototype.getBoundingClientRect = function (this: HTMLButtonElement) {
      const i = Number(this.dataset.i);
      return rect(100 * i - (this.parentElement as HTMLElement).scrollLeft, 90);
    };
    try {
      act(() =>
        root.render(
          <OrderGroup label="Order the terms by" selected="0">
            {[0, 1, 2, 3].map((i) => (
              <button key={i} type="button" data-i={i} aria-pressed={i === 0} />
            ))}
          </OrderGroup>,
        ),
      );
      const g = host.querySelector<HTMLElement>('[role="group"]') as HTMLElement;
      expect(g.scrollLeft).toBe(0);
      // Button 1 is 100–190: in view, but its right edge is under the end fade.
      act(() => {
        (g.querySelector('[data-i="1"]') as HTMLElement).focus();
      });
      expect(g.scrollLeft).toBe(190 - (200 - MORE_FADE_REM * 16));
    } finally {
      HTMLDivElement.prototype.getBoundingClientRect = groupRect;
      HTMLButtonElement.prototype.getBoundingClientRect = buttonRect;
    }
  });
});

describe("the fade's CSS", () => {
  const css = readFileSync("src/web/styles/mode-band.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  /** Every rule (selector and body) in the sheet that sets a mask. */
  const masked = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, , body]) => /mask-image/.test(body ?? ""));

  it("is drawn only on a marked row, and is as wide as the reveal allows for", () => {
    expect(masked.length).toBeGreaterThan(0);
    for (const [, selector] of masked) expect(selector).toMatch(/\[data-more-(start|end)\]/);
    expect(css).toMatch(new RegExp(`--more-fade:\\s*${MORE_FADE_REM}rem`));
  });
});
