/**
 * **Every author the page declares, not the last one.**
 *
 * Greg imported a 25-author Nature paper on 2026-09-28 and the byline read
 * "Hasson, Uri". Readability keeps one value per `<meta>` name, last write
 * wins, so a page that repeats `dc.creator` per author keeps the last; and it
 * does not read `citation_author` at all, so PLOS got its first author off the
 * DOM and arXiv got a dateline. The fixtures under tests/fixtures/bylines/ are
 * those three pages cut down to their author metadata, and each one stored the
 * wrong byline before the fix.
 *
 * docs/plans/260928b-multi-author-bylines-from-citation-meta.md;
 * docs/postmortems/260928a-a-library-field-that-holds-one-value-for-a-list-keeps-one.md.
 */
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { runExtract } from "../src/extract.js";
import { bylineFromAuthors, chooseByline, inNaturalOrder, metaAuthors } from "../src/meta-authors.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/bylines/${name}`, import.meta.url), "utf8");

const prose = Array.from(
  { length: 8 },
  (_, i) =>
    `<p>Paragraph ${i} of ordinary prose, long enough that Readability keeps this article rather than deciding the page is a navigation shell with nothing in it. It carries on for a sentence or two more.</p>`,
).join("\n");

const page = (head: string, body = "") =>
  `<!doctype html><html lang="en"><head><title>A Title</title>${head}</head><body><article>${body}${prose}</article></body></html>`;

const docOf = (head: string) => new JSDOM(page(head)).window.document;
const metaTag = (name: string, content: string) => `<meta name="${name}" content="${content}">`;

/** Just the names, so the cases written before affiliations (260929d) read as they did. */
const namesOf = (doc: Document) => metaAuthors(doc)?.map((a) => a.name) ?? null;

describe("metaAuthors", () => {
  it("reads every citation_author, in document order", () => {
    const head = ["Nastase, Samuel A.", "Liu, Yun-Fei", "Hasson, Uri"].map((n) => metaTag("citation_author", n)).join("");
    expect(namesOf(docOf(head))).toEqual(["Samuel A. Nastase", "Yun-Fei Liu", "Uri Hasson"]);
  });

  it("reads a single citation_author — arXiv's DOM fallback for one is a dateline", () => {
    expect(namesOf(docOf(metaTag("citation_author", "Doe, Jane")))).toEqual(["Jane Doe"]);
  });

  it("prefers citation_author over dc.creator when both are there", () => {
    const head = metaTag("dc.creator", "Someone Else") + metaTag("citation_author", "Jane Doe") + metaTag("citation_author", "John Smith");
    expect(namesOf(docOf(head))).toEqual(["Jane Doe", "John Smith"]);
  });

  it("reads a repeated dc.creator, in any of its spellings", () => {
    const head =
      metaTag("DC.Creator", "Doe, Jane") +
      metaTag("dc:creator", "Smith, John") +
      metaTag("dcterms.creator", "Lovelace, Ada") +
      metaTag("dcterm:creator", "Hopper, Grace");
    expect(namesOf(docOf(head))).toEqual(["Jane Doe", "John Smith", "Ada Lovelace", "Grace Hopper"]);
  });

  it("leaves a single dc.creator to Readability, which already reads one correctly", () => {
    expect(namesOf(docOf(metaTag("dc.creator", "Jane Doe")))).toBeNull();
  });

  it("does not read a repeated plain author tag — a news page's is left alone", () => {
    expect(namesOf(docOf(metaTag("author", "Jane Doe") + metaTag("author", "John Smith")))).toBeNull();
  });

  it("drops duplicates and empty values", () => {
    const head = ["Jane Doe", "", "  ", "jane doe", "John Smith"].map((n) => metaTag("citation_author", n)).join("");
    expect(namesOf(docOf(head))).toEqual(["Jane Doe", "John Smith"]);
  });

  it("returns null for a page with no author metadata", () => {
    expect(namesOf(docOf(""))).toBeNull();
  });
});

