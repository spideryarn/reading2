/**
 * Everything in stage 2's PDF path that is arithmetic rather than a model —
 * which is deliberately most of it. No network, no key, no PDF.
 *
 * The one thing worth saying about the shape of these tests: `runPdfExtract`
 * takes a `PdfReader`, so the model is a stub here and the *check* is real. A
 * transcription that loses a page fails in this file, at no cost, rather than
 * in production at the price of a full transcription.
 */
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/**
 * Every warning the stage wrote, because the one thing it logs is a cache entry
 * it had to throw away — and a discard nobody can see is how the crash that
 * caused it stays invisible.
 *
 * The logger is `silent` under vitest by construction (src/log.ts § level), so
 * replacing the module is the only way to read what it was asked to write.
 */
const warnings = vi.hoisted(
  () => [] as { fields: Record<string, unknown>; msg?: string | undefined }[],
);
vi.mock("../src/log.js", () => {
  const at = (level: string) => (a: unknown, b?: string) => {
    if (level !== "warn") return;
    warnings.push(
      typeof a === "string" ? { fields: {}, msg: a } : { fields: a as Record<string, unknown>, msg: b },
    );
  };
  const fake = (): unknown => ({
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    child: () => fake(),
  });
  return {
    log: () => fake(),
    errorFields: (err: unknown) => ({ err }),
    since: (started: number) => Date.now() - started,
  };
});

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

  /**
   * `into` runs the stage over a directory that already exists, which is the
   * only way to exercise the chunk cache: the key is deterministic, so a second
   * run over the same `dataDir` finds the first run's answers.
   */
  async function run(sabotage?: (r: PdfRecord[]) => PdfRecord[], into?: string) {
    asks = 0;
    const bytes = new Uint8Array(await readFile(EASY));
    const dir = into ?? (await mkdtemp(path.join(tmpdir(), "spya-pdf-")));
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
       turns off. src/pdf-read.ts.

       That last sentence was written before it happened, and on 2026-08-30 it
       did: the gate failed whole papers over a margin stamp and chart axis
       labels, and it got turned off. So this no longer rejects — but the retry
       it is actually about is unchanged, and the count below is the assertion
       that was always doing the work. */
    await run((records) => records.filter((r) => r.page !== 3));
    const chunks = asks;
    await run();
    expect(chunks).toBe(asks + 1);
  }, 60_000);

  /* ============================================== what the checker still sees ==
     These two used to assert `rejects.toThrow`, and that was the right spec
     until 2026-08-30. The stage no longer refuses: it publishes and records the
     complaint on `meta.quality` (Greg's call — the long note at the end of
     `runPdfExtract` has the production evidence and the cost).

     So what is under test moved rather than went away, and it is worth being
     exact about which half. **The detection is unchanged and still asserted
     here**; only the consequence changed. If a later reader restores a gate,
     these are the two cases to make fatal first — a page transcribed as nothing
     at all, and a dropped paragraph, are the failures pass 0 was built for, and
     are nothing like the margin stamp and chart axis labels that forced the
     change. */

  it("still notices a page that comes back empty, and says which", async () => {
    const result = await run((records) => records.filter((r) => r.page !== 3));
    expect(result.meta.quality?.join(" ")).toMatch(/No records at all for page 3/);
  }, 30_000);

  it("still notices a silently dropped paragraph", async () => {
    const result = await run((records) => {
      const victim = records.findIndex((r) => r.page === 5 && r.text.split(" ").length > 12);
      return records.filter((_, i) => i !== victim);
    });
    expect(result.meta.quality?.join(" ")).toMatch(/missing from the transcription/);
  }, 30_000);

  it("says nothing when the transcription is clean", async () => {
    /* The control, and it earns its place: both assertions above would pass if
       `quality` were filled in unconditionally with every page's worth of
       noise. An article that read correctly must carry no complaint at all. */
    const result = await run();
    expect(result.meta.quality).toBeUndefined();
  }, 30_000);

  /* ================================= the chunk cache, and what a crash leaves ==
     Every entry under `pdf-chunks/` is a paid vision-model call, so the two
     things that can go wrong here pull in opposite directions and both cost
     money: a valid entry that stops being read re-buys the call on every run,
     and a corrupt entry that is not tolerated wedges the article for ever,
     because the key is deterministic and nothing in the codebase deletes these
     files. Both directions get a test. See docs/postmortems/pdf-chunk-cache-corrupt-entry.md. */
  describe("the chunk cache", () => {
    async function cacheFiles(dir: string): Promise<string[]> {
      const names = await readdir(path.join(dir, "pdf-chunks"));
      return names.filter((n) => n.endsWith(".json")).sort();
    }

    /**
     * **Every real cache key is one the checkpoint store would accept.**
     *
     * `docs/plans/delete-the-importer.md` § B3 moves these entries into a
     * `checkpoints` table whose `key` column carries a CHECK constraint,
     * `^[a-z0-9][a-z0-9_-]{0,127}$` — narrower than "any string", because the
     * filesystem adapter turns the key into a file name and macOS is
     * case-insensitive.
     *
     * This asserts it against **the keys this code actually mints**, not
     * against a copy of the expression written into a test. The key is computed
     * inline in `runPdfExtract` and is not exported, so the only honest way to
     * see one is to run the stage and read the file names back — which is what
     * `cacheFiles` already does for the tests below. Upper-case hex, a `:` or
     * `=` separator, or a base64url `+` would every one of them pass a test
     * that re-derived the key, and then be rejected by the database in landing
     * D. `docs/reusable/silent-success.md`.
     *
     * The regex is duplicated here rather than imported, deliberately: importing
     * `src/store/checkpoints.ts` from a stage test would let a change to the
     * constraint silently relax this assertion at the same moment. If the two
     * disagree, one of them is wrong and somebody should look.
     */
    it("mints cache keys the checkpoint store's key constraint accepts", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "spya-pdf-key-"));
      await run(undefined, dir);
      const names = await cacheFiles(dir);
      /* Not vacuous: a run that cached nothing would pass every assertion
         below about the contents of an empty list. */
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        expect(name.endsWith(".json")).toBe(true);
        expect(name.replace(/\.json$/, "")).toMatch(/^[a-z0-9][a-z0-9_-]{0,127}$/);
      }
    }, 60_000);

    it("reads a well-formed entry back rather than paying for the call again", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "spya-pdf-cache-"));
      const first = await run(undefined, dir);
      expect(asks).toBeGreaterThan(0);
      expect((await cacheFiles(dir)).length).toBe(first.chunks);

      const again = await run(undefined, dir);
      /* The load-bearing assertion in this file: zero. One ask here is one
         vision-model call bought a second time for nothing. */
      expect(asks).toBe(0);
      expect(again.records).toBe(first.records);
    }, 60_000);

    it("treats a half-written entry as a miss, not as a failure of the whole step", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "spya-pdf-cache-"));
      const first = await run(undefined, dir);
      const names = await cacheFiles(dir);
      expect(names.length).toBeGreaterThan(1);

      /* Exactly what `writeFile` leaves behind when the process dies mid-write:
         the file exists, and it stops in the middle of a record. */
      const victim = path.join(dir, "pdf-chunks", names[0]!);
      const whole = await readFile(victim, "utf-8");
      await writeFile(victim, whole.slice(0, Math.floor(whole.length / 2)), "utf-8");
      expect(() => JSON.parse(whole.slice(0, Math.floor(whole.length / 2)))).toThrow(SyntaxError);

      const again = await run(undefined, dir);
      expect(again.records).toBe(first.records);
      /* One, not all of them: the damaged chunk is re-read and every intact
         entry beside it is still used. */
      expect(asks).toBe(1);
      /* And the good entry is back on disk, so the next run pays nothing. */
      expect(JSON.parse(await readFile(victim, "utf-8")).records.length).toBeGreaterThan(0);
    }, 60_000);

    it("says in the log that it threw an entry away, since nothing else records the crash", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "spya-pdf-cache-"));
      await run(undefined, dir);
      const names = await cacheFiles(dir);
      await writeFile(path.join(dir, "pdf-chunks", names[0]!), "{ \"records\": [", "utf-8");

      warnings.length = 0;
      await run(undefined, dir);
      expect(warnings.length).toBe(1);
      expect(warnings[0]?.msg).toMatch(/cache/i);
      expect(warnings[0]?.fields).toMatchObject({ slug: "paper", chunk: names[0]!.replace(".json", "") });
    }, 60_000);

    it("leaves no scratch file behind, so the next run does not read one", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "spya-pdf-cache-"));
      await run(undefined, dir);
      const names = await readdir(path.join(dir, "pdf-chunks"));
      expect(names.filter((n) => !n.endsWith(".json"))).toEqual([]);
    }, 60_000);
  });
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
