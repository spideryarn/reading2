/**
 * **An answer that ran out of room still says so after a reload.**
 *
 * `converse` flags a turn the model's `max_tokens` cut off (`truncated`), the
 * route puts the flag on the `done` frame and on the patch it hands
 * `chatStore.finish`, and the panel prints "This answer ran out of room…" under
 * it. But the Postgres store had no column for it: `finish` never wrote it and
 * `toMessage` never read it, so the flag lived exactly as long as the tab that
 * watched it arrive. A reload — or the reconnect path, which asks the store
 * whether the answer finished — showed the cut-off answer as a whole one.
 * docs/postmortems/261009 (see the plan 261009 high-powered chat ceiling).
 *
 * Nothing here reaches a model: `fetch` is stubbed with a stream that writes a
 * sentence and stops on `finish_reason: "length"`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";
import type { ChatMessage } from "../src/types.js";

loadEnvLocal();

const SLUG = "test-chat-truncated-stored-fixture";

await pgReady({
  suite: "tests/chat-truncated-stored.test.ts",
  tables: ["spideryarn.chat_threads", "spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");
const { chatStore } = await import("../src/store/index.js");

let article: ScratchArticle | undefined;

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  expect(article.copied).toContain("blocks");
});

afterEach(async () => {
  if (!article) return;
  await asTestOwner(async () => {
    for (const thread of await chatStore.load(SLUG)) await chatStore.remove(SLUG, thread.id);
  });
});

const realFetch = globalThis.fetch;
const realKey = process.env.OPENROUTER_API_KEY;
afterAll(async () => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = realKey;
  await article?.remove();
  await closeDb();
});

const encoder = new TextEncoder();
const frame = (body: unknown) => `data: ${JSON.stringify(body)}\n\n`;

/** One round that writes half a sentence and is cut off at `max_tokens`. */
function cutOffStream(): Response {
  const frames = [
    frame({ model: "test/model", choices: [{ delta: { content: "The three reasons are, first, that the" } }] }),
    frame({ choices: [{ finish_reason: "length", delta: {} }] }),
    "data: [DONE]\n\n",
  ];
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames) c.enqueue(encoder.encode(f));
      c.close();
    },
  });
  return { ok: true, status: 200, headers: new Headers(), body } as Response;
}

/** POST a question and return what the route wrote. */
async function ask(body: unknown): Promise<string> {
  const payload = [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method: "POST", url: `/api/chat/${SLUG}`, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;
  let written = "";
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
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
  return written;
}

describe("a chat answer cut off at max_tokens", () => {
  it("is stored as cut off, not as a whole answer", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = (async () => cutOffStream()) as unknown as typeof fetch;

    const written = await ask({ threadId: "spya-t7r4wz", question: "why?" });
    /* The live half, which already worked: the precondition, so a red below
       is about the store and not about the stub. */
    expect(written).toContain("event: done");
    expect(written).toContain('"truncated":true');

    const threads = await asTestOwner(() => chatStore.load(SLUG));
    const answer = threads.find((t) => t.id === "spya-t7r4wz")?.messages.at(-1);
    expect(answer?.role).toBe("assistant");
    expect(answer?.status).toBe("done");
    expect(answer?.text).toBe("The three reasons are, first, that the");
    expect(answer?.truncated, "the reload shows a cut-off answer as a whole one").toBe(true);
  });
});

/**
 * **`finish` names every field a finish can carry.** Its patch is the third
 * field-by-field enumeration in src/store/pg-chat.ts, and the one `truncated`
 * actually fell out of. The patch is typed from `ChatMessage` minus an
 * explicit list of what a finish does not set, so a new field fails to compile
 * here until it is put in one or the other (GPT Sol, plan 261009h F7).
 */
type NotFinishable =
  | "id"
  | "role"
  | "createdAt"
  | "passages"
  | "interrupted"
  | "stance"
  | "help"
  | "hintOpenedAt";
type Finishable = Required<Omit<ChatMessage, NotFinishable>>;

describe("chatStore.finish", () => {
  it("stores every field a finish can carry, and a retry clears the cut-off flag", async () => {
    const patch: Finishable = {
      text: "a whole answer",
      status: "done",
      citations: [{ url: "https://example.com/a", title: "A" }] as Finishable["citations"],
      searches: 1,
      tools: [{ name: "search_article_words", label: "searched", status: "done" }] as Finishable["tools"],
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      error: "kept",
      stopped: true,
      truncated: true,
      editedAt: "2026-10-09T06:01:00.000Z",
    };
    const threadId = "spya-f1n15h";
    await asTestOwner(async () => {
      const turn = await chatStore.begin(SLUG, { threadId, question: "why?" });
      await chatStore.finish(SLUG, turn.thread.id, turn.reply.id, patch, { attempt: turn.attempt });
      const stored = (await chatStore.load(SLUG)).find((t) => t.id === turn.thread.id)?.messages.at(-1);
      for (const [key, value] of Object.entries(patch)) {
        expect(stored?.[key as keyof ChatMessage], `finish dropped ${key}`).toEqual(value);
      }

      /* A finish that was not cut off omits the flag rather than sending
         `false`, so only the retry can clear it. */
      const again = await chatStore.retry(SLUG, turn.thread.id, turn.reply.id);
      await chatStore.finish(
        SLUG,
        turn.thread.id,
        again.reply.id,
        { text: "whole", status: "done" },
        { attempt: again.attempt },
      );
      const after = (await chatStore.load(SLUG)).find((t) => t.id === turn.thread.id)?.messages.at(-1);
      expect(after?.text).toBe("whole");
      expect(after?.truncated, "the last attempt's flag outlived its answer").toBeUndefined();
      expect(after?.editedAt, "the last attempt's edit time outlived its answer").toBeUndefined();
    });
  });
});
