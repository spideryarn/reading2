/**
 * The declared authors' affiliations, read off any web page's opening by one
 * cheap call and held to the page's own words — src/front-matter-authors.ts.
 *
 * The arXiv fixtures are the real title blocks in `tests/fixtures/latexml/`
 * (emails replaced), read through `runExtract` so the opening is what import
 * reads: after the title-block rewrite, before Readability. The model is a stub
 * gateway that answers what each test says; nothing here spends. What the real
 * model answers, and what it costs, is evals/front-matter/measure.ts.
 *
 * docs/plans/261009u-a-general-authors-pass-for-every-web-page.md.
 */
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import type { AuthorAnswer } from "../src/pdf-authors.js";
import { runExtract } from "../src/extract.js";
import {
  type FrontMatterAuthorsReader,
  type FrontMatterGateway,
  type OpeningRecord,
  checkFrontMatterAnswer,
  frontMatterAuthorsReader,
  markHidden,
  pageOpening,
  readFrontMatterAuthors,
} from "../src/front-matter-authors.js";
import type { Author } from "../src/types.js";

const fx = (name: string) =>
  readFileSync(new URL(`./fixtures/latexml/${name}.html`, import.meta.url), "utf8").replace(/^<!--[\s\S]*?-->\n/u, "");
const page = (body: string, head = "") =>
  `<!doctype html><html lang="en"><head><title>A Paper</title>${head}</head><body><nav><a href="/">Home</a> <a href="/list">Site menu</a></nav><article class="ltx_document ltx_authors_1line">${body}</article><footer>Site footer by Somebody Else</footer></body></html>`;
const prose = `<section class="ltx_section"><p>${"The dominant sequence transduction models are based on complex recurrent networks. ".repeat(12)}</p></section>`;
const attentionBody = `<h1 class="ltx_title ltx_title_document">Attention Is All You Need</h1>${fx("authors-1706-03762v7")}${prose}`;
const ARXIV = "https://arxiv.org/html/1706.03762v7";

const ATTENTION: [string, string[]][] = [
  ["Ashish Vaswani", ["Google Brain"]],
  ["Noam Shazeer", ["Google Brain"]],
  ["Niki Parmar", ["Google Research"]],
  ["Jakob Uszkoreit", ["Google Research"]],
  ["Llion Jones", ["Google Research"]],
  ["Aidan N. Gomez", ["University of Toronto"]],
  ["Łukasz Kaiser", ["Google Brain"]],
  ["Illia Polosukhin", []],
];
const NAMES = ATTENTION.map(([n]) => n);
const attention = (): Author[] => ATTENTION.map(([name, affiliations]) => ({ name, affiliations: [...affiliations] }));

/** What `runExtract` hands the reader: the opening and the declared names. */
async function handed(html: string, url = ARXIV): Promise<{ records: OpeningRecord[]; declared: string[] }> {
  let got: { records: OpeningRecord[]; declared: string[] } | null = null;
  await runExtract({
    html,
    url,
    slug: "front-matter-test",
    frontMatterAuthors: async (records, declared) => {
      got = { records: [...records], declared: [...declared] };
      return null;
    },
  });
  if (!got) throw new Error("the reader was not asked");
  return got;
}

const rec = (...texts: string[]): OpeningRecord[] => texts.map((text, i) => ({ id: `r${i + 1}`, text }));
const markedRec = (...rows: Array<[text: string, ...marks: string[]]>): OpeningRecord[] =>
  rows.map(([text, ...marks], i) => ({ id: `r${i + 1}`, text, ...(marks.length ? { marks } : {}) }));
const opening = (html: string) => {
  const doc = new JSDOM(html).window.document;
  markHidden(doc);
  return pageOpening(doc).map((r) => r.text);
};

/** A gateway that answers `authors` as the model's JSON, and counts its calls. */
const answering = (authors: AuthorAnswer[] | unknown, calls: { n: number } = { n: 0 }): FrontMatterGateway => async () => {
  calls.n++;
  return {
    json: { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ authors }) } }] },
    answeredBy: null,
    generationId: null,
  };
};

