/**
 * **What a page's operator list paints, and where** — the pure interpreter
 * src/pdf-figure-layout.ts runs over what pdf.js hands back, split out of it
 * (GPT Sol F34, docs/plans/260912a-figure-2-vector-figures-from-a-pdf.md) so
 * that each part can be argued with on plain arrays:
 *
 * - **graphics-state interpretation** — `save`/`restore`, the transform, form
 *   matrices and their bounding boxes, clips, line width, joins, the mitre
 *   limit, colours and the `gs` entries that change what is visible;
 * - **path and stroke measurement** — each painted path's box through the
 *   current transform and clip, whether it is one closed rectangle, and how far
 *   its stroke can reach past the box;
 * - the matrix arithmetic both lean on.
 *
 * No pdf.js here: the operator numbers come in as `PaintOpCodes`, which
 * `pdfjs.OPS` satisfies, and tests/pdf-figure-paint.test.ts drives every rule
 * with a table of its own. The behaviour is exactly the interpreter's before
 * the split; the real figures' stored dimensions and the render digest are the
 * evidence.
 */

import { CROP_PAD_PT, type InkBox, type PageBox } from "./pdf-figure-region.js";

/* ------------------------------------------------------------------ *
 * Matrices
 * ------------------------------------------------------------------ */

/** A 2D affine matrix in PDF's `[a b c d e f]` order. */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Six finite numbers, or `null`. */
export function asMatrix(value: unknown): Matrix | null {
  if (!value || typeof value !== "object" || !("length" in value)) return null;
  const list = Array.from(value as ArrayLike<unknown>);
  if (list.length !== 6 || !list.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return list as unknown as Matrix;
}

/** `a` then `b`: a point goes through `b` first, then `a` — PDF's `cm` order. */
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** The axis-aligned box of a rectangle's four corners through `m`. */
export function transformBox(m: Matrix, x0: number, y0: number, x1: number, y1: number): PageBox {
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

/** No rotation or skew, or a quarter turn: boxes stay boxes. */
export function axisAligned(m: Matrix): boolean {
  const straight = Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;
  const quarter = Math.abs(m[0]) < 1e-9 && Math.abs(m[3]) < 1e-9;
  return straight || quarter;
}

/** Largest scale of the matrix's 2×2 part (its largest singular value). */
export function maxScale(m: Matrix): number {
  const aa = m[0] * m[0] + m[1] * m[1];
  const bb = m[2] * m[2] + m[3] * m[3];
  const ab = m[0] * m[2] + m[1] * m[3];
  return Math.sqrt((aa + bb + Math.hypot(aa - bb, 2 * ab)) / 2);
}

export function intersectBox(a: PageBox | null, b: PageBox): PageBox | null {
  if (!a) return null;
  const box = {
    x0: Math.max(a.x0, b.x0),
    y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
  };
  return box.x0 <= box.x1 && box.y0 <= box.y1 ? box : null;
}

export function contains(outer: PageBox, inner: PageBox): boolean {
  return outer.x0 <= inner.x0 && outer.y0 <= inner.y0 && outer.x1 >= inner.x1 && outer.y1 >= inner.y1;
}

/* ------------------------------------------------------------------ *
 * The operator codes
 * ------------------------------------------------------------------ */

/** The pdf.js operator numbers the interpreter reads. `pdfjs.OPS` satisfies this. */
export interface PaintOpCodes {
  readonly save: number;
  readonly restore: number;
  readonly transform: number;
  readonly paintFormXObjectBegin: number;
  readonly paintFormXObjectEnd: number;
  readonly clip: number;
  readonly eoClip: number;
  readonly setLineWidth: number;
  readonly setLineJoin: number;
  readonly setMiterLimit: number;
  readonly setGState: number;
  readonly setStrokeRGBColor: number;
  readonly setFillRGBColor: number;
  readonly setStrokeTransparent: number;
  readonly setFillTransparent: number;
  readonly constructPath: number;
  readonly endPath: number;
  readonly shadingFill: number;
  readonly stroke: number;
  readonly closeStroke: number;
  readonly fill: number;
  readonly eoFill: number;
  readonly fillStroke: number;
  readonly eoFillStroke: number;
  readonly closeFillStroke: number;
  readonly closeEOFillStroke: number;
  readonly paintImageXObject: number;
  readonly paintImageXObjectRepeat: number;
  readonly paintInlineImageXObject: number;
  readonly paintInlineImageXObjectGroup: number;
  readonly paintImageMaskXObject: number;
  readonly paintImageMaskXObjectGroup: number;
  readonly paintImageMaskXObjectRepeat: number;
  readonly paintSolidColorImageMask: number;
}

/** What one page's operator list paints — the drawing half of a `PageLayout`. */
export interface PaintSummary {
  ink: InkBox[];
  paths: number;
  imageOps: number;
  shadings: number;
  unmeasuredPaint: number;
}

/* ------------------------------------------------------------------ *
 * Graphics-state interpretation
 * ------------------------------------------------------------------ */

/** The part of PDF's graphics state that decides where paint lands and whether it shows. */
export interface GraphicsState {
  ctm: Matrix;
  clip: PageBox | null;
  lineWidth: number;
  lineJoin: number;
  miterLimit: number;
  strokeColor: string;
  fillColor: string;
}

/** The state at the start of a page: identity transform, clipped to the view box. */
export function initialState(view: readonly number[]): GraphicsState {
  return {
    ctm: IDENTITY,
    clip: { x0: view[0] ?? 0, y0: view[1] ?? 0, x1: view[2] ?? 0, y1: view[3] ?? 0 },
    lineWidth: 1,
    lineJoin: 0,
    miterLimit: 10,
    strokeColor: "#000000",
    fillColor: "#000000",
  };
}

interface Run {
  codes: PaintOpCodes;
  state: GraphicsState;
  stack: GraphicsState[];
  pendingClip: boolean;
  ink: InkBox[];
  whitePaint: InkBox[];
  paths: number;
  imageOps: number;
  shadings: number;
  unmeasuredPaint: number;
}

type Args = readonly unknown[] | null | undefined;
type Handler = (run: Run, args: Args) => void;

/**
 * Walk an operator list and measure what it paints.
 *
 * One handler per operator, looked up rather than chained, so each rule is a
 * few lines that read on their own. Operators with no handler — text, marked
 * content, dependencies — change nothing measured here.
 */
export function interpretOperators(
  fnArray: ArrayLike<number>,
  argsArray: ArrayLike<unknown>,
  codes: PaintOpCodes,
  view: readonly number[],
): PaintSummary {
  const run: Run = {
    codes,
    state: initialState(view),
    stack: [],
    pendingClip: false,
    ink: [],
    whitePaint: [],
    paths: 0,
    imageOps: 0,
    shadings: 0,
    unmeasuredPaint: 0,
  };
  const handlers = handlersFor(codes);
  for (let at = 0; at < fnArray.length; at++) {
    const fn = fnArray[at];
    if (fn === undefined) continue;
    handlers.get(fn)?.(run, argsArray[at] as Args);
  }
  admitWhiteArtboards(run.ink, run.whitePaint);
  return {
    ink: run.ink,
    paths: run.paths,
    imageOps: run.imageOps,
    shadings: run.shadings,
    unmeasuredPaint: run.unmeasuredPaint,
  };
}

function handlersFor(codes: PaintOpCodes): Map<number, Handler> {
  const countImage: Handler = (run) => {
    run.imageOps += 1;
  };
  return new Map<number, Handler>([
    [codes.save, save],
    [codes.restore, restore],
    [codes.transform, transform],
    [codes.paintFormXObjectBegin, beginForm],
    [codes.paintFormXObjectEnd, restore],
    [codes.clip, markClip],
    [codes.eoClip, markClip],
    [codes.setLineWidth, (run, args) => setNumber(run, "lineWidth", lineWidthFrom(args?.[0]))],
    [codes.setLineJoin, (run, args) => setNumber(run, "lineJoin", lineJoinFrom(args?.[0]))],
    [codes.setMiterLimit, (run, args) => setNumber(run, "miterLimit", miterLimitFrom(args?.[0]))],
    [codes.setGState, setGState],
    [codes.setStrokeRGBColor, (run, args) => setColor(run, "strokeColor", args?.[0])],
    [codes.setFillRGBColor, (run, args) => setColor(run, "fillColor", args?.[0])],
    [codes.setStrokeTransparent, (run) => setTransparent(run, "strokeColor")],
    [codes.setFillTransparent, (run) => setTransparent(run, "fillColor")],
    [codes.constructPath, constructPath],
    [
      codes.shadingFill,
      (run) => {
        run.shadings += 1;
      },
    ],
    [codes.paintImageXObject, countImage],
    [codes.paintImageXObjectRepeat, countImage],
    [codes.paintInlineImageXObject, countImage],
    [codes.paintInlineImageXObjectGroup, countImage],
    [codes.paintImageMaskXObject, countImage],
    [codes.paintImageMaskXObjectGroup, countImage],
    [codes.paintImageMaskXObjectRepeat, countImage],
    [codes.paintSolidColorImageMask, countImage],
  ]);
}

function save(run: Run): void {
  run.stack.push({ ...run.state });
}

function restore(run: Run): void {
  const saved = run.stack.pop();
  if (saved) run.state = saved;
}

function transform(run: Run, args: Args): void {
  const m = asMatrix(args);
  if (m) run.state.ctm = multiply(run.state.ctm, m);
}

/**
 * `[matrix | null, bbox | null]` in v6 — the form's own matrix, and it is the
 * only one to apply: a transparency group's `beginGroup` carries the same
 * matrix for its clip, and applying both would double it (pdf.mjs
 * `beginGroup`, read 2026-09-12). The form's bounding box is a clip.
 */
function beginForm(run: Run, args: Args): void {
  save(run);
  transform(run, args?.[0] as Args);
  const bbox = boxFrom(args?.[1]);
  if (bbox === undefined) return;
  if (bbox && axisAligned(run.state.ctm)) {
    run.state.clip = intersectBox(run.state.clip, transformBox(run.state.ctm, ...bbox));
  } else run.unmeasuredPaint += 1;
}

/** Four numbers from an array-like: `undefined` when absent, `null` when present and unusable. */
function boxFrom(value: unknown): [number, number, number, number] | null | undefined {
  if (!value || typeof value !== "object" || !("length" in value)) return undefined;
  if ((value as ArrayLike<unknown>).length < 4) return undefined;
  const [x0, y0, x1, y1] = Array.from(value as ArrayLike<number>);
  const box = [x0, y0, x1, y1];
  return box.every(Number.isFinite) ? (box as [number, number, number, number]) : null;
}

function markClip(run: Run): void {
  run.pendingClip = true;
}

type NumericParam = "lineWidth" | "lineJoin" | "miterLimit";

/** Set a stroke parameter, or count the operator as paint we cannot measure. */
function setNumber(run: Run, key: NumericParam, value: number | null): void {
  if (value === null) run.unmeasuredPaint += 1;
  else run.state[key] = value;
}

export function lineWidthFrom(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.abs(value) : null;
}

export function lineJoinFrom(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2 ? value : null;
}

export function miterLimitFrom(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * A `gs` operator: its stroke parameters are applied, and anything that makes
 * visibility differ from the path boxes — zero alpha, a soft mask, a blend
 * mode — counts the page as unmeasured. In particular an alpha-zero path could
 * otherwise bridge two disconnected drawings in geometry while PDFium paints no
 * bridge at all. Entries are read in order and the first unmeasurable one stops
 * the reading, as it always has.
 */
function setGState(run: Run, args: Args): void {
  const entries = args?.[0];
  if (!Array.isArray(entries) || entries.some((entry) => gStateEntryUnmeasured(run.state, entry))) {
    run.unmeasuredPaint += 1;
  }
}

/** Apply one `[key, value]` of a `gs`; `true` if it cannot be measured. */
export function gStateEntryUnmeasured(state: GraphicsState, entry: unknown): boolean {
  if (!Array.isArray(entry)) return true;
  const [key, value] = entry as [unknown, unknown];
  const param = STROKE_PARAMS[key as string];
  if (param) {
    const parsed = param.parse(value);
    if (parsed === null) return true;
    state[param.key] = parsed;
  }
  return changesVisibility(key, value);
}

const STROKE_PARAMS: Record<string, { key: NumericParam; parse: (value: unknown) => number | null }> = {
  LW: { key: "lineWidth", parse: lineWidthFrom },
  LJ: { key: "lineJoin", parse: lineJoinFrom },
  ML: { key: "miterLimit", parse: miterLimitFrom },
};

/** A `gs` entry after which what shows is no longer the path boxes. */
export function changesVisibility(key: unknown, value: unknown): boolean {
  if (key === "CA" || key === "ca") return !(typeof value === "number") || value <= 0;
  if (key === "SMask") return value != null;
  if (key === "BM") return value !== "source-over" && value !== "Normal";
  return false;
}

function setColor(run: Run, key: "strokeColor" | "fillColor", color: unknown): void {
  if (typeof color !== "string") run.unmeasuredPaint += 1;
  else run.state[key] = color.toLowerCase();
}

function setTransparent(run: Run, key: "strokeColor" | "fillColor"): void {
  run.state[key] = "transparent";
  run.unmeasuredPaint += 1;
}

/* ------------------------------------------------------------------ *
 * Path and stroke measurement
 * ------------------------------------------------------------------ */

/**
 * `[paintOp, [path], minMax]`. `endPath` is the paint op of a path that only
 * set a clip — `W n` — and paints nothing; a pending clip is applied to the
 * path whatever its paint.
 */
function constructPath(run: Run, args: Args): void {
  run.paths += 1;
  const box = pathBox(run.state.ctm, args?.[2]);
  if (!box) {
    if (run.pendingClip) {
      run.unmeasuredPaint += 1;
      run.pendingClip = false;
    }
    return;
  }
  const buffer = (args?.[1] as unknown[] | undefined)?.[0];
  const rect = isRectangle(buffer, run.state.ctm);
  if (args?.[0] !== run.codes.endPath) recordPaint(run, args?.[0], box, rect, buffer);
  if (run.pendingClip) {
    if (rect && axisAligned(run.state.ctm)) run.state.clip = intersectBox(run.state.clip, box);
    else run.unmeasuredPaint += 1;
    run.pendingClip = false;
  }
}

/**
 * pdf.js's `minMax` through the current transform, or `null` for a path with
 * no finite point — pdf.js leaves its min/max at ±Infinity — or none at all.
 */
export function pathBox(ctm: Matrix, minMax: unknown): PageBox | null {
  if (!minMax || typeof minMax !== "object" || !("length" in minMax)) return null;
  const list = minMax as ArrayLike<number>;
  if (list.length < 4) return null;
  const [x0, y0, x1, y1] = [list[0], list[1], list[2], list[3]] as number[];
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  return transformBox(ctm, x0 as number, y0 as number, x1 as number, y1 as number);
}

/**
 * Where a painted path goes: visible ink, a white path (kept aside — see
 * `admitWhiteArtboards`), or nowhere. A visible stroke that can reach past
 * the renderer's padding counts the page as unmeasured.
 */
function recordPaint(run: Run, paint: unknown, box: PageBox, rect: boolean, buffer: unknown): void {
  const { state, codes } = run;
  const fillIsUsed = fills(paint, codes);
  const strokeIsUsed = strokes(paint, codes);
  const visible = isVisible(state, fillIsUsed, strokeIsUsed);
  if (visible && strokeIsUsed && strokeReach(state, buffer) > CROP_PAD_PT) run.unmeasuredPaint += 1;
  if (visible) pushClipped(run.ink, state.clip, box, rect);
  else if ((fillIsUsed || strokeIsUsed) && state.fillColor !== "transparent" && state.strokeColor !== "transparent") {
    pushClipped(run.whitePaint, state.clip, box, rect);
  }
}

/** Paint in a colour that shows on PDFium's white page. */
export function isVisible(state: GraphicsState, fillIsUsed: boolean, strokeIsUsed: boolean): boolean {
  const shows = (color: string) => color !== "#ffffff" && color !== "transparent";
  return (fillIsUsed && shows(state.fillColor)) || (strokeIsUsed && shows(state.strokeColor));
}

/**
 * How far past the path's box its stroke can reach, in points. The locator's
 * path bounds exclude the stroke; the largest singular value is an upper
 * bound on how the transform scales the line width.
 */
export function strokeReach(state: GraphicsState, buffer: unknown): number {
  const radius = (state.lineWidth * maxScale(state.ctm)) / 2;
  return radius * strokeExtentFactor(buffer, state.lineJoin, state.miterLimit);
}

function pushClipped(list: InkBox[], clip: PageBox | null, box: PageBox, rect: boolean): void {
  const visible = intersectBox(clip, box);
  if (visible) list.push(rect ? { ...visible, rect: true } : visible);
}

/**
 * A white path is normally invisible on PDFium's white page, so it cannot join
 * ownership components. A filled white artboard enclosing several visible paths
 * is the exception: exported diagrams use one as their canvas (the arXiv p3
 * fixture does), and its box is useful, bounded ownership geometry. A skinny
 * invisible bridge encloses neither endpoint and stays out. An artboard
 * admitted earlier counts towards a later one, as it always has.
 */
export function admitWhiteArtboards(ink: InkBox[], whitePaint: readonly InkBox[]): void {
  for (const white of whitePaint) {
    if (ink.filter((box) => contains(white, box)).length >= 2) ink.push(white);
  }
}

export function strokes(paint: unknown, O: PaintOpCodes): boolean {
  return (
    paint === O.stroke ||
    paint === O.closeStroke ||
    paint === O.fillStroke ||
    paint === O.eoFillStroke ||
    paint === O.closeFillStroke ||
    paint === O.closeEOFillStroke
  );
}

export function fills(paint: unknown, O: PaintOpCodes): boolean {
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
export function isRectangle(buffer: unknown, ctm: Matrix): boolean {
  if (!buffer || typeof buffer !== "object" || !("length" in buffer)) return false;
  if (!ctm.every(Number.isFinite) || Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]) < 1e-12) return false;
  const corners = rectangleCorners(Array.from(buffer as ArrayLike<number>));
  if (!corners) return false;
  const [p0, p1, p2, p3] = corners;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  const horizontalFirst = near(p0[1], p1[1]) && near(p1[0], p2[0]) && near(p2[1], p3[1]) && near(p3[0], p0[0]);
  const verticalFirst = near(p0[0], p1[0]) && near(p1[1], p2[1]) && near(p2[0], p3[0]) && near(p3[1], p0[1]);
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  return (horizontalFirst || verticalFirst) && area > 0;
}

type Point = readonly [number, number];

/** The four corners of a moveTo-and-lineTos path that closes on itself, or `null`. */
function rectangleCorners(ops: readonly number[]): [Point, Point, Point, Point] | null {
  const points: Point[] = [];
  let closed = false;
  for (let at = 0; at < ops.length; ) {
    const op = ops[at];
    if ((op === 0 && at === 0) || op === 1) {
      points.push([ops[at + 1] as number, ops[at + 2] as number]);
      at += 3;
    } else if (op === 4 && at === ops.length - 1) {
      closed = true;
      at += 1;
    } else return null;
  }
  const [p0, p1, p2, p3, p4] = points;
  if (!p0 || !p1 || !p2 || !p3 || points.length > 5) return null;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  if (points.length === 5 && !(p4 && near(p4[0], p0[0]) && near(p4[1], p0[1]))) return null;
  if (points.length === 4 && !closed) return null;
  return [p0, p1, p2, p3];
}

/* ------------------------------------------------------------------ *
 * How far a stroke reaches
 * ------------------------------------------------------------------ */

type Segment = { start: Point; end: Point; startTangent: Point; endTangent: Point };
type Subpath = { segments: Segment[]; closed: boolean };

/**
 * Maximum stroke extension in multiples of its radius. Round/square caps and
 * bevel/round joins fit inside √2. A miter can be longer, but only at the
 * actual joins in this path; using the graphics state's worst case for every
 * path rejects ordinary one-point diagram strokes. A path we cannot read is
 * given the worst case, the mitre limit.
 */
export function strokeExtentFactor(buffer: unknown, lineJoin: number, miterLimit: number): number {
  if (lineJoin !== 0) return Math.SQRT2;
  if (!buffer || typeof buffer !== "object" || !("length" in buffer)) return miterLimit;
  const subpaths = pathSubpaths(Array.from(buffer as ArrayLike<number>));
  return subpaths ? largestMiter(subpaths, miterLimit) : miterLimit;
}

/** A path under construction: the finished subpaths and the one being drawn. */
interface PathBuilder {
  subpaths: Subpath[];
  segments: Segment[];
  current: Point | null;
  first: Point | null;
}

/** pdf.js's path buffer as subpaths of segments with their end tangents, or `null` if malformed. */
export function pathSubpaths(values: readonly number[]): Subpath[] | null {
  const path: PathBuilder = { subpaths: [], segments: [], current: null, first: null };
  for (let at = 0; at < values.length; ) {
    const op = values[at++];
    const step = PATH_STEPS[op as number];
    const next = step ? step(path, values, at) : null;
    if (next === null) return null;
    at = next;
  }
  finishSubpath(path, false);
  return path.subpaths;
}

type PathStep = (path: PathBuilder, values: readonly number[], at: number) => number | null;

const PATH_STEPS: Record<number, PathStep> = {
  /* moveTo */
  0: (path, values, at) => {
    finishSubpath(path, false);
    const point = pointAt(values, at);
    if (!point) return null;
    path.current = point;
    path.first = point;
    return at + 2;
  },
  /* lineTo */
  1: (path, values, at) => {
    const end = pointAt(values, at);
    if (!path.current || !end) return null;
    const tangent = subtract(end, path.current);
    addSegment(path, end, tangent, tangent);
    return at + 2;
  },
  /* curveTo */
  2: (path, values, at) => {
    const [c1, c2, end] = [pointAt(values, at), pointAt(values, at + 2), pointAt(values, at + 4)];
    const current = path.current;
    if (!current || !c1 || !c2 || !end) return null;
    addSegment(path, end, nonzeroTangent(current, c1, c2, end), nonzeroTangent(c2, end, current, end));
    return at + 6;
  },
  /* quadraticCurveTo */
  3: (path, values, at) => {
    const [control, end] = [pointAt(values, at), pointAt(values, at + 2)];
    const current = path.current;
    if (!current || !control || !end) return null;
    addSegment(path, end, nonzeroTangent(current, control, end), nonzeroTangent(control, end, current));
    return at + 4;
  },
  /* closePath */
  4: (path, _values, at) => {
    const { current, first } = path;
    if (!current || !first) return null;
    if (current[0] !== first[0] || current[1] !== first[1]) {
      const tangent = subtract(first, current);
      addSegment(path, first, tangent, tangent);
    }
    finishSubpath(path, true);
    return at;
  },
};

function finishSubpath(path: PathBuilder, closed: boolean): void {
  if (path.segments.length > 0) path.subpaths.push({ segments: path.segments, closed });
  path.segments = [];
  path.current = null;
  path.first = null;
}

function addSegment(path: PathBuilder, end: Point, startTangent: Point, endTangent: Point): void {
  if (!path.current) return;
  path.segments.push({ start: path.current, end, startTangent, endTangent });
  path.current = end;
}

/** The largest mitre over every join in every subpath — a closed one joins its last segment to its first. */
function largestMiter(subpaths: readonly Subpath[], miterLimit: number): number {
  let factor = Math.SQRT2;
  for (const { segments, closed } of subpaths) {
    for (let i = 1; i < segments.length; i++) {
      factor = Math.max(factor, miterFactor(segments[i - 1]?.endTangent, segments[i]?.startTangent, miterLimit));
    }
    if (closed && segments.length > 1) {
      factor = Math.max(factor, miterFactor(segments.at(-1)?.endTangent, segments[0]?.startTangent, miterLimit));
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

/** The mitre length of one join in multiples of the stroke radius; √2 when PDF would bevel it. */
export function miterFactor(incoming: Point | undefined, outgoing: Point | undefined, limit: number): number {
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
