/**
 * **Investigate, through the route and Postgres** —
 * `POST /api/citations/:slug/:id/investigate`, src/citation-investigate.ts,
 * docs/plans/260930a-citations-investigate-one-work-on-demand.md.
 *
 * The rules are tests/citation-investigate.test.ts, with the runner and the
 * stores injected. What only the real composition can show is here:
 *
 * 1. **`done` is written after the answer is stored, and a fresh read of the
 *    list has it on the row** — code's provenance included.
 * 2. **A list made again with a different `why` hides it**; putting it back
 *    shows it again — the fingerprint is recomputed at read time.
 * 3. **A source quoted in the stream ends in `error`**, with the guard's
 *    sentence, and the stored answer is unchanged.
 * 4. **Refusals are JSON before a header**: a 404 for an unknown id, a 429 for
 *    a second press while one is running, and a stranger's slug is a 404 — none
 *    of them calls the provider.
 *
 * The provider is `globalThis.fetch`, stubbed with a streamed body — nothing
 * here spends.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, citationInvestigations, rateLimitEvents } from "../src/db/schema.js";
import { DIG_DEEPER_MODEL } from "../src/dig-deeper.js";
import { loadEnvLocal } from "../src/env.js";
import { modelFor } from "../src/models.js";
import { EVAL_OWNER_ID, runAsOwner } from "../src/owner.js";
import type {
  BlockId,
  Citations,
  CitationsResponse,
  CitedWork,
  FindCitationResponse,
  InvestigateCitationDone,
} from "../src/types.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-citation-investigate-route";
/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`. */
const WORK = "spya-nvrt2a";
const TITLE = "Scaling Laws for Neural Language Models";
const WHY = "The curve the piece extrapolates from.";
const EXTRACT = "We study empirical scaling laws for language model performance on the cross-entropy loss.";

await pgReady({
  suite: "tests/citation-investigate-route.test.ts",
  tables: ["spideryarn.revision_blocks", "spideryarn.citation_investigations", "spideryarn.rate_limit_events"],
});

const { handleApi } = await import("../src/routes.js");
const { investigateCitation } = await import("../src/store/index.js");
const { pgCitationInvestigationStore } = await import("../src/store/pg-citation-investigations.js");

let article: ScratchArticle | undefined;
const realFetch = globalThis.fetch;
const noModel = (() => Promise.reject(new Error("no model in tests"))) as unknown as typeof fetch;

const chunk = (data: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);

/**
 * A streamed provider: `first`, then — once `finish` is called — `rest`, one
 * annotation with an extract, the finish, the usage and `[DONE]`.
 */
/**
 * **The first step's answer** (plan 260930d): a non-streamed completion, as
 * `openRouterJson` reads it. The default names no result — a no-match, so the
 * press goes on unconfirmed and stores no find.
 */
const NO_MATCH_LOOKUP = {
  choices: [{ finish_reason: "stop", message: { content: '{"url": null}', annotations: [] } }],
  usage: { server_tool_use: { web_search_requests: 1 } },
};
/** A lookup that identifies the arXiv page (its URL carries the row's id) and verifies a quote in its extract. */
const FOUND_LOOKUP = {
  choices: [
    {
      finish_reason: "stop",
      message: {
        content: JSON.stringify({
          url: "https://arxiv.org/abs/2001.08361",
          paperDoes: null,
          paperDoesQuote: null,
          support: "supports",
          supportQuote: "We study empirical scaling laws for language model performance",
        }),
        annotations: [
          {
            type: "url_citation",
            url_citation: { url: "https://arxiv.org/abs/2001.08361", title: TITLE, content: EXTRACT },
          },
        ],
      },
    },
  ],
  usage: { server_tool_use: { web_search_requests: 1 } },
};

/** A page only *Dig deeper*'s forced search returns, so the stored row can show it arrived. */
const REVIEW = "https://example.org/kaplan-review";
const REVIEW_EXTRACT = "Kaplan and colleagues fit a power law to loss against parameters, data and compute.";
/**
 * **The forced search's answer** (plan 261001p stage 2): one search, one page,
 * and a library query on its line — `searchFirst` reads the count from
 * `usage` and refuses a press without one.
 */
