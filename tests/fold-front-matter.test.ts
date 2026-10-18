// @vitest-environment jsdom
/**
 * **Front and back matter in the fold store: stretches, each shut on arrival
 * behind a stub, and each openable** — src/web/fold.ts § Front and back matter.
 *
 * Greg, spya-ftsqsn, 2026-10-17: *"Mark it up as being less interesting …
 * And default-collapse it"*. The store's third kind of hiding, beside a fold
 * and the masthead's echo, generalised in plan 261018a from the one byline
 * run of 261007d (whose cases this file held, and still holds where they kept
 * their meaning) to a list of stretches with a stub row each.
 * docs/plans/261018a-front-and-back-matter-marked-at-import-and-folded-by-default.md
 * § Stage 3 and its plan review, F5 (two predicates), F6 (`visibleFrom` is not
 * the stub).
 */
import { act, createElement, StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { Block, BlockId } from "../src/types.js";
import {
  FOLD_STYLE_ATTR,
  clearFoldArticle,
  isContentHidden,
  isFoldedAway,
  isRowHidden,
  jumpToRow,
  openStretchesWithin,
  revealBlock,
  setFoldArticle,
  subscribeFold,
  toggleFold,
  toggleFoldAll,
  toggleStretch,
  useFold,
  useFoldArticle,
  visibleFrom,
  visibleNear,
} from "../src/web/fold.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const id = (s: string) => `spya-${s}` as BlockId;
const h = (s: string, level: number): Block =>
  ({ id: id(s), kind: "heading", level, tag: `h${level}`, text: s, words: 1, html: s }) as Block;
const p = (s: string): Block => ({ id: id(s), kind: "text", tag: "p", text: s, words: 1, html: s }) as Block;
const ids = (...s: string[]) => s.map(id);
const set = (...s: string[]) => new Set(ids(...s));

/*   t (h1)        the title: the masthead's echo
 *   lab (h2)      "Authors": a heading, the first stretch's stub
 *   n, aff        the byline
 *   abs (h2)  abs1
 *   a (h2)    a1
 *   refs (h2)     "References": the second stretch's stub
 *   r1, r2        the entries, to the end of the article */
const blocks: Block[] = [
  h("t", 1),
  h("lab", 2),
  p("n"),
  p("aff"),
  h("abs", 2),
  p("abs1"),
  h("a", 2),
  p("a1"),
  h("refs", 2),
  p("r1"),
  p("r2"),
];
const front = ids("lab", "n", "aff");
const back = ids("refs", "r1", "r2");
const both = [front, back];
const echo = set("t");
const style = () => document.head.querySelector(`style[${FOLD_STYLE_ATTR}]`)?.textContent ?? "";
const rule = (s: string) => `tr[data-block="spya-${s}"]>td{display:none}\n`;
const stub = (s: string) => `tr[data-block="spya-${s}"]>td>:not(.matter-stub){display:none}\n`;

/** What a subscribed component is handed, read through the real hook. */
function state(): { shut: string[]; foldable: string[]; folded: string[] } {
  let seen: ReturnType<typeof useFold> | null = null;
  function Probe() {
    seen = useFold();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  act(() => root.unmount());
  const s = seen as unknown as ReturnType<typeof useFold>;
  return { shut: [...s.shut], foldable: [...s.foldable], folded: [...s.folded] };
}

afterEach(() => clearFoldArticle());

describe("a stretch: shut on arrival, behind a stub", () => {
  it("keeps each stub's row and hides its content, and hides every other row of the stretch", () => {
    setFoldArticle("slug", blocks, echo, both);
    for (const s of ["lab", "refs"]) {
      expect(isRowHidden(`spya-${s}`)).toBe(false);
      expect(isContentHidden(`spya-${s}`)).toBe(true);
    }
    for (const s of ["n", "aff", "r1", "r2"]) {
      expect(isRowHidden(`spya-${s}`)).toBe(true);
      expect(isContentHidden(`spya-${s}`)).toBe(true);
    }
    for (const s of ["abs", "abs1", "a", "a1"]) expect(isContentHidden(`spya-${s}`)).toBe(false);
    expect(style()).toBe(
      rule("t") + rule("n") + rule("aff") + rule("r1") + rule("r2") + stub("lab") + stub("refs"),
    );
    expect(state().shut).toEqual(["spya-lab", "spya-refs"]);
  });

  it("is not a fold: none of its rows is folded away", () => {
    setFoldArticle("slug", blocks, echo, both);
    for (const s of [...front, ...back]) expect(isFoldedAway(s)).toBe(false);
  });

  it("the echo is hidden whole, content and row, and has no stub", () => {
    setFoldArticle("slug", blocks, echo, both);
    expect(isRowHidden("spya-t")).toBe(true);
    expect(isContentHidden("spya-t")).toBe(true);
  });

  it("says there is none when there is none", () => {
    setFoldArticle("slug", blocks, echo);
    expect(state().shut).toEqual([]);
    expect(isContentHidden("spya-lab")).toBe(false);
    toggleStretch(id("lab"));
    expect(state().shut).toEqual([]);
  });
});

describe("a stretch: opening and shutting, each on its own", () => {
  it("is opened by its stub, all of it and only it, and shut again by the same control", () => {
    setFoldArticle("slug", blocks, echo, both);
    toggleStretch(id("lab"));
    for (const s of front) {
      expect(isRowHidden(s)).toBe(false);
      expect(isContentHidden(s)).toBe(false);
    }
    expect(isContentHidden("spya-refs")).toBe(true); // the other stretch stays shut
    expect(isRowHidden("spya-r1")).toBe(true);
    expect(isRowHidden("spya-t")).toBe(true); // the echo is not part of it
    expect(state().shut).toEqual(["spya-refs"]);
    expect(style()).toBe(rule("t") + rule("r1") + rule("r2") + stub("refs"));
    toggleStretch(id("lab"));
    expect(isContentHidden("spya-lab")).toBe(true);
    expect(isRowHidden("spya-n")).toBe(true);
    expect(state().shut).toEqual(["spya-lab", "spya-refs"]);
  });

  it("is not toggled by an id that is in a stretch but is not its stub", () => {
    setFoldArticle("slug", blocks, echo, both);
    toggleStretch(id("n"));
    toggleStretch(id("abs"));
    expect(state().shut).toEqual(["spya-lab", "spya-refs"]);
  });

  it("is opened whole by a reveal of any one of its blocks, and the others stay shut", () => {
    setFoldArticle("slug", blocks, echo, both);
    revealBlock("spya-r2");
    for (const s of back) expect(isContentHidden(s)).toBe(false);
    expect(isContentHidden("spya-lab")).toBe(true);
    revealBlock("spya-lab"); // the stub itself
    expect(isRowHidden("spya-n")).toBe(false);
    expect(state().shut).toEqual([]);
  });

  it("is not opened by a reveal of a block outside every stretch, or of the echo", () => {
    setFoldArticle("slug", blocks, echo, both);
    revealBlock("spya-abs1");
    revealBlock("spya-t");
    revealBlock("spya-nowhere");
    expect(state().shut).toEqual(["spya-lab", "spya-refs"]);
  });

  it("tells a subscriber when one opens and when it shuts, and not when an open one is revealed", () => {
    setFoldArticle("slug", blocks, echo, both);
    let told = 0;
    const stop = subscribeFold(() => void told++);
    toggleStretch(id("lab"));
    expect(told).toBe(1);
    revealBlock("spya-n");
    expect(told).toBe(1);
    toggleStretch(id("lab"));
    expect(told).toBe(2);
    stop();
  });
});

/* A renamed article: block 0 is no echo, so its h1 is an ordinary foldable
   heading whose section is the whole article (261007d plan review F5). */
describe("a stretch under a real fold", () => {
  it("is folded away with the rest, stub and all", () => {
    setFoldArticle("slug", blocks, new Set(), both);
    toggleFold(id("t"));
    expect(isRowHidden("spya-lab")).toBe(true);
    expect(isFoldedAway("spya-lab")).toBe(true);
    expect(style()).not.toContain(stub("lab")); // hidden whole, so no stub rule of its own
  });

  it("opens the fold that covers it on a reveal, and no other fold", () => {
    setFoldArticle("slug", blocks, new Set(), [front]);
    toggleFold(id("t"));
    toggleFold(id("a"));
    revealBlock("spya-aff");
    for (const s of ["lab", "n", "aff", "abs", "abs1"]) expect(isRowHidden(`spya-${s}`)).toBe(false);
    expect(isContentHidden("spya-lab")).toBe(false);
    expect(isRowHidden("spya-a1")).toBe(true);
    expect(state()).toMatchObject({ shut: [], folded: ["spya-a"] });
  });

  it("opens the covering fold from a stretch that was already open under it", () => {
    setFoldArticle("slug", blocks, new Set(), [front]);
    toggleStretch(id("lab"));
    toggleFold(id("t"));
    revealBlock("spya-aff");
    expect(isRowHidden("spya-aff")).toBe(false);
    expect(state()).toMatchObject({ shut: [], folded: [] });
  });
});

describe("a stretch: its headings are never foldable", () => {
  it("gives a heading in a stretch no fold, shut or open", () => {
    setFoldArticle("slug", blocks, echo, both);
    expect(state().foldable).toEqual(["spya-abs", "spya-a"]);
    toggleFold(id("lab"));
    expect(state().folded).toEqual([]);
    toggleStretch(id("lab"));
    toggleStretch(id("refs"));
    expect(state().foldable).toEqual(["spya-abs", "spya-a"]);
    toggleFold(id("refs"));
    expect(isRowHidden("spya-r1")).toBe(false);
  });

  it("is not counted, opened or shut by Fold all", () => {
    setFoldArticle("slug", blocks, echo, both);
    toggleStretch(id("lab"));
    toggleFoldAll();
    expect(state().folded).toEqual(["spya-abs", "spya-a"]);
    expect(state().shut).toEqual(["spya-refs"]);
    toggleFoldAll();
    expect(state().shut).toEqual(["spya-refs"]);
  });

  it("makes the heading foldable again when its stretch is gone", () => {
    setFoldArticle("slug", blocks, echo, both);
    setFoldArticle("slug", blocks, echo, [front]);
    expect(state().foldable).toContain("spya-refs");
  });
});

/* 261007d plan review F10, per stretch. */
describe("a stretch: when it is shut again", () => {
  const opened = () => {
    setFoldArticle("slug", blocks, echo, both);
    toggleStretch(id("lab"));
    toggleStretch(id("refs"));
  };

  it("is shut for a different article", () => {
    opened();
    setFoldArticle("other", blocks, echo, both);
    expect(state().shut).toEqual(["spya-lab", "spya-refs"]);
  });

  it("stays as the reader left it across a refetch of the same stretches", () => {
    opened();
    setFoldArticle("slug", [...blocks], echo, [[...front], [...back]]);
    expect(state().shut).toEqual([]);
  });

  it("stays as the reader left it across a rename, which changes only the echo", () => {
    opened();
    setFoldArticle("slug", blocks, new Set(), both);
    expect(isRowHidden("spya-t")).toBe(false);
    expect(state().shut).toEqual([]);
  });

  it("shuts only the stretch that changed, and leaves the other as it was", () => {
    opened();
    setFoldArticle("slug", blocks, echo, [ids("lab", "n"), back]);
    expect(state().shut).toEqual(["spya-lab"]);
    expect(isRowHidden("spya-aff")).toBe(false); // no longer in any stretch
    expect(isRowHidden("spya-r1")).toBe(false);
  });

  it("is shut again when the stretch has grown by a block", () => {
    setFoldArticle("slug", blocks, echo, [ids("lab", "n")]);
    toggleStretch(id("lab"));
    setFoldArticle("slug", blocks, echo, [front]);
    expect(isRowHidden("spya-aff")).toBe(true);
    expect(state().shut).toEqual(["spya-lab"]);
  });

  it("is shut when a stretch that went away comes back", () => {
    opened();
    setFoldArticle("slug", blocks, echo, [back]);
    setFoldArticle("slug", blocks, echo, both);
    expect(state().shut).toEqual(["spya-lab"]);
  });

  it("is forgotten with the article", () => {
    opened();
    clearFoldArticle();
    expect(state().shut).toEqual([]);
    setFoldArticle("slug", blocks, echo, both);
    expect(state().shut).toEqual(["spya-lab", "spya-refs"]);
  });

  it("says nothing to a subscriber when nothing changed", () => {
    opened();
    let told = 0;
    const stop = subscribeFold(() => void told++);
    setFoldArticle("slug", blocks, echo, [[...front], [...back]]);
    expect(told).toBe(0);
    stop();
  });
});

/* Plan review of 261018a, F6: never the stub, which `scrollToBlock` would open. */
describe("visibleFrom: where a block in a shut stretch lands", () => {
  it("is the first block after the stretch, for its stub too", () => {
    setFoldArticle("slug", blocks, echo, both);
    for (const s of front) expect(visibleFrom(s)).toBe("spya-abs");
  });

  it("is the block itself once its stretch is open, and for any block outside one", () => {
    setFoldArticle("slug", blocks, echo, both);
    expect(visibleFrom("spya-abs1")).toBe("spya-abs1");
    expect(visibleFrom("spya-t")).toBe("spya-t"); // the echo goes to the top of the page, scroll.ts
    expect(visibleFrom("spya-nowhere")).toBe("spya-nowhere");
    toggleStretch(id("lab"));
    expect(visibleFrom("spya-lab")).toBe("spya-lab");
    expect(visibleFrom("spya-n")).toBe("spya-n");
  });

  it("walks past stretches back to back, while they are shut", () => {
    const abstract = ids("abs", "abs1");
    setFoldArticle("slug", blocks, echo, [front, abstract, back]);
    expect(visibleFrom("spya-n")).toBe("spya-a");
    toggleStretch(id("abs"));
    expect(visibleFrom("spya-n")).toBe("spya-abs");
  });

  it("has no visible destination after a stretch that ends the article; visibleNear answers the block before", () => {
    setFoldArticle("slug", blocks, echo, both);
    for (const s of back) {
      expect(visibleFrom(s)).toBeNull();
      expect(visibleNear(s)).toBe("spya-a1");
    }
    expect(visibleNear("spya-n")).toBe("spya-abs"); // ahead when there is an ahead
    expect(visibleNear("spya-a1")).toBe("spya-a1");
  });

  it("visibleNear walks back over a shut stretch before a trailing one", () => {
    const tail = ids("a", "a1");
    setFoldArticle("slug", blocks, echo, [front, tail, back]);
    expect(visibleNear("spya-r1")).toBe("spya-abs1");
  });

  it("visibleNear names the visible fold heading, not a hidden block before a trailing stretch", () => {
    setFoldArticle("slug", blocks, echo, both);
    toggleFold(id("a"));
    expect(isRowHidden("spya-a1")).toBe(true);
    expect(visibleNear("spya-r1")).toBe("spya-a");
  });

  it("is the outermost folded heading for a block a fold hides, and the block again once it is open", () => {
    /* sub (h3) under a (h2): both folded, and a1x is under both. */
    const nested = [...blocks.slice(0, 8), h("sub", 3), p("a1x")];
    setFoldArticle("slug", nested, echo, [front]);
    toggleFold(id("sub"));
    expect(visibleFrom("spya-a1x")).toBe("spya-sub");
    toggleFold(id("a"));
    expect(visibleFrom("spya-a1x")).toBe("spya-a");
    expect(visibleFrom("spya-sub")).toBe("spya-a");
    expect(visibleFrom("spya-a")).toBe("spya-a");
    revealBlock("spya-a1x");
    expect(visibleFrom("spya-a1x")).toBe("spya-a1x");
  });
});

/**
 * **A stretch that starts at block 0**: a web article imported since
 * 649dc7828 has no title heading, so the first thing in it is the byline
 * (front-matter.ts § Where it starts). No echo; the first row is the stub.
 */
describe("a stretch at block 0", () => {
  const noTitle: Block[] = [p("n"), p("aff"), h("abs", 2), p("abs1"), h("a", 2), p("a1")];
  const run = ids("n", "aff");

  it("keeps the first row as the stub, not folded away, landing on the first row after", () => {
    setFoldArticle("slug", noTitle, new Set(), [run]);
    expect(style()).toBe(rule("aff") + stub("n"));
    expect(isRowHidden("spya-n")).toBe(false);
    expect(isContentHidden("spya-n")).toBe(true);
    expect(isFoldedAway("spya-n")).toBe(false);
    expect(visibleFrom("spya-n")).toBe("spya-abs");
  });

  it("is left alone by Fold all, shut and open", () => {
    setFoldArticle("slug", noTitle, new Set(), [run]);
    toggleFoldAll();
    expect(state().folded.sort()).toEqual(["spya-a", "spya-abs"]);
    expect(state().shut).toEqual(["spya-n"]);
    toggleStretch(id("n"));
    expect(style()).toBe(rule("abs1") + rule("a1"));
    toggleFoldAll();
    expect(style()).toBe("");
    expect(state().shut).toEqual([]);
  });
});

describe("the stretches and the mounted table", () => {
  function Harness({ slug, list }: { slug: string; list: readonly (readonly BlockId[])[] }) {
    useFoldArticle(slug, blocks, echo, list);
    return null;
  }

  it("is handed over by the table and shut before paint", () => {
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Harness, { slug: "slug", list: both })));
    expect(isRowHidden("spya-n")).toBe(true);
    expect(isContentHidden("spya-lab")).toBe(true);
    act(() => root.unmount());
    expect(isRowHidden("spya-n")).toBe(false);
    expect(style()).toBe("");
  });

  it("follows the stretches when the table hands over different ones", () => {
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Harness, { slug: "slug", list: [ids("lab", "n")] })));
    expect(isRowHidden("spya-aff")).toBe(false);
    act(() => root.render(createElement(Harness, { slug: "slug", list: both })));
    expect(isRowHidden("spya-aff")).toBe(true);
    act(() => root.unmount());
  });

  /* Development only: StrictMode runs the table's cleanup and setup again
     straight after the mount, after a `?at=` restore may already have opened
     a stretch (fold.ts § `reopenFor`). */
  function Opener({ slug }: { slug: string }) {
    useFoldArticle(slug, blocks, echo, both);
    useEffect(() => revealBlock("spya-r1"), []);
    return null;
  }

  it("keeps the stretch opened during the mount across StrictMode's remount, and only that one", () => {
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(StrictMode, null, createElement(Opener, { slug: "slug" }))));
    expect(isRowHidden("spya-r1")).toBe(false);
    expect(state().shut).toEqual(["spya-lab"]);
    act(() => root.unmount());
  });

  it("is shut again for a reader who leaves the article and comes back to it", () => {
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Harness, { key: "first", slug: "slug", list: both })));
    toggleStretch(id("lab"));
    expect(isRowHidden("spya-n")).toBe(false);
    act(() => root.render(null));
    act(() => root.render(createElement(Harness, { key: "again", slug: "slug", list: both })));
    expect(state().shut).toEqual(["spya-lab", "spya-refs"]);
    act(() => root.unmount());
  });

  it("does not let the old keyed article's passive cleanup open its replacement's stretches", () => {
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Harness, { key: "old", slug: "old", list: [] })));
    act(() => root.render(createElement(Harness, { key: "next", slug: "next", list: both })));
    expect(state().shut).toEqual(["spya-lab", "spya-refs"]);
    act(() => root.unmount());
  });
});

