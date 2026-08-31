/**
 * URL state: the parsers that decide what a link means, and the section
 * arithmetic behind `?at=`.
 *
 * Both halves are pure, which is the reason they were split out of the
 * components at all — see docs/project/url-state.md. What is *not* tested here
 * is the scroll listener that drives them, because that needs a real layout;
 * it's covered by hand, per docs/project/browser-testing.md.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Block, Tree } from "../src/types.js";
import { buildGeometry } from "../src/web/tree.js";
import {
  activeSectionIndex,
  buildSections,
  sectionDepth,
} from "../src/web/position.js";
import {
  findParam,
  matchParam,
  MODES,
  diagramAxisParam,
  diagramHueParam,
  diagramParam,
  modeParam,
  orderParam,
  confParam,
  parseAsBit,
  parseAsBlockId,
  parseAsDepths,
  parseAsIdList,
  resolveMatcher,
  resolveRuns,
  runParam,
  spineParam,
  TERM_SORTS,
  sortParam,
  textParam,
} from "../src/web/params.js";

const blocks: Block[] = JSON.parse(
  readFileSync("example/blocks.json", "utf8"),
).blocks;
const tree: Tree = JSON.parse(readFileSync("example/tree.json", "utf8"));

describe("parseAsBlockId", () => {
  it("accepts an id we minted", () => {
    expect(parseAsBlockId.parse("spya-k3m9qt")).toBe("spya-k3m9qt");
  });

  // The point of validating at all: a stale or hand-mangled link should fall
  // back to the top of the article, not scroll to nothing and look broken.
  it.each([
    ["", "empty"],
    ["k3m9qt", "no prefix"],
    ["spya-k3m9q", "too short"],
    ["spya-3m9qtk", "starts with a digit — not a valid CSS selector"],
    ["spya-k3m9ql", "contains l, which the alphabet excludes"],
    ["spya-k3m9qo", "contains o, which the alphabet excludes"],
    ["n0003", "a node id, not a block id"],
    ["spya-k3m9qt; DROP", "trailing junk"],
  ])("rejects %j (%s)", (value) => {
    expect(parseAsBlockId.parse(value)).toBeNull();
  });

  it("round-trips", () => {
    const id = blocks[10]!.id;
    expect(parseAsBlockId.parse(parseAsBlockId.serialize(id))).toBe(id);
  });
});

describe("parseAsBit", () => {
  it("round-trips both ways", () => {
    expect(parseAsBit.parse(parseAsBit.serialize(true))).toBe(true);
    expect(parseAsBit.parse(parseAsBit.serialize(false))).toBe(false);
  });

  // `?text=0` is the spelling the app documented before any of this existed,
  // and links using it are in the docs. It has to keep meaning what it meant.
  it("keeps the documented text=0 spelling", () => {
    expect(parseAsBit.serialize(false)).toBe("0");
    expect(parseAsBit.parse("0")).toBe(false);
  });

  it("rejects anything else, so a junk value falls back to the default", () => {
    for (const v of ["true", "false", "", "2", "yes"]) {
      expect(parseAsBit.parse(v)).toBeNull();
    }
  });
});

/**
 * `?spine=` — the one bit parameter with no default, and the absence is the
 * whole design: see params.ts § spineParam and layout.ts § showSpine.
 */
describe("spineParam", () => {
  it("has no default, unlike text", () => {
    /* `in` rather than reading the property, because absent and
       `undefined` are different things here and only one of them is the
       design. nuqs encodes that in its types — `withDefault` is what adds
       `defaultValue` — so reading `spineParam.defaultValue` did not
       typecheck at all, and the assertion that it was `undefined` would
       have stayed green even if a default had been given. */
    expect("defaultValue" in spineParam).toBe(false);
    expect(textParam.defaultValue).toBe(true);
  });

  it("reads and writes the same 0/1 spelling as text", () => {
    expect(spineParam.parse("0")).toBe(false);
    expect(spineParam.parse("1")).toBe(true);
    expect(spineParam.serialize(false)).toBe("0");
  });

  // A link written by a version that spelled it differently should land on the
  // article with an automatic rail, not on an error.
  it("degrades a junk value to automatic", () => {
    for (const v of ["off", "", "true", "2"]) expect(spineParam.parse(v)).toBeNull();
  });

  // Hiding a whole column of the view is a deliberate act, so Back undoes it —
  // the same call `cols` and `text` make.
  it("pushes history", () => {
    expect(spineParam.history).toBe("push");
  });
});

