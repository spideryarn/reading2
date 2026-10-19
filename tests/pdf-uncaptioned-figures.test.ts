/**
 * A PDF figure with no printed caption, from the transcript to the marker the
 * `assets` step reads — the path report spya-x9gn3d fell through, where 27 of
 * the 33 figures in Rovelli's *The Order of Time* vanished without a word.
 * docs/plans/261019e-uncaptioned-pdf-figures-are-kept.md.
 */
import { describe, expect, it } from "vitest";
import type { PdfRecord } from "../src/pdf.js";
import { renderHtml } from "../src/pdf-read.js";
import { splitIntoBlocks } from "../src/blocks.js";
import { pdfFigureCaptionsIn, pdfFigureMarkersIn } from "../src/collect-assets.js";
import { parsePdfFigureMarker } from "../src/assets.js";
import { RESERVED_ATTRS } from "../src/reserved.js";

const RAW_SHA = "a".repeat(64);

const record = (over: Partial<PdfRecord> = {}): PdfRecord => ({
  page: 32,
  type: "paragraph",
  text: "Some words.",
  continues: false,
  uncertain: false,
  ...over,
});

const BEFORE = record({ text: "Every human being has their own past cone of ancestors. Those of Leonidas are shown below, alongside Gorgo's:" });
const FIGURE = record({ type: "figure", text: "" });
const AFTER = record({ text: "The temporal structure of the universe is very similar to this one." });

const figureBlocks = (records: PdfRecord[], previous?: ReturnType<typeof splitIntoBlocks>["blocks"]) => {
  const { blocks } = splitIntoBlocks(renderHtml(records, "T", RAW_SHA), previous);
  return { blocks, figures: blocks.filter((b) => b.html.includes(RESERVED_ATTRS.pdfFigure)) };
};

const markersIn = (html: string): string[] =>
  [...html.matchAll(/data-spya-pdf-figure="([^"]+)"/g)].map((match) => match[1]!);

