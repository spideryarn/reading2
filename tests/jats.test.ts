/**
 * **Europe PMC's JATS, turned into a page stage 2 reads.**
 *
 * docs/plans/261018j-a-refused-paper-read-from-europe-pmc-and-a-saved-page-keeps-its-address.md
 * § Stage 1, GPT Sol's S5 (what is refused before parsing), S7 (the head) and
 * S8 (what the six real papers need). The fixtures are the six papers of the
 * 261017a sample that have a free copy, as Europe PMC served them on
 * 2026-10-18, whole: tests/fixtures/europe-pmc/.
 */
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { JSDOM } from "jsdom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readArticle, runExtract } from "../src/extract.js";
import { JatsRefused, jatsToHtml } from "../src/jats.js";

const MATHML = "http://www.w3.org/1998/Math/MathML";
const PAPERS = ["PMC4595480", "PMC5828643", "PMC7357184", "PMC10393405", "PMC10767750", "PMC8005924"] as const;
const xmlOf = (pmcid: string) => readFileSync(new URL(`./fixtures/europe-pmc/${pmcid}.xml`, import.meta.url), "utf8");

/** The source, parsed the way the converter parses it, and the page it made, parsed as a browser would. */
function both(pmcid: string) {
  const xml = xmlOf(pmcid);
  const source = new JSDOM(xml, { contentType: "application/xml" }).window.document;
  const html = jatsToHtml(xml, pmcid);
  const page = new JSDOM(html).window.document;
  return { source, html, page };
}

const squash = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "");

/** What the converter leaves out on purpose: nothing inside these is the article's prose. */
const LEFT_OUT = ["supplementary-material", "journal-meta", "processing-meta", "permissions", "author-notes", "media"];

