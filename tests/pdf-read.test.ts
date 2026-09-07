/**
 * Everything in stage 2's PDF path that is arithmetic rather than a model —
 * which is deliberately most of it. No network, no key, no PDF.
 *
 * The one thing worth saying about the shape of these tests: `runPdfExtract`
 * takes a `PdfReader`, so the model is a stub here and the *check* is real. A
 * transcription that loses a page fails in this file, at no cost, rather than
 * in production at the price of a full transcription.
 */
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pass0, PdfRecord } from "../src/pdf.js";
import { pass0 } from "../src/pdf.js";
import { check } from "../src/pdf-score.js";
import { PdfReadingShapeError } from "../src/pdf-integrity.js";
import {
  instructionFor,
  parseRecords,
  type ChunkReading,
  type PdfReader,
  planChunks,
  renderHtml,
  runPdfExtract,
  withoutRepeats,
  wordsOf,
} from "../src/pdf-read.js";
import { parsePdfFigureMarker } from "../src/assets.js";
import { memoryCheckpoints, type MemoryCheckpoints } from "./helpers/memory-checkpoints.js";

const EASY = new URL("../evals/pdf/easy/source.pdf", import.meta.url);

/**
 * A raw PDF's sha256, as `renderHtml` requires one.
 *
 * A real-shaped hex string rather than `"x"`: `pdfFigureRef` refuses anything
 * that is not a lowercase sha256, and it refuses it *here* rather than much
 * later, as a lookup that never matches and a figure that never appears.
 */
