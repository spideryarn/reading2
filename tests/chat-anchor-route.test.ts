/**
 * The anchor, at the route — validation, and the rule that a thread is anchored
 * once.
 *
 * Everything here is checked **before a byte of the stream goes out**, which is
 * what lets a bad anchor be an ordinary JSON 400 rather than an `error` frame
 * inside a 200. `answer()` states the same rule for comments a few hundred
 * lines up in src/routes.ts.
 *
 * Nothing reaches the model: `fetch` is stubbed, so `converse` fails on its
 * first call. That is fine and deliberate — every assertion here is about what
 * happens before it. Same trick, same reasons, as tests/chat-route.test.ts.
 *
 * ## It ran on the filesystem store until 2026-09-04, and that is the point
 *
 * This file's own header used to say the foreign key was *deliberately not
 * tested here* because `this harness writes to the filesystem store, which has
 * no such thing`. That sentence was true, and it was the bug: a route suite
 * exercising the store that is not deployed
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § B). It now pins `postgres` before any import and seeds through
 * `scratchArticleInPg`, so *refuses a block that is not in this article* stands
 * in front of a real `revision_blocks` foreign key rather than in front of
 * nothing — and what the deleted check produces is a 500 out of a transaction,
 * which is exactly what the 400 exists to prevent. On files there was no such
 * thing to prevent, so the case could not distinguish the guard from its
 * absence.
 *
 * tests/chat-anchor.test.ts remains the store-level twin: it seeds an article
 * by hand and drives `withTurn`, where this one goes through `handleApi`, so
 * the status codes and the SSE frames here are the route's.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `SPIDERYARN_STORE=postgres`, before **any** import runs — `src/store/live.ts`
 * reads the flag once and imports are hoisted above every statement. Copied
 * from tests/candidates-route.test.ts, which explains the shape.
 */
const PREVIOUS_STORE_FLAG = vi.hoisted(() => {
  const previous = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return previous;
});

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

/** A throwaway slug, so the conversations written below belong to nobody. */
const SLUG = "test-chat-anchor-route";

