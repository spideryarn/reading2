/**
 * **Who cites this article, from OpenAlex** — src/citation-index.ts, with no
 * network and no database: every case hands `citersOf` a scripted `fetchJson`,
 * an in-memory cache and an in-memory limiter.
 * docs/plans/261004h-reception-lists-the-papers-that-cite-the-piece-from-openalex.md.
 *
 * The answers are OpenAlex's own, recorded on 2026-10-04 for Levin 2024
 * (Entropy, `10.3390/e26060481`) and trimmed to the fields we ask for:
 * tests/fixtures/openalex/.
 *
 * What is worth holding here is mostly what must *not* happen: a list handed to
 * an article the DOI does not belong to (on a fresh request, off the cache and
 * off a stale row alike), a count stored without its list, a link taken from
 * the response, and a short list explained by the wrong reason.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import type { LimiterService, ServiceLimiter, SlotLease, StartTaken, WorkId } from "../src/bibliographic.js";
import {
  CITERS_FRESH_MS,
  type CitationIndexStore,
  type FetchedCiters,
  type StoredCiters,
  citersOf,
  openAlexAuthors,
  openAlexCitersUrl,
  openAlexWorkUrl,
  parseOpenAlexCiters,
  parseOpenAlexWork,
} from "../src/citation-index.js";
import { citerUrl } from "../src/citer-link.js";
import { FetchFailure, fetchBibliographicJson, type FetchLike } from "../src/fetch.js";
import { CONTACT_EMAIL } from "../src/site-text.js";
import { citersLines } from "../src/messages.js";
import { providerHostOf } from "./setup/provider-guard.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/openalex/${name}`, import.meta.url), "utf8")) as unknown;

const WORK = fixture("work-e26060481.json") as Record<string, unknown>;
const CITERS = fixture("citers-e26060481.json") as { meta: { count: number }; results: Record<string, unknown>[] };

const DOI = "10.3390/e26060481";
const ID = `doi:${DOI}` as WorkId;
const TITLE = "Self-Improvising Memory: A Perspective on Memories as Agential, Dynamically Reinterpreting Cognitive Glue";
const LEVIN = { title: TITLE, byline: "Michael Levin", doi: DOI };

const WORK_URL = openAlexWorkUrl(DOI);
const CITERS_URL = openAlexCitersUrl("W4399223951", 100);
const CITERS_URL_SMALL = openAlexCitersUrl("W4399223951", 25);

/* ------------------------------------------------------------ the doubles -- */

class MemoryCache implements CitationIndexStore {
  rows = new Map<string, { answer: FetchedCiters; at: number }>();
  writes: string[] = [];
  async read(id: WorkId, freshMs: number): Promise<StoredCiters | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    return { ...row.answer, fetchedAt: new Date(row.at).toISOString(), fresh: Date.now() - row.at < freshMs };
  }
  async write(id: WorkId, answer: FetchedCiters): Promise<string> {
    this.writes.push(`${id}:${answer.kind}`);
    const at = Date.now();
    this.rows.set(id, { answer, at });
    return new Date(at).toISOString();
  }
  /** Make the row older than the freshness window. */
  age(id: WorkId): void {
    const row = this.rows.get(id);
    if (row) row.at -= CITERS_FRESH_MS + 1_000;
  }
}

class MemoryLimiter implements ServiceLimiter {
  cooling = new Map<LimiterService, number>();
  turns: LimiterService[] = [];
  async coolingDown(service: LimiterService) {
    return (this.cooling.get(service) ?? 0) > Date.now();
  }
  async takeSlot(service: LimiterService, leaseMs: number): Promise<SlotLease> {
    return { service, slot: 1, until: new Date(Date.now() + leaseMs) };
  }
  async freeSlot() {}
  async takeStart(service: LimiterService): Promise<StartTaken> {
    this.turns.push(service);
    return (await this.coolingDown(service)) ? { kind: "cooling-down" } : { kind: "start", waitMs: 0 };
  }
  async coolDown(service: LimiterService, forMs: number) {
    this.cooling.set(service, Date.now() + forMs);
  }
}

function failure(status: number | null, code: ConstructorParameters<typeof FetchFailure>[0] = "server-error"): FetchFailure {
  return new FetchFailure(code, "https://api.openalex.org/", `HTTP ${status}`, { status });
}

