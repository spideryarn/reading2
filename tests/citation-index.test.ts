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

import type { LimiterService, LookupResult, ServiceLimiter, SlotLease, StartTaken, WorkId } from "../src/bibliographic.js";
import {
  CITERS_FRESH_MS,
  type CitersKey,
  type CitationIndexStore,
  type FetchedCiters,
  type StoredCiters,
  citersOf,
  confirmedWorkOf,
  openAlexAuthors,
  openAlexCitersUrl,
  openAlexTitleSearchUrl,
  openAlexWorkUrl,
  titleMatchOf,
  titleQueryOf,
  TOPIC_MIN_CITERS,
  parseOpenAlexCiters,
  parseOpenAlexWork,
} from "../src/citation-index.js";
import { citerUrl } from "../src/citer-link.js";
import { FetchFailure, fetchBibliographicJson, type FetchLike } from "../src/fetch.js";
import type { Log } from "../src/log.js";
import { CONTACT_EMAIL } from "../src/site-text.js";
import { citersLines } from "../src/messages.js";
import { providerHostOf } from "./setup/provider-guard.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/openalex/${name}`, import.meta.url), "utf8")) as unknown;

const WORK = fixture("work-e26060481.json") as Record<string, unknown>;
const CITERS = fixture("citers-e26060481.json") as { meta: { count: number }; results: Record<string, unknown>[] };

const DOI = "10.3390/e26060481";
const ID = `doi:${DOI}` as CitersKey;
const TITLE = "Self-Improvising Memory: A Perspective on Memories as Agential, Dynamically Reinterpreting Cognitive Glue";
const LEVIN = { title: TITLE, byline: "Michael Levin", doi: DOI };

const WORK_URL = openAlexWorkUrl(DOI);
const CITERS_URL = openAlexCitersUrl("W4399223951", 100);
const CITERS_URL_SMALL = openAlexCitersUrl("W4399223951", 25);

/* ------------------------------------------------------------ the doubles -- */

class MemoryCache implements CitationIndexStore {
  rows = new Map<string, { answer: FetchedCiters; at: number }>();
  writes: string[] = [];
  async read(id: CitersKey, freshMs: number): Promise<StoredCiters | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    return { ...row.answer, fetchedAt: new Date(row.at).toISOString(), fresh: Date.now() - row.at < freshMs };
  }
  async write(id: CitersKey, answer: FetchedCiters): Promise<string> {
    this.writes.push(`${id}:${answer.kind}`);
    const at = Date.now();
    this.rows.set(id, { answer, at });
    return new Date(at).toISOString();
  }
  /** Make the row older than the freshness window. */
  age(id: CitersKey): void {
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
  /* arXiv's own record is asked only when an arXiv paper's own facts fail (plan
     261027c); by default the registry knows nothing, so no test reaches a real one. */
  const lookupWork = vi.fn(async (_id: WorkId): Promise<LookupResult> => ({ kind: "not-found" }));
  const deps = { store, limiter, fetchJson: api.fetchJson, sleep: async () => {}, lookupWork };
  return { store, limiter, api, deps, lookupWork };
}

