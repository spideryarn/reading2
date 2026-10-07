// @vitest-environment jsdom
/**
 * **The front matter in the fold store: shut on arrival, and openable** —
 * src/web/fold.ts § The front matter.
 *
 * Greg, spya-duh4w3, 2026-10-06: *"default collapse them so that you kind of
 * jump straight into the article itself when you first open it."* The run of
 * byline blocks (front-matter.ts) is the store's third kind of hiding, beside
 * a fold and the masthead's echo.
 * docs/plans/261007d-front-matter-folded-by-default-and-arxiv-html-authors.md
 * § How the rows are hidden; each case is a bullet of it, or F5 / F10 of its
 * plan review.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { Block, BlockId } from "../src/types.js";
import {
  FOLD_STYLE_ATTR,
  clearFoldArticle,
  isFolded,
  isFoldedAway,
  revealBlock,
  setFoldArticle,
  subscribeFold,
  toggleFold,
  toggleFoldAll,
  toggleFrontMatter,
  useFold,
  useFoldArticle,
  visibleFrom,
} from "../src/web/fold.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const id = (s: string) => `spya-${s}` as BlockId;
const h = (s: string, level: number): Block =>
  ({ id: id(s), kind: "heading", level, tag: `h${level}`, text: s, words: 1, html: s }) as Block;
const p = (s: string): Block => ({ id: id(s), kind: "text", tag: "p", text: s, words: 1, html: s }) as Block;
const ids = (...s: string[]) => s.map(id);
const set = (...s: string[]) => new Set(ids(...s));

/*   t (h1)        the title
 *   lab (h2)      "Authors": a heading inside the run
 *   n, aff        the byline
 *   abs (h2)  abs1
 *   a (h2)    a1 */
const blocks: Block[] = [h("t", 1), h("lab", 2), p("n"), p("aff"), h("abs", 2), p("abs1"), h("a", 2), p("a1")];
const front = ids("lab", "n", "aff");
const echo = set("t");
const style = () => document.head.querySelector(`style[${FOLD_STYLE_ATTR}]`)?.textContent ?? "";
const rule = (s: string) => `tr[data-block="spya-${s}"]>td{display:none}\n`;

