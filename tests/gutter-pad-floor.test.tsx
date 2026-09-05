// @vitest-environment jsdom
/**
 * **The row's floor must follow the controls the gutter actually draws.**
 *
 * `td.text.gutter-pad` is what floors a row at three 24px slots (styles.css §
 * the gutter) — two until 2026-09-05, when the affordances went back to a
 * single vertical line and the bookmark moved up beside them. Without it a
 * control placed below the first slot hangs *outside its own `<tr>`* — and an
 * overhanging control is an input bug rather than a cosmetic one: it still sits
 * inside the upper row's `<tr>`, so pointing at it marks that row active while
 * the pointer is geometrically in the next.
 *
 * ## Why this file exists rather than one more assertion somewhere
 *
 * The class shipped keyed to `onChatAbout || comments` while the component's
 * public API had grown a *third* thing that draws below the first slot,
 * `onHelp` — on the reasoning that App gates both callbacks on `owner` so "the
 * two can only ever agree". GPT Sol's stage 2 review, 2026-09-04: that is true
 * of today's single caller and **false at the type boundary**, and it is not
 * belt-and-braces — an `onHelp`-only caller gets a permalink in the first slot
 * and a "?" below it with no floor, which is precisely the overhang that work
 * removed.
 *
 * So the invariant is written down as a test rather than as a sentence about
 * what App happens to pass: **whatever can be drawn below the first slot floors
 * the row.** That sentence is unchanged since 2026-09-04; what changed under it
 * is which children qualify, because the bookmark moved into the first slot.
 * This file fixes the condition, in the one place a future caller could break
 * it without touching CSS; `tests/gutter-target-size.test.ts` fixes the cells
 * the condition is derived from.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* Mocked rather than started, as tests/prose-not-rebuilt.test.tsx does: the
   real render probe patches timers and fetch globally, and Floating UI does real
   geometry jsdom does not have. Neither is what is under test. */
vi.mock("../src/web/perf.js", () => ({
  useRenderCount: () => {},
  mark: (_l: string, fn: () => unknown) => fn(),
}));
vi.mock("../src/web/Tooltip.js", () => ({
  Tooltip: ({ children }: { children: unknown }) => children,
  TooltipGroup: ({ children }: { children: unknown }) => children,
}));

import { TableView } from "../src/web/TableView.js";
import { buildGeometry } from "../src/web/tree.js";
import { fitView } from "../src/web/layout.js";
import type { Article, Block, BlockId, Comment, Tree, TreeNode } from "../src/types.js";

class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoResize as unknown as typeof ResizeObserver;

const ONE_LINE = "spya-p00001" as BlockId;

/** Two paragraphs, because a floor that applied to *one* row would still pass on one. */
const BLOCKS: Block[] = [ONE_LINE, "spya-p00002" as BlockId].map((id, i) => ({
  id,
  tag: "p",
  kind: "text" as const,
  text: `A short one-line paragraph, number ${i + 1}.`,
  words: 7,
  html: `<p id="${id}">A short one-line paragraph, number ${i + 1}.</p>`,
  gistable: true,
}));

const nodes: Record<string, TreeNode> = {
  n0: {
    id: "n0",
    depth: 0,
    parent: null,
    children: ["n1", "n2"],
    range: [BLOCKS[0]!.id, BLOCKS[1]!.id],
    title: "Floor fixture",
  },
};
BLOCKS.forEach((b, i) => {
  nodes[`n${i + 1}`] = {
    id: `n${i + 1}`,
    depth: 1,
    parent: "n0",
    children: [],
    range: [b.id, b.id],
    title: b.text.slice(0, 20),
  };
});

const TREE: Tree = { version: "1", generator: "test", slug: "floor", rootId: "n0", nodes };
const ARTICLE: Article = {
  meta: { slug: "floor", title: "Floor fixture" },
  blocks: BLOCKS,
  tree: TREE,
  assets: undefined,
} as Article;