const SEARCH_STEP = {
  choices: [
    {
      finish_reason: "stop",
      message: {
        content: '"scaling laws" OR Kaplan',
        annotations: [
          {
            type: "url_citation",
            url_citation: { url: REVIEW, title: "A review of the scaling laws", content: REVIEW_EXTRACT },
          },
        ],
      },
    },
  ],
  usage: { server_tool_use: { web_search_requests: 1 } },
};

function provider(first: string, lookup: unknown = NO_MATCH_LOOKUP) {
  let calls = 0;
  let lookups = 0;
  let searches = 0;
  /** The `model` of every call to the gateway, in order. */
  const models: string[] = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const outside: string[] = [];
  globalThis.fetch = ((_url: string | URL, init?: { body?: string }) => {
    /* **Plan 261001a stage 3: the real paper read runs here too**, through
       the real composition root — the paper's own address and the registry.
       Neither reaches the network: the registry gets a 500 (an error, which
       stores nothing and cools nothing in the shared cache) and the paper a
       404, so the press stores an `unreadable` paper and goes on. */
    const url = String(_url);
    if (!url.startsWith("https://openrouter.ai/")) {
      outside.push(new URL(url).host);
      const registry = /^https:\/\/api\.(crossref|datacite)\.org\//.test(url);
      return Promise.resolve(new Response("", { status: registry ? 500 : 404 }));
    }
    const body = init?.body ?? "";
    models.push((JSON.parse(body) as { model: string }).model);
    /* Dig deeper's forced search: the one call that forces its tool. */
    if (body.includes('"tool_choice":"required"')) {
      searches += 1;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify(SEARCH_STEP),
      } as unknown as Response);
    }
    /* The lookup is the other call that does not stream. */
    if (!body.includes('"stream":true')) {
      lookups += 1;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify(lookup),
      } as unknown as Response);
    }
    calls += 1;
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
          c.enqueue(chunk({ model: "anthropic/claude-sonnet-5", choices: [{ delta: { content: first } }] }));
        },
      }),
    } as unknown as Response);
  }) as unknown as typeof fetch;
  return {
    calls: () => calls,
    lookups: () => lookups,
    searches: () => searches,
    models: () => models,
    /** The hosts asked that are not the model gateway — the paper and the registry. */
    outside: () => outside,
    finish(rest: string) {
      controller?.enqueue(
        chunk({
          choices: [
            {
              delta: {
                content: rest,
                annotations: [
                  {
                    type: "url_citation",
                    url_citation: { url: "https://arxiv.org/abs/2001.08361", title: TITLE, content: EXTRACT },
                  },
                ],
              },
            },
          ],
        }),
      );
      controller?.enqueue(chunk({ choices: [{ finish_reason: "stop", delta: {} }] }));
      controller?.enqueue(
        chunk({
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 5, server_tool_use_details: { web_search_requests: 1 } },
        }),
      );
      controller?.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      try {
        controller?.close();
      } catch {
        // Cancelled already.
      }
    },
  };
}

async function currentRevision(): Promise<string> {
  const [row] = await getDb()
    .select({ revision: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.id, article?.articleId ?? ""));
  if (!row?.revision) throw new Error("the scratch article has no current revision");
  return row.revision;
}

async function setWhy(why: string): Promise<void> {
  const revision = await currentRevision();
  const [rev] = await getDb()
    .select({ citations: articleRevisions.citations })
    .from(articleRevisions)
    .where(eq(articleRevisions.id, revision));
  const citations = rev?.citations as Citations;
  const next = { ...citations, citations: citations.citations.map((w) => (w.id === WORK ? { ...w, why } : w)) };
  await getDb().update(articleRevisions).set({ citations: next }).where(eq(articleRevisions.id, revision));
}

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  const first = article.blocks[0]?.id as BlockId;
  const work: CitedWork = {
    id: WORK,
    key: "arxiv:2001.08361",
    title: TITLE,
    authors: "Kaplan, J.",
    year: "2020",
    why: WHY,
    mentions: [],
    citedAt: [first],
    firstCited: first,
    citedInBody: true,
    url: "https://arxiv.org/abs/2001.08361",
    linkFrom: "arxiv",
  };
  const citations: Citations = {
    version: "citations/4",
    generator: "test",
    slug: SLUG,
    sourceHash: "test",
    citations: [work],
    capped: false,
    generatedAt: "2026-09-30T00:00:00.000Z",
    elapsedMs: 1,
  };
  await getDb().update(articleRevisions).set({ citations }).where(eq(articleRevisions.id, await currentRevision()));
}, 120_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  await getDb()
    .delete(rateLimitEvents)
    .where(and(eq(rateLimitEvents.ownerId, TEST_OWNER), eq(rateLimitEvents.bucket, "citation-investigate")));
  await article?.remove();
  await closeDb();
});

