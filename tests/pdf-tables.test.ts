/**
 * **A PDF's tables, shown** — `renderHtml` in src/pdf-read.ts writes the
 * `tabledata` cells the transcription already carries into their table's
 * `<figure>`, where until 2026-10-01 a table was its caption over nothing.
 *
 * The records are the shape the model writes (rule 7 of the prompt): a `table`
 * record for the caption, then `tabledata` reading across each row, cells split
 * by `|`, one row per record or several joined by newlines. Table 3 is from the
 * paper behind report spya-pawfwx (JCO 2005, page 4). No PDF is committed.
 * docs/plans/261001q-pdf-tables-and-composite-figures.md, stage 1.
 */
import { describe, expect, it } from "vitest";
import { splitIntoBlocks } from "../src/blocks.js";
import type { PdfRecord } from "../src/pdf.js";
import { renderHtml } from "../src/pdf-read.js";

const RAW_SHA = "d".repeat(64);

const r = (page: number, type: PdfRecord["type"], text: string, extra: Partial<PdfRecord> = {}): PdfRecord => ({
  page,
  type,
  text,
  continues: false,
  uncertain: false,
  ...extra,
});

const render = (records: PdfRecord[]) => renderHtml(records, "T", RAW_SHA);

/** Each `<table>` in the html, as rows of trimmed cell text. */
function tables(html: string): string[][][] {
  return [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)].map(([, body]) =>
    [...(body ?? "").matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, row]) =>
      [...(row ?? "").matchAll(/<td>([\s\S]*?)<\/td>/g)].map(([, cell]) => cell ?? ""),
    ),
  );
}

const TABLE_3 = [
  r(4, "table", "Table 3. HER-2 Status of Breast Carcinomas at Presentation and Relapse"),
  r(4, "tabledata", "| HER-2 Status at Presentation (N = 39)"),
  r(4, "tabledata", "| Negative (n = 30) | Positive (n = 9)"),
  r(4, "tabledata", "HER-2 status at relapse\nNegative | 27 | 0\nPositive | 3 | 9"),
];