describe("parseAsDepths", () => {
  it("reads and writes a plain list", () => {
    expect(parseAsDepths.parse("0,1,2")).toEqual([0, 1, 2]);
    expect(parseAsDepths.serialize([0, 1, 2])).toBe("0,1,2");
  });

  it("canonicalises, so the same view is always the same URL", () => {
    expect(parseAsDepths.serialize([2, 0, 1, 2])).toBe("0,1,2");
    expect(parseAsDepths.parse("2,0,1")).toEqual([0, 1, 2]);
  });

  // The empty set is the case that needs a spelling of its own: serialized as
  // "" it would be indistinguishable from the parameter being absent, and
  // absent means "automatic", which is the opposite of "the reader turned
  // every column off".
  it("distinguishes 'no columns' from 'not specified'", () => {
    expect(parseAsDepths.serialize([])).toBe("none");
    expect(parseAsDepths.parse("none")).toEqual([]);
  });

  it("rejects junk rather than half-reading it", () => {
    for (const v of ["", "a", "0,x", "-1", "0,,1"]) {
      expect(parseAsDepths.parse(v)).toBeNull();
    }
  });

  it("compares by value, so re-selecting the same columns is a no-op", () => {
    expect(parseAsDepths.eq([0, 1], [0, 1])).toBe(true);
    expect(parseAsDepths.eq([0, 1], [0, 2])).toBe(false);
    expect(parseAsDepths.eq([0, 1], [0])).toBe(false);
  });
});

describe("activeSectionIndex", () => {
  const tops = [-500, -120, 40, 900];

  it("picks the last section that has passed the line", () => {
    expect(activeSectionIndex(tops, 85)).toBe(2);
  });

  it("clamps above the first section instead of returning -1", () => {
    // There is always a section you are in, even before it reaches the top.
    expect(activeSectionIndex([300, 900], 85)).toBe(0);
  });

  it("stays on the last section past the end of the article", () => {
    expect(activeSectionIndex(tops, 5000)).toBe(3);
  });

  it("survives an empty article", () => {
    expect(activeSectionIndex([], 85)).toBe(0);
  });
});

describe("buildSections", () => {
  const geometry = buildGeometry(tree, blocks);
  const sections = buildSections(geometry, blocks);

  it("uses the deepest level that still has titles, not the leaves", () => {
    expect(sectionDepth(geometry)).toBe(geometry.leafDepth - 1);
  });

  // The whole point of storing a section rather than a position: there are
  // meaningfully fewer of them than there are blocks, so most scrolling writes
  // nothing to the URL at all.
  it("is coarser than one-per-block but finer than the parts", () => {
    expect(sections.length).toBeGreaterThan(1);
    expect(sections.length).toBeLessThan(blocks.length);
  });

  it("starts at the first block and never goes backwards", () => {
    expect(sections[0]!.row).toBe(0);
    for (let i = 1; i < sections.length; i++) {
      expect(sections[i]!.row).toBeGreaterThan(sections[i - 1]!.row);
    }
  });

  it("names each section by a real block id, never a node id", () => {
    // Node ids are handed out sequentially when the tree is generated and are
    // regenerated with it; a URL holding one would silently point elsewhere
    // after the next run. See docs/project/block-ids.md.
    for (const s of sections) {
      expect(blocks[s.row]!.id).toBe(s.blockId);
      expect(parseAsBlockId.parse(s.blockId)).toBe(s.blockId);
    }
  });

  it("covers every block, so there is always a section to be in", () => {
    const last = sections[sections.length - 1]!;
    expect(last.row).toBeLessThan(blocks.length);
  });
});

