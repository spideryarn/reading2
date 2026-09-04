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
 */
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { readerFailureOf } from "../src/job-failure.js";
import { MAX_PAGES, runPdfExtract } from "../src/pdf-read.js";
import { memoryCheckpoints } from "./helpers/memory-checkpoints.js";

/** A real, minimal, valid PDF with the given number of blank pages. */
async function pdfWithPages(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) {
    doc.addPage([200, 200]);
  }
  return doc.save();
}

describe("the page-cap reader message (real PDF, real pass0/runPdfExtract)", () => {
  it("tells the reader the actual page count and the limit, not the generic sentence", async () => {
    const pageCount = 142;
    expect(pageCount).toBeGreaterThan(MAX_PAGES);
    const bytes = await pdfWithPages(pageCount);

    let thrown: unknown;
    try {
      await runPdfExtract({
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
    // catch, naming the actual page count (142) and the limit (100).
    expect(readerFailure.message).toContain("142");
    expect(readerFailure.message).toContain(String(MAX_PAGES));
    expect(readerFailure.message).not.toContain("[jb-step-no]");
  });
});
