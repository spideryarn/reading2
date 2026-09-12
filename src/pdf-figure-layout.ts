/**
 * **What is drawn where on a page** — the impure half of locating a figure
 * that is drawn rather than pictured, and the twin of `readPdfRasters` in
 * src/pdf-figure-read.ts: that one reads the bitmaps off a page, this one reads
 * the boxes, the text and the counts the rules in src/pdf-figure-region.ts
 * decide on.
 *
 * docs/plans/260912a-figure-2-vector-figures-from-a-pdf.md. The teardown and
 * the abort discipline are `readPdfRasters`' and its header gives the reasons;
 * they are not repeated here, only obeyed.
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
import { CROP_PAD_PT, type PageBox, type PageLayout, type PageTextItem } from "./pdf-figure-region.js";

type Pdfjs = Awaited<ReturnType<typeof loadPdfjs>>;
type PdfDocument = Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>;

/** A 2D affine matrix in PDF's `[a b c d e f]` order. */
type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

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
 * Throws only when the document itself will not open, or when the signal
 * aborted — never with a partial answer an abort left behind.
 */
export async function readPdfPageLayouts(
  input: ReadPdfPageLayoutsInput,
): Promise<Map<number, PageLayout | null>> {
  const result = new Map<number, PageLayout | null>();
  const wanted = [...new Set(input.pages)].sort((a, b) => a - b);
  if (wanted.length === 0) return result;

  input.signal?.throwIfAborted();
  const data = new Uint8Array(input.data);
  const pdfjs = await loadPdfjs();
  input.signal?.throwIfAborted();

  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    /* Deliberately **without** `stopAtErrors` — see the header. */
    maxImageSize: 1,
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

async function readOneLayout(pdfjs: Pdfjs, doc: PdfDocument, pageNumber: number): Promise<PageLayout> {
  const proxy = await doc.getPage(pageNumber);
  const content = await proxy.getTextContent();
  const text: PageTextItem[] = [];
  for (const item of content.items) {
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

  const ops = await proxy.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE });
  const O = pdfjs.OPS;
  const imageOperators = new Set<number>([
    O.paintImageXObject,
    O.paintImageXObjectRepeat,
    O.paintInlineImageXObject,
    O.paintInlineImageXObjectGroup,
    O.paintImageMaskXObject,
    O.paintImageMaskXObjectGroup,
    O.paintImageMaskXObjectRepeat,
    O.paintSolidColorImageMask,
  ]);

  const ink: (PageBox & { rect?: boolean })[] = [];
  const whitePaint: (PageBox & { rect?: boolean })[] = [];
  let paths = 0;
  let imageOps = 0;
  let shadings = 0;
  let unmeasuredPaint = 0;
  const view = proxy.view;
  let ctm: Matrix = IDENTITY;
  let lineWidth = 1;
  let lineJoin = 0;
  let miterLimit = 10;
  let strokeColor = "#000000";
  let fillColor = "#000000";
  let clip: PageBox | null = {
    x0: view[0] ?? 0,
    y0: view[1] ?? 0,
    x1: view[2] ?? 0,
    y1: view[3] ?? 0,
  };
  const stack: {
    ctm: Matrix;
    clip: PageBox | null;
    lineWidth: number;
    lineJoin: number;
    miterLimit: number;
    strokeColor: string;
    fillColor: string;
  }[] = [];
  let pendingClip = false;
  for (let at = 0; at < ops.fnArray.length; at++) {
    const fn = ops.fnArray[at];
    const args = ops.argsArray[at] as unknown[] | null | undefined;
    if (fn === O.save) stack.push({ ctm, clip, lineWidth, lineJoin, miterLimit, strokeColor, fillColor });
    else if (fn === O.restore) {
      const saved = stack.pop();
      if (saved) ({ ctm, clip, lineWidth, lineJoin, miterLimit, strokeColor, fillColor } = saved);
    }
    else if (fn === O.transform) {
      const m = asMatrix(args);
      if (m) ctm = multiply(ctm, m);
    } else if (fn === O.paintFormXObjectBegin) {
      /* `[matrix | null, bbox | null]` in v6 — the form's own matrix, and it is
         the only one to apply: a transparency group's `beginGroup` carries the
         same matrix for its clip, and applying both would double it (pdf.mjs
         `beginGroup`, read 2026-09-12). */
      stack.push({ ctm, clip, lineWidth, lineJoin, miterLimit, strokeColor, fillColor });
      const m = asMatrix(args?.[0]);
      if (m) ctm = multiply(ctm, m);
      const bbox = args?.[1];
      if (bbox && typeof bbox === "object" && "length" in bbox && (bbox as ArrayLike<unknown>).length >= 4) {
        const [x0, y0, x1, y1] = Array.from(bbox as ArrayLike<number>);
        if ([x0, y0, x1, y1].every(Number.isFinite) && axisAligned(ctm)) {
          clip = intersectBox(clip, transformBox(ctm, x0 as number, y0 as number, x1 as number, y1 as number));
        } else unmeasuredPaint += 1;
      }
    } else if (fn === O.paintFormXObjectEnd) {
      const saved = stack.pop();
      if (saved) ({ ctm, clip, lineWidth, lineJoin, miterLimit, strokeColor, fillColor } = saved);
    } else if (fn === O.clip || fn === O.eoClip) pendingClip = true;
    else if (fn === O.setLineWidth) {
      const width = args?.[0];
      if (typeof width === "number" && Number.isFinite(width)) lineWidth = Math.abs(width);
      else unmeasuredPaint += 1;
    } else if (fn === O.setLineJoin) {
      const join = args?.[0];
      if (typeof join === "number" && Number.isInteger(join) && join >= 0 && join <= 2) lineJoin = join;
      else unmeasuredPaint += 1;
    } else if (fn === O.setMiterLimit) {
      const limit = args?.[0];
      if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) miterLimit = limit;
      else unmeasuredPaint += 1;
    }
    else if (fn === O.setGState) {
      const states = args?.[0];
      if (
        !Array.isArray(states) ||
        states.some((state) => {
          if (!Array.isArray(state)) return true;
          const [key, value] = state;
          if (key === "LW") {
            if (typeof value === "number" && Number.isFinite(value)) lineWidth = Math.abs(value);
            else return true;
          } else if (key === "LJ") {
            if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2) lineJoin = value;
            else return true;
          } else if (key === "ML") {
            if (typeof value === "number" && Number.isFinite(value) && value > 0) miterLimit = value;
            else return true;
          }
          return (
            ((key === "CA" || key === "ca") && (!(typeof value === "number") || value <= 0)) ||
            (key === "SMask" && value != null) ||
            (key === "BM" && value !== "source-over" && value !== "Normal")
          );
        })
      ) {
        /* Visibility can differ from the path boxes below. In particular an
           alpha-zero path can otherwise bridge two disconnected drawings in
           geometry while PDFium paints no bridge at all. */
        unmeasuredPaint += 1;
      }
    } else if (fn === O.setStrokeRGBColor || fn === O.setFillRGBColor) {
      const color = args?.[0];
      if (typeof color !== "string") unmeasuredPaint += 1;
      else if (fn === O.setStrokeRGBColor) strokeColor = color.toLowerCase();
      else fillColor = color.toLowerCase();
    } else if (fn === O.setStrokeTransparent || fn === O.setFillTransparent) {
      if (fn === O.setStrokeTransparent) strokeColor = "transparent";
      else fillColor = "transparent";
      unmeasuredPaint += 1;
    }
    else if (fn === O.constructPath) {
      paths += 1;
      /* `[paintOp, [path], minMax]`. `endPath` is the paint op of a path that
         only set a clip — `W n` — and paints nothing. */
      const paint = args?.[0];
      const minMax = args?.[2] as ArrayLike<number> | null | undefined;
      if (!minMax || minMax.length < 4) {
        if (pendingClip) {
          unmeasuredPaint += 1;
          pendingClip = false;
        }
        continue;
      }
      const [x0, y0, x1, y1] = [minMax[0], minMax[1], minMax[2], minMax[3]] as number[];
      /* A path with no finite point has nowhere to be; pdf.js leaves its
         min/max at ±Infinity. */
      if (![x0, y0, x1, y1].every(Number.isFinite)) {
        if (pendingClip) {
          unmeasuredPaint += 1;
          pendingClip = false;
        }
        continue;
      }
      const box = transformBox(ctm, x0 as number, y0 as number, x1 as number, y1 as number);
      const rect = isRectangle((args?.[1] as unknown[] | undefined)?.[0], ctm);
      if (paint !== O.endPath) {
        const fillIsUsed = fills(paint, O);
        const strokeIsUsed = strokes(paint, O);
        const visiblePaint =
          (fillIsUsed && fillColor !== "#ffffff" && fillColor !== "transparent") ||
          (strokeIsUsed && strokeColor !== "#ffffff" && strokeColor !== "transparent");
        if (visiblePaint && strokeIsUsed) {
          /* The locator's path bounds exclude the stroke. A stroke extending
             beyond the renderer's fixed padding would be cropped, so it is an
             unmeasured page rather than a partial figure. Frobenius norm is a
             conservative upper bound on the transform's largest scale. */
          const strokeRadius = (lineWidth * maxScale(ctm)) / 2;
          const joinExtent =
            strokeRadius * strokeExtentFactor((args?.[1] as unknown[] | undefined)?.[0], lineJoin, miterLimit);
          if (joinExtent > CROP_PAD_PT) unmeasuredPaint += 1;
        }
        if (visiblePaint) {
          const visible = intersectBox(clip, box);
          if (visible) ink.push(rect ? { ...visible, rect: true } : visible);
        } else if (
          (fillIsUsed || strokeIsUsed) &&
          fillColor !== "transparent" &&
          strokeColor !== "transparent"
        ) {
          const visible = intersectBox(clip, box);
          if (visible) whitePaint.push(rect ? { ...visible, rect: true } : visible);
        }
      }
      if (pendingClip) {
        if (rect && axisAligned(ctm)) clip = intersectBox(clip, box);
        else unmeasuredPaint += 1;
        pendingClip = false;
      }
    } else if (fn === O.shadingFill) shadings += 1;
    else if (fn !== undefined && imageOperators.has(fn)) imageOps += 1;
  }

  /* A white path is normally invisible on PDFium's white page, so it cannot
     join ownership components. A filled white artboard enclosing several
     visible paths is the exception: exported diagrams use one as their canvas
     (the arXiv p3 fixture does), and its box is useful, bounded ownership
     geometry. A skinny invisible bridge encloses neither endpoint and stays
     out. */
  for (const white of whitePaint) {
    if (ink.filter((box) => contains(white, box)).length >= 2) ink.push(white);
  }

  return {
    view: [view[0] ?? 0, view[1] ?? 0, view[2] ?? 0, view[3] ?? 0],
    rotate: proxy.rotate,
    ink,
    text,
    operators: ops.fnArray.length,
    paths,
    imageOps,
    shadings,
    unmeasuredPaint,
  };
}

