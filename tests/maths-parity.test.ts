// @vitest-environment jsdom
/**
 * **The server's reading of a formula agrees with the reader's** — character for
 * character, for every kind of formula and every hostile one.
 *
 * The reading view draws delimited TeX as MathML in the browser
 * (src/web/maths.ts), so a reader selecting across an equation quotes its
 * symbols. The server checks that quote against `block.text`, which holds the
 * TeX, and since fb30 stage 1b also against `renderedMathsText(block.text)`
 * (src/maths-tex.ts, used by src/quote-in-block.ts). That second form is only
 * worth anything if it is **the text the browser actually shows** — so this
 * compares it with `renderedText` (src/web/annotate.ts, the offset space every
 * comment lives in) of the html the client produced from the same text: through
 * `sanitizeArticle`, `renderArticleMaths` and its second sanitise, exactly the
 * ingress path.
 *
 * The acceptance rule is compared too, because the two sides read it
 * differently: the client parses temml's markup into a `<template>` and walks
 * the tree; the server reads the string. If they disagreed about a span, one
 * side would show symbols and the other would expect source.
 *
 * jsdom stands in for the browser here, which is the caveat
 * tests/sanitize-client.test.ts makes: the stage-1 browser check ran the same
 * html through Chromium's parser.
 */
import temml from "temml";
import { describe, expect, it } from "vitest";
import {
  acceptsMarkup,
  findMathSpans,
  MAX_TEX_CHARS,
  renderedMathsText,
  temmlRenderer,
} from "../src/maths-tex.js";
import { renderedText } from "../src/web/annotate.js";
import { renderArticleMaths, rendersMaths } from "../src/web/maths.js";
import { sanitizeArticle } from "../src/web/sanitize.js";
import type { Article } from "../src/types.js";

const real = temmlRenderer(temml);

/** Text as stored html carries it. */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** What the reader's browser shows for `text` in a paragraph, and the html it drew. */
async function client(text: string): Promise<{ text: string; html: string }> {
  const article = {
    slug: "parity",
    title: "parity",
    blocks: [{ id: "spya-aaaaaa", tag: "p", kind: "text", text, words: 0, html: `<p>${esc(text)}</p>`, gistable: true }],
  } as unknown as Article;
  const out = await renderArticleMaths(sanitizeArticle(article), { load: async () => real });
  const html = out.blocks[0]!.html;
  return { html, text: renderedText(html) };
}

let bomb = String.raw`\def\z{xx}`;
let name = "z";
for (const next of ["y", "w", "v", "u", "t", "s", "r", "q"]) {
  bomb += `\\def\\${next}{\\${name}\\${name}}`;
  name = next;
}
bomb += `\\${name}`;

/**
 * Ordinary formulas of the kinds in the Newman et al. paper, the constructs
 * whose text is not simply their letters, entities, and every hostile case
 * tests/maths.test.ts uses.
 */
const CORPUS: [string, string][] = [
  ["mutual information", String.raw`so \(I(X;Y) = \sum_{x,y} P(x,y) \log_2 \frac{P(x \mid y)}{P(x)}\) is non-negative`],
  ["aligned", String.raw`\[\begin{aligned} I(X_1;Y) &= \mathrm{Red} + \mathrm{Unq} \\ H(X) &\leq \log_2 |\mathcal{X}| \end{aligned}\]`],
  ["operatorname", String.raw`the \(\operatorname{Syn}(X_1, X_2; Y)\) term`],
  ["text inside", String.raw`\(p \text{ is uniform, with equality iff } q = p\)`],
  ["entities", String.raw`\(a < b\) and \(c > d\) and \(x \& y\) and "quoted"`],
  ["dollars", String.raw`$x_1$ and $\alpha$ and $$\int_0^1 f(t)\,dt$$`],
  ["prices stay prose", "a price of $5 and $10, and $PATH/$HOME"],
  ["accents and roots", String.raw`\(\binom{n}{k}\), \(\sqrt[3]{x}\), \(\overline{AB}\), \(\vec{v}\), \(f'(x)\)`],
  ["script letters", String.raw`\(\mathcal{L} = -\sum_i y_i \log \hat{y}_i\) and \(\mathscr{F}\)`],
  ["spaces", String.raw`\(a\ b\), \(a~b\), \(a\quad b\), \(a\,b\)`],
  ["matrix", String.raw`\[\begin{pmatrix} a & \cdots \\ \vdots & \ddots \end{pmatrix}\]`],
  ["tag alone", String.raw`\[x = 1 \tag{3}\]`],
  ["macro longer than its source", String.raw`\(\def\a{xxxxxxxxxx}\a\a\a\)`],
  ["colour", String.raw`\(\color{red}{x}\)`],
  ["text with markup", String.raw`\(\text{<img src=x onerror=alert(1)>}\)`],
  ["href", String.raw`\(\href{javascript:alert(1)}{x}\)`],
  ["style", String.raw`\(\style{color:red}{x}\)`],
  ["label and tag", String.raw`\[x\label{spya-aaaaaa}\tag{1}\]`],
  ["eqref", String.raw`see \(\eqref{a}\)`],
  ["ref", String.raw`see \(\ref{a}\)`],
  ["huge rule", String.raw`\(\rule{1000000em}{1000000em}\)`],
  ["huge space", String.raw`\(a\hspace{1000000em}b\)`],
  ["bomb", `\\(${bomb}\\)`],
  ["over-long", `\\(${"x+".repeat(Math.ceil(MAX_TEX_CHARS / 2) + 1)}\\)`],
  ["unclosed", String.raw`\(x^2 and nothing closes it`],
  ["several, some refused", String.raw`\(x^2\) then \(\eqref{b}\) then \(y_1\)`],
];

describe("renderedMathsText agrees with the browser's rendered text", () => {
  for (const [name, text] of CORPUS) {
    it(name, async () => {
      const seen = await client(text);
      expect(renderedMathsText(text, real)).toBe(seen.text);
    });
  }
});

describe("the server's acceptance rule agrees with the client's", () => {
  for (const [name, text] of CORPUS) {
    const spans = findMathSpans(text);
    if (spans.length !== 1) continue;
    it(name, async () => {
      const span = spans[0]!;
      const markup = real(span.tex, span.display);
      const serverAccepts = markup !== null && acceptsMarkup(markup);
      expect(serverAccepts).toBe(rendersMaths((await client(text)).html));
    });
  }

  it("the corpus exercises both answers", async () => {
    /* Against a rule that accepted everything, or nothing, half the cases above
       would still pass. These make sure both kinds are in the corpus. */
    expect(acceptsMarkup(real("x^2", false)!)).toBe(true);
    expect(acceptsMarkup(real(String.raw`x\label{spya-aaaaaa}\tag{1}`, true)!)).toBe(false);
    expect(acceptsMarkup(real(String.raw`\eqref{a}`, false)!)).toBe(false);
  });
});
