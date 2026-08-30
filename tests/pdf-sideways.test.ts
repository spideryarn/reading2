/**
 * **Text printed sideways is not prose, and must not be scored as if it were.**
 *
 * Measured on production 2026-08-30, on the first two PDFs ever ingested there.
 * A nine-page arXiv paper transcribed correctly, cost $0.021, and was refused
 * publication for exactly one reason:
 *
 *     Pages 1, 2, 3, 4: 1 run(s) are missing from the transcription,
 *       the longest 8 words — "arxiv 1503 02531v1 stat ml 9 mar 2015"
 *
 * That is the identifier arXiv prints down the left margin of page 1 of every
 * paper it hosts. The model was right not to transcribe a watermark, and the
 * checker counted its absence against it. On the fourteen-page paper the same
 * stamp arrived spliced into the middle of the title's first word —
 * `"normalizaarxiv 1607 06450v1 stat ml 21 jul 2016 tion"` — which is what a
 * rotated run does to reading order, and is unrecoverable downstream.
 *
 * The fixture is **built here rather than committed**: pdf-lib is already a
 * dependency and can draw rotated text, so the test makes its own PDF with
 * upright prose and one sideways stamp. That keeps a binary out of the repo,
 * keeps the licensing question away from a third-party paper, and — the part
 * that matters — makes the rotation the *only* difference between the text that
 * must survive and the text that must not.
 */

import { PDFDocument, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { baselineFor, pass0 } from "../src/pdf.js";

const PROSE = "The prose of the page runs left to right and must survive.";
/** Shaped like the real thing, which is what made the production failure. */
const STAMP = "arXiv:1503.02531v1 stat.ML 9 Mar 2015";

/** One page: prose across it, and the stamp rotated 90° up the left margin. */
async function pageWithMarginStamp(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  page.drawText(PROSE, { x: 80, y: 700, size: 12 });
  page.drawText(STAMP, { x: 30, y: 200, size: 10, rotate: degrees(90) });
  return doc.save();
}

describe("a margin stamp printed sideways", () => {
  it("is kept out of the baseline, and the upright prose is not", async () => {
    const pass = await pass0(await pageWithMarginStamp());
    const baseline = baselineFor(pass, 1).join(" ");

    /* The whole point: the checker never sees the stamp, so a transcription
       that omits it is not punished for omitting it. */
    expect(baseline).not.toContain("arXiv");
    expect(baseline).not.toContain("02531");
    /* And the fix is not simply dropping the page — before it, this assertion
       and the one above both held for the wrong reason only if pass 0 returned
       nothing at all. */
    expect(baseline).toContain("must survive");
  });

  it("is counted rather than silently subtracted", async () => {
    const pass = await pass0(await pageWithMarginStamp());
    const page = pass.pages[0];

    /* A page that quietly loses half its words to this rule should be
       discoverable, so the count is kept rather than thrown away. */
    expect(page?.sideways).toBeGreaterThan(0);
    /* `words` counts what is left, which is the prose. */
    expect(page?.words).toBe(PROSE.split(/\s+/).length);
  });

  it("leaves a page with no rotated text completely alone", async () => {
    /* The control. Without it, a rule that dropped *everything* would pass the
       two tests above by making the stamp absent along with the rest. */
    const doc = await PDFDocument.create();
    doc.addPage([600, 800]).drawText(PROSE, { x: 80, y: 700, size: 12 });
    const pass = await pass0(await doc.save());

    expect(baselineFor(pass, 1).join(" ")).toContain("must survive");
    expect(pass.pages[0]?.sideways).toBe(0);
  });
});
