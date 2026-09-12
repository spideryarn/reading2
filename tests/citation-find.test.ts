/**
 * **Find it on the web — what is kept, and what never is.** Citations mode's
 * stage 3, src/citation-find.ts; docs/plans/260911g-citations-mode.md § Stage 3
 * and review findings F1 and F4.
 *
 * The model is a pointer into the search's own result set and nothing more. So
 * the rules pinned here are the ones where a plausible answer would otherwise be
 * stored: a URL the model typed that the search never returned, a title the
 * model wrote in place of the result's, a result that is not the cited work, a
 * search that returned nothing. None of them may write a row.
 *
 * No network and no database: the model call and the store are injected. The
 * Postgres half — ownership, the read-back, the article-given link winning — is
 * tests/citation-find-route.test.ts.
 */
import { describe, expect, it } from "vitest";

import { ProviderRefused, type AiRequestBody, type JsonCall } from "../src/ai-call.js";
import {
  FIND_SYSTEM,
  MAX_TOTAL_RESULTS,
  findRequest,
  makeFindCitation,
  readFind,
} from "../src/citation-find.js";
import { attachFinds, pageNamesTitle } from "../src/citations.js";
import { CITATION_ALREADY_LINKED, CITATION_NO_MATCH, providerHttpFailure } from "../src/messages.js";
import type { Article, CitationFind, Citations, CitationsFound, CitedWork, BlockId } from "../src/types.js";

