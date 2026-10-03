/**
 * How wide the prose is, and how wide the mode band beside it — the pure half of
 * "§ fitting".
 *
 * Kept out of Reader.tsx so it can be tested without a DOM: every number below
 * is checkable arithmetic.
 *
 * **There were gist columns here until 2026-09-29**, and most of this file's
 * history is the negotiation between them and the prose — shrink first, drop
 * second, L0 never a candidate. They went with the Hierarchy mode
 * (docs/plans/260929d-remove-hierarchy-mode-and-heading-numbers.md), which
 * leaves two layouts: the prose alone (`fitView`), and the prose beside a mode
 * band (`fitMode`). granularity-zoom.md keeps the history of the columns.
 */

import type { Mode } from "../modes.js";
import type { SummaryView } from "./params.js";

/**
 * The painted width of the rail, in px. Mirrors `--spine-w` in styles.css —
 * and `tests/spine-width.test.ts` is what stops the two drifting, because CSS
 * cannot read this constant and two of the numbers derived from it live in
 * `@media` queries, which cannot read a custom property either.
 *
 * **Px on both sides of that mirror, and it used to be `24` here against
 * `1.5rem` there.** That pair is only equal at a 16px root, and nothing in this
 * app locks the root font size: a reader who has set their browser to 20px got
 * a rail CSS painted at 30px while this file went on subtracting 24, so the
 * table was 6px wider than the window said it was and the drift test would have
 * certified the disagreement as correct. Found by GPT Sol, 2026-08-28. The rail
 * is part of pixel arithmetic — breakpoints, column widths, `minWidth` — so px
 * is the unit it belongs in, and the stylesheet now says `12px` too.
 *
 * **12, halved from 24 on 2026-08-28** — Greg: *"let's make the Spine a little
 * bit narrower … define one, and then halve it from the current"*. What that
 * costs and what it does not is docs/plans/260828ay-spine-rail.md § What a 12px rail
 * actually breaks; the short version is that a mouse loses nothing (the rail is
 * flush against the viewport edge, which is the easy case for Fitts) and a
 * finger loses half of a target that was already below every guideline —
 * defused, not solved, by reveal-then-commit (docs/project/touch.md).
 *
 * One width, not two. There used to be a labelled 13rem rail as well, shown
 * whenever the window could afford it — Greg took it out on 2026-08-26, so the
 * rail is now always the collapsed one. That deletes a whole negotiation from
 * this file (labels-versus-a-gist-column, and the non-monotonic fit it caused)
 * and leaves the spine as a fixed 12px the layout simply subtracts.
 */
export const SPINE_W = 12;

/* **The narrowest a gist column read at, when there were gist columns** — and
   still a term of the phone breakpoint, which is why it outlived them.
   Exported for `tests/spine-width.test.ts` alone: both breakpoints in styles.css
   are `GIST_MIN + PROSE_MIN + SPINE_W − 1`, performed by hand because a `@media`
   query cannot read a custom property, and that test is the only thing that can
   notice when one of them moves and the others don't. **The mode crossover is
   deliberately not among them** — it moves with `?spine=0`, which no query can
   see, so the stylesheet is told it by a class instead (`.band-covers`, written
   from `fit.modeW`). That test asserts its absence. */
export const GIST_MIN = 176; // 11rem — the narrowest a gist still reads at
export const PROSE_MIN = 544; // 34rem — the width the reading column is defended at

/**
 * **The narrowest the reading column may actually be, as against the width it
 * is defended at.**
 *
 * `PROSE_MIN` is a *priority*: while there is room to give, the band gives it
 * to the prose, and 544px is the point past which it stops giving. This is a
 * *floor*: the width below which a reading column is no longer worth putting on
 * the screen, and the band should cover the article instead of standing beside
 * a sliver of it (`bandCoversProse`).
 *
 * **`MODE_` is in the name because it is not a fact about prose.** Plain on a
 * 390px phone draws a 378px reading column and always has; nothing here forbids
 * that, and a bare `PROSE_FLOOR` would read as though something did. This is
 * the narrowest prose worth showing *beside a mode band* — the width at which
 * the trade of article-for-panel stops paying — and it is only ever consulted
 * by `fitMode` and `bandCoversProse`. GPT Sol named it, 2026-09-06.
 *
 * **They were one number until 2026-09-06, and that is what put the crossover
 * out of every phone's reach.** `MODE_MIN + PROSE_MIN + SPINE_W` is 844, and
 * `useWindowWidth` subtracts the notch, so a landscape iPhone hands `fitMode`
 * something between 667 and 838 — no iPhone made has ever cleared it, in either
 * orientation. Greg, 2026-09-06: *"Even when my browser window is fairly wide,
 * it still only shows the Mode column … I'd really like to be able to see a
 * Mode (e.g. Outline) + Text side-by-side when viewing on a modern iPhone in
 * landscape mode."*
 *
 * Splitting the two rather than lowering `PROSE_MIN` is what keeps the change
 * to the widths that were broken. Above `MODE_MIN + PROSE_MIN` the floor never
 * binds — `avail − modeW` is 544 or more by construction — so every laptop and
 * desktop width behaves exactly as it did. Lowering `PROSE_MIN` to 400 instead
 * would have handed the band its 400px ideal at the prose's expense on a
 * 900–1000px laptop, which is where most reading happens and which nobody
 * complained about.
 *
 * **400px, and the comparison that settles it is the app's own phone.**
 * Measured in Chrome on 2026-09-06, at a 16px root, `1ch` in the reading face
 * (Geist at 17px) is **11.34px**, and the cell spends `--text-pad-l` +
 * `--text-pad-r`:
 *
 * | column | text run | measure |
 * |---|---|---|
 * | 390px window, portrait phone, no band | 328px | **29.0ch** |
 * | `MODE_PROSE_FLOOR` = 400 | 342px | **30.2ch** |
 * | `PROSE_MIN` = 544 | 486px | **42.9ch** |
 *
 * So the floor is a hair *wider* than what a phone reader gets in portrait
 * today, which is the app's everyday mobile experience and has drawn no
 * complaint. A landscape split is therefore no worse for the prose than
 * portrait already is, and it comes with a mode panel beside it. Below this the
 * two halves start starving each other and the covering band is the better
 * answer, which is why there is a floor at all.
 *
 * **`.prose`'s `clamp(45ch, 90vw, var(--reading-measure))` is not a third
 * opinion here, and it is worth saying so because it reads like one.** 45ch is
 * 510px of *text*, so a column honouring it would be 568px — wider than
 * `PROSE_MIN` has ever been. The clamp's low end is a lower bound on a
 * `max-width`, not a minimum width: when the cell is narrower than 45ch the
 * prose simply takes the cell, which is what it already does at every width
 * this app ships. Fable read it as a declared floor while arbitrating this
 * change, 2026-09-06; the measurement above is why it isn't one.
 */