function strokes(paint: unknown, O: Pdfjs["OPS"]): boolean {
  return (
    paint === O.stroke ||
    paint === O.closeStroke ||
    paint === O.fillStroke ||
    paint === O.eoFillStroke ||
    paint === O.closeFillStroke ||
    paint === O.closeEOFillStroke
  );
}

function fills(paint: unknown, O: Pdfjs["OPS"]): boolean {
  return (
    paint === O.fill ||
    paint === O.eoFill ||
    paint === O.fillStroke ||
    paint === O.eoFillStroke ||
    paint === O.closeFillStroke ||
    paint === O.closeEOFillStroke
  );
}

/**
 * Is this path one closed rectangle — `re`, or `m l l l h` round four
 * corners? Its transformed axis-aligned bounds are deliberately conservative:
 * treating text anywhere in those bounds as boxed can refuse a rotated box,
 * while dropping the flag can admit a boxed equation into the crop.
 *
 * Read off pdf.js's own path buffer (`DrawOPS`: moveTo 0, lineTo 1, closePath
 * 4; pdf.worker.mjs `buildPath`, read 2026-09-12), which is how `re` arrives
 * too: moveTo and three lineTos round the corners, then a closePath. A fourth
 * lineTo back to the start is accepted in place of, or as well as, the close.
 * What this is for: a boxed equation, a sidebar or a callout is drawn with one
 * of these, and src/pdf-figure-region.ts refuses a separate drawing that is
 * nothing but one with text inside it.
 */
