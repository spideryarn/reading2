/**
 * **Drawing one rectangle of one PDF page onto white** — PDFium, Chrome's own
 * PDF engine, compiled to WebAssembly (`@embedpdf/pdfium`).
 *
 * docs/plans/260912a-figure-2-vector-figures-from-a-pdf.md, § Rendering it and
 * § The rest of the shape. This is the first thing on the server that *renders*
 * a stranger's document, and the plan's § Security says what bounds it and
 * what does not; the three rules this file keeps are the ones that section
 * leans on.
 *
 * ## 1. One page in, one region out
 *
 * The input is a **one-page PDF** (src/pdf-figure-page.ts cuts it), so PDFium
 * parses only that page and what it references. The output is **only the
 * region**, rendered at an offset into a bitmap the size of the region: a WASM
 * heap never shrinks, and the spike measured ~70 MB of RSS per *full page* at
 * 2×, so the page is never rendered whole.
 *
 * ## 2. Every handle freed, on every path
 *
 * The raw PDFium interface is C: the document, the page, the bitmap and the
 * `malloc` holding the file are ours to free, and a WASM heap that leaks keeps
 * the leak for the life of the process. So all four are released in one
 * `finally`, in reverse order of acquisition, and the failure paths go through
 * the same door as the success. tests/pdf-figure-render.test.ts renders a dozen
 * times, failures mixed in, and requires the heap to stop growing. GPT Sol F5.
 *
 * ## 3. One initialisation, one render at a time
 *
 * The module is initialised once per process — a cached *promise*, so two
 * callers share one start rather than racing to a second — and renders go
 * through a promise chain, one after another. A render is synchronous WASM and
 * cannot interleave anyway; the chain is what keeps the one `await` in front of
 * it from letting two renders hold memory at once.
 *
 * **The WASM bytes are handed in** rather than left for the loader to find:
 * its own default reads a path next to its module, which a bundler can break.
 * A wasm that is missing where it should be makes initialisation fail, and a
 * failed initialisation is a `render-failed` figure — caption-only, never a
 * wrong picture.
 *
 * **Annotations are not rendered** (no `FPDF_ANNOT`), matching the operator
 * list src/pdf-figure-layout.ts measured the page from.
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { CROP_PAD_PT, type PageBox } from "./pdf-figure-region.js";
import { classifyRaster, type DecodedRaster, MAX_FIGURE_EDGE, PDFJS_RGB_24BPP } from "./pdf-figures.js";

/**
 * At most this many pixels per point — 216 dpi, which on the three figures
 * checked by eye is crisp to the smallest brace label, and past which a figure
 * is only bigger to download. `MAX_FIGURE_EDGE` caps the longest side as well.
 */
export const MAX_RENDER_SCALE = 3;

/**
 * Points of page added round the region before it is drawn — the locator's own
 * `CROP_PAD_PT`, so that what it checked for foreign text and prose is exactly
 * what gets drawn. Its boxes come from path coordinates, which do not include a
 * stroke's width; a line along the region's edge is half outside it without
 * this.
 */
export const REGION_PAD_PT = CROP_PAD_PT;

/**
 * How far PDFium's page size may sit from pdf.js's view box, in points, before
 * the two engines are taken to disagree about the page — the plan's
 * eligibility rule 3, third half. Sol F7.
 */
export const PAGE_SIZE_TOLERANCE_PT = 0.5;

/** PDFium's `FPDFBitmap_BGRA`. */
const BITMAP_BGRA = 4;
/** PDFium's `FPDF_REVERSE_BYTE_ORDER`: the bitmap comes out RGBA rather than BGRA. */
const FPDF_REVERSE_BYTE_ORDER = 0x10;
const OPAQUE_WHITE = 0xffffffff;

/**
 * Why a render produced nothing. The caller turns these into manifest words —
 * `render-failed` for the first four, `no-raster` for a geometry the two
 * engines disagree on, `not-located` for a region that draws nothing.
 */
export type RenderFailure =
  /** The module or its WASM could not be loaded. */
  | "init"
  /** PDFium would not open the one-page PDF, or it was not one page. */
  | "load"
  /** PDFium's page size is not pdf.js's. The locator's boxes do not describe this page. */
  | "geometry-mismatch"
  /** The region, clamped to the page, has no area. A bug upstream. */
  | "region"
  /** A bitmap could not be made, or PDFium threw while drawing. */
  | "render"
  /** Every pixel is white: the region draws nothing we could show. */
  | "blank";

export type RenderResult = { ok: true; raster: DecodedRaster } | { ok: false; failure: RenderFailure };

