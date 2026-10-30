/**
 * **Possible citations, from OpenAlex's full text** — src/citation-fulltext.ts,
 * with no network and no database: a scripted `fetchJson` and an in-memory
 * limiter. Plan 261026f; the numbers in the cases are the investigation's
 * (docs/investigations/261026a-cited-by-with-no-doi-full-text-and-web-search-recall-and-cost.md).
 *
 * What is worth holding is mostly what must not happen: an upload's title
 * sent out, a phrase taken for a piece, the piece's own record listed as its
 * citer, a title able to add a filter, and the phrase reaching a log line.
 */
import { describe, expect, it, vi } from "vitest";

import type { LimiterService, ServiceLimiter, SlotLease, StartTaken } from "../src/bibliographic.js";
import type { CitationIndexStore } from "../src/citation-index.js";
import {
  MIN_WORDS_WITHOUT_YEAR,
  POSSIBLE_PER_PAGE,
  type PossibleIdentity,
  fulltextQuestionOf,
  isCommonPhrase,
  isThePiecesOwnRecord,
  openAlexFulltextUrl,
  orderFor,
  possibleCitersOf,
} from "../src/citation-fulltext.js";
import { FetchFailure } from "../src/fetch.js";
import type { Log } from "../src/log.js";

/* ------------------------------------------------------------ the doubles -- */

class MemoryLimiter implements ServiceLimiter {
  turns: LimiterService[] = [];
  async coolingDown() {
    return false;
  }
  async takeSlot(service: LimiterService, leaseMs: number): Promise<SlotLease> {
    return { service, slot: 1, until: new Date(Date.now() + leaseMs) };
  }
  async freeSlot() {}
  async takeStart(service: LimiterService): Promise<StartTaken> {
    this.turns.push(service);
    return { kind: "start", waitMs: 0 };
  }
  async coolDown() {}
}

/** Never read: the full-text list has no cache. Present so no test opens a database. */
const NO_STORE: CitationIndexStore = {
  read: async () => {
    throw new Error("the full-text list must not read the citers cache");
  },
  write: async () => {
    throw new Error("the full-text list must not write the citers cache");
  },
};

function recordingLog(): { lines: string[]; logger: Log } {
  const lines: string[] = [];
  const write = (fields: object | string, msg?: string) => lines.push(JSON.stringify([fields, msg]));
  const logger = { info: write, warn: write, error: write, debug: write, child: () => logger } as unknown as Log;
  return { lines, logger };
}

function harness(answer: (url: string) => unknown) {
  const asked: string[] = [];
  const fetchJson = vi.fn(async (url: string) => {
    asked.push(url);
    const got = answer(url);
    if (got instanceof FetchFailure) throw got;
    return got;
  });
  const log = recordingLog();
  const deps = {
    store: NO_STORE,
    limiter: new MemoryLimiter(),
    fetchJson,
    sleep: async () => {},
    log: log.logger,
    now: () => new Date("2026-10-26T12:00:00Z"),
  };
  return { asked, deps, log };
}

/** One OpenAlex works page: `count` in all, these records on it. */
function page(count: number, works: { id: string; title: string; year?: number; cited?: number }[] = []) {
  return {
    meta: { count },
    results: works.map((w) => ({
      id: `https://openalex.org/${w.id}`,
      display_name: w.title,
      publication_year: w.year ?? 2026,
      cited_by_count: w.cited ?? 0,
      authorships: [{ author: { display_name: "A. Researcher" } }],
      type: "preprint",
    })),
  };
}

const failure = (status: number) => new FetchFailure("server-error", "https://api.openalex.org/", `HTTP ${status}`, { status });

/* ------------------------------------------------------------ the pieces -- */

/** The reported piece: no year, and a byline that is the word *Authors*. */
const WORKSPACE: PossibleIdentity = {
  title: "Verbalizable Representations Form a Global Workspace in Language Models",
  byline: "Authors",
  url: "https://transformer-circuits.pub/2026/workspace/index.html",
};
const WENG: PossibleIdentity = {
  title: "LLM Powered Autonomous Agents",
  byline: "Lilian Weng",
  url: "https://lilianweng.github.io/posts/2023-06-23-agent/",
  publishedAt: "2023-06-23",
};
const DEVIANCE: PossibleIdentity = { title: "Normalization of deviance", url: "https://danluu.com/wat/", publishedYear: 2015 };

