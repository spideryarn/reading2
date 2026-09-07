/**
 * Page identity is provenance, not model-authored content. These fixtures keep
 * the source invented and make the final HTML witness the order a reader gets.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { readerFailureOf } from "../src/job-failure.js";
import { PdfReadingShapeError, validateChunkReading } from "../src/pdf-integrity.js";
import type { Pass0, PdfRecord } from "../src/pdf.js";
import { pass0 } from "../src/pdf.js";
import { check } from "../src/pdf-score.js";
import {
  type ChunkReading,
  type PdfReader,
  parseRecords,
  planChunks,
  renderHtml,
  runPdfExtract,
} from "../src/pdf-read.js";
import { worthRetrying } from "../src/messages.js";
import { memoryCheckpoints, type MemoryCheckpoints } from "./helpers/memory-checkpoints.js";

const RAW_SHA = "c".repeat(64);
const SLUG = "source-six";

const rec = (page: number, text: string, over: Partial<PdfRecord> = {}): PdfRecord => ({
  page,
  type: "paragraph",
  text,
  continues: false,
  uncertain: false,
  ...over,
});

/** 1,100 words a page makes the real planner choose [1,2] [3,4] [5,6]. */
async function sixPageSource(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const names = ["one", "two", "three", "four", "five", "six"];
  for (let page = 1; page <= 6; page++) {
    const name = names[page - 1]!;
    const body = [
      `SOURCE_PAGE_${page}`,
      ...Array.from({ length: 1_099 }, (_, word) => `${name}word${word}`),
    ].join(" ");
    doc.addPage([20_000, 200]).drawText(body, { x: 10, y: 100, size: 2, font });
  }
  return doc.save();
}

function pagesAsked(instruction: string): number[] {
  const one = /Transcribe page (\d+)/.exec(instruction)?.[1];
  if (one) return [Number(one)];
  const range = /Transcribe pages (\d+)–(\d+)/.exec(instruction);
  if (!range) throw new Error(`test reader could not read instruction: ${instruction}`);
  return Array.from(
    { length: Number(range[2]) - Number(range[1]) + 1 },
    (_, at) => Number(range[1]) + at,
  );
}

const answer = (records: PdfRecord[], over: Partial<ChunkReading> = {}): ChunkReading => ({
  records,
  stripped: 0,
  finish: "stop",
  usage: { input: 10, output: 20 },
  ms: 1,
  ...over,
});

interface Stub {
  reader: PdfReader;
  calls: number[][];
}

function stubReader(
  pass: Pass0,
  change: (pages: number[], records: PdfRecord[], call: number) => ChunkReading = (_p, records) =>
    answer(records),
): Stub {
  const calls: number[][] = [];
  return {
    calls,
    reader: {
      id: "test/source-six",
      async read(_pdf, instruction) {
        const pages = pagesAsked(instruction);
        calls.push(pages);
        const records = pages.map((page) => rec(page, pass.pages[page - 1]!.text));
        return change(pages, records, calls.length);
      },
    },
  };
}

let bytes: Uint8Array;
let sourcePass: Pass0;

beforeAll(async () => {
  bytes = await sixPageSource();
  sourcePass = await pass0(bytes);
  expect(planChunks(sourcePass).map((chunk) => chunk.pages)).toEqual([
    [1, 2],
    [3, 4],
    [5, 6],
  ]);
});

const store = () => memoryCheckpoints({ slug: SLUG, articleId: "article-source-six" });

async function run(stub: Stub, checkpoints: MemoryCheckpoints = store(), signal?: AbortSignal) {
  return runPdfExtract({
    bytes,
    slug: SLUG,
    checkpoints,
    frontMatter: null,
    reader: stub.reader,
    ...(signal ? { signal } : {}),
  });
}

const markersIn = (html: string) => {
  const article = /<article>\s*([\s\S]*?)\s*<\/article>/.exec(html)?.[1] ?? "";
  return [...article.matchAll(/SOURCE_PAGE_(\d)/g)].map((match) => Number(match[1]));
};

function keysIn(checkpoints: MemoryCheckpoints): string[] {
  return [...checkpoints.entries.keys()].filter((key) => key.startsWith("pdf-chunk/"));
}

