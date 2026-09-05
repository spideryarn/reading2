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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `SPIDERYARN_STORE=postgres`, before **any** import runs — `src/store/live.ts`
 * reads the flag once and imports are hoisted above every statement.
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

const SLUG = "test-chat-help-route";

const { reachable } = await pgReady({
  suite: "tests/chat-help-route.test.ts",
  tables: ["spideryarn.chat_threads", "spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");
const { chatStore, STORE } = await import("../src/store/index.js");

if (PREVIOUS_STORE_FLAG === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = PREVIOUS_STORE_FLAG;

const when = reachable ? describe : describe.skip;

describe("the store these tests are actually talking to", () => {
  it("is the Postgres one", () => {
    expect(STORE).toBe("postgres");
  });
});

let article: ScratchArticle | undefined;
let BLOCK = "";

beforeAll(async () => {
  if (!reachable) return;
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

when("what the wire may carry", () => {
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

when("a help press, end to end", () => {
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
