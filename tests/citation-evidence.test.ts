/**
 * **The evidence a citation blurb may be written from** — plan 261017h stage 3a
 * (src/citation-evidence.ts; docs/plans/261017h-stage-3-design-citation-blurbs.md
 * § 3 and the design review's G6, G9, G10). No network, no database, no model:
 * the registry lookup, the JSON fetch and the limiter are fakes.
 *
 * What is pinned, because each fails quietly: a title search that accepts a
 * same-titled review, a correction or a chapter is a blurb about the wrong
 * work; a title search for an uploaded manuscript sends its unpublished
 * references to Crossref; an OpenAlex reconstruction of a reprint chapter read
 * as the author's abstract is the Searle inversion; and a run that never stops
 * asking is the abuse Greg ruled out.
 */
import { describe, expect, it, vi } from "vitest";

import type { LookupResult, ServiceLimiter, WorkId, WorkRecord } from "../src/bibliographic.js";
import {
  ACCEPTED_BOOK_TYPES,
  collectEvidence,
  crossrefItemIdentifies,
  type EvidenceDeps,
  type EvidenceRow,
  LOOKUP_BUDGET_MS,
  MAX_TITLE_SEARCHES,
  openAlexItemIdentifies,
  type RowEvidence,
} from "../src/citation-evidence.js";
import { FetchFailure } from "../src/fetch.js";
import type { Log } from "../src/log.js";
import type { OptionalSources } from "../src/registry-keys.js";

/* ------------------------------------------------------------ fixtures -- */

const ABSTRACT =
  "We show that sleep spindles couple the hippocampus to the cortex, and that boosting the coupling improves memory.";

function row(over: Partial<EvidenceRow> & Pick<EvidenceRow, "id" | "title">): EvidenceRow {
  return { url: "https://scholar.google.com/scholar?q=x", linkFrom: "search", ...over };
}

function record(id: string, title: string, over: Partial<WorkRecord> = {}): WorkRecord {
  return {
    id: id as WorkId,
    source: "crossref",
    title,
    authors: [{ family: "Maingret", given: "Nicolas" }],
    year: 2016,
    doi: id.replace(/^doi:/, ""),
    abstractReadAt: "2026-10-18T09:00:00.000Z",
    ...over,
  };
}

const COUPLING_TITLE = "Hippocampo-cortical coupling mediates memory consolidation during sleep";
const COUPLING = row({
  id: "c1",
  title: COUPLING_TITLE,
  authors: "Maingret, N.",
  year: "2016",
  url: "https://doi.org/10.1038/nn.4304",
  linkFrom: "doi",
});

/** A limiter that always grants, with no waiting: politeness is tests/bibliographic*.test.ts's. */
function limiter(): ServiceLimiter & { cooled: string[] } {
  const cooled: string[] = [];
  return {
    cooled,
    coolingDown: async () => false,
    takeSlot: async (service, leaseMs) => ({ service, slot: 1, until: new Date(Date.now() + leaseMs) }),
    freeSlot: async () => {},
    takeStart: async () => ({ kind: "start", waitMs: 0 }),
    coolDown: async (service) => {
      cooled.push(service);
    },
  };
}

function silentLog(): Log & { errors: unknown[] } {
  const errors: unknown[] = [];
  const l = {
    errors,
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (obj: unknown) => {
      errors.push(obj);
    },
    child: () => l,
  };
  return l as unknown as Log & { errors: unknown[] };
}

interface Fakes {
  lookups?: Record<string, LookupResult>;
  json?: (url: string) => unknown;
  now?: () => number;
  budgetMs?: number;
  /** Absent: today's keyless run, which every test above the stage-1 blocks pins. */
  sources?: OptionalSources;
}

function deps(f: Fakes = {}) {
  const asked: string[] = [];
  const fetched: string[] = [];
  /** The registry each request named for its key, in request order ("-" for none). */
  const keyed: string[] = [];
  const log = silentLog();
  const lim = limiter();
  const d: EvidenceDeps = {
    lookup: async (id) => {
      asked.push(id);
      return f.lookups?.[id] ?? { kind: "not-found" };
    },
    fetchJson: async (url, registryKey) => {
      fetched.push(url);
      keyed.push(registryKey ?? "-");
      if (!f.json) throw new Error(`unexpected fetch ${url}`);
      return f.json(url);
    },
    limiter: lim,
    sleep: async () => {},
    now: f.now ?? (() => Date.parse("2026-10-18T10:00:00.000Z")),
    log,
    ...(f.budgetMs !== undefined ? { lookupBudgetMs: f.budgetMs } : {}),
    ...(f.sources !== undefined ? { sources: f.sources } : {}),
  };
  return { d, asked, fetched, keyed, log, lim };
}

async function one(r: EvidenceRow, f: Fakes = {}, titleSearch = true) {
  const x = deps(f);
  const out = await collectEvidence([r], { titleSearch }, x.d);
  return { ...x, result: out.byEntry.get(r.id) as RowEvidence, counts: out.counts };
}

/** A Crossref `works?query.bibliographic=` answer. */
function searchAnswer(items: object[]) {
  return { message: { items } };
}

const CROSSREF_ITEM = {
  DOI: "10.1038/NN.4304",
  title: [COUPLING_TITLE],
  type: "journal-article",
  abstract: `<jats:p>${ABSTRACT}</jats:p>`,
  author: [
    { family: "Maingret", given: "Nicolas", sequence: "first" },
    { family: "Zugaro", given: "Michaël", sequence: "additional" },
  ],
  issued: { "date-parts": [[2016, 5]] },
};

const TITLE_ROW = row({ id: "t1", title: COUPLING_TITLE, authors: "Nicolas Maingret", year: "2016" });

/* ---------------------------------------------------- by identifier -- */

