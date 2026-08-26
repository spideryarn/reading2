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
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { handleApi } from "../src/routes.js";
import { loadThreads } from "../src/chat.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

/* An unknown slug falls through to the committed fixture article (see
   `loadArticle` in src/api.ts), so the turn has blocks to cite without this
   test owning an article. The chat file, though, is written under this slug —
   which is why it is a throwaway and why it is removed after. */
const SLUG = "test-chat-route-fixture";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
afterEach(() => rm(DIR, { recursive: true, force: true }));

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

    /* The ids in the frame are the ids on disk. That is the whole assertion:
       the client renders rows under names it invented, and an id in this frame
       that does not match the file is a row the reader can see and no later
       request can address — which is what "That message is not in this
       conversation." was. */
    const threads = await loadThreads(SLUG);
    const stored = threads.find((t) => t.id === begin?.data.threadId);
    expect(stored?.messages).toHaveLength(2);
    expect(begin?.data.questionId).toBe(stored?.messages[0]?.id);
    expect(begin?.data.messageId).toBe(stored?.messages[1]?.id);
    expect(stored?.messages[0]?.role).toBe("user");
    expect(stored?.messages[1]?.role).toBe("assistant");
  });

  it("names the question a retry is answering again", async () => {
    // A retry mints no new question: the id in the frame is the one already on
    // disk, and the client — which may still be holding its own invented name
    // for that row — takes this one.
    const first = await ask({ threadId: "spya-t7r4wz", question: "what is this about?" });
    const threadId = first[0]?.data.threadId as string;
    const answerId = first[0]?.data.messageId as string;

    const again = await ask({ threadId, retry: answerId });
    expect(again[0]?.event).toBe("begin");
    expect(again[0]?.data.messageId).toBe(answerId);

    const threads = await loadThreads(SLUG);
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

    const threads = await loadThreads(SLUG);
    const stored = threads.find((t) => t.id === threadId);
    expect(stored?.messages).toHaveLength(2);
    expect(stored?.messages[0]?.text).toBe("what is it really about?");
  });
});
