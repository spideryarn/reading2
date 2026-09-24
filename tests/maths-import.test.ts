/**
 * **HTML imports put maths into block text as delimited TeX** — the one
 * representation (docs/project/maths.md), stage 3b of
 * docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md.
 *
 * One hand-written fixture per shape a page delivers its TeX source in, each
 * copied from the real markup of the corpus page named beside it, then the
 * three corpus pages themselves through the real stage-2 path.
 */
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";
import { readArticle } from "../src/extract.js";
import { canonicaliseMaths } from "../src/maths-import.js";
import { findMathSpans, MATHS_SKIP_TAGS } from "../src/maths-tex.js";
import { loadMathsRenderer } from "../src/maths-server.js";

/* temml, loaded the one way there is (src/maths-server.ts): without it every
   formula is refused, as in a stage that forgot to load it. */
beforeAll(loadMathsRenderer);

function convert(body: string): { html: string; text: string; converted: number } {
  const doc = new JSDOM(`<!doctype html><body>${body}</body>`).window.document;
  const converted = canonicaliseMaths(doc);
  return { html: doc.body.innerHTML, text: doc.body.textContent ?? "", converted };
}

function drawableSpanCount(html: string): number {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  const doc = dom.window.document;
  const walker = doc.createTreeWalker(doc.body, dom.window.NodeFilter.SHOW_TEXT);
  const skip = MATHS_SKIP_TAGS.join(",");
  let count = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest(skip)) count += findMathSpans(node.textContent ?? "").length;
  }
  return count;
}

const TEX = '<annotation encoding="application/x-tex">';

describe("one formula per shape, into delimited TeX", () => {
  it("LaTeXML (ar5iv): a bare <math> with an x-tex annotation, inline", () => {
    const out = convert(
      `<p>state <math class="ltx_Math" alttext="h_{t}" display="inline"><semantics><msub><mi>h</mi><mi>t</mi></msub>${TEX}h_{t}</annotation></semantics></math> is</p>`,
    );
    expect(out.html).toBe(String.raw`<p>state \(h_{t}\) is</p>`);
    expect(out.converted).toBe(1);
  });

  it("a display <math> becomes \\[…\\]", () => {
    const out = convert(
      `<p><math display="block"><semantics><mi>x</mi>${TEX}x^2</annotation></semantics></math></p>`,
    );
    expect(out.html).toBe(String.raw`<p>\[x^2\]</p>`);
  });

  it("uses alttext when there is no annotation", () => {
    expect(convert(`<p><math alttext="a+b"><mi>a</mi></math></p>`).html).toBe(String.raw`<p>\(a+b\)</p>`);
  });

  it("MediaWiki: the whole wrapper goes, fallback image and \\displaystyle included", () => {
    const out = convert(
      `<p>of <span class="mwe-math-element mwe-math-element-inline"><span class="mwe-math-mathml-inline mwe-math-mathml-a11y" style="display: none;"><math alttext="{\\displaystyle xW}"><semantics><mi>x</mi>${TEX}{\\displaystyle xW}</annotation></semantics></math></span><img src="x.svg" class="mwe-math-fallback-image-inline" alt="{\\displaystyle xW}"></span> and</p>`,
    );
    expect(out.html).toBe(String.raw`<p>of \(xW\) and</p>`);
  });

  it("MediaWiki display: a block-level wrapper becomes \\[…\\]", () => {
    const out = convert(
      `<div><span class="mwe-math-element mwe-math-element-block"><span class="mwe-math-mathml-display"><math display="block"><semantics><mi>L</mi>${TEX}{\\displaystyle L=1}</annotation></semantics></math></span><img alt="L=1"></span></div>`,
    );
    expect(out.html).toBe(String.raw`<div>\[L=1\]</div>`);
  });

  it("KaTeX: the MathML and its aria-hidden HTML twin go together", () => {
    const out = convert(
      `<p>step <span class="katex"><span class="katex-mathml"><math><semantics><mi>α</mi>${TEX}\\alpha</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="mord mathnormal">α</span></span></span> is</p>`,
    );
    expect(out.html).toBe(String.raw`<p>step \(\alpha\) is</p>`);
    expect(out.text).not.toContain("α");
  });

  it("KaTeX display: .katex-display becomes \\[…\\]", () => {
    const out = convert(
      `<p><span class="katex-display"><span class="katex"><span class="katex-mathml"><math display="block"><semantics><mi>w</mi>${TEX}w^{k+1}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">w</span></span></span></p>`,
    );
    expect(out.html).toBe(String.raw`<p>\[w^{k+1}\]</p>`);
  });

  it("MathJax v2: script tags, inline and display, and the preview beside one", () => {
    const out = convert(
      `<p>so <span class="MathJax_Preview">x</span><script type="math/tex">x_1</script> and</p><p><script type="math/tex; mode=display">\\sum_i x_i</script></p>`,
    );
    expect(out.html).toBe(String.raw`<p>so \(x_1\) and</p><p>\[\sum_i x_i\]</p>`);
  });

  it("HTML-escapes TeX text in storage without changing what the span scanner reads", () => {
    for (const body of [
      `<p><math><semantics><mi>a</mi>${TEX}a&lt;b</annotation></semantics></math></p>`,
      `<p><script type="math/tex">a<b</script></p>`,
    ] as const) {
      const out = convert(body);
      expect(out.html).toBe(String.raw`<p>\(a&lt;b\)</p>`);
      expect(drawableSpanCount(out.html)).toBe(1);
    }
  });

  it("recognises the MathJax MIME type case-insensitively, but not longer lookalikes", () => {
    expect(convert(`<p><script type="Math/TeX">x_1</script></p>`).html).toBe(String.raw`<p>\(x_1\)</p>`);
    for (const type of ["math/texture", "math/tex; notmode=display"]) {
      const body = `<p><script type="${type}">x_1</script></p>`;
      expect(convert(body), type).toEqual({ html: body, text: "x_1", converted: 0 });
    }
  });

  it("leaves a MathJax script nested inside another publisher's formula wrapper", () => {
    for (const name of ["katex", "mwe-math-element"]) {
      const body = `<span class="${name}"><script type="math/tex">x_1</script><em>kept</em></span>`;
      expect(convert(body), name).toEqual({ html: body, text: "x_1kept", converted: 0 });
    }
  });
});

