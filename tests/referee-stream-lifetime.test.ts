/**
 * **A referee's stream is still running when the request says it is** — the
 * three streaming routes under `/api/referee/`, held open mid-stream and asked
 * two questions a syntactic check cannot answer.
 *
 * ## Why this file exists, and why it exists *before* the refactor it is for
 *
 * `serveAuthenticatedApi`'s `if` chain is being emptied into `AUTH_ROUTES` one
 * contiguous slice at a time
 * (docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md).
 * Referee was the next slice, and the first one whose handlers **stream**. It
 * moved on 2026-09-07; these routes are `AUTH_ROUTES` rows now.
 *
 * A guard in the chain reads `await runX(...); return;` inside a function the
 * caller awaits. A table row reads `handler: async (ctx) => { await runX(...) }`,
 * awaited by `dispatchAuthRoute`. Those are the same lifetime — **if** the
 * closure returns its promise. The defect the move risks is a closure that
 * *launches* the stream and resolves immediately:
 *
 *     handler: async ({ request: { res } }) => {
 *       void withSpendAttribution(..., () => runRefereeCriterion(slug, body, res));
 *     }
 *
 * That typechecks. The request then ends while the model call is still running,
 * the live-run lock is still held, and the store `finish` writes to a response
 * nobody is waiting on. `assertHandlersAwaited` in
 * tests/authenticated-api-route-contract.test.ts is a **syntax** tripwire and
 * would not catch every shape of it — a claim about the *form* of a handler
 * standing in for a claim about its *lifetime*, which is
 * docs/reusable/silent-success.md exactly. GPT Sol required a behavioural test
 * before referee moves, and this is it.
 *
 * **These cases were written and run against the guards while they were still in
 * the chain**, and not one of them was edited when the guards became rows. Green
 * before the move and green after it is the whole point: a test written after
 * the move could only ever describe what the move did.
 *
 * Nothing below reads the routes' source or their shape — it goes in through
 * `handleApi` by method and path — which is why the move needed no edit here,
 * and why the file goes on being the right place to notice a handler that stops
 * being awaited.
 *
 * ## The oracle that did not work, and why it is worth writing down
 *
 * The first draft of this file proved "the lock is still held" by issuing an
 * ordinary `GET` mid-stream and asserting the row came back `pending`.
 *
 * **That assertion cannot fail.** `sweepPending`
 * (src/store/pg-referee-criteria.ts) has two guards and its own comment says
 * each alone is a bug: the live set — what *this* process is streaming — **or**
 * an age cutoff of `CRITERION_ORPHAN_GRACE_MS`, which is 150 seconds. A row
 * begun moments ago is younger than the cutoff, so it is spared by its age
 * whether or not the lock holds it. Deleting `refereeing.delete(key)` would
 * have left the test green.
 *
 * The fix is to make the row **old**, exactly as tests/store-searches-pg.test.ts
 * does at the store level: backdate `attemptStartedAt` past the grace before
 * asking. Then `pending` has only one remaining explanation — the live set —
 * and the mutation that deletes the release turns this file red.
 *
 * Found by GPT Sol reviewing the plan
 * (docs/plans/260907e-referee-joins-the-route-table-review-sol.md, finding 1).
 * It is recorded here rather than only in the plan because the next person to
 * add a case to this file will reach for the same broken oracle.
 *
 * ## What this file does not do
 *
 * Nothing here reaches a model: all three generators are stubbed. It is about
 * plumbing — who awaits whom, and when a key leaves a `Set` — not about what a
 * referee is told. The answers themselves are
 * tests/referee-criteria-run.test.ts and its siblings.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../src/db/client.js";
import { refereeClaims, refereeCriteria } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-referee-stream-lifetime";

/**
 * The three stubbed generators, and the handshake that makes "still running" a
 * fact rather than a hope.
 *
 * **`vi.hoisted` because `vi.mock` is hoisted**: the factories below run before
 * this module's ordinary statements, so anything they close over has to be
 * created up there with them.
 *
 * Each gate is two promises. `arrive()` announces that the generator has been
 * entered and has yielded its first frame; `block()` is where it stops. A case
 * waits for `reached` before it inspects anything — without that it would be
 * asserting "the request has not finished" about a request that had not yet
 * *started*, which passes for the wrong reason (Sol, finding 2).
 */
const gates = vi.hoisted(() => {
  function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }
  function makeGate() {
    let arrived = deferred();
    let released = deferred();
    return {
      /** Awaited by the test: the generator is inside, and blocked. */
      reached: (): Promise<void> => arrived.promise,
      /** Called by the generator. */
      arrive: (): void => arrived.resolve(),
      /** Awaited by the generator. */
      hold: (): Promise<void> => released.promise,
      /** Called by the test to let the stream finish. */
      release: (): void => released.resolve(),
      reset: (): void => {
        arrived = deferred();
        released = deferred();
      },
    };
  }
  return { criterion: makeGate(), claims: makeGate(), mirror: makeGate() };
});

