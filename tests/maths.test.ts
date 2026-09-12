// @vitest-environment jsdom
/**
 * **TeX in the prose, drawn as maths** — src/web/maths.ts.
 *
 * jsdom, for the reason annotate.test.ts gives: the module is a DOM pass over
 * an html string, and the offset space comments are anchored in is defined by
 * the browser's own parser. A caveat that file also makes and that holds here:
 * jsdom is not Chrome or WebKit, so the parser-differential half of the
 * security argument is checked in a real browser instead — the plan's F11,
 * docs/plans/260912d-render-latex-equations-in-the-reading-view.md.
 *
 * What fails **silently** if it breaks, and is therefore pinned here:
 *
 *  - a price or a shell variable turned into italic letters (the delimiter
 *    rules, F8);
 *  - temml's markup reaching the reader without going back through the policy,
 *    or taking the app's new-tab links off with it (F3);
 *  - a formula minting an `id` that collides with a block id (F6);
 *  - a comment's mark moving to the wrong words because a formula changed the
 *    length of the text before it (F2);
 *  - temml being downloaded for an article with no maths in it.
 */
import temml from "temml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderedText, resolveMark } from "../src/web/annotate.js";
import {
  findMathSpans,
  MAX_SIZE_EM,
  MAX_SIZE_PT,
  MAX_TEX_CHARS,
  temmlRenderer,
  type RenderTex,
} from "../src/maths-tex.js";
import {
  renderArticleMaths,
  renderBlockMaths,
  rendersMaths,
} from "../src/web/maths.js";
import { sanitizeArticle, sanitizeBlockHtml } from "../src/web/sanitize.js";
import type { Article, Block } from "../src/types.js";

const real = temmlRenderer(temml);

/** A render that needs no library, so the DOM half can be pinned byte for byte. */
const FAKE: RenderTex = () => "<math><mi>x</mi></math>";

function block(id: string, html: string): Block {
  return { id, tag: "p", kind: "paragraph", text: "", words: 0, html, gistable: true } as unknown as Block;
}

function articleOf(...blocks: Block[]): Article {
  return { slug: "maths", title: "Maths", blocks } as unknown as Article;
}