describe("never worse than today", () => {
  it("leaves a formula stage 1 would refuse exactly as it was", () => {
    const body = `<p><math><semantics><mi>x</mi>${TEX}\\href{https://example.test}{x}</annotation></semantics></math></p>`;
    const out = convert(body);
    expect(out.converted).toBe(0);
    expect(out.html).toContain("<math>");
  });

  it("leaves TeX that would close its own span", () => {
    expect(convert(`<p><math alttext="a \\) b"><mi>a</mi></math></p>`).converted).toBe(0);
  });

  it("keeps a spaced line break, which holds no closer, and refuses an escaped closer", () => {
    const ok = String.raw`\begin{aligned} a &= b \\[0.4em] c &= d \end{aligned}`;
    expect(convert(`<p><math display="block" alttext="${ok}"><mi>a</mi></math></p>`).converted).toBe(1);
    const bad = String.raw`\begin{aligned} a &= b \\] c \end{aligned}`;
    expect(convert(`<p><math display="block" alttext="${bad}"><mi>a</mi></math></p>`).converted).toBe(0);
  });

  it("leaves bare MathML with no TeX source for the next stage", () => {
    const out = convert(`<p><math><mi>x</mi></math></p>`);
    expect(out.converted).toBe(0);
    expect(out.html).toBe("<p><math><mi>x</mi></math></p>");
  });

  it("does not touch maths inside code, pre, kbd or samp, where the reading view would not draw it", () => {
    for (const tag of ["code", "pre", "kbd", "samp"]) {
      expect(convert(`<${tag}><math alttext="x"><mi>x</mi></math></${tag}>`).converted, tag).toBe(0);
    }
  });

  it("does convert inside a heading or a link, keeping the heading and the link", () => {
    expect(convert(`<h2>On <math alttext="x"><mi>x</mi></math></h2>`).html).toBe(String.raw`<h2>On \(x\)</h2>`);
    expect(convert(`<a href="/y">see <math alttext="y"><mi>y</mi></math></a>`).html).toBe(
      String.raw`<a href="/y">see \(y\)</a>`,
    );
  });

  it("leaves a wrapper holding anything but the formula and its twin", () => {
    const body = `<span class="katex"><span class="katex-mathml"><math><semantics><mi>a</mi>${TEX}a</annotation></semantics></math></span><span class="katex-html">a</span><em>an author's note</em></span>`;
    const out = convert(body);
    expect(out.converted).toBe(0);
    expect(out.html).toContain("an author's note");
  });

  it("leaves a wrapper whose nominal formula container also holds authored content", () => {
    for (const body of [
      `<span class="katex"><span class="katex-mathml"><math><semantics><mi>a</mi>${TEX}a</annotation>` +
        `</semantics></math><em>an author's note</em></span><span class="katex-html">a</span></span>`,
      `<span class="mwe-math-element"><span class="mwe-math-mathml-inline"><math alttext="a"><mi>a</mi></math>` +
        `<em>an author's note</em></span><img alt="a"></span>`,
    ]) {
      const out = convert(body);
      expect(out.converted).toBe(0);
      expect(out.html).toContain("an author's note");
    }
  });

  it("leaves nested MathML and maths inside SVG in the page's own form", () => {
    const nested =
      `<math><mrow><math><semantics><mi>y</mi>${TEX}y</annotation></semantics></math>` +
      `<mtext>tail</mtext></mrow></math>`;
    const svg = `<svg><math alttext="x"><mi>x</mi></math><text>label</text></svg>`;
    expect(convert(nested)).toEqual({ html: nested, text: "yytail", converted: 0 });
    expect(convert(svg)).toEqual({ html: svg, text: "xlabel", converted: 0 });
  });

  it("leaves one publisher's formula wrapper nested inside another", () => {
    for (const [body, text] of [
      [
        `<span class="mwe-math-element"><span class="mwe-math-mathml-inline">` +
          `<span class="katex"><span class="katex-mathml"><math><semantics><mi>a</mi>${TEX}a</annotation>` +
          `</semantics></math></span><span class="katex-html">a</span></span></span><img alt="a"></span>`,
        "aaa",
      ],
      [
        `<span class="katex"><span class="katex-mathml"><span class="katex"><span class="katex-mathml">` +
          `<math><semantics><mi>a</mi>${TEX}a</annotation></semantics></math></span>` +
          `<span class="katex-html">a</span></span></span><span class="katex-html">a</span></span>`,
        "aaaa",
      ],
    ] as const) {
      expect(convert(body)).toEqual({ html: body, text, converted: 0 });
    }
  });

  it("counts only formulas still in the document after replacing an ancestor", () => {
    const out = convert(
      `<math alttext="x"><mrow><math alttext="y"><mi>y</mi></math></mrow></math>`,
    );
    expect(out.html).toBe(String.raw`\(x\)`);
    expect(out.converted).toBe(1);
  });

  it("does not unwrap a style group that closes before the end of the TeX", () => {
    expect(convert(`<math alttext="{\\displaystyle a}{b}"><mi>a</mi><mi>b</mi></math>`).html).toBe(
      String.raw`\({\displaystyle a}{b}\)`,
    );
  });

  it("leaves a formula a link points at, so the link keeps its target", () => {
    const out = convert(`<p><math id="eq1" alttext="e=mc^2"><mi>e</mi></math></p><p><a href="#eq1">(1)</a></p>`);
    expect(out.converted).toBe(0);
    expect(convert(`<p><math id="eq1" alttext="e=mc^2"><mi>e</mi></math></p>`).converted).toBe(1);
  });

  it("leaves a MathJax preview that is a link or a link target", () => {
    for (const body of [
      `<p><span class="MathJax_Preview" id="eq1">x</span><script type="math/tex">x</script>` +
        `<a href="#eq1">equation</a></p>`,
      `<p><a class="MathJax_Preview" href="/note">x</a><script type="math/tex">x</script></p>`,
    ]) {
      expect(convert(body)).toEqual({ html: body, text: body.includes("equation") ? "xxequation" : "xx", converted: 0 });
    }
  });
});

describe("the corpus pages, through the real stage 2", () => {
  const fixture = (name: string) =>
    readFileSync(new URL(`../evals/extraction/fixtures/${name}.html`, import.meta.url), "utf-8");

  for (const [name, url, sourceExpected, extractedExpected] of [
    ["ar5iv", "https://ar5iv.labs.arxiv.org/html/1706.03762", 142, 142],
    ["wiki_transformer", "https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)", 188, 188],
    ["distill_momentum", "https://distill.pub/2017/momentum/", 268, 221],
  ] as const) {
    it(`${name}: maths arrives as delimited TeX, with no <math> left doubled beside it`, () => {
      const source = fixture(name);
      const doc = new JSDOM(source).window.document;
      expect(canonicaliseMaths(doc)).toBe(sourceExpected);
      expect(doc.querySelector("math")).toBeNull();

      const content = readArticle(source, url).article?.content ?? "";
      expect(drawableSpanCount(content)).toBe(extractedExpected);
      expect(content).not.toMatch(/<math[\s>]/iu);
      expect(content).not.toContain("katex-html");
      expect(content).not.toContain("mwe-math-fallback-image");
    }, 60_000);
  }
});
