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

/**
 * px at a 16px root. Mirrors --spine-w in styles.css; change both together.
 *
 * One width, not two. There used to be a labelled 13rem rail as well, shown
 * whenever the window could afford it — Greg took it out on 2026-08-26, so the
 * rail is now always the collapsed one. That deletes a whole negotiation from
 * this file (labels-versus-a-gist-column, and the non-monotonic fit it caused)
 * and leaves the spine as a fixed 24px the layout simply subtracts.
 */
const SPINE_W = 24; // 1.5rem

const GIST_IDEAL = 240; // 15rem — comfortable for a one-sentence gist
const GIST_MIN = 176; // 11rem — the narrowest a gist still reads at
const PROSE_MIN = 544; // 34rem — the narrowest the reading column may be

/**
 * The **mode band** — the strip between the spine and the prose when the middle
 * is something other than the table of contents (chat, and whatever comes after
 * it). See docs/plans/chat-mode.md, and note what it replaces: in a mode, the
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
   * and **a window under 856px, where there is one and it takes no room from
   * the table because it covers it instead** (`fitMode`). Ask `mode !== "toc"`
   * if what you want to know is whether a band is open.
   */
  modeW: number;
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

export function spineWidth(mode: SpineMode): number {
  return mode === "on" ? SPINE_W : 0;
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
}

export function fitView({
  windowWidth,
  gistDepths,
  leafDepth,
  showText,
  chosen,
  modeBand = false,
  showSpine = null,
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
   * the rail already shows. They are not, on this device: the rail is 24px of
   * slivers and every name, gist and count it carries lives in a *hover* card
   * (Spine.tsx), which a finger cannot open. A touch reader gets the rail's
   * shape and its jumps and none of its words. GPT Sol caught the claim,
   * 2026-08-27.
   *
   * Whether a phone should also stack the current section's gist above the
   * prose — orientation without a mode switch — is a design question for Greg
   * rather than something to decide here. docs/plans/mobile-reading-view.md
   * § Open for Greg.
   */
  const gistsThatFit = (avail: number) => {
    let n = gistDepths.length;
    while (n > 0 && n * GIST_MIN + detailMin > avail) n--;
    return n;
  };

  /**
   * In outline mode the table *is* a whole-article overview, so a bird's-eye
   * rail beside it would be a second copy of the same thing; the space goes
   * back to the columns instead. That is what the reader gets by default, and
   * `showSpine` is how they say otherwise in either direction.
   *
   * Automatic is therefore "on wherever there is prose", which is that rule
   * written as one word. An explicit `?spine=` wins outright, both ways: the
   * reader may keep the rail in outline mode, and may take it away in reading
   * mode. Same rule `chosen` follows — the window must not overrule a choice
   * somebody made.
   *
   * The window width is not consulted at all, and used to be: the rail had a
   * labelled 13rem form that appeared when it was affordable, and deciding
   * *when* was the fiddliest arithmetic in this file. One width means the
   * question no longer exists.
   */
  const spine: SpineMode = (showSpine ?? showText) ? "on" : "off";
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
    // Drop the coarsest first — see `gistsThatFit` for why the floor is zero
    // rather than one.
    gists = gists.slice(gists.length - gistsThatFit(avail));
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
    modeW: 0,
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
   * band beside a 544px column and ask a 390px window for 856px of content.
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
   * the dock's Contents button away.
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
  };
}
