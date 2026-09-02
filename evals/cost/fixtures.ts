/**
 * The three articles the cost eval holds constant — **a committed manifest, not
 * a directory listing**, for the reason evals/hierarchy-structure/corpus.ts
 * gives: what gets measured has to be a decision, and a run has to be able to
 * say the bytes were the bytes.
 *
 * All three are files already in the tree; nothing new was downloaded. The
 * figures were measured on 2026-09-02 by running `runExtract`, `runBlocks`,
 * `pass0` and `planChunks` locally — every one of which is free, checked in the
 * code before running rather than assumed. Stage 3 of
 * docs/plans/260902g-estimate-article-ingestion-and-mode-generation-costs.md
 * records the method and the two gaps in the corpus:
 *
 * - **Nothing checked in is a normal ~1,000-word article.** The hole runs from
 *   625 words (one of the deliberately-broken extraction fixtures, so excluded)
 *   to 1,638 (a scene of a play). 561 words is the closest honest choice, and
 *   the report must say 561 rather than "about a thousand".
 * - **No PDF fixture is near 20 pages.** `much-harder` is 17 and a photographic
 *   scan, so its cost would be vision transcription; `harder` is 14 and
 *   born-digital. Taking `harder` and flagging the shortfall — a true 20-page
 *   fixture is a new licensed download, which is Greg's decision.
 *
 * `planChunks` also confirmed the plan's own warning: pages ÷ 6 predicts the
 * chunk count wrongly three times out of three, because `MAX_CHUNK_PAGES` caps
 * it. `chunks` below is the planner's answer, not arithmetic.
 */

import type { DocumentKind } from "../../src/fetch.js";

export interface CostFixture {
  /** The name a run is filed under, and half of its run-tagged slug. */
  name: string;
  /** Repo-relative, resolved against the repo root by run.ts. */
  file: string;
  kind: DocumentKind;
  /** What `Content-Type` the fixture step claims, so stage 2 branches as it would live. */
  contentType: string;
  /** sha256 of the file as committed. Re-hashed at run time and refused on a mismatch. */
  sha256: string;
  /** Words in the extracted article, measured 2026-09-02. */
  words: number;
  /**
   * Blocks and gistable blocks stage 3 produced, measured 2026-09-02 — `null`
   * for the PDF, whose extraction costs money and so was not measured for free.
   *
   * The runner compares the block count the job reports against this and says
   * so when they differ. That is the comparability check the whole manifest is
   * for: the same file can produce different blocks after a change to the
   * splitter, and a cost per block is meaningless if nobody noticed.
   */
  blocks: number | null;
  gistableBlocks: number | null;
  /** PDF only: pages, and the chunk plan `planChunks` produced. */
  pages?: number;
  chunks?: number;
  /** What the report should say about this pick, rather than letting a reader assume. */
  caveat?: string;
}

export const FIXTURES: readonly CostFixture[] = [
  {
    name: "short-html",
    file: "tests/fixtures/data-root/data/writes/raw.html",
    kind: "html",
    contentType: "text/html; charset=utf-8",
    sha256: "728a75e7d96b2727aad5cb35b66966fdb724e1999999438e8fba3a13cdfd4dc4",
    words: 561,
    blocks: 19,
    gistableBlocks: 18,
    caveat:
      "561 words, not ~1,000 — nothing checked in sits in the 700–1,500 band that is not " +
      "either a broken extraction fixture or a play. Report it as 561.",
  },
  {
    name: "long-html",
    file: "evals/extraction/fixtures/gwern.html",
    kind: "html",
    contentType: "text/html; charset=utf-8",
    sha256: "4a2564b8da9689f11afab5c99b621930defad2f305aaa0da7ff2e80152086f18",
    words: 16_855,
    blocks: 186,
    gistableBlocks: 177,
    caveat:
      "Checked for the duplicate-block failure its corpus exists to provoke: zero exact " +
      "duplicates under current code, so the word count is trustworthy.",
  },
  {
    name: "pdf",
    file: "evals/pdf/harder/source.pdf",
    kind: "pdf",
    contentType: "application/pdf",
    sha256: "18d0d66a7f975d865b224cf27d9f2c489ddf670975d72d91d380e1db69597318",
    words: 11_937,
    blocks: null,
    gistableBlocks: null,
    pages: 14,
    chunks: 5,
    caveat:
      "14 pages, not 20. `much-harder` is 17 but is a photographic scan, so its cost is " +
      "vision transcription and not representative. Extraction pays here and nowhere else.",
  },
];

export function fixtureByName(name: string): CostFixture {
  const found = FIXTURES.find((f) => f.name === name);
  if (!found) {
    throw new Error(`No cost fixture named "${name}". Have: ${FIXTURES.map((f) => f.name).join(", ")}`);
  }
  return found;
}
