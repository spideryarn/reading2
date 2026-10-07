/**
 * **What a guide turn sends, through the real route** —
 * docs/plans/261007j-the-guide-a-conversation-about-how-to-read-this.md, Stage 1.
 *
 * Modelled on tests/explore-digest-route.test.ts: `fetch` is stubbed to keep
 * the body it was handed and then fail, so nothing reaches a model and what is
 * asserted is the bytes a model would have been sent. The pure half — where the
 * line lands, the mode words, the tool list — is tests/guide-kind.test.ts.
 *
 * Asserted here: the experience line is resolved per turn from the **stored**
 * thread's kind and lands in the final message only; a failed count costs the
 * line and not the turn, and says so in the log without a count; a guide turn
 * is offered no web search and no tool that leaves the article; and a guide
 * refuses `visible`, as every non-chat kind does.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  /* Raised before src/log.ts loads, or the failed-count line is never written.
     tests/helpers/log-capture.ts. */
  process.env.LOG_LEVEL = "warn";
});

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { logLinesWhile } from "./helpers/log-capture.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-guide-route-fixture";
const LINE = "HOW MUCH THEY HAVE USED SPIDERYARN:";

await pgReady({
  suite: "tests/guide-route.test.ts",
  tables: ["spideryarn.chat_threads", "spideryarn.chat_messages"],
});

const { handleApi } = await import("../src/routes.js");
const { chatStore, shelfStore } = await import("../src/store/index.js");

let article: ScratchArticle | undefined;

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
}, 120_000);

beforeEach(async () => {
  sent.length = 0;
  vi.restoreAllMocks();
  await asTestOwner(async () => {
    for (const thread of await chatStore.load(SLUG)) await chatStore.remove(SLUG, thread.id);
  });
});

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

interface Sent {
  messages: { role: string; content: unknown }[];
  tools?: { type: string; function?: { name: string } }[];
  tool_choice?: unknown;
}
const sent: Sent[] = [];

const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = ((_url: unknown, init?: { body?: unknown }) => {
    try {
      const body = JSON.parse(String(init?.body ?? "null")) as Sent | null;
      if (body && Array.isArray(body.messages)) sent.push(body);
    } catch {
      /* not a model request */
    }
    return Promise.reject(new Error("no model in tests"));
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

async function post(body: unknown): Promise<number> {
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
  return (res as { statusCode: number }).statusCode;
}

const text = (content: unknown): string => (typeof content === "string" ? content : JSON.stringify(content));

function lastRequest() {
  const request = sent.at(-1);
  if (!request) throw new Error("no model request went out");
  const messages = request.messages;
  return {
    head: messages.slice(0, 2).map((m) => text(m.content)).join("\n"),
    middle: messages.slice(2, -1).map((m) => text(m.content)).join("\n"),
    final: text(messages.at(-1)?.content),
    tools: (request.tools ?? []).map((t) => t.function?.name ?? t.type),
  };
}

describe("a guide turn", () => {
  it("carries how much the reader has used Spideryarn, in the final message only", async () => {
    const count = vi.spyOn(shelfStore, "articlesOpenedBefore").mockResolvedValue(0);
    expect(await post({ threadId: "spya-gdrta2", question: "Where do I start?", kind: "guide" })).toBe(200);
    expect(count).toHaveBeenCalledWith(SLUG);
    const { head, middle, final } = lastRequest();
    expect(final).toContain(`${LINE} they have opened no other article still on their shelf.`);
    expect(final.indexOf(LINE)).toBeLessThan(final.lastIndexOf("Where do I start?"));
    expect(head).not.toContain(LINE);
    expect(middle).not.toContain(LINE);
    /* The guide's prompt, not chat's. */
    expect(head).toContain("WHAT SPIDERYARN CAN SHOW THEM");
  });

  it("resolves it again on a later turn, from the stored thread's kind", async () => {
    vi.spyOn(shelfStore, "articlesOpenedBefore").mockResolvedValue(0);
    await post({ threadId: "spya-gdrtb2", question: "first", kind: "guide" });
    const first = lastRequest().head;
    vi.spyOn(shelfStore, "articlesOpenedBefore").mockResolvedValue(12);
    /* No kind on the request: the stored thread decides. */
    expect(await post({ threadId: "spya-gdrtb2", question: "second" })).toBe(200);
    const { head, final } = lastRequest();
    expect(final).toContain(`${LINE} they have opened many other articles`);
    /* The cached prefix did not move when the bucket did. */
    expect(head).toBe(first);
  });

  it("is offered no web search and no tool that leaves the article", async () => {
    vi.spyOn(shelfStore, "articlesOpenedBefore").mockResolvedValue(3);
    await post({ threadId: "spya-gdrtc2", question: "What should I read closely?", kind: "guide" });
    const { tools } = lastRequest();
    expect(tools).toEqual([
      "search_article_words",
      "search_article_meaning",
      "article_links",
      "article_glossary",
      "article_citations",
    ]);
    expect(JSON.stringify(sent.at(-1)?.tools)).not.toContain("web_search");
  });

  it("refuses visible blocks before any model call", async () => {
    const id = article?.blocks[0]?.id;
    expect(await post({ threadId: "spya-gdrtd2", question: "this bit", kind: "guide", visible: [id] })).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("still answers when the count cannot be read, without the line, and logs no count", async () => {
    const count = vi
      .spyOn(shelfStore, "articlesOpenedBefore")
      .mockRejectedValueOnce(Object.assign(new Error("connection dropped"), { status: 503 }));
    let status = 0;
    const lines = await logLinesWhile(async () => {
      status = await post({ threadId: "spya-gdrte2", question: "carry on anyway", kind: "guide" });
    });
    expect(status).toBe(200);
    expect(count).toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    const { final } = lastRequest();
    expect(final).toContain("carry on anyway");
    expect(final).not.toContain(LINE);
    /* The control: the warning was written, so an empty capture is not what passed. */
    expect(lines).toContain("guide: could not read how many articles the reader has opened");
    expect(lines).toContain('"status":503');
    expect(lines).not.toContain("connection dropped");
  });
});

describe("a turn of any other kind", () => {
  it.each(["chat", "learn", "tutorial", "explore", "candidates"] as const)(
    "%s neither asks for the count nor carries the line",
    async (kind) => {
      const count = vi.spyOn(shelfStore, "articlesOpenedBefore").mockResolvedValue(0);
      expect(await post({ threadId: mintId(), question: "what about this", kind })).toBe(200);
      expect(sent).toHaveLength(1);
      expect(count).not.toHaveBeenCalled();
      expect(JSON.stringify(sent.at(-1))).not.toContain(LINE);
    },
  );
});
