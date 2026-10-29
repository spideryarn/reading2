// @vitest-environment jsdom
/**
 * **The reader's memory of an article keeps the paragraph, not only the
 * section.**
 *
 * Greg, 2026-10-18 (spya-qspg5a): *"When I reopen an article that I've already
 * been reading, it should ideally reopen at roughly the position where I was
 * on last … the paragraph that I was reading most recently."* `?at=` is a
 * section while the reader scrolls (position.ts), and on his article a section
 * is about 1,650 words. So the position spy notes the paragraph at the reading
 * line, and the copy `useLastView` keeps stores it in place of the section —
 * plan docs/plans/261019a-reopen-lands-on-the-paragraph-you-were-reading.md.
 *
 * Both hooks mounted together, over the fake viewport of
 * tests/reading-position-holds-across-a-reflow.test.tsx: rows `ROW` pixels
 * tall, `top` is `row * ROW - scrollY`, and `window.scrollTo` moves `scrollY`.
 */
import { act, createElement, type ReactNode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Block, BlockId, NodeId } from "../src/types.js";
import type { Section } from "../src/web/position.js";

vi.mock("../src/web/useExperimental.js", () => ({
  useExperimental: () => ({ on: false, loaded: true, signedIn: true }),
}));

const { lastViewKey, settleSavedPlace, useLastView } = await import("../src/web/last-view.js");
const { watchHistoryWrites } = await import("../src/web/router.js");
const { abandonScroll, clearArrivalAnchor } = await import("../src/web/scroll.js");
const { useReadingPosition } = await import("../src/web/reader/useReadingPosition.js");

enableHistorySync();
/* As main.tsx does: nuqs's writes to the address are heard by `useLastView`. */
watchHistoryWrites();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.CSS = { escape: (s: string) => s } as unknown as typeof globalThis.CSS;

const DIGITS = "abcdefghjk";
const block = (row: number) =>
  `spya-para${String(row)
    .padStart(2, "0")
    .split("")
    .map((d) => DIGITS.charAt(Number(d)))
    .join("")}` as BlockId;

const ROWS = 30;
const ROW = 100;
const BLOCKS: Block[] = Array.from({ length: ROWS }, (_, i) => ({
  id: block(i),
  tag: "p",
  kind: "text",
  text: `para ${i}`,
  words: 2,
  html: `<p>para ${i}</p>`,
  gistable: true,
}));
const SECTIONS: Section[] = [
  { row: 0, blockId: block(0), nodeId: "n0001" as NodeId, title: "Opening", titleVoice: "ai" },
  { row: 12, blockId: block(12), nodeId: "n0002" as NodeId, title: "Middle", titleVoice: "ai" },
  { row: 24, blockId: block(24), nodeId: "n0003" as NodeId, title: "End", titleVoice: "ai" },
];

const READER = "1a1a1a1a-1111-4111-8111-000000000009";
const KEY = lastViewKey("x", READER);

let scrollY = 0;
let held: Map<string, string>;
let host: HTMLDivElement;
let root: Root;

function Page(): ReactNode {
  useLastView("x", "article", READER);
  /* The owner's article read answering "never opened anywhere", as ArticlePage's
     does before it draws (last-view.ts § The server's place, plan 261029f). */
  useLayoutEffect(() => settleSavedPlace("x", READER, null), []);
  useReadingPosition(SECTIONS, BLOCKS, "k");
  return null;
}

function render(): void {
  act(() => root.render(createElement(NuqsAdapter, null, createElement(Page))));
}

/** Let nuqs's 300ms position debounce flush. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
  });
}

/** One scroll-frame measurement, without letting the 300ms URL write land. */
async function measureFrame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 32));
  });
}

/** The reader scrolls so that `row` (plus `into` pixels of it) is at the top. */
async function readAt(row: number, into = 0): Promise<void> {
  scrollY = row * ROW + into;
  window.dispatchEvent(new Event("scroll"));
}

const stored = () => held.get(KEY);
const atNow = () => new URLSearchParams(location.search).get("at");

