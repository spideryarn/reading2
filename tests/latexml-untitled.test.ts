/**
 * **A LaTeXML page with no document title: its `<title>` is LaTeXML's guess,
 * and is not used.**
 *
 * The fixture is arXiv 2308.08708v3, report spya-mx3wz0: a paper that sets its
 * title page by hand, so LaTeXML wrote `<title>1Indicator Properties</title>`
 * and no `h1.ltx_title_document`, and the article was shelved under a numbered
 * part of itself. docs/plans/261017a-an-arxiv-paper-with-no-title-takes-its-title-from-its-own-opening.md.
 */
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

import { runExtract } from "../src/extract.js";
import { latexmlUntitled } from "../src/latexml.js";

const UNTITLED = readFileSync(new URL("./fixtures/latexml/untitled-2308-08708v3.html", import.meta.url), "utf8");
const URL_2308 = "https://arxiv.org/html/2308.08708";
const REAL = "Consciousness in Artificial Intelligence: Insights from the Science of Consciousness";
const slug = "arxiv-2308-08708-spya-xax6v4";

const titled = (url = URL_2308) =>
  new JSDOM(
    `<!doctype html><html><head><title>A Paper</title></head><body><article class="ltx_document"><h1 class="ltx_title ltx_title_document">A Paper</h1><p>Words.</p></article></body></html>`,
    { url },
  ).window.document;

describe("latexmlUntitled", () => {
  it("is true for the reported page", () => {
    expect(latexmlUntitled(new JSDOM(UNTITLED, { url: URL_2308 }).window.document)).toBe(true);
  });

  it("is false for a LaTeXML page with a document title", () => {
    expect(latexmlUntitled(titled())).toBe(false);
  });

  it("is false for the same markup anywhere but a LaTeXML source: the class alone is no proof", () => {
    expect(latexmlUntitled(new JSDOM(UNTITLED, { url: "https://example.com/paper" }).window.document)).toBe(false);
  });

  it("is false with no document root: there is nothing to say the page is LaTeXML's", () => {
    const html = `<!doctype html><html><head><title>1Indicator Properties</title></head><body><article><p>Words.</p></article></body></html>`;
    expect(latexmlUntitled(new JSDOM(html, { url: URL_2308 }).window.document)).toBe(false);
  });

  it("finds the document title by its class, not its tag", () => {
    const html = UNTITLED.replace(`<article class="ltx_document">`, `<article class="ltx_document"><div class="ltx_title ltx_title_document">A Paper</div>`);
    expect(latexmlUntitled(new JSDOM(html, { url: URL_2308 }).window.document)).toBe(false);
  });

  it("a document-title class outside the document says nothing about it", () => {
    const html = UNTITLED.replace(`<body>`, `<body><h1 class="ltx_title_document">Somebody Else's</h1>`);
    expect(latexmlUntitled(new JSDOM(html, { url: URL_2308 }).window.document)).toBe(true);
  });
});

describe("runExtract on the reported page", () => {
  it("asks the opening for the title, and the page's <title> is not it", async () => {
    const titleFromOpening = vi.fn(async () => REAL);
    const out = await runExtract({ html: UNTITLED, url: URL_2308, slug, titleFromOpening });
    expect(out.meta.title).toBe(REAL);
    /* And the stored page's own <title>, which is the other place it lands. */
    expect(out.extractedHtml).toContain(`<title>${REAL}</title>`);
    expect(out.extractedHtml).not.toContain("Indicator Properties</title>");
    /* What it was asked with is the page's opening, which starts with the title paragraph. */
    const [records] = titleFromOpening.mock.calls[0] as unknown as [{ text: string }[]];
    expect(records[0]!.text).toBe(REAL);
  });

  it("with nothing to ask, or no answer, it is the paper's arXiv id, never LaTeXML's guess", async () => {
    const none = await runExtract({ html: UNTITLED, url: URL_2308, slug });
    expect(none.meta.title).toBe("arXiv:2308.08708");
    const refused = await runExtract({ html: UNTITLED, url: URL_2308, slug, titleFromOpening: async () => null });
    expect(refused.meta.title).toBe("arXiv:2308.08708");
    expect(refused.extractedHtml).toContain("<title>arXiv:2308.08708</title>");
    expect(JSON.stringify([none.meta, refused.meta, refused.extractedHtml.slice(0, 400)])).not.toContain("Indicator Properties");
  });

  it("with no id either, it is the slug", async () => {
    const out = await runExtract({ html: UNTITLED, url: "https://ar5iv.labs.arxiv.org/html/untitled", slug });
    expect(out.meta.title).toBe(slug);
  });

  it("an ordinary page's <title> is not second-guessed: the opening is not asked", async () => {
    const titleFromOpening = vi.fn(async () => "Something Else");
    const html = UNTITLED.replace(
      `<article class="ltx_document">`,
      `<article class="ltx_document"><h1 class="ltx_title ltx_title_document">1Indicator Properties</h1>`,
    );
    const out = await runExtract({ html, url: URL_2308, slug, titleFromOpening });
    expect(titleFromOpening).not.toHaveBeenCalled();
    expect(out.meta.title).toBe("1Indicator Properties");
  });
});
