/**
 * What a second tab can do to an answer the first one is watching.
 *
 * Every test here needs a **live** stream — one that has started, has written a
 * word, and has not finished — because the bugs these pin are all about what
 * happens to that stream when a second request arrives naming the same
 * conversation. `fetch` is stubbed with a body that emits one frame and then
 * stays open, exactly as a model still thinking does (the same trick
 * tests/converse-stop.test.ts uses), and the only way out is the abort.
 *
 * Both High findings of a GPT-5.6 review, 2026-08-26, are here:
 *
 *  - a stale retry or edit used to abort the live answer **and then** refuse
 *    itself with a 409, so the reader who pressed nothing was told they had
 *    stopped it;
 *  - and a stop naming an answer that has already been replaced used to abort
 *    the replacement, because the key names a row and a retry reuses the row.
 *
 * The review's *other* High — a new turn appended into the gap an edit is
 * waiting in — is **not** here, and an earlier version of this file claimed a
 * test for it that did not test it. The window it needs is the wait inside
 * `settleThread`, and nothing outside the process can widen that wait: the one
 * lever available from here, a slow `cancel()` on the body, is dropped on the
 * floor because `openrouter-stream.ts` cancels once un-awaited on abort and the
 * awaited cancel afterwards is then a no-op. The test written against it passed
 * with the lock removed, which is worse than no test. What is checked instead is
 * the lock's own contract — see tests/turn-order.test.ts.
 *
 * ## It ran on the filesystem store until 2026-09-04, and one contract appears
 *
 * The article was a `cp(example/ → data/<slug>/)` and the read-backs went
 * through `loadThreads`, so every claim here was being made about the store
 * that is not deployed
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § B). Worse, `loadThreads` reads the data root and never consults the store,
 * so pinning the flag and leaving it alone would have given `stored()` an empty
 * array rather than an error — every `status` assertion below reading
 * `undefined` and the file going green having checked nothing.
 *
 * **What the move adds is the store attempt.** `begin` hands back an
 * `attempt` token and `finish` is fenced on it, so a call some other process's
 * sweep has already buried cannot land on the retry the reader is watching —
 * and `pgChatStore.finish` *refuses* a caller that arrives without one
 * (`MissingAttempt`). The filesystem store has no attempts at all and returns
 * `undefined` there, so on files the whole thread of that token from `begin`
 * to `finish` could be cut and nothing in this file would have moved. It is
 * what the last assertion here — the answer ends up `done` — now depends on.
 *
 * ## The mutations, watched rather than reasoned — 2026-09-04
 *
 * Two, both aimed at the paragraph above, and the pair splits it in half: the
 * token being **carried** is tested here, the token being **checked** is not.
 *
 * **1 — cut the thread from `begin` to `finish`, and it went red.**
 * `src/routes.ts`: `const storeAttempt = begun.attempt;` made `const
 * storeAttempt = undefined as string | undefined;`, so `finish` is called with
 * no token and `pgChatStore.finish` throws `MissingAttempt`. **1 failed of 3**:
 * *refuses one aimed at an attempt that has been replaced*, whose last
 * assertion is the answer ending up `done`. This is the mutation the filesystem
 * store could not have had — it returns `undefined` there and takes
 * `undefined`, so the same cut moved nothing.
 *
 * **2 — remove the fence itself, and it STAYED GREEN.**
 * `src/store/pg-chat.ts` § `finish`: `eq(chatMessages.attemptId, attempt),`
 * deleted from the `where`, leaving only the `status = 'pending'` clause. **3
 * passed of 3.** The `MissingAttempt` throw above it still fires on an absent
 * token, which is what mutation 1 reached; what is gone is the check that the
 * token is *the current one*. Nothing here ever calls `finish` with a stale
 * attempt: the retry in the second case replaces the row's `attempt_id` and
 * then the original stream is aborted rather than allowed to land, so the
 * losing writer never arrives. So *a call some other process's sweep has
 * already buried cannot land on the retry the reader is watching* is the
 * mechanism this file rests on and **is not the thing this file proves**.
 * tests/turn-order.test.ts and tests/store-chat-pg.test.ts are where the fence
 * itself is held.
 *
 * **What neither covers.** Both reach `finish`. `begin`'s own minting of the
 * attempt is untouched — a `begin` that wrote the same token on every row would
 * satisfy both runs. Neither says anything about the `status`/`attempt_id`
 * CHECK pair being cleared together at the end of `finish`, nor about the
 * `updatedAt` bump deliberately left outside the fence a few lines above it,
 * which no assertion in this file reads.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `SPIDERYARN_STORE=postgres`, before **any** import runs — `src/store/live.ts`
 * reads the flag once and imports are hoisted above every statement. Copied
 * from tests/candidates-route.test.ts, which explains the shape.
 */
