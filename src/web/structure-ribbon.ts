/**
 * **The ribbon between Structure's two columns: where it goes, as numbers.**
 *
 * Column B is the inside of the row marked in column A, and until 2026-10-20
 * the only things that said so were a 2px rule down B's left edge and a matching
 * 2px inset on the marked row, 16px apart with nothing joining them. Greg asked
 * for it to read *"kinda like a Sankey diagram"* (spya-vqpeyr), so the space
 * between the columns now carries one band whose left end is the marked row's
 * height and whose right end is the height of everything column B draws: one
 * row becoming all of that.
 *
 * Pure, so it can be tested without a layout engine: `StructurePanel` reads the
 * rects and draws the path; this decides nothing about what is current.
 * docs/plans/261020l-structure-columns-sankey-ribbon.md.
 */

/** The part of a `DOMRect` the ribbon reads. */
export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * **How far left of column B's rows the ribbon's edge stands**, in px: its own
 * 2px (`STRUCT_BRACKET_PX`) and a 2px gap, so the edge never touches a row's
 * wash. structure-mode.css puts the current section's orange thumb at the same
 * place (`left: -4px`) so it covers the edge; tests/structure-ribbon.test.tsx
 * holds the two together.
 *
 * Inside column B's track, in the 0.6rem bracket inset the band's width
 * arithmetic already pays for, rather than in a wider gutter: the curve gets
 * ~24px instead of 16 and the switch to two columns does not move. A 2rem
 * gutter was built first and moved it to 1181px, one pixel past an 11-inch
 * iPad held landscape (GPT Sol's plan review, finding 5).
 */
export const RIBBON_EDGE_INSET_PX = 4;

/** The ribbon in the grid's own coordinates, px from its top-left corner. */
export interface Ribbon {
  /** Where the marked row in column A ends. */
  x0: number;
  /** Where the band ends and column B's edge begins. */
  xEdge: number;
  aTop: number;
  aBottom: number;
  bTop: number;
  bBottom: number;
}

/**
 * The ribbon, or `null` when there is nothing for it to join.
 *
 * - `row` is the marked row in column A; none means the reader is between parts.
 * - `head` is column B's header (the part's title), when there is one; the
 *   ribbon starts there, because that header is the part again.
 * - `list` is column B's visible list, its counters included; none means the
 *   part has no sections, and column B is a sentence rather than the inside of
 *   anything.
 *
 * Anything that is not a real shape inside the grid gives `null` too — jsdom,
 * a first frame before layout, a band mid-close. A ribbon from zero-height or
 * reversed rects would be drawn as nothing, or as something wrong, and claim to
 * be drawn.
 */
export function ribbonFrom(
  grid: Box,
  row: Box | null,
  head: Box | null,
  list: Box | null,
): Ribbon | null {
  if (!row || !list) return null;
  const all = [grid, row, list, ...(head ? [head] : [])];
  if (!all.every((b) => [b.top, b.bottom, b.left, b.right].every(Number.isFinite))) return null;
  if (!all.every((b) => b.bottom > b.top && b.right > b.left)) return null;
  /* DOM rects can disagree by a fraction at a shared edge. More than one pixel
     outside the grid is not rounding: it is a stale or mismatched endpoint. */
  const insideGrid = (b: Box) =>
    b.top >= grid.top - 1 &&
    b.bottom <= grid.bottom + 1 &&
    b.left >= grid.left - 1 &&
    b.right <= grid.right + 1;
  if (![row, list, ...(head ? [head] : [])].every(insideGrid)) return null;
  const x0 = row.right - grid.left;
  const xEdge = list.left - RIBBON_EDGE_INSET_PX - grid.left;
  if (x0 < 0 || xEdge <= x0) return null;
  return {
    x0,
    xEdge,
    aTop: Math.max(grid.top, row.top) - grid.top,
    aBottom: Math.min(grid.bottom, row.bottom) - grid.top,
    bTop: Math.max(grid.top, Math.min((head ?? list).top, list.top)) - grid.top,
    bBottom: Math.min(grid.bottom, list.bottom) - grid.top,
  };
}

/** Whole pixels, so a sub-pixel jitter in a rect is not a redraw. */
export function sameRibbon(a: Ribbon | null, b: Ribbon | null): boolean {
  if (a === null || b === null) return a === b;
  const k: (keyof Ribbon)[] = ["x0", "xEdge", "aTop", "aBottom", "bTop", "bBottom"];
  return k.every((key) => Math.round(a[key]) === Math.round(b[key]));
}

/**
 * The band's outline: across the top on one S-curve, down column B's edge,
 * and back on another. The control points sit halfway across at each end's own
 * height, which is the curve a Sankey link is drawn with, so both ends leave
 * their column horizontally.
 */
export function ribbonPath(r: Ribbon): string {
  const xm = (r.x0 + r.xEdge) / 2;
  const n = (v: number) => Math.round(v * 10) / 10;
  return [
    `M ${n(r.x0)} ${n(r.aTop)}`,
    `C ${n(xm)} ${n(r.aTop)} ${n(xm)} ${n(r.bTop)} ${n(r.xEdge)} ${n(r.bTop)}`,
    `L ${n(r.xEdge)} ${n(r.bBottom)}`,
    `C ${n(xm)} ${n(r.bBottom)} ${n(xm)} ${n(r.aBottom)} ${n(r.x0)} ${n(r.aBottom)}`,
    "Z",
  ].join(" ");
}
