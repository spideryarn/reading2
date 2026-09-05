/**
 * Choosing which columns to show, and how wide — the pure half of "§ fitting".
 *
 * Kept out of App.tsx so it can be tested without a DOM: every number below is
 * checkable arithmetic, and the worked examples in
 * granularity-zoom.md#too-many-levels-fit-the-columns-dont-just-scroll-them are
 * the test cases.
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
 *  - **L0 is not a candidate at all** — the spine already shows what it would,
 *    and since 2026-09-05 it is not an offerable column from any source
 *    (`offerableGists`). Among what is left, the *finest* goes first: a reader
 *    squeezed to one column is choosing between "the part I'm in" and "the
 *    paragraph I'm in", and the part is what orients them, so L2 goes before
 *    L1. See the `chosen === null` branch of `fitView` for the history.
 *
 * The detail column — prose in reading mode, the leaf column in outline mode —
 * takes whatever is left, so the table fills the window exactly when it can and
 * overflows by a known amount when it can't. Knowing that amount is what lets
 * TableView draw the pinned ends as a layer only when something is actually
 * underneath them, rather than guessing from a viewport breakpoint.
 */

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

const GIST_IDEAL = 240; // 15rem — comfortable for a one-sentence gist
/* Exported for `tests/spine-width.test.ts` alone: the two breakpoints in
   styles.css are `GIST_MIN + PROSE_MIN + SPINE_W − 1` and
   `MODE_MIN + PROSE_MIN + SPINE_W − 1`, performed by hand because a `@media`
   query cannot read a custom property, and that test is the only thing that can
   notice when one of the four moves and the others don't. */
export const GIST_MIN = 176; // 11rem — the narrowest a gist still reads at
export const PROSE_MIN = 544; // 34rem — the narrowest the reading column may be

/**
 * **The widest the reading column goes when it is the only column there is —
 * in rem, because it is a measure of type rather than of screen.**
 *
 * Everywhere else the detail column takes whatever the gists and the band have
 * left, and there is always something beside it to take the rest. In Plain
 * there is nothing: the article had the whole window and sat hard against the
 * left of it, with 800px of empty page to its right on a 1600px screen. Greg,
 * 2026-09-03: *"In Plain mode, can you centre the text on the page?"* Capping
 * the column is what leaves a margin for `styles.css` § plain, centred to
 * divide between the two sides.
 *
 * **The condition is "no other column", not "Plain".** The same thing is true
 * of Hierarchy with `?cols=` set to nothing, and of an article whose tree has
 * no gist depths at all — the mode is not what makes the page lopsided, being
 * alone is. Keeping it that way is also what keeps this file free of mode
 * names, which is the point of `plainCols` in App.tsx.
 *
 * **Everything in it except the gutter is rem, so it is not one number any
 * more.** `proseAloneMaxPx` below is the cap; this is the rem part of it.
 *
 * 49rem is `--reading-measure` (65ch, ≈46rem in the reading face), plus the
 * cell's `--text-pad-r` (1.4), plus the gutter's inset on each side (0.35 × 2)
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
 * cell's left padding goes **up** — 2.2rem at 16, 2.7rem at 12. A single rem
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
 * is something other than the table of contents (chat, and whatever comes after
 * it). See docs/plans/260826a-chat-mode.md, and note what it replaces: in a mode, the
 * gist columns are not squeezed, they are *gone*, so this is not a fourth term
 * in the shrink-then-drop negotiation. It is what the negotiation is about
 * instead.
 *
 * Wider than a gist column because it holds a conversation rather than a
 * sentence: an answer at 176px would be four words a line. It still yields to
 * the prose — `PROSE_MIN` wins, and the band shrinks to `MODE_MIN` before the
 * reading column gives up a pixel.
 */
export const MODE_IDEAL = 400; // 25rem
export const MODE_MIN = 288; // 18rem — narrower and an answer stops reading as prose

