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

async function extract(
  old: Meta,
  full: boolean,
  title = TITLE,
  answer: LookupResult = { kind: "unavailable", why: "busy" },
  page: { url: string; author: boolean } = { url: "https://example.org/paper", author: true },
) {
  const store = memoryArtefacts();
  store.plant("s", "fetch", "raw", {
    kind: "html", file: "raw.html", requestedUrl: page.url, url: page.url,
    contentType: "text/html", encoding: "utf-8", bytes: 100, sha256: "a".repeat(64),
    storedSha256: "a".repeat(64), storedBytes: 100, fetchedAt: "2024-05-31T00:00:00Z",
  } satisfies RawManifest);
  store.plant("s", "extract", "meta", old);
  if (full) store.plant("s", "extract", "extractedHtml", "<p>Previously read in full.</p>");
  /* Production's has() is false after beginStep marks extract running, even
     though read() still sees the copied HTML. Completion is not presence. */
  vi.spyOn(store, "has").mockResolvedValue(false);
  vi.mocked(readRawBytes).mockResolvedValue(new TextEncoder().encode(
    `<html><head><title>${title}</title>${page.author ? `<meta name="author" content="Taylor Beck">` : ""}</head>` +
    `<body><article><h1>${title}</h1>${"<p>A careful discussion of entropy and the arrow of time in open quantum systems. We measure the system and consider what this means for time and physics.</p>".repeat(30)}</article></body></html>`,
  ));
  const lookup = vi.spyOn(articleRegistryDeps, "lookup").mockResolvedValue(answer);
  /* The step's title tidy is a model's (plan 261005j); here it is the rule. */
  const tidy = vi.spyOn(titleTidiers, "import").mockImplementation(ruleTitleTidier);
  const result = await STEPS.extract.run({
    slug: "s", url: page.url, report: () => {}, preview: () => {},
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

/* Plan 261024a: the day in a page's address is the weakest evidence, so it
   goes in last, and only into an article the registry left with no date. */
describe("the address's day, after the registry", () => {
  const DATED = { url: "https://example.org/2023/01/15/paper", author: true };
  const agreeing = (dates: { published?: string; year?: number }): LookupResult => ({
    kind: "found",
    record: {
      id: parseWorkId("10.1000/old") as WorkId, doi: "10.1000/old", source: "crossref", title: TITLE,
      authors: [{ family: "Beck", given: "Taylor" }], venue: "Old Journal", ...dates,
    },
  });

  it("fills the day when the registry gives none", async () => {
    const { meta } = await extract(previous, true, TITLE, { kind: "unavailable", why: "busy" }, DATED);
    expect(meta?.publishedAt).toBe("2023-01-15");
  });

  it("loses to an agreeing registry's day", async () => {
    const { meta } = await extract(previous, true, TITLE, agreeing({ published: "2024-05-31" }), DATED);
    expect(meta?.publishedAt).toBe("2024-05-31");
  });

  it("loses to an agreeing registry's year, and never sits beside it", async () => {
    const { meta } = await extract(previous, true, TITLE, agreeing({ year: 2011 }), DATED);
    expect(meta?.publishedYear).toBe(2011);
    expect(meta).not.toHaveProperty("publishedAt");
  });

  it("is nothing at an undated address: the control", async () => {
    const { meta } = await extract(previous, true);
    expect(meta).not.toHaveProperty("publishedAt");
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

/* Plan 261018a, Stage 4: arXiv's HTML declares no author, and its address names it. */
describe("a page that names nobody, at an address that names it", () => {
  it("takes the year and the authors from the record its own address names", async () => {
    const arxiv = parseWorkId("https://arxiv.org/html/2308.08708v3") as WorkId;
    const answer: LookupResult = {
      kind: "found",
      record: {
        id: arxiv, doi: "10.48550/arxiv.2308.08708", source: "datacite", title: TITLE, venue: "arXiv", year: 2023,
        authors: [{ family: "Butlin", given: "Patrick" }, { family: "Long", given: "Robert" }],
      },
    };
    const { meta, lookup } = await extract(
      { slug: "s", title: TITLE },
      true,
      TITLE,
      answer,
      { url: "https://arxiv.org/html/2308.08708v3", author: false },
    );
    expect(lookup).toHaveBeenCalledWith(arxiv);
    expect(meta).toMatchObject({
      publishedYear: 2023,
      doi: "10.48550/arxiv.2308.08708",
      byline: "Patrick Butlin; Robert Long",
      authors: [{ name: "Patrick Butlin", affiliations: [] }, { name: "Robert Long", affiliations: [] }],
    });
  });
});
