/**
 * A poem quoted in a PDF keeps its line breaks; a prose quote wrapped by the
 * page does not gain any — docs/plans/261018d-a-poem-quoted-in-a-pdf-keeps-its-line-breaks.md.
 *
 * The quotes are the real ones from the book behind the report (*The Order of
 * Time*, report spya-dktkem), as the PDF reader transcribed them.
 */
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { blocksAreWhatTheirHtmlProduces, splitIntoBlocks } from "../src/blocks.js";
import { emptyDropped, toLinks } from "../src/crossrefs.js";
import { placeQuoteInBlock } from "../src/quote-in-block.js";
import { hashBlocks } from "../src/source-hash.js";
import type { PdfRecord } from "../src/pdf.js";
import { renderHtml } from "../src/pdf-read.js";

const RAW_SHA = "a".repeat(64);

const quote = (text: string, over: Partial<PdfRecord> = {}): PdfRecord => ({
  page: 1,
  type: "quote",
  text,
  continues: false,
  uncertain: false,
  ...over,
});

const SAADI = [
  "All of the sons of Adam are part of one single body,",
  "They are of the same essence.",
  "When time afflicts us with pain",
  "In one part of that body",
  "All the other parts feel it too.",
  "If you fail to feel the pain of others",
  "You do not deserve the name of man.",
].join("\n");

/** Horace (I, 24): every line short, so only the width floor tells it from a narrow column. */
const HORACE = [
  "If more gently than Orpheus",
  "who moved even the trees",
  "you were to pluck the zither",
  "the life-blood would not return",
  "to the vain shadow . . .",
  "Harsh fate,",
  "but its burden becomes lighter",
  "to bear, since everything",
  "that attempts to turn back",
  "is impossible. (I, 24)",
].join("\n");

/** Prose, broken where the printed line ran out. */
const WRAPPED = [
  "I have had the unheard-of good fortune of experiencing a global vision of my being—",
  "not of a particular moment, but of my existence “as a whole.” I was able to compare its",
  "finite nature in space, against which no one protests, with its finite nature in time,",
  "which is instead the source of so much outrage.",
].join("\n");

const blockquote = (html: string): string => /<blockquote(?:\s[^>]*)?>([\s\S]*?)<\/blockquote>/.exec(html)?.[1] ?? "";

const browserText = (inner: string): string => {
  const doc = new JSDOM(`<blockquote>${inner}</blockquote>`).window.document;
  return doc.querySelector("blockquote")?.textContent ?? "";
};

