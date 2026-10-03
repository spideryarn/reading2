// @vitest-environment jsdom
/**
 * **The block a chat panel is open on wears a mark** — the real `TableView`.
 *
 * Stage 2 of
 * docs/plans/261003p-block-chat-spinner-and-docking-in-the-marginalia-column.md.
 * The panel is fixed to the window, docked or floating, so nothing about where
 * it sits says which paragraph it is about; `td.text.chat-open` is what does.
 *
 * The harness is tests/highlight-marks.test.tsx's.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
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
import { readArticleFromDir } from "./helpers/article-from-dir.js";
import type { Article, BlockId } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DIR = "tests/fixtures/data-root/data/openai-huggingface";

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

async function draw(chatOpenBlock: BlockId | null | undefined): Promise<void> {
  const geometry = buildGeometry(article.tree, article.blocks);
  await act(async () => {
    root.render(
      createElement(TableView, {
        article,
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
        onSelect: () => {},
        onOpenComment: () => {},
        onOpenChat: () => {},
        ...(chatOpenBlock === undefined ? {} : { chatOpenBlock }),
      } as never),
    );
  });
}

const marked = () => [...host.querySelectorAll<HTMLElement>("td.text.chat-open")];

describe("the block a chat is open on", () => {
  it("is the one cell that wears `chat-open`", async () => {
    const target = article.blocks[3]?.id;
    if (!target) throw new Error("the fixture has fewer than four blocks");
    await draw(target);
    expect(host.querySelectorAll("td.text").length).toBeGreaterThan(4);
    expect(marked()).toHaveLength(1);
    expect(marked()[0]?.closest("tr")?.dataset.block).toBe(target);
  });

  it("moves with the panel, and goes when it closes", async () => {
    const [first, second] = [article.blocks[2]?.id, article.blocks[5]?.id];
    if (!first || !second) throw new Error("the fixture has fewer than six blocks");
    await draw(first);
    expect(marked().map((td) => td.closest("tr")?.dataset.block)).toEqual([first]);
    await draw(second);
    expect(marked().map((td) => td.closest("tr")?.dataset.block)).toEqual([second]);
    await draw(null);
    expect(marked()).toHaveLength(0);
  });

  it("marks nothing when the prop is absent, or names a block that is not here", async () => {
    await draw(undefined);
    expect(marked()).toHaveLength(0);
    await draw("spya-zzzzzz" as BlockId);
    expect(marked()).toHaveLength(0);
  });
});

/* A rule down the right edge that takes no room: a border would change the
   cell's width and move every line in the paragraph when the panel opens. And
   not the cell's `box-shadow`, which is the search bar's and the flash's
   (annotations.css § `td.text.has-hit`, prose.css § `block-flash-still`) — a
   second declaration would silently replace whichever lost the cascade. */
describe("td.text.chat-open", () => {
  const css = readFileSync("src/web/styles/dialogs.css", "utf8");
  const rule = css.match(/td\.text\.chat-open::after\s*\{([^}]*)\}/)?.[1] ?? "";

  it("is a 2px rule in the chat's colour, on the cell's right edge", () => {
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/right:\s*0/);
    expect(rule).toMatch(/width:\s*2px/);
    expect(rule).toMatch(/background:\s*var\(--chat-mark\)/);
    expect(rule).toMatch(/pointer-events:\s*none/);
  });

  it("takes no room and leaves the cell's own shadow alone", () => {
    expect(css).not.toMatch(/td\.text\.chat-open\s*\{[^}]*(border|box-shadow|padding)/);
  });
});
