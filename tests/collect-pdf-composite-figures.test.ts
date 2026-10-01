/**
 * **A composite figure, recovered through the located route** — the wiring of
 * `judgeLocatedRegion` into `collectPdfFigures` (src/collect-pdf-figures.ts),
 * docs/plans/261001q-pdf-tables-and-composite-figures.md § Stage 2.
 *
 * Two generated pages, the two shapes behind report spya-pawfwx: two photos
 * side by side under one caption (the bitmap route says `ambiguous`), and two
 * charts with a small legend and no picture at all (the drawn route says
 * `not-located`, and until this change the locator was never asked about a page
 * with no picture on it). The locator is scripted; nothing here spends money.
 */
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { collectPdfFigures, MAX_LOCATE_CALLS } from "../src/collect-pdf-figures.js";
import { readPdfPageLayouts } from "../src/pdf-figure-layout.js";
import type { FigureLocator } from "../src/pdf-figure-locate.js";
import { encodeFigurePng } from "../src/pdf-figures.js";
import type { BlobHead, PutResult, RawSourceStore } from "../src/store/blobs.js";

const PROSE = "This paragraph is ordinary body text that runs across the whole column of the page.";
const PHOTOS_CAPTION = "Fig 1. Two panels of the same experiment, side by side for comparison.";
const CHARTS_CAPTION = "Fig 2. Differences in kinase levels at presentation and at relapse.";

function marker(page: number, ordinal = 1) {
  return { ref: `pdffig1-${String(page).padStart(4, "0")}${"0".repeat(28)}.${page}.${ordinal}`, page, ordinal };
}

/** A bucket in a Map, create-only — tests/collect-pdf-figures.test.ts's. */
function fakeBlobs(): RawSourceStore {
  const objects = new Map<string, Uint8Array>();
  return {
    async head(key): Promise<BlobHead | null> {
      const there = objects.get(key);
      return there ? { bytes: there.byteLength, contentType: null } : null;
    },
    async get(key): Promise<Uint8Array | null> {
      return objects.get(key) ?? null;
    },
    async putIfAbsent(key, value): Promise<PutResult> {
      if (objects.has(key)) return "already-there";
      objects.set(key, value);
      return "stored";
    },
    async remove(key): Promise<void> {
      objects.delete(key);
    },
  };
}

/** A photo-like picture: noise, so no rule calls it blank. */
async function photo(seed: number): Promise<Uint8Array> {
  const width = 120;
  const height = 90;
  const data = new Uint8Array(width * height * 3);
  let x = seed;
  for (let i = 0; i < data.length; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    data[i] = x % 256;
  }
  return encodeFigurePng({ kind: "rgb", width, height, data });
}

async function proseLines(doc: PDFDocument, page: ReturnType<PDFDocument["addPage"]>, ys: number[]) {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const y of ys) page.drawText(PROSE, { x: 60, y, size: 10, font });
  return font;
}

/** Page 1: prose, two photos with labels, the caption under them, prose. */
async function photosPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await proseLines(doc, page, [780, 766, 752, 380, 366, 352]);
  for (const [i, x] of [100, 240].entries()) {
    const image = await doc.embedPng(await photo(i + 1));
    page.drawImage(image, { x, y: 500, width: 120, height: 90 });
    page.drawText(i === 0 ? "A" : "B", { x, y: 600, size: 9, font });
  }
  page.drawText(PHOTOS_CAPTION, { x: 60, y: 470, size: 9, font });
  return doc.save();
}

/** Page 1: prose, two charts drawn as lines and a small legend, the caption, prose. */
async function chartsPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await proseLines(doc, page, [780, 766, 752, 380, 366, 352]);
  for (const x of [100, 300]) {
    page.drawLine({ start: { x, y: 520 }, end: { x, y: 640 }, thickness: 1, color: rgb(0, 0, 0) });
    page.drawLine({ start: { x, y: 520 }, end: { x: x + 150, y: 520 }, thickness: 1, color: rgb(0, 0, 0) });
    page.drawLine({ start: { x: x + 10, y: 530 }, end: { x: x + 140, y: 630 }, thickness: 2, color: rgb(0, 0, 0) });
    page.drawText("Pre", { x: x + 5, y: 508, size: 8, font });
  }
  /* The legend: a short dashed swatch, smaller than the drawn route's 36 pt. */
  page.drawLine({ start: { x: 300, y: 500 }, end: { x: 330, y: 500 }, thickness: 1, color: rgb(0, 0, 0) });
  page.drawText("HER-2- to HER-2+", { x: 335, y: 497, size: 8, font });
  page.drawText(CHARTS_CAPTION, { x: 60, y: 470, size: 9, font });
  return doc.save();
}

/** Two pages with the same drawing but different captions outside the crop. */
async function repeatedChartsPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const caption of ["Fig 1. First claim about this chart.", "Fig 2. A different claim about this chart."]) {
    const page = doc.addPage([595, 842]);
    for (const x of [100, 300]) {
      page.drawLine({ start: { x, y: 520 }, end: { x, y: 640 }, thickness: 1, color: rgb(0, 0, 0) });
      page.drawLine({ start: { x, y: 520 }, end: { x: x + 150, y: 520 }, thickness: 1, color: rgb(0, 0, 0) });
      page.drawLine({ start: { x: x + 10, y: 530 }, end: { x: x + 140, y: 630 }, thickness: 2, color: rgb(0, 0, 0) });
      page.drawText("Pre", { x: x + 5, y: 508, size: 8, font });
    }
    page.drawText(caption, { x: 60, y: 470, size: 9, font });
  }
  return doc.save();
}

