/**
 * The quotes, in the band between the spine and the prose — the tenth mode.
 *
 * Greg, 2026-08-31, asking for it:
 *
 * > Create a "Quotes" mode that extracts the most central, helpful, interesting
 * > quotes. By default, display them in order. But also have a sub-mode for
 * > ordering them by importance, and a sub-mode for ordering by how
 * > memorable/interesting/striking/lyrical/etc. And add a threshold UI bar, and
 * > a Prioritised mode. Take inspiration from the Glossary mode.
 *
 * The glossary next door answers *what does this word mean*; the ideas answer
 * *what do I have to hold*. This answers *which lines are worth carrying out of
 * here* — and it is the only one of the three whose list is **the article
 * itself**. Full design in docs/plans/260831j-quotes-mode.md.
 *
 * ## Everything in the list is the article's, except two numbers
 *
 * That is the shape of this panel and the reason it is worth having. A row is a
 * sentence out of the piece, verified verbatim against the block it came from
 * (src/quotes.ts § the safety property), and the only things beside it are the
 * model's two scores — drawn as bars, labelled as judgment — and a caption
 * behind a button.
 *
 * *The article's*, not *the author's*: `authorVoice` in src/quotes.ts refuses a
 * block quotation and a span inside quotation marks, and that is as far as
 * block text lets anyone go. The promise matches what the check can prove.
 *
 * **The caption is behind a button because of where it fails.** Asked *why this
 * quote*, the obvious answer is a description of the page the reader is looking
 * at — *"the author says here that…"* — which is the register the glossary
 * spent a whole rewrite fixing in `senseHere`, and here it is not merely
 * tempting but the natural reading of the question. Greg's call was *"with
 * reason as a tooltip"*, so the list a reader scans is prose and nothing else.
 *
 * The **button** rather than a tooltip on the row is GPT Sol's amendment,
 * 2026-08-31, and it is about touch: an uncontrolled hover tooltip does not
 * exist on a device with no pointer, and nesting a trigger inside the row's own
 * button is invalid. So there is a small ⓘ beside each row — hover or focus
 * opens it, a tap pins it — and the row itself stays one big target.
 *
 * ## What this panel does NOT own
 *
 * The marks in the prose and the lane in the rail. **And since 2026-09-08 nor
 * does the band** — `useQuoteMarks` in src/web/reader/useQuoteMarks.ts resolves
 * them in `Reader`, because they are drawn in every mode and marks published by
 * a band live exactly as long as the band. What keeps this panel and the prose
 * agreeing is that both call `markedQuotes` below.
 * docs/plans/260908i-quotes-marked-in-the-prose-in-every-mode.md.
 */
import { useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { ChevronLeft, ChevronRight, Info, Pencil, Quote as QuoteIcon, RotateCcw, TriangleAlert } from "lucide-react";
import type { BlockId, Job, Quote, QuoteDrops, Quotes, QuoteStroke, QuoteTier } from "../types.js";
import { quotesAppendOnOffer, quotesFindMoreOffered } from "./find-more.js";
import { useFindMoreHandOff } from "./useFindMoreHandOff.js";
import type { QuoteRank } from "./params.js";
import type { UseQuotes } from "./useQuotes.js";
import type { StepFailure } from "./useStepJob.js";
import { BlockRef } from "./BlockRef.js";
import { ScoreBars } from "./ScoreBars.js";
import { OrderGroup } from "./OrderGroup.js";
import { Tooltip, TooltipGroup } from "./Tooltip.js";
import { StepTip } from "./StepTip.js";
import { builtButEmpty } from "../messages.js";
import { JobProgress } from "./JobProgress.js";
import { ModeSurface } from "./ModeSurface.js";
import { AboutMade } from "./BandAbout.js";
import { ReadError } from "./ReadError.js";
import { RewriteWaiting } from "./RewriteWaiting.js";
import { WrittenForYou } from "./WrittenForYou.js";
import { useRenderCount } from "./perf.js";
import { applyThreshold, floorToGateStep, hiddenNote, type ThresholdResult } from "./threshold.js";
import {
  aiProvenance,
  quoteBandRows,
  readerProvenance,
  withYours,
  type ReaderRowComment,
} from "./quote-band-rows.js";
import { BandWaiting } from "./BandWaiting.js";

/**
 * **The owner's half of this panel** — the read's status, the job choosing the
 * quotes, and the one verb.
 *
 * Absent for a visitor. GlossaryPanel.tsx § GlossaryOwner has the argument for
 * one panel with its data injected rather than two panels for one list.
 */
export type QuotesOwner = UseQuotes;

/**
 * **Who is reading, and the list they get — one prop, so the two cannot
 * disagree.** The argument is in GlossaryPanel.tsx § GlossaryAccess, including
 * why `owner?: never` is load-bearing rather than tidiness: without it the union
 * catches only a fresh object literal at the call site, so the same object built
 * in a variable first would typecheck with an owner hook riding inside a
 * visitor's arm.
 */
export type QuotesAccess =
  | { kind: "owner"; owner: QuotesOwner; quotes: QuoteList | null; yours?: ReaderHighlights }
  | { kind: "visitor"; quotes: QuoteList; owner?: never; yours?: never };

/**
 * **The reader's own highlights, as rows among the quotes** — Greg, 2026-10-03
 * (spya-ma5h9b): *"highlights show up alongside quotes."* src/web/quote-band-rows.ts.
 *
 * **On the owner arm only, and `yours?: never` on the other is the gate.** A
 * visitor's page carries comments too — the sharer's, public by their choice —
 * and showing those here is a product call nobody has made (what would the row
 * say: *the sharer's highlight*?). So it is not something a careless
 * `comments={comments}` can turn on: `Reader` builds this from the owner
 * capability and the type refuses it anywhere else. GPT Sol, 261003h Q6.
 *
 * Optional, absent meaning none — the band before the comments read lands.
 */
export interface ReaderHighlights {
  /** `readerRowComments` over the owner's comments. */
  rows: readonly ReaderRowComment[];
  /** The article's blocks in reading order, which is all the interleave needs. */
  blocks: readonly { id: BlockId }[];
  /** Go to the highlight and open its comment — `jumpToComment`, from `Reader`. */
  onOpen(id: string): void;
}

/**
 * The list this panel draws, from either side of the owner/visitor line.
 *
 * `discarded` is on both, which is the point: the disclosure under the bar is a
 * fact about the list on screen rather than about our pipeline, so a visitor
 * gets it too. src/public-types.ts § PublicQuotes has the argument.
 */
type QuoteList = {
  quotes: Quote[];
  discarded?: QuoteDrops;
  /**
   * When the list was last written. Only for a quote with no `addedAt` of its
   * own, whose card says *on or before* this. On both arms: the public
   * projection carries it for exactly that line (src/public-types.ts).
   */
  generatedAt?: string;
};

interface Props {
  access: QuotesAccess;
  /** Which quote is selected, from `?quote=`. */
  quoteId: string | null;
  onQuote(id: string | null): void;
  rank: QuoteRank;
  onRank(rank: QuoteRank): void;
  /**
   * Where the reader has put the bar, or null for "hasn't touched it" — which
   * is `QUOTE_BAR_DEFAULT`. The distinction is kept all the way from the URL
   * (`barParam` in params.ts) so that the default stays one number in one file.
   */
  bar: number | null;
  onBar(bar: number | null): void;
  /** Jump the article to a block, exactly as a gist cell does. */
  onJump(id: BlockId): void;
  /**
   * **What ‹ › step through**: the rows this panel shows, less any whose block
   * is gone — `useQuoteMarks`' `steppable`, which ← / → use too, so the buttons
   * and the keys walk one list. From `Reader` because only it has resolved the
   * marks; the panel never sees the blocks.
   */
  steps: readonly Quote[];
}

/* -------------------------------------------------------------- the scores --

   Two scores, and they are combined with `max` rather than with the glossary's
   product. Greg chose it on 2026-08-31 from three options drawn out at the size
   the difference is visible, and the argument is worth having here because
   several of the glossary's decisions were justified by properties of a product
   and do NOT carry over:

   **The glossary multiplies because its two scores are factors of one
   quantity** — `difficulty × centrality` is the cost of not knowing a term, and
   a term that is easy, or peripheral, has no such cost.

   **These two are separate reasons to keep a line.** A product gets that
   backwards: it would push the essay's thesis sentence below the fold for being
   plainly written, and drop the line you would tattoo on your arm for being an
   aside. `max` keeps a quote for being strongly one thing, which is what a
   quote is for.

   > what this gets right: a line can earn its place for ONE good reason.
   >
   > — the option Greg picked, 2026-08-31 */

/**
 * The bar's **starting** position: `max(importance, striking)`.
 *
 * `0.70` where the glossary's `PRIORITY_GATE` is `0.30`, and the difference is
 * arithmetic rather than taste: **a product of two 0–1 scores clusters low and
 * a maximum clusters high.** Two scores of 0.7 make 0.49 under a product and
 * 0.70 under a maximum, so a bar copied across from the glossary would hide
 * nothing at all.
 *
 * **`0.70` was a guess with nothing behind it**, which GPT Sol was right to
 * press on. There is now one measurement, and it moved the number.
 *
 * The first real run — `data/openai-huggingface`, 4,192 words, five quotes kept
 * — came back with `max(importance, striking)` of `0.70`, `0.75`, `0.75`,
 * `0.85` and `0.90`. At `0.70` **every quote survived the bar**, so the default
 * hid nothing and the panel opened on a note saying so. The clustering is
 * exactly what the argument above predicts and the starting position was simply
 * too low for it.
 *
 * `0.80` kept two of those five. **It was one article**, so a better-supported
 * guess rather than a measurement.
 *
 * **`0.60` since 2026-09-15**, at Greg's request that every prioritised bar let
 * most entries in by default. Measured on the four local quote lists, with the
 * snap below modelled: `0.80` showed 56% of a list on average, `0.60` shows 85%
 * (95% on the median list) and still holds the weakest tail back.
 * docs/plans/260915d-prioritised-by-default-in-search-and-lower-default-thresholds-everywhere.md.
 * Still well above the glossary's `0.10`, for the arithmetic reason above.
 *
 * `snapToStop` resolves a tie **downwards**, towards the lower score and so
 * towards showing more. That is the safer direction for a reference list: a
 * slightly generous list costs a reader a glance, where an empty one costs them
 * the feature.
 */
export const QUOTE_BAR_DEFAULT = 0.6;

/**
 * **The positions the bar can take: every score the list actually contains.**
 *
 * A discrete track rather than a continuous one, and it replaced a `0.05`-step
 * slider after GPT Sol showed the continuous version could not keep its own
 * promises. Three failures, all the same thing — a track whose positions are
 * arithmetic rather than data:
 *
 *  1. **The right-hand end kept a *band*, not the top.** It was the top score
 *     rounded down to the step, so priorities of `.62`, `.61` and `.20` gave an
 *     end of `.60` — which keeps two quotes that are not tied and calls them
 *     the top-scored ones.
 *  2. **`?bar=0.63` was accepted against a `step=0.05` track**, so a link could
 *     put the thumb where it could not be dragged.
 *  3. **Most positions changed nothing.** Between two real scores there is
 *     nothing to hide, so most of a drag was dead travel with a number moving
 *     over it.
 *
 * **The synthetic `0` went on 2026-09-03, and it is the subtle half of that
 * change.** While the bar grouped, `0` was a real position: it emptied "the
 * rest" into the top group. Now that it hides, `0` and the *lowest real score*
 * show exactly the same list — every score is `>= 0`, and the unscored survive
 * everywhere — so the first step of the drag would have been the no-op this
 * function exists to prevent. The list's own scores are the whole track, and
 * every adjacent pair of stops therefore differs by at least the quote (or
 * quotes) sitting on the lower one.
 *
 * `[0]` when nothing is scored, so the input still has a track to render;
 * `canPrioritise` is false there and the slider is not drawn anyway.
 *
 * Ascending — the bar reads as *how high*, so left is low. `barStops` is
 * exported because the panel, the slider and `canPrioritise` all ask it, and
 * three copies of "which positions exist" is how the count under the reader's
 * hand comes to disagree with the list under it.
 */
export function barStops(quotes: readonly Quote[]): number[] {
  const seen = new Set<number>();
  for (const quote of quotes) {
    const p = priorityOf(quote);
    if (p !== undefined) seen.add(p);
  }
  return seen.size === 0 ? [0] : [...seen].sort((a, b) => a - b);
}

/**
 * The nearest real stop to a number that arrived from anywhere.
 *
 * `?bar=` is a plain number in the URL and has to stay one — a link written
 * before an article was re-run, or typed by hand, or carried from a different
 * article, will not land on this list's stops. Snapping means such a link opens
 * on a division that exists rather than between two of them, and it is what
 * closes the off-grid hole above.
 *
 * Nearest rather than "the largest stop at or below": a `?bar=` a whisker above
 * the top score would otherwise fall all the way back to the second-highest,
 * which is a bigger lie than rounding.
 */
export function snapToStop(stops: number[], bar: number): number {
  let best = stops[0] ?? 0;
  for (const stop of stops) {
    if (Math.abs(stop - bar) < Math.abs(best - bar)) best = stop;
  }
  return best;
}

/**
 * `max(importance, striking)` over whichever of the two the model returned, or
 * nothing at all if it returned neither.
 *
 * **A missing score is skipped rather than read as zero, and under `max` that
 * is safe in a way it is not under a product.** A maximum over a subset can only
 * be *lower* than the maximum over both — so a quote scored on one axis can be
 * ranked below where it belongs and never above it, which is the direction an
 * honest default has to fail in. (Under a product a missing factor is fatal
 * rather than conservative, which is why the glossary computes nothing at all
 * for a half-scored entry and lets `survivesThreshold` show it — threshold.ts.)
 */
export function priorityOf(quote: Quote): number | undefined {
  const scores = [quote.importance, quote.striking].filter(
    (n): n is number => n !== undefined,
  );
  return scores.length === 0 ? undefined : Math.max(...scores);
}

/**
 * The priority the heavy stroke starts at — **its own number, not the bar's**,
 * since 2026-09-15.
 *
 * It was `QUOTE_BAR_DEFAULT`, so every quote the resting bar kept was heavy.
 * When the bar came down to `0.60`, keeping the tie would have left the
 * stroke's two-tier split idle in exactly the state most readers see, visible
 * only once somebody dragged the bar. At `0.80`, the quotes between the bar and
 * here draw light beside the heavy ones on first open.
 *
 * What the two controls still agree on is **order**: raising the bar removes
 * scored light quotes before scored heavy ones, because both read `priorityOf`.
 * Not "what survives is exactly the heavy fills" — the bar snaps to real
 * scores, so there may be no stop at `0.80`, and an unscored quote survives
 * every bar while drawing light. docs/project/quotes.md § A highlighter pen.
 */
export const QUOTE_HEAVY_AT = 0.8;

/**
 * How heavily this quote is drawn in the prose — the priority the reader can see
 * without opening the panel. docs/project/quotes.md § A highlighter pen.
 *
 * **`priorityOf`, not `importance`.** Greg asked for *"an indicator of the Quote
 * priority"*, and `priorityOf` is what `?bar=` already thresholds on. Driving the
 * fill from `importance` alone would let the two disagree — raising the bar
 * could hide a heavy fill and leave a light one on the page, which reads as a
 * bug in the feature whose whole job is to say what matters. On this the bar and
 * the fill are the same statement.
 *
 * **A quote with no score at all is light, not absent.** It has earned no
 * emphasis, but it must still be drawn: a quote scored on neither axis survives
 * every position of the bar (docs/project/quotes.md § The bar hides what is
 * below it), so an unmarked one would be a row in the panel with nothing in the
 * prose — the precise failure `threshold.ts` exists to prevent.
 */
export function quoteTier(quote: Quote): QuoteTier {
  const priority = priorityOf(quote);
  return priority !== undefined && priority >= QUOTE_HEAVY_AT ? 2 : 1;
}

/**
 * The faintest a quote is ever drawn. **This is where "even low-priority
 * quotes should still be clearly visible" is kept** — Greg,
 * SPIDERYARN-READING2-2W — and it is checked rather than felt.
 * tests/quote-fill.test.ts composites the quote colour at this alpha over
 * `--page`, in both themes, twice: as the spine's thin strip, which must clear
 * 3:1, WCAG's floor for a non-text mark; and, times the light tier's strength,
 * as the faintest fill in the prose, which must still differ from the page.
 * (Until 2026-10-03 the mark in the prose was a 1px outline at this alpha.)
 */
export const QUOTE_ALPHA_FLOOR = 0.7;

/** The priority at and below which a quote is drawn at `QUOTE_ALPHA_FLOOR`. */
const QUOTE_FADE_FROM = 0.5;

/**
 * **How brightly this quote is drawn: 0.70 to 1.00, with priority.** The
 * fine channel beside the tier's coarse one. It scales the fill's strength
 * since 2026-10-03, and the outline's alpha before that — Greg, 2026-09-10:
 *
 * > perhaps slightly fade the border based on the priority-score (but even
 * > low-priority quotes should still be clearly visible)
 *
 * **Tier and fade move the same way, so they reinforce rather than
 * cancel.** A higher priority has a stronger tier *and* a brighter fade;
 * `quoteTier` keeps the coarse step — two levels, because the earlier stroke
 * test found a third indistinguishable — and this is
 * the continuous one inside and across them, which nobody has to identify
 * pairwise: it is an impression across a page. 260907c's acceptance pass had
 * already found that *"the priority does help skimming — but through
 * brightness more than thickness"*, and this spends that finding.
 *
 * `priorityOf`, like the weight and the bar, so raising the bar still takes
 * away the faintest and lightest first. Unscored is the floor: visible,
 * claiming nothing — the argument `quoteTier` makes for drawing it light.
 * docs/plans/260911a-quotes-find-more-and-a-fade-that-carries-priority.md § 1.
 */
export function quoteAlpha(quote: Quote): number {
  const priority = priorityOf(quote);
  if (priority === undefined) return QUOTE_ALPHA_FLOOR;
  const along = Math.min(1, Math.max(0, (priority - QUOTE_FADE_FROM) / (1 - QUOTE_FADE_FROM)));
  return Math.round((QUOTE_ALPHA_FLOOR + (1 - QUOTE_ALPHA_FLOOR) * along) * 100) / 100;
}

/** Tier and brightness together — still named `QuoteStroke` — which is what crosses into the marks. */
export function quoteStroke(quote: Quote): QuoteStroke {
  return { tier: quoteTier(quote), alpha: quoteAlpha(quote) };
}

/**
 * The bar applied to the list, once: the quotes to draw, and how many went.
 *
 * **Everything the panel prints comes out of this one result** — the list, the
 * `N of M` beside the slider, the foot line, and whether the list is empty. A
 * count that disagrees with the list under it is the failure the shared module
 * exists to make impossible; see threshold.ts for the argument and for why an
 * unscored quote survives every position of the bar.
 */
export function visibleQuotes(
  quotes: readonly Quote[],
  bar: number,
): ThresholdResult<Quote> {
  return applyThreshold(quotes, bar, priorityOf);
}

/**
 * Can this list be prioritised **at all** — is there anything to bar?
 *
 * **Two distinct scored priorities**, which is exactly `barStops(quotes).length
 * >= 2`: the stops *are* the distinct scores, so the question "is there more
 * than one position of the slider" and the question "does any position hide
 * something" are the same question. With one stop, the bar sits on the lowest
 * score, every scored quote is at or above it, and the unscored survive
 * anyway — nothing the reader can do would change the list.
 *
 * It used to be *some stop splits the list*, over a track that began at a
 * synthetic `0`. That was the right question while the bar grouped, and it
 * gives the wrong answer now in one specific place: `[0.90, unscored]` split at
 * `0.90` because the unscored quote formed *"the rest"*, so the order was
 * offered — but once the unscored quote always survives, no position hides
 * anything and the mode would advertise an order that visibly does nothing.
 *
 * Note what this is *not*: it is not "does the current bar hide anything",
 * which is a question about one position of the slider. Offering the order is
 * the first question — and a bar that hides nothing right now is one drag from
 * hiding something, which is why `effectiveRank` does not fall back on it.
 */
export function canPrioritise(quotes: readonly Quote[]): boolean {
  return barStops(quotes).length > 1;
}

/**
 * The order actually in force, which is not always the one in the URL.
 *
 * `?rank=prioritised` can arrive on a list with no scores at all — from a link,
 * or from an artefact written before the model was asked for them. There is
 * nothing to bar, no slider worth showing and a label that would claim a
 * judgment nothing supports, so it falls back to `document` and `RankBar` does
 * not offer the control.
 *
 * **A list that has scores but whose current bar hides nothing does NOT fall
 * back**, which is the glossary's own hard-won rule (`effectiveSort`):
 * cancelling would take the slider away with it and strand a reader mid-drag,
 * and a list nothing is hidden from is not silent — the bar is on screen with
 * its number and its count and the foot line says how many are hidden,
 * including when the answer is none.
 */
export function effectiveRank(quotes: Quote[], rank: QuoteRank): QuoteRank {
  if (rank !== "prioritised") return rank;
  return canPrioritise(quotes) ? "prioritised" : "document";
}

/**
 * The foot line: how many quotes the bar is holding back, and the way back.
 *
 * Greg's call of 2026-09-03, applied here as well as next door: the bar hides
 * rather than groups, and it says how many. **Never null** — the old `barNote`
 * spoke only at the two ends, which made an absent line ambiguous; this one is
 * present wherever the slider is, saying "Nothing is hidden" when that is the
 * answer. A control that visibly does nothing is the failure this codebase
 * keeps writing down (docs/reusable/silent-success.md).
 *
 * **It takes the counts, not the list**, so the sentence and the `N of M` above
 * it come out of the same `visibleQuotes` call rather than two passes that
 * could disagree.
 *
 * Note that dragging cannot reach the all-hidden state here: the top stop is a
 * real quote's score, and that quote therefore always survives. The sentence
 * exists anyway, because `?bar=` is a number in a URL.
 */
export function barNote(hidden: number, total: number): string {
  return hiddenNote(hidden, total, { one: "quote", many: "quotes" });
}

/**
 * What the stage refused to store, in a sentence — or nothing when it refused
 * nothing.
 *
 * **The reader is entitled to this and a log line does not give it to them.**
 * A list quietly shorter than the model produced is the shape of failure
 * docs/reusable/silent-success.md keeps catching, and `unfound` in particular is
 * a fact about *this* list: the model offered words that are not in the piece.
 * GPT Sol asked for it in review, 2026-08-31.
 *
 * Only `unfound` and `otherVoice` are said out loud. The other four —
 * a length outside the bounds, an overlap, a list past the cap, a malformed
 * entry — are editorial rules or internal failures the reader has no stake in,
 * and naming them would turn an honest disclosure into a changelog.
 */
export function discardedNote(drops: QuoteDrops | undefined): string | null {
  if (!drops) return null;
  const parts: string[] = [];
  if (drops.unfound > 0) {
    parts.push(
      `${drops.unfound} ${drops.unfound === 1 ? "suggestion was" : "suggestions were"} dropped ` +
        "because the words are not in the article",
    );
  }
  if (drops.otherVoice > 0) {
    /* **"appeared as a quotation", not "quoted from somewhere else."** The
       second is a claim about authorship and we cannot make it: an author
       quoting their own earlier work lands in this counter too, and the whole
       reason `authorVoice` refuses a blockquote is that we *cannot tell those
       apart*. Saying what we observed rather than what we inferred is the same
       discipline the mode's own promise follows. GPT Sol, 2026-08-31. */
    parts.push(
      `${drops.otherVoice} ${drops.otherVoice === 1 ? "was" : "were"} dropped for ` +
        "appearing as a quotation",
    );
  }
  return parts.length === 0 ? null : `${parts.join(", and ")}.`;
}

/**
 * The list in one flat order.
 *
 * `document` is the artefact's own order and the default — Greg's *"by default,
 * display them in order"*. The two score orders are descending, because
 * "most important first" and "most striking first" are the questions people
 * actually have. A missing score sorts **last** rather than as zero: a quote
 * the model declined to score is not one it scored as trivial, and treating the
 * two the same is the small lie that makes a sort untrustworthy.
 *
 * **`prioritised` is the one that returns fewer quotes than it was given.** It
 * is not a rank at all any more: it is the article's own order with what is
 * below the bar taken out, which is the whole of the 2026-09-03 change. One
 * call to `visibleQuotes`, so what this returns and what the count beside the
 * slider says cannot come apart.
 */
export function rankQuotes(quotes: Quote[], rank: QuoteRank, bar = QUOTE_BAR_DEFAULT): Quote[] {
  if (rank === "document") return quotes;
  if (rank === "prioritised") return visibleQuotes(quotes, bar).visible;
  const value = (quote: Quote): number | undefined =>
    rank === "importance" ? quote.importance : quote.striking;
  return [...quotes]
    .map((quote, i) => ({ quote, i, score: value(quote) }))
    .sort((a, b) => {
      if (a.score === undefined && b.score === undefined) return a.i - b.i;
      if (a.score === undefined) return 1;
      if (b.score === undefined) return -1;
      // The index tie-break keeps document order inside a run of equal scores,
      // so the list does not reshuffle for no visible reason.
      return b.score === a.score ? a.i - b.i : b.score - a.score;
    })
    .map((x) => x.quote);
}

/**
 * **What the panel is actually showing**, from the two raw URL parameters — the
 * one question the band and the prose must never answer separately.
 *
 * Three steps, and each is somebody's hard-won rule rather than a step:
 * `snapToStop` brings an arriving `?bar=` onto a position the slider can be
 * dragged to, `effectiveRank` falls back off `prioritised` on a list with
 * nothing to bar, and `rankQuotes` orders and — in `prioritised` alone — hides.
 * `null` is *nobody has touched the bar*, resolved here to `QUOTE_BAR_DEFAULT`,
 * which is what keeps the default one number in one file.
 *
 * **Extracted on 2026-09-05, when the prose started marking every visible
 * quote.** Until then the panel computed this and the band computed a *piece*
 * of it — enough to notice that the bar had hidden the selected row. Now the
 * Quotes' own marks are this exact list, so the panel and its marks have to be
 * asking one function: a row hidden by the bar with its wash still on the
 * paragraph is precisely the failure src/web/threshold.ts exists to prevent,
 * and it would arrive as two expressions that agreed until one was edited.
 */
export function markedQuotes(
  quotes: readonly Quote[],
  rank: QuoteRank,
  bar: number | null,
): Quote[] {
  const list = [...quotes];
  return rankQuotes(list, effectiveRank(list, rank), snapToStop(barStops(list), bar ?? QUOTE_BAR_DEFAULT));
}

/**
 * Lower a prioritised bar just enough to reveal `id`, or leave it alone.
 *
 * The prose normally cards only threshold-visible quotes. Skim can add its
 * current quote to the prose after the bar hid it; *open Quotes* must then
 * reveal that row before `useQuoteMarks`' `hiddenSelection` effect clears the
 * selection. This is Quotes' `gateToReveal` (GlossaryPanel.tsx): preserve the
 * chosen order, move the visible control, and floor to the URL's hundredth so
 * serialisation can never put the bar back above the quote.
 */
export function barToReveal(
  quotes: readonly Quote[],
  id: string,
  rank: QuoteRank,
  bar: number,
): number | null {
  const list = [...quotes];
  if (effectiveRank(list, rank) !== "prioritised") return null;
  const quote = list.find((item) => item.id === id);
  const priority = quote ? priorityOf(quote) : undefined;
  const shownAt = snapToStop(barStops(list), bar);
  if (priority === undefined || priority >= shownAt) return null;
  return floorToGateStep(priority);
}

/**
 * **Where ‹, ›, ← and → go from `currentId`** — the band's stepper and the
 * keys in Quotes mode both ask this one function, so neither can do more than
 * the other. Greg, 2026-09-11 (spya-mtyquy):
 * *"add fairly big Previous/Next icon-buttons to jump around, and use
 * left/right to navigate between quotes"*.
 * docs/plans/261002h-quotes-in-the-spine-a-card-on-each-quote-and-previous-next.md § 3.
 *
 * `listed` is `markedQuotes`' list — what the panel shows and the prose
 * outlines — so "next" is the next row the reader can see, in whatever order
 * they chose. Three rules, all Skim's (skim-route.ts):
 *
 * - **Nothing selected, or a selection the list no longer shows** → the first,
 *   whichever way.
 * - **← on the first goes to the first again**: the page may be anywhere, and
 *   "you are already on it" is no answer to a reader asking to be taken there
 *   (SPIDERYARN-READING2-4K).
 * - **→ on the last is `null`** — no wrap, so the key goes back to the browser.
 */
export function stepQuote(
  listed: readonly Quote[],
  currentId: string | null,
  dir: -1 | 1,
): Quote | null {
  const at = currentId === null ? -1 : listed.findIndex((q) => q.id === currentId);
  if (at === -1) return listed[0] ?? null;
  return listed[Math.max(0, at + dir)] ?? null;
}

/** One number to put on a row, with the name of what it is. */
export interface RowScore {
  key: "importance" | "striking";
  value: number;
}

/**
 * The numbers to put on a row: none, one, or both.
 *
 * The rule is the glossary's, and it is the whole of the condition attached to
 * keeping model scores at all: **a row shows exactly the numbers its position
 * was decided on, and shows none if its position was not decided on them.** So
 * `document` shows nothing — a list that was not ranked must not print a
 * ranking beside every row, which is the bug `rowScores` was extracted to fix
 * next door.
 *
 * **`prioritised` shows both, and only one of them decided the position.** That
 * looks like a lie and is the honest choice: under `max` either score could
 * have been the winning reason, so showing only the winner would tell the
 * reader *this got in for being striking* when what is true is *this got in,
 * and here is how it scored on both*. The composite itself is never shown —
 * that is our arithmetic dressed as the model's judgment, and a number the
 * reader can neither interpret nor check.
 */
export function rowScores(quote: Quote, rank: QuoteRank | null): RowScore[] {
  const i = quote.importance;
  const s = quote.striking;
  if (rank === "importance") return i === undefined ? [] : [{ key: "importance", value: i }];
  if (rank === "striking") return s === undefined ? [] : [{ key: "striking", value: s }];
  if (rank === "prioritised") {
    const both: RowScore[] = [];
    if (i !== undefined) both.push({ key: "importance", value: i });
    if (s !== undefined) both.push({ key: "striking", value: s });
    return both;
  }
  return [];
}

export function QuotesPanel({
  access,
  quoteId,
  onQuote,
  rank: chosenRank,
  onRank,
  bar: chosenBar,
  onBar,
  onJump,
  steps,
}: Props) {
  useRenderCount("QuotesPanel");
  const owner = access.kind === "owner" ? access.owner : null;
  const quotes = access.quotes;
  const all = quotes?.quotes ?? [];
  /* **Snapped to a stop the list actually has**, so the groups, the count and
     the thumb can never disagree — and so a `?bar=` from a link, from a hand,
     or from a different article opens on a division that exists. */
  const bar = snapToStop(barStops(all), chosenBar ?? QUOTE_BAR_DEFAULT);
  /* `effectiveRank` and not `chosenRank`: everything below — the list, the
     RankBar's pressed state, the numbers on each row — has to agree about what
     order the list is actually in. One call, one answer, passed down. */
  const rank = effectiveRank(all, chosenRank);
  /* Empty with fewer than two quotes or two ranks; then there is no rank row
     and the empty head row holds the band's corner instead. */
  const ranks = quotes && quotes.quotes.length > 1 ? rankOptions(all) : [];
  /* Provenance about the owner's own run, so a visitor sees none of it:
     `profileHash` never leaves the server (src/public-types.ts). An icon since
     2026-10-01, as Glossary's is (plan 260929a), and in the band's corner since
     2026-10-02 (`ModeSurface`'s `profile`, plan 261002e).

     **No `regenerate`, on purpose.** Its panel edits the profile like every
     other, but Quotes' forced run appends to a current list — across a profile
     change too, keeping the first pass's stamp (src/quotes.ts § existingFor)
     — so a Regenerate here would lengthen the list and leave this badge saying
     *changed*. It needs a replace intent in the job contract first. Plan
     261002b § Deferred. */
  const badge =
    quotes && owner ? (
      <WrittenForYou written={owner.profiled} changed={owner.profileChanged} slug={owner.slug} />
    ) : null;
  /* **`markedQuotes` and not `rankQuotes(all, rank, bar)`**, although the two
     compute the same list from the same three lines. The prose marks this list
     now — in every mode, since 2026-09-08 — and it reaches it from
     `useQuoteMarks` in `Reader` rather than from here, so the two have to call
     one function or they are two expressions that agree until somebody edits
     one. `bar` and `rank` above are still needed on their own,
     by the slider and by the RankBar's pressed state. */
  const shownAiQuotes = quotes ? markedQuotes(all, chosenRank, chosenBar) : [];
  /* **The model's list is on screen**: there is one, and — for its owner — the
     read has settled. Everything about the list (the stale banner, the rows)
     waits for this; the reader's own rows below do not. */
  const listReady = quotes !== null && (owner === null || owner.status === "ready");
  /* **What the band draws: `shownAiQuotes` with the reader's highlights placed
     among them.** A projection for the markup below and nothing else — the
     bar, the count, `?quote=`, the stepper and the prose all go on reading
     `Quote[]` (quote-band-rows.ts § A projection for the panel). Owner only:
     the visitor arm has no `yours` to read. */
  const yours = access.kind === "owner" ? (access.yours ?? null) : null;
  const yoursCount = yours?.rows.length ?? 0;
  const bandRows = quoteBandRows(
    listReady ? shownAiQuotes : [],
    yours?.rows ?? [],
    rank,
    yours?.blocks ?? [],
  );

  /**
   * **The selected row follows into view** when the selection changes — by
   * ‹ ›, by ← / →, or by the prose card's *Open in Quotes* — so the reader can
   * see which row they are on. A row already fully in view is left alone.
   * **The list's own `scrollTop`, never `scrollIntoView`**, which scrolls every
   * scrollable ancestor too, the page included (OutlinePanel.tsx says the same).
   * Not on every render: a reader who scrolls the list by hand keeps their
   * place until the selection moves.
   */
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || quoteId === null || list.clientHeight <= 0) return;
    const row = list.querySelector<HTMLElement>(`[data-quote-row="${CSS.escape(quoteId)}"]`);
    if (!row) return;
    const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    const bottom = top + row.offsetHeight;
    const inView = top >= list.scrollTop && bottom <= list.scrollTop + list.clientHeight;
    if (!inView) list.scrollTop = Math.max(0, top - list.clientHeight / 3);
  }, [quoteId]);
  /* From the LIST, not from the owner hook — so the sentence appears for a
     visitor as well, which is what makes "the reader is told" true rather than
     true for whoever happens to own the article. */
  const discarded = discardedNote(quotes?.discarded);
  /* What the band's (i) adds after the mode's own words: how many quotes,
     what the stage refused to keep, and who chose them. Greg, 2026-10-01
     (spya-ucu35y): *"how many X (of y) … what model was used"*; plan 261001m.
     The count was at the rank row's end (or in the head row) and the
     discarded sentence above the list until then; *prioritised* still says
     "5 of 14" beside its slider, a count beside the control it describes. The
     discarded sentence is the list's, so a visitor gets it too; the
     provenance is the owner's artefact's — a visitor's carries none
     (src/public-types.ts). */
  const made = owner?.quotes ?? null;
  const about = quotes ? (
    <>
      <p>
        {withYours(all.length === 1 ? "One quote" : `${all.length} quotes`, yoursCount)}
        {made?.passes && made.passes > 1 ? `, found in ${made.passes} passes` : ""}.
      </p>
      {discarded && <p>{discarded}</p>}
      {made && (
        <AboutMade
          generator={made.generator}
          version={made.version}
          generatedAt={made.generatedAt}
          elapsedMs={made.elapsedMs}
        />
      )}
    </>
  ) : null;

  /**
   * @param again beside a list that is already there, so the run must be
   *   forced. The empty state's button must **not** be: it has to make the
   *   identical request the automatic run makes, or the two carry different
   *   `work_key`s and the reader pays twice. useQuotes.ts § `ensure`.
   */
  /* A forced run has finished and its list is not here yet: the forced button
     gives way to a read, never to a second paid run — GlossaryPanel.tsx §
     `MoreRow` is the sibling for the appending verb. rewrite-hold.ts. */
  const waiting = owner !== null && owner.rewriting && !owner.job && !owner.starting && !owner.failed;
  const newList =
    owner && waiting && !owner.error ? (
      <RewriteWaiting line="The new quotes haven't loaded yet." onRead={owner.refresh} className="tw:m-0" />
    ) : null;
  const rerun = (label: string, again = false) =>
    again && newList ? (
      newList
    ) : (
      <div className="quotes-run">
        <Progress
          job={owner?.job ?? null}
          starting={owner?.starting ?? false}
          failed={owner?.failed ?? null}
          stalled={owner?.stalled ?? false}
          onRun={() => (again ? owner?.regenerate() : owner?.ensure()) ?? Promise.resolve()}
          /* With `error` set the retry is `ReadError`'s; the button stays held. */
          runDisabled={again && (owner?.rewriting ?? false)}
          onCancel={(id) => owner?.cancel(id)}
          label={label}
        />
      </div>
    );

  /**
   * **Find more** — the forced run on a list written from this same article,
   * which the stage **appends** to (src/quotes.ts § existingFor). Greg,
   * 2026-09-10: *"Remove the "Choose them again" button, and add a "Find more"
   * button"*.
   *
   * **In the list's own recorded setting, not the current profile**, unlike
   * `rerun`, which always uses the profile: Find more continues the list the
   * reader has rather than choosing it for somebody else, and an append keeps
   * the stamp of the pass that started the list (src/quotes.ts §
   * existingFor), so a profiled pass onto a plain list would sit under a stamp
   * that says it was not. That held when there was a *Use your profile*
   * checkbox beside `rerun`, and it still holds now that there is not
   * (docs/plans/260913a-drop-the-use-your-profile-checkbox.md, GPT Sol's
   * review).
   */
  const pressFindMore = () => owner?.regenerate(owner.profiled) ?? Promise.resolve();
  /* **The command bar's *Quotes › Find more*** (plan 261004k) opens this band
     and leaves a press for it. It is made through `pressFindMore`, the
     button's own function, only if a fresh Find more is what the foot is
     offering now — and used up either way (useFindMoreHandOff.ts). */
  useFindMoreHandOff({
    slug: owner?.slug ?? null,
    mode: "quotes",
    /* The list and the job list must both have answered. Until the first job
       poll, `job === null` means “not known”, not “none” (code review F10). */
    settled: owner !== null && owner.status !== "loading" && owner.loaded,
    offered: owner !== null && quotesFindMoreOffered(owner),
    press: () => void pressFindMore(),
  });
  const findMore = newList ?? (
    <div className="quotes-run">
      <Progress
        job={owner?.job ?? null}
        starting={owner?.starting ?? false}
        failed={owner?.failed ?? null}
        stalled={owner?.stalled ?? false}
        onRun={pressFindMore}
        runDisabled={owner?.rewriting ?? false}
        onCancel={(id) => owner?.cancel(id)}
        label="Find more"
        runningLabel="Finding more…"
      />
    </div>
  );

  /* One `<ol>` for both places the rows are drawn: under the model's list's
     own furniture when there is a list, and on their own before there is. */
  const rowList = (
    <ol className="quotes-list-items">
      {bandRows.map((row) =>
        row.by === "reader" ? (
          <YoursRow
            key={`yours:${row.comment.id}`}
            comment={row.comment}
            onOpen={() => {
              /* **Both in one tick, and the clear is here rather than inside
                 `jumpToComment`.** Without it the quote the reader had selected
                 stays selected under the comment's dialog — its row lit, its
                 ring in the prose, the stepper still on it — and Escape hands
                 that stale selection back. `jumpToComment` is the drawer's
                 too, and knows nothing about Quotes. nuqs queues both writes
                 onto one history entry. GPT Sol, 261003h Q5. */
              onQuote(null);
              yours?.onOpen(row.comment.id);
            }}
            onJump={onJump}
          />
        ) : (
          <QuoteRow
            key={row.quote.id}
            quote={row.quote}
            generatedAt={quotes?.generatedAt}
            selected={row.quote.id === quoteId}
            scores={rowScores(row.quote, rank)}
            /* An unscored quote got here without clearing anything, and
               in an unheaded list a row with no numbers otherwise reads
               as though it had. A `title` and nothing visible — the same
               call the glossary makes, for the same reason. */
            unscored={rank === "prioritised" && priorityOf(row.quote) === undefined}
            onSelect={() => {
              // Pressing the selected quote again clears it. Since
              // 2026-09-05 that takes the *ring* off the passage and
              // leaves the wash, because every visible quote is marked
              // whether or not one is selected. A selection you cannot
              // cancel is a mode inside a mode.
              if (row.quote.id === quoteId) return onQuote(null);
              onQuote(row.quote.id);
              onJump(row.quote.blockId);
            }}
            onJump={onJump}
          />
        ),
      )}
    </ol>
  );

  return (
    <ModeSurface
      label="Quotes"
      feature="quotes"
      mode="quotes"
      about={about}
      profile={badge}
      /* **No head row while the rank row is drawn**, since 2026-10-01 — Greg,
          on a landscape iPhone: *"all the stuff at the top of their columns
          takes up the vertical real estate, and I can't see the actual result"*
          (`spya-gcdwps`). Its profile badge is now in the band's corner and
          its count in the (i); *prioritised* still says "5 of 14" beside its
          own threshold, where the count describes the control. The compact
          row began with Glossary (plan 260929a); plans 261001l, 261001m and
          261002e finished the moves.

          **Otherwise a fragment, so the row is there before the quotes are.**
          `head={quotes && <></>}` would pass the surface `null` while the list
          loads and draw no `.band-head`, so the corner could hang into the
          status below. With one quote, or one rank on offer, there is no rank
          row to host the corner, so the old row stays.

          **The count has gone to the band's (i)** since 2026-10-01 (plan
          261001m), and the badge to the band's corner beside it since
          2026-10-02 (plan 261002e), so this row holds nothing of its own.
          Still a fragment rather than `null`, for the reason above: the row
          holds its place while the list loads, and the corner sits in it. */
      // biome-ignore lint/complexity/noUselessFragments: an empty fragment is the point — a head that is not null keeps its row, and the note above says why
      head={ranks.length > 0 ? null : <></>}
      /* Pinned under the list rather than at the end of it. Same guard it had
          as a trailing child of the band — and **not on a stale or an outdated
          list**, whose banner offers the one honest action there, a list of its
          own. On an outdated list Find more would not even be what it says: the
          forced run it sends is a rewrite there (src/quotes.ts § existingFor). */
      foot={
        <>
          {/* **‹ › first, then the verb**: stepping is what a reader does in
              this band many times, Find more once. For owners and visitors
              alike — a visitor's list is just as long. Only once there is a
              list to step through. */}
          {quotes && steps.length > 0 && (
            <QuoteStepper
              shown={steps}
              quoteId={quoteId}
              onStep={(quote) => {
                onQuote(quote.id);
                onJump(quote.blockId);
              }}
            />
          )}
          {quotes && owner?.status === "ready" && owner.quotes && !owner.stale && !owner.outdated ? (
          <Foot
            list={owner.quotes}
            loaded={owner.loaded}
            running={owner.job !== null || owner.starting}
            /* The one answer to *can this list be added to* — the gate on the
               command bar's row too (find-more.ts). Under this guard it is
               false only at the ceiling. */
            addable={quotesAppendOnOffer(owner)}
            findMore={findMore}
            /* A job at the ceiling was not started by Find more, which is not
               offered there: it is a forced re-run from Metadata. So its
               status, and the way to ask again when it never became a job,
               are the rewrite's (`rerun`), as on an outdated list below.
               `rewriting` too: a run that has ended with its list unread is
               the hold's waiting line, which `rerun` draws (rewrite-hold.ts). */
            elsewhere={
              owner.job || owner.starting || owner.failed || owner.rewriting
                ? rerun("Choose them again", true)
                : null
            }
          />
        ) : /* **Status only, on an outdated list.** Its banner went on
               2026-09-29 (SPIDERYARN-READING2-55, plan 260929c), and that banner
               was where a rewrite's progress, Stop and failure showed; a run
               started from Metadata would otherwise show nowhere. Idle, nothing
               — the Ideas, Timeline, Debate and Quiz feet do the same. */
          quotes &&
          owner?.status === "ready" &&
          owner.outdated &&
          !owner.stale &&
          (owner.job || owner.starting || owner.failed || newList) ? (
          <div className="quotes-foot">{rerun("Choose them again", true)}</div>
        ) : null}
        </>
      }
    >

      {ranks.length > 0 && (
        <RankBar
          options={ranks}
          rank={rank}
          onRank={onRank}
        />
      )}

      {/* Only in the order it belongs to. It is the one control here that sets a
          number rather than picking from a list, and a number that means nothing
          in the other three orders would just be furniture. */}
      {quotes && rank === "prioritised" && (
        <BarSlider quotes={all} bar={bar} moved={chosenBar !== null} onBar={onBar} yours={yoursCount} />
      )}

      {/* **The reader's highlights, before there is a list to put them in** —
          not started, running, failed, or still loading. They are the reader's
          own and cost nothing, so they do not wait for the model; the status
          and the offer below stay exactly as they were. Plan 261003h, Q6. */}
      {!listReady && bandRows.length > 0 && (
        <div className="quotes-list quotes-list-yours-only">{rowList}</div>
      )}

      {owner?.error && <ReadError error={owner.error} onRetry={owner.retryRead} />}

      {owner?.status === "loading" && <BandWaiting className="quotes-quiet">Looking for quotes…</BandWaiting>}

      {/* **A visitor's list is already here or it is not**, so there is no
          loading state and no offer to build one — a piece with no quotes never
          mounts this panel at all, because `visitorGap` answers *not-built* and
          the band says so instead (src/web/visitor.ts). What is left is the one
          state absence cannot express: a run that came back with nothing. */}
      {!owner && quotes?.quotes.length === 0 && (
        <p className="quotes-quiet">{builtButEmpty("A set of quotes")}</p>
      )}

      {owner?.status === "none" && (
        <div className="quotes-empty">
          <p>Nobody has chosen the quotes for this one yet.</p>
          <p className="quotes-hint">
            One model call over the whole article, and it takes tens of seconds. Every line it
            picks is checked against the piece before it is kept.
          </p>
          {rerun("Choose the quotes")}
        </div>
      )}

      {listReady && (
        <>
          {/* Two different facts, and the first matters more here than on any
              sibling panel. `stale` means the article moved underneath these
              quotes — so a row's block id may name a paragraph that is gone,
              AND the words themselves may no longer be in the piece. That is
              the one banner in this band that says the list may be *false*
              rather than merely dated.

              `outdated` is *the article is the same and we would choose
              differently now*, which is what bumping `PROMPT_VERSION` means.
              Stale wins when both are true; two banners stacked is a wall.

              **The stale banner carries *Choose them again* (the outdated one
              went in plan 260929c), and neither list gets
              Find more.** Greg removed the button from a *current* list on
              2026-09-11 (*"Remove the "Choose them again" button, and add a
              "Find more" button"*), and it survived on the stale banner, where
              extending the list is impossible. From 2026-09-11 to 2026-09-24 an
              outdated list was extended by Find more instead; but `quotes/6`
              changed what a quote is — a passage long enough to stand alone —
              and an append cannot lengthen an old short quote, because the old
              span wins every overlap. So an outdated list is the other state
              where a list of its own is the honest action, and the forced run
              this button sends rewrites it (src/quotes.ts § existingFor),
              keeping the id of any quote chosen again in exactly its words.
              SPIDERYARN-READING2-3C; docs/plans/260924d-choose-them-again-on-an-outdated-quote-list.md. */}
          {owner?.stale ? (
            <div className="quotes-stale">
              <p>
                <TriangleAlert size={13} />
                The article has changed since these were chosen. Some of these lines may no longer
                be in it.
              </p>
              {rerun("Choose them again", true)}
            </div>
          ) : null}
          {/* **No banner for an outdated list** since 2026-09-29 — Greg
              (SPIDERYARN-READING2-55): *"it's not worth bugging the user about
              it."* It still gets no Find more (above); re-running is in
              Metadata, and a run started there shows in the foot. Plan
              260929c. */}

          {/* The discarded sentence was here, above the list, until
              2026-10-01; it is in the band's (i) now (`about`, plan 261001m).
              See `discardedNote` for why only two of the five counts are named. */}

          {/* One list again, in every rank. It was two headed groups from
              2026-08-31 until 2026-09-03, when the bar started hiding what is
              below it instead of grouping it — with nothing to contrast,
              "worth keeping" was a heading over the whole list. */}
          <div className="quotes-list" ref={listRef}>
            {rowList}
          </div>
        </>
      )}
    </ModeSurface>
  );
}

