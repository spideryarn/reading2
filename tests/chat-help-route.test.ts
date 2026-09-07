/**
 * **`help` at the route: validated on the wire, read back off storage.**
 *
 * Two halves, and the second is the one GPT Sol's review was about (F-01, P1).
 *
 * *Validation.* `help` is accepted as **absent or literal `true`**, and anything
 * else is a 400 rather than a coercion. Same rule, same reason, as `stance` and
 * `kind` a few lines above it in `streamChat`: a client that sends `help: "yes"`
 * and gets a 200 has no way to learn that the answer it received was written
 * with the ordinary prompt, and neither has the reader. It is accepted only on
 * a **new question** — a retry and an edit are refused one, exactly as they are
 * refused a kind and a stance.
 *
 * *Derivation.* And that refusal is only safe because the flag lives on the
 * **stored user row**. A thread-level flag would have had to be refused on
 * retry too, and then
 *
 * > Retrying the first help answer would therefore lose the pedagogical
 * > instruction and become an ordinary chat answer. That is user-visible wrong
 * > behaviour.
 *
 * So the assertion that matters here is the last one: press "Try again" on an
 * explanation and the request that goes out still carries the explanation
 * instruction. `withRetry` hands back the same stored question; the route reads
 * `user.help` from it and never from the body.
 *
 * Harness copied from tests/chat-anchor-route.test.ts, with one difference: the
 * model stub answers instead of throwing, because what is under test is the
 * request body `converse` builds rather than what happens before it.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-chat-help-route";

/* **`pgReady` refuses rather than reports**, since the filesystem store and the
   `SPIDERYARN_STORE` flag were deleted on 2026-09-05 (260903f) and Postgres is
   the only store there is. This file was written against the older shape — a
   `reachable` flag, a `describe.skip`, and a hoisted flag set before the first
   import — and the merge that removed them is what caught it. There is nothing
   left to skip for: a database this cannot reach is a failure, not a pass. */
await pgReady({
  suite: "tests/chat-help-route.test.ts",
  tables: ["spideryarn.chat_threads", "spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");
const { chatStore } = await import("../src/store/index.js");

let article: ScratchArticle | undefined;
let BLOCK = "";

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  const first = article.blocks.find((b) => b.text.trim().length > 30);
  if (!first) throw new Error("the fixture article has no block worth anchoring to");
  BLOCK = first.id;
}, 60_000);

beforeEach(async () => {
  if (!article) return;
  await asTestOwner(async () => {
    for (const thread of await chatStore.load(SLUG)) await chatStore.remove(SLUG, thread.id);
  });
  sent.length = 0;
});

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

const threads = () => asTestOwner(() => chatStore.load(SLUG));

/* A model that answers, so the request body is built and can be read. `converse`
   is the thing under test here, not the thing being avoided. */