function isRectangle(buffer: unknown, ctm: Matrix): boolean {
  if (!buffer || typeof buffer !== "object" || !("length" in buffer)) return false;
  const ops = Array.from(buffer as ArrayLike<number>);
  if (!ctm.every(Number.isFinite) || Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]) < 1e-12) return false;
  const points: [number, number][] = [];
  let at = 0;
  let closed = false;
  while (at < ops.length) {
    const op = ops[at];
    if (op === 0 && at === 0) {
      points.push([ops[at + 1] as number, ops[at + 2] as number]);
      at += 3;
    } else if (op === 1) {
      points.push([ops[at + 1] as number, ops[at + 2] as number]);
      at += 3;
    } else if (op === 4 && at === ops.length - 1) {
      closed = true;
      at += 1;
    } else return false;
  }
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  const [p0, p1, p2, p3, p4] = points;
  if (!p0 || !p1 || !p2 || !p3 || points.length > 5) return false;
  if (points.length === 5 && !(p4 && near(p4[0], p0[0]) && near(p4[1], p0[1]))) return false;
  if (points.length === 4 && !closed) return false;
  const horizontalFirst = near(p0[1], p1[1]) && near(p1[0], p2[0]) && near(p2[1], p3[1]) && near(p3[0], p0[0]);
  const verticalFirst = near(p0[0], p1[0]) && near(p1[1], p2[1]) && near(p2[0], p3[0]) && near(p3[1], p0[1]);
  const xs = [p0[0], p1[0], p2[0], p3[0]];
  const ys = [p0[1], p1[1], p2[1], p3[1]];
  const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  return (horizontalFirst || verticalFirst) && area > 0;
}

