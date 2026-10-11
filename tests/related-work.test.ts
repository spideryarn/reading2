/**
 * **Sources › Not cited** — src/related-work.ts, with no network and no
 * database: the matcher, the parse and its bounds, the query recipe, and every
 * state of the orchestration with doubles.
 * docs/plans/261011ac-sources-not-cited-related-work-it-leaves-out.md.
 *
 * The matcher is the part worth most care, because both of its errors are
 * real: a work the piece cites shown as *not in its bibliography* (the worse
 * one: it tells a reviewer the piece omits what it cites), and a work it does
 * not cite hidden because a generic title or a wrong DOI matched a row (F3).
 *
 * The OpenAlex answer is its own, recorded 2026-10-11 for the Transformer's
 * title and opening and trimmed to nine records: tests/fixtures/openalex/related-attention.json.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import type { LimiterService, ServiceLimiter, SlotLease, StartTaken } from "../src/bibliographic.js";
import { FetchFailure } from "../src/fetch.js";
import type { Log } from "../src/log.js";
import {
  MAX_ABSTRACT,
  MAX_QUERY_BODY,
  RELATED_WORK_RATE_POLICY,
  RELATED_WORK_RECIPE,
  type RelatedWorkArticle,
  type RelatedWorkLoaded,
  type RelatedWorkSearch,
  type RelatedWorkStore,
  abstractFromInvertedIndex,
  inBibliography,
  isThisPiece,
  notInBibliography,
  openAlexRelatedUrl,
  parseOpenAlexRelated,
  relatedWorkAnswer,
  relatedWorkFingerprint,
  relatedWorkInputOf,
  relatedWorkOf,
  relatedWorkQueryOf,
  searchRelatedWork,
} from "../src/related-work.js";
import { CONTACT_EMAIL } from "../src/site-text.js";
import type { AllowanceTaken, RateBucket, RatePolicy } from "../src/store/contracts.js";
import type { BlockId, CitedWork, RelatedWork } from "../src/types.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/openalex/${name}`, import.meta.url), "utf8")) as unknown;

const ANSWER = fixture("related-attention.json");

/* ------------------------------------------------------------ the builders -- */

let rowCount = 0;
/** A Bibliography row with only the fields the matcher reads set meaningfully. */
function row(over: Partial<CitedWork> & { title: string }): CitedWork {
  rowCount++;
  return {
    id: `spya-row${rowCount}`,
    key: `work:${over.title}|x|2017`,
    why: "Background.",
    mentions: [],
    citedAt: [],
    firstCited: "spya-aaaaaa" as BlockId,
    citedInBody: true,
    url: `https://scholar.google.com/scholar?q=${encodeURIComponent(over.title)}`,
    linkFrom: "search",
    ...over,
  };
}

function work(over: Partial<RelatedWork> & { title: string }): RelatedWork {
  return { openalexId: "W1", authors: ["Somebody Else"], authorCount: 1, ...over };
}

const TRANSFORMER: RelatedWorkArticle = {
  title: "Attention Is All You Need",
  byline: "Ashish Vaswani, Noam Shazeer, Niki Parmar",
  publishedYear: 2017,
};

/* ------------------------------------------------------------ the matcher -- */