describe("an uncaptioned PDF figure", () => {
  it("survives into the blocks as a marked figure the assets step will find", () => {
    const { blocks, figures } = figureBlocks([BEFORE, FIGURE, AFTER]);
    expect(figures).toHaveLength(1);
    expect(figures[0]!.tag).toBe("figure");
    /* Between the two paragraphs, where the model put it. */
    expect(blocks.map((b) => b.tag)).toEqual(["p", "figure", "p"]);
    const markers = pdfFigureMarkersIn(blocks);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.page).toBe(32);
    /* No caption to hand the gate, which is what makes it `uncaptioned`. */
    expect(pdfFigureCaptionsIn(blocks).has(markers[0]!.ref)).toBe(false);
  });

  it("keeps its block id when the same transcript is rendered again", () => {
    const first = figureBlocks([BEFORE, FIGURE, AFTER]);
    const again = figureBlocks([BEFORE, FIGURE, AFTER], first.blocks);
    expect(again.figures[0]!.id).toBe(first.figures[0]!.id);
  });

  it("does not hand its id to a new uncaptioned figure found earlier on the page", () => {
    /* GPT Sol, plan review of 261019e, finding 4: by page and ordinal alone, the
       newcomer would be ordinal 1 and take the old figure's ref and id. */
    const first = figureBlocks([BEFORE, FIGURE, AFTER]);
    const earlier = record({ text: "A paragraph the first reading missed, with a picture after it." });
    const again = figureBlocks([earlier, record({ type: "figure", text: "" }), BEFORE, FIGURE, AFTER], first.blocks);
    expect(again.figures).toHaveLength(2);
    expect(again.figures[0]!.id).not.toBe(first.figures[0]!.id);
  });

  it("remints an adjacent captionless run when another indistinguishable figure appears", () => {
    /* Immediate empty neighbours carry no text. Without the page's figure
       count in the context, the new first figure has the old first figure's
       page, ordinal and neighbours, and silently takes its id. There is no
       evidence for matching any member of this run, so all of them remint. */
    const first = figureBlocks([BEFORE, FIGURE, FIGURE, AFTER]);
    const again = figureBlocks([BEFORE, FIGURE, FIGURE, FIGURE, AFTER], first.blocks);
    const oldIds = new Set(first.figures.map((figure) => figure.id));
    expect(again.figures.filter((figure) => oldIds.has(figure.id))).toHaveLength(0);
  });

  it("is kept at either edge of the document", () => {
    expect(markersIn(renderHtml([FIGURE, AFTER], "T", RAW_SHA))).toHaveLength(1);
    expect(markersIn(renderHtml([BEFORE, FIGURE], "T", RAW_SHA))).toHaveLength(1);
  });

  it("mints distinct refs for adjacent captionless figures even when their rendered neighbours match", () => {
    const html = renderHtml(
      [
        BEFORE,
        record({ type: "figure", text: "" }),
        record({ type: "figure", text: "" }),
        record({ type: "figure", text: "" }),
        record({ type: "figure", text: "" }),
        AFTER,
      ],
      "T",
      RAW_SHA,
    );
    const markers = markersIn(html);
    expect(markers).toHaveLength(4);
    expect(new Set(markers)).toHaveLength(4);
  });

  it("counts an empty figure in the page ordinal before a captioned figure", () => {
    const markers = markersIn(
      renderHtml(
        [FIGURE, record({ type: "figure", text: "Figure 2. A captioned diagram." })],
        "T",
        RAW_SHA,
      ),
    ).map(parsePdfFigureMarker);
    expect(markers.map((marker) => marker?.ordinal)).toEqual([1, 2]);
  });

  it("does not emit an empty figure record that continues an earlier caption", () => {
    const html = renderHtml(
      [
        record({ type: "figure", text: "Figure 1. A diagram." }),
        record({ type: "figure", text: "", continues: true }),
        record({ type: "figure", text: "Figure 2. Another diagram." }),
      ],
      "T",
      RAW_SHA,
    );
    expect(markersIn(html)).toHaveLength(2);
    expect(html).toContain("<figcaption>Figure 1. A diagram.</figcaption>");
    expect(html).toContain("<figcaption>Figure 2. Another diagram.</figcaption>");
  });

  it("joins a continued caption onto an empty first piece instead of making a second figure", () => {
    const html = renderHtml(
      [
        record({ type: "figure", text: "" }),
        record({ type: "figure", text: "Figure 1. Caption continued here.", continues: true }),
      ],
      "T",
      RAW_SHA,
    );
    expect(markersIn(html)).toHaveLength(1);
    expect(html).toContain("<figcaption>Figure 1. Caption continued here.</figcaption>");
  });

  it("closes and reopens a list around the figure", () => {
    const html = renderHtml(
      [
        record({ type: "listitem", text: "One" }),
        FIGURE,
        record({ type: "listitem", text: "Two" }),
      ],
      "T",
      RAW_SHA,
    );
    expect(html).toContain("<ul>\n<li>One</li>\n</ul>\n<figure");
    expect(html).toMatch(/<\/figure>\n<ul>\n<li>Two<\/li>\n<\/ul>/);
  });

  it("does not hide a footnote marker in the prose beside it", () => {
    const html = renderHtml(
      [
        record({ text: "The claim is qualified here1." }),
        FIGURE,
        record({ type: "footnote", text: "1 The qualification." }),
      ],
      "T",
      RAW_SHA,
    );
    expect(html).toMatch(/qualified here<sup><a [^>]+>1<\/a><\/sup>\./);
    expect(markersIn(html)).toHaveLength(1);
  });

  it("keeps a numbered paragraph as prose when its endnote page also contains an empty figure", () => {
    const html = renderHtml(
      [
        record({ page: 31, type: "heading2", text: "Notes" }),
        record({ page: 31, type: "footnote", text: "1 First note." }),
        record({ page: 32, text: "2 This is body prose, not a recovered endnote." }),
        record({ page: 32, type: "figure", text: "" }),
      ],
      "T",
      RAW_SHA,
    );
    expect(html).toContain("<p>2 This is body prose, not a recovered endnote.</p>");
    expect(markersIn(html)).toHaveLength(1);
  });
});