/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`. */
const WORK_ID = "spya-w2rk3a";
const LINKED_ID = "spya-w2rk3b";
const REF_BLOCK = "spya-r3fb2k" as BlockId;
const BODY_BLOCK = "spya-b2dy3k" as BlockId;

const TITLE = "Scaling Laws for Neural Language Models";
const PAPER = "https://arxiv.org/abs/2001.08361";
const PAPER_TITLE = "[2001.08361] Scaling Laws for Neural Language Models";

function work(over: Partial<CitedWork> = {}): CitedWork {
  return {
    id: WORK_ID,
    key: "work:scaling laws",
    title: TITLE,
    authors: "Kaplan, J.; McCandlish, S.",
    year: "2020",
    why: "The empirical curve the piece extrapolates from.",
    reference: { blockId: REF_BLOCK, quote: TITLE, start: 0 },
    mentions: [],
    citedAt: [BODY_BLOCK],
    firstCited: BODY_BLOCK,
    citedInBody: true,
    url: "https://scholar.google.com/scholar?q=x",
    linkFrom: "search",
    ...over,
  };
}

function list(works: CitedWork[]): Citations {
  return {
    version: "citations/2",
    generator: "test",
    slug: "a-piece",
    sourceHash: "h",
    citations: works,
    capped: false,
    generatedAt: "2026-09-12T00:00:00.000Z",
    elapsedMs: 1,
  };
}

const ARTICLE = {
  slug: "a-piece",
  blocks: [
    { id: REF_BLOCK, text: `Kaplan et al. (2020). ${TITLE}. arXiv preprint.` },
    { id: BODY_BLOCK, text: "The curves in Kaplan et al. suggest more." },
  ],
} as unknown as Article;

/** A whole non-streamed chat completion, as `openRouterJson` hands it back. */
function answer(opts: {
  content?: string;
  finish?: string;
  searches?: number | null;
  results?: { url: string; title?: string; content?: string }[];
}): unknown {
  return {
    choices: [
      {
        finish_reason: opts.finish ?? "stop",
        message: {
          content: opts.content ?? JSON.stringify({ url: PAPER }),
          annotations: (opts.results ?? []).map((r) => ({ type: "url_citation", url_citation: r })),
        },
      },
    ],
    ...(opts.searches === null
      ? { usage: { prompt_tokens: 1 } }
      : { usage: { server_tool_use: { web_search_requests: opts.searches ?? 1 } } }),
  };
}

const THE_PAPER = { url: PAPER, title: PAPER_TITLE, content: `Abstract. We study empirical ${TITLE.toLowerCase()} …` };
const A_REVIEW = {
  url: "https://blog.example/why-scale-matters",
  title: "Why scale matters: a reading list",
  content: "A post about compute and data, citing many papers.",
};

/** The harness: a fake reader, a store that records, a model that answers `reply`. */
function harness(reply: unknown | Error, works: CitedWork[] = [work()]) {
  const saved: { slug: string; entryId: string; find: CitationFind }[] = [];
  const sent: AiRequestBody[] = [];
  const findCitation = makeFindCitation({
    reader: {
      loadCitations: async () => ({ citations: list(works), stale: false, outdated: false }) as CitationsFound,
      loadArticle: async () => ARTICLE,
    },
    finds: {
      async save(slug, entryId, find) {
        saved.push({ slug, entryId, find });
      },
    },
    call: async (body): Promise<JsonCall> => {
      sent.push(body);
      if (reply instanceof Error) throw reply;
      return { json: reply, answeredBy: "anthropic/claude-sonnet-5", generationId: null };
    },
    now: () => "2026-09-12T10:00:00.000Z",
  });
  return { findCitation, saved, sent };
}

/* --------------------------------------------------------------- readFind -- */

describe("readFind — the model is a pointer into the result set, nothing more", () => {
  it("keeps the ANNOTATION when the model names one of the results", () => {
    const reading = readFind(answer({ results: [A_REVIEW, THE_PAPER] }), TITLE);
    expect(reading?.verdict).toEqual({
      kind: "kept",
      page: { url: PAPER, title: PAPER_TITLE, excerpt: THE_PAPER.content },
    });
    expect(reading?.results).toBe(2);
    expect(reading?.searches).toBe(1);
  });

  it("refuses a URL the search did not return, however right it looks", () => {
    const remembered = "https://arxiv.org/abs/2001.08361v2";
    const reading = readFind(
      answer({ content: JSON.stringify({ url: remembered }), results: [THE_PAPER] }),
      TITLE,
    );
    expect(reading?.verdict).toEqual({ kind: "none", why: "not-a-result" });
  });

  it("refuses a result that is not the cited work — the title must be named", () => {
    const reading = readFind(
      answer({ content: JSON.stringify({ url: A_REVIEW.url }), results: [A_REVIEW, THE_PAPER] }),
      TITLE,
    );
    expect(reading?.verdict).toEqual({ kind: "none", why: "title-mismatch" });
  });

  it("keeps nothing when the search returned nothing", () => {
    const reading = readFind(answer({ results: [], searches: 0 }), TITLE);
    expect(reading?.verdict).toEqual({ kind: "none", why: "no-results" });
    expect(reading?.searches).toBe(0);
  });

  it("keeps nothing when the model says no result is the work", () => {
    const reading = readFind(answer({ content: '{"url": null}', results: [THE_PAPER] }), TITLE);
    expect(reading?.verdict).toEqual({ kind: "none", why: "none-picked" });
  });

  it("never uses a non-web URL as a key, even one planted in the answer", () => {
    const reading = readFind(
      answer({ content: '{"url": "javascript:alert(1)"}', results: [THE_PAPER] }),
      TITLE,
    );
    expect(reading?.verdict).toEqual({ kind: "none", why: "not-a-result" });
  });

  it("reports a missing search count as null, not zero", () => {
    const reading = readFind(answer({ results: [THE_PAPER], searches: null }), TITLE);
    expect(reading?.searches).toBeNull();
    expect(reading?.searchesFrom).toBe("neither");
  });

  it("calls an answer that did not finish cleanly unreadable, not 'no match'", () => {
    expect(readFind(answer({ finish: "length", results: [THE_PAPER] }), TITLE)).toBeNull();
    expect(readFind(null, TITLE)).toBeNull();
    expect(readFind(answer({ content: "I think it is the arXiv one.", results: [THE_PAPER] }), TITLE)).toBeNull();
  });
});

describe("pageNamesTitle", () => {
  it("accepts a result whose own title names the work", () => {
    expect(pageNamesTitle({ title: PAPER_TITLE }, TITLE)).toBe(true);
  });

  it("accepts an excerpt carrying the title words as a run, in order", () => {
    expect(pageNamesTitle({ title: "arXiv", excerpt: THE_PAPER.content }, TITLE)).toBe(true);
  });

  it("refuses the same words scattered through an excerpt", () => {
    const scattered = "Neural nets need laws; language is hard; scaling models is costly.";
    expect(pageNamesTitle({ excerpt: scattered }, TITLE)).toBe(false);
  });

  it("refuses an author's page that shares nothing with the title", () => {
    expect(pageNamesTitle({ title: "Jared Kaplan — Wikipedia", excerpt: "A physicist." }, TITLE)).toBe(false);
  });

  it("never matches a one-word title by excerpt — too common to be evidence", () => {
    expect(pageNamesTitle({ excerpt: "Superintelligence is discussed here." }, "Superintelligence")).toBe(false);
  });
});

/* ----------------------------------------------------- the orchestration -- */

describe("findCitation — what is stored", () => {
  it("stores the annotation's url and title, never the model's", async () => {
    const reply = answer({
      content: JSON.stringify({ url: PAPER, title: "The Model's Own Title", doi: "10.0/made-up" }),
      results: [THE_PAPER],
    });
    const { findCitation, saved } = harness(reply);

    const result = await findCitation("a-piece", WORK_ID);

    expect(saved).toHaveLength(1);
    expect(saved[0]?.find).toEqual({
      url: PAPER,
      title: PAPER_TITLE,
      host: "arxiv.org",
      searches: 1,
      model: "anthropic/claude-sonnet-5",
      at: "2026-09-12T10:00:00.000Z",
    });
    expect(result).toEqual({
      outcome: "found",
      work: {
        ...work(),
        url: PAPER,
        linkFrom: "web",
        found: {
          title: PAPER_TITLE,
          host: "arxiv.org",
          searches: 1,
          model: "anthropic/claude-sonnet-5",
          at: "2026-09-12T10:00:00.000Z",
        },
      },
    });
  });

  it("stores nothing for a model-picked URL that was not a result", async () => {
    const { findCitation, saved } = harness(
      answer({ content: JSON.stringify({ url: "https://doi.org/10.48550/arXiv.2001.08361" }), results: [THE_PAPER] }),
    );
    expect(await findCitation("a-piece", WORK_ID)).toEqual({ outcome: "no-match", message: CITATION_NO_MATCH });
    expect(saved).toEqual([]);
  });

  it("stores nothing when the named result's title does not match the work", async () => {
    const { findCitation, saved } = harness(
      answer({ content: JSON.stringify({ url: A_REVIEW.url }), results: [A_REVIEW] }),
    );
    expect(await findCitation("a-piece", WORK_ID)).toEqual({ outcome: "no-match", message: CITATION_NO_MATCH });
    expect(saved).toEqual([]);
  });

  it("stores nothing when there are no annotations at all", async () => {
    const { findCitation, saved } = harness(answer({ results: [], searches: 3 }));
    expect(await findCitation("a-piece", WORK_ID)).toEqual({ outcome: "no-match", message: CITATION_NO_MATCH });
    expect(saved).toEqual([]);
  });

  it("is a 404 for an entry id the list does not have, and spends nothing", async () => {
    const { findCitation, sent } = harness(answer({ results: [THE_PAPER] }));
    await expect(findCitation("a-piece", "spya-n2t3h4")).rejects.toMatchObject({ status: 404 });
    expect(sent).toEqual([]);
  });

  it("is a 409 on a row whose link the article gave, and spends nothing", async () => {
    const linked = work({ id: LINKED_ID, url: "https://doi.org/10.1000/x", linkFrom: "doi" });
    const { findCitation, sent } = harness(answer({ results: [THE_PAPER] }), [work(), linked]);
    await expect(findCitation("a-piece", LINKED_ID)).rejects.toMatchObject({
      status: 409,
      message: CITATION_ALREADY_LINKED,
    });
    expect(sent).toEqual([]);
  });

  it("passes a stranger's 404 through before any call — ownership is the read", async () => {
    const sent: AiRequestBody[] = [];
    const findCitation = makeFindCitation({
      reader: {
        loadCitations: async () => {
          throw Object.assign(new Error('No article "a-piece".'), { status: 404 });
        },
        loadArticle: async () => ARTICLE,
      },
      finds: { save: async () => {} },
      call: async (body) => {
        sent.push(body);
        return { json: null, answeredBy: null, generationId: null };
      },
    });
    await expect(findCitation("a-piece", WORK_ID)).rejects.toMatchObject({ status: 404 });
    expect(sent).toEqual([]);
  });

  it("reports a refused call in the house copy, and stores nothing", async () => {
    const { findCitation, saved } = harness(new ProviderRefused(429, "busy", new Headers()));
    await expect(findCitation("a-piece", WORK_ID)).rejects.toMatchObject({
      status: 502,
      message: providerHttpFailure(429).message,
    });
    expect(saved).toEqual([]);
  });

  it("reports an unreadable answer as a failure to retry, not as no match", async () => {
    const { findCitation, saved } = harness(answer({ finish: "length", results: [THE_PAPER] }));
    await expect(findCitation("a-piece", WORK_ID)).rejects.toMatchObject({ status: 502 });
    expect(saved).toEqual([]);
  });
});

describe("the request — the only bounds on spend that exist", () => {
  it("asks Exa for a small result set, with one short prompt about this one work", () => {
    const body = findRequest(work(), ARTICLE.blocks[0]?.text ?? null, "a-model");
    expect(body.tools).toEqual([
      {
        type: "openrouter:web_search",
        parameters: { engine: "exa", max_total_results: MAX_TOTAL_RESULTS, max_results: 5 },
      },
    ]);
    expect(MAX_TOTAL_RESULTS).toBeLessThanOrEqual(5);
    expect(FIND_SYSTEM).toMatch(/ONE web search/);
    const user = (body.messages as { role: string; content: string }[])[1]?.content ?? "";
    expect(user).toContain(`Title: ${TITLE}`);
    expect(user).toContain("arXiv preprint");
  });

  it("sends the article's reference entry when the work has one", async () => {
    const { findCitation, sent } = harness(answer({ results: [THE_PAPER] }));
    await findCitation("a-piece", WORK_ID);
    const user = (sent[0]?.messages as { content: string }[] | undefined)?.[1]?.content ?? "";
    expect(user).toContain("The article's reference entry: Kaplan et al. (2020)");
  });
});

/* ---------------------------------------------------------- the read-back -- */

describe("attachFinds — a found page is read back, and never beats the article's link", () => {
  const find: CitationFind = {
    url: PAPER,
    title: PAPER_TITLE,
    host: "arxiv.org",
    searches: 1,
    model: "m",
    at: "2026-09-12T10:00:00.000Z",
  };

  it("upgrades a searched row to the found page, labelled web", () => {
    const out = attachFinds(list([work()]), new Map([[WORK_ID, find]]));
    expect(out.citations[0]).toMatchObject({ url: PAPER, linkFrom: "web", found: { host: "arxiv.org" } });
  });

  it("leaves a row the article gave a link for exactly as it was", () => {
    const doi = work({ url: "https://doi.org/10.1000/x", linkFrom: "doi" });
    const out = attachFinds(list([doi]), new Map([[WORK_ID, find]]));
    expect(out.citations[0]).toEqual(doi);
  });

  it("returns the same list when there is nothing to attach", () => {
    const citations = list([work()]);
    expect(attachFinds(citations, new Map())).toBe(citations);
  });
});
