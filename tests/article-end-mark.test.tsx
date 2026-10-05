// @vitest-environment jsdom
/**
 * **The article says where it ends** — the real `TableView`.
 *
 * Greg, 2026-10-04 (report `spya-zgf8p2`): *"Add some subtle pleasant visual
 * marker at the very end of the article in the text column to show that it is
 * the end."* Until then the page just stopped, and the end of a piece looked
 * like a page that had not finished loading.
 *
 * What is pinned is **where the mark lives, not what it looks like**: one cell
 * in a `<tfoot>`, which is not a block. Everything that finds a block does it
 * through `tr[data-block]` or `td.text`, so a mark that was either would be
 * hovered, selected, counted and jumped to as a paragraph.
 * docs/plans/261005e-an-end-of-article-mark-and-the-publication-date-on-the-shelf-card.md.
 *
 * The harness is tests/chat-open-block-mark.test.tsx's.
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
import type { Article } from "../src/types.js";

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
        onSelect: () => {},
        onOpenComment: () => {},
        onOpenChat: () => {},
      } as never),
    );
  });
}

const marks = () => [...host.querySelectorAll<HTMLElement>(".article-end")];

describe("the end of the article", () => {
  it("is marked once, after the last block", async () => {
    await draw(article);
    expect(marks()).toHaveLength(1);
    const rows = [...host.querySelectorAll("table.zoom tr")];
    expect(rows.at(-1)?.contains(marks()[0] ?? null), "the mark is in the table's last row").toBe(true);
    expect(marks()[0]?.textContent).toContain("End of article");
  });

  it("is a footer cell and not a block", async () => {
    await draw(article);
    const mark = marks()[0];
    expect(mark?.closest("tfoot"), "in the table's foot").not.toBeNull();
    expect(mark?.closest("tbody"), "not among the blocks").toBeNull();
    expect(mark?.closest("tr")?.hasAttribute("data-block")).toBe(false);
    expect(mark?.closest("td")?.classList.contains("text")).toBe(false);
    /* And the blocks are all still there, one row each. */
    expect(host.querySelectorAll("tr[data-block]")).toHaveLength(article.blocks.length);
  });

  it("is not drawn for an article with no blocks", async () => {
    await draw({ ...article, blocks: [], tree: { ...article.tree, children: [] } as never });
    expect(marks()).toHaveLength(0);
  });
});

/* A `<tfoot>` is a footer group, and a browser repeats a footer group at the
   foot of every printed page: the article would end on each one. */
describe("the footer's display", () => {
  it("is a plain row group, so print draws it once", () => {
    const css = readFileSync("src/web/styles/prose.css", "utf8");
    expect(css).toMatch(/table\.zoom > tfoot\s*\{\s*display:\s*table-row-group;\s*\}/);
  });
});