export type SpineMode = "on" | "off";

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
  /**
   * **How much horizontal room the mode band takes from the table.** Set as
   * `--mode-w` on `.reader`; every rule that has to make room for the band
   * reads it from there (styles.css § mode band).
   *
   * It is `0` in two cases, and reading it as "there is no band" is wrong in
   * the second: the table-of-contents mode, where there genuinely is no band —
   * and **a window under 844px, where there is one and it takes no room from
   * the table because it covers it instead** (`fitMode`). Ask `mode !== "hierarchy"`
   * if what you want to know is whether a band is open.
   */
  modeW: number;
  /**
   * **The article is the only thing on this page** — no gist column, no band,
   * just the prose across the whole window. Plain reaches it by handing
   * `fitView` no columns to fit, and it is where `PROSE_ALONE_MAX_REM` and the auto
   * margins in styles.css § plain, centred come in.
   *
   * **Not the same question as `table.only-prose`**, which TableView asks to
   * decide whether the table head is worth its 40px, and which a band mode also
   * answers yes to: there the prose is the table's only column but it is not
   * alone on the page, and the band already takes the space this would centre
   * into. Two facts, deliberately two names — `inMode` and `bandOpen` in
   * App.tsx are the same care.
   */
  alone: boolean;
}

/**
 * Is the prose column on screen?
 *
 * **A named rule because it was silently two rules.** `fitMode` reserves width
 * for the prose unconditionally and its comment said `showText` was ignored —
 * but "ignored" was only true of the arithmetic. App went on passing the
 * reader's own `showText` to TableView, so arriving in a mode from *outline*
 * mode (`?text=0`) rendered no gist cells, because a mode has none, and no
 * prose cells, because `showText` was false. The result was a chat panel beside
 * an entirely empty table, and every doc claiming the article is permanent was
 * false. Found by a GPT-5.6 review, 2026-08-26.
 *
 * So the rule gets one home and both callers read it: **in a mode the prose is
 * always on.** Outline mode is a way of looking at the table of contents, and
 * in a mode there is no table of contents to outline — what would be left is
 * nothing at all.
 */
export function proseVisible(showText: boolean, modeBand: boolean): boolean {
  return modeBand || showText;
}

function spineWidth(mode: SpineMode): number {
  return mode === "on" ? SPINE_W : 0;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The gist columns a reader may open, out of every gist depth the article has.
 *
 * **Depth 0 is not one of them, whoever asks.** Until 2026-09-05 it was merely
 * closed by automatic fit and still honoured from `?cols=`; Greg took the whole
 * column out — *"For Hierarchy mode, let's get rid of the 'Arg' button and
 * functionality altogether"* — so the exclusion moved in front of the reader's
 * choice as well. An old `?cols=0,1,2` therefore drops the `0` in silence and
 * opens 1 and 2: a link somebody saved is not an error, and a column with one
 * cell in it spanning the whole article was close to zero information per
 * pixel anyway ("I can't currently see any value to the L0 column", Greg —
 * granularity-zoom.md).
 *
 * **The arc artefact is not what left.** `src/arc.ts`, the `arc` job step and
 * `arc.json` all still run, and Outline mode still renders the arc sentence for
 * the part you are in. What went is the *column* in Hierarchy that used to draw
 * it — docs/plans/260905d-declutter-the-reading-view-top-bars.md § Decisions 5.
 *
 * Exported because two things have to agree about it: this file, which decides
 * which columns are on screen, and the pill row in App.tsx, which offers them.
 * A pill for a column the fit will never open is a control that does nothing.
 */
export function offerableGists(gistDepths: number[]): number[] {
  return gistDepths.filter((d) => d !== 0);
}

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
  /**
   * True when the middle band belongs to a mode rather than to the table of
   * contents — see `MODE_IDEAL`. The gist columns are dropped entirely and the
   * band takes their place.
   */
  modeBand?: boolean;
  /**
   * Whether the reader has said the rail should be on screen, or `null` for
   * automatic — see params.ts § spineParam.
   *
   * Three states rather than two, for the same reason `chosen` has three: a
   * reader who has hidden the rail and a reader who is in outline mode are both
   * looking at a page with no rail, and they want opposite things when the text
   * comes back. `false` also survives a trip through a mode, where the rail is
   * otherwise unconditional.
   *
   * On or off is now the whole of it: there is one rail rather than a labelled
   * one and a collapsed one, so the window width no longer has anything to say
   * about the spine.
   */
  showSpine?: boolean | null;
  /**
   * The root font size this page is painted at, in px — `useRootFontPx()` in
   * App.tsx, `DEFAULT_ROOT_PX` for anything that has no DOM to ask.
   *
   * Only `PROSE_ALONE_MAX_REM` needs it, and only because that one number is a
   * measure of type rather than of screen. Every other constant in this file is
   * a *screen* width — how narrow a gist still reads at, how much room a chat
   * answer needs — and those are px on purpose, because they are compared with
   * a window measured in px.
   */
  rootFontPx?: number;
}

