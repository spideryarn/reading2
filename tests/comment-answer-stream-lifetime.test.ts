/**
 * **A comment's answer is still being written when the request says it is** —
 * `POST /api/comments/:slug/:id/answer`, held open mid-stream and asked the
 * questions a syntactic check cannot answer.
 *
 * ## Why this file exists, and why it exists *before* the move it is for
 *
 * `serveAuthenticatedApi`'s `if` chain is being emptied into `AUTH_ROUTES` one
 * contiguous slice at a time
 * (docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md), and
 * the six Comments guards are the next slice up. One of them streams:
 *
 *     const answerBody = await readBody(req);
 *     await withSpendAttribution({ articleSlug: slug }, () =>
 *       answer(slug, id, answerBody, res),
 *     );
 *
 * Moved into a row, that becomes a closure `dispatchAuthRoute` awaits — the same
 * lifetime **if** the closure still awaits `answer`. A closure that *launches*
 * it and resolves typechecks, and then the request ends while the model call is
 * still running, the spend collector has closed before the call it is counting
 * and anything `answer` throws lands nowhere. The queue of gaps in
 * docs/plans/260908a-chat-and-live-sessions-join-the-route-table.md § *The queue
 * after this slice* names this route; its only server-side coverage before this
 * file was a 409 *before* the stream starts (tests/routes.test.ts § *will not
 * answer a comment that was never a question*), which a launched stream passes.
 *
 * **These cases were written and run against the guard while it was still in
 * the chain**, and nothing in them reads the route's source or shape — it goes
 * in through `handleApi` by method and path — so the move must need no edit
 * here, and green before and green after is the claim.
 *
 * ## The oracle that would not work, and the one that does
 *
 * The obvious "the registry still holds it" check — a `GET` mid-stream that
 * sees the row still `pending` — **cannot fail**, for the reason
 * tests/referee-stream-lifetime.test.ts records against its own first draft.
 * `sweepPending` (src/store/pg-comments.ts) spares a `pending` row on **either**
 * of two grounds: the `keep` set the route builds from `answering`, or a lease on
 * the row that `beginAnswer` stamped `COMMENT_ANSWER_LEASE_MS` into the future.
 * A row begun a moment ago is spared by its lease whether or not the registry
 * holds it. So every registry case below **ages the lease in SQL first**, and
 * then `pending` has one remaining explanation.
 *
 * ## The mutations, watched rather than reasoned
 *
 * Each was applied to src/routes.ts alone, this file run, and reverted. The
 * results are in the plan that commissioned the file,
 * docs/plans/260911b-comments-join-the-route-table.md § *Stage 1, as built*,
 * rather than here, where they would be the first thing to go stale.
 *
 * | Mutation | What must go red |
 * |---|---|
 * | the guard's `await withSpendAttribution(…)` → `void withSpendAttribution(…)` | *holds the request open* — the subject |
 * | `release()` deleted from `answer`'s `finally` | *releases the registry by the time it answers* |
 * | `release()` called straight after `beganAnswering`, before the stream | *still holds the registry …, however old the lease* |
 * | `beganAnswering` a flag rather than a count (`+ 1` → `1`) | *a second attempt keeps the registry after the first finishes* |
 *
 * **The last three are not this migration's risks** — nothing in the move
 * touches `answer` or `beganAnswering`. They are here because an oracle for a
 * lock that has never been watched failing on the lock is the file this one's
 * header warns about, and because the second attempt is what makes the registry
 * a count.
 *
 * **Outside this oracle.** What the model is told, and what the reader sees —
 * `explainStream` is stubbed, so no model is called and no ledger row is
 * written; tests/explain.test.ts and the comment client suites hold those. The
 * spend collector's own window: a launched stream would also be attributed to
 * nothing, and no assertion here reads the ledger. And cross-machine sweeping,
 * which is tests/comment-sweep.test.ts.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../src/db/client.js";
import { comments as commentsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-comment-answer-stream-lifetime";

/**
 * The stubbed stream, and the handshake that makes "still running" a fact.
 *
 * **One gate per call, handed out in order**, because the two-attempt case needs
 * two streams held at once and released separately. A case pushes the gates it
 * will use before it starts the requests; each generator invocation takes the
 * next one. `arrive()` says the generator is inside and has yielded its first
 * frame; `hold()` is where it stops until the case calls `release()`.
 *
 * `vi.hoisted` because `vi.mock` is hoisted above this module's statements.
 */
