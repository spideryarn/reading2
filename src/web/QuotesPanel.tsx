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
 * The marks in the prose and the lane in the rail. `QuotesBand` in App.tsx
 * resolves the selected quote into `Found[]` and pushes it up, for the same
 * reason `SearchBand` and `IdeasBand` do.
 */
import { useState, type ReactElement } from "react";
import { Info, Quote as QuoteIcon, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import type { BlockId, Job, Quote, QuoteDrops } from "../types.js";
import type { QuoteRank } from "./params.js";
import type { UseQuotes } from "./useQuotes.js";
import type { StepFailure } from "./useStepJob.js";
import { BlockRef } from "./BlockRef.js";
import { ScoreBars } from "./ScoreBars.js";
import { Tooltip } from "./Tooltip.js";
import { builtButEmpty } from "../messages.js";
import { JobProgress } from "./JobProgress.js";
import { UseProfile, WrittenForYou } from "./WrittenForYou.js";
import { useRenderCount } from "./perf.js";
import { applyThreshold, hiddenNote, type ThresholdResult } from "./threshold.js";

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
  | { kind: "owner"; owner: QuotesOwner; quotes: QuoteList | null }
  | { kind: "visitor"; quotes: QuoteList; owner?: never };

/**
 * The list this panel draws, from either side of the owner/visitor line.
 *
 * `discarded` is on both, which is the point: the disclosure under the bar is a
 * fact about the list on screen rather than about our pipeline, so a visitor
 * gets it too. src/public-types.ts § PublicQuotes has the argument.
 */
type QuoteList = { quotes: Quote[]; discarded?: QuoteDrops };

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
 * `0.80` keeps two of those five, which is the size of list this is for. **It
 * is one article**, so this is a better-supported guess rather than a
 * measurement — and it stays a guess in the same way `0.30` next door does,
 * because the slider under it is the feedback loop. What is no longer true is
 * that nothing had ever been looked at.
 *
 * `snapToStop` resolves a tie **downwards**, towards the lower score and so
 * towards showing more. That is the safer direction for a reference list: a
 * slightly generous list costs a reader a glance, where an empty one costs them
 * the feature.
 */
export const QUOTE_BAR_DEFAULT = 0.8;

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
export function barStops(quotes: Quote[]): number[] {
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
export function canPrioritise(quotes: Quote[]): boolean {
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
 * Only `unfound` and `otherVoice` are said out loud. The other three —
 * a fragment, a whole paragraph, an overlap, a list past the cap — are editorial
 * rules of ours that the reader has no stake in, and naming them would turn an
 * honest disclosure into a changelog.
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
  const shown = quotes ? rankQuotes(all, rank, bar) : [];
  /* From the LIST, not from the owner hook — so the sentence appears for a
     visitor as well, which is what makes "the reader is told" true rather than
     true for whoever happens to own the article. */
  const discarded = discardedNote(quotes?.discarded);

  /* Seeded from what the list on screen was chosen with, so the box is already
     in the state the reader last picked and nothing has to remember it between
     visits: the artefact does. `useState`'s initialiser rather than an effect,
     because re-seeding on every poll would fight a reader who just unticked it. */
  const [withProfile, setWithProfile] = useState(() => (quotes ? (owner?.profiled ?? false) : true));

  /**
   * @param again beside a list that is already there, so the run must be
   *   forced. The empty state's button must **not** be: it has to make the
   *   identical request the automatic run makes, or the two carry different
   *   `work_key`s and the reader pays twice. useQuotes.ts § `ensure`.
   */
  const rerun = (label: string, again = false) => (
    <div className="quotes-run">
      <UseProfile
        checked={withProfile}
        onChange={setWithProfile}
        hasProfile={owner?.hasProfile ?? false}
        slug={owner?.slug ?? ""}
        disabled={owner?.job !== null}
        automatic={owner?.automatic ?? false}
      />
      <Progress
        job={owner?.job ?? null}
        starting={owner?.starting ?? false}
        failed={owner?.failed ?? null}
        stalled={owner?.stalled ?? false}
        onRun={() =>
          (again ? owner?.regenerate(withProfile) : owner?.ensure(withProfile)) ??
          Promise.resolve()
        }
        onCancel={(id) => owner?.cancel(id)}
        label={label}
      />
    </div>
  );

  return (
    <aside className="mode-band quotes" aria-label="Quotes">
      <div className="band-head">
        {/* The mode's name went on 2026-09-05 — the Dock says it (§ Stage 5 of
            docs/plans/260905d-declutter-the-reading-view-top-bars.md). The row
            stays for the count below it. */}
        {quotes && (
          <span className="quotes-count">
            {quotes.quotes.length} {quotes.quotes.length === 1 ? "quote" : "quotes"}
          </span>
        )}
        {/* Provenance about the owner's own run, so a visitor sees none of it:
            `profileHash` never leaves the server (src/public-types.ts). */}
        {quotes && owner && (
          <WrittenForYou
            written={owner.profiled}
            changed={owner.profileChanged}
            slug={owner.slug}
          />
        )}
      </div>

      {quotes && quotes.quotes.length > 1 && (
        <RankBar quotes={all} rank={rank} onRank={onRank} />
      )}

      {/* Only in the order it belongs to. It is the one control here that sets a
          number rather than picking from a list, and a number that means nothing
          in the other three orders would just be furniture. */}
      {quotes && rank === "prioritised" && (
        <BarSlider quotes={all} bar={bar} moved={chosenBar !== null} onBar={onBar} />
      )}

      {owner?.error && <p className="quotes-error">{owner.error}</p>}

      {owner?.status === "loading" && <p className="quotes-quiet">Looking for quotes…</p>}

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

      {quotes && (owner === null || owner.status === "ready") && (
        <>
          {/* Two different facts, and the first matters more here than on any
              sibling panel. `stale` means the article moved underneath these
              quotes — so a row's block id may name a paragraph that is gone,
              AND the words themselves may no longer be in the piece. That is
              the one banner in this band that says the list may be *false*
              rather than merely dated.

              `outdated` is *the article is the same and we would choose
              differently now*, which is what bumping `PROMPT_VERSION` means.
              Stale wins when both are true; two banners stacked is a wall. */}
          {owner?.stale ? (
            <div className="quotes-stale">
              <p>
                <TriangleAlert size={13} />
                The article has changed since these were chosen. Some of these lines may no longer
                be in it.
              </p>
              {rerun("Choose them again", true)}
            </div>
          ) : owner?.outdated ? (
            <div className="quotes-stale">
              <p>
                <TriangleAlert size={13} />
                These were chosen by an earlier version of the prompt.
              </p>
              {rerun("Choose them again", true)}
            </div>
          ) : null}

          {/* Said once, above the list, and only when there is something to say.
              See `discardedNote` for why only two of the five counts are named. */}
          {discarded && (
            <p className="quotes-discarded">
              <Sparkles size={12} />
              {discarded}
            </p>
          )}

          {/* One list again, in every rank. It was two headed groups from
              2026-08-31 until 2026-09-03, when the bar started hiding what is
              below it instead of grouping it — with nothing to contrast,
              "worth keeping" was a heading over the whole list. */}
          <div className="quotes-list">
            <ol className="quotes-list-items">
              {shown.map((quote) => (
                <QuoteRow
                  key={quote.id}
                  quote={quote}
                  selected={quote.id === quoteId}
                  scores={rowScores(quote, rank)}
                  /* An unscored quote got here without clearing anything, and
                     in an unheaded list a row with no numbers otherwise reads
                     as though it had. A `title` and nothing visible — the same
                     call the glossary makes, for the same reason. */
                  unscored={rank === "prioritised" && priorityOf(quote) === undefined}
                  onSelect={() => {
                    // Pressing the selected quote again clears it, which is
                    // what takes the mark back out of the prose. A selection
                    // you cannot cancel is a mode inside a mode.
                    if (quote.id === quoteId) return onQuote(null);
                    onQuote(quote.id);
                    onJump(quote.blockId);
                  }}
                  onJump={onJump}
                />
              ))}
            </ol>
          </div>

          {owner?.quotes && <Foot rerun={rerun} />}
        </>
      )}
    </aside>
  );
}

/** Which ranks this particular list can actually offer. */
function RankBar({
  quotes,
  rank,
  onRank,
}: {
  quotes: Quote[];
  rank: QuoteRank;
  onRank(rank: QuoteRank): void;
}) {
  const options: { key: QuoteRank; label: string; title: string }[] = [
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
  if (options.length < 2) return null;

  return (
    /* biome-ignore lint/a11y/useSemanticElements: <fieldset> is for form
       controls and wants a <legend>; these are toggle buttons that change how a
       list is ordered, and `role="group"` with an accessible name is exactly
       what ARIA has for that. Same call GlossaryPanel's SortBar makes. */
    <div className="quotes-rank" role="group" aria-label="Order the quotes by">
      <span className="quotes-rank-label">order</span>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={`quotes-rank-btn${rank === option.key ? " on" : ""}`}
          aria-pressed={rank === option.key}
          title={option.title}
          onClick={() => onRank(option.key)}
        >
          {option.label}
        </button>
      ))}
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
}: {
  quotes: Quote[];
  bar: number;
  moved: boolean;
  onBar(bar: number | null): void;
}) {
  const stops = barStops(quotes);
  /* **One pass, and every number here comes out of it.** The list above, the
     `N of M` and the foot line have to agree, and the way they cannot disagree
     is for there to be one result rather than a filter beside a counter. */
  const { visible, hiddenCount } = visibleQuotes(quotes, bar);
  const note = barNote(hiddenCount, quotes.length);
  const count = `${visible.length} of ${quotes.length}`;

  return (
    <div className="quotes-bar">
      <div className="quotes-bar-row">
        <label className="quotes-bar-label" htmlFor="quotes-bar">
          bar
        </label>
        <span className="quotes-bar-value">
          {bar.toFixed(2)} · {count}
        </span>
        {/* Only once there is something to undo. A reset that is always there is
            a permanent invitation to a state you are already in. */}
        {moved && (
          <button
            type="button"
            className="quotes-bar-reset"
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
        className="quotes-bar-range"
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
      <p className="quotes-bar-note">{note}</p>
    </div>
  );
}

/**
 * One quote. The author's sentence, its numbers, and two small controls.
 *
 * **The row is one button and the ⓘ is another, beside it — never inside it.**
 * A button inside a button is invalid HTML and the browser's recovery is not
 * something to design against. The layout is a flex row so the two read as one
 * item, and the ⓘ is only rendered when there is a reason to show.
 */
function QuoteRow({
  quote,
  selected,
  scores,
  unscored,
  onSelect,
  onJump,
}: {
  quote: Quote;
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
        {quote.reason && (
          <Tooltip
            content={quote.reason}
            placement="left"
            open={why}
            onOpenChange={setWhy}
            className="quotes-why-card"
          >
            <button
              type="button"
              className={`quotes-why${why ? " on" : ""}`}
              aria-label="Why this one"
              aria-expanded={why}
              onClick={() => setWhy((was) => !was)}
            >
              <Info size={12} />
            </button>
          </Tooltip>
        )}
        <BlockRef id={quote.blockId} onJump={onJump} className="quotes-where" />
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
const LABEL: Record<RowScore["key"], string> = {
  importance: "Importance — how much of the argument rests on this line",
  striking: "Striking — how memorable and well put it is",
};

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
 * So this takes no artefact at all now, and `owner.quotes` is read at the call
 * site only as the *is there a list yet* test for whether to draw the foot.
 */
function Foot({ rerun }: { rerun(label: string, again?: boolean): ReactElement }) {
  return <div className="quotes-foot">{rerun("Choose them again", true)}</div>;
}

function Progress(props: {
  job: Job | null;
  starting: boolean;
  failed: StepFailure | null;
  stalled: boolean;
  onRun(): Promise<void>;
  onCancel(id: string): void;
  label: string;
}) {
  return (
    <JobProgress {...props} step="quotes" icon={<QuoteIcon size={13} />} runningLabel="Choosing…" />
  );
}
