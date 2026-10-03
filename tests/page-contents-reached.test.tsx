// @vitest-environment jsdom
/**
 * **Which section the contents list marks, and how far down the window a
 * heading counts as reached** — PageContents.tsx § `reachedPx`.
 *
 * The sections carry `scroll-mt-24`, which is **6rem and not 96px**: the app
 * sets no root font size, so a reader whose browser is set to large text
 * (20px) gets a 120px margin. Until 2026-10-03 "reached" was a fixed 100px, so
 * for that reader a clicked section came to rest at 120 and the list went on
 * marking the one above it. Sweep item XZ-X12,
 * docs/plans/261003g-sweep-clusters-2-and-3-scan-decoding-and-four-one-file-fixes.md § 4.
 *
 * jsdom lays nothing out — every rect is zero and no stylesheet is applied —
 * so both the rects and the computed margin are stubbed here. That makes this
 * a test of the arithmetic and of *which element is asked*, and of nothing
 * about a browser: that a `rem` margin comes back from `getComputedStyle` in
 * pixels is the CSSOM's rule, checked in a browser and not here.
 *
 * **Every case is about the middle section of three, well away from the foot
 * of the document.** The first entry is marked whenever nothing is reached and
 * the last whenever the page is at the bottom, and neither consults the
 * threshold — so a case about either end would pass with the comparison
 * deleted. GPT Sol's PR-3 on the plan.
 */
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PageContents } from "../src/web/PageContents.js";

let host: HTMLDivElement;
let page: HTMLDivElement;
let root: Root;

/** Where each section's top is, and what scroll margin its style computes to. */
let tops: Record<string, number>;
let margin: string;

beforeEach(() => {
  page = document.createElement("div");
  for (const [id, label] of [
    ["sec-a", "Alpha"],
    ["sec-b", "Beta"],
    ["sec-c", "Gamma"],
  ] as const) {
    const section = document.createElement("section");
    section.id = id;
    section.setAttribute("data-section", label);
    section.innerHTML = `<h2>${label}</h2>`;
    section.getBoundingClientRect = () => ({ top: tops[id] ?? 0 }) as DOMRect;
    page.append(section);
  }
  host = document.createElement("div");
  document.body.append(page, host);
  root = createRoot(host);

  /* Not at the bottom: jsdom's scrollHeight is 0, which the component reads as
     "the reader is at the foot of the page" and marks the last entry. */
  Object.defineProperty(document.documentElement, "scrollHeight", {
    value: 5000,
    configurable: true,
  });
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
    const style = real(el, pseudo);
    if (!(el instanceof HTMLElement) || !el.hasAttribute("data-section")) return style;
    return new Proxy(style, {
      get: (target, key) =>
        key === "scrollMarginTop" ? margin : Reflect.get(target, key, target),
    });
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  page.remove();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document.documentElement, "scrollHeight");
});

/** Mount with the middle section's top at `beta`, and say which entry is marked. */
function markedWith(beta: number, scrollMargin: string): string | null {
  tops = { "sec-a": -400, "sec-b": beta, "sec-c": 900 };
  margin = scrollMargin;
  const ref = createRef<HTMLElement>();
  (ref as { current: HTMLElement | null }).current = page;
  act(() => {
    root.render(createElement(PageContents, { containerRef: ref, label: "Sections" }));
  });
  const marked = host.querySelectorAll('[aria-current="true"]');
  expect(marked.length).toBeLessThanOrEqual(1);
  return marked[0]?.textContent ?? null;
}

describe("how far down a heading counts as reached", () => {
  it("has a list to mark, and marks the section above when the next is far below", () => {
    expect(markedWith(600, "96px")).toBe("Alpha");
  });

  it("at the usual 96px margin, reaches a heading at rest just past it", () => {
    expect(markedWith(98, "96px")).toBe("Beta");
  });

  it("at a 120px margin — large text — reaches a heading that came to rest at 120", () => {
    /* The defect. Against a fixed 100px this is "Alpha". */
    expect(markedWith(120, "120px")).toBe("Beta");
  });

  it("allows 4px of slack past the margin and no more", () => {
    expect(markedWith(122, "120px")).toBe("Beta");
    act(() => root.unmount());
    root = createRoot(host);
    expect(markedWith(125, "120px")).toBe("Alpha");
  });

  it("follows the margin down as well as up", () => {
    /* 80px + 4: a heading at 90 is not reached, though it is inside the old
       fixed 100. So the number really is the section's own. */
    expect(markedWith(90, "80px")).toBe("Alpha");
    act(() => root.unmount());
    root = createRoot(host);
    expect(markedWith(83, "80px")).toBe("Beta");
  });

  it.each(["", "normal", "auto"])("falls back to 100px when the margin computes to %j", (value) => {
    expect(markedWith(99, value)).toBe("Beta");
    act(() => root.unmount());
    root = createRoot(host);
    expect(markedWith(101, value)).toBe("Alpha");
  });
});
