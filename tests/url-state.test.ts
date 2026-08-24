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
import { parseAsBit, parseAsBlockId, parseAsDepths } from "../src/web/params.js";

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