describe("metaAuthors' affiliations (plan 260929d)", () => {
  it("gives each citation_author the institution tags that follow it, as Nature and PLOS emit them", () => {
    const head =
      metaTag("citation_author", "Nastase, Samuel A.") +
      metaTag("citation_author_institution", "Princeton Neuroscience Institute, Princeton University") +
      metaTag("citation_author", "Liu, Yun-Fei") +
      metaTag("citation_author_institution", "Johns Hopkins University") +
      metaTag("citation_author_affiliation", "  Second   place ") +
      metaTag("citation_author", "Hasson, Uri");
    expect(metaAuthors(docOf(head))).toEqual([
      { name: "Samuel A. Nastase", affiliations: ["Princeton Neuroscience Institute, Princeton University"] },
      { name: "Yun-Fei Liu", affiliations: ["Johns Hopkins University", "Second place"] },
      { name: "Uri Hasson", affiliations: [] },
    ]);
  });

  it("drops an institution that comes before any author — it belongs to nobody", () => {
    const head = metaTag("citation_author_institution", "Orphan U") + metaTag("citation_author", "Jane Doe");
    expect(metaAuthors(docOf(head))).toEqual([{ name: "Jane Doe", affiliations: [] }]);
  });

  it("merges a repeated author's institutions into the first, without repeats", () => {
    const head =
      metaTag("citation_author", "Jane Doe") +
      metaTag("citation_author_institution", "A") +
      metaTag("citation_author", "jane doe") +
      metaTag("citation_author_institution", "A") +
      metaTag("citation_author_institution", "B");
    expect(metaAuthors(docOf(head))).toEqual([{ name: "Jane Doe", affiliations: ["A", "B"] }]);
  });

  it("keeps each affiliation beside its own author when the names are flipped", () => {
    const head =
      metaTag("citation_author", "Doe, Jane") +
      metaTag("citation_author_institution", "Oxford") +
      metaTag("citation_author", "Smith, John") +
      metaTag("citation_author_institution", "Cambridge");
    expect(metaAuthors(docOf(head))).toEqual([
      { name: "Jane Doe", affiliations: ["Oxford"] },
      { name: "John Smith", affiliations: ["Cambridge"] },
    ]);
  });

  it("does not attach an institution to a dc.creator", () => {
    const head =
      metaTag("dc.creator", "Jane Doe") + metaTag("citation_author_institution", "Oxford") + metaTag("dc.creator", "John Smith");
    expect(metaAuthors(docOf(head))).toEqual([
      { name: "Jane Doe", affiliations: [] },
      { name: "John Smith", affiliations: [] },
    ]);
  });
});

describe("inNaturalOrder", () => {
  it("flips a list that is all Surname, Given", () => {
    expect(inNaturalOrder(["Nastase, Samuel A.", "van der Berg, Eva"])).toEqual(["Samuel A. Nastase", "Eva van der Berg"]);
  });

  it("leaves a list already in natural order", () => {
    expect(inNaturalOrder(["Karin Tajima", "Kentaro Yamakawa"])).toEqual(["Karin Tajima", "Kentaro Yamakawa"]);
  });

  /** A comma alone does not say which way round a name is. GPT Sol, 2026-09-28. */
  it("does not turn a suffix into a given name", () => {
    expect(inNaturalOrder(["John Smith, Jr.", "Jane Doe"])).toEqual(["John Smith, Jr.", "Jane Doe"]);
    expect(inNaturalOrder(["John Smith, III"])).toEqual(["John Smith, III"]);
  });

  it("keeps the publisher's order for all when any one name is not Surname, Given", () => {
    expect(inNaturalOrder(["Doe, Jane", "Human Connectome Project"])).toEqual(["Doe, Jane", "Human Connectome Project"]);
    expect(inNaturalOrder(["Doe, Jane", "King, Martin Luther, Jr."])).toEqual(["Doe, Jane", "King, Martin Luther, Jr."]);
    expect(
      inNaturalOrder(["Doe, Jane", "Princeton Neuroscience Institute and Department of Psychology, Princeton University"]),
    ).toEqual(["Doe, Jane", "Princeton Neuroscience Institute and Department of Psychology, Princeton University"]);
  });

  it("does not reverse a short organizational author that happens to fit the comma shape", () => {
    expect(inNaturalOrder(["Doe, Jane", "University of Oxford, Department of Biology"])).toEqual([
      "Doe, Jane",
      "University of Oxford, Department of Biology",
    ]);
  });
});

describe("chooseByline", () => {
  it("keeps Readability's byline when it already names every author", () => {
    expect(chooseByline(["Tingting Wu", "Xiaorong Hou"], "Tingting Wu, Xiaorong Hou")).toBe("Tingting Wu, Xiaorong Hou");
    expect(chooseByline(["Augustin Žídek"], "augustin zidek")).toBe("augustin zidek");
  });

  it("replaces a byline that has dropped somebody", () => {
    expect(chooseByline(["Samuel A. Nastase", "Uri Hasson"], "Hasson, Uri")).toBe("Samuel A. Nastase; Uri Hasson");
  });

  it("replaces a byline that names nobody, and fills a missing one", () => {
    expect(chooseByline(["Jane Doe"], "[Submitted on 12 Jun 2017]")).toBe("Jane Doe");
    expect(chooseByline(["Jane Doe"], undefined)).toBe("Jane Doe");
  });

  it("does not mistake a surname elsewhere in a dateline for the author", () => {
    expect(chooseByline(["John May"], "[Submitted in May 2024]")).toBe("John May");
  });

  it("requires evidence for names whose folded form is empty", () => {
    expect(chooseByline(["***"], "---")).toBe("***");
  });

  it("matches non-Latin names as letters rather than folding them away", () => {
    expect(chooseByline(["李雷"], "李雷")).toBe("李雷");
    expect(chooseByline(["李雷"], "发布日期")).toBe("李雷");
  });

  it("is Readability's byline when the page declares nobody", () => {
    expect(chooseByline(null, "Jane Doe")).toBe("Jane Doe");
    expect(chooseByline(null, undefined)).toBeUndefined();
  });
});