describe("inBibliography: tier 1, the identifier", () => {
  it("matches a DOI to a row keyed by it, whatever its case", () => {
    const rows = [row({ title: "Something else entirely here", key: "doi:10.18653/v1/d14-1179" })];
    expect(inBibliography(work({ title: "Unrelated words in a title", doi: "10.18653/V1/D14-1179" }), rows)).toBe(true);
  });

  it("matches arXiv's DOI to a row keyed by the bare arXiv id, and the other way round", () => {
    const byArxiv = [row({ title: "Convolutional seq2seq", key: "arxiv:1705.03122" })];
    expect(inBibliography(work({ title: "Convolutional Sequence to Sequence Learning", doi: "10.48550/arxiv.1705.03122" }), byArxiv)).toBe(true);
    /* A row whose link is the arXiv abstract page, with a work: key. */
    const byLink = [row({ title: "ConvS2S", url: "https://arxiv.org/abs/1705.03122v3", linkFrom: "arxiv" })];
    expect(inBibliography(work({ title: "Different words entirely here", doi: "10.48550/arxiv.1705.03122" }), byLink)).toBe(true);
    /* And arXiv's DOI on the row, the bare id nowhere. */
    const byDoi = [row({ title: "ConvS2S", key: "doi:10.48550/arxiv.1705.03122" })];
    expect(inBibliography(work({ title: "Different words entirely here", doi: "10.48550/arxiv.1705.03122" }), byDoi)).toBe(true);
  });

  it("ignores the identifier of a row whose registry record says it is another work's", () => {
    const rows = [
      row({
        title: "Neural machine translation in linear time",
        key: "doi:10.1000/wrong",
        url: "https://doi.org/10.1000/wrong",
        linkFrom: "doi",
        registry: { kind: "conflict", source: "crossref" },
      }),
    ];
    expect(inBibliography(work({ title: "A paper about protein folding kinetics", doi: "10.1000/wrong" }), rows)).toBe(false);
    /* The row still counts by its title. */
    expect(inBibliography(work({ title: "Neural Machine Translation in Linear Time", doi: "10.1000/other" }), rows)).toBe(true);
  });

  it("does not match a different DOI", () => {
    const rows = [row({ title: "Some row title words", key: "doi:10.1000/a" })];
    expect(inBibliography(work({ title: "A wholly different paper", doi: "10.1000/b" }), rows)).toBe(false);
  });
});

describe("inBibliography: tier 2, the title", () => {
  it("matches across case, punctuation and a dropped subtitle", () => {
    const rows = [row({ title: "Sequence to sequence learning with neural networks" })];
    expect(inBibliography(work({ title: "Sequence to Sequence Learning with Neural Networks." }), rows)).toBe(true);
    const subtitled = [row({ title: "Effective approaches to attention-based neural machine translation" })];
    expect(
      inBibliography(work({ title: "Effective Approaches to Attention-based Neural Machine Translation: an empirical study" }), subtitled),
    ).toBe(true);
  });

  it("matches a row title cut at 120 characters mid-word", () => {
    const full =
      "Google's neural machine translation system: Bridging the gap between human and machine translation across the world's many languages";
    const cut = full.slice(0, 120);
    expect(cut.endsWith(" ma")).toBe(true);
    expect(inBibliography(work({ title: full }), [row({ title: cut })])).toBe(true);
  });

  it("never matches a generic title, however exactly", () => {
    const rows = [row({ title: "Introduction" }), row({ title: "Editorial" })];
    expect(inBibliography(work({ title: "Introduction" }), rows)).toBe(false);
    expect(inBibliography(work({ title: "Editorial" }), rows)).toBe(false);
  });

  it("does not take a correction or a supplement for the work", () => {
    const rows = [row({ title: "Recurrent models of visual attention" })];
    expect(inBibliography(work({ title: "Recurrent models of visual attention: correction" }), rows)).toBe(false);
  });

  it("does not match unrelated titles that share a few words", () => {
    const rows = [row({ title: "Neural machine translation by jointly learning to align and translate" })];
    expect(inBibliography(work({ title: "Convolutional Sequence to Sequence Learning" }), rows)).toBe(false);
  });
});

describe("inBibliography: tier 3, the article's own reference text", () => {
  it("finds a distinctive title inside a row's entry when the row's title is only a label", () => {
    const rows = [
      row({
        title: "Gehring et al. 2017",
        entry:
          "Jonas Gehring, Michael Auli, David Grangier, Denis Yarats, and Yann N. Dauphin. Convolutional sequence to sequence learning. arXiv preprint arXiv:1705.03122v2, 2017.",
      }),
    ];
    expect(inBibliography(work({ title: "Convolutional Sequence to Sequence Learning" }), rows)).toBe(true);
  });

  it("finds the main title before a colon when the entry gives only that", () => {
    const rows = [row({ title: "Devlin 2018", entry: "J. Devlin et al. BERT pre-training of deep bidirectional transformers. 2018." })];
    expect(
      inBibliography(work({ title: "BERT pre-training of deep bidirectional transformers: for language understanding" }), rows),
    ).toBe(true);
  });

  it("never finds a generic title in an entry", () => {
    const rows = [row({ title: "Smith 2019", entry: "A. Smith. Introduction. In: The Handbook of Things, 2019." })];
    expect(inBibliography(work({ title: "Introduction" }), rows)).toBe(false);
  });
});

