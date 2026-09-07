/**
 * **A streaming, lock-holding route's request lifetime** — written against
 * `POST /api/referee/criteria/:slug` **while that guard is still in the
 * if-chain of `serveAuthenticatedApi`**, and green there before anything moves.
 *
 * ## Why this file exists, and why it had to be written first
 *
 * `docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md` is
 * moving the 81 endpoint guards out of that chain and into an ordered table of
 * closures, a slice at a time. The check that guarded the first two slices is
 * `assertHandlersAwaited` in `tests/authenticated-api-route-contract.test.ts`,
 * which reads `dispatchAuthRoute` and refuses an un-awaited `.handler(…)`. GPT
 * Sol named its limit twice, and the second time named this subject:
 *
 * > `assertHandlersAwaited` is a useful tripwire, not behavioural proof. It
 * > correctly catches removal of either direct `await` in `dispatchAuthRoute`,
 * > so it is adequate for billing. But it would still pass if a moved closure
 * > launched its stream without returning it, swallowed an error, or released
 * > its lock early.
 * >
 * > — GPT Sol, stage 3a review, P2-LIFETIME-BEHAVIOUR
 *
 * A claim about *shape* standing in for a claim about *lifetime* —
 * docs/reusable/silent-success.md. Referee is the next slice up and it is the
 * first one where the difference is observable: `POST criteria` calls
 * `runRefereeCriterion`, which opens SSE **and** holds the module-scope
 * `refereeing` lock across the whole model call.
 *
 * **The order is the point.** Stage 3b's order test was written in the same
 * commit as the arrangement it approves, so it would equally have blessed a
 * wrong one — a regression pin, not evidence. This file is committed and
 * watched green while the guard is still an `if` in the chain, so that when the
 * guard becomes a table row the oracle predates the move. **If a later stage
 * has to edit this file to make its move pass, that is a finding, not a
 * chore.**
 *
 * ## The five things it proves, in Sol's order
 *
 * 1. Enter through `handleApi` with `runCriterionStream` paused after the
 *    pending row and the SSE `begin` frame.
 * 2. The `handleApi` promise is unsettled and the response has not ended.
 * 3. The corresponding GET's sweep leaves the row `pending`, which is how a
 *    caller can see that `refereeing` is still held.
 * 4. Released, the run produces the terminal frame, the stored answer, the
 *    response end — and only then does `handleApi` resolve.
 * 5. A handler whose work rejects asynchronously propagates that rejection
 *    rather than swallowing it.
 *
 * ### Step 3 needs no reach into module scope, and it needs one arrangement
 *
 * `refereeing` is a `Set<string>` at module scope in `src/routes.ts` with no
 * exported reader, and exporting one for a test would be pinning the
 * implementation rather than the behaviour. It does not need one: the lock's
 * only externally visible job is to stop `sweepCriteria` burying a row this
 * process is still running (`keep: liveCriteria(slug)`), so the GET's answer
 * *is* the lock, read the way the panel reads it.
 *
 * **But a fresh row is spared for a second reason** — `sweepPending` also
 * spares anything younger than `CRITERION_ORPHAN_GRACE_MS`, which is 150
 * seconds. A test that just issued the GET would pass with the lock deleted
 * altogether. So while the stream is paused this file backdates the row's
 * `attempt_started_at` past the grace window, which leaves the lock as the only
 * thing standing between that row and the sweep. The same row is put back to
 * `pending` and backdated again *after* the request resolves, and then the same
 * GET buries it — one arrangement, two opposite answers, and the only
 * difference between them is whether the request is still in flight.
 *
 * ### "Paused" is a deferred, never a delay
 *
 * The mocked `runCriterionStream` opens one gate when it is entered and awaits
 * another before it yields. So "the promise is still pending" is a fact about a
 * promise nothing has resolved, not about how fast this box is today — load
 * here is routinely over 20, and a `setTimeout` version of this test would
 * flake into uselessness and then be deleted by somebody who was right to
 * delete it. The event-loop flush before the assertion buys honesty, not
 * correctness: the handler could not proceed however many turns it were given.
 *
 * ## The mutations, which are the only evidence this file is worth its lines
 *
 * Red-first does not apply — the production code is already correct, so there
 * was nothing to watch go red first. Each of Sol's three named failures was
 * introduced in `src/routes.ts`, watched red, and reverted by editing the text
 * back. Run 2026-09-07, this file alone.
 *
 * 1. **`refereeing.delete(key)` added immediately after `refereeing.add(key)`**
 *    in `runRefereeCriterion`, so the lock is released before the stream
 *    completes rather than in the `finally` after it. *1 failed | 1 passed*,
 *    and it failed at the paused GET: *the sweep spares a run this process is
 *    still on: expected 'error' to be 'pending'*. Exactly the failure
 *    `assertHandlersAwaited` cannot see — the syntax it reads did not change.
 * 2. **The criteria POST arm's `await` dropped** (`void withSpendAttribution(…
 *    )`), so the arm launches the stream and returns. *2 failed*: the lifetime
 *    case at *the request is still in flight: expected 'resolved' to be
 *    'pending'*, and the rejection case at *the rejection reached serveApi's
 *    catch: expected +0 to be 500*, because nothing was left to propagate to.
 *    Vitest also reported an unhandled rejection, which is a *consequence* of
 *    the mutation rather than the assertion — the two failures above are the
 *    evidence.
 * 3. **The arm's rejection swallowed** — `await withSpendAttribution(…).catch(
 *    () => {})`. *1 failed | 1 passed*: § *propagates a rejection*, *expected
 *    +0 to be 500*. The response is never written at all, which is what a
 *    swallowed rejection looks like from outside. The first case stayed green,
 *    correctly: nothing in it rejects, so only the case written for this can
 *    see it — which is why step 5 is a case of its own rather than an
 *    assertion inside the first.
 *
 * **What mutation 3 could and could not be pointed at.** `runRefereeCriterion`
 * catches the stream's own rejection on purpose — a model failure is a stored
 * `error` and a `done` frame, not an HTTP error, because the headers are long
 * gone by then. So the only rejection the *arm* can propagate is one raised
 * before `sse(res)`, and the case uses the earliest of those: the store's
 * `begin`, made to reject after a turn of the event loop so the rejection is
 * asynchronous rather than a synchronous throw. That is the "deferred handler"
 * half of Sol's finding, and it is the shape a moved closure would break.
 *
 * ## What it does not cover
 *
 * The Claims POST (`pullingClaims`) and the Mirror POST (streams, no lock) are
 * not exercised here. Criteria is the guard the reviews named and the first one
 * in the slice; a file per streaming guard would restate this arrangement three
 * times without asking a new question of it.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { refereeCriteria } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { CRITERION_SWEPT } from "../src/referee-criteria-store.js";
import type { RefereeResult } from "../src/referee-criteria.js";
import { CRITERION_ORPHAN_GRACE_MS } from "../src/routes.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

/**
 * The two gates the mocked stream sits between, and the answer it eventually
 * gives.
 *
 * `vi.hoisted` because `vi.mock`'s factory is lifted above every import, so a
 * plain `const` would be in its temporal dead zone if anything imported the
 * mocked module earlier than this file expects it to.
 */
