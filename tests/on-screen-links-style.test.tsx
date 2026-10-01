// @vitest-environment jsdom
/**
 * The band's on-screen block links, mounted — src/web/OnScreenLinksStyle.tsx.
 * Rows are real `tbody tr[data-block]` elements with `getBoundingClientRect`
 * stubbed, so the shared selector and binary search are what run.
 * docs/plans/261001n-trajectory-question-above-quote-and-highlight-on-screen-block-links.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dock = 0;
vi.mock("../src/web/scroll.js", () => ({ stickyOffset: () => 0, dockOffset: () => dock }));

const { OnScreenLinksStyle } = await import("../src/web/OnScreenLinksStyle.js");

const A = "spya-aaaaaa";
const B = "spya-bbbbbb";
const C = "spya-cccccc";

let root: Root;
let host: HTMLDivElement;
let table: HTMLTableElement;
/** Each row's box, by id — changed to simulate a scroll. */
const boxes = new Map<string, [number, number]>();

function mountRows(ids: string[]) {
  table = document.createElement("table");
  table.className = "zoom";
  const tbody = document.createElement("tbody");
  for (const id of ids) {
    const tr = document.createElement("tr");
    tr.dataset.block = id;
    tr.getBoundingClientRect = () => {
      const [top, bottom] = boxes.get(id) ?? [0, 0];
      return { top, bottom, height: bottom - top } as DOMRect;
    };
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  document.body.appendChild(table);
}

function css(): string | null {
  return host.querySelector("style")?.textContent ?? null;
}

async function frame() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
  });
}

beforeEach(() => {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  dock = 0;
  boxes.clear();
  boxes.set(A, [0, 400]);
  boxes.set(B, [400, 790]);
  boxes.set(C, [790, 1200]);
  mountRows([A, B, C]);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  table.remove();
});

describe("OnScreenLinksStyle", () => {
  it("writes a rule naming the blocks on screen, and not the sliver at the bottom", async () => {
    await act(async () => root.render(createElement(OnScreenLinksStyle, { enabled: true, layoutKey: "k" })));
    expect(css()).toContain(`[data-block-link="${A}"]`);
    expect(css()).toContain(`[data-block-link="${B}"]`);
    expect(css()).not.toContain(C);
  });

  it("follows a scroll", async () => {
    await act(async () => root.render(createElement(OnScreenLinksStyle, { enabled: true, layoutKey: "k" })));
    boxes.set(A, [-800, -400]);
    boxes.set(B, [-400, -10]);
    boxes.set(C, [-10, 400]);
    window.dispatchEvent(new Event("scroll"));
    await frame();
    expect(css()).toContain(C);
    expect(css()).not.toContain(A);
    expect(css()).not.toContain(B);
  });

  it("does not count what is under the Dock", async () => {
    dock = 400;
    await act(async () => root.render(createElement(OnScreenLinksStyle, { enabled: true, layoutKey: "k" })));
    expect(css()).toContain(A);
    expect(css()).not.toContain(B);
  });

  it("measures again when the layout changes under a still page", async () => {
    await act(async () => root.render(createElement(OnScreenLinksStyle, { enabled: true, layoutKey: "k" })));
    boxes.set(A, [-800, -400]);
    boxes.set(B, [-400, -10]);
    boxes.set(C, [-10, 400]);
    await act(async () => root.render(createElement(OnScreenLinksStyle, { enabled: true, layoutKey: "k2" })));
    expect(css()).toContain(C);
    expect(css()).not.toContain(A);
  });

  it("writes nothing while it is off", async () => {
    await act(async () => root.render(createElement(OnScreenLinksStyle, { enabled: false, layoutKey: "k" })));
    expect(css()).toBeNull();
  });
});
