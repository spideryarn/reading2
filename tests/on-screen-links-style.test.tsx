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
let observers: FakeResizeObserver[];
/** Each row's box, by id — changed to simulate a scroll. */
const boxes = new Map<string, [number, number]>();

class FakeResizeObserver {
  readonly callback: ResizeObserverCallback;
  readonly observed: Element[] = [];

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    observers.push(this);
  }

  observe(target: Element) {
    this.observed.push(target);
  }
  disconnect() {}

  fire() {
    if (this.observed.length > 0) this.callback([], this as unknown as ResizeObserver);
  }
}

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
  observers = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
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
  vi.unstubAllGlobals();
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

  it("measures again when the article table itself reflows", async () => {
    await act(async () => root.render(createElement(OnScreenLinksStyle, { enabled: true, layoutKey: "k" })));
    expect(observers[0]?.observed).toEqual([table]);
    boxes.set(A, [-800, -400]);
    boxes.set(B, [-400, -10]);
    boxes.set(C, [-10, 400]);
    observers[0]?.fire();
    await frame();
    expect(css()).toContain(C);
    expect(css()).not.toContain(A);
  });

  it("does not schedule work from a ResizeObserver callback delivered after cleanup", async () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    await act(async () => root.render(createElement(OnScreenLinksStyle, { enabled: true, layoutKey: "k" })));
    const observer = observers[0];
    raf.mockClear();
    act(() => root.unmount());
    observer?.fire();
    expect(raf).not.toHaveBeenCalled();
    raf.mockRestore();
    root = createRoot(host);
  });

  it("does not turn whitespace in an invalid row id into valid link selectors", async () => {
    table.remove();
    const invalid = `${A} ${B}`;
    boxes.set(invalid, [0, 400]);
    mountRows([invalid]);
    await act(async () => root.render(createElement(OnScreenLinksStyle, { enabled: true, layoutKey: "k" })));
    expect(css()).toBeNull();
  });

  it("removes the rule when it is turned off", async () => {
    await act(async () => root.render(createElement(OnScreenLinksStyle, { enabled: true, layoutKey: "k" })));
    expect(css()).not.toBeNull();
    await act(async () => root.render(createElement(OnScreenLinksStyle, { enabled: false, layoutKey: "k" })));
    expect(css()).toBeNull();
  });
});