describe("a PDF's table shows its cells", () => {
  it("writes the cells inside the table's figure, after its caption", () => {
    const html = render([r(4, "paragraph", "Before."), ...TABLE_3, r(4, "paragraph", "After.")]);
    expect(html).toContain(
      "<figure><figcaption>Table 3. HER-2 Status of Breast Carcinomas at Presentation and Relapse</figcaption><table>",
    );
    expect(tables(html)).toEqual([
      [
        ["", "HER-2 Status at Presentation (N = 39)"],
        ["", "Negative (n = 30)", "Positive (n = 9)"],
        ["HER-2 status at relapse"],
        ["Negative", "27", "0"],
        ["Positive", "3", "9"],
      ],
    ]);
  });

  it("is one block, so the table is one thing on the spine as a web article's is", () => {
    const { blocks } = splitIntoBlocks(render([r(4, "paragraph", "Before."), ...TABLE_3, r(4, "paragraph", "After.")]));
    expect(blocks.map((b) => b.kind)).toEqual(["text", "media", "text"]);
    expect(blocks[1]?.text).toContain("Positive");
    expect(blocks[1]?.html).toContain("<td>27</td>");
  });

  it("keeps the cells with their table across a footer at the page turn", () => {
    const html = render([
      r(4, "table", "Table 1. Counts."),
      r(4, "tabledata", "a | 1"),
      r(4, "publisher", "Downloaded from ascopubs.org"),
      r(5, "tabledata", "b | 2"),
    ]);
    expect(tables(html)).toEqual([[["a", "1"], ["b", "2"]]]);
    expect(html).not.toContain("ascopubs");
  });

  it("keeps cells with a caption that continues across a page footer", () => {
    const html = render([
      r(4, "table", "Table 1. Counts"),
      r(4, "publisher", "Downloaded from ascopubs.org"),
      r(5, "table", "by group.", { continues: true }),
      r(5, "tabledata", "a | 1"),
    ]);
    expect(html).toContain("<figcaption>Table 1. Counts by group.</figcaption><table>");
    expect(tables(html)).toEqual([[["a", "1"]]]);
  });

  it("uses the checked continuation target, not an invalid continues flag, to own cells", () => {
    /* `continuationTargets` refuses the second caption's three-page jump. Cell
       ownership must make the same decision or the second caption is emitted as
       one figure while its cells silently move into the first. */
    const html = render([
      r(1, "table", "Table 1. Earlier."),
      r(1, "tabledata", "a | 1"),
      r(1, "publisher", "Downloaded from example.test"),
      r(4, "table", "Table 2. Later.", { continues: true }),
      r(4, "tabledata", "b | 2"),
    ]);
    expect(html).toContain("<figcaption>Table 1. Earlier.</figcaption><table><tbody><tr><td>a</td><td>1</td></tr>");
    expect(html).toContain("<figcaption>Table 2. Later.</figcaption><table><tbody><tr><td>b</td><td>2</td></tr>");
    expect(tables(html)).toEqual([[["a", "1"]], [["b", "2"]]]);
  });

  it("gives two tables their own cells", () => {
    const html = render([
      r(6, "table", "Table 4. One."),
      r(6, "tabledata", "x | 1"),
      r(6, "table", "Table 5. Two."),
      r(6, "tabledata", "y | 2"),
    ]);
    expect(tables(html)).toEqual([[["x", "1"]], [["y", "2"]]]);
  });

  it("does not carry cells past prose to a table above it", () => {
    /* A run of cells after a paragraph is not the earlier table's: something the
       reader sees lies between. It is shown where it is, in a figure of its own. */
    const html = render([
      r(2, "table", "Table 1. Counts."),
      r(2, "tabledata", "a | 1"),
      r(2, "paragraph", "Prose between."),
      r(2, "tabledata", "b | 2"),
    ]);
    expect(tables(html)).toEqual([[["a", "1"]], [["b", "2"]]]);
    expect(html.indexOf("Prose between.")).toBeLessThan(html.indexOf("<td>b</td>"));
  });

  it("keeps a continued paragraph in its first place, before the table that interrupted it", () => {
    const html = render([
      r(2, "paragraph", "The result was significant"),
      r(2, "table", "Table 1. Counts."),
      r(2, "tabledata", "a | 1"),
      r(2, "paragraph", "across groups.", { continues: true }),
    ]);
    expect(html).toContain("<p>The result was significant across groups.</p>\n<figure>");
    expect(html.match(/<td>a<\/td>/g)).toHaveLength(1);
  });

  it("shows cells before any table as their own figure, in place", () => {
    const html = render([
      r(1, "paragraph", "Before."),
      r(1, "tabledata", "orphan | 1"),
      r(1, "table", "Table 2. Later."),
      r(1, "tabledata", "owned | 2"),
    ]);
    expect(tables(html)).toEqual([[["orphan", "1"]], [["owned", "2"]]]);
    expect(html.indexOf("<td>orphan</td>")).toBeLessThan(html.indexOf("Table 2. Later."));
  });

  it("does not carry cells back across a figure", () => {
    const html = render([
      r(1, "table", "Table 1. Counts."),
      r(1, "tabledata", "owned | 1"),
      r(1, "figure", "Figure 1. Plot."),
      r(1, "tabledata", "orphan | 2"),
    ]);
    expect(tables(html)).toEqual([[["owned", "1"]], [["orphan", "2"]]]);
    expect(html.indexOf("Figure 1. Plot.")).toBeLessThan(html.indexOf("<td>orphan</td>"));
  });

  it("shows cells whose table has no caption, rather than dropping them", () => {
    const html = render([r(3, "table", ""), r(3, "tabledata", "a | 1\nb | 2"), r(3, "paragraph", "After.")]);
    expect(html).toContain("<figure><table>");
    expect(tables(html)).toEqual([[["a", "1"], ["b", "2"]]]);
  });

  it("escapes a cell like any other model text, and never writes the model's markup", () => {
    const html = render([r(1, "table", "Table 1. T."), r(1, "tabledata", "<b>x</b> | a & b")]);
    expect(html).toContain("<td>&lt;b&gt;x&lt;/b&gt;</td><td>a &amp; b</td>");
    expect(html).not.toContain("<b>");
  });

  it("marks a table the model could not read cleanly", () => {
    const html = render([r(1, "table", "Table 1. T."), r(1, "tabledata", "⟦illegible⟧ | 2", { uncertain: true })]);
    expect(html).toContain('<table class="pdf-uncertain">');
  });

  it("skips a row that is only separators, and an empty cell run stays a cell", () => {
    const html = render([r(1, "table", "Table 1. T."), r(1, "tabledata", "a | b\n\n | \nc |  | d")]);
    expect(tables(html)).toEqual([[["a", "b"], ["c", "", "d"]]]);
  });

  it("does not let an empty tabledata record drop or duplicate the rows after it", () => {
    const html = render([
      r(1, "table", "Table 1. T."),
      r(1, "tabledata", " | "),
      r(1, "tabledata", "a | 1"),
    ]);
    expect(tables(html)).toEqual([[["a", "1"]]]);
  });
});
