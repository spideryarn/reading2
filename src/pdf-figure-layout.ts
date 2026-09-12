/**
 * **What is drawn where on a page** — the impure half of locating a figure
 * that is drawn rather than pictured, and the twin of `readPdfRasters` in
 * src/pdf-figure-read.ts: that one reads the bitmaps off a page, this one reads
 * the boxes, the text and the counts the rules in src/pdf-figure-region.ts
 * decide on.
 *
 * docs/plans/260912a-figure-2-vector-figures-from-a-pdf.md. The teardown and
 * the abort discipline are `readPdfRasters`' and its header gives the reasons;
 * they are not repeated here, only obeyed. What the operator list *means* — the
 * graphics state, each path's box, how far a stroke reaches — is
 * src/pdf-figure-paint.ts, a pure interpreter this file only feeds.
 *
 * ## No image is ever decoded here — and none is seen here either
 *
 * `maxImageSize: 1`. pdf.js checks an image's dictionary `/Width × /Height`
 * against `maxImageSize` **before** decoding it (src/pdf-figure-read.ts § 1)
 * and, with its default error handling, removes an image over it from the
 * operator list with a warning. So any image larger than a pixel — bitmap,
 * inline or mask — costs nothing here, and **is also invisible here**: the
 * operator list of a page with a photograph on it looks like the same page
 * without one. `imageOps` counts only what is left, a one-pixel image or a
 * solid-colour mask.
 *
 * **So this read is not what decides whether a page has an image.** pdf-lib
 * does, from the file's structure rather than from a decode: an image XObject
 * in the resources or an inline image in any content stream the page paints
 * (src/pdf-figure-page.ts). Every page the drawn route renders has been through
 * that check.
 *
 * **Why not `stopAtErrors`**, which the first version used to make the size
 * check throw. Measured 2026-09-12 against evals/pdf/harder page 3: pdf.js did
 * not reject the operator list, it resolved it **empty** — 0 operators on a
 * page of 140 text runs — because the error lands after an empty last chunk has
 * already answered the caller. A list cut short looks exactly like a page with
 * less ink on it, which is the one thing the ownership rules cannot survive, and
 * it would happen for any other recoverable error — a broken font — as well.
 * Without it, a failing operator is skipped and the rest of the page is still
 * there. tests/pdf-figure-page.test.ts holds the page to that.
 *
 * ## Annotations are left out, on both sides
 *
 * The operator list is asked for with annotations disabled, and PDFium renders
 * without `FPDF_ANNOT` (src/pdf-figure-render.ts), so neither engine's picture
 * of the page includes a link border or a stamp the other did not measure.
 */

import { loadPdfjs } from "./pdf.js";
import { interpretOperators } from "./pdf-figure-paint.js";
import type { PageLayout, PageTextItem } from "./pdf-figure-region.js";

type Pdfjs = Awaited<ReturnType<typeof loadPdfjs>>;
type PdfDocument = Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>;

export interface ReadPdfPageLayoutsInput {
  /** The whole PDF. Copied before pdf.js sees it — see `ReadPdfRastersInput.data`. */
  data: Uint8Array;
  /** 1-based. Empty means the document is never opened. */
  pages: readonly number[];
  /** The step's deadline; the same bound, and the same limit, as `readPdfRasters`'. */
  signal?: AbortSignal;
}

/**
 * The layout of each page asked for, or `null` for a page that could not be
 * read — out of range, or anything pdf.js refused outright. `null` means *not
 * eligible*, never *nothing there*. An image on the page does **not** make it
 * `null`: it is dropped unseen (see the header), and pdf-lib is what refuses
 * the page for it.
 *
 * ## Every page is read twice, and the second read is strict
 *
 * GPT Sol F33. The read the rules use is forgiving — the header says why — and
 * forgiving means a malformed operator (a `sh` naming a shading that is not
 * there, a form that will not parse) is **skipped without a word**, while
 * PDFium may still draw something for it into the crop. So every page that
 * reads is read again from a second document opened with `stopAtErrors`, and
 * `strictAgrees` is whether the two layouts are **identical**: the view box and
 * rotation, every text run, the operator and path counts, every painted box
 * with its rectangle flag, and the image, shading and unmeasured counts — the
 * whole of what the rules decide on, compared as one value. A strict read that
 * throws, or that resolves with a list cut short (which is how pdf.js reports a
 * strict error — the header's empty list), disagrees.
 *
 * Measured 2026-09-12: on the three real figure pages the two reads are
 * identical; on a page carrying a `sh` with no shading, the forgiving read has
 * 35 operators and the strict one none. It costs a second parse of the
 * document, paid only for the pages the drawn route asks about.
 *
 * Throws only when the document itself will not open, or when the signal
 * aborted — never with a partial answer an abort left behind.
 */
