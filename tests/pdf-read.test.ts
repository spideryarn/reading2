/**
 * Everything in stage 2's PDF path that is arithmetic rather than a model —
 * which is deliberately most of it. No network, no key, no PDF.
 *
 * The one thing worth saying about the shape of these tests: `runPdfExtract`
 * takes a `PdfReader`, so the model is a stub here and the *check* is real. A
 * transcription that loses a page fails in this file, at no cost, rather than
 * in production at the price of a full transcription.
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pass0, PdfRecord } from "../src/pdf.js";
import { pass0 } from "../src/pdf.js";
import { check } from "../src/pdf-score.js";
import {
  instructionFor,
  parseRecords,
  type PdfReader,
  planChunks,
  renderHtml,
  runPdfExtract,
  withoutRepeats,
  wordsOf,
} from "../src/pdf-read.js";

const EASY = new URL("../evals/pdf/easy/source.pdf", import.meta.url);

const record = (over: Partial<PdfRecord> = {}): PdfRecord => ({
  page: 1,
  type: "paragraph",
  text: "Some words.",
  continues: false,
  uncertain: false,
  ...over,
});

describe("cutting a document into chunks", () => {
  const pages = (words: number[]): Pass0 => ({
    pages: words.map((w, i) => ({ page: i + 1, text: "", words: w, items: [] })),
    isScan: false,
    metaTitle: null,
      furniture: new Set(),
  });

  it("gives a dense document smaller chunks than a sparse one", () => {
    const dense = planChunks(pages(Array(12).fill(900)));
    const sparse = planChunks(pages(Array(12).fill(100)));
    expect(dense.length).toBeGreaterThan(sparse.length);
  });

  it("covers every page exactly once, in order", () => {
    const covered = planChunks(pages(Array(17).fill(420))).flatMap((c) => c.pages);
    expect(covered).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
  });

  it("never sends more than six pages at once, however empty they are", () => {
    for (const chunk of planChunks(pages(Array(30).fill(0)))) {
      expect(chunk.pages.length).toBeLessThanOrEqual(6);
    }
  });

  it("gives every chunk but the first the page before it, as context", () => {
    const chunks = planChunks(pages(Array(12).fill(900)));
    expect(chunks[0]!.context).toBeUndefined();
    for (const chunk of chunks.slice(1)) expect(chunk.context).toBe(chunk.pages[0]! - 1);
  });

  it("tells the model which page of the attachment is which", () => {
    const said = instructionFor({ pages: [5, 6], context: 4 });
    expect(said).toContain("page 4, included only so you can see");
    expect(said).toContain("DO NOT emit any record for it");
    expect(said).toContain("in order, 4, 5, 6");
  });

  it("plans real chunks for a real PDF", async () => {
    const chunks = planChunks(await pass0(new Uint8Array(await readFile(EASY))));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flatMap((c) => c.pages)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("text the chunk was only meant to look at", () => {
  /* GPT Sol's probe: the context page split into ten short records and
     relabelled as the next page. Every one is under the twenty-word floor the
     exact-repeat rule uses, so every one survived it — and precision treats the
     context page as legitimate source text, so the duplicated page scored 1.0
     on everything. src/pdf-read.ts § withoutRepeats. */
  it("drops the context page however finely it has been chopped up", async () => {
    const bytes = new Uint8Array(await readFile(EASY));
    const pass = await pass0(bytes);
    const contextPage = pass.pages[3]!;
    const wanted = pass.pages[4]!;

    const chopped = contextPage.text
      .split(/\s+/)
      .filter(Boolean)
      .reduce<string[][]>((acc, word, i) => {
        if (i % 10 === 0) acc.push([]);
        acc.at(-1)!.push(word);
        return acc;
      }, [])
      .map((chunk) => record({ page: wanted.page, text: chunk.join(" ") }));

    const honest = wanted.text
      .split("\n")
      .filter((l) => l.trim())
      .map((line) => record({ page: wanted.page, text: line }));

    const kept = withoutRepeats(
      [...chopped, ...honest],
      new Set(),
      wordsOf(pass, [contextPage.page]),
      wordsOf(pass, [wanted.page]),
    );
    /* Nearly all the chopped records go; the real page's records all stay. */
    expect(kept.length).toBeLessThan(chopped.length / 2 + honest.length);
    expect(kept.filter((r) => honest.some((h) => h.text === r.text)).length).toBe(honest.length);
  }, 30_000);
});

