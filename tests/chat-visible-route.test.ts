/**
 * **`visible` at the route: shape-checked, filtered to the article, ordered,
 * and sent as one hedged line in place of the position line.**
 *
 * Report spya-ybnas5 (Greg, 2026-10-01): chat should know what is on the
 * reader's screen, "but let's not overemphasize it". The client half is
 * tests/chat-visible-blocks-reach-the-server.test.tsx; this is what the server
 * does with it, read off the request `converse` actually builds.
 *
 * Harness copied from tests/chat-help-route.test.ts.
 * docs/plans/261001q-chat-knows-the-blocks-on-screen.md.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-chat-visible-route";

/* **`pgReady` refuses rather than reports**, since the filesystem store and the
   `SPIDERYARN_STORE` flag were deleted on 2026-09-05 (260903f) and Postgres is
   the only store there is. This file was written against the older shape — a
   `reachable` flag, a `describe.skip`, and a hoisted flag set before the first
   import — and the merge that removed them is what caught it. There is nothing
   left to skip for: a database this cannot reach is a failure, not a pass. */
await pgReady({
  suite: "tests/chat-visible-route.test.ts",
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


const HEDGE = "For context only";
const POSITION = "The reader is currently at block";

let ids: string[] = [];
beforeAll(() => {
  ids = (article?.blocks ?? []).map((b) => b.id);
  if (ids.length < 4) throw new Error("the fixture article needs four blocks");
});

describe("what the wire may carry", () => {
  it("refuses a visible that is not a list of strings", async () => {
    /* The last two are a list of strings, but not of ids: refused rather than
       dropped, because dropping hides a client bug. A *stale* id is the case
       that is dropped — below. */
    for (const visible of ["spya-aaaaaa", [1, 2], { a: 1 }, ["paragraph three"], [""]]) {
      const r = await post(`/api/chat/${SLUG}`, { threadId: "spya-aaaaaa", question: "why?", visible });
      expect(r.status, JSON.stringify(visible)).toBe(400);
      expect(String(r.body?.error)).toMatch(/visible/);
    }
  });

  it("refuses more than a hundred", async () => {
    const visible = Array.from({ length: 101 }, () => ids[0]);
    const r = await post(`/api/chat/${SLUG}`, { threadId: "spya-aaaaaa", question: "why?", visible });
    expect(r.status).toBe(400);
  });

  it("refuses one on a Learn turn, whose prompt is not to guess how far the reader has got", async () => {
    const r = await post(`/api/chat/${SLUG}`, {
      threadId: "spya-aaaaaa",
      question: "He says the brain is a computer.",
      kind: "learn",
      visible: [ids[0]],
    });
    expect(r.status).toBe(400);
    expect(String(r.body?.error)).toMatch(/visible/);
  });

  it("refuses one on an existing Learn thread, judged by the thread and not the body", async () => {
    await post(`/api/chat/${SLUG}`, {
      threadId: "spya-aaaaaa",
      question: "He says the brain is a computer.",
      kind: "learn",
    });
    const [thread] = await threads();
    expect(thread?.kind).toBe("learn");
    const r = await post(`/api/chat/${SLUG}`, {
      threadId: thread!.id,
      question: "And then?",
      visible: [ids[0]],
    });
    expect(r.status).toBe(400);
  });

  it("refuses one on a retry, which re-asks a stored question", async () => {
    const r = await post(`/api/chat/${SLUG}`, {
      threadId: "spya-aaaaaa",
      retry: "spya-bbbbbb",
      visible: [ids[0]],
    });
    expect(r.status).toBe(400);
  });
});

describe("what the model is told", () => {
  it("names the blocks on screen, in article order, hedged, and drops ids the article lacks", async () => {
    const [a, b, c] = ids as [string, string, string];
    await post(`/api/chat/${SLUG}`, {
      threadId: "spya-aaaaaa",
      question: "what does this mean?",
      at: a,
      visible: [c, "spya-zzzzzz", a, b],
    });
    expect(sent).toHaveLength(1);
    const text = finalUser(0);
    expect(text).toContain(`${HEDGE}: when they sent this, the reader's screen showed blocks ${a}, ${b}, ${c}.`);
    expect(text).toContain("otherwise ignore them");
    expect(text).not.toContain("spya-zzzzzz");
    /* One line about position, not two: an unhedged one beside it would undo the hedge. */
    expect(text).not.toContain(POSITION);
  });

  it("keeps the position line when nothing on screen survives", async () => {
    await post(`/api/chat/${SLUG}`, {
      threadId: "spya-aaaaaa",
      question: "what does this mean?",
      at: ids[0],
      visible: ["spya-zzzzzz"],
    });
    expect(finalUser(0)).toContain(`${POSITION} ${ids[0]}`);
    expect(finalUser(0)).not.toContain(HEDGE);
  });

  it("says nothing new when no visible is sent", async () => {
    await post(`/api/chat/${SLUG}`, { threadId: "spya-aaaaaa", question: "why?", at: ids[0] });
    expect(finalUser(0)).not.toContain(HEDGE);
    expect(finalUser(0)).toContain(POSITION);
  });

  it("travels with an edit too", async () => {
    await post(`/api/chat/${SLUG}`, { threadId: "spya-aaaaaa", question: "first?" });
    const [thread] = await threads();
    const question = thread?.messages[0]?.id;
    expect(question).toBeDefined();
    await post(`/api/chat/${SLUG}`, {
      threadId: thread!.id,
      edit: question,
      question: "first, again?",
      visible: [ids[1]],
    });
    expect(sent).toHaveLength(2);
    expect(finalUser(1)).toContain(`screen showed blocks ${ids[1]}.`);
  });

  it("leaves the cached prefix alone — the tools, the system prompt and the article", async () => {
    await post(`/api/chat/${SLUG}`, { threadId: "spya-aaaaaa", question: "why?" });
    await post(`/api/chat/${SLUG}`, { threadId: "spya-cccccc", question: "why?", visible: [ids[2]] });
    await post(`/api/chat/${SLUG}`, { threadId: "spya-dddddd", question: "why?", visible: [ids[0], ids[3]] });
    expect(sent).toHaveLength(3);
    const head = (i: number) => {
      const body = sent[i] as { tools?: unknown; messages: unknown[] };
      return JSON.stringify({ tools: body.tools, head: body.messages.slice(0, 3) });
    };
    expect(head(1)).toBe(head(0));
    expect(head(2)).toBe(head(0));
    /* And the line really is in the request, so the equality above is not two
       requests that both lost it. */
    expect(finalUser(2)).toContain(`screen showed blocks ${ids[0]}, ${ids[3]}.`);
  });
});
