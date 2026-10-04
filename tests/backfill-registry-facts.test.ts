/**
 * **The registry backfill's plan** — candidates without a model, a lookup
 * handed in, `withRegistryFacts` deciding, and what the plan says to write
 * (src/backfill-registry-facts.ts).
 * docs/plans/261004h-…-and-the-registry-backfill.md § Stage 2.
 *
 * No database and no network: the sources are a real PDF and hand-written
 * pages, and the registry is a table of answers. The apply half is
 * tests/backfill-registry-facts-pg.test.ts.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildPlan,
  memoryBibliographicStore,
  parsePlan,
  PlanRefused,
  rowVerdict,
  type ArticleRow,
  type PlanRow,
  type ReadSource,
} from "../src/backfill-registry-facts.js";
import { lookupWork, parseWorkId, SPACING_MS, type LookupResult, type WorkId, type WorkRecord } from "../src/bibliographic.js";
import { FetchFailure } from "../src/fetch.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const ARXIV_PDF = new Uint8Array(fs.readFileSync(path.join(ROOT, "evals/pdf/titles/arxiv-arnn-eeg-stamp/source.pdf")));

const TARGET = { host: "127.0.0.1", port: "54362", database: "postgres" };

const PAPER = "Hippocampo-cortical coupling mediates memory consolidation during sleep";
const PREPRINT = "Attentive recurrent networks for seizure detection in long recordings";

function article(over: Partial<ArticleRow> = {}): ArticleRow {
  return {
    articleId: randomUUID(),
    slug: "a-piece",
    revisionId: randomUUID(),
    title: PAPER,
    byline: "Nicolas Maingret",
    authors: null,
    doi: null,
    journal: null,
    publishedAt: null,
    publishedYear: null,
    finalUrl: "https://journal.example/articles/nn4304",
    requestedUrl: "https://journal.example/articles/nn4304",
    uploaded: false,
    rawSourceSha256: "a".repeat(64),
    rawSourceKind: "html",
    hasTimeline: false,
    hasDraft: false,
    ...over,
  };
}

const id = (s: string) => parseWorkId(s) as WorkId;

function record(over: Partial<WorkRecord> = {}): WorkRecord {
  return {
    id: id("10.1038/nn.4304"),
    source: "crossref",
    title: PAPER,
    authors: [{ family: "Maingret", given: "Nicolas" }],
    year: 2016,
    venue: "Nature Neuroscience",
    published: "2016-05-16",
    doi: "10.1038/nn.4304",
    ...over,
  };
}

/** A registry that knows the works it is given, and counts what it was asked. */
function registry(records: WorkRecord[]) {
  const asked: string[] = [];
  const lookup = async (workId: WorkId): Promise<LookupResult> => {
    asked.push(workId);
    const found = records.find((r) => r.id === workId);
    return found ? { kind: "found", record: found } : { kind: "not-found" };
  };
  return { asked, lookup };
}

const page = (head: string): ReadSource => async () => ({
  kind: "html",
  bytes: new TextEncoder().encode(`<!doctype html><html><head>${head}</head><body><p>Body.</p></body></html>`),
});

async function one(row: ArticleRow, readSource: ReadSource, records: WorkRecord[]): Promise<{ row: PlanRow; asked: string[] }> {
  const { asked, lookup } = registry(records);
  const plan = await buildPlan([row], { target: TARGET, publishedYearColumn: true }, { readSource, lookup });
  return { row: plan.rows[0] as PlanRow, asked };
}

