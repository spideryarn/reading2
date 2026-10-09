/**
 * An arXiv HTML paper's affiliations, read by the PDF path's authors pass and
 * held to the title block's own words — src/arxiv-affiliations.ts.
 *
 * The fixtures are the real title blocks in `tests/fixtures/latexml/` (emails
 * replaced). The model is a stub that answers what each test says: nothing here
 * spends. What the real model answers, and what it costs, is
 * evals/arxiv-affiliations/measure.ts.
 *
 * docs/plans/261009m-arxiv-html-affiliations-by-the-authors-pass.md.
 */
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  type AffiliationReader,
  type TitleBlock,
  arxivAffiliationReader,
  readArxivAffiliations,
  titleBlockRecords,
} from "../src/arxiv-affiliations.js";
import { runExtract } from "../src/extract.js";
import { latexmlTitleBlock } from "../src/latexml.js";
import { type AuthorAnswer, type AuthorsReader, parseAuthors } from "../src/pdf-authors.js";

const fx = (name: string) =>
  readFileSync(new URL(`./fixtures/latexml/${name}.html`, import.meta.url), "utf8").replace(/^<!--[\s\S]*?-->\n/u, "");
const page = (body: string, head = "") =>
  `<!doctype html><html lang="en"><head><title>A Paper</title>${head}</head><body><article class="ltx_document ltx_authors_1line">${body}</article></body></html>`;
const blockOf = (name: string, url = "https://arxiv.org/html/1706.03762v7") =>
  latexmlTitleBlock(new JSDOM(page(fx(name)), { url }).window.document)!;

const ATTENTION_AFFILIATIONS: [string, string[]][] = [
  ["Ashish Vaswani", ["Google Brain"]],
  ["Noam Shazeer", ["Google Brain"]],
  ["Niki Parmar", ["Google Research"]],
  ["Jakob Uszkoreit", ["Google Research"]],
  ["Llion Jones", ["Google Research"]],
  ["Aidan N. Gomez", ["University of Toronto"]],
  ["Łukasz Kaiser", ["Google Brain"]],
  ["Illia Polosukhin", []],
];
const attentionAnswer = (): AuthorAnswer[] =>
  ATTENTION_AFFILIATIONS.map(([name, affiliations]) => ({ name, affiliations: [...affiliations] }));

/** A reader that answers `answer` and remembers each prompt. */
const stub = (answer: AuthorAnswer[], seen: string[] = []): AuthorsReader => ({
  id: "test/stub",
  usage: () => ({ input: 0, output: 0 }),
  async ask(prompt) {
    seen.push(prompt);
    return parseAuthors(JSON.stringify({ authors: answer }));
  },
});

describe("the title block as the authors pass's records", () => {
  it("is the markup's names as the byline, then one line per author with LaTeXML's furniture out", () => {
    const block = blockOf("authors-1706-03762v7");
    expect(block.names).toHaveLength(8);
    const records = titleBlockRecords(block);
    expect(records[0]).toMatchObject({ id: "names", text: block.names.join(", ") });
    expect(records).toHaveLength(9);
    const shazeer = records.find((r) => r.text.startsWith("Noam Shazeer"))!;
    expect(shazeer.text).toContain("Google Brain");
    for (const r of records) expect(r.text).not.toMatch(/Affiliation:|Email:|footnotemark|thanks:/u);
  });

  it("is null wherever the names are: institutions marked up as creators", () => {
    expect(latexmlTitleBlock(new JSDOM(page(fx("authors-2610-08781")), { url: "https://arxiv.org/html/2610.08781" }).window.document)).toBeNull();
  });

  it("is null away from a LaTeXML address", () => {
    expect(latexmlTitleBlock(new JSDOM(page(fx("authors-1706-03762v7")), { url: "https://example.org/paper" }).window.document)).toBeNull();
  });
});

describe("readArxivAffiliations", () => {
  const block = blockOf("authors-1706-03762v7");

  it("gives each markup name the affiliations the page prints for it", async () => {
    const verdict = await readArxivAffiliations(block, stub(attentionAnswer()));
    expect(verdict.authors).toEqual(attentionAnswer());
  });

  it("finds one institution LaTeXML split across three labelled contacts (2610.08392)", async () => {
    const trento = blockOf("authors-2610-08392", "https://arxiv.org/html/2610.08392");
    const answer = trento.names.map((name) => ({
      name,
      affiliations: name === "Asiye Malkoç" ? ["Department of Cellular, Computational and Integrative Biology, University of Trento, Italy"]
        : name === "Yuri Bozzi" ? ["Center for Mind/ Brain Sciences, University of Trento, Italy"]
        : ["Department of Physics, University of Trento, Italy"],
    }));
    const verdict = await readArxivAffiliations(trento, stub(answer));
    expect(verdict.authors?.[0]).toEqual({ name: "Ilya Auslender", affiliations: ["Department of Physics, University of Trento, Italy"] });
  });

  it("refuses an affiliation the page does not print", async () => {
    const answer = attentionAnswer();
    answer[0]!.affiliations = ["Google DeepMind"];
    expect(await readArxivAffiliations(block, stub(answer))).toMatchObject({ authors: null });
  });

  it("refuses a list with somebody left out", async () => {
    const answer = attentionAnswer().filter((a) => a.name !== "Llion Jones");
    expect(await readArxivAffiliations(block, stub(answer))).toMatchObject({ authors: null });
  });

  it("refuses one name split into two people", async () => {
    const answer = attentionAnswer();
    answer.splice(0, 1, { name: "Ashish", affiliations: ["Google Brain"] }, { name: "Vaswani", affiliations: ["Google Brain"] });
    expect(await readArxivAffiliations(block, stub(answer))).toMatchObject({ authors: null });
  });

  it("refuses an institution that is printed, but beside somebody else", async () => {
    const answer = attentionAnswer();
    answer[0]!.affiliations = ["Google Research"];
    expect(await readArxivAffiliations(block, stub(answer))).toMatchObject({ authors: null });
  });

  it("refuses the names out of order", async () => {
    const answer = attentionAnswer();
    [answer[0], answer[1]] = [answer[1]!, answer[0]!];
    expect(await readArxivAffiliations(block, stub(answer))).toMatchObject({ authors: null });
  });

  it("refuses a list where nobody has an institution: it would say nothing", async () => {
    const answer = attentionAnswer().map((a) => ({ name: a.name, affiliations: [] }));
    expect(await readArxivAffiliations(block, stub(answer))).toMatchObject({ authors: null });
  });
});