type RankOption = { key: QuoteRank; label: string; title: string };

/**
 * Which ranks this particular list can actually offer — empty when fewer than
 * two, which is how the panel knows there is no rank row to fold the head row
 * into.
 */
function rankOptions(quotes: readonly Quote[]): RankOption[] {
  const options: RankOption[] = [
    {
      key: "document",
      label: "in order",
      title: "In the order the article says them — the default, and the reader's own order",
    },
    /* Offered when some position of the bar would hide something. A control
       that would visibly do nothing is worse than one that is not there — the
       same rule the two score ranks below follow. */
    ...(canPrioritise(quotes)
      ? [
          {
            key: "prioritised" as const,
            label: "prioritised",
            title:
              "Only the lines that score high on either judgment, in the order the article says them — the bar below decides how many",
          },
        ]
      : []),
    ...(quotes.some((q) => q.importance !== undefined)
      ? [
          {
            key: "importance" as const,
            label: "most important",
            title: "The model's judgment of how much of the argument rests on each line",
          },
        ]
      : []),
    ...(quotes.some((q) => q.striking !== undefined)
      ? [
          {
            key: "striking" as const,
            label: "most striking",
            title: "The model's judgment of how memorable and well put each line is",
          },
        ]
      : []),
  ];
  return options.length < 2 ? [] : options;
}

