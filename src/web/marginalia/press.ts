/**
 * **What a press of the Marginalia button does.** Greg's rule for a window too
 * narrow for the band and the notes together: *"whichever has been activated
 * most recently trumps/swaps out the other"* (SPIDERYARN-READING2-7P).
 *
 * Pressing a band already wins over the notes (layout.ts § `fitBoth`: below the
 * width for both, the band takes the room and `?margin=1` stays). This is the
 * other half: pressing Marginalia where the two do not fit together, but the
 * notes would fit alone, closes the band and keeps the notes on — whether they
 * were off, or on and hidden behind a band that won. Everywhere else it is a
 * plain toggle, a phone included: there the notes do not fit even alone, and
 * closing the reader's band to show a line saying so would be worse than
 * nothing.
 * docs/plans/261001k-annotations-head-path-wraps-and-the-notes-swap-in-on-a-narrow-window.md.
 */
import { type FitInput, fitView } from "../layout.js";

/**
 * **Where the notes would fit, were they on** — beside the band that is open,
 * and with no band. Hypothetical by necessity: while the notes are off the
 * live `Fit` has `margW` 0 whatever the width. Thresholds (GPT Sol on the
 * plan): alone from 612px with the rail, 600 without; beside a band from 900,
 * 888 without.
 */
export function notesFit(
  input: Omit<FitInput, "margin" | "modeBand">,
  bandOpen: boolean,
): { both: boolean; alone: boolean } {
  return {
    both: fitView({ ...input, margin: true, modeBand: bandOpen }).margW > 0,
    alone: fitView({ ...input, margin: true, modeBand: false }).margW > 0,
  };
}

export type MarginaliaPressInput = {
  /** `?margin=1` is on now. */
  margin: boolean;
  /** A band is open on the left (`mode !== "plain"`). */
  bandOpen: boolean;
  /** `fitView` with the open band and `margin: true` gives the notes a width.
   *  Ignored with no band open. */
  bothFit: boolean;
  /** `fitView` with no band and `margin: true` gives the notes a width. */
  aloneFit: boolean;
};

export type MarginaliaPress = { margin: boolean; closeBand: boolean };

export function marginaliaPress({
  margin,
  bandOpen,
  bothFit,
  aloneFit,
}: MarginaliaPressInput): MarginaliaPress {
  if (bandOpen && !bothFit && aloneFit) return { margin: true, closeBand: true };
  return { margin: !margin, closeBand: false };
}
