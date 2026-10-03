// @vitest-environment jsdom
/**
 * **A finger's selection gets a button, because it gets no `mouseup`.**
 *
 * Greg, 2026-10-03 (spya-ma5h9b), from an iPad: *"I tried highlighting a few
 * words on my iPad and it didn't seem to work. It just flashed up the usual
 * iPad context menu."* The comment box opened only from `TableView`'s
 * `onMouseUp`, and a long-press selection on iOS fires none.
 *
 * The harness below is `Reader.tsx`'s three arms in miniature — `TableView`,
 * `TouchSelectionChip` and `AnnotateDialog` around one `annotating` state and
 * one `selectProse` — because nothing in this repo mounts the whole `Reader`.
 * That makes it a replica of the wiring, so the last test reads `Reader.tsx`'s
 * source for the real one, as tests/one-escape-closes-one-surface.test.tsx does.
 *
 * **What this cannot show** is anything iOS does: jsdom has no long-press, no
 * selection handles, no callout and no range geometry. The events here are the
 * ones the Pointer Events and Selection specs say a touch selection produces.
 * docs/project/touch.md § A finger's selection gets a button.
 */
import { readFileSync } from "node:fs";

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../src/web/perf.js", () => ({
  useRenderCount: () => {},
  mark: (_l: string, fn: () => unknown) => fn(),
}));

/* Floating UI does real geometry and is not what is under test. */
vi.mock("../src/web/Tooltip.js", () => ({
  Tooltip: ({ children }: { children: unknown }) => children,
  TooltipGroup: ({ children }: { children: unknown }) => children,
  ControlTip: () => null,
}));

import { AnnotateDialog } from "../src/web/AnnotateDialog.js";
import { TableView } from "../src/web/TableView.js";
import { GRACE_MS, SETTLE_MS, TouchSelectionChip } from "../src/web/TouchSelectionChip.js";
import { buildGeometry } from "../src/web/tree.js";
import { fitView } from "../src/web/layout.js";
import { MIN_SELECTION_CHARS, type SelectionAnchor } from "../src/web/selection.js";
import { readArticleFromDir } from "./helpers/article-from-dir.js";
import type { Article } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DIR = "tests/fixtures/data-root/data/openai-huggingface";

class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoResize as unknown as typeof ResizeObserver;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  window.getSelection()?.removeAllRanges();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

/** `Reader.tsx` in miniature: the same three arms, the same gates. */
function Harness({ article, owner }: { article: Article; owner: boolean }) {
  const [annotating, setAnnotating] = useState<SelectionAnchor | null>(null);
  /* Reader.tsx § `selectProse`: a visitor's selection is silent. */
  const selectProse = (anchor: SelectionAnchor) => {
    if (!owner) return;
    setAnnotating(anchor);
  };
  return createElement(
    "div",
    null,
    createElement(TableView, {
      article,
      geometry: buildGeometry(article.tree, article.blocks),
      layout: fitView({ windowWidth: 1400 }),
      onJump: () => {},
      comments: [],
      openComment: null,
      chats: [],
      chatCounts: new Map<string, number>(),
      notesBy: "you" as const,
      openChat: null,
      linkBase: "/read/x",
      onSelect: selectProse,
      onOpenComment: () => {},
      onOpenChat: () => {},
    } as never),
    owner &&
      createElement(TouchSelectionChip, { suppressed: Boolean(annotating), onSelect: selectProse }),
    owner &&
      annotating &&
      createElement(AnnotateDialog, {
        anchor: annotating,
        placing: false,
        loaded: true,
        onSave: () => {},
        onCancel: () => setAnnotating(null),
      }),
  );
}

/** Mount, and hand back a text node of plain prose long enough to select in. */
async function mounted(owner = true): Promise<Text> {
  const loaded = await readArticleFromDir(DIR);
  if (!loaded.meta) throw new Error(`${DIR} has no meta.json — the fixture is incomplete`);
  const article: Article = {
    highPowerSince: null,
    titleOverridden: false,
    meta: loaded.meta,
    blocks: loaded.blocks,
    tree: loaded.tree,
    assets: undefined,
    navLabelStatus: "ready",
    sourceGuess: undefined,
  };
  await act(async () => {
    root.render(createElement(Harness, { article, owner }));
  });
  for (const prose of host.querySelectorAll<HTMLElement>("tr[data-block] td.text .prose")) {
    const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (/^[A-Za-z]{4}[\s\S]{40}/.test(n.textContent ?? "")) {
        vi.useFakeTimers();
        return n as Text;
      }
    }
  }
  throw new Error("fixture has no plain prose text node long enough to select in");
}

function pointerDown(el: EventTarget, pointerType: "touch" | "mouse" | "pen"): void {
  act(() => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType }));
  });
}

function selectionChanged(): void {
  act(() => {
    document.dispatchEvent(new Event("selectionchange"));
  });
}

/** Select `[0, end)` of the node and tell the document, as a browser would. */
function select(text: Text, end: number): string {
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, end);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  selectionChanged();
  return range.toString().trim();
}

