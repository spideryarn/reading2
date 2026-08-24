/**
 * Choosing which columns to show, and how wide — the pure half of "§ fitting".
 *
 * Kept out of App.tsx so it can be tested without a DOM: every number below is
 * checkable arithmetic, and the worked examples in
 * granularity-zoom.md#too-many-levels are the test cases.
 *
 * The problem, from that doc: minimum widths plus horizontal scrolling works,
 * but on any laptop it leaves a column permanently buried under the pinned
 * prose — three gist columns and the reading column come to 70rem, so a 1000px
 * window is short before you have done anything, and scrolling to a column you
 * can never see all of is not really an answer. So the view chooses.
 *
 * Two rules carry it:
 *
 *  - **Shrink first, drop second.** Gists squeeze from a comfortable 15rem down
 *    to 11rem before any level is given up.
 *  - **Give up the coarse levels first.** They are what the spine already
 *    shows; the finest gist is the one that earns its place beside the
 *    paragraph it summarises. So L0 goes, then L1.
 *
 * The detail column — prose in reading mode, the leaf column in outline mode —
 * takes whatever is left, so the table fills the window exactly when it can and
 * overflows by a known amount when it can't. Knowing that amount is what lets
 * TableView draw the pinned ends as a layer only when something is actually
 * underneath them, rather than guessing from a viewport breakpoint.
 */

/** px at a 16px root. Mirrors --spine-w in styles.css; change both together. */
const SPINE_FULL = 208; // 13rem
const SPINE_NARROW = 24; // 1.5rem

/**
 * Below this the spine's labels cost more width than they are worth and it
 * collapses to ticks. "Where am I" is exactly as useful on a small screen;
 * the words are what stops being affordable.
 */
const SPINE_LABELS_MIN_WINDOW = 1100;

const GIST_IDEAL = 240; // 15rem — comfortable for a one-sentence gist
const GIST_MIN = 176; // 11rem — the narrowest a gist still reads at
const PROSE_MIN = 544; // 34rem — the narrowest the reading column may be

export type SpineMode = "full" | "narrow" | "off";

export interface Layout {
  /** Explicit pixel widths, one per rendered column, in render order. */
  widths: number[];
  /** The table's own width — the sum of `widths`. */
  tableW: number;
  /**
   * Whether the table is wider than the room it has. The view knows this
   * exactly, because it chose the width.
   */
  overflowing: boolean;
}

export interface Fit extends Layout {
  /** Column depths to render, coarse to fine. Includes the leaf in outline mode. */
  columns: number[];
  spine: SpineMode;
  /** What `.reader` needs as an inline min-width so the sticky bars have range. */
  minWidth: number;
}

export function spineWidth(mode: SpineMode): number {
  return mode === "full" ? SPINE_FULL : mode === "narrow" ? SPINE_NARROW : 0;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface FitInput {
  windowWidth: number;
  /** Every gist depth this article has: 0 … leafDepth-1. */
  gistDepths: number[];
  leafDepth: number;
  showText: boolean;
  /**
   * The depths the reader picked, or `null` for automatic.
   *
   * A manual choice is honoured exactly, including one that doesn't fit —
   * "the window should not quietly overrule a choice you made". Automatic is
   * free to drop coarse levels.
   */
  chosen: number[] | null;
}

export function fitView({
  windowWidth,
  gistDepths,
  leafDepth,
  showText,
  chosen,
}: FitInput): Fit {
  // Outline mode has no prose; the leaf column is the detail column, and it
  // holds nav labels rather than paragraphs, so it needs far less room.
  const detailMin = showText ? PROSE_MIN : GIST_IDEAL;

  /** How many gist columns survive auto-fit in `avail` px. */
  const gistsThatFit = (avail: number) => {
    let n = gistDepths.length;
    while (n > 1 && n * GIST_MIN + detailMin > avail) n--;
    return n;
  };

  /**
   * In outline mode the table *is* a whole-article overview, so a bird's-eye
   * rail beside it would be a second copy of the same thing; the space goes
   * back to the columns instead.
   *
   * Otherwise the labels are affordable only when they cost nothing. The rail
   * widening from 1.5rem to 13rem eats 184px, which at some widths is exactly a
   * gist column — and a pure width threshold then makes the fit
   * **non-monotonic**: at 1099px you got three columns and at 1100px one, so
   * widening the window *removed* two levels of context. Whatever the right
   * trade between labels and columns is, "wider window, less article" is not
   * it, so the labels wait until they are free. In practice that is ~1280px for
   * a three-level tree.
   */
  const spine: SpineMode = !showText
    ? "off"
    : windowWidth >= SPINE_LABELS_MIN_WINDOW &&
        (chosen !== null ||
          gistsThatFit(windowWidth - SPINE_FULL) ===
            gistsThatFit(windowWidth - SPINE_NARROW))
      ? "full"
      : "narrow";
  const avail = Math.max(0, windowWidth - spineWidth(spine));

  let gists =
    chosen === null
      ? [...gistDepths]
      : gistDepths.filter((d) => chosen.includes(d));

  /**
   * The leaf column — one nav label per paragraph — beside the prose.
   *
   * Greg, 2026-08-25: "I really like the Outline 1-sentence-paragraphs. But I
   * also always want to be able to see the full text." In outline mode the leaf
   * column is the whole point and is always on; this is the same column, kept
   * when the text comes back, so reading mode contains everything outline mode
   * had *plus* the article.
   *
   * Opt-in only — never chosen by auto-fit — because it costs a column's width
   * and most reading doesn't want it. And note it does not breach the navLabel
   * contract (granularity-zoom.md#node-shape): a nav label must never be shown
   * *instead of* prose that could be displayed, and here the prose is right
   * beside it. Annotation, not substitution.
   */
  const leafBesideText = showText && (chosen?.includes(leafDepth) ?? false);

  if (chosen === null) {
    // Drop the coarsest first, and never the last one: a single gist beside the
    // prose is the point of the view, so we overflow rather than lose it.
    gists = gists.slice(gists.length - gistsThatFit(avail));
  }

  // Fixed-width columns: the gists, plus the leaf column when it is riding
  // alongside the prose rather than standing in for it.
  const fixedCount = gists.length + (leafBesideText ? 1 : 0);
  const gistW =
    fixedCount === 0
      ? 0
      : clamp(Math.floor((avail - detailMin) / fixedCount), GIST_MIN, GIST_IDEAL);
  const detailW = Math.max(detailMin, avail - fixedCount * gistW);

  const widths = [...Array<number>(fixedCount).fill(gistW), detailW];
  const tableW = widths.reduce((a, b) => a + b, 0);

  return {
    columns: showText
      ? leafBesideText
        ? [...gists, leafDepth]
        : gists
      : [...gists, leafDepth],
    widths,
    tableW,
    overflowing: tableW > avail,
    minWidth: spineWidth(spine) + tableW,
    spine,
  };
}