export function fitView({
  windowWidth,
  gistDepths,
  leafDepth,
  showText,
  chosen,
  modeBand = false,
  showSpine = null,
  rootFontPx = DEFAULT_ROOT_PX,
}: FitInput): Fit {
  /* A mode owns the middle band, so there are no gist columns to fit and no
     choice for the reader to have made about them. Handled first and returned
     early rather than woven into the arithmetic below, because every line of
     that arithmetic is about a negotiation that does not happen here — and a
     `modeBand &&` on each of them would be five chances to get one wrong.

     Note what this does NOT do: it does not consult `chosen`. `?cols=` survives
     the trip through chat untouched and means what it always meant when the
     reader comes back. */
  if (modeBand) return fitMode(windowWidth, showSpine);

  // Outline mode has no prose; the leaf column is the detail column, and it
  // holds nav labels rather than paragraphs, so it needs far less room.
  const detailMin = showText ? PROSE_MIN : GIST_IDEAL;

  /**
   * How many gist columns survive auto-fit in `avail` px.
   *
   * **It may return zero, and until 2026-08-27 it could not.** The loop stopped
   * at one, on the reasoning that "a single gist beside the prose is the point
   * of the view, so we overflow rather than lose it". That is true of a laptop
   * and false of a phone: below `GIST_MIN + PROSE_MIN` (720px) the promise to
   * keep one gist and the promise to give the prose 544px cannot both be kept,
   * so the table became wider than the window and the page scrolled sideways —
   * measured at 390px, a 720px table in which every line of prose was cut
   * mid-word. Reading a line by scrolling to it is not a worse trade-off, it is
   * a failure.
   *
   * So the rule this file already states is followed one step further: shrink
   * first, drop second, and **drop all the way to zero when zero is what fits**.
   * There is no new breakpoint — the crossover falls out of the two constants
   * that were already here, which is why the same change improves a 700px
   * laptop window for the same reason it rescues a phone.
   *
   * **What the reader loses on a phone is real, and it is bought back by a
   * switch rather than by a scroll.** Two coarse views are one tap away and
   * both are full-screen on a narrow window: outline mode (the `Text` pill) is
   * the paragraph outline at full width, and Summary mode is the article at
   * whichever length you ask for. The whole-article gist is in the masthead as
   * ordinary text. So the horizontal axis stops being a scroll and becomes a
   * switch — which is what the `Text` toggle already was.
   *
   * **The spine is not part of that answer, though the obvious sentence says it
   * is.** An earlier version of this comment claimed the coarse levels are what
   * the rail already shows. They are not, on this device: the rail is 12px of
   * slivers and every name, gist and count it carries lives in a *hover* card
   * (Spine.tsx), which a finger cannot open. A touch reader gets the rail's
   * shape and its jumps and none of its words. GPT Sol caught the claim,
   * 2026-08-27.
   *
   * Whether a phone should also stack the current section's gist above the
   * prose — orientation without a mode switch — is a design question for Greg
   * rather than something to decide here. docs/plans/260827t-mobile-reading-view.md
   * § Open for Greg.
   *
   * Takes `maxN` rather than always starting from `gistDepths.length`, because
   * the pool it is choosing among is `offerableGists` rather than the
   * article's full depth range — smaller by one on every article that has an
   * L0 at all.
   */
  const gistsThatFit = (avail: number, maxN: number) => {
    let n = maxN;
    while (n > 0 && n * GIST_MIN + detailMin > avail) n--;
    return n;
  };

  /**
   * **The rail is on unless the URL says otherwise** — Greg, 2026-09-05: "we
   * don't need the 'Spine' button (let's just default to always showing it)".
   * The pill that asked the question went with the rest of the controls bar
   * (docs/plans/260905d-declutter-the-reading-view-top-bars.md), so nothing on
   * screen can turn the rail on any more and a default of "off" would be a
   * state the reader has no way out of. `?spine=0` still wins outright — same
   * rule `chosen` follows, that the window must not overrule a choice somebody
   * made — which is why the parameter stays three-state rather than boolean.
   *
   * **What this overrules, and it was a real argument**: until 2026-09-05 the
   * default was `showSpine ?? showText`, on the reasoning that in outline mode
   * the table *is* a whole-article overview, so a bird's-eye rail beside it is
   * a second copy of the same thing and the 12px is better spent on the
   * columns. Still true, and now outweighed by the rail being unaskable-for.
   *
   * The window width is not consulted at all, and used to be: the rail had a
   * labelled 13rem form that appeared when it was affordable, and deciding
   * *when* was the fiddliest arithmetic in this file. One width means the
   * question no longer exists — the rail is 12px at every size, so there is no
   * width at which it fails to fit.
   *
   * Note this is now the same rule `fitMode` follows, phrased the same way.
   */
  const spine: SpineMode = (showSpine ?? true) ? "on" : "off";
  const avail = Math.max(0, windowWidth - spineWidth(spine));

  /**
   * The choice, out of the columns there are to choose from — and `?cols=`
   * cannot reach past that pool, which is the whole of what changed on
   * 2026-09-05. See `offerableGists`.
   */
  const offerable = offerableGists(gistDepths);
  let gists = chosen === null ? offerable : offerable.filter((d) => chosen.includes(d));

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
    /* Within what's left after L0 is excluded above, drop the *finest* level
     * first — the opposite direction from the old rule, and deliberate: Greg
     * reported landing on a narrow window (`?cols=1,2` on an iPad) and wanting
     * L1 and L2 by default, and squeezed to one column that has to be L1 —
     * L2's whole point is being the finest-grained context, which is the
     * first thing worth losing on a screen too narrow for both. `gists` is
     * ascending (coarse to fine) with L0 already gone, so keeping the front
     * keeps the coarser survivors. See `gistsThatFit` for why the floor is
     * zero rather than one. */
    gists = gists.slice(0, gistsThatFit(avail, gists.length));
  }

  // Fixed-width columns: the gists, plus the leaf column when it is riding
  // alongside the prose rather than standing in for it.
  const fixedCount = gists.length + (leafBesideText ? 1 : 0);
  const gistW =
    fixedCount === 0
      ? 0
      : clamp(Math.floor((avail - detailMin) / fixedCount), GIST_MIN, GIST_IDEAL);
  /**
   * **A minimum that protects nothing is not a minimum.**
   *
   * `detailMin` exists to stop the gist columns squeezing the reading column,
   * and dropping the last gist to zero (above) was only half the fix without
   * this line: at 390px the table came out `0 + 544` and the page went on
   * scrolling sideways, because the floor was still being applied to a column
   * that had nothing left to be protected from.
   *
   * So the floor yields to the window itself. Note where it does *not* bite: it
   * is `min(detailMin, avail)`, so it changes nothing whenever the window is at
   * least as wide as the prose minimum — including the case the file promises
   * to leave alone, a manual `?cols=` that does not fit. A reader who asks for
   * four columns on a 900px window still gets four columns and still overflows.
   * Only a window narrower than one reading column is affected, and there the
   * alternative is not a wider column, it is a column you scroll to read.
   */
  const detailW = Math.max(Math.min(detailMin, avail), avail - fixedCount * gistW);

  /**
   * **When the prose is the only column, it stops growing at the measure.**
   *
   * Everything above is a negotiation between columns, and with one column
   * there is nothing to negotiate: `detailW` came out as the whole window, and
   * a 1588px cell holding a 738px measure is 850px of empty page rather than a
   * wide reading column. See `PROSE_ALONE_MAX_REM` for why the cap is phrased as
   * "alone" rather than "Plain", `proseAloneMaxPx` for why it is a function of
   * the root rather than one number, and styles.css § plain, centred for the
   * auto margins that put the leftover on both sides instead of one.
   *
   * Outline mode is excluded by `showText`: its lone column is nav labels, not
   * prose, and `--reading-measure` has nothing to say about those.
   */
  const alone = fixedCount === 0 && showText;
  const columnW = alone
    ? Math.min(detailW, proseAloneMaxPx(rootFontPx))
    : detailW;

  const widths = [...Array<number>(fixedCount).fill(gistW), columnW];
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
    modeW: 0,
    alone,
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
 *  - **The prose wins.** The band shrinks from `MODE_IDEAL` to `MODE_MIN`
 *    before the reading column drops below `PROSE_MIN`, and past that the page
 *    overflows and scrolls rather than either of them getting narrower. Same
 *    order of preference the ToC layout has: the article is what is being read.
 *  - **The prose is always on**, which is `proseVisible`'s job rather than this
 *    function's. It used to be asserted here and nowhere else, and that is
 *    exactly how the outline-mode bug got in: a comment claiming a fact the
 *    only other caller did not know about.
 */
