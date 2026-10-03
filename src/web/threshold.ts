/**
 * **The one threshold rule every slider shares.**
 *
 * Glossary (`?gate=`), Quotes (`?bar=`) and Search (`?conf=`) each put a
 * threshold under the reader's hand — Citations (`?citebar=`) and the FAQ (`?faqbar=`) joined them later,
 * and Debate's categorical bar (`?name=`, debate-levels.ts) uses the same pass —
 * and until 2026-09-03 the first three disagreed about
 * what one is for: Search hid what was below it, while the other two moved it
 * into a second group headed *"the rest"*. Greg looked at the built thing and
 * said the grouping was not clearer:
 *
 * > if I set the threshold high, it shows the highest-priority first, and then
 * > all the rest just below. I think it would be clearer if it only showed the
 * > stuff above threshold (with an indication below perhaps that "N hidden
 * > because they're below the X threshold" […]) And there are other modes with
 * > thresholds - they should work the same way.
 * >
 * > — Greg, 2026-09-03
 *
 * So the three numeric sliders that existed then hide and say how many they are
 * holding back. Citations inherited that rule, and Debate reuses it over an
 * ordinal rank for its categorical levels. The rule lives here rather than in
 * one copy per panel. Each caller passes its own score accessor: the glossary
 * multiplies two scores, quotes take a maximum over whichever arrived, Search
 * carries confidence, Citations uses its weighted score, and Debate maps its
 * named levels to an ordinal only for this pass.
 *
 * The reference-list argument that justified grouping — *a term you cannot find
 * is a term you have lost* — did not survive contact: the bar is on screen with
 * its number, the foot line says how many it is holding back, and dragging it
 * left is one gesture. A term is not lost when the control that hid it is the
 * control in your hand.
 *
 * ## Why an outcome object rather than a family of counting helpers
 *
 * This is the whole design decision. Each panel used to have a `countAbove`
 * beside a `groupX` beside a note function, and each walked the list again with
 * its own copy of the rule — which is exactly how a list ends up rendering two
 * rows over the words `0 of 10`. **A count that disagrees with the list under
 * it is this feature's worst failure**, so the visible list, the `N of M`, the
 * hidden count, the empty branch and the foot line all come out of one pass and
 * one result.
 *
 * What deliberately stays with each panel: the track (a data-derived maximum
 * next door, an index into real stops for quotes, a fixed 0–100 for search),
 * the unit, and which noun the foot line uses. Those genuinely differ, and
 * unifying them would be the over-abstraction.
 *
 * docs/plans/260903c-threshold-sliders-hide-below-threshold-items.md § Stage 2.
 */

/** What one pass over a list at one threshold produced. */
export interface ThresholdResult<T> {
  /** The items to draw, in the order they arrived. */
  visible: T[];
  /** How many the bar is holding back. `visible.length + hiddenCount` is the whole list. */
  hiddenCount: number;
  /**
   * How many of the survivors got in without a score.
   *
   * They are in `visible` — see below — but a row with no numbers beside it in
   * an unheaded list otherwise reads as though it cleared the threshold, so the
   * panels put a `title` on it saying it was not scored.
   */
  unscoredCount: number;
}

/**
 * Does this item survive the bar?
 *
 * **A missing score always survives**, and it is the one line here that must
 * not be got wrong. Greg, asked whether an unscored entry should be hidden with
 * the rest or always shown: *"In the interim, always show them."* Four
 * different absences arrive at this function and the rule is right for all of
 * them:
 *
 *  - **A glossary entry the model failed to score**, which the prompt requires
 *    and which stage 1 of the plan found no instance of. Hiding it would
 *    silently drop a good entry for a field the reader cannot see.
 *  - **A quote scored on one axis, or neither**, which the quotes prompt
 *    explicitly permits.
 *  - **Every literal search match.** Words mode has no confidence at all, so
 *    reading null as zero would empty that list the moment an
 *    `?order=prioritised` link was opened there.
 *  - **A citation with no relevance.** Its weighted score is mostly relevance,
 *    and absence is not evidence that the work is unimportant. A citation
 *    whose *influence* alone is missing is **not** one of these since
 *    2026-10-03: the model now says "unknown" whenever it is not confident it
 *    knows the work, which is common, so that row arrives here with a score,
 *    its relevance alone (`priorityOf` in CitationsPanel.tsx; plan 261003m).
 *    That is the same arithmetic as assuming its influence equals its
 *    relevance, which is not neutral and is said so there.
 *
 * In all four, showing it is the lossless direction: a thing the reader can
 * see and judge beats one withheld on the strength of a missing field. Note
 * `== null` rather than a falsy check — **zero is a score**, and an item the
 * model scored `0` is not one it declined to score.
 *
 * Inclusive at the bar, because the number is printed on the row: a term
 * showing `0.30` that vanished at a threshold of `0.30` reads as a bug.
 */
export function survivesThreshold(score: number | null | undefined, threshold: number): boolean {
  return score == null || score >= threshold;
}

/**
 * Apply the bar to a list, once, and answer everything the panel needs to know.
 *
 * Order-preserving: a filtered list is still in whatever order it arrived in.
 * A copy, never the caller's array, so nothing downstream can be reordered
 * under a set of marks already on screen.
 */