describe("a row with a DOI or arXiv id", () => {
  it("takes Crossref's author abstract, with a code-built link and the moment it was read", async () => {
    const { result } = await one(COUPLING, {
      lookups: { "doi:10.1038/nn.4304": { kind: "found", record: record("doi:10.1038/nn.4304", COUPLING_TITLE, { abstract: ABSTRACT }) } },
    });
    expect(result).toEqual({
      state: "evidence",
      evidence: {
        kind: "author-abstract",
        source: "crossref",
        via: "id",
        workId: "doi:10.1038/nn.4304",
        url: "https://doi.org/10.1038/nn.4304",
        host: "doi.org",
        readAt: "2026-10-18T09:00:00.000Z",
        text: ABSTRACT,
        evidenceHash: expect.stringMatching(/^[0-9a-f]{16}$/) as string,
      },
    });
  });

  it("takes DataCite's abstract for an arXiv id, linked to arxiv.org", async () => {
    const attention = row({
      id: "a1",
      title: "Attention Is All You Need",
      url: "https://arxiv.org/abs/1706.03762",
      linkFrom: "arxiv",
    });
    const { result } = await one(attention, {
      lookups: {
        "arxiv:1706.03762": {
          kind: "found",
          record: record("arxiv:1706.03762", "Attention Is All You Need", {
            source: "datacite",
            doi: "10.48550/arxiv.1706.03762",
            abstract: ABSTRACT,
          }),
        },
      },
    });
    expect(result).toMatchObject({
      state: "evidence",
      evidence: { kind: "author-abstract", source: "datacite", url: "https://arxiv.org/abs/1706.03762", host: "arxiv.org" },
    });
  });

  it("is a conflict, asked nothing, when the Bibliography's registry verdict already says another work", async () => {
    const { result, asked } = await one({ ...COUPLING, registry: { kind: "conflict", source: "crossref" } });
    expect(asked).toEqual([]);
    expect(result).toEqual({ state: "no-evidence", why: "conflict", checkedAt: "2026-10-18T10:00:00.000Z" });
  });

  it("is a conflict when the record's title is another work's, and not-found / transient as the registry says", async () => {
    const other = await one(COUPLING, {
      lookups: { "doi:10.1038/nn.4304": { kind: "found", record: record("doi:10.1038/nn.4304", "Soil microbiomes of the Atacama desert", { abstract: ABSTRACT }) } },
    });
    expect(other.result).toMatchObject({ state: "no-evidence", why: "conflict" });
    expect((await one(COUPLING)).result).toEqual({ state: "no-evidence", why: "not-found", checkedAt: "2026-10-18T10:00:00.000Z" });
    const busy = await one(COUPLING, { lookups: { "doi:10.1038/nn.4304": { kind: "unavailable", why: "busy" } } });
    expect(busy.result).toEqual({ state: "transient", why: "busy" });
  });
});

/* ------------------------------------------------------ OpenAlex -- */

/** OpenAlex's `abstract_inverted_index` for a sentence. */
function inverted(sentence: string): Record<string, number[]> {
  const index: Record<string, number[]> = {};
  for (const [i, word] of sentence.split(" ").entries()) index[word] = [...(index[word] ?? []), i];
  return index;
}

describe("OpenAlex, by DOI, when the registry has no abstract", () => {
  const found = { "doi:10.1038/nn.4304": { kind: "found", record: record("doi:10.1038/nn.4304", COUPLING_TITLE) } } as const;

  it("is a reconstruction, labelled as one, never an author abstract", async () => {
    const { result, fetched } = await one(COUPLING, {
      lookups: found,
      json: () => ({ display_name: COUPLING_TITLE, type: "article", abstract_inverted_index: inverted(ABSTRACT) }),
    });
    expect(fetched).toHaveLength(1);
    expect(fetched[0]).toMatch(/^https:\/\/api\.openalex\.org\/works\/doi:10\.1038\/nn\.4304\?.*mailto=/);
    expect(result).toMatchObject({
      state: "evidence",
      evidence: { kind: "registry-reconstruction", source: "openalex", via: "id", text: ABSTRACT, url: "https://doi.org/10.1038/nn.4304" },
    });
  });

  it("refuses a book chapter or a book: the Searle reprint, whose stitched 'abstract' says the opposite of Searle", async () => {
    const SEARLE_TITLE = "Minds, brains, and programs";
    const searle = row({ id: "s1", title: SEARLE_TITLE, authors: "Searle, J. R.", url: "https://doi.org/10.4324/9781351251389-5", linkFrom: "doi" });
    for (const type of ["book-chapter", "book"]) {
      const { result } = await one(searle, {
        lookups: {
          "doi:10.4324/9781351251389-5": {
            kind: "found",
            record: record("doi:10.4324/9781351251389-5", SEARLE_TITLE, { authors: [{ family: "Searle", given: "John R." }], year: 2017 }),
          },
        },
        json: () => ({
          display_name: SEARLE_TITLE,
          type,
          abstract_inverted_index: inverted(
            "strong artificial intelligence must be false. The robot would have a television camera. Such a robot would have genuine understanding and other mental states.",
          ),
        }),
      });
      expect(result, type).toEqual({ state: "no-evidence", why: "no-abstract", checkedAt: "2026-10-18T10:00:00.000Z" });
    }
  });

  it("is not asked for an arXiv DOI: DataCite already holds the author's abstract", async () => {
    const preprint = row({ id: "p1", title: "Attention Is All You Need", url: "https://doi.org/10.48550/arXiv.1706.03762", linkFrom: "doi" });
    const { result, fetched } = await one(preprint, {
      lookups: {
        "doi:10.48550/arxiv.1706.03762": {
          kind: "found",
          record: record("doi:10.48550/arxiv.1706.03762", "Attention Is All You Need", { source: "datacite" }),
        },
      },
    });
    expect(fetched).toEqual([]);
    expect(result).toMatchObject({ state: "no-evidence", why: "no-abstract" });
  });

  it("is turned off for the run by a 429 or a 403 — one request, the rest transient — and a 429 cools it for everybody", async () => {
    for (const status of [429, 403]) {
      const second = { ...COUPLING, id: "c2", url: "https://doi.org/10.1038/nn.9999" };
      const x = deps({
        lookups: {
          ...found,
          "doi:10.1038/nn.9999": { kind: "found", record: record("doi:10.1038/nn.9999", COUPLING_TITLE) },
        },
        json: (url) => {
          throw new FetchFailure(status === 429 ? "rate-limited" : "http-error", url, `HTTP ${status}`, { status, retryAfterMs: null });
        },
      });
      /* OpenAlex has one slot (its migration seeds one), so the second row waits for the first. */
      let held = false;
      x.d.limiter = {
        ...x.lim,
        takeSlot: async (service, leaseMs) => {
          if (service === "openalex" && held) return null;
          if (service === "openalex") held = true;
          return { service, slot: 1, until: new Date(Date.now() + leaseMs) };
        },
        freeSlot: async (lease) => {
          if (lease.service === "openalex") held = false;
        },
      };
      x.d.sleep = (ms) => new Promise((done) => setTimeout(done, Math.min(ms, 1)));
      const out = await collectEvidence([COUPLING, second], { titleSearch: true }, x.d);
      expect(x.fetched, String(status)).toHaveLength(1);
      expect(out.byEntry.get("c1")).toEqual({ state: "transient", why: "openalex-off" });
      expect(out.byEntry.get("c2")).toEqual({ state: "transient", why: "openalex-off" });
      expect(x.lim.cooled).toEqual(status === 429 ? ["openalex"] : []);
    }
  });

  it("logs a 401 as a configuration failure, not as a busy service", async () => {
    const { result, log } = await one(COUPLING, {
      lookups: found,
      json: (url) => {
        throw new FetchFailure("http-error", url, "HTTP 401", { status: 401, retryAfterMs: null });
      },
    });
    expect(result).toEqual({ state: "transient", why: "openalex-off" });
    expect(log.errors).toEqual([expect.objectContaining({ service: "openalex", status: 401, outcome: "configuration" })]);
  });
});

/* ------------------------------------------------- the title search -- */

