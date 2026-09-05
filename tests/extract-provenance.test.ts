/**
 * **Which source element did this output node come from?**
 *
 * Every instrument that wants to say what Readability threw away has so far had
 * to answer that by matching text, and 260827ab spent a whole section on the
 * eight ways that was confidently wrong — a hidden duplicate of a paragraph is
 * invisible to a substring test, because every word of it is already there.
 *
 * Readability takes a `serializer` option; give it the identity function and it
 * hands back a **DOM node** rather than a string. Stamp every source element
 * first and the output carries its own provenance.
 *
 * Two things have to be true for that to be worth anything, and both are pinned
 * here rather than assumed:
 *
 *  1. **It is inert.** Readability weights `class` and `id` when it scores a
 *     node, so putting an attribute on every element in the document is not
 *     obviously free. The **HTML** it extracts must be byte-identical once the
 *     stamps are removed, and the stamped source must still be the source.
 *  2. **Coverage is measured, not hoped for.** Readability generates wrapper
 *     nodes of its own, and on degenerate markup it rebuilds the document
 *     wholesale — 260827ab measured 92.7% / 99.8% / **40.9%** on three pages.
 *     So there is a documented fallback and it is exercised.
 *
 * **Both of those gates were silent successes until 2026-09-05**, which is why
 * they are worth reading carefully rather than trusting. The first compared
 * whitespace-normalised `textContent`, and GPT Sol landed a mutation — prepend
 * `"\n\n"` to the extracted HTML — that it did not notice. The second compared a
 * pristine source document with itself. Both now compare bytes taken on either
 * side of the thing they claim about, and both have been watched fail against
 * those exact mutations.
 *
 * See docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md § A,
 * and evals/extraction/provenance.mts for the per-fixture numbers.
 */
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import {
  readArticle,
  readArticleWithProvenance,
  sourceRefOf,
  withoutSourceRefs,
} from "../src/extract.js";
import { RESERVED_ATTRS } from "../src/reserved.js";

const prose = (n: number, from = 0) =>
  Array.from(
    { length: n },
    (_, i) =>
      `<p id="p${from + i}">Paragraph ${from + i} of ordinary prose, long enough that Readability keeps this article rather than deciding the page is a navigation shell with nothing in it. It carries on for a sentence or two more.</p>`,
  ).join("\n");

const PAGE = `<!doctype html><html lang="en"><head><title>A Title</title></head>
<body><script>window.analytics = 1;</script>
<nav><a href="/x">Home</a><a href="/y">About</a></nav>
<article>${prose(10)}</article>
<footer><p>Copyright somebody.</p></footer></body></html>`;

const URL = "https://example.com/article";

/**
 * Paul Graham's markup, in miniature: a `<table>` wrapping a `<font>` with the
 * prose loose inside it, which is the shape that makes Readability rebuild the
 * document rather than keep it. Here so the inertness check runs on the rebuild
 * path too, since that is where a stamp could most plausibly change a score.
 */
const loose = (n: number, from = 0) =>
  prose(n, from).replace(/<p id="p\d+">/g, "").replace(/<\/p>/g, "<br><br>");

const DEGENERATE = `<!doctype html><html lang="en"><head><title>Degenerate</title></head>
<body><table><tr><td><font size="2" face="verdana">${loose(10)}</font></td></tr></table></body></html>`;