describe("a quote's line breaks, from a PDF", () => {
  it("writes a poem's line breaks as <br>", () => {
    const inner = blockquote(renderHtml([quote(SAADI)], "T", RAW_SHA));
    expect(inner.split("<br>\n")).toEqual(SAADI.split("\n"));
  });

  it("keeps the lines of a poem whose lines are all short", () => {
    const inner = blockquote(renderHtml([quote(HORACE)], "T", RAW_SHA));
    expect(inner.split("<br>\n")).toHaveLength(10);
  });

  it("does not break a prose quote at the page's line ends", () => {
    const inner = blockquote(renderHtml([quote(WRAPPED)], "T", RAW_SHA));
    expect(inner).not.toContain("<br>");
  });

  it("a two-line prose quote whose first line is the longer stays one paragraph", () => {
    const text =
      "This re-emergence of time seemed to me like an intrusion, a source of mental\nconfusion, anguish, fear and alienation.";
    expect(blockquote(renderHtml([quote(text)], "T", RAW_SHA))).not.toContain("<br>");
  });

  it("never puts a <br> inside maths", () => {
    const text = "Short line\n\\(x\\)\nanother short line\nand one more";
    expect(blockquote(renderHtml([quote(text)], "T", RAW_SHA))).not.toContain("<br>");
  });

  it("leaves a paragraph alone, however short its lines", () => {
    const html = renderHtml([{ ...quote(SAADI), type: "paragraph" }], "T", RAW_SHA);
    expect(html).not.toContain("<br>");
  });

  it("is not fooled by one line much longer than the rest", () => {
    /* Wrapped prose where the model joined two printed lines into one: measured
       against that line, every ordinary wrap would look as if it had room to spare. */
    const lines = WRAPPED.split("\n");
    const text = [lines[0], `${lines[1]} ${lines[2]}`, lines[2], lines[3]].join("\n");
    expect(blockquote(renderHtml([quote(text)], "T", RAW_SHA))).not.toContain("<br>");
  });

  it("calls nothing of two lines verse, whichever line is the longer", () => {
    const text = "As he said:\nthe whole of the universe is a single body and we are all of us part of it.";
    expect(blockquote(renderHtml([quote(text)], "T", RAW_SHA))).not.toContain("<br>");
  });

  it("does not call a short opening followed by two full prose lines verse", () => {
    const text = [
      "As he explained:",
      "the whole of the universe is a single body and every one of us belongs to that body,",
      "which is why an injury to any one member should concern all the other members as well.",
    ].join("\n");
    expect(blockquote(renderHtml([quote(text)], "T", RAW_SHA))).not.toContain("<br>");
  });

  it("does not call a short opening followed by three full prose lines verse", () => {
    const text = [
      "As he explained:",
      "the whole of the universe is a single body and every one of us belongs to that body,",
      "which is why an injury to any one member should concern all the other members as well,",
      "and why nobody who fails to feel the pain of others deserves the name of a human being.",
    ].join("\n");
    expect(blockquote(renderHtml([quote(text)], "T", RAW_SHA))).not.toContain("<br>");
  });

  it("joins a quote continued onto the next page with a space, as before", () => {
    const lines = SAADI.split("\n");
    const html = renderHtml(
      [quote(lines.slice(0, 4).join("\n")), quote(lines.slice(4).join("\n"), { page: 2, continues: true })],
      "T",
      RAW_SHA,
    );
    expect(blockquote(html)).toContain("In one part of that body All the other parts");
  });

  it("keeps the newline in the text the browser anchors to", () => {
    /* src/web/annotate.ts reads the block's text nodes; a bare <br> has none. */
    const inner = blockquote(renderHtml([quote(SAADI)], "T", RAW_SHA));
    expect(browserText(inner)).toBe(SAADI);
  });

  it.each([
    ["CRLF", "\r\n"],
    ["CR", "\r"],
    ["Unicode line separator", "\u2028"],
    ["Unicode paragraph separator", "\u2029"],
  ])("draws %s line endings without changing the browser's text", (_name, separator) => {
    const text = ["First short line", ". . .", "  Third indented line", "Fourth short line"].join(separator);
    const before = browserText(text);
    const inner = blockquote(renderHtml([quote(text)], "T", RAW_SHA));
    expect(inner.match(/<br>/gu)).toHaveLength(3);
    expect(browserText(inner)).toBe(before);
  });

  it("does not mistake marker or entity markup for line endings", () => {
    const text = [
      "First & shortest line",
      "Second line carries a note¹",
      "Third ⟦illegible⟧ <quoted> line",
      "Final line",
    ].join("\n");
    const inner = blockquote(
      renderHtml([quote(text, { page: 2, uncertain: true }), quote("¹ The note.", { page: 2, type: "footnote" })], "T", RAW_SHA),
    );
    expect(inner.match(/<br>/gu)).toHaveLength(3);
    expect(inner).toContain("&amp;");
    expect(inner).toContain("&lt;quoted&gt;");
    expect(inner).toContain("<sup><a ");
    expect(browserText(inner)).toBe(text);
    expect(renderHtml([quote(text, { uncertain: true })], "T", RAW_SHA)).toContain('<blockquote class="pdf-uncertain">');
  });

  it("keeps a passage across a line anchorable and linkable", async () => {
    const blocks = splitIntoBlocks(
      renderHtml(
        [
          quote(SAADI),
          quote("An intervening paragraph.", { type: "paragraph" }),
          quote("The detail behind the poem.", { type: "paragraph" }),
        ],
        "T",
        RAW_SHA,
      ),
    ).blocks;
    const from = blocks[0]!;
    const to = blocks[2]!;
    const phrase = "body,\nThey are of the same essence.";
    const start = browserText(blockquote(from.html)).indexOf(phrase);
    expect(start).toBeGreaterThan(-1);
    expect(await placeQuoteInBlock(from, { quote: phrase, start })).toBe("ok");
    expect(toLinks([{ from: from.id, phrase, to: to.id }], blocks, emptyDropped())).toEqual([
      { from: from.id, phrase, to: to.id },
    ]);
  });

  it("changes no block's text, id or fingerprint", () => {
    /* The same quote as it was stored before: newlines left raw. */
    const before = splitIntoBlocks(`<article><blockquote>${SAADI}</blockquote></article>`).blocks;
    const extracted = renderHtml([quote(SAADI)], "T", RAW_SHA);
    const run = splitIntoBlocks(extracted, before);
    const after = run.blocks;
    expect(after.map((b) => b.text)).toEqual(before.map((b) => b.text));
    expect(after.map((b) => b.id)).toEqual(before.map((b) => b.id));
    expect(hashBlocks(after)).toBe(hashBlocks(before));
    expect(after[0]?.html).toContain("<br>");
    expect(blocksAreWhatTheirHtmlProduces(extracted, run.html, after)).toBe(true);
  });
});