/**
 * Search mode's four parameters — see docs/project/search.md § The URL.
 *
 * The rule every one of them follows, and the reason they are all here rather
 * than in component state: **a link is the view.** Search mode changes what the
 * article looks like — passages washed, a bar down each matched paragraph — so
 * a URL that did not carry the search would be a URL that shows you a different
 * page from the one that was sent to you.
 *
 * And the rule every parser follows: an unknown value degrades to something
 * that still shows the article, rather than throwing. A link written by a
 * later version with a third matcher in it should land you on the piece.
 */
describe("glossary mode parameters", () => {
  it("defaults ?sort= to prioritised, which is what an absent parameter now means", () => {
    /* Changed 2026-08-26, and it is the kind of change worth a test because
       nothing about it is visible in a URL: the parameter that used to be
       absent because the list was in document order is now absent because it is
       in the prioritised one. Old links say what they want and are unaffected.
       See docs/plans/260826b-glossary-prioritised-order.md. */
    expect(sortParam.defaultValue).toBe("prioritised");
    expect(TERM_SORTS).toContain("prioritised");
  });

  it("still reads every order it has ever had, so old links keep working", () => {
    for (const sort of ["document", "difficulty", "centrality"] as const) {
      expect(sortParam.parse(sort)).toBe(sort);
    }
    // And an order from a later version degrades to the default rather than
    // to an empty list.
    expect(sortParam.parse("frequency")).toBeNull();
  });
});