export const MODE_PROSE_FLOOR = 400; // 25rem

/**
 * **The widest the reading column goes when it is the only column there is —
 * in rem, because it is a measure of type rather than of screen.**
 *
 * Beside a band the prose takes whatever the band has left, and there is
 * always something beside it to take the rest. In Plain
 * there is nothing: the article had the whole window and sat hard against the
 * left of it, with 800px of empty page to its right on a 1600px screen. Greg,
 * 2026-09-03: *"In Plain mode, can you centre the text on the page?"* Capping
 * the column is what leaves a margin for `styles.css` § plain, centred to
 * divide between the two sides.
 *
 * **The condition is "no band", not "Plain"** — the mode is not what makes the
 * page lopsided, being alone is, and keeping it that way keeps this file free
 * of mode names.
 *
 * **Everything in it except the gutter is rem, so it is not one number any
 * more.** `proseAloneMaxPx` below is the cap; this is the rem part of it.
 *
 * 49rem is `--reading-measure` (65ch, ≈46rem in the reading face), plus the
 * cell's plain pad (1.4 — `--text-pad-l` since the gutter moved right in
 * 261003c, `--text-pad-r` before; the sum is the same), plus the gutter's inset on each side (0.35 × 2)
 * — 48.1, rounded up to something round, exactly as the old 50 rounded its own
 * 49.5. The rounding runs upwards on purpose: `.prose` keeps its own clamp, so
 * slack here is a few pixels of margin inside the column rather than a clipped
 * measure. A whole number of rem is worth keeping — 51.6 was tried on the way
 * here and left every width this derives fractional, so the tests had to round
 * with it and stopped asserting anything checkable by hand.
 *
 * **Rem, and this is the second time that has mattered in this file.** `SPINE_W`
 * above records the same lesson from the other side: nothing in this app locks
 * the root font size, and a px constant standing in for a rem-relative length is
 * only correct at 16px. Everything *this* number stands for scales with the
 * root — `--reading-size` is `1.0625rem`, `ch` scales with the font size, and
 * both of those pads are rem — so a reader whose browser default is 20px would
 * have had a px cap clip their measure from 65ch to about 51ch, which is the one
 * thing the cap must never do. GPT Sol, 2026-09-03.
 *
 * **And the gutter is the exception that proves it, which is why it left this
 * constant.** See `proseAloneMaxPx`.
 */
export const PROSE_ALONE_MAX_REM = 49;

/**
 * **One cell of the prose gutter, in rem and in px — the two halves of
 * `--blk-slot: max(1.5rem, 24px)` in styles.css § tokens.**
 *
 * A copy, and copies are what this file spends its comments warning about, so
 * it needs its reason: **CSS knows the reader's root font size and this file
 * does not know the CSS.** The lone-column cap has to reserve the gutter's real
 * width at the root the page is painted at, and that width stopped being a rem
 * fact the moment it grew a px floor. `tests/gutter-target-size.test.ts` reads
 * the declaration out of the stylesheet and fails when these two disagree with
 * it — which is the only thing that makes a copy safe.
 *
 * The px number is WCAG 2.5.8's, not ours.
 */
export const BLK_SLOT_MIN_PX = 24;
export const BLK_SLOT_REM = 1.5;

/**
 * **The widest a lone reading column goes, in px at the root it is painted at.**
 *
 * `PROSE_ALONE_MAX_REM * root` would be the whole answer if every term scaled
 * with the root. Two of the gutter's do not: `--blk-slot` is `max(1.5rem, 24px)`,
 * so below a 16px root the gutter stops shrinking and the *rem* width of the
 * cell's gutter padding (its right since 261003c) goes **up** — 2.2rem at 16, 2.7rem at 12. A single rem
 * constant therefore cannot be right at every root, and the one that was here
 * under-reserved by 1.2px at 12px and by 12.9px at 9px, silently clipping the
 * measure it exists to protect. GPT Sol's stage 1 review, 2026-09-04.
 *
 * Adding the gutter as its own term instead is exact at every root, and when it
 * landed on 2026-09-04 it did not move the common ones: 832px at 16 and 1040 at
 * 20, both unchanged, with only the 12px case widening (624 → 636) — which is
 * the case that was wrong.
 *
 * **One slot, not two, since 2026-09-05.** The gutter had a second column for
 * the reader's bookmark and the bookmark is now in the line, so `--blk-gutter-w`
 * is `var(--blk-slot)` and this term halves with it: 808px at a 16px root, 1010
 * at 20, 612 at 12. Greg asked for the margin back — *"especially on mobile we
 * want the margins either side of the text to be minimal"* — and this is the
 * half of that a stylesheet cannot state.
 *
 * `Math.round` because a fractional CSS pixel in a table width is a hairline
 * seam, and because every number derived from this is asserted by hand in
 * tests/layout.test.ts.
 */
export function proseAloneMaxPx(rootFontPx: number): number {
  const slot = Math.max(BLK_SLOT_REM * rootFontPx, BLK_SLOT_MIN_PX);
  return Math.round(PROSE_ALONE_MAX_REM * rootFontPx + slot);
}

