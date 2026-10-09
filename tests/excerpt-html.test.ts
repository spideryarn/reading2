// @vitest-environment jsdom
/**
 * **An excerpt drawn from the block's own markup** — src/web/excerpt-html.ts,
 * plan 261009k, report spya-pqae7m.
 *
 * What fails silently if it breaks, and so is pinned here:
 *
 *  - a quote's formula shown as its TeX source (the report);
 *  - half a formula drawn, or its source left beside it, when a cut lands
 *    inside one;
 *  - a block id, an `id` or a link carried out of the prose into a row;
 *  - a reader's selection across a drawn formula, whose words are already
 *    symbols, falling back to a string.
 */
import temml from "temml";
import { describe, expect, it } from "vitest";
import { temmlRenderer } from "../src/maths-tex.js";
import type { Article, Block, BlockId } from "../src/types.js";
import { excerptFallbackHtml, excerptHtml } from "../src/web/excerpt-html.js";
import { renderArticleMaths } from "../src/web/maths.js";
import { renderedText } from "../src/web/annotate.js";

const ID = "spya-ex2abc" as BlockId;

function block(html: string): Block {
  return { id: ID, tag: "p", kind: "paragraph", text: "", words: 0, html, gistable: true } as unknown as Block;
}

/** The block as the reading view holds it: maths drawn at ingress, as in `resolveAccess`. */
async function drawn(html: string): Promise<Block> {
  const article = { slug: "x", title: "x", blocks: [block(html)] } as unknown as Article;
  return (await renderArticleMaths(article, { load: async () => temmlRenderer(temml) })).blocks[0]!;
}

