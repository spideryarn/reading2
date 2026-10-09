/**
 * **A `metadata` run on an article `extract` already read keeps what `metadata`
 * does not make, and what it found nothing for.** Plan
 * docs/plans/261009q-metadata-rerun-keeps-what-it-does-not-make.md.
 *
 * The step's `meta` goes to the store through `metaColumns`, which writes every
 * column `?? null` — so a field the step leaves out is a column it clears. Run
 * alone (the verified administrator may) on a PDF read in full, that cleared
 * `recall`, `pagesChecked`, `quality` and the rest of how the PDF was read, and
 * any byline, date or DOI the run did not find again.
 *
 * The previous `meta` is typed over every `Meta` field, so a new field is in it
 * the day it is added, and `METADATA_STEP_FIELDS` must then say whether the
 * step makes, fills or keeps it before this file compiles. The same run through
 * Postgres and a real job is tests/metadata-rerun-keeps-extract-pg.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RawManifest } from "../src/fetch.js";
import type { PaperMetadata } from "../src/paper-metadata.js";
import type { Meta } from "../src/types.js";
import { metaColumns } from "../src/store/artifacts-pg.js";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import { memoryArtefacts } from "./helpers/memory-artefacts.js";

vi.mock("../src/fetch.js", async (original) => ({
  ...(await original<typeof import("../src/fetch.js")>()),
  readRawBytes: vi.fn(),
}));
const { readRawBytes } = await import("../src/fetch.js");
const { STEPS, METADATA_STEP_FIELDS, metadataOverPrevious, titleTidiers, metadataReaders, articleRegistryDeps } =
  await import("../src/pipeline.js");

afterEach(() => vi.restoreAllMocks());

/**
 * Everything `extract` and stage 1 can say about a PDF, every field set but
 * `publishedYear`, which a day excludes (the table's CHECK); the year is tested
 * on its own below.
 */
const READ_IN_FULL: Required<Omit<Meta, "publishedYear">> = {
  slug: "s",
  title: "The Order of Time, as extract read it",
  titleOriginal: "THE ORDER OF TIME, AS EXTRACT READ IT",
  readingDifficulty: { language: 3, ideas: 4, reason: "Dense." },
  byline: "Extract Author, University of Somewhere",
  authors: [{ name: "Extract Author", affiliations: ["University of Somewhere"] }],
  siteName: "Example Journal Site",
  lang: "en",
  url: "https://example.org/paper.pdf",
  fetchedAt: "2024-01-01T00:00:00.000Z",
  publishedAt: "2023-05-01",
  excerpt: "The excerpt extract wrote.",
  note: "A note extract wrote.",
  abstract: "The abstract extract kept.",
  doi: "10.1234/extract",
  journal: "Extract Journal",
  filename: "paper.pdf",
  rawSha256: "b".repeat(64),
  source: "pdf",
  method: "model:pages",
  pages: 12,
  unverified: true,
  recall: 0.93,
  pagesChecked: 12,
  quality: ["Page 3 looked short against its words."],
};

const NOTHING_FOUND: PaperMetadata = {
  title: "A Fresh Title", authors: [], abstract: null, doi: null, from: "model", textChars: 100, answeredBy: "fixture",
};

async function runMetadata(previous: Meta, found: PaperMetadata = NOTHING_FOUND) {
  const store = memoryArtefacts();
  store.plant("s", "fetch", "raw", {
    kind: "pdf", file: "raw.pdf", url: "https://example.org/paper.pdf", requestedUrl: "https://example.org/paper.pdf",
    contentType: "application/pdf", encoding: "utf-8", bytes: 100, storedBytes: 100,
    sha256: "a".repeat(64), storedSha256: "a".repeat(64), fetchedAt: "2024-01-01T00:00:00Z",
  } satisfies RawManifest);
  /* The draft a standalone run writes into carries the published revision's
     columns, and both steps read them as `extract`'s `meta`. */
  store.plant("s", "extract", "meta", previous);
  store.plant("s", "extract", "extractedHtml", "<p>Already read.</p>");
  vi.spyOn(articleRegistryDeps, "lookup").mockResolvedValue({ kind: "unavailable", why: "busy" });
  vi.spyOn(titleTidiers, "import").mockResolvedValue({ title: "A Fresh Title" });
  vi.mocked(readRawBytes).mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  vi.spyOn(metadataReaders, "pdf").mockResolvedValue(found);
  const result = await STEPS.metadata.run({
    slug: "s", url: "https://example.org/paper.pdf", signal: new AbortController().signal,
    report: () => {}, preview: () => {}, cacheArticle: false, power: "standard",
  }, store, nullCheckpointStore());
  const meta = result.parts?.meta;
  if (!meta) throw new Error("the metadata step returned no meta");
  return meta;
}