/**
 * The rank buttons. The row took the count and the profile badge from a head
 * row of their own on 2026-10-01, for Greg's *"all the stuff at the top of
 * their columns takes up the vertical real estate"* (`spya-gcdwps`, plan
 * 261001l); the count has since gone to the band's (i) (plan 261001m) and the
 * badge to the band's corner (plan 261002e).
 */
function RankBar({
  options,
  rank,
  onRank,
}: {
  options: readonly RankOption[];
  rank: QuoteRank;
  onRank(rank: QuoteRank): void;
}) {
  return (
    <div className="gloss-sort">
      <OrderGroup label="Order the quotes by" selected={rank}>
        {/* No "order" word in front since 2026-10-01, as in Glossary; the
            group's `aria-label` still says it to a screen reader. */}
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`gloss-sort-btn${rank === option.key ? " on" : ""}`}
            aria-pressed={rank === option.key}
            title={option.title}
            onClick={() => onRank(option.key)}
          >
            {option.label}
          </button>
        ))}
      </OrderGroup>
    </div>
  );
}

/**
 * The bar, with the reader's hand on it — the second thing Greg asked for by
 * name.
 *
 * Everything here is the glossary's `GateSlider` with the composite changed,
 * and every one of its four properties is kept because each answers something
 * that went wrong once:
 *
 * - **the number is on screen**, because a thumb position is not a number
 *   anybody can read;
 * - **the count is on screen**, `5 of 14`, which is what the reader is aiming
 *   at and the only feedback that survives a drag that hides nobody;
 * - **every adjacent pair of stops shows a different list** (`barStops`), so no
 *   part of the track is dead and both ends mean what they say;
 * - **it says how many it is holding back** (`hiddenNote`), in every state
 *   including none, which is the silent-success failure this codebase keeps
 *   catching itself in.
 *
 * A native `<input type="range">` rather than anything built: draggable,
 * arrow-key steppable, announced by screen readers and touch-friendly for free.
 */
