/**
 * **A LaTeXML title with a line break in it keeps the space the break stood
 * for.**
 *
 * The fixture is arXiv 2602.11988, trimmed: its `\title` has a `\\` after
 * `AGENTS.md:`, the page's `h1.ltx_title_document` keeps it as a `<br>`, and
 * LaTeXML's `<title>` deletes it, so the article was shelved as
 * `Evaluating AGENTS.md:Are …` (report spya-whpceg).
 * docs/plans/261024b-an-arxiv-title-keeps-the-space-its-line-break-stood-for.md.
 */
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { runExtract } from "../src/extract.js";
import { latexmlTitleText } from "../src/latexml.js";

const PAGE = readFileSync(new URL("./fixtures/latexml/title-line-break-2602-11988.html", import.meta.url), "utf8");
const URL_2602 = "https://arxiv.org/html/2602.11988";
const REAL = "Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?";
const slug = "arxiv-2602-11988-spya-sudvzx";

const page = (title: string, h1: string) =>
  new JSDOM(
    `<!doctype html><html><head><title>${title}</title></head><body><article class="ltx_document"><h1 class="ltx_title ltx_title_document">${h1}</h1><p>Words.</p></article></body></html>`,
  ).window.document;

describe("latexmlTitleText", () => {
  it("reads a line break in the document title as a space, when <title> is the same with the break deleted", () => {
    expect(latexmlTitleText(new JSDOM(PAGE, { url: URL_2602 }).window.document)).toEqual({
      drawn: REAL,
      head: "Evaluating AGENTS.md:Are Repository-Level Context Files Helpful for Coding Agents?",
    });
  });

  it("and when <title> already has the space", () => {
    expect(latexmlTitleText(page("A: Paper", `A: <br class="ltx_break">Paper`))).toEqual({ drawn: "A: Paper", head: "A: Paper" });
  });

  it("needs the measured LaTeXML break: a matching ordinary heading is not this fault", () => {
    expect(latexmlTitleText(page("A Paper", "A Paper"))).toBeNull();
    expect(latexmlTitleText(page("APaper", "A<br>Paper"))).toBeNull();
  });

  it("two breaks and the whitespace round them are one space", () => {
    expect(latexmlTitleText(page("APaper", `A \n<br class="ltx_break">\n<br class="ltx_break"> Paper`))).toEqual({ drawn: "A Paper", head: "APaper" });
  });

  it("does not treat a private-use character in the untrusted title as its own break marker", () => {
    expect(latexmlTitleText(page("APaper", `A<br class="ltx_break">Paper`))).toEqual({ drawn: "A Paper", head: "APaper" });
  });

  it("leaves a footnote mark and its text out, a break inside it included", () => {
    const doc = page(
      "APaper",
      `A<br class="ltx_break">Paper<span class="ltx_note ltx_role_thanks"><sup class="ltx_note_mark">*</sup><span class="ltx_note_outer"><span class="ltx_note_content">Funded<br class="ltx_break">by somebody.</span></span></span>`,
    );
    expect(latexmlTitleText(doc)).toEqual({ drawn: "A Paper", head: "APaper" });
  });

  it("is null when <title> says anything else: spaces moved, or other words", () => {
    expect(latexmlTitleText(page("A Pa per", `A<br class="ltx_break">Paper`))).toBeNull();
    expect(latexmlTitleText(page("A Paper | Site", `A<br class="ltx_break">Paper`))).toBeNull();
  });

  it("is null with two document titles: which one is not ours to guess", () => {
    const doc = page("A Paper", "A Paper");
    doc.querySelector("article")!.insertAdjacentHTML("beforeend", `<h1 class="ltx_title ltx_title_document">Another</h1>`);
    expect(latexmlTitleText(doc)).toBeNull();
  });

  it("is null with two document roots even when only one has a title", () => {
    const doc = page("A Paper", `A<br class="ltx_break">Paper`);
    doc.body.insertAdjacentHTML("beforeend", `<article class="ltx_document"><p>Another document.</p></article>`);
    expect(latexmlTitleText(doc)).toBeNull();
  });

  it("compares with JSDOM's document.title, not a foreign <title> element", () => {
    const doc = page("A Paper", `A<br class="ltx_break">Paper`);
    const svgTitle = doc.createElementNS("http://www.w3.org/2000/svg", "title");
    svgTitle.textContent = "An SVG's title";
    doc.head.insertBefore(svgTitle, doc.head.firstChild);
    expect(doc.querySelector("head > title")?.textContent).toBe("An SVG's title");
    expect(doc.title).toBe("A Paper");
    expect(latexmlTitleText(doc)).toEqual({ drawn: "A Paper", head: "A Paper" });
  });

  it("is null with no document title", () => {
    const doc = new JSDOM(`<!doctype html><html><head><title>1Indicator Properties</title></head><body><article class="ltx_document"><p>Words.</p></article></body></html>`).window.document;
    expect(latexmlTitleText(doc)).toBeNull();
  });

  it("is null with no LaTeXML document at all", () => {
    const doc = new JSDOM(`<!doctype html><html><head><title>A Paper</title></head><body><h1 class="ltx_title_document">A Paper</h1></body></html>`).window.document;
    expect(latexmlTitleText(doc)).toBeNull();
  });
});

