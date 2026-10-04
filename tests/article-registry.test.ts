/**
 * The article's own registry record: which identifiers are candidates, and what
 * an agreeing record may put on `meta`.
 * docs/plans/261004a-metadata-page-shows-publication-date-and-journal-from-crossref-at-import.md
 */
import { describe, expect, it } from "vitest";

import {
  MAX_OWN_IDS,
  ownIdsOfPage,
  ownIdsOfPdf,
  registryIsThisArticle,
  withRegistryFacts,
} from "../src/article-registry.js";
import { parseWorkId, type LookupResult, type WorkId, type WorkRecord } from "../src/bibliographic.js";
import type { Meta } from "../src/types.js";

const TITLE = "Entropy and the arrow of time in open quantum systems";

function record(doi: string, over: { [K in keyof WorkRecord]?: WorkRecord[K] | undefined } = {}): WorkRecord {
  const whole = {
    id: parseWorkId(doi) as WorkId,
    source: "crossref",
    title: TITLE,
    authors: [{ family: "Beck", given: "Taylor" }],
    year: 2024,
    venue: "Entropy",
    published: "2024-05-31",
    doi,
    ...over,
  };
  /* An `undefined` in `over` takes the field off, as a registry that does not state it would. */
  return Object.fromEntries(Object.entries(whole).filter(([, v]) => v !== undefined)) as unknown as WorkRecord;
}

function lookupOf(answers: Record<string, LookupResult>): { lookup: (id: WorkId) => Promise<LookupResult>; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    lookup: async (id) => {
      asked.push(id);
      return answers[id] ?? { kind: "not-found" };
    },
  };
}

const meta = (over: Partial<Meta> = {}): Meta => ({ slug: "s", title: TITLE, byline: "Taylor Beck", ...over });

describe("ownIdsOfPdf", () => {
  it("finds a DOI in any record of the first two pages, with the sentence's punctuation off", () => {
    const ids = ownIdsOfPdf([
      { page: 1, text: "Citation: Beck, T. Entropy 2024, 26, 481. https://doi.org/10.3390/e26060481." },
      { page: 2, text: "See also (doi:10.1000/Second)." },
      { page: 3, text: "10.1000/third" },
    ]);
    expect(ids).toEqual(["doi:10.3390/e26060481", "doi:10.1000/second"]);
  });

  it("counts pages from the document's first, finds an arXiv stamp, and never repeats one", () => {
    const ids = ownIdsOfPdf([
      { page: 4, text: "arXiv:1706.03762v5 [cs.CL] 6 Dec 2017" },
      { page: 4, text: "arXiv:1706.03762v5" },
      { page: 6, text: "10.1000/too-late" },
    ]);
    expect(ids).toEqual(["arxiv:1706.03762"]);
  });

  it("keeps at most three", () => {
    const ids = ownIdsOfPdf([{ page: 1, text: "10.1000/a 10.1000/b 10.1000/c 10.1000/d" }]);
    expect(ids).toHaveLength(MAX_OWN_IDS);
    expect(ids).toEqual(["doi:10.1000/a", "doi:10.1000/b", "doi:10.1000/c"]);
  });
});

describe("ownIdsOfPage", () => {
  it("reads citation_doi, then the address", () => {
    expect(ownIdsOfPage({ doi: "10.3390/E26060481", url: "https://arxiv.org/abs/1706.03762v2" })).toEqual([
      "doi:10.3390/e26060481",
      "arxiv:1706.03762",
    ]);
  });

  it("is empty for a page that declares nothing", () => {
    expect(ownIdsOfPage({ doi: undefined, url: "https://example.com/post" })).toEqual([]);
    expect(ownIdsOfPage({ doi: "not a doi", url: null })).toEqual([]);
  });
});

describe("registryIsThisArticle", () => {
  it("agrees on the same words whatever the case, markup or punctuation", () => {
    expect(registryIsThisArticle(TITLE, "Entropy and the Arrow of Time in Open Quantum Systems.")).toBe(true);
  });

  it("agrees when one is the other plus a subtitle", () => {
    expect(registryIsThisArticle(`${TITLE}: a field guide`, TITLE)).toBe(true);
  });

  it("refuses another work, a generic title, and a correction to this one", () => {
    expect(registryIsThisArticle(TITLE, "Hippocampo-cortical coupling mediates memory consolidation")).toBe(false);
    expect(registryIsThisArticle("Introduction", "Introduction")).toBe(false);
    expect(registryIsThisArticle(TITLE, `${TITLE}: correction`)).toBe(false);
  });

  it("refuses a short shared opening", () => {
    expect(registryIsThisArticle("Entropy and time", "Entropy and time in the kitchen")).toBe(false);
  });
});

