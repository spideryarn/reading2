/**
 * **Which way a passage cuts, said four ways** — a rank, a direction in words,
 * a signed number, and only then a colour.
 *
 * The order of that sentence is the design. docs/project/colour-scales.md is
 * blunt that **colour may never be the only carrier** of a good/bad judgement,
 * and the red↔green default this mode ships with is permitted *only* under a
 * stated condition: use it where the reader already knows which end is which
 * from something other than the colour — a printed number, a label, a position.
 * `DivergingScale` in src/referee-criteria.ts writes that condition down beside
 * the column, and adds the part that matters here: **if the panel ever stops
 * printing the direction in words, the default stops being permitted.** This
 * file is where the words are produced, so this file is that condition.
 *
 * ## Anchored at zero, never at the data
 *
 * `step` maps −100…+100 onto the nine ramp steps with **0 always landing on the
 * middle one**. The tempting alternative — scale to the range the results
 * actually cover — is wrong in the way that does not look wrong: three passages
 * at −80, −60 and −40 would paint one of them at the *favourable* end of the
 * scale, in green, because it is the least bad of the three. Nothing would
 * error and the panel would be saying the opposite of what the model said. The
 * scale is fixed because the units are fixed.
 *
 * ## It returns a token name, never a colour
 *
 * The same seam src/web/hit-colours.ts keeps and states in one line: *the
 * colour belongs to the design tokens.* A function here returning `#8fd99a`
 * would put a hex value beyond the reach of the theme, and changing the ramp
 * would mean editing TypeScript.
 */

import type { DivergingScale, RefereePoles } from "../referee-criteria.js";

/** How many steps the diverging ramps have — `--div-0` … `--div-8`. */
export const DIVERGING_STEPS = 9;

/**
 * Which step of the ramp a valence lands on, **with zero fixed at the middle**.
 *
 * −100 → 0, 0 → 4, +100 → 8. Clamped at both ends rather than trusted, because
 * a stored row is cast on the way back in rather than re-validated (the same
 * reason `keepAbove` in search-hits.ts tolerates a null confidence), and a step
 * of `-1` would emit `var(--div-rg--1)` — which is not an error anywhere, it is
 * a property nothing defines and therefore an element with no background.
 */
export function valenceStep(valence: number): number {
  const bounded = Math.min(100, Math.max(-100, Number.isFinite(valence) ? valence : 0));
  const step = Math.round(((bounded + 100) / 200) * (DIVERGING_STEPS - 1));
  return Math.min(DIVERGING_STEPS - 1, Math.max(0, step));
}

/** The custom property for that step on this criterion's ramp. */
export function valenceToken(scale: DivergingScale, valence: number): string {
  return scale === "rg"
    ? `var(--div-rg-${valenceStep(valence)})`
    : `var(--div-${valenceStep(valence)})`;
}

/**
 * **The direction in words**, which is the carrier the colour is only ever
 * decoration on.
 *
 * Three answers and not two: **zero is a real answer** meaning *neither way*,
 * and it is the commonest one. Rounding it into "counts for" because the number
 * is not negative would be the panel making a judgement the model did not.
 *
 * The plan's wording — "counts against" / "counts for" — kept exactly, because
 * it is the phrasing Greg's own poles are written to complete.
 */
export function valenceWords(valence: number): string {
  if (valence < 0) return "counts against";
  if (valence > 0) return "counts for";
  return "counts neither way";
}

/**
 * The signed number as a reader should see it — `+70`, `−40`, `0`.
 *
 * An explicit `+` on the positive side, because the sign *is* the direction and
 * a bare `70` beside a `−40` reads as a magnitude. A real minus sign (U+2212)
 * rather than a hyphen, which is what the rest of this repo's prose uses and
 * what a screen reader pronounces as "minus".
 */
export function signedValence(valence: number): string {
  if (valence > 0) return `+${valence}`;
  if (valence < 0) return `−${Math.abs(valence)}`;
  return "0";
}

/**
 * The whole of what a row says about one passage's valence, as one sentence —
 * **for the accessible name, which must carry everything the visible row does.**
 *
 * Rank first, because the rank is what the panel leads with (the plan's § 1:
 * *the ordinal, large, with the number small beside it*). Then the direction in
 * words, then the referee's own end in their own words, then the number. A
 * reader using a screen reader gets the identical four facts a sighted reader
 * gets, in the identical order, and neither of them gets the colour.
 */
export function valenceLabel(rank: number, valence: number, poles: RefereePoles): string {
  const end = valence < 0 ? poles.against : valence > 0 ? poles.favour : null;
  const direction = valenceWords(valence);
  return end === null
    ? `${rank}. ${direction}, ${signedValence(valence)}`
    : `${rank}. ${direction} — ${end} — ${signedValence(valence)}`;
}
