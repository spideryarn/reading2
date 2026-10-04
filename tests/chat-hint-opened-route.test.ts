/**
 * **`POST /api/chat/:slug/:threadId/hint-opened` — the reader pressed Hint.**
 *
 * The route records the first press under a Recall answer and answers with the
 * time. What it must refuse: a message that is not a Recall answer, a hint the
 * stored answer no longer carries (a retry reuses the row, so a late press
 * could otherwise mark the replacement as opened), and anybody's article but
 * the reader's own.
 *
 * Every read-back goes to the store, not the response — the response is built
 * from the store's answer, so only the row says whether anything was written.
 * The store's own cases, with the clock, are in tests/event-times.test.ts.
 * docs/plans/261004h-recall-questions-link-the-passage-and-carry-a-hint-button.md
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { type OwnerId, runAsOwner } from "../src/owner.js";
import type { ThreadKind } from "../src/types.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

const RUN = randomUUID().slice(0, 8);
const SLUG = `test-chat-hint-opened-${RUN}`;
/** An article the signed-in reader does not own. */
const THEIR_SLUG = `test-chat-hint-opened-theirs-${RUN}`;
const SOMEBODY_ELSE = randomUUID() as OwnerId;

await pgReady({
  suite: "tests/chat-hint-opened-route.test.ts",
  columns: [{ table: "spideryarn.chat_messages", column: "hint_opened_at" }],
});

const { handleApi } = await import("../src/routes.js");
const { chatStore } = await import("../src/store/index.js");

interface Answer {
  status: number;
  body: Record<string, unknown>;
}

async function post(slug: string, threadId: string, body: unknown): Promise<Answer> {
  const payload = [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method: "POST", url: `/api/chat/${slug}/${threadId}/hint-opened`, headers: AUTHED_HEADERS },
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
  return { status: res.statusCode, body: (written ? JSON.parse(written) : {}) as Record<string, unknown> };
}

const HINT = "He names two games where the hand-built approach lost.";
const ANSWER = `Do you remember what researchers kept doing instead?\n\nHint: ${HINT}`;

/** A finished answer, written the way the streaming route writes one. */
async function answered(
  kind: ThreadKind,
  text = ANSWER,
  as: <T>(body: () => Promise<T>) => Promise<T> = asTestOwner,
  slug = SLUG,
) {
  return as(async () => {
    const turn = await chatStore.begin(slug, { threadId: mintId(), question: "What I took from it.", kind });
    await chatStore.finish(slug, turn.thread.id, turn.reply.id, { status: "done", text }, { attempt: turn.attempt });
    return { threadId: turn.thread.id, replyId: turn.reply.id, userId: turn.user.id };
  });
}

/** The stored message, as the reader's own next load would see it. */
const stored = (threadId: string, id: string, slug = SLUG, as = asTestOwner) =>
  as(async () => (await chatStore.load(slug)).find((t) => t.id === threadId)?.messages.find((m) => m.id === id));

let mine: ScratchArticle | undefined;
let theirs: ScratchArticle | undefined;

beforeAll(async () => {
  await seedAuthUser(getDb(), { id: SOMEBODY_ELSE, email: `hint-opened-${SOMEBODY_ELSE}@example.invalid` });
  mine = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  theirs = await scratchArticleInPg(THEIR_SLUG, { ownerId: SOMEBODY_ELSE });
}, 120_000);

beforeEach(async () => {
  if (!mine) return;
  await asTestOwner(async () => {
    for (const thread of await chatStore.load(SLUG)) await chatStore.remove(SLUG, thread.id);
  });
});

afterAll(async () => {
  await mine?.remove();
  await theirs?.remove();
  await closeDb();
});

describe("pressing Hint under a Recall answer", () => {
  it("records the press, answers with the time, and the next load carries it", async () => {
    const { threadId, replyId } = await answered("remember");
    expect(await stored(threadId, replyId)).not.toHaveProperty("hintOpenedAt");

    const out = await post(SLUG, threadId, { messageId: replyId, hint: HINT });
    expect(out.status).toBe(200);
    expect(out.body.hintOpenedAt).toEqual(expect.any(String));
    expect(Date.now() - Date.parse(String(out.body.hintOpenedAt))).toBeLessThan(60_000);
    expect((await stored(threadId, replyId))?.hintOpenedAt).toBe(out.body.hintOpenedAt);
  });

  it("answers a second press with the first time", async () => {
    const { threadId, replyId } = await answered("remember");
    const first = await post(SLUG, threadId, { messageId: replyId, hint: HINT });
    const second = await post(SLUG, threadId, { messageId: replyId, hint: HINT });
    expect(second.status).toBe(200);
    expect(second.body.hintOpenedAt).toBe(first.body.hintOpenedAt);
  });
});

describe("what it refuses", () => {
  it("a hint that is not the one the stored answer carries, with a 409 and nothing written", async () => {
    const { threadId, replyId } = await answered("remember");
    const out = await post(SLUG, threadId, { messageId: replyId, hint: "A hint from the answer before the retry." });
    expect(out.status).toBe(409);
    expect(await stored(threadId, replyId)).not.toHaveProperty("hintOpenedAt");
  });

  it("a press that arrives after a retry has emptied the same row", async () => {
    const { threadId, replyId } = await answered("remember");
    await asTestOwner(() => chatStore.retry(SLUG, threadId, replyId));
    const out = await post(SLUG, threadId, { messageId: replyId, hint: HINT });
    expect(out.status).toBe(409);
    expect(await stored(threadId, replyId)).not.toHaveProperty("hintOpenedAt");
  });

  it("an answer in a conversation that is not Recall", async () => {
    for (const kind of ["chat", "tutorial"] as const) {
      const { threadId, replyId } = await answered(kind);
      const out = await post(SLUG, threadId, { messageId: replyId, hint: HINT });
      expect(out.status, kind).toBe(400);
      expect(await stored(threadId, replyId), kind).not.toHaveProperty("hintOpenedAt");
    }
  });

  it("the reader's own message in a Recall conversation", async () => {
    const { threadId, userId } = await answered("remember");
    expect((await post(SLUG, threadId, { messageId: userId, hint: HINT })).status).toBe(400);
  });

  it("a message, a conversation or an article that is not there", async () => {
    const { threadId, replyId } = await answered("remember");
    expect((await post(SLUG, threadId, { messageId: mintId(), hint: HINT })).status).toBe(404);
    expect((await post(SLUG, mintId(), { messageId: replyId, hint: HINT })).status).toBe(404);
    expect((await post(`no-such-article-${RUN}`, threadId, { messageId: replyId, hint: HINT })).status).toBe(404);
  });

  it("somebody else's article, as if it were not there, and writes nothing to it", async () => {
    const asThem = <T>(body: () => Promise<T>) => runAsOwner(SOMEBODY_ELSE, body);
    const { threadId, replyId } = await answered("remember", ANSWER, asThem, THEIR_SLUG);
    const out = await post(THEIR_SLUG, threadId, { messageId: replyId, hint: HINT });
    expect(out.status).toBe(404);
    expect(await stored(threadId, replyId, THEIR_SLUG, asThem)).not.toHaveProperty("hintOpenedAt");
  });

  it("a body without a message id or a hint", async () => {
    const { threadId, replyId } = await answered("remember");
    for (const body of [{}, { messageId: replyId }, { hint: HINT }, { messageId: replyId, hint: "" }, { messageId: 7, hint: HINT }]) {
      expect((await post(SLUG, threadId, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await stored(threadId, replyId)).not.toHaveProperty("hintOpenedAt");
  });
});
