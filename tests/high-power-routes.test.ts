/**
 * **High-powered AI, through the routes** — docs/plans/260930f-high-powered-ai-per-article.md,
 * Stage 2.
 *
 * Two halves, both against Postgres and the real `handleApi`:
 *
 * 1. **The switch**, `PUT /api/admin/article/:slug/high-power` — an
 *    administrator gets 200 and the column back; a reader is refused by the
 *    admin namespace gate (403) before the handler runs; another owner's slug is
 *    a 404 even to the administrator (owner-scoped, decision 8); a body that is
 *    not exactly `{ on: boolean }` is a 400. `GET /api/metadata/:slug` carries it.
 * 2. **Every request-path route family sends Opus for a high-powered article**
 *    (Sol F4: per family, not one representative) — explain, chat, search,
 *    quiz marking, the three referee streams and a live session's meaning
 *    search. Nothing is mocked but `fetch`: the model id asserted is the one on
 *    the outgoing request, so a route that forgot its `power` (or a stream that
 *    ignored it) is caught at the wire rather than at a seam.
 *
 * The citation routes, the upload source guess and the glossary term lookups
 * are dependency-injected and are held in their own suites
 * (citation-find, citation-investigate, source-guess-run, term-lookup,
 * glossary-asked-term).
 */
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Verifier } from "../src/auth.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articles, comments as commentsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { CAPABLE_MODEL_OPENROUTER, HIGH_POWER_MODEL_OPENROUTER } from "../src/models.js";
import { DEV_OWNER_ID } from "../src/owner.js";
import { buildQuiz, inputFingerprint } from "../src/quiz.js";
import type { Block, Quiz, Tree } from "../src/types.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-high-power-routes";
/** Somebody else's article — the environment's owner, not the administrator. */
const OTHERS = "test-high-power-routes-others";

await pgReady({
  suite: "tests/high-power-routes.test.ts",
  tables: ["spideryarn.articles", "spideryarn.revision_blocks", "spideryarn.comments", "spideryarn.chat_threads"],
});

const { handleApi } = await import("../src/routes.js");
const { commentStore, chatStore } = await import("../src/store/index.js");

/** Somebody signed in who is not the administrator. */
const acceptAReader: Verifier = async () => ({
  ok: true,
  claims: { sub: randomUUID(), email: "a-reader@example.test", role: "authenticated", is_anonymous: false },
});

interface Reply {
  status: number;
  body: Record<string, unknown>;
  text: string;
}

async function call(method: string, url: string, body?: unknown, verify: Verifier = acceptAny): Promise<Reply> {
  const payload = body === undefined ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;
  let status = 0;
  let text = "";
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    writeHead(code: number) {
      status = code;
    },
    flushHeaders() {},
    on() {},
    once() {},
    removeListener() {},
    write(chunk: unknown) {
      text += String(chunk);
      return true;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) text += String(chunk);
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, verify);
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* An SSE body is not JSON. */
  }
  return { status, body: parsed, text };
}

/* ---------------------------------------------------------- the one model -- */

/** Every model id that went out, in order. The stub answers every call with one short streamed sentence. */
const sent: string[] = [];
const realFetch = globalThis.fetch;
const realKey = process.env.OPENROUTER_API_KEY;

function streamedSentence(): Response {
  const encoder = new TextEncoder();
  const frames = [
    `data: ${JSON.stringify({ model: "test/model", choices: [{ delta: { content: "Because." } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ finish_reason: "stop", delta: {} }] })}\n\n`,
    "data: [DONE]\n\n",
  ];
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    body: new ReadableStream<Uint8Array>({
      start(c) {
        for (const f of frames) c.enqueue(encoder.encode(f));
        c.close();
      },
    }),
  } as unknown as Response;
}

/* ----------------------------------------------------------------- fixtures -- */

