// @vitest-environment jsdom
/**
 * **A highlight redraws when its colour or its words change, and a click on an
 * overlap opens the comment whose colour is showing** — the real `TableView`,
 * plan 261003e.
 *
 * Two review findings, both of which a unit test of `annotateHtml` cannot see:
 *
 * - **S2, the mark cache.** `marksByBlock` reuses its resolved marks while
 *   `anchorKey` is unchanged, and that key used to hold the anchor alone. So a
 *   recolour, a removed colour, or a note added to a wordless highlight — none
 *   of which moves the words — kept the old drawing. Each is a re-render here
 *   with a new comment object, which is what `useComments` hands down.
 * - **S5, one priority.** The click handler opens the first id in
 *   `data-comment`; the wash is the first coloured comment's. Driven through
 *   the real `mouseup` path, as tests/short-selection-in-a-mark.test.tsx does.
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

let article: Article;
/** A plain prose block with no link in it, and its rendered text. */
let blockId: BlockId;
let text = "";

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
const onOpenComment = vi.fn();
const onOpenChat = vi.fn();

beforeEach(async () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  window.getSelection()?.removeAllRanges();
  onOpenComment.mockReset();
  onOpenChat.mockReset();
  /* Find the block from the rendered page, as tests/short-selection-in-a-mark.test.tsx
     does: the offset space is the DOM's text, not `block.text`. */
  await draw([]);
  const row = [...host.querySelectorAll<HTMLElement>("tr[data-block]")].find((tr) => {
    const prose = tr.querySelector<HTMLElement>("td.text .prose");
    return prose !== null && !prose.querySelector("a[href]") && (prose.textContent ?? "").trim().length > 80;
  });
  if (!row) throw new Error("the fixture has no plain prose block long enough to mark");
  blockId = row.dataset.block as BlockId;
  text = row.querySelector("td.text .prose")?.textContent ?? "";
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function draw(comments: Comment[]): Promise<void> {
  const geometry = buildGeometry(article.tree, article.blocks);
  await act(async () => {
    root.render(
      createElement(TableView, {
        article,
        geometry,
        layout: fitView({ windowWidth: 1400 }),
        onJump: () => {},
        comments,
        openComment: null,
        chats: [],
        chatCounts: new Map<string, number>(),
        notesBy: "you" as const,
        openChat: null,
        linkBase: "/read/x",
        onSelect: () => {},
        onOpenComment,
        onOpenChat,
      } as never),
    );
  });
}

/** A comment over `[start, end)` of the block's rendered text. */
function over(id: string, start: number, end: number, more: Partial<Comment> = {}): Comment {
  return {
    id,
    blockId,
    quote: text.slice(start, end),
    start,
    createdAt: "2026-10-01T09:00:00.000Z",
    status: "none",
    ...more,
  } as Comment;
}

const marks = () => [...host.querySelectorAll<HTMLElement>(`tr[data-block="${blockId}"] mark.cmt`)];
const colourOf = () => marks()[0]?.getAttribute("data-colour") ?? null;
const hasStar = () => marks().some((m) => m.hasAttribute("data-mark-end"));

describe("the drawing follows the comment, not only its anchor (S2)", () => {
  it("redraws on a recolour", async () => {
    await draw([over("spya-hlm001", 10, 40, { colour: "yellow" })]);
    expect(colourOf()).toBe("yellow");
    await draw([over("spya-hlm001", 10, 40, { colour: "pink" })]);
    expect(colourOf()).toBe("pink");
  });

  it("redraws when the colour is taken away, and the plain comment gets its ✳ back", async () => {
    await draw([over("spya-hlm002", 10, 40, { colour: "green" })]);
    expect(colourOf()).toBe("green");
    expect(hasStar()).toBe(false);
    await draw([over("spya-hlm002", 10, 40)]);
    expect(marks().length).toBeGreaterThan(0);
    expect(colourOf()).toBeNull();
    expect(hasStar()).toBe(true);
  });

  it("gains the ✳ when a wordless highlight is given a note, and loses it when the note is cleared", async () => {
    await draw([over("spya-hlm003", 10, 40, { colour: "blue" })]);
    expect(hasStar()).toBe(false);
    await draw([over("spya-hlm003", 10, 40, { colour: "blue", body: "why this matters" })]);
    expect(hasStar()).toBe(true);
    await draw([over("spya-hlm003", 10, 40, { colour: "blue" })]);
    expect(hasStar()).toBe(false);
  });
});

describe("a click on an overlap opens the comment whose colour it wears (S5)", () => {
  it("opens the newer of two overlapping highlights, through the real mouseup", async () => {
    /* The older one first in the list, as the store returns them. */
    await draw([
      over("spya-hlm004", 10, 40, { colour: "yellow", createdAt: "2026-10-01T09:00:00.000Z" }),
      over("spya-hlm005", 25, 60, { colour: "pink", createdAt: "2026-10-02T09:00:00.000Z" }),
    ]);
    const overlap = marks().find((m) => (m.getAttribute("data-comment") ?? "").includes(" "));
    if (!overlap) throw new Error("the two comments drew no shared run — the test would prove nothing");
    expect(overlap.getAttribute("data-colour")).toBe("pink");
    act(() => {
      overlap.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    expect(onOpenComment).toHaveBeenCalledTimes(1);
    expect(onOpenComment).toHaveBeenCalledWith("spya-hlm005");
  });
});