const control = vi.hoisted(() => {
  const gate = (): { promise: Promise<void>; open: () => void } => {
    let open: () => void = () => {};
    const promise = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { promise, open };
  };
  return {
    gate,
    /** Opened by the generator when it is entered — i.e. `begin` has been sent. */
    entered: gate(),
    /** Opened by the test. Until then the request cannot make progress. */
    release: gate(),
    /** Set in `beforeAll`, once the fixture's block ids are known. */
    result: null as RefereeResult | null,
  };
});

/**
 * The model call, replaced by a generator that stops where the test says.
 *
 * `importActual` and spread rather than a bare object, for the reason
 * tests/referee-routes-postgres.test.ts gives: `src/routes.ts` imports
 * `LITERATURE_TIMEOUT_MS` from this module and asserts against it at module
 * scope, so a replacement that dropped it would fail the import graph before a
 * case ran.
 */
vi.mock("../src/referee-criteria-run.js", async () => ({
  ...(await vi.importActual<typeof import("../src/referee-criteria-run.js")>(
    "../src/referee-criteria-run.js",
  )),
  runCriterionStream: async function* () {
    /* The body of an async generator runs on the first `next()`, which is the
       `for await` inside `runRefereeCriterion` — so by the time this line runs,
       the pending row is written, `refereeing` holds the key, and the `begin`
       frame has gone out. That is Sol's step 1, and it is bought by where the
       generator is entered rather than by any delay. */
    control.entered.open();
    await control.release.promise;
    yield {
      type: "done" as const,
      outcome: {
        results: control.result ? [control.result] : [],
        model: "a-test-model",
        dropped: { malformed: 0, unknownIds: 0, unquoted: 0, uncited: 0, clampedValence: 0 },
      },
    };
  },
}));

const SLUG = "test-streaming-route-request-lifetime";

