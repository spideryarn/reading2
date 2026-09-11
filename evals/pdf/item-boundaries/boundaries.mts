/**
 * **What `pass0` throws away, measured without paying for anything** — the
 * pure half of the cluster N experiment. docs/plans/260911b-pdf-item-boundaries-evidence.md
 *
 * `pass0` (src/pdf.ts) builds a page's text by concatenating pdf.js text items,
 * adding a newline only where pdf.js set `hasEOL`. Where two items meet with no
 * whitespace and no marker, the boundary between them is gone from the text —
 * which is right when a font change cut a word in two, and wrong when pdf.js
 * simply failed to mark a line change: Kuhn's folio `64` from the foot of the
 * page is welded to the heading `9.5.10.` at the top, and src/pdf-score.ts §
 * `folioOffset` exists to infer it back by a document-wide vote.
 *
 * This module keeps that boundary and says what kind it was, from geometry the
 * items already carry. It never inserts a space — fonts split words into items,
 * so "no whitespace at the join" is usually correct — and the only thing it
 * will insert is a newline, where the next item is on a different line.
 *
 * `pageTextAsPass0` is pass0's own loop, restated so the experiment can run both
 * readings over the same items; tests/pdf-item-boundaries-eval.test.ts checks it
 * against pass0 itself, and `compare.mts` refuses to report a document where the
 * two disagree on any page.
 */
import { readFile } from "node:fs/promises";
import { loadPdfjs } from "../../../src/pdf.js";

/** The fields of a pdf.js `TextItem` this experiment reads — nothing more. */
export interface RawItem {
  str: string;
  hasEOL: boolean;
  /** `[a, b, c, d, e, f]`: `d` is the vertical scale (≈ font size), `e, f` the origin. */
  transform: number[];
  width: number;
  height: number;
}

/**
 * - `touching` — same line, no visible gap: a font or kerning split, usually inside a word.
 * - `gap` — same line, a visible gap the text layer has no space for.
 * - `shift` — a small vertical move: a superscript, subscript or inline maths.
 * - `line-break` — the next item is on another line, and pdf.js did not say so.
 */
export type BoundaryKind = "touching" | "gap" | "shift" | "line-break";

export interface Boundary {
  kind: BoundaryKind;
  /** The whitespace-delimited token that ends at the boundary, as pass0's text holds it. */
  left: string;
  /** The token that starts there. */
  right: string;
  /** |Δy| in units of the larger font size of the two items. */
  dy: number;
  /** Horizontal gap after the left item's end, in the same units (negative: overlap or backwards). */
  gap: number;
}

/**
 * **A move of more than this many font sizes is another line.** A superscript or
 * subscript moves about a third of the size; the tightest leading in print is
 * about one. `compare.mts` prints the distribution of every fused boundary's
 * |Δy| so this number is checked against the corpus rather than trusted.
 */
export const LINE_BREAK = 0.7;
/** Below this, a vertical move is jitter in the baseline, not a shift. */
export const SHIFT = 0.15;
/** A horizontal gap wider than this share of the font size would print as a space. */
export const GAP = 0.2;

/** Same test as src/pdf.ts § `isSideways`: more than 45° off horizontal. */
const isSideways = (t: number[]) => Math.abs(t[1] ?? 0) > Math.abs(t[0] ?? 0);

const sizeOf = (item: RawItem) => Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0) || item.height;

/** A numbered heading as a whole token — the same pattern as src/pdf-score.ts § `NUMBERED_HEADING`. */
export const NUMBERED_HEADING = /^\d+(?:\.\d+)*\.$/u;

/** pass0's page text, exactly: every upright item, a newline only for `hasEOL`, spaces collapsed, trimmed. */
export function pageTextAsPass0(items: RawItem[]): string {
  return walk(items, () => false).text;
}

/** The fused boundaries on a page — joins with no whitespace and no end-of-line between them. */
export function classify(items: RawItem[]): Boundary[] {
  return walk(items, () => false).boundaries;
}

/**
 * pass0's page text with a newline added at every `line-break` boundary, and no
 * other change. The second reading the experiment scores.
 */
export function pageTextSplitAtLineBreaks(items: RawItem[]): string {
  return walk(items, (b) => b.kind === "line-break").text;
}

