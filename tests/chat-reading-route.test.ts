/**
 * **READING SO FAR at the route** — plan
 * docs/plans/261020ac-chat-told-how-much-of-the-article-you-have-read.md, GPT
 * Sol's plan review F6 and F7: the line is read from the owner's stored
 * reading time on every turn (a send, a retry, an edit), a Candidates turn gets
 * none, and nothing recorded is "little or none" rather than no line.
 *
 * Harness copied from tests/chat-help-route.test.ts: a model stub that answers,
 * so the request body `converse` builds can be read.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { READING_SO_FAR_HEADING } from "../src/reading-so-far.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-chat-reading-route";

await pgReady({
  suite: "tests/chat-reading-route.test.ts",
  tables: ["spideryarn.chat_threads", "spideryarn.revision_blocks", "spideryarn.reading_time"],
});

const { handleApi } = await import("../src/routes.js");
const { chatStore, readingTimeStore } = await import("../src/store/index.js");

let article: ScratchArticle | undefined;

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
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

const sent: Record<string, unknown>[] = [];
const realFetch = globalThis.fetch;
beforeAll(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  globalThis.fetch = ((_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as Record<string, unknown>;
    const format = request.response_format as { json_schema?: { name?: unknown } } | undefined;
    if (format?.json_schema?.name === "conversation_gist") {
      return Promise.resolve(
        Response.json({
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ gist: "A short answer" }) } }],
        }),
      );
    }
    sent.push(request);
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

async function post(body: unknown): Promise<void> {
  const payload = [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method: "POST", url: `/api/chat/${SLUG}`, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;
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
    write() {
      return true;
    },
    end() {
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, acceptAny);
}

const finalUser = (i: number) =>
  String(((sent[i] as { messages: { content: unknown }[] }).messages.at(-1)?.content ?? "") as string);
const threads = () => asTestOwner(() => chatStore.load(SLUG));

describe("READING SO FAR on a chat turn", () => {
  it("says little or none when nothing is recorded, then more once the body is read", async () => {
    await post({ threadId: "spya-rdaaaa", question: "what does it say?" });
    expect(finalUser(0)).toContain(`${READING_SO_FAR_HEADING} (`);
    expect(finalUser(0)).toContain("little or none of it yet");

    /* Every body block read slowly: the next turn, on the same thread, is told so. */
    const seconds = Object.fromEntries(article!.blocks.map((b) => [b.id, 10_000]));
    await asTestOwner(() => readingTimeStore.add(SLUG, seconds));
    await post({ threadId: "spya-rdaaaa", question: "and then?" });
    expect(finalUser(1)).toContain("most or all of it");
  });

  it("is recomputed on a retry and an edit, which build the turn again", async () => {
    await post({ threadId: "spya-rdbbbb", question: "what does it say?" });
    const [thread] = await threads();
    const [question, reply] = thread!.messages;
    await post({ threadId: "spya-rdbbbb", retry: reply!.id });
    await post({ threadId: "spya-rdbbbb", edit: question!.id, question: "what does it really say?" });
    expect(sent).toHaveLength(3);
    for (let i = 0; i < 3; i++) expect(finalUser(i), `request ${i}`).toContain(READING_SO_FAR_HEADING);
  });

  it("is in a Learn turn too", async () => {
    await post({ threadId: "spya-rdcccc", question: "I have not read it yet.", kind: "learn" });
    expect(finalUser(0)).toContain(READING_SO_FAR_HEADING);
  });

  it("is not in a Candidates turn, whose reader is an editor finding reviewers", async () => {
    const read = vi.spyOn(readingTimeStore, "read");
    try {
      await post({ threadId: "spya-rddddd", question: "who could review this?", kind: "candidates", useProfile: false });
      expect(sent.length).toBeGreaterThan(0);
      expect(finalUser(0)).not.toContain(READING_SO_FAR_HEADING);
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });

  it("answers without the line when the reading-time read fails", async () => {
    const read = vi.spyOn(readingTimeStore, "read").mockRejectedValueOnce(new Error("test read failed"));
    try {
      await post({ threadId: "spya-rdeeee", question: "what does it say?" });
      expect(sent).toHaveLength(1);
      expect(finalUser(0)).not.toContain(READING_SO_FAR_HEADING);
    } finally {
      read.mockRestore();
    }
  });
});
