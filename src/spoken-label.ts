/**
 * The longest a label on a pointer or a tool run may be.
 *
 * These are short by construction — `show_passage` asks for "a few words naming
 * what is in the passage", and a tool's label is `searched your library for
 * "predictive processing"`. The cap is not a product rule, it is a bound on
 * what a browser can put in a column: everything on this route is a claim by
 * the browser, and the two fields with no natural length were the two with no
 * limit. Trimmed rather than refused, because a long label is a cosmetic
 * problem and throwing the whole exchange away over one would lose the reader's
 * words for it.
 */
const MAX_SPOKEN_LABEL = 400;

/** Trim rather than refuse. See `MAX_SPOKEN_LABEL`. */
export function shortenedSpokenLabel(text: string): string {
  return text.length > MAX_SPOKEN_LABEL ? text.slice(0, MAX_SPOKEN_LABEL) : text;
}

