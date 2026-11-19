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
 * The mapping between the origin columns and the union is written by hand in
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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { inputFingerprint } from "../src/bibliography.js";
import { askDoesItSayThatAboutBlock } from "../src/chat-question.js";
import { CiteCheckExists } from "../src/chat.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, chatThreads, quizAttempts, rateLimitEvents } from "../src/db/schema.js";
import { READER_STATE } from "../src/admin-articles.js";
import { loadEnvLocal } from "../src/env.js";
import type { OwnerId } from "../src/owner.js";
import { violatesCheckConstraint, violatesConstraint } from "../src/store/db-errors.js";
import type { Bibliography, ChatThread, CitedWork, CiteCheckOrigin, ThreadSummary } from "../src/types.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

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
const { chatStore, loadArticle, loadBibliography, quizAttemptStore } = await import("../src/store/index.js");
const { citeCheckConflictOf, CITE_CHECK_INDEX } = await import("../src/store/pg-chat.js");
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

async function call(
  method: "GET" | "POST",
  url: string,
  body?: unknown,
  opts: { flushHeaders?: () => void; end?: () => void } = {},
): Promise<Result> {
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
    flushHeaders() {
      opts.flushHeaders?.();
    },
    on() {},
    write(chunk: string) {
      written += chunk;
      return true;
    },
    end(chunk?: string) {
      opts.end?.();
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
const claim = () => ({ mode: "sources-claims", blockId: BLOCK, quote: QUOTE });
/* The second shape (plan 261005k, A): Debate looked at from an angle the
   reader typed. Their words, no block and no quote. */
const LENS = "how it relates to Smith 2019";
const lens = (words = LENS) => ({ mode: "reception", lens: words });

describe("an origin on the way in", () => {
  it("stores a claim's origin on the thread it creates, and reads it back equal", async () => {
    const out = await ask({ threadId: THREAD, question: "does it hold up?", origin: claim() });
    expect(out.frames[0]?.event).toBe("begin");
    expect(out.frames[0]?.data.origin).toEqual(claim());
    const thread = await stored();
    expect(thread?.origin).toEqual({ mode: "sources-claims", blockId: BLOCK, quote: QUOTE });
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
    ["something that is not an object", "reception"],
    ["no mode", { blockId: "spya-aaaaaa", quote: "some words" }],
    ["a mode nobody has built", { mode: "summary", blockId: "spya-aaaaaa", quote: "some words" }],
    ["a mode that does not exist", { mode: "elsewhere", blockId: "spya-aaaaaa", quote: "some words" }],
    ["a claim with no block", { mode: "sources-claims", quote: "some words" }],
    ["a malformed block id", { mode: "sources-claims", blockId: "not-a-block", quote: "some words" }],
    ["a claim with no words", { mode: "sources-claims", blockId: "spya-aaaaaa" }],
    ["an empty quote", { mode: "sources-claims", blockId: "spya-aaaaaa", quote: "   " }],
    ["a quote that is not a string", { mode: "sources-claims", blockId: "spya-aaaaaa", quote: 7 }],
  ])("refuses %s", async (_name, origin) => {
    const out = await ask({ threadId: THREAD, question: "what?", origin });
    expect(out.status).toBe(400);
    expect(await threads(), "a refused request leaves no thread behind").toHaveLength(0);
  });

  it("refuses a quote over the cap, with a 413", async () => {
    const out = await ask({
      threadId: THREAD,
      question: "what?",
      origin: { mode: "sources-claims", blockId: BLOCK, quote: "x".repeat(20_001) },
    });
    expect(out.status).toBe(413);
    expect(await threads()).toHaveLength(0);
  });

  it("refuses a block that is not in this article, as a 400 and not a foreign-key 500", async () => {
    const out = await ask({
      threadId: THREAD,
      question: "what?",
      origin: { mode: "sources-claims", blockId: "spya-zzzzzz", quote: "some words" },
    });
    expect(out.status).toBe(400);
    expect(await threads()).toHaveLength(0);
  });

  it("never repeats the quote back in an error", async () => {
    /* The quote is article prose and `httpError` messages are logged. */
    const secret = `${QUOTE} and a secret tail`;
    for (const origin of [
      { mode: "sources-claims", blockId: "spya-zzzzzz", quote: secret },
      { mode: "sources-claims", blockId: "not-a-block", quote: secret },
      { mode: "elsewhere", blockId: BLOCK, quote: secret },
    ]) {
      const out = await ask({ threadId: THREAD, question: "what?", origin });
      expect(out.status).toBe(400);
      expect(JSON.stringify(out.body)).not.toContain(QUOTE);
    }
  });

  it.each(["learn", "candidates", "explore"])(
    "refuses an origin on a %s conversation",
    async (kind) => {
      const out = await ask({ threadId: THREAD, question: "what?", kind, origin: claim() });
      expect(out.status).toBe(400);
      expect(await threads()).toHaveLength(0);
    },
  );
});

/**
 * **A tab loaded before plan 261009w's deploy** still sends a claim's and a
 * lens's origin as `mode: "debate"`. Each is read by its shape and stored
 * under its new word (§ After GPT Sol's plan review, F1), and a body that
 * carries both shapes is still neither.
 */
describe("an old `debate` origin from a stale tab", () => {
  it("stores a claim sent as `debate` as a Sources › Claims origin", async () => {
    const out = await ask({ threadId: THREAD, question: "does it hold up?", origin: { ...claim(), mode: "debate" } });
    expect(out.frames[0]?.event).toBe("begin");
    expect((await stored())?.origin).toEqual(claim());
    const [row] = await getDb()
      .select({ mode: chatThreads.originMode })
      .from(chatThreads)
      .where(eq(chatThreads.id, THREAD));
    expect(row?.mode, "written in the new word").toBe("sources-claims");
  });

  it("stores a lens sent as `debate` as a Reception origin", async () => {
    const out = await ask({ threadId: THREAD, question: "what do others say?", origin: { ...lens(), mode: "debate" } });
    expect(out.frames[0]?.event).toBe("begin");
    expect((await stored())?.origin).toEqual(lens());
  });

  it("refuses a `debate` body that is both a lens and a claim", async () => {
    const out = await ask({ threadId: THREAD, question: "what?", origin: { ...claim(), mode: "debate", lens: LENS } });
    expect(out.status).toBe(400);
    expect(await threads()).toHaveLength(0);
  });
});

/**
 * **The second shape: a lens** (plan 261005k, A). Both shapes said
 * `mode: "debate"` until plan 261009w; now a lens is `reception`, and a body
 * that carries a lens and any part of a claim is neither.
 */
describe("a lens origin on the way in", () => {
  it("stores the lens on the thread it creates, and reads it back equal", async () => {
    const out = await ask({ threadId: THREAD, question: "what do others say?", origin: lens() });
    expect(out.frames[0]?.event).toBe("begin");
    expect(out.frames[0]?.data.origin).toEqual(lens());
    const thread = await stored();
    expect(thread?.origin).toEqual({ mode: "reception", lens: LENS });
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
    ["an empty lens", { mode: "reception", lens: "" }],
    ["a lens of spaces", { mode: "reception", lens: "  \n " }],
    ["a lens that is not a string", { mode: "reception", lens: 7 }],
    ["a lens and a block", { mode: "reception", lens: "an angle", blockId: "spya-aaaaaa" }],
    ["a lens and a quote", { mode: "reception", lens: "an angle", quote: "some words" }],
    ["a lens and a whole claim", { mode: "reception", lens: "an angle", blockId: "spya-aaaaaa", quote: "some words" }],
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
      { mode: "reception", lens: secret, blockId: BLOCK },
      { mode: "reception", lens: `${secret}${"x".repeat(601)}` },
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
 * the idea is plan 261009k's stage 3; a literature-search finding, `situate`,
 * plan 261025h, whose id is `si-` and twelve hex digits rather than a block-shaped one;
 * the sources digest and a summary level, plan 261030b, each with an id from its
 * artefact's time).
 * An id and a snapshot of the name. The id is never dereferenced, so a made-up
 * one is accepted; only the shape is checked.
 */
/** Each item mode's id, another item's, and a well-formed id of another shape. */
const ITEM_IDS = {
  glossary: ["spya-ttm222", "spya-ttm333", "si-0123456789ab"],
  bibliography: ["spya-ttm222", "spya-ttm333", "si-0123456789ab"],
  ideas: ["spya-ttm222", "spya-ttm333", "si-0123456789ab"],
  situate: ["si-0123456789ab", "si-ba9876543210", "spya-ttm222"],
  "sources-digest": ["sd-20261030215639123", "sd-20261030215639123-p2", "ss-brief-20261030215639123"],
  summary: ["ss-brief-20261030215639123", "ss-fuller-20261030215639123", "sd-20261030215639123"],
} as const;
const BLOCK_SHAPED = new Set<string>(["glossary", "bibliography", "ideas"]);

describe.each(["glossary", "bibliography", "ideas", "situate", "sources-digest", "summary"] as const)("a %s origin on the way in", (mode) => {
  const [ITEM, OTHER_ITEM, OTHER_SHAPE] = ITEM_IDS[mode];
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
    /* Each shape's own id: a finding's is not a block-shaped one, nor the reverse. */
    ["the other kind of item id", { mode, itemId: OTHER_SHAPE, quote: "qualia" }],
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
    const otherMode = mode === "glossary" ? "bibliography" : "glossary";
    /* Another mode's item, well formed for that mode, so the answer is the 409 and not the 400. */
    const otherModeItem = BLOCK_SHAPED.has(mode) ? item({ mode: otherMode }) : { mode: otherMode, itemId: "spya-ttm222", quote: "qualia" };
    for (const other of [item({ itemId: OTHER_ITEM }), otherModeItem, claim(), lens()]) {
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

describe("a Where it sits overview origin on the way in", () => {
  const origin = {
    mode: "situate",
    itemId: "so-20261025122230533",
    quote: "The report was followed by a peer-reviewed update",
  } as const;

  it("passes the route and database checks, and reads back through the summary", async () => {
    const out = await ask({ threadId: THREAD, question: "what does this rest on?", origin });
    expect(out.frames[0]?.event).toBe("begin");
    expect(out.frames[0]?.data.origin).toEqual(origin);
    expect((await stored())?.origin).toEqual(origin);
    const summaries = (await call("GET", `/api/chat/${SLUG}?summary=1`)).body?.threads as ThreadSummary[];
    expect(summaries.find((thread) => thread.id === THREAD)?.origin).toEqual(origin);
  });

  it.each(["so-2026102512223", "so-202610251222305333", "so-2026-10-25T12:22:30Z"])(
    "refuses malformed overview id %s",
    async (itemId) => {
      const out = await ask({ threadId: THREAD, question: "what?", origin: { ...origin, itemId } });
      expect(out.status).toBe(400);
      expect(await threads()).toHaveLength(0);
    },
  );
});

/**
 * **A cited work's origin as it was spelled before 2026-10-09** — plan
 * docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md, Stage 2.
 * Bibliography's origin mode was `citations`. The rows are not rewritten until
 * the contract migration, and a tab open across the deploy still sends the old
 * word (F1), so both are read as Bibliography's and the new word is written.
 */
describe("a cited work's origin under its old mode word", () => {
  const ITEM = "spya-ttm222";
  const old = { mode: "citations", itemId: ITEM, quote: "qualia" };
  const current = { mode: "bibliography", itemId: ITEM, quote: "qualia" };

  const storedMode = async () => {
    const [row] = await getDb()
      .select({ mode: chatThreads.originMode })
      .from(chatThreads)
      .where(and(eq(chatThreads.articleId, (article as ScratchArticle).articleId), eq(chatThreads.id, THREAD)));
    return row?.mode;
  };

  it("takes the old word from a stale tab, and stores and answers it as the new", async () => {
    const out = await ask({ threadId: THREAD, question: "what more?", origin: old });
    expect(out.frames[0]?.event).toBe("begin");
    expect(out.frames[0]?.data.origin).toEqual(current);
    expect(await storedMode()).toBe("bibliography");
    expect((await stored())?.origin).toEqual(current);
  });

  it("reads a row written with the old word as the new, and either word carries on its conversation", async () => {
    await ask({ threadId: THREAD, question: "what more?", origin: current });
    await getDb()
      .update(chatThreads)
      .set({ originMode: "citations" })
      .where(and(eq(chatThreads.articleId, (article as ScratchArticle).articleId), eq(chatThreads.id, THREAD)));
    expect((await stored())?.origin).toEqual(current);
    const summaries = (await call("GET", `/api/chat/${SLUG}?summary=1`)).body?.threads as ThreadSummary[];
    expect(summaries.find((t) => t.id === THREAD)?.origin).toEqual(current);
    expect((await ask({ threadId: THREAD, question: "and now?", origin: old })).frames[0]?.event).toBe("begin");
    expect((await ask({ threadId: THREAD, question: "and then?", origin: current })).frames[0]?.event).toBe("begin");
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
      { mode: "sources-claims", blockId: OTHER_BLOCK, quote: QUOTE },
      { mode: "sources-claims", blockId: BLOCK, quote: `${QUOTE} and more` },
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
    expect(await refusedBy({ originMode: "sources-claims", originBlockId: BLOCK, originQuote: "words" })).toBeNull();
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
    expect(await refusedBy({ originMode: "sources-claims", originQuote: "words" })).toMatch(
      /chat_threads_origin_sources_claims/,
    );
    expect(await refusedBy({ originMode: "sources-claims", originBlockId: BLOCK })).toMatch(
      /chat_threads_origin_sources_claims/,
    );
    expect(
      await refusedBy({
        originMode: "sources-claims",
        originBlockId: BLOCK,
        originQuote: "words",
        originItemId: "spya-aaaaaa",
      }),
    ).toMatch(/chat_threads_origin_sources_claims/);
  });

  it("refuses an origin on a thread that is not a chat", async () => {
    expect(
      await refusedBy({ kind: "explore", originMode: "sources-claims", originBlockId: BLOCK, originQuote: "words" }),
    ).toMatch(/chat_threads_origin_chat_only/);
  });

  it("refuses a block the article does not have", async () => {
    expect(
      await refusedBy({ originMode: "sources-claims", originBlockId: "spya-zzzzzz", originQuote: "words" }),
    ).toMatch(/chat_threads_origin_identity_fk/);
  });

  /* Plan 261005k, A, and its review's F7: the lens is a fifth column, and a
     lens and a claim are never mixed. Since plan 261009w a lens is `reception`
     and a claim `sources-claims`. */
  it("accepts a plain chat, with no origin column set", async () => {
    expect(await refusedBy({})).toBeNull();
  });

  it("accepts a lens: a mode and the lens, and nothing else", async () => {
    expect(await refusedBy({ originMode: "reception", originLens: "an angle" })).toBeNull();
  });

  it("refuses a claim and a lens mixed, whole or in part, under either word", async () => {
    expect(
      await refusedBy({ originMode: "reception", originBlockId: BLOCK, originQuote: "words", originLens: "an angle" }),
    ).toMatch(/chat_threads_origin_reception/);
    expect(await refusedBy({ originMode: "reception", originBlockId: BLOCK, originLens: "an angle" })).toMatch(
      /chat_threads_origin_reception/,
    );
    expect(await refusedBy({ originMode: "reception", originQuote: "words", originLens: "an angle" })).toMatch(
      /chat_threads_origin_reception/,
    );
    expect(
      await refusedBy({ originMode: "sources-claims", originBlockId: BLOCK, originQuote: "words", originLens: "an angle" }),
    ).toMatch(/chat_threads_origin_(sources_claims|lens_debate_only)/);
  });

  it("refuses a Reception origin with no lens", async () => {
    expect(await refusedBy({ originMode: "reception" })).toMatch(/chat_threads_origin_reception/);
  });

  it("refuses a lens with no mode", async () => {
    expect(await refusedBy({ originLens: "an angle" })).toMatch(/chat_threads_origin_none/);
  });

  it("refuses a lens with an item id", async () => {
    expect(
      await refusedBy({ originMode: "reception", originLens: "an angle", originItemId: "spya-aaaaaa" }),
    ).toMatch(/chat_threads_origin_reception/);
  });

  it("refuses a lens on any mode but Reception (or its old word)", async () => {
    /* A well-formed summary item but for the lens. The item check forbids a
       lens too, so either may be the one named. */
    expect(
      await refusedBy({ originMode: "summary", originItemId: "ss-brief-20261030215639123", originQuote: "words", originLens: "an angle" }),
    ).toMatch(/chat_threads_origin_(lens_debate_only|item)/);
  });

  it("refuses a lens on a thread that is not a chat", async () => {
    expect(await refusedBy({ kind: "explore", originMode: "reception", originLens: "an angle" })).toMatch(
      /chat_threads_origin_chat_only/,
    );
  });

  /* **The old word, as the code deployed before plan 261009w still writes it**
     for the minutes of the deploy: `debate`, a claim or a lens, with the
     shape checks it always had. The contract migration rewrites these rows. */
  describe("a `debate` origin, as written before 2026-10-09", () => {
    it("accepts a claim", async () => {
      expect(await refusedBy({ originMode: "debate", originBlockId: BLOCK, originQuote: "words" })).toBeNull();
    });

    it("accepts a lens", async () => {
      expect(await refusedBy({ originMode: "debate", originLens: "an angle" })).toBeNull();
    });

    it("refuses half a claim, a mix, or neither", async () => {
      expect(await refusedBy({ originMode: "debate", originQuote: "words" })).toMatch(/chat_threads_origin_debate/);
      expect(
        await refusedBy({ originMode: "debate", originBlockId: BLOCK, originQuote: "words", originLens: "an angle" }),
      ).toMatch(/chat_threads_origin_debate/);
      expect(await refusedBy({ originMode: "debate" })).toMatch(/chat_threads_origin_debate/);
    });
  });

  /* Plan 261006d, D2: a glossary entry or a cited work is an id and a name,
     with no block and no lens. The digest and a summary level joined them in
     plan 261030b, each with an id of its own form (below). */
  describe.each(["glossary", "citations", "bibliography", "ideas", "situate", "sources-digest", "summary"])("a %s origin", (mode) => {
    const itemId =
      mode === "sources-digest" ? "sd-20261030215639123" : mode === "summary" ? "ss-fuller-20261030215639123" : "spya-ttm222";
    const good = { originMode: mode, originItemId: itemId, originQuote: "qualia" };

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

  /* Plan 261030b: `summary`, reserved with no shape since plan 261009k
     (GPT Sol's F8), is now an item, and its id and the digest's have a form
     of their own, held by a CHECK each: the patterns of `SUMMARY_ITEM_ID` and
     `SOURCES_DIGEST_ITEM_ID` in src/types.ts. */
  it("refuses a summary origin with no shape, as it was reserved", async () => {
    expect(await refusedBy({ originMode: "summary" })).toMatch(/chat_threads_origin_item/);
  });

  it.each([
    ["sources-digest", "sd-20261030215639123"],
    ["sources-digest", "sd-20261030215639-p12"],
    ["summary", "ss-brief-20261030215639123"],
    ["summary", "ss-fuller-20261030215639"],
  ])("accepts a %s origin with the id %s", async (mode, itemId) => {
    expect(await refusedBy({ originMode: mode, originItemId: itemId, originQuote: "words" })).toBeNull();
  });

  it.each([
    ["sources-digest", "sd-2026", /chat_threads_origin_sources_digest/],
    ["sources-digest", "sd-20261030215639123-p0", /chat_threads_origin_sources_digest/],
    ["sources-digest", "spya-aaaaaa", /chat_threads_origin_sources_digest/],
    ["sources-digest", "ss-brief-20261030215639123", /chat_threads_origin_sources_digest/],
    ["summary", "ss-thread-20261030215639123", /chat_threads_origin_summary/],
    ["summary", "ss-brief-2026", /chat_threads_origin_summary/],
    ["summary", "spya-aaaaaa", /chat_threads_origin_summary/],
    ["summary", "sd-20261030215639123", /chat_threads_origin_summary/],
  ])("refuses a %s origin with the malformed id %s", async (mode, itemId, constraint) => {
    expect(await refusedBy({ originMode: mode, originItemId: itemId, originQuote: "words" })).toMatch(constraint);
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
      expect(restored).toEqual({ mode: "sources-claims", item: null, block: BLOCK, quote: QUOTE });
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
      expect(restored).toEqual({ mode: "reception", item: null, block: null, quote: null, lens: LENS });
      expect((await stored())?.origin).toEqual(lens());
    } finally {
      globalThis.fetch = stub;
      await rm(exported, { recursive: true, force: true });
      await rm(out, { recursive: true, force: true });
    }
  });
});

/**
 * **A citation's *Does it say that?*** — origin `cite-check`, plan
 * docs/plans/261024m-citation-card-streams-a-note-on-what-this-paragraph-cites-the-work-for.md,
 * stage 1 and § After GPT Sol's review. One chat per cited work and citing
 * paragraph; on the turn that creates one the route checks the anchor, an
 * existing chat (409 with its id), the owner's Bibliography and the question
 * the server builds (409 stale), and for `auto: true` only, an allowance that
 * a refusal before the model starts refunds and the turn's `finally` frees.
 *
 * **"Spends nothing"** is two counts: the model's `fetch` (stubbed to fail, so
 * a turn that reached it stops there) and this owner's `cite-check` rows in
 * `rate_limit_events`.
 */
describe("a citation's Does it say that? (origin cite-check)", () => {
  const WORK_ID = "spya-wrk222";
  const WORK = { title: "Attention Is All You Need", authors: "Vaswani et al.", year: "2017" };
  const STRANGER = "00000000-0000-4000-8000-00000000c17e" as OwnerId;
  let calls = 0;
  let before: typeof globalThis.fetch;
  let revisionId = "";
  let freshHash = "";

  const check = (over: Record<string, unknown> = {}) => ({
    mode: "cite-check",
    itemId: WORK_ID,
    blockId: BLOCK,
    quote: WORK.title,
    ...over,
  });
  const askedFor = (blockId = BLOCK) => askDoesItSayThatAboutBlock(WORK, blockId);
  const send = (over: Record<string, unknown> = {}) =>
    ask({ threadId: THREAD, question: askedFor(), anchor: { blockId: BLOCK }, origin: check(), ...over });

  const fills = () =>
    getDb()
      .select({ id: rateLimitEvents.id, leaseUntil: rateLimitEvents.leaseUntil })
      .from(rateLimitEvents)
      .where(and(eq(rateLimitEvents.ownerId, TEST_OWNER), eq(rateLimitEvents.bucket, "cite-check")));

  async function setBibliography(over: Partial<Bibliography> = {}, work: Partial<CitedWork> = {}): Promise<void> {
    const bibliography: Bibliography = {
      version: "citations/7",
      generator: "test",
      slug: SLUG,
      sourceHash: freshHash,
      citations: [
        {
          id: WORK_ID,
          key: "arxiv:1706.03762",
          ...WORK,
          why: "The architecture the piece builds on.",
          mentions: [],
          citedAt: [BLOCK],
          firstCited: BLOCK,
          citedInBody: true,
          url: "https://arxiv.org/abs/1706.03762",
          linkFrom: "arxiv",
          ...work,
        },
      ],
      capped: false,
      generatedAt: "2026-10-24T00:00:00.000Z",
      elapsedMs: 1,
      ...over,
    };
    await getDb().update(articleRevisions).set({ bibliography }).where(eq(articleRevisions.id, revisionId));
  }

  beforeAll(async () => {
    const [row] = await getDb()
      .select({ revision: articles.currentRevisionId })
      .from(articles)
      .where(eq(articles.id, (article as ScratchArticle).articleId));
    if (!row?.revision) throw new Error("the scratch article has no current revision");
    revisionId = row.revision;
    /* The fingerprint the pipeline writes (`inputFingerprint` over what
       `loadArticle` returns), so the list reads as fresh — asserted, so a
       wrong hash cannot pass every refusal below as "stale" for free. */
    const loaded = await asTestOwner(() => loadArticle(SLUG));
    freshHash = inputFingerprint(loaded.blocks, loaded.tree, loaded.meta);
    await setBibliography();
    expect((await asTestOwner(() => loadBibliography(SLUG))).stale).toBe(false);
    await seedAuthUser(getDb(), { id: STRANGER, email: "cite-check-stranger@example.invalid", onConflictDoNothing: true });
  });

  beforeEach(async () => {
    await setBibliography();
    await getDb().delete(rateLimitEvents).where(eq(rateLimitEvents.bucket, "cite-check"));
    calls = 0;
    before = globalThis.fetch;
    globalThis.fetch = (() => {
      calls += 1;
      return Promise.reject(new Error("no model in tests"));
    }) as unknown as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = before;
    vi.restoreAllMocks();
    await getDb().delete(rateLimitEvents).where(eq(rateLimitEvents.bucket, "cite-check"));
  });

  it("stores the origin and the anchor on the thread a press creates, and takes no allowance", async () => {
    const out = await send();
    expect(out.frames[0]?.event).toBe("begin");
    expect(out.frames[0]?.data.origin).toEqual(check());
    const thread = await stored();
    expect(thread?.origin).toEqual(check());
    expect(thread?.anchor).toEqual({ blockId: BLOCK });
    expect(thread?.title).toBe("Does it say that? Attention Is All You Need");
    expect(thread?.messages[0]?.text).toBe(askedFor());
    expect(calls, "the press reached the model").toBeGreaterThan(0);
    expect(await fills(), "a press is never capped and takes nothing").toHaveLength(0);
    const [row] = await getDb()
      .select({ mode: chatThreads.originMode, item: chatThreads.originItemId, block: chatThreads.originBlockId })
      .from(chatThreads)
      .where(and(eq(chatThreads.articleId, (article as ScratchArticle).articleId), eq(chatThreads.id, THREAD)));
    expect(row).toEqual({ mode: "cite-check", item: WORK_ID, block: BLOCK });
  });

  it("takes exactly one fill for an automatic start, and frees its slot when the turn ends", async () => {
    const out = await send({ auto: true });
    expect(out.frames[0]?.event).toBe("begin");
    expect(calls).toBeGreaterThan(0);
    const rows = await fills();
    expect(rows, "one fill, still counted").toHaveLength(1);
    expect(rows[0]?.leaseUntil, "the lease freed in the turn's finally").toBeNull();
  });

  it("keeps the concurrency lease through the answer's gist model and store work", async () => {
    let leaseDuringGist: Date | null | undefined;
    globalThis.fetch = (async (_url, init) => {
      calls += 1;
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const format = request.response_format as { json_schema?: { name?: unknown } } | undefined;
      if (format?.json_schema?.name === "conversation_gist") {
        leaseDuringGist = (await fills())[0]?.leaseUntil;
        return Response.json({
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ gist: "A short answer" }) } }],
        });
      }
      const body = [
        `data: ${JSON.stringify({ model: "test/model", choices: [{ delta: { content: "Because." } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ finish_reason: "stop", delta: {} }] })}\n\n`,
        "data: [DONE]\n\n",
      ].join("");
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;

    await send({ auto: true });

    expect(leaseDuringGist, "the slot remains held while the gist runs").toBeInstanceOf(Date);
    expect((await fills())[0]?.leaseUntil, "the slot is freed after the gist is stored").toBeNull();
  });

  it("refunds an automatic fill when response setup fails before the model starts", async () => {
    const out = await call(
      "POST",
      `/api/chat/${SLUG}`,
      {
        threadId: THREAD,
        question: askedFor(),
        anchor: { blockId: BLOCK },
        origin: check(),
        auto: true,
      },
      {
        flushHeaders: () => {
          throw new Error("response setup failed before the model");
        },
      },
    );
    expect(out.status).toBe(200);
    expect(calls, "no model call").toBe(0);
    expect(await fills(), "a pre-model failure is refunded, not merely released").toHaveLength(0);
  });

  it("settles the allowance even when closing the response throws", async () => {
    await expect(
      call(
        "POST",
        `/api/chat/${SLUG}`,
        {
          threadId: THREAD,
          question: askedFor(),
          anchor: { blockId: BLOCK },
          origin: check(),
          auto: true,
        },
        {
          end: () => {
            throw new Error("response close failed");
          },
        },
      ),
    ).rejects.toThrow("response close failed");
    expect(calls, "the model was entered, so the fill remains counted").toBeGreaterThan(0);
    const rows = await fills();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.leaseUntil, "the terminal settlement still frees the slot").toBeNull();
  });

  it("answers a second start for the same work and paragraph with a 409 carrying the first's id, spending nothing", async () => {
    await send();
    const spentSoFar = calls;
    for (const body of [
      { threadId: OTHER_THREAD, auto: true },
      { threadId: OTHER_THREAD },
      /* The same first turn resent under its own id. */
      { auto: true },
    ]) {
      const out = await send(body);
      expect(out.status).toBe(409);
      expect(out.body?.threadId).toBe(THREAD);
    }
    expect(calls, "no second model call").toBe(spentSoFar);
    expect(await fills()).toHaveLength(0);
    expect(await threads()).toHaveLength(1);
  });

  it("keeps a saved chat reopenable after the Bibliography goes stale: the 409 still carries its id", async () => {
    await send();
    await setBibliography({ sourceHash: "moved-since" });
    const out = await send({ threadId: OTHER_THREAD, auto: true });
    expect(out.status).toBe(409);
    expect(out.body?.threadId).toBe(THREAD);
  });

  it("lets the same work in another paragraph have its own chat", async () => {
    await setBibliography({}, { citedAt: [BLOCK, OTHER_BLOCK] });
    await send();
    const out = await ask({
      threadId: OTHER_THREAD,
      question: askedFor(OTHER_BLOCK),
      anchor: { blockId: OTHER_BLOCK },
      origin: check({ blockId: OTHER_BLOCK }),
    });
    expect(out.frames[0]?.event).toBe("begin");
    expect(await threads()).toHaveLength(2);
  });

  it.each<[string, () => Record<string, unknown>, number]>([
    ["auto that is not true", () => ({ auto: "yes" }), 400],
    ["auto: false", () => ({ auto: false }), 400],
    ["auto without a cite-check origin", () => ({ auto: true, origin: undefined, anchor: undefined }), 400],
    ["no anchor", () => ({ anchor: undefined }), 400],
    ["an anchor on another paragraph", () => ({ anchor: { blockId: OTHER_BLOCK } }), 400],
    ["a selection anchor", () => ({ anchor: { blockId: BLOCK, quote: "x", start: 0 } }), 400],
    ["a help press", () => ({ help: true }), 400],
    ["a lens beside it", () => ({ origin: check({ lens: "an angle" }) }), 400],
    ["a malformed work id", () => ({ origin: check({ itemId: "not-an-id" }) }), 400],
    ["a malformed block id", () => ({ origin: check({ blockId: "not-a-block" }), anchor: { blockId: "not-a-block" } }), 400],
    ["an empty title", () => ({ origin: check({ quote: "  " }) }), 400],
    ["a title over the cap", () => ({ origin: check({ quote: "x".repeat(301) }) }), 413],
    ["a question that is not the one the server builds", () => ({ question: "Is this paper any good?" }), 409],
    ["a question built from another work", () => ({ question: askDoesItSayThatAboutBlock({ title: "Another" }, BLOCK) }), 409],
    ["a work the list does not have", () => ({ origin: check({ itemId: "spya-wrk333" }) }), 409],
    [
      "a paragraph that does not cite the work",
      () => ({ origin: check({ blockId: OTHER_BLOCK }), anchor: { blockId: OTHER_BLOCK }, question: askedFor(OTHER_BLOCK) }),
      409,
    ],
  ])("refuses %s before spending anything", async (_name, over, status) => {
    /* A thunk, because the blocks are read in `beforeAll`, after the table is built. */
    const out = await send({ auto: true, ...over() });
    expect(out.status, JSON.stringify(out.body)).toBe(status);
    expect(out.frames, "an ordinary JSON answer, not a stream").toHaveLength(0);
    expect(calls, "no model call").toBe(0);
    expect(await fills(), "no fill").toHaveLength(0);
    expect(await threads(), "no thread").toHaveLength(0);
  });

  it("refuses a stale Bibliography, and one that is not there, before spending anything", async () => {
    await setBibliography({ sourceHash: "moved-since" });
    const stale = await send({ auto: true });
    expect(stale.status).toBe(409);
    expect(stale.body?.threadId).toBeUndefined();
    await getDb().update(articleRevisions).set({ bibliography: null }).where(eq(articleRevisions.id, revisionId));
    const missing = await send({ auto: true });
    expect(missing.status).toBe(409);
    expect(calls).toBe(0);
    expect(await fills()).toHaveLength(0);
    expect(await threads()).toHaveLength(0);
  });

  it("refuses an edit of the first question, spending nothing", async () => {
    await send();
    const thread = (await stored()) as ChatThread;
    const first = thread.messages[0]?.id as string;
    const spentSoFar = calls;
    const out = await ask({ threadId: THREAD, edit: first, question: "Something else entirely?" });
    expect(out.status).toBe(409);
    expect(calls).toBe(spentSoFar);
    expect((await stored())?.messages[0]?.text).toBe(askedFor());
  });

  /** Rows of the bucket, written as the limiter writes them, `ago` ms in the past. */
  async function spend(owner: string, n: number, ago: number, leased = false): Promise<void> {
    await getDb()
      .insert(rateLimitEvents)
      .values(
        Array.from({ length: n }, () => ({
          ownerId: owner,
          bucket: "cite-check",
          startedAt: new Date(Date.now() - ago),
          leaseUntil: leased ? new Date(Date.now() + 60_000) : null,
        })),
      );
  }

  it.each<[string, () => Promise<void>, number, string]>([
    ["the hour", () => spend(TEST_OWNER, 8, 1_000), 429, "hour"],
    ["the reader's day", () => spend(TEST_OWNER, 20, 2 * 60 * 60 * 1000), 429, "day"],
    ["two already running", () => spend(TEST_OWNER, 2, 1_000, true), 429, "busy"],
    ["everybody's day", () => spend(STRANGER, 100, 2 * 60 * 60 * 1000), 503, "global"],
  ])("refuses an automatic start at %s with a reason, and spends nothing", async (_name, fill, status, reason) => {
    await fill();
    const counted = (await fills()).length;
    const out = await send({ auto: true });
    expect(out.status).toBe(status);
    expect(out.body?.reason).toBe(reason);
    expect(typeof out.body?.error).toBe("string");
    expect(calls).toBe(0);
    expect((await fills()).length).toBe(counted);
    expect(await threads()).toHaveLength(0);
    /* A press is never capped. */
    const pressed = await send();
    expect(pressed.frames[0]?.event).toBe("begin");
  });

  it("refunds the fill when the store finds the chat the route's own look missed", async () => {
    /* The race's losing half, made deterministic: another tab's start landed
       after this request's look for an existing chat, so the look saw none —
       here, a look that returns nothing — and `withTurn`, under the article
       row lock, refuses it (plan § C1). */
    await send();
    const spentSoFar = calls;
    vi.spyOn(chatStore, "load").mockResolvedValue([]);
    const out = await send({ threadId: OTHER_THREAD, auto: true });
    vi.restoreAllMocks();
    expect(out.status).toBe(409);
    expect(out.body?.threadId).toBe(THREAD);
    expect(calls, "no model call for the loser").toBe(spentSoFar);
    expect(await fills(), "its fill refunded, not counted").toHaveLength(0);
    expect(await threads()).toHaveLength(1);
  });

  it("makes one thread, one model call and one counted fill from two starts at once", async () => {
    /* One turn's worth of model calls, measured rather than assumed. */
    await send({ threadId: OTHER_THREAD });
    const perTurn = calls;
    await asTestOwner(async () => {
      for (const thread of await chatStore.load(SLUG)) await chatStore.remove(SLUG, thread.id);
    });
    calls = 0;
    const [a, b] = await Promise.all([send({ auto: true }), send({ threadId: OTHER_THREAD, auto: true })]);
    const won = [a, b].filter((r) => r.frames[0]?.event === "begin");
    const lost = [a, b].filter((r) => r.status === 409);
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    const all = await threads();
    expect(all).toHaveLength(1);
    expect(lost[0]?.body?.threadId).toBe(all[0]?.id);
    expect(calls).toBe(perTurn);
    expect(await fills()).toHaveLength(1);
  });

  it("holds the shape in the database: a cite-check row without its block is refused by its CHECK", async () => {
    const err = await getDb()
      .insert(chatThreads)
      .values({
        articleId: (article as ScratchArticle).articleId,
        id: THREAD,
        ownerId: TEST_OWNER,
        title: "t",
        kind: "chat",
        originMode: "cite-check",
        originItemId: WORK_ID,
        originQuote: WORK.title,
      })
      .catch((e: unknown) => e);
    expect(violatesCheckConstraint(err, "chat_threads_origin_cite_check")).toBe(true);
  });

  it("holds one per work and block in the database, and reads a violation as the 409's conflict", async () => {
    await send();
    const origin = check() as CiteCheckOrigin;
    const err = await getDb()
      .insert(chatThreads)
      .values({
        articleId: (article as ScratchArticle).articleId,
        id: OTHER_THREAD,
        ownerId: TEST_OWNER,
        title: "t",
        kind: "chat",
        originMode: "cite-check",
        originItemId: WORK_ID,
        originBlockId: BLOCK,
        originQuote: WORK.title,
      })
      .catch((e: unknown) => e);
    expect(violatesConstraint(err, CITE_CHECK_INDEX)).toBe(true);
    const conflict = await citeCheckConflictOf(err, (article as ScratchArticle).articleId, origin);
    expect(conflict).toBeInstanceOf(CiteCheckExists);
    expect(conflict?.threadId).toBe(THREAD);
    expect(await citeCheckConflictOf(new Error("anything else"), (article as ScratchArticle).articleId, origin)).toBeNull();
  });
});

/**
 * **A quiz mark's origin** (plan 261024i, stage 2; Greg's B on q-nvxfwx).
 * Not one of the item origins: the attempt is the identity, the route reads
 * it, and the stored quote is the question the attempt kept. GPT Sol's F3 and
 * F4 on that plan.
 */
describe("a quiz mark's origin", () => {
  const BATCH = "spya-bat222";
  const QUESTION = "spya-qqq222";
  const ASKED = "What does the author mean by order?";
  const keep = (over: { batchId?: string; questionId?: string } = {}) =>
    asTestOwner(() =>
      quizAttemptStore.record(SLUG, {
        batchId: over.batchId ?? BATCH,
        questionId: over.questionId ?? QUESTION,
        question: ASKED,
        answer: "Time's direction",
        reply: "Partly.",
      }),
    );
  const mark = (attemptId: string, over: Record<string, unknown> = {}) => ({
    mode: "quiz",
    batchId: BATCH,
    itemId: QUESTION,
    attemptId,
    quote: ASKED,
    ...over,
  });

  it("stores the mark, and reads it back equal, on the summary too", async () => {
    const { id } = await keep();
    const out = await ask({ threadId: THREAD, question: "why only partly?", origin: mark(id) });
    expect(out.frames[0]?.event).toBe("begin");
    expect((await stored())?.origin).toEqual(mark(id));
    expect((await stored())?.title).toBe(`Quiz: ${ASKED}`);
    const summaries = (await call("GET", `/api/chat/${SLUG}?summary=1`)).body?.threads as ThreadSummary[];
    expect(summaries.find((t) => t.id === THREAD)?.origin).toEqual(mark(id));
  });

  it("stores the question the attempt kept, not the one the request sent", async () => {
    const { id } = await keep();
    await ask({ threadId: THREAD, question: "why?", origin: mark(id, { quote: "a forged question" }) });
    expect((await stored())?.origin).toEqual(mark(id));
  });

  it("refuses an attempt this article does not have, or with another batch or question, as a 400", async () => {
    const { id } = await keep();
    const missing = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a01";
    for (const origin of [
      mark(missing),
      mark(id, { batchId: "spya-bat333" }),
      mark(id, { itemId: "spya-qqq333" }),
    ]) {
      const out = await ask({ threadId: THREAD, question: "why?", origin });
      expect(out.status).toBe(400);
      expect(JSON.stringify(out.body)).not.toContain(ASKED);
    }
    expect(await stored()).toBeUndefined();
  });

  it("refuses a malformed mark before reading anything", async () => {
    const { id } = await keep();
    for (const origin of [
      mark("not-a-uuid"),
      mark(id, { batchId: "" }),
      mark(id, { blockId: BLOCK }),
      mark(id, { quote: "" }),
    ]) {
      expect((await ask({ threadId: THREAD, question: "why?", origin })).status).toBe(400);
    }
  });

  it("refuses another mark on its thread with a 409, and lets the same one through", async () => {
    const first = await keep();
    const again = await keep();
    await ask({ threadId: THREAD, question: "why?", origin: mark(first.id) });
    expect((await ask({ threadId: THREAD, question: "and?", origin: mark(again.id) })).status).toBe(409);
    expect((await ask({ threadId: THREAD, question: "and?", origin: mark(first.id) })).frames[0]?.event).toBe("begin");
  });

  it("holds the copies to the attempt, and refuses half a mark, in the database", async () => {
    const { id } = await keep();
    const articleId = (article as ScratchArticle).articleId;
    const insert = (over: Partial<typeof chatThreads.$inferInsert>) =>
      getDb()
        .insert(chatThreads)
        .values({ articleId, id: THREAD, ownerId: TEST_OWNER, title: "by hand", ...over })
        .then(
          () => null,
          (e: unknown) => String((e as { cause?: { message?: string } }).cause?.message ?? e),
        );
    const whole = { originMode: "quiz", originItemId: QUESTION, originQuote: ASKED, originBatchId: BATCH, originAttemptId: id };
    expect(await insert({ ...whole, originBatchId: "spya-bat333" })).toMatch(/chat_threads_origin_quiz_attempt_fk/);
    expect(await insert({ ...whole, originItemId: "spya-qqq333" })).toMatch(/chat_threads_origin_quiz_attempt_fk/);
    expect(await insert({ ...whole, originAttemptId: null })).toMatch(/chat_threads_origin_quiz\b/);
    expect(await insert({ ...whole, originBlockId: BLOCK })).toMatch(/chat_threads_origin_quiz\b/);
    expect(
      await insert({ originMode: "glossary", originItemId: "spya-ttm222", originQuote: "q", originBatchId: BATCH }),
    ).toMatch(/chat_threads_origin_quiz_only/);
    expect(await insert({ originBatchId: BATCH })).toMatch(/chat_threads_origin_quiz_only/);
    expect(await insert(whole)).toBeNull();
  });

  it("refuses to delete a mark a chat is about, and deletes it once the chat has gone", async () => {
    const { id } = await keep();
    await ask({ threadId: THREAD, question: "why?", origin: mark(id) });
    const gone = () => getDb().delete(quizAttempts).where(eq(quizAttempts.id, id));
    const err: unknown = await gone().then(
      () => null,
      (e: unknown) => e,
    );
    expect(String((err as { cause?: { message?: string } } | null)?.cause?.message ?? err)).toMatch(
      /chat_threads_origin_quiz_attempt_fk/,
    );
    await asTestOwner(() => chatStore.remove(SLUG, THREAD));
    await gone();
  });

  it("goes with its article, chat and attempt in one statement", async () => {
    /* The loader stores the raw source, which needs the real fetch. */
    const stub = globalThis.fetch;
    globalThis.fetch = realFetch;
    const doomed = await scratchArticleInPg(`${SLUG}-quiz-doomed`, { ownerId: TEST_OWNER }).finally(() => {
      globalThis.fetch = stub;
    });
    try {
      const { id } = await asTestOwner(() =>
        quizAttemptStore.record(doomed.slug, {
          batchId: BATCH,
          questionId: QUESTION,
          question: ASKED,
          answer: "a",
          reply: "b",
        }),
      );
      const out = await call("POST", `/api/chat/${doomed.slug}`, {
        threadId: THREAD,
        question: "why?",
        origin: mark(id),
      });
      expect(out.frames[0]?.event).toBe("begin");
      await getDb().delete(articles).where(eq(articles.id, doomed.articleId));
      expect(await getDb().select().from(quizAttempts).where(eq(quizAttempts.id, id))).toEqual([]);
    } finally {
      await doomed.remove();
    }
  });

  it("is deleted before the attempts it names when an article changes owner", async () => {
    const order = READER_STATE.map((kind) => kind.table);
    expect(order.indexOf("chat_threads")).toBeLessThan(order.indexOf("quiz_attempts"));
  });

  it("exports the mark and its attempt's id, and the restore puts it back", async () => {
    const { id } = await keep();
    await ask({ threadId: THREAD, question: "why?", origin: mark(id) });
    const out = await mkdtemp(path.join(tmpdir(), "spideryarn-export-quiz-"));
    const exported = path.join(process.cwd(), "data", SLUG);
    const stub = globalThis.fetch;
    globalThis.fetch = realFetch;
    try {
      await asTestOwner(() =>
        exportArticle(SLUG, { dataRoot: path.join(process.cwd(), "data"), outputRoot: path.join(out, "output") }),
      );
      const chat = JSON.parse(await readFile(path.join(exported, "chat.json"), "utf8")) as { threads: ChatThread[] };
      expect(chat.threads.find((t) => t.id === THREAD)?.origin).toEqual(mark(id));
      const kept = JSON.parse(await readFile(path.join(exported, "quiz-attempts.json"), "utf8")) as {
        attempts: { id: string }[];
      };
      expect(kept.attempts.map((a) => a.id)).toContain(id);
      /* A real restore has neither row. Remove the thread first because the
         foreign key correctly refuses the reverse order, then prove the
         seeder puts the attempt back before the chat that names it. */
      await asTestOwner(() => chatStore.remove(SLUG, THREAD));
      await getDb().delete(quizAttempts).where(eq(quizAttempts.id, id));
      await asTestOwner(() => seedChatFromFiles(SLUG));
      expect((await stored())?.origin).toEqual(mark(id));
      expect(await getDb().select({ id: quizAttempts.id }).from(quizAttempts).where(eq(quizAttempts.id, id))).toEqual([
        { id },
      ]);
    } finally {
      globalThis.fetch = stub;
      await rm(exported, { recursive: true, force: true });
      await rm(out, { recursive: true, force: true });
    }
  });
});