const fieldsThat = (kind: "made" | "filled" | "kept") =>
  (Object.keys(METADATA_STEP_FIELDS) as (keyof Meta)[]).filter((k) => METADATA_STEP_FIELDS[k] === kind);

describe("a metadata run on a PDF already read in full", () => {
  it("keeps every field it does not make, and every one it found nothing for, all the way to the columns", async () => {
    const meta = await runMetadata(READ_IN_FULL);
    expect(fieldsThat("kept")).toEqual(
      expect.arrayContaining(["method", "pages", "unverified", "recall", "pagesChecked", "quality"]),
    );
    for (const key of [...fieldsThat("kept"), ...fieldsThat("filled")]) {
      if (key === "publishedYear") continue;
      expect(meta[key], key).toEqual(READ_IN_FULL[key]);
    }
    expect(metaColumns(meta)).toMatchObject({
      siteName: READ_IN_FULL.siteName,
      lang: READ_IN_FULL.lang,
      excerpt: READ_IN_FULL.excerpt,
      note: READ_IN_FULL.note,
      extractMethod: READ_IN_FULL.method,
      pages: READ_IN_FULL.pages,
      unverified: READ_IN_FULL.unverified,
      recall: READ_IN_FULL.recall,
      pagesChecked: READ_IN_FULL.pagesChecked,
      quality: READ_IN_FULL.quality,
      byline: READ_IN_FULL.byline,
      abstract: READ_IN_FULL.abstract,
      doi: READ_IN_FULL.doi,
      journal: READ_IN_FULL.journal,
      publishedAt: READ_IN_FULL.publishedAt,
      publishedYear: null,
    });
  });

  it("puts what it does find over what was there", async () => {
    const meta = await runMetadata(READ_IN_FULL, {
      ...NOTHING_FOUND, authors: ["Fresh Author"], abstract: "A fresh abstract.", doi: "10.1234/fresh",
    });
    expect(meta).toMatchObject({
      title: "A Fresh Title",
      byline: "Fresh Author",
      authors: [{ name: "Fresh Author", affiliations: [] }],
      abstract: "A fresh abstract.",
      doi: "10.1234/fresh",
      source: "pdf",
      recall: READ_IN_FULL.recall,
    });
    /* The journal was the registry's word about the old DOI, and the registry
       was unreachable for the new one. */
    expect(meta.journal).toBeUndefined();
  });

  it("keeps nothing on a minimal paper's first run, because there is nothing before it", async () => {
    const meta = await runMetadata({ slug: "s", title: "s" });
    expect(meta.recall).toBeUndefined();
    expect(meta.quality).toBeUndefined();
  });
});

describe("metadataOverPrevious, the pairs", () => {
  const made: Meta = { slug: "s", title: "T" };

  it("keeps extract's authors, affiliations and byline when the run reads the same names", () => {
    const out = metadataOverPrevious(READ_IN_FULL, {
      ...made, authors: [{ name: "Extract Author", affiliations: [] }], byline: "Extract Author",
    });
    expect(out.authors).toEqual(READ_IN_FULL.authors);
    expect(out.byline).toBe(READ_IN_FULL.byline);
  });

  it("keeps the journal beside the same DOI, and drops it beside a different one", () => {
    expect(metadataOverPrevious(READ_IN_FULL, { ...made, doi: READ_IN_FULL.doi }).journal).toBe(READ_IN_FULL.journal);
    expect(metadataOverPrevious(READ_IN_FULL, { ...made, doi: READ_IN_FULL.doi.toUpperCase() }).journal).toBe(READ_IN_FULL.journal);
    expect(metadataOverPrevious(READ_IN_FULL, { ...made, doi: "10.9999/other" }).journal).toBeUndefined();
    expect(metadataOverPrevious(READ_IN_FULL, { ...made, doi: "10.9999/other", journal: "New" }).journal).toBe("New");
  });

  it("moves the day and the year as one", () => {
    const { publishedAt: _day, ...noDay } = READ_IN_FULL;
    const year: Meta = { ...noDay, publishedYear: 2021 };
    expect(metadataOverPrevious(year, made)).toMatchObject({ publishedYear: 2021 });
    expect(metadataOverPrevious(year, made).publishedAt).toBeUndefined();
    const replaced = metadataOverPrevious(year, { ...made, publishedAt: "2022-02-02" });
    expect(replaced.publishedAt).toBe("2022-02-02");
    expect(replaced.publishedYear).toBeUndefined();
  });

  it("does not keep a title original beside a title it is not the original of", () => {
    expect(metadataOverPrevious(READ_IN_FULL, made).titleOriginal).toBeUndefined();
  });
});
