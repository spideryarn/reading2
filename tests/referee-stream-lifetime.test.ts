/**
 * **A referee's stream is still running when the request says it is** — the
 * streaming routes under `/api/referee/` (three, and Hidden text's Opus check
 * since plan 261007l), held open mid-stream and asked
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
 * an age cutoff of `CRITERION_ORPHAN_GRACE_MS` — minutes, derived from the literature deadline. A row
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
 * plumbing — who awaits whom, and when a live marker is released — not about what a
 * referee is told. The answers themselves are
 * tests/referee-criteria-run.test.ts and its siblings.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../src/db/client.js";
import { refereeClaims, refereeCriteria, revisionBlocks } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { hashBlocks } from "../src/source-hash.js";
import type { Block } from "../src/types.js";
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
      /**
       * Make room for a **second** run through the same gate while the first is
       * still parked in it, and hand back the first one's release.
       *
       * `release()` reads the variable, so after this it lets the *second* run
       * go; the function returned here closed over the first run's promise.
       */
      handOver: (): (() => void) => {
        const releaseFirst = released.resolve;
        arrived = deferred();
        released = deferred();
        return releaseFirst;
      },
    };
  }
  return {
    criterion: makeGate(),
    claims: makeGate(),
    mirror: makeGate(),
    hidden: makeGate(),
    /** The signal Hidden text's Opus check was handed: `gone`, so leaving stops the paid call. */
    hiddenSignal: [] as unknown[],
    /** The blocks each criterion run was handed, at the model boundary. */
    criterionSaw: [] as unknown[],
  };
});

/* Each factory keeps everything else the real module exports — these modules
   carry constants the route reads at import time (`LITERATURE_TIMEOUT_MS` is
   compared against `CRITERION_ORPHAN_GRACE_MS` in a module-scope check that
   *throws*), so a bare object would break the import rather than the test. */
vi.mock("../src/referee-criteria-run.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/referee-criteria-run.js")>()),
  async *runCriterionStream(request: { blocks: unknown }) {
    gates.criterionSaw.push(request.blocks);
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

/* Hidden text's Opus check (plan 261007l). The scan is stubbed to one flagged
   row, because the route refuses — with a 409 and no stream — a document with
   nothing flagged, and this article's own source may have none. */
vi.mock("../src/referee-hidden-check.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/referee-hidden-check.js")>()),
  async *hiddenCheckStream(request: { signal?: unknown }) {
    gates.hiddenSignal.push(request.signal);
    yield { type: "delta", text: "half an object" };
    gates.hidden.arrive();
    await gates.hidden.hold();
    yield { type: "done", judgments: [], unanswered: 1, notSent: 0, model: "stub" };
  },
}));

vi.mock("../src/source-scan.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/source-scan.js")>()),
  async scanArticleSource() {
    return {
      ms: null,
      scan: {
        examined: "html-source-only",
        findings: [{ kind: "colour-on-background", where: "body > p", text: "Hidden.", detail: "color: #fff" }],
        truncated: 0,
        unreadableSelectors: 0,
        blindSpots: ["approximated-cascade"],
      },
    };
  },
}));

await pgReady({
  suite: "tests/referee-stream-lifetime.test.ts",
  tables: [
    "spideryarn.referee_criteria",
    "spideryarn.referee_claims",
    "spideryarn.referee_hidden_checks",
    "spideryarn.revision_blocks",
  ],
});

const { handleApi, CRITERION_ORPHAN_GRACE_MS } = await import("../src/routes.js");
const { refereeClaimsStore, refereeCriteriaStore, refereeHiddenCheckStore } = await import("../src/store/index.js");
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
  /**
   * `brokenStream`: a response `sse()` cannot open. `res.on` is the first thing
   * it calls, so throwing there is a failure *between* the pending row being
   * written and the stream existing. The route's generic handler then answers
   * 500 on the same fake, which has sent no header.
   */
  opts: { brokenStream?: boolean } = {},
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
    on() {
      if (opts.brokenStream) throw new Error("the socket went away before the stream opened");
    },
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
 * Wrap a store's real `begin` once so that it **commits and then waits** before
 * answering its caller: the request it belongs to registers its live marker
 * late, after a newer request has registered its own. Plan 261005i § C.
 */
