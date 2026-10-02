// @vitest-environment jsdom
/**
 * **Folding a heading's section** — src/web/fold.ts. Which rows a fold hides,
 * which headings get a button, and the store's reveal, which `scrollToBlock`
 * relies on to have changed the layout before it returns.
 * docs/plans/261002e-collapsible-headings-and-fold-all.md.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Block, BlockId } from "../src/types.js";
import {
  FOLD_STYLE_ATTR,
  clearFoldArticle,
  foldableHeadings,
  foldsHiding,
  hiddenBlocks,
  isFolded,
  revealBlock,
  setFoldArticle,
  toggleFold,
  toggleFoldAll,
} from "../src/web/fold.js";

const id = (s: string) => `spya-${s}` as BlockId;
const h = (s: string, level?: number): Block =>
  ({ id: id(s), kind: "heading", level, tag: "h2", text: s, words: 1, html: s }) as Block;
const p = (s: string): Block => ({ id: id(s), kind: "text", tag: "p", text: s, words: 1, html: s }) as Block;

/*   intro
 *   A (h2)      a1 a2
 *     A.x (h3)  ax1
 *     A.y (h3)               ← nothing under it before B
 *   B (h2)      b1
 *   C (h2)                   ← the last heading, nothing under it */
const blocks: Block[] = [
  p("intro"),
  h("a", 2),
  p("a1"),
  p("a2"),
  h("ax", 3),
  p("ax1"),
  h("ay", 3),
  h("b", 2),
  p("b1"),
  h("c", 2),
];
const set = (...s: string[]) => new Set(s.map(id));

afterEach(() => clearFoldArticle());

describe("hiddenBlocks", () => {
  it("hides a heading's section up to the next heading of its level or coarser", () => {
    expect(hiddenBlocks(blocks, set("a"))).toEqual(set("a1", "a2", "ax", "ax1", "ay"));
  });

  it("stops a subsection at its sibling, and keeps the heading itself visible", () => {
    expect(hiddenBlocks(blocks, set("ax"))).toEqual(set("ax1"));
  });

  it("composes nested folds", () => {
    expect(hiddenBlocks(blocks, set("a", "ax"))).toEqual(hiddenBlocks(blocks, set("a")));
  });

  it("runs the last section to the end of the article", () => {
    expect(hiddenBlocks([p("x"), h("z", 2), p("z1"), p("z2")], set("z"))).toEqual(set("z1", "z2"));
  });

  it("treats a heading with no level as the narrowest", () => {
    const bs = [h("top", 2), h("nolevel"), p("n1"), h("deep", 6), p("d1")];
    expect(hiddenBlocks(bs, set("nolevel"))).toEqual(set("n1"));
  });

  it("ignores an id that is not a heading here", () => {
    expect(hiddenBlocks(blocks, set("a1", "gone"))).toEqual(new Set());
  });
});

describe("foldableHeadings", () => {
  it("is the headings with something under them", () => {
    expect(foldableHeadings(blocks)).toEqual(set("a", "ax", "b"));
  });
});

describe("foldsHiding", () => {
  it("names every folded ancestor of the block, and no sibling", () => {
    expect(foldsHiding(blocks, set("a", "ax", "b"), id("ax1"))).toEqual([id("a"), id("ax")]);
  });
});

describe("the store", () => {
  const style = () => document.head.querySelector(`style[${FOLD_STYLE_ATTR}]`)?.textContent ?? "";

  it("writes the hiding rule synchronously, against the cells and not the row", () => {
    setFoldArticle("slug", blocks);
    toggleFold(id("b"));
    expect(isFolded("spya-b1")).toBe(true);
    expect(style()).toContain('tr[data-block="spya-b1"]>td{display:none}');
    toggleFold(id("b"));
    expect(isFolded("spya-b1")).toBe(false);
    expect(document.head.querySelector(`style[${FOLD_STYLE_ATTR}]`)).toBeNull();
  });

  it("reveals a block by unfolding only the folds hiding it", () => {
    setFoldArticle("slug", blocks);
    toggleFoldAll();
    expect(isFolded("spya-ax1")).toBe(true);
    revealBlock("spya-ax1");
    expect(isFolded("spya-ax1")).toBe(false);
    expect(isFolded("spya-b1")).toBe(true);
    // A's other children are visible now, because A is open; A.x was opened too.
    expect(isFolded("spya-a1")).toBe(false);
  });

  it("toggles all: folds everything, then opens everything", () => {
    setFoldArticle("slug", blocks);
    toggleFoldAll();
    expect(isFolded("spya-a1")).toBe(true);
    expect(isFolded("spya-b1")).toBe(true);
    toggleFoldAll();
    expect(isFolded("spya-a1")).toBe(false);
    expect(isFolded("spya-b1")).toBe(false);
  });

  it("opens everything when anything is folded, rather than folding the rest", () => {
    setFoldArticle("slug", blocks);
    toggleFold(id("b"));
    toggleFoldAll();
    expect(isFolded("spya-b1")).toBe(false);
  });

  it("starts a different article with nothing folded, and keeps folds across a refetch", () => {
    setFoldArticle("slug", blocks);
    toggleFold(id("b"));
    setFoldArticle("slug", [...blocks]);
    expect(isFolded("spya-b1")).toBe(true);
    setFoldArticle("other", blocks);
    expect(isFolded("spya-b1")).toBe(false);
  });

  it("ignores a toggle on a heading with nothing to fold", () => {
    setFoldArticle("slug", blocks);
    toggleFold(id("ay"));
    toggleFold(id("a1"));
    expect(hiddenBlocks(blocks, set())).toEqual(new Set());
    expect(document.head.querySelector(`style[${FOLD_STYLE_ATTR}]`)).toBeNull();
  });
});
