/**
 * **A web note, through the route and Postgres** —
 * `POST /api/bibliography/:slug/:id/web-note` (src/citation-web-note.ts, plan
 * 261018o stage 2). The rules are tests/citation-web-note.test.ts, with every
 * dependency a fake; what only the real composition can show is here:
 *
 * 1. **Stages, then `done` once stored**, and a fresh GET of the list has the
 *    note on the row.
 * 2. **A second press spends nothing**: a stored note, or a fresh *none*, is a
 *    JSON 409 with its `reason` and no provider call.
 * 3. **A second press while one runs is a JSON 429**, before any header.
 * 4. **A visitor is a 404**, and an id the list does not have is too.
 *
 * The provider is `globalThis.fetch`, stubbed — nothing here spends.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { rowIdentity } from "../src/citation-blurbs-identity.js";
import { CITATION_WEB_NOTE_PROMPT_VERSION, CITATION_WEB_NOTE_VALIDATION_VERSION } from "../src/citation-web-note-shown.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, citationWebNotes, rateLimitEvents } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { EVAL_OWNER_ID, runAsOwner } from "../src/owner.js";
import type { Bibliography, BibliographyResponse, BlockId, CitedWork, WebNoteDone } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-citation-web-note-route";
const WORK = "spya-nvrt3b";
/* A title-only row: its identifier must come from Crossref's title search. */
const TITLED = "spya-nvrt4c";
const TITLE = "Scaling Laws for Neural Language Models";
const EXTRACT =
  "We study empirical scaling laws for language model performance on the cross-entropy loss. " +
  "The loss scales as a power-law with model size, dataset size, and the amount of compute used for training.";
const QUOTE = "The loss scales as a power-law with model size, dataset size";

await pgReady({
  suite: "tests/citation-web-note-route.test.ts",
  tables: ["spideryarn.citation_web_notes", "spideryarn.rate_limit_events"],
});

const { handleApi } = await import("../src/routes.js");
const { citationWebNote } = await import("../src/store/index.js");
const { pgCitationWebNoteStore } = await import("../src/store/pg-citation-web-notes.js");

let article: ScratchArticle | undefined;
let work: CitedWork | undefined;
const realFetch = globalThis.fetch;
const noModel = (() => Promise.reject(new Error("no model in tests"))) as unknown as typeof fetch;

const WRITER = {
  choices: [
    {
      finish_reason: "stop",
      message: {
        content: JSON.stringify({
          url: "https://arxiv.org/abs/2001.08361",
          sentences: [{ text: "It finds that loss falls as a power law in size, data and compute.", quote: QUOTE }],
        }),
        annotations: [{ type: "url_citation", url_citation: { url: "https://arxiv.org/abs/2001.08361", title: TITLE, content: EXTRACT } }],
      },
    },
  ],
  usage: { server_tool_use: { web_search_requests: 1 } },
};
const CHECK = {
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ verdicts: [{ n: 1, supported: true }] }) } }],
};

