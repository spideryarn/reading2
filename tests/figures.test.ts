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
  it("a LaTeXML equation and a layout table are not tables", () => {
    expect(
      figureKindOf(block("table", "other", '<table class="ltx_equation ltx_eqn_table" id="S1.E1"><tr><td>x</td></tr></table>')),
    ).toBeNull();
    expect(figureKindOf(block("table", "other", '<table role="presentation"><tr><td>x</td></tr></table>'))).toBeNull();
  });
  it("a pull-quote with a portrait in its figure is not a figure", () => {
    expect(
      figureKindOf(block("figure", "media", '<figure><img src="face.jpg"><blockquote><p>Said.</p></blockquote></figure>')),
    ).toBeNull();
  });
  it("a standalone svg, canvas, video or audio with text of its own is still found", () => {
    expect(figureKindOf(block("svg", "text", "<svg><title>A chart</title></svg>", "A chart"))).toBe("figure");
    expect(figureKindOf(block("canvas", "text", "<canvas>Fallback</canvas>", "Fallback"))).toBe("figure");
    expect(figureKindOf(block("video", "text", "<video>Your browser…</video>", "Your browser…"))).toBe("media");
    expect(figureKindOf(block("audio", "text", "<audio>Listen</audio>", "Listen"))).toBe("media");
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

  it("counts a table drawn as a picture as a table, by its caption (spya-s8pf4r)", () => {
    const blocks = [
      block("figure", "media", "<figure><img src=a><figcaption>Table 1. Absolute values</figcaption></figure>"),
      block("figure", "media", '<figure data-spya-pdf-figure="r:3:1"><figcaption>Table 4: Hyperparameters</figcaption></figure>'),
      block("p", "media", "<p><img src=c></p>"),
      block("p", "caption", "<p>Supplementary Table S2. Doses.</p>", "Supplementary Table S2. Doses."),
      block("figure", "media", "<figure><img src=f><figcaption>TABLE IV. Results</figcaption></figure>"),
      block("figure", "media", "<figure><img src=g><figcaption>Extended Data Table 2 | Cohort</figcaption></figure>"),
      block("figure", "media", "<figure><img src=d><figcaption>Figure 1. A table of results is shown</figcaption></figure>"),
      block("figure", "media", "<figure><img src=e><figcaption>Tables and chairs at the venue</figcaption></figure>"),
    ];
    expect(figuresOf(blocks).map((f) => [f.kind, f.ordinal])).toEqual([
      ["table", 1],
      ["table", 2],
      ["table", 3],
      ["table", 4],
      ["table", 5],
      ["figure", 1],
      ["figure", 2],
    ]);
  });

  it("leaves a table's caption above it to the table, not to a picture before it (Sol, 261015b)", () => {
    const blocks = [
      block("p", "media", "<p><img src=a></p>"),
      block("p", "caption", "<p>Table 1. Doses.</p>", "Table 1. Doses."),
      block("table", "other", "<table><tr><td>1</td></tr></table>"),
    ];
    expect(figuresOf(blocks).map((f) => [f.kind, f.caption])).toEqual([
      ["figure", null],
      ["table", "Table 1. Doses."],
    ]);
  });

  it("does not reserve an image's table caption when the following table takes its own caption", () => {
    const blocks = [
      block("p", "media", "<p><img src=a></p>"),
      block("p", "caption", "<p>Table 1. Picture.</p>", "Table 1. Picture."),
      block("table", "other", "<table><tr><td>2</td></tr></table>"),
      block("p", "caption", "<p>Table 2. Native.</p>", "Table 2. Native."),
      block("table", "other", "<table><caption>Table 3. Own.</caption><tr><td>3</td></tr></table>"),
      block("p", "media", "<p><img src=b></p>"),
      block("p", "caption", "<p>Table 4. Picture.</p>", "Table 4. Picture."),
      block(
        "figure",
        "media",
        "<figure><figcaption>Table 5. Own.</figcaption><table><tr><td>5</td></tr></table></figure>",
      ),
    ];
    expect(figuresOf(blocks).map((f) => [f.kind, f.caption, f.ordinal])).toEqual([
      ["table", "Table 1. Picture.", 1],
      ["table", "Table 2. Native.", 2],
      ["table", "Table 3. Own.", 3],
      ["table", "Table 4. Picture.", 4],
      ["table", "Table 5. Own.", 5],
    ]);
  });

  it("reserves each caption through a run of native tables without claiming one twice", () => {
    const blocks = [
      block("p", "media", "<p><img src=a></p>"),
      block("p", "caption", "<p>Table 1. First native.</p>", "Table 1. First native."),
      block("table", "other", "<table><tr><td>1</td></tr></table>"),
      block("p", "caption", "<p>Table 2. Second native.</p>", "Table 2. Second native."),
      block("table", "other", "<table><tr><td>2</td></tr></table>"),
    ];
    expect(figuresOf(blocks).map((f) => [f.kind, f.caption, f.ordinal])).toEqual([
      ["figure", null, 1],
      ["table", "Table 1. First native.", 1],
      ["table", "Table 2. Second native.", 2],
    ]);
  });

  it("recognises the complete Roman numeral alphabet in picture-table captions", () => {
    const blocks = [
      block("figure", "media", "<figure><img src=c><figcaption>Table C. Results.</figcaption></figure>"),
      block("figure", "media", "<figure><img src=d><figcaption>Table D. Results.</figcaption></figure>"),
      block("figure", "media", "<figure><img src=m><figcaption>Table M. Results.</figcaption></figure>"),
    ];
    expect(figuresOf(blocks).map((f) => [f.kind, f.ordinal])).toEqual([
      ["table", 1],
      ["table", 2],
      ["table", 3],
    ]);
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