describe("search mode parameters", () => {
  it("reads the two matchers and refuses anything else", () => {
    expect(matchParam.parse("words")).toBe("words");
    expect(matchParam.parse("meaning")).toBe("meaning");
    expect(matchParam.parse("regex")).toBeNull();
    expect(matchParam.parse("")).toBeNull();
  });

  /**
   * The default, and the one URL shape it must not swallow.
   *
   * Changed from `words` by Greg on 2026-08-26. The old default was defended as
   * "the free one", and that argument was about the wrong thing: nothing in
   * meaning mode spends anything until the reader presses find, so the default
   * was never choosing a price, only choosing which question the panel opens on.
   *
   * Testing `matchParam.defaultValue` is what this used to do and it was not
   * enough: it asserts the constant and says nothing about the URLs already in
   * the world. Every words search written before that date is spelled `?find=…`
   * with no `?match=` — the library's deep-link, and anything anyone pasted into
   * a message or bookmarked — and reading those as meaning searches loses the
   * words they were sent for, silently. Gap found by a GPT Sol review.
   */
  describe("which matcher a URL is asking for", () => {
    it("opens on meaning when the URL says nothing at all", () => {
      expect(resolveMatcher(null, null)).toBe("meaning");
    });

    it("reads a bare ?find= as the words search it was written as", () => {
      expect(resolveMatcher(null, "wet hardware")).toBe("words");
    });

    it("lets an explicit ?match= win over the words it is carrying", () => {
      expect(resolveMatcher("meaning", "wet hardware")).toBe("meaning");
      expect(resolveMatcher("words", null)).toBe("words");
    });

    it("is not fooled by a query of nothing but spaces", () => {
      expect(resolveMatcher(null, "   ")).toBe("meaning");
    });

    it("has no parser default, which is what makes absence visible", () => {
      // `withDefault` here would make `resolveMatcher` unreachable: nuqs would
      // hand it "meaning" for a URL that never said so, and the bare-`?find=`
      // rule above could not fire.
      expect("defaultValue" in matchParam).toBe(false);
    });
  });

  it("takes any string as something to find, because any string might be in the article", () => {
    expect(findParam.parse("wet hardware")).toBe("wet hardware");
    expect(findParam.parse("$5.00 (approx.)")).toBe("$5.00 (approx.)");
  });

  it("reads an empty query as not searching, rather than as searching for nothing", () => {
    // The difference between an unmarked article and one where every gap
    // between characters is a match.
    expect(findParam.parse("")).toBeNull();
    expect(findParam.parse("   ")).toBeNull();
  });

  it("round-trips a query with a space in it", () => {
    const value = "the hard problem";
    expect(findParam.parse(findParam.serialize(value))).toBe(value);
  });

  it("validates a saved-search id as a block id, so a mangled link shows the list", () => {
    expect(runParam.parse("spya-k3m9qt")).toBe("spya-k3m9qt");
    expect(runParam.parse("nonsense")).toBeNull();
    // `l`, `i` and `o` are not in the alphabet — block-ids.md.
    expect(runParam.parse("spya-k3m9ql")).toBeNull();
  });

  it("reads the three orderings and defaults to the article's own", () => {
    expect(orderParam.parse("document")).toBe("document");
    expect(orderParam.parse("confidence")).toBe("confidence");
    expect(orderParam.parse("prioritised")).toBe("prioritised");
    expect(orderParam.parse("relevance")).toBeNull();
    expect(orderParam.defaultValue).toBe("document");
  });

  it("spells prioritised the way the glossary spells it", () => {
    // One idea in the reader's hands, one spelling. Two would be a thing to
    // have to remember, and `?order=prioritized` would parse to null and
    // silently show an unfiltered list.
    expect(orderParam.parse("prioritised")).toBe("prioritised");
    expect(sortParam.parse("prioritised")).toBe("prioritised");
  });

  it("takes the confidence threshold as the 0-100 integer the rows print", () => {
    expect(confParam.parse("50")).toBe(50);
    expect(confParam.parse("0")).toBe(0);
    expect(confParam.parse("100")).toBe(100);
    expect(confParam.serialize(62)).toBe("62");
    // Out of range, or not a number at all, is nobody's choice rather than a
    // clamp — the same rule every other parser here follows.
    for (const bad of ["101", "-1", "", "half", "5px", " 50"]) {
      expect(confParam.parse(bad)).toBeNull();
    }
  });

  it("refuses a 0-1 fraction rather than flooring it to zero", () => {
    /* `?gate=` is a 0-1 fraction and sits beside this in the same URL, so `0.5`
       is exactly the value somebody writes here by mistake. `parseInt` would
       have made it 0 — a threshold that hides nothing, with nothing to see. */
    expect(confParam.parse("0.5")).toBeNull();
    expect(confParam.parse("0.85")).toBeNull();
  });

  it("gives the threshold no default of its own", () => {
    // Absent has to keep meaning *nobody has touched this*, which is what lets
    // the panel hide its reset button until there is something to reset. The
    // starting position lives in search-hits.ts as PRIORITY_CONF.
    /* `in` rather than reading `.defaultValue`: a parser built without
       `.withDefault()` does not have the property *in its type* either, so the
       obvious spelling fails `npm run typecheck` — which is the gate this file
       relies on (see the `Found` fixture note in search-hits.test.ts). */
    expect("defaultValue" in confParam).toBe(false);
  });

  it("keeps its ordering separate from the glossary's", () => {
    // Two modes' orderings have nothing in common but the word. `sort=difficulty`
    // arriving in search mode would be a value with no meaning that something
    // would eventually have to guess at.
    expect(orderParam.parse("difficulty")).toBeNull();
    expect(sortParam.parse("confidence")).toBeNull();
  });

  it("has search in the list of modes, so ?mode=search is a link that works", () => {
    expect(MODES).toContain("search");
    expect(modeParam.parse("search")).toBe("search");
    // And a mode from a later version still shows the article.
    expect(modeParam.parse("summaries")).toBeNull();
    expect(modeParam.defaultValue).toBe("hierarchy");
  });

  /**
   * **The one test standing between every pre-rename link and a broken page.**
   *
   * The mode was called `toc` until 2026-08-29. A first draft of that rename
   * argued the change could not break a link, because `toc` was the default and
   * "the default never appears in a URL" — which was false: `withMode` in
   * src/web/Dock.tsx wrote the parameter unconditionally, default included, so
   * every dock navigation stamped `?mode=toc` into a URL a reader could copy.
   * GPT Sol caught it.
   *
   * What actually keeps those links working is the unknown-value rule: `toc` is
   * now simply unrecognised, and an unrecognised mode falls back to the default
   * — which is `hierarchy`, the very view `toc` named. That is a safety net
   * rather than a plan, and until this test existed it was an argument rather
   * than an observation.
   */
  it("still shows the hierarchy for a link written before the rename", () => {
    expect(MODES).not.toContain("toc");
    expect(modeParam.parse("toc")).toBeNull();
    // null is what `withDefault` turns into the default, so the reader lands on
    // the same view the old link meant rather than on an error.
    expect(modeParam.defaultValue).toBe("hierarchy");
  });
});

