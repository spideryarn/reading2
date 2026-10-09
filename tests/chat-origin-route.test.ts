/**
 * **A conversation records where it was started from** — `ThreadOrigin`, at
 * the route, in the store, in the summary and in the export.
 * Plan docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md, D1.
 *
 * The rules are the anchor's, and tests/chat-anchor-route.test.ts is this
 * file's model: validated before a byte of the stream goes out, set only on
 * the turn that creates the thread, only for a chat, never on a retry or an
 * edit, a different origin for an existing thread is a 409, and the same one
 * resent is fine.
 *
 * Nothing reaches the model: `fetch` is stubbed, so `converse` fails on its
 * first call, and every assertion is about what happens before it.
 *
 * The mapping between the four columns and the union is written by hand in
 * four places (`upsertThread` and `threadsFor` in src/store/pg-chat.ts,
 * src/store/export.ts, tests/helpers/seed-reader-state.ts), which is how
 * `tools` and `help` were each lost once. So the round trip is asserted
 * through each of them.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { chatThreads } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import type { ChatThread, ThreadSummary } from "../src/types.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-chat-origin-route";
/* The id alphabet has no `i`, `l`, `o` or `1`; `withTurn` mints a replacement
   for anything else, which makes a typo here look like a store bug. */
const THREAD = "spya-rgn222";
const OTHER_THREAD = "spya-rgn333";

await pgReady({
  suite: "tests/chat-origin-route.test.ts",
  tables: ["spideryarn.chat_threads", "spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");
const { chatStore } = await import("../src/store/index.js");
const { exportArticle } = await import("../src/store/export.js");
const { seedChatFromFiles } = await import("./helpers/seed-reader-state.js");

let article: ScratchArticle | undefined;
let BLOCK = "";
let OTHER_BLOCK = "";
/** The claim's words. A claim is the article's own words, so they are taken from it. */
let QUOTE = "";

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  const long = article.blocks.filter((b) => b.text.trim().length > 30);
  if (long.length < 2) throw new Error("the fixture article needs two blocks to quote from");
  BLOCK = (long[0] as { id: string }).id;
  OTHER_BLOCK = (long[1] as { id: string }).id;
  QUOTE = (long[0] as { text: string }).text.trim().slice(0, 24);
}, 60_000);

beforeEach(async () => {
  if (!article) return;
  await asTestOwner(async () => {
    for (const thread of await chatStore.load(SLUG)) await chatStore.remove(SLUG, thread.id);
  });
});

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

const threads = () => asTestOwner(() => chatStore.load(SLUG));
const stored = async (id = THREAD): Promise<ChatThread | undefined> =>
  (await threads()).find((t) => t.id === id);

const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() =>
    Promise.reject(new Error("no model in tests"))) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

interface Result {
  status: number;
  body: Record<string, unknown> | null;
  frames: { event: string; data: Record<string, unknown> }[];
}