/* Each factory keeps everything else the real module exports — these modules
   carry constants the route reads at import time (`LITERATURE_TIMEOUT_MS` is
   compared against `CRITERION_ORPHAN_GRACE_MS` in a module-scope check that
   *throws*), so a bare object would break the import rather than the test. */
vi.mock("../src/referee-criteria-run.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/referee-criteria-run.js")>()),
  async *runCriterionStream() {
    yield { type: "result", result: { kind: "single", quote: "held off site", blockId: "b" } };
    gates.criterion.arrive();
    await gates.criterion.hold();
    yield { type: "done", outcome: { results: [], model: "stub", dropped: {}, searches: [] } };
  },
}));

vi.mock("../src/referee-claims-run.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/referee-claims-run.js")>()),
  async *runClaimsStream() {
    yield { type: "claim", claim: { id: "c1", text: "a claim", blockId: "b" } };
    gates.claims.arrive();
    await gates.claims.hold();
    yield {
      type: "done",
      outcome: { claims: [], model: "stub", dropped: { truncated: 0 } },
    };
  },
}));

vi.mock("../src/referee-mirror.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/referee-mirror.js")>()),
  async *mirrorStream() {
    yield { type: "delta", text: "half a sentence" };
    gates.mirror.arrive();
    await gates.mirror.hold();
    yield { type: "done", markdown: "done", model: "stub" };
  },
}));

await pgReady({
  suite: "tests/referee-stream-lifetime.test.ts",
  tables: ["spideryarn.referee_criteria", "spideryarn.referee_claims", "spideryarn.revision_blocks"],
});

const { handleApi, CRITERION_ORPHAN_GRACE_MS } = await import("../src/routes.js");
const { refereeCriteriaStore } = await import("../src/store/index.js");
const { CLAIMS_ORPHAN_GRACE_MS } = await import("../src/store/pg-referee-claims.js");

/**
 * A request that is **started but not waited for**, so the test can look at it
 * while it is still in flight.
 *
 * `settled` is set by a continuation attached at the moment the promise is
 * created, so reading it is a question about the original promise rather than a
 * race against a sentinel. The response is the streaming-capable fake that
 * tests/candidates-route.test.ts uses — `sse()` needs `on`, `writeHead` and the
 * two "has the reader gone" properties, and a response without them would throw
 * inside the handler and look like a lifetime failure.
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

/** An ordinary, fully-awaited request — the second question, asked normally. */
async function get(url: string): Promise<Record<string, unknown>> {
  const call = begin("GET", url);
  await call.promise;
  return JSON.parse(call.written() || "{}") as Record<string, unknown>;
}

/**
 * Wait for the generator's checkpoint, and **fail fast if the request answers
 * instead of reaching it**.
 *
 * Waiting on `reached()` alone is right until something upstream of the stream
 * goes wrong — a matcher that stopped matching, a 404, a validation error. Then
 * the checkpoint never fires and the case sits until the suite's 60-second
 * timeout, reporting "timed out" about a routing failure. Racing the request
 * against it turns that into a sentence naming what happened. GPT Sol's stage 1
 * review, P2.
 *
 * The trailing `await Promise.resolve()` closes the one-microtask hole in
 * `settled`: fulfilling a promise *queues* its continuations rather than running
 * them, so a request that finished in the same job as the gate could still read
 * `settled() === false` for one tick. Yielding once lets that continuation run
 * before anything is asserted (same review, P2).
 */
async function reachedOrSettled(
  gate: { reached: () => Promise<void> },
  call: { promise: Promise<void> },
  route: string,
): Promise<void> {
  const early = call.promise.then(
    () => {
      throw new Error(`${route}: the request settled before the stream was entered`);
    },
    () => {
      throw new Error(`${route}: the request failed before the stream was entered`);
    },
  );
  /* Marks `early` handled, so Node does not warn when the gate wins the race.
     `Promise.race` would attach a handler too, but only to whichever settles
     first. */
  early.catch(() => {});
  await Promise.race([gate.reached(), early]);
  await Promise.resolve();
}

/**
 * Make every `pending` criterion on this article older than the grace.
 *
 * The precedent is tests/store-searches-pg.test.ts, which backdates
 * `attemptStartedAt` to reach the same branch. Ten minutes against a
 * 150-second grace, so the margin is not something a slow box can close.
 */
