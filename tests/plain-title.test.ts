/**
 * **A title that came from outside us is stored as plain text.**
 *
 * docs/plans/260929e-outside-titles-become-plain-text-at-ingest.md. A Debate
 * source was drawn as `Physics - <i>Landmarks</i>—Millikan…`: the web search
 * handed us a title with inline markup in it, and every surface draws titles
 * as text, so the tags showed. The fix is one function, `plainTitle`, applied
 * where an outside title is written — so the second half of this file feeds
 * the same title through every one of those seams, not only the function.
 */
import { describe, expect, it } from "vitest";

import { emptyDrops, noScoreDrops, toDrafts } from "../src/citations.js";
import { runExtract } from "../src/extract.js";
import { readCitations } from "../src/referee-criteria.js";
import { plainTitle } from "../src/html.js";
import { extractPreview } from "../src/link-previews.js";
import { collectCitations, collectSearchEvidence } from "../src/openrouter-stream.js";
import { metaColumns } from "../src/store/artifacts-pg.js";
import type { Block, Citation, Meta, SearchEvidence } from "../src/types.js";

/** The one fb56 saw, as the search returned it. */
const APS = "Physics - <i>Landmarks</i>—Millikan Measures the Electron’s Charge";
const APS_PLAIN = "Physics - Landmarks—Millikan Measures the Electron’s Charge";