beforeEach(async () => {
  globalThis.fetch = noModel;
  /* This owner's presses from earlier runs would count against eight an hour. */
  await getDb()
    .delete(rateLimitEvents)
    .where(and(eq(rateLimitEvents.ownerId, TEST_OWNER), eq(rateLimitEvents.bucket, "citation-investigate")));
});

function serve(method: string, url: string) {
  const req = Object.assign(
    (async function* () {
      yield* [Buffer.from("{}")];
    })(),
    { method, url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;
  let written = "";
  let head = 0;
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    writeHead(status: number) {
      head = status;
      (this as { statusCode: number }).statusCode = status;
    },
    flushHeaders() {},
    on() {},
    write(piece: string) {
      written += piece;
      return true;
    },
    end(piece?: string) {
      if (piece) written += piece;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;
  return {
    req,
    res,
    status: () => head || (res as unknown as { statusCode: number }).statusCode,
    body: () => written,
  };
}

function frames(body: string): { name: string; data: unknown }[] {
  return body
    .split("\n\n")
    .map((f) => {
      const name = /^event: (.*)$/m.exec(f)?.[1];
      const data = /^data: (.*)$/m.exec(f)?.[1];
      return name && data ? { name, data: JSON.parse(data) as unknown } : null;
    })
    .filter((f): f is { name: string; data: unknown } => f !== null);
}

const terminals = (body: string) => frames(body).filter((f) => f.name === "done" || f.name === "error");

async function until(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !ready(); i++) await new Promise((r) => setTimeout(r, 5));
}

const investigateUrl = (id = WORK) => `/api/citations/${SLUG}/${id}/investigate`;

async function listed(): Promise<CitedWork | undefined> {
  const call = serve("GET", `/api/citations/${SLUG}`);
  await handleApi(call.req, call.res, acceptAny);
  return (JSON.parse(call.body()) as CitationsResponse).citations.citations.find((w) => w.id === WORK);
}

async function storedAnswer(): Promise<string | undefined> {
  const [row] = await getDb()
    .select({ answer: citationInvestigations.answer })
    .from(citationInvestigations)
    .where(and(eq(citationInvestigations.articleId, article?.articleId ?? ""), eq(citationInvestigations.entryId, WORK)));
  return row?.answer;
}

describe("POST /api/citations/:slug/:id/investigate", () => {
  it("streams, writes `done` only once stored, and a fresh read has it on the row", async () => {
    const stub = provider("Does it back the claim?\n");
    const call = serve("POST", investigateUrl());
    const handled = handleApi(call.req, call.res, acceptAny);
    await until(() => call.body().includes("event: delta"));
    expect(terminals(call.body())).toEqual([]);
    stub.finish("The abstract on arxiv.org says it does.");
    await handled;

    const ends = terminals(call.body());
    expect(ends.map((f) => f.name)).toEqual(["done"]);
    const done = ends[0]?.data as InvestigateCitationDone;
    /* Plan 261001p stage 2: the forced search's page is stored beside the
       answer's own, and its search is counted with the answer's. */
    expect(done.investigation).toMatchObject({
      answer: "Does it back the claim?\nThe abstract on arxiv.org says it does.",
      extractsRead: 2,
      longestExtractWords: 14,
      matchedHost: null,
      searches: 2,
      searchesFrom: "server_tool_use_details",
      sources: [
        { url: REVIEW, title: "A review of the scaling laws" },
        { url: "https://arxiv.org/abs/2001.08361", title: TITLE },
      ],
    });
    expect(stub.calls()).toBe(1);
    expect(stub.searches()).toBe(1);
    /* Every call but the search step went to Dig deeper's model. */
    expect(stub.models()[0]).toBe(modelFor("dig-deeper-search", "standard"));
    expect(stub.models().slice(1).every((m) => m === DIG_DEEPER_MODEL)).toBe(true);
    expect(await storedAnswer()).toBe(done.investigation.answer);
    expect((await listed())?.investigation).toEqual(done.investigation);
    /* Plan 261001a stage 3, through the real composition root: the row's
       arXiv link was asked for as a PDF (the registry may answer from the
       shared cache, so whether it was asked is not pinned here), and the
       paper's state was stored through the CHECKs and read back. */
    expect(stub.outside()).toContain("arxiv.org");
    expect(done.investigation.paper).toMatchObject({ state: "unreadable", host: "arxiv.org", unreadableWhy: "not-found" });
  });

  /* Plan 261001p stage 2, Sol F2: the press writes its fingerprint with
     `DIG_DEEPER_MODEL`, so the read must hash the same constant. Were it to
     ask `modelFor`, an environment override would win there and every kept
     answer would vanish from the row on reload. */
  it("still attaches a kept answer on reload with the investigate model's override set", async () => {
    expect((await listed())?.investigation).toBeDefined();
    const previous = process.env.SPIDERYARN_CITATION_INVESTIGATE_MODEL;
    process.env.SPIDERYARN_CITATION_INVESTIGATE_MODEL = "test/another-model";
    try {
      expect(modelFor("citation-investigate", "standard")).toBe("test/another-model");
      expect((await listed())?.investigation).toBeDefined();
    } finally {
      if (previous === undefined) delete process.env.SPIDERYARN_CITATION_INVESTIGATE_MODEL;
      else process.env.SPIDERYARN_CITATION_INVESTIGATE_MODEL = previous;
    }
  });

  it("hides the answer when the list is made again with a different why, and shows it when put back", async () => {
    expect((await listed())?.investigation).toBeDefined();
    await setWhy("A different use of the same work.");
    try {
      expect((await listed())?.investigation).toBeUndefined();
    } finally {
      await setWhy(WHY);
    }
    expect((await listed())?.investigation).toBeDefined();
  });

  it("ends in `error` when the answer quotes a source, and keeps the stored answer", async () => {
    const before = await storedAnswer();
    const stub = provider('The abstract says "we find a smooth power law in every setting" plainly.');
    const call = serve("POST", investigateUrl());
    await handleApi(call.req, call.res, acceptAny);
    const ends = terminals(call.body());
    expect(ends.map((f) => f.name)).toEqual(["error"]);
    expect((ends[0]?.data as { error?: string } | undefined)?.error).toMatch(/\[cite-quoted\]$/);
    expect(call.body()).not.toContain("smooth power law");
    expect(stub.calls()).toBe(1);
    expect(await storedAnswer()).toBe(before);
  });

  it("refuses a second press while one is running with a JSON 429, before any header", async () => {
    const stub = provider("Does it back the claim?\n");
    const first = serve("POST", investigateUrl());
    const running = handleApi(first.req, first.res, acceptAny);
    await until(() => first.body().includes("event: delta"));

    const second = serve("POST", investigateUrl());
    await handleApi(second.req, second.res, acceptAny);
    expect(second.status()).toBe(429);
    expect(second.body()).not.toContain("event: ");
    expect(stub.calls()).toBe(1);

    stub.finish("It does.");
    await running;
  });

  it("is a JSON 404 for an id the list does not have, with no call", async () => {
    const call = serve("POST", investigateUrl("spya-n2t3h4"));
    await handleApi(call.req, call.res, acceptAny);
    expect(call.status()).toBe(404);
    expect(call.body()).not.toContain("event: ");
  });

  it("is a 404 for somebody who does not own the article, with no call", async () => {
    await expect(runAsOwner(EVAL_OWNER_ID, () => investigateCitation(SLUG, WORK, null))).rejects.toMatchObject({
      status: 404,
    });
  });

  /* Plan 260930d. Last, because it stores a find: the rows after it would
     skip the first step. */
  it("looks the work up first, streams stage and lookup frames, and reads with the page it stored", async () => {
    const stub = provider("Does it back the claim?\n", FOUND_LOOKUP);
    const call = serve("POST", investigateUrl());
    const handled = handleApi(call.req, call.res, acceptAny);
    await until(() => call.body().includes("event: delta"));
    stub.finish("The abstract on arxiv.org says it does.");
    await handled;

    const names = frames(call.body()).map((f) => (f.name === "stage" ? `stage:${(f.data as { stage: string }).stage}` : f.name));
    expect(names.filter((n) => n !== "delta")).toEqual([
      "stage:searching",
      "stage:finding",
      "lookup",
      "stage:reading-paper",
      "stage:reading",
      "done",
    ]);
    const lookup = frames(call.body()).find((f) => f.name === "lookup")?.data as FindCitationResponse;
    expect(lookup.outcome).toBe("found");
    expect(lookup.outcome === "found" ? lookup.lookup.state : null).toBe("assessed");
    expect(stub.lookups()).toBe(1);
    expect(stub.calls()).toBe(1);

    const done = terminals(call.body())[0]?.data as InvestigateCitationDone;
    /* The re-read found the stored page, so this answer's own extracts credit it. */
    expect(done.investigation.matchedHost).toBe("arxiv.org");
    const row = await listed();
    expect(row?.lookup).toEqual(lookup.outcome === "found" ? lookup.lookup : undefined);
    expect(row?.investigation).toEqual(done.investigation);

    /* A second press skips the first step: the row now has a current assessed lookup. */
    const again = provider("It does.\n", FOUND_LOOKUP);
    const second = serve("POST", investigateUrl());
    const secondHandled = handleApi(second.req, second.res, acceptAny);
    await until(() => second.body().includes("event: delta"));
    again.finish("Still.");
    await secondHandled;
    expect(again.lookups()).toBe(0);
    expect(frames(second.body()).some((f) => f.name === "lookup")).toBe(false);
  });
});

/* The P0 of 2026-10-01: with the paper read, the model may answer from it and
   search nothing. The CHECK `citation_investigations_counts` must take that
   row, and only that one — an answer with no extract and no paper read stays
   refused by the database as well as by the code. Its own entry id, so the
   rows above are untouched. */
describe("the store's CHECK on extracts", () => {
  const ZERO = "spya-zerex2";
  const BASE = {
    answer: "From the paper's own text.",
    sources: [],
    extractsRead: 0,
    longestExtractWords: 0,
    matchedHost: null,
    searches: 0,
    searchesFrom: "server_tool_use_details",
    model: "test/model",
    at: "2026-10-01T12:00:00.000Z",
    contextHash: "0123456789abcdef",
    promptVersion: "citation-investigate/test",
  };
  const save = async (inv: Parameters<typeof pgCitationInvestigationStore.save>[2]) =>
    runAsOwner(TEST_OWNER, () => pgCitationInvestigationStore.save(SLUG, ZERO, inv));

  it("keeps an answer with no extract when the paper was read", async () => {
    await save({
      ...BASE,
      paper: {
        state: "read",
        requestedUrl: "https://arxiv.org/pdf/2001.08361",
        finalUrl: "https://arxiv.org/pdf/2001.08361v1",
        host: "arxiv.org",
        words: 11200,
        sentWords: 4900,
        chunks: ["c1", "c2"],
        matchedBy: "arxiv",
        evidenceSha: "e".repeat(64),
        selectionVersion: "paper-selection/1",
        readAt: "2026-10-01T12:00:00.000Z",
        passages: [],
      },
    });
    const [row] = await getDb()
      .select({ extractsRead: citationInvestigations.extractsRead, paperState: citationInvestigations.paperState })
      .from(citationInvestigations)
      .where(and(eq(citationInvestigations.articleId, article?.articleId ?? ""), eq(citationInvestigations.entryId, ZERO)));
    expect(row).toEqual({ extractsRead: 0, paperState: "read" });
  });

  it("refuses an answer with no extract when the paper was not read", async () => {
    await expect(save({ ...BASE, paper: { state: "no-address", readAt: "2026-10-01T12:00:00.000Z" } })).rejects.toThrow();
    await expect(save(BASE)).rejects.toThrow();
  });
});
