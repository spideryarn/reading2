// @vitest-environment jsdom
/**
 * **A short drag inside an existing mark must not open that mark.**
 *
 * `TableView`'s `mouseup` handler asks `readSelection` first, on the stated
 * rule that *a real selection wins over the mark it happens to end in*. But a
 * selection the floor refused came back as `null` — indistinguishable from "no
 * selection at all" — so the handler fell straight through to the mark logic
 * and opened somebody's comment or chat instead. The reader dragged out two
 * words and got an old explanation of a different passage.
 *
 * Two halves, and they need each other:
 *
 * - a drag **at or above** the floor opens a new comment on those words, even
 *   when it lands inside an existing mark (`MIN_SELECTION_CHARS` is 2 since
 *   2026-09-05, so `AI` and `Ryle` are askable);
 * - a drag **below** it does nothing at all — not the mark, not a new comment.
 *
 * The plain click on a mark is asserted alongside them, because "nothing ever
 * opens" would pass the first two on its own. docs/project/comments.md
 * § Deliberate limits.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/* Mocked rather than started, as in tests/prose-not-rebuilt.test.tsx: the real
   probe patches timers, rAF and fetch globally. */
vi.mock("../src/web/perf.js", () => ({
  useRenderCount: () => {},
  mark: (_l: string, fn: () => unknown) => fn(),
}));

/* Floating UI does real geometry and is not what is under test. */
vi.mock("../src/web/Tooltip.js", () => ({
  Tooltip: ({ children }: { children: unknown }) => children,
  TooltipGroup: ({ children }: { children: unknown }) => children,
}));

import { TableView } from "../src/web/TableView.js";
import { buildGeometry } from "../src/web/tree.js";
import { fitView } from "../src/web/layout.js";
import { MIN_SELECTION_CHARS } from "../src/web/selection.js";
import { readArticleFromDir } from "./helpers/article-from-dir.js";
import type { Article, BlockId, Comment } from "../src/types.js";

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
});

interface Spies {
  onSelect: ReturnType<typeof vi.fn>;
  onOpenComment: ReturnType<typeof vi.fn>;
  onOpenChat: ReturnType<typeof vi.fn>;
}

function propsFor(article: Article, comments: Comment[], spies: Spies) {
  const geometry = buildGeometry(article.tree, article.blocks);
  const gistDepths = geometry.columnDepths.filter((d) => d < geometry.leafDepth);
  const fit = fitView({
    windowWidth: 1400,
    gistDepths,
    leafDepth: geometry.leafDepth,
    showText: true,
    chosen: null,
  });
  return {
    article,
    geometry,
    columns: fit.columns,
    layout: fit,
    showText: true,
    navDepth: geometry.leafDepth,
    onJump: () => {},
    comments,
    openComment: null,
    chats: [],
    chatCounts: new Map<string, number>(),
    openChat: null,
    sections: [],
    layoutKey: "test",
    linkBase: "/read/x",
    ...spies,
  };
}

