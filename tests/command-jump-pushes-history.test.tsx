// @vitest-environment jsdom
/**
 * **The bar's *Jump to the first “X”* is a deliberate jump: it pushes, and
 * Back comes home.** Plan 261003f, Stage 1.1, and GPT Sol's F3 on it: the
 * first draft wrote `?at=`, which is the debounced **replace** the reader's
 * own scrolling makes — so the jump would have left no history entry, and Back
 * would have left the article instead of returning to where the reader was.
 *
 * So the runner is handed the reading view's `jumpTo`
 * (reader/useReadingPosition.ts). This mounts the real hook over nuqs, builds
 * the executor the way Reader.tsx does (`readingExecutor`), presses the row's
 * runner, and reads `history`: one entry more, the address on the first block
 * that says the words, and Back on the address the reader had. The last test
 * reads Reader.tsx itself, since mounting it drags in the whole page
 * (tests/glossary-band-wiring.test.ts § the same honest label): a wiring
 * check that the executor's `jump` is `jumpTo`, and that its paid glossary
 * path receives only the ready, visible glossary.
 *
 * The fake viewport is tests/reading-position-holds-across-a-reflow.test.tsx's.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Block, BlockId, NodeId } from "../src/types.js";
import type { CommandExecutor } from "../src/web/command-proposal.js";
import { readingExecutor } from "../src/web/command-runners.js";
import type { Section } from "../src/web/position.js";
import { abandonScroll, clearArrivalAnchor } from "../src/web/scroll.js";
import { useReadingPosition } from "../src/web/reader/useReadingPosition.js";

enableHistorySync();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
/* jsdom has no `CSS.escape`; block ids need none (tests/scroll-glide.test.ts). */
globalThis.CSS = { escape: (s: string) => s } as unknown as typeof globalThis.CSS;

const DIGITS = "abcdefghjk";
const block = (row: number) =>
  `spya-para${String(row)
    .padStart(2, "0")
    .split("")
    .map((d) => DIGITS.charAt(Number(d)))
    .join("")}` as BlockId;

const ROWS = 30;
/* Rows 20 and 25 say it; the jump is to the first. */
const words = (i: number) => (i === 20 || i === 25 ? `para ${i} names free energy` : `para ${i}`);
const BLOCKS: Block[] = Array.from({ length: ROWS }, (_, i) => ({
  id: block(i),
  tag: "p",
  kind: "text",
  text: words(i),
  words: 2,
  html: `<p>${words(i)}</p>`,
  gistable: true,
}));
const SECTIONS: Section[] = [
  { row: 0, blockId: block(0), nodeId: "n0001" as NodeId, title: "Where it opens", titleVoice: "ai" },
  { row: 12, blockId: block(12), nodeId: "n0002" as NodeId, title: "The middle bit", titleVoice: "ai" },
];

const ROW_HEIGHT = 100;
let scrollY = 0;
let host: HTMLDivElement;
let root: Root;
let executor: CommandExecutor;

/** The hook, and the executor built from its `jumpTo` as Reader.tsx builds it. */
function Harness(): ReactNode {
  const { jumpTo } = useReadingPosition(SECTIONS, BLOCKS, "layout");
  executor = readingExecutor({ slug: "x", blocks: BLOCKS, jump: jumpTo });
  return null;
}

async function settle(ms = 450): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

const atNow = () => new URLSearchParams(location.search).get("at");

beforeEach(() => {
  scrollY = 0;
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
    const top = i === -1 ? 0 : i * ROW_HEIGHT - scrollY;
    return {
      top,
      bottom: top + ROW_HEIGHT,
      height: ROW_HEIGHT,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  });
  vi.spyOn(document.documentElement, "scrollHeight", "get").mockImplementation(() => ROWS * ROW_HEIGHT);
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 200 });
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: (arg: unknown) => {
      const top = typeof arg === "object" && arg !== null ? (arg as ScrollToOptions).top : arg;
      if (typeof top === "number") scrollY = top;
      window.dispatchEvent(new Event("scroll"));
    },
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

describe("Jump to the first “X”, from the command bar", () => {
  it("pushes one history entry at the first block that says it, and Back returns", async () => {
    history.replaceState(null, "", `/read/x?at=${block(2)}`);
    act(() => root.render(createElement(NuqsAdapter, null, createElement(Harness))));
    await settle();
    const depth = history.length;
    const before = location.search;

    let outcome: unknown;
    await act(async () => {
      outcome = await executor.runners["jump-first"]?.({ id: "jump-first", words: "free energy" });
    });
    /* Short of the 300ms position debounce: what is on the address now is the
       jump's own push, not a later write from the scroll spy. */
    await settle(60);
    expect(outcome).toEqual({ kind: "close" });
    expect(atNow()).toBe(block(20));
    expect(history.length, "a deliberate jump pushes; a replace would leave the depth alone").toBe(depth + 1);

    const popped = new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
    history.back();
    await act(async () => {
      await popped;
    });
    expect(location.search).toBe(before);
  });

  it("moves nothing, and pushes nothing, when the article does not say it", async () => {
    history.replaceState(null, "", `/read/x?at=${block(2)}`);
    act(() => root.render(createElement(NuqsAdapter, null, createElement(Harness))));
    await settle();
    const depth = history.length;
    const before = location.search;
    let outcome: unknown;
    await act(async () => {
      outcome = await executor.runners["jump-first"]?.({ id: "jump-first", words: "dopamine" });
    });
    await settle(60);
    expect(outcome).toEqual({ kind: "stay", message: "“dopamine” isn't in this article." });
    expect(history.length).toBe(depth);
    expect(location.search).toBe(before);
  });
});

describe("the reading view's wiring (source-level, and labelled as such)", () => {
  it("hands the executor the deliberate jump and only the ready, visible glossary", async () => {
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const reader = await readFile(path.join(repo, "src/web/reader/Reader.tsx"), "utf8");
    const call = /readingExecutor\(\{[\s\S]*?\n {6}\}\)/.exec(reader)?.[0] ?? "";
    expect(call, "Reader.tsx no longer builds its executor with readingExecutor").not.toBe("");
    expect(call).toMatch(/\bjump: jumpTo,/);
    /* The ask must not exist while the read is loading, failed or says there
       is no glossary. Otherwise opening the band can generate a glossary while
       the hand-off starts a second paid lookup (F1). */
    expect(reader).toMatch(
      /const glossaryReady = glossaryRead\?\.status === "ready" && glossaryRead\.glossary !== null;/,
    );
    expect(call).toMatch(/\bready: glossaryReady,/);
    /* `command-proposal` can only enforce visibility against the list it is
       handed. Hold Reader's half too: `terms` is `shownEntries(allTerms)`,
       while `allTerms` still contains entries the owner hid (F2). */
    expect(call).toMatch(/\bterms,/);
    expect(call).not.toMatch(/\bterms: allTerms\b/);
    /* And the ask's move to Glossary is the plain setter, which arms no
       generate-on-open (F1) — the Dock's `onMode` is the press that does.
       Since plan 261004g it is `showBand`: the same plain setter, plus
       bringing back a band that had stepped aside on a narrow window. */
    expect(call).toMatch(/openGlossary: \(\) => showBand\("glossary"\),/);
    expect(reader).toMatch(/const showBand = useCallback\([\s\S]*?if \(target !== mode\) void setMode\(target\);/);
    expect(reader).toMatch(/<Dock[\s\S]*?executor=\{executor\}/);
  });
});