/** A real quiz over the article's real blocks — tests/quiz-mark-stream-lifetime.test.ts's `quizInto`. */
async function quizInto(dir: string): Promise<Quiz> {
  const { blocks } = JSON.parse(await readFile(path.join(dir, "blocks.json"), "utf-8")) as { blocks: Block[] };
  const tree = JSON.parse(await readFile(path.join(dir, "tree.json"), "utf-8")) as Tree;
  const meta = JSON.parse(await readFile(path.join(dir, "meta.json"), "utf-8"));
  const block = blocks.find((b) => b.text.length > 120);
  if (!block) throw new Error("the fixture has no block long enough to quote");
  const quiz = buildQuiz(
    {
      questions: [
        {
          question: "What does the piece say in that passage?",
          referenceAnswer: "It says the quoted thing. Then it moves on.",
          evidence: [{ blockId: block.id, quote: block.text.slice(0, 60) }],
        },
      ],
    },
    {
      power: "standard",
      slug: path.basename(dir),
      blocks,
      sourceHash: inputFingerprint(blocks, tree, meta),
      elapsedMs: 1,
      dropped: { unknownIds: 0, unquoted: 0, truncated: 0, overCap: 0, malformed: 0, duplicate: 0, unanchored: 0 },
    },
  );
  await writeFile(path.join(dir, "quiz.json"), JSON.stringify(quiz, null, 2));
  return quiz;
}

let mine: ScratchArticle | undefined;
let others: ScratchArticle | undefined;
let quiz: Quiz | undefined;
let block = "";
let quote = "";

beforeAll(async () => {
  mine = await scratchArticleInPg(SLUG, {
    ownerId: TEST_OWNER,
    mutate: async (dir) => {
      quiz = await quizInto(dir);
    },
  });
  /* Named, never the default: the default owner is whatever the environment
     says, and on a machine where that is the administrator this would be a
     second article of the caller's own. */
  others = await scratchArticleInPg(OTHERS, { ownerId: DEV_OWNER_ID });
  const long = mine.blocks.find((b) => b.text.length > 40);
  if (!long) throw new Error("the fixture has no block long enough to quote");
  block = long.id;
  quote = long.text.slice(0, 20);

  process.env.OPENROUTER_API_KEY = "test-key";
  globalThis.fetch = ((_url: string, init: RequestInit) => {
    sent.push(String((JSON.parse(String(init.body)) as { model?: unknown }).model));
    return Promise.resolve(streamedSentence());
  }) as unknown as typeof fetch;
}, 120_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = realKey;
  await mine?.remove();
  await others?.remove();
  await closeDb();
});

beforeEach(() => {
  sent.length = 0;
});

async function columnOf(articleId: string): Promise<Date | null> {
  const [row] = await getDb()
    .select({ since: articles.highPowerSince })
    .from(articles)
    .where(eq(articles.id, articleId));
  return row?.since ?? null;
}

/* =============================================================== the switch == */

describe("PUT /api/admin/article/:slug/high-power", { timeout: 60_000 }, () => {
  const url = `/api/admin/article/${SLUG}/high-power`;

  it("switches it on for the administrator's own article, and answers when", async () => {
    const r = await call("PUT", url, { on: true });
    expect(r.status).toBe(200);
    expect(typeof r.body.highPowerSince).toBe("string");
    expect(await columnOf(mine!.articleId)).toBeInstanceOf(Date);
    /* Twice is idempotent: the first `since` is kept. */
    const again = await call("PUT", url, { on: true });
    expect(again.body.highPowerSince).toBe(r.body.highPowerSince);
    /* And the metadata page can read it. */
    const meta = await call("GET", `/api/metadata/${SLUG}`);
    expect(meta.body.highPowerSince).toBe(r.body.highPowerSince);
  });

  it("switches it off again", async () => {
    await call("PUT", url, { on: true });
    const r = await call("PUT", url, { on: false });
    expect(r.status).toBe(200);
    expect(r.body.highPowerSince).toBeNull();
    expect(await columnOf(mine!.articleId)).toBeNull();
  });

  it("refuses a reader with 403 — the namespace gate, before the handler", async () => {
    const r = await call("PUT", url, { on: true }, acceptAReader);
    expect(r.status).toBe(403);
    expect(await columnOf(mine!.articleId)).toBeNull();
  });

  it("is a 404 for another owner's article, even to the administrator", async () => {
    const r = await call("PUT", `/api/admin/article/${OTHERS}/high-power`, { on: true });
    expect(r.status).toBe(404);
    expect(await columnOf(others!.articleId)).toBeNull();
  });

  it.each([
    ["a string for on", { on: "true" }],
    ["no on at all", {}],
    ["an extra field", { on: true, also: 1 }],
    ["not an object", [true]],
  ])("is a 400 for %s, and changes nothing", async (_what, body) => {
    const r = await call("PUT", url, body);
    expect(r.status).toBe(400);
    expect(await columnOf(mine!.articleId)).toBeNull();
  });
});