const gates = vi.hoisted(() => {
  function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }
  interface Gate {
    reached: () => Promise<void>;
    arrive: () => void;
    hold: () => Promise<void>;
    release: () => void;
  }
  const queue: Gate[] = [];
  let taken = 0;
  return {
    /** A new gate, queued for the next stream to begin. */
    make(): Gate {
      const arrived = deferred();
      const released = deferred();
      const gate: Gate = {
        reached: () => arrived.promise,
        arrive: () => arrived.resolve(),
        hold: () => released.promise,
        release: () => released.resolve(),
      };
      queue.push(gate);
      return gate;
    },
    /** Called by the generator: the gate for this call. */
    take(): Gate {
      const gate = queue[taken++];
      if (!gate) throw new Error("a stream began that no case made a gate for");
      return gate;
    },
    /** Release everything, so a parked generator cannot keep a worker alive. */
    releaseAll(): void {
      for (const gate of queue) gate.release();
    },
  };
});

/* Everything else the real module exports is kept — src/store/pg-comments.ts
   derives `COMMENT_ANSWER_LEASE_MS` from `EXPLAIN_TIMEOUT_MS` at import time. */
vi.mock("../src/explain.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/explain.js")>()),
  async *explainStream() {
    const gate = gates.take();
    yield { type: "delta", text: "half an explanation" };
    gate.arrive();
    await gate.hold();
    yield {
      type: "done",
      ending: "finished",
      answer: "the whole explanation",
      citations: [],
      searches: 0,
      model: "stub",
    };
  },
}));