/**
 * `?runs=` — which saved searches are switched on, and the legacy `?run=` it
 * replaced. See docs/project/search.md § The URL.
 *
 * The reason this block exists at all is the bug it opens with. Everything here
 * is a pure round-trip, and the failure was a round-trip that did not close:
 * the empty set went out as one string and came back meaning something else.
 * Nothing in the component layer could have caught it, and nothing in the
 * browser looked wrong — the reader unticked a search, it went away, and it was
 * back on the next reload.
 */
describe("runsParam and the legacy run= it replaced", () => {
  it("survives a round trip", () => {
    const ids = ["spya-k3m9qt", "spya-p7x2vb"];
    expect(parseAsIdList.parse(parseAsIdList.serialize(ids))).toEqual(ids);
  });

  it("keeps the empty set distinguishable from an absent one", () => {
    /* **The bug.** An empty list joined with commas is `""`; `""` parses back to
       "no valid ids", which is `null`, which is exactly what an *absent*
       parameter gives you — so `resolveRuns` fell through to the legacy `?run=`
       and switched a search back on that the reader had just switched off. On
       every reload, with no way to make it stop. Found by a GPT Sol review,
       2026-08-26; the fix is a spelling for "deliberately empty", the same
       trick `?cols=` plays with `none`. */
    expect(parseAsIdList.serialize([])).toBe("none");
    expect(parseAsIdList.parse("none")).toEqual([]);
    expect(resolveRuns(parseAsIdList.parse(parseAsIdList.serialize([])), "spya-k3m9qt")).toEqual([]);
  });

  it("drops one bad id rather than the whole list", () => {
    /* The opposite call from `?cols=`, which rejects the whole value. A depth
       list is short and hand-written; a run list is machine-written and
       long-lived, and the id most likely to be wrong in one is a search deleted
       on another machine. Throwing away the other searches over it would be the
       worst available answer. */
    expect(parseAsIdList.parse("spya-k3m9qt,NOT-AN-ID,spya-p7x2vb")).toEqual([
      "spya-k3m9qt",
      "spya-p7x2vb",
    ]);
  });

  it("degrades a wholly mangled value to nothing, not to the empty set", () => {
    /* `null`, not `[]`: a hand-mangled URL has said nothing intelligible, and
       "nothing intelligible" is not the same claim as "none of them". Only
       `none` means the second, which is what lets it beat the legacy fallback. */
    expect(parseAsIdList.parse("garbage")).toBeNull();
    expect(parseAsIdList.parse("")).toBeNull();
  });

  it("drops duplicates, because two ticks of one box is one tick", () => {
    expect(parseAsIdList.parse("spya-k3m9qt,spya-k3m9qt")).toEqual(["spya-k3m9qt"]);
    expect(parseAsIdList.serialize(["spya-k3m9qt", "spya-k3m9qt"])).toBe("spya-k3m9qt");
  });

  it("keeps the order the reader switched them on in", () => {
    /* Unlike `?cols=`, which sorts. Sorting a set of ids would order the
       reader's searches by a random six characters, which is not an order. */
    expect(parseAsIdList.parse("spya-p7x2vb,spya-k3m9qt")).toEqual([
      "spya-p7x2vb",
      "spya-k3m9qt",
    ]);
  });

  it("opens a link written before the plural existed", () => {
    /* `?run=<id>` was the only spelling of a shown search until 2026-08-26, so
       every one pasted into a message or left in a history entry is that shape.
       Same rule, and same reason, as `resolveMatcher` above: absence has to stay
       visible, so there is no `withDefault` and one function decides. */
    expect(resolveRuns(null, "spya-k3m9qt")).toEqual(["spya-k3m9qt"]);
    expect(runParam.parse("spya-k3m9qt")).toBe("spya-k3m9qt");
  });

  it("lets the plural win when a URL carries both", () => {
    expect(resolveRuns(["spya-p7x2vb"], "spya-k3m9qt")).toEqual(["spya-p7x2vb"]);
  });

  it("defaults to nothing switched on", () => {
    /* Greg's ask: the boxes start unticked. Landing on an article in search mode
       paints nothing until the reader says so — the rule the glossary and the
       summaries both already follow. */
    expect(resolveRuns(null, null)).toEqual([]);
  });
});