/* ----------------------------------------------------------- the question -- */

const NOW = 2026;

/** `WENG` without the fields named: `exactOptionalPropertyTypes` will not take an `undefined`. */
function without(identity: PossibleIdentity, ...keys: (keyof PossibleIdentity)[]): PossibleIdentity {
  const copy: Record<string, unknown> = { ...identity };
  for (const key of keys) delete copy[key];
  return copy as unknown as PossibleIdentity;
}

describe("whether to ask, and with what words", () => {
  it("never sends an uploaded file's title, nor one with no public address", () => {
    expect(fulltextQuestionOf({ ...WENG, filename: "draft.pdf" }, NOW)).toBeNull();
    expect(fulltextQuestionOf(without(WENG, "url"), NOW)).toBeNull();
    expect(fulltextQuestionOf({ ...WENG, url: "file:///Users/me/draft.html" }, NOW)).toBeNull();
  });

  it("does not ask for a title too plain to be the piece's own", () => {
    expect(fulltextQuestionOf({ title: "Simulators", url: "https://generative.ink/posts/simulators/", publishedYear: 2022 }, NOW)).toBeNull();
  });

  it(`asks with no year only for a title of ${MIN_WORDS_WITHOUT_YEAR} words or more`, () => {
    expect(fulltextQuestionOf(WORKSPACE, NOW)).toEqual({
      phrase: "verbalizable representations form a global workspace in language models",
      year: undefined,
    });
    expect(fulltextQuestionOf(without(WENG, "publishedAt"), NOW)).toBeNull();
    expect(fulltextQuestionOf(WENG, NOW)).toEqual({ phrase: "llm powered autonomous agents", year: 2023 });
  });

  it("takes a year after this one as no year, so its windows are never empty or ahead of now", () => {
    expect(fulltextQuestionOf({ ...WORKSPACE, publishedYear: 2027 }, NOW)?.year).toBeUndefined();
    expect(fulltextQuestionOf({ ...WORKSPACE, publishedYear: 2100 }, NOW)?.year).toBeUndefined();
    expect(fulltextQuestionOf({ ...WENG, publishedAt: "2100-01-01" }, NOW)).toBeNull(); // four words, and now no year
    expect(fulltextQuestionOf({ ...WORKSPACE, publishedYear: 2026 }, NOW)?.year).toBe(2026);
  });

  it("keeps an apostrophe inside a word, which the full-text index needs (Don't: 31 works, dont: none)", () => {
    const graham: PossibleIdentity = { title: "Do Things that Don’t Scale", url: "https://paulgraham.com/ds.html", publishedYear: 2013 };
    expect(fulltextQuestionOf(graham, NOW)?.phrase).toBe("do things that don't scale");
    expect(fulltextQuestionOf({ ...graham, title: "'Quoted' Things That Don't Scale Well" }, NOW)?.phrase).toBe(
      "quoted things that don't scale well",
    );
  });

  it("sends a hostile title as lower-case words that cannot close the phrase or add a filter (Sol's F4)", () => {
    const hostile: PossibleIdentity = {
      title: 'Agents" OR fulltext.search:"x",publication_year:1900|cites:W1 AND Reasoning: Engines',
      url: "https://example.org/post",
      publishedYear: 2024,
    };
    const question = fulltextQuestionOf(hostile, NOW);
    expect(question?.phrase).toBe("agents or fulltext search x publication year 1900 cites w1 and reasoning engines");
    const url = new URL(openAlexFulltextUrl(question!.phrase, { from: 2023, to: 2026 }, { perPage: 25, order: "newest" }));
    expect(url.searchParams.get("filter")).toBe(
      'fulltext.search:"agents or fulltext search x publication year 1900 cites w1 and reasoning engines",publication_year:2023-2026',
    );
    expect(url.searchParams.getAll("filter")).toHaveLength(1);
  });
});

/* --------------------------------------------------------------- the gate -- */