const { reachable } = await pgReady({
  suite: "tests/chat-anchor-route.test.ts",
  tables: ["spideryarn.chat_threads", "spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");
const { chatStore, STORE } = await import("../src/store/index.js");

if (PREVIOUS_STORE_FLAG === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = PREVIOUS_STORE_FLAG;

const when = reachable ? describe : describe.skip;

describe("the store these tests are actually talking to", () => {
  it("is the Postgres one", () => {
    /* A flag that failed to take looks exactly like this suite working: the
       filesystem store answers happily, and the foreign key the
       article-membership check stands in front of is never touched. */
    expect(STORE).toBe("postgres");
  });
});

/**
 * The article, and a real run of words inside one of its blocks.
 *
 * Read off the seeded clone rather than written down. `scratchArticleInPg`
 * hands back the blocks it actually loaded, and a literal block id taken from
 * `example/` would not survive the move to the corpus article this now uses —
 * see `ScratchArticle.blocks`.
 */
let article: ScratchArticle | undefined;
let BLOCK = { id: "", text: "" };
let QUOTE = "";
let START = 0;

beforeAll(async () => {
  if (!reachable) return;
  /* `TEST_OWNER`, because `acceptAny` authenticates as that reader and the
     Postgres reader filters every article by owner. An article seeded as
     anybody else is invisible and every route below answers 404, which looks
     exactly like a broken route — `ScratchOptions.ownerId`. */
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  const long = article.blocks.find((b) => b.text.trim().length > 30);
  if (!long) throw new Error("the fixture article has no block long enough to select inside");
  BLOCK = { id: long.id, text: long.text };
  QUOTE = long.text.trim().slice(0, 20);
  START = long.text.indexOf(QUOTE);
  expect(BLOCK.id).toMatch(/^spya-/);
  expect(START).toBeGreaterThanOrEqual(0);
}, 60_000);

/**
 * Conversations, and nothing a previous case wrote beside them.
 *
 * Where the filesystem version re-copied `example/` into `data/<slug>/` after
 * every case, which threw the chat file away along with it. Deleting the
 * threads and keeping the article is the same reset: nothing here writes to the
 * article, and a published revision is not editable anyway.
 */
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

/**
 * Every read-back runs as the reader the request ran as.
 *
 * Outside a request `currentOwnerId()` falls back to the environment's owner,
 * and the read then fails as a 404 about the fixture arriving in the assertion
 * — see `asTestOwner`.
 */
const threads = () => asTestOwner(() => chatStore.load(SLUG));

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
  /** The JSON body, when the route answered with one rather than a stream. */
  body: Record<string, unknown> | null;
  /** The SSE frames, when it streamed. */
  frames: { event: string; data: Record<string, unknown> }[];
}

async function post(pathname: string, body: unknown): Promise<Result> {
  const payload = [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method: "POST", url: pathname , headers: AUTHED_HEADERS },
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

const ask = (body: unknown) => post(`/api/chat/${SLUG}`, body);

when("an anchor on the way in", () => {
  /**
   * **Mutation.** The pilot conversion's own, recorded in
   * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
   * § the pilot table rather than watched again here: `anchorQuote: quoteOf(…)`
   * made `anchorQuote: null` in `pg-chat.ts`, and the run printed `4 failed`.
   * Sharper than it was meant to be — a null `anchor_quote` beside a non-null
   * `anchor_start` violates the `chat_threads_anchor_both` CHECK, so the route
   * 500s, where the filesystem store would have written the fourth anchor shape
   * and said nothing.
   *
   * **Blind to.** Which of the two it proves. Because that mutation trips a
   * CHECK rather than a read, the reds do not separate *the quote was written*
   * from *the row was written at all*, and the case below asserting the anchor
   * comes back whole is doing the second of those jobs, not the first. The
   * `anchorStart` column beside it was never mutated.
   */
  it("accepts a selection and stores it on the thread", async () => {
    const out = await ask({
      threadId: "spya-anchr2",
      question: "what does this mean?",
      anchor: { blockId: BLOCK.id, quote: QUOTE, start: START },
    });
    expect(out.frames[0]?.event).toBe("begin");
    const stored = (await threads()).find((t) => t.id === "spya-anchr2");
    expect(stored?.anchor).toEqual({ blockId: BLOCK.id, quote: QUOTE, start: START });
  });

  it("accepts a block-only anchor, which is what the paragraph button sends", async () => {
    await ask({
      threadId: "spya-anchr2",
      question: "tell me about this paragraph",
      anchor: { blockId: BLOCK.id },
    });
    const stored = (await threads()).find((t) => t.id === "spya-anchr2");
    expect(stored?.anchor).toEqual({ blockId: BLOCK.id });
    /* Absent, not undefined — the two stores were compared on exactly this, and
       under Postgres it is the reader's job rather than `JSON.stringify`'s:
       `quote` and `start` are their own nullable columns, so a read that spread
       them back unconditionally would hand the client `{ blockId, quote: null }`
       — the fourth anchor shape tests/chat-anchor.test.ts says must not exist. */
    expect("quote" in (stored?.anchor ?? {})).toBe(false);
  });

  /* Half an anchor is not an error anybody sees. It is a mark drawn a few
     characters to the left of the words it belongs to, which reads as a styling
     glitch rather than as bad data — so it has to be refused at the door. */
  it.each([
    ["a quote with no offset", { blockId: "spya-aaaaaa", quote: "some words" }],
    ["an offset with no quote", { blockId: "spya-aaaaaa", start: 3 }],
    ["a negative offset", { blockId: "spya-aaaaaa", quote: "some words", start: -1 }],
    ["a fractional offset", { blockId: "spya-aaaaaa", quote: "some words", start: 1.5 }],
    ["an empty quote", { blockId: "spya-aaaaaa", quote: "   ", start: 0 }],
    ["a malformed block id", { blockId: "not-a-block", quote: "some words", start: 0 }],
    ["no block id at all", { quote: "some words", start: 0 }],
  ])("refuses %s", async (_name, anchor) => {
    const out = await ask({ threadId: "spya-anchr3", question: "what?", anchor });
    expect(out.status).toBe(400);
    // Nothing written: a refused request must not leave a thread behind.
    expect(await threads()).toHaveLength(0);
  });

  it("refuses a block that is not in this article", async () => {
    /* Well-formed, so the id check passes; the article is what says no. Without
       this, Postgres answers with a foreign-key violation out of a transaction
       — a 500 where a 400 belonged.

       **Mutation.** `checkAnchor` in src/routes.ts, with `if (!block) throw
       httpError(400, "anchor.blockId is not a block of this article");` made
       `if (!block) return;`, so a well-formed id belonging to no block of this
       article goes through to the store. Watched on 2026-09-04; the run printed
       `1 failed | 19 passed (20)` and this case failed with `expected 500 to be
       400`.

       **That is the sentence above made checkable**: on the filesystem store
       there was no foreign key for the guard to stand in front of, so the same
       deletion turned this case into an ordinary 200 and it could not tell the
       guard from its absence.

       **Blind to.** One branch of `checkAnchor` and no other. The `start` past
       the end of a block, the whitespace-folded `quote` comparison beneath it
       and the `isSpideryarnId` shape check in `parseAnchor` above it are three
       further refusals this deletion never touches, and the seven `it.each`
       cases stayed green under it — a well-formed id is where it starts. Nor
       does the assertion say which statement raised the 500: it reads a status
       code, so a 500 arriving from any other cause would look the same. */
    const out = await ask({
      threadId: "spya-anchr3",
      question: "what?",
      anchor: { blockId: "spya-zzzzzz", quote: "some words", start: 0 },
    });
    expect(out.status).toBe(400);
  });

  it("refuses a quote that is not in the block it names", async () => {
    const out = await ask({
      threadId: "spya-anchr3",
      question: "what?",
      anchor: { blockId: BLOCK.id, quote: "no such words appear here at all", start: 0 },
    });
    expect(out.status).toBe(400);
  });

  it("never repeats the quote back in the error", async () => {
    /* The quote is article prose. `httpError` messages are logged as `reason`,
       and redaction is path-based and cannot reach inside a string — so a
       message built from the request body puts the article in the log, which
       docs/project/logging.md forbids outright.

       The secret is taken from the seeded article rather than written down as a
       literal of `example/`'s prose: a phrase that is not in the article any
       more would pass this test without the route having redacted anything. */
    const secret = QUOTE;
    const out = await ask({
      threadId: "spya-anchr3",
      question: "what?",
      anchor: { blockId: BLOCK.id, quote: `${secret} but wrong`, start: 999_999 },
    });
    expect(out.status).toBe(400);
    expect(JSON.stringify(out.body)).not.toContain(secret);
  });
});

when("a thread is anchored once", () => {
  it("refuses a second question that names a different passage", async () => {
    await ask({
      threadId: "spya-anchr2",
      question: "what does this mean?",
      anchor: { blockId: BLOCK.id, quote: QUOTE, start: START },
    });
    const out = await ask({
      threadId: "spya-anchr2",
      question: "and now?",
      anchor: { blockId: BLOCK.id },
    });
    /* Silently ignoring this is the failure worth naming: a question about
       passage B, appended to a thread the database says is about passage A,
       with nothing anywhere disagreeing. */
    expect(out.status).toBe(409);
    const stored = (await threads()).find((t) => t.id === "spya-anchr2");
    expect(stored?.anchor).toEqual({ blockId: BLOCK.id, quote: QUOTE, start: START });
  });

  it("lets an identical anchor through, so a resent request is harmless", async () => {
    const anchor = { blockId: BLOCK.id, quote: QUOTE, start: START };
    await ask({ threadId: "spya-anchr2", question: "what does this mean?", anchor });
    const out = await ask({ threadId: "spya-anchr2", question: "and now?", anchor });
    expect(out.status).not.toBe(409);
    expect(out.frames[0]?.event).toBe("begin");
  });

  it("refuses an anchor sent with a retry", async () => {
    /* `withRetry` does not go through `withTurn` at all, so an anchor here
       would be dropped without a word. */
    const first = await ask({ threadId: "spya-anchr2", question: "what?" });
    const answerId = first.frames[0]?.data.messageId as string;
    const out = await ask({
      threadId: "spya-anchr2",
      retry: answerId,
      anchor: { blockId: BLOCK.id },
    });
    expect(out.status).toBe(400);
  });
});

when("cancelling the first answer", () => {
  it("throws the whole conversation away", async () => {
    const started = await ask({
      threadId: "spya-anchr2",
      question: "what does this mean?",
      anchor: { blockId: BLOCK.id, quote: QUOTE, start: START },
    });
    const threadId = started.frames[0]?.data.threadId as string;
    const messageId = started.frames[0]?.data.messageId as string;

    const out = await post(`/api/chat/${SLUG}/${threadId}/cancel`, { messageId });
    expect(out.body).toEqual({ cancelled: true });
    // Panel gone, mark gone, nothing in the list. Greg's call, 2026-08-26.
    expect(await threads()).toHaveLength(0);
  });

  it("is content when the conversation has already gone", async () => {
    // A second tab, a double-press, or a reader who cancelled and reloaded.
    // The client wants to close the panel either way, so this is not an error.
    const out = await post(`/api/chat/${SLUG}/spya-nosuch/cancel`, { messageId: "spya-msgaaa" });
    expect(out.body).toEqual({ cancelled: true });
  });

  it("refuses to delete a conversation that has more than one turn in it", async () => {
    const first = await ask({ threadId: "spya-anchr2", question: "what?" });
    const threadId = first.frames[0]?.data.threadId as string;
    await ask({ threadId, question: "and Dennett?" });
    const tail = (await threads()).find((t) => t.id === threadId)?.messages;
    const lastId = tail?.[tail.length - 1]?.id as string;

    /* The race Sol found, as a test. Stop-then-delete had no guard here, so a
       second question arriving in the gap was deleted along with the first. */
    const out = await post(`/api/chat/${SLUG}/${threadId}/cancel`, { messageId: lastId });
    expect(out.status).toBe(409);
    expect((await threads()).find((t) => t.id === threadId)?.messages).toHaveLength(4);
  });

  it("refuses when the answer named is not the one at the end", async () => {
    const first = await ask({ threadId: "spya-anchr2", question: "what?" });
    const threadId = first.frames[0]?.data.threadId as string;
    const out = await post(`/api/chat/${SLUG}/${threadId}/cancel`, { messageId: "spya-msgaaa" });
    expect(out.status).toBe(409);
    expect(await threads()).toHaveLength(1);
  });
});
