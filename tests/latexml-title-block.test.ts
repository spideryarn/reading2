/**
 * **A LaTeXML title block becomes one row per author** (src/latexml.ts, fix 6).
 *
 * The fixtures are `tests/fixtures/latexml/authors-*.html`, each the `.ltx_authors`
 * block of a real arXiv HTML page. The reported paper is 1706.03762v7 (*Attention
 * Is All You Need*), whose block reached a reader as one 194-word paragraph of
 * `††thanks:` and `11footnotemark: 1`, with the first author's affiliation and
 * email deleted by Readability.
 *
 * docs/plans/261009d-arxiv-html-title-block-tidied-at-import.md.
 */
import { readFileSync, readdirSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { splitIntoBlocks } from "../src/blocks.js";
import { runExtract } from "../src/extract.js";
import { latexmlAuthorNames, prepareLatexml } from "../src/latexml.js";

const fx = (name: string) =>
  readFileSync(new URL(`./fixtures/latexml/${name}.html`, import.meta.url), "utf8").replace(/^<!--[\s\S]*?-->\n/u, "");

const pageWith = (articleClass: string, body: string) =>
  `<!doctype html><html lang="en"><head><title>A Paper</title></head><body><article class="${articleClass}">${body}</article></body></html>`;
const latexml = (body: string) => pageWith("ltx_document ltx_authors_1line", body);
const documentAt = (html: string, url = "https://arxiv.org/html/1706.03762v7") => new JSDOM(html, { url }).window.document;

function prepared(body: string, url?: string) {
  const doc = documentAt(latexml(body), url);
  const before = doc.body.innerHTML;
  const stats = prepareLatexml(doc);
  return { doc, stats, unchanged: doc.body.innerHTML === before };
}

/** Each row of the rewritten block: its lines, as the reader sees them. */
function rows(doc: Document): string[][] {
  const article = doc.querySelector("article")!;
  return Array.from(article.querySelectorAll("p")).map((p) =>
    p.innerHTML
      .split(/<br>/u)
      .map((line) => new JSDOM(`<div>${line}</div>`).window.document.body.textContent!.replace(/\s+/gu, " ").trim()),
  );
}

const ATTENTION = fx("authors-1706-03762v7");

describe("the reported paper: eight author rows and three numbered notes", () => {
  it("is rewritten, and counted", () => {
    const { stats, unchanged } = prepared(ATTENTION);
    expect(unchanged).toBe(false);
    expect(stats.titleBlocks).toBe(1);
  });

  it("each author is a row of name, affiliation and email; each note is written once, under its number", () => {
    const { doc } = prepared(ATTENTION);
    const got = rows(doc);
    expect(got.slice(0, 8).map((r) => r[0])).toEqual([
      "Ashish Vaswani1",
      "Noam Shazeer1",
      "Niki Parmar1",
      "Jakob Uszkoreit1",
      "Llion Jones1",
      "Aidan N. Gomez1,2",
      "Łukasz Kaiser1",
      "Illia Polosukhin1,3",
    ]);
    /* Ashish Vaswani's details are the ones Readability used to delete. */
    expect(got[0]!.slice(1)).toEqual(["Google Brain", expect.stringMatching(/@example\.org$/u)]);
    expect(got[5]!.slice(1)).toEqual(["University of Toronto", expect.stringMatching(/@example\.org$/u)]);
    /* Illia Polosukhin has an email and no affiliation. */
    expect(got[7]!).toHaveLength(2);
    expect(got.slice(8).map((r) => r.join(" "))).toEqual([
      expect.stringMatching(/^1 Equal contribution\. Listing order is random\. Jakob proposed .* accelerating our research\.$/u),
      "2 Work performed while at Google Brain.",
      "3 Work performed while at Google Research.",
    ]);
    expect(got).toHaveLength(11);
  });

  it("no LaTeXML label survives, and no author class for Readability to take", () => {
    const { doc } = prepared(ATTENTION);
    const text = doc.querySelector("article")!.textContent!;
    for (const label of ["thanks:", "footnotemark:", "Affiliation:", "Email:", "†"]) expect(text, label).not.toContain(label);
    expect(doc.querySelector("article [class*='author']")).toBeNull();
  });

  it("the names are still read, from the original block", () => {
    expect(latexmlAuthorNames(documentAt(latexml(ATTENTION)))).toHaveLength(8);
  });
});

describe("marks, kept and made consistent", () => {
  const titleThanks =
    '<h1 class="ltx_title ltx_title_document">A Paper<span class="ltx_pubnotes"><span class="ltx_pubnotes_content"><span class="ltx_pubnote ltx_role_thanks"><span class="ltx_note_name">Thanks: </span>Funded by somebody.</span></span></span></h1>';

  it("a \\footnotemark shares the note it repeats (2610.08785: both authors at MIT)", () => {
    const { doc, unchanged } = prepared(fx("authors-2610-08785"));
    expect(unchanged).toBe(false);
    expect(rows(doc)).toEqual([["Kevin Zhang1"], ["Stephen Bates1"], ["1 EECS, MIT, Cambridge MA, USA."]]);
  });

  it("a \\footnotemark whose note is not in the block refuses the whole rewrite (2610.08392: mark 2, one note)", () => {
    expect(prepared(fx("authors-2610-08392")).unchanged).toBe(true);
  });

  it("a \\thanks on the title counts towards N, so a mark after it is not proved and refuses", () => {
    /* LaTeXML renders a title's \\thanks as a pubnote, not the ltx_note shape
       used beside an author (2610.10724). It still advances LaTeX's footnote
       counter, so mark 1 below points here, not at Kevin Zhang's MIT note. */
    expect(prepared(titleThanks + fx("authors-2610-08785")).unchanged).toBe(true);
  });

  it("subtracts a title \\thanks before resolving a later mark", () => {
    const { doc, unchanged } = prepared(titleThanks + fx("authors-2610-08392"));
    expect(unchanged).toBe(false);
    expect(rows(doc).slice(0, 2).map((row) => row[0])).toEqual(["Ilya Auslender1", "Yasaman Heydari1"]);
  });
});

describe("the page's nodes are moved, not retyped", () => {
  it("a name that is its own ORCID link keeps the link (2610.08750)", () => {
    const { doc, unchanged } = prepared(fx("authors-2610-08750"));
    expect(unchanged).toBe(false);
    const link = doc.querySelector('article a[href^="https://orcid.org/"]');
    expect(link?.textContent?.trim()).toBe("Daniel Probst");
  });

  it("an empty mailto: link is unwrapped to its text; a real one is kept", () => {
    const { doc } = prepared(ATTENTION);
    expect(doc.querySelector('article a[href="mailto:"]')).toBeNull();
    const real = fx("authors-2610-01658v1");
    const kept = prepared(real).doc.querySelectorAll('article a[href^="mailto:"]').length;
    expect(kept).toBe(new JSDOM(real).window.document.querySelectorAll('a[href^="mailto:"]:not([href="mailto:"])').length);
  });

  it("accepts the measured E-mail label without a colon (2610.10642)", () => {
    const html = ATTENTION.replace("Email: ", "E-mail ");
    expect(html).not.toBe(ATTENTION);
    expect(prepared(html).unchanged).toBe(false);
  });

  it("keeps an image-only contact rather than letting the word check hide its loss", () => {
    const html = ATTENTION.replace("Google Brain\n", '<img src="logo.svg" alt="Laboratory logo">\n');
    const { doc, unchanged } = prepared(html);
    expect(unchanged).toBe(false);
    expect(doc.querySelector('article img[src="logo.svg"]')?.getAttribute("alt")).toBe("Laboratory logo");
  });

  it("bare names are one line, not a row each (2610.08790)", () => {
    const { doc } = prepared(fx("authors-2610-08790"));
    expect(rows(doc)).toEqual([
      ["Jiraphon Yenphraphai, Fang Li, Tianshuo Xu, Depu Meng, Quentin Herau, Yihan Hu, Raymond A. Yeh, Wei Zhan"],
    ]);
  });
});

/** The words of a block, less what the rewrite is allowed to leave behind. */
function wordsOf(el: Element): string[] {
  const copy = el.cloneNode(true) as Element;
  for (const f of Array.from(copy.querySelectorAll(".ltx_note_mark, .ltx_note_type, .ltx_tag_note, .ltx_contact_name, .ltx_author_before"))) f.remove();
  /* The numbers the rewrite adds are in a <sup>; a row, a line and a mark each end a word. */
  for (const end of Array.from(copy.querySelectorAll("p, br, sup"))) {
    end.before(" ");
    end.after(" ");
  }
  return (copy.textContent!.match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !/^\p{N}+$/u.test(w)).sort();
}

describe("every fixture: rewritten with every word, or left exactly as it was", () => {
  const fixtures = readdirSync(new URL("./fixtures/latexml/", import.meta.url)).filter((f) => f.startsWith("authors-"));
  for (const file of fixtures) {
    it(file, () => {
      const body = fx(file.replace(/\.html$/u, ""));
      const before = documentAt(latexml(body)).querySelector("article")!;
      const { doc, unchanged } = prepared(body);
      if (unchanged) return;
      expect(wordsOf(doc.querySelector("article")!)).toEqual(wordsOf(before));
    });
  }

  it("which ones, so a widening or a narrowing shows here", () => {
    const rewritten = fixtures.filter((f) => !prepared(fx(f.replace(/\.html$/u, ""))).unchanged).sort();
    expect(rewritten).toMatchInlineSnapshot(`
      [
        "authors-1706-03762v7.html",
        "authors-2605-20355v1.html",
        "authors-2608-13566.html",
        "authors-2610-01658v1.html",
        "authors-2610-01988v1.html",
        "authors-2610-03261v1.html",
        "authors-2610-08750.html",
        "authors-2610-08785.html",
        "authors-2610-08790.html",
      ]
    `);
  });
});

describe("left exactly as the page had it", () => {
  it("not at a LaTeXML address", () => {
    expect(prepared(ATTENTION, "https://example.test/html/1706.03762").unchanged).toBe(true);
  });
  it("names it cannot read (2610.08781)", () => {
    expect(prepared(fx("authors-2610-08781")).unchanged).toBe(true);
  });
  it("loose words in an author's notes, beside the contacts", () => {
    const html = ATTENTION.replace('<span class="ltx_author_notes_content">', '<span class="ltx_author_notes_content">Also at the zoo. ');
    expect(html).not.toBe(ATTENTION);
    expect(prepared(html).unchanged).toBe(true);
  });
  it("an element in an author's notes that is not a contact", () => {
    const html = ATTENTION.replace('<span class="ltx_author_notes_content">', '<span class="ltx_author_notes_content"><span class="ltx_text">Also at the zoo.</span>');
    expect(prepared(html).unchanged).toBe(true);
  });
  it("a \\footnotemark with words in it", () => {
    const html = ATTENTION.replace('<span class="ltx_note_type">footnotemark: </span>', '<span class="ltx_note_type">footnotemark: </span>Also at the zoo.');
    expect(html).not.toBe(ATTENTION);
    expect(prepared(html).unchanged).toBe(true);
  });
  it("a \\footnotemark with non-text content in it", () => {
    const html = ATTENTION.replace(
      '<span class="ltx_note_type">footnotemark: </span>',
      '<span class="ltx_note_type">footnotemark: </span><img alt="an unexplained mark">',
    );
    expect(html).not.toBe(ATTENTION);
    expect(prepared(html).unchanged).toBe(true);
  });
  it("words hidden inside a furniture label do not pass the word check", () => {
    const contact = ATTENTION.replace("Affiliation: ", "Affiliation: Also at the zoo. ");
    const note = ATTENTION.replace(
      "thanks: </span>Equal contribution.",
      "thanks: Also at the zoo. </span>Equal contribution.",
    );
    expect(contact).not.toBe(ATTENTION);
    expect(note).not.toBe(ATTENTION);
    expect(prepared(contact).unchanged).toBe(true);
    expect(prepared(note).unchanged).toBe(true);
  });
  it("block content that cannot remain inside an author paragraph refuses", () => {
    const html = ATTENTION.replace("Google Brain\n", "<p>Google Brain</p>\n");
    expect(html).not.toBe(ATTENTION);
    expect(prepared(html).unchanged).toBe(true);
  });
  it("a byline-shaped descendant that Readability would delete refuses", () => {
    const html = ATTENTION.replace(
      "Google Brain\n",
      '<span class="author-email">Google Brain</span>\n',
    );
    expect(html).not.toBe(ATTENTION);
    expect(prepared(html).unchanged).toBe(true);
  });
  it("a note of another kind beside a name", () => {
    const html = ATTENTION.replace("ltx_role_thanks", "ltx_role_footnote");
    expect(prepared(html).unchanged).toBe(true);
  });
  it("a link in the page pointing at a note wrapper the rewrite would leave behind", () => {
    const html = `${ATTENTION}<p><a href="#footnotex1">see</a></p>`;
    expect(prepared(html).unchanged).toBe(true);
  });
  it("but a link to an id inside a moved node keeps it, and the block keeps its own", () => {
    const html = `${ATTENTION.replace('<div class="ltx_authors">', '<div class="ltx_authors" id="authors">')}<p><a href="#id2">mail</a><a href="#authors">up</a></p>`;
    const { doc, unchanged } = prepared(html);
    expect(unchanged).toBe(false);
    expect(doc.getElementById("id2")?.textContent).toMatch(/@example\.org$/u);
    expect(doc.getElementById("authors")?.tagName).toBe("DIV");
  });
});

describe("what a reader gets: stage 2 and stage 3", () => {
  const prose = Array.from(
    { length: 8 },
    (_, i) =>
      `<div class="ltx_para"><p class="ltx_p">Paragraph ${i} of ordinary prose, long enough that Readability keeps this article rather than deciding the page is a navigation shell with nothing in it. It carries on for a sentence or two more.</p></div>`,
  ).join("\n");

  it("one block per author row, its lines kept, the byline the eight names, and Ashish Vaswani's details there", async () => {
    const out = await runExtract({
      html: latexml(`<h1 class="ltx_title ltx_title_document">Attention Is All You Need</h1>${ATTENTION}<section class="ltx_section">${prose}</section>`),
      url: "https://arxiv.org/html/1706.03762v7",
      slug: "latexml-title-block",
    });
    expect(out.meta.byline).toBe(
      "Ashish Vaswani; Noam Shazeer; Niki Parmar; Jakob Uszkoreit; Llion Jones; Aidan N. Gomez; Łukasz Kaiser; Illia Polosukhin",
    );
    expect(out.meta.authors).toHaveLength(8);
    const { blocks } = splitIntoBlocks(out.extractedHtml);
    const authorRows = blocks.filter((b) => /@example\.org/u.test(b.text));
    expect(authorRows).toHaveLength(8);
    for (const row of authorRows) expect(row.html).toContain("<br>");
    expect(authorRows[0]!.html).toContain("<sup>1</sup>");
    expect(authorRows.every((row) => row.role === undefined && row.noteId === undefined)).toBe(true);
    expect(authorRows[0]!.text).toMatch(/^Ashish Vaswani ?1 Google Brain author\d+@example\.org$/u);
    expect(blocks.some((b) => b.text.startsWith("1 Equal contribution."))).toBe(true);
    expect(blocks.map((b) => b.text).join(" ")).not.toMatch(/thanks:|footnotemark:|Affiliation:/u);
  });
});
