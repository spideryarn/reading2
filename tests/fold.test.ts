// @vitest-environment jsdom
/**
 * **Folding a heading's section** — src/web/fold.ts. Which rows a fold hides,
 * which headings get a button, and the store's reveal, which `scrollToBlock`
 * relies on to have changed the layout before it returns.
 * docs/plans/261002e-collapsible-headings-and-fold-all.md.
 */
import { createElement, StrictMode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { Block, BlockId } from "../src/types.js";
import { FoldToggle } from "../src/web/FoldToggle.js";
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
  useFold,
  useFoldArticle,
} from "../src/web/fold.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

  it("recomputes a kept fold against changed blocks, and drops a heading that is no longer foldable", () => {
    setFoldArticle("slug", blocks);
    toggleFold(id("b"));
    const changed = blocks.map((block) =>
      block.id === id("b1") ? { ...block, id: id("b2") } : block,
    );
    setFoldArticle("slug", changed);
    expect(isFolded("spya-b1")).toBe(false);
    expect(isFolded("spya-b2")).toBe(true);

    setFoldArticle("slug", changed.filter((block) => block.id !== id("b2")));
    expect(document.head.querySelector(`style[${FOLD_STYLE_ATTR}]`)).toBeNull();
  });

  it("ignores a toggle on a heading with nothing to fold", () => {
    setFoldArticle("slug", blocks);
    toggleFold(id("ay"));
    toggleFold(id("a1"));
    expect(hiddenBlocks(blocks, set())).toEqual(new Set());
    expect(document.head.querySelector(`style[${FOLD_STYLE_ATTR}]`)).toBeNull();
  });
});

function FoldHarness({ articleKey, articleBlocks }: { articleKey: string; articleBlocks: Block[] }) {
  useFoldArticle(articleKey, articleBlocks);
  const current = useFold();
  return createElement("output", { "data-foldable": current.foldable.size });
}

describe("the mounted article", () => {
  it("survives StrictMode's effect replay and removes an active fold on unmount", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(FoldHarness, { articleKey: "strict", articleBlocks: blocks }),
        ),
      );
    });
    expect(host.querySelector("output")?.getAttribute("data-foldable")).toBe("3");
    const event = new KeyboardEvent("keydown", {
      code: "KeyT",
      metaKey: true,
      altKey: true,
      cancelable: true,
    });
    act(() => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(isFolded("spya-b1")).toBe(true); // one listener, not StrictMode's setup twice
    expect(document.head.querySelector(`style[${FOLD_STYLE_ATTR}]`)).not.toBeNull();
    act(() => root.unmount());
    expect(document.head.querySelector(`style[${FOLD_STYLE_ATTR}]`)).toBeNull();
    host.remove();
  });

  it("does not let the old keyed article's passive cleanup clear its replacement", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const next = [h("next", 2), p("next1")];
    act(() => {
      root.render(
        createElement(FoldHarness, { key: "old", articleKey: "old", articleBlocks: blocks }),
      );
    });
    act(() => {
      root.render(
        createElement(FoldHarness, { key: "next", articleKey: "next", articleBlocks: next }),
      );
    });
    expect(host.querySelector("output")?.getAttribute("data-foldable")).toBe("1");
    act(() => toggleFold(id("next")));
    expect(isFolded("spya-next1")).toBe(true);
    act(() => root.unmount());
    host.remove();
  });

  it("claims the fold chord only when the reader is not typing, no dialog is open, and folding exists", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(createElement(FoldHarness, { articleKey: "chord", articleBlocks: blocks }));
    });
    const press = (alreadyClaimed = false) => {
      const event = new KeyboardEvent("keydown", {
        code: "KeyT",
        key: "†",
        metaKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      if (alreadyClaimed) event.preventDefault();
      act(() => window.dispatchEvent(event));
      return event.defaultPrevented;
    };

    expect(press()).toBe(true);
    expect(isFolded("spya-b1")).toBe(true);
    act(() => toggleFoldAll());

    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    expect(press()).toBe(false);
    expect(isFolded("spya-b1")).toBe(false);
    input.remove();

    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    expect(press()).toBe(false);
    expect(isFolded("spya-b1")).toBe(false);
    dialog.remove();

    expect(press(true)).toBe(true);
    expect(isFolded("spya-b1")).toBe(false);

    act(() => {
      root.render(
        createElement(FoldHarness, {
          articleKey: "chord",
          articleBlocks: [h("nothing", 2)],
        }),
      );
    });
    expect(press()).toBe(false);
    act(() => root.unmount());
    host.remove();
  });
});

describe("FoldToggle", () => {
  it("keeps its native button props through Tooltip, stops the row click, and Alt-clicks all", () => {
    setFoldArticle("slug", blocks);
    const host = document.createElement("div");
    let rowClicks = 0;
    const root = createRoot(host);
    document.body.append(host);
    act(() => {
      root.render(
        createElement(
          "div",
          { onClick: () => rowClicks++ },
          createElement(FoldToggle, { id: id("b") }),
        ),
      );
    });
    const button = host.querySelector<HTMLButtonElement>("button.fold-toggle")!;
    expect(button.getAttribute("aria-expanded")).toBe("true");

    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(rowClicks).toBe(0);
    expect(isFolded("spya-b1")).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");

    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: true })));
    expect(isFolded("spya-a1")).toBe(true);
    expect(isFolded("spya-b1")).toBe(true);
    expect(rowClicks).toBe(0);
    act(() => root.unmount());
    host.remove();
  });

  it("renders no control for a heading with nothing to hide", () => {
    setFoldArticle("slug", blocks);
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(createElement(FoldToggle, { id: id("c") })));
    expect(host.querySelector("button")).toBeNull();
    act(() => root.unmount());
  });
});