async function ageTheCriteria(articleId: string): Promise<void> {
  await getDb()
    .update(refereeCriteria)
    .set({ attemptStartedAt: new Date(Date.now() - 10 * 60_000) })
    /* **`pending` only**, and the constraint is the reason rather than the
       tidiness: `referee_criteria_attempt_both` requires the attempt id and its
       timestamp to be both set or both null, and `finish` clears the pair. An
       unscoped update therefore stamps a time onto a finished row that has no
       attempt and is refused — which is what happened the first time this ran.
       Aging only the rows a sweep could collect is also what the cases mean. */
    .where(and(eq(refereeCriteria.articleId, articleId), eq(refereeCriteria.status, "pending")));
}

/** The same, for the claims run, whose sweep ages on `createdAt`. */
async function ageTheClaimsRun(articleId: string): Promise<void> {
  await getDb()
    .update(refereeClaims)
    .set({ createdAt: new Date(Date.now() - 10 * 60_000) })
    .where(eq(refereeClaims.articleId, articleId));
}

describe("a referee's stream outlives nothing it should", { timeout: 60_000 }, () => {
  let article: ScratchArticle;

  beforeAll(async () => {
    article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  });

  beforeEach(async () => {
    gates.criterion.reset();
    gates.claims.reset();
    gates.mirror.reset();
    await asTestOwner(async () => {
      for (const row of await refereeCriteriaStore.load(SLUG)) {
        await refereeCriteriaStore.remove(SLUG, row.id);
      }
    });
    await getDb().delete(refereeClaims).where(eq(refereeClaims.articleId, article.articleId));
  });

  afterAll(async () => {
    /* Release every gate before tearing down: a generator still parked on
       `hold()` keeps a request alive, and the worker would sit on it. */
    gates.criterion.release();
    gates.claims.release();
    gates.mirror.release();
    await article?.remove();
  });

  describe("POST /api/referee/criteria/:slug", () => {
    it("holds the request open until the stream is finished, and only then answers", async () => {
      const call = begin("POST", `/api/referee/criteria/${SLUG}`, {
        criterion: "Are the methods reproducible?",
        kind: "single",
      });
      await reachedOrSettled(gates.criterion, call, "POST /api/referee/criteria/:slug");

      /* The handshake has fired, so the handler is genuinely inside the stream.
         Both of these are false for a route that launched and returned. */
      expect(call.settled(), "the request answered while the stream was still running").toBe(false);
      expect(call.ended(), "the response was ended mid-stream").toBe(false);

      gates.criterion.release();
      await call.promise;

      expect(call.ended()).toBe(true);
      expect(call.settled()).toBe(true);
      const rows = await asTestOwner(() => refereeCriteriaStore.load(SLUG));
      expect(rows[0]?.status, "the store finish ran before the request settled").toBe("done");
    });

    it("still holds the live-run lock while the stream is running, however old the row looks", async () => {
      const call = begin("POST", `/api/referee/criteria/${SLUG}`, {
        criterion: "Are the methods reproducible?",
        kind: "single",
      });
      await reachedOrSettled(gates.criterion, call, "POST /api/referee/criteria/:slug");

      /* **The row is now older than the grace**, so the age guard cannot be
         what spares it. Only `keep` — `liveCriteria(slug)`, built from the
         `refereeing` set — is left. Without this line the assertion below
         passes with the lock deleted, which is what the first draft did. */
      await ageTheCriteria(article.articleId);
      const mid = await get(`/api/referee/criteria/${SLUG}`);
      const midRows = mid.criteria as { status: string }[];
      expect(midRows[0]?.status, "an aged row survived only if the lock is held").toBe("pending");

      gates.criterion.release();
      await call.promise;
    });

    it("releases the lock by the time it answers, so the next sweep can collect a stale retry", async () => {
      const first = begin("POST", `/api/referee/criteria/${SLUG}`, {
        criterion: "Are the methods reproducible?",
        kind: "single",
      });
      await reachedOrSettled(gates.criterion, first, "POST /api/referee/criteria/:slug");
      gates.criterion.release();
      await first.promise;

      /* **The same criterion id put back into `pending` by hand**, so the key
         a sweep would have to be spared by is exactly the key the finished run
         held.

         Deliberately not `refereeCriteriaStore.begin(…, done.id)`: whether a
         retry resets the row at all is `withCriterion`'s decision, and routing
         this through it would make the case depend on that policy rather than
         on the lock. Both attempt columns are written together because
         `referee_criteria_attempt_both` requires it. */
      const [done] = await asTestOwner(() => refereeCriteriaStore.load(SLUG));
      if (!done) throw new Error("the first run stored nothing to retry");
      await getDb()
        .update(refereeCriteria)
        .set({
          status: "pending",
          attemptId: randomUUID(),
          attemptStartedAt: new Date(Date.now() - 10 * 60_000),
        })
        .where(
          and(eq(refereeCriteria.articleId, article.articleId), eq(refereeCriteria.id, done.id)),
        );

      const after = await get(`/api/referee/criteria/${SLUG}`);
      const rows = after.criteria as { status: string }[];
      expect(rows[0]?.status, "the key was never released, so the sweep spared it").toBe("error");
    });

    it("propagates a failure raised outside the handler's own catch", async () => {
      /* `runRefereeCriterion` catches a *stream* failure and converts it to an
         `error` row, so a throwing generator proves conversion, not
         propagation (Sol, finding 3). `begin` is upstream of that catch, so a
         rejection there has to travel out through the route. */
      const boom = new Error("the store refused to begin");
      const spy = vi.spyOn(refereeCriteriaStore, "begin").mockRejectedValueOnce(boom);
      try {
        const call = begin("POST", `/api/referee/criteria/${SLUG}`, {
          criterion: "Are the methods reproducible?",
          kind: "single",
        });
        await call.promise;
        /* It answers rather than hanging, and it answers as an error — the
           generic handler's 500, on a response no header was written to. */
        expect(call.ended()).toBe(true);
        expect(call.written()).toContain("error");
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("POST /api/referee/claims/:slug", () => {
    /* Written against the claims store rather than by analogy with criteria:
       its lock, key, store method and sweep are all its own (Sol, finding 4). */
    it("holds the request open until the stream is finished", async () => {
      const call = begin("POST", `/api/referee/claims/${SLUG}`);
      await reachedOrSettled(gates.claims, call, "POST /api/referee/claims/:slug");

      expect(call.settled(), "the request answered while the stream was still running").toBe(false);
      expect(call.ended()).toBe(false);

      gates.claims.release();
      await call.promise;
      expect(call.settled()).toBe(true);
      expect(call.ended()).toBe(true);
    });

    it("still holds its own lock while the stream is running, however old the run looks", async () => {
      const call = begin("POST", `/api/referee/claims/${SLUG}`);
      await reachedOrSettled(gates.claims, call, "POST /api/referee/claims/:slug");

      await ageTheClaimsRun(article.articleId);
      const mid = await get(`/api/referee/claims/${SLUG}`);
      const run = mid.run as { status: string } | null;
      expect(run?.status, "an aged run survived only if `pullingClaims` holds it").toBe("pending");

      gates.claims.release();
      await call.promise;
    });

    it("releases its own lock by the time it answers, so the next sweep can collect a stale run", async () => {
      /* **The gap Sol found in the first version of this file**, and it is the
         same shape as the oracle bug in the draft before that: the two cases
         above both stayed green with `pullingClaims.delete(slug)` deleted,
         because neither of them asks anything after the request has answered.
         Criteria had this case; claims did not, and claims is a separate lock,
         key, sweep and store method rather than an instance of criteria. */
      const call = begin("POST", `/api/referee/claims/${SLUG}`);
      await reachedOrSettled(gates.claims, call, "POST /api/referee/claims/:slug");
      gates.claims.release();
      await call.promise;

      /* There is one claims run per article, so the key is the slug and the row
         is the row — no id to keep in step. Put back to `pending` and aged past
         the grace, it is collectable if and only if the slug has left
         `pullingClaims`. */
      await getDb()
        .update(refereeClaims)
        .set({ status: "pending", createdAt: new Date(Date.now() - 10 * 60_000) })
        .where(eq(refereeClaims.articleId, article.articleId));

      const after = await get(`/api/referee/claims/${SLUG}`);
      const run = after.run as { status: string } | null;
      expect(run?.status, "the slug was never released, so the sweep spared it").toBe("error");
    });
  });

  describe("POST /api/referee/mirror/:slug", () => {
    /* Mirror streams and holds no live-run lock, so lifetime is the whole of
       what there is to check here — and it is a third closure, which can forget
       to return its promise independently of the other two. */
    it("holds the request open until the stream is finished", async () => {
      const call = begin("POST", `/api/referee/mirror/${SLUG}`);
      await reachedOrSettled(gates.mirror, call, "POST /api/referee/mirror/:slug");

      expect(call.settled(), "the request answered while the stream was still running").toBe(false);
      expect(call.ended()).toBe(false);

      gates.mirror.release();
      await call.promise;
      expect(call.settled()).toBe(true);
      expect(call.ended()).toBe(true);
    });
  });

  it("uses the graces this file assumes, so backdating ten minutes is enough", () => {
    /* If either grace is raised past ten minutes, every aged-row case above
       starts passing for the old, broken reason — the row is spared by its age
       and the lock is never the explanation, which is exactly the bug this file
       was rewritten to remove. **Both** are asserted: checking only the criteria
       one left the claims cases free to rot silently, since `claims` sweeps on a
       grace of its own that is derived from a different timeout (Sol's stage 1
       review, P2). */
    expect(CRITERION_ORPHAN_GRACE_MS, "criteria").toBeLessThan(10 * 60_000);
    expect(CLAIMS_ORPHAN_GRACE_MS, "claims").toBeLessThan(10 * 60_000);
  });
});
