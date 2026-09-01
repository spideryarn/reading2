/**
 * **A mark is bound to the batch the reader was shown, and refuses rather than
 * falls forward.**
 *
 * The failure this file exists for is invisible from every other angle. Between
 * a reader seeing a question and pressing Answer, a forced regeneration
 * replaces every reference answer and every piece of evidence in `quiz.json`.
 * The `quiz` step inherits no ids (src/pipeline.ts § the `quiz` step), so the
 * new batch's questions have new ids — but a client holding the *old* ids sends
 * a perfectly well-formed request, and a server that looked the question up by
 * id alone would either find nothing, or, if it fell forward to "the question
 * at that position now", mark one batch's answer against another batch's
 * reference with nothing anywhere going red.
 *
 * So the route is asked, at the route, for four things:
 *
 * 1. a `batchId` that is not the current one is a **409** and reaches no model;
 * 2. a **source-stale** quiz is a 409 too, and is checked *first*, because "the
 *    article has changed" and "the questions were rewritten" send the reader to
 *    different buttons;
 * 3. a `questionId` that is not in the current batch is a **404** — never a
 *    fall-forward to a coincidental match;
 * 4. every refusal happens **before a single SSE header is written**, so it is
 *    an ordinary JSON status a `fetch` caller can read, not an error frame
 *    inside a 200.
 *
 * Two more were added after a GPT Sol review of the built code
 * (docs/plans/260831al-review-quiz-sub-mode-stage4-review-sol.md):
 *
 * 5. the quiz and the article are two separate reads, and a revision landing
 *    **between** them defeats every check above — so the article is checked
 *    again after it has been read, not only before;
 * 6. a reader who leaves cancels the **provider** call, not merely the writing
 *    of frames.
 *
 * Nothing here reaches the model except the two cases that say so: `fetch` is
 * stubbed to reject, which is what makes point 1 assertable at all — a 409 that
 * had already called the provider would still be a 409.
 *
 * Harness copied from tests/chat-route.test.ts.
 * docs/plans/260831al-review-quiz-sub-mode.md § Marking.
 */
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **A hook in the gap between the two reads**, and the only way to test the
 * gap at all.
 *
 * `markOneAnswer` reads the quiz, validates it, and then reads the article —
 * two awaits, and a new revision can be published between them. Nothing in a
 * test can win that race by hand, so this puts the publication *inside* it:
 * `betweenReads` runs immediately before the article read and after the quiz
 * has already been validated, which is precisely the interleaving.
 *
 * Everything else comes straight from the real store, so the five cases that
 * do not set `betweenReads` are running against exactly the code they were
 * written against. It must be `vi.mock` rather than a spy: the store's exports
 * are ESM bindings and `src/routes.ts` captures them at import.
 */
let betweenReads: (() => Promise<void>) | null = null;
vi.mock("../src/store/index.js", async () => {
  const actual = await vi.importActual<typeof import("../src/store/index.js")>(
    "../src/store/index.js",
  );
  return {
    ...actual,
    loadArticle: async (slug: string) => {
      const hook = betweenReads;
      betweenReads = null;
      if (hook) await hook();
      return actual.loadArticle(slug);
    },
  };
});

import { handleApi } from "../src/routes.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";
import { buildQuiz } from "../src/quiz.js";
import { inputFingerprint } from "../src/quiz.js";
import type { Block, Quiz, Tree } from "../src/types.js";

const SLUG = "test-quiz-mark-route-fixture";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
const EXAMPLE = path.resolve(import.meta.dirname, "..", "example");

const reseed = async () => {
  await rm(DIR, { recursive: true, force: true });
  await cp(EXAMPLE, DIR, { recursive: true });
};

const realFetch = globalThis.fetch;
beforeAll(async () => {
  await reseed();
  /* Any model call at all is a bug here — every assertion below is about a
     refusal that must happen first. A rejecting `fetch` turns "we called the
     provider anyway" into a visible failure rather than a slower pass. */
  globalThis.fetch = (() =>
    Promise.reject(new Error("no model in tests"))) as unknown as typeof fetch;
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  await rm(DIR, { recursive: true, force: true });
});

/**
 * A real quiz over the fixture's real blocks, built by the real `buildQuiz`.
 *
 * **Not a hand-written object.** The fields this route reads — `batchId`, the
 * question ids, `sourceHash` — are exactly the ones a literal would get subtly
 * wrong, and a `sourceHash` typed by hand would make every case below a 409 for
 * the wrong reason, which is a test that passes while asking nothing.
 */
async function writeQuiz(opts: { stale?: boolean } = {}): Promise<Quiz> {
  const { blocks } = JSON.parse(await readFile(path.join(DIR, "blocks.json"), "utf-8")) as {
    blocks: Block[];
  };
  const tree = JSON.parse(await readFile(path.join(DIR, "tree.json"), "utf-8")) as Tree;
  const meta = JSON.parse(await readFile(path.join(DIR, "meta.json"), "utf-8"));
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
      slug: SLUG,
      blocks,
      /* The real fingerprint, so the artefact is genuinely current — unless the
         test asks for the opposite, in which case a hash that is merely
         *different* is exactly what "the article moved" looks like from here. */
      sourceHash: opts.stale ? "a-hash-from-an-older-article" : inputFingerprint(blocks, tree, meta),
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
  await writeFile(path.join(DIR, "quiz.json"), JSON.stringify(quiz, null, 2));
  return quiz;
}

