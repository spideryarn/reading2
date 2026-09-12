/**
 * src/pdf-figure-render.ts — PDFium, compiled to WebAssembly, drawing one
 * rectangle of one page onto white.
 *
 * **The lifecycle is the thing under test** (GPT Sol F5). The raw PDFium
 * interface makes us free every document, page, bitmap and `malloc` by hand,
 * and a WASM heap never shrinks: a leak on any path — the failure paths above
 * all — shows up as a heap that keeps growing from one render to the next. So
 * the heap is measured across a run that mixes successes with the two
 * failures a real document can produce, and must stop growing once warm.
 *
 * The fixture is the report's page (docs/plans/260912a-figure-2-vector-figures-from-a-pdf.md): already a one-page
 * PDF, cut with pdf-lib, which is exactly what the renderer is handed in
 * production.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { drawPdfRegionForTests, pdfiumHeapBytes, renderPdfRegion } from "../src/pdf-figure-render.js";

const MDPI_P8 = "tests/fixtures/pdf-vector-figure/entropy-24-00930-p8.pdf";
/** pdf.js's view box for that page. */
const VIEW = { width: 595.276, height: 841.89 };
/** Both lattices and their labels, as the locator finds them. */
const LATTICES = { x0: 169, y0: 470.6, x1: 509.2, y1: 746.5 };

async function page(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(MDPI_P8));
}

describe("renderPdfRegion", () => {
  it("refuses a bitmap that PDFium could not clear and releases every acquired handle", () => {
    const released: string[] = [];
    let rendered = false;
    const heap = new Uint8Array(4096);
    const pdfium = {
      pdfium: {
        HEAPU8: heap,
        _malloc: () => 32,
        _free: () => released.push("buffer"),
      },
      FPDF_LoadMemDocument: () => 101,
      FPDF_GetPageCount: () => 1,
      FPDF_LoadPage: () => 102,
      FPDF_GetPageWidthF: () => 100,
      FPDF_GetPageHeightF: () => 100,
      FPDFBitmap_CreateEx: () => 103,
      FPDFBitmap_FillRect: () => false,
      FPDF_RenderPageBitmap: () => {
        rendered = true;
      },
      FPDFBitmap_GetStride: () => 400,
      FPDFBitmap_GetBuffer: () => 512,
      FPDFBitmap_Destroy: () => released.push("bitmap"),
      FPDF_ClosePage: () => released.push("page"),
      FPDF_CloseDocument: () => released.push("document"),
    };
    expect(
      drawPdfRegionForTests(pdfium, {
        onePagePdf: Uint8Array.of(1),
        region: { x0: 10, y0: 10, x1: 90, y1: 90 },
        view: { width: 100, height: 100 },
      }),
    ).toEqual({ ok: false, failure: "render" });
    expect(rendered).toBe(false);
    expect(released).toEqual(["bitmap", "page", "document", "buffer"]);
  });

  it("releases later handles even when an earlier release throws", () => {
    const released: string[] = [];
    const pdfium = {
      pdfium: {
        HEAPU8: new Uint8Array(4096),
        _malloc: () => 32,
        _free: () => released.push("buffer"),
      },
      FPDF_LoadMemDocument: () => 101,
      FPDF_GetPageCount: () => 1,
      FPDF_LoadPage: () => 102,
      FPDF_GetPageWidthF: () => 100,
      FPDF_GetPageHeightF: () => 100,
      FPDFBitmap_CreateEx: () => 103,
      FPDFBitmap_FillRect: () => true,
      FPDF_RenderPageBitmap: () => undefined,
      FPDFBitmap_GetStride: () => 400,
      FPDFBitmap_GetBuffer: () => 512,
      FPDFBitmap_Destroy: () => {
        released.push("bitmap");
        throw new Error("destroy failed");
      },
      FPDF_ClosePage: () => released.push("page"),
      FPDF_CloseDocument: () => released.push("document"),
    };
    expect(() =>
      drawPdfRegionForTests(pdfium, {
        onePagePdf: Uint8Array.of(1),
        region: { x0: 10, y0: 10, x1: 90, y1: 90 },
        view: { width: 100, height: 100 },
      }),
    ).toThrow("destroy failed");
    expect(released).toEqual(["bitmap", "page", "document", "buffer"]);
  });

  it("draws the region onto white, at the scale its size allows", async () => {
    const result = await renderPdfRegion({ onePagePdf: await page(), region: LATTICES, view: VIEW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { raster } = result;
    expect(raster.kind).toBe("rgb");
    /* The region plus its padding, at 3× — well inside `MAX_FIGURE_EDGE`. */
    expect(raster.width / raster.height).toBeCloseTo((509.2 - 169 + 8) / (746.5 - 470.6 + 8), 1);
    expect(raster.data.some((byte) => byte !== 255), "a render that drew nothing").toBe(true);
    /* The coordinate-seam mutation this test must kill: using `y0` instead of
       `pageHeight - y1` still returns a non-white rectangle of exactly the same
       dimensions and aspect ratio, but it is unrelated page content. PDFium is
       pinned, so the raster digest is stable evidence of the actual two
       lattices and labels rather than merely evidence that something drew. */
    expect(createHash("sha256").update(raster.data).digest("hex")).toBe(
      "38061019a34a2a6744cb876dc697a433a1b00db3094312a885f072c28277e180",
    );
    /* The padding is page, and the page is white. */
    expect([...raster.data.subarray(0, 3)]).toEqual([255, 255, 255]);
  }, 60_000);

  it("refuses a page whose size PDFium and pdf.js disagree about", async () => {
    const result = await renderPdfRegion({
      onePagePdf: await page(),
      region: LATTICES,
      view: { width: VIEW.width, height: VIEW.height + 2 },
    });
    expect(result).toEqual({ ok: false, failure: "geometry-mismatch" });
  }, 60_000);

  it("keeps the heap flat across renders, failures included", async () => {
    const good = await page();
    /* Garbage behind a PDF header, rather than a truncated real file: PDFium
       repairs a truncated cross-reference table, so what a cut file opens as
       is PDFium's business, and this test needs a load that fails. */
    const corrupt = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> nonsense\n%%EOF\n");
    const offPage = { x0: 700, y0: 900, x1: 800, y1: 1000 };
    const outcomes: string[] = [];
    let warm: number | null = null;
    for (let i = 0; i < 12; i++) {
      const kind = i % 3;
      const result =
        kind === 0
          ? await renderPdfRegion({ onePagePdf: good, region: LATTICES, view: VIEW })
          : kind === 1
            ? await renderPdfRegion({ onePagePdf: good, region: offPage, view: VIEW })
            : await renderPdfRegion({ onePagePdf: corrupt, region: LATTICES, view: VIEW });
      outcomes.push(result.ok ? "ok" : result.failure);
      if (i === 2) warm = pdfiumHeapBytes();
    }
    expect(outcomes.slice(0, 3)).toEqual(["ok", "region", "load"]);
    expect(new Set(outcomes)).toEqual(new Set(["ok", "region", "load"]));
    expect(warm).toBeGreaterThan(0);
    expect(pdfiumHeapBytes()).toBe(warm);
  }, 120_000);
});
