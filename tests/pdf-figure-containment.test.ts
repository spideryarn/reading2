/**
 * The render-side containment check — GPT Sol F35,
 * docs/plans/260912a-figure-2-vector-figures-from-a-pdf.md § F33's fix,
 * checked narrowly. Every non-white pixel PDFium draws must fall inside what
 * the locator measured with pdf.js, or the figure is refused.
 *
 * **The operator that makes pdf.js and PDFium disagree** is `sh` given its
 * shading's name as a *string* — `(Sh0) sh` — where a name belongs. Each
 * engine's behaviour, measured on 2026-09-12 rather than assumed
 * (the probes are in the builder's report):
 *
 * - pdf.js reads `args[0].name`, gets `undefined`, and throws "No shading
 *   object found" (pdf.worker.mjs, the `shadingFill` case of the operator
 *   loop). Forgiving, it skips the operator: the page reads with no shading and
 *   no ink at the mark. The same page with `/Sh0 sh` reads with one shading.
 * - PDFium resolves the string to the shading and paints it: 1,720 dark pixels
 *   inside the mark at the render's scale, the same as with the name.
 *
 * Two candidates that do not work, and why. A `sh` naming a shading the page
 * lacks (Sol's probe) is skipped by pdf.js but **painted by nothing in
 * PDFium** either — 0 pixels — so no picture could show it. A Form XObject
 * with a malformed `/OC` is skipped by pdf.js and drawn by PDFium, but its
 * error is raised asynchronously and never lands on the chunk boundary: the
 * strict read catches it at every padding tried (476–482 pairs).
 *
 * **Sol's shape**: the bad `sh` is the page's last operator, preceded by 995
 * others — the page's 35, a two-operator clip to the mark, and 479 `q`/`Q`
 * pairs — so pdf.js flushes a full chunk just before it, the strict read
 * resolves with that chunk, and the two reads agree. That is the case this
 * check exists for.
 */
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFOperator,
  type PDFOperatorNames,
  PDFString,
  rgb,
  StandardFonts,
} from "pdf-lib";
import { describe, expect, it } from "vitest";

import { collectPdfFigures } from "../src/collect-pdf-figures.js";
import { readPdfPageLayouts } from "../src/pdf-figure-layout.js";
import { locateDrawnFigure } from "../src/pdf-figure-region.js";
import { renderPdfRegion } from "../src/pdf-figure-render.js";
import type { PutResult, RawSourceStore } from "../src/store/blobs.js";

const CAPTION = "Figure 1. A drawn test figure made of two boxes joined by a line.";
const VIEW = { width: 595, height: 842 };
/** Between the two boxes, above the line that joins them: inside the region, outside every box. */
const MARK = { x0: 286, y0: 560, x1: 294, y1: 590 };

type Extra = "none" | "mark" | "unread-shading-at-chunk-boundary";

const op = (name: string, args: Parameters<typeof PDFOperator.of>[1] = []) =>
  PDFOperator.of(name as PDFOperatorNames, args);