interface Answered {
  status: number;
  body: string;
  /** Did the route open a stream? A refusal must not have. */
  streamed: boolean;
}

/**
 * The request and response a mark is served on, plus the two levers a test
 * needs on them: what has been written so far, and the reader hanging up.
 *
 * **`close()` is not decoration.** `sse` and `heartbeat` both register
 * `res.on("close")`, and a mock whose `on` is a no-op silently drops them — so
 * a route that never noticed the reader had gone would look identical to one
 * that did. Recording the listeners is what makes "the reader left" something
 * this file can actually do.
 */
function serve(body: unknown) {
  const payload = [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method: "POST", url: `/api/quiz/${SLUG}/mark`, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;

  let written = "";
  let head = 0;
  const closers: (() => void)[] = [];
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    /* `sse` calls this; `send` does not. It is the cleanest witness that the
       route decided to stream, because everything else about a 200 and a 409
       is written through the same `write`/`end` pair. */
    writeHead(status: number) {
      head = status;
      (this as { statusCode: number }).statusCode = status;
    },
    flushHeaders() {},
    on(event: string, fn: () => void) {
      if (event === "close") closers.push(fn);
    },
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
    req,
    res,
    /** The reader navigated away: the socket is gone, the handler is not. */
    close(): void {
      (res as unknown as { destroyed: boolean }).destroyed = true;
      for (const fn of closers) fn();
    },
    answered(): Answered {
      return {
        status: (res as unknown as { statusCode: number }).statusCode,
        body: written,
        streamed: head === 200 && written.includes("event: "),
      };
    },
  };
}

async function mark(body: unknown): Promise<Answered> {
  const call = serve(body);
  await handleApi(call.req, call.res, acceptAny);
  return call.answered();
}

beforeEach(async () => {
  await reseed();
  betweenReads = null;
  /* Back to the rejecting default every time, because one case below points
     `fetch` at a provider that talks. A leaked stub would let a later test
     reach a model and still pass, which is the shape of failure this whole
     file is about. */
  globalThis.fetch = (() =>
    Promise.reject(new Error("no model in tests"))) as unknown as typeof fetch;
});

describe("marking one answer", () => {
  it("refuses a batchId that is not the current one, with a 409", async () => {
    const quiz = await writeQuiz();
    const answered = await mark({
      /* The shape of the real failure: the client is holding a batch id from
         before a forced regeneration. */
      batchId: "spya-oldbat",
      questionId: quiz.questions[0]?.id,
      answer: "I think it says the quoted thing.",
    });

    expect(answered.status).toBe(409);
    /* **And no stream was opened.** A 409 the client has to dig out of an error
       frame inside a 200 is a 409 the client will not act on — and once
       `sse(res)` has written the headers, every later failure is a frame. */
    expect(answered.streamed).toBe(false);
    expect(answered.body).toMatch(/rewritten/i);
  });

  it("never falls forward to the question with that id in the current batch", async () => {
    const quiz = await writeQuiz();
    const id = quiz.questions[0]?.id;
    /* The id is real and the question is really there — the *only* thing wrong
       is the batch. This is the case a fall-forward would silently accept, and
       it is why the assertion is on the status rather than on the reply: a
       server that marked this would answer 200 with a perfectly good mark
       against a reference answer the reader never saw. */
    const answered = await mark({
      batchId: "spya-oldbat",
      questionId: id,
      answer: "I think it says the quoted thing.",
    });
    expect(answered.status).toBe(409);
    expect(answered.body).not.toContain("event: delta");
  });

  it("refuses a source-stale quiz before it looks at the batch at all", async () => {
    const quiz = await writeQuiz({ stale: true });
    const answered = await mark({
      /* The **correct** batch id, so the only thing that can refuse this is the
         staleness check — and the message has to be the article's rather than
         the batch's, or the reader presses the wrong button. */
      batchId: quiz.batchId,
      questionId: quiz.questions[0]?.id,
      answer: "I think it says the quoted thing.",
    });

    expect(answered.status).toBe(409);
    expect(answered.streamed).toBe(false);
    expect(answered.body).toMatch(/article has changed/i);
  });

  it("answers 404 for a question id that is not in this quiz", async () => {
    const quiz = await writeQuiz();
    const answered = await mark({
      batchId: quiz.batchId,
      questionId: "spya-nobody",
      answer: "I think it says the quoted thing.",
    });
    expect(answered.status).toBe(404);
    expect(answered.streamed).toBe(false);
  });

  it("refuses an empty answer and one past the cap, without a model call", async () => {
    const quiz = await writeQuiz();
    const id = quiz.questions[0]?.id;

    const blank = await mark({ batchId: quiz.batchId, questionId: id, answer: "   " });
    expect(blank.status).toBe(400);

    /* The cap is a guard against a paste of the whole article, not a style
       rule. `MAX_QUIZ_ANSWER_CHARS` is 4000 and this is comfortably past it. */
    const huge = await mark({ batchId: quiz.batchId, questionId: id, answer: "x".repeat(20_000) });
    expect(huge.status).toBe(413);
  });

  it("gets as far as the model when the batch and the article both agree", async () => {
    /* **The negative control, and without it the five above prove much less.**
       They would all pass on a route that refused everything. `fetch` rejects
       in this file, so reaching the provider is the furthest a passing request
       can get — and what that looks like from here is a stream that opened and
       then said `error`, which is exactly the terminal contract. */
    const quiz = await writeQuiz();
    const answered = await mark({
      batchId: quiz.batchId,
      questionId: quiz.questions[0]?.id,
      answer: "I think it says the quoted thing.",
    });

    expect(answered.status).toBe(200);
    expect(answered.streamed).toBe(true);
    expect(answered.body).toContain("event: error");
    // And exactly one terminal frame, never a `done` beside it.
    expect(answered.body).not.toContain("event: done");
  });
});