describe("pageOpening: the page's visible text from its main heading on, before Readability", () => {
  it("has every Attention author's row, each name apart from its institution", async () => {
    const { records, declared } = await handed(page(attentionBody));
    expect(declared).toEqual(NAMES);
    expect(records[0]!.text).toBe("Attention Is All You Need");
    for (const name of NAMES) expect(records.some((r) => r.text.startsWith(name))).toBe(true);
    /* `Noam Shazeer<sup>1</sup><br>Google Brain`: words apart, not `Shazeer1Google`. */
    expect(records.find((r) => r.text.startsWith("Noam Shazeer"))!.text).toMatch(/^Noam Shazeer 1 Google Brain /u);
  });

  it("stays inside the article: no navigation above it, no footer after it", async () => {
    const { records } = await handed(page(attentionBody));
    expect(records.some((r) => /Site menu|Site footer/u.test(r.text))).toBe(false);
  });

  it("reads from the top of the body when there is no heading", () => {
    expect(opening(`<body><p>By Jane Doe</p><p>Text.</p></body>`)).toEqual(["By Jane Doe", "Text."]);
  });

  it("skips scripts and styles", () => {
    expect(opening(`<body><h1>T</h1><script>var x = "Jane Doe";</script><style>p{}</style><p>Jane Doe</p></body>`)).toEqual(["T", "Jane Doe"]);
  });

  it("leaves out what the page hides from its reader", () => {
    const html = `<body><h1>T</h1><p>Jane Doe <span hidden>Malicious University</span><span style="display: none">Hidden Institute</span><span aria-hidden="true">Aria College</span> Acme University</p></body>`;
    expect(opening(html)).toEqual(["T", "Jane Doe Acme University"]);
  });

  it("reads inline visibility declarations as CSS, including whitespace around the colon", () => {
    const html = `<body><h1>T</h1><p>Jane Doe <span style="display : none">Malicious University</span><span style="visibility : hidden">Hidden Institute</span><span style="opacity: 0">Invisible College</span><span style="filter: opacity(0)">Filtered Academy</span><span style="content-visibility: hidden">Suppressed Laboratory</span> Acme University</p></body>`;
    expect(opening(html)).toEqual(["T", "Jane Doe Acme University"]);
  });

  it("leaves out text hidden by a style rule in the page", () => {
    const html = `<head><style>.secret-affiliation { display: none }</style></head><body><h1>T</h1><p>Jane Doe <span class="secret-affiliation">Malicious University</span> Acme University</p></body>`;
    expect(opening(html)).toEqual(["T", "Jane Doe Acme University"]);
  });

  it("leaves out text a page hid with aria-hidden even though stage 2 un-hides it for Readability", async () => {
    const body = `<h1 class="ltx_title ltx_title_document">Attention Is All You Need</h1>${fx("authors-1706-03762v7").replace("Google Brain", '<span aria-hidden="true">Malicious University</span>Google Brain')}${prose}`;
    const { records } = await handed(page(body));
    expect(records.some((r) => r.text.includes("Malicious"))).toBe(false);
  });

  /* **A known gap, kept visible.** The LaTeXML rewrite moves a hidden contact's
     bare text into a new row, and an attribute cannot ride on a text node.
     Closing it meant wrapping hidden text in new elements on every page before
     `prepareDocument`, which this change declined (src/front-matter-authors.ts
     § markHidden; plan 261009u § The code review). `it.fails` turns red the day
     it is closed, so this line gets rewritten then. */
  it.fails("keeps hidden provenance when the LaTeXML rewrite moves a hidden element's bare text", async () => {
    const authors = fx("authors-1706-03762v7").replace(
      '<span class="ltx_contact ltx_role_affiliation">',
      '<span class="ltx_contact ltx_role_affiliation" aria-hidden="true">',
    );
    const body = `<h1 class="ltx_title ltx_title_document">Attention Is All You Need</h1>${authors}${prose}`;
    const { records } = await handed(page(body));
    expect(records.find((r) => r.text.startsWith("Ashish Vaswani"))!.text).not.toContain("Google Brain");
  });

  it("leaves no stamp of its own in the extracted article", async () => {
    const body = `<h1 class="ltx_title ltx_title_document">Attention Is All You Need</h1>${fx("authors-1706-03762v7")}<section class="ltx_section"><p hidden>Collapsed.</p>${prose.slice('<section class="ltx_section">'.length)}`;
    const out = await runExtract({ html: page(body), url: ARXIV, slug: "front-matter-test", frontMatterAuthors: async () => null });
    expect(out.extractedHtml).not.toContain("data-spya-hidden");
  });

  it("keeps a superscript marker apart from the words either side", () => {
    expect(opening(`<body><h1>T</h1><p>Jane Doe<sup>1</sup></p><p><sup>1</sup>Acme University</p></body>`)).toEqual(["T", "Jane Doe 1", "1 Acme University"]);
  });

  it("stops walking a page with an unbounded number of empty nodes", () => {
    const empty = "<span></span>".repeat(20_050);
    expect(opening(`<body><h1>T</h1><div>${empty}</div><p>Words after the walk bound.</p></body>`)).toEqual(["T"]);
  });
});