describe("isThisPiece", () => {
  it("is the piece by its DOI, or its arXiv address", () => {
    expect(isThisPiece(work({ title: "Anything", doi: "10.1000/me" }), { ...TRANSFORMER, doi: "10.1000/ME" })).toBe(true);
    expect(
      isThisPiece(work({ title: "Anything", doi: "10.48550/arxiv.1706.03762" }), { ...TRANSFORMER, url: "https://arxiv.org/abs/1706.03762" }),
    ).toBe(true);
  });

  it("is the piece by its whole title and an author, or its whole title and the year", () => {
    expect(isThisPiece(work({ title: "Attention is all you need", authors: ["Ashish Vaswani"] }), TRANSFORMER)).toBe(true);
    expect(isThisPiece(work({ title: "Attention Is All You Need", authors: ["A Stranger"], year: 2017 }), TRANSFORMER)).toBe(true);
  });

  it("is never the piece by its title alone", () => {
    expect(isThisPiece(work({ title: "Attention Is All You Need", authors: ["A Stranger"], year: 2023 }), TRANSFORMER)).toBe(false);
    expect(isThisPiece(work({ title: "Attention Is All You Need", authors: ["A Stranger"] }), TRANSFORMER)).toBe(false);
  });

  it("is not the piece with a title that only begins the same way", () => {
    expect(
      isThisPiece(work({ title: "Attention Is All You Need in Speech Separation", authors: ["Ashish Vaswani"], year: 2017 }), TRANSFORMER),
    ).toBe(false);
  });
});

describe("notInBibliography", () => {
  it("drops the piece and the cited works, counting only the cited ones, and keeps OpenAlex's order", () => {
    const works = [
      work({ openalexId: "W1", title: "Attention Is All You Need", authors: ["Ashish Vaswani"], year: 2017 }),
      work({ openalexId: "W2", title: "Convolutional Sequence to Sequence Learning", doi: "10.48550/arxiv.1705.03122" }),
      work({ openalexId: "W3", title: "Recurrent Models of Visual Attention" }),
      work({ openalexId: "W4", title: "A Neural Transducer" }),
    ];
    const rows = [row({ title: "Convolutional sequence to sequence learning", key: "arxiv:1705.03122" })];
    const kept = notInBibliography(works, rows, TRANSFORMER);
    expect(kept.excluded).toBe(1);
    expect(kept.works.map((w) => w.openalexId)).toEqual(["W3", "W4"]);
  });

  it("cuts each kept work's authors to the few the panel shows, keeping the count", () => {
    const many = Array.from({ length: 12 }, (_, i) => `Author Number${i}`);
    const kept = notInBibliography([work({ title: "Structured Attention Networks", authors: many, authorCount: 12 })], [], TRANSFORMER);
    expect(kept.works[0]?.authors).toHaveLength(6);
    expect(kept.works[0]?.authorCount).toBe(12);
  });
});

/* ------------------------------------------------------------ the parsing -- */

