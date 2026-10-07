/**
 * **The bibliographic lookup, without a network or a database** — stage 1 of
 * docs/plans/261001a-citations-read-the-cited-paper-and-a-shared-bibliographic-lookup.md.
 *
 * Four things here, and each fails quietly when it goes, which is why they are
 * pinned: an identifier spelled two ways becomes two cache rows (and two
 * requests); a parser that misses `given` or an organisation's `name` hands the
 * callers a by-line that is wrong without being empty; a lookup that caches an
 * error or ignores a 429 is the abuse Greg ruled out; and a JSON caller that will
 * dial any host is a second door round `fetchBytes`'s guards.
 *
 * The answers in tests/fixtures/bibliographic/ are real ones, recorded once on
 * 2026-10-01 and trimmed to the fields the parsers read. The orchestration runs
 * against an in-memory store here; the Postgres store's own claim, slots and
 * spacing are tests/bibliographic-pg.test.ts.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  type BibliographicStore,
  type CachedAnswer,
  crossrefUrl,
  dataciteUrl,
  type Freshness,
  type IdentifierClaim,
  lookupWork,
  parseCrossref,
  parseDatacite,
  parseWorkId,
  plainRegistryText,
  type Registry,
  type SlotLease,
  type StartTaken,
  type WorkId,
} from "../src/bibliographic.js";
import {
  BIBLIOGRAPHIC_USER_AGENT,
  FetchFailure,
  fetchBibliographicJson,
  type FetchLike,
} from "../src/fetch.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/bibliographic/${name}`, import.meta.url), "utf8")) as unknown;

const CROSSREF = fixture("crossref-10.1038-nn.4304.json");
const DATACITE = fixture("datacite-10.48550-arxiv.1706.03762.json");

function id(input: string): WorkId {
  const parsed = parseWorkId(input);
  if (parsed === null) throw new Error(`not a work id: ${input}`);
  return parsed;
}

/* ------------------------------------------------------------ identifiers -- */

describe("parseWorkId", () => {
  it("spells a DOI one way however it arrives", () => {
    for (const input of [
      "10.1038/NN.4304",
      "doi:10.1038/nn.4304",
      "DOI: 10.1038/nn.4304",
      "https://doi.org/10.1038/nn.4304",
      "http://dx.doi.org/10.1038/NN.4304",
    ]) {
      expect(parseWorkId(input), input).toBe("doi:10.1038/nn.4304");
    }
  });

  it("spells an arXiv id one way, without its version, in both shapes", () => {
    for (const input of ["1706.03762", "arXiv:1706.03762v5", "https://arxiv.org/abs/1706.03762v7", "https://arxiv.org/pdf/1706.03762"]) {
      expect(parseWorkId(input), input).toBe("arxiv:1706.03762");
    }
    expect(parseWorkId("arxiv:hep-th/9901001v2")).toBe("arxiv:hep-th/9901001");
    expect(parseWorkId("https://arxiv.org/abs/math.GT/0309136")).toBe("arxiv:math.gt/0309136");
  });

  it("drops a landing-page suffix a publisher address left on the DOI", () => {
    /* The free probe's real rows (261001a): Crossref and DataCite both 404'd
       these, because `.full` is bioRxiv's / the publisher's page, not the DOI. */
    expect(parseWorkId("https://doi.org/10.1101/2020.06.26.174482.full")).toBe("doi:10.1101/2020.06.26.174482");
    expect(parseWorkId("https://doi.org/10.1636/JoA-S-17-093.1.full")).toBe("doi:10.1636/joa-s-17-093.1");
    for (const input of [
      "10.1101/2020.06.26.174482v2.full.pdf",
      "10.1101/2020.06.26.174482v1",
      "https://doi.org/10.1101/2020.06.26.174482.full-text",
      "doi:10.1101/2020.06.26.174482.abstract",
      "10.1101/2020.06.26.174482.short",
      "10.1101/2020.06.26.174482.pdf",
    ]) {
      expect(parseWorkId(input), input).toBe("doi:10.1101/2020.06.26.174482");
    }
    /* Conservative: only those whole suffixes, and the version only on bioRxiv's prefix. */
    expect(parseWorkId("10.1000/report.fuller")).toBe("doi:10.1000/report.fuller");
    /* DOI suffixes are opaque. These may be the registered DOI itself unless a
       known publisher path shape proves otherwise. */
    expect(parseWorkId("10.1000/report.pdf")).toBe("doi:10.1000/report.pdf");
    expect(parseWorkId("10.1000/report.full")).toBe("doi:10.1000/report.full");
    expect(parseWorkId("10.1000/report.abstract")).toBe("doi:10.1000/report.abstract");
    expect(parseWorkId("10.1000/abc-v2")).toBe("doi:10.1000/abc-v2");
    expect(parseWorkId("10.1000/x.v2")).toBe("doi:10.1000/x.v2");
    expect(parseWorkId("10.1000/.full")).toBe("doi:10.1000/.full");
  });

  it("refuses what is not an identifier", () => {
    for (const input of [
      "",
      "attention is all you need",
      "10.1038",
      "doi:",
      "doi:nn.4304",
      "arxiv:17060.3762",
      "https://example.com/10.1038/nn.4304",
      "https://doi.org/not-a-doi",
      "10.1038/café",
      `10.1038/${"x".repeat(400)}`,
    ]) {
      expect(parseWorkId(input), input).toBeNull();
    }
  });
});

