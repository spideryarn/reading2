/**
 * **A quiz mark is still being written when the request says it is** —
 * `POST /api/quiz/:slug/mark`, held open mid-stream.
 *
 * ## Why this file exists, and why it exists *before* the move it is for
 *
 * `serveAuthenticatedApi`'s `if` chain is being emptied into `AUTH_ROUTES` one
 * contiguous slice at a time
 * (docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md), and
 * the last guard in the chain streams:
 *
 *     const markBody = await readBody(req);
 *     await withSpendAttribution({ articleSlug: at }, () => markOneAnswer(at, markBody, res));
 *
 * Moved into a row, that becomes a closure `dispatchAuthRoute` awaits — the same
 * lifetime **if** the closure still awaits `markOneAnswer`. One that launches
 * it typechecks, and then the request settles while the model is still
 * marking, the spend collector closes before the call it is counting, and a
 * failure after the headers lands nowhere. tests/quiz-mark-route.test.ts pins
 * the refusals, which all happen before a header and so pass under a launched
 * stream too.
 *
 * **These cases were written and run against the guard while it was still in
 * the chain**, and nothing in them reads the route's source or shape — they go
 * in through `handleApi` by method and path — so the move must need no edit
 * here, and green before and green after is the claim. Harness from
 * tests/link-summary-stream-lifetime.test.ts; the seeded quiz from
 * tests/quiz-mark-route.test.ts.
 *
 * ## The mutations, watched rather than reasoned
 *
 * Each applied to src/routes.ts alone, this file run, and reverted. The results
 * are in the plan that moves this guard,
 * docs/plans/260911d-close-the-route-transition.md, rather than here.
 *
 * | Mutation | What must go red |
 * |---|---|
 * | the guard's `await withSpendAttribution(` → `void withSpendAttribution(` | both cases, at the handshake |
 * | `frame("error", …)` deleted from `markOneAnswer`'s `catch` | *a mark that fails mid-answer …* |
 *
 * **Outside this oracle.** What the model is told, the verdict and the
 * reader-leaving abort — `markAnswerStream` is stubbed, so no model is called
 * and no ledger row is written; tests/quiz-mark.test.ts and
 * tests/quiz-mark-route.test.ts hold those. The spend collector's own window:
 * no assertion here reads the ledger.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { loadEnvLocal } from "../src/env.js";
import { buildQuiz, inputFingerprint } from "../src/quiz.js";
import type { Block, Quiz, Tree } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-quiz-mark-stream-lifetime";

/**
 * The stubbed mark, one gate per call, handed out in order — the
 * comment-answer oracle's harness. A gate made with `fail` throws where the
 * other would finish, after the first delta has been written.
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
    fail: boolean;
    reached: () => Promise<void>;
    arrive: () => void;
    hold: () => Promise<void>;
    release: () => void;
  }
  const queue: Gate[] = [];
  let taken = 0;
  return {
    make(opts: { fail?: boolean } = {}): Gate {
      const arrived = deferred();
      const released = deferred();
      const gate: Gate = {
        fail: opts.fail ?? false,
        reached: () => arrived.promise,
        arrive: () => arrived.resolve(),
        hold: () => released.promise,
        release: () => released.resolve(),
      };
      queue.push(gate);
      return gate;
    },
    take(): Gate {
      const gate = queue[taken++];
      if (!gate) throw new Error("a mark began that no case made a gate for");
      return gate;
    },
    releaseAll(): void {
      for (const gate of queue) gate.release();
    },
  };
});

/* Only the stream is replaced; everything else the module exports is kept. */
vi.mock("../src/quiz-mark.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/quiz-mark.js")>()),
  async *markAnswerStream() {
    const gate = gates.take();
    yield { type: "delta", text: "Half a mark " };
    gate.arrive();
    await gate.hold();
    if (gate.fail) throw new Error("the provider went away mid-mark");
    yield { type: "delta", text: "and the rest." };
    yield { type: "done", reply: "Half a mark and the rest.", model: "stub" };
  },
}));