/** The gateway, stubbed: the writer (it carries the search tool) and the check. `hold` keeps the writer waiting. */
function provider(opts: { hold?: Promise<void> } = {}) {
  const jobs: string[] = [];
  const outside: string[] = [];
  globalThis.fetch = (async (url: string | URL, init?: { body?: string }) => {
    /* A registry answers 500: an error, which cools nothing in the shared limiter. */
    if (!String(url).startsWith("https://openrouter.ai/")) {
      outside.push(new URL(String(url)).host);
      return new Response("", { status: 500 });
    }
    const body = init?.body ?? "";
    const writer = body.includes("openrouter:web_search");
    jobs.push(writer ? "writer" : "check");
    if (writer && opts.hold) await opts.hold;
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => JSON.stringify(writer ? WRITER : CHECK),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { jobs, outside };
}

async function currentRevision(): Promise<string> {
  const [row] = await getDb()
    .select({ revision: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.id, article?.articleId ?? ""));
  if (!row?.revision) throw new Error("the scratch article has no current revision");
  return row.revision;
}

async function clear(): Promise<void> {
  await getDb()
    .delete(rateLimitEvents)
    .where(and(eq(rateLimitEvents.ownerId, TEST_OWNER), eq(rateLimitEvents.bucket, "citation-web-note")));
  await getDb().delete(citationWebNotes).where(eq(citationWebNotes.articleId, article?.articleId ?? ""));
}

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  const first = article.blocks[0]?.id as BlockId;
  work = {
    id: WORK,
    key: "arxiv:2001.08361",
    title: TITLE,
    authors: "Kaplan, J.",
    year: "2020",
    why: "The curve the piece extrapolates from.",
    mentions: [],
    citedAt: [first],
    firstCited: first,
    citedInBody: true,
    url: "https://arxiv.org/abs/2001.08361",
    linkFrom: "arxiv",
  };
  const bibliography: Bibliography = {
    version: "citations/4",
    generator: "test",
    slug: SLUG,
    sourceHash: "test",
    citations: [
      work,
      {
        ...work,
        id: TITLED,
        key: "work:titled",
        title: "Hippocampo-cortical coupling mediates memory consolidation during sleep",
        authors: "Maingret, N.",
        year: "2016",
        url: "https://scholar.google.com/scholar?q=Hippocampo-cortical%20coupling",
        linkFrom: "search",
      },
    ],
    capped: false,
    generatedAt: "2026-10-19T00:00:00.000Z",
    elapsedMs: 1,
  };
  /* Fetched from a public address, so a title-only row may be searched for by title (G6). */
  await getDb()
    .update(articleRevisions)
    .set({ bibliography, finalUrl: "https://essays.example/coupling", rawFilename: null })
    .where(eq(articleRevisions.id, await currentRevision()));
}, 120_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  await clear();
  await article?.remove();
  await closeDb();
});