/** The root font size everything not told otherwise assumes. */
export const DEFAULT_ROOT_PX = 16;

/**
 * The **mode band** — the strip between the spine and the prose when the middle
 * holds a mode (chat, and whatever came after it). See
 * docs/plans/260826a-chat-mode.md.
 *
 * Wide enough to hold a conversation rather than a sentence: an answer at
 * 176px would be four words a line. It still yields to
 * the prose — `PROSE_MIN` wins, and the band shrinks to `MODE_MIN` before the
 * reading column gives up a pixel.
 */
export const MODE_IDEAL = 400; // 25rem
export const MODE_MIN = 288; // 18rem — narrower and an answer stops reading as prose

/**
 * **The widest a `"wide"` band goes: a prose column's measure** — a ceiling
 * since 2026-09-30, reached from about 1307px at a 16px root (`WIDE_SHARE`). Tweets' posts
 * are set in the prose face, so the width at which prose reads well is the width
 * at which they do. Greg, 2026-09-29: *"It could be quite a wide left-hand
 * column if that will help to make it be readable."*
 * docs/plans/260929f-tweets-become-a-mode-with-a-wide-band-and-block-links.md.
 */
export const WIDE_IDEAL_REM = 34;

/**
 * `WIDE_IDEAL_REM` in pixels at this root. In rem, like Structure's columns,
 * because the posts are rem-sized type: a reader with a larger root font gets a
 * proportionally wider band rather than fewer words a line. GPT Sol, plan
 * review, 2026-09-29.
 */
export function wideIdeal(rootFontPx: number): number {
  return Math.round(WIDE_IDEAL_REM * rootFontPx);
}

/**
 * **The wide band's share of the room beside the rail**, since 2026-09-30.
 *
 * It had taken whatever the prose left — `avail − PROSE_MIN` — and on an iPad
 * that swung from floor to ceiling: 288px in portrait (834 wide), where the
 * prose was defending 544, and 544 in landscape (1194), where band and prose
 * came out nearly equal. Greg, 2026-09-30 (SPIDERYARN-READING2-6G): *"The tweet
 * thread column perhaps could be slightly wider when I'm looking at it on my
 * iPad in portrait mode, and slightly narrower when I'm looking at it on my
 * iPad in landscape mode."* A share is one number for the relationship he was
 * reacting to: 345 and 496 on those two, and 544 still from about 1307 up.
 *
 * So in Tweets the prose gives up its `PROSE_MIN` defence (477 in portrait):
 * the thread is what is being read there and the prose is where its links
 * land. It never goes below `MODE_PROSE_FLOOR`, and the band never below the
 * standard one. docs/plans/260930h-tweets-band-fits-ipad-and-copy-buttons-become-icons.md.
 */
export const WIDE_SHARE = 0.42;

/**
 * **The roomy band's ceiling** — the standard band's, a touch higher. Summary's,
 * since 2026-10-01. Greg (SPIDERYARN-READING2-7Q): *"Make the Summary mode
 * column ever so slightly wider (if on a wide screen)"*. It still takes only
 * what the prose leaves above `PROSE_MIN`, so below about 957px it is the
 * standard band and it reaches 448px near 1004px.
 * docs/plans/261001p-summary-loses-parts-and-sections-a-touch-wider.md.
 */
export const ROOMY_IDEAL_REM = 28;

/**
 * **Which band a mode gets.** Every mode's band is `MODE_MIN`–`MODE_IDEAL` wide,
 * except Structure's while its two columns are on screen — see
 * `structureColumnsBand` — a `"wide"` one, which takes `WIDE_SHARE` of the
 * room up to `wideIdeal`, and so is the one band that takes room the prose was
 * defending, and a `"roomy"` one, the standard band up to `ROOMY_IDEAL_REM`.
 */
export type BandShape = "standard" | "structure" | "wide" | "roomy";

/**
 * **The band each mode gets** — one answer for the live fit and for the
 * Marginalia press's `notesFit`, which had each written the same ternary.
 * Structure's two columns want a band of their own width where they fit
 * (`structureColumnsBand`, docs/plans/260928a-structure-two-columns-readable.md).
 * The thread's posts are prose, so theirs may grow to a prose column's measure
 * — Greg, 2026-09-29: *"It could be quite a wide left-hand column if that will
 * help to make it be readable."* Summary's paragraphs get a touch more room
 * (`ROOMY_IDEAL_REM`).
 *
 * **The thread is Summary's third view since 2026-10-03**, so Summary's band
 * is the wide one while `?summary=thread` is showing and the roomy one
 * otherwise, and the view is part of the question. `summary` is the parsed
 * state the Reader holds, and it counts only inside Summary: the parameter
 * outlives the mode, as `?diagram=` does.
 * docs/plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md.
 */
export function bandShapeFor(mode: Mode, summary: SummaryView): BandShape {
  if (mode === "structure") return "structure";
  if (mode === "summary") return summary === "thread" ? "wide" : "roomy";
  return "standard";
}

/**
 * **Structure's two columns, as widths.** Calculated from rem, because the
 * columns hold rem-sized type (structure-mode.css) and a larger root needs
 * wider columns for the same line. `structureColumnsBand` also floors the
 * result above the ordinary band's maximum so the two faces cannot overlap at
 * an unusually small root.
 *
 * The minimum is the rule from Greg's request (2026-09-28): each of the two
 * columns is at least as wide as the one column he calls fine, at its
 * narrowest — Structure's list face in a `MODE_MIN` band has a 267px content
 * box, and 17rem is the rem step that clears it. Until then the columns shared
 * the ordinary band and were never wider than ~181px, on any screen.
 * docs/plans/260928a-structure-two-columns-readable.md.
 */