const RAW_SHA = "a".repeat(64);

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

  /**
   * **A run of image-heavy pages must not grow to the six-page maximum.**
   *
   * Measured, on Kuhn's 142-page paper: pages 8–13 hold the figures, hold
   * almost no text, and so were bounded by nothing but `MAX_CHUNK_PAGES` — one
   * chunk of **4.54 MB** against a 200 KB median for that document, and it was
   * the 354 s call in a run whose per-call mean was 52 s and p95 96 s. The
   * numbers below are that shape, rounded: a light document with six heavy
   * pages in the middle of it.
   */
  const SPARSE = 200 * 1024;
  const HEAVY = 1024 * 1024;
  const HEAVY_RUN = [7, 8, 9, 10, 11, 12];
  const bytesFor = (heavy: readonly number[], count: number) =>
    new Map(
      Array.from({ length: count }, (_, i) => [i + 1, heavy.includes(i + 1) ? HEAVY : SPARSE]),
    );

  it("does not let sparse image-heavy pages grow a chunk past the byte bound", () => {
    /* Eighty words a page is under `ASSUMED_WORDS`, so every page weighs 500 and
       six of them are 3,000 — inside `CHUNK_WORDS`. The words cannot close this
       chunk and the pictures are invisible to them. */
    const pass = pages(Array(20).fill(80));

    const unbounded = planChunks(pass);
    expect(unbounded.some((c) => c.pages.join() === HEAVY_RUN.join())).toBe(true);

    const bounded = planChunks(pass, { pageBytes: bytesFor(HEAVY_RUN, 20) });
    /* Every page still sent, exactly once and in order. */
    expect(bounded.flatMap((c) => c.pages)).toEqual(unbounded.flatMap((c) => c.pages));
    const holding = bounded.filter((c) => c.pages.some((p) => HEAVY_RUN.includes(p)));
    expect(holding.length).toBeGreaterThan(1);
    for (const chunk of holding) {
      expect(chunk.pages.filter((p) => HEAVY_RUN.includes(p)).length).toBeLessThanOrEqual(3);
    }
  });

  it("leaves a document with nothing heavy in it exactly as it was", () => {
    /* The bound must be a bound and not a re-plan: an ordinary paper's chunks
       are the same with the weights as without them. */
    const pass = pages(Array(20).fill(900));
    const without = planChunks(pass).map((c) => c.pages.join());
    const weighed = planChunks(pass, { pageBytes: bytesFor([], 20) }).map((c) => c.pages.join());
    expect(weighed).toEqual(without);
  });

  it("still emits a single page that is bigger than the bound on its own", () => {
    /* Nothing can split one page, so the bound must never be able to drop one.
       Same shape as `CHUNK_WORDS`, which cannot refuse a 10,000-word page. */
    const pass = pages(Array(6).fill(80));
    const huge = new Map([1, 2, 3, 4, 5, 6].map((p) => [p, p === 3 ? 40 * 1024 * 1024 : SPARSE]));
    const chunks = planChunks(pass, { pageBytes: huge });
    expect(chunks.flatMap((c) => c.pages)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(chunks.some((c) => c.pages.includes(3) && c.pages.length === 1)).toBe(true);
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
    const html = renderHtml([record({ text: "<script>alert(1)</script> & so on" })], "T", RAW_SHA);
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
      RAW_SHA,
    );
    expect(html).toContain("<p>The sentence begins and it ends.</p>");
    expect(html.match(/<p>/g)).toHaveLength(1);
  });

  it("does not join across a type change, because that would merge a heading into prose", () => {
    const html = renderHtml(
      [record({ type: "heading2", text: "A heading" }), record({ text: "Prose.", continues: true })],
      "T",
      RAW_SHA,
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
      RAW_SHA,
    );
    expect(html).toContain("<ul>\n<li>one</li>\n<li>two</li>\n</ul>");
    expect(html.match(/<ul>/g)).toHaveLength(1);
  });

  it("shows a figure as its caption, and marks where its picture would be", () => {
    const html = renderHtml([record({ type: "figure", text: "Figure 3. A drawing." })], "T", RAW_SHA);
    expect(html).toContain("<figcaption>Figure 3. A drawing.</figcaption></figure>");
    /* The caption is still the whole of what a *reader* sees at this stage. The
       picture is recovered by the `assets` step and inserted by the reading
       view — stages C and D of
       docs/plans/260906a-figures-from-a-pdf-are-placeholders-with-no-image.md
       — and what has to be here is the marker that lets either of them find it. */
    expect(html).not.toContain("<img");
    const marker = /data-spya-pdf-figure="([^"]+)"/.exec(html)?.[1];
    expect(parsePdfFigureMarker(marker ?? "")).toEqual({ ref: marker, page: 1, ordinal: 1 });
  });

  it("does not mark a table, though it renders as a figure too", () => {
    /* The figure record is the gate the whole recovery route stands on. A page
       holding a figure and a table would otherwise have two claimants and be
       refused as `ambiguous`, so a recoverable figure would be lost to a table
       that was never going to be a bitmap. src/pdf-read.ts § `renderHtml`. */
    const html = renderHtml([record({ type: "table", text: "Table 1. Counts." })], "T", RAW_SHA);
    expect(html).toContain("<figure><figcaption>Table 1. Counts.</figcaption></figure>");
  });

  it("numbers the figures within a page, and starts again on the next one", () => {
    const html = renderHtml(
      [
        record({ page: 3, type: "figure", text: "Figure 1. First." }),
        record({ page: 3, type: "figure", text: "Figure 2. Second." }),
        record({ page: 4, type: "figure", text: "Figure 3. Third." }),
      ],
      "T",
      RAW_SHA,
    );
    const at = [...html.matchAll(/data-spya-pdf-figure="([^"]+)"/g)].map((m) =>
      parsePdfFigureMarker(m[1] ?? ""),
    );
    expect(at.map((m) => [m?.page, m?.ordinal])).toEqual([
      [3, 1],
      [3, 2],
      [4, 1],
    ]);
    /* Three markers, three refs. `pairPageFigures` throws on a repeat rather
       than attach one picture to two captions, so a renderer minting the same
       ref twice would take a whole document down — the right failure, and the
       wrong place to discover it. */
    expect(new Set(at.map((m) => m?.ref)).size).toBe(3);
  });

  it("mints a different ref for the same figure in a different PDF", () => {
    /* The property the ref exists for: a stored asset is carried into a new
       revision, so a ref that did not fold in the raw PDF's own hash would go
       on matching the *previous* document's page three. GPT Sol, D1-5. */
    const figure = [record({ type: "figure", text: "Figure 1. A drawing." })];
    expect(renderHtml(figure, "T", RAW_SHA)).not.toBe(
      renderHtml(figure, "T", `b${RAW_SHA.slice(1)}`),
    );
  });

  it("leaves a captionless figure with no element and therefore no marker", () => {
    /* v1's boundary, stated rather than discovered: `renderHtml` skips an
       empty-text record before it builds anything, so a figure with no printed
       caption has no block to address and nothing to re-mint. Giving those a
       media block of their own is a separate decision. GPT Sol, I-3. */
    const html = renderHtml([record({ type: "figure", text: "   " })], "T", RAW_SHA);
    expect(html).not.toContain("<figure");
    expect(html).not.toContain("data-spya-pdf-figure");
  });

  it("marks a block the model could not fully read, so the reader can see it", () => {
    const html = renderHtml([record({ text: "the ⟦illegible⟧ word", uncertain: true })], "T", RAW_SHA);
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
      RAW_SHA,
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

  it("refuses partial record shapes instead of defaulting missing boolean flags", () => {
    const partial = { page: 1, type: "paragraph", text: "x", continues: false };
    expect(() => parseRecords(JSON.stringify({ records: [partial] }))).toThrow(/no uncertain flag/);
  });

  it.each([[null], [[]], [7], ["record"]])("raises PdfReadingShapeError for malformed record entry %j", (entry) => {
    expect(() => parseRecords(JSON.stringify({ records: [entry] }))).toThrow(PdfReadingShapeError);
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
        const one = /Transcribe page (\d+)/.exec(instruction)?.[1];
        const range = /Transcribe pages (\d+)–(\d+)/.exec(instruction);
        const sent = one
          ? [Number(one)]
          : range
            ? Array.from(
                { length: Number(range[2]) - Number(range[1]) + 1 },
                (_, at) => Number(range[1]) + at,
              )
            : [];
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
   * `into` runs the stage against a checkpoint store that already holds
   * something, which is the only way to exercise resuming: the key is
   * deterministic, so a second run over the same store finds the first run's
   * answers. Without one it gets a fresh store and pays for everything.
   */
  async function run(sabotage?: (r: PdfRecord[]) => PdfRecord[], into?: MemoryCheckpoints) {
    asks = 0;
    const bytes = new Uint8Array(await readFile(EASY));
    const pass = await pass0(bytes);
    return runPdfExtract({
      frontMatter: null,
      bytes,
      url: "https://example.test/paper.pdf",
      checkpoints: into ?? memoryCheckpoints({ slug: "paper", articleId: "article-paper" }),
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
    /* Returned, not written. The stage stopped writing `outFile` on 2026-08-31
       and hands the page back as `extractedHtml` — the same artefact
       `runExtract` returns for a web page, which is what lets stage 3 onwards
       stay ignorant of which extractor ran. */
    expect(result.extractedHtml).toContain("<article>");
  }, 30_000);

  it("asks a chunk with only content warnings exactly once more, and no more", async () => {
    /* Not the fallback the plan forbids — the same call, judged by the same
       check. It exists because the reader drops a clause about one run in
       three, and a gate that fails a whole paper for that is a gate somebody
       turns off. src/pdf-read.ts.

       That last sentence was written before it happened, and on 2026-08-30 it
       did: the gate failed whole papers over a margin stamp and chart axis
       labels, and it got turned off. So this no longer rejects — but the retry
       it is actually about is unchanged, and the count below is the assertion
       that was always doing the work. */
    const omitOneParagraph = (records: PdfRecord[]) => {
      const victim = records.findIndex((r) => r.page === 5 && r.text.split(" ").length > 12);
      return records.filter((_, at) => at !== victim);
    };
    await run(omitOneParagraph);
    const chunks = asks;
    await run();
    expect(chunks).toBe(asks + 1);
  }, 60_000);

  /* Missing page identity is structural and cannot publish. A partial recall
     warning remains the noisy content class Greg chose to publish with notes. */

  it("still notices a page that comes back empty, and says which", async () => {
    await expect(run((records) => records.filter((r) => r.page !== 3))).rejects.toThrow(/pages 3/);
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

  /* ============================== the chunk checkpoints, and what a crash leaves ==
     Every entry under the `pdf-chunk` namespace is a paid vision-model call, so
     the two things that can go wrong here pull in opposite directions and both
     cost money: a valid entry that stops being read re-buys the call on every
     run, and an unusable entry that is not tolerated wedges the article for
     ever, because the key is deterministic and nothing ever deletes these. Both
     directions get a test. See
     docs/postmortems/260828e-pdf-chunk-cache-corrupt-entry.md.

     **These were files under `data/<slug>/pdf-chunks/` until 2026-09-01**, and
     the change is the whole of landing D2: the directory is job-scoped `/tmp`
     on Vercel, a retry is a new job id on a different machine, and every one of
     these tests passed while production resumed nothing at all. The store is
     keyed on the article now (src/store/checkpoints.ts). What survives here is
     what these tests were really about — that the stage stops paying, and that
     a bad entry is a miss rather than an outage — asked of the store instead of
     the filesystem. The liveness property itself, across two jobs and a real
     database, is tests/checkpoints-durable-resume.test.ts. */
  describe("the chunk checkpoints", () => {
    /** The keys the stage actually minted, which is the only honest place to read one. */
    function keysIn(store: MemoryCheckpoints): string[] {
      return [...store.entries.keys()]
        .filter((k) => k.startsWith("pdf-chunk/"))
        .map((k) => k.slice("pdf-chunk/".length))
        .sort();
    }

    /**
     * **Every real key is one the checkpoint store's constraint accepts.**
     *
     * The `checkpoints` table's `key` column carries a CHECK,
     * `^[a-z0-9][a-z0-9_-]{0,127}$`. This asserts it against **the keys this
     * code actually mints**, not against a copy of the expression written into
     * a test: the key is computed inside `runPdfExtract` and is not exported, so
     * the only honest way to see one is to run the stage and read back what it
     * stored. Upper-case hex, a `:` or `=` separator, or a base64url `+` would
     * every one of them pass a test that re-derived the key, and then be
     * rejected by the database. docs/reusable/silent-success.md.
     *
     * The regex is duplicated here rather than imported, deliberately:
     * importing `CHECKPOINT_KEY_RE` would let a change to the constraint
     * silently relax this assertion at the same moment. If the two disagree,
     * one of them is wrong and somebody should look.
     */
    it("mints keys the checkpoint store's key constraint accepts", async () => {
      const store = memoryCheckpoints({ slug: "paper", articleId: "article-paper" });
      await run(undefined, store);
      const keys = keysIn(store);
      /* Not vacuous: a run that checkpointed nothing would pass every assertion
         below about the contents of an empty list. */
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(key).toMatch(/^[a-z0-9][a-z0-9_-]{0,127}$/);
      }
    }, 60_000);

    it("reads a well-formed entry back rather than paying for the call again", async () => {
      const store = memoryCheckpoints({ slug: "paper", articleId: "article-paper" });
      const first = await run(undefined, store);
      expect(asks).toBeGreaterThan(0);
      expect(keysIn(store).length).toBe(first.chunks);

      const again = await run(undefined, store);
      /* The load-bearing assertion in this file: zero. One ask here is one
         vision-model call bought a second time for nothing. */
      expect(asks).toBe(0);
      expect(again.records).toBe(first.records);
    }, 60_000);

    it("asks the store once for every chunk, not once per chunk", async () => {
      /* The bulk read, measured rather than assumed. A hundred-page PDF can
         plan a hundred chunks, and a hundred round trips before the first model
         call is latency spent on a document that is already close to its
         deadline. src/store/checkpoints.ts § `read` is plural. */
      const store = memoryCheckpoints({ slug: "paper", articleId: "article-paper" });
      const first = await run(undefined, store);
      expect(first.chunks).toBeGreaterThan(1);
      expect(store.calls.reads).toBe(1);
      expect(store.calls.keysAsked).toBe(first.chunks);
    }, 60_000);

    it("treats an unusable entry as a miss, not as a failure of the whole step", async () => {
      const store = memoryCheckpoints({ slug: "paper", articleId: "article-paper" });
      const first = await run(undefined, store);
      const keys = keysIn(store);
      expect(keys.length).toBeGreaterThan(1);

      /* **Not a half-written file, because Postgres cannot write half a row** —
         which is what took the permanent trap in the postmortem away. What
         remains is an entry that is whole and is not a reading: an older shape
         of this code, or a value written under a key whose meaning has moved.
         It parses, so nothing catches it before the caller looks. */
      const entry = `pdf-chunk/${keys[0]!}`;
      const original = JSON.parse(store.entries.get(entry)!) as ChunkReading;
      const recoveredPages = new Set(original.records.map((record) => record.page)).size;
      store.entries.set(entry, JSON.stringify({ pages: [1], note: "not a reading" }));

      const again = await run(undefined, store);
      expect(again.records).toBe(first.records);
      /* One, not all of them: the unusable entry is re-read and every intact
         entry beside it is still used. */
      expect(asks).toBe(recoveredPages);
      /* And the good entry is back in the store, so the next run pays nothing. */
      const healed = JSON.parse(store.entries.get(`pdf-chunk/${keys[0]!}`)!) as { records: unknown[] };
      expect(healed.records.length).toBeGreaterThan(0);
    }, 60_000);

    it("says in the log that it threw an entry away, since nothing else records the crash", async () => {
      const store = memoryCheckpoints({ slug: "paper", articleId: "article-paper" });
      await run(undefined, store);
      const keys = keysIn(store);
      store.entries.set(`pdf-chunk/${keys[0]!}`, JSON.stringify({ records: "not an array" }));

      warnings.length = 0;
      await run(undefined, store);
      expect(warnings.length).toBe(1);
      expect(warnings[0]?.msg).toMatch(/checkpoint/i);
      expect(warnings[0]?.fields).toMatchObject({ slug: "paper", chunk: keys[0]! });
    }, 60_000);

    it("does not let a broken store fail the step, because a saving is not a dependency", async () => {
      /**
       * **A cache that has become an outage is the failure this guards.** The
       * filesystem version could do exactly that: a full `/tmp` made `mkdir`
       * and `writeFile` throw straight out of the stage, so a machine running
       * short of scratch space stopped being able to read PDFs at all. A store
       * that throws must cost the *saving* and nothing else.
       */
      const broken = memoryCheckpoints({ slug: "paper", articleId: "article-paper" });
      const angry = {
        ...broken,
        read: async (): Promise<Map<string, never>> => {
          throw new Error("the checkpoint store is on fire");
        },
        write: async (): Promise<void> => {
          throw new Error("the checkpoint store is still on fire");
        },
      };
      const bytes = new Uint8Array(await readFile(EASY));
      const pass = await pass0(bytes);
      asks = 0;
      const result = await runPdfExtract({
        frontMatter: null,
        bytes,
        url: "https://example.test/paper.pdf",
        checkpoints: angry,
        slug: "paper",
        reader: honestReader(pass),
      });
      expect(result.records).toBeGreaterThan(0);
      /* It paid for every chunk, which is the cost of a broken store — and it
         said so, twice, rather than failing silently. */
      expect(asks).toBe(result.chunks);
      expect(warnings.filter((w) => /checkpoint/i.test(w.msg ?? "")).length).toBeGreaterThan(0);
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
    expect(report.calls[0]?.cost).toEqual({ source: "none" });
    expect(report.calls[1]?.cost).toEqual({ source: "provider", costNanos: 250_000 });
  }, 20_000);
});