function parse(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

/**
 * **A realistic long displayed equation**, of the kind the Newman et al. paper
 * behind SPIDERYARN-READING2-30 carries — a partial-information decomposition,
 * an integrated-information minimum and an entropy bound, aligned: 761
 * characters of source, and the limits in maths.ts must let it through.
 */
const LONG = String.raw`\begin{aligned}
I(X_1, X_2; Y) &= \sum_{x_1 \in \mathcal{X}_1} \sum_{x_2 \in \mathcal{X}_2} \sum_{y \in \mathcal{Y}} P(x_1, x_2, y) \log_2 \frac{P(x_1, x_2 \mid y)}{P(x_1, x_2)} \\
&= \mathrm{Red}(X_1, X_2; Y) + \mathrm{Unq}(X_1; Y \setminus X_2) + \mathrm{Unq}(X_2; Y \setminus X_1) + \mathrm{Syn}(X_1, X_2; Y) \\
I(X_1; Y) &= \mathrm{Red}(X_1, X_2; Y) + \mathrm{Unq}(X_1; Y \setminus X_2) \\
I(X_2; Y) &= \mathrm{Red}(X_1, X_2; Y) + \mathrm{Unq}(X_2; Y \setminus X_1) \\
\Phi_{\mathrm{ID}}(X) &= \min_{\mathcal{P}} \left[ \sum_{k=1}^{|\mathcal{P}|} I\!\left(M^k_{t-\tau}; M^k_t\right) - I\!\left(X_{t-\tau}; X_t\right) \right] \\
H(X) &= -\sum_{x} p(x) \log_2 p(x) \leq \log_2 |\mathcal{X}|, \qquad \text{with equality iff } p \text{ is uniform}
\end{aligned}`;

describe("findMathSpans — which text is maths", () => {
  it("finds \\( … \\) inline", () => {
    expect(findMathSpans(String.raw`\(x^2\)`)).toEqual([
      { start: 0, end: 7, tex: "x^2", display: false },
    ]);
  });

  it("finds \\[ … \\] and $$ … $$ as display", () => {
    expect(findMathSpans(String.raw`a \[\frac{a}{b}\] b`)).toEqual([
      { start: 2, end: 17, tex: String.raw`\frac{a}{b}`, display: true },
    ]);
    expect(findMathSpans("so $$x+y$$.")).toEqual([
      { start: 3, end: 10, tex: "x+y", display: true },
    ]);
  });

  it("finds $ … $ when the content is unmistakably TeX", () => {
    expect(findMathSpans("take $x_1$ first")).toEqual([
      { start: 5, end: 10, tex: "x_1", display: false },
    ]);
    expect(findMathSpans(String.raw`$\alpha$`)).toEqual([
      { start: 0, end: 8, tex: String.raw`\alpha`, display: false },
    ]);
  });

  it("finds several, left to right, without overlap", () => {
    const spans = findMathSpans(String.raw`\(a^2\) and \(b^2\) and $$c$$`);
    expect(spans.map((s) => s.tex)).toEqual(["a^2", "b^2", "c"]);
  });

  /* F8 — every one of these is prose a reader wrote, and turning it into
     italic letters is the failure the delimiter rules exist to prevent. */
  for (const prose of [
    "$5 and $10",
    "costs $5, or $6.",
    "$5-$6",
    "Set $x=$y before running it.",
    "Expand $PATH/$HOME first.",
    // No TeX signal inside: deliberately missed, and said so in docs/project/maths.md.
    "$x$",
    // An escaped dollar is never a delimiter.
    String.raw`\$x^2\$`,
    // Unclosed.
    String.raw`see \(x^2 and nothing closes it`,
    // Empty.
    String.raw`\(\) and $$ $$`,
  ]) {
    it(`leaves prose alone: ${JSON.stringify(prose)}`, () => {
      expect(findMathSpans(prose)).toEqual([]);
    });
  }

  it("an unclosed \\( does not swallow a later span", () => {
    expect(findMathSpans(String.raw`see \(x and \[y^2\]`).map((s) => s.tex)).toEqual(["y^2"]);
  });
});

describe("renderBlockMaths — the DOM edit", () => {
  it("replaces a span inside a <p>", () => {
    const out = renderBlockMaths(String.raw`<p>so \(x^2\) holds</p>`, FAKE);
    expect(out).toBe("<p>so <math><mi>x</mi></math> holds</p>");
  });

  for (const [name, html] of [
    ["code", String.raw`<p>run <code>\(x^2\)</code></p>`],
    ["pre", String.raw`<pre>echo \(x^2\) $$y$$</pre>`],
    ["kbd", String.raw`<p><kbd>\(x\)</kbd></p>`],
    ["an existing <math>", String.raw`<p><math><mtext>\(x^2\)</mtext></math></p>`],
    ["svg", String.raw`<p><svg><text>\(x^2\)</text></svg></p>`],
  ] as const) {
    it(`leaves a span inside ${name} alone, as the very same string`, () => {
      expect(renderBlockMaths(html, FAKE)).toBe(html);
    });
  }

  it("returns the very same string when nothing matched", () => {
    const html = "<p>It costs $5 and $10.</p>";
    expect(renderBlockMaths(html, FAKE)).toBe(html);
  });

  it("leaves the source when the render refuses", () => {
    const html = String.raw`<p>so \(x^2\) holds</p>`;
    expect(renderBlockMaths(html, () => null)).toBe(html);
  });

  it("changes nothing outside the replaced text — ids, data-spya-*, structure", () => {
    const html =
      `<p id="spya-k3m9qt" data-spya-src="p1">A <strong>b</strong> ` +
      String.raw`\(x^2\)` +
      ` c <a href="/x" data-spya-was-id="n1">d</a>.</p>`;
    const want = html.replace(String.raw`\(x^2\)`, "<math><mi>x</mi></math>");
    expect(renderBlockMaths(html, FAKE)).toBe(want);
  });

  it("refuses a fragment that is not one <math> element", () => {
    const html = String.raw`<p>\(x\)</p>`;
    expect(renderBlockMaths(html, () => "<b>x</b>")).toBe(html);
    expect(renderBlockMaths(html, () => "<math></math><math></math>")).toBe(html);
  });
});

describe("with the real temml", () => {
  it("turns a formula into <math>", () => {
    const out = renderBlockMaths(String.raw`<p>\(x^2\)</p>`, real);
    expect(out).toContain("<msup>");
    expect(renderedText(out)).not.toContain("\\(");
  });

  it("renders a long aligned display equation within the limits", () => {
    expect(LONG.length).toBeGreaterThan(700);
    expect(LONG.length).toBeLessThan(MAX_TEX_CHARS);
    const out = renderBlockMaths(`<p>\\[${LONG}\\]</p>`, real);
    expect(out).toContain("<mtable");
    expect(renderedText(out)).not.toContain("\\begin");
  });

  it("the rendered block is a fixed point of the sanitiser", async () => {
    const a = articleOf(
      block("spya-aaaaaa", String.raw`<p>inline \(x^2\), display \[\frac{a}{b}\], colour \(\color{red}x\)</p>`),
    );
    const out = await renderArticleMaths(a, { load: async () => real });
    const html = out.blocks[0]!.html;
    expect(html).toContain("<math");
    expect(sanitizeBlockHtml(html)).toBe(html);
  });

  for (const tex of [
    String.raw`\href{javascript:alert(1)}{x}`,
    String.raw`\style{color:red}{x}`,
    String.raw`\text{<img src=x onerror=alert(1)>}`,
  ]) {
    it(`hostile input stays inert: ${tex}`, async () => {
      /* Escaped as the stored html would have it: a `<` in the prose is `&lt;`. */
      const html = `<p>\\(${tex.replace(/</g, "&lt;").replace(/>/g, "&gt;")}\\)</p>`;
      const out = (await renderArticleMaths(articleOf(block("spya-aaaaaa", html)), { load: async () => real }))
        .blocks[0]!.html;
      const root = parse(out);
      expect(root.querySelector("img")).toBeNull();
      for (const el of root.querySelectorAll("*")) {
        for (const attr of el.attributes) {
          expect(attr.name, `${el.tagName} carries ${attr.name}`).not.toMatch(/^on|^href$|^style$|^xlink:href$/i);
        }
      }
    });
  }

  it("leaves \\label/\\tag and \\eqref as source, with no id and no href (F6)", () => {
    /* The positive control: without the refusal, temml really does mint the id. */
    expect(temml.renderToString(String.raw`x\label{spya-aaaaaa}\tag{1}`, { displayMode: true })).toContain(
      `id="spya-aaaaaa"`,
    );
    for (const html of [
      String.raw`<p>\[x\label{spya-aaaaaa}\tag{1}\]</p>`,
      String.raw`<p>see \(\eqref{a}\)</p>`,
      String.raw`<p>see \(\ref{a}\)</p>`,
    ]) {
      const out = renderBlockMaths(html, real);
      expect(out).toBe(html);
      expect(out).not.toMatch(/\sid=|\shref=|\sname=/);
    }
  });

  /** Every dimension temml wrote, in the units it wrote them in. */
  function dimensions(html: string): { value: number; unit: string }[] {
    const found: { value: number; unit: string }[] = [];
    for (const el of parse(html).querySelectorAll("*")) {
      for (const name of ["width", "height", "depth", "voffset", "lspace"]) {
        const m = el.getAttribute(name)?.match(/^(-?[\d.]+)(em|pt)$/);
        if (m) found.push({ value: Math.abs(Number(m[1])), unit: m[2]! });
      }
    }
    return found;
  }

  for (const tex of [
    String.raw`\rule{1000000em}{1000000em}`,
    String.raw`\hspace{1000000em}`,
    String.raw`\rule{1000000pt}{1000000cm}`,
    String.raw`\raisebox{1000000em}{x}`,
  ]) {
    it(`bounds a huge box: ${tex} (F5)`, () => {
      const out = renderBlockMaths(`<p>\\(${tex}\\)</p>`, real);
      const dims = dimensions(out);
      expect(dims.length, "the probe must find a dimension to check").toBeGreaterThan(0);
      for (const d of dims) {
        expect(d.value).toBeLessThanOrEqual(d.unit === "em" ? MAX_SIZE_EM : MAX_SIZE_PT);
      }
    });
  }

  it("leaves a macro-expansion bomb as source (F5)", () => {
    /* Nine doublings: 512 copies, which temml's own default (1000) would draw. */
    let defs = String.raw`\def\z{xx}`;
    let name = "z";
    for (const next of ["y", "w", "v", "u", "t", "s", "r", "q"]) {
      defs += `\\def\\${next}{\\${name}\\${name}}`;
      name = next;
    }
    const html = `<p>\\(${defs}\\${name}\\)</p>`;
    expect(renderBlockMaths(html, real)).toBe(html);
  });

  it("leaves an over-long span as source (F5)", () => {
    const tex = "x+".repeat(Math.ceil(MAX_TEX_CHARS / 2) + 1);
    const html = `<p>\\(${tex}\\)</p>`;
    expect(renderBlockMaths(html, real)).toBe(html);
  });
});

describe("renderArticleMaths — the article, at ingress", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the new-tab links the second sanitise would strip (F3)", async () => {
    const a = sanitizeArticle(
      articleOf(block("spya-aaaaaa", String.raw`<p>See <a href="https://example.com/x">this</a> and \(x^2\).</p>`)),
    );
    expect(a.blocks[0]!.html, "precondition: ingress aimed it at a new tab").toContain(`target="_blank"`);
    const html = (await renderArticleMaths(a, { load: async () => real })).blocks[0]!.html;
    expect(html).toContain("<math");
    expect(html).toContain(`target="_blank"`);
    expect(html).toContain(`rel="noopener noreferrer"`);
  });

  it("never loads temml for an article with no maths, and hands back the same article", async () => {
    const load = vi.fn(async () => FAKE);
    const a = articleOf(
      block("spya-aaaaaa", "<p>It costs $5 and $10.</p>"),
      block("spya-bbbbbb", String.raw`<p>run <code>\(x^2\)</code></p>`),
    );
    expect(await renderArticleMaths(a, { load })).toBe(a);
    expect(load).not.toHaveBeenCalled();
  });

  it("loads once, and keeps every unchanged block by identity", async () => {
    const load = vi.fn(async () => real);
    const a = articleOf(
      block("spya-aaaaaa", String.raw`<p>\(x^2\)</p>`),
      block("spya-bbbbbb", "<p>plain</p>"),
      block("spya-cccccc", String.raw`<p>\(y^2\)</p>`),
    );
    const out = await renderArticleMaths(a, { load });
    expect(load).toHaveBeenCalledTimes(1);
    expect(out).not.toBe(a);
    expect(out.blocks[1]).toBe(a.blocks[1]);
    expect(out.blocks[0]!.html).toContain("<math");
    expect(out.blocks[0]!.id).toBe("spya-aaaaaa");
    /* What TableView reads is the block after the second sanitise, so the
       provenance F2 hangs off has to survive it. */
    expect(rendersMaths(out.blocks[0]!)).toBe(true);
    expect(rendersMaths(out.blocks[1]!)).toBe(false);
    /* rehostImages rebuilds changed blocks with this shape. */
    expect(rendersMaths({ ...out.blocks[0]!, html: out.blocks[0]!.html })).toBe(true);
  });

  it("a failed load is the article unchanged, and quiet", async () => {
    const noise = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log")];
    const a = articleOf(block("spya-aaaaaa", String.raw`<p>\(x^2\)</p>`));
    const out = await renderArticleMaths(a, {
      load: async () => {
        throw new Error("offline");
      },
    });
    expect(out).toBe(a);
    for (const spy of noise) expect(spy).not.toHaveBeenCalled();
  });

  it("a released load is the article unchanged", async () => {
    const stop = new AbortController();
    const a = articleOf(block("spya-aaaaaa", String.raw`<p>\(x^2\)</p>`));
    const load = vi.fn(async () => {
      stop.abort();
      return real;
    });
    expect(await renderArticleMaths(a, { load, signal: stop.signal })).toBe(a);
  });
});