describe("source-id stamping", () => {
  /**
   * **Byte-identical HTML, not normalised text**, and the difference is the
   * whole value of this test.
   *
   * It read `textContent.replace(/\s+/gu, " ")` on both sides until GPT Sol
   * prepended `"\n\n"` to the extracted HTML in the implementation and watched
   * this pass anyway (2026-09-05). Whitespace-normalised text cannot see a
   * wrapper element, an attribute, a reordering or a space — which is precisely
   * the damage a per-element attribute could do to a scorer that weights `class`
   * and `id`.
   *
   * `withoutSourceRefs` removes the one attribute the instrument adds and
   * nothing else, so anything else that differs fails here.
   */
  it.each([
    ["ordinary prose", PAGE],
    ["markup degenerate enough that Readability rebuilds it", DEGENERATE],
  ])("is inert on %s: identical HTML once the stamps come off", (_what, page) => {
    const stock = readArticle(page, URL).article;
    const { article } = readArticleWithProvenance(page, URL);
    expect(stock?.content, "the page must extract at all, or this proves nothing").toBeTruthy();
    expect(withoutSourceRefs(article!.content!)).toBe(stock!.content);
    expect(article?.title).toBe(stock?.title);
    expect(article?.byline ?? null).toBe(stock?.byline ?? null);
  });

  it("hands back a DOM node rather than a string, so the stamps survive", () => {
    const { article } = readArticleWithProvenance(PAGE, URL);
    expect(article?.content).toBeTruthy();
    expect(typeof article!.content).not.toBe("string");
    expect(article!.content!.querySelectorAll("p").length).toBeGreaterThan(0);
  });

  /**
   * **The source document is compared with what it was, not with itself.**
   *
   * This used to read `source.querySelectorAll("*").length === stampedElements`
   * — two numbers off the same object, written by the same loop, which GPT Sol
   * called true by construction and was right to. What has to be true is that
   * **Readability never touched this document**: every id an output node
   * resolves to is looked up in it, so a pruned source would answer `none` for
   * exactly the passages the instrument exists to find, and nothing would say so.
   *
   * `sourceHtml` is taken inside `readArticleWithProvenance` at the moment
   * Readability is handed its *copy*. Delete the re-parse and pass the stamped
   * document straight in — the one-line "simplification" this guards against —
   * and `_removeScripts` alone moves these bytes.
   */
  it("keeps the stamped source exactly as Readability was never given it", () => {
    const { source, sourceHtml, stampedElements } = readArticleWithProvenance(PAGE, URL);
    expect(stampedElements).toBeGreaterThan(10);
    expect(source.documentElement.outerHTML).toBe(sourceHtml);
    expect(source.querySelectorAll(`[${RESERVED_ATTRS.sourceRef}]`).length).toBe(stampedElements);
    // And the furniture Readability strips is still here to be looked up in.
    expect(source.querySelector("nav")).not.toBeNull();
    expect(source.querySelector("script")).not.toBeNull();
  });

  it("maps an output paragraph back to the source element it came from", () => {
    const { article, source } = readArticleWithProvenance(PAGE, URL);
    const p = Array.from(article!.content!.querySelectorAll("p")).find((el) =>
      (el.textContent ?? "").startsWith("Paragraph 3 "),
    )!;
    const ref = sourceRefOf(p);
    expect(ref.how).toBe("direct");
    const origin = source.querySelector(`[${RESERVED_ATTRS.sourceRef}="${ref.id}"]`);
    expect(origin?.id).toBe("p3");
  });

  it("scrubs any stamp the page arrived carrying, so every stamp is ours", () => {
    const hostile = PAGE.replace(
      "<article>",
      `<article><p ${RESERVED_ATTRS.sourceRef}="s1">Forged.</p>`,
    );
    const { source } = readArticleWithProvenance(hostile, URL);
    const forged = Array.from(source.querySelectorAll("p")).find(
      (el) => el.textContent === "Forged.",
    )!;
    // Re-stamped in document order, so it cannot still be claiming s1 unless it
    // genuinely is the first element.
    expect(forged.getAttribute(RESERVED_ATTRS.sourceRef)).not.toBe("s1");
  });
});

describe("the fallback, for output nodes Readability generated itself", () => {
  const doc = new JSDOM("<div></div>").window.document;
  const make = (html: string): Element => {
    const host = doc.createElement("div");
    host.innerHTML = html;
    return host.firstElementChild!;
  };

  it("reports a direct hit as direct", () => {
    const el = make(`<p ${RESERVED_ATTRS.sourceRef}="s7">x</p>`);
    expect(sourceRefOf(el)).toEqual({ id: "s7", how: "direct" });
  });

  it("falls back to the first stamped descendant of a generated wrapper", () => {
    const el = make(`<div><p ${RESERVED_ATTRS.sourceRef}="s9">x</p></div>`);
    expect(sourceRefOf(el)).toEqual({ id: "s9", how: "descendant" });
  });

  it("falls back to the nearest stamped ancestor when there is no descendant", () => {
    const outer = make(`<div ${RESERVED_ATTRS.sourceRef}="s2"><div><br></div></div>`);
    expect(sourceRefOf(outer.querySelector("br")!)).toEqual({ id: "s2", how: "ancestor" });
  });

  it("says none rather than guessing, when nothing near it is stamped", () => {
    expect(sourceRefOf(make("<div><br></div>"))).toEqual({ id: null, how: "none" });
  });

  it("prefers a descendant to an ancestor, because it is the more specific claim", () => {
    const outer = make(
      `<div ${RESERVED_ATTRS.sourceRef}="s2"><div><p ${RESERVED_ATTRS.sourceRef}="s5">x</p></div></div>`,
    );
    expect(sourceRefOf(outer.firstElementChild!)).toEqual({ id: "s5", how: "descendant" });
  });
});
