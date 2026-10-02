/**
 * **Two facts about an author's heading that both sides of the wire need**, in
 * a module that imports nothing, so the browser can read them without reaching
 * into the pipeline (tests/client-imports.test.ts).
 *
 * The pipeline uses `sameHeading` to check that a node's `sourceHeading` really
 * is a heading in its range (src/tree-invariants.ts, src/heading-snap.ts); the
 * client uses the same comparison to decide whether a section title is that
 * heading, and so the author's words (src/web/tree.ts § `titleVoice`). One
 * function, so the two cannot disagree about an apostrophe.
 */

/** The title a preamble part wears — the one node the heading tree has no author text for. Ours. */
export const PREAMBLE_TITLE = "Before the first heading";

/**
 * Are these two heading strings the same heading?
 *
 * Not `===`, and the reason is worth stating because the obvious version of
 * this check was wrong for a year's worth of articles that simply never had the
 * character in them.
 *
 * `sourceHeading` is the author's heading text **quoted back by a model**, and a
 * model quoting text does not reproduce bytes — it reproduces the heading. Ask
 * one to repeat `Claude’s Constitution` and a fair share of the time you get
 * `Claude's Constitution`: same heading, straight apostrophe. Publishers emit
 * the curly one (U+2019) because their CMS does, so the mismatch is between two
 * spellings of the same punctuation mark and nothing else.
 *
 * That is not a hypothetical. The first article to reach this check with
 * apostrophes in its headings — the Anthropic constitution, 36 headings — failed
 * on **eleven** of them, and every one of the eleven was an apostrophe. Zero of
 * the failures were a heading the model had got wrong, which is what this check
 * is for. A validator whose errors are all false is worse than no validator: it
 * teaches whoever reads it to stop reading it.
 *
 * So the comparison folds the characters that have a typographic and a
 * typewriter spelling — quotes, apostrophes, the dashes, the ellipsis — and
 * collapses runs of whitespace. It deliberately does **not** fold case or strip
 * words: a heading rewritten rather than quoted is exactly what should still
 * fail here, and this stays strict about every part of the text that carries
 * meaning.
 */
export function sameHeading(a: string, b: string): boolean {
  return normalisePunctuation(a) === normalisePunctuation(b);
}

function normalisePunctuation(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}
