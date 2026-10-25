/**
 * **The labels of the summaries an author puts at the front of a piece** — an
 * executive summary, *Key points*, *Highlights*, *Significance*, *Author
 * summary* — and what a folded one's stub calls it.
 *
 * Greg, 2026-10-25, answering q-r8kumx with "B": fold them like the abstract,
 * a row in Structure, and the stub says which kind it is. One matter kind,
 * `summary`; which of these it was is read back from the stretch's first
 * block, the label, through this closed map, so a stub never shows the
 * article's own words or a model's.
 * docs/plans/261025f-an-executive-summary-and-the-other-front-summaries-fold-like-the-abstract.md.
 *
 * A leaf, importing nothing, because the reading view draws the stub
 * (src/web/matter-view.ts) and src/matter.ts, which finds the stretch, reaches
 * the model gateway that the browser may not import.
 */

/**
 * A label's words, lower case, without a section number in front ("7.",
 * "VII.", "A.", an appendix's "A.1.1") or punctuation at either end, and with apostrophes dropped
 * ("Authors' contributions").
 */
export function normaliseLabel(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’'`]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/^(?:\d+(?:\.\d+)*|[ivx]+|[a-z](?:\.\d+)*)(?:[.):]\s*|\s+)(?=\p{L})/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "");
}

/**
 * Each label, normalised, and its name on the stub. Not "Summary", "TL;DR",
 * "In brief" or "Key findings": "Summary" is as often a section of the body
 * (*8. Summary*, *2.5 Summary* in the 261018b corpus), and the rest were not
 * in Greg's list.
 */
const SUMMARY_LABELS: ReadonlyMap<string, string> = new Map([
  ["executive summary", "Executive summary"],
  ["key points", "Key points"],
  ["highlights", "Highlights"],
  ["research highlights", "Research highlights"],
  ["significance", "Significance"],
  ["significance statement", "Significance statement"],
  ["author summary", "Author summary"],
]);

/** The stub's name for a summary whose first block is not one of the labels: never expected, never the page's words. */
export const SUMMARY_FALLBACK_LABEL = "Summary";

/** Whether a block's whole text is a front summary's label. */
export function isSummaryLabel(text: string): boolean {
  return SUMMARY_LABELS.has(normaliseLabel(text));
}

/** The stub's name for a summary that opens with this label. */
export function summaryStubLabel(firstBlockText: string): string {
  return SUMMARY_LABELS.get(normaliseLabel(firstBlockText)) ?? SUMMARY_FALLBACK_LABEL;
}