describe("bylineFromAuthors", () => {
  /** `"; "`, because Referee mode's `authorKeys` reads a two-part comma segment as `Surname, Given`. */
  it("joins with a semicolon", () => {
    expect(bylineFromAuthors(["Jane Doe", "John Smith"])).toBe("Jane Doe; John Smith");
  });
});

describe("runExtract on the saved publisher pages", () => {
  it("Nature: all 25 authors, not only the last", async () => {
    const { meta } = await runExtract({
      html: fixture("nature-s41597-021-01033-3.html"),
      url: "https://www.nature.com/articles/s41597-021-01033-3",
      slug: "nature",
    });
    const names = (meta.byline ?? "").split("; ");
    expect(names).toHaveLength(25);
    expect(names[0]).toBe("Samuel A. Nastase");
    expect(names[1]).toBe("Yun-Fei Liu");
    expect(names[24]).toBe("Uri Hasson");
    /* The structured twin (plan 260929d): the same names in the same order. */
    expect(meta.authors?.map((a) => a.name)).toEqual(names);
  });

  it("stores the affiliations beside the names, and the byline stays the names alone", async () => {
    const head =
      metaTag("citation_author", "Doe, Jane") +
      metaTag("citation_author_institution", "Oxford") +
      metaTag("citation_author", "Smith, John");
    const { meta } = await runExtract({ html: page(head), url: "https://example.com/a", slug: "a" });
    expect(meta.byline).toBe("Jane Doe; John Smith");
    expect(meta.authors).toEqual([
      { name: "Jane Doe", affiliations: ["Oxford"] },
      { name: "John Smith", affiliations: [] },
    ]);
  });

  it("keeps the list beside a Readability byline that names exactly those people", async () => {
    const ld = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "ScholarlyArticle",
      headline: "A Title",
      author: [{ "@type": "Person", name: "Jane Doe" }, { "@type": "Person", name: "John Smith" }],
    });
    const head = `${metaTag("citation_author", "Jane Doe")}${metaTag("citation_author", "John Smith")}<script type="application/ld+json">${ld}</script>`;
    const { meta } = await runExtract({ html: page(head), url: "https://example.com/b", slug: "b" });
    expect(meta.byline).toBe("Jane Doe, John Smith");
    expect(meta.authors?.map((a) => a.name)).toEqual(["Jane Doe", "John Smith"]);
  });

  it("PLOS: all 6 authors, not the first link of the author list", async () => {
    const { meta } = await runExtract({
      html: fixture("plos-pone-0285120.html"),
      url: "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0285120",
      slug: "plos",
    });
    expect(meta.byline).toBe(
      "Karin Tajima; Kentaro Yamakawa; Yuki Kuwabara; Chika Miyazaki; Hiroshi Sunaga; Shoichi Uezono",
    );
  });

  it("arXiv: the 8 authors, not the submission dateline", async () => {
    const { meta } = await runExtract({
      html: fixture("arxiv-1706.03762.html"),
      url: "https://arxiv.org/abs/1706.03762",
      slug: "arxiv",
    });
    expect(meta.byline).toBe(
      "Ashish Vaswani; Noam Shazeer; Niki Parmar; Jakob Uszkoreit; Llion Jones; Aidan N. Gomez; Lukasz Kaiser; Illia Polosukhin",
    );
  });

  /**
   * One `citation_author` — Google Scholar's minimum — beside a full JSON-LD
   * author list that Readability already reads. Readability's byline names both,
   * so it stands. GPT Sol, 2026-09-28.
   */
  it("one citation_author beside a complete JSON-LD list keeps Readability's byline", async () => {
    const ld = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "ScholarlyArticle",
      headline: "A Title",
      author: [{ "@type": "Person", name: "Jane Doe" }, { "@type": "Person", name: "John Smith" }],
    });
    const { meta } = await runExtract({
      html: page(`${metaTag("citation_author", "Doe, Jane")}<script type="application/ld+json">${ld}</script>`),
      url: "https://example.com/ld",
      slug: "ld",
    });
    expect(meta.byline).toBe("Jane Doe, John Smith");
    /* And no one-name list beside a two-name byline (plan 260929d). */
    expect(meta.authors).toBeUndefined();
  });

  it("a page with only a plain author tag keeps Readability's byline", async () => {
    const { meta } = await runExtract({ html: page(metaTag("author", "Jane Doe")), url: "https://example.com/n", slug: "n" });
    expect(meta.byline).toBe("Jane Doe");
  });
});