beforeEach(async () => {
  globalThis.fetch = noModel;
  await clear();
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
  return { req, res, status: () => head || (res as unknown as { statusCode: number }).statusCode, body: () => written };
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

const pressUrl = (id = WORK) => `/api/bibliography/${SLUG}/${id}/web-note`;

async function listed(): Promise<CitedWork | undefined> {
  const call = serve("GET", `/api/bibliography/${SLUG}`);
  await handleApi(call.req, call.res, acceptAny);
  return (JSON.parse(call.body()) as BibliographyResponse).bibliography.citations.find((w) => w.id === WORK);
}

async function until(ready: () => boolean, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`until: still not ready after ${ms} ms`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("POST /api/bibliography/:slug/:id/web-note", () => {
  it("streams its stages, writes `done` once stored, and the next read has the note on the row", async () => {
    const stub = provider();
    const call = serve("POST", pressUrl());
    await handleApi(call.req, call.res, acceptAny);
    const got = frames(call.body());
    expect(got.map((f) => (f.name === "stage" ? `stage:${(f.data as { stage: string }).stage}` : f.name))).toEqual([
      "stage:searching",
      "stage:checking",
      "done",
    ]);
    const done = got.at(-1)?.data as WebNoteDone;
    expect(done).toMatchObject({ outcome: "note", webNote: { host: "arxiv.org", url: "https://arxiv.org/abs/2001.08361" } });
    expect(stub.jobs).toEqual(["writer", "check"]);
    expect((await listed())?.webNote).toMatchObject({ host: "arxiv.org", sentences: [{ quote: QUOTE }] });
  });

  it("answers a second press with a stored note as a JSON 409, with no call", async () => {
    provider();
    const first = serve("POST", pressUrl());
    await handleApi(first.req, first.res, acceptAny);
    const stub = provider();
    const second = serve("POST", pressUrl());
    await handleApi(second.req, second.res, acceptAny);
    expect(second.status()).toBe(409);
    expect(JSON.parse(second.body())).toMatchObject({ reason: "web-note" });
    expect(stub.jobs).toEqual([]);
  });

  it("answers a press inside a week of a none as a JSON 409, with no call", async () => {
    await runAsOwner(TEST_OWNER, () =>
      pgCitationWebNoteStore.save(SLUG, WORK, {
        identity: rowIdentity(work as CitedWork),
        validationVersion: CITATION_WEB_NOTE_VALIDATION_VERSION,
        promptVersion: CITATION_WEB_NOTE_PROMPT_VERSION,
        model: "m",
        searches: 1,
        checkedAt: new Date().toISOString(),
        state: "none",
        why: "not-the-work",
      }),
    );
    const stub = provider();
    const call = serve("POST", pressUrl());
    await handleApi(call.req, call.res, acceptAny);
    expect(call.status()).toBe(409);
    expect(JSON.parse(call.body())).toMatchObject({ reason: "searched" });
    expect(stub.jobs).toEqual([]);
    expect((await listed())?.webNote).toBeUndefined();
  });

  it("refuses a second press while one is running with a JSON 429, before any header", async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const stub = provider({ hold });
    const first = serve("POST", pressUrl());
    const running = handleApi(first.req, first.res, acceptAny);
    await until(() => stub.jobs.length === 1);
    const second = serve("POST", pressUrl());
    await handleApi(second.req, second.res, acceptAny);
    expect(second.status()).toBe(429);
    expect(second.body()).not.toContain("event: ");
    expect(stub.jobs).toEqual(["writer"]);
    release();
    await running;
  });

  it("is a JSON 404 for an id the list does not have, with no call", async () => {
    const stub = provider();
    const call = serve("POST", pressUrl("spya-n2t3h4"));
    await handleApi(call.req, call.res, acceptAny);
    expect(call.status()).toBe(404);
    expect(stub.jobs).toEqual([]);
  });

  it("is a JSON 503 when the catalogue a title-only row's identifier comes from fails, with no model call and nothing stored", async () => {
    const stub = provider();
    const call = serve("POST", pressUrl(TITLED));
    await handleApi(call.req, call.res, acceptAny);
    expect(call.status()).toBe(503);
    expect(JSON.parse(call.body())).toMatchObject({ error: expect.stringContaining("[cite-web-note-registry]") });
    expect(stub.outside).toContain("api.crossref.org");
    expect(stub.jobs).toEqual([]);
    const rows = await getDb().select().from(citationWebNotes).where(eq(citationWebNotes.articleId, article?.articleId ?? ""));
    expect(rows).toEqual([]);
    /* And no allowance was taken: the refusal comes before it. */
    const taken = await getDb()
      .select()
      .from(rateLimitEvents)
      .where(and(eq(rateLimitEvents.ownerId, TEST_OWNER), eq(rateLimitEvents.bucket, "citation-web-note")));
    expect(taken).toEqual([]);
  });

  it("puts both calls on the cost ledger, as the writer's and the check's jobs, against this article", async () => {
    /* The real seam: `openRouterJson` meters every call into `spideryarn.ai_calls`
       (src/ai-call.ts § Meter); this asks what it wrote for this press. */
    const since = new Date();
    provider();
    const call = serve("POST", pressUrl());
    await handleApi(call.req, call.res, acceptAny);
    expect(frames(call.body()).at(-1)?.name).toBe("done");
    const rows = (
      await getDb().execute(
        sql`select purpose, scope_kind from spideryarn.ai_calls
             where article_slug = ${SLUG} and started_at >= ${since.toISOString()}::timestamptz
             order by started_at`,
      )
    ).rows as Record<string, unknown>[];
    expect(rows).toEqual([
      { purpose: "citation-web-note", scope_kind: "request" },
      { purpose: "citation-web-note-check", scope_kind: "request" },
    ]);
  });

  it("is a 404 for somebody who does not own the article — a visitor's press spends nothing", async () => {
    const stub = provider();
    await expect(runAsOwner(EVAL_OWNER_ID, () => citationWebNote(SLUG, WORK))).rejects.toMatchObject({ status: 404 });
    expect(stub.jobs).toEqual([]);
  });
});