describe("parseOpenAlexRelated", () => {
  it("reads OpenAlex's recorded answer, closest first, and drops the duplicate title", () => {
    const works = parseOpenAlexRelated(ANSWER);
    expect(works).not.toBeNull();
    const titles = (works ?? []).map((w) => w.title);
    expect(titles[0]).toBe("Convolutional Sequence to Sequence Learning");
    /* The proceedings and the arXiv versions of one paper: the first kept. */
    expect(titles.filter((t) => t === "Neural Machine Translation with Recurrent Attention Modeling")).toHaveLength(1);
    expect(works).toHaveLength(8);
    const first = works?.[0];
    expect(first).toMatchObject({
      openalexId: "W2613904329",
      doi: "10.48550/arxiv.1705.03122",
      year: 2017,
      venue: "arXiv (Cornell University)",
    });
    expect(first?.abstract?.startsWith("The prevalent approach to sequence to sequence learning")).toBe(true);
    expect((first?.abstract ?? "").length).toBeLessThanOrEqual(MAX_ABSTRACT);
    /* A record with no DOI and no abstract is still a work. */
    expect(works?.find((w) => w.title === "Sequence Modeling with Recurrent Tensor Networks")).toMatchObject({
      openalexId: "W2998907126",
    });
    expect(works?.find((w) => w.openalexId === "W2998907126")?.doi).toBeUndefined();
  });

  it("is null for an answer that is not a search's", () => {
    expect(parseOpenAlexRelated(null)).toBeNull();
    expect(parseOpenAlexRelated({ meta: {} })).toBeNull();
    expect(parseOpenAlexRelated([])).toBeNull();
  });

  it("drops a record without a W id or a title, and a malformed DOI only", () => {
    const works = parseOpenAlexRelated({
      results: [
        { id: "https://openalex.org/A123", display_name: "An author, not a work" },
        { id: "https://openalex.org/W1", display_name: "   " },
        { id: "https://evil.example/W2", display_name: "Somewhere else" },
        { id: "https://openalex.org/W3", display_name: "<b>Bold</b> &amp; plain", doi: "javascript:alert(1)" },
        { id: "https://openalex.org/W3", display_name: "The same id again" },
      ],
    });
    expect(works).toEqual([{ openalexId: "W3", title: "Bold & plain", authors: [], authorCount: 0 }]);
  });

  it("bounds what a stranger sends", () => {
    const long = "x".repeat(5000);
    const works = parseOpenAlexRelated({
      results: [
        {
          id: "W9",
          display_name: long,
          authorships: Array.from({ length: 500 }, (_, i) => ({ author: { display_name: `Name ${i} ${long}` } })),
          primary_location: { source: { display_name: long } },
          cited_by_count: -4,
        },
      ],
    });
    const only = works?.[0];
    expect(only?.title.length).toBeLessThanOrEqual(1000);
    expect(only?.authors.length).toBe(20);
    expect(only?.authorCount).toBe(500);
    expect(only?.authors[0]?.length).toBeLessThanOrEqual(200);
    expect(only?.venue?.length).toBeLessThanOrEqual(300);
    expect(only?.citedByCount).toBeUndefined();
  });

  it("re-checks a stored work, refusing one that is not a work", () => {
    expect(relatedWorkOf({ openalexId: "W1", title: "Fine", authors: ["A B"], authorCount: 1 })).toEqual({
      openalexId: "W1",
      title: "Fine",
      authors: ["A B"],
      authorCount: 1,
    });
    expect(relatedWorkOf({ openalexId: "javascript:x", title: "No" })).toBeNull();
    expect(relatedWorkOf({ openalexId: "W1", title: "" })).toBeNull();
    expect(relatedWorkOf({ openalexId: "W1", title: "T", doi: "not a doi" })?.doi).toBeUndefined();
  });
});

describe("abstractFromInvertedIndex", () => {
  it("puts the words back in their places and cuts at a word", () => {
    expect(abstractFromInvertedIndex({ world: [1], hello: [0], again: [3], "<i>big</i>": [2] })).toBe("hello world big again");
    const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`word${i}`, [i]]));
    const text = abstractFromInvertedIndex(many) ?? "";
    expect(text.length).toBeLessThanOrEqual(MAX_ABSTRACT);
    expect(text.endsWith(" ")).toBe(false);
    expect(/word\d+$/.test(text)).toBe(true);
  });

  it("ignores positions out of range or not integers, and is null with nothing", () => {
    expect(abstractFromInvertedIndex({ a: [-1, 1.5, 1e9, "0"], b: [0] })).toBe("b");
    expect(abstractFromInvertedIndex(null)).toBeNull();
    expect(abstractFromInvertedIndex({})).toBeNull();
    expect(abstractFromInvertedIndex([["a", [0]]])).toBeNull();
  });

  it("stops reading a huge index", () => {
    const huge = { a: Array.from({ length: 100_000 }, (_, i) => i + 1_000), b: [0] };
    /* `b` comes after the bound on positions, so it is never reached. */
    expect(abstractFromInvertedIndex(huge)).toBeNull();
  });
});

/* ------------------------------------------------------------ the recipe -- */

