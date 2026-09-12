/**
 * **One page of a PDF, on its own, and whether any image hides in it** — the
 * pdf-lib half of recovering a figure that is drawn rather than pictured.
 *
 * docs/plans/260912a-figure-2-vector-figures-from-a-pdf.md. Two jobs, because
 * they want the same parse:
 *
 * 1. **The cut.** PDFium is handed one page, never the document, so the second
 *    parser sees only that page and what it references, and its WASM heap is
 *    bounded by a page rather than by a 50 MiB upload. The cutting is
 *    `openPdfCuts` (src/pdf-read.ts) — the seam stage 2 already uses, its
 *    lazy import and its deterministic save included — not a second copy of it.
 * 2. **The image check, and it is the only one.** The plan's eligibility rule
 *    2 and Sol F2: an image the bitmap route declined is never handed to a
 *    second decoder. pdf.js cannot answer it — it *removes* an image over its
 *    size cap from the operator list rather than reporting it
 *    (src/pdf-figure-read.ts § 1), and the layout read sets that cap at one
 *    pixel so it never decodes one (src/pdf-figure-layout.ts). So the answer
 *    comes from the file's structure instead, which is there whether anybody
 *    decoded it or not: an image XObject in the resources, or an **inline**
 *    image — `BI … ID … EI` — in any content stream the page paints, which is
 *    the one kind the resources cannot show.
 *
 * The walk reads the **cut** page rather than the source's. `copyPages` moves a
 * page's inherited resources onto the page itself, so the cut's `/Resources`
 * is everything the page can paint — and it is exactly the thing PDFium will be
 * handed, which is the property that matters.
 */

/* Type-only, so it is erased: pdf-lib itself is imported lazily below. */
import type { PDFDict as PdfDict } from "pdf-lib";

import { openPdfCuts } from "./pdf-read.js";

/**
 * How deep the walk follows Form XObjects, tiling patterns, Type 3 fonts and
 * soft masks inside one another. A real figure nests two or three deep; past
 * this, the answer is "an image may be in there", because the walk could not
 * prove otherwise.
 */
export const MAX_RESOURCE_DEPTH = 8;

/**
 * The most decoded bytes of one content stream the inline-image scan will read.
 * A page's content is tens or hundreds of kilobytes — the report's page is
 * 1,382 operators — so 32 MiB is far outside anything real, and a stream that
 * inflates past it is answered "may hold an image" rather than read to the end.
 */
export const MAX_CONTENT_SCAN_BYTES = 32 * 1024 * 1024;

/**
 * The inline-image operator as a token: `BI` between PDF whitespace or
 * delimiters. PDF whitespace includes NUL, which JavaScript's `\s` does not;
 * omitting it lets a valid NUL-delimited inline image pass this refusal. Loose
 * on purpose — a string that happens to spell ` BI ` is a refused page, never
 * a missed image.
 */
const PDF_TOKEN_BOUNDARY = String.raw`[\x00\x09\x0a\x0c\x0d\x20()[\]{}<>/%]`;
const INLINE_IMAGE = new RegExp(`(?:^|${PDF_TOKEN_BOUNDARY})BI(?=${PDF_TOKEN_BOUNDARY})`);

export interface FigurePage {
  /** A one-page PDF of this page alone. */
  bytes: Uint8Array;
  /**
   * An image — XObject or inline — anywhere this page's content reaches, or
   * something the walk could not see to the bottom of. `true` is *not
   * eligible*.
   */
  imageInResources: boolean;
  /** Reachable paint (currently a Type 3 glyph program) absent from pdf.js's path list. */
  unmeasuredPaint: boolean;
}

export interface FigurePages {
  /** 1-based. Not to be called concurrently — `PdfCuts.cut` says why. */
  cut(page: number): Promise<FigurePage>;
}

/** Parse the source once; cut pages out of that parse on demand. */
export async function openFigurePages(source: Uint8Array): Promise<FigurePages> {
  const cuts = await openPdfCuts(source);
  return {
    async cut(page) {
      const bytes = await cuts.cut([page]);
      return { bytes, ...(await inspectOnePage(bytes)) };
    },
  };
}

/**
 * Does the only page of this PDF paint an image — an image XObject reached
 * through its resources, or an inline image in its content or in any content it
 * paints?
 *
 * **Every doubt is a yes.** A malformed dictionary, an entry of the wrong type,
 * a filter pdf-lib cannot decode, a stream past `MAX_CONTENT_SCAN_BYTES`, a
 * nesting past `MAX_RESOURCE_DEPTH`, pdf-lib refusing the file: none of them
 * proves the page has no image, so none of them may let it through.
 */
export async function onePageHasImage(onePage: Uint8Array): Promise<boolean> {
  return (await inspectOnePage(onePage)).imageInResources;
}

