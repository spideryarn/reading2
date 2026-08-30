/**
 * **What the chat endpoint refuses once review mode exists.**
 *
 * Review added two optional fields to `POST /api/chat/:slug` — `kind` and
 * `stance` — and every test here is about a request that must NOT be quietly
 * accepted. That emphasis is the point: an API that ignores an unknown key and
 * a client that never checks look identical from both ends, so the failure mode
 * for all of these is a 200 and an answer written to the wrong instructions,
 * with nothing on screen saying so.
 *
 * The 409 tests also pin *where* the check runs. `settleThread` stops a live
 * answer in the thread, and a request rejected after that has aborted the
 * answer another tab's reader was watching and told them they stopped it — a
 * bug this route has had once already (docs/plans/chat-mode.md § The race a
 * retry created). So a retry or an edit carrying a kind is refused before
 * anything is read, let alone settled.
 *
 * Nothing here reaches the model: `fetch` is stubbed, exactly as in
 * tests/chat-route.test.ts, because everything under test happens before the
 * first model call.
 */
import { cp, rm } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleApi } from "../src/routes.js";
import { loadThreads } from "../src/chat.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

const SLUG = "test-review-route-fixture";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
/* The committed fixture's artefacts, copied in so the turn has an article. This
   slug used to get them for nothing — an unknown slug fell through to
   `example/` — and that fallback is gone (src/api.ts § `candidateDirs`), which
   is why the block ids asserted below are still the fixture's own. */
const EXAMPLE = path.resolve(import.meta.dirname, "..", "example");
beforeEach(async () => {
  await rm(DIR, { recursive: true, force: true });
  await cp(EXAMPLE, DIR, { recursive: true });
});
afterAll(() => rm(DIR, { recursive: true, force: true }));

const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() =>
    Promise.reject(new Error("no model in tests"))) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

/**
 * POST a body and return the status and what was written.
 *
 * Unlike `ask` in tests/chat-route.test.ts this keeps the **status code**,
 * because every case here is a refusal — and a refusal that arrives as an
 * `error` frame inside a 200 stream is a different (and worse) thing from a
 * 4xx, so the two have to be told apart.
 */
async function post(body: unknown): Promise<{ status: number; body: string }> {
  const payload = [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method: "POST", url: `/api/chat/${SLUG}`, headers: AUTHED_HEADERS },
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
  return { status: (res as { statusCode: number }).statusCode, body: written };
}

/** A stored review, so the "already a different kind" cases have one to hit. */
async function seedReview(threadId: string) {
  await post({ threadId, question: "what I took from it", kind: "review", stance: "socratic" });
}

describe("a stance the server does not know is refused, not ignored", () => {
  it("400s an unknown stance", async () => {
    const { status } = await post({
      threadId: "spya-r4v3wz",
      question: "what I took",
      kind: "review",
      stance: "socratik",
    });
    expect(status).toBe(400);
  });

  it("names the four in the message, so a client author can fix it", async () => {
    const { body } = await post({
      threadId: "spya-r4v3wz",
      question: "q",
      kind: "review",
      stance: "nonsense",
    });
    for (const s of ["balanced", "respond", "socratic", "signposts"]) expect(body).toContain(s);
  });

  it("accepts all four", async () => {
    for (const stance of ["balanced", "respond", "socratic", "signposts"]) {
      const { status } = await post({
        threadId: `spya-s${stance.slice(0, 5)}`,
        question: "what I took",
        kind: "review",
        stance,
      });
      // 200: the turn is written and the stream opens before the model is called.
      expect(status, `${stance} was refused`).not.toBe(400);
    }
  });

  it("400s an unknown kind", async () => {
    const { status } = await post({ threadId: "spya-r4v3wz", question: "q", kind: "essay" });
    expect(status).toBe(400);
  });
});

describe("a review cannot be anchored to a passage", () => {
  /* There is no gesture that starts a review from a selection — both the
     paragraph button and the selection open a chat — so an anchor arriving with
     `kind: "review"` is a confused client. It is refused rather than dropped
     because an unanchored review draws no mark in the prose, which is the
     property the reading view's overlay relies on. */
  it("400s an anchor sent with kind review", async () => {
    /* `spya-tgnssb` is a REAL block of the fixture article (example/blocks.json),
       and that matters: the first version of this test used a made-up id and
       passed for the wrong reason — `checkAnchor` rejects an id the article
       does not have, so the 400 arrived whether or not the review rule existed.
       With a genuine block, the only thing that can refuse this is the rule
       under test. */
    const { status } = await post({
      threadId: "spya-r4v3wz",
      question: "what I took",
      kind: "review",
      anchor: { blockId: "spya-tgnssb" },
    });
    expect(status).toBe(400);
  });

  it("accepts the same anchor on a chat, so the block id is not the reason", async () => {
    const { status } = await post({
      threadId: "spya-r4v4wz",
      question: "what does this mean?",
      anchor: { blockId: "spya-tgnssb" },
    });
    expect(status).not.toBe(400);
  });
});

