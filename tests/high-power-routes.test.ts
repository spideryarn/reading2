/**
 * **High-powered AI, through the routes** — docs/plans/260930f-high-powered-ai-per-article.md,
 * Stage 2, and docs/plans/260930k-high-power-for-readers-and-cost-only-for-admins.md,
 * which opened it to readers.
 *
 * Two halves, both against Postgres and the real `handleApi`:
 *
 * 1. **The switch**, `PUT /api/article/:slug/high-power` — an administrator
 *    gets 200 and the column back and **writes no ledger row**; a reader gets
 *    the same on their own article and is **charged once** (one `high_power`
 *    row, not refunded by switching off, not charged again by switching back
 *    on), or a 402 when it does not fit; another owner's slug is a 404 to
 *    either; a body that is not exactly `{ on: boolean }` is a 400.
 *    `GET /api/metadata/:slug` carries it. The billing arithmetic itself is
 *    tests/billing-high-power.test.ts.
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

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Verifier } from "../src/auth.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articles, comments as commentsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { CAPABLE_MODEL_OPENROUTER, HIGH_POWER_MODEL_OPENROUTER } from "../src/models.js";
import { DEV_OWNER_ID } from "../src/owner.js";
import { buildQuiz, inputFingerprint } from "../src/quiz.js";
import type { Block, Quiz, Tree } from "../src/types.js";
import type { OwnerId } from "../src/owner.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

const SLUG = "test-high-power-routes";
/** Somebody else's article — the environment's owner, not the administrator. */
const OTHERS = "test-high-power-routes-others";
/** A reader's own article — the half 260930k added. */
const READERS = "test-high-power-routes-reader";

await pgReady({
  suite: "tests/high-power-routes.test.ts",
  tables: [
    "spideryarn.articles",
    "spideryarn.revision_blocks",
    "spideryarn.comments",
    "spideryarn.chat_threads",
    "spideryarn.ingest_events",
    "spideryarn.billing_accounts",
  ],
});

const { handleApi } = await import("../src/routes.js");
const { commentStore, chatStore } = await import("../src/store/index.js");

/**
 * **A reader of this file's own**, not the administrator. Fixed, so a killed
 * run's ledger rows are swept by the next one rather than added to; and its own,
 * because the free allowance is three articles and a shared identity's rows
 * would change what the 402 case below sees.
 */
const READER = "0b1f0a1e-0000-4000-8000-00000000c6c2" as OwnerId;

/** Signs in as that reader. */
const acceptAReader: Verifier = async () => ({
  ok: true,
  claims: { sub: READER, email: `reader-${READER}@example.test`, role: "authenticated", is_anonymous: false },
});

/** Somebody signed in who is neither the administrator nor `READER`. */
const acceptAStranger: Verifier = async () => ({
  ok: true,
  claims: { sub: randomUUID(), email: "a-stranger@example.test", role: "authenticated", is_anonymous: false },
});

interface Reply {
  status: number;
  body: Record<string, unknown>;
  text: string;
  headers: Record<string, string>;
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
  const headers: Record<string, string> = {};
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    writableEnded: false,
    destroyed: false,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
    },
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
  return { status, body: parsed, text, headers };
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
let readers: ScratchArticle | undefined;
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
  await seedAuthUser(getDb(), {
    id: READER,
    email: `reader-${READER}@example.test`,
    onConflictDoNothing: true,
  });
  await sweepReaderLedger();
  readers = await scratchArticleInPg(READERS, { ownerId: READER });
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
  await readers?.remove();
  await sweepReaderLedger();
  await getDb().execute(sql`delete from auth.users where id = ${READER}::uuid`).catch(() => {});
  await closeDb();
});

/** The reader's ledger and billing anchor — theirs alone, so swept by owner. */
async function sweepReaderLedger(): Promise<void> {
  await getDb().execute(sql`delete from spideryarn.ingest_events where owner_id = ${READER}::uuid`);
  await getDb().execute(sql`delete from spideryarn.billing_accounts where owner_id = ${READER}::uuid`);
}