export function applyThreshold<T>(
  items: readonly T[],
  threshold: number,
  scoreOf: (item: T) => number | null | undefined,
): ThresholdResult<T> {
  const visible: T[] = [];
  let hiddenCount = 0;
  let unscoredCount = 0;
  for (const item of items) {
    const score = scoreOf(item);
    if (!survivesThreshold(score, threshold)) {
      hiddenCount += 1;
      continue;
    }
    if (score == null) unscoredCount += 1;
    visible.push(item);
  }
  return { visible, hiddenCount, unscoredCount };
}

/** The singular and the plural of whatever this panel is counting. */
export interface ThresholdNoun {
  one: string;
  many: string;
}

/**
 * The foot line: how many the bar is holding back, and the way to get them back.
 *
 * **Present wherever the threshold control is, and absent wherever it is not.**
 * Including the case where the bar has hidden everything — a line that is
 * sometimes missing for a *different* reason teaches the reader nothing, and an
 * empty list under a slider is otherwise ambiguous between *there is nothing
 * here* and *you have hidden it all*.
 *
 * Two words are deliberately not in this copy:
 *
 *  - **"clears"**, which the three original panels each used to say. An unscored item
 *    survives without clearing anything, so the verb would be a small lie in
 *    exactly the place this feature has to be honest.
 *  - **"the rest"**, which named the second group. That group is gone.
 *
 * One sentence parameterised by its noun rather than one copy per panel: copies
 * of one sentence are how panels come to disagree. The original plan expected
 * the copy to stay beside each panel on the grounds that it differed; after
 * this change it does not.
 *
 * Not in [`src/messages.ts`](../messages.ts): that module is defined around
 * model-call failures and their four `kind`s (docs/project/copy.md), and a
 * threshold note is not a failure.
 */
export function hiddenNote(hidden: number, total: number, noun: ThresholdNoun): string {
  if (hidden === 0) return "Nothing is hidden by this threshold.";
  const subject =
    hidden === 1 ? `1 ${noun.one} is` : `${hidden} ${noun.many} are`;
  /* "All" only when it is telling the reader something the count does not
     already: with one hidden thing, "All 1 term is hidden" is not English and
     "1 term is hidden" is the same fact. */
  const all = hidden === total && hidden > 1 ? "All " : "";
  const them = hidden === 1 ? "it" : "them";
  return `${all}${subject} hidden by this threshold. Drag the slider left to show ${them}.`;
}

/* ------------------------------------------------------------ the track --
   The arithmetic of a slider that ends where the data does. It was the
   Glossary's (GlossaryPanel.tsx § prioritised) and was copied once into
   Citations; the FAQ would have been the third copy, so since 2026-09-29 it
   lives here, taking a score accessor like `applyThreshold` does
   (docs/plans/260929g-faq-difficulty-centrality-and-a-threshold.md, Sol F4).
   The Glossary and Citations keep their own names as one-line wrappers. The
   reasoning behind each rule is in GlossaryPanel.tsx beside `gateTop` and
   `canPrioritise`, and it is the same for every caller. */

/**
 * How far a threshold slider moves in one step, and therefore how precise its
 * URL value gets: two decimal places, which is what `gateParam`, `citeBarParam`
 * and `faqBarParam` serialize.
 */
export const GATE_STEP = 0.01;

/** How many steps span 0-1, and therefore the grid the URL values are written on. */
const GATE_STEPS = Math.round(1 / GATE_STEP);

/**
 * **The largest position of the slider at or below a score.**
 *
 * `Math.floor(score / GATE_STEP)` loses a whole step wherever the quotient
 * lands a hair under an integer — `0.58 / 0.01` is `57.99999999999999` — so
 * round the quotient to a sane number of places before flooring, and divide by
 * 100 rather than multiplying by `0.01`, since `57 / 100` is exactly the double
 * `0.57` the URL round-trips. Never above its argument: the item a number was
 * computed from always survives that number.
 */
export function floorToGateStep(score: number): number {
  const steps = Math.floor(Math.round((score / GATE_STEP) * 1e9) / 1e9);
  return steps / GATE_STEPS;
}

/**
 * The right-hand end of the track **as the data alone decides it**: the largest
 * score in the list, floored to a stop. Zero when nothing is scored.
 * Floored, not rounded up, so the top stop always shows the top item.
 */
export function thresholdTop<T>(
  items: readonly T[],
  scoreOf: (item: T) => number | null | undefined,
): number {
  let top = 0;
  for (const item of items) {
    const s = scoreOf(item);
    if (s != null && s > top) top = s;
  }
  return floorToGateStep(top);
}

/**
 * The track's rendered maximum: the data's top, the current value (so a link's
 * off-range value still has somewhere to sit), and one step at least (so an
 * unscored list still has a track to render). **Never ask this whether the
 * list can be thresholded** — it folds in the current value; ask `canThreshold`.
 */
export function thresholdMax<T>(
  items: readonly T[],
  threshold: number,
  scoreOf: (item: T) => number | null | undefined,
): number {
  return Math.max(thresholdTop(items, scoreOf), threshold, GATE_STEP);
}

/**
 * **Would any position of the bar hide anything?** True exactly when some score
 * sits strictly below the track's top stop — equivalently, when the bar at
 * `thresholdTop` hides something. A list that answers false has no prioritised
 * order worth offering: every position the reader can reach would show the
 * same list.
 */
export function canThreshold<T>(
  items: readonly T[],
  scoreOf: (item: T) => number | null | undefined,
): boolean {
  const top = thresholdTop(items, scoreOf);
  for (const item of items) {
    const s = scoreOf(item);
    if (s != null && s < top) return true;
  }
  return false;
}