describe("records into HTML", () => {
  it("puts the model's words in, and never the model's markup", () => {
    const html = renderHtml([record({ text: "<script>alert(1)</script> & so on" })], "T");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&amp; so on");
  });

  it("joins a paragraph broken across a page rather than starting a new one", () => {
    const html = renderHtml(
      [
        record({ page: 1, text: "The sentence begins" }),
        record({ page: 2, text: "and it ends.", continues: true }),
      ],
      "T",
    );
    expect(html).toContain("<p>The sentence begins and it ends.</p>");
    expect(html.match(/<p>/g)).toHaveLength(1);
  });

  it("does not join across a type change, because that would merge a heading into prose", () => {
    const html = renderHtml(
      [record({ type: "heading2", text: "A heading" }), record({ text: "Prose.", continues: true })],
      "T",
    );
    expect(html).toContain("<h2>A heading</h2>");
    expect(html).toContain("<p>Prose.</p>");
  });

  it("wraps consecutive list items in one list, and closes it", () => {
    const html = renderHtml(
      [
        record({ type: "listitem", text: "one" }),
        record({ type: "listitem", text: "two" }),
        record({ text: "after" }),
      ],
      "T",
    );
    expect(html).toContain("<ul>\n<li>one</li>\n<li>two</li>\n</ul>");
    expect(html.match(/<ul>/g)).toHaveLength(1);
  });

  it("shows a figure as its caption and nothing else", () => {
    const html = renderHtml([record({ type: "figure", text: "Figure 3. A drawing." })], "T");
    expect(html).toContain("<figure><figcaption>Figure 3. A drawing.</figcaption></figure>");
  });

  it("marks a block the model could not fully read, so the reader can see it", () => {
    const html = renderHtml([record({ text: "the ⟦illegible⟧ word", uncertain: true })], "T");
    expect(html).toContain('<p class="pdf-uncertain">the ⟦illegible⟧ word</p>');
  });

  it("leaves out footnotes, references and a cover page — and only those", () => {
    const html = renderHtml(
      [
        record({ type: "cover", text: "Wellcome Library" }),
        record({ type: "heading1", text: "The real title" }),
        record({ text: "Body." }),
        record({ type: "footnote", text: "1. See below." }),
        record({ type: "reference", text: "Smith, J. (1901)." }),
      ],
      "T",
    );
    expect(html).toContain("The real title");
    expect(html).toContain("Body.");
    expect(html).not.toContain("Wellcome");
    expect(html).not.toContain("See below");
    expect(html).not.toContain("Smith");
  });
});

describe("a scan, where recall is a number about nothing", () => {
  it("records no recall at all, and says how many pages were checked", async () => {
    /* One page with a text layer out of seventeen — the digitising library's own
       rights page — used to average to `recall: 1` for a document nobody had
       checked. See src/pdf-read.ts. */
    const scan: Pass0 = {
      pages: Array.from({ length: 3 }, (_, i) => ({
        page: i + 1,
        text: i === 0 ? "Wellcome Collection. This work is licensed." : "",
        words: i === 0 ? 7 : 0,
        items: [],
      })),
      isScan: true,
      metaTitle: null,
      furniture: new Set(),
    };
    const perfect = [
      record({ page: 1, type: "cover", text: "Wellcome Collection. This work is licensed." }),
      record({ page: 2, text: "The lecture begins." }),
      record({ page: 3, text: "And continues." }),
    ];
    const result = check(perfect, [1, 2, 3], scan);
    expect(result.ok).toBe(true);
    expect(result.pages.filter((p) => p.recall !== null)).toHaveLength(1);
  });
});

describe("what comes back from the model", () => {
  it("refuses a record with a type the schema does not have", () => {
    const json = JSON.stringify({ records: [{ ...record(), type: "sidebar" }] });
    expect(() => parseRecords(json)).toThrow(/unknown type: sidebar/);
  });

  it("removes characters that are on no printed page, and says how many", () => {
    /* Observed on the `easy` fixture, every run: the model joins a URL the page
       broke across a line and leaves U+FFFE where the hyphen was. Meaningless,
       invisible, and enough to fail a word-perfect paper. src/pdf-read.ts. */
    const json = JSON.stringify({
      records: [record({ text: "http://example.org/skull\uFFFEshape.html\u200b" })],
    });
    const { records, stripped } = parseRecords(json);
    expect(records[0]!.text).toBe("http://example.org/skullshape.html");
    expect(stripped).toBe(2);
  });

  it("refuses a record with no page number, rather than defaulting it", () => {
    const json = JSON.stringify({ records: [{ type: "paragraph", text: "x" }] });
    expect(() => parseRecords(json)).toThrow(/no page number/);
  });

  it("says so when the answer is not JSON at all", () => {
    expect(() => parseRecords("I'm sorry, I can't help with that.")).toThrow(/other than JSON/);
  });
});