const PREVIOUS_STORE_FLAG = vi.hoisted(() => {
  const previous = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return previous;
});

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import type { ChatMessage } from "../src/types.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

/* The turn needs an article to answer about, and this slug used to get one for
   nothing: an unknown slug fell through to the committed `example/` fixture.
   That fallback is gone (src/api.ts § `candidateDirs`) — it answered a reader's
   own half-built article with the fixture's prose. It is a seeded Postgres
   article now, and the conversations written against it are deleted between
   cases rather than the directory being thrown away. */
const SLUG = "test-chat-live-fixture";

const { reachable } = await pgReady({
  suite: "tests/chat-live-turn.test.ts",
  tables: ["spideryarn.chat_threads", "spideryarn.chat_messages", "spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");
const { chatStore, STORE } = await import("../src/store/index.js");

if (PREVIOUS_STORE_FLAG === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = PREVIOUS_STORE_FLAG;

const when = reachable ? describe : describe.skip;

describe("the store these tests are actually talking to", () => {
  it("is the Postgres one", () => {
    /* Not gated on the database being up, deliberately: a control that vanishes
       when Postgres is missing vanishes exactly when it matters. A flag that
       failed to take looks precisely like this suite working — the filesystem
       store finishes an answer with no attempt token and says nothing. */
    expect(STORE).toBe("postgres");
  });
});

const frame = (text: string) =>
  `data: ${JSON.stringify({ model: "test/model", choices: [{ delta: { content: text } }] })}\n\n`;

/** A body that says one word and then waits for ever. The abort ends it. */
function hangingBody(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let sent = false;
  return new ReadableStream({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(encoder.encode(frame("Because")));
        return;
      }
      return new Promise<void>(() => {});
    },
  });
}

let article: ScratchArticle | undefined;

beforeAll(async () => {
  if (!reachable) return;
  /* `TEST_OWNER`, because `acceptAny` authenticates as that reader and the
     Postgres reader filters every article by owner. An article seeded as
     anybody else is invisible and every route below answers 404, which looks
     exactly like a broken route — `ScratchOptions.ownerId`. */
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
}, 60_000);

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

beforeEach(async () => {
  /* Conversations, and nothing a previous case left streaming beside them.
     Both cases below use the same thread id, so this is what keeps the second
     from inheriting the first's messages — where the filesystem version threw
     the whole `data/<slug>/` directory away and got the same reset for free. */
  if (article) {
    await asTestOwner(async () => {
      for (const thread of await chatStore.load(SLUG)) await chatStore.remove(SLUG, thread.id);
    });
  }
  process.env.OPENROUTER_API_KEY = "test-key";
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      return new Promise<Response>((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        resolve(new Response(hangingBody(), { headers: { "Content-Type": "text/event-stream" } }));
      });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

interface Call {
  /** Resolves when the route has finished — which, for a send, means aborted. */
  done: Promise<void>;
  status(): number;
  frames(): { event: string; data: Record<string, unknown> }[];
  /** The JSON body, for the routes that answer with one rather than a stream. */
  body(): Record<string, unknown>;
}

function call(method: string, url: string, body?: unknown): Call {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;

  let written = "";
  let status = 0;
  const res = {
    get statusCode() {
      return status;
    },
    set statusCode(v: number) {
      status = v;
    },
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

  return {
    done: handleApi(req, res, acceptAny).then(() => {}),
    status: () => status,
    body: () => (written.startsWith("event: ") ? {} : (JSON.parse(written || "{}") as Record<string, unknown>)),
    frames: () =>
      written
        .split("\n\n")
        .filter((b) => b.startsWith("event: "))
        .map((b) => {
          const [head, ...rest] = b.split("\n");
          return {
            event: (head as string).slice("event: ".length),
            data: JSON.parse(rest.join("\n").slice("data: ".length)) as Record<string, unknown>,
          };
        }),
  };
}

/** Wait until the route has written its first frame, or give up. */
async function begun(c: Call): Promise<Record<string, unknown>> {
  for (let i = 0; i < 150; i++) {
    const first = c.frames()[0];
    if (first && first.data.text === undefined) return first.data;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("no begin frame");
}

/** Wait until at least one word of the answer has arrived. */
async function streaming(c: Call): Promise<void> {
  for (let i = 0; i < 150; i++) {
    if (c.frames().some((f) => f.event === "delta")) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("nothing streamed");
}

/**
 * The conversation as the store has it, read as the reader the request ran as.
 *
 * Outside a request `currentOwnerId()` falls back to the environment's owner
 * and the read fails as a 404 about the fixture, arriving inside an assertion —
 * see `asTestOwner`. It went through `loadThreads` until 2026-09-04, which
 * reads `data/<slug>/chat.json` whatever the store is.
 */
const stored = async (threadId: string): Promise<ChatMessage[]> =>
  (await asTestOwner(() => chatStore.load(SLUG))).find((t) => t.id === threadId)?.messages ?? [];

/** Stop whatever is still streaming in a conversation. Never throws. */
async function release(threadId: string): Promise<void> {
  if (threadId === "") return;
  const pending = (await stored(threadId)).filter((m) => m.status === "pending");
  for (const m of pending) {
    await call("POST", `/api/chat/${SLUG}/${threadId}/stop`, { messageId: m.id }).done.catch(
      () => {},
    );
  }
}

when("a request that will be refused touches nothing", () => {
  it("does not stop the live answer on its way to a 409", async () => {
    const live = call("POST", `/api/chat/${SLUG}`, {
      threadId: "spya-t7r4wz",
      question: "why is it like that?",
    });
    let threadId = "";
    try {
      const first = await begun(live);
      threadId = first.threadId as string;
      await streaming(live);

      /* A retry of a message that is not the last one — a second tab a step
         behind, which is the case ChatConflict exists for. It must be refused,
         and the refusal must cost the reader in the other tab nothing. */
      const stale = call("POST", `/api/chat/${SLUG}`, {
        threadId,
        retry: first.questionId as string,
      });
      await stale.done;
      expect(stale.status()).toBe(409);

      // Still arriving. Before the fix this row was `done` with `stopped: true`:
      // the settle ran before the check, so the refusal aborted the answer first
      // and refused itself second.
      const after = await stored(threadId);
      expect(after.at(-1)?.status).toBe("pending");
      expect(after.at(-1)?.stopped).toBeUndefined();
      expect(live.frames().some((f) => f.event === "done")).toBe(false);
    } finally {
      /* In a `finally` because a *failing* assertion above leaves the stream
         open, and an open stream here is not an inert leftover: it holds a
         120-second deadline and a 45-second stall timer, and it stays in the
         module's `streaming` map where the next test can see it. A regression
         would take the whole file down with it rather than one case. */
      await release(threadId);
      await live.done;
    }
  });
});

when("a stop names the answer it was pressed on", () => {
  it("refuses one aimed at an attempt that has been replaced", async () => {
    const live = call("POST", `/api/chat/${SLUG}`, {
      threadId: "spya-t7r4wz",
      question: "why is it like that?",
    });
    const first = await begun(live);
    const threadId = first.threadId as string;
    const answerId = first.messageId as string;
    await streaming(live);

    // Stop it the honest way, then ask again. The retry reuses the row, so the
    // second attempt answers to the same name as the first.
    await call("POST", `/api/chat/${SLUG}/${threadId}/stop`, {
      messageId: answerId,
      attempt: first.attempt as number,
    }).done;
    await live.done;

    const again = call("POST", `/api/chat/${SLUG}`, { threadId, retry: answerId });
    const second = await begun(again);
    expect(second.messageId).toBe(answerId);
    expect(second.attempt).not.toBe(first.attempt);
    await streaming(again);

    /* The first attempt's stop, arriving late. Same row, older attempt. It must
       do nothing: the words the reader pressed it on finished long ago, and the
       answer under that name now is one nobody asked to stop. */
    const late = call("POST", `/api/chat/${SLUG}/${threadId}/stop`, {
      messageId: answerId,
      attempt: first.attempt as number,
    });
    await late.done;
    // "There was nothing to stop" — true in the only sense the reader means it.
    expect(late.body()).toEqual({ stopped: false });
    // And the answer that *is* under that name is untouched and still arriving.
    expect((await stored(threadId)).at(-1)?.status).toBe("pending");

    await call("POST", `/api/chat/${SLUG}/${threadId}/stop`, {
      messageId: answerId,
      attempt: second.attempt as number,
    }).done;
    await again.done;
    expect((await stored(threadId)).at(-1)?.status).toBe("done");
  });
});
