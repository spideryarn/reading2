/**
 * The documents and the page ranges the bake-off reads, shared by the harness
 * and the scorer so the two cannot disagree about which pages were asked for.
 *
 * That is not a tidiness point. The scorer's first question is "did every
 * requested page come back", and a scorer that infers the requested pages from
 * the output can only ever answer yes.
 */

export interface Doc {
  name: string;
  file: string;
  /** Chunks of contiguous pages to transcribe, 1-based, with an optional context page. */
  chunks: { context?: number; pages: number[]; why: string }[];
}

export const DOCS: Doc[] = [
  {
    name: "easy",
    file: "evals/pdf/easy/source.pdf",
    chunks: [
      { pages: [1, 2], why: "first page: title block, abstract, keywords, running header" },
      { context: 4, pages: [5, 6], why: "dense middle, paragraph continuing across the break" },
    ],
  },
  {
    name: "harder",
    file: "evals/pdf/harder/source.pdf",
    chunks: [
      { pages: [1, 2], why: "first page: two columns begin, author block, abstract" },
      { context: 6, pages: [7, 8], why: "densest pages, tables and captioned figures" },
    ],
  },
  {
    name: "much-harder",
    file: "evals/pdf/much-harder/source.pdf",
    chunks: [
      { pages: [2, 3], why: "first content pages of the scan (page 1 is Wellcome's rights page)" },
      { context: 9, pages: [10, 11], why: "mid-pamphlet, worst foxing, hyphenation across line-ends" },
    ],
  },
];