/** A logger whose objects can be inspected without Pino's test-time silence. */
function recordingLog(): { entries: object[]; logger: Log } {
  const entries: object[] = [];
  const write = (value: object | string) => {
    if (typeof value === "object") entries.push(value);
  };
  const logger: Log = {
    debug: write,
    info: write,
    warn: write,
    error: write,
    child: () => logger,
  };
  return { entries, logger };
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

  /* Plan 261027c: a page's byline often names the senior author, who comes last;
     Narratives' Uri Hasson is the 25th of 25. The CHECK keeps 20. */
  it("keeps the first nineteen authors and the last one of a longer list", () => {
    const names = Array.from({ length: 25 }, (_, i) => `Author Number${i + 1}`);
    const of = (list: unknown[]) => parseOpenAlexWork({
      ...WORK,
      authorships: list.map((display_name) => ({ author: { display_name } })),
    });
    expect(of(names)?.authors).toEqual([...names.slice(0, 19), "Author Number25"]);
    expect(of(names.slice(0, 20))?.authors).toEqual(names.slice(0, 20));
    expect(of([...names.slice(0, 10), null, ...names.slice(10, 20)])?.authors).toEqual(names.slice(0, 20));
    const thousands = Array.from({ length: 5_000 }, (_, i) => `Physics Author ${i + 1}`);
    expect(of(thousands)?.authors).toEqual([...thousands.slice(0, 19), "Physics Author 5000"]);
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
    /* Since plan 261011q an article with no DOI and an author is searched for by
       title (below), so these have no author: nothing to search with either. */
    expect(await citersOf({ title: TITLE }, h.deps)).toEqual({ kind: "no-doi" });
    expect(await citersOf({ title: TITLE, doi: "not a doi" }, h.deps)).toEqual({ kind: "no-doi" });
    expect(await citersOf({ title: TITLE, doi: "arxiv:1706.03762" }, h.deps)).toEqual({ kind: "no-doi" });
    /* An address that names no work is not a fallback either, nor one that names a
       DOI: the fallback is for arXiv's gap alone (GPT Sol's F4 on plan 261010n). */
    for (const url of ["https://example.com/post", `https://doi.org/${DOI}`]) {
      expect(await citersOf({ title: TITLE, url }, h.deps)).toEqual({ kind: "no-doi" });
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

  /* Investigation 261025a: OpenAlex's record for arXiv 2308.08708 (Butlin, Long et
     al.) has the right authors and its 196 real citers, but a Zenodo deposit
     merged into it gave it another title. When the article's own arXiv address
     independently names that DOI, the bounded author lists can stand in for
     the title only when at least two and four in five agree. */
  it("confirms an arXiv DOI's retitled record when the bounded author lists agree", async () => {
    const arxivDoi = "10.48550/arxiv.2308.08708";
    const arxivId = `doi:${arxivDoi}` as CitersKey;
    const retitled = {
      ...WORK,
      display_name: "Cheap Correlate or Discriminating Property? An Executable Validation Protocol",
      title: "Cheap Correlate or Discriminating Property? An Executable Validation Protocol",
      authorships: authorships(["Patrick Butlin", "Long, Robert", "Eric Elmoznino", "Yoshua Bengio"]),
    };
    const article = {
      title: "Consciousness in Artificial Intelligence: Insights from the Science of Consciousness",
      byline: "Patrick Butlin, Robert Long, Eric Elmoznino, Yoshua Bengio",
      authors: ["Patrick Butlin", "Robert Long", "Eric Elmoznino", "Yoshua Bengio"]
        .map((name) => ({ name, affiliations: [] })),
      doi: arxivDoi,
      url: "https://arxiv.org/html/2308.08708",
    };
    const h = harness({ [openAlexWorkUrl(arxivDoi)]: retitled, [CITERS_URL]: CITERS });
    expect((await citersOf(article, h.deps)).kind).toBe("found");
    /* …off the cache too, which is checked by the same rule. */
    expect((await citersOf(article, h.deps)).kind).toBe("found");
    expect(await citersOf({ ...article, title: "A Later Paper", url: "https://example.com/later" }, h.deps)).toEqual({
      kind: "unconfirmed",
    });
    /* …and off a stale fallback after OpenAlex becomes unavailable. */
    h.store.age(arxivId);
    h.api.fetchJson.mockRejectedValue(failure(503));
    expect((await citersOf(article, h.deps)).kind).toBe("found");

    /* Half of a two-person list is not enough without the title. */
    const lone = harness({ [openAlexWorkUrl(arxivDoi)]: retitled, [CITERS_URL]: CITERS });
    expect(await citersOf({
      ...article,
      byline: "Patrick Butlin, Ada Lovelace",
      authors: ["Patrick Butlin", "Ada Lovelace"].map((name) => ({ name, affiliations: [] })),
    }, lone.deps)).toEqual({ kind: "unconfirmed" });

    /* And a DOI that is not arXiv's keeps the title rule, two authors or not. */
    const journal = harness({ [WORK_URL]: retitled, [CITERS_URL]: CITERS });
    const { url: _url, ...noAddress } = article;
    expect(await citersOf({ ...noAddress, doi: DOI }, journal.deps)).toEqual({ kind: "unconfirmed" });
  });

  it("does not let an arXiv DOI override the title unless the article's own address names that paper", async () => {
    const arxivDoi = "10.48550/arxiv.2308.08708";
    const retitled = {
      ...WORK,
      title: "An Earlier Paper by the Same Team",
      authorships: authorships(["Patrick Butlin", "Robert Long"]),
    };
    const identity = {
      title: "A Later Paper by the Same Team",
      byline: "Patrick Butlin, Robert Long",
      authors: ["Patrick Butlin", "Robert Long"].map((name) => ({ name, affiliations: [] })),
      doi: arxivDoi,
    };

    /* A later paper or blog post can accidentally carry the team's earlier DOI. */
    const later = harness({ [openAlexWorkUrl(arxivDoi)]: retitled, [CITERS_URL]: CITERS });
    expect(await citersOf({ ...identity, url: "https://example.com/later-paper" }, later.deps)).toEqual({
      kind: "unconfirmed",
    });

    /* A stored DOI can also disagree with the arXiv paper named by the address. */
    const mistyped = harness({ [openAlexWorkUrl(arxivDoi)]: retitled, [CITERS_URL]: CITERS });
    expect(await citersOf({ ...identity, url: "https://arxiv.org/html/2401.12345" }, mistyped.deps)).toEqual({
      kind: "unconfirmed",
    });
  });

  it("requires two distinct article authors, rather than two matches somewhere in the byline", async () => {
    const arxivDoi = "10.48550/arxiv.2308.08708";
    const singleAuthorTarget = {
      ...WORK,
      title: "Another Article Entirely",
      authorships: authorships(["John Smith", "Jane Jones"]),
    };
    const single = harness({ [openAlexWorkUrl(arxivDoi)]: singleAuthorTarget, [CITERS_URL]: CITERS });
    expect(await citersOf({
      title: "A Single-author Paper",
      byline: "J. Smith Jones",
      authors: [{ name: "J. Smith Jones", affiliations: [] }],
      doi: arxivDoi,
      url: "https://arxiv.org/html/2308.08708",
    }, single.deps)).toEqual({ kind: "unconfirmed" });

    /* The free-text matcher must not cross the boundary between two authors. */
    const recombinedTarget = {
      ...WORK,
      title: "Another Article Entirely",
      authorships: authorships(["Robert Butlin", "Patrick Long"]),
    };
    const recombined = harness({ [openAlexWorkUrl(arxivDoi)]: recombinedTarget, [CITERS_URL]: CITERS });
    expect(await citersOf({
      title: "The Actual Article",
      byline: "Patrick Butlin, Robert Long",
      authors: ["Patrick Butlin", "Robert Long"].map((name) => ({ name, affiliations: [] })),
      doi: arxivDoi,
      url: "https://arxiv.org/html/2308.08708",
    }, recombined.deps)).toEqual({ kind: "unconfirmed" });

    /* Two spellings of one OpenAlex author are still only one person. */
    const duplicatedTarget = {
      ...WORK,
      title: "Another Article Entirely",
      authorships: authorships(["Patrick Butlin", "P. Butlin"]),
    };
    const duplicated = harness({ [openAlexWorkUrl(arxivDoi)]: duplicatedTarget, [CITERS_URL]: CITERS });
    expect(await citersOf({
      title: "The Actual Article",
      authors: ["Patrick Butlin", "Robert Long"].map((name) => ({ name, affiliations: [] })),
      doi: arxivDoi,
      url: "https://arxiv.org/html/2308.08708",
    }, duplicated.deps)).toEqual({ kind: "unconfirmed" });
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

  it("answers unavailable, never a throw, when its dependencies cannot be loaded", async () => {
    const deps = Object.defineProperty({}, "store", {
      get() {
        throw new Error("store module did not load");
      },
    });
    await expect(citersOf(LEVIN, deps)).resolves.toEqual({ kind: "unavailable" });
  });
});

/* ------------------------------------------------------------ the fetcher -- */

/* ----------------------------------------------- the title search, 261011q -- */

/*
 * An article with no DOI is looked up by its title at OpenAlex, and a record is
 * taken only when the whole title agrees, a second fact agrees (two authors, or
 * one author and the year), and no other record passes as well. The first two
 * records below are shaped from the answer measured on 2026-10-11 for
 * "Attention Is All You Need": the right work with a 2025 year and all eight
 * authors, and a same-titled 2025 book chapter by somebody else.
 */
const ATTENTION = "Attention Is All You Need";
const VASWANI_AUTHORS = [
  "Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit",
  "Llion Jones", "Aidan N. Gomez", "Łukasz Kaiser", "Illia Polosukhin",
];
const authorships = (names: string[]) => names.map((display_name) => ({ author: { display_name } }));
const VASWANI = {
  id: "https://openalex.org/W2626778328",
  doi: "https://doi.org/10.65215/2q58a426",
  display_name: ATTENTION,
  publication_year: 2025,
  authorships: authorships(VASWANI_AUTHORS),
};
const BISHOP = {
  id: "https://openalex.org/W4415754031",
  doi: "https://doi.org/10.1201/9781003561460-19",
  display_name: ATTENTION,
  publication_year: 2025,
  authorships: authorships(["J. M. Bishop", "Gabriel Seiberth"]),
};
const SPEECH = {
  id: "https://openalex.org/W3163652268",
  display_name: "Attention Is All You Need In Speech Separation",
  publication_year: 2021,
  authorships: authorships(["Cem Subakan", "Mirco Ravanelli"]),
};
const searchOf = (...results: unknown[]) => ({ meta: { count: results.length }, results });
const ATTENTION_ARTICLE = {
  title: ATTENTION,
  byline: "Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit, Llion Jones, Aidan N. Gomez, Lukasz Kaiser, Illia Polosukhin",
  publishedYear: 2017,
};
const SEARCH_URL = openAlexTitleSearchUrl(titleQueryOf(ATTENTION)!);
const VASWANI_CITERS_URL = openAlexCitersUrl("W2626778328", 100);
const VASWANI_KEY = "openalex:w2626778328" as CitersKey;

describe("the title search's address", () => {
  it("sends the title's words alone, lower-cased, through URLSearchParams, with our contact address", () => {
    const query = titleQueryOf("Attention, Is All | You NEED: AND (more) & “quotes”?");
    expect(query).toBe("attention is all you need and more quotes");
    const url = new URL(openAlexTitleSearchUrl(query!));
    expect(url.origin + url.pathname).toBe("https://api.openalex.org/works");
    expect(url.searchParams.get("search.title")).toBe(query);
    expect(url.searchParams.get("per_page")).toBe("10");
    expect(url.searchParams.get("mailto")).toBe(CONTACT_EMAIL);
    expect(url.searchParams.get("filter")).toBeNull();
  });

  it("is bounded, and cut at a word", () => {
    const query = titleQueryOf(`${"memory ".repeat(200)}end`)!;
    expect(query.length).toBeLessThanOrEqual(300);
    expect(query.endsWith("memory")).toBe(true);
  });

  it("is null for a title with no words", () => {
    expect(titleQueryOf("—?!")).toBeNull();
  });
});

describe("titleMatchOf", () => {
  it("takes the right work, though its year is 2025, because eight of its authors agree", () => {
    expect(titleMatchOf(ATTENTION_ARTICLE, searchOf(VASWANI, BISHOP, SPEECH))).toMatchObject({
      kind: "match",
      target: { openalexId: "W2626778328", title: ATTENTION },
    });
  });

  it("refuses the same-titled chapter by somebody else", () => {
    expect(titleMatchOf(ATTENTION_ARTICLE, searchOf(BISHOP, SPEECH))).toEqual({ kind: "none" });
  });

  it("needs the year, within one, when only one author agrees", () => {
    const one = { title: ATTENTION, byline: "Ashish Vaswani" };
    const sole = { ...VASWANI, authorships: authorships(["Ashish Vaswani", "Somebody Else"]) };
    expect(titleMatchOf(one, searchOf(sole))).toEqual({ kind: "none" });
    expect(titleMatchOf({ ...one, publishedYear: 2017 }, searchOf({ ...sole, publication_year: 2018 }))?.kind).toBe("match");
    expect(titleMatchOf({ ...one, publishedAt: "2017-06-12" }, searchOf({ ...sole, publication_year: 2017 }))?.kind).toBe("match");
    expect(titleMatchOf({ ...one, publishedYear: 2017 }, searchOf(sole))).toEqual({ kind: "none" });
  });

  /* Plan 261027c, GPT Sol's P2: a title search's target is a target too. */
  it("finds the senior author at the end of a long list", () => {
    const names = [...Array.from({ length: 24 }, (_, i) => `Author Number${i + 1}`), "Uri Hasson"];
    const long = { ...VASWANI, publication_year: 2017, authorships: authorships(names) };
    const got = titleMatchOf({ title: ATTENTION, byline: "Hasson, Uri", publishedYear: 2017 }, searchOf(long));
    expect(got?.kind).toBe("match");
    if (got?.kind === "match") expect(got.target.authors).toHaveLength(20);
  });

  it("does not count one author listed twice as two", () => {
    const one = { title: ATTENTION, byline: "Ashish Vaswani" };
    const twice = { ...VASWANI, authorships: authorships(["Ashish Vaswani", "Ashish  vaswani"]) };
    expect(titleMatchOf(one, searchOf(twice))).toEqual({ kind: "none" });
  });

  it("does not count full-name and initial variants of one author as two people", () => {
    const one = { title: ATTENTION, byline: "Ashish Vaswani" };
    const twice = { ...VASWANI, authorships: authorships(["Ashish Vaswani", "A. Vaswani"]) };
    expect(titleMatchOf(one, searchOf(twice))).toEqual({ kind: "none" });
  });

  it("still counts different authors who share a surname and first initial", () => {
    const two = { title: ATTENTION, byline: "Ashish Vaswani, Anand Vaswani" };
    const work = { ...VASWANI, authorships: authorships(["Ashish Vaswani", "Anand Vaswani"]) };
    expect(titleMatchOf(two, searchOf(work))?.kind).toBe("match");
  });

  it("matches nothing when two different works pass: two records are one work only as twins (261025h)", () => {
    /* Twins — the same whole title, the same authors, years within one — are
       one work; anything else that passes twice is two works, and the most
       cited is still not evidence of which. */
    const later = { ...VASWANI, id: "https://openalex.org/W1", publication_year: 2027 };
    expect(titleMatchOf(ATTENTION_ARTICLE, searchOf(VASWANI, later))).toEqual({ kind: "none" });
    const fewerAuthors = { ...VASWANI, id: "https://openalex.org/W1", authorships: authorships(["Ashish Vaswani", "Somebody Else"]) };
    expect(titleMatchOf({ ...ATTENTION_ARTICLE, publishedYear: 2025 }, searchOf(VASWANI, fewerAuthors))).toEqual({ kind: "none" });
    const undated = { ...VASWANI, id: "https://openalex.org/W1", publication_year: undefined };
    expect(titleMatchOf(ATTENTION_ARTICLE, searchOf(VASWANI, undated))).toEqual({ kind: "none" });
    /* The same work twice in one answer is one work. */
    expect(titleMatchOf(ATTENTION_ARTICLE, searchOf(VASWANI, VASWANI))?.kind).toBe("match");
  });

  it("refuses a longer title that starts with this one, and a record with a malformed id", () => {
    expect(titleMatchOf(ATTENTION_ARTICLE, searchOf({ ...SPEECH, authorships: VASWANI.authorships }))).toEqual({
      kind: "none",
    });
    expect(titleMatchOf(ATTENTION_ARTICLE, searchOf({ ...VASWANI, id: "https://example.com/W2626778328x" }))).toEqual({
      kind: "none",
    });
  });

  it("is null for an answer that is not a search's", () => {
    expect(titleMatchOf(ATTENTION_ARTICLE, { results: "nope" })).toBeNull();
    expect(titleMatchOf(ATTENTION_ARTICLE, null)).toBeNull();
  });
});

describe("citersOf, with no DOI", () => {
  it("searches by title, lists the matched work's citers by its OpenAlex id, and says how it found it", async () => {
    const h = harness({ [SEARCH_URL]: searchOf(VASWANI, BISHOP), [VASWANI_CITERS_URL]: CITERS });
    const got = await citersOf(ATTENTION_ARTICLE, h.deps);
    expect(got).toMatchObject({ kind: "found", via: "title", target: { openalexId: "W2626778328", title: ATTENTION } });
    /* No DOI hop: the DOI OpenAlex gives back is its own metadata, not evidence. */
    expect(h.api.asked).toEqual([SEARCH_URL, VASWANI_CITERS_URL]);
    expect(h.store.writes).toEqual([`${VASWANI_KEY}:found`]);

    /* The search is asked again on the next open; the list is not. */
    expect((await citersOf(ATTENTION_ARTICLE, h.deps)).kind).toBe("found");
    expect(h.api.asked).toEqual([SEARCH_URL, VASWANI_CITERS_URL, SEARCH_URL]);
  });

  it("a DOI's list says it came by DOI, and names the record", async () => {
    const h = harness(HAPPY);
    expect(await citersOf(LEVIN, h.deps)).toMatchObject({
      kind: "found",
      via: "doi",
      target: { openalexId: "W4399223951" },
    });
  });

  it("is no-match when nothing passes, and asks for no list", async () => {
    const h = harness({ [SEARCH_URL]: searchOf(BISHOP, SPEECH) });
    expect(await citersOf(ATTENTION_ARTICLE, h.deps)).toEqual({ kind: "no-match" });
    expect(h.api.asked).toEqual([SEARCH_URL]);
    expect(h.store.writes).toEqual([]);
  });

  it("asks nothing for a title too short to be told apart", async () => {
    const h = harness({});
    expect(await citersOf({ title: "Editorial", byline: "Ashish Vaswani" }, h.deps)).toEqual({ kind: "no-doi" });
    expect(h.api.asked).toEqual([]);
  });

  it("is unavailable, storing nothing, when the search fails or is not a search's answer", async () => {
    for (const answer of [failure(500), { nothing: true }]) {
      const h = harness({ [SEARCH_URL]: answer });
      expect(await citersOf(ATTENTION_ARTICLE, h.deps)).toEqual({ kind: "unavailable" });
      expect(h.store.writes).toEqual([]);
    }
  });

  it("does not log a title, author or the title-bearing search URL when an unexpected error escapes", async () => {
    const h = harness({});
    const recorded = recordingLog();
    h.api.fetchJson.mockRejectedValue(new Error(`failed ${SEARCH_URL} for ${ATTENTION_ARTICLE.byline}`));
    expect(await citersOf(ATTENTION_ARTICLE, { ...h.deps, log: recorded.logger })).toEqual({ kind: "unavailable" });
    const error = recorded.entries.find((entry) => "err" in entry);
    expect(error).toBeUndefined();
    expect(JSON.stringify(recorded.entries)).not.toContain(ATTENTION);
    expect(JSON.stringify(recorded.entries)).not.toContain("Ashish");
    expect(JSON.stringify(recorded.entries)).not.toContain("search.title");
  });

  it("serves a fresh cached list under the OpenAlex key without asking for it again", async () => {
    const h = harness({ [SEARCH_URL]: searchOf(VASWANI) });
    await h.store.write(VASWANI_KEY, {
      kind: "found",
      target: { openalexId: "W2626778328", title: ATTENTION, authors: VASWANI_AUTHORS },
      count: 0, returned: 0, dropped: 0, capped: false,
      citers: [],
    });
    expect(await citersOf(ATTENTION_ARTICLE, h.deps)).toMatchObject({ kind: "found", via: "title" });
    expect(h.api.asked).toEqual([SEARCH_URL]);
  });
});

/* ---------------------------------------------- twins, and the topic view -- */

/* The Extended Mind (Clark & Chalmers 1998) as the trial's local article
   clark-chalmers-1998-spya-uwb4tn has it: a PDF, no DOI, no year
   (docs/investigations/261025a § Failures 2 and 5). The three OpenAlex answers
   are real, asked 2026-10-25 and trimmed to their first records: the title
   search, which holds the paper twice (W393180982, Analysis, 5,514 citers;
   W4239232206, Wiley's DOI, 673), and the union's citers, unfiltered and by the
   work's top keyword. */
const EM_SEARCH = fixture("extended-mind-search.json");
const EM_CITERS = fixture("extended-mind-citers.json");
const EM_TOPIC = fixture("extended-mind-topic.json");
const EXTENDED_MIND = {
  title: "The extended mind",
  byline: "ANDY CLARK; DAVID CHALMERS",
  authors: [
    { name: "ANDY CLARK", affiliations: [] },
    { name: "DAVID CHALMERS", affiliations: [] },
  ],
  url: "https://www.alice.id.tue.nl/references/clark-chalmers-1998.pdf",
};
const EM_SEARCH_URL = openAlexTitleSearchUrl(titleQueryOf(EXTENDED_MIND.title)!);
const EM_UNION = "W393180982|W4239232206";
const EM_CITERS_URL = openAlexCitersUrl(EM_UNION, 100);
const EM_TOPIC_URL = openAlexCitersUrl(EM_UNION, 100, "extended mind");
const EM_KEY = "openalex:w393180982|w4239232206" as CitersKey;

describe("twin records: one work held twice by OpenAlex (261025h, decision 2)", () => {
  it("takes The Extended Mind's two records as one work, and says which", () => {
    expect(titleMatchOf(EXTENDED_MIND, EM_SEARCH)).toEqual({
      kind: "match",
      target: {
        openalexId: "W393180982",
        alsoHeldAs: ["W4239232206"],
        title: "The Extended Mind",
        authors: ["Andy Clark", "David J. Chalmers"],
        keyword: "extended mind",
      },
    });
  });

  it("asks for the union's citers in one request, so the count is OpenAlex's own, and keys the list by both", async () => {
    const h = harness({ [EM_SEARCH_URL]: EM_SEARCH, [EM_CITERS_URL]: EM_CITERS, [EM_TOPIC_URL]: EM_TOPIC });
    const got = await citersOf(EXTENDED_MIND, h.deps);
    expect(got).toMatchObject({
      kind: "found",
      via: "title",
      target: { openalexId: "W393180982", title: "The Extended Mind", alsoHeldAs: ["W4239232206"] },
      count: 5849,
      capped: true,
    });
    expect(new URL(EM_CITERS_URL).searchParams.get("filter")).toBe("cites:W393180982|W4239232206");
    expect(h.api.asked.slice(0, 2)).toEqual([EM_SEARCH_URL, EM_CITERS_URL]);
    expect(h.store.writes[0]).toBe(`${EM_KEY}:found`);
  });

  it("is still none when one of the two is a different work: another year, or fewer of the authors", () => {
    const body = EM_SEARCH as { results: Record<string, unknown>[] };
    const [first, second, ...rest] = body.results;
    const later = { ...second, publication_year: 2001 };
    expect(titleMatchOf(EXTENDED_MIND, { results: [first, later, ...rest] })).toEqual({ kind: "none" });
    /* With the year known, a record carrying one of the two authors passes on
       its own, and so is a second work rather than nothing; but not a twin. */
    const oneAuthor = { ...second, authorships: authorships(["Andy Clark"]) };
    const dated = { ...EXTENDED_MIND, publishedYear: 1998 };
    expect(titleMatchOf(dated, { results: [oneAuthor] })?.kind).toBe("match");
    expect(titleMatchOf(dated, { results: [first, oneAuthor, ...rest] })).toEqual({ kind: "none" });
  });

  it("reads a surname-first byline as the people in it (Sol's S1-F7)", () => {
    const title = "A Distinctive Paper About Coupled Oscillators";
    const record = (names: string[]) => ({
      id: "https://openalex.org/W1",
      display_name: title,
      publication_year: 2020,
      authorships: authorships(names),
    });
    const ours = record(["Jane Smith", "John Jones"]);
    for (const byline of ["Smith, Jane; Jones, John", "Smith, Jane, Jones, John", "Smith, Jane and Jones, John", "Jane Smith, John Jones"]) {
      expect(titleMatchOf({ title, byline }, searchOf(ours))?.kind, byline).toBe("match");
    }
    /* Structured authors win over the byline whenever there are any. */
    const structured = { title, byline: "Somebody Else", authors: [{ name: "Jane Smith", affiliations: [] }, { name: "John Jones", affiliations: [] }] };
    expect(titleMatchOf(structured, searchOf(ours))?.kind).toBe("match");
    /* And the semicolon form still keeps people apart. */
    expect(titleMatchOf({ title, byline: "Smith, Jane Alice; Jones, John Bob" }, searchOf(record(["John Smith", "Bob Jones"])))).toEqual({
      kind: "none",
    });
  });

  it("matches authors one to one, never across a byline's separators (Sol's S1-F1)", () => {
    /* Each OpenAlex name borrows words from two different people in the byline. */
    const article = { title: "A Distinctive Paper About Coupled Oscillators", byline: "Jane Alice Smith, John Bob Jones" };
    const record = (id: string, year: number) => ({
      id: `https://openalex.org/${id}`,
      display_name: article.title,
      publication_year: year,
      authorships: authorships(["John Smith", "Bob Jones"]),
    });
    expect(titleMatchOf(article, searchOf(record("W1", 2020), record("W2", 2021)))).toEqual({ kind: "none" });
    expect(titleMatchOf({ ...article, publishedYear: 2020 }, searchOf(record("W1", 2020), record("W2", 2021)))).toEqual({ kind: "none" });
    /* The same records with the article's own two people do pass, and join. */
    const ours = (id: string, year: number) => ({ ...record(id, year), authorships: authorships(["Jane Smith", "John Jones"]) });
    expect(titleMatchOf(article, searchOf(ours("W1", 2020), ours("W2", 2021)))).toMatchObject({
      kind: "match",
      target: { openalexId: "W1", alsoHeldAs: ["W2"] },
    });
  });

  it("joins a sole author's twins on that one author", () => {
    const sole = { title: ATTENTION, byline: "Ashish Vaswani", publishedYear: 2017 };
    const a = { ...VASWANI, authorships: authorships(["Ashish Vaswani"]), publication_year: 2017 };
    const b = { ...a, id: "https://openalex.org/W1", publication_year: 2018 };
    expect(titleMatchOf(sole, searchOf(a, b))).toMatchObject({
      kind: "match",
      target: { openalexId: "W2626778328", alsoHeldAs: ["W1"] },
    });
  });
});

describe("the topic view: the citers that mention the work's own keyword (261025h, decision 10)", () => {
  it("says a list of more than a thousand citers has a topic, by OpenAlex's keyword, and fetches nothing more for it", async () => {
    expect(TOPIC_MIN_CITERS).toBe(1000);
    const h = harness({ [EM_SEARCH_URL]: EM_SEARCH, [EM_CITERS_URL]: EM_CITERS, [EM_TOPIC_URL]: EM_TOPIC });
    const got = await citersOf(EXTENDED_MIND, h.deps);
    expect(got).toMatchObject({ kind: "found", count: 5849, topic: { keyword: "extended mind" } });
    /* No count until the reader has asked for the topic's list once (Sol's S1-F5). */
    expect(got.kind === "found" ? [got.topic?.count, got.filteredBy] : null).toEqual([undefined, undefined]);
    expect(h.api.asked).toEqual([EM_SEARCH_URL, EM_CITERS_URL]);
    expect(h.store.writes).toEqual([`${EM_KEY}:found`]);
    /* The keyword goes as a phrase search, a parameter of its own, never inside `filter`. */
    const url = new URL(EM_TOPIC_URL);
    expect(url.searchParams.get("search.title_and_abstract")).toBe('"extended mind"');
    expect(url.searchParams.get("filter")).toBe("cites:W393180982|W4239232206");
  });

  it("fetches and caches the topic's list only on ?about=topic, and then the plain list carries its count", async () => {
    const h = harness({ [EM_SEARCH_URL]: EM_SEARCH, [EM_CITERS_URL]: EM_CITERS, [EM_TOPIC_URL]: EM_TOPIC });
    await citersOf(EXTENDED_MIND, h.deps);
    const topic = await citersOf(EXTENDED_MIND, h.deps, { about: "topic" });
    expect(topic).toMatchObject({
      kind: "found",
      filteredBy: "extended mind",
      count: 556,
      topic: { keyword: "extended mind", count: 556 },
      target: { openalexId: "W393180982", alsoHeldAs: ["W4239232206"] },
    });
    expect(topic.kind === "found" ? topic.citers[0]?.title : null).toBe("Minds: extended or scaffolded?");
    expect(h.api.asked).toEqual([EM_SEARCH_URL, EM_CITERS_URL, EM_SEARCH_URL, EM_TOPIC_URL]);
    /* Cached apart from the unfiltered list. */
    expect(h.store.writes).toEqual([`${EM_KEY}:found`, `${EM_KEY}#topic:found`]);
    /* The next plain open: the title search alone, and the topic's count off its row. */
    const again = await citersOf(EXTENDED_MIND, h.deps);
    expect(again).toMatchObject({ topic: { keyword: "extended mind", count: 556 } });
    expect(h.api.asked).toHaveLength(5);
  });

  it("offers no topic at a thousand citers or fewer, and ?about=topic is then the unfiltered list", async () => {
    const small = { ...(EM_CITERS as object), meta: { count: TOPIC_MIN_CITERS } };
    const h = harness({ [EM_SEARCH_URL]: EM_SEARCH, [EM_CITERS_URL]: small });
    const got = await citersOf(EXTENDED_MIND, h.deps, { about: "topic" });
    expect(got).toMatchObject({ kind: "found", count: TOPIC_MIN_CITERS });
    expect(got.kind === "found" ? [got.topic, got.filteredBy] : null).toEqual([undefined, undefined]);
    expect(h.api.asked).toEqual([EM_SEARCH_URL, EM_CITERS_URL]);
  });

  it("answers ?about=topic with the unfiltered list, still offering the topic, when its list cannot be read", async () => {
    const h = harness({ [EM_SEARCH_URL]: EM_SEARCH, [EM_CITERS_URL]: EM_CITERS, [EM_TOPIC_URL]: failure(500) });
    const got = await citersOf(EXTENDED_MIND, h.deps, { about: "topic" });
    expect(got).toMatchObject({ kind: "found", count: 5849, topic: { keyword: "extended mind" } });
    expect(got.kind === "found" ? got.filteredBy : "not found").toBeUndefined();
  });

  it("logs where the topic's list came from, not where the plain list did (Sol's S1-F6)", async () => {
    const h = harness({ [EM_SEARCH_URL]: EM_SEARCH, [EM_CITERS_URL]: EM_CITERS, [EM_TOPIC_URL]: EM_TOPIC });
    await citersOf(EXTENDED_MIND, h.deps);
    const recorded = recordingLog();
    await citersOf(EXTENDED_MIND, { ...h.deps, log: recorded.logger }, { about: "topic" });
    expect(recorded.entries).toContainEqual(expect.objectContaining({ id: `${EM_KEY}#topic`, from: "openalex", about: "topic" }));
    const cached = recordingLog();
    await citersOf(EXTENDED_MIND, { ...h.deps, log: cached.logger }, { about: "topic" });
    expect(cached.entries).toContainEqual(expect.objectContaining({ id: `${EM_KEY}#topic`, from: "cache" }));
  });

  it("takes the keyword with the highest score, as OpenAlex's own words, and a work with none has no topic", () => {
    const work = parseOpenAlexWork({
      id: "https://openalex.org/W1",
      title: "A work",
      keywords: [
        { display_name: "second", score: 0.4 },
        { display_name: "first \"choice\"", score: 0.9 },
      ],
    });
    expect(work?.keyword).toBe("first choice");
    expect(parseOpenAlexWork({ id: "https://openalex.org/W1", title: "A work" })?.keyword).toBeUndefined();
  });
});

describe("arXiv's own record, when an arXiv paper's own facts cannot confirm (plan 261027c)", () => {
  const arxivDoi = "10.48550/arxiv.2308.08708";
  const ARXIV_TITLE = "Consciousness in Artificial Intelligence: Insights from the Science of Consciousness";
  const RETITLED = {
    ...WORK,
    title: "Cheap Correlate or Discriminating Property? An Executable Validation Protocol",
    authorships: authorships(["Patrick Butlin", "Long, Robert", "Eric Elmoznino", "Yoshua Bengio"]),
  };
  /* What arXiv's DataCite record says the paper is. */
  const ARXIV_RECORD: LookupResult = {
    kind: "found",
    record: {
      id: "arxiv:2308.08708" as WorkId,
      source: "datacite",
      title: ARXIV_TITLE,
      authors: [
        { family: "Butlin", given: "Patrick" },
        { family: "Long", given: "Robert" },
        { family: "Elmoznino", given: "Eric" },
        { family: "Bengio", given: "Yoshua" },
      ],
      doi: arxivDoi,
    },
  };
  /* Production's revision of spya-ufn2xj's article, imported before 261017a. */
  const STALE = { title: "1Indicator Properties", url: "https://arxiv.org/html/2308.08708" };

  it("carries confirmed, unavailable and refused through a write, fresh cache and stale fallback", async () => {
    const h = harness({ [openAlexWorkUrl(arxivDoi)]: RETITLED, [CITERS_URL]: CITERS });
    h.lookupWork.mockResolvedValue(ARXIV_RECORD);
    /* A just-written answer is checked again, against the memoised registry answer. */
    expect((await citersOf(STALE, h.deps)).kind).toBe("found");
    expect(h.lookupWork).toHaveBeenCalledWith("arxiv:2308.08708");

    /* A registry outage cannot unlock a fresh row or become a permanent disagreement. */
    h.lookupWork.mockResolvedValue({ kind: "unavailable", why: "error" });
    expect(await citersOf(STALE, h.deps)).toEqual({ kind: "unavailable" });
    h.lookupWork.mockResolvedValue({ kind: "not-found" });
    expect(await citersOf(STALE, h.deps)).toEqual({ kind: "unconfirmed" });

    /* Each public call has a new memo; the same dependency may recover. */
    h.lookupWork.mockResolvedValue(ARXIV_RECORD);
    expect((await citersOf(STALE, h.deps)).kind).toBe("found");
    expect(h.lookupWork).toHaveBeenCalledTimes(4);
    expect(h.api.asked).toEqual([openAlexWorkUrl(arxivDoi), CITERS_URL]);

    h.store.age(`doi:${arxivDoi}` as CitersKey);
    h.api.fetchJson.mockRejectedValue(failure(503));
    expect((await citersOf(STALE, h.deps)).kind).toBe("found");
    h.lookupWork.mockResolvedValue({ kind: "unavailable", why: "error" });
    expect(await citersOf(STALE, h.deps)).toEqual({ kind: "unavailable" });
    h.lookupWork.mockResolvedValue({ kind: "not-found" });
    /* OpenAlex is unavailable, but refusal still cannot make the stale row list. */
    expect(await citersOf(STALE, h.deps)).toEqual({ kind: "unavailable" });
  });

  it("confirms by arXiv's title and an author when we have the title but no authors", async () => {
    const h = harness({ [openAlexWorkUrl(arxivDoi)]: { ...RETITLED, title: ARXIV_TITLE }, [CITERS_URL]: CITERS });
    h.lookupWork.mockResolvedValue(ARXIV_RECORD);
    expect((await citersOf({ ...STALE, title: ARXIV_TITLE }, h.deps)).kind).toBe("found");
  });

  /* Measured on dev: OpenAlex holds BERT's arXiv DOI under an unrelated 2025 paper. */
  it("still refuses an arXiv DOI that OpenAlex has given to another work", async () => {
    const bertDoi = "10.48550/arxiv.1810.04805";
    const stranger = {
      ...WORK,
      title: "AI-Assisted Pipeline for Dynamic Generation of Trustworthy Health Supplement Content at Scale",
      authorships: authorships(["Kefallinos, Dionysios", "Alexandris, Georgios", "Maras, Alexis"]),
    };
    const h = harness({ [openAlexWorkUrl(bertDoi)]: stranger, [CITERS_URL]: CITERS });
    h.lookupWork.mockResolvedValue({
      kind: "found",
      record: {
        id: "arxiv:1810.04805" as WorkId,
        source: "datacite",
        title: "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
        authors: [{ family: "Devlin", given: "Jacob" }, { family: "Chang", given: "Ming-Wei" }],
        doi: bertDoi,
      },
    });
    const bert = {
      title: "Pre-training of Deep Bidirectional Transformers for Language Understanding",
      authors: ["Jacob Devlin", "Ming-Wei Chang"].map((name) => ({ name, affiliations: [] })),
      url: "https://arxiv.org/abs/1810.04805",
    };
    expect(await citersOf(bert, h.deps)).toEqual({ kind: "unconfirmed" });
    expect(h.lookupWork).toHaveBeenCalledWith("arxiv:1810.04805");
    expect(h.api.asked).toEqual([openAlexWorkUrl(bertDoi)]);
    expect(h.store.writes).toEqual([]);

    /* The fallback is bounded to this address's own arXiv DOI. */
    const own = harness({ [openAlexWorkUrl(arxivDoi)]: WORK, [CITERS_URL]: CITERS });
    expect((await citersOf({ title: TITLE, byline: "Michael Levin", url: "https://arxiv.org/html/2308.08708" }, own.deps)).kind)
      .toBe("found");
    expect(own.lookupWork).not.toHaveBeenCalled();

    /* A DOI the page carries, which can be a cited work's: our facts only. */
    const journal = harness({ [WORK_URL]: RETITLED, [CITERS_URL]: CITERS });
    journal.lookupWork.mockResolvedValue(ARXIV_RECORD);
    expect(await citersOf({ ...STALE, doi: DOI, url: "https://example.com/post" }, journal.deps)).toEqual({ kind: "unconfirmed" });
    /* An arXiv DOI the address does not name: an author's later page carrying it. */
    const later = harness({ [openAlexWorkUrl(arxivDoi)]: RETITLED, [CITERS_URL]: CITERS });
    later.lookupWork.mockResolvedValue(ARXIV_RECORD);
    expect(await citersOf({ ...STALE, doi: arxivDoi, url: "https://arxiv.org/html/2401.12345" }, later.deps))
      .toEqual({ kind: "unconfirmed" });
    expect(journal.lookupWork).not.toHaveBeenCalled();
    expect(later.lookupWork).not.toHaveBeenCalled();
  });

  it("is unconfirmed when arXiv has no record, and unavailable, with its Try again, when arXiv cannot be reached", async () => {
    const none = harness({ [openAlexWorkUrl(arxivDoi)]: RETITLED, [CITERS_URL]: CITERS });
    expect(await citersOf(STALE, none.deps)).toEqual({ kind: "unconfirmed" });
    const down = harness({ [openAlexWorkUrl(arxivDoi)]: RETITLED, [CITERS_URL]: CITERS });
    down.lookupWork.mockResolvedValue({ kind: "unavailable", why: "error" });
    expect(await citersOf(STALE, down.deps)).toEqual({ kind: "unavailable" });
    expect(down.api.asked).toEqual([openAlexWorkUrl(arxivDoi)]);
    expect(down.store.writes).toEqual([]);
  });

  it("reads arXiv's record once per request, however many times the record is checked", async () => {
    const target = {
      ...RETITLED,
      keywords: [{ display_name: "consciousness", score: 1 }],
    };
    const plain = { ...CITERS, meta: { count: TOPIC_MIN_CITERS + 1 } };
    const topicUrl = openAlexCitersUrl("W4399223951", 100, "consciousness");
    const h = harness({ [openAlexWorkUrl(arxivDoi)]: target, [CITERS_URL]: plain, [topicUrl]: CITERS });
    h.lookupWork.mockResolvedValue(ARXIV_RECORD);
    expect((await citersOf(STALE, h.deps, { about: "topic" })).kind).toBe("found");
    /* askWork, the just-written plain answer and the topic answer all confirm. */
    expect(h.lookupWork).toHaveBeenCalledTimes(1);
  });

  it("uses the same confirmation and tri-state answer for Situate", async () => {
    const h = harness({ [openAlexWorkUrl(arxivDoi)]: RETITLED });
    h.lookupWork.mockResolvedValue(ARXIV_RECORD);
    expect(await confirmedWorkOf(STALE, h.deps)).toMatchObject({ kind: "confirmed", key: `doi:${arxivDoi}` });
    h.lookupWork.mockResolvedValue({ kind: "unavailable", why: "busy" });
    expect(await confirmedWorkOf(STALE, h.deps)).toEqual({ kind: "unavailable" });
  });

  /* GPT Sol on plan 261027c: with the title disagreeing, two shared names would let
     the same team's other paper through. The lists must be the same list. */
  it("refuses a record with another title whose authors are only some of arXiv's", async () => {
    const teamsOtherPaper = { ...RETITLED, authorships: authorships(["Patrick Butlin", "Long, Robert"]) };
    const h = harness({ [openAlexWorkUrl(arxivDoi)]: teamsOtherPaper, [CITERS_URL]: CITERS });
    h.lookupWork.mockResolvedValue(ARXIV_RECORD);
    expect(await citersOf(STALE, h.deps)).toEqual({ kind: "unconfirmed" });
    /* The same holds for the article's own structured authors. */
    const own = harness({ [openAlexWorkUrl(arxivDoi)]: teamsOtherPaper, [CITERS_URL]: CITERS });
    const authors = ["Patrick Butlin", "Robert Long", "Eric Elmoznino"].map((name) => ({ name, affiliations: [] }));
    expect(await citersOf({ ...STALE, authors }, own.deps)).toEqual({ kind: "unconfirmed" });
  });

  it("applies four-in-five against both list sizes, after duplicate people are removed", async () => {
    const people = ["Patrick Butlin", "Robert Long", "Eric Elmoznino", "Yoshua Bengio", "Marta Halina"];
    const article = {
      ...STALE,
      authors: people.map((name) => ({ name, affiliations: [] })),
    };
    const four = { ...RETITLED, authorships: authorships(people.slice(0, 4)) };
    const passes = harness({ [openAlexWorkUrl(arxivDoi)]: four, [CITERS_URL]: CITERS });
    expect((await citersOf(article, passes.deps)).kind).toBe("found");

    const sixNames = [...people, "Anil Seth"];
    const failsLongerArticle = harness({ [openAlexWorkUrl(arxivDoi)]: four, [CITERS_URL]: CITERS });
    expect(await citersOf({ ...article, authors: sixNames.map((name) => ({ name, affiliations: [] })) }, failsLongerArticle.deps))
      .toEqual({ kind: "unconfirmed" });
    const six = { ...RETITLED, authorships: authorships(sixNames) };
    const failsLongerTarget = harness({ [openAlexWorkUrl(arxivDoi)]: six, [CITERS_URL]: CITERS });
    expect(await citersOf({ ...article, authors: people.slice(0, 4).map((name) => ({ name, affiliations: [] })) }, failsLongerTarget.deps))
      .toEqual({ kind: "unconfirmed" });

    /* Deduplicate before selecting the bounded comparison set. Otherwise the
       repeated front author shrinks 21 people to the same two as the target. */
    const duplicateHeavy: LookupResult = {
      kind: "found",
      record: {
        ...ARXIV_RECORD.record,
        authors: [
          ...Array.from({ length: 19 }, () => ({ family: "Butlin", given: "Patrick" })),
          ...Array.from({ length: 20 }, (_, i) => ({ family: `Collaborator${i + 1}`, given: "Casey" })),
          { family: "Bengio", given: "Yoshua" },
        ],
      },
    };
    const two = { ...RETITLED, authorships: authorships(["Patrick Butlin", "Yoshua Bengio"]) };
    const duplicates = harness({ [openAlexWorkUrl(arxivDoi)]: two, [CITERS_URL]: CITERS });
    duplicates.lookupWork.mockResolvedValue(duplicateHeavy);
    expect(await citersOf(STALE, duplicates.deps)).toEqual({ kind: "unconfirmed" });
  });
});

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
      /* Semantic Scholar's API joined the list on 2026-10-18 (plan 261018o); its website did not. */
      "https://www.semanticscholar.org/paper/1",
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
