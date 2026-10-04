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
 * No network and no database: the model call and the store are injected, and
 * the lookup is driven as its one caller drives it — `runCitationLookup`, the
 * first step of *Investigate* (src/citation-investigate.ts). The route these
 * cases used to go through, `POST /api/citations/:slug/:id/find`, was deleted on
 * 2026-10-04 with its own wrapper's cases (the 404s, its allowance, its model
 * choice); Investigate's equivalents are tests/citation-investigate.test.ts.
 * The Postgres half — a stored find read back through `GET /api/citations/:slug`,
 * the article-given link winning — is tests/citation-finds-read-back-pg.test.ts.
 */
import { describe, expect, it } from "vitest";

import { HIGH_POWER_MODEL_OPENROUTER } from "../src/models.js";

import { ProviderRefused, type AiRequestBody, type JsonCall } from "../src/ai-call.js";
import {
  FIND_SYSTEM,
  MAX_TOTAL_RESULTS,
  findRequest,
  findWorkPage,
  LOOKUP_ANSWER_TOKENS,
  LOOKUP_SYSTEM,
  lookupPrompt,
  readFind,
  runCitationLookup,
} from "../src/citation-find.js";
import { lookupContext } from "../src/citation-lookup.js";
import { attachFinds, pageNamesTitle } from "../src/citations.js";
import { CITATION_LOOKUP_NO_MATCH, CITATION_NO_MATCH, providerHttpFailure } from "../src/messages.js";
import type { Article, CitationFind, Citations, CitedWork, BlockId } from "../src/types.js";

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
/* A result with an extract that names the first author and the year — enough
   for R-1's stricter identity rule, where `THE_PAPER` is enough only for the
   link. */
const EXTRACT =
  "Jared Kaplan, Sam McCandlish (2020). We study empirical scaling laws for language model performance. " +
  "The loss scales as a power-law with model size, dataset size, and compute.";
const NAMED_PAPER = { url: PAPER, title: PAPER_TITLE, content: EXTRACT };
const DOI_PAGE = { url: "https://publisher.example/doi/10.1000/x", title: TITLE, content: EXTRACT };
const SUPPORT_QUOTE = "The loss scales as a power-law with model size";
const DOES_QUOTE = "We study empirical scaling laws for language model performance";
const JUDGED = {
  url: DOI_PAGE.url,
  paperDoes: "It measures how a language model's loss falls as the model grows.",
  paperDoesQuote: DOES_QUOTE,
  support: "supports",
  supportQuote: SUPPORT_QUOTE,
};

const A_REVIEW = {
  url: "https://blog.example/why-scale-matters",
  title: "Why scale matters: a reading list",
  content: "A post about compute and data, citing many papers.",
};

/** The model the caller resolved. Its own choice is tests/citation-investigate.test.ts. */
const MODEL = "anthropic/claude-sonnet-5";

/**
 * The harness: a store that records and a model that answers `reply`, behind
 * `runCitationLookup`. `lookUp` resolves the row from `works` as the caller
 * does; an id the list lacks is the caller's 404 and is not reachable here.
 */
