/**
 * The PDF chunks are read concurrently, and the answer must not depend on who
 * finished first.
 *
 * **Why this file exists separately from tests/pdf-read.test.ts.** That file
 * stubs the model and checks the arithmetic, and every one of its 39 tests
 * passed against both the sequential version of this stage and the concurrent
 * one. They could not tell the two apart, which means none of them was evidence
 * about the change — docs/reusable/silent-success.md. These three can: each was
 * seen red against a deliberate reversion before being trusted, and the
 * reversion for each is named in its own comment.
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { Pass0, PdfRecord } from "../src/pdf.js";
import { pass0 } from "../src/pdf.js";
import {
  CHUNK_CONCURRENCY,
  type PdfReader,
  planChunks,
  runPdfExtract,
} from "../src/pdf-read.js";

const EASY = new URL("../evals/pdf/easy/source.pdf", import.meta.url);

/**
 * A PDF dense enough that every page becomes its own chunk, so there are more
 * chunks than `CHUNK_CONCURRENCY`.
 *
 * **Built rather than borrowed, because no fixture in the repo can test this.**
 * `easy` plans 2 chunks, `much-harder` 3, `harder` 5 — all at or below the
 * bound, which GPT Sol pointed out means every assertion about the bound passes
 * under an unbounded `Promise.all`, under `concurrency: 2`, with
 * `queue.clear()` deleted, and with the signal missing from `queue.add`. A test
 * that four different breakages pass is not a test of the bound.
 *
 * `planChunks` closes a chunk when the next page would take it past
 * `CHUNK_WORDS` (3200). These pages measure out at roughly 1,100 words each —
 * two to a chunk — so the caller needs about twice as many pages as it wants
 * chunks. That is measured, not predicted: the first draft reasoned its way to
 * "one page per chunk" from the number of words it drew, and got 6 chunks from
 * 12 pages, because what `pass0` counts is what the text layer yields and not
 * what `drawText` was handed. The words are made unique per page so nothing
 * trips the twenty-word repeat dedup.
 */
async function manyChunkPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let p = 1; p <= pages; p++) {
    const page = doc.addPage([612, 792]);
    for (let line = 0; line < 43; line++) {
      const words = Array.from({ length: 40 }, (_, w) => `p${p}l${line}w${w}`);
      page.drawText(words.join(" "), { x: 20, y: 770 - line * 17, size: 4 });
    }
  }
  return doc.save();
}

/** The pages an instruction asks to be emitted, ignoring any context page. */
function askedPages(instruction: string): number[] {
  const all = [...instruction.matchAll(/\d+/g)].map(Number);
  return instruction.includes("included only so you can see") ? all.slice(1) : all;
}

/**
 * A reader that transcribes from the PDF's own text layer, and lets the test
 * decide when each call returns.
 *
 * `hold` is given the pages a call is for and returns a promise the call waits
 * on before answering — which is how completion order is controlled without a
 * timer, and therefore without a flake.
 */
function scriptedReader(
  pass: Pass0,
  hooks: {
    hold?: ((pages: number[]) => Promise<void>) | undefined;
    onStart?: (pages: number[]) => void;
    onEnd?: (pages: number[]) => void;
    fail?: (pages: number[]) => boolean;
    onSignal?: (pages: number[], signal: AbortSignal | undefined) => void;
  } = {},
): PdfReader {
  return {
    id: "test/scripted",
    async read(_pdf, instruction, signal) {
      const pages = askedPages(instruction);
      hooks.onSignal?.(pages, signal);
      hooks.onStart?.(pages);
      try {
        await hooks.hold?.(pages);
        if (hooks.fail?.(pages)) throw new Error(`refused pages ${pages.join(", ")}`);
        const records: PdfRecord[] = [];
        const wanted = new Set(pages);
        for (const page of pass.pages) {
          if (!wanted.has(page.page)) continue;
          for (const line of page.text.split("\n")) {
            if (line.trim()) {
              records.push({
                page: page.page,
                type: "paragraph",
                text: line,
                continues: false,
                uncertain: false,
              });
            }
          }
        }
        return {
          records,
          stripped: 0,
          finish: "stop" as const,
          usage: { input: 100, output: 200 },
          ms: 1,
        };
      } finally {
        hooks.onEnd?.(pages);
      }
    },
  };
}

async function fixture() {
  const bytes = new Uint8Array(await readFile(EASY));
  return { bytes, pass: await pass0(bytes) };
}