describe("the whole stage, with the model stubbed out", () => {
  /** A reader that transcribes each requested page from the PDF's own text layer. */
  function honestReader(pass: Pass0, sabotage?: (r: PdfRecord[]) => PdfRecord[]): PdfReader {
    return {
      id: "test/honest",
      async read(_pdf, instruction) {
        const asked = [...instruction.matchAll(/\d+/g)].map(Number);
        const sent = instruction.includes("included only so you can see")
          ? asked.slice(1)
          : asked;
        const wanted = new Set(sent);
        const records: PdfRecord[] = [];
        for (const page of pass.pages) {
          if (!wanted.has(page.page)) continue;
          for (const line of page.text.split("\n")) {
            if (line.trim()) records.push(record({ page: page.page, text: line }));
          }
        }
        asks++;
        return {
          records: sabotage ? sabotage(records) : records,
          stripped: 0,
          finish: "stop",
          usage: { input: 100, output: 200 },
          ms: 1,
        };
      },
    };
  }

  /** How many times the stub was asked, so a retry can be counted rather than inferred. */
  let asks = 0;

  async function run(sabotage?: (r: PdfRecord[]) => PdfRecord[]) {
    asks = 0;
    const bytes = new Uint8Array(await readFile(EASY));
    const dir = await mkdtemp(path.join(tmpdir(), "spya-pdf-"));
    const pass = await pass0(bytes);
    return runPdfExtract({
      bytes,
      url: "https://example.test/paper.pdf",
      outFile: path.join(dir, "article.html"),
      dataDir: dir,
      slug: "paper",
      reader: honestReader(pass, sabotage),
    });
  }

  it("writes an article and records what read it", async () => {
    const result = await run();
    expect(result.pages).toBe(8);
    /* Not "Hauntings", which is a section heading three pages in and which an
       earlier version of the title ladder happily used. src/pdf-read.ts. */
    expect(result.meta.title).toBe("Forms of Memory in Post-colonial Australia");
    expect(result.meta.source).toBe("pdf");
    expect(result.meta.method).toBe("test/honest");
    expect(result.meta.pages).toBe(8);
    expect(result.meta.rawSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.meta.unverified).toBeUndefined();
    expect(result.meta.recall).toBeGreaterThan(0.9);
    expect(result.meta.pagesChecked).toBe(8);
    expect(await readFile(result.outFile, "utf-8")).toContain("<article>");
    /* The PDF itself has to be beside the article whatever route made it, or
       the reader's "view the original" link 404s. src/pdf-read.ts. */
    const manifest = JSON.parse(await readFile(path.join(path.dirname(result.outFile), "raw.json"), "utf-8"));
    expect(manifest.kind).toBe("pdf");
    expect(manifest.sha256).toBe(result.meta.rawSha256);
  }, 30_000);

  it("asks a failing chunk exactly once more, and no more", async () => {
    /* Not the fallback the plan forbids — the same call, judged by the same
       check. It exists because the reader drops a clause about one run in
       three, and a gate that fails a whole paper for that is a gate somebody
       turns off. src/pdf-read.ts. */
    await expect(run((records) => records.filter((r) => r.page !== 3))).rejects.toThrow();
    const chunks = asks;
    await run();
    expect(chunks).toBe(asks + 1);
  }, 60_000);

  it("refuses to write anything when a page comes back empty", async () => {
    await expect(run((records) => records.filter((r) => r.page !== 3))).rejects.toThrow(
      /No records at all for page 3/,
    );
  }, 30_000);

  it("refuses when a paragraph is silently dropped", async () => {
    await expect(
      run((records) => {
        const victim = records.findIndex((r) => r.page === 5 && r.text.split(" ").length > 12);
        return records.filter((_, i) => i !== victim);
      }),
    ).rejects.toThrow(/missing from the transcription/);
  }, 30_000);
});

/* ============================================ the transport retry, for real ==
   `openRouterReader` retries a request that never got an answer at all — a
   dropped connection, not a bad answer — and each attempt is its own metered
   call. Every other test in this file replaces the reader entirely, so none of
   them exercises that: the claim in src/pdf-read.ts that a retry produces one
   spend record per attempt was written down and never checked. GPT Sol asked
   for this twice. */

import { collectSpend } from "../src/ai-spend.js";
import { openRouterReader } from "../src/pdf-read.js";

/** A JSON body in the shape `openRouterJson` expects back. */
function pdfAnswer(): Response {
  return new Response(
    JSON.stringify({
      model: "openai/gpt-5.1",
      usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.000_25 },
      choices: [
        {
          message: {
            content: JSON.stringify({ records: [], notes: "" }),
          },
        },
      ],
    }),
    { status: 200, headers: new Headers({ "x-generation-id": "gen-retry-test" }) },
  );
}

describe("openRouterReader's transport retries", () => {
  const savedKey = process.env.OPENROUTER_API_KEY;
  const savedFetch = globalThis.fetch;
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-not-a-real-key";
  });
  afterEach(() => {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedKey;
  });

  it("records one call per attempt — an error, then an ok", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      /* What actually happened to a five-chunk run: `TypeError: fetch failed`
         with an HTTP/2 protocol error underneath, after the first chunk had
         already been paid for. */
      if (calls === 1) throw new TypeError("fetch failed");
      return pdfAnswer();
    }) as typeof globalThis.fetch;

    const { report } = await collectSpend(async () => {
      await openRouterReader("openai/gpt-5.1").read(
        new Uint8Array([1, 2, 3]),
        "read it",
        undefined,
      );
    });

    expect(calls).toBe(2);
    /* **Two rows, not one.** A retry that succeeds has paid for one call and
       possibly for two, and one record per attempt is the only shape that can
       say which. A wrapper that retried inside a single meter would give one row
       here, and the bill would be a third of the truth. */
    expect(report.calls).toHaveLength(2);
    expect(report.calls.map((c) => c.outcome)).toEqual(["error", "ok"]);
    expect(report.calls[0]?.costNanos).toBeNull();
    expect(report.calls[1]?.costNanos).toBe(250_000);
  }, 20_000);
});
