/**
 * **How big a PDF chunk may be, and what happens to one that is too big.**
 *
 * Two changes, both from docs/plans/260928b-pdf-chunk-too-big-for-one-request.md
 * and built under plan 261004f:
 *
 * - **A**: the allowance is the reader model's, 40 MiB encoded, where it was a
 *   30 MiB left over from a model that no longer reads PDFs.
 * - **B**: a chunk that is over the allowance only because of the context page
 *   it carries is sent without that page, rather than failing the import.
 *
 * **Everything here runs the real `openRouterReader`, with only the wire
 * replaced** (its `ask` parameter). The size refusal lives inside that reader,
 * so a test that swaps the whole `PdfReader` cannot reach it — which is how the
 * 30 MiB went stale unnoticed. No arithmetic is copied: the tests ask
 * `encodedBytes` and `maxEncodedBytesFor`, the functions the reader itself asks.
 *
 * **Seen red**, each against the tree with the seam in place and the fix not:
 * the 32 MiB chunk was refused (`[pdf-chunk-big]`) and never reached the wire;
 * `maxEncodedBytesFor(PDF_READER_MODEL)` was 30 MiB; and the import in "sent
 * without its context page" rejected with `[pdf-chunk-big]`, as did both
 * checkpoint tests. The "ordinary chunk" test is a guard and passed before and
 * after by design; it was seen red by making the context drop unconditional.
 */
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Before any import: src/log.ts reads `LOG_LEVEL` once. tests/helpers/log-capture.ts. */
const HOISTED = vi.hoisted(() => {
  const previousLevel = process.env.LOG_LEVEL;
  if (previousLevel === undefined || ["silent", "fatal", "error"].includes(previousLevel)) {
    process.env.LOG_LEVEL = "warn";
  }
  return { previousLevel };
});

import type { openRouterJson } from "../src/ai-call.js";
import { readerFailureOf } from "../src/job-failure.js";
import { PDF_READER_MODEL } from "../src/models.js";
import type { Pass0, PdfRecord } from "../src/pdf.js";
import { pass0 } from "../src/pdf.js";
import {
  encodedBytes,
  maxEncodedBytesFor,
  openPdfCuts,
  openRouterReader,
  type PdfReader,
  planChunks,
  runPdfExtract,
} from "../src/pdf-read.js";
import { logLinesWhile } from "./helpers/log-capture.js";
import { memoryCheckpoints } from "./helpers/memory-checkpoints.js";