describe("which title-only rows are searched", () => {
  const match = () => searchAnswer([CROSSREF_ITEM]);

  it("searches Crossref once, politely, with the title and the first author's surname, and keeps a strict match", async () => {
    const { result, fetched } = await one(TITLE_ROW, { json: match });
    expect(fetched).toHaveLength(1);
    const url = new URL(fetched[0]!);
    expect(url.origin + url.pathname).toBe("https://api.crossref.org/works");
    expect(url.searchParams.get("query.bibliographic")).toBe(
      "hippocampo cortical coupling mediates memory consolidation during sleep maingret",
    );
    expect(url.searchParams.get("rows")).toBe("5");
    expect(url.searchParams.get("mailto")).toMatch(/@/);
    expect(result).toMatchObject({
      state: "evidence",
      evidence: { kind: "author-abstract", source: "crossref", via: "title", workId: "doi:10.1038/nn.4304", text: ABSTRACT },
    });
  });

  it("is not attempted at all for an article that was not imported from a public web address (G6)", async () => {
    const { result, fetched } = await one(TITLE_ROW, { json: match }, false);
    expect(fetched).toEqual([]);
    expect(result).toEqual({ state: "no-evidence", why: "title-search-off" });
  });

  it("does not search an author–year label", async () => {
    for (const title of ["Zacks et al. (2007)", "Acemoglu and Restrepo (2019)", "Acemoglu, Autor, and Restrepo (2019)"]) {
      const { result, fetched } = await one(row({ id: "l1", title, authors: "Zacks" }), { json: match });
      expect(fetched, title).toEqual([]);
      expect(result, title).toEqual({ state: "no-evidence", why: "label-only" });
    }
  });

  it("does not search a work the entry says is unpublished, in preparation, under review, submitted or forthcoming", async () => {
    const said = [
      { title: "Sleep spindles and memory in older adults (in preparation)" },
      { title: COUPLING_TITLE, year: "forthcoming" },
      { title: COUPLING_TITLE, entry: "Maingret, N. Hippocampo-cortical coupling… Manuscript under review." },
      { title: COUPLING_TITLE, entry: "Maingret, N. (2016). Unpublished manuscript." },
      { title: COUPLING_TITLE, entry: "Maingret, N. Submitted to Nature." },
      { title: COUPLING_TITLE, entry: "Maingret, N., personal communication, 2016." },
    ];
    for (const over of said) {
      const { result, fetched } = await one(row({ id: "u1", authors: "Maingret, N.", ...over }), { json: match });
      expect(fetched, JSON.stringify(over)).toEqual([]);
      expect(result, JSON.stringify(over)).toEqual({ state: "no-evidence", why: "unpublished" });
    }
  });

  it("does not search a title too weak to name one work, or a row with no author to check", async () => {
    for (const over of [{ title: "Introduction", authors: "Smith" }, { title: COUPLING_TITLE }]) {
      const { result, fetched } = await one(row({ id: "w1", ...over }), { json: match });
      expect(fetched).toEqual([]);
      expect(result).toEqual({ state: "no-evidence", why: "no-identifier-or-title" });
    }
  });

  it("is not-found, with when it was checked, when no item passes the rule", async () => {
    const { result } = await one(TITLE_ROW, { json: () => searchAnswer([{ ...CROSSREF_ITEM, title: ["Something else entirely here"] }]) });
    expect(result).toEqual({ state: "no-evidence", why: "not-found", checkedAt: "2026-10-18T10:00:00.000Z" });
  });

  it("is no-abstract when the matching item has none", async () => {
    const { abstract: _a, ...bare } = CROSSREF_ITEM;
    const { result } = await one(TITLE_ROW, { json: () => searchAnswer([bare]) });
    expect(result).toMatchObject({ state: "no-evidence", why: "no-abstract" });
  });

  it(`asks at most ${MAX_TITLE_SEARCHES} title queries a run; the rest are transient, to be asked next time`, async () => {
    const rows = Array.from({ length: MAX_TITLE_SEARCHES + 5 }, (_, i) => ({ ...TITLE_ROW, id: `t${i}` }));
    const x = deps({ json: match });
    const out = await collectEvidence(rows, { titleSearch: true }, x.d);
    expect(x.fetched).toHaveLength(MAX_TITLE_SEARCHES);
    const overCap = rows.filter((r) => out.byEntry.get(r.id)?.state === "transient");
    expect(overCap.map((r) => r.id)).toEqual(["t60", "t61", "t62", "t63", "t64"]);
    expect(out.byEntry.get("t64")).toEqual({ state: "transient", why: "over-cap" });
    expect(out.counts.titleQueries).toBe(MAX_TITLE_SEARCHES);
  });

  it("cools Crossref for everybody on a 429, but does not wait past the lookup budget", async () => {
    const clock = 0;
    const { result, lim } = await one(TITLE_ROW, {
      now: () => clock,
      budgetMs: 1_000,
      json: (url) => {
        throw new FetchFailure("rate-limited", url, "HTTP 429", { status: 429, retryAfterMs: null });
      },
    });
    expect(result).toEqual({ state: "transient", why: "over-budget" });
    expect(lim.cooled).toEqual(["crossref"]);
  });

  it("waits out Crossref's Retry-After inside the lookup budget, then asks the row again", async () => {
    let clock = 0;
    let coolingUntil = 0;
    let requests = 0;
    const sleeps: number[] = [];
    const x = deps({
      now: () => clock,
      budgetMs: 10_000,
      json: (url) => {
        requests++;
        if (requests === 1) {
          throw new FetchFailure("rate-limited", url, "HTTP 429", { status: 429, retryAfterMs: 2_500 });
        }
        return searchAnswer([CROSSREF_ITEM]);
      },
    });
    x.d.limiter = {
      ...x.lim,
      coolingDown: async (service) => service === "crossref" && clock < coolingUntil,
      coolDown: async (service, forMs) => {
        if (service === "crossref") coolingUntil = Math.max(coolingUntil, clock + forMs);
      },
    };
    x.d.sleep = async (ms) => {
      sleeps.push(ms);
      clock += ms;
    };

    const out = await collectEvidence([TITLE_ROW], { titleSearch: true }, x.d);

    expect(out.byEntry.get(TITLE_ROW.id)).toMatchObject({ state: "evidence" });
    expect(requests).toBe(2);
    expect(out.counts.titleQueries).toBe(2);
    expect(sleeps.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThanOrEqual(2_500);
    expect(clock).toBeLessThan(10_000);
  });

  it("does not wait through Retry-After when the claim's deadline margin is nearer", async () => {
    let clock = 0;
    let requests = 0;
    const sleeps: number[] = [];
    const x = deps({
      now: () => clock,
      budgetMs: 10_000,
      json: (url) => {
        requests++;
        throw new FetchFailure("rate-limited", url, "HTTP 429", { status: 429, retryAfterMs: 2_500 });
      },
    });
    x.d.sleep = async (ms) => {
      sleeps.push(ms);
      clock += ms;
    };

    const out = await collectEvidence(
      [TITLE_ROW],
      { titleSearch: true, deadlineAt: 3_000, deadlineMarginMs: 1_000 },
      x.d,
    );

    expect(out.byEntry.get(TITLE_ROW.id)).toEqual({ state: "transient", why: "over-budget" });
    expect(requests).toBe(1);
    expect(sleeps).toEqual([]);
  });
});

describe("the strict title rule (design § 3, G10)", () => {
  const ok = (item: object, r: EvidenceRow = TITLE_ROW) => crossrefItemIdentifies(item, r);

  it("keeps an exact title with the same first author, and a title equal up to a subtitle", () => {
    expect(ok(CROSSREF_ITEM)).toBe(true);
    expect(ok({ ...CROSSREF_ITEM, subtitle: ["Evidence from rodents"] })).toBe(true);
    expect(ok(CROSSREF_ITEM, { ...TITLE_ROW, title: `${COUPLING_TITLE}: evidence from rodents` })).toBe(true);
  });

  it("refuses a same-title review by another author", () => {
    expect(ok({ ...CROSSREF_ITEM, author: [{ family: "Reviewer", given: "A.", sequence: "first" }] })).toBe(false);
    expect(ok({ ...CROSSREF_ITEM, type: "peer-review" })).toBe(false);
  });

  it("refuses agreement on the second author alone: the first author must agree", () => {
    expect(
      ok({
        ...CROSSREF_ITEM,
        author: [
          { family: "Zugaro", given: "Michaël", sequence: "first" },
          { family: "Maingret", given: "Nicolas", sequence: "additional" },
        ],
      }),
    ).toBe(false);
  });

  it("refuses year-only agreement (no first author) and a year more than one off", () => {
    expect(ok({ ...CROSSREF_ITEM, author: [] })).toBe(false);
    expect(ok({ ...CROSSREF_ITEM, issued: { "date-parts": [[2019]] } })).toBe(false);
    expect(ok({ ...CROSSREF_ITEM, issued: { "date-parts": [[2017]] } })).toBe(true);
  });

  it("refuses a correction's tail and an item of the wrong kind", () => {
    expect(ok({ ...CROSSREF_ITEM, title: [`${COUPLING_TITLE}: Correction`] })).toBe(false);
    expect(ok({ ...CROSSREF_ITEM, title: [`Correction to: ${COUPLING_TITLE}`] })).toBe(false);
    expect(ok({ ...CROSSREF_ITEM, type: "component" })).toBe(false);
    expect(ok({ ...CROSSREF_ITEM, type: "dataset" })).toBe(false);
  });

  describe("a book-looking entry", () => {
    const BOOK = row({
      id: "b1",
      title: "The Intentional Stance and its critics",
      authors: "Dennett, D. C.",
      year: "1987",
      entry: "Dennett, D. C. (1987). The Intentional Stance and its critics. Cambridge, MA: MIT Press.",
    });
    const item = (type: string) => ({
      DOI: "10.7551/mitpress/1234.001.0001",
      title: ["The Intentional Stance and its critics"],
      type,
      author: [{ family: "Dennett", given: "Daniel C.", sequence: "first" }],
      issued: { "date-parts": [[1987]] },
    });

    it("matches only a book-type record", () => {
      for (const type of ACCEPTED_BOOK_TYPES) expect(crossrefItemIdentifies(item(type), BOOK), type).toBe(true);
      expect(ACCEPTED_BOOK_TYPES).toEqual(["book", "monograph", "edited-book", "reference-book"]);
    });

    it("refuses a journal record and a book chapter", () => {
      expect(crossrefItemIdentifies(item("journal-article"), BOOK)).toBe(false);
      expect(crossrefItemIdentifies(item("book-chapter"), BOOK)).toBe(false);
    });

    it("is book-looking by ISBN, Publishers, Books or (Ed./Eds.) as well as Press", () => {
      for (const entry of [
        "Dennett (1987). The Intentional Stance and its critics. ISBN 978-0-262-04093-0.",
        "Dennett (1987). The Intentional Stance and its critics. Bradford Books.",
        "Dennett (1987). The Intentional Stance and its critics. Kluwer Academic Publishers.",
        "Dennett, D. C. (Ed.). (1987). The Intentional Stance and its critics.",
        "Dennett, D. C. (Eds.). (1987). The Intentional Stance and its critics.",
      ]) {
        expect(crossrefItemIdentifies(item("journal-article"), { ...BOOK, entry }), entry).toBe(false);
      }
    });
  });
});

/* ---------------------------------------------------------- the budget -- */

describe("the run's budget", () => {
  it(`starts no lookup after ${LOOKUP_BUDGET_MS / 1000} s; the rest are transient`, async () => {
    let clock = 0;
    const rows = Array.from({ length: 6 }, (_, i) => ({
      ...COUPLING,
      id: `c${i}`,
      url: `https://doi.org/10.1038/nn.${4300 + i}`,
    }));
    const lookups: Record<string, LookupResult> = {};
    for (let i = 0; i < 6; i++) {
      const doi = `10.1038/nn.${4300 + i}`;
      lookups[`doi:${doi}`] = { kind: "found", record: record(`doi:${doi}`, COUPLING_TITLE, { abstract: ABSTRACT }) };
    }
    const x = deps({ lookups, now: () => clock });
    const slow = x.d.lookup;
    x.d.lookup = async (id) => {
      const answer = await slow(id);
      clock += 50_000;
      return answer;
    };
    const out = await collectEvidence(rows, { titleSearch: true }, x.d);
    const states = rows.map((r) => out.byEntry.get(r.id));
    /* Two at a time, each lookup taking 50 s: the first pair start at 0, the
       next two at 50 s and 100 s (inside the budget), and nothing at 150 s. */
    expect(x.asked).toHaveLength(4);
    expect(states.filter((s) => s?.state === "evidence")).toHaveLength(4);
    expect(states.filter((s) => s?.state === "transient" && s.why === "over-budget")).toHaveLength(2);
  });

  it("answers every row it was given, exactly once", async () => {
    const rows = [COUPLING, TITLE_ROW, row({ id: "x1", title: "Some page", url: "https://example.com/p", linkFrom: "article" })];
    const out = await collectEvidence(rows, { titleSearch: false }, deps().d);
    expect([...out.byEntry.keys()].sort()).toEqual(["c1", "t1", "x1"]);
    expect(out.byEntry.get("x1")).toEqual({ state: "no-evidence", why: "no-identifier-or-title" });
  });
});

/* ===================================================================== *
 * Plan 261018o stage 1: Semantic Scholar by id, OpenAlex by title, each
 * switched on only by its key (docs/plans/261018o-…-registry-keys.md, R2,
 * R5, R6 of its review). Tests 2–5 of the plan's list.
 * ===================================================================== */

const BOTH: OptionalSources = { semanticScholar: true, openAlexKeyed: true };
const S2_ONLY: OptionalSources = { semanticScholar: true, openAlexKeyed: false };
const PAPER_ID = "649def34f8be52c8b66281af98ae884c09aef38b";
const S2_ABSTRACT = "Semantic Scholar's copy: spindles couple hippocampus and cortex during sleep, and memory improves.";
const S2_PAPER = {
  paperId: PAPER_ID,
  title: COUPLING_TITLE,
  abstract: S2_ABSTRACT,
  externalIds: { DOI: "10.1038/NN.4304", MAG: "2403111963", CorpusId: 1234 },
  year: 2016,
};
const OA_WORK = { display_name: COUPLING_TITLE, type: "article", abstract_inverted_index: inverted(ABSTRACT) };
const NO_ABSTRACT = { "doi:10.1038/nn.4304": { kind: "found", record: record("doi:10.1038/nn.4304", COUPLING_TITLE) } } as const;

const isS2 = (url: string) => url.startsWith("https://api.semanticscholar.org/");
const isOpenAlexSearch = (url: string) => url.startsWith("https://api.openalex.org/works?");
const isOpenAlexDoi = (url: string) => url.startsWith("https://api.openalex.org/works/doi:");

/** A fake for every service by its address; anything it is not told about is a 404. */
function services(answers: { s2?: () => unknown; oaSearch?: () => unknown; oaDoi?: () => unknown; crossref?: () => unknown }) {
  return (url: string): unknown => {
    const answer = isS2(url)
      ? answers.s2
      : isOpenAlexSearch(url)
        ? answers.oaSearch
        : isOpenAlexDoi(url)
          ? answers.oaDoi
          : answers.crossref;
    if (answer === undefined) throw new FetchFailure("http-error", url, "HTTP 404", { status: 404, retryAfterMs: null });
    return answer();
  };
}

describe("with no key, neither new source is asked (test 2)", () => {
  it("asks no Semantic Scholar and no OpenAlex search, for an id row or a title-only row Crossref cannot find", async () => {
    const x = deps({
      lookups: NO_ABSTRACT,
      json: services({ oaDoi: () => OA_WORK, crossref: () => searchAnswer([]), s2: () => S2_PAPER, oaSearch: () => ({ results: [] }) }),
    });
    const out = await collectEvidence([COUPLING, TITLE_ROW], { titleSearch: true }, x.d);
    expect(x.fetched.filter(isS2)).toEqual([]);
    expect(x.fetched.filter(isOpenAlexSearch)).toEqual([]);
    expect(out.byEntry.get("c1")).toMatchObject({ state: "evidence", evidence: { source: "openalex" } });
    expect(out.byEntry.get("t1")).toEqual({ state: "no-evidence", why: "not-found", checkedAt: "2026-10-18T10:00:00.000Z" });
    expect(x.log.errors).toEqual([]);
  });

  it("asks no Semantic Scholar while its approval is missing, whatever else is on (R5)", async () => {
    const x = deps({ lookups: NO_ABSTRACT, sources: { semanticScholar: false, openAlexKeyed: true }, json: services({ oaDoi: () => OA_WORK }) });
    await collectEvidence([COUPLING], { titleSearch: true }, x.d);
    expect(x.fetched.filter(isS2)).toEqual([]);
  });

  it("names OpenAlex's key on every OpenAlex request, so a key that is set is sent", async () => {
    const x = deps({ lookups: NO_ABSTRACT, json: services({ oaDoi: () => OA_WORK }) });
    await collectEvidence([COUPLING], { titleSearch: true }, x.d);
    expect(x.fetched.filter(isOpenAlexDoi)).toHaveLength(1);
    expect(x.keyed).toEqual(["openalex"]);
  });

  /* Stage 1's code review, F4: a DOI lookup that STARTS inside the budget and
     ends after it still goes straight on to OpenAlex under the keyless policy,
     as it did before the phases existed. Only a keyed run waits for phase 3. */
  it("goes straight on to OpenAlex from a lookup that ends past the budget, keyless — as before the phases", async () => {
    for (const sources of [undefined, { semanticScholar: false, openAlexKeyed: true }] as const) {
      let clock = 0;
      const x = deps({ lookups: NO_ABSTRACT, now: () => clock, budgetMs: 1_000, json: services({ oaDoi: () => OA_WORK }), ...(sources ? { sources } : {}) });
      const slow = x.d.lookup;
      x.d.lookup = async (id) => {
        const answer = await slow(id);
        clock += 5_000;
        return answer;
      };
      const out = await collectEvidence([COUPLING], { titleSearch: true }, x.d);
      if (sources === undefined) {
        expect(x.fetched.filter(isOpenAlexDoi), "keyless").toHaveLength(1);
        expect(out.byEntry.get("c1")).toMatchObject({ state: "evidence", evidence: { source: "openalex" } });
      } else {
        expect(x.fetched, "keyed: phase 3 starts nothing past the budget").toEqual([]);
        expect(out.byEntry.get("c1")).toEqual({ state: "transient", why: "over-budget" });
      }
    }
  });
});

describe("Semantic Scholar by DOI or arXiv id (test 3)", () => {
  it("is the work's author abstract when its own id and its title agree, linked to doi.org, its paper id kept", async () => {
    const x = deps({ lookups: NO_ABSTRACT, sources: S2_ONLY, json: services({ s2: () => S2_PAPER, oaDoi: () => OA_WORK }) });
    const out = await collectEvidence([COUPLING], { titleSearch: true }, x.d);
    expect(x.fetched).toEqual([
      "https://api.semanticscholar.org/graph/v1/paper/DOI:10.1038/nn.4304?fields=paperId,title,abstract,externalIds,year",
    ]);
    expect(x.keyed).toEqual(["semantic-scholar"]);
    expect(out.byEntry.get("c1")).toEqual({
      state: "evidence",
      evidence: {
        kind: "author-abstract",
        source: "semantic-scholar",
        via: "id",
        workId: "doi:10.1038/nn.4304",
        url: "https://doi.org/10.1038/nn.4304",
        host: "doi.org",
        readAt: "2026-10-18T10:00:00.000Z",
        text: S2_ABSTRACT,
        evidenceHash: expect.stringMatching(/^[0-9a-f]{16}$/) as string,
        paperId: PAPER_ID,
      },
    });
    expect(out.counts.semanticScholarQueries).toBe(1);
  });

  it("asks by ARXIV: for an arXiv id DataCite had no abstract for, and accepts its ArXiv external id", async () => {
    const attention = row({ id: "a1", title: "Attention Is All You Need", authors: "Vaswani", url: "https://arxiv.org/abs/1706.03762", linkFrom: "arxiv" });
    const x = deps({
      lookups: {
        "arxiv:1706.03762": {
          kind: "found",
          record: record("arxiv:1706.03762", "Attention Is All You Need", { source: "datacite", doi: "10.48550/arxiv.1706.03762", authors: [{ family: "Vaswani" }], year: 2017 }),
        },
      },
      sources: S2_ONLY,
      json: services({ s2: () => ({ ...S2_PAPER, title: "Attention is All you Need", externalIds: { ArXiv: "1706.03762", DBLP: "x" } }) }),
    });
    const out = await collectEvidence([attention], { titleSearch: true }, x.d);
    expect(x.fetched).toEqual([
      "https://api.semanticscholar.org/graph/v1/paper/ARXIV:1706.03762?fields=paperId,title,abstract,externalIds,year",
    ]);
    expect(out.byEntry.get("a1")).toMatchObject({ state: "evidence", evidence: { source: "semantic-scholar", url: "https://arxiv.org/abs/1706.03762" } });
  });

  it("is not the work's when its title does not agree, or its ids are another work's — and OpenAlex is asked as before", async () => {
    for (const paper of [
      { ...S2_PAPER, title: "Soil microbiomes of the Atacama desert" },
      { ...S2_PAPER, externalIds: { DOI: "10.1038/nn.9999" } },
      { ...S2_PAPER, externalIds: {} },
    ]) {
      const x = deps({ lookups: NO_ABSTRACT, sources: S2_ONLY, json: services({ s2: () => paper, oaDoi: () => OA_WORK }) });
      const out = await collectEvidence([COUPLING], { titleSearch: true }, x.d);
      expect(out.byEntry.get("c1"), JSON.stringify(paper)).toMatchObject({ state: "evidence", evidence: { source: "openalex" } });
    }
  });

  it("never takes a TLDR: a model's summary is not the author's abstract", async () => {
    const tldrOnly = { ...S2_PAPER, abstract: null, tldr: { model: "tldr@v2.0.0", text: "Spindles help memory." } };
    const x = deps({ lookups: NO_ABSTRACT, sources: S2_ONLY, json: services({ s2: () => tldrOnly }) });
    const out = await collectEvidence([COUPLING], { titleSearch: true }, x.d);
    expect(out.byEntry.get("c1")).toEqual({ state: "no-evidence", why: "no-abstract", checkedAt: "2026-10-18T10:00:00.000Z" });
    expect(JSON.stringify(out)).not.toContain("Spindles help memory");
  });

  it("refuses a paper id that is not Semantic Scholar's 40 hex characters", async () => {
    const x = deps({ lookups: NO_ABSTRACT, sources: S2_ONLY, json: services({ s2: () => ({ ...S2_PAPER, paperId: "../../evil" }) }) });
    const out = await collectEvidence([COUPLING], { titleSearch: true }, x.d);
    expect(out.byEntry.get("c1")).toMatchObject({ state: "no-evidence", why: "no-abstract" });
  });

  it("is off for the run on a 401 with its key set: one request, every row transient, logged as configuration, never as the key", async () => {
    for (const status of [401, 403]) {
      const second = { ...COUPLING, id: "c2", url: "https://doi.org/10.1038/nn.9999" };
      const x = deps({
        lookups: { ...NO_ABSTRACT, "doi:10.1038/nn.9999": { kind: "found", record: record("doi:10.1038/nn.9999", COUPLING_TITLE) } },
        sources: S2_ONLY,
        json: (url) => {
          if (isS2(url)) throw new FetchFailure("http-error", url, `HTTP ${status}`, { status, retryAfterMs: null });
          return { display_name: COUPLING_TITLE, type: "article" };
        },
      });
      const out = await collectEvidence([COUPLING, second], { titleSearch: true }, x.d);
      expect(x.fetched.filter(isS2), String(status)).toHaveLength(1);
      expect(out.byEntry.get("c1")).toEqual({ state: "transient", why: "semantic-scholar-off" });
      expect(out.byEntry.get("c2")).toEqual({ state: "transient", why: "semantic-scholar-off" });
      expect(x.log.errors).toEqual([expect.objectContaining({ service: "semantic-scholar", status, outcome: "configuration" })]);
    }
  });

  /* Stage 1's code review, F5: the 429 breaker. */
  it("is off for the run on a 429: one request, one shared cooldown, every row transient, a warning and no configuration error", async () => {
    const second = { ...COUPLING, id: "c2", url: "https://doi.org/10.1038/nn.9999" };
    const x = deps({
      lookups: { ...NO_ABSTRACT, "doi:10.1038/nn.9999": { kind: "found", record: record("doi:10.1038/nn.9999", COUPLING_TITLE) } },
      sources: S2_ONLY,
      json: (url) => {
        if (isS2(url)) throw new FetchFailure("rate-limited", url, "HTTP 429", { status: 429, retryAfterMs: 30_000 });
        return { display_name: COUPLING_TITLE, type: "article" };
      },
    });
    const warnings: unknown[] = [];
    x.d.log = { ...x.log, warn: (o: unknown) => warnings.push(o), child: () => x.d.log } as unknown as Log;
    const out = await collectEvidence([COUPLING, second], { titleSearch: true }, x.d);
    expect(x.fetched.filter(isS2)).toHaveLength(1);
    expect(x.lim.cooled).toEqual(["semantic-scholar"]);
    expect(out.byEntry.get("c1")).toEqual({ state: "transient", why: "semantic-scholar-off" });
    expect(out.byEntry.get("c2")).toEqual({ state: "transient", why: "semantic-scholar-off" });
    expect(warnings.filter((w) => (w as { service?: string }).service === "semantic-scholar")).toEqual([
      expect.objectContaining({ service: "semantic-scholar", status: 429, outcome: "off-for-run" }),
    ]);
    expect(x.log.errors).toEqual([]);
  });

  it("falls through to OpenAlex when it is busy or broken, and an OpenAlex note stands (R6)", async () => {
    const x = deps({
      lookups: NO_ABSTRACT,
      sources: S2_ONLY,
      json: (url) => {
        if (isS2(url)) throw new FetchFailure("http-error", url, "HTTP 500", { status: 500, retryAfterMs: null });
        return OA_WORK;
      },
    });
    const out = await collectEvidence([COUPLING], { titleSearch: true }, x.d);
    expect(out.byEntry.get("c1")).toMatchObject({ state: "evidence", evidence: { source: "openalex" } });
  });
});

describe("the cascade's order (test 5)", () => {
  it("takes Crossref's abstract and asks neither Semantic Scholar nor OpenAlex", async () => {
    const x = deps({
      lookups: { "doi:10.1038/nn.4304": { kind: "found", record: record("doi:10.1038/nn.4304", COUPLING_TITLE, { abstract: ABSTRACT }) } },
      sources: BOTH,
      json: services({ s2: () => S2_PAPER, oaDoi: () => OA_WORK }),
    });
    const out = await collectEvidence([COUPLING], { titleSearch: true }, x.d);
    expect(x.fetched).toEqual([]);
    expect(out.byEntry.get("c1")).toMatchObject({ state: "evidence", evidence: { source: "crossref", text: ABSTRACT } });
  });

  it("takes Semantic Scholar's abstract over OpenAlex's reconstruction, which is then not asked", async () => {
    const x = deps({ lookups: NO_ABSTRACT, sources: BOTH, json: services({ s2: () => S2_PAPER, oaDoi: () => OA_WORK }) });
    const out = await collectEvidence([COUPLING], { titleSearch: true }, x.d);
    expect(x.fetched.filter(isOpenAlexDoi)).toEqual([]);
    expect(out.byEntry.get("c1")).toMatchObject({ state: "evidence", evidence: { source: "semantic-scholar" } });
  });

  it("asks Semantic Scholar for a Crossref title match that had no abstract, and keeps how it was found", async () => {
    const { abstract: _a, ...bare } = CROSSREF_ITEM;
    const x = deps({ sources: S2_ONLY, json: services({ crossref: () => searchAnswer([bare]), s2: () => S2_PAPER }) });
    const out = await collectEvidence([TITLE_ROW], { titleSearch: true }, x.d);
    expect(out.byEntry.get("t1")).toMatchObject({
      state: "evidence",
      evidence: { source: "semantic-scholar", via: "title", workId: "doi:10.1038/nn.4304" },
    });
    /* A Crossref title match is not reconstructed by OpenAlex, as before. */
    expect(x.fetched.filter(isOpenAlexDoi)).toEqual([]);
  });
});

/** An OpenAlex `/works?search.title=` result, the Crossref fixture's work. */
const OA_ITEM = {
  id: "https://openalex.org/W2403111963",
  doi: "https://doi.org/10.1038/nn.4304",
  display_name: COUPLING_TITLE,
  type: "article",
  publication_year: 2016,
  authorships: [
    { author_position: "first", raw_author_name: "Nicolas Maingret", author: { display_name: "Nicolas Maingret" } },
    { author_position: "last", raw_author_name: "Michaël Zugaro", author: { display_name: "Michaël Zugaro" } },
  ],
};

describe("OpenAlex's title search, with its key (test 4)", () => {
  const KEYED: OptionalSources = { semanticScholar: false, openAlexKeyed: true };

  it("is asked only when Crossref found no match, by title, with its key, and its DOI then gets OpenAlex's reconstruction", async () => {
    const x = deps({
      sources: KEYED,
      json: services({ crossref: () => searchAnswer([]), oaSearch: () => ({ results: [OA_ITEM] }), oaDoi: () => OA_WORK }),
    });
    const out = await collectEvidence([TITLE_ROW], { titleSearch: true }, x.d);
    const search = x.fetched.find(isOpenAlexSearch);
    expect(search).toBeDefined();
    const url = new URL(search!);
    expect(url.searchParams.get("search.title")).toBe("hippocampo cortical coupling mediates memory consolidation during sleep");
    expect(url.searchParams.get("filter")).toBe("has_doi:true");
    expect(url.searchParams.get("per_page")).toBe("5");
    expect(url.searchParams.get("select")).toBe("id,doi,display_name,type,publication_year,authorships");
    expect(url.searchParams.get("mailto")).toMatch(/@/);
    expect(x.keyed).toEqual(["-", "openalex", "openalex"]);
    expect(out.byEntry.get("t1")).toMatchObject({
      state: "evidence",
      evidence: { kind: "registry-reconstruction", source: "openalex", via: "title", workId: "doi:10.1038/nn.4304" },
    });
    expect(out.counts.titleQueries).toBe(2);
    expect(out.counts.openAlexTitleQueries).toBe(1);
  });

  it("is not asked when Crossref matched, for an upload, or with no key", async () => {
    const crossrefFinds = deps({ sources: KEYED, json: services({ crossref: () => searchAnswer([CROSSREF_ITEM]) }) });
    await collectEvidence([TITLE_ROW], { titleSearch: true }, crossrefFinds.d);
    expect(crossrefFinds.fetched.filter(isOpenAlexSearch)).toEqual([]);
    const upload = deps({ sources: KEYED, json: services({ crossref: () => searchAnswer([]) }) });
    await collectEvidence([TITLE_ROW], { titleSearch: false }, upload.d);
    expect(upload.fetched).toEqual([]);
  });

  it("refuses a match with no DOI, a book-looking row's non-book, and a book chapter", async () => {
    const { doi: _d, ...noDoi } = OA_ITEM;
    const x = deps({ sources: KEYED, json: services({ crossref: () => searchAnswer([]), oaSearch: () => ({ results: [noDoi] }) }) });
    const out = await collectEvidence([TITLE_ROW], { titleSearch: true }, x.d);
    expect(out.byEntry.get("t1")).toEqual({ state: "no-evidence", why: "not-found", checkedAt: "2026-10-18T10:00:00.000Z" });

    const book = { ...TITLE_ROW, entry: "Maingret, N. (2016). Hippocampo-cortical coupling. MIT Press." };
    for (const type of ["article", "book-chapter"]) {
      expect(openAlexItemIdentifies({ ...OA_ITEM, type }, book), type).toBe(false);
    }
    expect(openAlexItemIdentifies({ ...OA_ITEM, type: "book" }, book)).toBe(true);
  });

  it("counts against the same cap as Crossref's title queries", async () => {
    const rows = Array.from({ length: MAX_TITLE_SEARCHES }, (_, i) => ({ ...TITLE_ROW, id: `t${i}` }));
    const x = deps({ sources: KEYED, json: services({ crossref: () => searchAnswer([]), oaSearch: () => ({ results: [] }) }) });
    const out = await collectEvidence(rows, { titleSearch: true }, x.d);
    expect(x.fetched).toHaveLength(MAX_TITLE_SEARCHES);
    expect(out.counts.titleQueries).toBe(MAX_TITLE_SEARCHES);
    expect([...out.byEntry.values()].some((a) => a.state === "transient" && a.why === "over-cap")).toBe(true);
  });

  it("treats a 403 with the key set as configuration: logged at error, OpenAlex off for the run, the row transient", async () => {
    const x = deps({
      sources: KEYED,
      json: (url) => {
        if (isOpenAlexSearch(url)) throw new FetchFailure("http-error", url, "HTTP 403", { status: 403, retryAfterMs: null });
        return searchAnswer([]);
      },
    });
    const out = await collectEvidence([TITLE_ROW], { titleSearch: true }, x.d);
    expect(out.byEntry.get("t1")).toEqual({ state: "transient", why: "openalex-off" });
    expect(x.log.errors).toEqual([expect.objectContaining({ service: "openalex", status: 403, outcome: "configuration" })]);
    expect(x.lim.cooled).toEqual([]);
  });
});

describe("one strict rule over both registries' records (test 4, R6)", () => {
  /** The Crossref rule's cases, each as an OpenAlex item. */
  const ok = (over: object, r: EvidenceRow = TITLE_ROW) => openAlexItemIdentifies({ ...OA_ITEM, ...over }, r);
  const first = (name: string) => ({ author_position: "first", raw_author_name: name, author: { display_name: name } });

  it("keeps the same work, and a title equal up to a subtitle", () => {
    expect(ok({})).toBe(true);
    expect(ok({}, { ...TITLE_ROW, title: `${COUPLING_TITLE}: evidence from rodents` })).toBe(true);
    expect(ok({ display_name: `${COUPLING_TITLE}: Evidence from rodents` })).toBe(true);
  });

  it("refuses another first author, agreement on the second author alone, or no first author", () => {
    expect(ok({ authorships: [first("A. Reviewer")] })).toBe(false);
    expect(ok({ authorships: [first("Michaël Zugaro"), { ...first("Nicolas Maingret"), author_position: "middle" }] })).toBe(false);
    expect(ok({ authorships: [{ ...first("Nicolas Maingret"), author_position: "middle" }] })).toBe(false);
    expect(ok({ authorships: [] })).toBe(false);
  });

  it("falls back to the author's display name when the byline's raw name is absent", () => {
    expect(ok({ authorships: [{ author_position: "first", author: { display_name: "Nicolas Maingret" } }] })).toBe(true);
  });

  it("refuses a year more than one off, a correction's tail", () => {
    expect(ok({ publication_year: 2019 })).toBe(false);
    expect(ok({ publication_year: 2017 })).toBe(true);
    expect(ok({ display_name: `${COUPLING_TITLE}: Correction` })).toBe(false);
    expect(ok({ display_name: `Correction to: ${COUPLING_TITLE}` })).toBe(false);
  });

  it("refuses OpenAlex's own kinds that are not the work: a review of it, an erratum, a retraction, paratext, a peer review, a dataset", () => {
    for (const type of ["book-review", "erratum", "retraction", "paratext", "peer-review", "dataset", "supplementary-materials"]) {
      expect(ok({ type }), type).toBe(false);
    }
    for (const type of ["article", "preprint", "review", "letter"]) expect(ok({ type }), type).toBe(true);
  });

  it("is the rule Crossref's items go through too", () => {
    expect(crossrefItemIdentifies(CROSSREF_ITEM, TITLE_ROW)).toBe(true);
    expect(crossrefItemIdentifies({ ...CROSSREF_ITEM, type: "peer-review" }, TITLE_ROW)).toBe(false);
    expect(openAlexItemIdentifies(null, TITLE_ROW)).toBe(false);
  });
});

it("the real deps are the shared lookup and the guarded JSON fetch", async () => {
  const { citationEvidenceDeps } = await import("../src/citation-evidence.js");
  const { lookupWork } = await import("../src/bibliographic.js");
  const d = await citationEvidenceDeps();
  expect(d.lookup).toBe(lookupWork);
  await expect(d.fetchJson("https://example.com/works")).rejects.toMatchObject({ code: "blocked-address" });
  vi.restoreAllMocks();
});

it("the real deps read which optional sources are on from the environment, per run", async () => {
  const { citationEvidenceDeps } = await import("../src/citation-evidence.js");
  const before = { oa: process.env.OPENALEX_API_KEY, s2: process.env.SEMANTIC_SCHOLAR_API_KEY, ok: process.env.SEMANTIC_SCHOLAR_COMMERCIAL_USE };
  try {
    delete process.env.OPENALEX_API_KEY;
    delete process.env.SEMANTIC_SCHOLAR_API_KEY;
    delete process.env.SEMANTIC_SCHOLAR_COMMERCIAL_USE;
    expect((await citationEvidenceDeps()).sources).toEqual({ semanticScholar: false, openAlexKeyed: false });
    process.env.OPENALEX_API_KEY = "k";
    process.env.SEMANTIC_SCHOLAR_API_KEY = "k";
    process.env.SEMANTIC_SCHOLAR_COMMERCIAL_USE = "approved";
    expect((await citationEvidenceDeps()).sources).toEqual({ semanticScholar: true, openAlexKeyed: true });
  } finally {
    for (const [name, value] of [
      ["OPENALEX_API_KEY", before.oa],
      ["SEMANTIC_SCHOLAR_API_KEY", before.s2],
      ["SEMANTIC_SCHOLAR_COMMERCIAL_USE", before.ok],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

/* The key-redaction case through the cascade's real log lines: a forced 401 with a key set. */
it("never logs Semantic Scholar's key on a refused request (test 1, through the cascade)", async () => {
  const { fetchBibliographicJson } = await import("../src/fetch.js");
  const KEY = "s2-cascade-secret-0042";
  const before = { key: process.env.SEMANTIC_SCHOLAR_API_KEY, ok: process.env.SEMANTIC_SCHOLAR_COMMERCIAL_USE };
  process.env.SEMANTIC_SCHOLAR_API_KEY = KEY;
  process.env.SEMANTIC_SCHOLAR_COMMERCIAL_USE = "approved";
  try {
    const lines: unknown[] = [];
    const capture = {
      debug: (o: unknown) => lines.push(o),
      info: (o: unknown) => lines.push(o),
      warn: (o: unknown) => lines.push(o),
      error: (o: unknown) => lines.push(o),
      child: () => capture,
    } as unknown as Log;
    const x = deps({ lookups: NO_ABSTRACT, sources: S2_ONLY });
    x.d.log = capture;
    x.d.fetchJson = (url, registryKey) =>
      fetchBibliographicJson(url, {
        ...(registryKey !== undefined ? { registryKey } : {}),
        resolve: async () => ["104.18.0.1"],
        fetchImpl: async () => new Response("{}", { status: 401 }),
      });
    const out = await collectEvidence([COUPLING], { titleSearch: true }, x.d);
    expect(out.byEntry.get("c1")).toEqual({ state: "transient", why: "semantic-scholar-off" });
    expect(lines.length).toBeGreaterThan(0);
    expect(JSON.stringify(lines)).not.toContain(KEY);
  } finally {
    for (const [name, value] of [
      ["SEMANTIC_SCHOLAR_API_KEY", before.key],
      ["SEMANTIC_SCHOLAR_COMMERCIAL_USE", before.ok],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

/* Stage 1's code review, F1: even a cascade handed `semanticScholar: true` by
   mistake cannot reach Semantic Scholar with a key and no approval — the one
   door refuses it before any request. */
it("sends no Semantic Scholar request through the real door with a key but no approval, whatever the cascade was told", async () => {
  const { fetchBibliographicJson } = await import("../src/fetch.js");
  const before = { key: process.env.SEMANTIC_SCHOLAR_API_KEY, ok: process.env.SEMANTIC_SCHOLAR_COMMERCIAL_USE };
  process.env.SEMANTIC_SCHOLAR_API_KEY = "s2-unapproved-key";
  delete process.env.SEMANTIC_SCHOLAR_COMMERCIAL_USE;
  try {
    const x = deps({ lookups: NO_ABSTRACT, sources: S2_ONLY });
    const transport = vi.fn(async () => Response.json(S2_PAPER));
    x.d.fetchJson = (url, registryKey) =>
      isS2(url)
        ? fetchBibliographicJson(url, {
            ...(registryKey !== undefined ? { registryKey } : {}),
            resolve: async () => ["104.18.0.1"],
            fetchImpl: transport,
          })
        : Promise.resolve(OA_WORK);
    const out = await collectEvidence([COUPLING], { titleSearch: true }, x.d);
    expect(transport).not.toHaveBeenCalled();
    expect(out.byEntry.get("c1")).toMatchObject({ state: "evidence", evidence: { source: "openalex" } });
  } finally {
    for (const [name, value] of [
      ["SEMANTIC_SCHOLAR_API_KEY", before.key],
      ["SEMANTIC_SCHOLAR_COMMERCIAL_USE", before.ok],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