/* -------------------------------------------------------------- parsing -- */

describe("parseCrossref", () => {
  it("reads the recorded answer", () => {
    const record = parseCrossref(id("10.1038/nn.4304"), "10.1038/nn.4304", CROSSREF);
    expect(record).toEqual({
      id: "doi:10.1038/nn.4304",
      source: "crossref",
      title: "Hippocampo-cortical coupling mediates memory consolidation during sleep",
      authors: [
        { family: "Maingret", given: "Nicolas" },
        { family: "Girardeau", given: "Gabrielle" },
        { family: "Todorova", given: "Ralitsa" },
        { family: "Goutierre", given: "Marie" },
        { family: "Zugaro", given: "Michaël" },
      ],
      year: 2016,
      venue: "Nature Neuroscience",
      published: "2016-05-16",
      doi: "10.1038/nn.4304",
    });
  });

  it("keeps the earliest whole day any date field states, and none from a year or a month alone", () => {
    const day = (message: Record<string, unknown>) =>
      parseCrossref(id("10.1000/x"), "10.1000/x", { message: { title: ["A title"], ...message } })?.published;
    expect(
      day({
        issued: { "date-parts": [[2024]] },
        "published-print": { "date-parts": [[2024, 6, 20]] },
        "published-online": { "date-parts": [[2024, 5, 31]] },
      }),
    ).toBe("2024-05-31");
    expect(day({ issued: { "date-parts": [[2024, 5]] }, published: { "date-parts": [[2024]] } })).toBeUndefined();
    expect(day({ issued: { "date-parts": [[2024, 2, 31]] } })).toBeUndefined();
    expect(day({ issued: { "date-parts": [[null]] } })).toBeUndefined();
    expect(day({ issued: { "date-parts": [["2024", "5", "31"]] } })).toBeUndefined();
  });

  it("takes an organisation's name as its family, strips markup, and finds the year where it is", () => {
    const record = parseCrossref(id("10.1000/x"), "10.1000/x", {
      message: {
        title: ["  Growth of <i>E.&#160;coli</i>\n in   &amp; out  "],
        author: [{ name: "The ATLAS Collaboration" }, { given: "Ada", family: "Lovelace" }, { given: "Nobody" }],
        issued: { "date-parts": [[null]] },
        "published-print": { "date-parts": [[1999, 3]] },
      },
    });
    /* The no-break space is whitespace too, and collapses with the rest. */
    expect(record?.title).toBe("Growth of E. coli in & out");
    expect(record?.authors).toEqual([{ family: "The ATLAS Collaboration" }, { family: "Lovelace", given: "Ada" }]);
    expect(record?.year).toBe(1999);
    expect(record?.venue).toBeUndefined();
    expect(record?.doi).toBe("10.1000/x");
  });

  it("falls back to published-online, then published", () => {
    const at = (key: string) =>
      parseCrossref(id("10.1000/x"), "10.1000/x", { message: { title: ["T"], [key]: { "date-parts": [[2001]] } } })?.year;
    expect(at("published-online")).toBe(2001);
    expect(at("published")).toBe(2001);
  });

  it("gives nothing for an answer with no title, or not shaped like one", () => {
    expect(parseCrossref(id("10.1000/x"), "10.1000/x", { message: { title: [] } })).toBeNull();
    expect(parseCrossref(id("10.1000/x"), "10.1000/x", { message: { title: ["<i> </i>"] } })).toBeNull();
    expect(parseCrossref(id("10.1000/x"), "10.1000/x", [])).toBeNull();
    expect(parseCrossref(id("10.1000/x"), "10.1000/x", null)).toBeNull();
  });

  it("keeps the citation count only when it is a whole number Postgres can hold, and keeps the record either way", () => {
    /* Plan 261005i. `is-referenced-by-count` is Crossref's own count of the
       works citing this one. A count that is not one is no count: the title
       and the rest of the record are still an answer (GPT Sol's F3). */
    const counted = (count: unknown) =>
      parseCrossref(id("10.1000/x"), "10.1000/x", {
        message: { title: ["Dreams and memory consolidation"], "is-referenced-by-count": count },
      });
    expect(counted(357)).toMatchObject({ title: "Dreams and memory consolidation", citedByCount: 357 });
    expect(counted(0)).toMatchObject({ citedByCount: 0 });
    expect(counted(2_147_483_647)).toMatchObject({ citedByCount: 2_147_483_647 });
    for (const bad of [undefined, null, -1, 3.5, "357", Number.NaN, 2_147_483_648, Number.MAX_SAFE_INTEGER, [357]]) {
      const record = counted(bad);
      expect(record, String(bad)).toMatchObject({ title: "Dreams and memory consolidation" });
      expect(record, String(bad)).not.toHaveProperty("citedByCount");
    }
    /* The recorded answer was trimmed before the count mattered: no field, no count. */
    expect(parseCrossref(id("10.1038/nn.4304"), "10.1038/nn.4304", CROSSREF)).not.toHaveProperty("citedByCount");
  });

  it("never says when the count was read: that is the store's clock, not the parser's", () => {
    const record = parseCrossref(id("10.1000/x"), "10.1000/x", {
      message: { title: ["Dreams and memory consolidation"], "is-referenced-by-count": 4 },
    });
    expect(record).toMatchObject({ citedByCount: 4 });
    expect(record).not.toHaveProperty("citedByCountReadAt");
  });
});

