/**
 * **The glossary's *Look up a term* box streams its answer, and a partial one
 * is never a finished one.** `POST /api/glossary/:slug/ask`, at the route.
 *
 * Cluster E of docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md,
 * and the stage plan is docs/plans/260910g-stream-glossary-answers-as-they-arrive.md.
 * The transport claims below are exercised directly. The full refusal matrix —
 * ownership, malformed term, no prose, absent and part-word — lives in
 * glossary-asked-term.test.ts; the 400 and 409 controls here pin the route seam
 * where ordinary JSON could accidentally become SSE.
 *
 * 1. **Useful text is written before the provider has finished.** A provider
 *    that sends one delta and then holds is the whole test of streaming: a
 *    route that waits for the answer and then sends it writes nothing until
 *    the hold is released, and a spinner in front of it would look the same.
 * 2. **Exactly one terminal frame**: `done` carrying the unchanged
 *    `AskedTermAnswer`, or `error`. EOF without `[DONE]` and a provider error
 *    mid-answer are `error`, never `done` with the half that arrived.
 * 3. **The quote is the article's, never the reader's.** The `begin` frame and
 *    the `done` both carry the characters the matcher found in the block,
 *    typed in a different case here so the two cannot coincide.
 * 4. **Representative refusals are ordinary JSON, before a header**, with no
 *    call to the provider — the codes the box already reads (`[gl-ask-…]`) are
 *    unchanged.
 * 5. **One provider call per request.**
 * 6. **The reader leaving aborts the provider request**, not merely the frames:
 *    an aborted client proves nothing about billing on its own.
 *
 * Harness copied from tests/quiz-mark-route.test.ts, including its reason for
 * a `res` whose `on("close")` records the listener.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import type { AskedTermAnswer } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-glossary-ask-stream-route";

await pgReady({
  suite: "tests/glossary-asked-term-stream-route.test.ts",
  tables: ["spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");

let article: ScratchArticle | undefined;
/** A word the seeded article really uses, as the article writes it. */
let word = "";

const realFetch = globalThis.fetch;
const noModel = (() => Promise.reject(new Error("no model in tests"))) as unknown as typeof fetch;

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  /* A whole word of seven letters or more from the first paragraph, found
     rather than typed, so the case does not depend on what the corpus article
     happens to say. */
  for (const b of article.blocks) {
    const hit = b.text ? /\b[A-Za-z]{7,}\b/.exec(b.text) : null;
    if (hit) {
      word = hit[0];
      break;
    }
  }
  if (!word) throw new Error("the fixture has no word long enough to ask about");
  globalThis.fetch = noModel;
}, 120_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  await article?.remove();
  await closeDb();
});

beforeEach(() => {
  /* Back to the rejecting default every time: a leaked talking provider would
     let a later case reach a model and still pass. */
  globalThis.fetch = noModel;
});

/** One OpenRouter SSE line. */
const chunk = (data: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);

/**
 * A provider that says `first` and then waits for the test.
 *
 * `finish` ends it cleanly, `cut` closes the body with no `[DONE]` and no
 * finish reason, and `fail` sends the mid-stream error chunk OpenRouter uses.
 */
function heldProvider(first: string) {
  let calls = 0;
  let sent: AbortSignal | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const close = () => {
    try {
      controller?.close();
    } catch {
      // Cancelled already, which is what an abort does.
    }
  };
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    calls += 1;
    sent = init?.signal ?? undefined;
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
          c.enqueue(chunk({ model: "a-model", choices: [{ delta: { content: first } }] }));
        },
      }),
    } as unknown as Response);
  }) as unknown as typeof fetch;

  return {
    calls: () => calls,
    signal: () => sent,
    finish(rest: string) {
      controller?.enqueue(chunk({ choices: [{ delta: { content: rest } }] }));
      controller?.enqueue(chunk({ choices: [{ finish_reason: "stop", delta: {} }] }));
      controller?.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      close();
    },
    cut() {
      close();
    },
    fail() {
      controller?.enqueue(chunk({ error: { message: "upstream went away" } }));
      close();
    },
    /** A clean `[DONE]` after the model hit its token ceiling. */
    runOutOfRoom() {
      controller?.enqueue(chunk({ choices: [{ finish_reason: "length", delta: {} }] }));
      controller?.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      close();
    },
  };
}