export async function readPdfPageLayouts(
  input: ReadPdfPageLayoutsInput,
): Promise<Map<number, PageLayout | null>> {
  const forgiving = await readLayoutsWith(input, false);
  const readable = [...forgiving].flatMap(([page, layout]) => (layout ? [page] : []));
  let strict = new Map<number, MeasuredLayout | null>();
  if (readable.length > 0) {
    try {
      strict = await readLayoutsWith({ ...input, pages: readable }, true);
    } catch {
      /* A document that will not open strictly agrees with nothing. An abort
         is not that — it is what the caller is told. */
      input.signal?.throwIfAborted();
    }
  }
  const result = new Map<number, PageLayout | null>();
  for (const [page, layout] of forgiving) {
    result.set(page, layout && { ...layout, strictAgrees: sameLayout(layout, strict.get(page)) });
  }
  return result;
}

/** A page's layout before the strict read has been compared with it. */
type MeasuredLayout = Omit<PageLayout, "strictAgrees">;

/** Identical in everything the rules read. Both sides are built by `readOneLayout`, so their shapes match. */
function sameLayout(forgiving: MeasuredLayout, strict: MeasuredLayout | null | undefined): boolean {
  return !!strict && JSON.stringify(forgiving) === JSON.stringify(strict);
}

async function readLayoutsWith(
  input: ReadPdfPageLayoutsInput,
  stopAtErrors: boolean,
): Promise<Map<number, MeasuredLayout | null>> {
  const result = new Map<number, MeasuredLayout | null>();
  const wanted = [...new Set(input.pages)].sort((a, b) => a - b);
  if (wanted.length === 0) return result;

  input.signal?.throwIfAborted();
  const data = new Uint8Array(input.data);
  const pdfjs = await loadPdfjs();
  input.signal?.throwIfAborted();

  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    /* Forgiving for the read the rules use — see the header — and strict only
       for the second read that checks it. */
    maxImageSize: 1,
    stopAtErrors,
  });
  const giveUp = () => {
    void loadingTask.destroy().catch(() => {
      /* Already giving up. */
    });
  };
  input.signal?.addEventListener("abort", giveUp, { once: true });

  let doc: PdfDocument | undefined;
  try {
    doc = await loadingTask.promise;
    for (const page of wanted) {
      input.signal?.throwIfAborted();
      if (!Number.isSafeInteger(page) || page < 1 || page > doc.numPages) {
        result.set(page, null);
        continue;
      }
      try {
        result.set(page, await readOneLayout(pdfjs, doc, page));
      } catch {
        /* An abort is not a fact about the page; everything else is. */
        input.signal?.throwIfAborted();
        result.set(page, null);
      }
    }
    /* The door `readPdfRasters` found an abort could leave by, closed the same
       way: a destroyed worker can answer an in-flight call with an empty
       result rather than an error. */
    input.signal?.throwIfAborted();
    return result;
  } catch (err) {
    input.signal?.throwIfAborted();
    throw err;
  } finally {
    input.signal?.removeEventListener("abort", giveUp);
    try {
      await doc?.cleanup?.();
    } catch {
      /* Being torn down regardless. */
    }
    try {
      await loadingTask.destroy();
    } catch {
      /* Ditto. */
    }
  }
}

async function readOneLayout(pdfjs: Pdfjs, doc: PdfDocument, pageNumber: number): Promise<MeasuredLayout> {
  const proxy = await doc.getPage(pageNumber);
  const content = await proxy.getTextContent();
  const text = textRunsFrom(content.items);
  const ops = await proxy.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE });
  const view = proxy.view;
  const paint = interpretOperators(ops.fnArray, ops.argsArray, pdfjs.OPS, view);
  return {
    view: [view[0] ?? 0, view[1] ?? 0, view[2] ?? 0, view[3] ?? 0],
    rotate: proxy.rotate,
    ink: paint.ink,
    text,
    operators: ops.fnArray.length,
    paths: paint.paths,
    imageOps: paint.imageOps,
    shadings: paint.shadings,
    unmeasuredPaint: paint.unmeasuredPaint,
  };
}

/** pdf.js's text items as runs: a string and a text matrix, or skipped. Widths and heights default to 0. */
export function textRunsFrom(items: readonly unknown[]): PageTextItem[] {
  const text: PageTextItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item)) continue;
    const run = item as { str: unknown; transform?: unknown; width?: unknown; height?: unknown };
    if (typeof run.str !== "string" || !Array.isArray(run.transform)) continue;
    text.push({
      str: run.str,
      transform: run.transform.map(Number),
      width: typeof run.width === "number" ? run.width : 0,
      height: typeof run.height === "number" ? run.height : 0,
    });
  }
  return text;
}