/**
 * **The negative control, and the rule the plan forbids**: a newline at every
 * fused join, font splits included. `compare.mts` scores it as a third arm so
 * that "no verdict changed" under the real split is shown to be a result the
 * comparison could have failed to produce, rather than one it always produces.
 */
export function pageTextSplitAtEveryJoin(items: RawItem[]): string {
  return walk(items, () => true).text;
}

/** Numbered headings that begin at a line break pdf.js did not mark — what `folioOffset` infers by vote. */
export function headingsAtLineBreaks(items: RawItem[]): string[] {
  return classify(items)
    .filter((b) => b.kind === "line-break" && NUMBERED_HEADING.test(b.right))
    .map((b) => b.right);
}

/**
 * One loop for all four readings, so they cannot drift apart: pass0's
 * concatenation, with each fused join classified and — where `split` says so —
 * a newline put there.
 */
function walk(items: RawItem[], split: (b: Boundary) => boolean): { text: string; boundaries: Boundary[] } {
  let raw = "";
  let previous: RawItem | undefined;
  const joins: { at: number; kind: BoundaryKind; dy: number; gap: number }[] = [];
  for (const item of items) {
    if (isSideways(item.transform)) continue;
    const last = raw.at(-1);
    const first = item.str[0];
    if (previous && last !== undefined && first !== undefined && !/\s/u.test(last) && !/\s/u.test(first)) {
      const size = Math.max(sizeOf(previous), sizeOf(item)) || 1;
      const dy = Math.abs((item.transform[5] ?? 0) - (previous.transform[5] ?? 0)) / size;
      const gap = ((item.transform[4] ?? 0) - ((previous.transform[4] ?? 0) + previous.width)) / size;
      const kind: BoundaryKind = dy > LINE_BREAK ? "line-break" : dy > SHIFT ? "shift" : gap > GAP ? "gap" : "touching";
      joins.push({ at: raw.length, kind, dy: round(dy), gap: round(gap) });
    }
    raw += item.str + (item.hasEOL ? "\n" : "");
    /* Geometry comes from the last item that printed something. An empty
       end-of-line marker carries no position worth comparing, and a join after
       one is not fused anyway. */
    if (item.str.trim()) previous = item;
    else if (item.hasEOL || item.str) previous = undefined;
  }
  const boundaries = joins.map((j) => ({
    kind: j.kind,
    left: /\S*$/u.exec(raw.slice(0, j.at))![0],
    right: /^\S*/u.exec(raw.slice(j.at))![0],
    dy: j.dy,
    gap: j.gap,
  }));
  let text = raw;
  for (let i = joins.length - 1; i >= 0; i--) {
    if (split(boundaries[i]!)) text = `${text.slice(0, joins[i]!.at)}\n${text.slice(joins[i]!.at)}`;
  }
  return { text: text.replace(/[ \t]+/g, " ").trim(), boundaries };
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * **The corrupted section number a model might write** — the adversarial case
 * the 260904c postmortem says a widened rule must be tested against.
 *
 * `12.3.` → `2.3.` (a digit lost from a multi-digit component), `9.5.10.` →
 * `5.10.` (a component lost). `null` when the text does not open with a numbered
 * heading, or when there is nothing to lose (`4.`).
 */
export function truncatedHeading(text: string): string | null {
  const [head, ...rest] = text.split(" ");
  if (head === undefined || !NUMBERED_HEADING.test(head)) return null;
  const parts = head.split(".").slice(0, -1);
  const first = parts[0]!;
  const shorter =
    first.length >= 2 ? `${first.slice(1)}.${parts.slice(1).map((p) => `${p}.`).join("")}` : parts.length >= 2 ? `${parts.slice(1).join(".")}.` : null;
  return shorter === null ? null : [shorter, ...rest].join(" ");
}

/** Every page's items as pdf.js gives them, opened the way pass0 opens a file. */
export async function readRawPages(file: string): Promise<RawItem[][]> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await readFile(file)), useSystemFonts: true });
  const doc = await task.promise;
  const pages: RawItem[][] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(
        content.items.flatMap((i) =>
          "str" in i ? [{ str: i.str, hasEOL: i.hasEOL, transform: i.transform, width: i.width, height: i.height }] : [],
        ),
      );
    }
  } finally {
    await task.destroy();
  }
  return pages;
}