describe.each(PAPERS)("%s", (pmcid) => {
  const { source, html, page } = both(pmcid);

  it("keeps the text of every paragraph it means to keep", () => {
    const text = squash(page.body.textContent);
    const article = source.documentElement;
    const kept = [...article.getElementsByTagName("p")].filter((p) => {
      for (let el: Element | null = p; el !== null; el = el.parentElement) {
        if (LEFT_OUT.includes(el.localName)) return false;
        if (el.localName === "front" && p.closest("abstract") === null) return false;
        if (el.localName === "abstract" && el.getAttribute("abstract-type") === "teaser") {
          return [...article.getElementsByTagName("abstract")].every((a) => a.getAttribute("abstract-type") === "teaser");
        }
      }
      return true;
    });
    expect(kept.length).toBeGreaterThan(10);
    const missing = kept.filter((p) => !text.includes(squash(p.textContent)));
    expect(missing.map((p) => (p.textContent ?? "").slice(0, 80))).toEqual([]);
  });

  it("nests its headings without skipping a level, under one h1", () => {
    const levels = [...page.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => Number(h.localName.slice(1)));
    expect(levels[0]).toBe(1);
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    for (const [i, level] of levels.entries()) {
      if (i > 0) expect(level - (levels[i - 1] ?? 1), `heading ${i}`).toBeLessThanOrEqual(1);
    }
    expect([...page.querySelectorAll("h2")].length).toBeGreaterThan(2);
  });

  it("draws every figure from the open-data bucket, never the thumbnail", () => {
    const figs = source.getElementsByTagName("fig").length;
    const figures = [...page.querySelectorAll("figure")].filter((f) => f.querySelector("figcaption") !== null);
    expect(figures.length).toBeGreaterThanOrEqual(figs);
    const srcs = [...page.querySelectorAll("img")].map((img) => img.getAttribute("src") ?? "");
    expect(srcs.length).toBeGreaterThan(0);
    for (const src of srcs) {
      expect(src).toMatch(new RegExp(`^https://pmc-oa-opendata\\.s3\\.amazonaws\\.com/${pmcid}\\.\\d+/[^/]+$`));
      expect(src).not.toMatch(/\.gif$/);
    }
  });

  it("renders each reference once, where it stands, and every citation of one links to it", () => {
    const refs = [...source.getElementsByTagName("ref")];
    expect(refs.length).toBeGreaterThan(10);
    for (const ref of refs) {
      const id = ref.getAttribute("id") ?? "";
      expect(page.querySelectorAll(`li[id="${id}"]`), id).toHaveLength(1);
    }
    expect(source.getElementsByTagName("ref-list").length).toBeGreaterThan(0);
    const links = [...page.querySelectorAll('a[href^="#"]')];
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) expect(page.getElementById((a.getAttribute("href") ?? "").slice(1)), a.outerHTML).not.toBeNull();
  });

  it("copies no markup and no attribute from the XML", () => {
    const allowed = new Set(["id", "href", "src", "alt", "colspan", "rowspan", "charset", "name", "content", "property", "display", "encoding", "mathvariant", "stretchy", "width", "displaystyle", "fence", "separator", "lspace", "rspace", "accent", "linethickness", "columnalign", "form", "movablelimits", "largeop", "symmetric"]);
    for (const el of page.querySelectorAll("*")) {
      for (const attr of el.attributes) expect(allowed, `${el.localName}[${attr.name}]`).toContain(attr.name);
    }
    expect(html).not.toMatch(/<script|\sxlink:|\son[a-z]+="/i);
  });

  it("is read by stage 2 with its own title, authors, date and journal", async () => {
    const url = `https://europepmc.org/article/PMC/${pmcid}`;
    const meta = source.getElementsByTagName("article-meta")[0];
    const title = squash(meta?.getElementsByTagName("article-title")[0]?.textContent);
    const result = await runExtract({ html, url, slug: `europepmc-${pmcid.toLowerCase()}` });
    expect(squash(result.meta.title)).toBe(title);
    expect(result.meta.authors?.length).toBeGreaterThan(0);
    expect(result.meta.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.meta.siteName).toBe(source.getElementsByTagName("journal-title")[0]?.textContent?.trim());
    const doi = [...(meta?.getElementsByTagName("article-id") ?? [])].find((a) => a.getAttribute("pub-id-type") === "doi");
    expect(result.ownIds).toContain(`doi:${doi?.textContent?.toLowerCase()}`);
  });
});