/** The request and response one ask is served on — quiz-mark-route's `serve`. */
function serve(slug: string, body: unknown) {
  const payload = [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method: "POST", url: `/api/glossary/${slug}/ask`, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;

  let written = "";
  let head = 0;
  const closers: (() => void)[] = [];
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    writeHead(status: number) {
      head = status;
      (this as { statusCode: number }).statusCode = status;
    },
    flushHeaders() {},
    on(event: string, fn: () => void) {
      if (event === "close") closers.push(fn);
    },
    write(piece: string) {
      written += piece;
      return true;
    },
    end(piece?: string) {
      if (piece) written += piece;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;

  return {
    req,
    res,
    close(): void {
      (res as unknown as { destroyed: boolean }).destroyed = true;
      for (const fn of closers) fn();
    },
    status: () => (res as unknown as { statusCode: number }).statusCode,
    body: () => written,
    streamed: () => head === 200 && written.includes("event: "),
  };
}

/** Every `event: name` / `data: …` frame written so far, parsed. */
function frames(body: string): { name: string; data: unknown }[] {
  return body
    .split("\n\n")
    .map((f) => {
      const name = /^event: (.*)$/m.exec(f)?.[1];
      const data = /^data: (.*)$/m.exec(f)?.[1];
      return name && data ? { name, data: JSON.parse(data) as unknown } : null;
    })
    .filter((f): f is { name: string; data: unknown } => f !== null);
}

/** Poll, rather than sleep, until `ready()` or about a second has passed. */
async function until(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !ready(); i++) await new Promise((r) => setTimeout(r, 5));
}

describe("an answer that is still arriving", () => {
  it("writes the first words before the provider has finished", async () => {
    const provider = heldProvider("The first sentence. ");
    /* Upper case, so the typed term and the article's own characters differ —
       and the quote that comes back can only be the article's. */
    const call = serve(SLUG, { term: word.toUpperCase() });
    const handled = handleApi(call.req, call.res, acceptAny);

    await until(() => call.body().includes("event: delta"));
    /* **The claim of the whole stage.** Read before the provider is released:
       a route that waits for the answer has written nothing at this point. */
    const early = frames(call.body());
    provider.finish("The second sentence.");
    await handled;

    expect(early.some((f) => f.name === "delta")).toBe(true);
    expect(early.some((f) => f.name === "done")).toBe(false);

    const all = frames(call.body());
    const begin = all.find((f) => f.name === "begin")?.data as
      | { term: string; blockId: string; quote: string }
      | undefined;
    expect(begin?.quote).toBe(word);
    expect(begin?.quote).not.toBe(word.toUpperCase());

    const terminals = all.filter((f) => f.name === "done" || f.name === "error");
    expect(terminals.map((f) => f.name)).toEqual(["done"]);
    const done = terminals[0]?.data as AskedTermAnswer;
    /* The public shape, unchanged — the same four keys the JSON route sent. */
    expect(Object.keys(done).sort()).toEqual(["blockId", "lookup", "quote", "term"]);
    expect(done.quote).toBe(word);
    expect(done.term).toBe(word.toUpperCase());
    expect(done.blockId).toBe(begin?.blockId);
    expect(done.lookup.answer).toBe("The first sentence. The second sentence.");
    expect(provider.calls()).toBe(1);
  });

  it("ends in `error`, never `done`, when the body stops without finishing", async () => {
    const provider = heldProvider("Half an answer ");
    const call = serve(SLUG, { term: word });
    const handled = handleApi(call.req, call.res, acceptAny);
    await until(() => provider.calls() > 0);
    provider.cut();
    await handled;

    const names = frames(call.body()).map((f) => f.name);
    expect(call.streamed()).toBe(true);
    expect(names.filter((n) => n === "done" || n === "error")).toEqual(["error"]);
    expect(provider.calls()).toBe(1);
  });

  it("ends in `error` when the provider fails mid-answer", async () => {
    const provider = heldProvider("Half an answer ");
    const call = serve(SLUG, { term: word });
    const handled = handleApi(call.req, call.res, acceptAny);
    await until(() => provider.calls() > 0);
    provider.fail();
    await handled;

    const names = frames(call.body()).map((f) => f.name);
    expect(names.filter((n) => n === "done" || n === "error")).toEqual(["error"]);
  });

  it("ends in `error` when the answer ran out of room, clean `[DONE]` and all", async () => {
    /* **The real `explainStream`, which accepts this as a `done`** — right for
       a comment, which has nowhere to say it was cut. The glossary refuses it.
       GPT Sol's finding on the plan: the first draft checked only the reader's
       signal, and this came out as a whole answer. */
    const provider = heldProvider("Half an answer that ");
    const call = serve(SLUG, { term: word });
    const handled = handleApi(call.req, call.res, acceptAny);
    await until(() => provider.calls() > 0);
    provider.runOutOfRoom();
    await handled;

    const all = frames(call.body());
    const terminals = all.filter((f) => f.name === "done" || f.name === "error");
    expect(terminals.map((f) => f.name)).toEqual(["error"]);
    const error = terminals[0]?.data as { error?: unknown } | undefined;
    expect(error?.error).toMatch(/\[gl-cut-off\]/);
  });

  it("answers a provider refusal inside the stream, not as its HTTP status", async () => {
    /* **A named change of contract, not an accident.** Before streaming, a
       provider 429 reached the client as the response's own status. The
       stream's headers go before the provider is asked, so it is now a 200
       carrying an `error` frame — with the refusal's sentence, which is what
       the box shows either way. GPT Sol, reviewing the plan. */
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      return Promise.resolve({
        ok: false,
        status: 429,
        headers: new Headers(),
        text: () => Promise.resolve("rate limited"),
        body: null,
      } as unknown as Response);
    }) as unknown as typeof fetch;

    const call = serve(SLUG, { term: word });
    await handleApi(call.req, call.res, acceptAny);

    expect(call.status()).toBe(200);
    const terminals = frames(call.body()).filter((f) => f.name === "done" || f.name === "error");
    expect(terminals.map((f) => f.name)).toEqual(["error"]);
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});

describe("a question the article cannot answer", () => {
  it("is refused as JSON before a header, with no provider call", async () => {
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      return Promise.reject(new Error("no model in tests"));
    }) as unknown as typeof fetch;

    const call = serve(SLUG, { term: "zzqxv nowhere in this article" });
    await handleApi(call.req, call.res, acceptAny);

    expect(call.status()).toBe(409);
    expect(call.streamed()).toBe(false);
    expect(call.body()).toMatch(/\[gl-ask-absent\]/);
    expect(calls).toBe(0);
  });

  it("refuses a malformed term with a 400, unstreamed", async () => {
    const call = serve(SLUG, { term: "   " });
    await handleApi(call.req, call.res, acceptAny);
    expect(call.status()).toBe(400);
    expect(call.streamed()).toBe(false);
  });
});

describe("the reader leaving", () => {
  it("aborts the provider request, not just the writing of frames", async () => {
    const provider = heldProvider("You have ");
    const call = serve(SLUG, { term: word });
    const handled = handleApi(call.req, call.res, acceptAny);

    await until(() => provider.signal() !== undefined);
    expect(provider.signal(), "the route never reached the provider").toBeDefined();

    call.close();
    /* Released afterwards, so a route that does NOT abort still ends and fails
       on the assertion rather than on a timeout. */
    provider.cut();
    await handled;

    expect(provider.signal()?.aborted).toBe(true);
    expect(frames(call.body()).some((f) => f.name === "done")).toBe(false);
  });
});