/** A scripted OpenAlex: each address answers from the map, and every address asked is recorded. */
function openAlex(answers: Record<string, unknown | FetchFailure>) {
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

function harness(answers: Record<string, unknown | FetchFailure>) {
  const store = new MemoryCache();
  const limiter = new MemoryLimiter();
  const api = openAlex(answers);
  const deps = { store, limiter, fetchJson: api.fetchJson, sleep: async () => {} };
  return { store, limiter, api, deps };
}

const HAPPY = { [WORK_URL]: WORK, [CITERS_URL]: CITERS };

/** `n` distinct, well-formed citing works. */
function works(n: number, over: (i: number) => Record<string, unknown> = () => ({})): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `https://openalex.org/W${1000 + i}`,
    doi: `https://doi.org/10.1000/citer.${i}`,
    display_name: `A citing paper, number ${i}`,
    publication_year: 2025,
    cited_by_count: n - i,
    type: "article",
    authorships: [{ author: { display_name: "Ada Lovelace" } }],
    primary_location: { source: { display_name: "A Journal" } },
    ...over(i),
  }));
}

/* ------------------------------------------------------------ the parsers -- */

describe("parseOpenAlexWork", () => {
  it("reads the id, the title and the authors' names off the recorded answer", () => {
    expect(parseOpenAlexWork(WORK)).toEqual({ openalexId: "W4399223951", title: TITLE, authors: ["Michael G. Levin"] });
  });

  it("refuses a record whose id is not a W id", () => {
    expect(parseOpenAlexWork({ ...WORK, id: "https://openalex.org/A5085228887" })).toBeNull();
    expect(parseOpenAlexWork({ ...WORK, id: "https://evil.example/W1" })).toBeNull();
    expect(parseOpenAlexWork({ ...WORK, id: 7 })).toBeNull();
    expect(parseOpenAlexWork("nope")).toBeNull();
  });

  it("keeps a record with no title, as one that cannot be confirmed", () => {
    expect(parseOpenAlexWork({ ...WORK, title: null })?.title).toBeNull();
  });
});

