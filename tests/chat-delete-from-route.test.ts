/**
 * **`POST /api/chat/:slug/:threadId/delete-from` — the reader deleted a
 * question, and everything after it.**
 *
 * Report spya-mx423m: "Where should I start?" asked twice, and the second one
 * wanted gone. The rules are `withDeleteFrom` in src/chat.ts; this checks them
 * where they bite, at the route and the rows. Every read-back goes to the store,
 * not the response, because only the rows say what was deleted.
 * docs/plans/261009m-delete-a-chat-question-and-what-follows.md
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { type OwnerId, runAsOwner } from "../src/owner.js";
import type { ChatThread } from "../src/types.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

const RUN = randomUUID().slice(0, 8);
const SLUG = `test-chat-delete-from-${RUN}`;
/** An article the signed-in reader does not own. */
const THEIR_SLUG = `test-chat-delete-from-theirs-${RUN}`;
const SOMEBODY_ELSE = randomUUID() as OwnerId;

await pgReady({ suite: "tests/chat-delete-from-route.test.ts" });

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
    { method: "POST", url: `/api/chat/${slug}/${threadId}/delete-from`, headers: AUTHED_HEADERS },
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

type As = <T>(body: () => Promise<T>) => Promise<T>;

/**
 * A conversation of `questions.length` finished turns, written the way the
 * streaming route writes them. The last answer is left `pending` when asked.
 */
async function conversation(
  questions: string[],
  { lastPending = false, as = asTestOwner as As, slug = SLUG } = {},
): Promise<ChatThread> {
  return as(async () => {
    const threadId = mintId();
    for (const [i, question] of questions.entries()) {
      const turn = await chatStore.begin(slug, { threadId, question });
      if (lastPending && i === questions.length - 1) break;
      await chatStore.finish(slug, threadId, turn.reply.id, { status: "done", text: `Answer ${i}` }, { attempt: turn.attempt });
    }
    return stored(threadId, slug, as) as Promise<ChatThread>;
  });
}

/** The stored conversation, as the reader's own next load would see it. */
const stored = (threadId: string, slug = SLUG, as: As = asTestOwner) =>
  as(async () => (await chatStore.load(slug)).find((t) => t.id === threadId));

const ids = (thread: ChatThread | undefined) => thread?.messages.map((m) => m.id);

/** A delete of `thread.messages[at]`, naming the tail as the panel does. */
const deleteAt = (thread: ChatThread, at: number, slug = SLUG) =>
  post(slug, thread.id, { messageId: thread.messages[at]?.id, expectedTailId: thread.messages.at(-1)?.id });

let mine: ScratchArticle | undefined;
let theirs: ScratchArticle | undefined;

