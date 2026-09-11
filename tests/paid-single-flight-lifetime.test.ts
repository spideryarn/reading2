/**
 * **The two pictures that pay for embeddings are still being paid for when the
 * request says they are** — `POST /api/similar/:slug` and
 * `POST /api/projection/:slug`, held open mid-embedding and asked what a
 * syntactic check cannot answer.
 *
 * ## Why this file exists, and why it exists *before* the move it is for
 *
 * `serveAuthenticatedApi`'s `if` chain is being emptied into `AUTH_ROUTES` one
 * contiguous slice at a time
 * (docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md), and
 * `sketch` … `projection` is the next slice up. Two of its six guards spend
 * money, and neither links the request's lifetime to the spending with an
 * `await`. They **return** it, from an inner block:
 *
 *     return withSpendAttribution({ articleSlug: at }, async () => { … });
 *
 * Moved into a row, that becomes a closure `dispatchAuthRoute` awaits — the same
 * lifetime **if** the closure still returns the promise. One that launches it
 * (`void withSpendAttribution(…)`) typechecks, and then the request ends while
 * the embedding is still in flight: the spend collector closes before the call
 * it is counting, the reader's answer is written to a response nobody is
 * waiting on, and a provider failure lands nowhere instead of in the outer
 * error mapping. **Changing only an `await` cannot see this**, because there is
 * none to change; the mutation that can is `return` → `void` (260908f § G).
 *
 * The single-flight half is `INFLIGHT` in src/similar.ts and src/projection.ts:
 * a second reader of a cold article joins the first one's promise rather than
 * buying a second set of embeddings. The request has to stay open **through**
 * that promise's settlement, not merely until it was started — which is the
 * same property as above, asked with two readers so that "only one embedding
 * was bought" is a fact the case can see.
 *
 * **These cases were written and run against the guards while they were still
 * in the chain**, and nothing in them reads the route's source or shape — they go
 * in through `handleApi` by method and path — so the move must need no edit
 * here, and green before and green after is the claim.
 *
 * ## The mutations, watched rather than reasoned
 *
 * Each was applied alone, this file run, and reverted. The results are in the
 * plan that commissioned the file,
 * docs/plans/260911c-paid-single-flight-joins-the-route-table.md § *Stage 1, as
 * built*, rather than here, where they would be the first thing to go stale.
 *
 * | Mutation | What must go red |
 * |---|---|
 * | a guard's `return withSpendAttribution(…)` → `void withSpendAttribution(…)` | *holds the request open …* and *a provider failure …*, for that route |
 * | `if (flying) return flying;` deleted from `similarBlocks` / `projectArticle` | *… and a second reader joins the one being paid for* |
 *
 * **Outside this oracle.** What the embeddings are and what the pictures do
 * with them — `embedAll` is stubbed, so no provider is called and no ledger row
 * is written; tests/similar.test.ts and tests/projection.test.ts hold the
 * arithmetic, tests/embedding-route-failures.test.ts the failure sentences. And
 * the spend collector's own window: no assertion here reads the ledger.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { EmbeddingFailure } from "../src/embeddings.js";
import { loadEnvLocal } from "../src/env.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

/**
 * The stubbed embedding call, and the handshake that makes "still paying" a
 * fact.
 *
 * **One behaviour per call, handed out in order** — a gate to hold at, or a
 * failure to throw. A call that finds nothing queued throws, so a second
 * embedding nobody expected is a loud failure rather than a quiet second gate.
 * `calls` counts every call, which is what makes "one embedding for two
 * readers" something a case can assert.
 *
 * `vi.hoisted` because `vi.mock` is hoisted above this module's statements.
 */
const stub = vi.hoisted(() => {
  function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }
  interface Gate {
    kind: "gate";
    reached: () => Promise<void>;
    arrive: () => void;
    hold: () => Promise<void>;
    release: () => void;
  }
  type Behaviour = Gate | { kind: "fail"; error: () => Error };
  const queue: Behaviour[] = [];
  const gates: Gate[] = [];
  let taken = 0;
  return {
    calls: 0,
    /** Entries into `similarBlocks` / `projectArticle`, passed through untouched. */
    entered: 0,
    /** A new gate, queued for the next embedding call. */
    gate(): Gate {
      const arrived = deferred();
      const released = deferred();
      const gate: Gate = {
        kind: "gate",
        reached: () => arrived.promise,
        arrive: () => arrived.resolve(),
        hold: () => released.promise,
        release: () => released.resolve(),
      };
      queue.push(gate);
      gates.push(gate);
      return gate;
    },
    /** Queue a failure for the next embedding call. */
    fail(error: () => Error): void {
      queue.push({ kind: "fail", error });
    },
    /** Called by the fake: this call's behaviour. */
    take(): Behaviour {
      const next = queue[taken++];
      if (!next) throw new Error("an embedding began that no case queued a behaviour for");
      return next;
    },
    /** Release everything, so a parked call cannot keep a worker alive. */
    releaseAll(): void {
      for (const gate of gates) gate.release();
    },
  };
});

vi.mock("../src/embeddings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/embeddings.js")>()),
  async embedAll(texts: string[]) {
    stub.calls++;
    const next = stub.take();
    if (next.kind === "fail") throw next.error();
    next.arrive();
    await next.hold();
    /* Eight dimensions of something deterministic and not all alike, so the
       projection's principal components and the similarity ranking both have
       real arithmetic to do. The values are not the point. */
    return {
      vectors: texts.map((_t, i) => Array.from({ length: 8 }, (_v, d) => Math.sin(i * (d + 1)) + d / 10)),
      usage: { promptTokens: texts.length, cost: 0 },
    };
  },
}));

/* Pass-throughs that count, so a case can wait until the second reader has
   actually reached the single-flight map instead of guessing with a timer. The
   real functions run, `INFLIGHT` and all. */