describe("a phrase, not a piece", () => {
  it("is decided by the works from before the piece existed (the investigation's counts)", () => {
    expect(isCommonPhrase(176, 1031, 2015, 2026)).toBe(true); // Normalization of deviance
    expect(isCommonPhrase(374_250, 327_679, 2022, 2026)).toBe(true); // Simulators, were it asked
    expect(isCommonPhrase(3, 3, 2023, 2026)).toBe(true); // How to Do Great Work
    expect(isCommonPhrase(4, 1462, 2015, 2026)).toBe(false); // Understanding LSTM Networks
    expect(isCommonPhrase(0, 278, 2023, 2026)).toBe(false); // LLM Powered Autonomous Agents
  });

  it("does not let one or two early works hide a small list, and three is the floor (Sol's F3)", () => {
    expect(isCommonPhrase(0, 0, 2022, 2026)).toBe(false);
    expect(isCommonPhrase(1, 3, 2022, 2026)).toBe(false); // More Is Different for AI
    expect(isCommonPhrase(2, 0, 2022, 2026)).toBe(false);
    expect(isCommonPhrase(3, 0, 2022, 2026)).toBe(true); // nothing since: a phrase, not a piece
  });

  it("is strictly above 5% of the rate since, not at it", () => {
    /* 9 before is one a year; 2023 to 2026 with the year before is five years. */
    expect(isCommonPhrase(9, 100, 2023, 2026)).toBe(false); // exactly 5%
    expect(isCommonPhrase(9, 99, 2023, 2026)).toBe(true);
  });

  it("counts the current year as two years since (the year before, and this one)", () => {
    expect(isCommonPhrase(9, 40, 2026, 2026)).toBe(false); // 1 a year against 20 a year: exactly 5%
    expect(isCommonPhrase(9, 39, 2026, 2026)).toBe(true);
  });
});

describe("the piece's own record", () => {
  it("is its title, or its title after a leading A, An or The", () => {
    expect(isThePiecesOwnRecord("A Verbalizable Representations Form a Global Workspace in Language Models", WORKSPACE.title)).toBe(true);
    expect(isThePiecesOwnRecord("LLM powered autonomous agents.", WENG.title)).toBe(true);
    expect(isThePiecesOwnRecord("The Extended Mind", "Extended mind")).toBe(true);
  });

  it("is not a reply, a comment or a revisit whose title contains it (Sol's F5)", () => {
    const piece = "Heuristics That Almost Always Work";
    expect(isThePiecesOwnRecord(`Response to ${piece}`, piece)).toBe(false);
    expect(isThePiecesOwnRecord(`Comment on ${piece}`, piece)).toBe(false);
    expect(isThePiecesOwnRecord(`Revisiting ${piece}`, piece)).toBe(false);
    expect(isThePiecesOwnRecord(`Response to (Scott Alexander): ${piece}`, piece)).toBe(false);
    expect(isThePiecesOwnRecord("Dialogue with Socrates: LLM-Powered Autonomous Agents in Healthcare", WENG.title)).toBe(false);
  });
});

describe("the order", () => {
  it("is newest first for a recent piece or one with no year, most cited first otherwise", () => {
    expect(orderFor(undefined, 2026)).toBe("newest");
    expect(orderFor(2025, 2026)).toBe("newest");
    expect(orderFor(2023, 2026)).toBe("most-cited");
  });
});

/* ---------------------------------------------------------- the requests -- */