describe("parseDatacite and the citation count", () => {
  it("keeps none, whatever DataCite sends: its counts are too thin to show (plan 261005i § Passed over)", () => {
    const record = parseDatacite(id("10.5281/zenodo.123"), "10.5281/zenodo.123", {
      data: { attributes: { titles: [{ title: "A dataset" }], creators: [], citationCount: 12, "is-referenced-by-count": 12 } },
    });
    expect(record).toMatchObject({ source: "datacite", title: "A dataset" });
    expect(record).not.toHaveProperty("citedByCount");
  });
});

describe("parseDatacite", () => {
  it("reads the recorded answer", () => {
    const record = parseDatacite(id("arxiv:1706.03762"), "10.48550/arxiv.1706.03762", DATACITE);
    expect(record).toMatchObject({
      id: "arxiv:1706.03762",
      source: "datacite",
      title: "Attention Is All You Need",
      year: 2017,
      venue: "arXiv",
      doi: "10.48550/arxiv.1706.03762",
    });
    expect(record?.authors).toHaveLength(8);
    expect(record?.authors[0]).toEqual({ family: "Vaswani", given: "Ashish" });
    expect(record?.authors[5]).toEqual({ family: "Gomez", given: "Aidan N." });
  });

  it("splits a Personal name at its comma, keeps an organisation whole, and prefers the main title", () => {
    const record = parseDatacite(id("10.5281/zenodo.1"), "10.5281/zenodo.1", {
      data: {
        attributes: {
          titles: [{ title: "A subtitle", titleType: "Subtitle" }, { title: "The dataset" }],
          creators: [
            { name: "Curie, Marie", nameType: "Personal" },
            { name: "CERN, Geneva", nameType: "Organizational" },
            { name: "Someone" },
          ],
          publicationYear: "2020",
          publisher: { name: "Zenodo" },
          container: { title: "A <b>series</b>" },
        },
      },
    });
    expect(record?.title).toBe("The dataset");
    expect(record?.authors).toEqual([
      { family: "Curie", given: "Marie" },
      { family: "CERN, Geneva" },
      { family: "Someone" },
    ]);
    expect(record?.year).toBe(2020);
    expect(record?.venue).toBe("A series");
    expect(record?.doi).toBe("10.5281/zenodo.1");
  });

  it("uses the publisher when there is no container, and refuses a year out of range", () => {
    const record = parseDatacite(id("10.5281/zenodo.2"), "10.5281/zenodo.2", {
      data: { attributes: { titles: [{ title: "T" }], publisher: { name: "Zenodo" }, publicationYear: 20201 } },
    });
    expect(record?.venue).toBe("Zenodo");
    expect(record?.year).toBeUndefined();
    expect(parseDatacite(id("10.5281/zenodo.2"), "10.5281/zenodo.2", { data: { attributes: { titles: [] } } })).toBeNull();
  });
});

