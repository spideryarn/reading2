/** Registry facts through the real extract step, with source bytes and lookups held in process. */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Meta } from "../src/types.js";
import type { RawManifest } from "../src/fetch.js";
import { parseWorkId, type LookupResult, type WorkId } from "../src/bibliographic.js";

vi.mock("../src/fetch.js", async (original) => ({
  ...(await original<typeof import("../src/fetch.js")>()),
  readRawBytes: vi.fn(),
}));

const { readRawBytes } = await import("../src/fetch.js");
const { STEPS, articleRegistryDeps, titleTidiers } = await import("../src/pipeline.js");
const { ruleTitleTidier } = await import("../src/title-tidy.js");
const { memoryArtefacts } = await import("./helpers/memory-artefacts.js");
const { nullCheckpointStore } = await import("../src/store/checkpoints.js");

const TITLE = "Entropy and the arrow of time in open quantum systems";
const previous: Meta = {
  slug: "s", title: TITLE, byline: "Taylor Beck", doi: "10.1000/old",
  journal: "Old Journal", publishedAt: "2024-05-31", abstract: "An abstract.",
};

afterEach(() => vi.restoreAllMocks());

async function extract(old: Meta, full: boolean, title = TITLE, answer: LookupResult = { kind: "unavailable", why: "busy" }) {
  const store = memoryArtefacts();
  store.plant("s", "fetch", "raw", {
    kind: "html", file: "raw.html", requestedUrl: "https://example.org/paper", url: "https://example.org/paper",
    contentType: "text/html", encoding: "utf-8", bytes: 100, sha256: "a".repeat(64),
    storedSha256: "a".repeat(64), storedBytes: 100, fetchedAt: "2024-05-31T00:00:00Z",
  } satisfies RawManifest);
  store.plant("s", "extract", "meta", old);
  if (full) store.plant("s", "extract", "extractedHtml", "<p>Previously read in full.</p>");
  /* Production's has() is false after beginStep marks extract running, even
     though read() still sees the copied HTML. Completion is not presence. */
  vi.spyOn(store, "has").mockResolvedValue(false);
  vi.mocked(readRawBytes).mockResolvedValue(new TextEncoder().encode(
    `<html><head><title>${title}</title><meta name="author" content="Taylor Beck"></head>` +
    `<body><article><h1>${title}</h1>${"<p>A careful discussion of entropy and the arrow of time in open quantum systems. We measure the system and consider what this means for time and physics.</p>".repeat(30)}</article></body></html>`,
  ));
  const lookup = vi.spyOn(articleRegistryDeps, "lookup").mockResolvedValue(answer);
  /* The step's title tidy is a model's (plan 261005j); here it is the rule. */
  const tidy = vi.spyOn(titleTidiers, "import").mockImplementation(ruleTitleTidier);
  const result = await STEPS.extract.run({
    slug: "s", url: "https://example.org/paper", report: () => {}, preview: () => {},
    signal: new AbortController().signal, cacheArticle: false, power: "standard",
  }, store, nullCheckpointStore());
  return { meta: result.parts?.meta, lookup, tidy };
}

describe("registry metadata retained during extraction", () => {
  it("does not carry a removed publisher date or old registry facts into a full re-extraction", async () => {
    const { meta, lookup } = await extract(previous, true);
    expect(meta?.publishedAt).toBeUndefined();
    expect(meta?.journal).toBeUndefined();
    /* The DOI itself is kept, as it was before 261004a, and it is what gets asked about. */
    expect(meta?.doi).toBe(previous.doi);
    expect(lookup).toHaveBeenCalledWith("doi:10.1000/old");
  });

  it("keeps confirmed minimal-paper facts during Read this when the registry is unavailable", async () => {
    const { meta } = await extract(previous, false);
    expect(meta).toMatchObject({ doi: previous.doi, journal: previous.journal, publishedAt: previous.publishedAt });
  });

  /* Plan 261004h: the year is the same fact as the day at a coarser precision,
     so it is kept and dropped on the same terms. */
  const { publishedAt: _day, ...undated } = previous;
  const yearOnly: Meta = { ...undated, publishedYear: 2011 };

  it("keeps a year-only paper's year during Read this, and never beside a day", async () => {
    const { meta } = await extract(yearOnly, false);
    expect(meta).toMatchObject({ doi: previous.doi, journal: previous.journal, publishedYear: 2011 });
    expect(meta).not.toHaveProperty("publishedAt");
  });

  it("does not carry an old year into a full re-extraction", async () => {
    const { meta } = await extract(yearOnly, true);
    expect(meta).not.toHaveProperty("publishedYear");
  });

  it("keeps the minimal paper's year when an agreeing registry reply has no date", async () => {
    const answer: LookupResult = {
      kind: "found",
      record: {
        id: parseWorkId("10.1000/old") as WorkId, doi: "10.1000/old", source: "crossref", title: TITLE,
        authors: [{ family: "Beck", given: "Taylor" }], venue: "Old Journal",
      },
    };
    const { meta, lookup } = await extract(yearOnly, false, TITLE, answer);
    expect(lookup).toHaveBeenCalledWith("doi:10.1000/old");
    expect(meta).toMatchObject({ publishedYear: 2011 });
    expect(meta).not.toHaveProperty("publishedAt");
    const reextracted = await extract(yearOnly, true, TITLE, answer);
    expect(reextracted.meta).not.toHaveProperty("publishedYear");
  });

  it("keeps them whatever title the fuller reading gives: Read this re-reads the same bytes", async () => {
    const { meta } = await extract(previous, false, "A different article about the mechanics of fluid flow");
    expect(meta).toMatchObject({ doi: previous.doi, journal: previous.journal, publishedAt: previous.publishedAt });
  });
});

/* Plan 261005j: a model does not answer the same way twice, and `title` is in
   every generated mode's fingerprint. */
describe("the title across a re-extraction", () => {
  const SHOUTED = "THE ORDER OF TIME";

  it("keeps the title the last revision tidied, and asks nobody, when the same title arrives", async () => {
    const held: Meta = { ...previous, title: "The Order of Time, as tidied before", titleOriginal: SHOUTED };
    const { meta, tidy } = await extract(held, true, SHOUTED);
    expect(meta?.title).toBe("The Order of Time, as tidied before");
    expect(meta?.titleOriginal).toBe(SHOUTED);
    expect(tidy).not.toHaveBeenCalled();
  });

  it("asks again when a different title arrives", async () => {
    const held: Meta = { ...previous, title: "Something Else", titleOriginal: "SOMETHING ELSE" };
    const { meta, tidy } = await extract(held, true, SHOUTED);
    expect(meta?.title).toBe("The Order of Time");
    expect(tidy).toHaveBeenCalledOnce();
  });

  it("asks about a title stored as it came, so one imported before any tidying is still tidied", async () => {
    const { meta, tidy } = await extract({ ...previous, title: SHOUTED }, true, SHOUTED);
    expect(meta?.title).toBe("The Order of Time");
    expect(meta?.titleOriginal).toBe(SHOUTED);
    expect(tidy).toHaveBeenCalledOnce();
    /* Bound to the step's own cancellation, which `runExtract` has no signal to carry. */
    expect(tidy.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
