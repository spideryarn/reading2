/**
 * **A LaTeXML page (arXiv's HTML, ar5iv), put into the shapes the pipeline reads.**
 *
 * Five rewrites in src/latexml.ts and the byline, each red before it was built.
 * The fixtures under tests/fixtures/latexml/ are cut from the five papers of
 * docs/investigations/261005e-arxiv-html-rendering-against-its-pdf-through-our-pipeline.md
 * (the smallest element that shows the fault, markup verbatim, inline styles
 * dropped, prose and addresses replaced). Every rewrite has its negative twins:
 * the same markup outside `article.ltx_document`, an authored sibling the shape
 * does not allow, and a link pointing at an id the rewrite would delete.
 *
 * docs/plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md
 * § *Stage: the HTML arm's faults*. The table inside a list item (its fix 4) is
 * in tests/extract-protect-list-item-tables.test.ts: it turned out to be the
 * prose-retention fallback (src/protect.ts), not a shape of LaTeXML's.
 */
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";

import { splitIntoBlocks } from "../src/blocks.js";
import { runExtract } from "../src/extract.js";
import { latexmlAuthorNames, prepareLatexml } from "../src/latexml.js";
import { canonicaliseMaths } from "../src/maths-import.js";
import { loadMathsRenderer, texWouldDraw } from "../src/maths-server.js";
import { findMathSpans } from "../src/maths-tex.js";
import { metaAuthors } from "../src/meta-authors.js";

/* temml: without it no formula "would draw", and fix 1 leaves every equation alone. */
beforeAll(loadMathsRenderer);

const fx = (name: string) =>
  readFileSync(new URL(`./fixtures/latexml/${name}.html`, import.meta.url), "utf8").replace(/^<!--[\s\S]*?-->\n/u, "");

const pageWith = (articleClass: string, body: string) =>
  `<!doctype html><html lang="en"><head><title>A Paper</title></head><body><article class="${articleClass}">${body}</article></body></html>`;
const latexml = (body: string) => pageWith("ltx_document ltx_authors_1line", body);
const notLatexml = (body: string) => pageWith("post", body);
const documentAt = (html: string, url = "https://arxiv.org/html/2605.20355v1") => new JSDOM(html, { url }).window.document;

function prepared(html: string, url = "https://arxiv.org/html/2605.20355v1") {
  const doc = documentAt(html, url);
  const before = doc.body.innerHTML;
  const stats = prepareLatexml(doc);
  return { doc, stats, unchanged: doc.body.innerHTML === before };
}

const NOTHING = { alignedEquations: 0, equationGroupsLeftAlone: 0, svgObjects: 0, listings: 0, boxedPassages: 0 };

it("does not treat an ordinary page as LaTeXML from article.ltx_document alone", () => {
  const { unchanged, stats } = prepared(latexml(fx("listing")), "https://example.test/an-ordinary-page");
  expect(unchanged).toBe(true);
  expect(stats).toEqual(NOTHING);
});

const prose = Array.from(
  { length: 8 },
  (_, i) =>
    `<div class="ltx_para"><p class="ltx_p">Paragraph ${i} of ordinary prose, long enough that Readability keeps this article rather than deciding the page is a navigation shell with nothing in it. It carries on for a sentence or two more.</p></div>`,
).join("\n");

/** The page through the real stage 2 and stage 3: what a reader gets. */
async function blocksOf(body: string) {
  const out = await runExtract({
    html: latexml(`<h1 class="ltx_title ltx_title_document">A Paper</h1><section class="ltx_section">${prose}${body}${prose}</section>`),
    url: "https://arxiv.org/html/2605.20355v1",
    slug: "latexml-test",
  });
  return { out, blocks: splitIntoBlocks(out.extractedHtml).blocks };
}

