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
import { readPdfRasters } from "../src/pdf-figure-read.js";
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

    const before = await collectPdfFigures({ neighbours: new Map(), locate: null, captions, markers: [m], pdf, blobs: fakeBlobs() });
    expect(before.entries[0]).toMatchObject({ status: "failed", reason: "ambiguous" });

    const { locate, asked } = scripted({ page: 1, box_2d: box2d(95, 495, 365, 612) });
    const run = await collectPdfFigures({ neighbours: new Map(), locate, captions, markers: [m], pdf, blobs: fakeBlobs() });
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

    const before = await collectPdfFigures({ neighbours: new Map(), locate: null, captions, markers: [m], pdf, blobs: fakeBlobs() });
    expect(before.entries[0]?.status).toBe("failed");

    const { locate, asked } = scripted({ page: 1, box_2d: box2d(95, 490, 455, 645) });
    const run = await collectPdfFigures({ neighbours: new Map(), locate, captions, markers: [m], pdf, blobs: fakeBlobs() });
    expect(asked).toHaveLength(1);
    expect(run.entries[0]).toMatchObject({ status: "stored" });
    expect(run.located).toBe(1);
  }, 120_000);

  it("keeps the refusal when the box is the prose under the caption", async () => {
    const m = marker(1);
    const pdf = await photosPdf();
    const { locate } = scripted({ page: 1, box_2d: box2d(55, 340, 540, 395) });
    const layoutReads: number[][] = [];
    const run = await collectPdfFigures({ neighbours: new Map(),
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
      const caption = request.subject.kind === "caption" ? request.subject.caption : "";
      asked.push(caption);
      const page = caption.startsWith("Fig 1") ? 1 : 2;
      return { ok: true, answer: { page, box_2d: box2d(95, 500, 455, 645) } };
    };
    const run = await collectPdfFigures({ neighbours: new Map(), locate, captions, markers: [one, two], pdf, blobs: fakeBlobs() });
    expect(asked).toHaveLength(2);
    expect(run.entries.map((entry) => entry.status)).toEqual(["failed", "failed"]);
    expect(run.located).toBe(0);
  }, 120_000);

  it("does not let the test override widen the production call ceiling", async () => {
    /* LeCun's paper needs nine captioned calls; the old ceiling of eight is the
       policy regression this exact value guards, while the assertions below
       guard enforcement of whichever policy is exported. */
    expect(MAX_LOCATE_CALLS).toBe(16);
    const pdf = await chartsPdf();
    const markers = Array.from({ length: MAX_LOCATE_CALLS + 1 }, (_, i) => marker(1, i + 1));
    const captions = new Map(markers.map((m, i) => [m.ref, `Figure ${i + 10}. Not printed on this page.`]));
    let calls = 0;
    const locate: FigureLocator = async () => {
      calls += 1;
      return { ok: true, answer: { page: null, box_2d: null } };
    };
    const run = await collectPdfFigures({ neighbours: new Map(),
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

/* ------------------------------------------------------------------ *
 * A small picture inside a drawing — report spya-m40r6t,
 * docs/plans/261027e-a-picture-inside-a-drawing-is-not-the-figure.md.
 * ------------------------------------------------------------------ */

/**
 * One page of a diagram in the shape of LeCun's: boxes joined by lines, and
 * small embedded icons (the paper's Earth, its "Z" and "S") wired into it.
 * The same icons are reused on every page, as the paper reuses them.
 */
async function iconDiagramsPdf(captions: readonly string[], icons: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const images = [await doc.embedPng(await photo(7)), await doc.embedPng(await photo(8))];
  const black = rgb(0, 0, 0);
  for (const [n, caption] of captions.entries()) {
    const page = doc.addPage([595, 842]);
    for (const y of [780, 766, 752, 380, 366, 352]) page.drawText(PROSE, { x: 60, y, size: 10, font });
    /* Different labels on each page: two identical renders under two captions
       are refused by a rule of their own, which is not what is tested here. */
    for (const [x, label] of [[200, "Enc"], [300, "Pred"], [400, "Cost"]] as const) {
      page.drawRectangle({ x, y: 580, width: 60, height: 30, borderColor: black, borderWidth: 1 });
      page.drawText(`${label}${n + 1}`, { x: x + 8, y: 590, size: 9, font });
    }
    page.drawLine({ start: { x: 260, y: 595 }, end: { x: 300, y: 595 }, thickness: 1, color: black });
    page.drawLine({ start: { x: 360, y: 595 }, end: { x: 400, y: 595 }, thickness: 1, color: black });
    page.drawLine({ start: { x: 230, y: 580 }, end: { x: 230, y: 525 }, thickness: 1, color: black });
    for (let i = 0; i < icons; i++) {
      const image = images[i];
      if (!image) throw new Error("two icons at most");
      page.drawImage(image, { x: 110 + i * 300, y: 510, width: 40, height: 30 });
      /* Wired in: a line from the icon's edge into the drawing. */
      if (i === 0) page.drawLine({ start: { x: 150, y: 525 }, end: { x: 230, y: 525 }, thickness: 1, color: black });
      else page.drawLine({ start: { x: 430, y: 540 }, end: { x: 430, y: 580 }, thickness: 1, color: black });
    }
    page.drawText(caption, { x: 60, y: 470, size: 9, font });
  }
  return doc.save();
}

/** Each figure's whole drawing, as a model that answered correctly would box it. */
const DIAGRAM_BOX = box2d(105, 505, 465, 615);

describe("a small picture inside a drawing is not the figure", () => {
  const captions = [
    "Fig 3. A perception-action episode with the world in it.",
    "Fig 4. The same agent planning several steps ahead.",
  ];
  const markers = [marker(1), marker(2)];
  const captionsByRef = new Map(markers.map((m, i) => [m.ref, captions[i] ?? ""]));
  /* Answers each figure's own page with its whole drawing. */
  const answering = (asked: string[] = []): FigureLocator => async (request) => {
    const caption = request.subject.kind === "caption" ? request.subject.caption : "";
    asked.push(caption);
    return { ok: true, answer: { page: caption.startsWith("Fig 3") ? 1 : 2, box_2d: DIAGRAM_BOX } };
  };

  it("refuses the icon rather than storing it as the figure", async () => {
    const run = await collectPdfFigures({
      neighbours: new Map(),
      locate: null,
      captions: captionsByRef,
      markers,
      pdf: await iconDiagramsPdf(captions, 1),
      blobs: fakeBlobs(),
    });
    /* Until 261027e the one picture on each page was paired with its caption:
       the same icon stored twice, as two different figures. */
    expect(run.entries).toMatchObject([
      { status: "failed", reason: "in-a-drawing" },
      { status: "failed", reason: "in-a-drawing" },
    ]);
  }, 120_000);

  it("asks the locator instead, and stores each whole drawing", async () => {
    const asked: string[] = [];
    const run = await collectPdfFigures({
      neighbours: new Map(),
      locate: answering(asked),
      captions: captionsByRef,
      markers,
      pdf: await iconDiagramsPdf(captions, 1),
      blobs: fakeBlobs(),
    });
    expect(asked).toHaveLength(2);
    expect(run.located).toBe(2);
    for (const entry of run.entries) {
      expect(entry.status).toBe("stored");
      /* The drawing, not the 4:3 icon. */
      if (entry.status === "stored") expect(entry.width / entry.height).toBeGreaterThan(2.5);
    }
  }, 120_000);

  it("keeps two drawings that share their small icons", async () => {
    /* LeCun's Figures 10 and 12: two icons on each page, so the bitmap route
       says `ambiguous`; the composite route accepted the right box for each,
       and then both were dropped because they "shared a picture". */
    const pdf = await iconDiagramsPdf(captions, 2);
    const before = await collectPdfFigures({ neighbours: new Map(), locate: null, captions: captionsByRef, markers, pdf, blobs: fakeBlobs() });
    expect(before.entries.map((e) => (e.status === "failed" ? e.reason : e.status))).toEqual(["ambiguous", "ambiguous"]);

    const run = await collectPdfFigures({ neighbours: new Map(), locate: answering(), captions: captionsByRef, markers, pdf, blobs: fakeBlobs() });
    expect(run.entries.map((e) => e.status)).toEqual(["stored", "stored"]);
    expect(run.located).toBe(2);
  }, 120_000);

  it("never stores the icon when the model boxes only the icon", async () => {
    /* GPT Sol, plan review of 261027e, 1: the locator's one-picture verdict
       would otherwise put back exactly what the bitmap route refused. One
       figure only: with two, both choosing the same icon are refused by the
       older rule against one picture under two captions, which would hide
       whether this one holds. */
    const only = marker(1);
    const iconOnly: FigureLocator = async () => ({ ok: true, answer: { page: 1, box_2d: box2d(111, 511, 149, 539) } });
    const run = await collectPdfFigures({
      neighbours: new Map(),
      locate: iconOnly,
      captions: new Map([[only.ref, captions[0] ?? ""]]),
      markers: [only],
      pdf: await iconDiagramsPdf(captions.slice(0, 1), 1),
      blobs: fakeBlobs(),
    });
    expect(run.locateCalls).toBe(1);
    expect(run.entries).toMatchObject([{ status: "failed", reason: "in-a-drawing" }]);
  }, 120_000);

  it("never stores an unmeasurable picture when the model boxes that picture", async () => {
    /* `unmeasured-picture` is fail-closed for the same reason as
       `in-a-drawing`. A missing clip used to disappear from the composite
       route's `pictures` list, making the whole-drawing guard see no picture
       and accept a tight rendered crop of it. */
    const only = marker(1);
    const pdf = await iconDiagramsPdf(captions.slice(0, 1), 1);
    const run = await collectPdfFigures({
      neighbours: new Map(),
      locate: async () => ({ ok: true, answer: { page: 1, box_2d: box2d(105, 505, 155, 545) } }),
      captions: new Map([[only.ref, captions[0] ?? ""]]),
      markers: [only],
      pdf,
      blobs: fakeBlobs(),
      readPdfRasters: async (input) => {
        const read = await readPdfRasters(input);
        return { ...read, paints: read.paints.map((paint) => ({ ...paint, clip: null })) };
      },
    });
    expect(run.locateCalls).toBe(1);
    expect(run.entries).toMatchObject([{ status: "failed", reason: "unmeasured-picture" }]);
  }, 120_000);

  it("refuses rather than risks a picture whose page layout cannot be read", async () => {
    const run = await collectPdfFigures({
      neighbours: new Map(),
      locate: null,
      captions: captionsByRef,
      markers,
      pdf: await iconDiagramsPdf(captions, 1),
      blobs: fakeBlobs(),
      readLayouts: async () => {
        throw new Error("pdf.js could not lay this page out");
      },
    });
    expect(run.entries).toMatchObject([
      { status: "failed", reason: "unmeasured-picture" },
      { status: "failed", reason: "unmeasured-picture" },
    ]);
  }, 120_000);
});

describe("a repeated grid of photos is still one figure under two captions", () => {
  it("refuses both, even when the two boxes differ so the renders do", async () => {
    /* GPT Sol, plan review of 261027e, 3: in a grid of six no one photo covers
       a quarter of the region, so the pictures two regions share are summed
       rather than judged one at a time. */
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const images = await Promise.all([1, 2, 3, 4, 5, 6].map(async (seed) => doc.embedPng(await photo(seed))));
    const twoCaptions = ["Fig 1. Six panels of one experiment.", "Fig 2. The same six panels, said again."];
    for (const caption of twoCaptions) {
      const page = doc.addPage([595, 842]);
      for (const y of [780, 766, 752, 380, 366, 352]) page.drawText(PROSE, { x: 60, y, size: 10, font });
      for (const [i, image] of images.entries()) {
        page.drawImage(image, { x: 100 + (i % 3) * 88, y: 500 + Math.floor(i / 3) * 64, width: 80, height: 60 });
      }
      page.drawText(caption, { x: 60, y: 470, size: 9, font });
    }
    const pdf = await doc.save();
    const both = [marker(1), marker(2)];
    const locate: FigureLocator = async (request) => {
      const first = request.subject.kind === "caption" && request.subject.caption.startsWith("Fig 1");
      return {
        ok: true,
        answer: first
          ? { page: 1, box_2d: box2d(95, 495, 365, 630) }
          : { page: 2, box_2d: box2d(90, 490, 372, 632) },
      };
    };
    const run = await collectPdfFigures({
      neighbours: new Map(),
      locate,
      captions: new Map(both.map((m, i) => [m.ref, twoCaptions[i] ?? ""])),
      markers: both,
      pdf,
      blobs: fakeBlobs(),
    });
    expect(run.entries.map((e) => e.status)).toEqual(["failed", "failed"]);
    expect(run.located).toBe(0);
  }, 120_000);
});