export const STRUCT_COLUMN_MIN_REM = 17; // 272px
export const STRUCT_COLUMN_IDEAL_REM = 20; // 320px — ~40 characters; wider only costs the prose
/** The gap between the columns — structure-mode.css § `.struct-grid`. Change both. */
export const STRUCT_GUTTER_REM = 1;
/** Structure's padding on the band, both sides — structure-mode.css § `.mode-band.struct`. Change both. */
export const STRUCT_PAD_X_REM = 1.5;
/**
 * Column B's bracket — structure-mode.css § `.struct-inner`, its padding and its
 * border. Change both. It comes out of column B's track, and the tracks are
 * equal, so both tracks carry it: without it the threshold gave column B 260px
 * of its 272 (GPT Sol's plan review, finding 2).
 */
export const STRUCT_BRACKET_INSET_REM = 0.6;
export const STRUCT_BRACKET_PX = 2;
/** `.mode-band`'s one border (mode-band.css, `border-right`). */
const BAND_BORDER_PX = 1;

/**
 * **The band border-box widths Structure's columns need**: `min` to draw them at
 * all, `ideal` beyond which the room goes back to the prose.
 *
 * The one statement of Structure's switch point. `fitMode` sizes the band from
 * it and `structureFace` (StructureMode.tsx) picks the face from it, so the band
 * handed out and the face drawn in it cannot disagree —
 * tests/structure-band-width.test.ts sweeps every width for exactly that.
 */
export function structureColumnsBand(rootFontPx: number): { min: number; ideal: number } {
  const track = (columnRem: number) =>
    (columnRem + STRUCT_BRACKET_INSET_REM) * rootFontPx + STRUCT_BRACKET_PX;
  const around = (STRUCT_GUTTER_REM + STRUCT_PAD_X_REM) * rootFontPx + BAND_BORDER_PX;
  const measuredMin = Math.ceil(2 * track(STRUCT_COLUMN_MIN_REM) + around);
  const measuredIdeal = Math.ceil(2 * track(STRUCT_COLUMN_IDEAL_REM) + around);
  /* An ordinary band reaches MODE_IDEAL. Keep the columns' threshold above it
     even at an unusually small browser root, or fitMode can take its ordinary
     branch (because there is not room beside PROSE_MIN) and still hand out a
     MODE_MIN band that structureFace reads as columns. The 401px floor is inert
     at every normal root — the measured minimum is already 458px at 12px — and
     preserves the stated jump from an ordinary band to a columns band for all
     positive root sizes. */
  const min = Math.max(MODE_IDEAL + 1, measuredMin);
  return { min, ideal: Math.max(min, measuredIdeal) };
}

export type SpineMode = "on" | "off";

export interface Fit {
  /** Explicit pixel widths, one per rendered column, in render order — one,
      the prose, since the gist columns went. */
  widths: number[];
  /** The table's own width — the sum of `widths`. */
  tableW: number;
  /**
   * Whether the table is wider than the room it has. The view knows this
   * exactly, because it chose the width.
   */
  overflowing: boolean;
  spine: SpineMode;
  /** What `.reader` needs as an inline min-width so the sticky bars have range. */
  minWidth: number;
  /**
   * **How much horizontal room the mode band takes from the table.** Set as
   * `--mode-w` on `.reader`; every rule that has to make room for the band
   * reads it from there (styles.css § mode band).
   *
   * It is `0` in two cases, and reading it as "there is no band" is wrong in
   * the second: Plain, where there genuinely is no band — and **a window under
   * `MODE_MIN + MODE_PROSE_FLOOR` plus whatever the rail costs — 700px with it,
   * 688 with `?spine=0` — where there is one and it takes no room from the
   * table because it covers it instead** (`fitMode`, and `bandCoversProse` for
   * the one statement of that width; it takes `showSpine` precisely because the
   * answer is not a single number). Ask `mode !== "plain"` if what you want to
   * know is whether a band is open.
   */
  modeW: number;
  /**
   * **The article is the only thing on this page** — no band, just the prose
   * across the whole window. It is where `PROSE_ALONE_MAX_REM` and the auto
   * margins in styles.css § plain, centred come in.
   */
  alone: boolean;
  /**
   * **The marginalia column's width, right of the prose** — `0` when there is
   * no column, and also when one was asked for and the window has no room for
   * it (`fitMargin`). Written as `--marg-w` on `.reader`.
   */
  margW: number;
  /**
   * **How much of the window's right-hand side `.reader` keeps clear for the
   * column**, as padding — `--marg-reserve`. Often `0` even with a column,
   * because the centred prose already leaves room beside it; see `fitMargin`.
   */
  margReserve: number;
  /**
   * **Where the column starts**, in px from `.reader`'s left padding edge less
   * the notch — the table's right edge. Only the head needs it: the notes find
   * their place from their cells, but the head is `position: fixed`.
   */
  margLeft: number;
}

function spineWidth(mode: SpineMode): number {
  return mode === "on" ? SPINE_W : 0;
}

/**
 * **The rail, in a mode**: on unless the reader turned it off.
 *
 * `?spine=0` is a choice about the page rather than about the mode you happen
 * to be in, so `null` — nobody has chosen — means on. Named because two
 * functions now resolve it and they must not drift: `fitMode` needs the mode
 * for its own arithmetic, and `bandCoversProse` needs it to answer the same
 * question one press earlier.
 *
 * **It is deliberately not `Fit.spine`**, which is what the *current* layout
 * resolved to. The two agree today; a caller asking "would a band cover the
 * article" is asking about the rail the band would find, not the one on screen
 * now, and keeping the questions apart is cheaper than re-deriving it the day
 * they differ again.
 */
function modeSpine(showSpine: boolean | null): SpineMode {
  return showSpine === false ? "off" : "on";
}