/**
 * The three parameters diagram mode owns.
 *
 * They are here rather than left to the parser factory because the rule they
 * follow is a *design* rule, not a parsing one: **an unknown value degrades to
 * something real.** A link from a future version of this app, or one somebody
 * has typed by hand, must open a picture rather than an error — the same call
 * every other parser in params.ts makes, and worth pinning for the two newest.
 */
describe("the diagram parameters", () => {
  it("takes any of the three pictures and falls back to the one that draws first", () => {
    expect(diagramParam.parse("force")).toBe("force");
    expect(diagramParam.parse("drift")).toBe("drift");
    expect(diagramParam.parse("trail")).toBe("trail");
    // A picture from a version this build has never heard of.
    expect(diagramParam.parse("hyperbolic")).toBeNull();
    /* **And ones this build used to have.** Strata, Mindmap, Arc and Cluster
       were cut on 2026-08-27 and Tree on 2026-08-30, and a `?diagram=strata` or
       `?diagram=tree` in somebody's bookmark has to open a real picture rather
       than a broken page — the same rule as the line above, and the one that
       has an actual link behind it. `tree` is the one to watch: it was the
       default for three days, so it is in the most bookmarks. */
    expect(diagramParam.parse("strata")).toBeNull();
    expect(diagramParam.parse("mindmap")).toBeNull();
    expect(diagramParam.parse("tree")).toBeNull();
    /* `force` because it is the only one that draws anything before a model has
       answered: four of its five kinds of line are arithmetic over prose the
       browser already holds. The other two would open on a spinner. */
    expect(diagramParam.defaultValue).toBe("force");
  });

  it("defaults sideways to lanes, and refuses anything it cannot draw", () => {
    expect(diagramAxisParam.parse("lanes")).toBe("lanes");
    expect(diagramAxisParam.parse("spread")).toBe("spread");
    expect(diagramAxisParam.parse("umap")).toBeNull();
    expect(diagramAxisParam.parse("")).toBeNull();
    expect(diagramAxisParam.defaultValue).toBe("lanes");
  });

  it("defaults colour to the section hues the other pictures use", () => {
    /* `section` rather than `progress`, so that a reader who has learnt what
       green means on the other two pictures does not have to learn a second
       thing on these two. Trail is the picture that wants `progress`, and
       asking for it is one press. */
    expect(diagramHueParam.parse("section")).toBe("section");
    expect(diagramHueParam.parse("progress")).toBe("progress");
    expect(diagramHueParam.parse("topic")).toBe("topic");
    expect(diagramHueParam.parse("jet")).toBeNull();
    expect(diagramHueParam.defaultValue).toBe("section");
  });

  it("pushes a different picture and replaces a different way of looking at one", () => {
    /* The split this whole file is about. `?diagram=` is a different picture and
       Back should undo it; `?dx=` and `?dhue=` are ways of looking at one, and a
       reader flicking between them to compare should not have to press Back
       eight times to leave the panel. */
    expect(diagramParam.history).toBe("push");
    expect(diagramAxisParam.history).toBe("replace");
    expect(diagramHueParam.history).toBe("replace");
  });
});