describe("arxivAffiliationReader, the pipeline's wrapper", () => {
  const block = blockOf("authors-1706-03762v7");
  const failing = (err: Error): AuthorsReader => ({
    id: "test/failing",
    usage: () => ({ input: 0, output: 0 }),
    async ask() {
      throw err;
    },
  });

  it("is null, not a failed import, when the call fails", async () => {
    const read = arxivAffiliationReader(failing(new Error("upstream 502")), { slug: "s", signal: new AbortController().signal });
    expect(await read(block)).toBeNull();
  });

  it("re-throws when the job is aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const read = arxivAffiliationReader(failing(new Error("aborted")), { slug: "s", signal: ac.signal });
    await expect(read(block)).rejects.toThrow();
  });

  it("is null on a refusal", async () => {
    const answer = attentionAnswer();
    answer[0]!.affiliations = ["Google DeepMind"];
    const read = arxivAffiliationReader(stub(answer), { slug: "s", signal: new AbortController().signal });
    expect(await read(block)).toBeNull();
  });
});

describe("runExtract with an affiliations reader", () => {
  const prose = `<p>${"The dominant sequence transduction models are based on complex recurrent networks. ".repeat(12)}</p>`;
  const body = `<h1 class="ltx_title ltx_title_document">Attention Is All You Need</h1>${fx("authors-1706-03762v7")}<section class="ltx_section">${prose}</section>`;
  const extract = (affiliations?: AffiliationReader, head = "") =>
    runExtract({ html: page(body, head), url: "https://arxiv.org/html/1706.03762v7", slug: "arxiv-affiliations", ...(affiliations ? { affiliations } : {}) });

  it("stores the affiliations on meta.authors, the byline unchanged", async () => {
    const seen: TitleBlock[] = [];
    const out = await extract(async (block) => {
      seen.push(block);
      return readArxivAffiliations(block, stub(attentionAnswer())).then((v) => v.authors);
    });
    expect(seen).toHaveLength(1);
    expect(out.meta.authors).toEqual(attentionAnswer());
    expect(out.meta.byline).toBe(ATTENTION_AFFILIATIONS.map(([n]) => n).join("; "));
  });

  it("keeps the names alone when the reader gives nothing", async () => {
    const out = await extract(async () => null);
    expect(out.meta.authors).toEqual(ATTENTION_AFFILIATIONS.map(([name]) => ({ name, affiliations: [] })));
  });

  it("does not ask when the page declares the very same authors in citation_author tags", async () => {
    let asked = 0;
    const names = ATTENTION_AFFILIATIONS.map(([n]) => n);
    const out = await extract(
      async () => {
        asked++;
        return null;
      },
      names.map((n) => `<meta name="citation_author" content="${n}">`).join(""),
    );
    expect(asked).toBe(0);
    expect(out.meta.authors?.map((a) => a.name)).toEqual(names);
  });

  it("does not ask for a page it refuses as too short", async () => {
    let asked = 0;
    const short = page(`<h1 class="ltx_title ltx_title_document">A</h1>${fx("authors-2610-08785")}<p>Too short.</p>`);
    await expect(
      runExtract({
        html: short,
        url: "https://arxiv.org/html/1706.03762v7",
        slug: "arxiv-affiliations-short",
        affiliations: async () => {
          asked++;
          return null;
        },
      }),
    ).rejects.toThrow();
    expect(asked).toBe(0);
  });
});

describe("the projection of a creator's text", () => {
  const creator = (contacts: string) =>
    `<div class="ltx_authors"><span class="ltx_creator ltx_role_author"><span class="ltx_personname">Alice Doe</span><span class="ltx_author_notes"><span class="ltx_author_notes_content">${contacts}</span></span></span></div>`;
  const textOf = (contacts: string) =>
    latexmlTitleBlock(new JSDOM(page(creator(contacts)), { url: "https://arxiv.org/html/2610.00001" }).window.document)!.creators[0];

  it("never fuses the words either side of a label it takes out", () => {
    const text = textOf(
      `<span class="ltx_contact ltx_role_affiliation"><span class="ltx_contact_name">Affiliation:</span>Department</span><span class="ltx_contact ltx_role_affiliation"><span class="ltx_contact_name">Affiliation:</span>University</span>`,
    );
    expect(text).toBe("Alice Doe Department University");
  });

  it("keeps a label it has not measured, as words", () => {
    const text = textOf(`<span class="ltx_contact ltx_role_affiliation"><span class="ltx_contact_name">Visiting from:</span> Acme Labs</span>`);
    expect(text).toBe("Alice Doe Visiting from: Acme Labs");
  });
});
