/**
 * The `begin` frame — the first thing a chat stream says, and the only place
 * the client is told what this turn is really called.
 *
 * A test at the route rather than at `withServerIds`, because the bug it pins
 * lived exactly in the join between the two. The client swapped the ids the
 * frame carried; the frame carried one id too few. Both halves were correct
 * about what they did and neither was correct about the turn, and no test of
 * either half alone would have noticed. Greg, 2026-08-26: *"I tried editing a
 * previous message, and got 'That message is not in this conversation.'"*
 *
 * Nothing here reaches the model: `fetch` is stubbed, so `converse` fails on
 * its first call — which is fine and is deliberate, because the frame under
 * test is written before it. See tests/routes.test.ts for the same fake
 * request/response pair without the streaming parts.
 *
 * ## Why this runs against Postgres
 *
 * It used to `cp(example/ → data/test-chat-route-fixture/)` and read the
 * conversation back with `loadThreads` from src/chat.ts. Stage 4 deletes both
 * halves of that — the filesystem store and `src/chat.ts`
 * (docs/plans/260831b-finish-the-database-move.md). The article is now a
 * throwaway copy of the committed corpus in Postgres
 * (tests/helpers/scratch-article.ts), and the conversation is read back through
 * `chatStore`, which is the same object src/routes.ts writes it with.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-chat-route-fixture";

await pgReady({
  suite: "tests/chat-route.test.ts",
  tables: ["spideryarn.chat_threads", "spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");
const { chatStore } = await import("../src/store/index.js");

let article: ScratchArticle | undefined;

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  /* **The seed is asserted, not assumed.** A clone that copied nothing would
     leave every test below failing on a 404 that reads like a broken route.
     `blocks` is the one this file actually needs — the turn has to have
     something to cite. */
  expect(article.copied).toContain("blocks");
});

/** The article's own conversations, and nothing a previous test wrote. */
afterEach(async () => {
  if (!article) return;
  await asTestOwner(async () => {
    for (const thread of await chatStore.load(SLUG)) await chatStore.remove(SLUG, thread.id);
  });
});

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() =>
    Promise.reject(new Error("no model in tests"))) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

interface Frame {
  event: string;
  data: Record<string, unknown>;
}

/** POST a question and return the frames the route wrote, in order. */
async function ask(body: unknown): Promise<Frame[]> {
  const payload = [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method: "POST", url: `/api/chat/${SLUG}` , headers: AUTHED_HEADERS },
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
  return written
    .split("\n\n")
    .filter((block) => block.startsWith("event: "))
    .map((block) => {
      const [head, ...rest] = block.split("\n");
      return {
        event: (head as string).slice("event: ".length),
        data: JSON.parse(rest.join("\n").slice("data: ".length)) as Record<string, unknown>,
      };
    });
}

describe("the begin frame names both rows of the turn", () => {
  it("gives the client the question's id, not only the answer's", async () => {
    const frames = await ask({ threadId: "spya-t7r4wz", question: "what is this about?" });
    const begin = frames[0];
    expect(begin?.event).toBe("begin");

    /* The ids in the frame are the ids in the store. That is the whole
       assertion: the client renders rows under names it invented, and an id in
       this frame that does not match the store is a row the reader can see and
       no later request can address — which is what "That message is not in this
       conversation." was. */
    const threads = await asTestOwner(() => chatStore.load(SLUG));
    const stored = threads.find((t) => t.id === begin?.data.threadId);
    expect(stored?.messages).toHaveLength(2);
    expect(begin?.data.questionId).toBe(stored?.messages[0]?.id);
    expect(begin?.data.messageId).toBe(stored?.messages[1]?.id);
    expect(stored?.messages[0]?.role).toBe("user");
    expect(stored?.messages[1]?.role).toBe("assistant");
  });

  it("names the question a retry is answering again", async () => {
    // A retry mints no new question: the id in the frame is the one already
    // stored, and the client — which may still be holding its own invented name
    // for that row — takes this one.
    const first = await ask({ threadId: "spya-t7r4wz", question: "what is this about?" });
    const threadId = first[0]?.data.threadId as string;
    const answerId = first[0]?.data.messageId as string;

    const again = await ask({ threadId, retry: answerId });
    expect(again[0]?.event).toBe("begin");
    expect(again[0]?.data.messageId).toBe(answerId);

    const threads = await asTestOwner(() => chatStore.load(SLUG));
    const stored = threads.find((t) => t.id === threadId);
    expect(again[0]?.data.questionId).toBe(stored?.messages[0]?.id);
  });

  it("names the rewritten question after an edit", async () => {
    const first = await ask({ threadId: "spya-t7r4wz", question: "what is this about?" });
    const threadId = first[0]?.data.threadId as string;
    const questionId = first[0]?.data.questionId as string;

    const edited = await ask({ threadId, edit: questionId, question: "what is it really about?" });
    expect(edited[0]?.event).toBe("begin");
    // The edited row keeps its id — an edit rewrites a question rather than
    // replacing it — and the answer beneath it is a new row.
    expect(edited[0]?.data.questionId).toBe(questionId);
    expect(edited[0]?.data.messageId).not.toBe(first[0]?.data.messageId);

    const threads = await asTestOwner(() => chatStore.load(SLUG));
    const stored = threads.find((t) => t.id === threadId);
    expect(stored?.messages).toHaveLength(2);
    expect(stored?.messages[0]?.text).toBe("what is it really about?");
  });
});