export interface RenderRegionInput {
  /** A PDF of exactly one page. */
  onePagePdf: Uint8Array;
  /** In PDF points, origin at the bottom left — the locator's region. */
  region: PageBox;
  /** pdf.js's view box, as a width and height. Its origin is already known to be (0, 0). */
  view: { width: number; height: number };
}

/**
 * Draw `region` of the only page of `onePagePdf` onto white, as RGB.
 *
 * Never throws: every way this can go wrong is a `RenderFailure`, because one
 * bad page must no more fail the step than one bad image does.
 */
export function renderPdfRegion(input: RenderRegionInput): Promise<RenderResult> {
  const run = queue.then(() => renderNow(input));
  queue = run.catch(() => undefined);
  return run;
}

/**
 * The WASM heap's size in bytes, or `null` before the first render has
 * initialised it. For the lifecycle test; nothing in the pipeline reads it.
 */
export function pdfiumHeapBytes(): number | null {
  return loaded ? loaded.pdfium.HEAPU8.length : null;
}

/* ------------------------------------------------------------------ *
 * The module
 * ------------------------------------------------------------------ */

/**
 * The part of `@embedpdf/pdfium`'s surface this file uses, spelled here. The
 * package's own types lean on `@types/emscripten`, which this repo does not
 * carry, and would leave `HEAPU8` untyped; eleven functions are cheaper to
 * state than a dependency is to add.
 */
interface Pdfium {
  pdfium: {
    HEAPU8: Uint8Array;
    _malloc(size: number): number;
    _free(pointer: number): void;
  };
  PDFiumExt_Init(): void;
  FPDF_LoadMemDocument(pointer: number, size: number, password: string): number;
  FPDF_GetPageCount(doc: number): number;
  FPDF_LoadPage(doc: number, index: number): number;
  FPDF_GetPageWidthF(page: number): number;
  FPDF_GetPageHeightF(page: number): number;
  FPDFBitmap_CreateEx(width: number, height: number, format: number, firstScan: number, stride: number): number;
  FPDFBitmap_FillRect(bitmap: number, left: number, top: number, width: number, height: number, color: number): boolean;
  FPDF_RenderPageBitmap(
    bitmap: number,
    page: number,
    startX: number,
    startY: number,
    sizeX: number,
    sizeY: number,
    rotate: number,
    flags: number,
  ): unknown;
  FPDFBitmap_GetStride(bitmap: number): number;
  FPDFBitmap_GetBuffer(bitmap: number): number;
  FPDFBitmap_Destroy(bitmap: number): void;
  FPDF_ClosePage(page: number): void;
  FPDF_CloseDocument(doc: number): void;
}

let starting: Promise<Pdfium> | null = null;
let loaded: Pdfium | null = null;
let queue: Promise<unknown> = Promise.resolve();

/**
 * The one initialisation. A rejection stays cached: a WASM that would not load
 * once will not load the second time either, and every figure after it is a
 * `render-failed` rather than another attempt.
 */
function loadPdfium(): Promise<Pdfium> {
  starting ??= (async () => {
    /* Resolved through the package's own export, `@embedpdf/pdfium/pdfium.wasm`,
       so the path is the package's promise rather than a layout we guessed. */
    const wasmPath = createRequire(import.meta.url).resolve("@embedpdf/pdfium/pdfium.wasm");
    const wasmBinary = await readFile(wasmPath);
    /* Lazy, so that no request pays for four and a half megabytes of WASM
       unless it is about to draw a figure. */
    const { init } = await import("@embedpdf/pdfium");
    const module = (await init({ wasmBinary } as unknown as Parameters<typeof init>[0])) as unknown as Pdfium;
    module.PDFiumExt_Init();
    loaded = module;
    return module;
  })();
  return starting;
}

async function renderNow(input: RenderRegionInput): Promise<RenderResult> {
  let pdfium: Pdfium;
  try {
    pdfium = await loadPdfium();
  } catch {
    return { ok: false, failure: "init" };
  }
  try {
    return drawRegion(pdfium, input);
  } catch {
    return { ok: false, failure: "render" };
  }
}