describe("plainRegistryText", () => {
  it("caps what it keeps", () => {
    expect(plainRegistryText("x".repeat(1500))).toHaveLength(1000);
    expect(plainRegistryText(42)).toBeNull();
  });
});

/* --------------------------------------------------------- the lookup -- */

/**
 * An in-memory store with the Postgres store's rules, minus the concurrency the
 * Postgres tests are for: answers expire, claims lapse, a cooldown refuses.
 */
class MemoryStore implements BibliographicStore {
  rows = new Map<string, { answer: CachedAnswer | null; at: number; claimedUntil: number | null }>();
  cooling = new Map<Registry, number>();
  writes: string[] = [];

  private fresh(row: { answer: CachedAnswer | null; at: number }, f: Freshness): boolean {
    if (row.answer === null) return false;
    /* A Crossref record nobody has asked for its count is not an answer yet (plan 261005i). */
    if (
      row.answer.kind === "found" &&
      row.answer.record.source === "crossref" &&
      row.answer.record.citedByCountReadAt === undefined
    ) {
      return false;
    }
    return Date.now() - row.at < (row.answer.kind === "found" ? f.foundMs : f.notFoundMs);
  }

  async read(id: WorkId, f: Freshness) {
    const row = this.rows.get(id);
    if (!row) return { answer: null, claimed: false };
    return {
      answer: this.fresh(row, f) ? row.answer : null,
      claimed: row.claimedUntil !== null && row.claimedUntil > Date.now(),
    };
  }
  async claim(id: WorkId, f: Freshness, leaseMs: number): Promise<IdentifierClaim | null> {
    const row = this.rows.get(id);
    if (row && ((row.claimedUntil !== null && row.claimedUntil > Date.now()) || this.fresh(row, f))) return null;
    const until = Date.now() + leaseMs;
    this.rows.set(id, { answer: row?.answer ?? null, at: row?.at ?? 0, claimedUntil: until });
    return { id, until: new Date(until) };
  }
  async release(claim: IdentifierClaim) {
    const row = this.rows.get(claim.id);
    if (!row || row.claimedUntil !== claim.until.getTime()) return;
    if (row.answer === null) this.rows.delete(claim.id);
    else row.claimedUntil = null;
  }
  async write(claim: IdentifierClaim, answer: CachedAnswer): Promise<Date | null> {
    const row = this.rows.get(claim.id);
    if (!row || row.claimedUntil !== claim.until.getTime()) return null;
    this.writes.push(`${claim.id}:${answer.kind}`);
    const at = Date.now();
    /* Written out rather than through the production helper, so the two can disagree. */
    const kept: CachedAnswer =
      answer.kind === "found" && answer.record.source === "crossref"
        ? { kind: "found", record: { ...answer.record, citedByCountReadAt: new Date(at).toISOString() } }
        : answer;
    this.rows.set(claim.id, { answer: kept, at, claimedUntil: null });
    return new Date(at);
  }
  async coolingDown(service: Registry) {
    return (this.cooling.get(service) ?? 0) > Date.now();
  }
  async takeSlot(service: Registry, leaseMs: number): Promise<SlotLease> {
    return { service, slot: 1, until: new Date(Date.now() + leaseMs) };
  }
  async freeSlot() {}
  async takeStart(service: Registry): Promise<StartTaken> {
    return (await this.coolingDown(service)) ? { kind: "cooling-down" } : { kind: "start", waitMs: 0 };
  }
  async coolDown(service: Registry, forMs: number) {
    this.cooling.set(service, Math.max(this.cooling.get(service) ?? 0, Date.now() + forMs));
  }
}

function failure(status: number, retryAfterMs: number | null = null): FetchFailure {
  const code = status === 404 ? "not-found" : status === 429 ? "rate-limited" : "server-error";
  return new FetchFailure(code, "https://api.example/", `HTTP ${status}`, { status, retryAfterMs });
}

/** A scripted registry: each URL answers from the map, and every URL asked is recorded. */
function registry(answers: Record<string, unknown | FetchFailure>) {
  const asked: string[] = [];
  const fetchJson = vi.fn(async (url: string) => {
    asked.push(url);
    if (!(url in answers)) throw new Error(`unexpected request: ${url}`);
    const answer = answers[url];
    if (answer instanceof FetchFailure) throw answer;
    return answer;
  });
  return { asked, fetchJson };
}