function BarSlider({
  quotes,
  bar,
  moved,
  onBar,
  yours,
}: {
  quotes: Quote[];
  bar: number;
  moved: boolean;
  onBar(bar: number | null): void;
  /**
   * How many of the reader's own highlights are in the list as well. Said
   * beside the count and **never added into it**: the bar reads a score, a
   * highlight has none, and "5 of 14" is about the model's fourteen.
   */
  yours: number;
}) {
  const stops = barStops(quotes);
  /* **One pass, and every number here comes out of it.** The list above, the
     `N of M` and the foot line have to agree, and the way they cannot disagree
     is for there to be one result rather than a filter beside a counter. */
  const { visible, hiddenCount } = visibleQuotes(quotes, bar);
  const note = barNote(hiddenCount, quotes.length);
  const count = `${visible.length} of ${quotes.length}`;

  return (
    <div className="gloss-gate">
      <div className="gloss-gate-row">
        <label className="gloss-gate-label" htmlFor="quotes-bar">
          bar
        </label>
        <span className="gloss-gate-value">
          {bar.toFixed(2)} · {withYours(count, yours)}
        </span>
        {/* Only once there is something to undo. A reset that is always there is
            a permanent invitation to a state you are already in. */}
        {moved && (
          <button
            type="button"
            className="gloss-gate-reset"
            title={`Back to ${QUOTE_BAR_DEFAULT.toFixed(2)}`}
            aria-label={`Reset the bar to ${QUOTE_BAR_DEFAULT.toFixed(2)}`}
            onClick={() => onBar(null)}
          >
            <RotateCcw size={11} />
          </button>
        )}
      </div>
      {/* **The track is an INDEX into `stops`, not the score itself.** A range
          input needs a uniform step, and this list's scores are not uniformly
          spaced — so the thumb walks the positions and the value is read out of
          the array. That is what makes every drag change the list, and it is
          why `?bar=` still carries the score rather than the index: an index is
          meaningless against a re-run list, where a score is still a score. */}
      <input
        id="quotes-bar"
        className="gloss-gate-range"
        type="range"
        min={0}
        max={Math.max(stops.length - 1, 0)}
        step={1}
        value={Math.max(stops.indexOf(bar), 0)}
        title="How high a quote has to score to stay on screen: the higher of the model's two judgments, so either reason is enough. Every stop is a score this list actually contains — left shows everything, right shows only the top-scored."
        /* The thumb's position is a number nobody can hear. This is what makes
           it audible, and it is the count rather than the score because the
           count is what the reader is aiming at. **"showing", not
           "promoting"** — an unscored quote is shown without being promoted. */
        aria-valuetext={`${bar.toFixed(2)}, showing ${count} quotes`}
        onChange={(e) => onBar(stops[Number.parseInt(e.target.value, 10)] ?? 0)}
      />
      {/* Always, never conditionally: present wherever the slider is, absent
          wherever it is not. A line that is sometimes missing for a *different*
          reason teaches the reader nothing. */}
      <p className="gloss-gate-note">{note}</p>
    </div>
  );
}

