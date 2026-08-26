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
 * ## What is deliberately not tested here
 *
 * The foreign key. This harness writes to the filesystem store, which has no
 * such thing; `tests/chat-anchor.test.ts` covers it against Postgres, where it
 * exists. What *is* tested here is the check that makes the foreign key a 400
 * anybody can read rather than a 500 out of a transaction.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { loadArticle } from "../src/api.js";
import { loadThreads } from "../src/chat.js";
import { handleApi } from "../src/routes.js";

/* An unknown slug falls through to the committed fixture article, so the turn
   has real blocks to anchor to without this test owning an article. The chat
   file is written under this slug, which is why it is a throwaway. */
const SLUG = "test-chat-anchor-route";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
afterEach(() => rm(DIR, { recursive: true, force: true }));

const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() =>
    Promise.reject(new Error("no model in tests"))) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

/** A real block of the fixture article, and a real run of words inside it. */
const article = await loadArticle(SLUG);
const BLOCK = article.blocks.find((b) => b.text.trim().length > 30);
if (!BLOCK) throw new Error("the fixture article has no block long enough to select inside");
const QUOTE = BLOCK.text.trim().slice(0, 20);
const START = BLOCK.text.indexOf(QUOTE);

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
    { method: "POST", url: pathname },
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

  await handleApi(req, res);

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

describe("an anchor on the way in", () => {
  it("accepts a selection and stores it on the thread", async () => {
    const out = await ask({
      threadId: "spya-anchr2",
      question: "what does this mean?",
      anchor: { blockId: BLOCK.id, quote: QUOTE, start: START },
    });
    expect(out.frames[0]?.event).toBe("begin");
    const stored = (await loadThreads(SLUG)).find((t) => t.id === "spya-anchr2");
    expect(stored?.anchor).toEqual({ blockId: BLOCK.id, quote: QUOTE, start: START });
  });

  it("accepts a block-only anchor, which is what the paragraph button sends", async () => {
    await ask({
      threadId: "spya-anchr2",
      question: "tell me about this paragraph",
      anchor: { blockId: BLOCK.id },
    });
    const stored = (await loadThreads(SLUG)).find((t) => t.id === "spya-anchr2");
    expect(stored?.anchor).toEqual({ blockId: BLOCK.id });
    // Absent, not undefined — the two stores are compared on exactly this.
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
    expect(await loadThreads(SLUG)).toHaveLength(0);
  });

  it("refuses a block that is not in this article", async () => {
    /* Well-formed, so the id check passes; the article is what says no. Without
       this, Postgres answers with a foreign-key violation out of a transaction
       — a 500 where a 400 belonged. */
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
       docs/project/logging.md forbids outright. */
    const secret = "Utility of phrenology";
    const out = await ask({
      threadId: "spya-anchr3",
      question: "what?",
      anchor: { blockId: BLOCK.id, quote: `${secret} but wrong`, start: 999_999 },
    });
    expect(out.status).toBe(400);
    expect(JSON.stringify(out.body)).not.toContain(secret);
  });
});

describe("a thread is anchored once", () => {
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
    const stored = (await loadThreads(SLUG)).find((t) => t.id === "spya-anchr2");
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

describe("cancelling the first answer", () => {
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
    expect(await loadThreads(SLUG)).toHaveLength(0);
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
    const tail = (await loadThreads(SLUG)).find((t) => t.id === threadId)?.messages;
    const lastId = tail?.[tail.length - 1]?.id as string;

    /* The race Sol found, as a test. Stop-then-delete had no guard here, so a
       second question arriving in the gap was deleted along with the first. */
    const out = await post(`/api/chat/${SLUG}/${threadId}/cancel`, { messageId: lastId });
    expect(out.status).toBe(409);
    expect((await loadThreads(SLUG)).find((t) => t.id === threadId)?.messages).toHaveLength(4);
  });

  it("refuses when the answer named is not the one at the end", async () => {
    const first = await ask({ threadId: "spya-anchr2", question: "what?" });
    const threadId = first.frames[0]?.data.threadId as string;
    const out = await post(`/api/chat/${SLUG}/${threadId}/cancel`, { messageId: "spya-msgaaa" });
    expect(out.status).toBe(409);
    expect(await loadThreads(SLUG)).toHaveLength(1);
  });
});