function beginAnswersLate<A extends unknown[], R>(store: { begin: (...args: A) => Promise<R> }): {
  committed: Promise<void>;
  answer: () => void;
  restore: () => void;
} {
  const real = store.begin.bind(store);
  let committedNow!: () => void;
  const committed = new Promise<void>((r) => (committedNow = r));
  let answer!: () => void;
  const waiting = new Promise<void>((r) => (answer = r));
  const spy = vi.spyOn(store, "begin").mockImplementationOnce(async (...args: A) => {
    const begun = await real(...args);
    committedNow();
    await waiting;
    return begun;
  });
  return { committed, answer, restore: () => spy.mockRestore() };
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
    gates.hidden.reset();
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
    gates.hidden.release();
    await article?.remove();
  });

  describe("POST /api/referee/criteria/:slug", () => {
    it("keeps carried writable fields on either terminal status", async () => {
      await asTestOwner(async () => {
        const failed = await refereeCriteriaStore.begin(SLUG, "feedfacefeedface", "Methods?", { kind: "single" });
        const failure = {
          status: "error" as const,
          error: "failed",
          model: "failure-model",
          results: [{
            kind: "single" as const,
            blockId: "spya-k3m9qt",
            quote: "methods",
            confidence: 70,
            reasoning: "Names the methods",
          }],
        };
        const error = await refereeCriteriaStore.finish(SLUG, failed.row.id, failure, failed.attempt);
        expect(error?.model).toBe("failure-model");
        expect(error?.results).toEqual(failure.results);

        const begun = await refereeCriteriaStore.begin(SLUG, "feedfacefeedface", "Controls?", { kind: "single" });
        const answer = { status: "done" as const, results: [], error: "carried error" };
        const done = await refereeCriteriaStore.finish(SLUG, begun.row.id, answer, begun.attempt);
        expect(done?.error).toBe("carried error");
      });
    });

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
         `refereeing` map — is left. Without this line the assertion below
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

    it("holds the lock until the answer is stored, not only until the model stops", async () => {
      /* **The gap between the model's last word and `finish`.** The handler
         used to drop its key in the model call's own `finally`, so a page load
         landing in that gap swept a run whose answer was in hand — and `finish`
         then matched no row and the answer was thrown away. Search had the same
         shape until `1714d1aa3`.

         The wrapped `finish` *is* that page load: it ages the row past the
         grace, so only the key can spare it, asks the sweeping `GET`, and then
         does the real write. A key already released means the row is `error`
         by the time the write runs, and the write matches nothing. */
      const real = refereeCriteriaStore.finish.bind(refereeCriteriaStore);
      const spy = vi
        .spyOn(refereeCriteriaStore, "finish")
        .mockImplementationOnce(async (...args: Parameters<typeof real>) => {
          await ageTheCriteria(article.articleId);
          await get(`/api/referee/criteria/${SLUG}`);
          return real(...args);
        });
      try {
        const call = begin("POST", `/api/referee/criteria/${SLUG}`, {
          criterion: "Are the methods reproducible?",
          kind: "single",
        });
        await reachedOrSettled(gates.criterion, call, "POST /api/referee/criteria/:slug");
        gates.criterion.release();
        await call.promise;

        expect(spy, "the wrapped finish never ran, so nothing was tested").toHaveBeenCalledTimes(1);
        const rows = await asTestOwner(() => refereeCriteriaStore.load(SLUG));
        expect(rows[0]?.status, "a sweep between the model and the store buried the answer").toBe(
          "done",
        );
      } finally {
        spy.mockRestore();
      }
    });

    it("a deleted run finishing does not release its replacement's lock", async () => {
      const body = { criterion: "Are the methods reproducible?", kind: "single" };
      const older = begin("POST", `/api/referee/criteria/${SLUG}`, body);
      await reachedOrSettled(gates.criterion, older, "POST /api/referee/criteria/:slug (older)");
      const releaseOlder = gates.criterion.handOver();
      let newer: ReturnType<typeof begin> | undefined;
      try {
        const [row] = await asTestOwner(() => refereeCriteriaStore.load(SLUG));
        if (!row) throw new Error("the older request never wrote its pending row");
        const removed = begin("DELETE", `/api/referee/criteria/${SLUG}/${row.id}`);
        await removed.promise;
        expect(JSON.parse(removed.written()).criteria).toEqual([]);

        // An absent supplied id is reusable, even while its deleted run is still answering.
        newer = begin("POST", `/api/referee/criteria/${SLUG}`, { ...body, id: row.id });
        await reachedOrSettled(gates.criterion, newer, "POST /api/referee/criteria/:slug (newer)");
        const [replacement] = await asTestOwner(() => refereeCriteriaStore.load(SLUG));
        expect(replacement?.id, "the requests did not share a marker key").toBe(row.id);

        releaseOlder();
        await older.promise;
        expect(newer.settled(), "the replacement finished too, so nothing was tested").toBe(false);
        await ageTheCriteria(article.articleId);
        const mid = await get(`/api/referee/criteria/${SLUG}`);
        expect(
          (mid.criteria as { status: string }[])[0]?.status,
          "the deleted run took its replacement's lock with it",
        ).toBe("pending");
      } finally {
        releaseOlder();
        gates.criterion.release();
        await Promise.all([older.promise, newer?.promise]);
      }
    });

    it("stamps the row with the hash of the blocks the model was sent, across a re-extraction", async () => {
      /* Plan 261005i § D, and tests/routes.test.ts has Search's twin. The
         wrapped `begin` commits, a block is rewritten in the table, and only
         then does `begin` answer. */
      const original = article.blocks[0];
      if (!original) throw new Error("the fixture has no block to rewrite");
      const thisBlock = and(
        eq(revisionBlocks.articleId, article.articleId),
        eq(revisionBlocks.blockId, original.id),
      );
      const real = refereeCriteriaStore.begin.bind(refereeCriteriaStore);
      const spy = vi
        .spyOn(refereeCriteriaStore, "begin")
        .mockImplementationOnce(async (...args: Parameters<typeof real>) => {
          const begun = await real(...args);
          await getDb()
            .update(revisionBlocks)
            .set({ text: `${original.text} Re-extracted.` })
            .where(thisBlock);
          return begun;
        });
      gates.criterionSaw.length = 0;
      try {
        const call = begin("POST", `/api/referee/criteria/${SLUG}`, {
          criterion: "Are the methods reproducible?",
          kind: "single",
        });
        await reachedOrSettled(gates.criterion, call, "POST /api/referee/criteria/:slug");
        gates.criterion.release();
        await call.promise;

        expect(spy, "the wrapped begin never ran, so nothing was tested").toHaveBeenCalledTimes(1);
        expect(gates.criterionSaw).toHaveLength(1);
        const sent = gates.criterionSaw[0] as Block[];
        const [stored] = await asTestOwner(() => refereeCriteriaStore.load(SLUG));
        expect(stored?.sourceHash, "the row's hash is not of the blocks the model was sent").toBe(
          hashBlocks(sent),
        );
        /* And the article really did change under the request. */
        expect(await asTestOwner(() => refereeCriteriaStore.sourceHash(SLUG))).not.toBe(
          stored?.sourceHash,
        );
      } finally {
        spy.mockRestore();
        await getDb().update(revisionBlocks).set({ text: original.text }).where(thisBlock);
      }
    });

    it("a deleted run whose begin answers late does not release its replacement's lock", async () => {
      /* The case above, in the other order: the older request's `begin` has
         committed but not yet answered when the replacement registers, so the
         older registers *second*. One holder per key let it take the key over
         and delete it on the way out. */
      const body = { criterion: "Are the methods reproducible?", kind: "single" };
      const late = beginAnswersLate(refereeCriteriaStore);
      const older = begin("POST", `/api/referee/criteria/${SLUG}`, body);
      let newer: ReturnType<typeof begin> | undefined;
      let releaseNewer = (): void => {};
      try {
        await late.committed;
        const [row] = await asTestOwner(() => refereeCriteriaStore.load(SLUG));
        if (!row) throw new Error("the older request never wrote its pending row");
        await begin("DELETE", `/api/referee/criteria/${SLUG}/${row.id}`).promise;

        newer = begin("POST", `/api/referee/criteria/${SLUG}`, { ...body, id: row.id });
        await reachedOrSettled(gates.criterion, newer, "POST /api/referee/criteria/:slug (newer)");
        const [replacement] = await asTestOwner(() => refereeCriteriaStore.load(SLUG));
        expect(replacement?.id, "the requests did not share a marker key").toBe(row.id);
        releaseNewer = gates.criterion.handOver();

        late.answer();
        await reachedOrSettled(gates.criterion, older, "POST /api/referee/criteria/:slug (older)");
        gates.criterion.release();
        await older.promise;
        expect(newer.settled(), "the replacement finished too, so nothing was tested").toBe(false);

        await ageTheCriteria(article.articleId);
        const mid = await get(`/api/referee/criteria/${SLUG}`);
        expect(
          (mid.criteria as { status: string }[])[0]?.status,
          "the late-registered older run took its replacement's lock with it",
        ).toBe("pending");
      } finally {
        late.restore();
        late.answer();
        releaseNewer();
        gates.criterion.release();
        await Promise.all([older.promise, newer?.promise]);
      }
    });

    it("does not keep the lock when the stream could not be opened", async () => {
      /* The other half of the same repair: the key was added *before*
         `sse(res)` and released only inside what came after it, so a response
         that could not be opened left the key in the set for the life of the
         process, and its `pending` row could never be swept. */
      const call = begin(
        "POST",
        `/api/referee/criteria/${SLUG}`,
        { criterion: "Are the methods reproducible?", kind: "single" },
        { brokenStream: true },
      );
      await call.promise;
      expect(call.written(), "the request did not fail, so nothing was tested").toContain("error");

      await ageTheCriteria(article.articleId);
      const after = await get(`/api/referee/criteria/${SLUG}`);
      const rows = after.criteria as { status: string }[];
      expect(rows[0]?.status, "the key was pinned, so the sweep spared a dead run").toBe("error");
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
         `pullingClaims`.

         `claims: []` with it, as `begin` writes: a `pending` row may not carry
         claims (`referee_claims_empty_unless_done`), so this hand-made one has
         to be a row the store could have made. */
      await getDb()
        .update(refereeClaims)
        .set({ status: "pending", claims: [], createdAt: new Date(Date.now() - 10 * 60_000) })
        .where(eq(refereeClaims.articleId, article.articleId));

      const after = await get(`/api/referee/claims/${SLUG}`);
      const run = after.run as { status: string } | null;
      expect(run?.status, "the slug was never released, so the sweep spared it").toBe("error");
    });

    it("holds its lock until the answer is stored, not only until the model stops", async () => {
      /* The criteria case of the same name, against claims' own lock, sweep and
         store method. */
      const real = refereeClaimsStore.finish.bind(refereeClaimsStore);
      const spy = vi
        .spyOn(refereeClaimsStore, "finish")
        .mockImplementationOnce(async (...args: Parameters<typeof real>) => {
          await ageTheClaimsRun(article.articleId);
          await get(`/api/referee/claims/${SLUG}`);
          return real(...args);
        });
      try {
        const call = begin("POST", `/api/referee/claims/${SLUG}`);
        await reachedOrSettled(gates.claims, call, "POST /api/referee/claims/:slug");
        gates.claims.release();
        await call.promise;

        expect(spy, "the wrapped finish never ran, so nothing was tested").toHaveBeenCalledTimes(1);
        const run = await asTestOwner(() => refereeClaimsStore.load(SLUG));
        expect(run?.status, "a sweep between the model and the store buried the answer").toBe(
          "done",
        );
      } finally {
        spy.mockRestore();
      }
    });

    it("an older run finishing does not release the newer run's lock", async () => {
      /* **Two tabs, one article, one key.** The key is the slug, so both runs
         hold the same one, and with a `Set` the first to finish deleted it out
         from under the second. Each request now releases only its own hold on
         the key — src/live-keys.ts, plans 261002h and 261005i § C. */
      const older = begin("POST", `/api/referee/claims/${SLUG}`);
      await reachedOrSettled(gates.claims, older, "POST /api/referee/claims/:slug (older)");
      const releaseOlder = gates.claims.handOver();
      const newer = begin("POST", `/api/referee/claims/${SLUG}`);
      await reachedOrSettled(gates.claims, newer, "POST /api/referee/claims/:slug (newer)");

      releaseOlder();
      await older.promise;
      expect(newer.settled(), "the newer run finished too, so nothing was tested").toBe(false);

      await ageTheClaimsRun(article.articleId);
      const mid = await get(`/api/referee/claims/${SLUG}`);
      const run = mid.run as { status: string } | null;
      expect(run?.status, "the older run took the newer run's lock with it").toBe("pending");

      gates.claims.release();
      await newer.promise;
    });

    it("an older run whose begin answers late does not release the newer run's lock", async () => {
      /* The case above with the registrations the other way round: the older
         run's `begin` commits, the newer run begins and registers, and only
         then does the older's `begin` answer. */
      const late = beginAnswersLate(refereeClaimsStore);
      const older = begin("POST", `/api/referee/claims/${SLUG}`);
      let newer: ReturnType<typeof begin> | undefined;
      let releaseNewer = (): void => {};
      try {
        await late.committed;
        newer = begin("POST", `/api/referee/claims/${SLUG}`);
        await reachedOrSettled(gates.claims, newer, "POST /api/referee/claims/:slug (newer)");
        releaseNewer = gates.claims.handOver();

        late.answer();
        await reachedOrSettled(gates.claims, older, "POST /api/referee/claims/:slug (older)");
        gates.claims.release();
        await older.promise;
        expect(newer.settled(), "the newer run finished too, so nothing was tested").toBe(false);

        await ageTheClaimsRun(article.articleId);
        const mid = await get(`/api/referee/claims/${SLUG}`);
        const run = mid.run as { status: string } | null;
        expect(run?.status, "the late-registered older run took the newer run's lock with it").toBe(
          "pending",
        );
      } finally {
        late.restore();
        late.answer();
        releaseNewer();
        gates.claims.release();
        await Promise.all([older.promise, newer?.promise]);
      }
    });

    it("does not keep its lock when the stream could not be opened", async () => {
      const call = begin("POST", `/api/referee/claims/${SLUG}`, undefined, { brokenStream: true });
      await call.promise;
      expect(call.written(), "the request did not fail, so nothing was tested").toContain("error");

      await ageTheClaimsRun(article.articleId);
      const after = await get(`/api/referee/claims/${SLUG}`);
      const run = after.run as { status: string } | null;
      expect(run?.status, "the slug was pinned, so the sweep spared a dead run").toBe("error");
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

  describe("POST /api/referee/hidden-check/:slug", () => {
    /* Mirror's shape: no lock, so lifetime is what there is to check — a fourth
       closure that can forget to return its promise. Since 2026-10-09 the
       answer is kept (plan 261009a), so the paid call is **not** handed `gone`:
       it runs to the end and is saved for the referee's next visit. */
    it("holds the request open until the stream is finished, runs on without the reader's signal, and saves", async () => {
      const call = begin("POST", `/api/referee/hidden-check/${SLUG}`);
      await reachedOrSettled(gates.hidden, call, "POST /api/referee/hidden-check/:slug");

      expect(call.settled(), "the request answered while the stream was still running").toBe(false);
      expect(call.ended()).toBe(false);
      expect(gates.hiddenSignal.at(-1)).toBeUndefined();

      gates.hidden.release();
      await call.promise;
      expect(call.settled()).toBe(true);
      expect(call.ended()).toBe(true);
      expect(call.written()).toContain("event: done");
      /* Saved: the frame carries the stored check's date and no `saved: false`. */
      expect(call.written()).toContain('"checkedAt"');
      expect(call.written()).not.toContain('"saved":false');
    });

    it("does not send done until the answer is saved", async () => {
      const real = refereeHiddenCheckStore.save.bind(refereeHiddenCheckStore);
      let reachedSave!: () => void;
      const saving = new Promise<void>((resolve) => {
        reachedSave = resolve;
      });
      let releaseSave!: () => void;
      const held = new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      const save = vi.spyOn(refereeHiddenCheckStore, "save").mockImplementationOnce(async (...args) => {
        reachedSave();
        await held;
        return real(...args);
      });

      try {
        const call = begin("POST", `/api/referee/hidden-check/${SLUG}`);
        await reachedOrSettled(gates.hidden, call, "POST /api/referee/hidden-check/:slug");
        gates.hidden.release();
        await saving;
        expect(call.written()).not.toContain("event: done");
        expect(call.settled()).toBe(false);

        releaseSave();
        await call.promise;
        expect(call.written()).toContain("event: done");
      } finally {
        releaseSave?.();
        save.mockRestore();
      }
    });

    it("still sends the paid answer as not saved when keeping it fails", async () => {
      const saveError = "a save failure containing words that must not reach the wire";
      const save = vi.spyOn(refereeHiddenCheckStore, "save").mockRejectedValueOnce(new Error(saveError));

      try {
        const call = begin("POST", `/api/referee/hidden-check/${SLUG}`);
        await reachedOrSettled(gates.hidden, call, "POST /api/referee/hidden-check/:slug");
        gates.hidden.release();
        await call.promise;

        expect(call.written()).toContain("event: done");
        expect(call.written()).toContain('"saved":false');
        expect(call.written()).not.toContain("event: error");
        expect(call.written()).not.toContain(saveError);
      } finally {
        save.mockRestore();
      }
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