describe("a thread's kind belongs to the thread", () => {
  it("409s a send whose kind contradicts the stored thread", async () => {
    /* Two layers answer this, and the test passes on either — which is the
       design rather than a weakness. The route's check is there for the status
       code and a sentence a person can act on; `withTurn`'s is the guarantee,
       because the route reads under `inTurnOrder` and that is only
       per-process. Remove both and this goes red. */
    const id = "spya-r7k2wz";
    await seedReview(id);
    const { status } = await post({ threadId: id, question: "sneaky", kind: "chat" });
    expect(status).toBe(409);
  });

  it("accepts a send that agrees, so a duplicate request is harmless", async () => {
    const id = "spya-r7k3wz";
    await seedReview(id);
    const { status } = await post({ threadId: id, question: "and also", kind: "review" });
    expect(status).not.toBe(409);
  });

  it("accepts a send that names no kind at all", async () => {
    const id = "spya-r7k4wz";
    await seedReview(id);
    const { status } = await post({ threadId: id, question: "and also" });
    expect(status).not.toBe(409);
    const threads = await loadThreads(SLUG);
    expect(threads.find((t) => t.id === id)?.kind).toBe("review");
  });

  /* **Refused before anything is read, let alone settled.** A retry's thread
     already has a kind and its answer already has a stance, so a body carrying
     either can only be a stale tab — and `settleThread`, which a retry calls,
     stops a live answer in that thread. Rejecting after that would abort an
     answer someone was watching in another tab and record it as stopped. */
  it("400s a retry that carries a kind", async () => {
    const id = "spya-r7k5wz";
    await seedReview(id);
    const { status } = await post({ threadId: id, retry: "spya-whatever", kind: "review" });
    expect(status).toBe(400);
  });

  it("400s a retry that carries a stance", async () => {
    const id = "spya-r7k6wz";
    await seedReview(id);
    const { status } = await post({ threadId: id, retry: "spya-whatever", stance: "respond" });
    expect(status).toBe(400);
  });

  it("400s an edit that carries a stance", async () => {
    const id = "spya-r7k7wz";
    await seedReview(id);
    const { status } = await post({
      threadId: id,
      edit: "spya-whatever",
      question: "rewritten",
      stance: "respond",
    });
    expect(status).toBe(400);
  });
});

describe("what actually gets stored", () => {
  it("writes the kind and the stance on the very first turn", async () => {
    const id = "spya-r8m2wz";
    await post({ threadId: id, question: "what I took from it", kind: "review", stance: "signposts" });
    const thread = (await loadThreads(SLUG)).find((t) => t.id === id);
    expect(thread?.kind).toBe("review");
    /* **And the answer here has FAILED**, because `fetch` is stubbed to reject
       — which makes this the sharpest version of the test rather than an
       inconvenience. The stance was written onto the pending row before the
       model was called, so it is still there on a row that never produced a
       word. Write it in `finishTurn` instead and this goes red: every crashed,
       stopped or swept answer would then have no stance, and the retry of one
       would have nothing to inherit. */
    expect(thread?.messages.at(-1)?.status).toBe("error");
    expect(thread?.messages.at(-1)?.stance).toBe("signposts");
  });

  it("stores no stance for an ordinary chat", async () => {
    const id = "spya-r8m3wz";
    await post({ threadId: id, question: "an ordinary question" });
    const thread = (await loadThreads(SLUG)).find((t) => t.id === id);
    expect(thread?.kind).toBe("chat");
    expect(thread?.messages.at(-1)).not.toHaveProperty("stance");
  });

  /* A spoken review runs three or four times longer than a typed question, so
     the two have their own limits. Sharing chat's 4,000 would 413 a reader who
     talked for four minutes, after they had already paid for the
     transcription. */
  it("lets a review be much longer than a question", async () => {
    const long = "so what I took from this is ".repeat(300); // ~8,400 chars
    expect(long.length).toBeGreaterThan(4000);
    const asChat = await post({ threadId: "spya-r9m2wz", question: long });
    const asReview = await post({
      threadId: "spya-r9m3wz",
      question: long,
      kind: "review",
      stance: "balanced",
    });
    expect(asChat.status).toBe(413);
    expect(asReview.status).not.toBe(413);
  });

  it("still has a ceiling on a review", async () => {
    const absurd = "x".repeat(20_001);
    const { status } = await post({ threadId: "spya-r9m4wz", question: absurd, kind: "review" });
    expect(status).toBe(413);
  });
});