describe("fix 1 — an aligned equation is one display formula", () => {
  /** The one formula in a rewritten group: its TeX, and the text beside it. */
  function formulaOf(table: Element) {
    const text = table.textContent ?? "";
    const spans = findMathSpans(text);
    expect(spans).toHaveLength(1);
    const tex = /\\\[([\s\S]*)\\\]/u.exec(text)?.[1] ?? "";
    return { tex, text, beside: text.replace(/\\\[[\s\S]*\\\]/u, "").trim() };
  }

  it("equation (1) of 2605.20355v1: two rows, two cells, one number — one formula, the number beside it", () => {
    const { doc, stats } = prepared(latexml(`<p>See <a href="#S3.E1">(1)</a>.</p>${fx("equation-group-one-tbody")}`));
    expect(stats).toEqual({ ...NOTHING, alignedEquations: 1 });
    const table = doc.querySelector('table[id="S3.E1"]');
    expect(table).not.toBeNull();
    expect(table?.querySelectorAll("math")).toHaveLength(0);
    const { tex, beside } = formulaOf(table as Element);
    expect(tex).toBe(
      [
        "\\begin{aligned}",
        "\\pi_{\\mathrm{shared}}(a\\mid s)",
        "& \\triangleq\\alpha\\,\\pi_{\\mathrm{expert}}(a\\mid s) \\\\",
        "& +(1-\\alpha)\\,\\pi_{\\mathrm{student}}(a\\mid s),\\qquad\\alpha\\in[0,1].",
        "\\end{aligned}",
      ].join("\n"),
    );
    expect(beside).toBe("(1)");
    expect(texWouldDraw(tex, true)).toBe(true);
    /* One row of the single-line equation's own shape, which stage 3 already reads. */
    expect(table?.querySelectorAll("tr")).toHaveLength(1);
    /* And the later maths pass has nothing left to do to it. */
    const html = table?.outerHTML;
    canonicaliseMaths(doc);
    expect(table?.outerHTML).toBe(html);
  });

  it("the multi-tbody form (eq. 8 of 2610.01988v1): the row a link points at keeps its id", () => {
    const { doc, stats } = prepared(latexml(`<p>By <a href="#S2.E8">eq. 8</a>.</p>${fx("equation-group-align")}`));
    expect(stats.alignedEquations).toBe(1);
    const table = doc.querySelector('table[id="S2.EGx1"]') as Element;
    expect(table.querySelector('[id="S2.E8"]')).not.toBeNull();
    const { tex, beside } = formulaOf(table);
    expect(tex.split("\\\\\n")).toHaveLength(2);
    expect(tex).toContain("G_{\\mu\\nu}^{a}\n& =e^{g_{j}\\phi/\\Lambda}");
    expect(tex).not.toContain("\\displaystyle");
    expect(beside).toBe("(8)");
  });

  it("keeps a number written on the left on the left (2610.01658v1)", () => {
    const { doc, stats } = prepared(latexml(fx("equation-group-number-on-the-left")));
    expect(stats.alignedEquations).toBe(1);
    const text = doc.querySelector("table")?.textContent?.trim() ?? "";
    expect(text).toMatch(/^\(\d+\)\s*\\\[/u);
  });

  it("writes a one-cell row with no alignment point (2610.03261v1)", () => {
    const { doc, stats } = prepared(latexml(fx("equation-group-one-cell")));
    expect(stats.alignedEquations).toBe(1);
    const { tex, beside } = formulaOf(doc.querySelector("table") as Element);
    expect(tex).not.toContain("&");
    expect(beside).toBe("(3)");
  });

  it("a reader gets one block holding one display formula", async () => {
    const { blocks } = await blocksOf(fx("equation-group-one-tbody"));
    const withMaths = blocks.filter((b) => b.text.includes("\\pi_{\\mathrm{shared}}"));
    expect(withMaths).toHaveLength(1);
    expect(withMaths[0]?.text).toMatch(/^\\\[\\begin\{aligned\}[\s\S]*\\end\{aligned\}\\\]\s*\(1\)$/u);
  });

  describe("left exactly as the page had it", () => {
    it("several independently numbered rows", () => {
      const { stats, unchanged } = prepared(latexml(fx("equation-group-two-numbers")));
      expect(unchanged).toBe(true);
      expect(stats).toEqual({ ...NOTHING, equationGroupsLeftAlone: 1 });
    });

    it("four formula cells in a row", () => {
      const { stats, unchanged } = prepared(latexml(fx("equation-group-four-cells")));
      expect(unchanged).toBe(true);
      expect(stats.equationGroupsLeftAlone).toBe(1);
    });

    it("the same markup outside article.ltx_document", () => {
      const { stats, unchanged } = prepared(notLatexml(fx("equation-group-one-tbody")));
      expect(unchanged).toBe(true);
      expect(stats).toEqual(NOTHING);
    });

    it("another alignment environment's class", () => {
      for (const cls of ["ltx_eqn_gather", "ltx_eqn_eqnarray", "anything_else"]) {
        const html = fx("equation-group-align").replace("ltx_eqn_align ", `ltx_eqn_align ${cls} `);
        expect(html).toContain(cls);
        expect(prepared(latexml(html)).unchanged, cls).toBe(true);
      }
    });

    it("an authored sibling the shape does not allow", () => {
      const fixture = fx("equation-group-one-tbody");
      const extraRow = fixture.replace("</tbody>", '<tr><td colspan="4">and so, as the author wrote between the lines,</td></tr></tbody>');
      const extraInCell = fixture.replace("</math></td>", "</math> <em>authored words</em></td>");
      const textInTable = fixture.replace("</tr></tbody>", '</tr></tbody><tbody><tr class="ltx_equation ltx_eqn_row"><td class="ltx_td ltx_eqn_cell">words</td></tr></tbody>');
      for (const [name, html] of Object.entries({ extraRow, extraInCell, textInTable })) {
        expect(html, name).not.toBe(fixture);
        const { stats, unchanged } = prepared(latexml(html));
        expect(unchanged, name).toBe(true);
        expect(stats.equationGroupsLeftAlone, name).toBe(1);
      }
    });

    it("a link pointing at an id the rewrite would delete (a cell's formula)", () => {
      const { unchanged } = prepared(latexml(`<p><a href="#S3.E1X.m2">the left side</a></p>${fx("equation-group-one-tbody")}`));
      expect(unchanged).toBe(true);
    });

    it("more linked rows than the one row left can carry", () => {
      const fixture = fx("equation-group-one-tbody").replace("<tbody>", '<tbody id="body">');
      const links = '<a href="#S3.E1X">a</a><a href="#S3.E1Xa">b</a><a href="#body">c</a>';
      expect(prepared(latexml(`<p>${links}</p>${fixture}`)).unchanged).toBe(true);
      /* Two fit: the row and its tbody each carry one. */
      const two = prepared(latexml(`<p><a href="#S3.E1X">a</a><a href="#S3.E1Xa">b</a></p>${fixture}`));
      expect(two.stats.alignedEquations).toBe(1);
      expect(two.doc.querySelector('table [id="S3.E1X"]')).not.toBeNull();
      expect(two.doc.querySelector('table [id="S3.E1Xa"]')).not.toBeNull();
    });

    it("TeX the reading view would not draw", () => {
      const broken = fx("equation-group-one-tbody").replace(/\\displaystyle\\triangleq/gu, "\\displaystyle\\notacommand{");
      expect(broken).toContain("\\notacommand{");
      expect(prepared(latexml(broken)).unchanged).toBe(true);
    });

    it("TeX that would end its own span", () => {
      const closes = fx("equation-group-one-tbody").replace(/\\displaystyle\\triangleq/gu, "\\displaystyle\\]\\triangleq");
      expect(prepared(latexml(closes)).unchanged).toBe(true);
    });

    it("a cell whose TeX only becomes valid after the injected alignment syntax", () => {
      for (const source of ["a &amp; b", String.raw`x \\ y`]) {
        const html = fx("equation-group-one-tbody").replace(
          /<annotation encoding="application\/x-tex">[^<]*<\/annotation>/u,
          `<annotation encoding="application/x-tex">${source}</annotation>`,
        );
        expect(html).not.toBe(fx("equation-group-one-tbody"));
        expect(prepared(latexml(html)).unchanged, source).toBe(true);
      }
    });
  });

  /** `equation-group-one-tbody` with its first formula's TeX source replaced. */
  const withFirstCell = (source: string): string => {
    const html = fx("equation-group-one-tbody").replace(
      /<annotation encoding="application\/x-tex">[^<]*<\/annotation>/u,
      () => `<annotation encoding="application/x-tex">${source}</annotation>`,
    );
    expect(html).not.toBe(fx("equation-group-one-tbody"));
    return html;
  };

  it("joins a cell whose rows and columns are inside an environment of its own (2610.01658v1)", () => {
    const cases = String.raw`\begin{cases}1&amp;\text{if }n=0,\\ 0&amp;\text{otherwise.}\end{cases}`;
    const { doc, stats } = prepared(latexml(withFirstCell(cases)));
    expect(stats.alignedEquations).toBe(1);
    expect(formulaOf(doc.querySelector("table") as Element).tex).toContain(
      String.raw`\begin{cases}1&\text{if }n=0,\\ 0&\text{otherwise.}\end{cases}`,
    );
  });

  it("leaves a cell whose environments do not balance, or whose control is outside them", () => {
    for (const source of [
      String.raw`\begin{cases}1&amp;2`,
      String.raw`\begin{cases}1\end{cases} &amp; 2`,
      String.raw`1\end{cases}`,
    ]) {
      expect(prepared(latexml(withFirstCell(source))).unchanged, source).toBe(true);
    }
  });

  it("keeps the alignment point when the right-hand formula cell is empty", () => {
    const fixture = fx("equation-group-one-tbody");
    const html = fixture.replace(
      /<td class="ltx_td ltx_align_left ltx_eqn_cell"><math[\s\S]*?<\/math><\/td>/u,
      '<td class="ltx_td ltx_align_left ltx_eqn_cell"></td>',
    );
    expect(html).not.toBe(fixture);
    const { doc, stats } = prepared(latexml(html));
    expect(stats.alignedEquations).toBe(1);
    const { tex } = formulaOf(doc.querySelector("table") as Element);
    const firstRow = tex.split(" \\\\\n")[0] ?? "";
    expect(firstRow).toContain("&");
  });

  it("does not touch a single-line equation, which the maths pass already makes one display formula", () => {
    const { doc, stats, unchanged } = prepared(latexml(fx("equation-single-line")));
    expect(unchanged).toBe(true);
    expect(stats).toEqual(NOTHING);
    expect(canonicaliseMaths(doc)).toBe(1);
    expect(doc.querySelector("table")?.textContent?.trim()).toMatch(/^\\\[A_\{\\mu\}\^\{a\}=[\s\S]*\\\]\s*\(1\)$/u);
  });
});

describe("fix 2 — an SVG plot in an <object> is an image", () => {
  it("becomes an <img> with the same address, id and dimensions (Figure 2 of 2610.01988v1)", () => {
    const { doc, stats } = prepared(latexml(fx("figure-svg-object")));
    expect(stats).toEqual({ ...NOTHING, svgObjects: 1 });
    expect(doc.querySelector("object")).toBeNull();
    const img = doc.querySelector("figure > img");
    expect(img?.getAttribute("src")).toBe("2610.01988v1/glueball_monopole_vs_lattice.svg");
    expect(img?.id).toBe("S5.F2.g1");
    expect(img?.getAttribute("width")).toBe("238");
    expect(img?.getAttribute("height")).toBe("179");
    expect(img?.hasAttribute("type")).toBe(false);
    expect(img?.hasAttribute("data")).toBe(false);
  });

  it("a panel of a multi-part figure, one wrapper down (ar5iv 1706.03762, Figure 4)", () => {
    const panel = fx("figure-svg-object").replace(/(<object[^>]*><\/object>)/u, '<div class="ltx_flex_figure"><div class="ltx_flex_cell ltx_flex_size_1">$1</div></div>');
    expect(panel).toContain("ltx_flex_cell");
    const { doc, stats } = prepared(latexml(panel));
    expect(stats.svgObjects).toBe(1);
    expect(doc.querySelector("figure .ltx_flex_cell > img")?.id).toBe("S5.F2.g1");
  });

  it("a reader gets the figure with its picture, addressed at the publisher", async () => {
    const { out } = await blocksOf(fx("figure-svg-object"));
    const doc = new JSDOM(out.extractedHtml).window.document;
    expect(doc.querySelector("figure img")?.getAttribute("src")).toBe(
      "https://arxiv.org/html/2610.01988v1/glueball_monopole_vs_lattice.svg",
    );
    /* That it is then left hot-linked rather than hosted is stage 4.5's standing
       answer for every SVG: tests/assets.test.ts (`sniffImage` is null for SVG
       bytes) and tests/collect-assets.test.ts (`unsupported-format`). */
  });

  describe("left exactly as the page had it", () => {
    const fixture = fx("figure-svg-object");
    it("an object with fallback children", () => {
      const html = fixture.replace("></object>", "><p>The plot, described in words.</p></object>");
      expect(html).not.toBe(fixture);
      expect(prepared(latexml(html))).toMatchObject({ unchanged: true, stats: NOTHING });
      const text = fixture.replace("></object>", ">A plot.</object>");
      expect(prepared(latexml(text)).unchanged).toBe(true);
    });
    it("an object of another type, or with no address", () => {
      expect(prepared(latexml(fixture.replace("image/svg+xml", "application/pdf"))).unchanged).toBe(true);
      expect(prepared(latexml(fixture.replace(/ data="[^"]*"/u, ""))).unchanged).toBe(true);
    });
    it("an object that is not in a figure", () => {
      const bare = fixture.replace(/<figure[^>]*>/u, "<div>").replace("</figure>", "</div>").replace(/<figcaption[\s\S]*<\/figcaption>/u, "");
      expect(bare).not.toContain("<figure");
      expect(prepared(latexml(bare)).unchanged).toBe(true);
    });
    it("the same markup outside article.ltx_document", () => {
      expect(prepared(notLatexml(fixture))).toMatchObject({ unchanged: true, stats: NOTHING });
    });
  });
});

describe("fix 3 — a code listing is one code block", () => {
  it("becomes one <pre>, a line per line, the spans and their ids kept (Appendix F of 2608.13566)", () => {
    const { doc, stats } = prepared(latexml(fx("listing")));
    expect(stats).toEqual({ ...NOTHING, listings: 1 });
    const pre = doc.querySelector("pre");
    expect(pre?.id).toBe("A6.SS1.SSS0.Px1.p1.2");
    expect(doc.querySelector(".ltx_listing, .ltx_listingline, .ltx_listing_data")).toBeNull();
    const lines = (pre?.textContent ?? "").split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^You are a helpful Python /u);
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("**Output rules**");
    expect(pre?.querySelector('[id="lstnumberx3.2"]')?.textContent).toBe("Output");
  });

  it("a reader gets one code block", async () => {
    const { blocks } = await blocksOf(fx("listing"));
    const code = blocks.filter((b) => b.kind === "code");
    expect(code).toHaveLength(1);
    expect(code[0]?.text.split("\n")).toHaveLength(3);
    expect(code[0]?.text).toContain("**Output rules**");
    expect(blocks.filter((b) => b.kind !== "code" && b.text.includes("Output rules"))).toHaveLength(0);
  });

  describe("left exactly as the page had it", () => {
    const fixture = fx("listing");
    it("an algorithm set as a listing, with formulas in its lines (2605.20355v1)", () => {
      /* A formula in a <pre> is never drawn (MATHS_SKIP_TAGS), so it stays prose. */
      expect(prepared(latexml(fx("listing-algorithm-with-maths")))).toMatchObject({ unchanged: true, stats: NOTHING });
    });
    it("an authored sibling among the lines", () => {
      const html = fixture.replace('<div id="lstnumberx2"', '<p>A remark between the lines.</p><div id="lstnumberx2"');
      expect(html).not.toBe(fixture);
      expect(prepared(latexml(html)).unchanged).toBe(true);
      const text = fixture.replace('<div id="lstnumberx2"', 'stray words<div id="lstnumberx2"');
      expect(prepared(latexml(text)).unchanged).toBe(true);
    });
    it("a line a link points at", () => {
      expect(prepared(latexml(`<p><a href="#lstnumberx2">line 2</a></p>${fixture}`)).unchanged).toBe(true);
    });
    it("a download cell that holds anything but the publisher's data link", () => {
      const html = fixture.replace(/<a href="data:[^"]*" download="">⬇<\/a>/u, '<a href="https://example.test/code.py">the code</a>');
      expect(html).not.toBe(fixture);
      expect(prepared(latexml(html)).unchanged).toBe(true);
    });
    it("a visible data link that is not a download control", () => {
      const html = fixture.replace(/<a href="(data:[^"]*)" download="">⬇<\/a>/u, '<a href="$1">LICENSE: attribution required</a>');
      expect(html).not.toBe(fixture);
      expect(prepared(latexml(html)).unchanged).toBe(true);
    });
    it("source-formatting whitespace between a line's inline children", () => {
      const html = fixture.replace(/<\/span><span id="lstnumberx1\.2"/u, '</span>\n  <span id="lstnumberx1.2"');
      expect(html).not.toBe(fixture);
      expect(prepared(latexml(html)).unchanged).toBe(true);
    });
    it("the same markup outside article.ltx_document", () => {
      expect(prepared(notLatexml(fixture))).toMatchObject({ unchanged: true, stats: NOTHING });
    });
  });
});

describe("fix 5 — the byline is the paper's authors", () => {
  const NAMES: Record<string, string[]> = {
    "2608-13566": [
      "Egor Shibaev",
      "Vera Kudrevskaia",
      "Timur Galimzyanov",
      "Mikhail Evtikhiev",
      "Ana Terna",
      "Rastislav Rabatin",
      "Timur Kudashev",
      "Timofey Bryksin",
      "Arina Puchkova",
      "Patrik Bartak",
      "Egor Bogomolov",
      "Sergey Titov",
    ],
    "2605-20355v1": [
      "Megha Srivastava",
      "Jonathan Ouyang",
      "Eric Zhou",
      "Andrew Silva",
      "Emily Sumner",
      "Dorsa Sadigh",
      "Yuchen Cui",
      "Deepak Gopinath",
      "Guy Rosman",
    ],
    /* Joined by " and " in the page; Readability's byline was the word "and". */
    "2610-01658v1": ["Kais Hamza", "Laurent Tournier"],
    "2610-03261v1": ["Elena Morotti", "Davide Evangelista", "Elena Loli Piccolomini"],
    /* Each name carries an ORCID link with an SVG logo in it. */
    "2610-01988v1": ["Adamu Issifu", "Orlando Oliveira", "Tobias Frederico"],
    /* Joined by ", " and a last " and ". */
    "2610-08790": ["Jiraphon Yenphraphai", "Fang Li", "Tianshuo Xu", "Depu Meng", "Quentin Herau", "Yihan Hu", "Raymond A. Yeh", "Wei Zhan"],
    /* A \thanks footnote set after the personname, not inside it; the second name carries its mark inside. */
    "2610-08785": ["Kevin Zhang", "Stephen Bates"],
    /* The same footnote, with the affiliations after it. */
    "2610-08392": ["Ilya Auslender", "Yasaman Heydari", "Asiye Malkoç"],
    /* The second name is the text of its own ORCID link. */
    "2610-08750": ["Jose Eduardo Escrig Molina", "Daniel Probst"],
  };

  for (const [slug, names] of Object.entries(NAMES)) {
    it(`reads the names of ${slug}, in the page's order, and nothing else`, () => {
      const doc = documentAt(latexml(fx(`authors-${slug}`)));
      expect(latexmlAuthorNames(doc)).toEqual(names);
      /* The same path a page's declared authors take, names only. */
      expect(metaAuthors(doc)).toEqual(names.map((name) => ({ name, affiliations: [] })));
    });
  }

  it("is the byline and the author list stage 2 stores", async () => {
    const { out } = await blocksOf(fx("authors-2610-01658v1"));
    expect(out.meta.byline).toBe("Kais Hamza; Laurent Tournier");
    expect(out.meta.authors).toEqual([
      { name: "Kais Hamza", affiliations: [] },
      { name: "Laurent Tournier", affiliations: [] },
    ]);
  });

  it("a page that declares its authors in metadata is read from there", () => {
    const html = latexml(fx("authors-2610-01658v1")).replace("<title>", '<meta name="citation_author" content="Doe, Jane"><title>');
    expect(metaAuthors(documentAt(html))).toEqual([{ name: "Jane Doe", affiliations: [] }]);
  });

  describe("leaves the byline to Readability when the shape is not one it knows", () => {
    const fixture = fx("authors-2610-01658v1");
    const names = (html: string) => latexmlAuthorNames(documentAt(html));
    it("the same markup outside article.ltx_document", () => {
      expect(names(notLatexml(fixture))).toBeNull();
      expect(metaAuthors(documentAt(notLatexml(fixture)))).toBeNull();
    });
    it("several names in one personname (older LaTeXML: commas, line breaks, affiliations)", () => {
      const html = (inner: string) =>
        latexml(`<div class="ltx_authors"><span class="ltx_creator ltx_role_author"><span class="ltx_personname">${inner}</span></span></div>`);
      expect(names(html("Jane Doe"))).toEqual(["Jane Doe"]);
      expect(names(html("Jane Doe<sup>1</sup>"))).toEqual(["Jane Doe"]);
      expect(names(html("Jane Doe, John Smith"))).toBeNull();
      expect(names(html("Jane Doe and John Smith"))).toBeNull();
      expect(names(html('Jane Doe<br class="ltx_break">University of Somewhere'))).toBeNull();
      expect(names(html("Jane Doe jane@example.test"))).toBeNull();
      expect(names(html("Jane Doe<sup>1</sup> John Smith<sup>2</sup>"))).toBeNull();
      expect(names(html(""))).toBeNull();
    });
    it("an authored sibling among the creators, or two author blocks", () => {
      const sibling = fixture.replace('<div class="ltx_authors">', '<div class="ltx_authors"><p>With thanks to the referees.</p>');
      expect(sibling).not.toBe(fixture);
      expect(names(latexml(sibling))).toBeNull();
      expect(names(latexml(fixture + fixture))).toBeNull();
    });
    it("one creator it cannot read spoils the list rather than shortening it", () => {
      const html = fixture.replace("Laurent Tournier", "Laurent Tournier, Université Sorbonne Paris Nord");
      expect(html).not.toBe(fixture);
      expect(names(latexml(html))).toBeNull();
    });
    it("an author separator with elements or words other than 'and'", () => {
      const nested = fixture.replace('<span class="ltx_author_before"> and </span>', '<span class="ltx_author_before"><span>Ada Lovelace</span></span>');
      const words = fixture.replace('<span class="ltx_author_before"> and </span>', '<span class="ltx_author_before">University of Oxford</span>');
      expect(names(latexml(nested))).toBeNull();
      expect(names(latexml(words))).toBeNull();
    });
    it("a comma between creators is a separator; a comma with words is not", () => {
      const comma = fx("authors-2610-08790");
      for (const between of [", and ", ", Jr., ", "; ", ", University of Oxford, "]) {
        const html = comma.replace('<span class="ltx_author_before">, </span>', `<span class="ltx_author_before">${between}</span>`);
        expect(html, between).not.toBe(comma);
        expect(names(latexml(html)), between).toBeNull();
      }
    });
    it("a footnote beside the personname hides nobody: a second personname or loose words after it still refuse", () => {
      const noted = fx("authors-2610-08785");
      const after = '<span class="ltx_note_type">thanks: </span>EECS, MIT, Cambridge MA, USA.</span></span></span>';
      expect(noted).toContain(after);
      expect(names(latexml(noted.replace(after, `${after}<span class="ltx_personname">John Smith</span>`)))).toBeNull();
      expect(names(latexml(noted.replace(after, `${after} John Smith`)))).toBeNull();
      /* Only the footnote LaTeXML makes of \thanks: another element in its place is not read past. */
      const other = noted.replace('class="ltx_note ltx_note_frontmatter ltx_thanks_note ltx_role_thanks"', 'class="ltx_text"');
      expect(other).not.toBe(noted);
      expect(names(latexml(other))).toBeNull();
    });
    it("a link around a name is read only when it is the person's ORCID and holds the name alone", () => {
      const linked = fx("authors-2610-08750");
      const orcid = 'href="https://orcid.org/0000-0003-1737-4407"';
      expect(linked).toContain(orcid);
      for (const href of ['href="https://github.com/someone/code"', 'href="https://orcid.org.example.test/0000-0003-1737-4407"', 'href="https://orcid.org/"']) {
        expect(names(latexml(linked.replace(orcid, href))), href).toBeNull();
      }
      for (const inside of ["Daniel Probst, John Smith", "Daniel Probst and John Smith", 'Daniel Probst <span class="ltx_text">Code</span>']) {
        const html = linked.replace("Daniel Probst</a>", `${inside}</a>`);
        expect(html, inside).not.toBe(linked);
        expect(names(latexml(html)), inside).toBeNull();
      }
      /* Words beside the link are a second thing in the personname. */
      for (const [from, to] of [
        ["Daniel Probst</a>", "Daniel Probst</a> John Smith"],
        ['<span class="ltx_personname"><a href="https://orcid', '<span class="ltx_personname">John Smith <a href="https://orcid'],
      ] as const) {
        expect(linked, from).toContain(from);
        expect(names(latexml(linked.replace(from, to))), to).toBeNull();
      }
    });
    it("institutions and icon links marked up as creators (2610.08781): nothing is read", () => {
      const fixture08781 = fx("authors-2610-08781");
      expect(fixture08781).toContain("Tata Consultancy Services");
      expect(fixture08781).toContain('<span class="ltx_text ltx_font_typewriter">Code</span></a>');
      expect(names(latexml(fixture08781))).toBeNull();
      expect(metaAuthors(documentAt(latexml(fixture08781)))).toBeNull();
      /* Each kind of creator in it refuses on its own: a name with a formula after it, an
         institution with one before it, and a link that is not a name. */
      const creators = fixture08781.replace(/^<div class="ltx_authors">\n|<\/div>\n?$/gu, "").split(/\n<span class="ltx_author_before">\s*<\/span>/u);
      expect(creators).toHaveLength(9);
      for (const creator of creators) expect(names(latexml(`<div class="ltx_authors">${creator}</div>`)), creator.slice(0, 120)).toBeNull();
      /* And the two links are not names even with nothing else on the page. */
      const links = creators.filter((creator) => creator.includes("ltx_href") && !creator.includes("<math"));
      expect(links).toHaveLength(2);
    });
    it("leaves a single declared dc.creator to Readability", () => {
      const html = latexml(fixture).replace("<title>", '<meta name="dc.creator" content="Declared Author"><title>');
      expect(metaAuthors(documentAt(html))).toBeNull();
    });
    it("leaves another author meta declaration to Readability", () => {
      const html = latexml(fixture).replace("<title>", '<meta name="author" content="Declared Author"><title>');
      expect(metaAuthors(documentAt(html))).toBeNull();
    });
  });
});

describe("fix 7 — a boxed passage keeps its words", () => {
  const WORDS = "The benchmark measures one capability. It is drawn from twelve repositories, unevenly.";

  it("the words come out of the SVG that only frames them, ids kept (§3 of 2608.13566)", () => {
    const { doc, stats } = prepared(latexml(fx("boxed-passage")));
    expect(stats).toEqual({ ...NOTHING, boxedPassages: 1 });
    expect(doc.querySelector("svg, foreignObject")).toBeNull();
    const lifted = doc.querySelector('[id="S3.p6.pic1"]');
    expect(lifted?.tagName).toBe("SPAN");
    expect(lifted?.textContent?.replace(/\s+/gu, " ").trim()).toBe(WORDS);
    expect(lifted?.querySelector('[id="S3.p6.pic1.1.1.1"]')).not.toBeNull();
  });

  it("a reader gets them as a block of text", async () => {
    const { blocks } = await blocksOf(fx("boxed-passage"));
    const block = blocks.filter((b) => b.text.includes("twelve repositories"));
    expect(block).toHaveLength(1);
    expect(block[0]?.text.replace(/\s+/gu, " ").trim()).toBe(WORDS);
  });

  describe("left exactly as the page had it", () => {
    const fixture = fx("boxed-passage");
    it("a diagram whose labels are foreignObjects (Figure 1a of 2610.01988v1)", () => {
      expect(prepared(latexml(fx("svg-diagram")))).toMatchObject({ unchanged: true, stats: NOTHING });
    });
    it("an SVG that draws more than a frame", () => {
      for (const extra of ['<text x="1" y="1">a label</text>', '<circle r="3"></circle>', '<image href="a.png"></image>']) {
        const html = fixture.replace("<foreignObject", `${extra}<foreignObject`);
        expect(html, extra).not.toBe(fixture);
        expect(prepared(latexml(html)).unchanged, extra).toBe(true);
      }
    });
    it("words beside the publisher's one container", () => {
      const html = fixture.replace('<span class="ltx_foreignobject_container">', '<p>other words</p><span class="ltx_foreignobject_container">');
      expect(html).not.toBe(fixture);
      expect(prepared(latexml(html)).unchanged).toBe(true);
    });
    it("active or fetching content inside the passage", () => {
      const html = fixture.replace(
        '<span class="ltx_foreignobject_content">',
        '<span class="ltx_foreignobject_content"><iframe src="https://www.youtube.com/embed/example"></iframe>',
      );
      expect(html).not.toBe(fixture);
      expect(prepared(latexml(html)).unchanged).toBe(true);
    });
    it("a link pointing at a part of the frame", () => {
      const html = fixture.replace("<foreignObject", '<foreignObject id="frame"');
      expect(prepared(latexml(`<p><a href="#frame">the box</a></p>${html}`)).unchanged).toBe(true);
    });
    it("a link pointing at the content wrapper that the rewrite would delete", () => {
      const html = fixture.replace('class="ltx_foreignobject_content"', 'id="content" class="ltx_foreignobject_content"');
      expect(prepared(latexml(`<p><a href="#content">the passage</a></p>${html}`)).unchanged).toBe(true);
    });
    it("the same markup outside article.ltx_document", () => {
      expect(prepared(notLatexml(fixture))).toMatchObject({ unchanged: true, stats: NOTHING });
    });
  });
});