await pgReady({
  suite: "tests/comment-answer-stream-lifetime.test.ts",
  tables: ["spideryarn.comments", "spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");
const { commentStore } = await import("../src/store/index.js");

/**
 * A request **started but not waited for**, so a case can look at it in flight.
 *
 * `settled` is set by a continuation attached when the promise is made, so
 * reading it asks about the original promise rather than racing a sentinel.
 * The response is the streaming-capable fake tests/referee-stream-lifetime.test.ts
 * uses: `sse()` needs `on`, `writeHead` and the two "has the reader gone"
 * properties.
 */
function begin(
  method: string,
  url: string,
  body?: unknown,
): {
  promise: Promise<void>;
  settled: () => boolean;
  ended: () => boolean;
  written: () => string;
} {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;

  let written = "";
  let ended = false;
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    flushHeaders() {},
    writeHead() {},
    on() {},
    write(chunk: string) {
      written += chunk;
      return true;
    },
    end(chunk?: string) {
      if (chunk) written += chunk;
      ended = true;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;

  let settled = false;
  const promise = handleApi(req, res, acceptAny).then(
    () => {
      settled = true;
    },
    (err: unknown) => {
      settled = true;
      throw err;
    },
  );
  return { promise, settled: () => settled, ended: () => ended, written: () => written };
}

/** The comments `GET`, asked normally — this is what runs the sweep. */
async function statusOf(id: string): Promise<string | undefined> {
  const call = begin("GET", `/api/comments/${SLUG}`);
  await call.promise;
  const body = JSON.parse(call.written() || "{}") as { comments?: { id: string; status: string }[] };
  return body.comments?.find((c) => c.id === id)?.status;
}

/**
 * Wait for the stream's checkpoint, and **fail fast if the request answers
 * instead** — a 404 or a 409 upstream of the stream would otherwise sit until
 * the timeout and report "timed out" about a routing failure. The trailing
 * `await Promise.resolve()` lets a continuation queued in the same job run
 * before `settled` is read (tests/referee-stream-lifetime.test.ts § why).
 */
async function reachedOrSettled(
  gate: { reached: () => Promise<void> },
  call: { promise: Promise<void>; written: () => string },
): Promise<void> {
  const early = call.promise.then(
    () => {
      /* Also what a handler that launched `answer` and returned looks like: the
         request resolves before the stream has even begun. */
      throw new Error(
        `the request settled before the stream was entered — launched rather than awaited? ${call.written()}`,
      );
    },
    () => {
      throw new Error("the request failed before the stream was entered");
    },
  );
  early.catch(() => {});
  await Promise.race([gate.reached(), early]);
  await Promise.resolve();
}

/** Put the lease on this comment an hour in the past — what a dead process leaves. */
async function ageTheLease(articleId: string, id: string): Promise<void> {
  await getDb()
    .update(commentsTable)
    .set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 hour'` })
    .where(and(eq(commentsTable.articleId, articleId), eq(commentsTable.id, id)));
}

const answerUrl = (id: string) => `/api/comments/${SLUG}/${id}/answer`;
/** `useProfile: false`, so `answer` makes no profile read before the claim. */
const ANSWER_BODY = { useProfile: false };

describe("a comment's answer outlives nothing it should", { timeout: 60_000 }, () => {
  let article: ScratchArticle;
  let block = "";
  let quote = "";

  beforeAll(async () => {
    /* `TEST_OWNER`, because `acceptAny` authenticates as that reader and every
       article read is owner-scoped — seeded as anybody else, the route 404s. */
    article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
    const long = article.blocks.find((b) => b.text.length > 40);
    if (!long) throw new Error("the fixture has no block long enough to quote");
    block = long.id;
    quote = long.text.slice(0, 20);
  }, 60_000);

  /**
   * A comment that can be answered: made free, then given an old answer in SQL,
   * because `beginAnswer` claims only a terminal row and creating one lands as
   * `none` — the fixture tests/routes.test.ts § *a pending comment nobody is
   * answering* uses, for the reason it gives.
   */
  let id = "";
  beforeEach(async () => {
    await asTestOwner(async () => {
      for (const c of await commentStore.load(SLUG)) await commentStore.remove(SLUG, c.id);
    });
    const made = await asTestOwner(() =>
      commentStore.create(SLUG, { blockId: block, quote, start: 0 }),
    );
    id = made.id;
    await getDb()
      .update(commentsTable)
      .set({ status: "done", answer: "an old explanation" })
      .where(and(eq(commentsTable.articleId, article.articleId), eq(commentsTable.id, id)));
  });

  afterAll(async () => {
    gates.releaseAll();
    await article?.remove();
  });

  it("holds the request open until the answer is written, and only then answers", async () => {
    const gate = gates.make();
    const call = begin("POST", answerUrl(id), ANSWER_BODY);
    await reachedOrSettled(gate, call);

    /* The handshake fired, so the handler is inside the stream. Both of these
       are false for a route that launched `answer` and returned. */
    expect(call.settled(), "the request answered while the stream was still running").toBe(false);
    expect(call.ended(), "the response was ended mid-stream").toBe(false);

    gate.release();
    await call.promise;

    expect(call.ended()).toBe(true);
    expect(call.written()).toContain("event: done");
    const stored = (await asTestOwner(() => commentStore.load(SLUG))).find((c) => c.id === id);
    expect(stored?.status, "the terminal write ran before the request settled").toBe("done");
    expect(stored?.answer).toBe("the whole explanation");
  });

  it("still holds the registry while the stream is running, however old the lease", async () => {
    const gate = gates.make();
    const call = begin("POST", answerUrl(id), ANSWER_BODY);
    await reachedOrSettled(gate, call);

    /* **The lease is now an hour gone**, so the row's own clock cannot be what
       spares it. Only `keep` — `liveComments(slug)`, built from `answering` —
       is left. Without this line the assertion passes with the registry
       deleted. */
    await ageTheLease(article.articleId, id);
    expect(await statusOf(id), "an aged row survived only if the registry holds it").toBe("pending");

    gate.release();
    await call.promise;
  });

  it("releases the registry by the time it answers, so the next sweep can collect a dead attempt", async () => {
    const gate = gates.make();
    const call = begin("POST", answerUrl(id), ANSWER_BODY);
    await reachedOrSettled(gate, call);
    gate.release();
    await call.promise;

    /* The same comment put back to `pending` with a dead lease — what a crash
       leaves — so the key a sweep would have to spare is exactly the key the
       finished answer held. Collectable if and only if that key has left
       `answering`. */
    await getDb()
      .update(commentsTable)
      .set({ status: "pending", leaseExpiresAt: sql`clock_timestamp() - interval '1 hour'` })
      .where(and(eq(commentsTable.articleId, article.articleId), eq(commentsTable.id, id)));
    expect(await statusOf(id), "the key was never released, so the sweep spared it").toBe("error");
  });

  it("a second attempt keeps the registry after the first finishes", async () => {
    /* **Why the registry is a count.** The deep-search button sits on an
       answered comment, so two answers for one id can overlap — and here the
       second is a retry that reclaims the row once the first attempt's lease
       has run out, which is `beginAnswer`'s documented path. When the first
       finishes, the second is still streaming, and the sweep must still spare
       it. A flag would be cleared by whichever finished first. */
    const first = gates.make();
    const firstCall = begin("POST", answerUrl(id), ANSWER_BODY);
    await reachedOrSettled(first, firstCall);

    await ageTheLease(article.articleId, id);
    const second = gates.make();
    const secondCall = begin("POST", answerUrl(id), ANSWER_BODY);
    await reachedOrSettled(second, secondCall);

    first.release();
    await firstCall.promise;
    expect(secondCall.settled(), "the second attempt ended with the first").toBe(false);

    await ageTheLease(article.articleId, id);
    expect(await statusOf(id), "the first attempt's release took the second's protection").toBe(
      "pending",
    );

    second.release();
    await secondCall.promise;
    const stored = (await asTestOwner(() => commentStore.load(SLUG))).find((c) => c.id === id);
    expect(stored?.status, "the live attempt's terminal write landed").toBe("done");
  });
});