function parse(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

const ATTENTION =
  '<p data-spya-id="spya-ex2abc">We scale the dot products by \\(\\frac{1}{\\sqrt{d_k}}\\) to counteract this, as <em>Vaswani et al.</em> argue.</p>';

describe("excerptHtml", () => {
  it("draws a quote's TeX as maths, and leaves no source beside it (spya-pqae7m)", async () => {
    const b = await drawn(ATTENTION);
    const html = excerptHtml(b, "scale the dot products by \\(\\frac{1}{\\sqrt{d_k}}\\) to counteract this");
    const el = parse(html!);
    expect(el.querySelectorAll("math")).toHaveLength(1);
    expect(el.textContent).not.toContain("\\(");
    expect(el.textContent).not.toContain("sqrt");
    expect(el.textContent?.startsWith("scale the dot")).toBe(true);
    expect(el.textContent?.endsWith("counteract this")).toBe(true);
  });

  it("takes the whole formula when a cut lands inside it", async () => {
    const b = await drawn(ATTENTION);
    // Skim cuts a long quote on a word boundary, which can be inside the TeX.
    const html = excerptHtml(b, "We scale the dot products by \\(\\frac{1}{\\sqrt{d_k}");
    const el = parse(html!);
    expect(el.querySelectorAll("math")).toHaveLength(1);
    expect(el.textContent).not.toContain("\\");
    // …and from the other end.
    const tail = parse(excerptHtml(b, "{d_k}}\\) to counteract this")!);
    expect(tail.querySelectorAll("math")).toHaveLength(1);
    expect(tail.textContent).not.toContain("\\");
  });

  it("keeps inline formatting, partly-covered too, and nothing that addresses anything", () => {
    const b = block(
      '<p data-spya-id="spya-ex2abc" class="lead" id="x">The <a href="https://example.com" target="_blank">model of <strong>record</strong></a> is H<sub>2</sub>O, <em class="c" id="y">not quite right</em><img src="https://example.com/a.png" alt="pic">.</p>',
    );
    const el = parse(excerptHtml(b, "of record is H2O, not quite")!);
    expect(el.textContent).toBe("of record is H2O, not quite");
    expect(el.querySelector("strong")?.textContent).toBe("record");
    expect(el.querySelector("sub")?.textContent).toBe("2");
    // The `<em>` began inside the excerpt and ends outside it: kept, cut short.
    expect(el.querySelector("em")?.textContent).toBe("not quite");
    expect(el.querySelector("a, img, p, [id], [class], [data-spya-id], [href], [src]")).toBeNull();
  });

  it("finds a reader's selection across a drawn formula — its words are symbols already", async () => {
    const b = await drawn(ATTENTION);
    // What `Range.toString()` gives for a selection in the prose as drawn.
    const prose = renderedText(b.html);
    const from = prose.indexOf("by ");
    const selected = prose.slice(from, prose.indexOf(" to counteract"));
    expect(selected).not.toContain("\\(");
    const el = parse(excerptHtml(b, selected)!);
    expect(el.querySelectorAll("math")).toHaveLength(1);
  });

  it("draws a displayed formula in the line, so a row stays a row", async () => {
    const b = await drawn('<p>The loss is \\[L = \\sum_i x_i\\] in full.</p>');
    const el = parse(excerptHtml(b, "loss is \\[L = \\sum_i x_i\\] in full")!);
    const math = el.querySelector("math")!;
    expect(math).not.toBeNull();
    expect(math.getAttribute("display")).toBeNull();
    expect(math.classList.contains("tml-display")).toBe(false);
  });

  it("never cuts a formula the article carried as MathML", () => {
    const b = block("<p>Energy <math><mi>E</mi><mo>=</mo><mi>m</mi></math> and mass.</p>");
    const el = parse(excerptHtml(b, "=m and mass")!);
    expect(el.querySelector("math")?.textContent).toBe("E=m");
  });

  /* GPT Sol's plan review, F1–F7 (docs/plans/261009k-…-plan-review-sol.md). */
  it("keeps the formatting an excerpt sits wholly inside — F1", () => {
    const one = parse(excerptHtml(block("<p>Plain <em>important words</em> here.</p>"), "important words")!);
    expect(one.querySelector("em")?.textContent).toBe("important words");
    const nested = parse(excerptHtml(block("<p>A <strong>b <em>very deep</em> c</strong>.</p>"), "very deep")!);
    expect(nested.querySelector("strong > em")?.textContent).toBe("very deep");
  });

  it("carries no address out of the article's own MathML — F2", () => {
    const b = block(
      '<p>See <math id="spya-aaaaaa" data-spya-pdf-figure="forged"><mtext><a href="https://evil.test/x" name="n">target</a></mtext></math> now.</p>',
    );
    const html = excerptHtml(b, "See target now")!;
    const el = parse(html);
    expect(el.querySelector("math")).not.toBeNull();
    expect(el.querySelector("[id], [name], [href], a")).toBeNull();
    expect(html).not.toContain("data-spya");
    expect(el.textContent).toBe("See target now");
  });

  it("draws the occurrence a caller places, not the first — F3", () => {
    const b = block("<p><em>same words</em> and then <strong>same words</strong>.</p>");
    const second = renderedText(b.html).lastIndexOf("same words");
    expect(parse(excerptHtml(b, "same words", { near: second })!).querySelector("strong")).not.toBeNull();
    expect(parse(excerptHtml(b, "same words")!).querySelector("em")).not.toBeNull();
  });

  it("does not match words through a diagram it would then leave out — F5", () => {
    const b = block("<p><em>before</em><svg><text>label</text></svg><strong>after</strong></p>");
    expect(excerptHtml(b, "before label after")).toBeNull();
  });

  it("unwraps the article's own <q>: the caller already quotes the excerpt — F7", () => {
    const el = parse(excerptHtml(block("<p>He said <q>no more</q> twice.</p>"), "said no more twice")!);
    expect(el.querySelector("q")).toBeNull();
    expect(el.textContent).toBe("said no more twice");
  });

  it("is null for words the block does not hold, and leaves a price alone", () => {
    expect(excerptHtml(block("<p>Nothing like it.</p>"), "something else")).toBeNull();
    const el = parse(excerptHtml(block("<p>It cost $5 and $10.</p>"), "cost $5 and $10")!);
    expect(el.textContent).toBe("cost $5 and $10");
    expect(el.querySelector("math")).toBeNull();
  });
});

describe("excerptFallbackHtml", () => {
  it("draws the string's maths with the block's renderer when the block cannot place it", async () => {
    const b = await drawn(ATTENTION);
    const el = parse(excerptFallbackHtml(b, "an older quote about \\(d_k\\)")!);
    expect(el.querySelector("math")).not.toBeNull();
    expect(el.textContent?.startsWith("an older quote about")).toBe(true);
  });

  it("is null where there is nothing to draw: no renderer, or no maths", async () => {
    expect(excerptFallbackHtml(block("<p>x</p>"), "\\(d_k\\)")).toBeNull();
    expect(excerptFallbackHtml(undefined, "\\(d_k\\)")).toBeNull();
    expect(excerptFallbackHtml(await drawn(ATTENTION), "plain words <b>")).toBeNull();
  });

  it("leaves a code block's TeX as code — F9", async () => {
    const b = { ...(await drawn(ATTENTION)), kind: "code" } as Block;
    expect(excerptFallbackHtml(b, "printf(\"\\(x\\)\")")).toBeNull();
  });
});
