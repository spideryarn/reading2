/**
 * **The reader's notes ride on every Explore turn, and on no other kind's.**
 *
 * docs/plans/261003l-reader-notes-chat-tool-and-explore-sub-mode-of-remember.md
 * § Reviews, PR-1. The plan first sent the digest on the opening turn only.
 * Only the reader's question is stored, and history is rebuilt from the stored
 * rows, so a digest sent once is gone by the second turn — and a retry or an
 * edit of the opening question would have lost it too. So `streamChat` builds
 * it on send, retry and edit alike, from the **stored** thread's id and kind.
 *
 * Every case here reads **the request that goes out**: `fetch` is stubbed to
 * keep the body it was handed and then fail, so nothing reaches a model and
 * what is asserted is the bytes a model would have been sent. The pure half —
 * where in the message it lands, and that the cached prefix does not move — is
 * tests/explore-kind.test.ts.
 *
 * **Each "no digest" has a control**: the same note is on the article for
 * every case, and the Explore cases beside them find it
 * (docs/reusable/silent-success.md).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import type { ChatThread, ThreadKind } from "../src/types.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-explore-digest-route-fixture";
const NOTE = "READER-NOTE-explore-digest-m4x";
const EARLIER_QUESTION = "EARLIER-CHAT-QUESTION-m4x";
const EARLIER_ANSWER = "EARLIER-CHAT-ANSWER-m4x";

await pgReady({
  suite: "tests/explore-digest-route.test.ts",
  tables: ["spideryarn.chat_threads", "spideryarn.chat_messages", "spideryarn.comments"],
});

const { handleApi } = await import("../src/routes.js");
const { chatStore, commentStore } = await import("../src/store/index.js");

let article: ScratchArticle | undefined;
/** The reader's earlier chat on this article, which the digest's index lists. */
let earlierChat = "";

/** One finished exchange, written through the store as a real turn is. */
async function exchange(threadId: string, question: string, answer: string, kind?: ThreadKind): Promise<ChatThread> {
  const turn = await chatStore.begin(SLUG, { threadId, question, ...(kind ? { kind } : {}) });
  await chatStore.finish(SLUG, turn.thread.id, turn.reply.id, { status: "done", text: answer }, { attempt: turn.attempt });
  return turn.thread;
}

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  const block = article.blocks.find((b) => b.text.length > 20);
  if (!block) throw new Error("the fixture has no paragraph to put a note on");
  await asTestOwner(() => commentStore.create(SLUG, { blockId: block.id, body: NOTE }));
}, 120_000);

/** Only the earlier chat, and nothing a previous test wrote. */
beforeEach(async () => {
  if (!article) return;
  sent.length = 0;
  await asTestOwner(async () => {
    for (const thread of await chatStore.load(SLUG)) await chatStore.remove(SLUG, thread.id);
    earlierChat = (await exchange(mintId(), EARLIER_QUESTION, EARLIER_ANSWER)).id;
  });
});

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

/* ------------------------------------------------- the request that goes out -- */