beforeEach(() => {
  scrollY = 0;
  held = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => held.get(key) ?? null,
      setItem: (key: string, value: string) => void held.set(key, value),
      removeItem: (key: string) => void held.delete(key),
    },
  });

  document.body.replaceChildren();
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  for (const b of BLOCKS) {
    const tr = document.createElement("tr");
    tr.dataset.block = b.id;
    tbody.append(tr);
  }
  table.append(tbody);
  document.body.append(table);

  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const id = (this as HTMLElement).dataset?.block;
    const i = id === undefined ? -1 : BLOCKS.findIndex((b) => b.id === id);
    const top = i === -1 ? 0 : i * ROW - scrollY;
    return { top, bottom: top + ROW, height: ROW, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
  vi.spyOn(document.documentElement, "scrollHeight", "get").mockImplementation(() => ROWS * ROW);
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 200 });
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: vi.fn((arg: unknown) => {
      const top = typeof arg === "object" && arg !== null ? (arg as ScrollToOptions).top : arg;
      if (typeof top === "number") scrollY = top;
      window.dispatchEvent(new Event("scroll"));
    }),
  });

  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  abandonScroll();
  clearArrivalAnchor();
  vi.restoreAllMocks();
});

describe("the remembered view keeps the paragraph at the reading line", () => {
  it("stores the paragraph, while the address goes on naming the section", async () => {
    history.replaceState(null, "", "/read/x?mode=quotes");
    render();
    await settle();

    await readAt(17, 40);
    await settle();

    expect(atNow()).toBe(block(12));
    expect(stored()).toBe(`?at=${block(17)}&mode=quotes`);
  });

  it("keeps the paragraph when another parameter changes the address", async () => {
    history.replaceState(null, "", "/read/x?mode=quotes");
    render();
    await settle();
    await readAt(17);
    await settle();

    history.replaceState(null, "", `/read/x?at=${block(12)}&mode=ideas`);
    expect(stored()).toBe(`?at=${block(17)}&mode=ideas`);
  });

  /** GPT Sol's plan review, F3: the address is 300ms behind the spy. */
  it("saves a new section's paragraph before the address has caught up", async () => {
    history.replaceState(null, "", "/read/x");
    render();
    await settle();
    await readAt(17);
    await settle();

    await readAt(26);
    await measureFrame();
    expect(atNow(), "the address write should still be queued").toBe(block(12));
    expect(stored()).toBe(`?at=${block(26)}`);
  });

  it("does not let another parameter overwrite a paragraph ahead of the address", async () => {
    history.replaceState(null, "", "/read/x?mode=quotes");
    render();
    await settle();
    await readAt(17);
    await settle();

    await readAt(26);
    await measureFrame();
    expect(atNow(), "the address write should still be queued").toBe(block(12));
    expect(stored()).toBe(`?at=${block(26)}&mode=quotes`);

    /* A mode write reaches the address while the position write is still
       queued. It is newer view state, but its old `at` is not a newer place. */
    act(() => history.replaceState(null, "", `/read/x?at=${block(12)}&mode=ideas`));
    expect(stored()).toBe(`?at=${block(26)}&mode=ideas`);
  });

  it("does not carry a paragraph across a newer address position", async () => {
    history.replaceState(null, "", "/read/x");
    render();
    await settle();
    await readAt(17);
    await settle();

    act(() => history.replaceState(null, "", `/read/x?at=${block(24)}&mode=ideas`));
    expect(stored()).toBe(`?at=${block(24)}&mode=ideas`);
  });

  it("treats Back as newer even when it returns to the address behind a queued note", async () => {
    history.replaceState(null, "", "/read/x");
    render();
    await settle();
    await readAt(17);
    await settle();

    await readAt(26);
    await measureFrame();
    expect(stored()).toBe(`?at=${block(26)}`);

    act(() => {
      history.replaceState(null, "", `/read/x?at=${block(12)}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(stored()).toBe(`?at=${block(12)}`);
  });

  it("forgets the paragraph when the reader goes back to the top", async () => {
    history.replaceState(null, "", "/read/x");
    render();
    await settle();
    await readAt(17);
    await settle();

    await readAt(0);
    await measureFrame();
    expect(stored()).toBe("");
  });

  it("is what a reopen at the bare address arrives at", async () => {
    held.set(KEY, `?at=${block(17)}&mode=quotes`);
    history.replaceState(null, "", "/read/x");
    render();
    await settle();

    expect(atNow()).toBe(block(17));
    expect(scrollY).toBe(17 * ROW);
    expect(stored()).toBe(`?at=${block(17)}&mode=quotes`);
  });
});