describe("buildPlan", () => {
  it("a page that declares its DOI, and the registry agrees: the DOI, the journal and the day", async () => {
    const { row } = await one(article(), page('<meta name="citation_doi" content="10.1038/nn.4304">'), [record()]);
    expect(row.outcome).toBe("agreed");
    expect(row.sourceKind).toBe("html");
    expect(row.candidates).toEqual(["doi:10.1038/nn.4304"]);
    expect(row.asked).toEqual([{ id: "doi:10.1038/nn.4304", answer: "found" }]);
    expect(row.write).toEqual({ doi: "10.1038/nn.4304", journal: "Nature Neuroscience", published_at: "2016-05-16" });
  });

  it("a PDF whose only identifier is arXiv's sideways stamp, and the registry agrees", async () => {
    const preprint = record({
      id: id("arxiv:2403.03276"),
      source: "datacite",
      title: PREPRINT,
      authors: [{ family: "Rukhsar", given: "Salim" }],
      venue: "arXiv",
      published: "2024-03-05",
      doi: "10.48550/arxiv.2403.03276",
    });
    const { row } = await one(
      article({ title: PREPRINT, byline: "Salim Rukhsar", rawSourceKind: "pdf", uploaded: true, finalUrl: null, requestedUrl: null }),
      async () => ({ kind: "pdf", bytes: ARXIV_PDF }),
      [preprint],
    );
    expect(row.sourceKind).toBe("pdf");
    expect(row.candidates).toContain("arxiv:2403.03276");
    expect(row.outcome).toBe("agreed");
    /* An arXiv id is not a DOI the article prints, so no `doi`; the venue is the answer for arXiv. */
    expect(row.write).toEqual({ journal: "arXiv", published_at: "2024-03-05" });
  });

  it("a paper fetched from an arXiv address is a candidate by its address", async () => {
    const { row } = await one(
      article({ finalUrl: "https://arxiv.org/pdf/2403.03276v1", requestedUrl: "https://arxiv.org/abs/2403.03276" }),
      page(""),
      [],
    );
    expect(row.candidates).toEqual(["arxiv:2403.03276"]);
    expect(row.outcome).toBe("none-agreed");
  });

  it("an uploaded file's address is never read", async () => {
    const { row } = await one(article({ uploaded: true, finalUrl: "https://arxiv.org/abs/2403.03276" }), page(""), []);
    expect(row.candidates).toEqual([]);
  });

  it("the registry's record is another work: nothing is written", async () => {
    const { row, asked } = await one(
      article(),
      page('<meta name="citation_doi" content="10.1038/nn.4304">'),
      [record({ title: "A different paper about something else entirely" })],
    );
    expect(asked).toEqual(["doi:10.1038/nn.4304"]);
    expect(row.outcome).toBe("none-agreed");
    expect(row.write).toEqual({});
  });

  it("no identifier anywhere: no candidate, and the registry is not asked", async () => {
    const { row, asked } = await one(article(), page('<meta name="description" content="x">'), [record()]);
    expect(row.outcome).toBe("no-candidate");
    expect(row.candidates).toEqual([]);
    expect(asked).toEqual([]);
    expect(row.write).toEqual({});
  });

  it("no stored document is its own outcome, not `no-candidate`", async () => {
    const { row, asked } = await one(article({ rawSourceSha256: null, rawSourceKind: null }), async () => null, [record()]);
    expect(row.outcome).toBe("no-source");
    expect(row.sourceKind).toBeNull();
    expect(asked).toEqual([]);
  });

  it("a referenced document that cannot be read is its own outcome, and names the error's class", async () => {
    class MissingRawObject extends Error {
      override name = "MissingRawObject";
    }
    const { row } = await one(
      article(),
      async () => {
        throw new MissingRawObject("gone");
      },
      [record()],
    );
    expect(row.outcome).toBe("source-unreadable");
    expect(row.note).toBe("MissingRawObject");
    expect(row.write).toEqual({});
  });

  it("a PDF pdf.js cannot open is unreadable, not a crash", async () => {
    const { row } = await one(
      article({ rawSourceKind: "pdf" }),
      async () => ({ kind: "pdf", bytes: new TextEncoder().encode("this is not a PDF") }),
      [],
    );
    expect(row.outcome).toBe("source-unreadable");
    expect(row.sourceKind).toBe("pdf");
  });

  it("a record that states only a year gives the year and no day", async () => {
    const { published: _none, ...yearOnly } = record({ year: 2011 });
    const { row } = await one(article(), page('<meta name="citation_doi" content="10.1038/nn.4304">'), [yearOnly]);
    expect(row.write).toEqual({ doi: "10.1038/nn.4304", journal: "Nature Neuroscience", published_year: 2011 });
  });

  it("an article with its own date gets no day and no year", async () => {
    const { row } = await one(
      article({ publishedAt: "2016-05-17T09:00:00+01:00" }),
      page('<meta name="citation_doi" content="10.1038/nn.4304">'),
      [record()],
    );
    expect(row.outcome).toBe("agreed");
    expect(row.write).toEqual({ doi: "10.1038/nn.4304", journal: "Nature Neuroscience" });
  });

  it("an article that already has a year is not given a day", async () => {
    const { row } = await one(
      article({ publishedYear: 2016 }),
      page('<meta name="citation_doi" content="10.1038/nn.4304">'),
      [record()],
    );
    expect(row.write).toEqual({ doi: "10.1038/nn.4304", journal: "Nature Neuroscience" });
  });

  it("a column that is already filled is left out of the plan", async () => {
    const { row } = await one(
      article({ doi: "10.1038/nn.4304", journal: "Nat. Neurosci." }),
      page(""),
      [record()],
    );
    expect(row.outcome).toBe("agreed");
    expect(row.write).toEqual({ published_at: "2016-05-16" });
  });

  it("totals count the Timelines a new day makes stale, and not the ones a year would", async () => {
    const { published: _none, ...yearOnly } = record({ id: id("10.5555/year.only"), doi: "10.5555/year.only", year: 2011 });
    const { lookup } = registry([record(), yearOnly]);
    const sources: Record<string, string> = {
      day: '<meta name="citation_doi" content="10.1038/nn.4304">',
      year: '<meta name="citation_doi" content="10.5555/year.only">',
      none: "",
    };
    const plan = await buildPlan(
      [
        article({ slug: "day", hasTimeline: true, hasDraft: true }),
        article({ slug: "year", hasTimeline: true }),
        article({ slug: "none", hasTimeline: true }),
      ],
      { target: TARGET, publishedYearColumn: false },
      {
        readSource: async (row) => page(sources[row.slug] ?? "")(row),
        lookup,
        now: () => new Date("2026-10-04T12:00:00Z"),
      },
    );
    expect(plan.version).toBe(1);
    expect(plan.target).toEqual(TARGET);
    expect(plan.madeAt).toBe("2026-10-04T12:00:00.000Z");
    expect(plan.publishedYearColumn).toBe(false);
    /* The year is still listed when the column is not there yet. */
    expect(plan.rows[1]?.write.published_year).toBe(2011);
    expect(plan.totals).toMatchObject({
      articles: 3,
      rowsWithAWrite: 2,
      timelinesMadeStale: 1,
      rowsWithAWriteAndADraft: 1,
      lookupsUnanswered: 0,
      byColumn: { doi: 2, journal: 2, published_at: 1, published_year: 1 },
    });
    expect(plan.totals.byOutcome).toMatchObject({ agreed: 2, "no-candidate": 1 });
  });

  it("a lookup with no answer is recorded as unanswered, never as a miss", async () => {
    const plan = await buildPlan(
      [article()],
      { target: TARGET, publishedYearColumn: true },
      {
        readSource: page('<meta name="citation_doi" content="10.1038/nn.4304">'),
        lookup: async () => ({ kind: "unavailable", why: "cooling-down" }),
      },
    );
    expect(plan.rows[0]?.asked).toEqual([{ id: "doi:10.1038/nn.4304", answer: "unavailable:cooling-down" }]);
    expect(plan.totals.lookupsUnanswered).toBe(1);
  });
});