interface Sent {
  messages: { role: string; content: unknown }[];
  tools?: { type: string; function?: { name: string } }[];
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

/** The one model request the last `post` made, split at the cache breakpoint. */
function lastRequest() {
  const request = sent.at(-1);
  if (!request) throw new Error("no model request went out");
  const messages = request.messages;
  return {
    /** The system prompt and the article: the cached prefix. */
    head: messages.slice(0, 2).map((m) => text(m.content)).join("\n"),
    /** The canned line and the history: everything between the article and the question. */
    middle: messages.slice(2, -1).map((m) => text(m.content)).join("\n"),
    /** The final user message, where the digest belongs. */
    final: text(messages.at(-1)?.content),
    tools: (request.tools ?? []).map((t) => t.function?.name ?? t.type),
  };
}

const stored = async (id: string) => (await asTestOwner(() => chatStore.load(SLUG))).find((t) => t.id === id);
const theExplore = async () => (await asTestOwner(() => chatStore.load(SLUG))).find((t) => t.kind === "explore");

/* -------------------------------------------------------------------------- */

describe("an Explore turn carries the reader's notes", () => {
  it("on the opening send", async () => {
    expect(await post({ threadId: "spya-xp7ra2", question: "Start from what I've marked", kind: "explore" })).toBe(200);
    const { head, middle, final, tools } = lastRequest();
    expect(final).toContain(NOTE);
    /* The index lists the earlier chat by id and title (its first question),
       and never what was said in it: that is one tool call away. */
    expect(final).toContain(earlierChat);
    expect(final).not.toContain(EARLIER_ANSWER);
    /* Below the breakpoint and nowhere else. */
    expect(head).not.toContain(NOTE);
    expect(middle).not.toContain(NOTE);
    /* Before the question, which goes last. */
    expect(final.indexOf(NOTE)).toBeLessThan(final.lastIndexOf("Start from what I've marked"));
    /* The conversation the turn is in is not one of the "other conversations". */
    expect(final).not.toContain("spya-xp7ra2");
    /* And the tool is offered, for one conversation in full or a fresh look. */
    expect(tools).toContain("reader_notes");
  });

  it("on a retry of the opening answer", async () => {
    await post({ threadId: "spya-xp7rb2", question: "what do I think", kind: "explore" });
    const thread = await theExplore();
    const reply = thread?.messages.at(-1);
    expect(reply?.role).toBe("assistant");
    sent.length = 0;
    expect(await post({ threadId: thread?.id, retry: reply?.id })).toBe(200);
    expect(sent).toHaveLength(1);
    expect(lastRequest().final).toContain(NOTE);
    expect(lastRequest().final).toContain("what do I think");
  });

  it("on an edit of the opening question", async () => {
    await post({ threadId: "spya-xp7rc2", question: "first wording", kind: "explore" });
    const thread = await theExplore();
    const question = thread?.messages[0];
    sent.length = 0;
    expect(
      await post({
        threadId: thread?.id,
        edit: question?.id,
        question: "second wording",
        expectedTailId: thread?.messages.at(-1)?.id,
      }),
    ).toBe(200);
    expect(sent).toHaveLength(1);
    const { final } = lastRequest();
    expect(final).toContain(NOTE);
    expect(final).toContain("second wording");
    expect(final).not.toContain("first wording");
  });

  /* The case the first-turn-only design lost. No `kind` on the request: the
     stored thread's kind is what decides, as it decides the prompt. */
  it("on the second turn, from the stored thread's kind", async () => {
    const thread = await asTestOwner(() => exchange("spya-xp7rd2", "FIRST-EXPLORE-QUESTION", "A first answer.", "explore"));
    expect(await post({ threadId: thread.id, question: "and a second thing" })).toBe(200);
    const { middle, final } = lastRequest();
    expect(middle).toContain("FIRST-EXPLORE-QUESTION");
    expect(middle).not.toContain(NOTE);
    expect(final).toContain(NOTE);
    expect(final).toContain("and a second thing");
    expect((await stored(thread.id))?.kind).toBe("explore");
  });

  it("when the history is long enough to have been trimmed", async () => {
    const id = "spya-xp7re2";
    await asTestOwner(async () => {
      for (let i = 0; i < 23; i++) {
        await exchange(id, `EXPLORE-TURN-${String(i).padStart(2, "0")}-question`, `answer ${i}`, i === 0 ? "explore" : undefined);
      }
    });
    expect(await post({ threadId: id, question: "the twenty-fourth" })).toBe(200);
    const { middle, final } = lastRequest();
    /* The control: trimming really happened, and the newest turn survived it. */
    expect(middle).not.toContain("EXPLORE-TURN-00-question");
    expect(middle).toContain("EXPLORE-TURN-22-question");
    expect(final).toContain(NOTE);
  }, 120_000);

  it("leaves the cached prefix the same bytes on every one of those turns", async () => {
    await post({ threadId: "spya-xp7rf2", question: "one", kind: "explore" });
    const first = lastRequest().head;
    const thread = await theExplore();
    await post({ threadId: thread?.id, question: "two" });
    expect(lastRequest().head).toBe(first);
  });
});

describe("a turn of any other kind carries none", () => {
  it.each(["chat", "remember", "tutorial", "candidates"] as const)("%s", async (kind) => {
    expect(await post({ threadId: mintId(), question: "what about this", kind })).toBe(200);
    expect(sent).toHaveLength(1);
    const request = JSON.stringify(sent.at(-1));
    expect(request).not.toContain(NOTE);
    expect(request).not.toContain(earlierChat);
  });

  /* The request cannot ask for one: a chat follow-up that says `explore` is the
     409 every contradicting kind gets, before any model call. */
  it("is not unlocked by a request that calls a chat thread explore", async () => {
    expect(await post({ threadId: earlierChat, question: "and this", kind: "explore" })).toBe(409);
    expect(sent).toHaveLength(0);
  });
});

describe("when the notes cannot be loaded", () => {
  it("still answers, without a digest", async () => {
    const load = vi.spyOn(commentStore, "load").mockRejectedValueOnce(new Error("connection dropped"));
    try {
      expect(await post({ threadId: "spya-xp7rg2", question: "carry on anyway", kind: "explore" })).toBe(200);
    } finally {
      load.mockRestore();
    }
    expect(sent).toHaveLength(1);
    const { final, tools } = lastRequest();
    expect(final).toContain("carry on anyway");
    expect(final).not.toContain(NOTE);
    expect(final).not.toContain("UNTRUSTED");
    /* The tool is still there, so the model can try again and say so if it fails. */
    expect(tools).toContain("reader_notes");
  });
});
