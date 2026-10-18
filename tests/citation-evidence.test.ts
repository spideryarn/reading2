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
  type RowEvidence,
} from "../src/citation-evidence.js";
import { FetchFailure } from "../src/fetch.js";
import type { Log } from "../src/log.js";

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
}

function deps(f: Fakes = {}) {
  const asked: string[] = [];
  const fetched: string[] = [];
  const log = silentLog();
  const lim = limiter();
  const d: EvidenceDeps = {
    lookup: async (id) => {
      asked.push(id);
      return f.lookups?.[id] ?? { kind: "not-found" };
    },
    fetchJson: async (url) => {
      fetched.push(url);
      if (!f.json) throw new Error(`unexpected fetch ${url}`);
      return f.json(url);
    },
    limiter: lim,
    sleep: async () => {},
    now: f.now ?? (() => Date.parse("2026-10-18T10:00:00.000Z")),
    log,
    ...(f.budgetMs !== undefined ? { lookupBudgetMs: f.budgetMs } : {}),
  };
  return { d, asked, fetched, log, lim };
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

  it("is transient, and cools Crossref for everybody, on a 429", async () => {
    const { result, lim } = await one(TITLE_ROW, {
      json: (url) => {
        throw new FetchFailure("rate-limited", url, "HTTP 429", { status: 429, retryAfterMs: null });
      },
    });
    expect(result).toEqual({ state: "transient", why: "cooling-down" });
    expect(lim.cooled).toEqual(["crossref"]);
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

it("the real deps are the shared lookup and the guarded JSON fetch", async () => {
  const { citationEvidenceDeps } = await import("../src/citation-evidence.js");
  const { lookupWork } = await import("../src/bibliographic.js");
  const d = await citationEvidenceDeps();
  expect(d.lookup).toBe(lookupWork);
  await expect(d.fetchJson("https://example.com/works")).rejects.toMatchObject({ code: "blocked-address" });
  vi.restoreAllMocks();
});