/*   lab (h2) n, aff     | three stretches back to back: one list of stubs
 *   abs (h2) abs1       |
 *   ack, fund           |
 *   a (h2) a1             the body
 *   refs (h2) r1, r2      a fourth, on its own
 * Browser pass of 261018a: four stubs spaced like paragraphs pushed the
 * article to mid-screen; consecutive stubs sit as a compact list. */
describe("stubs back to back: a compact list", () => {
  const run: Block[] = [
    h("t", 1),
    h("lab", 2),
    p("n"),
    p("aff"),
    h("abs", 2),
    p("abs1"),
    p("ack"),
    p("fund"),
    h("a", 2),
    p("a1"),
    h("refs", 2),
    p("r1"),
    p("r2"),
  ];
  const four = [ids("lab", "n", "aff"), ids("abs", "abs1"), ids("ack", "fund"), ids("refs", "r1", "r2")];
  const above = (s: string) => `tr[data-block="spya-${s}"]>td{--stub-above:var(--stub-tight)}\n`;
  const below = (s: string) => `tr[data-block="spya-${s}"]>td{--stub-below:var(--stub-tight)}\n`;

  it("draws each stub tight against the shut stub beside it, and the ends of the list with normal space", () => {
    setFoldArticle("slug", run, echo, four);
    const css = style();
    expect(css).toContain(below("lab"));
    expect(css).toContain(above("abs"));
    expect(css).toContain(below("abs"));
    expect(css).toContain(above("ack"));
    expect(css).not.toContain(above("lab"));
    expect(css).not.toContain(below("ack"));
    expect(css).not.toContain(above("refs"));
    expect(css).not.toContain(below("refs"));
  });

  it("is not tight against a stretch that is open, whose first row is prose again", () => {
    setFoldArticle("slug", run, echo, four);
    toggleStretch(id("abs"));
    const css = style();
    expect(css).not.toContain(below("lab"));
    expect(css).not.toContain(above("ack"));
    expect(css).not.toMatch(/spya-abs"\]>td\{--stub/);
  });
});

/* Browser pass of 261018a: Structure's "Title and Abstract" spans two
   stretches, and pressing it opened only the first. */
describe("openStretchesWithin: a Structure row opens everything it names", () => {
  it("opens every stretch that lies wholly within the row's range, by index, and no other", () => {
    setFoldArticle("slug", blocks, echo, both);
    openStretchesWithin(0, 5);
    expect(state().shut).toEqual(["spya-refs"]);
    clearFoldArticle();
    setFoldArticle("slug", blocks, echo, both);
    openStretchesWithin(2, 10); // the front stretch only partly: left shut
    expect(state().shut).toEqual(["spya-lab"]);
    clearFoldArticle();
    setFoldArticle("slug", blocks, echo, both);
    openStretchesWithin(0, 10);
    expect(state().shut).toEqual([]);
  });

  it("is what a row's press does first, before its jump, in both faces", () => {
    setFoldArticle("slug", blocks, echo, both);
    const shutAtJump: string[][] = [];
    jumpToRow({ blockId: id("t"), startRow: 0, endRow: 5 }, (to) => {
      expect(to).toBe(id("t"));
      shutAtJump.push(state().shut);
    });
    expect(shutAtJump).toEqual([["spya-refs"]]);
  });

  it("tells a subscriber once, and not at all when there is nothing to open", () => {
    setFoldArticle("slug", blocks, echo, both);
    let heard = 0;
    const off = subscribeFold(() => heard++);
    openStretchesWithin(0, 10);
    expect(heard).toBe(1);
    openStretchesWithin(0, 10);
    openStretchesWithin(4, 7);
    expect(heard).toBe(1);
    off();
  });
});
