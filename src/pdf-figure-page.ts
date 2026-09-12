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
 * **The rules of that walk are src/pdf-figure-resources.ts**, pure, over a lazy
 * tree; this file is only the adapter that reads pdf-lib's dictionaries into
 * it (GPT Sol F34). Every read is a function the walk calls when it gets there,
 * so the first doubt still answers and nothing after it is read.
 *
 * The walk reads the **cut** page rather than the source's. `copyPages` moves a
 * page's inherited resources onto the page itself, so the cut's `/Resources`
 * is everything the page can paint — and it is exactly the thing PDFium will be
 * handed, which is the property that matters.
 */

/* Type-only, so they are erased: pdf-lib itself is imported lazily below. */
import type { PDFContext, PDFDict as PdfDict } from "pdf-lib";

import {
  type Content,
  type FontEntry,
  inspectPageTree,
  type PageInspection,
  type PaintedEntry,
  type ResourceNode,
  type XObjectEntry,
} from "./pdf-figure-resources.js";
import { openPdfCuts } from "./pdf-read.js";

export { MAX_RESOURCE_DEPTH } from "./pdf-figure-resources.js";

/**
 * The most decoded bytes of one content stream the inline-image scan will read.
 * A page's content is tens or hundreds of kilobytes — the report's page is
 * 1,382 operators — so 32 MiB is far outside anything real, and a stream that
 * inflates past it is answered "may hold an image" rather than read to the end.
 */
export const MAX_CONTENT_SCAN_BYTES = 32 * 1024 * 1024;

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

const DOUBT: PageInspection = { imageInResources: true, unmeasuredPaint: true };

async function inspectOnePage(onePage: Uint8Array): Promise<PageInspection> {
  /* Lazy, for the reason `openPdfCuts` gives: pdf-lib is not a cost any
     request should pay unless it cuts a page. Node caches the module. */
  const lib = await import("pdf-lib");
  try {
    const doc = await lib.PDFDocument.load(onePage);
    if (doc.getPageCount() !== 1) return DOUBT;
    const reader = pdfLibReader(lib, doc.context);
    const page = doc.getPage(0).node;
    return inspectPageTree({
      contents: () => reader.decodeSequence(reader.contentStreams(page.Contents())),
      resources: () => reader.node(page.Resources()),
    });
  } catch {
    /* A throw anywhere in the reading — a dictionary of the wrong type, a
       filter pdf-lib cannot decode — proves nothing about the page. */
    return DOUBT;
  }
}

type PdfLib = typeof import("pdf-lib");

/** pdf-lib's objects, read into the walk's lazy tree. */
function pdfLibReader(lib: PdfLib, context: PDFContext) {
  const { PDFArray, PDFDict, PDFName, PDFRawStream, PDFStream, decodePDFRawStream } = lib;
  const name = (n: string) => PDFName.of(n);
  const resolve = (value: unknown) => context.lookup(value as Parameters<typeof context.lookup>[0]);

  /** The dictionary of a stream, or the dictionary itself, or nothing. */
  const dictOf = (value: unknown): PdfDict | undefined => {
    const resolved = resolve(value);
    if (resolved instanceof PDFStream) return resolved.dict;
    if (resolved instanceof PDFDict) return resolved;
    return undefined;
  };

  /**
   * One logical content stream's decoded bytes, or `null` when a part is not a
   * stream or the whole runs past `MAX_CONTENT_SCAN_BYTES`. A page's
   * `/Contents` array is concatenated by PDF readers, so it is decoded as one
   * byte sequence: a token split at a stream boundary is still found.
   */
  const decodeSequence = (values: readonly unknown[]): Uint8Array | null => {
    const chunks: Buffer[] = [];
    let total = 0;
    for (const value of values) {
      const stream = resolve(value);
      if (!(stream instanceof PDFRawStream)) return null;
      const remaining = MAX_CONTENT_SCAN_BYTES - total;
      const decoded = decodePDFRawStream(stream).getBytes(remaining + 1);
      if (decoded.length > remaining) return null;
      chunks.push(Buffer.from(decoded.buffer, decoded.byteOffset, decoded.byteLength));
      total += decoded.byteLength;
    }
    return Buffer.concat(chunks, total);
  };
  const content = (value: unknown): Content => () => decodeSequence([value]);

  const contentStreams = (contents: unknown): unknown[] =>
    contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];

  const entriesOf = (resources: PdfDict, key: string): unknown[] => [
    ...(resources.lookupMaybe(name(key), PDFDict)?.asMap().values() ?? []),
  ];
  const resourcesOf = (dict: PdfDict) => (): ResourceNode | undefined =>
    node(dict.lookupMaybe(name("Resources"), PDFDict));

  const xobjectEntry = (value: unknown): XObjectEntry => {
    const dict = dictOf(value);
    if (!dict) return { kind: "unclassified" };
    const subtype = dict.lookupMaybe(name("Subtype"), PDFName);
    if (subtype === name("Image")) return { kind: "image" };
    if (subtype !== name("Form")) return { kind: "unclassified" };
    return { kind: "form", content: content(value), resources: resourcesOf(dict) };
  };

  /* A tiling pattern is a little content stream of its own, and can paint an image. */
  const patternEntry = (value: unknown): PaintedEntry => {
    const resolved = resolve(value);
    if (!(resolved instanceof PDFStream)) return { kind: "unreadable" };
    return { kind: "painted", content: content(value), resources: resourcesOf(resolved.dict) };
  };

  /* So is every glyph of a Type 3 font. */
  const fontEntry = (value: unknown): FontEntry => {
    const dict = dictOf(value);
    if (!dict) return { kind: "unclassified" };
    const subtype = dict.lookupMaybe(name("Subtype"), PDFName);
    if (!subtype) return { kind: "unclassified" };
    if (subtype !== name("Type3")) return { kind: "other" };
    return {
      kind: "type3",
      glyphs: () => [...(dict.lookupMaybe(name("CharProcs"), PDFDict)?.asMap().values() ?? [])].map(content),
      resources: resourcesOf(dict),
    };
  };

  /* And a soft mask is a Form XObject painted as a mask. */
  const softMaskEntry = (value: unknown): PaintedEntry => {
    const state = dictOf(value);
    if (!state) return { kind: "unreadable" };
    const smaskValue = state.get(name("SMask"));
    if (!smaskValue || resolve(smaskValue) === name("None")) return { kind: "none" };
    const smask = dictOf(smaskValue);
    const groupRef = smask?.get(name("G"));
    const group = groupRef && dictOf(groupRef);
    if (!groupRef || !group) return { kind: "unreadable" };
    return { kind: "painted", content: content(groupRef), resources: resourcesOf(group) };
  };

  const node = (resources: PdfDict | undefined): ResourceNode | undefined =>
    resources && {
      id: resources,
      xobjects: () => entriesOf(resources, "XObject").map((value) => () => xobjectEntry(value)),
      patterns: () => entriesOf(resources, "Pattern").map((value) => () => patternEntry(value)),
      fonts: () => entriesOf(resources, "Font").map((value) => () => fontEntry(value)),
      softMasks: () => entriesOf(resources, "ExtGState").map((value) => () => softMaskEntry(value)),
    };

  return { decodeSequence, contentStreams, node };
}
