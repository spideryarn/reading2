/**
 * The article's own section number, taken off a title we draw our number beside.
 *
 * Structure, Summary and Diagram put "2.1" beside a tree title, and a title taken
 * from the article's heading often already says "3.2 Methods" — so the reader saw
 * "2.1 3.2 Methods" (SPIDERYARN-READING2-4Q). This is applied where our number is
 * minted, `buildSummaryTree`, and nowhere else: the stored tree, the Spine and the
 * prose keep the article's words.
 *
 * Deliberately narrow, because a wrong strip eats a real word and a missed one
 * only repeats a number. Kept: any component of three or more digits ("2008
 * financial crisis"), a bare letter ("C. elegans", "A. Proofs"), a roman numeral
 * with no `.` or `)` ("I think"), a one-letter roman before a lower-case word
 * ("V. cholerae"), and anything that would leave nothing behind ("1.").
 *
 * docs/plans/260929d-remove-hierarchy-mode-and-heading-numbers.md § The regex.
 */

/** `1`, `3.2`, `1.2.3`, `A.1` — one or two digits a component, a letter only in front. */
const ARABIC = String.raw`(?:[A-Za-z]\.)?\d{1,2}(?:\.\d{1,2})*`;
/** I, V and X only, one case at a time. */
const ROMAN = String.raw`(?:[IVX]{1,6}|[ivx]{1,6})`;

/** `(3.2)`, or `3.2` with an optional `.`, `)` or `:`, then an optional spaced dash. */
const ARABIC_PREFIX = new RegExp(
  String.raw`^\s*(?:\(${ARABIC}\)|${ARABIC}[.):]?)(?:\s+[-–—])?\s+(?=\S)`,
);
/** `(iv)`, `IV.` or `ii)` — the punctuation is required. */
const ROMAN_PREFIX = new RegExp(String.raw`^\s*(?:\((${ROMAN})\)|(${ROMAN})[.)])\s+(?=(\S))`);

export function withoutOwnNumber(title: string): string {
  const arabic = ARABIC_PREFIX.exec(title);
  if (arabic) return title.slice(arabic[0].length);

  const roman = ROMAN_PREFIX.exec(title);
  if (roman) {
    const numeral = roman[1] ?? roman[2] ?? "";
    const next = roman[3] ?? "";
    // "V. cholerae", "X. laevis": a genus initial, not a section.
    const species = numeral.length === 1 && next !== next.toUpperCase();
    if (!species) return title.slice(roman[0].length);
  }
  return title;
}