function harness(reply: unknown | Error, works: CitedWork[] = [work()], model: string = MODEL) {
  const saved: { slug: string; entryId: string; find: CitationFind }[] = [];
  const sent: AiRequestBody[] = [];
  const lookUp = async (slug: string, entryId: string) => {
    const listed = works.find((w) => w.id === entryId);
    if (!listed) throw new Error(`the test asked for ${entryId}, which its list does not have`);
    return runCitationLookup(
      {
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
      },
      slug,
      entryId,
      listed,
      ARTICLE,
      model,
    );
  };
  return { lookUp, saved, sent };
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

describe("runCitationLookup — what is stored", () => {
  it("stores the annotation's url and title, never the model's", async () => {
    const reply = answer({
      content: JSON.stringify({ url: PAPER, title: "The Model's Own Title", doi: "10.0/made-up" }),
      results: [THE_PAPER],
    });
    const { lookUp, saved } = harness(reply);

    const result = await lookUp("a-piece", WORK_ID);

    /* The result names neither the first author nor the year, so the link is
       kept (Find it's rule) but nothing is read from it (R-1's stricter one). */
    const lookup = {
      state: "not-identified",
      host: "arxiv.org",
      searches: 1,
      model: "anthropic/claude-sonnet-5",
      at: "2026-09-12T10:00:00.000Z",
      contextHash: expect.stringMatching(/^[0-9a-f]{16}$/),
      evidenceHash: expect.stringMatching(/^[0-9a-f]{16}$/),
    };
    expect(saved).toHaveLength(1);
    expect(saved[0]?.find).toEqual({
      url: PAPER,
      title: PAPER_TITLE,
      host: "arxiv.org",
      searches: 1,
      model: "anthropic/claude-sonnet-5",
      at: "2026-09-12T10:00:00.000Z",
      lookup,
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
      lookup,
    });
  });

  it("stores nothing for a model-picked URL that was not a result", async () => {
    const { lookUp, saved } = harness(
      answer({ content: JSON.stringify({ url: "https://doi.org/10.48550/arXiv.2001.08361" }), results: [THE_PAPER] }),
    );
    expect(await lookUp("a-piece", WORK_ID)).toEqual({ outcome: "no-match", message: CITATION_NO_MATCH });
    expect(saved).toEqual([]);
  });

  it("stores nothing when the named result's title does not match the work", async () => {
    const { lookUp, saved } = harness(
      answer({ content: JSON.stringify({ url: A_REVIEW.url }), results: [A_REVIEW] }),
    );
    expect(await lookUp("a-piece", WORK_ID)).toEqual({ outcome: "no-match", message: CITATION_NO_MATCH });
    expect(saved).toEqual([]);
  });

  it("stores nothing when there are no annotations at all", async () => {
    const { lookUp, saved } = harness(answer({ results: [], searches: 3 }));
    expect(await lookUp("a-piece", WORK_ID)).toEqual({ outcome: "no-match", message: CITATION_NO_MATCH });
    expect(saved).toEqual([]);
  });

  /* Until plan 260929g this was a 409 (`CITATION_ALREADY_LINKED`): Find it
     was only for searched rows. Look it up is offered on every row (R-3), so
     the refusal is gone on purpose and these tests pin what replaced it. */
  it("looks up a row the article linked, and hands back its link unchanged", async () => {
    const linked = work({ id: LINKED_ID, url: "https://doi.org/10.1000/x", linkFrom: "doi" });
    const { lookUp, sent, saved } = harness(
      answer({ content: JSON.stringify(JUDGED), results: [DOI_PAGE] }),
      [work(), linked],
    );
    const result = await lookUp("a-piece", LINKED_ID);
    expect(sent).toHaveLength(1);
    expect(result).toMatchObject({ outcome: "found", work: linked });
    if (result.outcome !== "found") throw new Error("unreachable");
    expect(result.work.url).toBe("https://doi.org/10.1000/x");
    expect(result.work.linkFrom).toBe("doi");
    expect(result.work.found).toBeUndefined();
    expect(result.work).not.toHaveProperty("lookup");
    expect(result.lookup).toMatchObject({
      state: "assessed",
      host: "publisher.example",
      verdict: { support: "supports", quote: SUPPORT_QUOTE },
      paperDoes: { says: JUDGED.paperDoes, quote: DOES_QUOTE },
    });
    /* Stored for its lookup only: the page whose extract was read. */
    expect(saved[0]?.find).toMatchObject({ url: DOI_PAGE.url, lookup: { state: "assessed" } });
  });

  it("keeps no judgement on a DOI row whose result URL does not carry that DOI", async () => {
    const linked = work({ id: LINKED_ID, url: "https://doi.org/10.1000/other", linkFrom: "doi" });
    const { lookUp } = harness(answer({ content: JSON.stringify(JUDGED), results: [DOI_PAGE] }), [linked]);
    const result = await lookUp("a-piece", LINKED_ID);
    expect(result).toMatchObject({ outcome: "found", work: linked, lookup: { state: "not-identified" } });
    expect(JSON.stringify(result)).not.toContain(SUPPORT_QUOTE);
  });

  it("says the article's link is still there when a linked row matches nothing", async () => {
    const linked = work({ id: LINKED_ID, url: "https://doi.org/10.1000/x", linkFrom: "doi" });
    const { lookUp, saved } = harness(answer({ content: '{"url": null}', results: [DOI_PAGE] }), [linked]);
    expect(await lookUp("a-piece", LINKED_ID)).toEqual({ outcome: "no-match", message: CITATION_LOOKUP_NO_MATCH });
    expect(saved).toEqual([]);
  });

  it("reads a searched row's extract too, and upgrades its link as before", async () => {
    const { lookUp } = harness(answer({ content: JSON.stringify({ ...JUDGED, url: PAPER }), results: [NAMED_PAPER] }));
    const result = await lookUp("a-piece", WORK_ID);
    expect(result).toMatchObject({
      outcome: "found",
      work: { url: PAPER, linkFrom: "web" },
      lookup: { state: "assessed", verdict: { support: "supports", quote: SUPPORT_QUOTE } },
    });
  });

  it("keeps the URL pick when the reading is malformed", async () => {
    const { lookUp } = harness(
      answer({ content: JSON.stringify({ ...JUDGED, url: PAPER, support: "yes" }), results: [NAMED_PAPER] }),
    );
    expect(await lookUp("a-piece", WORK_ID)).toMatchObject({
      outcome: "found",
      work: { url: PAPER, linkFrom: "web" },
      lookup: { state: "unreadable" },
    });
  });

  it("replaces a found row's link on a second press, and drops the earlier lookup from the row", async () => {
    const earlier = { state: "no-extract", host: "x.org", searches: 1, model: "m", at: "t", contextHash: "c", evidenceHash: "e" } as const;
    const found = work({ url: "https://x.org/old", linkFrom: "web", lookup: earlier });
    const { lookUp } = harness(answer({ content: JSON.stringify({ ...JUDGED, url: PAPER }), results: [NAMED_PAPER] }), [found]);
    const result = await lookUp("a-piece", WORK_ID);
    expect(result).toMatchObject({ outcome: "found", work: { url: PAPER, linkFrom: "web" }, lookup: { state: "assessed" } });
    if (result.outcome !== "found") throw new Error("unreachable");
    expect(result.work).not.toHaveProperty("lookup");
  });

  it("reports a refused call in the house copy, and stores nothing", async () => {
    const { lookUp, saved } = harness(new ProviderRefused(429, "busy", new Headers()));
    await expect(lookUp("a-piece", WORK_ID)).rejects.toMatchObject({
      status: 502,
      message: providerHttpFailure(429).message,
    });
    expect(saved).toEqual([]);
  });

  it("reports an unreadable answer as a failure to retry, not as no match", async () => {
    const { lookUp, saved } = harness(answer({ finish: "length", results: [THE_PAPER] }));
    await expect(lookUp("a-piece", WORK_ID)).rejects.toMatchObject({ status: 502 });
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

  it("findWorkPage, the shared core, judges a title-only work with no article and no store", async () => {
    const sent: AiRequestBody[] = [];
    const { reading } = await findWorkPage({ title: TITLE }, null, {
      model: "a-model",
      power: "standard",
      call: async (body) => {
        sent.push(body);
        return { json: answer({ results: [A_REVIEW, THE_PAPER] }) } as JsonCall;
      },
    });
    expect(reading.verdict).toEqual({ kind: "kept", page: expect.objectContaining({ url: PAPER }) });
    const user = (sent[0]?.messages as { content: string }[] | undefined)?.[1]?.content ?? "";
    expect(user).toBe(`Title: ${TITLE}`);
  });

  it("sends the article's reference entry when the work has one", async () => {
    const { lookUp, sent } = harness(answer({ results: [THE_PAPER] }));
    await lookUp("a-piece", WORK_ID);
    const user = (sent[0]?.messages as { content: string }[] | undefined)?.[1]?.content ?? "";
    expect(user).toContain("The article's reference entry: Kaplan et al. (2020)");
  });

  it("Look it up sends its own prompt, the why and the citing passage, with the same search bounds", async () => {
    const { lookUp, sent } = harness(answer({ results: [THE_PAPER] }));
    await lookUp("a-piece", WORK_ID);
    const body = sent[0]!;
    const messages = body.messages as { role: string; content: string }[];
    expect(messages[0]?.content).toBe(LOOKUP_SYSTEM);
    expect(LOOKUP_SYSTEM).toMatch(/ONE web search/);
    expect(LOOKUP_SYSTEM).toMatch(/not instructions/);
    expect(body.max_tokens).toBe(LOOKUP_ANSWER_TOKENS);
    expect(body.tools).toEqual(findRequest(work(), null, "m").tools);
    const user = messages[1]?.content ?? "";
    expect(user).toContain(`What the article uses it for: ${work().why}`);
    expect(user).toContain("The article's passage that cites it: The curves in Kaplan et al. suggest more.");
    expect(user).toBe(
      lookupPrompt(lookupContext(work(), (id) => ARTICLE.blocks.find((b) => b.id === id)?.text)),
    );
  });

  it("gives the search a linked row's DOI because the result URL must carry it", async () => {
    const linked = work({ id: LINKED_ID, url: "https://doi.org/10.1000/x", linkFrom: "doi" });
    const { lookUp, sent } = harness(
      answer({ content: JSON.stringify(JUDGED), results: [DOI_PAGE] }),
      [linked],
    );
    await lookUp("a-piece", LINKED_ID);
    const user = (sent[0]?.messages as { role: string; content: string }[] | undefined)?.[1]?.content ?? "";
    expect(user).toContain("DOI: 10.1000/x");
  });

  it("findWorkPage still sends Find it's prompt and nothing of an article", async () => {
    const sent: AiRequestBody[] = [];
    await findWorkPage({ title: TITLE }, null, {
      model: "a-model",
      power: "standard",
      call: async (body) => {
        sent.push(body);
        return { json: answer({ results: [THE_PAPER] }) } as JsonCall;
      },
    });
    expect((sent[0]?.messages as { content: string }[] | undefined)?.[0]?.content).toBe(FIND_SYSTEM);
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

/* ------------------------------------------------ High-powered AI (260930f) -- */

describe("which model searches — the caller's choice, and findWorkPage's `power` (Sol F4)", () => {
  it("sends the model its caller resolved, and no other", async () => {
    const { lookUp, sent } = harness(answer({ results: [THE_PAPER] }), [work()], HIGH_POWER_MODEL_OPENROUTER);
    await lookUp("a-piece", WORK_ID);
    expect(sent[0]?.model).toBe(HIGH_POWER_MODEL_OPENROUTER);
  });

  it("findWorkPage resolves the model from `power` when no model is given", async () => {
    const sent: AiRequestBody[] = [];
    await findWorkPage({ title: TITLE }, null, {
      power: "high",
      call: async (body) => {
        sent.push(body);
        return { json: answer({ results: [THE_PAPER] }) } as JsonCall;
      },
    });
    expect(sent[0]?.model).toBe(HIGH_POWER_MODEL_OPENROUTER);
  });
});