function asMatrix(value: unknown): Matrix | null {
  if (!value || typeof value !== "object" || !("length" in value)) return null;
  const list = Array.from(value as ArrayLike<unknown>);
  if (list.length !== 6 || !list.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return list as unknown as Matrix;
}

/** `a` then `b`: a point goes through `b` first, then `a` — PDF's `cm` order. */
function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function transformBox(m: Matrix, x0: number, y0: number, x1: number, y1: number): PageBox {
  const corners = [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ].map(([x = 0, y = 0]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] as const);
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function axisAligned(m: Matrix): boolean {
  const straight = Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;
  const quarter = Math.abs(m[0]) < 1e-9 && Math.abs(m[3]) < 1e-9;
  return straight || quarter;
}

/** Largest scale of the matrix's 2×2 part (its largest singular value). */
function maxScale(m: Matrix): number {
  const aa = m[0] * m[0] + m[1] * m[1];
  const bb = m[2] * m[2] + m[3] * m[3];
  const ab = m[0] * m[2] + m[1] * m[3];
  return Math.sqrt((aa + bb + Math.hypot(aa - bb, 2 * ab)) / 2);
}

type Point = readonly [number, number];
type Segment = { start: Point; end: Point; startTangent: Point; endTangent: Point };

/**
 * Maximum stroke extension in multiples of its radius. Round/square caps and
 * bevel/round joins fit inside √2. A miter can be longer, but only at the
 * actual joins in this path; using the graphics state's worst case for every
 * path rejects ordinary one-point diagram strokes.
 */
function strokeExtentFactor(buffer: unknown, lineJoin: number, miterLimit: number): number {
  if (lineJoin !== 0) return Math.SQRT2;
  if (!buffer || typeof buffer !== "object" || !("length" in buffer)) return miterLimit;
  const values = Array.from(buffer as ArrayLike<number>);
  const subpaths: { segments: Segment[]; closed: boolean }[] = [];
  let segments: Segment[] = [];
  let current: Point | null = null;
  let first: Point | null = null;
  const finish = (closed: boolean): void => {
    if (segments.length > 0) subpaths.push({ segments, closed });
    segments = [];
    current = null;
    first = null;
  };
  const add = (end: Point, startTangent: Point, endTangent: Point): void => {
    if (!current) return;
    segments.push({ start: current, end, startTangent, endTangent });
    current = end;
  };

  for (let at = 0; at < values.length;) {
    const op = values[at++];
    if (op === 0) {
      finish(false);
      const point = pointAt(values, at);
      if (!point) return miterLimit;
      current = first = point;
      at += 2;
    } else if (op === 1) {
      const end = pointAt(values, at);
      if (!current || !end) return miterLimit;
      const tangent = subtract(end, current);
      add(end, tangent, tangent);
      at += 2;
    } else if (op === 2) {
      const control1 = pointAt(values, at);
      const control2 = pointAt(values, at + 2);
      const end = pointAt(values, at + 4);
      if (!current || !control1 || !control2 || !end) return miterLimit;
      add(end, nonzeroTangent(current, control1, control2, end), nonzeroTangent(control2, end, current, end));
      at += 6;
    } else if (op === 3) {
      const control = pointAt(values, at);
      const end = pointAt(values, at + 2);
      if (!current || !control || !end) return miterLimit;
      add(end, nonzeroTangent(current, control, end), nonzeroTangent(control, end, current));
      at += 4;
    } else if (op === 4) {
      if (!current || !first) return miterLimit;
      if (current[0] !== first[0] || current[1] !== first[1]) {
        const tangent = subtract(first, current);
        add(first, tangent, tangent);
      }
      finish(true);
    } else return miterLimit;
  }
  finish(false);

  let factor = Math.SQRT2;
  for (const path of subpaths) {
    for (let i = 1; i < path.segments.length; i++) {
      factor = Math.max(factor, miterFactor(path.segments[i - 1]?.endTangent, path.segments[i]?.startTangent, miterLimit));
    }
    if (path.closed && path.segments.length > 1) {
      factor = Math.max(
        factor,
        miterFactor(path.segments.at(-1)?.endTangent, path.segments[0]?.startTangent, miterLimit),
      );
    }
  }
  return factor;
}

function pointAt(values: readonly number[], at: number): Point | null {
  const x = values[at];
  const y = values[at + 1];
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function subtract(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1]];
}

function nonzeroTangent(...points: Point[]): Point {
  for (let i = 1; i < points.length; i++) {
    const tangent = subtract(points[i] as Point, points[i - 1] as Point);
    if (tangent[0] !== 0 || tangent[1] !== 0) return tangent;
  }
  return [0, 0];
}

function miterFactor(incoming: Point | undefined, outgoing: Point | undefined, limit: number): number {
  if (!incoming || !outgoing) return Math.SQRT2;
  const inLength = Math.hypot(...incoming);
  const outLength = Math.hypot(...outgoing);
  if (inLength === 0 || outLength === 0) return Math.SQRT2;
  const cosInterior = Math.max(
    -1,
    Math.min(1, (-incoming[0] * outgoing[0] - incoming[1] * outgoing[1]) / (inLength * outLength)),
  );
  const sinHalf = Math.sqrt((1 - cosInterior) / 2);
  const miter = sinHalf === 0 ? Number.POSITIVE_INFINITY : 1 / sinHalf;
  /* PDF bevels the join when the requested miter exceeds the limit. */
  return miter <= limit ? miter : Math.SQRT2;
}

function intersectBox(a: PageBox | null, b: PageBox): PageBox | null {
  if (!a) return null;
  const box = {
    x0: Math.max(a.x0, b.x0),
    y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
  };
  return box.x0 <= box.x1 && box.y0 <= box.y1 ? box : null;
}

function contains(outer: PageBox, inner: PageBox): boolean {
  return outer.x0 <= inner.x0 && outer.y0 <= inner.y0 && outer.x1 >= inner.x1 && outer.y1 >= inner.y1;
}
