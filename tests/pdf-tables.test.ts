/**
 * **A PDF's tables, shown** — `renderHtml` in src/pdf-read.ts writes the
 * `tabledata` cells the transcription already carries into their table's
 * `<figure>`, where until 2026-10-01 a table was its caption over nothing.
 *
 * The records are the shape the model writes (rule 7 of the prompt): a `table`
 * record for the caption, then `tabledata` reading across each row, one row per
 * record or several joined by newlines. Cells are split by tabs, which rule 7
 * has named since `pdf-v5`, and by `|` in a row with no tab, which is how the
 * model wrote most of them before (report spya-xn4597). Table 3 is from the
 * paper behind report spya-pawfwx (JCO 2005, page 4). No PDF is committed.
 * docs/plans/261001q-pdf-tables-and-composite-figures.md, stage 1.
 */
import { describe, expect, it } from "vitest";
import { splitIntoBlocks } from "../src/blocks.js";
import { jsdom } from "../src/jsdom-lazy.js";
import type { PdfRecord } from "../src/pdf.js";
import { validateChunkReading } from "../src/pdf-integrity.js";
import { parseRecords, renderHtml } from "../src/pdf-read.js";
import { hashBlocks } from "../src/source-hash.js";

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
    expect(html).toContain("<figcaption>Table 1. Earlier.</figcaption><table><tbody><tr><td>a</td> <td>1</td></tr>");
    expect(html).toContain("<figcaption>Table 2. Later.</figcaption><table><tbody><tr><td>b</td> <td>2</td></tr>");
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
    expect(html).toContain("<td>&lt;b&gt;x&lt;/b&gt;</td> <td>a &amp; b</td>");
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

  /* Report spya-xn4597: on the LSE sentience review two of the four
     confidence grids came back tab-separated, and each row was drawn as one
     cell. Production's records, cut to three columns. */
  it("splits a row on tabs", () => {
    const html = render([
      r(24, "table", "Table 2. A summary of the evidence of sentience in cephalopods."),
      r(24, "tabledata", "Criterion 1\tCriterion 2\tCriterion 3"),
      r(24, "publisher", "Downloaded from example.test"),
      r(25, "tabledata", "Octopods (Octopoda)\tVH\tVH\tH"),
      r(25, "tabledata", "Nautiloids\tH\tL\tL"),
    ]);
    expect(tables(html)).toEqual([
      [
        ["Criterion 1", "Criterion 2", "Criterion 3"],
        ["Octopods (Octopoda)", "VH", "VH", "H"],
        ["Nautiloids", "H", "L", "L"],
      ],
    ]);
  });

  it("keeps an empty first, middle and last cell when cells are split on tabs", () => {
    /* The blank corner is how a header row lines up over a row-label column:
       trimming the line of its tabs first would lose it. */
    const html = render([
      r(1, "table", "Table 1. T."),
      r(1, "tabledata", "\tCriterion 1\tCriterion 2\r\nOctopods\tVH\t\r\nNautiloids\t\tL"),
    ]);
    expect(tables(html)).toEqual([
      [
        ["", "Criterion 1", "Criterion 2"],
        ["Octopods", "VH", ""],
        ["Nautiloids", "", "L"],
      ],
    ]);
  });

  it("keeps a bar in a tab-separated row as the author's text", () => {
    const html = render([r(1, "table", "Table 1. T."), r(1, "tabledata", "\\(P(A | B)\\)\t0.5")]);
    expect(tables(html)).toEqual([[["\\(P(A | B)\\)", "0.5"]]]);
  });

  it("skips a row of only tabs and spaces, without dropping printed dash-only cells", () => {
    const html = render([
      r(1, "table", "Table 1. T."),
      r(1, "tabledata", "a\tb\n \t \t \n---\t:---:\nc\td"),
      r(1, "tabledata", "e | f\n---|---\ng | h"),
      r(1, "tabledata", "| head | value |\n| left | 1\nright | 2 |"),
    ]);
    expect(tables(html)).toEqual([
      [
        ["a", "b"],
        ["---", ":---:"],
        ["c", "d"],
        ["e", "f"],
        ["---", "---"],
        ["g", "h"],
        ["head", "value"],
        ["", "left", "1"],
        ["right", "2", ""],
      ],
    ]);
  });

  it("keeps printed hyphen, em-dash and triple-hyphen cells", () => {
    const html = render([r(1, "table", "Table 1. T."), r(1, "tabledata", "a\t-\t—\nmissing\t---\t---")]);
    expect(tables(html)).toEqual([[["a", "-", "—"], ["missing", "---", "---"]]]);
  });

  it("marks a tab-separated table the model could not read cleanly", () => {
    const html = render([
      r(1, "table", "Table 1. T."),
      r(1, "tabledata", "certain\t1"),
      r(2, "tabledata", "⟦illegible⟧\t2", { uncertain: true }),
    ]);
    expect(html).toContain('<table class="pdf-uncertain">');
    expect(tables(html)).toEqual([[["certain", "1"], ["⟦illegible⟧", "2"]]]);
  });

  it("keeps an escaped tab from the model's JSON through validation and into separate cells", () => {
    const json = JSON.stringify({
      records: [r(1, "table", "Table 1. T."), r(1, "tabledata", "Octopods\tVH\tH")],
    });
    expect(json).toContain("\\t");
    const parsed = parseRecords(json);
    const verdict = validateChunkReading({
      ...parsed,
      finish: "stop",
      ms: 1,
      usage: { input: 1, output: 1 },
    });
    if (verdict.kind !== "valid") throw new Error(`not valid: ${verdict.code}`);

    expect(tables(render(verdict.reading.records))).toEqual([[["Octopods", "VH", "H"]]]);
  });

  it("gives a table the same block text, so the same id, whether its cells were split or not", () => {
    /* A re-extraction that now splits a row the old renderer drew as one cell
       changes the table's html, not its text: `extractText` puts a space at
       each cell boundary and collapses whitespace, and the text is what an id
       and the fingerprint are carried on. */
    const before = splitIntoBlocks(
      `<p>Before.</p><figure><figcaption>Table 2. T.</figcaption><table><tbody><tr><td>Octopods\tVH\tH</td></tr></tbody></table></figure>`,
    );
    const after = splitIntoBlocks(
      render([r(1, "paragraph", "Before."), r(1, "table", "Table 2. T."), r(1, "tabledata", "Octopods\tVH\tH")]),
      before.blocks,
    );
    expect(after.blocks.map((b) => b.text)).toEqual(before.blocks.map((b) => b.text));
    expect(after.blocks.map((b) => b.id)).toEqual(before.blocks.map((b) => b.id));
    expect(hashBlocks(after.blocks)).toBe(hashBlocks(before.blocks));
    expect(after.blocks[1]?.html).toContain("<td>Octopods</td> <td>VH</td> <td>H</td>");
    const { JSDOM } = jsdom();
    const rendered = (html: string) => new JSDOM(html).window.document.body.textContent;
    expect(rendered(after.blocks[1]!.html)).toBe(rendered(before.blocks[1]!.html)?.replace(/\t/g, " "));
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
