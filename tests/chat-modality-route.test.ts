/**
 * **How a chat message was made, at the route and in the table** — report
 * spya-z30x5n, docs/plans/261011z-chat-messages-record-how-they-were-made.md.
 *
 * The browser may say how the reader made a new question (typed, dictated,
 * mixed); the server says everything else. Every streamed answer is `written`,
 * including a retry of a spoken one (Sol's plan review F1), and the database's
 * CHECK holds each value to its role whatever the writer.
 *
 * Harness copied from tests/chat-help-route.test.ts: a model stub that answers.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-chat-modality-route";

await pgReady({
  suite: "tests/chat-modality-route.test.ts",
  tables: ["spideryarn.chat_threads", "spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");
const { chatStore } = await import("../src/store/index.js");

let article: ScratchArticle | undefined;

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
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

async function post(pathname: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> | null }> {
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
  let parsed: Record<string, unknown> | null = null;
  if (!written.startsWith("event: ")) {
    try {
      parsed = JSON.parse(written) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  }
  return { status: res.statusCode, body: parsed };
}

describe("what the wire may carry", () => {
  it.each(["spoken", "written", "voice", true])("refuses modality %j from a browser", async (modality) => {
    const r = await post(`/api/chat/${SLUG}`, { threadId: "spya-maaaaa", question: "why?", modality });
    expect(r.status).toBe(400);
    expect(String(r.body?.error)).toMatch(/modality/);
  });

  it("refuses a modality on a retry or an edit", async () => {
    const retry = await post(`/api/chat/${SLUG}`, { threadId: "spya-maaaaa", retry: "spya-mbbbbb", modality: "typed" });
    expect(retry.status).toBe(400);
    const edit = await post(`/api/chat/${SLUG}`, {
      threadId: "spya-maaaaa",
      edit: "spya-mbbbbb",
      question: "why, really?",
      modality: "typed",
    });
    expect(edit.status).toBe(400);
  });
});

describe("what is stored", () => {
  it.each(["typed", "dictated", "mixed"] as const)("stores a %s question, and the answer as written", async (modality) => {
    await post(`/api/chat/${SLUG}`, { threadId: "spya-mcccca", question: "Why does he say so?", modality });
    const [thread] = await threads();
    expect(thread?.messages.map((m) => [m.role, m.modality])).toEqual([
      ["user", modality],
      ["assistant", "written"],
    ]);
  });

  it("leaves a question that said nothing unrecorded, never guessed", async () => {
    await post(`/api/chat/${SLUG}`, { threadId: "spya-mcccce", question: "Why does he say so?" });
    const [thread] = await threads();
    expect(thread?.messages[0]).not.toHaveProperty("modality");
    expect(thread?.messages[1]?.modality).toBe("written");
  });

  it("writes a retried spoken answer as written, and keeps the spoken question", async () => {
    const spoken = await post(`/api/chat/${SLUG}/spya-mddddd/spoken`, {
      question: "What does he mean?",
      answer: "He means the weather.",
      expectedTailId: null,
    });
    expect(spoken.status).toBe(200);
    const [before] = await threads();
    const answerId = before?.messages[1]?.id;
    expect(before?.messages[1]?.modality).toBe("spoken");

    await post(`/api/chat/${SLUG}`, { threadId: "spya-mddddd", retry: answerId });
    const [after] = await threads();
    expect(after?.messages.map((m) => [m.role, m.modality])).toEqual([
      ["user", "spoken"],
      ["assistant", "written"],
    ]);
  });

  it("keeps the question's modality through an edit, and the new answer is written", async () => {
    await post(`/api/chat/${SLUG}`, { threadId: "spya-meeeee", question: "Why?", modality: "dictated" });
    const [before] = await threads();
    const questionId = before?.messages[0]?.id;
    await post(`/api/chat/${SLUG}`, {
      threadId: "spya-meeeee",
      edit: questionId,
      question: "Why, really?",
      expectedTailId: before?.messages[1]?.id,
    });
    const [after] = await threads();
    expect(after?.messages[0]?.editedAt).toBeDefined();
    expect(after?.messages.map((m) => [m.role, m.modality])).toEqual([
      ["user", "dictated"],
      ["assistant", "written"],
    ]);
  });
});

describe("the CHECK", () => {
  it.each([
    ["assistant", "dictated"],
    ["user", "written"],
    ["user", "voice"],
  ])("refuses a %s row that says %s, whatever the writer", async (role, modality) => {
    await post(`/api/chat/${SLUG}`, { threadId: "spya-mfffff", question: "Why?" });
    const [thread] = await threads();
    expect(thread).toBeDefined();
    /* A real write against a stored row, so it is the constraint that answers. */
    await expect(
      getDb().execute(sql`
        update spideryarn.chat_messages set modality = ${modality}
        where thread_id = ${thread!.id} and role = ${role}
      `),
    ).rejects.toMatchObject({ cause: { constraint: "chat_messages_modality" } });
  });

  it("accepts each value on its own role", async () => {
    await post(`/api/chat/${SLUG}`, { threadId: "spya-mggggg", question: "Why?" });
    const [thread] = await threads();
    await getDb().execute(sql`
      update spideryarn.chat_messages set modality = 'spoken' where thread_id = ${thread!.id}
    `);
    const [after] = await threads();
    expect(after?.messages.map((m) => m.modality)).toEqual(["spoken", "spoken"]);
  });
});