describe("runExtract on the reported page", () => {
  it("shelves it with the space the line break stood for", async () => {
    const out = await runExtract({ html: PAGE, url: URL_2602, slug });
    expect(out.meta.title).toBe(REAL);
    expect(out.extractedHtml).toContain(`<title>${REAL}</title>`);
  });

  it("only ever re-spaces: a document title whose words differ from <title> leaves <title> as it was", async () => {
    const html = PAGE.replace(`<br class="ltx_break">Are`, `<br class="ltx_break">Are <math alttext="x"><mi>x</mi></math>`);
    expect(html).not.toBe(PAGE);
    const out = await runExtract({ html, url: URL_2602, slug });
    expect(out.meta.title).toBe("Evaluating AGENTS.md:Are Repository-Level Context Files Helpful for Coding Agents?");
  });

  it("puts back only the break's space: spaces moved anywhere else leave the title as it was", async () => {
    const html = PAGE.replace("<title>Evaluating AGENTS.md:Are", "<title>Evaluating AGENTS. md:Are");
    expect(html).not.toBe(PAGE);
    const out = await runExtract({ html, url: URL_2602, slug });
    expect(out.meta.title).toBe("Evaluating AGENTS. md:Are Repository-Level Context Files Helpful for Coding Agents?");
  });

  it("a right <title> that Readability cut at its colon is shelved whole (2305.10601, Tree of Thoughts)", async () => {
    const html = PAGE.replace("<title>Evaluating AGENTS.md:Are", "<title>Evaluating AGENTS.md: Are");
    expect(html).not.toBe(PAGE);
    const out = await runExtract({ html, url: URL_2602, slug });
    expect(out.meta.title).toBe(REAL);
  });

  it("a title Readability took from somewhere else is left as Readability took it", async () => {
    const html = PAGE.replace("</head>", `<meta property="og:title" content="AGENTS.md study"></head>`);
    const out = await runExtract({ html, url: URL_2602, slug });
    expect(out.meta.title).toBe("AGENTS.md study");
  });

  it("a short metadata title is not mistaken for a cut piece merely because <title> contains it", async () => {
    const html = PAGE.replace("</head>", `<meta property="og:title" content="Are"></head>`);
    const out = await runExtract({ html, url: URL_2602, slug });
    expect(out.meta.title).toBe("Are");
  });

  /* Chosen, not overlooked: a metadata title that is exactly the part after
     the colon of a `<title>` the heading confirms gives way to the whole title.
     Whether Readability cut it or the metadata said it, the page states the
     whole title twice, and the rule stays free of Readability's list of
     metadata keys (plan 261024b § After the code review). */
  it("a metadata title that is the colon suffix of a <title> the heading confirms gives way to the whole title", async () => {
    const suffix = "Are Repository-Level Context Files Helpful for Coding Agents?";
    const html = PAGE.replace("<title>Evaluating AGENTS.md:Are", "<title>Evaluating AGENTS.md: Are").replace(
      "</head>",
      `<meta property="og:title" content="${suffix}"></head>`,
    );
    const out = await runExtract({ html, url: URL_2602, slug });
    expect(out.meta.title).toBe(REAL);
  });

  it("an upload with no address gets the same narrow repair", async () => {
    const out = await runExtract({ html: PAGE, url: null, slug });
    expect(out.meta.title).toBe(REAL);
  });
});