describe("checkFrontMatterAnswer, against the Attention opening", async () => {
  const { records } = await handed(page(attentionBody));

  it("gives each declared name the institution printed beside it", () => {
    expect(checkFrontMatterAnswer(attention(), records, NAMES)).toEqual({ authors: attention() });
  });

  it("refuses an institution the page does not print", () => {
    const a = attention();
    a[0]!.affiliations = ["Google DeepMind"];
    expect(checkFrontMatterAnswer(a, records, NAMES).authors).toBeNull();
  });

  it("refuses an institution that is printed, but beside somebody else (Vaswani given Parmar's)", () => {
    const a = attention();
    a[0]!.affiliations = ["Google Research"];
    expect(checkFrontMatterAnswer(a, records, NAMES).authors).toBeNull();
  });

  it("refuses a declared author left out", () => {
    expect(checkFrontMatterAnswer(attention().filter((x) => x.name !== "Llion Jones"), records, NAMES).authors).toBeNull();
  });

  it("refuses the declared names out of order", () => {
    const a = attention();
    [a[0], a[1]] = [a[1]!, a[0]!];
    expect(checkFrontMatterAnswer(a, records, NAMES).authors).toBeNull();
  });

  it("refuses one name split into two people", () => {
    const a = attention();
    a.splice(0, 1, { name: "Ashish", affiliations: ["Google Brain"] }, { name: "Vaswani", affiliations: ["Google Brain"] });
    expect(checkFrontMatterAnswer(a, records, NAMES).authors).toBeNull();
  });

  it("refuses two people merged into one name, which the byline's words alone allow", () => {
    const a = attention();
    a.splice(0, 2, { name: "Ashish Vaswani Noam Shazeer", affiliations: ["Google Brain"] });
    expect(checkFrontMatterAnswer(a, records, NAMES).authors).toBeNull();
  });

  it("refuses an answer that adds nothing to the declared names", () => {
    expect(checkFrontMatterAnswer(attention().map((x) => ({ ...x, affiliations: [] })), records, NAMES).authors).toBeNull();
  });
});

