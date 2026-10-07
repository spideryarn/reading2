// @vitest-environment jsdom
/**
 * **The prose does not draw the title the masthead has just drawn** — the real
 * `TableView`, on a real wrapper-shaped article.
 *
 * Greg, spya-t6cdve, 2026-10-06: *"Why does this article seem to show the title
 * twice on the page?"* Block 0 of every web article imported before stage 3 of
 * the plan is our own debug page's `<h1>`, and block 1 its `~N min read` line.
 * docs/plans/261007b-the-title-is-drawn-once-and-the-masthead-loses-its-back-arrow.md.
 *
 * What is pinned is **how** they are hidden: the rows stay in the table, so
 * block ids, row indices and the tree's spans still agree, and the fold
 * store's one stylesheet hides their cells and answers `isFolded` for them.
 * jsdom lays nothing out, so "hidden" here is the rule in that stylesheet;
 * that the rule draws nothing is the browser pass's to see.
 *
 * The harness is tests/article-end-mark.test.tsx's, and so is the fixture: its
 * blocks 0 and 1 are the wrapper as stage 3 stored it.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/web/perf.js", () => ({
  useRenderCount: () => {},
  mark: (_l: string, fn: () => unknown) => fn(),
}));
vi.mock("../src/web/Tooltip.js", () => ({
  Tooltip: ({ children }: { children: unknown }) => children,
  TooltipGroup: ({ children }: { children: unknown }) => children,
  ControlTip: () => null,
}));

import { TableView } from "../src/web/TableView.js";
import { buildGeometry } from "../src/web/tree.js";
import { fitView } from "../src/web/layout.js";
import { FOLD_STYLE_ATTR, isFolded, isFoldedAway, toggleFoldAll } from "../src/web/fold.js";
import { readArticleFromDir } from "./helpers/article-from-dir.js";
import type { Article } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DIR = "tests/fixtures/data-root/data/noema-mythology-of-conscious-ai";

class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoResize as unknown as typeof ResizeObserver;

let article: Article;

beforeAll(async () => {
  const loaded = await readArticleFromDir(DIR);
  if (!loaded.meta) throw new Error(`${DIR} has no meta.json`);
  article = {
    highPowerSince: null,
    titleOverridden: false,
    meta: loaded.meta,
    blocks: loaded.blocks,
    tree: loaded.tree,
    assets: undefined,
    navLabelStatus: "ready",
    sourceGuess: undefined,
  };
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function draw(shown: Article): Promise<void> {
  const geometry = buildGeometry(shown.tree, shown.blocks);
  await act(async () => {
    root.render(
      createElement(TableView, {
        article: shown,
        geometry,
        layout: fitView({ windowWidth: 1400 }),
        onJump: () => {},
        comments: [],
        openComment: null,
        chats: [],
        chatCounts: new Map<string, number>(),
        notesBy: "you" as const,
        openChat: null,
        linkBase: "/read/x",
        slug: "x",
        onSelect: () => {},
        onOpenComment: () => {},
        onOpenChat: () => {},
      } as never),
    );
  });
}

const row = (i: number) => host.querySelector<HTMLElement>(`tr[data-block="${article.blocks[i]!.id}"]`);
const rule = (i: number) => `tr[data-block="${article.blocks[i]!.id}"]>td{display:none}`;
const sheet = () => document.head.querySelector(`style[${FOLD_STYLE_ATTR}]`)?.textContent ?? "";

describe("the wrapper's heading and reading-time line, in the prose table", () => {
  it("is the fixture this test thinks it is", () => {
    expect(article.blocks[0]).toMatchObject({ tag: "h1", text: article.meta.title });
    expect(article.blocks[1]?.text).toMatch(/· ~\d+ min read$/);
    expect(article.blocks[2]?.kind).toBe("text");
  });

  it("keeps both rows in the table, in their places", async () => {
    await draw(article);
    const rows = [...host.querySelectorAll<HTMLElement>("tbody tr[data-block]")];
    expect(rows).toHaveLength(article.blocks.length);
    expect(rows[0]).toBe(row(0));
    expect(rows[1]).toBe(row(1));
    expect(row(0)?.querySelector("td.text")?.textContent).toContain(article.meta.title);
  });

  it("hides their cells through the fold stylesheet, and nothing else's", async () => {
    await draw(article);
    expect(sheet()).toBe(`${rule(0)}\n${rule(1)}\n`);
    expect(isFolded(article.blocks[0]!.id)).toBe(true);
    expect(isFolded(article.blocks[1]!.id)).toBe(true);
    expect(isFolded(article.blocks[2]!.id)).toBe(false);
    /* Hidden, and not folded away: its section is the one on screen. */
    expect(isFoldedAway(article.blocks[0]!.id)).toBe(false);
  });

  it("gives the hidden heading no fold chevron, and leaves the other headings theirs", async () => {
    await draw(article);
    expect(row(0)?.querySelector(".fold-toggle")).toBeNull();
    expect(host.querySelectorAll(".fold-toggle").length).toBeGreaterThan(0);
  });

  it("leaves the third block as it was: drawn, unhidden, and still there after Fold all", async () => {
    await draw(article);
    const third = row(2);
    expect(third?.querySelector("td.text")?.textContent).toContain(article.blocks[2]!.text.slice(0, 40));
    expect(sheet()).not.toContain(article.blocks[2]!.id);
    /* Fold all folds the sections and cannot shut the article behind the
       hidden h1, which would have taken this row with it. */
    act(() => toggleFoldAll());
    expect(isFolded(article.blocks[2]!.id)).toBe(false);
    expect(sheet().split("\n").length).toBeGreaterThan(3);
    act(() => toggleFoldAll());
    expect(sheet()).toBe(`${rule(0)}\n${rule(1)}\n`);
  });

  it("draws a renamed article's heading and still hides our line, then follows the rename's undoing", async () => {
    /* ArticlePage applies a rename as a spread: new article, the same blocks. */
    const renamed = { ...article, meta: { ...article.meta, title: "My name for it" }, titleOverridden: true };
    await draw(renamed);
    expect(sheet()).toBe(`${rule(1)}\n`);
    expect(row(0)?.querySelector(".fold-toggle"), "the author's heading folds like any other").not.toBeNull();
    await draw(article);
    expect(sheet()).toBe(`${rule(0)}\n${rule(1)}\n`);
    expect(row(0)?.querySelector(".fold-toggle")).toBeNull();
  });

  it("follows a rename that keeps the same words: only the flag changed", async () => {
    await draw(article);
    await draw({ ...article, titleOverridden: true });
    expect(sheet()).toBe(`${rule(1)}\n`);
  });

  it("follows the title when it alone changes, on an article with no line of ours", async () => {
    /* A PDF's shape: its own `<h1>` and no reading-time line, so only the
       words decide. The tree is cut down to match the one block. */
    const first = article.blocks[0]!;
    const paper = { ...article, blocks: [first], tree: { ...article.tree, children: [] } as never };
    await draw({ ...paper, meta: { ...article.meta, title: "Not what the heading says" } });
    expect(sheet()).toBe("");
    await draw(paper);
    expect(sheet()).toBe(`tr[data-block="${first.id}"]>td{display:none}\n`);
  });

  it("opens everything when the reader leaves", async () => {
    await draw(article);
    act(() => root.unmount());
    expect(document.head.querySelector(`style[${FOLD_STYLE_ATTR}]`)).toBeNull();
    root = createRoot(host);
  });
});