function drawRegion(P: Pdfium, input: RenderRegionInput): RenderResult {
  const fail = (failure: RenderFailure): RenderResult => ({ ok: false, failure });
  const bytes = input.onePagePdf;
  if (bytes.byteLength === 0) return fail("load");

  let buffer = 0;
  let doc = 0;
  let page = 0;
  let bitmap = 0;
  try {
    buffer = P.pdfium._malloc(bytes.byteLength);
    if (!buffer) return fail("load");
    /* Read `HEAPU8` after the `malloc`, never before: a heap that grew to make
       room has a new buffer, and the old view is detached. */
    P.pdfium.HEAPU8.set(bytes, buffer);
    doc = P.FPDF_LoadMemDocument(buffer, bytes.byteLength, "");
    if (!doc) return fail("load");
    if (P.FPDF_GetPageCount(doc) !== 1) return fail("load");
    page = P.FPDF_LoadPage(doc, 0);
    if (!page) return fail("load");

    const pageWidth = P.FPDF_GetPageWidthF(page);
    const pageHeight = P.FPDF_GetPageHeightF(page);
    if (
      !(Math.abs(pageWidth - input.view.width) <= PAGE_SIZE_TOLERANCE_PT) ||
      !(Math.abs(pageHeight - input.view.height) <= PAGE_SIZE_TOLERANCE_PT)
    ) {
      return fail("geometry-mismatch");
    }

    const { region } = input;
    const x0 = Math.max(0, region.x0 - REGION_PAD_PT);
    const y0 = Math.max(0, region.y0 - REGION_PAD_PT);
    const x1 = Math.min(pageWidth, region.x1 + REGION_PAD_PT);
    const y1 = Math.min(pageHeight, region.y1 + REGION_PAD_PT);
    if (!(x1 - x0 >= 1 && y1 - y0 >= 1)) return fail("region");

    const scale = Math.min(MAX_RENDER_SCALE, MAX_FIGURE_EDGE / Math.max(x1 - x0, y1 - y0));
    const width = Math.min(MAX_FIGURE_EDGE, Math.max(1, Math.round((x1 - x0) * scale)));
    const height = Math.min(MAX_FIGURE_EDGE, Math.max(1, Math.round((y1 - y0) * scale)));

    bitmap = P.FPDFBitmap_CreateEx(width, height, BITMAP_BGRA, 0, 0);
    if (!bitmap) return fail("render");
    if (!P.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, OPAQUE_WHITE)) return fail("render");
    /* The whole page laid out at `scale`, shifted so the region's top-left
       corner lands on the bitmap's origin; PDFium draws only what falls inside
       the bitmap. PDF's y runs up the page and the bitmap's runs down it, hence
       `pageHeight - y1`. */
    P.FPDF_RenderPageBitmap(
      bitmap,
      page,
      -Math.round(x0 * scale),
      -Math.round((pageHeight - y1) * scale),
      Math.round(pageWidth * scale),
      Math.round(pageHeight * scale),
      0,
      FPDF_REVERSE_BYTE_ORDER,
    );

    const stride = P.FPDFBitmap_GetStride(bitmap);
    const pointer = P.FPDFBitmap_GetBuffer(bitmap);
    if (!pointer || stride < width * 4) return fail("render");
    const heap = P.pdfium.HEAPU8;
    const rgb = new Uint8Array(width * height * 3);
    let blank = true;
    for (let y = 0; y < height; y++) {
      const row = pointer + y * stride;
      for (let x = 0; x < width; x++) {
        const from = row + x * 4;
        const to = (y * width + x) * 3;
        const r = heap[from] as number;
        const g = heap[from + 1] as number;
        const b = heap[from + 2] as number;
        rgb[to] = r;
        rgb[to + 1] = g;
        rgb[to + 2] = b;
        if (blank && (r !== 255 || g !== 255 || b !== 255)) blank = false;
      }
    }
    /* Exactly white, no tolerance — the rule src/pdf-figures.ts keeps for
       blankness and for the same reason: a faint grid is still a figure. */
    if (blank) return fail("blank");

    /* Through the one door every `DecodedRaster` comes through, so nothing
       downstream has a second kind of raster to trust. */
    const verdict = classifyRaster({ page: 1, key: "drawn", width, height, kind: PDFJS_RGB_24BPP, data: rgb });
    return verdict.status === "usable" ? { ok: true, raster: verdict.raster } : fail("render");
  } finally {
    /* Reverse order of acquisition, each only if it was acquired. The document
       reads from `buffer` until it is closed, so the `free` is last. */
    try {
      if (bitmap) P.FPDFBitmap_Destroy(bitmap);
    } finally {
      try {
        if (page) P.FPDF_ClosePage(page);
      } finally {
        try {
          if (doc) P.FPDF_CloseDocument(doc);
        } finally {
          if (buffer) P.pdfium._free(buffer);
        }
      }
    }
  }
}

/** The synchronous C-handle seam, exported only so failure cleanup can be tested without WASM. */
export function drawPdfRegionForTests(pdfium: unknown, input: RenderRegionInput): RenderResult {
  return drawRegion(pdfium as Pdfium, input);
}