/** What a subscribed component is handed, read through the real hook. */
function state(): { front: number; frontOpen: boolean; foldable: string[]; folded: string[] } {
  let seen: ReturnType<typeof useFold> | null = null;
  function Probe() {
    seen = useFold();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  act(() => root.unmount());
  const s = seen as unknown as ReturnType<typeof useFold>;
  return { front: s.front, frontOpen: s.frontOpen, foldable: [...s.foldable], folded: [...s.folded] };
}

afterEach(() => clearFoldArticle());

describe("the front matter: shut on arrival", () => {
  it("hides the run's rows from the start, after the echo and in document order", () => {
    setFoldArticle("slug", blocks, echo, front);
    for (const s of ["t", "lab", "n", "aff"]) expect(isFolded(`spya-${s}`)).toBe(true);
    expect(isFolded("spya-abs")).toBe(false);
    expect(style()).toBe(rule("t") + rule("lab") + rule("n") + rule("aff"));
    expect(state()).toMatchObject({ front: 3, frontOpen: false });
  });

  it("is not a fold: its rows are not folded away", () => {
    setFoldArticle("slug", blocks, echo, front);
    for (const s of ["lab", "n", "aff"]) expect(isFoldedAway(`spya-${s}`)).toBe(false);
  });

  it("says there is none when there is none", () => {
    setFoldArticle("slug", blocks, echo);
    expect(state()).toMatchObject({ front: 0, frontOpen: false });
    expect(isFolded("spya-n")).toBe(false);
    toggleFrontMatter();
    expect(state()).toMatchObject({ front: 0, frontOpen: false });
  });
});

describe("the front matter: opening and shutting", () => {
  it("is opened by its control, all of it, and shut by the same control", () => {
    setFoldArticle("slug", blocks, echo, front);
    toggleFrontMatter();
    for (const s of ["lab", "n", "aff"]) expect(isFolded(`spya-${s}`)).toBe(false);
    expect(isFolded("spya-t")).toBe(true); // the echo is not part of it
    expect(style()).toBe(rule("t"));
    expect(state()).toMatchObject({ front: 3, frontOpen: true });
    toggleFrontMatter();
    for (const s of ["lab", "n", "aff"]) expect(isFolded(`spya-${s}`)).toBe(true);
    expect(state().frontOpen).toBe(false);
  });

  it("is opened whole by a reveal of any one of its blocks", () => {
    setFoldArticle("slug", blocks, echo, front);
    revealBlock("spya-n");
    for (const s of ["lab", "n", "aff"]) expect(isFolded(`spya-${s}`)).toBe(false);
    expect(state().frontOpen).toBe(true);
  });

  it("is not opened by a reveal of a block outside it, or of the echo", () => {
    setFoldArticle("slug", blocks, echo, front);
    revealBlock("spya-abs1");
    revealBlock("spya-t");
    revealBlock("spya-nowhere");
    expect(isFolded("spya-n")).toBe(true);
    expect(state().frontOpen).toBe(false);
  });

  it("tells a subscriber when it opens and when it shuts", () => {
    setFoldArticle("slug", blocks, echo, front);
    let told = 0;
    const stop = subscribeFold(() => void told++);
    toggleFrontMatter();
    expect(told).toBe(1);
    toggleFrontMatter();
    expect(told).toBe(2);
    stop();
  });
});

/* A renamed article: block 0 is no echo, so its h1 is an ordinary foldable
   heading whose section is the whole article (plan review F5). */
describe("the front matter under a real fold", () => {
  it("is folded away with the rest, and the control then says shut", () => {
    setFoldArticle("slug", blocks, new Set(), front);
    toggleFrontMatter();
    toggleFold(id("t"));
    expect(isFoldedAway("spya-n")).toBe(true);
    expect(state().frontOpen).toBe(false);
  });

  it("opens the fold that covers it when the control opens it, and no other fold", () => {
    setFoldArticle("slug", blocks, new Set(), front);
    toggleFold(id("t"));
    toggleFold(id("a"));
    toggleFrontMatter();
    for (const s of ["lab", "n", "aff", "abs", "abs1"]) expect(isFolded(`spya-${s}`)).toBe(false);
    expect(isFolded("spya-a1")).toBe(true);
    expect(state()).toMatchObject({ frontOpen: true, folded: ["spya-a"] });
  });

  it("opens the covering fold from a run that was already open under it", () => {
    setFoldArticle("slug", blocks, new Set(), front);
    toggleFrontMatter();
    toggleFold(id("t"));
    toggleFrontMatter(); // one press shows it; it does not shut what cannot be seen
    expect(isFolded("spya-n")).toBe(false);
    expect(state()).toMatchObject({ frontOpen: true, folded: [] });
  });

  it("opens the covering fold on a reveal too, shut or open", () => {
    setFoldArticle("slug", blocks, new Set(), front);
    toggleFold(id("t"));
    revealBlock("spya-aff");
    expect(isFolded("spya-aff")).toBe(false);
    expect(isFolded("spya-lab")).toBe(false);
    toggleFold(id("t"));
    revealBlock("spya-aff"); // open already, and under the fold again
    expect(isFolded("spya-aff")).toBe(false);
    expect(state().frontOpen).toBe(true);
  });
});

describe("the front matter: its headings are never foldable", () => {
  it("gives a run heading no fold, shut or open", () => {
    setFoldArticle("slug", blocks, echo, front);
    expect(state().foldable).toEqual(["spya-abs", "spya-a"]);
    toggleFold(id("lab"));
    expect(state().folded).toEqual([]);
    toggleFrontMatter();
    expect(state().foldable).toEqual(["spya-abs", "spya-a"]);
    toggleFold(id("lab"));
    expect(isFolded("spya-n")).toBe(false);
  });

  it("is not counted or shut by Fold all", () => {
    setFoldArticle("slug", blocks, echo, front);
    toggleFrontMatter();
    toggleFoldAll();
    expect(state().folded).toEqual(["spya-abs", "spya-a"]);
    for (const s of ["lab", "n", "aff"]) expect(isFolded(`spya-${s}`)).toBe(false);
  });

  it("makes the heading foldable again when the run is gone", () => {
    setFoldArticle("slug", blocks, echo, front);
    setFoldArticle("slug", blocks, echo);
    expect(state().foldable).toContain("spya-lab");
  });
});

/* Plan review F10. */
describe("the front matter: when it is shut again", () => {
  const opened = () => {
    setFoldArticle("slug", blocks, echo, front);
    toggleFrontMatter();
  };

  it("is shut for a different article", () => {
    opened();
    setFoldArticle("other", blocks, echo, front);
    expect(isFolded("spya-n")).toBe(true);
    expect(state().frontOpen).toBe(false);
  });

  it("stays as the reader left it across a refetch of the same run", () => {
    opened();
    setFoldArticle("slug", [...blocks], echo, [...front]);
    expect(isFolded("spya-n")).toBe(false);
    expect(state().frontOpen).toBe(true);
  });

  it("stays as the reader left it across a rename, which changes only the echo", () => {
    opened();
    setFoldArticle("slug", blocks, new Set(), front);
    expect(isFolded("spya-n")).toBe(false);
    expect(isFolded("spya-t")).toBe(false);
    expect(state().frontOpen).toBe(true);
  });

  it("is shut again when the run is a different run", () => {
    opened();
    setFoldArticle("slug", blocks, echo, ids("lab", "n"));
    expect(isFolded("spya-n")).toBe(true);
    expect(isFolded("spya-aff")).toBe(false);
    expect(state()).toMatchObject({ front: 2, frontOpen: false });
  });

  it("is shut again when the run has grown by a block", () => {
    setFoldArticle("slug", blocks, echo, ids("lab", "n"));
    toggleFrontMatter();
    setFoldArticle("slug", blocks, echo, front);
    expect(isFolded("spya-aff")).toBe(true);
    expect(state().frontOpen).toBe(false);
  });

  it("is shut again when the same blocks come back in another order", () => {
    opened();
    setFoldArticle("slug", blocks, echo, ids("n", "lab", "aff"));
    expect(state().frontOpen).toBe(false);
  });

  it("is shut when a run that went away comes back", () => {
    opened();
    setFoldArticle("slug", blocks, echo);
    setFoldArticle("slug", blocks, echo, front);
    expect(isFolded("spya-n")).toBe(true);
  });

  it("is forgotten with the article", () => {
    opened();
    clearFoldArticle();
    expect(state()).toMatchObject({ front: 0, frontOpen: false });
    setFoldArticle("slug", blocks, echo, front);
    expect(isFolded("spya-n")).toBe(true);
  });

  it("says nothing to a subscriber when nothing changed", () => {
    opened();
    let told = 0;
    const stop = subscribeFold(() => void told++);
    setFoldArticle("slug", blocks, echo, [...front]);
    expect(told).toBe(0);
    stop();
  });
});

describe("visibleFrom: where a block in the shut run lands", () => {
  it("is the first block after the run while it is shut", () => {
    setFoldArticle("slug", blocks, echo, front);
    for (const s of ["lab", "n", "aff"]) expect(visibleFrom(`spya-${s}`)).toBe("spya-abs");
  });

  it("is the block itself once the run is open, and for any block outside it", () => {
    setFoldArticle("slug", blocks, echo, front);
    expect(visibleFrom("spya-abs1")).toBe("spya-abs1");
    expect(visibleFrom("spya-t")).toBe("spya-t"); // the echo goes to the top of the page, scroll.ts
    expect(visibleFrom("spya-nowhere")).toBe("spya-nowhere");
    toggleFrontMatter();
    expect(visibleFrom("spya-n")).toBe("spya-n");
  });

  it("is the block itself when the run is the end of the article", () => {
    const short = blocks.slice(0, 4);
    setFoldArticle("slug", short, echo, front);
    expect(visibleFrom("spya-n")).toBe("spya-n");
  });
});

describe("the front matter and the mounted table", () => {
  function Harness({ slug, run }: { slug: string; run: readonly BlockId[] }) {
    useFoldArticle(slug, blocks, echo, run);
    return null;
  }

  it("is handed over by the table and shut before paint", () => {
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Harness, { slug: "slug", run: front })));
    expect(isFolded("spya-n")).toBe(true);
    act(() => root.unmount());
    expect(isFolded("spya-n")).toBe(false);
  });

  it("follows the run when the table hands over a different one", () => {
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Harness, { slug: "slug", run: ids("lab", "n") })));
    expect(isFolded("spya-aff")).toBe(false);
    act(() => root.render(createElement(Harness, { slug: "slug", run: front })));
    expect(isFolded("spya-aff")).toBe(true);
    act(() => root.unmount());
  });

  it("does not let the old keyed article's passive cleanup open its replacement's run", () => {
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Harness, { key: "old", slug: "old", run: [] })));
    act(() => root.render(createElement(Harness, { key: "next", slug: "next", run: front })));
    expect(isFolded("spya-n")).toBe(true);
    expect(state().front).toBe(3);
    act(() => root.unmount());
  });
});