describe("withRegistryFacts", () => {
  const ID = "doi:10.3390/e26060481" as WorkId;

  it("fills the DOI, the journal and the day from an agreeing record", async () => {
    const { lookup } = lookupOf({ [ID]: { kind: "found", record: record("10.3390/e26060481") } });
    const out = await withRegistryFacts(meta(), [ID], { lookup });
    expect(out.meta).toEqual({ ...meta(), doi: "10.3390/e26060481", journal: "Entropy", publishedAt: "2024-05-31" });
    expect(out.outcome).toBe("agreed");
  });

  it("keeps the page's own date, and still takes the journal", async () => {
    const { lookup } = lookupOf({ [ID]: { kind: "found", record: record("10.3390/e26060481") } });
    const out = await withRegistryFacts(meta({ publishedAt: "2024-06-02T09:00:00+02:00" }), [ID], { lookup });
    expect(out.meta.publishedAt).toBe("2024-06-02T09:00:00+02:00");
    expect(out.meta.journal).toBe("Entropy");
  });

  it("takes nothing from a record whose title is another work's", async () => {
    const { lookup } = lookupOf({ [ID]: { kind: "found", record: record("10.3390/e26060481", { title: "Another paper about something else" }) } });
    const before = meta();
    const out = await withRegistryFacts(before, [ID], { lookup });
    expect(out.meta).toEqual(before);
    expect(out.outcome).toBe("none-agreed");
  });

  it("moves on to the second candidate when the first disagrees", async () => {
    const first = "doi:10.1000/cited" as WorkId;
    const { lookup, asked } = lookupOf({
      [first]: { kind: "found", record: record("10.1000/cited", { title: "A cited work with its own long title" }) },
      [ID]: { kind: "found", record: record("10.3390/e26060481") },
    });
    const out = await withRegistryFacts(meta(), [first, ID], { lookup });
    expect(asked).toEqual([first, ID]);
    expect(out.meta.doi).toBe("10.3390/e26060481");
  });

  it("asks about the DOI the article already has first, and keeps it when nothing agrees", async () => {
    const { lookup, asked } = lookupOf({});
    const out = await withRegistryFacts(meta({ doi: "10.1000/Mine" }), [ID], { lookup });
    expect(asked).toEqual(["doi:10.1000/mine", ID]);
    expect(out.meta.doi).toBe("10.1000/Mine");
    expect(out.meta.journal).toBeUndefined();
  });

  it("leaves meta alone, and does not throw, when the registry cannot be reached", async () => {
    const before = meta();
    const unavailable = await withRegistryFacts(before, [ID], { lookup: async () => ({ kind: "unavailable", why: "busy" }) });
    expect(unavailable.meta).toEqual(before);
    const thrown = await withRegistryFacts(before, [ID], {
      lookup: async () => {
        throw new Error("down");
      },
    });
    expect(thrown.meta).toEqual(before);
    expect(thrown.outcome).toBe("none-agreed");
  });

  it("asks nobody when there is no candidate, or no title worth checking against", async () => {
    const { lookup, asked } = lookupOf({});
    expect((await withRegistryFacts(meta(), [], { lookup })).outcome).toBe("no-candidate");
    expect((await withRegistryFacts(meta({ title: "Introduction" }), [ID], { lookup })).outcome).toBe("no-candidate");
    expect(asked).toEqual([]);
  });

  it("takes nothing from the same title by other authors, or when either side names nobody", async () => {
    const others = lookupOf({ [ID]: { kind: "found", record: record("10.3390/e26060481", { authors: [{ family: "Lovelace", given: "Ada" }] }) } });
    expect((await withRegistryFacts(meta(), [ID], others)).outcome).toBe("none-agreed");
    const nobody = lookupOf({ [ID]: { kind: "found", record: record("10.3390/e26060481", { authors: [] }) } });
    expect((await withRegistryFacts(meta(), [ID], nobody)).outcome).toBe("none-agreed");
    const agreeing = lookupOf({ [ID]: { kind: "found", record: record("10.3390/e26060481") } });
    const out = await withRegistryFacts({ slug: "s", title: TITLE }, [ID], agreeing);
    expect(out.outcome).toBe("no-candidate");
    expect(agreeing.asked).toEqual([]);
  });

  it("reads an author through accents and a structured list", async () => {
    const { lookup } = lookupOf({ [ID]: { kind: "found", record: record("10.3390/e26060481", { authors: [{ family: "Müller" }] }) } });
    const out = await withRegistryFacts(
      { slug: "s", title: TITLE, authors: [{ name: "Jana Muller", affiliations: [] }] },
      [ID],
      { lookup },
    );
    expect(out.outcome).toBe("agreed");
  });

  it("takes a journal from Crossref and from arXiv, and not a DataCite repository's name", async () => {
    const arxiv = "arxiv:1706.03762" as WorkId;
    const datacite = { source: "datacite" as const, published: undefined };
    const viaArxiv = lookupOf({ [arxiv]: { kind: "found", record: { ...record("10.48550/arxiv.1706.03762", { venue: "arXiv", ...datacite }), id: arxiv } } });
    const a = await withRegistryFacts(meta(), [arxiv], viaArxiv);
    expect(a.meta.journal).toBe("arXiv");
    expect(a.meta.doi).toBeUndefined();
    const zenodo = "doi:10.5281/zenodo.1" as WorkId;
    const viaZenodo = lookupOf({ [zenodo]: { kind: "found", record: record("10.5281/zenodo.1", { venue: "Zenodo", ...datacite }) } });
    const z = await withRegistryFacts(meta(), [zenodo], viaZenodo);
    expect(z.outcome).toBe("agreed");
    expect(z.meta.journal).toBeUndefined();
    expect(z.meta.doi).toBe("10.5281/zenodo.1");
  });

  it("starts no second lookup once the budget is spent, or after a cancel", async () => {
    const first = "doi:10.1000/cited" as WorkId;
    const slow = lookupOf({});
    let t = 0;
    await withRegistryFacts(meta(), [first, ID], { lookup: slow.lookup, now: () => (t += 11_000) });
    expect(slow.asked).toEqual([first]);
    const cancelled = lookupOf({});
    const out = await withRegistryFacts(meta(), [ID], { lookup: cancelled.lookup, signal: AbortSignal.abort() });
    expect(cancelled.asked).toEqual([]);
    expect(out.outcome).toBe("none-agreed");
  });

  it("takes a venue with no day, and no day that is not a real one", async () => {
    const { lookup } = lookupOf({
      [ID]: { kind: "found", record: { ...record("10.3390/e26060481"), published: "2024-02-31" } },
    });
    const out = await withRegistryFacts(meta(), [ID], { lookup });
    expect(out.meta.journal).toBe("Entropy");
    expect(out.meta.publishedAt).toBeUndefined();
  });
});