describe("an offset recorded before the render is not trusted after it (F2)", () => {
  it("draws no mark rather than moving to the second of two identical phrases", async () => {
    const html = `<p>Consider \\[${LONG}\\] where the cat sat on the mat, and again the cat sat on the mat.</p>`;
    const before = renderedText(html);
    const anchor = { quote: "the cat sat", start: before.indexOf("the cat sat") };

    const renderedBlock = (await renderArticleMaths(articleOf(block("spya-aaaaaa", html)), {
      load: async () => real,
    })).blocks[0]!;
    const rendered = renderedBlock.html;
    const after = renderedText(rendered);
    /* The hazard, demonstrated: the formula's symbols are far shorter than its
       source, so the old offset is now nearer the SECOND phrase, and the
       ordinary rule would move the mark there. */
    expect(resolveMark(after, anchor)?.start).toBe(after.lastIndexOf("the cat sat"));

    expect(rendersMaths(renderedBlock)).toBe(true);
    expect(resolveMark(after, anchor, { offsetTrusted: !rendersMaths(renderedBlock) })).toBeNull();
  });

  it("a block with no rendered maths is not flagged, so it keeps the ordinary rule", () => {
    expect(rendersMaths(block("spya-aaaaaa", "<p>the cat sat</p>"))).toBe(false);
    expect(rendersMaths(block("spya-aaaaaa", "<p><math><mi>x</mi></math></p>"))).toBe(false);
  });

  it("does not let an article forge the marker that makes offsets untrusted", () => {
    const forged = block(
      "spya-aaaaaa",
      '<p><math class="rendered-maths"><mi>x</mi></math> first; first</p>',
    );
    const text = "x first; first";
    const anchor = { quote: "first", start: text.lastIndexOf("first") };
    expect(rendersMaths(forged)).toBe(false);
    expect(resolveMark(text, anchor, { offsetTrusted: !rendersMaths(forged) })).toEqual({
      start: anchor.start,
      end: anchor.start + anchor.quote.length,
    });
  });
});