function keyHolding(checkpoints: MemoryCheckpoints, page: number): string {
  const found = keysIn(checkpoints).find((key) => {
    const reading = JSON.parse(checkpoints.entries.get(key)!) as ChunkReading;
    return reading.records.some((record) => record.page === page);
  });
  if (!found) throw new Error(`no checkpoint holds page ${page}`);
  return found;
}

describe("structural recovery", () => {
  it("recovers source pages 5-6 when their chunk invents labels 1-2, preserves final HTML order, and reuses the recovered checkpoint", async () => {
    const checkpoints = store();
    const first = stubReader(sourcePass, (pages, records) =>
      pages.join() === "5,6"
        ? answer(records.map((record, at) => ({ ...record, page: at + 1 })))
        : answer(records),
    );
    const result = await run(first, checkpoints);

    expect(first.calls).toEqual([[1, 2], [3, 4], [5, 6], [5], [6]]);
    expect(markersIn(result.extractedHtml)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(keysIn(checkpoints)).toHaveLength(3);

    const second = stubReader(sourcePass);
    const again = await run(second, checkpoints);
    expect(second.calls).toEqual([]);
    expect(markersIn(again.extractedHtml)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("revalidates a bad-label checkpoint, retains its good neighbours, and heals only that chunk", async () => {
    const checkpoints = store();
    await run(stubReader(sourcePass), checkpoints);
    const goodBefore = new Map(keysIn(checkpoints).map((key) => [key, checkpoints.entries.get(key)!]));
    const badKey = keyHolding(checkpoints, 5);
    const bad = JSON.parse(checkpoints.entries.get(badKey)!) as ChunkReading;
    bad.records = bad.records.map((record, at) => ({ ...record, page: at + 1 }));
    checkpoints.entries.set(badKey, JSON.stringify(bad));

    const recovery = stubReader(sourcePass, (_pages, records) =>
      /* A one-page body has authoritative provenance; its model label does not. */
      answer(records.map((record) => ({ ...record, page: 999 }))),
    );
    const result = await run(recovery, checkpoints);
    expect(recovery.calls).toEqual([[5], [6]]);
    expect(markersIn(result.extractedHtml)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const [key, value] of goodBefore) {
      if (key !== badKey) expect(checkpoints.entries.get(key)).toBe(value);
    }
  });

  it("rejects partial cached record, finish, and usage shapes and recovers each one page at a time", async () => {
    const corruptions: Array<(reading: Record<string, unknown>) => void> = [
      (reading) => {
        const records = reading.records as Array<Record<string, unknown>>;
        delete records[0]!.uncertain;
      },
      (reading) => {
        reading.finish = "length";
      },
      (reading) => {
        reading.usage = { input: 10 };
      },
    ];

    for (const corrupt of corruptions) {
      const checkpoints = store();
      await run(stubReader(sourcePass), checkpoints);
      const badKey = keyHolding(checkpoints, 5);
      const reading = JSON.parse(checkpoints.entries.get(badKey)!) as Record<string, unknown>;
      corrupt(reading);
      checkpoints.entries.set(badKey, JSON.stringify(reading));

      const recovery = stubReader(sourcePass);
      const result = await run(recovery, checkpoints);
      expect(recovery.calls).toEqual([[5], [6]]);
      expect(markersIn(result.extractedHtml)).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });

  it("treats descending in-range labels as structural instead of sorting them globally", async () => {
    const stub = stubReader(sourcePass, (pages, records) =>
      pages.join() === "5,6" ? answer([...records].reverse()) : answer(records),
    );
    const result = await run(stub);
    expect(stub.calls).toEqual([[1, 2], [3, 4], [5, 6], [5], [6]]);
    expect(markersIn(result.extractedHtml)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("recovers a fresh typed record-shape failure and retains its incurred usage", async () => {
    const stub = stubReader(sourcePass, (pages, records) => {
      if (pages.join() === "5,6") {
        throw new PdfReadingShapeError("record-shape", "synthetic partial record", {
          input: 7,
          output: 11,
        });
      }
      return answer(records);
    });
    const result = await run(stub);
    expect(stub.calls).toEqual([[1, 2], [3, 4], [5, 6], [5], [6]]);
    expect(result.usage).toEqual({ input: 47, output: 91 });
    expect(markersIn(result.extractedHtml)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("rejects a context-page impostor instead of trimming its bad label and claiming success", async () => {
    const stub = stubReader(sourcePass, (pages, records) =>
      pages.join() === "3,4"
        ? answer([rec(2, "IMPOSTOR_CONTEXT_RECORD"), ...records])
        : answer(records),
    );
    const result = await run(stub);
    expect(stub.calls).toEqual([[1, 2], [3, 4], [5, 6], [3], [4]]);
    expect(result.extractedHtml).not.toContain("IMPOSTOR_CONTEXT_RECORD");
    expect(markersIn(result.extractedHtml)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("fails retryably with affected pages and returns no HTML when single-page recovery is exhausted", async () => {
    const stub = stubReader(sourcePass, (pages, records) =>
      pages.join() === "5,6" || pages.join() === "5" ? answer([]) : answer(records),
    );
    let result: Awaited<ReturnType<typeof run>> | undefined;
    let caught: unknown;
    try {
      result = await run(stub);
    } catch (error) {
      caught = error;
    }
    expect(result, "STRUCTURAL_GUARD_NO_HTML").toBeUndefined();
    const facing = readerFailureOf(caught, "Extracting the article");
    expect(facing.message).toMatch(/page 5\b/i);
    expect(worthRetrying(facing.message)).toBe(true);
    expect(stub.calls.filter((pages) => pages.join() === "5")).toHaveLength(2);
  });

  it("propagates cancellation during recovery and does not checkpoint the defective chunk", async () => {
    const checkpoints = store();
    const controller = new AbortController();
    const stub = stubReader(sourcePass, (pages, records) => {
      if (pages.join() === "5,6") return answer([]);
      if (pages.join() === "5") {
        controller.abort(new DOMException("test cancellation", "AbortError"));
        throw controller.signal.reason;
      }
      return answer(records);
    });
    await expect(run(stub, checkpoints, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(keysIn(checkpoints).some((key) => {
      const reading = JSON.parse(checkpoints.entries.get(key)!) as ChunkReading;
      return reading.records.some((record) => record.page === 5);
    })).toBe(false);
  });

  it("does not attempt a checkpoint write after the caller cancels a completed reading", async () => {
    const checkpoints = store();
    const controller = new AbortController();
    const stub = stubReader(sourcePass, (_pages, records) => {
      controller.abort(new DOMException("cancel before checkpoint", "AbortError"));
      return answer(records);
    });
    await expect(
      runPdfExtract({
        bytes,
        slug: SLUG,
        checkpoints,
        frontMatter: null,
        reader: stub.reader,
        signal: controller.signal,
        width: 1,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(checkpoints.calls.writes).toBe(0);
  });

  it("recovers from the original single pages when final dedup removes a page, then checkpoints the repaired chunk", async () => {
    const checkpoints = store();
    const stub = stubReader(sourcePass, (pages, records) =>
      pages.join() === "3,4"
        ? answer([rec(3, sourcePass.pages[0]!.text), records[1]!])
        : answer(records),
    );
    const result = await run(stub, checkpoints);
    expect(stub.calls).toEqual([[1, 2], [3, 4], [5, 6], [3, 4], [3], [4]]);
    expect(markersIn(result.extractedHtml)).toEqual([1, 2, 3, 4, 5, 6]);

    const replay = stubReader(sourcePass);
    expect(markersIn((await run(replay, checkpoints)).extractedHtml)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(replay.calls).toEqual([]);
  });

  it("refuses rather than restoring a duplicate when single-page recovery still deduplicates away the only page content", async () => {
    const checkpoints = store();
    const stub = stubReader(sourcePass, (pages, records) =>
      pages.join() === "3,4" || pages.join() === "3"
        ? answer(records.map((record) => ({ ...record, text: sourcePass.pages[0]!.text })))
        : answer(records),
    );
    let result: Awaited<ReturnType<typeof run>> | undefined;
    let caught: unknown;
    try {
      result = await run(stub, checkpoints);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      message:
        "The PDF reader could not establish source-page integrity for pages 3 after 2 single-page attempts. [ai-pdf-incomplete]",
    });
    expect(result, "DEDUP_GUARD_NO_HTML").toBeUndefined();
    expect(stub.calls.filter((pages) => pages.join() === "3")).toHaveLength(1);
    expect(stub.calls.filter((pages) => pages.join() === "4")).toHaveLength(1);
    expect(keysIn(checkpoints).some((key) => {
      const reading = JSON.parse(checkpoints.entries.get(key)!) as ChunkReading;
      return reading.records.some((record) => record.page === 3);
    })).toBe(false);
  });

  it.each(["constructor", "toString"])(
    "rejects prototype record type %s and refuses when recovery repeats it",
    async (type) => {
      const malformed = answer([rec(5, "not renderable", { type: type as PdfRecord["type"] })]);
      expect(validateChunkReading(malformed).kind).toBe("structural");
      const stub = stubReader(sourcePass, (pages, records) =>
        pages.includes(5) ? answer(records.map((record) => ({ ...record, type }) as PdfRecord)) : answer(records),
      );
      let result: Awaited<ReturnType<typeof run>> | undefined;
      await expect(
        run(stub).then((value) => {
          result = value;
        }),
      ).rejects.toThrow(/source-page integrity/i);
      expect(result, "PROTOTYPE_TYPE_NO_HTML").toBeUndefined();
    },
  );

  it("recovers a live-shaped null record through the typed structural path", async () => {
    const stub = stubReader(sourcePass, (pages, records) => {
      if (pages.join() === "5,6") {
        parseRecords('{"records":[null]}');
      }
      return answer(records);
    });
    const result = await run(stub);
    expect(stub.calls).toEqual([[1, 2], [3, 4], [5, 6], [5], [6]]);
    expect(markersIn(result.extractedHtml)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it.each(["error", "unknown-provider-finish"])(
    "recovers a fresh non-stop finish %s instead of publishing it",
    async (finish) => {
      const stub = stubReader(sourcePass, (pages, records) =>
        pages.join() === "5,6" ? answer(records, { finish }) : answer(records),
      );
      const result = await run(stub);
      expect(stub.calls).toEqual([[1, 2], [3, 4], [5, 6], [5], [6]]);
      expect(markersIn(result.extractedHtml)).toEqual([1, 2, 3, 4, 5, 6]);
    },
  );

  it("does not reuse a cached non-stop finish", async () => {
    const checkpoints = store();
    await run(stubReader(sourcePass), checkpoints);
    const badKey = keyHolding(checkpoints, 5);
    const reading = JSON.parse(checkpoints.entries.get(badKey)!) as ChunkReading;
    reading.finish = "error";
    checkpoints.entries.set(badKey, JSON.stringify(reading));

    const recovery = stubReader(sourcePass);
    const result = await run(recovery, checkpoints);
    expect(recovery.calls).toEqual([[5], [6]]);
    expect(markersIn(result.extractedHtml)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("refuses without HTML when every single-page attempt also has a non-stop finish", async () => {
    const stub = stubReader(sourcePass, (pages, records) =>
      pages.includes(5) ? answer(records, { finish: "error" }) : answer(records),
    );
    let result: Awaited<ReturnType<typeof run>> | undefined;
    await expect(
      run(stub).then((value) => {
        result = value;
      }),
    ).rejects.toThrow(/source-page integrity/i);
    expect(result, "NON_STOP_NO_HTML").toBeUndefined();
    expect(stub.calls.filter((pages) => pages.join() === "5")).toHaveLength(2);
  });
});

describe("the typed structural boundary", () => {
  const pass = (texts: string[], isScan = false): Pass0 => ({
    pages: texts.map((text, at) => ({
      page: at + 1,
      text,
      words: text.trim() ? text.trim().split(/\s+/).length : 0,
      items: [],
    })),
    isScan,
    metaTitle: null,
    furniture: new Set(),
  });

  it("requires a substantive record on a text-bearing page, while a hidden record counts", () => {
    const text = "A substantive sentence in the source text layer.";
    expect(check([], [1], pass([text])).verdict.kind).toBe("structural");
    expect(check([rec(1, "")], [1], pass([text])).verdict.kind).toBe("structural");
    expect(check([rec(1, text, { type: "footnote" })], [1], pass([text])).verdict.kind).not.toBe(
      "structural",
    );
  });

  it("uses a page-local witness even in a mixed scan, but leaves blank pages unverified", () => {
    expect(check([], [1], pass([""])).verdict.kind).toBe("pass");
    expect(check([], [1], pass([""], true)).verdict.kind).toBe("pass");
    expect(check([], [1], pass(["Substantive text survived on this mixed-scan page."], true)).verdict.kind).toBe(
      "structural",
    );
  });

  it("does not infer a bibliography from years when the concluding page has no records", () => {
    const body = pass([
      "Opening body prose.",
      "In 2020 the argument changed. In 2021 it changed again. By 2022 the conclusion was different.",
    ]);
    expect(check([], [2], body).verdict.kind).toBe("structural");
  });

  it("does not let blank reference records suppress a prose warning and retry", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const body = [
      "SOURCE_PAGE_1 2020",
      ...Array.from({ length: 198 }, (_, word) => `bodyword${word}`),
    ].join(" ");
    doc.addPage([20_000, 200]).drawText(body, { x: 10, y: 100, size: 2, font });
    const source = await doc.save();
    const sourcePass = await pass0(source);
    const stub = stubReader(sourcePass, () =>
      answer([
        rec(1, "tiny body survived"),
        ...Array.from({ length: 10 }, () => rec(1, "", { type: "reference" })),
        ...Array.from({ length: 10 }, () => rec(1, " \t ", { type: "reference" })),
      ]),
    );

    const result = await runPdfExtract({
      bytes: source,
      slug: "blank-references",
      checkpoints: memoryCheckpoints({
        slug: "blank-references",
        articleId: "article-blank-references",
      }),
      frontMatter: null,
      reader: stub.reader,
    });

    expect(stub.calls).toEqual([[1], [1]]);
    expect(result.meta.quality?.join(" ")).toMatch(/missing from the transcription/i);
  });

  it("requires several lexical words from a prose-bearing page, including in hidden records", () => {
    const source = pass(["This long body page contains enough prose to establish an independent text witness."]);
    expect(check([rec(1, "1")], [1], source).verdict.kind).toBe("structural");
    expect(check([rec(1, "enough prose survived", { type: "footnote" })], [1], source).verdict.kind).not.toBe(
      "structural",
    );
  });

  it("accepts short genuine prose but does not turn maths or recognised furniture into a fatal presence claim", () => {
    expect(check([rec(1, "Brief author note")], [1], pass(["Brief author note"])).verdict.kind).not.toBe(
      "structural",
    );
    expect(check([], [1], pass(["∫ x² dx = 4"])).verdict.kind).not.toBe("structural");
    const furniture = pass(["Journal running header 42"]);
    furniture.furniture.add("journal running header");
    expect(check([], [1], furniture).verdict.kind).not.toBe("structural");
  });

  it("keeps recall and invention problems as content warnings, not structural failures", () => {
    const result = check([rec(1, "A short summary 2099.")], [1], pass(["A much longer source paragraph from 2020 that the summary omits."]));
    expect(result.verdict.kind).toBe("content-warning");
  });
});

describe("continuation joins", () => {
  const htmlFor = (records: PdfRecord[]) => renderHtml(records, "T", RAW_SHA);

  it("joins on the same page and exactly the next page", () => {
    expect(htmlFor([rec(1, "A"), rec(1, "B", { continues: true })])).toContain("<p>A B</p>");
    expect(htmlFor([rec(1, "A"), rec(2, "B", { continues: true })])).toContain("<p>A B</p>");
  });

  it("tracks the last joined page so a continuation may span three pages", () => {
    expect(
      htmlFor([
        rec(1, "A"),
        rec(2, "B", { continues: true }),
        rec(3, "C", { continues: true }),
      ]),
    ).toContain("<p>A B C</p>");
  });

  it("does not join across a gap or backwards", () => {
    const gap = htmlFor([rec(1, "A"), rec(3, "C", { continues: true })]);
    expect(gap).toContain("<p>A</p>\n<p>C</p>");
    const backwards = htmlFor([rec(2, "B"), rec(1, "A", { continues: true })]);
    expect(backwards).toContain("<p>B</p>\n<p>A</p>");
  });
});