describe("checkFrontMatterAnswer: whose institution is it", () => {
  const two = ["Alice Smith", "Bob Jones"];

  it("takes a footnote marker printed on the name and before the institution (2610.08785's shape)", () => {
    const records = markedRec(["A Title"], ["Alice Smith 1", "1"], ["Bob Jones 1", "1"], ["1 EECS, MIT, Cambridge MA, USA"]);
    const both = two.map((name) => ({ name, affiliations: ["EECS, MIT, Cambridge MA, USA"] }));
    expect(checkFrontMatterAnswer(both, records, two).authors).toEqual(both);
  });

  it("refuses a swap across a separate numbered list (GPT Sol, plan review P1-1)", () => {
    const records = markedRec(["A Title"], ["Alice Smith 1", "1"], ["Bob Jones 2", "2"], ["1 Alpha University"], ["2 Beta Institute"]);
    const swapped = [
      { name: "Alice Smith", affiliations: ["Beta Institute"] },
      { name: "Bob Jones", affiliations: ["Alpha University"] },
    ];
    expect(checkFrontMatterAnswer(swapped, records, two).authors).toBeNull();
    const right = [
      { name: "Alice Smith", affiliations: ["Alpha University"] },
      { name: "Bob Jones", affiliations: ["Beta Institute"] },
    ];
    expect(checkFrontMatterAnswer(right, records, two).authors).toEqual(right);
  });

  it("refuses a swap when names and institutions share one record (GPT Sol, plan review P1-1)", () => {
    const records = rec("A Title", "Alice Smith 1 Bob Jones 2 1 Alpha University 2 Beta Institute");
    const swapped = [
      { name: "Alice Smith", affiliations: ["Beta Institute"] },
      { name: "Bob Jones", affiliations: ["Alpha University"] },
    ];
    expect(checkFrontMatterAnswer(swapped, records, two).authors).toBeNull();
  });

  it("takes an unmarked institution printed once for everyone, given to everyone", () => {
    const records = rec("A Title", "Alice Smith, Bob Jones", "From the Acme University, Springfield");
    const both = two.map((name) => ({ name, affiliations: ["Acme University, Springfield"] }));
    expect(checkFrontMatterAnswer(both, records, two).authors).toEqual(both);
  });

  it("refuses an unmarked shared line split between the authors by what the model knows of them (JCO 2005)", () => {
    const records = rec("A Title", "Alice Smith, Bob Jones", "From Acme University; and Beta Institute");
    const split = [
      { name: "Alice Smith", affiliations: ["Acme University"] },
      { name: "Bob Jones", affiliations: ["Beta Institute"] },
    ];
    expect(checkFrontMatterAnswer(split, records, two).authors).toBeNull();
  });

  /* Caught by `verifyAuthors`' name shape (the declared names are joined with commas, and a name has
     none); the names-equal check behind it is the second line, which no single case isolates today. */
  it("refuses two declared people merged into one, which would drop the second from the list", () => {
    const records = rec("A Title", "Alice Smith, Bob Jones", "Acme University");
    expect(checkFrontMatterAnswer([{ name: "Alice Smith Bob Jones", affiliations: ["Acme University"] }], records, two).authors).toBeNull();
  });

  it("refuses an institution made by dropping a real prefix as though it were a marker", () => {
    const records = rec("A Title", "Alice Smith", "3M Company");
    expect(checkFrontMatterAnswer([{ name: "Alice Smith", affiliations: ["M Company"] }], records, ["Alice Smith"]).authors).toBeNull();
  });

  it("refuses an institution made of words something else sits between", () => {
    const records = rec("A Title", "Alice Smith Department INJECTED WORDS University");
    expect(checkFrontMatterAnswer([{ name: "Alice Smith", affiliations: ["Department University"] }], records, ["Alice Smith"]).authors).toBeNull();
  });

  it("does not mistake an author's name inside an institution for an author row", () => {
    const records = rec("A Title", "Alice Smith", "New York University");
    const answer = [
      { name: "Alice Smith", affiliations: [] },
      { name: "York", affiliations: ["New York University"] },
    ];
    expect(checkFrontMatterAnswer(answer, records, ["Alice Smith", "York"]).authors).toBeNull();
  });

  it("does not treat an ordinary marker-shaped word after a name as a footnote marker", () => {
    const records = rec("A Title", "Alice Smith D", "D Delta Institute");
    expect(checkFrontMatterAnswer([{ name: "Alice Smith", affiliations: ["Delta Institute"] }], records, ["Alice Smith"]).authors).toBeNull();
  });

  it("is nothing when the page declares nobody", () => {
    expect(checkFrontMatterAnswer([{ name: "Alice Smith", affiliations: ["Acme"] }], rec("Alice Smith Acme"), []).authors).toBeNull();
  });
});