async function runWith(reader: PdfReader, bytes: Uint8Array) {
  const dir = await mkdtemp(path.join(tmpdir(), "spya-pdfconc-"));
  return runPdfExtract({
    bytes,
    url: "https://example.test/paper.pdf",
    dataDir: dir,
    slug: "paper",
    reader,
  });
}

describe("PDF chunks are read concurrently", () => {
  it("reads at exactly the configured width, no narrower and no wider", async () => {
    const bytes = await manyChunkPdf(24);
    const pass = await pass0(bytes);
    const total = planChunks(pass).length;
    /* The whole point of the synthetic PDF. If this is ever not true the test
       below is measuring nothing, so it is asserted rather than assumed. */
    expect(total).toBeGreaterThan(CHUNK_CONCURRENCY);

    let inFlight = 0;
    let peak = 0;

    /**
     * **Every call is held for one fixed window, and the window has to be a
     * timer.**
     *
     * The obvious design — release as soon as `CHUNK_CONCURRENCY` calls are in
     * flight — was tried and is useless: it PASSES with `concurrency: Infinity`.
     * Each task does an async cache read before it reaches the reader, so the
     * twelve tasks arrive staggered; releasing on the eighth lets those eight
     * finish before the last four have started, and the peak never reaches
     * twelve even with no bound at all. Verified by reverting to `Infinity` and
     * watching all three tests stay green.
     *
     * So the gate is time, not a count: hold everything for one window long
     * enough that anything the queue is willing to start has started. Bounded
     * at eight, only eight are ever in the air; unbounded, all twelve are.
     */
    const reader = scriptedReader(pass, {
      onStart: () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
      },
      onEnd: () => {
        inFlight -= 1;
      },
      hold: () => new Promise<void>((r) => setTimeout(r, 300)),
    });

    await runWith(reader, bytes);
    /* Three breakages, three reds. Sequential or any narrower queue: peak is
       that width and the equality fails. An unbounded `Promise.all` or a
       `concurrency: Infinity`: peak reaches all 12. */
    expect(peak).toBe(CHUNK_CONCURRENCY);
    expect(peak).toBeLessThan(total);
  });

  /**
   * **The first version of this test was decoration, and saying so is the point.**
   *
   * It ran the stage twice, once with each completion order, and compared page
   * count, title and recall. All three matched — and they matched with the fold
   * loop deliberately reversed, too. So it could not have failed. The reason is
   * worth keeping: `all.sort()` restores record order at the end, and recall is
   * a sum, which is commutative. Fold order genuinely does not reach either.
   *
   * The one thing it does reach is `seen`. When two chunks emit the same twenty
   * words, the dedup keeps whichever is folded FIRST and drops the other — so
   * in page order the earlier page keeps the text, and in completion order it
   * is a race. That is the determinism the concurrent version has to buy back,
   * and it is what this now tests.
   */
  it("keeps a duplicated passage on the earlier page, whoever answers first", async () => {
    const { bytes, pass } = await fixture();
    const chunks = planChunks(pass);
    expect(chunks.length).toBeGreaterThan(1);
    const early = chunks[0]!;
    const late = chunks[1]!;

    /* Long enough to clear the twenty-word floor in `withoutRepeats`, which is
       what makes it a dedup candidate at all rather than a kept short record. */
    const SHARED =
      "the persistence of memory in the archive is not a metaphor but a claim " +
      "about what the record can be made to hold for us";
    expect(SHARED.split(/\s+/).length).toBeGreaterThanOrEqual(20);

    /** Both chunks emit SHARED; only one may survive, and it must be the earlier page. */
    const duplicating = (hold?: (pages: number[]) => Promise<void>): PdfReader => {
      const inner = scriptedReader(pass, { hold });
      return {
        id: "test/duplicating",
        async read(pdf, instruction, signal) {
          const out = await inner.read(pdf, instruction, signal);
          const pages = askedPages(instruction);
          return {
            ...out,
            records: [
              ...out.records,
              {
                page: pages[0]!,
                type: "paragraph" as const,
                text: SHARED,
                continues: false,
                uncertain: false,
              },
            ],
          };
        },
      };
    };

    const survivor = async (reader: PdfReader) => {
      const dir = await mkdtemp(path.join(tmpdir(), "spya-pdfdup-"));
      const result = await runPdfExtract({
        bytes,
        url: "https://example.test/paper.pdf",
        dataDir: dir,
        slug: "paper",
        reader,
      });
      return result.extractedHtml;
    };

    /**
     * **Counting the survivors is not enough, and that was the second thing
     * this test got wrong.**
     *
     * Exactly one copy survives whichever chunk is folded first — the dedup
     * guarantees that much on its own — so a count of 1 is true under the bug
     * as well as under the fix. What differs is WHICH page keeps it, and
     * records are sorted by page at the end, so the survivor's position in the
     * article is the observable that separates the two.
     *
     * Comparing that position *between the two runs* rather than against a
     * landmark inside the document, because the third thing this test got wrong
     * was using a landmark: the first long line of the late chunk's page is the
     * journal's running header, which is on every page including the first, so
     * the comparison was against page 1's copy of it and could never mean what
     * it said.
     */
    const laterFirst = (pages: number[]) =>
      pages[0] === early.pages[0]
        ? new Promise<void>((r) => setTimeout(r, 40))
        : Promise.resolve();

    const earlyFirstHtml = await survivor(duplicating());
    const lateFirstHtml = await survivor(duplicating(laterFirst));

    expect(earlyFirstHtml.split(SHARED).length - 1, "one copy survives").toBe(1);
    expect(lateFirstHtml.split(SHARED).length - 1, "one copy survives").toBe(1);

    /* The survivor sits in the same place regardless of who answered first,
       because the fold runs in page order. */
    expect(lateFirstHtml.indexOf(SHARED), "the same page keeps it either way").toBe(
      earlyFirstHtml.indexOf(SHARED),
    );

    /**
     * And it is the EARLY page that keeps it, not merely a consistent one.
     *
     * **This is the assertion that does the work, and the one above is not.**
     * Verified by reverting the fold to completion order: the two runs still
     * agreed with each other — they moved together — so the equality above
     * stayed green and only this line went red, at 24,689 against a half-length
     * of 12,419. Worth writing down, because the equality reads like the
     * stronger check and is the weaker one.
     */
    expect(earlyFirstHtml.indexOf(SHARED)).toBeLessThan(earlyFirstHtml.length / 2);
    void late;
  });

  /**
   * **This needs more chunks than the queue is wide, and the first version did
   * not have them.**
   *
   * On the 2-chunk `easy` fixture there is nothing queued behind the failure,
   * so `queue.clear()` could be deleted and the test would still pass — it was
   * only ever exercising `fatal.abort()`. With twelve chunks and a width of
   * eight, the two halves of the stop are separately observable: four chunks
   * are waiting in the queue and must never start, and seven are in the air and
   * must be signalled.
   */
  it("neither starts nor pays for the chunks behind a failure", async () => {
    const bytes = await manyChunkPdf(24);
    const pass = await pass0(bytes);
    const chunks = planChunks(pass);
    expect(chunks.length).toBeGreaterThan(CHUNK_CONCURRENCY);
    const doomed = chunks[0]!.pages[0]!;

    const aborted: number[][] = [];
    const started: number[][] = [];

    /* The doomed chunk must not fail until the first wave is full, or the
       failure races the queue's own scheduling and the counts below mean
       nothing. */
    let waveFull!: () => void;
    const firstWave = new Promise<void>((r) => (waveFull = r));

    const reader = scriptedReader(pass, {
      onStart: (pages) => {
        started.push(pages);
        if (started.length >= CHUNK_CONCURRENCY) waveFull();
      },
      onSignal: (pages, signal) => {
        signal?.addEventListener("abort", () => aborted.push(pages));
      },
      hold: (pages) =>
        pages[0] === doomed
          ? firstWave
          : /* The survivors hang until their signal aborts. If the abort never
               arrives, this rejects and the test fails loudly rather than
               hanging the suite. */
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error("never aborted")), 5000),
            ),
      fail: (pages) => pages[0] === doomed,
    });

    await expect(runWith(reader, bytes)).rejects.toThrow(/refused pages/);

    /* `queue.clear()`: the four chunks still queued never run, so nothing past
       the first wave was ever bought. Redden by deleting the `clear()` — the
       remaining chunks start as the aborted ones settle and this climbs to 12. */
    expect(started.length).toBe(CHUNK_CONCURRENCY);

    /* `fatal.abort()`: everything in the air was signalled. Redden by deleting
       the `abort()` — nothing lands in `aborted` and the 5s guards fire instead.

       `CHUNK_CONCURRENCY` and not one less: the doomed chunk is in this list
       too. Its listener is attached to the same shared signal and stays
       attached after it has thrown, so it fires along with the rest. The first
       version of this assertion said `- 1` on the assumption that a chunk which
       had already failed would not be counted, which was a guess about
       `AbortSignal` rather than an observation of it. */
    expect(aborted.length).toBe(CHUNK_CONCURRENCY);
  });
});