/**
 * **Would an open mode band cover the article rather than sit beside it?**
 *
 * The crossover `fitMode` turns on, lifted out so there is exactly one
 * statement of it. Below this width the band stops taking room from the prose
 * and is laid over it instead — see the long note inside `fitMode` for why that
 * is the design and not a failure, and styles.css § a band with no room for the
 * other half of it.
 *
 * **It is `MODE_PROSE_FLOOR` and not `PROSE_MIN`**, and that distinction is what
 * lets a phone in landscape have both. The band yields to the prose down to
 * `PROSE_MIN` (544) while there is room to give, but the question *this*
 * function answers is a different one — how narrow a reading column is still
 * worth standing beside — and the answer to that is the floor, 400. See
 * `MODE_PROSE_FLOOR` for why the two were one number until 2026-09-06 and what that
 * cost.
 *
 * **It moves with the rail**, which is why it takes `showSpine` rather than
 * being a number: 700 with the rail on, 688 without. A caller that guessed the
 * rail was on would miss a phone by twelve pixels, and one that guessed it was
 * off would warn a reader whose band fits perfectly well. Getting that wrong
 * from a hand-copied breakpoint is the accident this codebase has already had
 * once — see `App.tsx` § `band-covers`.
 *
 * **It answers a hypothetical when no band is open**, and that is the point:
 * `SmallScreenHint` is the other caller, and its whole job is to say what will
 * happen when the reader presses a mode button, *before* the article vanishes
 * underneath one.
 */