async function inspectOnePage(
  onePage: Uint8Array,
): Promise<Pick<FigurePage, "imageInResources" | "unmeasuredPaint">> {
  /* Lazy, for the reason `openPdfCuts` gives: pdf-lib is not a cost any
     request should pay unless it cuts a page. Node caches the module. */
  const { PDFArray, PDFDocument, PDFDict, PDFName, PDFRawStream, PDFStream, decodePDFRawStream } = await import(
    "pdf-lib"
  );
  try {
    const doc = await PDFDocument.load(onePage);
    if (doc.getPageCount() !== 1) return { imageInResources: true, unmeasuredPaint: true };
    const context = doc.context;
    const name = (n: string) => PDFName.of(n);
    const seen = new Set<unknown>();
    let unmeasuredPaint = false;
    const resolve = (value: unknown) => context.lookup(value as Parameters<typeof context.lookup>[0]);

    /** The dictionary of a stream, or the dictionary itself, or nothing. */
    const dictOf = (value: unknown): PdfDict | undefined => {
      const resolved = resolve(value);
      if (resolved instanceof PDFStream) return resolved.dict;
      if (resolved instanceof PDFDict) return resolved;
      return undefined;
    };

    /**
     * Does this logical content stream contain an inline image? A page's
     * `/Contents` array is concatenated by PDF readers, so scan it as one byte
     * sequence too: recovery parsers can recognise a token split at an invalid
     * stream boundary, and doubt must still refuse the page. Unreadable or over
     * the cap is a yes.
     */
    const paintsInlineSequence = (values: readonly unknown[]): boolean => {
      const chunks: Buffer[] = [];
      let total = 0;
      for (const value of values) {
        const stream = resolve(value);
        if (!(stream instanceof PDFRawStream)) return true;
        const remaining = MAX_CONTENT_SCAN_BYTES - total;
        const decoded = decodePDFRawStream(stream).getBytes(remaining + 1);
        if (decoded.length > remaining) return true;
        const chunk = Buffer.from(decoded.buffer, decoded.byteOffset, decoded.byteLength);
        chunks.push(chunk);
        total += chunk.byteLength;
      }
      return INLINE_IMAGE.test(Buffer.concat(chunks, total).toString("latin1"));
    };
    const paintsInline = (value: unknown): boolean => paintsInlineSequence([value]);

    const walk = (resources: PdfDict | undefined, depth: number): boolean => {
      if (!resources) return false;
      if (depth > MAX_RESOURCE_DEPTH) return true;
      if (seen.has(resources)) return false;
      seen.add(resources);

      const xobjects = resources.lookupMaybe(name("XObject"), PDFDict);
      for (const value of xobjects?.asMap().values() ?? []) {
        const dict = dictOf(value);
        if (!dict) return true;
        const subtype = dict.lookupMaybe(name("Subtype"), PDFName);
        if (subtype === name("Image")) return true;
        if (subtype !== name("Form")) return true;
        if (paintsInline(value)) return true;
        if (walk(dict.lookupMaybe(name("Resources"), PDFDict), depth + 1)) return true;
      }

      /* A tiling pattern is a little content stream of its own, and can paint an image. */
      const patterns = resources.lookupMaybe(name("Pattern"), PDFDict);
      for (const value of patterns?.asMap().values() ?? []) {
        const resolved = resolve(value);
        if (!(resolved instanceof PDFStream)) return true;
        if (paintsInline(value)) return true;
        if (walk(resolved.dict.lookupMaybe(name("Resources"), PDFDict), depth + 1)) return true;
      }

      /* So is every glyph of a Type 3 font. */
      const fonts = resources.lookupMaybe(name("Font"), PDFDict);
      for (const value of fonts?.asMap().values() ?? []) {
        const dict = dictOf(value);
        if (!dict) return true;
        const subtype = dict.lookupMaybe(name("Subtype"), PDFName);
        if (!subtype) return true;
        if (subtype !== name("Type3")) continue;
        /* pdf.js renders a Type 3 CharProc internally but does not put its
           vector paths in the page's operator list. PDFium would therefore
           draw ink the ownership and complexity rules never measured. */
        unmeasuredPaint = true;
        const glyphs = dict.lookupMaybe(name("CharProcs"), PDFDict);
        for (const glyph of glyphs?.asMap().values() ?? []) if (paintsInline(glyph)) return true;
        if (walk(dict.lookupMaybe(name("Resources"), PDFDict), depth + 1)) return true;
      }

      /* And a soft mask is a Form XObject painted as a mask. */
      const states = resources.lookupMaybe(name("ExtGState"), PDFDict);
      for (const value of states?.asMap().values() ?? []) {
        const state = dictOf(value);
        if (!state) return true;
        const smaskValue = state.get(name("SMask"));
        if (!smaskValue || resolve(smaskValue) === name("None")) continue;
        const smask = dictOf(smaskValue);
        if (!smask) return true;
        const groupRef = smask?.get(name("G"));
        const group = groupRef && dictOf(groupRef);
        if (!groupRef || !group) return true;
        if (paintsInline(groupRef)) return true;
        if (walk(group.lookupMaybe(name("Resources"), PDFDict), depth + 1)) return true;
      }
      return false;
    };

    const page = doc.getPage(0).node;
    const contents = page.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    const imageInResources = paintsInlineSequence(streams) || walk(page.Resources(), 0);
    return { imageInResources, unmeasuredPaint };
  } catch {
    return { imageInResources: true, unmeasuredPaint: true };
  }
}