/** `ingest_events` rows of each kind for one owner. */
async function ledgerOf(owner: string): Promise<{ ingest: number; highPower: number }> {
  const result = await getDb().execute(sql`
    select count(*) filter (where kind = 'ingest')::int as ingest,
           count(*) filter (where kind = 'high_power')::int as high_power
      from spideryarn.ingest_events where owner_id = ${owner}::uuid`);
  const rows = (Array.isArray(result) ? result : (result as unknown as { rows: unknown[] }).rows) as {
    ingest: number;
    high_power: number;
  }[];
  const row = rows[0];
  if (!row) throw new Error("a count returned no row");
  return { ingest: Number(row.ingest), highPower: Number(row.high_power) };
}

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

describe("PUT /api/article/:slug/high-power", { timeout: 60_000 }, () => {
  const url = `/api/article/${SLUG}/high-power`;
  const readersUrl = `/api/article/${READERS}/high-power`;

  beforeEach(async () => {
    await sweepReaderLedger();
    await getDb().update(articles).set({ highPowerSince: null }).where(eq(articles.id, readers!.articleId));
  });

  it("switches it on for the administrator's own article, and answers when", async () => {
    const r = await call("PUT", url, { on: true });
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toBe("private, no-store");
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

  /**
   * **The administrator is exempt, as with ingests**: the route sends them to
   * the uncharged store method, so switching on writes no ledger row at all.
   * Counted before and after rather than assumed empty — this is the shared
   * local admin identity, and somebody's local use may have left rows.
   */
  it("charges the administrator nothing: no ledger row is written", async () => {
    await call("PUT", url, { on: false });
    const before = await ledgerOf(TEST_OWNER);
    const r = await call("PUT", url, { on: true });
    expect(r.status).toBe(200);
    expect(await columnOf(mine!.articleId)).toBeInstanceOf(Date);
    expect(await ledgerOf(TEST_OWNER)).toEqual(before);
  });

  it("lets a reader switch their own article on, and charges them once", async () => {
    const r = await call("PUT", readersUrl, { on: true }, acceptAReader);
    expect(r.status).toBe(200);
    expect(typeof r.body.highPowerSince).toBe("string");
    expect(await columnOf(readers!.articleId)).toBeInstanceOf(Date);
    expect(await ledgerOf(READER)).toEqual({ ingest: 0, highPower: 1 });
    /* The metadata page reads it for the owner. */
    const meta = await call("GET", `/api/metadata/${READERS}`, undefined, acceptAReader);
    expect(meta.body.highPowerSince).toBe(r.body.highPowerSince);
  });

  it("switches a reader's article off without a refund, and back on without a second charge", async () => {
    const on = await call("PUT", readersUrl, { on: true }, acceptAReader);
    expect(on.status).toBe(200);

    const off = await call("PUT", readersUrl, { on: false }, acceptAReader);
    expect(off.status).toBe(200);
    expect(off.body.highPowerSince).toBeNull();
    expect(await columnOf(readers!.articleId)).toBeNull();
    /* Off refunds nothing: the Opus calls were spent. */
    expect(await ledgerOf(READER)).toEqual({ ingest: 0, highPower: 1 });

    const again = await call("PUT", readersUrl, { on: true }, acceptAReader);
    expect(again.status).toBe(200);
    expect(await columnOf(readers!.articleId)).toBeInstanceOf(Date);
    /* And on again is free: still one row. */
    expect(await ledgerOf(READER)).toEqual({ ingest: 0, highPower: 1 });
  });

  it("is a 402 for a reader with no room, and changes nothing", async () => {
    /* Three private articles' worth already spent — six of the free six
       half-units — and this article private, so the upgrade costs two. */
    await getDb().execute(sql`
      insert into spideryarn.ingest_events (owner_id, reserved_at, succeeded_at)
      select ${READER}::uuid, now(), now() from generate_series(1, 3)`);
    const r = await call("PUT", readersUrl, { on: true }, acceptAReader);
    expect(r.status).toBe(402);
    expect(r.headers["cache-control"]).toBe("private, no-store");
    expect(String(r.body.error)).toContain("[pay-high-power]");
    expect(await columnOf(readers!.articleId)).toBeNull();
    expect(await ledgerOf(READER)).toEqual({ ingest: 3, highPower: 0 });
  });

  it("is a 404 for another owner's article, even to the administrator", async () => {
    const r = await call("PUT", `/api/article/${OTHERS}/high-power`, { on: true });
    expect(r.status).toBe(404);
    expect(r.headers["cache-control"]).toBe("private, no-store");
    expect(await columnOf(others!.articleId)).toBeNull();
  });

  it("is a 404 for another owner's article to a reader, and charges them nothing", async () => {
    const r = await call("PUT", `/api/article/${OTHERS}/high-power`, { on: true }, acceptAReader);
    expect(r.status).toBe(404);
    expect(await columnOf(others!.articleId)).toBeNull();
    expect(await ledgerOf(READER)).toEqual({ ingest: 0, highPower: 0 });
    /* And a stranger cannot switch the reader's article either. */
    const stranger = await call("PUT", readersUrl, { on: true }, acceptAStranger);
    expect(stranger.status).toBe(404);
    expect(await columnOf(readers!.articleId)).toBeNull();
  });

  it.each([
    ["a string for on", { on: "true" }],
    ["no on at all", {}],
    ["an extra field", { on: true, also: 1 }],
    ["not an object", [true]],
  ])("is a 400 for %s, and changes nothing", async (_what, body) => {
    await call("PUT", url, { on: false });
    const r = await call("PUT", url, body);
    expect(r.status).toBe(400);
    expect(r.headers["cache-control"]).toBe("private, no-store");
    expect(await columnOf(mine!.articleId)).toBeNull();
    const reader = await call("PUT", readersUrl, body, acceptAReader);
    expect(reader.status).toBe(400);
    expect(await ledgerOf(READER)).toEqual({ ingest: 0, highPower: 0 });
  });
});

/* ======================================================= the request paths == */

describe("every request-path route family sends Opus for a high-powered article (Sol F4)", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    await call("PUT", `/api/article/${SLUG}/high-power`, { on: true });
  });
  afterAll(async () => {
    await call("PUT", `/api/article/${SLUG}/high-power`, { on: false });
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

  /**
   * **The reader half** (260930k decision 6): `articlePower` no longer asks
   * whether the owner is an administrator, so a reader's own high-powered
   * article sends Opus too. Switched on through the route, as the reader, so
   * this is the charged path end to end — and back to Sonnet when off.
   */
  it("a reader's high-powered article sends Opus too, and Sonnet once it is off", async () => {
    await sweepReaderLedger();
    const on = await call("PUT", `/api/article/${READERS}/high-power`, { on: true }, acceptAReader);
    expect(on.status).toBe(200);
    try {
      await call("POST", `/api/search/${READERS}`, { criterion: "where does it argue?" }, acceptAReader);
      expect(sent).toEqual([HIGH_POWER_MODEL_OPENROUTER]);
    } finally {
      await call("PUT", `/api/article/${READERS}/high-power`, { on: false }, acceptAReader);
    }
    sent.length = 0;
    await call("POST", `/api/search/${READERS}`, { criterion: "where does it argue?" }, acceptAReader);
    expect(sent).toEqual([CAPABLE_MODEL_OPENROUTER]);
  });

  it("and back to Sonnet the moment it is switched off", async () => {
    await call("PUT", `/api/article/${SLUG}/high-power`, { on: false });
    try {
      await call("POST", `/api/search/${SLUG}`, { criterion: "where does it argue?" });
      expect(sent).toEqual([CAPABLE_MODEL_OPENROUTER]);
    } finally {
      await call("PUT", `/api/article/${SLUG}/high-power`, { on: true });
    }
  });
});