const sent: Record<string, unknown>[] = [];
const realFetch = globalThis.fetch;
beforeAll(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  globalThis.fetch = ((_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    const encoder = new TextEncoder();
    const frames = [
      `data: ${JSON.stringify({ model: "test/model", choices: [{ delta: { content: "Because." } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ finish_reason: "stop", delta: {} }] })}\n\n`,
      "data: [DONE]\n\n",
    ];
    return Promise.resolve({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(c) {
          for (const f of frames) c.enqueue(encoder.encode(f));
          c.close();
        },
      }),
    } as Response);
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

interface Result {
  status: number;
  body: Record<string, unknown> | null;
  frames: { event: string; data: Record<string, unknown> }[];
}

async function post(pathname: string, body: unknown): Promise<Result> {
  const payload = [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method: "POST", url: pathname, headers: AUTHED_HEADERS },
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
    .filter((b) => b.startsWith("event: "))
    .map((b) => {
      const [head, ...rest] = b.split("\n");
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

/** The last user message of the nth request that reached the model. */
const finalUser = (i: number) =>
  String(((sent[i] as { messages: { content: unknown }[] }).messages.at(-1)?.content ?? "") as string);

const HELP_LINE = 'The reader pressed the "?" beside this passage';

describe("what the wire may carry", () => {
  it("refuses a help that is not literally true", async () => {
    const r = await post(`/api/chat/${SLUG}`, {
      threadId: "spya-aaaaaa",
      question: "why?",
      help: "yes",
    });
    expect(r.status).toBe(400);
    expect(String(r.body?.error)).toMatch(/help/i);
  });

  it("refuses help: false rather than treating it as absent", async () => {
    /* `false` is not a smaller `true`: a client sending it has a bug, and
       accepting it quietly is how the bug survives to the next release. */
    const r = await post(`/api/chat/${SLUG}`, {
      threadId: "spya-aaaaaa",
      question: "why?",
      help: false,
    });
    expect(r.status).toBe(400);
  });

  it("refuses help on a retry, which takes it from the stored question instead", async () => {
    const r = await post(`/api/chat/${SLUG}`, {
      threadId: "spya-aaaaaa",
      retry: "spya-bbbbbb",
      help: true,
    });
    expect(r.status).toBe(400);
  });

  it("refuses help on an edit, for the same reason", async () => {
    const r = await post(`/api/chat/${SLUG}`, {
      threadId: "spya-aaaaaa",
      edit: "spya-bbbbbb",
      question: "why, really?",
      help: true,
    });
    expect(r.status).toBe(400);
  });
});

describe("a help press, end to end", () => {
  it("stores the flag on the reader's row and on nothing else", async () => {
    const r = await post(`/api/chat/${SLUG}`, {
      threadId: "spya-aaaaaa",
      question: "About this block: I could not follow it.",
      anchor: { blockId: BLOCK },
      help: true,
    });
    expect(r.frames.some((f) => f.event === "begin")).toBe(true);

    const [thread] = await threads();
    expect(thread).toBeDefined();
    const [user, reply] = thread!.messages;
    expect(user?.help, "the '?' press is not in the database").toBe(true);
    expect(reply).not.toHaveProperty("help");
    /* Still an ordinary anchored chat: a fourth `ThreadKind` was refused, and
       that refusal is what keeps every mark the reading view draws a chat. */
    expect(thread!.kind).toBe("chat");
  });

  it("puts the pedagogical instruction in the request that goes out", async () => {
    await post(`/api/chat/${SLUG}`, {
      threadId: "spya-aaaaaa",
      question: "About this block: I could not follow it.",
      anchor: { blockId: BLOCK },
      help: true,
    });
    expect(sent).toHaveLength(1);
    expect(finalUser(0)).toContain(HELP_LINE);
  });

  it("does NOT put it there for an ordinary question", async () => {
    await post(`/api/chat/${SLUG}`, {
      threadId: "spya-aaaaaa",
      question: "why does he say that?",
      anchor: { blockId: BLOCK },
    });
    expect(sent).toHaveLength(1);
    expect(finalUser(0)).not.toContain(HELP_LINE);
  });

  it("answers a RETRY of a help question as a help question", async () => {
    /* The whole reason the flag is on the message and not on the thread. A
       thread-level design has to refuse `help` on retry — and then pressing
       "Try again" on an explanation is silently answered with the ordinary
       prompt, with nothing on screen saying the answer changed kind. */
    await post(`/api/chat/${SLUG}`, {
      threadId: "spya-aaaaaa",
      question: "About this block: I could not follow it.",
      anchor: { blockId: BLOCK },
      help: true,
    });
    const [thread] = await threads();
    const replyId = thread?.messages[1]?.id;
    expect(replyId).toBeDefined();

    await post(`/api/chat/${SLUG}`, { threadId: "spya-aaaaaa", retry: replyId });
    expect(sent).toHaveLength(2);
    expect(
      finalUser(1),
      "The retry was answered with the ordinary chat prompt. The route must read " +
        "`help` off the stored user row, never off the request body.",
    ).toContain(HELP_LINE);
  });

  it("answers an EDIT of a help question as a help question", async () => {
    await post(`/api/chat/${SLUG}`, {
      threadId: "spya-aaaaaa",
      question: "About this block: I could not follow it.",
      anchor: { blockId: BLOCK },
      help: true,
    });
    const [thread] = await threads();
    const questionId = thread?.messages[0]?.id;
    expect(questionId).toBeDefined();

    await post(`/api/chat/${SLUG}`, {
      threadId: "spya-aaaaaa",
      edit: questionId,
      question: "About this block: I still could not follow it.",
    });
    expect(sent).toHaveLength(2);
    expect(finalUser(1)).toContain(HELP_LINE);
  });
});

/**
 * **What `help: true` is allowed to describe.**
 *
 * The shape check above only says the value is literally `true`. The *meaning*
 * is narrower, and it is written down in one place — `ChatMessage.help` in
 * src/types.ts: the paragraph "?" button created this thread. Three facts follow
 * from that sentence, and each of them is refused rather than dropped, the same
 * posture the anchor rule a few lines above it in `streamChat` takes, and for the
 * same reason: a client that gets a 200 for a request the server then quietly
 * reinterprets has no way to learn it was reinterpreted, and neither has the
 * reader — except in the row, which now says a button was pressed that was not.
 *
 * The create-the-thread rule is stated **twice** in `streamChat` — once off a
 * load taken before `loadArticle`, for the sentence and the fast refusal, and
 * once under `inTurnOrder`, where the read is safe from a thread appearing
 * between the look and the write. Both were watched refuse on their own:
 * deleting the early one leaves *refuses a help flag on a later turn* green
 * through the second (run 2026-09-05). One test cannot distinguish them, which
 * is the honest state of a fast path and its guarantee.
 *
 * GPT Sol's review of the built code, finding 1.
 */
describe("what help: true is allowed to claim", () => {
  /** What the "?" actually sends, bar the anchor, which needs `BLOCK`. */
  const helpPress = {
    threadId: "spya-aaaaaa",
    question: "About this block: I could not follow it.",
    help: true as const,
  };

  it("refuses a help flag on a later turn of a conversation that exists", async () => {
    /* The "?" *creates* a thread. A second question in one is the reader
       typing, and a flag saying otherwise would put a press in the database
       that nobody made — and answer an ordinary follow-up with the teaching
       prompt. */
    const first = await post(`/api/chat/${SLUG}`, { ...helpPress, anchor: { blockId: BLOCK } });
    expect(first.frames.some((f) => f.event === "begin")).toBe(true);

    /* The **same** anchor on the follow-up, which `sameAnchor` lets through, so
       the only rule this request breaks is the one under test. Sending no
       anchor would break the whole-block rule as well and be refused by
       whichever is checked first — a test that cannot say which rule it
       proved. */
    const second = await post(`/api/chat/${SLUG}`, {
      threadId: "spya-aaaaaa",
      question: "and what follows from that?",
      anchor: { blockId: BLOCK },
      help: true,
    });
    expect(second.status).toBe(400);
    /* Each refusal is pinned to its OWN sentence rather than to "a 400 was
       returned": four rules that all produced one message would be one rule
       with three tests agreeing with it. */
    expect(String(second.body?.error)).toMatch(/starts a conversation/i);
  });

  it("refuses a help flag with no anchor at all", async () => {
    const r = await post(`/api/chat/${SLUG}`, {
      threadId: "spya-aaaaaa",
      question: "About this block: I could not follow it.",
      help: true,
    });
    expect(r.status).toBe(400);
    expect(String(r.body?.error)).toMatch(/whole paragraph/i);
    expect(await threads()).toHaveLength(0);
  });

  it("refuses a help flag on a selection-anchored chat", async () => {
    /* A selection is the reader dragging over a phrase and asking about it —
       a different gesture, with a different anchor, and not a "?" press. */
    const block = article!.blocks.find((b) => b.id === BLOCK)!;
    const quote = block.text.slice(0, 20);
    const r = await post(`/api/chat/${SLUG}`, {
      threadId: "spya-aaaaaa",
      question: "what does this mean?",
      anchor: { blockId: BLOCK, quote, start: block.text.indexOf(quote) },
      help: true,
    });
    expect(r.status).toBe(400);
    expect(String(r.body?.error)).toMatch(/whole paragraph/i);
    expect(await threads()).toHaveLength(0);
  });

  it("refuses a help flag on a thread of another kind", async () => {
    /* Remember and Candidates are about the whole piece; the "?" is beside one
       paragraph. Sent without an anchor, so the refusal under test is the kind
       one rather than the anchor rule that already refuses an anchored
       Remember. */
    const r = await post(`/api/chat/${SLUG}`, {
      threadId: "spya-aaaaaa",
      question: "here is what I took from it",
      kind: "remember",
      help: true,
    });
    expect(r.status).toBe(400);
    expect(String(r.body?.error)).toMatch(/remember conversation is about the whole article/i);
    expect(await threads()).toHaveLength(0);
  });

  it("still lets through the thing the real client sends", async () => {
    /* `helpAboutBlock` in src/web/reader/Reader.tsx mints exactly this: a draft with a
       whole-block anchor, no kind, and `help: true` on the send that creates
       the thread. If this goes red the rules above have locked the reader out
       of the button they were written for. */
    const r = await post(`/api/chat/${SLUG}`, { ...helpPress, anchor: { blockId: BLOCK } });
    expect(r.status).not.toBe(400);
    const [thread] = await threads();
    expect(thread?.messages[0]?.help).toBe(true);
  });
});

/**
 * **The passage reaches the model on every turn, not only the first.**
 *
 * `buildConverseMessages` says so at length beside its `anchor` option, and
 * gives the reason: `recentHistory` keeps the most recent turns, so a passage
 * that lives only in the reader's first message stops being sent while the panel
 * and the database still say the thread is anchored to it. The route never
 * passed `thread.anchor`, so that had never been true on the chat path — a
 * docblock asserting a behaviour in the present tense that the code did not
 * have. GPT Sol's review of the built code, finding 2.
 *
 * Asserted **through the route**, on the request that goes to the model. The
 * builder-level test in tests/help-prompt.test.ts hands `buildConverseMessages`
 * an anchor itself, so it cannot see whether anybody passes one.
 */
describe("the passage a conversation is anchored to", () => {
  const anchorLine = () => `This conversation is about block ${BLOCK}`;

  it("is in the turn that creates the thread", async () => {
    await post(`/api/chat/${SLUG}`, {
      threadId: "spya-aaaaaa",
      question: "About this block: I could not follow it.",
      anchor: { blockId: BLOCK },
      help: true,
    });
    expect(sent).toHaveLength(1);
    expect(finalUser(0)).toContain(anchorLine());
  });

  it("is still there on a follow-up that names no anchor", async () => {
    await post(`/api/chat/${SLUG}`, {
      threadId: "spya-aaaaaa",
      question: "About this block: I could not follow it.",
      anchor: { blockId: BLOCK },
      help: true,
    });
    await post(`/api/chat/${SLUG}`, {
      threadId: "spya-aaaaaa",
      question: "and what follows from that?",
    });
    expect(sent).toHaveLength(2);
    expect(
      finalUser(1),
      "The stored anchor never reached `converse`, so a follow-up is answered " +
        "about an article with no passage picked out — and after ~20 turns the " +
        "first message carrying it has left the history window too.",
    ).toContain(anchorLine());
  });

  it("says nothing about a passage when the conversation has none", async () => {
    await post(`/api/chat/${SLUG}`, {
      threadId: "spya-aaaaaa",
      question: "what is this piece for?",
    });
    expect(sent).toHaveLength(1);
    expect(finalUser(0)).not.toContain("This conversation is about block");
  });
});