/* ======================================================= the request paths == */

describe("every request-path route family sends Opus for a high-powered article (Sol F4)", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    await call("PUT", `/api/admin/article/${SLUG}/high-power`, { on: true });
  });
  afterAll(async () => {
    await call("PUT", `/api/admin/article/${SLUG}/high-power`, { on: false });
  });

  beforeEach(async () => {
    await asTestOwner(async () => {
      for (const c of await commentStore.load(SLUG)) await commentStore.remove(SLUG, c.id);
      for (const t of await chatStore.load(SLUG)) await chatStore.remove(SLUG, t.id);
    });
  });

  it("explain — answering a comment", async () => {
    const made = await asTestOwner(() => commentStore.create(SLUG, { blockId: block, quote, start: 0 }));
    /* `beginAnswer` claims only a terminal row — tests/comment-answer-stream-lifetime.test.ts. */
    await getDb()
      .update(commentsTable)
      .set({ status: "done", answer: "an old explanation" })
      .where(and(eq(commentsTable.articleId, mine!.articleId), eq(commentsTable.id, made.id)));
    await call("POST", `/api/comments/${SLUG}/${made.id}/answer`, { useProfile: false });
    expect(sent).toEqual([HIGH_POWER_MODEL_OPENROUTER]);
  });

  it("chat — a turn", async () => {
    await call("POST", `/api/chat/${SLUG}`, { threadId: "spya-aaaaaa", question: "why?" });
    expect(sent.length).toBeGreaterThan(0);
    expect(new Set(sent)).toEqual(new Set([HIGH_POWER_MODEL_OPENROUTER]));
  });

  it("search — a meaning search", async () => {
    await call("POST", `/api/search/${SLUG}`, { criterion: "where does it argue?" });
    expect(sent).toEqual([HIGH_POWER_MODEL_OPENROUTER]);
  });

  it("quiz — marking an answer", async () => {
    const question = quiz?.questions[0];
    if (!quiz || !question) throw new Error("the seed wrote no questions");
    await call("POST", `/api/quiz/${SLUG}/mark`, {
      batchId: quiz.batchId,
      questionId: question.id,
      answer: "It says something about it.",
    });
    /* The mark is capable-tier; a verdict after it, if any, is quick-tier and
       stays where it is. */
    expect(sent[0]).toBe(HIGH_POWER_MODEL_OPENROUTER);
    for (const m of sent.slice(1)) expect(m).not.toBe(CAPABLE_MODEL_OPENROUTER);
  });

  it("referee — a criterion", async () => {
    await call("POST", `/api/referee/criteria/${SLUG}`, { criterion: "Are the methods reproducible?", kind: "single" });
    expect(sent).toEqual([HIGH_POWER_MODEL_OPENROUTER]);
  });

  it("referee — the claims", async () => {
    await call("POST", `/api/referee/claims/${SLUG}`);
    expect(sent).toEqual([HIGH_POWER_MODEL_OPENROUTER]);
  });

  it("referee — the mirror", async () => {
    /* A note with words in it: a mirror over nothing is no model call at all. */
    await asTestOwner(() =>
      commentStore.create(SLUG, { blockId: block, quote, start: 0, body: "This claim needs a citation." }),
    );
    await call("POST", `/api/referee/mirror/${SLUG}`);
    expect(sent).toEqual([HIGH_POWER_MODEL_OPENROUTER]);
  });

  it("live conversation — its meaning search tool", async () => {
    await call("POST", `/api/chat/${SLUG}/live-tool`, {
      name: "search_article_meaning",
      args: { criterion: "where does it argue?" },
    });
    expect(sent).toEqual([HIGH_POWER_MODEL_OPENROUTER]);
  });

  it("and back to Sonnet the moment it is switched off", async () => {
    await call("PUT", `/api/admin/article/${SLUG}/high-power`, { on: false });
    try {
      await call("POST", `/api/search/${SLUG}`, { criterion: "where does it argue?" });
      expect(sent).toEqual([CAPABLE_MODEL_OPENROUTER]);
    } finally {
      await call("PUT", `/api/admin/article/${SLUG}/high-power`, { on: true });
    }
  });
});