describe("the article can move between the two reads", () => {
  it("refuses when a revision lands after the quiz was checked and before the article was read", async () => {
    const quiz = await writeQuiz();

    /* **Publish, in the gap.** The quiz was current when it was validated and
       the article is a different one by the time it is read — so the model
       would be handed revision A's question, reference answer and evidence
       beside revision B's prose, and the staleness guard, whose entire job is
       to stop exactly that, has already passed. Rewriting one block's text is
       all it takes: the fingerprint covers the prose. */
    betweenReads = async () => {
      const file = path.join(DIR, "blocks.json");
      const parsed = JSON.parse(await readFile(file, "utf-8")) as { blocks: Block[] };
      const first = parsed.blocks[0];
      if (!first) throw new Error("the fixture has no blocks");
      first.text = `${first.text} And then the author added a paragraph.`;
      await writeFile(file, JSON.stringify(parsed, null, 2));
    };

    const answered = await mark({
      batchId: quiz.batchId,
      questionId: quiz.questions[0]?.id,
      answer: "I think it says the quoted thing.",
    });

    /* The same 409 and the same sentence as a quiz that was stale on arrival —
       because it is the same fact, found one await later. */
    expect(answered.status).toBe(409);
    expect(answered.streamed).toBe(false);
    expect(answered.body).toMatch(/article has changed/i);
  });

  it("still marks when nothing moved, so the re-check is not simply a refusal", async () => {
    /* The negative control for the case above: the second read must be a
       check, not a second chance to fail. `fetch` rejects in this file, so
       reaching the provider is as far as a passing request can get. */
    const quiz = await writeQuiz();
    const answered = await mark({
      batchId: quiz.batchId,
      questionId: quiz.questions[0]?.id,
      answer: "I think it says the quoted thing.",
    });

    expect(answered.status).toBe(200);
    expect(answered.streamed).toBe(true);
  });
});

describe("the reader leaving stops the paid call", () => {
  it("aborts the provider request, not just the writing of frames", async () => {
    const quiz = await writeQuiz();

    /* A provider that has started talking and has not finished, so there is
       something in flight to cancel. `release` ends it from the test's side
       afterwards — deliberately, so that a route which does NOT abort still
       finishes and fails on the assertion rather than on a five-second
       timeout. A timeout is a red test that says almost nothing. */
    let sent: AbortSignal | undefined;
    let release = () => {};
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      sent = init?.signal ?? undefined;
      return Promise.resolve({
        ok: true,
        headers: new Headers(),
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: "You have " } }] })}\n\n`,
              ),
            );
            release = () => {
              // A cancelled stream throws on `close()`, and by then the abort
              // has already done the job this is standing in for.
              try {
                c.close();
              } catch {}
            };
          },
        }),
      } as unknown as Response);
    }) as unknown as typeof fetch;

    const call = serve({
      batchId: quiz.batchId,
      questionId: quiz.questions[0]?.id,
      answer: "I think it says the quoted thing.",
    });
    const handled = handleApi(call.req, call.res, acceptAny);

    // Wait for the call to actually be in flight; there is nothing to abort
    // before that, and a fixed sleep here would be a flake waiting to happen.
    for (let i = 0; i < 200 && !sent; i++) await new Promise((r) => setTimeout(r, 5));
    expect(sent, "the route never reached the provider").toBeDefined();

    call.close();
    release();
    await handled;

    /* **The signal handed to OpenRouter, not the one the route keeps.** Before
       this, closing the tab stopped the frames and left the provider
       generating — and being paid for — until it finished on its own, so a
       retry started a second paid call beside the first. */
    expect(sent?.aborted).toBe(true);
    // And nothing was ticked on the way out: the socket is gone either way,
    // but a `done` frame written to it would still be the wrong claim.
    expect(call.answered().body).not.toContain("event: done");
  });
});