async function call(method: "GET" | "POST", url: string, body?: unknown): Promise<Result> {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;

  let written = "";
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    writeHead(code: number) {
      (this as { statusCode: number }).statusCode = code;
    },
    flushHeaders() {},
    on() {},
    write(chunk: string) {
      written += chunk;
      return true;
    },
    end(chunk?: string) {
      if (chunk) written += chunk;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;

  await handleApi(req, res, acceptAny);

  const frames = written
    .split("\n\n")
    .filter((block) => block.startsWith("event: "))
    .map((block) => {
      const [head, ...rest] = block.split("\n");
      return {
        event: (head as string).slice("event: ".length),
        data: JSON.parse(rest.join("\n").slice("data: ".length)) as Record<string, unknown>,
      };
    });

  let parsed: Record<string, unknown> | null = null;
  if (frames.length === 0 && written.trim()) {
    try {
      parsed = JSON.parse(written) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  }
  return { status: res.statusCode, body: parsed, frames };
}

const ask = (body: unknown) => call("POST", `/api/chat/${SLUG}`, body);
const claim = () => ({ mode: "debate", blockId: BLOCK, quote: QUOTE });
/* The second shape (plan 261005k, A): Debate looked at from an angle the
   reader typed. Their words, no block and no quote. */
const LENS = "how it relates to Smith 2019";
const lens = (words = LENS) => ({ mode: "debate", lens: words });

describe("an origin on the way in", () => {
  it("stores a claim's origin on the thread it creates, and reads it back equal", async () => {
    const out = await ask({ threadId: THREAD, question: "does it hold up?", origin: claim() });
    expect(out.frames[0]?.event).toBe("begin");
    expect(out.frames[0]?.data.origin).toEqual(claim());
    const thread = await stored();
    expect(thread?.origin).toEqual({ mode: "debate", blockId: BLOCK, quote: QUOTE });
    expect(thread?.kind, "a claim check is an ordinary chat").toBe("chat");
    expect(thread && "anchor" in thread, "and it is not anchored").toBe(false);
  });

  it("leaves a thread started without one with no origin key at all", async () => {
    await ask({ threadId: THREAD, question: "an ordinary question" });
    const thread = await stored();
    expect(thread).toBeDefined();
    expect(thread && "origin" in thread).toBe(false);
  });

  it("keeps the origin when a second question arrives without one", async () => {
    await ask({ threadId: THREAD, question: "does it hold up?", origin: claim() });
    const out = await ask({ threadId: THREAD, question: "and who disagrees?" });
    expect(out.frames[0]?.event).toBe("begin");
    expect((await stored())?.origin).toEqual(claim());
  });

  it("puts the origin on the thread's summary, and on the full list", async () => {
    await ask({ threadId: THREAD, question: "does it hold up?", origin: claim() });
    await ask({ threadId: OTHER_THREAD, question: "an ordinary question" });
    const summaries = (await call("GET", `/api/chat/${SLUG}?summary=1`)).body?.threads as ThreadSummary[];
    expect(summaries.find((t) => t.id === THREAD)?.origin).toEqual(claim());
    const plain = summaries.find((t) => t.id === OTHER_THREAD);
    expect(plain && "origin" in plain, "absent, not null, on a thread without one").toBe(false);
    const full = (await call("GET", `/api/chat/${SLUG}`)).body?.threads as ChatThread[];
    expect(full.find((t) => t.id === THREAD)?.origin).toEqual(claim());
  });

  it.each([
    ["something that is not an object", "debate"],
    ["no mode", { blockId: "spya-aaaaaa", quote: "some words" }],
    ["a mode nobody has built", { mode: "summary", blockId: "spya-aaaaaa", quote: "some words" }],
    ["a mode that does not exist", { mode: "elsewhere", blockId: "spya-aaaaaa", quote: "some words" }],
    ["a claim with no block", { mode: "debate", quote: "some words" }],
    ["a malformed block id", { mode: "debate", blockId: "not-a-block", quote: "some words" }],
    ["a claim with no words", { mode: "debate", blockId: "spya-aaaaaa" }],
    ["an empty quote", { mode: "debate", blockId: "spya-aaaaaa", quote: "   " }],
    ["a quote that is not a string", { mode: "debate", blockId: "spya-aaaaaa", quote: 7 }],
  ])("refuses %s", async (_name, origin) => {
    const out = await ask({ threadId: THREAD, question: "what?", origin });
    expect(out.status).toBe(400);
    expect(await threads(), "a refused request leaves no thread behind").toHaveLength(0);
  });

  it("refuses a quote over the cap, with a 413", async () => {
    const out = await ask({
      threadId: THREAD,
      question: "what?",
      origin: { mode: "debate", blockId: BLOCK, quote: "x".repeat(20_001) },
    });
    expect(out.status).toBe(413);
    expect(await threads()).toHaveLength(0);
  });

  it("refuses a block that is not in this article, as a 400 and not a foreign-key 500", async () => {
    const out = await ask({
      threadId: THREAD,
      question: "what?",
      origin: { mode: "debate", blockId: "spya-zzzzzz", quote: "some words" },
    });
    expect(out.status).toBe(400);
    expect(await threads()).toHaveLength(0);
  });

  it("never repeats the quote back in an error", async () => {
    /* The quote is article prose and `httpError` messages are logged. */
    const secret = `${QUOTE} and a secret tail`;
    for (const origin of [
      { mode: "debate", blockId: "spya-zzzzzz", quote: secret },
      { mode: "debate", blockId: "not-a-block", quote: secret },
      { mode: "elsewhere", blockId: BLOCK, quote: secret },
    ]) {
      const out = await ask({ threadId: THREAD, question: "what?", origin });
      expect(out.status).toBe(400);
      expect(JSON.stringify(out.body)).not.toContain(QUOTE);
    }
  });

  it.each(["learn", "candidates", "tutorial", "explore"])(
    "refuses an origin on a %s conversation",
    async (kind) => {
      const out = await ask({ threadId: THREAD, question: "what?", kind, origin: claim() });
      expect(out.status).toBe(400);
      expect(await threads()).toHaveLength(0);
    },
  );
});

/**
 * **The second shape: a lens** (plan 261005k, A). Both shapes say
 * `mode: "debate"`, so which one a body is has to be decided by what it
 * carries, and a body that carries both is neither.
 */
describe("a lens origin on the way in", () => {
  it("stores the lens on the thread it creates, and reads it back equal", async () => {
    const out = await ask({ threadId: THREAD, question: "what do others say?", origin: lens() });
    expect(out.frames[0]?.event).toBe("begin");
    expect(out.frames[0]?.data.origin).toEqual(lens());
    const thread = await stored();
    expect(thread?.origin).toEqual({ mode: "debate", lens: LENS });
    expect(thread?.origin && "blockId" in thread.origin, "a lens has no block").toBe(false);
    expect(thread?.kind, "a lens chat is an ordinary chat").toBe("chat");
    expect(thread && "anchor" in thread).toBe(false);
  });

  it("stores the lens trimmed", async () => {
    await ask({ threadId: THREAD, question: "what do others say?", origin: lens(`  ${LENS}\n`) });
    expect((await stored())?.origin).toEqual(lens());
  });

  it("puts a lens origin on the thread's summary", async () => {
    await ask({ threadId: THREAD, question: "what do others say?", origin: lens() });
    const summaries = (await call("GET", `/api/chat/${SLUG}?summary=1`)).body?.threads as ThreadSummary[];
    expect(summaries.find((t) => t.id === THREAD)?.origin).toEqual(lens());
  });

  it("accepts a lens at the cap, and refuses one over it without cutting it", async () => {
    const atCap = await ask({ threadId: THREAD, question: "what?", origin: lens("x".repeat(600)) });
    expect(atCap.frames[0]?.event).toBe("begin");
    const over = await ask({ threadId: OTHER_THREAD, question: "what?", origin: lens("x".repeat(601)) });
    expect(over.status).toBe(413);
    expect(await stored(OTHER_THREAD), "refused, not stored cut short").toBeUndefined();
  });

  it.each([
    ["an empty lens", { mode: "debate", lens: "" }],
    ["a lens of spaces", { mode: "debate", lens: "  \n " }],
    ["a lens that is not a string", { mode: "debate", lens: 7 }],
    ["a lens and a block", { mode: "debate", lens: "an angle", blockId: "spya-aaaaaa" }],
    ["a lens and a quote", { mode: "debate", lens: "an angle", quote: "some words" }],
    ["a lens and a whole claim", { mode: "debate", lens: "an angle", blockId: "spya-aaaaaa", quote: "some words" }],
    ["a lens on a mode nobody has built", { mode: "summary", lens: "an angle" }],
  ])("refuses %s", async (_name, origin) => {
    const out = await ask({ threadId: THREAD, question: "what?", origin });
    expect(out.status).toBe(400);
    expect(await threads(), "a refused request leaves no thread behind").toHaveLength(0);
  });

  it("refuses a lens with this article's own block and words too, not only a made-up block", async () => {
    const out = await ask({ threadId: THREAD, question: "what?", origin: { ...claim(), lens: LENS } });
    expect(out.status).toBe(400);
    expect(await threads()).toHaveLength(0);
  });

  it("never repeats the lens back in an error", async () => {
    /* The lens is the reader's own words and `httpError` messages are logged. */
    const secret = "a private angle nobody should log";
    for (const origin of [
      { mode: "debate", lens: secret, blockId: BLOCK },
      { mode: "debate", lens: `${secret}${"x".repeat(601)}` },
      { mode: "elsewhere", lens: secret },
    ]) {
      const out = await ask({ threadId: THREAD, question: "what?", origin });
      expect([400, 413]).toContain(out.status);
      expect(JSON.stringify(out.body)).not.toContain("private angle");
    }
  });

  it("refuses a lens on a conversation that is not a chat", async () => {
    const out = await ask({ threadId: THREAD, question: "what?", kind: "explore", origin: lens() });
    expect(out.status).toBe(400);
    expect(await threads()).toHaveLength(0);
  });
});

/**
 * **The item shapes: a glossary entry, a cited work and an idea**
 * (plan docs/plans/261006d-glossary-and-citations-ask-in-chat-with-origin.md, D1 and D3;
 * the idea is plan 261009k's stage 3).
 * An id and a snapshot of the name. The id is never dereferenced, so a made-up
 * one is accepted; only the shape is checked.
 */
describe.each(["glossary", "citations", "ideas"] as const)("a %s origin on the way in", (mode) => {
  const ITEM = "spya-ttm222";
  const item = (over: Record<string, unknown> = {}) => ({ mode, itemId: ITEM, quote: "qualia", ...over });

  it("stores the id and the name on the thread it creates, and reads them back equal", async () => {
    const out = await ask({ threadId: THREAD, question: "what more?", origin: item() });
    expect(out.frames[0]?.event, "no block to check, so nothing refuses it").toBe("begin");
    expect(out.frames[0]?.data.origin).toEqual(item());
    const thread = await stored();
    expect(thread?.origin).toEqual({ mode, itemId: ITEM, quote: "qualia" });
    expect(thread?.kind).toBe("chat");
    expect(thread && "anchor" in thread).toBe(false);
    const summaries = (await call("GET", `/api/chat/${SLUG}?summary=1`)).body?.threads as ThreadSummary[];
    expect(summaries.find((t) => t.id === THREAD)?.origin).toEqual(item());
  });

  it("writes the item's own columns and no block or lens", async () => {
    await ask({ threadId: THREAD, question: "what more?", origin: item() });
    const [row] = await getDb()
      .select({
        mode: chatThreads.originMode,
        item: chatThreads.originItemId,
        block: chatThreads.originBlockId,
        quote: chatThreads.originQuote,
        lens: chatThreads.originLens,
      })
      .from(chatThreads)
      .where(and(eq(chatThreads.articleId, (article as ScratchArticle).articleId), eq(chatThreads.id, THREAD)));
    expect(row).toEqual({ mode, item: ITEM, block: null, quote: "qualia", lens: null });
  });

  it("accepts a name at the cap, and refuses one over it with a 413", async () => {
    const atCap = await ask({ threadId: THREAD, question: "what?", origin: item({ quote: "x".repeat(300) }) });
    expect(atCap.frames[0]?.event).toBe("begin");
    const over = await ask({ threadId: OTHER_THREAD, question: "what?", origin: item({ quote: "x".repeat(301) }) });
    expect(over.status).toBe(413);
    expect(await stored(OTHER_THREAD)).toBeUndefined();
  });

  it.each([
    ["no item id", { mode, quote: "qualia" }],
    ["a malformed item id", { mode, itemId: "not-an-id", quote: "qualia" }],
    ["no name", { mode, itemId: ITEM }],
    ["an empty name", { mode, itemId: ITEM, quote: "  " }],
    ["a name that is not a string", { mode, itemId: ITEM, quote: 7 }],
    ["a block as well", { mode, itemId: ITEM, quote: "qualia", blockId: "spya-aaaaaa" }],
    ["a lens as well", { mode, itemId: ITEM, quote: "qualia", lens: "an angle" }],
  ])("refuses %s", async (_name, origin) => {
    const out = await ask({ threadId: THREAD, question: "what?", origin });
    expect(out.status).toBe(400);
    expect(JSON.stringify(out.body), "the name is not repeated back").not.toContain("qualia");
    expect(await threads()).toHaveLength(0);
  });

  it("is the same origin whatever the name says, and the first name is kept", async () => {
    await ask({ threadId: THREAD, question: "what more?", origin: item() });
    const out = await ask({ threadId: THREAD, question: "and now?", origin: item({ quote: "Qualia (reworded)" }) });
    expect(out.frames[0]?.event, "matched by mode and id only").toBe("begin");
    expect((await stored())?.origin).toEqual(item());
  });

  it("refuses another item, the other item mode, and a claim, with a 409", async () => {
    await ask({ threadId: THREAD, question: "what more?", origin: item() });
    const otherMode = mode === "glossary" ? "citations" : "glossary";
    for (const other of [item({ itemId: "spya-ttm333" }), item({ mode: otherMode }), claim(), lens()]) {
      expect((await ask({ threadId: THREAD, question: "and now?", origin: other })).status).toBe(409);
    }
    expect((await stored())?.origin).toEqual(item());
    expect((await stored())?.messages).toHaveLength(2);
  });

  it("refuses it on a conversation that is not a chat", async () => {
    const out = await ask({ threadId: THREAD, question: "what?", kind: "explore", origin: item() });
    expect(out.status).toBe(400);
  });

  it("exports it, and the restore puts it back in its own columns", async () => {
    await ask({ threadId: THREAD, question: "what more?", origin: item() });
    const out = await mkdtemp(path.join(tmpdir(), "spideryarn-export-item-"));
    const exported = path.join(process.cwd(), "data", SLUG);
    const stub = globalThis.fetch;
    globalThis.fetch = realFetch;
    try {
      await asTestOwner(() =>
        exportArticle(SLUG, { dataRoot: path.join(process.cwd(), "data"), outputRoot: path.join(out, "output") }),
      );
      const file = JSON.parse(await readFile(path.join(exported, "chat.json"), "utf8")) as {
        threads: ChatThread[];
      };
      expect(file.threads.find((t) => t.id === THREAD)?.origin).toEqual(item());
      await asTestOwner(() => seedChatFromFiles(SLUG));
      expect((await stored())?.origin).toEqual(item());
    } finally {
      globalThis.fetch = stub;
      await rm(exported, { recursive: true, force: true });
      await rm(out, { recursive: true, force: true });
    }
  });
});

describe("a lens and a claim are never the same origin", () => {
  it("refuses a lens for a thread started from a claim, and a claim for one started from a lens", async () => {
    await ask({ threadId: THREAD, question: "does it hold up?", origin: claim() });
    expect((await ask({ threadId: THREAD, question: "and now?", origin: lens() })).status).toBe(409);
    /* A lens whose words are the claim's is still not the claim. */
    expect((await ask({ threadId: THREAD, question: "and now?", origin: lens(QUOTE) })).status).toBe(409);
    expect((await stored())?.origin).toEqual(claim());

    await ask({ threadId: OTHER_THREAD, question: "what do others say?", origin: lens() });
    expect((await ask({ threadId: OTHER_THREAD, question: "and now?", origin: claim() })).status).toBe(409);
    expect((await stored(OTHER_THREAD))?.origin).toEqual(lens());
    expect((await stored(OTHER_THREAD))?.messages, "the refused question was not appended").toHaveLength(2);
  });

  it("refuses a different lens, and a lens for a thread started without one", async () => {
    await ask({ threadId: THREAD, question: "what do others say?", origin: lens() });
    expect((await ask({ threadId: THREAD, question: "and now?", origin: lens("another angle") })).status).toBe(409);
    await ask({ threadId: OTHER_THREAD, question: "an ordinary question" });
    expect((await ask({ threadId: OTHER_THREAD, question: "and now?", origin: lens() })).status).toBe(409);
    const plain = await stored(OTHER_THREAD);
    expect(plain && "origin" in plain).toBe(false);
  });

  it("lets the identical lens through, however it was spaced", async () => {
    await ask({ threadId: THREAD, question: "what do others say?", origin: lens() });
    const out = await ask({ threadId: THREAD, question: "and now?", origin: lens(` ${LENS} `) });
    expect(out.frames[0]?.event).toBe("begin");
    expect((await stored())?.origin).toEqual(lens());
  });

  it("keeps the stored lens through a follow-up, a retry and an edit, none of which may carry one", async () => {
    const first = await ask({ threadId: THREAD, question: "what do others say?", origin: lens() });
    const answerId = first.frames[0]?.data.messageId as string;
    const questionId = first.frames[0]?.data.questionId as string;
    expect((await ask({ threadId: THREAD, retry: answerId, origin: lens() })).status).toBe(400);
    expect((await ask({ threadId: THREAD, edit: questionId, question: "reworded", origin: lens() })).status).toBe(400);

    const retried = await ask({ threadId: THREAD, retry: answerId });
    expect(retried.frames[0]?.event).toBe("begin");
    expect(retried.frames[0]?.data.origin, "the begin frame reports the stored origin").toEqual(lens());
    expect((await stored())?.origin).toEqual(lens());

    const edited = await ask({ threadId: THREAD, edit: questionId, question: "reworded" });
    expect(edited.frames[0]?.event).toBe("begin");
    expect((await stored())?.origin).toEqual(lens());
  });
});

describe("a thread's origin is set once", () => {
  it("refuses a different origin for a thread that already has one, with a 409", async () => {
    await ask({ threadId: THREAD, question: "does it hold up?", origin: claim() });
    for (const other of [
      { mode: "debate", blockId: OTHER_BLOCK, quote: QUOTE },
      { mode: "debate", blockId: BLOCK, quote: `${QUOTE} and more` },
    ]) {
      const out = await ask({ threadId: THREAD, question: "and now?", origin: other });
      expect(out.status).toBe(409);
    }
    const thread = await stored();
    expect(thread?.origin).toEqual(claim());
    expect(thread?.messages, "and the refused questions were not appended").toHaveLength(2);
  });

  it("refuses an origin for a thread that was started without one, with a 409", async () => {
    await ask({ threadId: THREAD, question: "an ordinary question" });
    const out = await ask({ threadId: THREAD, question: "and now?", origin: claim() });
    expect(out.status).toBe(409);
    const thread = await stored();
    expect(thread && "origin" in thread).toBe(false);
  });

  it("lets the identical origin through, so a resent request is harmless", async () => {
    await ask({ threadId: THREAD, question: "does it hold up?", origin: claim() });
    const out = await ask({ threadId: THREAD, question: "and now?", origin: claim() });
    expect(out.status).not.toBe(409);
    expect(out.frames[0]?.event).toBe("begin");
    expect((await stored())?.origin).toEqual(claim());
  });

  it("refuses an origin sent with a retry or an edit", async () => {
    const first = await ask({ threadId: THREAD, question: "does it hold up?", origin: claim() });
    const answerId = first.frames[0]?.data.messageId as string;
    const questionId = first.frames[0]?.data.questionId as string;
    const retried = await ask({ threadId: THREAD, retry: answerId, origin: claim() });
    expect(retried.status).toBe(400);
    const edited = await ask({ threadId: THREAD, edit: questionId, question: "reworded", origin: claim() });
    expect(edited.status).toBe(400);
  });
});

describe("the origin's columns", () => {
  const row = (over: Partial<typeof chatThreads.$inferInsert>) => ({
    articleId: (article as ScratchArticle).articleId,
    id: THREAD,
    ownerId: TEST_OWNER,
    title: "a row written by hand",
    ...over,
  });
  /** The name of the constraint an insert tripped, or `null` if it went in. */
  async function refusedBy(over: Partial<typeof chatThreads.$inferInsert>): Promise<string | null> {
    const err: unknown = await getDb()
      .insert(chatThreads)
      .values(row(over))
      .then(
        () => null,
        (e: unknown) => e,
      );
    if (err === null) return null;
    /* Drizzle wraps the driver's error; the constraint's name is on the cause. */
    const cause = (err as { cause?: unknown }).cause;
    return String((cause as { message?: string } | undefined)?.message ?? cause ?? err);
  }

  it("accepts a claim's three columns", async () => {
    expect(await refusedBy({ originMode: "debate", originBlockId: BLOCK, originQuote: "words" })).toBeNull();
  });

  it("refuses a mode the CHECK does not list", async () => {
    expect(await refusedBy({ originMode: "elsewhere" })).toMatch(/chat_threads_origin_mode/);
  });

  it("refuses origin columns with no mode", async () => {
    expect(await refusedBy({ originQuote: "words" })).toMatch(/chat_threads_origin_none/);
    expect(await refusedBy({ originBlockId: BLOCK })).toMatch(/chat_threads_origin_none/);
    expect(await refusedBy({ originItemId: "spya-aaaaaa" })).toMatch(/chat_threads_origin_none/);
  });

  it("refuses a claim without its block, without its words, or with an item id", async () => {
    expect(await refusedBy({ originMode: "debate", originQuote: "words" })).toMatch(/chat_threads_origin_debate/);
    expect(await refusedBy({ originMode: "debate", originBlockId: BLOCK })).toMatch(/chat_threads_origin_debate/);
    expect(
      await refusedBy({
        originMode: "debate",
        originBlockId: BLOCK,
        originQuote: "words",
        originItemId: "spya-aaaaaa",
      }),
    ).toMatch(/chat_threads_origin_debate/);
  });

  it("refuses an origin on a thread that is not a chat", async () => {
    expect(
      await refusedBy({ kind: "explore", originMode: "debate", originBlockId: BLOCK, originQuote: "words" }),
    ).toMatch(/chat_threads_origin_chat_only/);
  });

  it("refuses a block the article does not have", async () => {
    expect(
      await refusedBy({ originMode: "debate", originBlockId: "spya-zzzzzz", originQuote: "words" }),
    ).toMatch(/chat_threads_origin_identity_fk/);
  });

  /* Plan 261005k, A, and its review's F7: the lens is a fifth column, and a
     debate origin is one shape or the other. */
  it("accepts a plain chat, with no origin column set", async () => {
    expect(await refusedBy({})).toBeNull();
  });

  it("accepts a lens: a mode and the lens, and nothing else", async () => {
    expect(await refusedBy({ originMode: "debate", originLens: "an angle" })).toBeNull();
  });

  it("refuses a claim and a lens mixed, whole or in part", async () => {
    expect(
      await refusedBy({ originMode: "debate", originBlockId: BLOCK, originQuote: "words", originLens: "an angle" }),
    ).toMatch(/chat_threads_origin_debate/);
    expect(await refusedBy({ originMode: "debate", originBlockId: BLOCK, originLens: "an angle" })).toMatch(
      /chat_threads_origin_debate/,
    );
    expect(await refusedBy({ originMode: "debate", originQuote: "words", originLens: "an angle" })).toMatch(
      /chat_threads_origin_debate/,
    );
  });

  it("refuses a debate origin that is neither a claim nor a lens", async () => {
    expect(await refusedBy({ originMode: "debate" })).toMatch(/chat_threads_origin_debate/);
  });

  it("refuses a lens with no mode", async () => {
    expect(await refusedBy({ originLens: "an angle" })).toMatch(/chat_threads_origin_none/);
  });

  it("refuses a lens with an item id", async () => {
    expect(
      await refusedBy({ originMode: "debate", originLens: "an angle", originItemId: "spya-aaaaaa" }),
    ).toMatch(/chat_threads_origin_debate/);
  });

  it("refuses a lens on any mode but debate", async () => {
    expect(await refusedBy({ originMode: "summary", originLens: "an angle" })).toMatch(
      /chat_threads_origin_lens_debate_only/,
    );
  });

  it("refuses a lens on a thread that is not a chat", async () => {
    expect(await refusedBy({ kind: "explore", originMode: "debate", originLens: "an angle" })).toMatch(
      /chat_threads_origin_chat_only/,
    );
  });

  /* Plan 261006d, D2: a glossary entry or a cited work is an id and a name,
     with no block and no lens. `summary` is still reserved and has no shape. */
  describe.each(["glossary", "citations", "ideas"])("a %s origin", (mode) => {
    const good = { originMode: mode, originItemId: "spya-ttm222", originQuote: "qualia" };

    it("accepts an id and a name", async () => {
      expect(await refusedBy(good)).toBeNull();
    });

    it("refuses one without its id or without its name", async () => {
      expect(await refusedBy({ ...good, originItemId: null })).toMatch(/chat_threads_origin_item/);
      expect(await refusedBy({ ...good, originQuote: null })).toMatch(/chat_threads_origin_item/);
      expect(await refusedBy({ originMode: mode })).toMatch(/chat_threads_origin_item/);
    });

    it("refuses one with a block", async () => {
      expect(await refusedBy({ ...good, originBlockId: BLOCK })).toMatch(/chat_threads_origin_item/);
    });

    it("refuses one with a lens", async () => {
      /* Either constraint may be the one named: both forbid it. */
      expect(await refusedBy({ ...good, originLens: "an angle" })).toMatch(/chat_threads_origin_(item|lens_debate_only)/);
    });
  });

  it("still accepts the reserved summary mode with no shape of its own", async () => {
    expect(await refusedBy({ originMode: "summary" })).toBeNull();
  });

  /* Plan 261009k, GPT Sol's F8: `summary` has no shape, so it may carry none
     of the shape columns, and does not get one by accident before it is built. */
  it("refuses a summary origin that carries an item id, a block or a quote", async () => {
    expect(await refusedBy({ originMode: "summary", originItemId: "spya-aaaaaa" })).toMatch(
      /chat_threads_origin_summary/,
    );
    expect(await refusedBy({ originMode: "summary", originBlockId: BLOCK })).toMatch(/chat_threads_origin_summary/);
    expect(await refusedBy({ originMode: "summary", originQuote: "words" })).toMatch(/chat_threads_origin_summary/);
  });
});

describe("db:export and the origin", () => {
  it("exports the origin, omits it where there is none, and the restore puts it back", async () => {
    await ask({ threadId: THREAD, question: "does it hold up?", origin: claim() });
    await ask({ threadId: OTHER_THREAD, question: "an ordinary question" });

    const out = await mkdtemp(path.join(tmpdir(), "spideryarn-export-origin-"));
    /* `seedChatFromFiles` reads the repository's `data/` root and cannot be
       pointed elsewhere; the slug is this file's own and is removed below
       (tests/store-export-thread-kind.test.ts does the same). */
    const exported = path.join(process.cwd(), "data", SLUG);
    /* The export reads the raw document out of Storage, which is a real
       request; the stub above is for the model. */
    const stub = globalThis.fetch;
    globalThis.fetch = realFetch;
    try {
      await asTestOwner(() =>
        exportArticle(SLUG, { dataRoot: path.join(process.cwd(), "data"), outputRoot: path.join(out, "output") }),
      );
      const file = JSON.parse(await readFile(path.join(exported, "chat.json"), "utf8")) as {
        threads: ChatThread[];
      };
      expect(file.threads.find((t) => t.id === THREAD)?.origin).toEqual(claim());
      const plain = file.threads.find((t) => t.id === OTHER_THREAD);
      expect(plain && "origin" in plain).toBe(false);

      await asTestOwner(() => seedChatFromFiles(SLUG));
      const [restored] = await getDb()
        .select({
          mode: chatThreads.originMode,
          item: chatThreads.originItemId,
          block: chatThreads.originBlockId,
          quote: chatThreads.originQuote,
        })
        .from(chatThreads)
        .where(and(eq(chatThreads.articleId, (article as ScratchArticle).articleId), eq(chatThreads.id, THREAD)));
      expect(restored).toEqual({ mode: "debate", item: null, block: BLOCK, quote: QUOTE });
      expect((await stored())?.origin).toEqual(claim());
    } finally {
      globalThis.fetch = stub;
      await rm(exported, { recursive: true, force: true });
      await rm(out, { recursive: true, force: true });
    }
  });

  it("exports a lens origin, and the restore puts it back in its own column", async () => {
    await ask({ threadId: THREAD, question: "what do others say?", origin: lens() });

    const out = await mkdtemp(path.join(tmpdir(), "spideryarn-export-lens-"));
    const exported = path.join(process.cwd(), "data", SLUG);
    const stub = globalThis.fetch;
    globalThis.fetch = realFetch;
    try {
      await asTestOwner(() =>
        exportArticle(SLUG, { dataRoot: path.join(process.cwd(), "data"), outputRoot: path.join(out, "output") }),
      );
      const file = JSON.parse(await readFile(path.join(exported, "chat.json"), "utf8")) as {
        threads: ChatThread[];
      };
      expect(file.threads.find((t) => t.id === THREAD)?.origin).toEqual(lens());

      await asTestOwner(() => seedChatFromFiles(SLUG));
      const [restored] = await getDb()
        .select({
          mode: chatThreads.originMode,
          item: chatThreads.originItemId,
          block: chatThreads.originBlockId,
          quote: chatThreads.originQuote,
          lens: chatThreads.originLens,
        })
        .from(chatThreads)
        .where(and(eq(chatThreads.articleId, (article as ScratchArticle).articleId), eq(chatThreads.id, THREAD)));
      expect(restored).toEqual({ mode: "debate", item: null, block: null, quote: null, lens: LENS });
      expect((await stored())?.origin).toEqual(lens());
    } finally {
      globalThis.fetch = stub;
      await rm(exported, { recursive: true, force: true });
      await rm(out, { recursive: true, force: true });
    }
  });
});
