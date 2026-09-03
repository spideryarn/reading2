/**
 * **The one threshold rule the three sliders share.**
 *
 * Glossary (`?gate=`), Quotes (`?bar=`) and Search (`?conf=`) each put a
 * threshold under the reader's hand, and until 2026-09-03 they disagreed about
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
 * So all three now hide, all three say how many they are holding back, and the
 * rule they hold in common is here rather than written a third time. Each
 * caller passes its own score accessor, because the *composite* differs and
 * nothing else does: the glossary multiplies two scores, quotes take a maximum
 * over whichever arrived, and a search hit carries the model's confidence.
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
 * the rest or always shown: *"In the interim, always show them."* Three
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
 *
 * In all three, showing it is the lossless direction: a thing the reader can
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
 * Order-preserving: a filtered list is still in whatever order it arrived in,
 * which for all three callers is the reader's own order through the piece.
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
 *  - **"clears"**, which the three panels each used to say. An unscored item
 *    survives without clearing anything, so the verb would be a small lie in
 *    exactly the place this feature has to be honest.
 *  - **"the rest"**, which named the second group. That group is gone.
 *
 * One sentence in three shapes rather than three copies in three panels: the
 * only thing that differs is the noun, and three copies of one sentence is how
 * they come to disagree. The plan expected the copy to stay beside each panel
 * on the grounds that it differed; after this change it does not.
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