await pgReady({
  suite: "tests/streaming-route-request-lifetime.test.ts",
  tables: ["spideryarn.referee_criteria", "spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");
const { refereeCriteriaStore } = await import("../src/store/index.js");

const POST_URL = `/api/referee/criteria/${SLUG}`;

/** A request in flight, and everything about it a test may ask. */
interface Live {
  /** The `handleApi` promise itself. Await it to let the request finish. */
  readonly done: Promise<void>;
  /** Settled or not — read, never awaited, so the question can be asked early. */
  settled(): "pending" | "resolved" | "rejected";
  status(): number;
  text(): string;
  ended(): boolean;
  /**
   * What happened to the response, in the order it happened, plus `resolved`
   * once `handleApi` settles. This is how step 4's *"and only then"* is
   * checked: a set of facts cannot say which came last.
   */
  readonly order: readonly string[];
}

/**
 * Drive `handleApi` with a fake request/response pair and **do not await it**.
 *
 * The response is the streaming-capable one from
 * tests/referee-routes-postgres.test.ts, plus `writableEnded`, which `sse`'s
 * `alive()` reads: without it the heartbeat would go on writing pings into a
 * finished response for the rest of the run.
 */
function start(method: string, url: string, body?: unknown): Live {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;

  let status = 0;
  let text = "";
  let ended = false;
  const order: string[] = [];
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    get writableEnded() {
      return ended;
    },
    destroyed: false,
    setHeader: () => {},
    writeHead: (code: number) => {
      status = code;
      order.push("headers");
      return res;
    },
    write: (chunk: unknown) => {
      const raw = String(chunk);
      text += raw;
      const named = /^event: (\w+)/.exec(raw);
      if (named) order.push(`frame:${named[1]}`);
      return true;
    },
    end: (chunk?: unknown) => {
      if (chunk !== undefined) text += String(chunk);
      ended = true;
      order.push("end");
    },
    on: () => res,
    once: () => res,
    removeListener: () => res,
    emit: () => false,
    flushHeaders: () => {},
  } as unknown as ServerResponse;

  let settled: "pending" | "resolved" | "rejected" = "pending";
  const done = handleApi(req, res, acceptAny).then(
    () => {
      settled = "resolved";
      order.push("resolved");
    },
    (err: unknown) => {
      settled = "rejected";
      order.push("rejected");
      throw err;
    },
  );
  /* So that a rejection this test is about to assert on cannot be reported as
     an unhandled one first. The `done` the caller gets still rejects. */
  done.catch(() => {});
  return {
    done,
    settled: () => settled,
    status: () => status,
    text: () => text,
    ended: () => ended,
    order,
  };
}

/** The same thing, awaited — for the requests that are not the subject. */
async function call(method: string, url: string, body?: unknown): Promise<Live> {
  const live = start(method, url, body);
  await live.done;
  return live;
}

/** The JSON body of a request that answered with one. */
function json(live: Live): Record<string, unknown> {
  return live.text() ? (JSON.parse(live.text()) as Record<string, unknown>) : {};
}

/**
 * Let every continuation that *could* run, run.
 *
 * Not a wait for something to happen — nothing this test asserts depends on how
 * long this takes. It exists so that "still pending" is not merely "not pending
 * yet on this tick".
 */
async function settleTurns(times = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/**
 * Make one row look like a criterion an earlier process abandoned: `pending`,
 * and older than the sweep's grace window.
 *
 * Straight SQL rather than a store call, because no store method backdates a
 * lease — the same move tests/store-searches-pg.test.ts makes for the same
 * reason. Scoped by `(article_id, id)`, which is the table's key.
 */
async function ageIntoTheSweepsReach(articleId: string, id: string): Promise<void> {
  const db = getDb();
  const where = and(eq(refereeCriteria.articleId, articleId), eq(refereeCriteria.id, id));
  /* **The attempt this row already has, kept.** Two reasons, one per call site.
     Mid-flight, overwriting it would break `finish`'s fence and the request
     would end with no `done` frame — a green-looking test whose subject had
     quietly stopped happening. Afterwards there is none, because `finish`
     clears it, and `referee_criteria_attempt_both` refuses a start time without
     an id — so the arrangement supplies one rather than the two calls being
     different arrangements. */
  const [current] = await db
    .select({ attemptId: refereeCriteria.attemptId })
    .from(refereeCriteria)
    .where(where);
  await db
    .update(refereeCriteria)
    .set({
      status: "pending",
      error: null,
      attemptId: current?.attemptId ?? "0123456789abcdef",
      attemptStartedAt: new Date(Date.now() - CRITERION_ORPHAN_GRACE_MS - 60_000),
    })
    .where(where);
}

describe("a streaming route's request lifetime", { timeout: 60_000 }, () => {
  let article: ScratchArticle;

  beforeAll(async () => {
    /* `ownerId: TEST_OWNER` and not the default: a request authenticated by
       ./helpers/authed.ts runs as `TEST_SUB`, and the Postgres reader filters
       every article by owner, so an article seeded as anybody else answers 404
       to everything — ./helpers/scratch-article.ts § `ScratchOptions.ownerId`. */
    article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
    const block = article.blocks.find((b) => b.text.length > 40);
    if (!block) throw new Error("the fixture has no block long enough to quote");
    control.result = {
      kind: "single",
      blockId: block.id,
      quote: block.text.slice(0, 20),
      start: 0,
      confidence: 80,
      reasoning: "bears on the criterion",
    };
  });

  afterAll(async () => {
    /* If a case failed before releasing, the request would otherwise hold a
       connection open past the teardown and the failure would arrive as a
       timeout somewhere else. */
    control.release.open();
    await article?.remove();
    await closeDb();
  });

  it("holds its lock, its response and its caller's promise for as long as the stream is open", async () => {
    const live = start("POST", POST_URL, {
      criterion: "Does the paper say who held the randomisation sequence?",
      kind: "single",
    });

    /* ---------------------------------------------------------- step 1 -- */
    await control.entered.promise;
    await settleTurns();

    /* ---------------------------------------------------------- step 2 -- */
    expect(live.settled(), "the request is still in flight").toBe("pending");
    expect(live.ended(), "nothing has ended the response").toBe(false);
    expect(live.order).toContain("frame:begin");
    expect(live.order).not.toContain("frame:done");

    const pending = await asTestOwner(() => refereeCriteriaStore.load(SLUG));
    expect(pending).toHaveLength(1);
    const row = pending[0];
    if (!row) throw new Error("the POST wrote no pending row");
    expect(row.status).toBe("pending");

    /* ---------------------------------------------------------- step 3 -- */
    /* Backdated first, or the sweep would spare this row for its age and the
       assertion below would pass with `refereeing` deleted outright. */
    await ageIntoTheSweepsReach(article.articleId, row.id);
    const whileRunning = await call("GET", POST_URL);
    expect(whileRunning.status()).toBe(200);
    const spared = (json(whileRunning).criteria as { id: string; status: string }[])[0];
    expect(spared?.id).toBe(row.id);
    expect(spared?.status, "the sweep spares a run this process is still on").toBe("pending");

    /* The GET went to the database and back, so a great many turns of the event
       loop have passed since the assertion above. The POST is still where it
       was left, because a promise nobody resolved cannot resolve. */
    expect(live.settled(), "the POST is still in flight after the GET").toBe("pending");
    expect(live.ended()).toBe(false);

    /* ---------------------------------------------------------- step 4 -- */
    control.release.open();
    await live.done;

    expect(live.order.filter((o) => o !== "headers" && !o.startsWith("frame:begin"))).toEqual([
      "frame:done",
      "end",
      "resolved",
    ]);
    expect(live.text()).toContain("event: done");
    expect(live.ended()).toBe(true);

    /* The stored answer. It is also the reason the ordering above is enough to
       say `finish` landed before the response ended: the `done` frame carries
       what `refereeCriteriaStore.finish` returned, so a frame that was written
       is a write that had already happened. */
    const stored = await asTestOwner(() => refereeCriteriaStore.load(SLUG));
    expect(stored[0]?.status).toBe("done");
    expect(stored[0]?.results).toHaveLength(1);

    /* The lock is gone, asked as the same question in the same words: put the
       same row back the way it was during the pause, and this time the sweep
       takes it. */
    await ageIntoTheSweepsReach(article.articleId, row.id);
    const afterwards = await call("GET", POST_URL);
    const swept = (json(afterwards).criteria as { id: string; status: string; error?: string }[])[0];
    expect(swept?.id).toBe(row.id);
    expect(swept?.status, "the lock was released, so the sweep may bury the row").toBe("error");
    expect(swept?.error).toBe(CRITERION_SWEPT);
  });

  it("propagates a rejection raised after a turn of the event loop, rather than swallowing it", async () => {
    /* Step 5, and the deferred-handler half of the finding. `begin` is the
       earliest thing in `runRefereeCriterion` that can reject, and the only
       class of rejection the *arm* can propagate at all: everything from
       `loadArticle` onwards is caught on purpose, because by then the SSE
       headers have gone out and a model failure has to be a stored `error`
       rather than an HTTP one. The failure is asynchronous rather than a
       synchronous throw, which is the shape a moved closure would drop. */
    const spy = vi.spyOn(refereeCriteriaStore, "begin").mockImplementation(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      throw new Error("the store refused this criterion [lifetime-test]");
    });
    try {
      const live = await call("POST", POST_URL, {
        criterion: "Does the paper say who held the randomisation sequence?",
        kind: "single",
      });
      expect(live.status(), "the rejection reached serveApi's catch").toBe(500);
      expect(live.ended(), "and something answered the reader").toBe(true);
    } finally {
      spy.mockRestore();
    }
    /* Nothing was written, so the next case — and the sweep — see an empty
       paper. Asserted rather than assumed: a `begin` that got half way would
       leave a row this file would then attribute to something else. */
    expect(await asTestOwner(() => refereeCriteriaStore.load(SLUG))).toHaveLength(1);
  });
});