describe("readFrontMatterAuthors and the pipeline's reader", () => {
  const records = rec("A Title", "Jane Doe Acme University");
  const good = [{ name: "Jane Doe", affiliations: ["Acme University"] }];

  it("is one call, held to the page", async () => {
    const calls = { n: 0 };
    expect((await readFrontMatterAuthors(records, ["Jane Doe"], { gateway: answering(good, calls) })).authors).toEqual(good);
    expect(calls.n).toBe(1);
  });

  it("makes no call for an empty opening or no declared names", async () => {
    const calls = { n: 0 };
    expect((await readFrontMatterAuthors([], ["Jane Doe"], { gateway: answering(good, calls) })).authors).toBeNull();
    expect((await readFrontMatterAuthors(records, [], { gateway: answering(good, calls) })).authors).toBeNull();
    expect(calls.n).toBe(0);
  });

  it("throws on an answer that is not the schema's shape", async () => {
    await expect(readFrontMatterAuthors(records, ["Jane Doe"], { gateway: answering("Jane") })).rejects.toThrow(/refused/u);
  });

  it("is null, not a failed import, when the call fails", async () => {
    const read = frontMatterAuthorsReader(
      { slug: "s", signal: new AbortController().signal },
      { gateway: async () => Promise.reject(new Error("upstream 502")) },
    );
    expect(await read(records, ["Jane Doe"])).toBeNull();
  });

  it("re-throws when the job is aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const read = frontMatterAuthorsReader({ slug: "s", signal: ac.signal }, { gateway: answering(good) });
    await expect(read(records, ["Jane Doe"])).rejects.toThrow();
  });

  it("is null on a refusal", async () => {
    const read = frontMatterAuthorsReader(
      { slug: "s", signal: new AbortController().signal },
      { gateway: answering([{ name: "Jane Doe", affiliations: ["Beta Institute"] }]) },
    );
    expect(await read(records, ["Jane Doe"])).toBeNull();
  });
});

describe("runExtract with the reader", () => {
  const extract = (reader: FrontMatterAuthorsReader, head = "", body = attentionBody) =>
    runExtract({ html: page(body, head), url: ARXIV, slug: "front-matter-test", frontMatterAuthors: reader });
  const counting = () => {
    const calls = { n: 0 };
    const reader: FrontMatterAuthorsReader = async () => {
      calls.n++;
      return null;
    };
    return { calls, reader };
  };

  it("stores the affiliations on meta.authors, the byline unchanged", async () => {
    const out = await extract(async (records, declared) => checkFrontMatterAnswer(attention(), records, declared).authors);
    expect(out.meta.authors).toEqual(attention());
    expect(out.meta.byline).toBe(NAMES.join("; "));
  });

  it("keeps the declared names alone when the reader gives nothing", async () => {
    const out = await extract(async () => null);
    expect(out.meta.authors).toEqual(NAMES.map((name) => ({ name, affiliations: [] })));
  });

  it("asks for a page that declares names in citation_author tags without institutions", async () => {
    const { calls, reader } = counting();
    await extract(reader, NAMES.map((n) => `<meta name="citation_author" content="${n}">`).join(""));
    expect(calls.n).toBe(1);
  });

  it("does not ask when the page's meta tags already give an affiliation", async () => {
    const { calls, reader } = counting();
    await extract(reader, `<meta name="citation_author" content="Ashish Vaswani"><meta name="citation_author_institution" content="Google Brain">`);
    expect(calls.n).toBe(0);
  });

  it("does not ask a page that declares no authors", async () => {
    const { calls, reader } = counting();
    const out = await runExtract({
      html: `<!doctype html><html><head><title>Essay</title></head><body><article><h1>Essay</h1><p>By Jane Doe, Acme University</p>${prose}</article></body></html>`,
      url: "https://example.org/essay",
      slug: "front-matter-blog",
      frontMatterAuthors: reader,
    });
    expect(calls.n).toBe(0);
    expect(out.meta.authors).toBeUndefined();
  });

  it("does not ask for a page it refuses as too short", async () => {
    const { calls, reader } = counting();
    await expect(extract(reader, "", `<h1 class="ltx_title ltx_title_document">A</h1>${fx("authors-2610-08785")}<p>Too short.</p>`)).rejects.toThrow();
    expect(calls.n).toBe(0);
  });
});