function fitMode(windowWidth: number, showSpine: boolean | null = null): Fit {
  const spine: SpineMode = showSpine === false ? "off" : "on";
  const avail = Math.max(0, windowWidth - spineWidth(spine));

  /**
   * **Below `MODE_MIN + PROSE_MIN` the band stops taking room from the article
   * and covers it instead.**
   *
   * The negotiation below has an implied floor and no behaviour underneath it:
   * both terms bottom out, so at 390px this function used to return a 288px
   * band beside a 544px column and ask a 390px window for 832px of content.
   * Opening chat on a phone put two half-visible panels side by side and
   * neither of them could be read.
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
   * The prose does not go away, for the reason `proseVisible` exists: a mode
   * with no article behind it is how the outline-mode bug produced an empty
   * table beside a chat panel. It is still there, still full width, one tap on
   * the dock's Hierarchy button away.
   */
  /**
   * **This crossover is conditional, and since 2026-09-03 nothing else tries to
   * guess it.**
   *
   * `avail` is the window minus the rail, so the width at which the band stops
   * fitting beside the prose depends on whether the rail is there: 844 with it,
   * 832 without. `styles.css` § a band with no room used to be a plain
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
   */
  if (MODE_MIN + PROSE_MIN > avail) {
    return {
      columns: [],
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
    };
  }

  const modeW = clamp(avail - PROSE_MIN, MODE_MIN, MODE_IDEAL);
  const proseW = Math.max(PROSE_MIN, avail - modeW);
  return {
    // The table is the prose column and nothing else. Its own `pin-left` and
    // `pin-right` land on the same single column, which is what they already do
    // in outline mode with one level.
    columns: [],
    widths: [proseW],
    tableW: proseW,
    overflowing: modeW + proseW > avail,
    minWidth: spineWidth(spine) + modeW + proseW,
    spine,
    modeW,
    alone: false,
  };
}