const noSleep = async () => {};

describe("lookupWork", () => {
  const nn = id("10.1038/nn.4304");

  it("asks Crossref for a DOI, remembers the answer, and does not ask again", async () => {
    const store = new MemoryStore();
    const { asked, fetchJson } = registry({ [crossrefUrl("10.1038/nn.4304")]: CROSSREF });
    const first = await lookupWork(nn, { store, fetchJson, sleep: noSleep });
    expect(first).toMatchObject({ kind: "found", record: { source: "crossref", year: 2016 } });
    /* A hit is answered from the read alone. The claim would also refuse over a
       fresh answer, so "no request" by itself cannot tell a hit from a miss that
       the claim rescued — hence the spy. */
    const claim = vi.spyOn(store, "claim");
    const second = await lookupWork(nn, { store, fetchJson, sleep: noSleep });
    expect(second).toEqual(first);
    expect(asked).toEqual([crossrefUrl("10.1038/nn.4304")]);
    expect(claim).not.toHaveBeenCalled();
  });

  it("asks DataCite for an arXiv id, under arXiv's own DOI", async () => {
    const store = new MemoryStore();
    const { asked, fetchJson } = registry({ [dataciteUrl("10.48550/arxiv.1706.03762")]: DATACITE });
    const result = await lookupWork(id("arXiv:1706.03762v5"), { store, fetchJson, sleep: noSleep });
    expect(result).toMatchObject({ kind: "found", record: { source: "datacite", title: "Attention Is All You Need" } });
    expect(asked).toEqual(["https://api.datacite.org/dois/10.48550/arxiv.1706.03762"]);
  });

  it("goes to DataCite when Crossref says 404", async () => {
    const store = new MemoryStore();
    const doi = "10.5281/zenodo.123";
    const { asked, fetchJson } = registry({
      [crossrefUrl(doi)]: failure(404),
      [dataciteUrl(doi)]: { data: { attributes: { titles: [{ title: "A dataset" }], creators: [], doi } } },
    });
    const result = await lookupWork(id(doi), { store, fetchJson, sleep: noSleep });
    expect(result).toMatchObject({ kind: "found", record: { source: "datacite", title: "A dataset" } });
    expect(asked).toEqual([crossrefUrl(doi), dataciteUrl(doi)]);
  });

  it("remembers a work neither registry has", async () => {
    const store = new MemoryStore();
    const doi = "10.9999/nowhere";
    const { asked, fetchJson } = registry({ [crossrefUrl(doi)]: failure(404), [dataciteUrl(doi)]: failure(404) });
    expect(await lookupWork(id(doi), { store, fetchJson, sleep: noSleep })).toEqual({ kind: "not-found" });
    expect(await lookupWork(id(doi), { store, fetchJson, sleep: noSleep })).toEqual({ kind: "not-found" });
    expect(asked).toHaveLength(2);
    expect(store.writes).toEqual([`doi:${doi}:not-found`]);
  });

  it("does not remember an error: the next caller asks again", async () => {
    const store = new MemoryStore();
    const { asked, fetchJson } = registry({ [crossrefUrl("10.1038/nn.4304")]: failure(500) });
    expect(await lookupWork(nn, { store, fetchJson, sleep: noSleep })).toEqual({ kind: "unavailable", why: "error" });
    expect(await lookupWork(nn, { store, fetchJson, sleep: noSleep })).toEqual({ kind: "unavailable", why: "error" });
    expect(asked).toHaveLength(2);
    expect(store.writes).toEqual([]);
    expect(store.rows.has(nn)).toBe(false);
  });

  it("stops asking a service that said 429, for every identifier, and honours Retry-After", async () => {
    const store = new MemoryStore();
    const { asked, fetchJson } = registry({ [crossrefUrl("10.1038/nn.4304")]: failure(429, 120_000) });
    expect(await lookupWork(nn, { store, fetchJson, sleep: noSleep })).toEqual({
      kind: "unavailable",
      why: "cooling-down",
    });
    const cooledFor = (store.cooling.get("crossref") ?? 0) - Date.now();
    expect(cooledFor).toBeGreaterThan(110_000);
    expect(cooledFor).toBeLessThanOrEqual(120_000);
    /* A different DOI: the cooldown is the service's, not the identifier's. */
    expect(await lookupWork(id("10.1000/other"), { store, fetchJson, sleep: noSleep })).toEqual({
      kind: "unavailable",
      why: "cooling-down",
    });
    expect(asked).toEqual([crossrefUrl("10.1038/nn.4304")]);
    expect(store.writes).toEqual([]);
  });

  it("cools a service the default 60 seconds, not one, on a 429 that said `Retry-After: 0`", async () => {
    /* The whole road, from the header to the cooldown: the real fetch reads the
       header and the real lookup decides the cooldown. `0` is "no usable
       instruction" (src/retry-after.ts), so the default applies. Until
       2026-10-04 it arrived here as a wait of 0 and was floored to one second,
       which is asking a registry that has just refused us again almost at
       once. */
    const store = new MemoryStore();
    const fetchImpl = vi.fn<FetchLike>(
      async () => new Response("{}", { status: 429, headers: { "retry-after": "0" } }),
    );
    const resolve = async () => ["104.18.0.1"];
    const fetchJson = (url: string) => fetchBibliographicJson(url, { fetchImpl, resolve });
    expect(await lookupWork(nn, { store, fetchJson, sleep: noSleep })).toEqual({
      kind: "unavailable",
      why: "cooling-down",
    });
    const cooledFor = (store.cooling.get("crossref") ?? 0) - Date.now();
    expect(cooledFor).toBeGreaterThan(55_000);
    expect(cooledFor).toBeLessThanOrEqual(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("cools a service 60 seconds on a 503 that gave no Retry-After", async () => {
    const store = new MemoryStore();
    const { fetchJson } = registry({ [crossrefUrl("10.1038/nn.4304")]: failure(503) });
    await lookupWork(nn, { store, fetchJson, sleep: noSleep });
    const cooledFor = (store.cooling.get("crossref") ?? 0) - Date.now();
    expect(cooledFor).toBeGreaterThan(55_000);
    expect(cooledFor).toBeLessThanOrEqual(60_000);
  });

  it("does not start a reserved request when another request set a cooldown while it waited", async () => {
    const store = new MemoryStore();
    let checks = 0;
    store.coolingDown = async () => ++checks > 1;
    store.takeStart = async () => ({ kind: "start", waitMs: 250 });
    const fetchJson = vi.fn(async () => CROSSREF);

    expect(await lookupWork(nn, { store, fetchJson, sleep: noSleep })).toEqual({
      kind: "unavailable",
      why: "cooling-down",
    });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  describe("Crossref's citation count (plan 261005i)", () => {
    const doi = "10.1000/counted";
    const counted = (count?: number) => ({
      message: {
        DOI: doi,
        title: ["Dreams and memory consolidation"],
        ...(count === undefined ? {} : { "is-referenced-by-count": count }),
      },
    });
    const DATASET = { data: { attributes: { titles: [{ title: "A dataset" }], creators: [], doi } } };

    it("says when the count was read, from the store's clock, on the answer just fetched and on the cached one", async () => {
      vi.useFakeTimers({ now: new Date("2026-10-04T12:00:00.000Z") });
      try {
        const store = new MemoryStore();
        const { asked, fetchJson } = registry({ [crossrefUrl(doi)]: counted(357) });
        const first = await lookupWork(id(doi), { store, fetchJson, sleep: noSleep });
        expect(first).toMatchObject({
          kind: "found",
          record: { source: "crossref", citedByCount: 357, citedByCountReadAt: "2026-10-04T12:00:00.000Z" },
        });
        vi.setSystemTime(new Date("2026-11-01T09:00:00.000Z"));
        /* A month on it is still the day it was read, not the day it was served. */
        expect(await lookupWork(id(doi), { store, fetchJson, sleep: noSleep })).toEqual(first);
        expect(asked).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("says it asked even when Crossref gave no count, so it does not ask again", async () => {
      const store = new MemoryStore();
      const { asked, fetchJson } = registry({ [crossrefUrl(doi)]: counted() });
      const first = await lookupWork(id(doi), { store, fetchJson, sleep: noSleep });
      expect(first).toMatchObject({ kind: "found", record: { citedByCountReadAt: expect.any(String) as string } });
      expect((first as { record: object }).record).not.toHaveProperty("citedByCount");
      expect(await lookupWork(id(doi), { store, fetchJson, sleep: noSleep })).toEqual(first);
      expect(asked).toHaveLength(1);
    });

    it("gives a DataCite record and a miss no read moment, and still knows each was stored", async () => {
      /* GPT Sol's F1: `write` answers "stored" with a moment for every answer,
         so a DataCite record or a miss is not mistaken for a lost claim. */
      const store = new MemoryStore();
      const { fetchJson } = registry({
        [crossrefUrl(doi)]: failure(404),
        [dataciteUrl(doi)]: DATASET,
        [crossrefUrl("10.9999/nowhere")]: failure(404),
        [dataciteUrl("10.9999/nowhere")]: failure(404),
      });
      const dataset = await lookupWork(id(doi), { store, fetchJson, sleep: noSleep });
      expect(dataset).toMatchObject({ kind: "found", record: { source: "datacite" } });
      expect((dataset as { record: object }).record).not.toHaveProperty("citedByCountReadAt");
      expect(await lookupWork(id("10.9999/nowhere"), { store, fetchJson, sleep: noSleep })).toEqual({ kind: "not-found" });
      expect(store.writes).toEqual([`doi:${doi}:found`, "doi:10.9999/nowhere:not-found"]);
    });

    it("falls back to the other caller's answer when its own write lost the claim", async () => {
      const store = new MemoryStore();
      const { fetchJson } = registry({ [crossrefUrl(doi)]: counted(9) });
      const write = vi.spyOn(store, "write").mockResolvedValue(null);
      expect(await lookupWork(id(doi), { store, fetchJson, sleep: noSleep })).toEqual({
        kind: "unavailable",
        why: "in-flight",
      });
      expect(write).toHaveBeenCalledTimes(1);
    });

    /** A record cached by the code before this feature: fresh by its age, and nobody asked for its count. */
    function preFeature(store: MemoryStore) {
      const old = parseCrossref(id(doi), doi, counted())!;
      store.rows.set(id(doi), { answer: { kind: "found", record: old }, at: Date.now(), claimedUntil: null });
    }

    it("asks once more about a record cached before the count was kept, and then not again", async () => {
      const store = new MemoryStore();
      preFeature(store);
      const { asked, fetchJson } = registry({ [crossrefUrl(doi)]: counted(12) });
      expect(await lookupWork(id(doi), { store, fetchJson, sleep: noSleep })).toMatchObject({
        kind: "found",
        record: { citedByCount: 12 },
      });
      await lookupWork(id(doi), { store, fetchJson, sleep: noSleep });
      expect(asked).toHaveLength(1);
    });

    it("keeps such a record eligible after a failed refresh: once means one refresh that worked (GPT Sol's F4)", async () => {
      const store = new MemoryStore();
      preFeature(store);
      const down = registry({ [crossrefUrl(doi)]: failure(500) });
      for (let i = 0; i < 2; i++) {
        expect(await lookupWork(id(doi), { store, fetchJson: down.fetchJson, sleep: noSleep })).toEqual({
          kind: "unavailable",
          why: "error",
        });
      }
      expect(down.asked).toHaveLength(2);
      /* The old answer is still there underneath; only the claim went. */
      expect(store.rows.get(id(doi))?.answer).toMatchObject({ kind: "found" });
      const up = registry({ [crossrefUrl(doi)]: counted(3) });
      expect(await lookupWork(id(doi), { store, fetchJson: up.fetchJson, sleep: noSleep })).toMatchObject({
        record: { citedByCount: 3 },
      });
      await lookupWork(id(doi), { store, fetchJson: up.fetchJson, sleep: noSleep });
      expect(up.asked).toHaveLength(1);
    });

    it("lets the refresh replace a Crossref record with DataCite's, or with a miss, and neither is asked again", async () => {
      for (const [datacite, expected] of [
        [DATASET, { kind: "found", record: { source: "datacite" } }],
        [failure(404), { kind: "not-found" }],
      ] as const) {
        const store = new MemoryStore();
        preFeature(store);
        const { asked, fetchJson } = registry({ [crossrefUrl(doi)]: failure(404), [dataciteUrl(doi)]: datacite });
        const result = await lookupWork(id(doi), { store, fetchJson, sleep: noSleep });
        expect(result).toMatchObject(expected);
        if (result.kind === "found") {
          expect(result.record).not.toHaveProperty("citedByCount");
          expect(result.record).not.toHaveProperty("citedByCountReadAt");
        }
        expect(await lookupWork(id(doi), { store, fetchJson, sleep: noSleep })).toEqual(result);
        expect(asked).toHaveLength(2);
      }
    });
  });

  it("refuses a malformed identifier before any request or any read", async () => {
    const store = new MemoryStore();
    const read = vi.spyOn(store, "read");
    const { fetchJson } = registry({});
    for (const bad of ["attention is all you need", "doi:10.1038/NN.4304", "10.1038/nn.4304"]) {
      await expect(lookupWork(bad as WorkId, { store, fetchJson, sleep: noSleep })).rejects.toThrow(TypeError);
    }
    expect(fetchJson).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------ the JSON fetch caller -- */

describe("fetchBibliographicJson", () => {
  const resolve = vi.fn(async () => ["104.18.0.1"]);

  it("refuses any host but the two registries and OpenAlex, before a lookup or a request", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    for (const url of [
      "https://example.com/works/10.1000/x",
      "http://api.crossref.org/works/10.1000/x",
      "https://api.crossref.org:8443/works/10.1000/x",
      "https://user@api.crossref.org/works/10.1000/x",
      "https://api.crossref.org.evil.example/works/10.1000/x",
      "https://api.semanticscholar.org/graph/v1/paper/DOI:10.1000/x",
    ]) {
      await expect(fetchBibliographicJson(url, { fetchImpl, resolve }), url).rejects.toMatchObject({
        code: "blocked-address",
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("keeps the address guard and DNS pin on an allowlisted registry host", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const privateResolve = vi.fn(async () => ["127.0.0.1"]);
    await expect(
      fetchBibliographicJson(crossrefUrl("10.1000/x"), { fetchImpl, resolve: privateResolve }),
    ).rejects.toMatchObject({ code: "blocked-address" });
    expect(privateResolve).toHaveBeenCalledWith("api.crossref.org");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("asks once, as Spideryarn, for JSON, and parses it", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => Response.json({ status: "ok" }));
    const got = await fetchBibliographicJson(crossrefUrl("10.1038/nn.4304"), { fetchImpl, resolve });
    expect(got).toEqual({ status: "ok" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.crossref.org/works/10.1038/nn.4304?mailto=hello%40spideryarn.com");
    const headers = init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe("Spideryarn/1.0 (https://spideryarn.com; mailto:hello@spideryarn.com)");
    expect(headers["User-Agent"]).toBe(BIBLIOGRAPHIC_USER_AGENT);
    expect(headers.Accept).toBe("application/json, application/vnd.api+json");
  });

  it("surfaces 404, 429 with its Retry-After, and 503 as statuses, without retrying", async () => {
    for (const [status, retryAfter, expected] of [
      [404, null, null],
      [429, "30", 30_000],
      [503, null, null],
    ] as const) {
      const fetchImpl = vi.fn<FetchLike>(
        async () =>
          new Response("{}", { status, headers: retryAfter === null ? {} : { "retry-after": retryAfter } }),
      );
      const err = await fetchBibliographicJson(dataciteUrl("10.1000/x"), { fetchImpl, resolve }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(FetchFailure);
      expect((err as FetchFailure).status).toBe(status);
      expect((err as FetchFailure).retryAfterMs).toBe(expected);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("follows no redirect and refuses a body that is not JSON", async () => {
    const redirect = vi.fn<FetchLike>(
      async () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } }),
    );
    await expect(
      fetchBibliographicJson(dataciteUrl("10.1000/x"), { fetchImpl: redirect, resolve }),
    ).rejects.toMatchObject({ code: "too-many-redirects" });
    expect(redirect).toHaveBeenCalledTimes(1);

    const html = vi.fn<FetchLike>(async () => new Response("<html>nope</html>", { status: 200 }));
    await expect(fetchBibliographicJson(dataciteUrl("10.1000/x"), { fetchImpl: html, resolve })).rejects.toMatchObject({
      code: "unsupported-type",
    });

    const disguised = vi.fn<FetchLike>(async () =>
      Response.json({ looks: "json" }, { headers: { "content-type": "text/html" } }),
    );
    await expect(
      fetchBibliographicJson(dataciteUrl("10.1000/x"), { fetchImpl: disguised, resolve }),
    ).rejects.toMatchObject({ code: "unsupported-type" });
  });

  it("refuses an answer over a megabyte", async () => {
    const big = vi.fn<FetchLike>(async () => new Response(`"${"x".repeat(1024 * 1024 + 10)}"`, { status: 200 }));
    await expect(fetchBibliographicJson(dataciteUrl("10.1000/x"), { fetchImpl: big, resolve })).rejects.toMatchObject({
      code: "too-large",
    });
  });
});
