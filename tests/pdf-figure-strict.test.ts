/**
 * The strict second read of a candidate page — GPT Sol F33,
 * docs/plans/260912a-figure-2-vector-figures-from-a-pdf.md § Stage 1 code review.
 *
 * pdf.js is run forgiving, so a malformed paint operator can be dropped from
 * the operator list without a word — and PDFium may still draw something for
 * it into the crop, where the ownership rules never measured it. So a page the
 * drawn route is about to use is read a second time with `stopAtErrors`, and
 * refused unless the two reads agree.
 *
 * The malformed operator here is `sh` naming a shading the page does not have:
 * measured 2026-09-12, the forgiving read drops it and keeps the other 35
 * operators, and the strict read resolves with an empty list — not a
 * rejection, which is why the check compares the reads rather than waiting for
 * a throw.
 */
import { readFile } from "node:fs/promises";
import { PDFDocument, PDFName, PDFOperator, type PDFOperatorNames, rgb, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { collectPdfFigures } from "../src/collect-pdf-figures.js";
import { readPdfPageLayouts } from "../src/pdf-figure-layout.js";
import type { PutResult, RawSourceStore } from "../src/store/blobs.js";

const CAPTION = "Figure 1. A drawn test figure made of two boxes joined by a line.";

/** An eligible drawn-figure page: two boxes joined by a line over one caption — and, if asked, a broken `sh`. */
async function drawnPage(malformed: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(CAPTION, { x: 72, y: 400, size: 9, font });
  page.drawRectangle({ x: 100, y: 450, width: 180, height: 150, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  page.drawRectangle({ x: 300, y: 450, width: 180, height: 150, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  page.drawLine({ start: { x: 280, y: 525 }, end: { x: 300, y: 525 }, thickness: 1, color: rgb(0, 0, 0) });
  if (malformed) page.pushOperators(PDFOperator.of("sh" as PDFOperatorNames, [PDFName.of("Sh0")]));
  return doc.save();
}

const MARKER = { ref: `pdffig1-${"0".repeat(30)}01.1.1`, page: 1, ordinal: 1 };

function fakeBlobs(): RawSourceStore & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async head(key) {
      const there = objects.get(key);
      return there ? { bytes: there.byteLength, contentType: null } : null;
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async putIfAbsent(key, value): Promise<PutResult> {
      if (objects.has(key)) return "already-there";
      objects.set(key, value);
      return "stored";
    },
    async remove(key) {
      objects.delete(key);
    },
  };
}

describe("the strict second read (Sol F33)", () => {
  it("draws the well-formed page, whose two reads agree", async () => {
    const pdf = await drawnPage(false);
    const layout = (await readPdfPageLayouts({ data: pdf, pages: [1] })).get(1);
    expect(layout?.strictAgrees).toBe(true);
    const run = await collectPdfFigures({
      markers: [MARKER],
      pdf,
      blobs: fakeBlobs(),
      captions: new Map([[MARKER.ref, CAPTION]]),
    });
    expect(run.entries[0]).toMatchObject({ status: "stored" });
  }, 60_000);

  it("refuses the page whose paint the forgiving read dropped", async () => {
    const pdf = await drawnPage(true);
    const layout = (await readPdfPageLayouts({ data: pdf, pages: [1] })).get(1);
    /* The forgiving read looks exactly like the well-formed page's… */
    const control = (await readPdfPageLayouts({ data: await drawnPage(false), pages: [1] })).get(1);
    expect(layout?.operators).toBe(control?.operators);
    /* …and only the strict one knows it is not. */
    expect(layout?.strictAgrees).toBe(false);
    const blobs = fakeBlobs();
    const run = await collectPdfFigures({
      markers: [MARKER],
      pdf,
      blobs,
      captions: new Map([[MARKER.ref, CAPTION]]),
    });
    expect(run.entries).toEqual([expect.objectContaining({ status: "failed", reason: "not-located" })]);
    expect(blobs.objects.size).toBe(0);
  }, 60_000);

  it("agrees with the forgiving read on all three real figures", async () => {
    const mdpi = await readFile("tests/fixtures/pdf-vector-figure/entropy-24-00930-p8.pdf");
    const arxiv = await readFile("evals/pdf/titles/arxiv-arnn-eeg-stamp/source.pdf");
    expect((await readPdfPageLayouts({ data: new Uint8Array(mdpi), pages: [1] })).get(1)?.strictAgrees).toBe(true);
    const arxivLayouts = await readPdfPageLayouts({ data: new Uint8Array(arxiv), pages: [2, 3] });
    expect([arxivLayouts.get(2)?.strictAgrees, arxivLayouts.get(3)?.strictAgrees]).toEqual([true, true]);
  }, 60_000);
});