describe("parseOpenAlexCiters", () => {
  it("gives the recorded 39 citers, in OpenAlex's order, with its own count", () => {
    const parsed = parseOpenAlexCiters(CITERS);
    expect(parsed).not.toBeNull();
    expect(parsed?.count).toBe(39);
    expect(parsed?.returned).toBe(39);
    expect(parsed?.dropped).toBe(0);
    expect(parsed?.citers).toHaveLength(39);
    expect(parsed?.citers[0]).toEqual({
      openalexId: "W4404978008",
      doi: "10.1002/bies.202400196",
      title: "The Multiscale Wisdom of the Body: Collective Intelligence as a Tractable Interface for Next‐Generation Biomedicine",
      authors: ["Michael G. Levin"],
      authorCount: 1,
      year: 2024,
      venue: "BioEssays",
      kind: "review",
      citedByCount: 34,
    });
    const counts = parsed?.citers.map((c) => c.citedByCount) ?? [];
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it("drops a result with no title, and counts it", () => {
    const parsed = parseOpenAlexCiters({ meta: { count: 3 }, results: works(3, (i) => (i === 1 ? { display_name: "  " } : {})) });
    expect(parsed?.citers.map((c) => c.openalexId)).toEqual(["W1000", "W1002"]);
    expect(parsed).toMatchObject({ count: 3, returned: 3, dropped: 1 });
  });

  it("merges a repeated id and a repeated DOI, first sighting kept, and counts them", () => {
    const [a, b, c] = works(3);
    const parsed = parseOpenAlexCiters({
      meta: { count: 5 },
      results: [a, { ...b, id: a?.id }, c, { ...b, doi: String(c?.doi).toUpperCase() }, b],
    });
    expect(parsed?.citers.map((x) => x.title)).toEqual([
      "A citing paper, number 0",
      "A citing paper, number 2",
      "A citing paper, number 1",
    ]);
    expect(parsed).toMatchObject({ returned: 5, dropped: 2 });
  });

  it("strips markup from a title and a venue, and bounds them", () => {
    const [w] = works(1, () => ({
      display_name: `<i>Caenorhabditis</i> &amp; memory <script>alert(1)</script>${"x".repeat(2000)}`,
      primary_location: { source: { display_name: "<b>Bio</b>Essays" } },
    }));
    const citer = parseOpenAlexCiters({ meta: { count: 1 }, results: [w] })?.citers[0];
    expect(citer?.title.startsWith("Caenorhabditis & memory alert(1)")).toBe(true);
    expect(citer?.title).not.toMatch(/[<>]/);
    expect(citer?.title.length).toBeLessThanOrEqual(1000);
    expect(citer?.venue).toBe("Bio Essays");
  });

  it("drops a work whose id is malformed, and keeps one whose DOI is, without the DOI", () => {
    const parsed = parseOpenAlexCiters({
      meta: { count: 3 },
      results: works(3, (i) =>
        i === 0 ? { id: "https://openalex.org/W12\"onmouseover=x" } : i === 1 ? { doi: "javascript:alert(1)" } : {},
      ),
    });
    expect(parsed?.citers.map((c) => c.openalexId)).toEqual(["W1001", "W1002"]);
    expect(parsed?.citers[0]?.doi).toBeUndefined();
    expect(parsed?.dropped).toBe(1);
    if (!parsed) throw new Error("no page");
    expect(citersLines({ ...parsed, listed: parsed.citers.length, capped: false }, undefined).join(" "))
      .toContain("invalid identifier");
  });

  it("keeps at most twenty authors' names, and the full count", () => {
    const [w] = works(1, () => ({
      authorships: Array.from({ length: 45 }, (_, i) => ({ author: { display_name: `Author ${i}` } })),
    }));
    const citer = parseOpenAlexCiters({ meta: { count: 1 }, results: [w] })?.citers[0];
    expect(citer?.authors).toHaveLength(20);
    expect(citer?.authorCount).toBe(45);
  });

  it("is null for an answer with no list or no count", () => {
    expect(parseOpenAlexCiters({ meta: { count: 3 } })).toBeNull();
    expect(parseOpenAlexCiters({ results: [] })).toBeNull();
    expect(parseOpenAlexCiters({ meta: { count: -1 }, results: [] })).toBeNull();
    expect(parseOpenAlexCiters(null)).toBeNull();
  });
});

describe("a citer's link", () => {
  it("encodes literal URL metacharacters in a parsed DOI", () => {
    for (const doi of ["10.1000/citer%2fpart", "10.1000/citer\\part"]) {
      const [work] = works(1, () => ({ doi }));
      const citer = parseOpenAlexCiters({ meta: { count: 1 }, results: [work] })?.citers[0];
      if (!citer?.doi) throw new Error("no parsed DOI");
      const link = new URL(citerUrl(citer)!);
      expect(decodeURIComponent(link.pathname.slice(1))).toBe(doi);
    }
  });
  it("is built from the DOI, or from the W id, and is never a string from the response", () => {
    const [w] = works(1, () => ({
      doi: "https://doi.org/10.1000/Real.DOI",
      id: "https://openalex.org/W77",
      primary_location: { landing_page_url: "https://evil.example/landing", pdf_url: "https://evil.example/pdf" },
      open_access: { oa_url: "https://evil.example/oa" },
    }));
    const citer = parseOpenAlexCiters({ meta: { count: 1 }, results: [w] })?.citers[0];
    if (!citer) throw new Error("no citer");
    expect(JSON.stringify(citer)).not.toContain("evil.example");
    expect(JSON.stringify(citer)).not.toContain("http");
    expect(citerUrl(citer)).toBe("https://doi.org/10.1000/real.doi");
    const { doi: _doi, ...noDoi } = citer;
    expect(citerUrl(noDoi)).toBe("https://openalex.org/W77");
    expect(citerUrl({ openalexId: "W1/../../evil" })).toBeNull();
  });
});

describe("openAlexAuthors", () => {
  it("makes a display name a family name and the given names before it", () => {
    expect(openAlexAuthors(["Michael G. Levin", "Plato", "  "])).toEqual([
      { family: "Levin", given: "Michael G." },
      { family: "Plato" },
    ]);
  });
});

describe("the addresses", () => {
  it("asks for the DOI, then for what cites the id, most cited first, with our contact address", () => {
    const work = new URL(WORK_URL);
    expect(work.origin + work.pathname).toBe("https://api.openalex.org/works/doi:10.3390/e26060481");
    expect(work.searchParams.get("mailto")).toBe(CONTACT_EMAIL);
    const citers = new URL(CITERS_URL);
    expect(citers.origin + citers.pathname).toBe("https://api.openalex.org/works");
    expect(citers.searchParams.get("filter")).toBe("cites:W4399223951");
    expect(citers.searchParams.get("sort")).toBe("cited_by_count:desc");
    expect(citers.searchParams.get("per-page")).toBe("100");
    expect(citers.searchParams.get("mailto")).toBe(CONTACT_EMAIL);
    expect(citers.searchParams.has("api_key")).toBe(false);
  });
});

/* ------------------------------------------------------------- citersOf -- */

describe("citersOf", () => {
  it.each(["Michael G. Levin Jr.", "Levin, Michael G."])(
    "confirms the same author from the display name %s, fresh and cached",
    async (name) => {
      const h = harness({
        ...HAPPY,
        [WORK_URL]: { ...WORK, authorships: [{ author: { display_name: name } }] },
      });
      expect((await citersOf(LEVIN, h.deps)).kind).toBe("found");
      expect((await citersOf(LEVIN, h.deps)).kind).toBe("found");
      expect(h.api.asked).toEqual([WORK_URL, CITERS_URL]);
      expect(await citersOf({ ...LEVIN, byline: "Ada Levin" }, h.deps)).toEqual({ kind: "unconfirmed" });
    },
  );

  it("confirms a complete multiword author name without losing its first given name", async () => {
    const name = "Juan Carlos de la Cruz";
    const h = harness({
      ...HAPPY,
      [WORK_URL]: { ...WORK, authorships: [{ author: { display_name: name } }] },
    });
    expect((await citersOf({ ...LEVIN, byline: name }, h.deps)).kind).toBe("found");
    expect((await citersOf({ title: TITLE, doi: DOI, authors: [{ name, affiliations: [] }] }, h.deps)).kind).toBe("found");
    expect(await citersOf({ ...LEVIN, byline: "Pedro Carlos de la Cruz" }, h.deps)).toEqual({ kind: "unconfirmed" });
  });

  it("reports an oversized target record as too-large instead of offering the same retry", async () => {
    const h = harness({ [WORK_URL]: failure(200, "too-large") });
    expect(await citersOf(LEVIN, h.deps)).toEqual({ kind: "too-large" });
    expect(h.api.asked).toEqual([WORK_URL]);
    expect(h.store.writes).toEqual([]);
  });
  it("lists the 39, stores them, and asks twice", async () => {
    const h = harness(HAPPY);
    const got = await citersOf(LEVIN, h.deps);
    expect(got.kind).toBe("found");
    if (got.kind !== "found") return;
    expect(got).toMatchObject({ count: 39, returned: 39, dropped: 0, capped: false });
    expect(got.citers).toHaveLength(39);
    expect(Number.isNaN(Date.parse(got.fetchedAt))).toBe(false);
    expect(h.api.asked).toEqual([WORK_URL, CITERS_URL]);
    expect(h.limiter.turns).toEqual(["openalex", "openalex"]);
    expect(h.store.writes).toEqual([`${ID}:found`]);
  });

  it("makes no request for an article with no DOI, or one that is not a DOI", async () => {
    const h = harness({});
    expect(await citersOf({ title: TITLE, byline: "Michael Levin" }, h.deps)).toEqual({ kind: "no-doi" });
    expect(await citersOf({ ...LEVIN, doi: "not a doi" }, h.deps)).toEqual({ kind: "no-doi" });
    expect(await citersOf({ ...LEVIN, doi: "arxiv:1706.03762" }, h.deps)).toEqual({ kind: "no-doi" });
    /* An address that names no work is not a fallback either, nor one that names a
       DOI: the fallback is for arXiv's gap alone (GPT Sol's F4 on plan 261010n). */
    for (const url of ["https://example.com/post", `https://doi.org/${DOI}`]) {
      expect(await citersOf({ title: TITLE, byline: "Michael Levin", url }, h.deps)).toEqual({ kind: "no-doi" });
    }
    expect(h.api.asked).toEqual([]);
  });

  /* Plan 261010n (spya-sbj3yk): an article imported before an agreed arXiv record put
     its DOI on the article has none, and its address is the arXiv page. arXiv's own
     DataCite DOI is asked about, and the answer still has to be this article's. */
  it("with no DOI, asks about arXiv's DOI for the arXiv paper the article's own address names", async () => {
    const arxivDoi = "10.48550/arxiv.1706.03762";
    const h = harness({ [openAlexWorkUrl(arxivDoi)]: WORK, [CITERS_URL]: CITERS });
    const article = { title: TITLE, byline: "Michael Levin", url: "https://arxiv.org/abs/1706.03762v7" };
    expect((await citersOf(article, h.deps)).kind).toBe("found");
    expect(h.api.asked).toEqual([openAlexWorkUrl(arxivDoi), CITERS_URL]);
    expect(h.store.writes).toEqual([`doi:${arxivDoi}:found`]);
    /* The same record, read for an article whose title is not its own, lists nothing. */
    expect(await citersOf({ ...article, title: "A different paper altogether about memory" }, h.deps)).toEqual({
      kind: "unconfirmed",
    });
    /* An article's own DOI wins over its address. */
    const own = harness(HAPPY);
    expect((await citersOf({ ...LEVIN, url: "https://arxiv.org/abs/1706.03762" }, own.deps)).kind).toBe("found");
    expect(own.api.asked).toEqual([WORK_URL, CITERS_URL]);

    /* A stored value that is not a DOI is not precedence: old or hand-edited
       metadata must not hide the usable arXiv address underneath it. */
    const invalid = harness({ [openAlexWorkUrl(arxivDoi)]: WORK, [CITERS_URL]: CITERS });
    expect((await citersOf({ ...article, doi: "arxiv:1706.03762" }, invalid.deps)).kind).toBe("found");
    expect(invalid.api.asked).toEqual([openAlexWorkUrl(arxivDoi), CITERS_URL]);
  });

  it("calls a 404 not-indexed, remembers it, and does not ask again", async () => {
    const h = harness({ [WORK_URL]: failure(404, "not-found") });
    expect(await citersOf(LEVIN, h.deps)).toEqual({ kind: "not-indexed" });
    expect(await citersOf(LEVIN, h.deps)).toEqual({ kind: "not-indexed" });
    expect(h.api.asked).toEqual([WORK_URL]);
    expect(h.store.writes).toEqual([`${ID}:not-indexed`]);
  });

  it("does not list citers when the title is another work's, and never asks for them", async () => {
    const h = harness(HAPPY);
    const got = await citersOf({ ...LEVIN, title: "Attention Is All You Need" }, h.deps);
    expect(got).toEqual({ kind: "unconfirmed" });
    expect(h.api.asked).toEqual([WORK_URL]);
    expect(h.store.writes).toEqual([]);
  });

  it("does not list citers when the title is identical and no author agrees (F3)", async () => {
    const h = harness(HAPPY);
    expect(await citersOf({ ...LEVIN, byline: "Ada Lovelace" }, h.deps)).toEqual({ kind: "unconfirmed" });
    expect(await citersOf({ title: TITLE, doi: DOI }, h.deps)).toEqual({ kind: "unconfirmed" });
    expect(h.api.asked).toEqual([WORK_URL, WORK_URL]);
    expect(h.store.writes).toEqual([]);
  });

  it("agrees on structured authors as well as a byline", async () => {
    const h = harness(HAPPY);
    const got = await citersOf({ title: TITLE, doi: DOI, authors: [{ name: "Michael Levin", affiliations: [] }] }, h.deps);
    expect(got.kind).toBe("found");
  });

  it("checks a cache hit against the article too: a second article with this DOI gets nothing (F1)", async () => {
    const h = harness(HAPPY);
    expect((await citersOf(LEVIN, h.deps)).kind).toBe("found");
    const asked = h.api.asked.length;
    /* Another article, whose DOI was mistyped as Levin's. The row is fresh. */
    const other = { title: "Attention Is All You Need", byline: "Ashish Vaswani", doi: DOI };
    expect(await citersOf(other, h.deps)).toEqual({ kind: "unconfirmed" });
    /* …and the same title by somebody else, off the same cached row (F3). */
    expect(await citersOf({ ...LEVIN, byline: "Ada Lovelace" }, h.deps)).toEqual({ kind: "unconfirmed" });
    expect(h.api.asked).toHaveLength(asked);
    /* The right article still gets its list off the cache. */
    expect((await citersOf(LEVIN, h.deps)).kind).toBe("found");
    expect(h.api.asked).toHaveLength(asked);
  });

  it("a failed second request is unavailable, and stores nothing: never a count without its list", async () => {
    const h = harness({ [WORK_URL]: WORK, [CITERS_URL]: failure(500) });
    expect(await citersOf(LEVIN, h.deps)).toEqual({ kind: "unavailable" });
    expect(h.store.writes).toEqual([]);
    expect(h.store.rows.size).toBe(0);
  });

  it("a malformed list is unavailable, and stores nothing", async () => {
    const h = harness({ [WORK_URL]: WORK, [CITERS_URL]: { meta: {}, results: "no" } });
    expect(await citersOf(LEVIN, h.deps)).toEqual({ kind: "unavailable" });
    expect(h.store.writes).toEqual([]);
  });

  it("a 429 cools OpenAlex for everybody, and the next caller does not ask", async () => {
    const h = harness({ [WORK_URL]: failure(429, "rate-limited") });
    expect(await citersOf(LEVIN, h.deps)).toEqual({ kind: "unavailable" });
    expect(await citersOf(LEVIN, h.deps)).toEqual({ kind: "unavailable" });
    expect(h.api.asked).toEqual([WORK_URL]);
    expect(await h.limiter.coolingDown("openalex")).toBe(true);
    expect(await h.limiter.coolingDown("crossref")).toBe(false);
  });

  it("carries a count larger than the page through, and says the page limit is why", async () => {
    const h = harness({ [WORK_URL]: WORK, [CITERS_URL]: { meta: { count: 389 }, results: works(100) } });
    const got = await citersOf(LEVIN, h.deps);
    expect(got).toMatchObject({ kind: "found", count: 389, returned: 100, dropped: 0, capped: true });
    if (got.kind === "found") expect(got.citers).toHaveLength(100);
  });

  it("tells a dropped record from a capped page (F5)", async () => {
    /* 39 returned, one with no title: 38 listed, and the page limit hid none. */
    const a = harness({ [WORK_URL]: WORK, [CITERS_URL]: { meta: { count: 39 }, results: works(39, (i) => (i === 7 ? { display_name: null } : {})) } });
    const one = await citersOf(LEVIN, a.deps);
    expect(one).toMatchObject({ kind: "found", count: 39, returned: 39, dropped: 1, capped: false });
    if (one.kind === "found") expect(one.citers).toHaveLength(38);

    /* 100 of 389 returned, five unshowable: 95 listed, and the limit hid some too. */
    const b = harness({ [WORK_URL]: WORK, [CITERS_URL]: { meta: { count: 389 }, results: works(100, (i) => (i < 5 ? { display_name: "" } : {})) } });
    const two = await citersOf(LEVIN, b.deps);
    expect(two).toMatchObject({ kind: "found", count: 389, returned: 100, dropped: 5, capped: true });
    if (two.kind === "found") expect(two.citers).toHaveLength(95);

    /* A count, and not one record we can show. */
    const c = harness({ [WORK_URL]: WORK, [CITERS_URL]: { meta: { count: 2 }, results: works(2, () => ({ display_name: null })) } });
    const three = await citersOf(LEVIN, c.deps);
    expect(three).toMatchObject({ kind: "found", count: 2, returned: 2, dropped: 2, capped: false, citers: [] });
  });

  it("serves a fresh cached list with its date, and makes no request", async () => {
    const h = harness(HAPPY);
    const first = await citersOf(LEVIN, h.deps);
    const again = await citersOf(LEVIN, h.deps);
    expect(again).toEqual(first);
    expect(h.api.asked).toEqual([WORK_URL, CITERS_URL]);
  });

  it("asks again once the row is a week old, and replaces it", async () => {
    const h = harness(HAPPY);
    await citersOf(LEVIN, h.deps);
    h.store.age(ID);
    await citersOf(LEVIN, h.deps);
    expect(h.api.asked).toEqual([WORK_URL, CITERS_URL, WORK_URL, CITERS_URL]);
    expect(h.store.writes).toEqual([`${ID}:found`, `${ID}:found`]);
  });

  it("serves the stale list, with its own date, when OpenAlex cannot be reached", async () => {
    const h = harness(HAPPY);
    const first = await citersOf(LEVIN, h.deps);
    h.store.age(ID);
    const stale = await h.store.read(ID, CITERS_FRESH_MS);
    h.api.fetchJson.mockRejectedValue(failure(null, "timeout"));
    const got = await citersOf(LEVIN, h.deps);
    expect(got.kind).toBe("found");
    if (got.kind !== "found" || first.kind !== "found") return;
    expect(got.citers).toEqual(first.citers);
    expect(got.fetchedAt).toBe(stale?.fetchedAt);
    expect(h.store.writes).toEqual([`${ID}:found`]);
  });

  it("checks the stale fallback against the article as well (F1)", async () => {
    const h = harness(HAPPY);
    await citersOf(LEVIN, h.deps);
    h.store.age(ID);
    h.api.fetchJson.mockRejectedValue(failure(503));
    const other = { title: "Attention Is All You Need", byline: "Ashish Vaswani", doi: DOI };
    expect(await citersOf(other, h.deps)).toEqual({ kind: "unavailable" });
  });

  it("asks for a shorter page when the answer is too large, and lists that honestly (F6)", async () => {
    const h = harness({
      [WORK_URL]: WORK,
      [CITERS_URL]: failure(200, "too-large"),
      [CITERS_URL_SMALL]: { meta: { count: 389 }, results: works(25) },
    });
    const got = await citersOf(LEVIN, h.deps);
    expect(got).toMatchObject({ kind: "found", count: 389, returned: 25, capped: true });
    expect(h.api.asked).toEqual([WORK_URL, CITERS_URL, CITERS_URL_SMALL]);
  });

  it("says too-large when the shorter page is too large as well, and stores nothing (F6)", async () => {
    const h = harness({
      [WORK_URL]: WORK,
      [CITERS_URL]: failure(200, "too-large"),
      [CITERS_URL_SMALL]: failure(200, "too-large"),
    });
    expect(await citersOf(LEVIN, h.deps)).toEqual({ kind: "too-large" });
    expect(h.store.writes).toEqual([]);
  });

  it("an oversized answer off the real fetcher is the too-large failure (F6)", async () => {
    /* One citer whose authors' affiliations run past the megabyte the fetcher
       reads: the failure `citersOf` shortens the page on. */
    const fat = JSON.stringify({
      meta: { count: 1 },
      results: works(1, () => ({
        authorships: Array.from({ length: 200 }, () => ({
          author: { display_name: "Ada Lovelace" },
          raw_affiliation_strings: ["x".repeat(6000)],
        })),
      })),
    });
    expect(fat.length).toBeGreaterThan(1024 * 1024);
    const fetchImpl: FetchLike = async () =>
      new Response(fat, { status: 200, headers: { "content-type": "application/json" } });
    const resolve = async () => ["93.184.216.34"];
    const fetchJson = (url: string) => fetchBibliographicJson(url, { fetchImpl, resolve });
    const h = harness({});
    const real = { ...h.deps, fetchJson: vi.fn(async (url: string) => (url === WORK_URL ? WORK : await fetchJson(url))) };
    expect(await citersOf(LEVIN, real)).toEqual({ kind: "too-large" });
    expect(real.fetchJson.mock.calls.map((c) => c[0])).toEqual([WORK_URL, CITERS_URL, CITERS_URL_SMALL]);
  });

  it("answers unavailable, never a throw, when the cache itself fails", async () => {
    const h = harness(HAPPY);
    h.store.read = async () => {
      throw new Error("database is down");
    };
    expect(await citersOf(LEVIN, h.deps)).toEqual({ kind: "unavailable" });
  });
});

/* ------------------------------------------------------------ the fetcher -- */

describe("fetchBibliographicJson and OpenAlex", () => {
  const resolve = async () => ["93.184.216.34"];
  const ok: FetchLike = async () =>
    new Response(JSON.stringify(WORK), { status: 200, headers: { "content-type": "application/json" } });

  it("dials api.openalex.org", async () => {
    expect(await fetchBibliographicJson(WORK_URL, { fetchImpl: ok, resolve })).toEqual(WORK);
  });

  it("still refuses every other host, and a lookalike", async () => {
    for (const url of [
      "https://openalex.org/works/W1",
      "https://api.openalex.org.evil.example/works/W1",
      "http://api.openalex.org/works/W1",
      "https://api.semanticscholar.org/graph/v1/paper/1",
    ]) {
      await expect(fetchBibliographicJson(url, { fetchImpl: ok, resolve }), url).rejects.toMatchObject({
        code: "blocked-address",
      });
    }
  });
});

describe("the suite's own guard", () => {
  it("refuses api.openalex.org, so no test here can ask it for real", () => {
    expect(providerHostOf("https://api.openalex.org/works/W4399223951")).toBe("api.openalex.org");
  });
});