export function bandCoversProse(windowWidth: number, showSpine: boolean | null = null): boolean {
  return MODE_MIN + MODE_PROSE_FLOOR > Math.max(0, windowWidth - spineWidth(modeSpine(showSpine)));
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface FitInput {
  windowWidth: number;
  /**
   * True when a mode's band is open — every mode but Plain. See `MODE_IDEAL`.
   */
  modeBand?: boolean;
  /**
   * Whether the reader has said the rail should be on screen, or `null` for
   * automatic — see params.ts § spineParam. Three states rather than two so
   * that `false` survives a trip through a mode; `null` means on.
   */
  showSpine?: boolean | null;
  /**
   * The root font size this page is painted at, in px — `useRootFontPx()` in
   * Reader.tsx, `DEFAULT_ROOT_PX` for anything that has no DOM to ask.
   *
   * Two things need it, and only because each is a measure of type rather than
   * of screen: `PROSE_ALONE_MAX_REM`, and Structure's columns
   * (`structureColumnsBand`). Every other constant in this file is a *screen*
   * width, and those are px on purpose, because they are compared with a
   * window measured in px.
   */
  rootFontPx?: number;
  /**
   * Which band is open, when `modeBand` is — see `BandShape`. Ignored without a
   * band.
   */
  bandShape?: BandShape;
  /**
   * True when the marginalia column is wanted to the right of the prose —
   * `fitMargin` alone, `fitBoth` beside a band (since 2026-10-01).
   */
  margin?: boolean;
}

/**
 * **The marginalia column's width**: ~20 characters of note at its
 * narrowest, ~36 at its widest. Notes are a step smaller than the prose
 * (marginalia.css), so these are much narrower than a band.
 */
export const MARG_MIN = 200; // 12.5rem
export const MARG_IDEAL = 288; // 18rem

/**
 * **The prose with a column of notes to its right** — Marginalia mode.
 * docs/plans/261001d-annotations-mode-marginalia-in-a-right-hand-column.md.
 *
 * Three rules, in the order they bind as the window narrows:
 *
 *  1. **The prose stays where Plain puts it** — centred, at the Plain cap —
 *     while the room left beside it already holds the column. Nothing is
 *     reserved then (`margReserve` 0), so turning the mode on does not move a
 *     word of the article.
 *  2. **Then the column pushes the centred prose left**, by reserving room on
 *     `.reader`'s right: the table is centred (`.text-alone`) in a content box
 *     `avail − margReserve` wide, so its right edge sits at
 *     `(avail − margReserve + proseW) / 2` past the rail, and the column fits
 *     after it exactly when `margReserve ≥ 2·margW + proseW − avail`.
 *  3. **Then the prose narrows**, the column shrinking first from `MARG_IDEAL`
 *     to `MARG_MIN` while the prose holds `PROSE_MIN`, and the prose giving
 *     way after that down to `MODE_PROSE_FLOOR` — the same floor a band
 *     respects, for the same reason.
 *
 * Below that floor there is no column (`margW` 0) and the page is Plain's.
 */
function fitMargin(windowWidth: number, showSpine: boolean | null, rootFontPx: number): Fit {
  const spine = modeSpine(showSpine);
  const avail = Math.max(0, windowWidth - spineWidth(spine));
  const plainW = Math.min(avail, proseAloneMaxPx(rootFontPx));
  if (avail - MARG_MIN < MODE_PROSE_FLOOR) {
    return {
      widths: [plainW],
      tableW: plainW,
      overflowing: false,
      minWidth: spineWidth(spine) + plainW,
      spine,
      modeW: 0,
      alone: true,
      margW: 0,
      margReserve: 0,
      margLeft: 0,
    };
  }
  const margW = clamp(avail - PROSE_MIN, MARG_MIN, MARG_IDEAL);
  const proseW = Math.min(plainW, avail - margW);
  const margReserve = Math.max(0, 2 * margW + proseW - avail);
  return {
    widths: [proseW],
    tableW: proseW,
    overflowing: false,
    minWidth: spineWidth(spine) + proseW + margReserve,
    spine,
    modeW: 0,
    alone: true,
    margW,
    margReserve,
    margLeft: spineWidth(spine) + (avail - margReserve - proseW) / 2 + proseW,
  };
}

/**
 * **A band on the left and the marginalia column on the right** — since
 * 2026-10-01, docs/plans/261001i-annotations-column-beside-a-band-mode.md.
 *
 *  - **The column takes its room first, then band and prose share the rest
 *    exactly as `fitMode` would share a window that much narrower** — so
 *    Structure's columns and Tweets' share behave as they always do, and the
 *    face Structure draws still follows the band it was given.
 *  - **The band wins.** When the rest would not hold a band beside
 *    `MODE_PROSE_FLOOR` of prose, there is no column and the fit is the band's
 *    own, unchanged: below 900px with the rail. The band is what the reader
 *    opened most specifically and it may hold their half-typed words; the
 *    notes are ambient, and under a covering band they would annotate prose
 *    nobody can see.
 *  - **The prose is capped at Plain's width**, unlike a band alone, where the
 *    cell takes all the rest and the prose centres inside it. A note sits at
 *    the cell's right edge, so an uncapped cell would leave the notes hundreds
 *    of pixels from their paragraph on a wide screen. The spare room goes to
 *    the right of the column, inside `margReserve`.
 */
function fitBoth(
  windowWidth: number,
  showSpine: boolean | null,
  bandShape: BandShape,
  rootFontPx: number,
): Fit {
  const spine = modeSpine(showSpine);
  const avail = Math.max(0, windowWidth - spineWidth(spine));
  const margW = clamp(avail - MODE_MIN - PROSE_MIN, MARG_MIN, MARG_IDEAL);
  const rest = avail - margW;
  if (MODE_MIN + MODE_PROSE_FLOOR > rest) return fitMode(windowWidth, showSpine, bandShape, rootFontPx);
  const modeW = bandWidth(rest, bandShape, rootFontPx);
  const proseW = Math.min(proseAloneMaxPx(rootFontPx), Math.max(MODE_PROSE_FLOOR, rest - modeW));
  const margReserve = avail - modeW - proseW;
  return {
    widths: [proseW],
    tableW: proseW,
    overflowing: false,
    minWidth: spineWidth(spine) + modeW + proseW + margReserve,
    spine,
    modeW,
    alone: false,
    margW,
    margReserve,
    margLeft: spineWidth(spine) + modeW + proseW,
  };
}

/**
 * **The layout for this window**: the prose beside a mode's band, or the prose
 * alone.
 *
 * **The rail is on unless the URL says otherwise** — Greg, 2026-09-05: "we
 * don't need the 'Spine' button (let's just default to always showing it)".
 * `?spine=0` still wins outright, which is why the parameter stays
 * three-state rather than boolean. `modeSpine` is the one statement of that,
 * shared with `fitMode` and `bandCoversProse`.
 *
 * **Alone, the prose stops growing at the measure.** A 1588px cell holding a
 * 738px measure is 850px of empty page rather than a wide reading column. See
 * `PROSE_ALONE_MAX_REM` for why the cap is phrased as "alone" rather than
 * "Plain", `proseAloneMaxPx` for why it is a function of the root rather than
 * one number, and styles.css § plain, centred for the auto margins that put the
 * leftover on both sides instead of one. Below the cap the prose takes the
 * whole window, however narrow — a 390px phone gets a 378px column, and the
 * page never scrolls sideways.
 */
export function fitView({
  windowWidth,
  modeBand = false,
  showSpine = null,
  rootFontPx = DEFAULT_ROOT_PX,
  bandShape = "standard",
  margin = false,
}: FitInput): Fit {
  if (modeBand && margin) return fitBoth(windowWidth, showSpine, bandShape, rootFontPx);
  if (modeBand) return fitMode(windowWidth, showSpine, bandShape, rootFontPx);
  if (margin) return fitMargin(windowWidth, showSpine, rootFontPx);
  const spine: SpineMode = modeSpine(showSpine);
  const avail = Math.max(0, windowWidth - spineWidth(spine));
  const proseW = Math.min(avail, proseAloneMaxPx(rootFontPx));
  return {
    widths: [proseW],
    tableW: proseW,
    overflowing: false,
    minWidth: spineWidth(spine) + proseW,
    spine,
    modeW: 0,
    alone: true,
    margW: 0,
    margReserve: 0,
    margLeft: 0,
  };
}

/**
 * The layout when the middle band belongs to a mode: spine, band, prose.
 *
 * Three things are decided here and each is a judgement rather than arithmetic:
 *
 *  - **The spine is on unless the reader turned it off.** `?spine=0` is a
 *    choice about the page, not about the mode they happen to be in, and it is
 *    the only thing that turns the rail off in a mode.
 *  - **The prose wins, and then it yields to a floor.** The band shrinks from
 *    `MODE_IDEAL` to `MODE_MIN` before the reading column drops below
 *    `PROSE_MIN`, because the article is what is being read. Past that the *prose* narrows, from 544 to
 *    `MODE_PROSE_FLOOR`, and past *that* the band gives up sharing the screen
 *    and covers the article instead. **The page never overflows and never
 *    scrolls sideways**; it said it did until 2026-09-06, and that was already
 *    only reachable in the branch the cover check had made unreachable.
 *  - **Two bands can be wider.** Structure's columns, only once they fit
 *    beside `PROSE_MIN` — `structureColumnsBand` — and Tweets' wide band,
 *    which takes a share of the room and lets the prose down towards
 *    `MODE_PROSE_FLOOR` to do it (`WIDE_SHARE`). Both in `bandWidth` below.
 *  - **The prose is always on.** There is no longer any view that hides it
 *    (`?text=0` went with the Hierarchy mode on 2026-09-29).
 */
function fitMode(
  windowWidth: number,
  showSpine: boolean | null,
  bandShape: BandShape,
  rootFontPx: number,
): Fit {
  const spine = modeSpine(showSpine);
  const avail = Math.max(0, windowWidth - spineWidth(spine));

  /**
   * **Below `MODE_MIN + MODE_PROSE_FLOOR` the band stops taking room from the
   * article and covers it instead.**
   *
   * The negotiation below has an implied floor and no behaviour underneath it:
   * both terms bottom out, so at 390px this function used to return a 288px
   * band beside a 544px column and ask a 390px window for 832px of content.
   * Opening chat on a phone put two half-visible panels side by side and
   * neither of them could be read.
   *
   * **`MODE_PROSE_FLOOR`, not `PROSE_MIN`, since 2026-09-06.** The sum was 832 and
   * the crossover 844, which is above every iPhone's landscape width once the
   * notch is subtracted, so *no* phone ever got a band beside its article. It
   * is 688 and 700 now, and the widths between 700 and 844 are the whole of the
   * change: the band pins at `MODE_MIN` there and the prose takes the rest.
   *
   * **`modeW` is 0 here, and that is not a lie about there being a band.** The
   * field's job is to say how much horizontal room the band takes *from the
   * table* — it is written straight out as `--mode-w`, which five rules in
   * styles.css subtract from the two sticky bars and add to `.reader`'s
   * padding. On a phone the band takes none: it is `position: fixed`, so
   * styles.css § a narrow window simply widens it to the whole window and it
   * sits on top of the article. Everything else on the page can then keep the
   * geometry it has when no band is open at all.
   *
   * That fixed positioning is also why the obvious alternative does not work,
   * and it was tried first: giving the band and the prose a full screen each
   * and letting the page scroll between them. A fixed band cannot scroll away,
   * so the second pane never arrives — and `--mode-w` at a full screen makes
   * `calc(100vw - --spine-w - --mode-w)` zero, which is the masthead and the
   * controls bar. Caught by GPT Sol reviewing this plan, 2026-08-27.
   *
   * The prose does not go away: it is still there, still full width, one tap
   * on the dock's Plain button away.
   */
  /**
   * **This crossover is conditional, and since 2026-09-03 nothing else tries to
   * guess it.**
   *
   * `avail` is the window minus the rail, so the width at which the band stops
   * fitting beside the prose depends on whether the rail is there: **700 with
   * it, 688 without**, since 2026-09-06. The pair below is the one that was
   * live when the bug happened — 844 and 832 — and every number in this note is
   * that era's, deliberately, because it is a reproduction and not a
   * description.
   *
   * `styles.css` § a band with no room used to be a plain
   * `@media (max-width: 843px)`, which knows nothing about `?spine=0`, and
   * between **832 and 843 with the rail off** the two disagreed: this function
   * handed the band 288–299px and squeezed the table to make room, while the
   * stylesheet widened that same band to the whole window and laid it over the
   * article it had just made space for. Measured, not reasoned: at 832px,
   * `modeW` 288 against a covering band. Found by GPT Sol reviewing the rail's
   * halving, 2026-08-28 — and pre-existing rather than introduced by it, since
   * the same gap sat at 844–855 when the rail was 24px. It is as wide as the
   * rail, whatever the rail is.
   *
   * The fix was not a fourth hand-copied breakpoint. The stylesheet stopped
   * deriving a fact it cannot see: `App.tsx` writes `band-covers` on `.reader`
   * from `fit.modeW === 0`, beside the `--mode-w` it already wrote from the same
   * number, and the covering rules key off the class. So `modeW: 0` below is now
   * the *only* statement of this crossover on the page, and the rail's width may
   * move without anything in CSS moving with it.
   * `tests/spine-width.test.ts` § the band covers the article on a fact, not on
   * a width holds that line.
   *
   * **The condition itself moved to `bandCoversProse` on 2026-09-05** and this
   * function now asks it rather than spelling it out, because a second reader
   * of the same crossover arrived: the banner that tells a phone reader why the
   * article vanished (src/web/SmallScreenHint.tsx). Two hand-written copies of
   * a width is how the stylesheet and this file came to disagree in the first
   * place, and the fix there was the same one — derive it, do not restate it.
   */
  if (bandCoversProse(windowWidth, showSpine)) {
    return {
      widths: [avail],
      tableW: avail,
      overflowing: false,
      minWidth: spineWidth(spine) + avail,
      spine,
      modeW: 0,
      /* A band is open — it is covering the article rather than sitting beside
         it, but it is there, and nothing about this page is the article on its
         own. See `Fit.alone`. */
      alone: false,
      margW: 0,
      margReserve: 0,
      margLeft: 0,
    };
  }

  /* **Two different prose numbers, and the difference is the whole negotiation.**
     A standard band (and Structure until its columns fit) is computed against
     `PROSE_MIN` — the width the prose is *defended* at — so while the window can
     afford it the band shrinks and the reading column keeps its 544. A wide
     band is the deliberate exception: `bandWidth` lets its share take the prose
     down towards `MODE_PROSE_FLOOR`. The column's own width falls back to that
     floor in either case. For a standard band it only binds once the band has
     already bottomed out at `MODE_MIN`: between 688 and 832 of `avail` the band
     sits at 288 and the prose grows 400 → 544, and at 832 the two agree and the
     arithmetic is identical to what it was when there was one constant. Below
     688 the branch above has already taken the covering path, so `proseW` is
     never less than `MODE_PROSE_FLOOR` and the sum is never more than `avail`. */
  const modeW = bandWidth(avail, bandShape, rootFontPx);
  const proseW = Math.max(MODE_PROSE_FLOOR, avail - modeW);
  return {
    widths: [proseW],
    tableW: proseW,
    overflowing: modeW + proseW > avail,
    minWidth: spineWidth(spine) + modeW + proseW,
    spine,
    modeW,
    alone: false,
    margW: 0,
    margReserve: 0,
    margLeft: 0,
  };
}

/**
 * **The band's width beside the prose**, for a window that is not covered.
 *
 * Structure asks one question first: is there room beside `PROSE_MIN` for its
 * two columns (`structureColumnsBand`)? If so it takes that room, up to the
 * columns' ideal; if not, it gets exactly what every other mode gets, and
 * `structureFace` draws the list in it. So the band **jumps** from `MODE_IDEAL`
 * to the columns' minimum rather than growing through the widths between —
 * a list face in a 500px band would be a look Greg has not seen, and he called
 * the one column fine as it is (260928a § Assumptions 1).
 *
 * The prose keeps `PROSE_MIN` at the switch: the columns take only room the
 * reading column was not defending. The wide band is the exception, by
 * design: see `WIDE_SHARE`.
 */
function bandWidth(avail: number, bandShape: BandShape, rootFontPx: number): number {
  if (bandShape === "structure") {
    const { min, ideal } = structureColumnsBand(rootFontPx);
    if (avail - PROSE_MIN >= min) return Math.min(avail - PROSE_MIN, ideal);
  }
  const spare = spareBeyondTheMeasure(avail, rootFontPx);
  /* Floored at `MODE_IDEAL`, as the wide band's cap is: 28rem at a 12px root
     is 336, and a roomy band must never be the narrower one. */
  if (bandShape === "roomy") {
    const ideal = Math.max(MODE_IDEAL, Math.round(ROOMY_IDEAL_REM * rootFontPx));
    return Math.max(clamp(avail - PROSE_MIN, MODE_MIN, ideal), spare);
  }
  const standard = clamp(avail - PROSE_MIN, MODE_MIN, MODE_IDEAL);
  if (bandShape === "standard") return Math.max(standard, spare);
  /* Grows smoothly rather than jumping: the posts reflow at any width, unlike
     Structure's two columns. A share of the room (`WIDE_SHARE`), never
     narrower than the standard band, never wider than its root-relative cap
     or than leaves the prose its floor. The last bound is what keeps
     `fitMode` from overflowing at the crossover: 0.42 × 688 is 289. */
  if (bandShape === "wide") {
    const cap = Math.min(Math.max(MODE_IDEAL, wideIdeal(rootFontPx)), avail - MODE_PROSE_FLOOR);
    return clamp(Math.round(avail * WIDE_SHARE), standard, cap);
  }
  /* Structure whose columns do not fit: the ordinary band, and deliberately
     not `spare` — its list face in a band past `MODE_IDEAL` is a look Greg has
     not seen (260928a). In practice the columns fit first at every root. */
  return standard;
}

/**
 * **What the prose cell has beyond the width the prose can use**, offered to a
 * standard or roomy band, up to a reading measure. Greg, 2026-10-01
 * (spya-xebdgz): *"if the window is really wide and there's space, the
 * left-hand column should expand up to that sort of width"* — the measure the
 * text is set at — *"I think the way it works right now for slightly narrow
 * windows is pretty good, so we don't want to screw that up … let's not
 * introduce too much complexity."*
 *
 * **No new number.** The prose stops reading wider at `proseAloneMaxPx` — the
 * measure, its pad and the gutter, the cap it already has alone — so anything
 * the cell holds past that is page on either side of a centred column. The
 * band takes it, and stops at `wideIdeal`, which is already this file's name
 * for a prose column's measure and Tweets' ceiling.
 *
 * **Narrow windows are untouched by construction**: this is negative until the
 * cell is wider than the prose can use, which at a 16px root is a 1220px
 * window for a standard band (1268 for Summary's roomy one), and below that the
 * band is exactly what it was. It reaches 34rem at 1364 and stops.
 * docs/plans/261002a-horizontal-scrollbar-wider-band-on-wide-windows-archive-button-on-the-masthead.md.
 */
function spareBeyondTheMeasure(avail: number, rootFontPx: number): number {
  return Math.min(avail - proseAloneMaxPx(rootFontPx), wideIdeal(rootFontPx));
}

/**
 * **The block chat panel, docked over the marginalia column** rather than
 * floating over the prose.
 * docs/plans/261003p-block-chat-spinner-and-docking-in-the-marginalia-column.md.
 *
 * `CHAT_DOCK_MIN` is the narrowest the panel is worth docking at: below it the
 * panel floats in the corner exactly as it always has, because a 200px chat is
 * worse than an overlapping one. `CHAT_DOCK_INSET` is how far right of the
 * column's edge the panel starts, so the prose's gutter icons stay clear; the
 * stylesheet adds it to `left`, and ChatDialog.tsx hands it over as
 * `--chat-dock-inset` so that this is the only copy. `CHAT_DOCK_GUTTER` is the
 * page kept between the panel and the window's right edge.
 */
/* **Sized so that a full column is enough room.** The column is at most
   `MARG_IDEAL` (288px), and with a band open it is pressed against the
   window's edge, so the room there is 288 less the inset and the gutter. The
   first numbers (272, 10, 12) left 266 and the panel never docked beside a
   band below 1658px, which is the layout the report was filed from. With
   these a full column gives 272px. A column narrower than `CHAT_DOCK_MIN`
   plus the two still floats. */
export const CHAT_DOCK_MIN = 256; // 16rem
export const CHAT_DOCK_INSET = 8;
export const CHAT_DOCK_GUTTER = 8;

/**
 * **How much room a docked chat panel has, in px — or `null` for "do not dock,
 * float".** Pure: the live `Fit` and the window width it was fitted to.
 *
 * `fit.margLeft` is the table's right edge, which is where the column starts
 * (`fitMargin`, `fitBoth`); `windowWidth` is the same number both were given,
 * with the notch and the scrollbar already out of it, so the difference is
 * everything right of the prose. The inset and the gutter come off **before**
 * the minimum is applied — GPT Sol on the plan, F3: taken off afterwards, a
 * panel that just qualified would run into the window's edge.
 *
 * **Gated on `margW`, not on the room.** With no column `margLeft` is `0` and
 * the arithmetic would report the whole window; and a column that was asked
 * for but has no room (`margW` 0 — a phone, a narrow iPad) is not showing.
 *
 * **The room, not the width.** The panel is `min(26rem, the room)` and the
 * `26rem` is the stylesheet's (dialogs.css § `.chat-dialog.docked`), which is
 * the one place that knows the root font size without being told.
 */
export function chatDock(fit: Fit, windowWidth: number): number | null {
  if (fit.margW <= 0) return null;
  const room = windowWidth - fit.margLeft - CHAT_DOCK_INSET - CHAT_DOCK_GUTTER;
  return room >= CHAT_DOCK_MIN ? room : null;
}