describe("possibleCitersOf", () => {
  it("asks nothing at all for an upload, an address-less article, or a plain title", async () => {
    const h = harness(() => page(0));
    expect(await possibleCitersOf({ ...WENG, filename: "mine.pdf" }, h.deps)).toBeNull();
    expect(await possibleCitersOf(without(WENG, "url"), h.deps)).toBeNull();
    expect(
      await possibleCitersOf({ title: "Simulators", url: "https://generative.ink/posts/simulators/", publishedYear: 2022 }, h.deps),
    ).toBeNull();
    expect(h.asked).toEqual([]);
  });

  it("with no year, asks one page newest first and lists everything but the piece's own record", async () => {
    const h = harness(() =>
      page(134, [
        { id: "W1", title: "A Verbalizable Representations Form a Global Workspace in Language Models" },
        { id: "W2", title: "Reader--Writer Coupling in Transformer MLPs" },
        { id: "W3", title: "Interpreting Model Reasoning through Behavioral Counterfactuals" },
      ]),
    );
    const got = await possibleCitersOf(WORKSPACE, h.deps);
    expect(h.asked).toHaveLength(1);
    const url = new URL(h.asked[0]!);
    expect(url.searchParams.get("filter")).toBe('fulltext.search:"verbalizable representations form a global workspace in language models"');
    expect(url.searchParams.get("sort")).toBe("publication_date:desc");
    expect(url.searchParams.get("per_page")).toBe(String(POSSIBLE_PER_PAGE));
    expect(got).toMatchObject({ kind: "found", total: 134, dropped: 1, order: "newest", fromYear: null, toYear: null });
    expect(got?.kind === "found" ? got.citers.map((c) => c.openalexId) : []).toEqual(["W2", "W3"]);
  });

  it("with a year, counts the works before it first, and lists from the year before it through now", async () => {
    const h = harness((url) =>
      new URL(url).searchParams.get("per_page") === "1" ? page(0) : page(278, [{ id: "W9", title: "ChatDev", year: 2024, cited: 446 }]),
    );
    const got = await possibleCitersOf(WENG, h.deps);
    expect(h.asked).toHaveLength(2);
    expect(new URL(h.asked[0]!).searchParams.get("filter")).toBe('fulltext.search:"llm powered autonomous agents",publication_year:2013-2021');
    expect(new URL(h.asked[1]!).searchParams.get("filter")).toBe('fulltext.search:"llm powered autonomous agents",publication_year:2022-2026');
    expect(new URL(h.asked[1]!).searchParams.get("sort")).toBe("cited_by_count:desc,publication_date:desc");
    expect(got).toMatchObject({ kind: "found", total: 278, order: "most-cited", fromYear: 2022, toYear: 2026 });
  });

  it("says common-phrase, and lists nothing, when the gate fires", async () => {
    const h = harness((url) =>
      new URL(url).searchParams.get("per_page") === "1" ? page(176) : page(1031, [{ id: "W5", title: "Challenger launch decision" }]),
    );
    expect(await possibleCitersOf(DEVIANCE, h.deps)).toEqual({ kind: "common-phrase" });
  });

  it("says none when OpenAlex has no such work, or only the piece's own record", async () => {
    expect(await possibleCitersOf(WORKSPACE, harness(() => page(0)).deps)).toEqual({ kind: "none" });
    const own = harness(() => page(1, [{ id: "W1", title: WORKSPACE.title }]));
    expect(await possibleCitersOf(WORKSPACE, own.deps)).toEqual({ kind: "none" });
  });

  it("does not say none when a nonzero page is malformed or has unseen rows after an own record", async () => {
    const malformed = harness(() => ({ meta: { count: 7 }, results: [{ id: "not-an-openalex-id" }] }));
    expect(await possibleCitersOf(WORKSPACE, malformed.deps)).toMatchObject({
      kind: "found",
      total: 7,
      dropped: 1,
      citers: [],
    });

    const partialOwn = harness(() => page(2, [{ id: "W1", title: WORKSPACE.title }]));
    expect(await possibleCitersOf(WORKSPACE, partialOwn.deps)).toMatchObject({
      kind: "found",
      total: 2,
      dropped: 1,
      citers: [],
    });
  });

  it("is unavailable when either request fails, and never logs the phrase", async () => {
    const first = harness(() => failure(503));
    expect(await possibleCitersOf(WENG, first.deps)).toEqual({ kind: "unavailable" });
    expect(first.asked).toHaveLength(1);

    const second = harness((url) => (new URL(url).searchParams.get("per_page") === "1" ? page(0) : failure(500)));
    expect(await possibleCitersOf(WENG, second.deps)).toEqual({ kind: "unavailable" });

    const thrown = harness(() => {
      throw new Error("boom at https://api.openalex.org/works?filter=fulltext.search:%22llm%20powered%20autonomous%20agents%22");
    });
    expect(await possibleCitersOf(WENG, thrown.deps)).toEqual({ kind: "unavailable" });

    for (const h of [first, second, thrown]) {
      const logged = h.log.lines.join("\n").toLowerCase();
      expect(logged).not.toContain("autonomous");
      expect(logged).not.toContain("fulltext.search");
    }
  });

  it("logs the outcome and counts, never the words", async () => {
    const h = harness((url) => (new URL(url).searchParams.get("per_page") === "1" ? page(0) : page(278, [{ id: "W9", title: "ChatDev" }])));
    await possibleCitersOf(WENG, h.deps);
    const logged = h.log.lines.join("\n");
    expect(logged).toContain('"outcome":"found"');
    expect(logged.toLowerCase()).not.toContain("autonomous");
  });
});