afterAll(() => {
  if (HOISTED.previousLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = HOISTED.previousLevel;
});

const hadKey = process.env.OPENROUTER_API_KEY;
beforeEach(() => {
  /* No key at all, on purpose. A reader given its own wire (`ask`, below) does
     not need one, and a test here that forgot to pass `ask` then fails as
     "not configured" instead of sending a request. */
  delete process.env.OPENROUTER_API_KEY;
});
afterEach(() => {
  if (hadKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = hadKey;
});

const MIB = 1024 * 1024;
const SLUG = "a-heavy-pdf";
const codeOf = (message: string) => message.match(/\[([a-z0-9-]+)\]$/)?.[1];

async function threw(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error("that was supposed to throw and did not");
}

type Ask = typeof openRouterJson;
interface Sent {
  instruction: string;
  /** The length of the base64 the request carried. */
  encoded: number;
  /** The base64 itself, so two runs can be compared byte for byte. */
  data: string;
}

/**
 * **The wire, faked.** Records what each request carried and answers with
 * `answer`'s records in the provider's envelope.
 */
function fakeWire(answer: (instruction: string) => PdfRecord[] = () => []): { ask: Ask; sent: Sent[] } {
  const sent: Sent[] = [];
  const ask: Ask = async (_job, body) => {
    const messages = body.messages as { content: unknown }[];
    const user = messages[1]?.content as [{ text: string }, { file: { file_data: string } }];
    const instruction = user[0].text;
    const data = user[1].file.file_data.replace("data:application/pdf;base64,", "");
    sent.push({ instruction, encoded: data.length, data });
    return {
      json: {
        choices: [{ message: { content: JSON.stringify({ records: answer(instruction) }) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      answeredBy: null,
      generationId: null,
    };
  };
  return { ask, sent };
}

describe("A: the allowance is the reader model's", () => {
  /* The report: page 6 (20.2 MiB) carried as context for page 7 (3.8 MiB),
     23.88 MiB raw, 31.85 MiB encoded. 260928b § Why it failed. */
  const THE_REPORTED_CHUNK = Math.round(23.88 * MIB);

  it("allows the model that reads PDFs today 40 MiB, and an unlisted model the old 30", () => {
    expect(maxEncodedBytesFor(PDF_READER_MODEL)).toBe(40 * MIB);
    expect(maxEncodedBytesFor("somebody/else")).toBe(30 * MIB);
    expect(openRouterReader().maxEncodedBytes).toBe(maxEncodedBytesFor(PDF_READER_MODEL));
    expect(openRouterReader("somebody/else").maxEncodedBytes).toBe(30 * MIB);
  });

  it("sends the chunk the report was refused over", async () => {
    const wire = fakeWire();
    /* Not a valid PDF, and it does not need to be: the reader parses nothing. */
    const reading = await openRouterReader(PDF_READER_MODEL, undefined, { ask: wire.ask }).read(
      new Uint8Array(THE_REPORTED_CHUNK),
      "read this",
    );

    expect(reading.finish).toBe("stop");
    expect(wire.sent).toHaveLength(1);
    expect(wire.sent[0]?.encoded).toBe(encodedBytes(THE_REPORTED_CHUNK));
    expect(wire.sent[0]?.encoded).toBeGreaterThan(31 * MIB);
  });

  it("still refuses one that is over the allowance, before anything is sent", async () => {
    const wire = fakeWire();
    const over = Math.ceil((maxEncodedBytesFor(PDF_READER_MODEL) * 3) / 4) + 3;
    const err = await threw(() =>
      openRouterReader(PDF_READER_MODEL, undefined, { ask: wire.ask }).read(new Uint8Array(over), "read this"),
    );

    const failure = readerFailureOf(err, "Extracting the article");
    expect(failure.kind).toBe("blocked");
    expect(codeOf(failure.message)).toBe("pdf-chunk-big");
    expect(wire.sent).toHaveLength(0);
  });
});

/** Incompressible bytes for a page to carry: a JPEG of noise, `side` pixels square. */
function noiseJpeg(side: number, seed: number): Uint8Array {
  const canvas = createCanvas(side, side);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(side, side);
  let state = seed;
  for (let i = 0; i < image.data.length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    image.data[i] = i % 4 === 3 ? 255 : state >>> 24;
  }
  ctx.putImageData(image, 0, 0);
  return new Uint8Array(canvas.toBuffer("image/jpeg", 90));
}

/**
 * Four pages, each dense enough to be a chunk of its own, with page 2 heavy and
 * page 3 less so — the shape of the reported paper's pages 6 and 7, in
 * kilobytes rather than megabytes.
 */
async function heavyPagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let p = 1; p <= 4; p++) {
    const page = doc.addPage([612, 792]);
    for (let line = 0; line < 90; line++) {
      const words = Array.from({ length: 40 }, (_, w) => `p${p}l${line}w${w}`);
      page.drawText(words.join(" "), { x: 10, y: 780 - line * 5, size: 3 });
    }
    const side = p === 2 ? 512 : p === 3 ? 192 : 0;
    if (side) page.drawImage(await doc.embedJpg(noiseJpeg(side, p)), { x: 500, y: 20, width: 40, height: 40 });
  }
  return doc.save();
}

/** Answers a request from the PDF's own text layer, for the pages it was asked to emit. */
function fromTextLayer(pass: Pass0): (instruction: string) => PdfRecord[] {
  return (instruction) => {
    const match = instruction.match(/^Transcribe page (\d+) of the attached PDF\./);
    if (!match) throw new Error(`unexpected fixture instruction: ${instruction}`);
    const wanted = Number(match[1]);
    return pass.pages
      .filter((page) => page.page === wanted)
      .flatMap((page) => page.text.split("\n").filter((line) => line.trim()))
      .map((text) => ({ page: wanted, type: "paragraph" as const, text, continues: false, uncertain: false }));
  };
}

/** The fixture, its text layer, and what each cut of it weighs in a request. */
async function fixture() {
  const bytes = await heavyPagePdf();
  const pass = await pass0(bytes);
  const cuts = await openPdfCuts(bytes);
  const plan = planChunks(pass, { pageBytes: await cuts.measurePages() });
  /* The premise, checked rather than hoped: one page a chunk, each after the
     first carrying the page before it. */
  expect(plan).toEqual([{ pages: [1] }, { pages: [2], context: 1 }, { pages: [3], context: 2 }, { pages: [4], context: 3 }]);
  const weigh = async (pages: number[]) => encodedBytes((await cuts.cut(pages)).byteLength);
  return {
    bytes,
    pass,
    /** Page 3 with page 2 as context: the heaviest request in the plan. */
    page3WithContext: await weigh([2, 3]),
    page3Alone: await weigh([3]),
    page2WithContext: await weigh([1, 2]),
    page2Alone: await weigh([2]),
  };
}

const run = (bytes: Uint8Array, reader: PdfReader, checkpoints = memoryCheckpoints({ slug: SLUG, articleId: "article-heavy" })) =>
  runPdfExtract({ bytes, slug: SLUG, checkpoints, reader, frontMatter: null, authors: null });

const CONTEXT_NOTE = /The FIRST page of the attached file is page (\d+)/;
const askFor = (sent: Sent[], page: number) =>
  sent.filter((s) => s.instruction.startsWith(`Transcribe page ${page} of`));

describe("B: a chunk too big only because of its context page", () => {
  it("is sent without its context page, and the run says so", async () => {
    const f = await fixture();
    /* One byte under what page 3 weighs with page 2 in front of it. */
    const limit = f.page3WithContext - 1;
    expect(f.page2WithContext).toBeLessThanOrEqual(limit);
    expect(f.page3Alone).toBeLessThan(limit);

    const wire = fakeWire(fromTextLayer(f.pass));
    const reader = openRouterReader(PDF_READER_MODEL, undefined, { ask: wire.ask, maxEncodedBytes: limit });
    let result: Awaited<ReturnType<typeof runPdfExtract>> | undefined;
    const logged = await logLinesWhile(async () => {
      result = await run(f.bytes, reader);
    });

    /* Page 3 went once, alone; nothing over the limit ever reached the wire. */
    const three = askFor(wire.sent, 3);
    expect(three).toHaveLength(1);
    expect(three[0]?.encoded).toBe(f.page3Alone);
    expect(three[0]?.instruction).not.toMatch(CONTEXT_NOTE);
    expect(three[0]?.instruction).toContain("pages are, in order, 3 —");
    expect(Math.max(...wire.sent.map((s) => s.encoded))).toBeLessThanOrEqual(limit);
    /* Its neighbours kept theirs. */
    expect(askFor(wire.sent, 2)[0]?.instruction.match(CONTEXT_NOTE)?.[1]).toBe("1");
    expect(askFor(wire.sent, 4)[0]?.instruction.match(CONTEXT_NOTE)?.[1]).toBe("3");

    /* The whole article arrived. */
    expect(result?.pages).toBe(4);
    expect(result?.chunks).toBe(4);
    for (const word of ["p1l0w0", "p2l0w0", "p3l0w0", "p3l89w39", "p4l89w39"]) {
      expect(result?.extractedHtml).toContain(word);
    }
    /* And it is on the record: in the result, and in the log, by page number. */
    expect(result?.notes.filter((note) => /without .*context/.test(note))).toEqual([
      expect.stringMatching(/^page 3: .*page 2\b/),
    ]);
    expect(logged).toContain("dropped the context page from a pdf chunk");
    expect(logged).toMatch(/"pages":\[3\]/);
    expect(logged).toMatch(/"context":2\b/);
    /* No article prose in the log: every word of the fixture looks like p3l0w0. */
    expect(logged).not.toMatch(/p\dl\d+w\d+/);
  });

  it("still refuses a page that is over the allowance on its own", async () => {
    const f = await fixture();
    /* One byte under page 2 alone: dropping page 1 from in front of it is not enough. */
    const limit = f.page2Alone - 1;
    const wire = fakeWire(fromTextLayer(f.pass));
    const reader = openRouterReader(PDF_READER_MODEL, undefined, { ask: wire.ask, maxEncodedBytes: limit });

    const failure = readerFailureOf(await threw(() => run(f.bytes, reader)), "Extracting the article");

    expect(failure.kind).toBe("blocked");
    expect(codeOf(failure.message)).toBe("pdf-chunk-big");
    expect(failure.message).toContain("too large to send to the AI service in one piece");
    expect(askFor(wire.sent, 2)).toHaveLength(0);
  });

  it("leaves an ordinary chunk exactly as it was: the bytes, the instruction and the checkpoint key", async () => {
    const f = await fixture();
    /* The same reader twice, once saying nothing about a limit — which is the
       path every chunk took before this existed — and once with a limit no
       chunk meets. */
    const request = async (limited: boolean) => {
      const wire = fakeWire(fromTextLayer(f.pass));
      const real = openRouterReader(PDF_READER_MODEL, undefined, { ask: wire.ask, maxEncodedBytes: f.page3WithContext });
      const store = memoryCheckpoints({ slug: SLUG, articleId: "article-heavy" });
      const result = await run(f.bytes, limited ? real : { id: real.id, read: real.read }, store);
      const sent = [...wire.sent].sort((a, b) => a.instruction.localeCompare(b.instruction));
      return { sent, keys: [...store.entries.keys()].sort(), notes: result.notes };
    };
    const before = await request(false);
    const after = await request(true);

    expect(after.sent).toHaveLength(4);
    expect(after.sent).toEqual(before.sent);
    expect(after.keys).toHaveLength(4);
    expect(after.keys).toEqual(before.keys);
    expect(after.notes).toEqual(before.notes);
    expect(after.sent.filter((s) => CONTEXT_NOTE.test(s.instruction))).toHaveLength(3);
  });
});

describe("B: the checkpoint of a chunk sent without its context page", () => {
  /** One run over `store`, with or without a limit that page 3 plus its context is over. */
  async function attempt(f: Awaited<ReturnType<typeof fixture>>, store: ReturnType<typeof memoryCheckpoints>, tight: boolean) {
    const wire = fakeWire(fromTextLayer(f.pass));
    const reader = openRouterReader(PDF_READER_MODEL, undefined, {
      ask: wire.ask,
      maxEncodedBytes: tight ? f.page3WithContext - 1 : f.page3WithContext,
    });
    const result = await run(f.bytes, reader, store);
    return { sent: wire.sent, notes: result.notes.filter((note) => /without .*context/.test(note)) };
  }
  const newStore = () => memoryCheckpoints({ slug: SLUG, articleId: "article-heavy" });

  it("has its own key, is found again by the next attempt, and changes no other chunk's key", async () => {
    const f = await fixture();
    const withContext = newStore();
    await attempt(f, withContext, false);
    const without = newStore();
    await attempt(f, without, true);

    const a = [...withContext.entries.keys()];
    const b = [...without.entries.keys()];
    expect(a).toHaveLength(4);
    expect(b).toHaveLength(4);
    /* Pages 1, 2 and 4 are the same question either way; page 3 is not. */
    expect(b.filter((key) => a.includes(key))).toHaveLength(3);

    /* A second attempt over the same store pays for nothing, and still says
       what it did not send. */
    const again = await attempt(f, without, true);
    expect(again.sent).toHaveLength(0);
    expect(again.notes).toHaveLength(1);
    expect([...without.entries.keys()]).toEqual(b);
  });

  it("is never served to a chunk that carries its context page", async () => {
    const f = await fixture();
    const store = newStore();
    await attempt(f, store, true);

    /* The allowance goes up, so page 3 can carry page 2 again. That is a
       different question, and the answer stored for the other one is not it. */
    const roomy = await attempt(f, store, false);
    expect(roomy.sent).toHaveLength(1);
    expect(roomy.sent[0]?.instruction).toMatch(/^Transcribe page 3 of/);
    expect(roomy.sent[0]?.instruction.match(CONTEXT_NOTE)?.[1]).toBe("2");
    expect(roomy.sent[0]?.encoded).toBe(f.page3WithContext);
    expect(roomy.notes).toHaveLength(0);
    expect(store.entries.size).toBe(5);
  });

  it("and a reading made with the context page is used as it is, not asked again without", async () => {
    const f = await fixture();
    const store = newStore();
    await attempt(f, store, false);

    const tight = await attempt(f, store, true);
    expect(tight.sent).toHaveLength(0);
    expect(tight.notes).toHaveLength(0);
    expect(store.entries.size).toBe(4);
  });
});
