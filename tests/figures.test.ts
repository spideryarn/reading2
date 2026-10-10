/**
 * Which blocks are figures, tables and media — src/figures.ts, the stops of
 * Skim's Figures walk and the marks on Structure's rows (spya-sb0c7e,
 * docs/plans/261011b-skim-figures-walk-and-structure-figure-marks.md).
 *
 * Half against hand-built blocks for each rule, half against blocks stage 3
 * really wrote (the fixtures), so a rule that reads a shape stage 3 does not
 * produce shows up here.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { figureKindOf, figureName, figuresInRange, figuresOf } from "../src/figures.js";
import type { Block, BlockId, BlockKind } from "../src/types.js";

let n = 0;
function block(tag: string, kind: BlockKind, html: string, text = ""): Block {
  n += 1;
  return {
    id: `spya-t${String(n).padStart(5, "0")}` as BlockId,
    tag,
    kind,
    text,
    words: text.split(/\s+/).filter(Boolean).length,
    html,
    gistable: kind === "text",
  };
}

const readBlocks = (path: string): Block[] => {
  const json = JSON.parse(readFileSync(path, "utf8")) as Block[] | { blocks: Block[] };
  return Array.isArray(json) ? json : json.blocks;
};

describe("figureKindOf", () => {
  it("a table is a table, though stage 3 calls it `other`", () => {
    expect(figureKindOf(block("table", "other", "<table><tr><td>a</td></tr></table>", "a"))).toBe("table");
  });
  it("a figure wrapping a table is a table (a PDF's tables are)", () => {
    expect(
      figureKindOf(block("figure", "media", "<figure><figcaption>Table 1.</figcaption><table></table></figure>")),
    ).toBe("table");
  });
  it("an image, a bare img, an image-only paragraph and an svg are figures", () => {
    expect(figureKindOf(block("figure", "media", '<figure><img src="a.png"></figure>'))).toBe("figure");
    expect(figureKindOf(block("img", "media", '<img src="a.png">'))).toBe("figure");
    expect(figureKindOf(block("p", "media", '<p><img src="a.png"></p>'))).toBe("figure");
    expect(figureKindOf(block("figure", "media", "<figure><svg></svg></figure>"))).toBe("figure");
  });
  it("a PDF figure is a figure before its image arrives", () => {
    expect(
      figureKindOf(block("figure", "media", '<figure data-spya-pdf-figure="r:1:1"><figcaption>Fig. 1</figcaption></figure>')),
    ).toBe("figure");
  });
  it("a video embed is media", () => {
    expect(figureKindOf(block("iframe", "media", '<iframe src="https://www.youtube.com/embed/x"></iframe>'))).toBe(
      "media",
    );
  });
  it("a rule, a pull-quote's figure and a paragraph are not", () => {
    expect(figureKindOf(block("hr", "media", "<hr>"))).toBeNull();
    expect(figureKindOf(block("figure", "media", "<figure><blockquote><p>Said.</p></blockquote></figure>"))).toBeNull();
    expect(figureKindOf(block("p", "text", "<p>Words.</p>", "Words."))).toBeNull();
  });
  it("a title set as a short image is lettering, not a figure; an image with no height is kept", () => {
    expect(figureKindOf(block("img", "media", '<img src="t.gif" width="190" height="18">'))).toBeNull();
    expect(figureKindOf(block("img", "media", '<img src="t.gif" width="190" height="300">'))).toBe("figure");
  });
});

describe("figuresOf", () => {
  it("takes a figcaption, else the caption paragraph after, else the one before", () => {
    const blocks = [
      block("figure", "media", "<figure><img src=a><figcaption>Own &amp; <em>only</em></figcaption></figure>"),
      block("p", "media", "<p><img src=b></p>"),
      block("p", "caption", "<p>Figure 2: after.</p>", "Figure 2: after."),
      block("p", "caption", "<p>Table 1. before.</p>", "Table 1. before."),
      block("table", "other", "<table></table>"),
      block("table", "other", "<table></table>"),
    ];
    const got = figuresOf(blocks);
    expect(got.map((f) => [f.kind, f.caption, f.ordinal, f.row])).toEqual([
      ["figure", "Own & only", 1, 0],
      ["figure", "Figure 2: after.", 2, 1],
      ["table", "Table 1. before.", 1, 4],
      ["table", null, 2, 5],
    ]);
    expect(figureName(got[3]!)).toBe("Table 2");
  });

  it("does not hand one caption to two figures", () => {
    const blocks = [
      block("p", "media", "<p><img src=a></p>"),
      block("p", "caption", "<p>Figure 1: one.</p>", "Figure 1: one."),
      block("p", "media", "<p><img src=b></p>"),
    ];
    expect(figuresOf(blocks).map((f) => f.caption)).toEqual(["Figure 1: one.", null]);
  });

  it("finds the five figures and the video in a real article, and none of its pull-quotes or its rule", () => {
    const got = figuresOf(readBlocks("tests/fixtures/data-root/data/noema-mythology-of-conscious-ai/blocks.json"));
    expect(got.map((f) => f.kind)).toEqual(["media", "figure", "figure", "figure", "figure", "figure"]);
    expect(got.filter((f) => f.kind === "figure").map((f) => f.caption?.slice(0, 9))).toEqual([
      "Figure 1:",
      "Figure 2:",
      "Figure 3:",
      "Figure 4:",
      "Figure 5:",
    ]);
  });

  it("finds no figure in an essay whose only image is its title", () => {
    expect(figuresOf(readBlocks("tests/fixtures/data-root/data/writes/blocks.json"))).toEqual([]);
  });
});

describe("figuresInRange", () => {
  it("counts by row, inclusive at both ends", () => {
    const blocks = [
      block("p", "text", "<p>a</p>", "a"),
      block("table", "other", "<table></table>"),
      block("p", "media", "<p><img src=a></p>"),
      block("p", "media", "<p><img src=b></p>"),
    ];
    const figures = figuresOf(blocks);
    expect(figuresInRange(figures, 0, 0)).toEqual({ figure: 0, table: 0, media: 0 });
    expect(figuresInRange(figures, 1, 3)).toEqual({ figure: 2, table: 1, media: 0 });
    expect(figuresInRange(figures, 3, 3)).toEqual({ figure: 1, table: 0, media: 0 });
  });
});