beforeAll(async () => {
  await seedAuthUser(getDb(), { id: SOMEBODY_ELSE, email: `delete-from-${SOMEBODY_ELSE}@example.invalid` });
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

describe("deleting a question", () => {
  it("takes the question, its answer and everything after, and keeps what came before", async () => {
    const before = await conversation(["Where should I start?", "Where should I start?", "And then?"]);
    const second = before.messages[2];
    expect(second?.role).toBe("user");

    const out = await post(SLUG, before.id, { messageId: second?.id, expectedTailId: before.messages.at(-1)?.id });
    expect(out.status).toBe(200);
    expect(out.body.deleted).toBe(4);

    const after = await stored(before.id);
    expect(ids(after)).toEqual(ids(before)?.slice(0, 2));
    // The response also tells the truth, though the panel commits by the captured ids.
    const answered = (out.body.threads as ChatThread[]).find((t) => t.id === before.id);
    expect(ids(answered)).toEqual(ids(after));
  });

  it("dates the conversation by the turn it now ends on, and drops its gist", async () => {
    const before = await conversation(["One?", "Two?"]);
    expect(await asTestOwner(() => chatStore.setGist(SLUG, before.id, "A gist of both turns.", before))).toBe(true);
    expect((await stored(before.id))?.gist).toBe("A gist of both turns.");

    expect((await deleteAt(before, 2)).status).toBe(200);
    const after = await stored(before.id);
    /* When the kept turn was asked: what `updatedAt` said before the second
       one, so the list's "last message" is one that is still there. */
    expect(after?.updatedAt).toBe(before.messages[1]?.createdAt);
    expect(after?.updatedAt).not.toBe(before.updatedAt);
    expect(after?.gist).toBeUndefined();
  });

  it("touches no other conversation of the article, though its rows share the ordinals", async () => {
    const other = await conversation(["One?", "Two?", "Three?"]);
    const before = await conversation(["One?", "Two?", "Three?"]);
    expect((await deleteAt(before, 2)).status).toBe(200);
    expect(ids(await stored(before.id))).toEqual(ids(before)?.slice(0, 2));
    expect(ids(await stored(other.id))).toEqual(ids(other));
  });

  it("can ask again afterwards, in the place the deleted question had", async () => {
    const before = await conversation(["One?", "Two?"]);
    expect((await deleteAt(before, 2)).status).toBe(200);
    const again = await asTestOwner(() => chatStore.begin(SLUG, { threadId: before.id, question: "Two, again?" }));
    expect(again.thread.messages.map((m) => m.text).slice(0, 3)).toEqual(["One?", "Answer 0", "Two, again?"]);
  });

  it("a late finish for a deleted answer cannot move the conversation's clock", async () => {
    const first = await conversation(["One?"]);
    const second = await asTestOwner(() => chatStore.begin(SLUG, { threadId: first.id, question: "Two?" }));
    expect(
      await asTestOwner(() =>
        chatStore.finish(
          SLUG,
          first.id,
          second.reply.id,
          { status: "done", text: "Answer 1" },
          { attempt: second.attempt },
        ),
      ),
    ).toBe(true);
    const before = await stored(first.id);
    if (!before) throw new Error("the conversation was not stored");
    expect((await deleteAt(before, 2)).status).toBe(200);
    const prunedAt = (await stored(first.id))?.updatedAt;

    expect(
      await asTestOwner(() =>
        chatStore.finish(
          SLUG,
          first.id,
          second.reply.id,
          { status: "done", text: "Late answer" },
          { attempt: second.attempt, now: () => "2030-01-01T00:00:00.000Z" },
        ),
      ),
    ).toBe(false);
    expect((await stored(first.id))?.updatedAt).toBe(prunedAt);
  });
});

describe("what it refuses, with nothing deleted", () => {
  it("a conversation that has moved on since the tab looked", async () => {
    const before = await conversation(["One?", "Two?"]);
    const out = await post(SLUG, before.id, { messageId: before.messages[2]?.id, expectedTailId: before.messages[1]?.id });
    expect(out.status).toBe(409);
    expect(String(out.body.error)).toMatch(/Reload before deleting/);
    expect(ids(await stored(before.id))).toEqual(ids(before));
  });

  it("an answer, and the first question", async () => {
    const before = await conversation(["One?", "Two?"]);
    for (const at of [0, 1, 3]) {
      expect((await deleteAt(before, at)).status, String(at)).toBe(409);
    }
    expect(ids(await stored(before.id))).toEqual(ids(before));
  });

  it("a conversation with an answer still arriving", async () => {
    const before = await conversation(["One?", "Two?"], { lastPending: true });
    expect(before.messages.at(-1)?.status).toBe("pending");
    expect((await deleteAt(before, 2)).status).toBe(409);
    expect(ids(await stored(before.id))).toEqual(ids(before));
  });

  it("a message or a conversation that is not there", async () => {
    const before = await conversation(["One?", "Two?"]);
    const tail = before.messages.at(-1)?.id;
    expect((await post(SLUG, before.id, { messageId: mintId(), expectedTailId: tail })).status).toBe(409);
    expect((await post(SLUG, mintId(), { messageId: before.messages[2]?.id, expectedTailId: tail })).status).toBe(409);
    expect((await deleteAt(before, 2, `no-such-article-${RUN}`)).status).toBe(404);
    expect(ids(await stored(before.id))).toEqual(ids(before));
  });

  it("somebody else's article, as if it were not there", async () => {
    const asThem: As = (body) => runAsOwner(SOMEBODY_ELSE, body);
    const before = await conversation(["One?", "Two?"], { as: asThem, slug: THEIR_SLUG });
    expect((await deleteAt(before, 2, THEIR_SLUG)).status).toBe(404);
    expect(ids(await stored(before.id, THEIR_SLUG, asThem))).toEqual(ids(before));
  });

  it("a body without a message id, or without the tail it expects", async () => {
    const before = await conversation(["One?", "Two?"]);
    const tail = before.messages.at(-1)?.id;
    for (const body of [
      {},
      { messageId: 7, expectedTailId: tail },
      // The tail is required: an unguarded delete is a stale tab deleting turns it never saw.
      { messageId: before.messages[2]?.id },
      { messageId: before.messages[2]?.id, expectedTailId: 7 },
    ]) {
      expect((await post(SLUG, before.id, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(ids(await stored(before.id))).toEqual(ids(before));
  });
});