describe("the query recipe", () => {
  it("is the title then the abstract when there is one", () => {
    expect(relatedWorkQueryOf({ ...TRANSFORMER, abstract: "The dominant models." }, ["Ignored prose."])).toBe(
      "Attention Is All You Need The dominant models.",
    );
  });

  it("is the title then the opening paragraphs, cut at a word at the limit", () => {
    const para = "word ".repeat(400);
    const query = relatedWorkQueryOf(TRANSFORMER, [para, "second paragraph"]) ?? "";
    const body = query.slice("Attention Is All You Need ".length);
    expect(body.length).toBeLessThanOrEqual(MAX_QUERY_BODY);
    expect(body.length).toBeGreaterThan(MAX_QUERY_BODY - 6);
    expect(body.endsWith("word")).toBe(true);
  });

  it("is the title alone with no prose, the prose alone with no title, and null with neither", () => {
    expect(relatedWorkQueryOf(TRANSFORMER, [])).toBe("Attention Is All You Need");
    expect(relatedWorkQueryOf({ title: null }, ["Some prose."])).toBe("Some prose.");
    expect(relatedWorkQueryOf({ title: null }, [])).toBeNull();
    expect(relatedWorkQueryOf({ title: "  " }, ["  "])).toBeNull();
  });

  it("limits by year only when the year is known, and the fingerprint follows both", () => {
    const withYear = relatedWorkInputOf({ article: TRANSFORMER, opening: [] });
    expect(withYear?.yearLimit).toBe(2017);
    const fromDate = relatedWorkInputOf({ article: { title: "A title here", publishedAt: "2016-05-01" }, opening: [] });
    expect(fromDate?.yearLimit).toBe(2016);
    const noYear = relatedWorkInputOf({ article: { title: "Attention Is All You Need" }, opening: [] });
    expect(noYear?.yearLimit).toBeNull();
    expect(withYear?.fingerprint).not.toBe(noYear?.fingerprint);
    expect(withYear?.fingerprint).toMatch(new RegExp(`^${RELATED_WORK_RECIPE.replace("/", "\\/")}:[0-9a-f]{64}$`));
    expect(relatedWorkFingerprint("q", 2017)).toBe(relatedWorkFingerprint("q", 2017));
    expect(relatedWorkFingerprint("q", 2017)).not.toBe(relatedWorkFingerprint("q ", 2017));
  });

  it("builds the address with every value encoded, and the filter its own parameter", () => {
    const url = new URL(openAlexRelatedUrl("x&filter=type:book AND y", 2017));
    expect(url.origin + url.pathname).toBe("https://api.openalex.org/works");
    expect(url.searchParams.get("search.semantic")).toBe("x&filter=type:book AND y");
    expect(url.searchParams.getAll("filter")).toEqual(["publication_year:<2018"]);
    expect(url.searchParams.get("per_page")).toBe("25");
    expect(url.searchParams.get("mailto")).toBe(CONTACT_EMAIL);
    expect(url.searchParams.get("select")).toContain("abstract_inverted_index");
    expect(new URL(openAlexRelatedUrl("q", null)).searchParams.has("filter")).toBe(false);
  });
});

/* ------------------------------------------------------- the orchestration -- */

class MemoryLimiter implements ServiceLimiter {
  cooling = new Map<LimiterService, number>();
  async coolingDown(service: LimiterService) {
    return (this.cooling.get(service) ?? 0) > Date.now();
  }
  async takeSlot(service: LimiterService, leaseMs: number): Promise<SlotLease> {
    return { service, slot: 1, until: new Date(Date.now() + leaseMs) };
  }
  async freeSlot() {}
  async takeStart(service: LimiterService): Promise<StartTaken> {
    return (await this.coolingDown(service)) ? { kind: "cooling-down" } : { kind: "start", waitMs: 0 };
  }
  async coolDown(service: LimiterService, forMs: number) {
    this.cooling.set(service, Date.now() + forMs);
  }
}

class MemoryStore implements RelatedWorkStore {
  writes: { articleId: string; search: RelatedWorkSearch }[] = [];
  fail = false;
  async write(articleId: string, search: RelatedWorkSearch): Promise<string> {
    if (this.fail) throw new Error("insert failed: params: Attention Is All You Need");
    this.writes.push({ articleId, search });
    return "2026-10-11T12:00:00.000Z";
  }
}