/** `box_2d` for a page box on a 595 × 842 page. */
function box2d(x0: number, y0: number, x1: number, y1: number): number[] {
  return [
    Math.round(((842 - y1) / 842) * 1000),
    Math.round((x0 / 595) * 1000),
    Math.round(((842 - y0) / 842) * 1000),
    Math.round((x1 / 595) * 1000),
  ];
}

function scripted(answer: unknown) {
  const asked: number[][] = [];
  const locate: FigureLocator = async (request) => {
    asked.push(request.pages.map((p) => p.page));
    return { ok: true, answer };
  };
  return { locate, asked };
}

describe("a composite figure the model boxed", () => {
  it("stores two photos under one caption as one rendered figure", async () => {
    const m = marker(1);
    const pdf = await photosPdf();
    const captions = new Map([[m.ref, PHOTOS_CAPTION]]);

    const before = await collectPdfFigures({ locate: null, captions, markers: [m], pdf, blobs: fakeBlobs() });
    expect(before.entries[0]).toMatchObject({ status: "failed", reason: "ambiguous" });

    const { locate, asked } = scripted({ page: 1, box_2d: box2d(95, 495, 365, 612) });
    const run = await collectPdfFigures({ locate, captions, markers: [m], pdf, blobs: fakeBlobs() });
    expect(asked).toEqual([[1]]);
    const entry = run.entries[0]!;
    expect(entry).toMatchObject({ status: "stored" });
    /* Both photos, not one: wider than two pictures' worth of one. */
    if (entry.status === "stored") expect(entry.width / entry.height).toBeGreaterThan(2);
    expect(run.located).toBe(1);
  }, 120_000);

  it("asks about, and stores, a figure of charts with no picture on its page", async () => {
    const m = marker(1);
    const pdf = await chartsPdf();
    const captions = new Map([[m.ref, CHARTS_CAPTION]]);

    const before = await collectPdfFigures({ locate: null, captions, markers: [m], pdf, blobs: fakeBlobs() });
    expect(before.entries[0]?.status).toBe("failed");

    const { locate, asked } = scripted({ page: 1, box_2d: box2d(95, 490, 455, 645) });
    const run = await collectPdfFigures({ locate, captions, markers: [m], pdf, blobs: fakeBlobs() });
    expect(asked).toHaveLength(1);
    expect(run.entries[0]).toMatchObject({ status: "stored" });
    expect(run.located).toBe(1);
  }, 120_000);

  it("keeps the refusal when the box is the prose under the caption", async () => {
    const m = marker(1);
    const pdf = await photosPdf();
    const { locate } = scripted({ page: 1, box_2d: box2d(55, 340, 540, 395) });
    const layoutReads: number[][] = [];
    const run = await collectPdfFigures({
      locate,
      captions: new Map([[m.ref, PHOTOS_CAPTION]]),
      markers: [m],
      pdf,
      blobs: fakeBlobs(),
      readLayouts: async (options) => {
        layoutReads.push([...options.pages]);
        return readPdfPageLayouts(options);
      },
    });
    /* This makes the wiring assertion red if the composite judge is simply
       skipped: the bitmap/drawn routes do not need a layout for this page. */
    expect(layoutReads).toEqual([[1]]);
    expect(run.entries[0]).toMatchObject({ status: "failed", reason: "ambiguous" });
  }, 120_000);

  it("gives neither caption an identical composite repeated on another page", async () => {
    const one = marker(1);
    const two = marker(2);
    const captions = new Map([
      [one.ref, "Fig 1. First claim about this chart."],
      [two.ref, "Fig 2. A different claim about this chart."],
    ]);
    const pdf = await repeatedChartsPdf();
    const asked: string[] = [];
    const locate: FigureLocator = async (request) => {
      asked.push(request.caption);
      const page = request.caption.startsWith("Fig 1") ? 1 : 2;
      return { ok: true, answer: { page, box_2d: box2d(95, 500, 455, 645) } };
    };
    const run = await collectPdfFigures({ locate, captions, markers: [one, two], pdf, blobs: fakeBlobs() });
    expect(asked).toHaveLength(2);
    expect(run.entries.map((entry) => entry.status)).toEqual(["failed", "failed"]);
    expect(run.located).toBe(0);
  }, 120_000);

  it("does not let the test override widen the production call ceiling", async () => {
    const pdf = await chartsPdf();
    const markers = Array.from({ length: MAX_LOCATE_CALLS + 1 }, (_, i) => marker(1, i + 1));
    const captions = new Map(markers.map((m, i) => [m.ref, `Figure ${i + 10}. Not printed on this page.`]));
    let calls = 0;
    const locate: FigureLocator = async () => {
      calls += 1;
      return { ok: true, answer: { page: null, box_2d: null } };
    };
    const run = await collectPdfFigures({
      locate,
      maxLocateCalls: MAX_LOCATE_CALLS + 100,
      captions,
      markers,
      pdf,
      blobs: fakeBlobs(),
    });
    expect(calls).toBe(MAX_LOCATE_CALLS);
    expect(run.locateCalls).toBe(MAX_LOCATE_CALLS);
  }, 120_000);
});
