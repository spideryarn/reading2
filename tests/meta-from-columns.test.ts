/**
 * **The owner-facing `Meta` names every column it is handed.**
 *
 * `metaFrom` (src/store/pg.ts) rebuilds a reader's `Meta` from the revision
 * columns field by field, and a field it does not name is simply absent — the
 * class in docs/postmortems/261009h-a-flag-the-store-did-not-keep.md. `quality`
 * went that way: the PDF checker's complaints had no column, so this read never
 * had them to give (plan 261009n).
 *
 * Two halves, both checked by the compiler before the assertion runs:
 *
 * - the row is **every `META_COLUMNS` entry, non-null**, so a column added to
 *   the projection does not compile into the fixture until it has a value;
 * - `WHERE` places **every `Meta` key**, so a field added to the type does not
 *   compile until somebody says whether this read surfaces it.
 *
 * Then every key marked `"surfaced"` must come back.
 */
import { describe, expect, it } from "vitest";

import { metaFrom, type MetaRow } from "../src/store/pg.js";
import type { Meta } from "../src/types.js";

const ROW: { [K in keyof MetaRow]: NonNullable<MetaRow[K]> } = {
  title: "A paper",
  byline: "Somebody",
  siteName: "Somewhere",
  lang: "en",
  excerpt: "Two sentences.",
  /* Exclusive with `publishedYear` in the table, not here: this read only
     reports what it is given. */
  publishedAt: "2011-03-10",
  note: "a note",
  abstract: "An abstract.",
  doi: "10.1234/example",
  journal: "A Journal",
  publishedYear: 2011,
  finalUrl: "https://example.test/landed",
  fetchedAt: new Date("2026-03-04T05:06:07.000Z"),
  rawSha256: "a".repeat(64),
  rawFilename: "paper.pdf",
  source: "pdf",
  extractMethod: "openai/gpt-5.6-luna/pdf-v1",
  pages: 17,
  unverified: false,
  recall: 0.94,
  pagesChecked: 12,
  quality: ["page 3: a paragraph in the text layer is missing"],
  readingLanguage: 3,
  readingIdeas: 3,
  readingDifficultyReason: "Dense but plain.",
};

/** Where each `Meta` field comes from on this read, or why it does not. */
const WHERE: Record<keyof Meta, "surfaced" | { elsewhere: string }> = {
  slug: "surfaced",
  title: "surfaced",
  titleOriginal: "surfaced",
  readingDifficulty: "surfaced",
  byline: "surfaced",
  /* The reading view's read adds it from its own column
     (`REVISION_READ_POLICY.authors`); the shelf does not take it. */
  authors: { elsewhere: "added by loadArticle, not here" },
  siteName: "surfaced",
  lang: "surfaced",
  url: "surfaced",
  fetchedAt: "surfaced",
  publishedAt: "surfaced",
  excerpt: "surfaced",
  note: "surfaced",
  abstract: "surfaced",
  doi: "surfaced",
  journal: "surfaced",
  publishedYear: "surfaced",
  filename: "surfaced",
  source: "surfaced",
  method: "surfaced",
  pages: "surfaced",
  rawSha256: "surfaced",
  unverified: "surfaced",
  recall: "surfaced",
  pagesChecked: "surfaced",
  quality: "surfaced",
};

describe("metaFrom", () => {
  it("surfaces every field it has a column for", () => {
    const meta = metaFrom("a-paper", { ...ROW, titleOriginal: "A PAPER" }, null);
    const missing = (Object.keys(WHERE) as (keyof Meta)[])
      .filter((k) => WHERE[k] === "surfaced")
      .filter((k) => meta[k] === undefined);
    expect(missing).toEqual([]);
  });

  it("gives the checker's complaints back as they were stored", () => {
    expect(metaFrom("a-paper", ROW, null).quality).toEqual(ROW.quality);
    expect(metaFrom("a-paper", { ...ROW, quality: null }, null)).not.toHaveProperty("quality");
  });
});
