/**
 * **`POST /api/chat/:slug/:threadId/spoken` — the one write path a browser
 * dictates the contents of.**
 *
 * Every other row in a conversation is written by this server from a model call
 * this server made. A spoken exchange is not: the audio goes browser↔OpenAI
 * directly (Vercel has no long-lived sockets), so the transcript, the tool runs
 * and the passage pointers all arrive as *claims*. This suite is about which of
 * those claims the route believes.
 *
 * Two of the assertions here are for fields the route **replaces** rather than
 * validates, and they are the ones worth having:
 *
 *  - `status` on a tool run, because a stored `running` row is a spinner with
 *    nothing left to end it — src/types.ts § `ToolRun.status`. The live panel's
 *    idea of a run legitimately says `running`, so the browser will send it.
 *  - `model`, because it is the only mark that separates a spoken answer from a
 *    typed one that happened to cite nothing, and the citation instruments in
 *    src/converse.ts read exactly that difference.
 *
 * And the 409, which is not a guard in the ordinary sense: it is the whole
 * idempotency of the endpoint. docs/plans/live-conversation-in-chat.md § 1.
 */
import { cp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { handleApi } from "../src/routes.js";
import { loadThreads } from "../src/chat.js";
import { LIVE_MODEL } from "../src/live.js";
import type { ChatThread } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

const SLUG = "test-chat-spoken-route";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
const EXAMPLE = path.resolve(import.meta.dirname, "..", "example");
const reseed = async () => {
  await rm(DIR, { recursive: true, force: true });
  await cp(EXAMPLE, DIR, { recursive: true });
};
beforeAll(reseed);
afterEach(reseed);
afterAll(() => rm(DIR, { recursive: true, force: true }));

interface Answer {
  status: number;
  body: Record<string, unknown>;
}

async function post(threadId: string, body: unknown, path = "spoken"): Promise<Answer> {
  const payload = [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    {
      method: "POST",
      url: `/api/chat/${SLUG}/${threadId}/${path}`,
      headers: AUTHED_HEADERS,
    },
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
  return {
    status: res.statusCode,
    body: (written ? JSON.parse(written) : {}) as Record<string, unknown>,
  };
}

/**
 * A block id the fixture article really has.
 *
 * Read from the artefact rather than written out, because the point of the
 * check it exercises is that the id is *in the article* — a constant copied
 * here would go stale the day the fixture changed, and the test would then be
 * asserting the refusal path while claiming to assert the acceptance one.
 */
let REAL_BLOCK = "";
beforeAll(async () => {
  const blocks = JSON.parse(
    await readFile(path.join(DIR, "blocks.json"), "utf8"),
  ) as { blocks: { id: string }[] };
  REAL_BLOCK = blocks.blocks[0]?.id ?? "";
  if (!REAL_BLOCK) throw new Error("the fixture has no blocks to point at");
});

/** The minimum a valid exchange needs. */
const exchange = (over: Record<string, unknown> = {}) => ({
  question: "Why does he reject the rainstorm?",
  answer: "Because it does not compute.",
  expectedTailId: null,
  ...over,
});

const threadOf = (answer: Answer): ChatThread => answer.body.thread as ChatThread;

describe("appending one exchange", () => {
  it("writes both rows, done, and titles the conversation", async () => {
    const out = await post("spya-vaaaaa", exchange());
    expect(out.status).toBe(200);
    const thread = threadOf(out);
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages.map((m) => m.status)).toEqual(["done", "done"]);
    expect(thread.title).toContain("Why does he reject");

    /* On disk, not merely in the response. The response is built from the
       store's return value, so a route that answered without writing would
       look identical from here. */
    const stored = (await loadThreads(SLUG)).find((t) => t.id === thread.id);
    expect(stored?.messages).toHaveLength(2);
    expect(stored?.messages[1]?.text).toBe("Because it does not compute.");
  });

  it("marks the answer with the realtime model, so the instruments can tell", async () => {
    /* Not decoration. `citedBlockIds` in src/converse.ts is watched to say
       whether the citation prompt still works, and a spoken answer cites
       nothing *by design* — it points with `show_passage`. Without an explicit
       mark, every live conversation drags that number down and reads as a
       regression in the typed path. */
    const thread = threadOf(await post("spya-vaaaab", exchange()));
    expect(thread.messages[1]?.model).toBe(LIVE_MODEL);
  });

  it("takes a passage pointer and an interruption", async () => {
    const thread = threadOf(
      await post(
        "spya-vaaaac",
        exchange({
          passages: [{ blockIds: [REAL_BLOCK], why: "the rainstorm" }],
          interrupted: true,
        }),
      ),
    );
    expect(thread.messages[1]?.passages).toEqual([
      { blockIds: [REAL_BLOCK], why: "the rainstorm" },
    ]);
    expect(thread.messages[1]?.interrupted).toBe(true);
  });

  it("accepts an exchange whose transcription failed", async () => {
    /* An empty question is a real state — the transcriber fails — and refusing
       it would throw away the answer the reader actually heard. */
    const out = await post("spya-vaaaad", exchange({ question: "" }));
    expect(out.status).toBe(200);
    expect(threadOf(out).title).toBe("New chat");
  });
});

describe("what the route refuses to take the browser's word for", () => {
  it("NEVER stores a tool run as running", async () => {
    /* The live panel's own idea of a run says `running` while it is going, and
       that object is what the browser has to hand when the exchange ends. A
       `running` row on disk is a spinner nothing can ever end — src/types.ts
       § ToolRun.status — and this is the only route that could write one. */
    const thread = threadOf(
      await post(
        "spya-vaaaae",
        exchange({
          tools: [{ name: "search_article_words", label: "searched", status: "running" }],
        }),
      ),
    );
    expect(thread.messages[1]?.tools?.[0]?.status, "a running tool run reached the store").toBe(
      "done",
    );
  });

  it("does not let the browser name the model", async () => {
    const thread = threadOf(await post("spya-vaaaaf", exchange({ model: "something-else" })));
    expect(thread.messages[1]?.model).toBe(LIVE_MODEL);
  });

  it("refuses a passage pointing at something that is not a block id", async () => {
    const out = await post(
      "spya-vaaaag",
      exchange({ passages: [{ blockIds: ["../../etc/passwd"], why: "x" }] }),
    );
    expect(out.status).toBe(400);
    expect(await loadThreads(SLUG)).toHaveLength(0);
  });

  it("refuses a WELL-FORMED id that this article does not have", async () => {
    /* **The one the shape check misses, and the one that matters.** These
       become pressable references in the reader's own transcript, so an id that
       resolves to nothing is a link that scrolls nowhere, stored for ever — and
       the reader cannot tell that from a bug in the scrolling. The first
       version of this test sent `../../etc/passwd`, which proves only that the
       regex works; GPT Sol pointed out that `spya-zzzzzz` sails through it. */
    const out = await post(
      "spya-vaaabe",
      exchange({ passages: [{ blockIds: ["spya-zzzzzz"], why: "nowhere" }] }),
    );
    expect(out.status).toBe(400);
    expect(await loadThreads(SLUG)).toHaveLength(0);
  });

  it("refuses a receipt for a tool a live session is never given", async () => {
    /* The stored name is shown to the reader as something the companion did,
       beside receipts that are all real. A browser filing `delete_database`
       against its own transcript is a claim they have every reason to believe
       and no way to check. */
    const out = await post(
      "spya-vaaabf",
      exchange({ tools: [{ name: "delete_database", label: "tidied up" }] }),
    );
    expect(out.status).toBe(400);
  });

  it("takes a receipt for show_passage, which is answered in the browser", async () => {
    /* It is not in `LIVE_SERVER_TOOLS` — this server never runs it — but it is
       a real thing the model asked for and the reader saw happen, so its
       receipt belongs in the transcript like any other. */
    const thread = threadOf(
      await post("spya-vaaabg", exchange({ tools: [{ name: "show_passage", label: "pointed at" }] })),
    );
    expect(thread.messages[1]?.tools?.[0]?.name).toBe("show_passage");
  });

  it("trims a label long enough to be a payload rather than a label", async () => {
    /* `why` and a tool's `label`/`detail` are the two fields on this route with
       no natural length, and everything here is a claim by the browser. Trimmed
       rather than refused: a long label is cosmetic, and throwing the exchange
       away over one would lose the reader's words with it. */
    const thread = threadOf(
      await post(
        "spya-vaaabd",
        exchange({
          passages: [{ blockIds: [REAL_BLOCK], why: "x".repeat(5000) }],
          tools: [{ name: "search_article_words", label: "y".repeat(5000), detail: "z".repeat(5000) }],
        }),
      ),
    );
    expect(thread.messages[1]?.passages?.[0]?.why.length).toBeLessThanOrEqual(400);
    expect(thread.messages[1]?.tools?.[0]?.label.length).toBeLessThanOrEqual(400);
    expect(thread.messages[1]?.tools?.[0]?.detail?.length).toBeLessThanOrEqual(400);
    /* And the exchange itself still landed. */
    expect(thread.messages).toHaveLength(2);
  });

  it("refuses an exchange with nothing in it", async () => {
    const out = await post("spya-vaaaah", exchange({ question: "  ", answer: "" }));
    expect(out.status).toBe(400);
  });

  it("refuses a body with no expectedTailId at all", async () => {
    /* **Absent and `null` are different claims** — "I forgot to say" and "I
       think this conversation is empty" — and accepting the first would let a
       caller skip the only guard this endpoint has by leaving a key out. */
    const { expectedTailId: _omitted, ...noTail } = exchange();
    const out = await post("spya-vaaaaj", noTail);
    expect(out.status).toBe(400);
  });
});

describe("the expected tail, which is also the idempotency", () => {
  it("appends a second exchange behind the first", async () => {
    const first = threadOf(await post("spya-vaaaba", exchange()));
    const tail = first.messages.at(-1)!.id;
    const second = await post(
      "spya-vaaaba",
      exchange({ question: "And the second?", expectedTailId: tail }),
    );
    expect(second.status).toBe(200);
    expect(threadOf(second).messages).toHaveLength(4);
  });

  it("makes a replayed request a 409 rather than a duplicated turn", async () => {
    /* The reason there is no exchange-id column. A POST retried after it
       succeeded — a dropped response, a client retry — presents the tail the
       first attempt has already moved. It has to conflict, and the client's
       answer to a conflict is to go and look rather than to write again. */
    const body = exchange();
    const first = await post("spya-vaaabb", body);
    expect(first.status).toBe(200);

    const again = await post("spya-vaaabb", body);
    expect(again.status).toBe(409);

    const stored = (await loadThreads(SLUG)).find((t) => t.id === threadOf(first).id);
    expect(stored?.messages, "the replay wrote the turn a second time").toHaveLength(2);
  });

  it("refuses an append behind a conversation that has moved on", async () => {
    const first = threadOf(await post("spya-vaaabc", exchange()));
    const out = await post(
      "spya-vaaabc",
      exchange({ expectedTailId: first.messages[0]?.id, question: "stale" }),
    );
    expect(out.status).toBe(409);
  });
});