vi.mock("../src/similar.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/similar.js")>();
  return {
    ...real,
    similarBlocks: (...args: Parameters<typeof real.similarBlocks>) => {
      stub.entered++;
      return real.similarBlocks(...args);
    },
  };
});
vi.mock("../src/projection.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/projection.js")>();
  return {
    ...real,
    projectArticle: (...args: Parameters<typeof real.projectArticle>) => {
      stub.entered++;
      return real.projectArticle(...args);
    },
  };
});

await pgReady({
  suite: "tests/paid-single-flight-lifetime.test.ts",
  tables: ["spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");

/**
 * A request **started but not waited for**, so a case can look at it in flight
 * — tests/comment-answer-stream-lifetime.test.ts's `begin`, with the status
 * kept, because these two routes answer through `send`.
 */
function begin(
  method: string,
  url: string,
): {
  promise: Promise<void>;
  settled: () => boolean;
  ended: () => boolean;
  status: () => number;
  written: () => string;
} {
  const req = Object.assign(
    (async function* () {
      /* No body: neither route reads one. */
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
  return {
    promise,
    settled: () => settled,
    ended: () => ended,
    status: () => res.statusCode,
    written: () => written,
  };
}

/**
 * Wait for the embedding's checkpoint, and **fail fast if the request answers
 * instead** — a 404 upstream of the embedding would otherwise sit until the
 * timeout and report "timed out" about a routing failure. The trailing
 * `await Promise.resolve()` lets a continuation queued in the same job run
 * before `settled` is read.
 */
async function reachedOrSettled(
  gate: { reached: () => Promise<void> },
  call: { promise: Promise<void>; status: () => number; written: () => string },
): Promise<void> {
  const early = call.promise.then(
    () => {
      /* Also what a guard that launched the work looks like: it falls through
         to the 404, or — in a row — resolves with nothing written. */
      throw new Error(
        `the request settled before the embedding was entered — launched rather than returned? ${call.status()} ${call.written()}`,
      );
    },
    () => {
      throw new Error("the request failed before the embedding was entered");
    },
  );
  early.catch(() => {});
  await Promise.race([gate.reached(), early]);
  await Promise.resolve();
}

/** Poll until `done()`, failing if `call` settles first or it takes too long. */
async function until(
  done: () => boolean,
  call: { settled: () => boolean; status: () => number; written: () => string },
  what: string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!done()) {
    if (call.settled()) throw new Error(`${what}: the request settled first — ${call.status()} ${call.written()}`);
    if (Date.now() > deadline) throw new Error(`${what}: never happened`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const ROUTES = [
  { route: "similar", slug: "test-paid-single-flight-similar" },
  { route: "projection", slug: "test-paid-single-flight-projection" },
] as const;

describe("the paid pictures outlive nothing they should", { timeout: 60_000 }, () => {
  /* One article per route per case: both caches are keyed by slug, and a warm
     answer from an earlier case would be served without an embedding at all. */
  const articles: ScratchArticle[] = [];

  beforeAll(async () => {
    for (const { slug } of ROUTES) {
      /* `TEST_OWNER`, because `acceptAny` authenticates as that reader and every
         article read is owner-scoped — seeded as anybody else, the route 404s. */
      articles.push(await scratchArticleInPg(`${slug}-held`, { ownerId: TEST_OWNER }));
      articles.push(await scratchArticleInPg(`${slug}-fails`, { ownerId: TEST_OWNER }));
    }
  }, 120_000);

  afterAll(async () => {
    stub.releaseAll();
    for (const article of articles) await article.remove();
  });

  describe.each(ROUTES)("POST /api/$route/:slug", ({ route, slug }) => {
    it("holds the request open until the answer is sent, and a second reader joins the one being paid for", async () => {
      const url = `/api/${route}/${slug}-held`;
      const gate = stub.gate();
      const callsBefore = stub.calls;
      const enteredBefore = stub.entered;

      const first = begin("POST", url);
      await reachedOrSettled(gate, first);
      /* The handshake fired, so the embedding is being paid for. Both of these
         are false for a guard that launched the work rather than returning it. */
      expect(first.settled(), "the request answered while the embedding was still in flight").toBe(false);
      expect(first.ended(), "the response was ended mid-embedding").toBe(false);

      /* The second reader, arriving while the first is still paying. It has
         reached the single-flight map once it has entered the function —
         nothing in `similarBlocks` or `projectArticle` awaits before the map is
         consulted. */
      const second = begin("POST", url);
      await until(() => stub.entered === enteredBefore + 2, second, "the second reader reaching the map");
      expect(second.settled(), "the second reader was answered before the first embedding finished").toBe(false);

      gate.release();
      await Promise.all([first.promise, second.promise]);

      expect(first.status(), first.written()).toBe(200);
      expect(second.status(), second.written()).toBe(200);
      expect(stub.calls - callsBefore, "two readers of one cold article bought two embeddings").toBe(1);
      /* The same answer, because it is the same promise. */
      expect(second.written()).toBe(first.written());
      expect(JSON.parse(first.written())).toHaveProperty("blocks");
    });

    it("a provider failure reaches the reader as the route's own answer, not as nothing", async () => {
      /* The half of the lifetime a success cannot show: the throw from
         `embeddingHttpError` has to arrive at `serveApi`'s catch while the
         request is still its to answer. A launched promise rejects into
         nowhere, and the request has already been answered — or not at all. */
      stub.fail(() => new EmbeddingFailure("provider", "socket died"));
      const call = begin("POST", `/api/${route}/${slug}-fails`);
      await call.promise;
      expect(call.ended(), "nothing answered the reader").toBe(true);
      expect(call.status(), call.written()).toBe(502);
    });
  });
});