class MemoryAllowance {
  taken: { bucket: RateBucket; policy: RatePolicy }[] = [];
  finished: string[] = [];
  answer: AllowanceTaken = { kind: "allowed", id: "token-1" };
  async take(bucket: RateBucket, policy: RatePolicy): Promise<AllowanceTaken> {
    this.taken.push({ bucket, policy });
    return this.answer;
  }
  async finish(id: string): Promise<void> {
    this.finished.push(id);
  }
}

function recordingLog(): { entries: object[]; logger: Log } {
  const entries: object[] = [];
  const write = (value: object | string) => {
    if (typeof value === "object") entries.push(value);
  };
  const logger: Log = { debug: write, info: write, warn: write, error: write, child: () => logger };
  return { entries, logger };
}

const OPENING = ["The dominant sequence transduction models are based on complex recurrent or convolutional neural networks."];

function loaded(over: Partial<RelatedWorkLoaded> = {}): RelatedWorkLoaded {
  return {
    articleId: "11111111-1111-4111-8111-111111111111",
    article: TRANSFORMER,
    opening: OPENING,
    bibliography: {
      citations: [
        row({
          title: "Gehring et al. 2017",
          key: "arxiv:1705.03122",
          entry: "Jonas Gehring et al. Convolutional sequence to sequence learning. arXiv:1705.03122, 2017.",
        }),
      ],
      stale: false,
      capped: false,
    },
    stored: null,
    ...over,
  };
}

function harness(answer: unknown | FetchFailure = ANSWER) {
  const store = new MemoryStore();
  const allowance = new MemoryAllowance();
  const limiter = new MemoryLimiter();
  const { entries, logger } = recordingLog();
  const asked: string[] = [];
  const fetchJson = vi.fn(async (url: string) => {
    asked.push(url);
    if (answer instanceof FetchFailure) throw answer;
    return answer;
  });
  return { store, allowance, limiter, entries, asked, deps: { store, allowance, limiter, fetchJson, sleep: async () => {}, log: logger } };
}

describe("searchRelatedWork (POST)", () => {
  it("searches once, keeps the parsed answer, and answers it filtered", async () => {
    const h = harness();
    const result = await searchRelatedWork(loaded(), h.deps);
    const input = relatedWorkInputOf(loaded());
    expect(h.asked).toEqual([openAlexRelatedUrl(input?.query ?? "", 2017)]);
    expect(h.allowance.taken).toEqual([{ bucket: "related-work-search", policy: RELATED_WORK_RATE_POLICY }]);
    expect(h.allowance.finished).toEqual(["token-1"]);
    expect(h.store.writes).toHaveLength(1);
    expect(h.store.writes[0]?.search.fingerprint).toBe(input?.fingerprint);
    expect(h.store.writes[0]?.search.yearLimit).toBe(2017);
    /* All eight are kept: the exclusion is at read time, never at write. */
    expect(h.store.writes[0]?.search.works).toHaveLength(8);
    expect(result).toMatchObject({
      kind: "found",
      excluded: 1,
      bibliographyStale: false,
      bibliographyCapped: false,
      yearLimited: 2017,
      queryChanged: false,
      searchedAt: "2026-10-11T12:00:00.000Z",
    });
    if (result.kind !== "found") throw new Error("not found");
    expect(result.works).toHaveLength(7);
    expect(result.works.map((w) => w.title)).not.toContain("Convolutional Sequence to Sequence Learning");
  });

  it("says no-bibliography and no-query without asking anything or taking any allowance", async () => {
    const h = harness();
    expect(await searchRelatedWork(loaded({ bibliography: null }), h.deps)).toEqual({ kind: "no-bibliography" });
    expect(await searchRelatedWork(loaded({ article: { title: null }, opening: [] }), h.deps)).toEqual({ kind: "no-query" });
    expect(h.asked).toEqual([]);
    expect(h.allowance.taken).toEqual([]);
  });

  it("is rate-limited when the allowance refuses, and asks nothing", async () => {
    const h = harness();
    h.allowance.answer = { kind: "global" };
    expect(await searchRelatedWork(loaded(), h.deps)).toEqual({ kind: "rate-limited" });
    expect(h.asked).toEqual([]);
    expect(h.allowance.finished).toEqual([]);
  });

  it("is unavailable, storing nothing, when OpenAlex fails, and a 429 cools the service", async () => {
    const h = harness(new FetchFailure("server-error", "https://api.openalex.org/", "HTTP 429", { status: 429 }));
    expect(await searchRelatedWork(loaded(), h.deps)).toEqual({ kind: "unavailable" });
    expect(h.store.writes).toEqual([]);
    expect(await h.limiter.coolingDown("openalex")).toBe(true);
    expect(h.allowance.finished).toEqual(["token-1"]);
    /* Cooling: the next press asks nothing. */
    h.asked.length = 0;
    expect(await searchRelatedWork(loaded(), h.deps)).toEqual({ kind: "unavailable" });
    expect(h.asked).toEqual([]);
  });

  it("is unavailable for an answer that is not a search's", async () => {
    const h = harness({ error: "nope" });
    expect(await searchRelatedWork(loaded(), h.deps)).toEqual({ kind: "unavailable" });
    expect(h.store.writes).toEqual([]);
  });

  it("is unavailable when the write fails, and logs nothing of the article's words", async () => {
    const h = harness();
    h.store.fail = true;
    expect(await searchRelatedWork(loaded(), h.deps)).toEqual({ kind: "unavailable" });
    expect(h.allowance.finished).toEqual(["token-1"]);
    const logged = JSON.stringify(h.entries);
    expect(logged).not.toContain("Attention");
    expect(logged).not.toContain("dominant");
    expect(logged).not.toContain("openalex.org/works");
    expect(logged).toContain("internal-error");
  });

  it("logs only ids, outcomes and counts on success", async () => {
    const h = harness();
    await searchRelatedWork(loaded(), h.deps);
    const logged = JSON.stringify(h.entries);
    expect(logged).not.toContain("Attention");
    expect(logged).not.toContain("Convolutional");
    expect(logged).not.toContain(RELATED_WORK_RECIPE);
    expect(h.entries).toContainEqual(expect.objectContaining({ outcome: "found", listed: 7, excluded: 1, returned: 8 }));
  });
});

