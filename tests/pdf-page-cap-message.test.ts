/**
 * **A PDF refused for its length, and told nobody why** — the report this whole
 * piece of work came out of.
 *
 * Greg uploaded a ~142-page paper on 2026-09-03 and the extract step failed.
 * Sentry showed a bare `Error: Error` with `message_withheld: True`, and the
 * reader was shown `stepGaveUp("blocked", …)`'s fully generic sentence ending
 * `[jb-step-no]` — not the specific *"This PDF has 142 pages and the limit is
 * 100…"* that `runPdfExtract`'s `TooManyPages` catch had built.
 *
 * The cause: that catch called `stageFailure("blocked", detail)`, the form that
 * sets `failureKind` and treats its argument as a log-only diagnostic
 * (src/job-failure.ts). `readerFailureOf` found no declared `readerFailure` and
 * substituted the generic sentence for the kind. Seven other throw sites had
 * done the same thing —
 * docs/plans/260903k-pdf-page-cap-refused-with-no-reason-given.md.
 *
 * **Written to fail, and it did**, before `pdfTooManyPages` existed. Kept
 * because it drives the real code end to end: a real >`MAX_PAGES` PDF built with
 * pdf-lib, through the real `pass0` and `runPdfExtract`, asserting at the seam
 * every failed step passes through. The other three refusals in that file are
 * in tests/pdf-read-failure-sentences.test.ts.
 *
 * **The cap moved to 250 on 2026-09-04 and this file went red, loudly**, which
 * is what a hard-coded 142 beside a `toBeGreaterThan(MAX_PAGES)` is for. The
 * page count is now derived from the cap, because the property under test is
 * *the reader is told the count and the limit* and that is true at any cap —
 * pinning a number pinned the wrong thing. What the original 142 was really
 * evidence of has become the second test here: the paper Greg uploaded is now
 * **accepted**, which is the product change the whole plan was for.
 *
 * This refusal is a **backstop** since the same day. Stage 1 counts the pages
 * before the document is stored (tests/a-long-pdf-is-refused-before-it-is-stored.test.ts),
 * so an ordinary ingest never reaches the catch below — an article ingested
 * before that landed, or re-extracted after the cap moves again, does.
 */
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { readerFailureOf } from "../src/job-failure.js";
import { planChunks, runPdfExtract } from "../src/pdf-read.js";
import { pass0 } from "../src/pdf.js";
import { MAX_PAGES } from "../src/uploads.js";
import { memoryCheckpoints } from "./helpers/memory-checkpoints.js";

/** A real, minimal, valid PDF with the given number of blank pages. */
async function pdfWithPages(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) {
    doc.addPage([200, 200]);
  }
  return doc.save();
}

/** The paper that started this: Kuhn, *A Landscape of Consciousness*, ~142 pages. */
const THE_PAPER = 142;

describe("the page-cap reader message (real PDF, real pass0/runPdfExtract)", () => {
  it("tells the reader the actual page count and the limit, not the generic sentence", async () => {
    /* Derived, not pinned. The claim is about the sentence, not about 142. */
    const pageCount = MAX_PAGES + 42;
    const bytes = await pdfWithPages(pageCount);

    let thrown: unknown;
    try {
      await runPdfExtract({
        frontMatter: null,
        bytes,
        slug: "too-many-pages",
        checkpoints: memoryCheckpoints({ slug: "too-many-pages", articleId: "article-too-many-pages" }),
      });
      throw new Error("runPdfExtract should have thrown TooManyPages, but it did not");
    } catch (err) {
      thrown = err;
    }

    const readerFailure = readerFailureOf(thrown, "Extracting the article");

    // What the reader SHOULD see: the specific sentence from the TooManyPages
    // catch, naming the actual page count and the limit.
    expect(readerFailure.message).toContain(String(pageCount));
    expect(readerFailure.message).toContain(String(MAX_PAGES));
    expect(readerFailure.message).not.toContain("[jb-step-no]");
  });

  /**
   * **The other half of the same change, and the point of it.**
   *
   * `pass0` and `planChunks` rather than `runPdfExtract`, because past the cap
   * the next thing that happens is a model call and this test has no business
   * making one. Those two are what the cap actually gates: getting through the
   * guard and planning a finite number of chunks is the whole of "accepted".
   */
  it("accepts the paper that prompted the change, and plans it into chunks", async () => {
    expect(THE_PAPER).toBeLessThanOrEqual(MAX_PAGES);
    const pass = await pass0(await pdfWithPages(THE_PAPER), { maxPages: MAX_PAGES });
    expect(pass.pages).toHaveLength(THE_PAPER);
    const chunks = planChunks(pass);
    expect(chunks.length).toBeGreaterThan(0);
    /* Every page is planned exactly once — a plan that quietly dropped pages
       would still be "a number of chunks". */
    expect(chunks.flatMap((c) => c.pages)).toEqual(
      Array.from({ length: THE_PAPER }, (_, i) => i + 1),
    );
  });
});