/**
 * One quote. The author's sentence, its numbers, and two small controls.
 *
 * **The row is one button and the ⓘ is another, beside it — never inside it.**
 * A button inside a button is invalid HTML and the browser's recovery is not
 * something to design against. The layout is a flex row so the two read as one
 * item.
 *
 * **The ⓘ is on every row since 2026-10-03**, where it used to be drawn only
 * when the model gave a reason: its card now ends with who chose the line and
 * when (`aiProvenance`), which every quote has. Greg, spya-ma5h9b: *"quotes
 * should as well, maybe saying when it was applied and whether it's AI
 * generated or human highlights."*
 */
function QuoteRow({
  quote,
  generatedAt,
  selected,
  scores,
  unscored,
  onSelect,
  onJump,
}: {
  quote: Quote;
  /** The list's time: the *on or before* bound for a quote with no `addedAt`. */
  generatedAt: string | undefined;
  selected: boolean;
  scores: RowScore[];
  /**
   * This row survived the bar without being scored, so say so — quietly.
   *
   * A `title` and nothing visible, the same call the glossary makes. It reveals
   * no composite, so the rule that only the model's raw numbers reach the
   * screen still holds. The quotes prompt explicitly permits omitting both
   * scores, so unlike next door this state is by design rather than a model
   * disobeying — which is a reason to name it, not to shout about it.
   */
  unscored: boolean;
  onSelect(): void;
  onJump(id: BlockId): void;
}) {
  /**
   * The tooltip is **controlled**, which is what makes it work on a phone.
   *
   * Hover and focus still drive it — `Tooltip` calls `onOpenChange` for both —
   * and the button's own click *pins* it. Uncontrolled, there would be no tap
   * route at all: a touch device has nothing to hover with, so a hover-only
   * card does not exist there. GPT Sol, 2026-08-31, who was also right that the
   * plan's claim of "no keyboard route" was wrong: the row is a button, so it
   * is a tab stop, and this one is the next.
   */
  const [why, setWhy] = useState(false);

  return (
    <li
      className={`quotes-row${selected ? " on" : ""}`}
      data-quote-row={quote.id}
      {...(unscored && {
        title: "Not scored for prioritising — shown regardless of the threshold",
      })}
    >
      <button
        type="button"
        className="quotes-quote"
        aria-pressed={selected}
        onClick={onSelect}
      >
        {/* A `<blockquote>` rather than a `<p>`, because that is what it is —
            and it is inside the button rather than around it so the whole
            sentence is the target. Never `dangerouslySetInnerHTML`: this is
            model-touched text even though every character of it came out of the
            article (src/quotes.ts slices the block), and the rule in
            docs/project/security.md does not have an exception for that. */}
        <blockquote className="quotes-text">{quote.text}</blockquote>
        {/* **Drawn, not printed** — Greg, 2026-08-31: *"Prefer to use UI (e.g. a
            little sparkline/bar rather than numbers) plus tooltip instead of
            numbers"*. A row is meant to be skimmed, and two decimals are read
            rather than skimmed; a length compares down a column without being
            read at all. The numbers are in the tooltip and in the bars' own
            `aria-label`. src/web/ScoreBars.tsx. */}
        <ScoreBars
          className="quotes-scores"
          scores={scores.map((score) => ({
            key: score.key,
            label: LABEL[score.key],
            value: score.value,
          }))}
        />
      </button>
      <div className="quotes-row-side">
        {/* The card is the model's (`.quotes-why-card` is in its face,
            voices.css); the last line is ours, so it sets the app's face on
            itself. docs/project/fonts.md. */}
        <Tooltip
          content={
            <>
              {quote.reason && <span className="quotes-why-reason">{quote.reason}</span>}
              <span className="quotes-prov">{aiProvenance(quote, generatedAt)}</span>
            </>
          }
          placement="left"
          open={why}
          onOpenChange={setWhy}
          className="quotes-why-card"
        >
          <button
            type="button"
            className={`quotes-why tap-target${why ? " on" : ""}`}
            aria-label={quote.reason ? "Why this one" : "Who chose this, and when"}
            aria-expanded={why}
            onClick={() => setWhy((was) => !was)}
          >
            <Info size={12} />
          </button>
        </Tooltip>
        <BlockRef id={quote.blockId} onJump={onJump} className="quotes-where" />
      </div>
    </li>
  );
}