describe("memoryBibliographicStore, under lookupWork", () => {
  const crossref = {
    message: { DOI: "10.1038/nn.4304", title: [PAPER], author: [{ given: "Nicolas", family: "Maingret" }] },
  };

  it("spaces two Crossref starts by the shipped spacing, and asks once for a repeated id", async () => {
    let clock = 1_000_000;
    const slept: number[] = [];
    const urls: string[] = [];
    const deps = {
      store: memoryBibliographicStore(() => clock),
      fetchJson: async (url: string) => {
        urls.push(url);
        return crossref;
      },
      sleep: async (ms: number) => {
        slept.push(ms);
        clock += ms;
      },
    };
    expect((await lookupWork(id("10.1038/nn.4304"), deps)).kind).toBe("found");
    expect((await lookupWork(id("10.1038/nn.9999"), deps)).kind).toBe("found");
    expect(slept).toEqual([SPACING_MS.crossref]);
    expect((await lookupWork(id("10.1038/nn.4304"), deps)).kind).toBe("found");
    expect(urls).toHaveLength(2);
  });

  it("stops asking a service that said 429", async () => {
    let calls = 0;
    const deps = {
      store: memoryBibliographicStore(),
      fetchJson: async () => {
        calls++;
        throw new FetchFailure("rate-limited", "https://api.example/", "HTTP 429", { status: 429, retryAfterMs: null });
      },
      sleep: async () => {},
    };
    expect(await lookupWork(id("10.1038/nn.4304"), deps)).toEqual({ kind: "unavailable", why: "cooling-down" });
    expect(await lookupWork(id("10.1038/nn.9999"), deps)).toEqual({ kind: "unavailable", why: "cooling-down" });
    expect(calls).toBe(1);
  });
});

