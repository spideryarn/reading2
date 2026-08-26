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
  modeParam,
  orderParam,
  parseAsBit,
  parseAsBlockId,
  parseAsDepths,
  resolveMatcher,
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
    expect(spineParam.defaultValue).toBeUndefined();
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
       See docs/plans/glossary-prioritised-order.md. */
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

  it("reads the two orderings and defaults to the article's own", () => {
    expect(orderParam.parse("document")).toBe("document");
    expect(orderParam.parse("confidence")).toBe("confidence");
    expect(orderParam.parse("relevance")).toBeNull();
    expect(orderParam.defaultValue).toBe("document");
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
    expect(modeParam.defaultValue).toBe("toc");
  });
});
