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
 * **Since 2026-09-02 the prose is painted by valence too**, at Greg's
 * direction: *"I was thinking that it should match the colour of the left-hand
 * panel. If that's set to red/green, so should the prose be."* The prose has no
 * words, so the condition above would not be met by the panel's four carriers —
 * they are not beside the mark. What pays for it is `valenceDirection` below: a
 * mark drawn by valence carries a **sign** as well as a hue, written through
 * `data-dir` and drawn as generated content by styles.css, plus a visible key
 * in the Criteria panel. A minus sign survives greyscale, deuteranopia and
 * protanopia intact, which a hue does not.
 * docs/plans/260902e-make-referee-mode-understandable.md.
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
 * The same step as an **RGB triple** — `var(--div-rg-0-rgb)`.
 *
 * Two functions rather than one with a flag, because the two callers want two
 * different things and neither can use the other's. A panel swatch sets
 * `background` and wants a *colour*; a mark in the prose is painted by a
 * stylesheet rule that writes `rgb(var(--h0))` (styles.css § stacked hues), so
 * what it needs is the **three numbers** to interpolate — hand it
 * `var(--div-rg-0)`, whose value is itself an `rgb(…)` expression, and the
 * declaration is invalid at computed-value time and the stripe simply does not
 * paint. Silent, and exactly the shape docs/reusable/silent-success.md is
 * about, which is why the two spellings are two functions with two names rather
 * than one function a caller can get subtly wrong.
 *
 * `valenceStep` is shared rather than re-derived: the step arithmetic is the
 * part with the anchored-at-zero decision in it, and two copies of it would be
 * two places for the panel and the prose to disagree about which end a passage
 * is at. styles/colourscales.css derives every `--div-N` from its `--div-N-rgb`
 * for the same reason, and tests/colour-scales.test.ts checks it still does.
 */
export function valenceRgbToken(scale: DivergingScale, valence: number): string {
  return scale === "rg"
    ? `var(--div-rg-${valenceStep(valence)}-rgb)`
    : `var(--div-${valenceStep(valence)}-rgb)`;
}

/**
 * **Which way a passage cuts, as a word the markup can carry** — the non-colour
 * half of a valence mark in the prose.
 *
 * Three answers and not two, for `valenceWords`' reason: zero is a real answer
 * meaning *neither way*, and it is the commonest one.
 *
 * It exists because a mark drawn by valence would otherwise make **colour the
 * only carrier of a good/bad judgement**, which docs/project/colour-scales.md
 * forbids and which the panel row avoids four times over. `annotateHtml` writes
 * this onto the mark as `data-dir` and styles.css turns it into a small
 * superscript sign — generated content, so it cannot be copied out of the
 * article and cannot reach the block's text offsets.
 */
export type ValenceDirection = "against" | "neither" | "for";

export function valenceDirection(valence: number): ValenceDirection {
  if (valence < 0) return "against";
  if (valence > 0) return "for";
  return "neither";
}

/**
 * **The fourth value `data-dir` can take**, which no valence produces.
 *
 * A rendered run can be covered by two valence marks pointing opposite ways —
 * two results of one criterion, or two criteria — and `annotateHtml` draws both
 * stripes. Printing one of the two signs there would be the renderer choosing a
 * verdict, so it writes `mixed` and styles.css draws `±`.
 *
 * It lives here rather than in annotate.ts because of `directionWords` below:
 * the four phrases are one list, and the stylesheet's alt text is checked
 * against it (tests/valence.test.ts).
 */
export type MarkDirection = ValenceDirection | "mixed";

/**
 * **The one copy of the four phrases** — *counts against*, *counts for*,
 * *counts neither way*, *counts both ways*.
 *
 * Three places need them and they must not drift: the panel row's visible
 * words, the panel row's spoken sentence, and the **alt text on the sign in the
 * prose** (`content: "−" / "counts against"` in styles.css, which is how a
 * screen-reader user hears a mark they have arrived at directly rather than
 * through the panel). The stylesheet cannot import this, so it necessarily
 * holds a copy of the strings — and tests/valence.test.ts reads styles.css off
 * disk and compares the two, which is what makes it a copy that cannot drift
 * rather than a second source of truth.
 *
 * **Criterion-neutral wording on purpose.** The referee's own pole words
 * ("underpowered", "well-controlled") belong to one criterion, and a mark in
 * the prose can be drawn by any of several at once — so the phrase beside a
 * mark says which *way* it cuts and never which end of whose scale.
 */
export function directionWords(dir: MarkDirection): string {
  switch (dir) {
    case "against":
      return "counts against";
    case "for":
      return "counts for";
    case "neither":
      return "counts neither way";
    case "mixed":
      return "counts both ways";
  }
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
  return directionWords(valenceDirection(valence));
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
  return `${rank}. ${valenceSentence(valence, poles)}`;
}

/**
 * The same three facts without the rank — *"counts against — underpowered —
 * −64"*.
 *
 * Pulled out of `valenceLabel` rather than written a second time when the
 * referee-vs-model line arrived (`CriteriaPanel`'s `RefereeGap`), which prints
 * the model's judgement inside a sentence that already has the referee's in
 * front of it and so has no rank to lead with. Two copies of this ordering
 * would be two places for the poles to end up swapped, and swapping them is the
 * failure tests/referee-criteria-panel.test.tsx exists to catch.
 */
export function valenceSentence(valence: number, poles: RefereePoles): string {
  const end = valence < 0 ? poles.against : valence > 0 ? poles.favour : null;
  const direction = valenceWords(valence);
  return end === null
    ? `${direction}, ${signedValence(valence)}`
    : `${direction} — ${end} — ${signedValence(valence)}`;
}