function collapse(): void {
  window.getSelection()!.removeAllRanges();
  selectionChanged();
}

function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const chip = () => document.querySelector<HTMLButtonElement>("button.touch-select-chip");
const boxQuote = () => document.querySelector(".annotate-dialog .annotate-quote")?.textContent ?? null;

/** A finger's tap: the pointer goes down on it, and the click follows. */
function tap(el: HTMLElement): void {
  pointerDown(el, "touch");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** A finger selects 20 characters and the handles come to rest. */
async function aSettledTouchSelection(): Promise<{ text: Text; quote: string }> {
  const text = await mounted();
  pointerDown(text.parentElement!, "touch");
  const quote = select(text, 20);
  wait(SETTLE_MS);
  return { text, quote };
}

it("a touch selection gets the chip once it settles, and pressing it opens the box on those words", async () => {
  const text = await mounted();
  pointerDown(text.parentElement!, "touch");
  const quote = select(text, 20);

  expect(boxQuote(), "no mouseup, so nothing has opened by itself").toBeNull();
  wait(SETTLE_MS - 1);
  expect(chip(), "not while the handles may still be moving").toBeNull();
  wait(1);
  const button = chip();
  expect(button?.textContent).toBe("Highlight or comment");
  expect(window.getSelection()!.isCollapsed, "appearing must not clear the selection").toBe(false);
  expect(document.activeElement, "and it takes no focus").not.toBe(button);

  tap(button!);
  expect(boxQuote()).toBe(quote);
});

it("moving the handles takes the chip away until they settle again", async () => {
  const { text } = await aSettledTouchSelection();
  expect(chip()).not.toBeNull();
  const longer = select(text, 30);
  expect(chip(), "it was drawn beside words that are no longer the selection").toBeNull();
  wait(SETTLE_MS);
  tap(chip()!);
  expect(boxQuote()).toBe(longer);
});

it("a mouse selection never shows the chip", async () => {
  const text = await mounted();
  pointerDown(text.parentElement!, "mouse");
  select(text, 20);
  wait(SETTLE_MS * 4);
  expect(chip()).toBeNull();
});

it("a mouse press takes away a chip a finger earned", async () => {
  const { text } = await aSettledTouchSelection();
  expect(chip()).not.toBeNull();
  pointerDown(text.parentElement!, "mouse");
  expect(chip()).toBeNull();
});

it("a selection under the floor shows no chip", async () => {
  const text = await mounted();
  pointerDown(text.parentElement!, "touch");
  select(text, MIN_SELECTION_CHARS - 1);
  wait(SETTLE_MS * 4);
  expect(chip()).toBeNull();
});

it("a selection the tap collapsed still opens, inside the grace period", async () => {
  const { quote } = await aSettledTouchSelection();
  collapse();
  wait(GRACE_MS - 1);
  const button = chip();
  expect(button, "the chip must outlive the collapse long enough to be pressed").not.toBeNull();
  tap(button!);
  expect(boxQuote()).toBe(quote);
});

it("once the selection is gone and the grace has run out, the chip is gone and nothing can open", async () => {
  await aSettledTouchSelection();
  const stale = chip()!;
  collapse();
  wait(GRACE_MS);
  expect(chip()).toBeNull();
  /* The node a slow finger might still be heading for: detached, so pressing
     it reaches nothing. */
  tap(stale);
  wait(SETTLE_MS * 4);
  expect(boxQuote()).toBeNull();
});

it("a visitor never sees the chip", async () => {
  const text = await mounted(false);
  pointerDown(text.parentElement!, "touch");
  select(text, 20);
  wait(SETTLE_MS * 4);
  expect(chip()).toBeNull();
  expect(boxQuote()).toBeNull();
});

it("the chip is gone once the box is open, and does not come back over it", async () => {
  const { text } = await aSettledTouchSelection();
  tap(chip()!);
  expect(boxQuote()).not.toBeNull();
  expect(chip()).toBeNull();
  /* The selection is deliberately left alone when the box opens (Reader.tsx
     § selectProse), and the reader may nudge it. Still no chip. */
  select(text, 25);
  wait(SETTLE_MS * 4);
  expect(chip()).toBeNull();
});

it("Reader.tsx mounts the chip for an owner only, off the same selectProse, and hides it behind every box", () => {
  const source = readFileSync("src/web/reader/Reader.tsx", "utf8");
  const at = source.indexOf("<TouchSelectionChip");
  expect(at, "Reader.tsx no longer mounts the chip — this test has lost its subject").toBeGreaterThan(-1);
  const tag = source.slice(at, source.indexOf("/>", at));
  expect(tag).toMatch(/onSelect=\{selectProse\}/);
  expect(tag).toMatch(/suppressed=\{Boolean\(annotating \|\| overlay \|\| openComment\)\}/);
  const before = source.slice(0, at).trimEnd();
  expect(before.endsWith("{owner && ("), "a visitor must not get the chip at all").toBe(true);
});