const GEOMETRY = buildGeometry(TREE, BLOCKS);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/**
 * `TableView` with only the props this question needs, and **the capabilities
 * spelled as present-or-absent handlers**, because that is how the component
 * decides what to draw and therefore what the row has to hold.
 */
function paint(over: Record<string, unknown> = {}): void {
  const fit = fitView({
    windowWidth: 1400,
    gistDepths: GEOMETRY.columnDepths.filter((d) => d < GEOMETRY.leafDepth),
    leafDepth: GEOMETRY.leafDepth,
    showText: true,
    chosen: null,
  });
  const props = {
    article: ARTICLE,
    geometry: GEOMETRY,
    columns: fit.columns,
    layout: fit,
    showText: true,
    navDepth: GEOMETRY.leafDepth,
    arcCells: null,
    arcPending: false,
    onJump: () => {},
    comments: [] as Comment[],
    openComment: null,
    onSelect: () => {},
    onOpenComment: () => {},
    chats: [],
    chatCounts: new Map<string, number>(),
    openChat: null,
    onOpenChat: () => {},
    sections: [],
    layoutKey: "test",
    linkBase: "/read/floor",
    ...over,
  };
  act(() => {
    root.render(createElement(TableView, props as never));
  });
}

const cells = () => [...host.querySelectorAll("td.text")];
const padded = () => cells().filter((td) => td.classList.contains("gutter-pad"));

describe("the column's floor", () => {
  it("is on every row for a reader who can open a conversation", () => {
    paint({ onChatAbout: () => {}, onHelp: () => {} });
    expect(cells().length).toBe(BLOCKS.length);
    expect(padded().length).toBe(BLOCKS.length);
  });

  it("is on every row for a caller who passes ONLY onHelp", () => {
    /* The case the condition used to miss. The "?" is `grid-area: 3 / 2`, so
       this row draws something in the third slot; without the floor that
       something hangs into the paragraph below and takes its hover. */
    paint({ onHelp: () => {} });
    expect(host.querySelectorAll(".blk-help").length).toBe(BLOCKS.length);
    expect(padded().length).toBe(BLOCKS.length);
  });

  it("is on every row for a caller who passes ONLY onChatAbout", () => {
    paint({ onChatAbout: () => {} });
    expect(host.querySelectorAll(".block-chat").length).toBe(BLOCKS.length);
    expect(padded().length).toBe(BLOCKS.length);
  });

  it("is on NO row for a comment, because the bookmark is in the first slot", () => {
    /* **This flipped on 2026-09-05 and the reason is one number in the
       stylesheet**: `.blk-cmt` is `grid-area: 1 / 1`, not `2 / 1`. The bookmark
       shares the top row with the permalink, so a comment draws nothing below
       the first slot and needs no floor — which is why `gutter-pad` is now
       keyed on the two callbacks alone.

       **So this assertion is coupled to a CSS declaration**, and that coupling
       is the fragile part of the arrangement: move the bookmark down a row and
       this file goes on passing while commented rows quietly overhang again.
       `tests/gutter-target-size.test.ts` pins `.blk-cmt` to row 1 for exactly
       that reason, and says so. Do not change one without the other. */
    const comment: Comment = {
      id: "c1",
      blockId: ONE_LINE,
      quote: "short",
      start: 2,
      createdAt: "2026-09-04T09:00:00Z",
      status: "none",
    };
    paint({ comments: [comment] });
    expect(host.querySelectorAll(".blk-cmt").length).toBe(1);
    expect(padded()).toEqual([]);
  });

  it("is on no row at all for a visitor, whose gutter is one permalink", () => {
    // The control that stops the assertions above passing on a component that
    // simply floors everything.
    paint();
    expect(host.querySelectorAll("a.blk-permalink").length).toBe(BLOCKS.length);
    expect(padded()).toEqual([]);
  });
});