describe("the six papers' particulars (S8)", () => {
  it("finds the authors of a contrib-group whose contribs carry no type", () => {
    const { page } = both("PMC10393405");
    const authors = [...page.querySelectorAll('meta[name="citation_author"]')].map((m) => m.getAttribute("content"));
    expect(authors).toEqual(["Kaitlyn M L Cramb", "Dayne Beccano-Kelly", "Stephanie J Cragg", "Richard Wade-Martins"]);
    expect(page.querySelectorAll('meta[name="citation_author_institution"]').length).toBeGreaterThan(0);
  });

  it("dates the BMJ paper by its electronic date, not its collection's year", () => {
    const { page } = both("PMC8005924");
    expect(page.querySelector('meta[property="article:published_time"]')?.getAttribute("content")).toBe("2021-03-29");
  });

  it("gives a print date with no day its first", () => {
    const { page } = both("PMC4595480");
    expect(page.querySelector('meta[property="article:published_time"]')?.getAttribute("content")).toBe("2015-10-01");
  });

  it("rebuilds bare MathML in its namespace, all 17 formulas", () => {
    const { page } = both("PMC7357184");
    const maths = [...page.getElementsByTagNameNS(MATHML, "math")];
    expect(maths).toHaveLength(17);
    for (const math of maths) {
      expect(math.querySelector("*")?.namespaceURI).toBe(MATHML);
      expect((math.textContent ?? "").trim()).not.toBe("");
    }
  });

  it("draws a table that is only a picture as a figure", () => {
    const { page } = both("PMC10767750");
    const table3 = page.getElementById("tbl3");
    expect(table3?.localName).toBe("figure");
    expect(table3?.querySelector("img")?.getAttribute("src")).toMatch(/^https:\/\/pmc-oa-opendata\.s3\.amazonaws\.com\/PMC10767750\.1\//);
    expect(page.querySelectorAll("table").length).toBeGreaterThan(0);
  });

  it("keeps a table's spans", () => {
    const { page } = both("PMC7357184");
    expect(page.querySelector('th[colspan="2"]')).not.toBeNull();
  });

  it("places a floats-group's figures in the text and the version's directory from pmcid-ver", () => {
    const { page } = both("PMC4595480");
    const figure = page.getElementById("fig0005");
    expect(figure?.querySelector("img")?.getAttribute("src")).toBe("https://pmc-oa-opendata.s3.amazonaws.com/PMC4595480.1/gr1.jpg");
    /* After the paragraph that cites it, not at the end. */
    expect(figure?.previousElementSibling?.querySelector('a[href="#fig0005"]')).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Built, never copied
 * ------------------------------------------------------------------ */

const article = (body: string, front = "") =>
  `<?xml version="1.0"?><article xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:mml="http://www.w3.org/1998/Math/MathML"><front><article-meta><title-group><article-title>T</article-title></title-group>${front}</article-meta></front><body>${body}</body></article>`;

describe("what the converter builds", () => {
  it("escapes text, and carries no element or attribute of the source's own", () => {
    const html = jatsToHtml(
      article(
        '<p onclick="x()" style="x">&lt;script&gt;alert(1)&lt;/script&gt; <ext-link xlink:href="javascript:alert(1)">bad</ext-link> <ext-link xlink:href="https://ok.example/a">good</ext-link> <script>no</script></p>',
      ),
      "PMC1",
    );
    const page = new JSDOM(html).window.document;
    expect(page.querySelector("script")).toBeNull();
    expect(page.querySelector("[onclick], [style]")).toBeNull();
    expect([...page.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["https://ok.example/a"]);
    expect(page.body.textContent).toContain("<script>alert(1)</script>");
  });

  it("treats a figure's file name as one opaque, encoded path segment, extension or none", () => {
    const html = jatsToHtml(
      article('<fig id="f1"><label>Figure 1</label><graphic xlink:href="fig one"/></fig><fig id="f2"><graphic xlink:href="../../x?y#z"/></fig>'),
      "PMC1",
    );
    const srcs = [...new JSDOM(html).window.document.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(srcs).toEqual([
      "https://pmc-oa-opendata.s3.amazonaws.com/PMC1.1/fig%20one",
      "https://pmc-oa-opendata.s3.amazonaws.com/PMC1.1/..%2F..%2Fx%3Fy%23z",
    ]);
  });

  it("splits a paragraph around a block it holds", () => {
    const html = jatsToHtml(article("<p>before<list><list-item><p>item</p></list-item></list>after</p>"), "PMC1");
    const body = new JSDOM(html).window.document.querySelector("article");
    expect([...(body?.children ?? [])].slice(1).map((c) => `${c.localName}:${c.textContent}`)).toEqual(["p:before", "ul:item", "p:after"]);
  });

  it("drops MathML attributes outside its allowlist and an annotation-xml", () => {
    const html = jatsToHtml(
      article('<p><inline-formula><mml:math><mml:mi mathvariant="bold" href="javascript:x" onclick="y">x</mml:mi><mml:annotation-xml encoding="text/html"><b>no</b></mml:annotation-xml></mml:math></inline-formula></p>'),
      "PMC1",
    );
    const mi = new JSDOM(html).window.document.getElementsByTagNameNS(MATHML, "mi")[0];
    expect(mi?.getAttribute("mathvariant")).toBe("bold");
    expect(mi?.attributes).toHaveLength(1);
    expect(html).not.toContain("annotation-xml");
  });

  it("carries TeX where the JATS has it, without the LaTeX document around it", () => {
    const html = jatsToHtml(
      article(
        "<p>See <inline-formula><alternatives><tex-math>\\documentclass{article}\\begin{document}$x^2$\\end{document}</tex-math><mml:math><mml:msup><mml:mi>x</mml:mi><mml:mn>2</mml:mn></mml:msup></mml:math></alternatives></inline-formula>.</p>",
      ),
      "PMC1",
    );
    const annotation = new JSDOM(html).window.document.getElementsByTagNameNS(MATHML, "annotation")[0];
    expect(annotation?.getAttribute("encoding")).toBe("application/x-tex");
    expect(annotation?.textContent).toBe("x^2");
  });
});

/* ------------------------------------------------------------------ *
 * S5: refused before parsing, and nothing fetched
 * ------------------------------------------------------------------ */

describe("what is refused before it is parsed (S5)", () => {
  let server: Server;
  let base = "";
  const hits: string[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      hits.push(req.url ?? "");
      res.end("<!ENTITY leak 'LEAKED'>");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  const refusal = (xml: string) => {
    try {
      jatsToHtml(xml, "PMC1");
      return null;
    } catch (err) {
      return err instanceof JatsRefused ? err.reason : err;
    }
  };
  const BODY = "<article><front/><body><p>x &e; y</p></body></article>";

  it("refuses an internal entity, which jsdom would otherwise expand", () => {
    expect(refusal(`<!DOCTYPE article [<!ENTITY e "boom">]>${BODY}`)).toBe("declarations");
  });

  it("refuses an external entity and an external parameter entity, and asks for neither", async () => {
    expect(refusal(`<!DOCTYPE article [<!ENTITY e SYSTEM "${base}/e">]>${BODY}`)).toBe("declarations");
    expect(refusal(`<!DOCTYPE article [<!ENTITY % p SYSTEM "${base}/p"> %p;]>${BODY}`)).toBe("declarations");
    expect(refusal(`<!DOCTYPE article SYSTEM "${base}/dtd">${BODY.replace("&e;", "")}`)).toBe("declarations");
    await new Promise((done) => setTimeout(done, 50));
    expect(hits).toEqual([]);
  });

  it("lets JATS's own PUBLIC doctype through, and fetches no DTD for it", async () => {
    const xml = `<!DOCTYPE article PUBLIC "-//NLM//DTD JATS (Z39.96) Journal Archiving and Interchange DTD v1.4//EN" "${base}/JATS.dtd">${article("<p>Fine.</p>").replace('<?xml version="1.0"?>', "")}`;
    expect(jatsToHtml(xml, "PMC1")).toContain("Fine.");
    await new Promise((done) => setTimeout(done, 50));
    expect(hits).toEqual([]);
  });

  it("refuses a second DOCTYPE, malformed XML, another root, and a body with no text", () => {
    const pub = '<!DOCTYPE article PUBLIC "a" "b">';
    expect(refusal(`${pub}${pub}${BODY}`)).toBe("declarations");
    expect(refusal("<article><body><p>x</body></article>")).toBe("parse");
    expect(refusal("<article><body><p>&nbsp;</p></body></article>")).toBe("parse");
    expect(refusal("<html><body><p>x</p></body></html>")).toBe("not-an-article");
    expect(refusal("<article><front/><body> </body></article>")).toBe("no-body");
    expect(refusal("<article><front/></article>")).toBe("no-body");
  });

  it("refuses a document past its element bound", () => {
    expect(refusal(`<article><body><p>x</p>${"<x/>".repeat(200_001)}</body></article>`)).toBe("too-large");
  });

  it("names nothing from the document in its message", () => {
    const err = new JatsRefused("parse");
    expect(err.message).toBe("The JATS document was refused: parse.");
  });
});

describe("readArticle over a converted page", () => {
  it("is not taken for a bot check or a short page", () => {
    const { html } = both("PMC5828643");
    const read = readArticle(html, "https://europepmc.org/article/PMC/PMC5828643");
    expect(read.refusal).toBeNull();
    expect(read.article?.title).toBe("Normal aging induces A1-like astrocyte reactivity");
  });
});