/**
 * **One of the reader's own highlights, as a row** — quote-band-rows.ts.
 *
 * The same shape as `QuoteRow` so the list reads as one list, and different in
 * every way that says whose it is:
 *
 * - **a bar down the left edge in the highlight's own colour**, at full
 *   strength (`--hl-*-solid`; the wash in the prose is too pale to carry a 3px
 *   edge), and **the word *yours***, for anyone who cannot tell four colours
 *   apart;
 * - **no scores and no "why"** — nobody judged it;
 * - **no `data-quote-row`, no `aria-pressed`, never `.on`**: those are
 *   `?quote=`'s, and a highlight's own selection is `?note=`. Pressing it opens
 *   its comment, where the colour can be changed and the note read or written.
 *
 * The words are the comment's stored `quote` — the article's characters, as the
 * browser's selection sliced them — so they are drawn as the article's, in the
 * same `<blockquote>`. A highlight whose words a re-extraction took away still
 * shows here, as it still shows in the drawer.
 */
function YoursRow({
  comment,
  onOpen,
  onJump,
}: {
  comment: ReaderRowComment;
  onOpen(): void;
  onJump(id: BlockId): void;
}) {
  const [about, setAbout] = useState(false);
  return (
    <li className="quotes-row quotes-row-yours" data-yours-row={comment.id} data-colour={comment.colour}>
      <button type="button" className="quotes-quote" onClick={onOpen}>
        <blockquote className="quotes-text">{comment.quote}</blockquote>
        <span className="quotes-yours">yours</span>
      </button>
      <div className="quotes-row-side">
        {/* Keyed from `body`, the note this mark promises: an answer from the
            model is not the reader's note. Not a button — the row itself opens
            the comment. */}
        {comment.body && (
          <span className="quotes-yours-noted" title="Has your note" role="img" aria-label="Has your note">
            <Pencil size={11} />
          </span>
        )}
        <Tooltip
          content={
            <>
              {comment.body && <span className="quotes-yours-note">{comment.body}</span>}
              <span className="quotes-prov">{readerProvenance(comment)}</span>
            </>
          }
          placement="left"
          open={about}
          onOpenChange={setAbout}
          className="quotes-yours-card"
        >
          <button
            type="button"
            className={`quotes-why tap-target${about ? " on" : ""}`}
            aria-label="About your highlight"
            aria-expanded={about}
            onClick={() => setAbout((was) => !was)}
          >
            <Info size={12} />
          </button>
        </Tooltip>
        <BlockRef id={comment.blockId} onJump={onJump} className="quotes-where" />
      </div>
    </li>
  );
}