describe("rowVerdict", () => {
  const empty = { doi: null, journal: null, published_at: null, published_year: null };

  it("writes every planned column that is empty", () => {
    expect(rowVerdict({ doi: "10.1/x", journal: "J", published_at: "2016-05-16" }, empty)).toEqual({
      kind: "write",
      columns: ["doi", "journal", "published_at"],
    });
  });

  it("is `already` when every planned column holds the plan's value", () => {
    expect(
      rowVerdict({ doi: "10.1/x", published_year: 2011 }, { ...empty, doi: "10.1/x", published_year: 2011 }),
    ).toEqual({ kind: "already" });
  });

  it("writes what is left when some of the row is already there", () => {
    expect(rowVerdict({ doi: "10.1/x", journal: "J" }, { ...empty, doi: "10.1/x" })).toEqual({ kind: "write", columns: ["journal"] });
  });

  it("refuses a year where a day now exists, and a day where a year does", () => {
    expect(rowVerdict({ published_year: 2011 }, { ...empty, published_at: "2011-03-04" })).toEqual({
      kind: "conflict",
      columns: ["published_year"],
    });
    expect(rowVerdict({ published_at: "2011-03-04" }, { ...empty, published_year: 2011 })).toEqual({
      kind: "conflict",
      columns: ["published_at"],
    });
  });

  it("refuses the whole row when one column holds something else", () => {
    expect(rowVerdict({ doi: "10.1/x", journal: "J" }, { ...empty, journal: "Another" })).toEqual({
      kind: "conflict",
      columns: ["journal"],
    });
  });
});

describe("parsePlan", () => {
  const row = () => ({ slug: "a-piece", articleId: randomUUID(), revisionId: randomUUID(), write: { doi: "10.1/x" } });
  const plan = (rows: unknown[]) => ({ version: 1, target: TARGET, madeAt: "2026-10-04T12:00:00.000Z", rows });

  it("keeps a well-formed plan's rows and target", () => {
    const r = row();
    const parsed = parsePlan(plan([r]));
    expect(parsed.target).toEqual(TARGET);
    expect(parsed.rows[0]).toMatchObject({ slug: "a-piece", articleId: r.articleId, write: { doi: "10.1/x" } });
  });

  it.each([
    ["a file that is not a plan", { rows: [] }],
    ["a plan with no target", { version: 1, rows: [] }],
    ["a column this does not fill", plan([{ ...row(), write: { title: "Mine now" } }])],
    ["a year that is not a year", plan([{ ...row(), write: { published_year: 20111 } }])],
    ["a day that is not a day", plan([{ ...row(), write: { published_at: "2011-02-30" } }])],
    ["a day with a time", plan([{ ...row(), write: { published_at: "2011-02-03T00:00:00Z" } }])],
    ["a day and a year together", plan([{ ...row(), write: { published_at: "2011-02-03", published_year: 2011 } }])],
    ["an id that is not a uuid", plan([{ ...row(), revisionId: "1; drop table" }])],
  ])("refuses %s", (_name, file) => {
    expect(() => parsePlan(file)).toThrow(PlanRefused);
  });
});