/** Two boxes joined by a line over one caption, and whatever `extra` adds. */
async function drawnPage(extra: Extra): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([VIEW.width, VIEW.height]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(CAPTION, { x: 72, y: 400, size: 9, font });
  page.drawRectangle({ x: 100, y: 450, width: 180, height: 150, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  page.drawRectangle({ x: 300, y: 450, width: 180, height: 150, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  page.drawLine({ start: { x: 280, y: 525 }, end: { x: 300, y: 525 }, thickness: 1, color: rgb(0, 0, 0) });
  const markSize = { width: MARK.x1 - MARK.x0, height: MARK.y1 - MARK.y0 };
  if (extra === "mark") {
    page.drawRectangle({ x: MARK.x0, y: MARK.y0, ...markSize, color: rgb(0, 0, 0) });
  } else if (extra === "unread-shading-at-chunk-boundary") {
    /* An axial shading, black end to end, which the clip confines to the mark. */
    const fn = doc.context.obj({ FunctionType: 2, Domain: [0, 1], C0: [0], C1: [0], N: 1 });
    const shading = doc.context.obj({
      ShadingType: 2,
      ColorSpace: "DeviceGray",
      Coords: [MARK.x0, MARK.y0, MARK.x1, MARK.y0],
      Function: fn,
      Extend: [true, true],
    });
    page.node
      .normalizedEntries()
      .Resources.set(PDFName.of("Shading"), doc.context.obj({ Sh0: doc.context.register(shading) }));
    page.pushOperators(
      op("re", [PDFNumber.of(MARK.x0), PDFNumber.of(MARK.y0), PDFNumber.of(markSize.width), PDFNumber.of(markSize.height)]),
      op("W"),
      op("n"),
    );
    for (let i = 0; i < 479; i++) page.pushOperators(op("q"), op("Q"));
    page.pushOperators(op("sh", [PDFString.of("Sh0")]));
  }
  return doc.save();
}

const MARKER = { ref: `pdffig1-${"0".repeat(30)}02.1.1`, page: 1, ordinal: 1 };

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

/** What the locator makes of the page, as the drawn route would ask it. */
async function located(pdf: Uint8Array) {
  const layout = (await readPdfPageLayouts({ data: pdf, pages: [1] })).get(1);
  if (!layout) throw new Error("the page did not read");
  const verdict = locateDrawnFigure({
    layout,
    caption: CAPTION,
    markersOnPage: 1,
    imageInResources: false,
    unmeasuredPaint: false,
  });
  return { layout, verdict };
}

describe("the render's paint must lie inside what was measured (Sol F35)", () => {
  it("accepts the well-formed figure, every pixel accounted for", async () => {
    const pdf = await drawnPage("none");
    const { verdict } = await located(pdf);
    if (!verdict.ok) throw new Error(`refused: ${verdict.detail}`);
    const result = await renderPdfRegion({ onePagePdf: pdf, region: verdict.region, view: VIEW, containment: verdict.containment });
    expect(result.ok).toBe(true);
  }, 60_000);

  it("refuses a real drawing with a mark outside every measured box", async () => {
    /* The mark is ordinary paint here; what makes it foreign is that the boxes
       handed to the renderer do not include it — as when pdf.js skipped it. */
    const pdf = await drawnPage("mark");
    const { verdict } = await located(await drawnPage("none"));
    if (!verdict.ok) throw new Error(`refused: ${verdict.detail}`);
    const result = await renderPdfRegion({ onePagePdf: pdf, region: verdict.region, view: VIEW, containment: verdict.containment });
    expect(result).toEqual({ ok: false, failure: "unmeasured-paint" });
  }, 60_000);

  it("refuses the page whose skipped paint both pdf.js reads agree about", async () => {
    const pdf = await drawnPage("unread-shading-at-chunk-boundary");
    const { layout, verdict } = await located(pdf);
    /* F35 reproduced: the strict read agrees, and no shading or ink is measured
       at the mark… */
    expect(layout.operators).toBe(995);
    expect(layout.strictAgrees).toBe(true);
    expect(layout.shadings).toBe(0);
    expect(layout.ink.some((b) => b.x0 < MARK.x1 && MARK.x0 < b.x1 && b.y0 < MARK.y1 && MARK.y0 < b.y1)).toBe(false);
    /* …so the locator is fooled, and only the picture can tell. */
    if (!verdict.ok) throw new Error(`refused before the render: ${verdict.detail}`);
    const result = await renderPdfRegion({ onePagePdf: pdf, region: verdict.region, view: VIEW, containment: verdict.containment });
    expect(result).toEqual({ ok: false, failure: "unmeasured-paint" });

    const blobs = fakeBlobs();
    const run = await collectPdfFigures({ markers: [MARKER], pdf, blobs, captions: new Map([[MARKER.ref, CAPTION]]) });
    expect(run.entries).toEqual([expect.objectContaining({ status: "failed", reason: "not-located" })]);
    expect(blobs.objects.size).toBe(0);
  }, 60_000);
});