/**
 * The two scores' names, said once — and short, because they now appear inside
 * a tooltip and inside a screen reader's sentence rather than as a row of
 * abbreviations. "The model's judgment:" was in both and is gone: the panel's
 * heading and the order buttons already establish whose judgment these are, and
 * repeating it twice per row is six words of tooltip spent on nothing.
 */
export const LABEL: Record<RowScore["key"], string> = {
  importance: "Importance — how much of the argument rests on this line",
  striking: "Striking — how memorable and well put it is",
};

/**
 * **‹ 3 of 14 ›, pinned under the list** — Greg, 2026-09-11 (spya-mtyquy):
 * *"in Quotes mode, add fairly big Previous/Next icon-buttons to jump around,
 * and use left/right to navigate between quotes"*. Skim's arrows and size
 * (`--control-h-lg`, quotes.css § the stepper), each naming its key on its card; the
 * rule is `stepQuote`, which ← / → share through `Reader`, so the keys can do
 * no more than these. The position is spoken through a live region, as Skim's
 * is. docs/plans/261002h-quotes-in-the-spine-a-card-on-each-quote-and-previous-next.md § 3.
 */
function QuoteStepper({
  shown,
  quoteId,
  onStep,
}: {
  shown: readonly Quote[];
  quoteId: string | null;
  onStep(quote: Quote): void;
}) {
  const at = quoteId === null ? -1 : shown.findIndex((q) => q.id === quoteId);
  const prev = stepQuote(shown, quoteId, -1);
  const next = stepQuote(shown, quoteId, 1);
  const first = at <= 0;
  const said = at === -1 ? `${shown.length} quotes` : `Quote ${at + 1} of ${shown.length}`;
  return (
    <div className="quotes-step">
      <TooltipGroup delay={{ open: 240, close: 90 }} timeoutMs={400}>
        <StepTip
          head={at === -1 ? "First quote" : first ? "Back to the first quote" : "Previous quote"}
          what={
            at === -1
              ? "Go to the first quote in the list."
              : first
                ? "Back to the first quote."
                : "Back one quote in the list."
          }
          keyName="←"
          placement="top"
          enabled={prev !== null}
        >
          <button
            type="button"
            className="quotes-arrow"
            aria-label={first ? "First quote" : "Previous quote"}
            disabled={prev === null}
            onClick={() => prev && onStep(prev)}
          >
            <ChevronLeft size={20} />
          </button>
        </StepTip>
        <span className="quotes-step-at" aria-hidden="true">
          {at === -1 ? `${shown.length}` : `${at + 1} of ${shown.length}`}
        </span>
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {said}
        </span>
        <StepTip
          head={at === -1 ? "First quote" : "Next quote"}
          what={at === -1 ? "Go to the first quote in the list." : "On to the next quote in the list."}
          keyName="→"
          placement="top"
          enabled={next !== null}
        >
          <button
            type="button"
            className="quotes-arrow"
            aria-label={at === -1 ? "First quote" : "Next quote"}
            disabled={next === null}
            onClick={() => next && onStep(next)}
          >
            <ChevronRight size={20} />
          </button>
        </StepTip>
      </TooltipGroup>
    </div>
  );
}

/**
 * Under the list: the one verb.
 *
 * **It printed `generator · version` above the button until 2026-09-05**, and
 * that line went for the reason the glossary's did, on the same day and by the
 * same instruction — Greg, having read both feet:
 *
 * > we can probably get rid of Start again button and the "claude-sonnet-5 ·
 * > glossary/3 · one pass" at the bottom, those are all confusing and
 * > unnecessary.
 *
 * > also do the same for Quotes (and any other modes as needed)
 *
 * Which model wrote a list and which prompt version it used are pipeline facts:
 * the public projection already drops them for a visitor
 * (src/public-types.ts), they are still on the artefact and in the export, and
 * `Metadata` is where an owner can see them
 * (src/web/Metadata.tsx § `StageRow`). A reader deciding whether to press
 * *Choose them again* is not helped by either. `Foot` in
 * src/web/GlossaryPanel.tsx carries the longer version of the argument.
 *
 * **The verb went from *Choose them again* to *Find more* on 2026-09-11**, and
 * it is a change of behaviour rather than a label: Greg asked for it twice
 * (report 27, then SPIDERYARN-READING2-2W), and the stage now appends. So the
 * foot reads the artefact again, for two facts only it has — whether the last
 * Find more added anything, and whether the list is at the ceiling.
 */
function Foot({
  list,
  loaded,
  running,
  addable,
  findMore,
  elsewhere,
}: {
  list: Quotes;
  /** False until the first job poll; neither a button nor the cap claim is true yet. */
  loaded: boolean;
  /** A run is in flight, so the last one's answer is about to be superseded. */
  running: boolean;
  /**
   * The list can be added to — `quotesAppendOnOffer`. The caller draws this
   * foot only for a current list, so `false` here is the ceiling
   * (`MAX_QUOTES_TOTAL`).
   */
  addable: boolean;
  findMore: ReactElement;
  /**
   * The progress, Stop or failure of a run that is going or has failed (or
   * the line that says its new list has not loaded), or null when there is
   * none. Drawn at the ceiling **in place of** its
   * sentence, which until 2026-10-07 stood where a running job's Stop and a
   * failed one's Retry would have been (plan 261007a § K4). Under the
   * ceiling `findMore` already carries the same status.
   */
  elsewhere: ReactElement | null;
}) {
  /* **Said, because otherwise a Find more that found nothing looks exactly
     like a button that did nothing** — the job finishes, the list is the same
     length, and nothing on screen changed. docs/reusable/silent-success.md.
     Absent on a first pass (`passes` 1, or a list from before the field). */
  const foundNothing = !running && (list.passes ?? 1) > 1 && list.lastAdded === 0;
  return (
    <div className="quotes-foot">
      {foundNothing && <p className="quotes-quiet">Nothing more worth keeping turned up.</p>}
      {addable ? (loaded ? findMore : null) : (
        elsewhere ?? <p className="quotes-quiet">That is as many as we keep for one article.</p>
      )}
    </div>
  );
}

function Progress(props: {
  job: Job | null;
  starting: boolean;
  failed: StepFailure | null;
  stalled: boolean;
  onRun(): Promise<void>;
  /** `JobProgress.runDisabled`: the forced run is held (rewrite-hold.ts). */
  runDisabled?: boolean;
  onCancel(id: string): void;
  label: string;
  /** What the button says while its run is going. *Choosing…* unless said. */
  runningLabel?: string;
}) {
  const { runningLabel = "Choosing…", ...rest } = props;
  return (
    <JobProgress {...rest} step="quotes" icon={<QuoteIcon size={13} />} runningLabel={runningLabel} />
  );
}