/** Render the article, then re-render with one comment anchored inside it. */
async function withAMarkedPassage(): Promise<{
  mark: HTMLElement;
  quote: string;
  blockId: BlockId;
  spies: Spies;
}> {
  const loaded = await readArticleFromDir(DIR);
  if (!loaded.meta) throw new Error(`${DIR} has no meta.json — the fixture is incomplete`);
  const article: Article = {
    meta: loaded.meta,
    blocks: loaded.blocks,
    tree: loaded.tree,
    assets: undefined,
    navLabelStatus: "ready",
  };
  const spies: Spies = { onSelect: vi.fn(), onOpenComment: vi.fn(), onOpenChat: vi.fn() };

  await act(async () => {
    root.render(createElement(TableView, propsFor(article, [], spies) as never));
  });

  /* Pick the quote out of the *rendered* text rather than out of `block.text`:
     the offset space a comment is stored in is the concatenation of the
     block's text nodes, which is what the DOM has and what `readSelection`
     measures. See docs/project/comments.md § Anchoring. */
  const row = [...host.querySelectorAll<HTMLElement>("tr[data-block]")].find((tr) => {
    const prose = tr.querySelector<HTMLElement>("td.text .prose");
    if (!prose || prose.querySelector("a[href]")) return false; // a link click is its own rule
    return (prose.textContent ?? "").trim().length > 60;
  });
  if (!row) throw new Error("fixture has no plain prose block long enough to mark");
  const blockId = row.dataset.block as BlockId;
  const prose = row.querySelector<HTMLElement>("td.text .prose")!;
  const text = prose.textContent ?? "";
  /* Start the quote on a word of at least four letters, so that dragging out
     its first one, two or three characters is a drag of exactly that many —
     `readSelection` trims, and a space at offset 1 would quietly turn the
     two-character drag into a one-character one and test the wrong branch. */
  const start = text.slice(20).search(/[A-Za-z]{4}/) + 20;
  const quote = text.slice(start, start + 24).trim();
  expect(quote.slice(0, 4), "the drags below must not straddle a space").toMatch(/^[A-Za-z]{4}$/);
  expect(quote.length, "the quote must be long enough to drag inside").toBeGreaterThan(8);

  const comment: Comment = {
    id: "cmt-1",
    blockId,
    quote,
    start: text.indexOf(quote, start),
    createdAt: new Date().toISOString(),
    status: "none",
    body: "the reader's own note",
  };

  await act(async () => {
    root.render(createElement(TableView, propsFor(article, [comment], spies) as never));
  });

  const mark = host.querySelector<HTMLElement>("mark.cmt");
  /* Without this the tests below pass by never drawing a mark at all —
     docs/reusable/silent-success.md. */
  if (!mark) throw new Error("the comment drew no mark — the test would prove nothing");
  return { mark, quote, blockId, spies };
}

/** Select `[start, end)` of the mark's own text, the way a drag inside it would. */
function dragInside(mark: HTMLElement, start: number, end: number): void {
  const text = mark.firstChild;
  if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error("the mark has no text node");
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, end);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

function mouseUpOn(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
}

it("a drag inside a mark asks about those words instead of reopening the comment", async () => {
  const { mark, spies } = await withAMarkedPassage();
  dragInside(mark, 0, MIN_SELECTION_CHARS + 1);
  mouseUpOn(mark);

  expect(spies.onSelect, "a real selection wins over the mark it lands in").toHaveBeenCalledTimes(1);
  expect(spies.onOpenComment).not.toHaveBeenCalled();
  expect(spies.onOpenChat).not.toHaveBeenCalled();
});

it("a two-character drag is a question, not a skid", async () => {
  /* `AI`, `EU`, `Ryle`, `qualia` — the commonest short selection there is, and
     the floor of 8 refused every one of them. */
  expect(MIN_SELECTION_CHARS).toBeLessThanOrEqual(2);
  const { mark, spies } = await withAMarkedPassage();
  dragInside(mark, 0, 2);
  mouseUpOn(mark);

  expect(spies.onSelect).toHaveBeenCalledTimes(1);
  expect(spies.onOpenComment).not.toHaveBeenCalled();
});

it("a drag too short to read opens nothing at all", async () => {
  const { mark, spies } = await withAMarkedPassage();
  dragInside(mark, 0, MIN_SELECTION_CHARS - 1);
  mouseUpOn(mark);

  expect(spies.onSelect, "too short to be a question").not.toHaveBeenCalled();
  expect(
    spies.onOpenComment,
    "a refused selection must not open the mark it happened to end in",
  ).not.toHaveBeenCalled();
  expect(spies.onOpenChat).not.toHaveBeenCalled();
});

it("a plain click on a mark still opens its comment", async () => {
  const { mark, spies } = await withAMarkedPassage();
  window.getSelection()?.removeAllRanges();
  mouseUpOn(mark);

  expect(spies.onOpenComment).toHaveBeenCalledWith("cmt-1");
  expect(spies.onSelect).not.toHaveBeenCalled();
});
