/**
 * **What an explanation says of itself**, in the words the band and the margin
 * both draw — one copy, so the two cannot drift (docs/project/controls.md §
 * Controls that do the same job look the same). Greg, spya-nkq6rj: *"if Opus
 * is unsure itself, it should say so"*, *"it should be clear if some of its
 * responses are based on stuff that came from out the article"*.
 * docs/plans/261028c-explanations-of-confusing-passages-and-sources-feeding-the-margin.md.
 */
import type { Explanation } from "../types.js";

/** The label for an explanation the model was unsure of (`sure: false`). */
export const NOT_SURE_LABEL = "Not sure";
/** The label for one that relies on what the model knows from outside the piece (`outside: true`). */
export const OUTSIDE_LABEL = "Draws on AI memory, unchecked";

/** The accessible name and card head of an explanation's *Ask in chat*. */
export const ASK_EXPLANATION_IN_CHAT = "Ask about this explanation in chat";

/** The labels that apply to one explanation, in the order they are drawn — none when neither applies. */
export function explanationLabels(e: Pick<Explanation, "sure" | "outside">): string[] {
  return [...(e.sure ? [] : [NOT_SURE_LABEL]), ...(e.outside ? [OUTSIDE_LABEL] : [])];
}