await pgReady({
  suite: "tests/quiz-mark-stream-lifetime.test.ts",
  tables: ["spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");

/**
 * A real quiz over the article's real blocks, built by the real `buildQuiz` and
 * written into the clone — tests/quiz-mark-route.test.ts's `quizInto`, which
 * says why a hand-written one would make every case a 409 for the wrong reason.
 */
async function quizInto(dir: string): Promise<Quiz> {
  const { blocks } = JSON.parse(await readFile(path.join(dir, "blocks.json"), "utf-8")) as {
    blocks: Block[];
  };
  const tree = JSON.parse(await readFile(path.join(dir, "tree.json"), "utf-8")) as Tree;
  const meta = JSON.parse(await readFile(path.join(dir, "meta.json"), "utf-8"));
  const block = blocks.find((b) => b.text.length > 120);
  if (!block) throw new Error("the fixture has no block long enough to quote");
  const quiz = buildQuiz(
    {
      questions: [
        {
          question: "What does the piece say in that passage?",
          referenceAnswer: "It says the quoted thing. Then it moves on.",
          band: "easy",
          value: 4,
          evidence: [{ blockId: block.id, quote: block.text.slice(0, 60) }],
        },
      ],
    },
    {
      slug: path.basename(dir),
      blocks,
      sourceHash: inputFingerprint(blocks, tree, meta),
      elapsedMs: 1,
      dropped: {
        unknownIds: 0,
        unquoted: 0,
        truncated: 0,
        overCap: 0,
        malformed: 0,
        duplicate: 0,
        unanchored: 0,
      },
    },
  );
  await writeFile(path.join(dir, "quiz.json"), JSON.stringify(quiz, null, 2));
  return quiz;
}

/**
 * A request started but not waited for, plus **what the response looked like
 * at the moment the request settled** — tests/glossary-stream-lifetime.test.ts's
 * `begin`, for its reason.
 */
function begin(body: unknown): {
  promise: Promise<void>;
  settled: () => boolean;
  ended: () => boolean;
  written: () => string;
  atSettle: () => { ended: boolean; written: string } | undefined;
} {
  const payload = [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method: "POST", url: `/api/quiz/${SLUG}/mark`, headers: AUTHED_HEADERS },
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
  let snapshot: { ended: boolean; written: string } | undefined;
  const promise = handleApi(req, res, acceptAny).then(
    () => {
      settled = true;
      snapshot = { ended, written };
    },
    (err: unknown) => {
      settled = true;
      snapshot = { ended, written };
      throw err;
    },
  );
  return {
    promise,
    settled: () => settled,
    ended: () => ended,
    written: () => written,
    atSettle: () => snapshot,
  };
}

/** Wait for the stream's checkpoint, failing fast if the request answers instead. */
async function reachedOrSettled(
  gate: { reached: () => Promise<void> },
  call: { promise: Promise<void>; written: () => string },
): Promise<void> {
  const early = call.promise.then(
    () => {
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

/** The frames a stream wrote other than `delta`, by name, in order. */
const terminals = (written: string): string[] =>
  [...written.matchAll(/^event: (\w+)$/gm)]
    .map((m) => m[1] ?? "")
    .filter((name) => name !== "delta");

let article: ScratchArticle | undefined;
let quiz: Quiz | undefined;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  /* `TEST_OWNER`, because `acceptAny` authenticates as that reader and the
     Postgres reader filters every article by owner. */
  article = await scratchArticleInPg(SLUG, {
    ownerId: TEST_OWNER,
    mutate: async (dir) => {
      quiz = await quizInto(dir);
    },
  });
  /* `markAnswerStream` is the only model call on this path, so a `fetch` that
     rejects makes a paid call nobody stubbed a failure rather than a bill. */
  globalThis.fetch = (() => Promise.reject(new Error("no model in tests"))) as unknown as typeof fetch;
}, 120_000);

afterAll(async () => {
  gates.releaseAll();
  globalThis.fetch = realFetch;
  await article?.remove();
});

function markBody(): { batchId: string; questionId: string; answer: string } {
  const question = quiz?.questions[0];
  if (!quiz || !question) throw new Error("the seed wrote no questions");
  return { batchId: quiz.batchId, questionId: question.id, answer: "It says something about it." };
}

describe("a quiz mark outlives nothing it should", { timeout: 60_000 }, () => {
  it("holds the request open until the mark is written, and only then answers", async () => {
    const gate = gates.make();
    const call = begin(markBody());
    await reachedOrSettled(gate, call);

    /* The handshake fired, so the handler is inside the stream and has written
       its first words. Both of these are false for a guard that launched it. */
    expect(call.settled(), "the request answered while the mark was still being written").toBe(false);
    expect(call.ended(), "the response was ended mid-stream").toBe(false);

    gate.release();
    await call.promise;

    expect(call.atSettle()?.ended, "the response was still open when the request settled").toBe(true);
    expect(terminals(call.atSettle()?.written ?? ""), call.written()).toEqual(["done"]);
  });

  it("a mark that fails mid-answer says so, and ends the response, before the request settles", async () => {
    /* The half of the lifetime a success cannot show: a launched stream's
       failure lands nowhere, and the request has already been answered. */
    const gate = gates.make({ fail: true });
    const call = begin(markBody());
    await reachedOrSettled(gate, call);
    expect(call.settled(), "the request answered while the mark was still being written").toBe(false);

    gate.release();
    await call.promise;

    expect(terminals(call.atSettle()?.written ?? ""), call.written()).toEqual(["error"]);
    expect(call.atSettle()?.ended, "the response was still open when the request settled").toBe(true);
  });
});