describe("relatedWorkAnswer (GET)", () => {
  const stored = (over: Partial<RelatedWorkLoaded["stored"] & object> = {}) => ({
    fingerprint: relatedWorkInputOf(loaded())?.fingerprint ?? "",
    yearLimit: 2017,
    works: parseOpenAlexRelated(ANSWER) ?? [],
    searchedAt: "2026-10-01T00:00:00.000Z",
    ...over,
  });

  it("is not-searched with nothing kept, and never asks anything", () => {
    expect(relatedWorkAnswer(loaded())).toEqual({ kind: "not-searched" });
  });

  it("says no-bibliography and no-query before anything kept", () => {
    expect(relatedWorkAnswer(loaded({ bibliography: null, stored: stored() }))).toEqual({ kind: "no-bibliography" });
    expect(relatedWorkAnswer(loaded({ article: { title: null }, opening: [], stored: stored() }))).toEqual({ kind: "no-query" });
  });

  it("filters the kept search against the Bibliography as it is now", () => {
    const before = relatedWorkAnswer(loaded({ stored: stored() }));
    expect(before).toMatchObject({ kind: "found", excluded: 1, searchedAt: "2026-10-01T00:00:00.000Z" });
    const remade = loaded({
      stored: stored(),
      bibliography: {
        citations: [row({ title: "A neural transducer for streaming speech", key: "doi:10.48550/arxiv.1511.04868" })],
        stale: true,
        capped: true,
      },
    });
    const after = relatedWorkAnswer(remade);
    expect(after).toMatchObject({ kind: "found", excluded: 1, bibliographyStale: true, bibliographyCapped: true });
    if (after.kind !== "found") throw new Error("not found");
    expect(after.works.map((w) => w.title)).toContain("Convolutional Sequence to Sequence Learning");
    expect(after.works.map((w) => w.title)).not.toContain("A Neural Transducer");
  });

  it("says when the article no longer asks what was searched", () => {
    const changed = relatedWorkAnswer(loaded({ stored: stored({ fingerprint: relatedWorkFingerprint("older words", 2017) }) }));
    expect(changed).toMatchObject({ kind: "found", queryChanged: true });
    const noYear = relatedWorkAnswer(loaded({ stored: stored({ yearLimit: null }) }));
    expect(noYear).toMatchObject({ kind: "found", yearLimited: null });
  });
});