describe("plainTitle", () => {
  it.each([
    ["the APS title", APS, APS_PLAIN],
    ["the same, entity-encoded once", "Physics - &lt;i&gt;Landmarks&lt;/i&gt;—Millikan", "Physics - Landmarks—Millikan"],
    ["Crossref's JATS", "The <jats:italic>Drosophila</jats:italic> genome", "The Drosophila genome"],
    ["a subscript, joined not spaced", "Splitting H<sub>2</sub>O at scale", "Splitting H2O at scale"],
    ["small caps", "A <scp>Bayesian</scp> view", "A Bayesian view"],
    ["attributes on a tag", 'A <span class="x" style="y">styled</span> word', "A styled word"],
    ["upper case", "An <I>Italic</I> word", "An Italic word"],
    [
      "MathML, dropping the TeX annotation that duplicates it",
      '<mml:math><mml:semantics><mml:mi>x</mml:mi><mml:annotation encoding="application/x-tex">x</mml:annotation></mml:semantics></mml:math> bounds',
      "x bounds",
    ],
    ["JATS alternatives, dropping tex-math", "On <alternatives><tex-math>\\alpha</tex-math><mml:math><mml:mi>α</mml:mi></mml:math></alternatives> decay", "On α decay"],
    ["a line break becomes a space", "Part one<br/>Part two", "Part one Part two"],
    ["named and numeric entities", "Cats &amp; dogs &#8212; a &#x2018;study&#x2019;", "Cats & dogs — a ‘study’"],
    ["whitespace collapsed", "  Two\n  lines  ", "Two lines"],
  ])("%s", (_, input, expected) => {
    expect(plainTitle(input)).toBe(expected);
  });

  it.each([
    ["an inequality, which is not a tag", "Why x<y and y>z", "Why x<y and y>z"],
    ["an unknown tag name", "The <foo> operator", "The <foo> operator"],
    ["an unknown entity", "Fish &unknownentity; chips", "Fish &unknownentity; chips"],
    ["an out-of-range code point", "Bad &#x110000; point", "Bad &#x110000; point"],
    ["a surrogate code point", "Bad &#xD800; point", "Bad &#xD800; point"],
    ["plain text", "Scaling Laws for Neural Language Models", "Scaling Laws for Neural Language Models"],
  ])("leaves alone %s", (_, input, expected) => {
    expect(plainTitle(input)).toBe(expected);
  });

  /* **Not a sanitiser.** These pin what it does with hostile input, which is
     produce *text* — safe only because every sink escapes or treats it as text.
     GPT Sol's plan review asked for all four. */
  it.each([
    ["an encoded script tag, decoded to literal text", "&lt;script&gt;x&lt;/script&gt;", "<script>x</script>"],
    ["a tag hidden inside an allowed one", "<scr<i>ipt>", "<script>"],
    ["a nested allowed tag", "A <i<i>> B", "A B"],
    ["an unclosed allowed tag", "A <i title", "A <i title"],
  ])("hostile input: %s", (_, input, expected) => {
    expect(plainTitle(input)).toBe(expected);
  });

  it("stops after a bounded number of passes on deep nesting", () => {
    const deep = `${"<i".repeat(1000)}${">".repeat(1000)} T`;
    const started = performance.now();
    plainTitle(deep);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("drops a bidi override that decoding produced", () => {
    expect(plainTitle("A&#x202E;gnp.exe")).toBe("Agnp.exe");
  });

  it("is a no-op the second time", () => {
    expect(plainTitle(plainTitle(APS))).toBe(APS_PLAIN);
  });
});

/* ------------------------------------------------------------ the seams -- */

describe("every seam an outside title enters by", () => {
  const annotation = { type: "url_citation", url_citation: { url: "https://physics.aps.org/x", title: APS } };

  it("web-search citations (chat, explain, Referee Criteria)", () => {
    const into = new Map<string, Citation>();
    collectCitations([annotation] as Parameters<typeof collectCitations>[0], into);
    expect([...into.values()][0]?.title).toBe(APS_PLAIN);
  });

  it("web-search evidence (Debate, citation finds, referee candidates)", () => {
    const into = new Map<string, SearchEvidence>();
    collectSearchEvidence([annotation] as Parameters<typeof collectSearchEvidence>[0], into);
    expect([...into.values()][0]?.title).toBe(APS_PLAIN);
  });

  it("a title that is only markup is no title at all", () => {
    const into = new Map<string, Citation>();
    const empty = { type: "url_citation", url_citation: { url: "https://a.test", title: "<i> </i>" } };
    collectCitations([empty] as Parameters<typeof collectCitations>[0], into);
    expect([...into.values()]).toStrictEqual([{ url: "https://a.test" }]);
  });

  it("a link preview's og:title", () => {
    const html = `<!doctype html><html><head><meta property="og:title" content="${APS.replace(/</g, "&lt;").replace(/>/g, "&gt;")}"></head><body><p>x</p></body></html>`;
    expect(extractPreview(html, "https://physics.aps.org/x")?.page.title).toBe(APS_PLAIN);
  });

  it("a cited work's title as the model read it off the page", () => {
    const text = "Millikan's landmark measurement.";
    const block = { id: "spya-ref001", tag: "p", kind: "text", text, words: 3, html: `<p>${text}</p>`, gistable: true } as unknown as Block;
    const drafts = toDrafts(
      [{ title: APS, why: "The history.", reference: { block: "spya-ref001", quote: "Millikan" } }],
      [block],
      emptyDrops(),
      noScoreDrops(),
    );
    expect(drafts[0]?.title).toBe(APS_PLAIN);
  });

  it("Referee Criteria's citations, as the model wrote them", () => {
    expect(readCitations([{ url: "https://physics.aps.org/x", title: APS }])[0]?.title).toBe(APS_PLAIN);
  });

  it("the article's title from an HTML page, in meta and in the heading stage 3 reads", async () => {
    const prose = Array.from(
      { length: 8 },
      (_, i) => `<p>Paragraph ${i} of ordinary prose, long enough that Readability keeps this article rather than deciding the page is a navigation shell.</p>`,
    ).join("\n");
    const { meta, extractedHtml } = await runExtract({
      html: `<!doctype html><html lang="en"><head><title>The &lt;i&gt;Drosophila&lt;/i&gt; genome</title></head><body><article>${prose}</article></body></html>`,
      url: "https://example.com/fly",
      slug: "fly",
    });
    expect(meta.title).toBe("The Drosophila genome");
    expect(extractedHtml).toContain("<h1>The Drosophila genome</h1>");
    expect(extractedHtml).not.toContain("&lt;i&gt;");
  });

  it("the article's title at the column, whichever producer wrote it", () => {
    expect(metaColumns({ slug: "s", title: APS } as Meta).title).toBe(APS_PLAIN);
  });
});
