/**
 * **A mark is bound to the batch the reader was shown, and refuses rather than
 * falls forward.**
 *
 * The failure this file exists for is invisible from every other angle. Between
 * a reader seeing a question and pressing Answer, a forced regeneration
 * replaces every reference answer and every piece of evidence in the quiz
 * artefact. The `quiz` step inherits no ids (src/pipeline.ts § the `quiz` step),
 * so the new batch's questions have new ids — but a client holding the *old* ids
 * sends a perfectly well-formed request, and a server that looked the question
 * up by id alone would either find nothing, or, if it fell forward to "the
 * question at that position now", mark one batch's answer against another
 * batch's reference with nothing anywhere going red.
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
 * ## It ran on the filesystem store until 2026-09-04, and case 5 is why it had to move
 *
 * The article and the quiz were a copied `example/` under `data/<slug>/` that
 * this file rewrote in place, so every one of the six claims above was being
 * made about the store that is not deployed
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § B). Three seeded articles replace it, each built by `scratchArticleInPg`
 * with its quiz written into the clone on the way in, so the artefact goes into
 * Postgres through `copyArtefacts` and `publishRevision` like any other.
 *
 * **Case 5 is the one that changes character rather than merely moving.** *A
 * revision landing between the two reads* was `writeFile` over `blocks.json` —
 * a sentence about a directory, and a thing no reader can do. It is now a real
 * second publication: a fresh draft off the current revision, the blocks
 * rewritten, the same questions carried forward onto it, and
 * `publishRevision`'s own guards run. What the second `loadQuiz` then finds is
 * a batch whose `sourceHash` was computed from a revision that is no longer
 * current — which is exactly the state a reader meets, and one the filesystem
 * store had no revisions to be in.
 *
 * Harness copied from tests/chat-route.test.ts; the flag pin and the seeding
 * shape from tests/candidates-route.test.ts.
 * docs/plans/260831al-review-quiz-sub-mode.md § Marking.
 *
 * ## The mutations, watched rather than reasoned — 2026-09-04
 *
 * Four, one per claim in the numbered list above that a mutation can reach.
 * Three red, and **the first stayed green, which is the finding.** All in
 * `src/routes.ts`.
 *
 * **1 — "checked *first*" (claim 2), and it STAYED GREEN.** `refuseAMovedQuiz`:
 * the two `if` blocks swapped, so the batch is checked before the staleness.
 * **10 passed of 10.** The reason is in *refuses a source-stale quiz before it
 * looks at the batch at all*: it sends the **correct** batch id, so under
 * either order the batch check simply passes and the staleness one throws. The
 * test's own comment says the correct id is deliberate — and that is exactly
 * what makes the ordering unobservable from here. **The word "first" in claim 2
 * is not tested by this file.** A case with *both* wrong — a stale article and
 * a superseded batch — is the one that would pin it, and there isn't one.
 *
 * **2 — the fall-forward (claim 3).** `const question = found.quiz
 * .questions[at];` made `… ?? found.quiz.questions[0];`, which is the
 * fall-forward the header calls the invisible failure. **1 failed of 10**:
 * *answers 404 for a question id that is not in this quiz*, `expected 200 to be
 * 404`. Note that *never falls forward to the question with that id in the
 * current batch* stayed **green**: it sends a stale `batchId`, so it is refused
 * by the batch check one line earlier and never reaches the lookup. Its 409 is
 * evidence about claim 1, not about claim 3.
 *
 * **3 — the second read (claim 5), the one the move to Postgres is for.** The
 * line `refuseAMovedQuiz(await loadQuiz(slug), batchId);` after `loadArticle`
 * deleted. **1 failed of 10**: *refuses when a revision lands after the quiz was
 * checked and before the article was read*, `expected 200 to be 409`. The
 * control beside it, *still marks when nothing moved*, stayed green — so the
 * pair distinguishes a re-check from a second chance to fail, which is what it
 * was written to do. This is the mutation the filesystem version could not have
 * had: the gap is filled by a real `publishRevision`, and a store with no
 * revisions has no gap.
 *
 * **4 — the abort (claim 6).** `signal: gone,` made `signal: new
 * AbortController().signal,` — a live signal that nothing ever fires, so the
 * frames stop and the provider call does not. **1 failed of 10**: *aborts the
 * provider request, not just the writing of frames*, `expected false to be
 * true`.
 *
 * **What the four do not cover.** Claim 4 — *every refusal happens before a
 * single SSE header is written* — has no mutation here at all: it is asserted
 * by `streamed === false` on four cases, but nothing above moves `sse(res)`
 * relative to the checks, so the claim rests on reading the code. The 400/413
 * body validation is untouched. And none of the four reaches `loadQuiz`'s own
 * `stale` computation — every mutation above assumes `found.stale` is right and
 * only moves what is done with it; a `sourceHash` comparison that was wrong
 * would sail through all ten tests.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `SPIDERYARN_STORE=postgres`, before **any** import runs — `src/store/live.ts`
 * reads the flag once and imports are hoisted above every statement. `vi.hoisted`
 * runs ahead of the `vi.mock` factory below as well, so the `importActual` in it
 * gets the Postgres wiring rather than a second copy of the filesystem one.
 */
const PREVIOUS_STORE_FLAG = vi.hoisted(() => {
  const previous = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return previous;
});

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
 * Everything else comes straight from the real store, so the cases that do not
 * set `betweenReads` are running against exactly the code they were written
 * against. It must be `vi.mock` rather than a spy: the store's exports are ESM
 * bindings and `src/routes.ts` captures them at import.
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

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { buildQuiz, inputFingerprint } from "../src/quiz.js";
import type { Block, Quiz, Tree } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

/**
 * Three articles, because the three states this file needs are states of an
 * *article* now rather than of a file it can rewrite between cases.
 *
 * The filesystem version had one slug and re-copied `example/` in `beforeEach`.
 * A published revision is not editable, and re-seeding one per case would pay
 * ~300ms eight times over for an endpoint that **stores nothing** — every case
 * here is a read. So the states are separated by slug instead: one current, one
 * source-stale, and one that a revision lands on top of.
 */
const SLUG = "test-quiz-mark-route-fixture";
const STALE_SLUG = "test-quiz-mark-route-stale";
const MOVES_SLUG = "test-quiz-mark-route-moves";

const { reachable } = await pgReady({
  suite: "tests/quiz-mark-route.test.ts",
  tables: ["spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");
const { STORE } = await import("../src/store/index.js");

if (PREVIOUS_STORE_FLAG === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = PREVIOUS_STORE_FLAG;

const when = reachable ? describe : describe.skip;

describe("the store these tests are actually talking to", () => {
  it("is the Postgres one", () => {
    /* Not gated on the database being up, deliberately: a control that vanishes
       when Postgres is missing vanishes exactly when it matters. A flag that
       failed to take looks precisely like this suite working — the filesystem
       store answers `loadQuiz` out of a JSON file, and *a revision landing
       between the two reads* would go back to being a `writeFile`. */
    expect(STORE).toBe("postgres");
  });
});

/**
 * A real quiz over a real article's real blocks, built by the real `buildQuiz`.
 *
 * **Not a hand-written object.** The fields this route reads — `batchId`, the
 * question ids, `sourceHash` — are exactly the ones a literal would get subtly
 * wrong, and a `sourceHash` typed by hand would make every case below a 409 for
 * the wrong reason, which is a test that passes while asking nothing.
 *
 * It is written into the **clone**, not into `data/`, and `scratchArticleInPg`
 * then carries it into Postgres through `copyArtefacts` — so the artefact
 * arrives on the revision the way the pipeline puts one there, rather than by a
 * second write path invented here.
 */
async function quizInto(dir: string, opts: { stale?: boolean } = {}): Promise<Quiz> {
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
  await writeFile(path.join(dir, "quiz.json"), JSON.stringify(quiz, null, 2));
  return quiz;
}

/** One seeded article and the batch that is current on it. */
interface Seeded {
  readonly article: ScratchArticle;
  readonly quiz: Quiz;
}

async function seed(slug: string, opts: { stale?: boolean } = {}): Promise<Seeded> {
  let built: Quiz | undefined;
  /* `TEST_OWNER`, because `acceptAny` authenticates as that reader and the
     Postgres reader filters every article by owner. An article seeded as
     anybody else is invisible and every route below answers 404, which looks
     exactly like a broken route — `ScratchOptions.ownerId`. */
  const article = await scratchArticleInPg(slug, {
    ownerId: TEST_OWNER,
    mutate: async (dir) => {
      built = await quizInto(dir, opts);
    },
  });
  if (!built) throw new Error("the seed did not run its own mutate, so there are no questions");
  return { article, quiz: built };
}

let current: Seeded | undefined;
let stale: Seeded | undefined;
let moves: Seeded | undefined;

const realFetch = globalThis.fetch;

beforeAll(async () => {
  if (!reachable) return;
  current = await seed(SLUG);
  stale = await seed(STALE_SLUG, { stale: true });
  moves = await seed(MOVES_SLUG);
  /* Any model call at all is a bug here — every assertion below is about a
     refusal that must happen first. A rejecting `fetch` turns "we called the
     provider anyway" into a visible failure rather than a slower pass. */
  globalThis.fetch = (() =>
    Promise.reject(new Error("no model in tests"))) as unknown as typeof fetch;
}, 120_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  await current?.article.remove();
  await stale?.article.remove();
  await moves?.article.remove();
  await closeDb();
});

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
function serve(slug: string, body: unknown) {
  const payload = [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method: "POST", url: `/api/quiz/${slug}/mark`, headers: AUTHED_HEADERS },
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

async function mark(slug: string, body: unknown): Promise<Answered> {
  const call = serve(slug, body);
  await handleApi(call.req, call.res, acceptAny);
  return call.answered();
}

beforeEach(() => {
  betweenReads = null;
  /* Back to the rejecting default every time, because one case below points
     `fetch` at a provider that talks. A leaked stub would let a later test
     reach a model and still pass, which is the shape of failure this whole
     file is about. */
  globalThis.fetch = (() =>
    Promise.reject(new Error("no model in tests"))) as unknown as typeof fetch;
});

when("marking one answer", () => {
  it("refuses a batchId that is not the current one, with a 409", async () => {
    const answered = await mark(SLUG, {
      /* The shape of the real failure: the client is holding a batch id from
         before a forced regeneration. */
      batchId: "spya-oldbat",
      questionId: current?.quiz.questions[0]?.id,
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
    /* The id is real and the question is really there — the *only* thing wrong
       is the batch. This is the case a fall-forward would silently accept, and
       it is why the assertion is on the status rather than on the reply: a
       server that marked this would answer 200 with a perfectly good mark
       against a reference answer the reader never saw. */
    const answered = await mark(SLUG, {
      batchId: "spya-oldbat",
      questionId: current?.quiz.questions[0]?.id,
      answer: "I think it says the quoted thing.",
    });
    expect(answered.status).toBe(409);
    expect(answered.body).not.toContain("event: delta");
  });

  it("refuses a source-stale quiz before it looks at the batch at all", async () => {
    const answered = await mark(STALE_SLUG, {
      /* The **correct** batch id, so the only thing that can refuse this is the
         staleness check — and the message has to be the article's rather than
         the batch's, or the reader presses the wrong button. */
      batchId: stale?.quiz.batchId,
      questionId: stale?.quiz.questions[0]?.id,
      answer: "I think it says the quoted thing.",
    });

    expect(answered.status).toBe(409);
    expect(answered.streamed).toBe(false);
    expect(answered.body).toMatch(/article has changed/i);
  });

  it("answers 404 for a question id that is not in this quiz", async () => {
    const answered = await mark(SLUG, {
      batchId: current?.quiz.batchId,
      questionId: "spya-nobody",
      answer: "I think it says the quoted thing.",
    });
    expect(answered.status).toBe(404);
    expect(answered.streamed).toBe(false);
  });

  it("refuses an empty answer and one past the cap, without a model call", async () => {
    const batchId = current?.quiz.batchId;
    const id = current?.quiz.questions[0]?.id;

    const blank = await mark(SLUG, { batchId, questionId: id, answer: "   " });
    expect(blank.status).toBe(400);

    /* The cap is a guard against a paste of the whole article, not a style
       rule. `MAX_QUIZ_ANSWER_CHARS` is 4000 and this is comfortably past it. */
    const huge = await mark(SLUG, { batchId, questionId: id, answer: "x".repeat(20_000) });
    expect(huge.status).toBe(413);
  });

  it("gets as far as the model when the batch and the article both agree", async () => {
    /* **The negative control, and without it the five above prove much less.**
       They would all pass on a route that refused everything. `fetch` rejects
       in this file, so reaching the provider is the furthest a passing request
       can get — and what that looks like from here is a stream that opened and
       then said `error`, which is exactly the terminal contract.

       It is also the one case that proves the *seed* is honest: a quiz whose
       `sourceHash` did not survive `copyArtefacts` and `publishRevision` would
       come back stale, and every refusal above would still pass. */
    const answered = await mark(SLUG, {
      batchId: current?.quiz.batchId,
      questionId: current?.quiz.questions[0]?.id,
      answer: "I think it says the quoted thing.",
    });

    expect(answered.status).toBe(200);
    expect(answered.streamed).toBe(true);
    expect(answered.body).toContain("event: error");
    // And exactly one terminal frame, never a `done` beside it.
    expect(answered.body).not.toContain("event: done");
  });
});

when("the article can move between the two reads", () => {
  it("refuses when a revision lands after the quiz was checked and before the article was read", async () => {
    /* **Publish, in the gap.** The quiz was current when it was validated and
       the article is a different one by the time it is read — so the model
       would be handed revision A's question, reference answer and evidence
       beside revision B's prose, and the staleness guard, whose entire job is
       to stop exactly that, has already passed.

       A real second publication rather than a `writeFile`: a fresh draft off
       what is current, one block's text rewritten — the fingerprint covers the
       prose — and **the same questions carried onto it**. Carrying them is what
       makes this case about the article rather than about the batch: leave the
       corpus article's own `quiz.json` in the clone and the second `loadQuiz`
       finds a different `batchId`, which refuses with the other sentence for
       the other reason. */
    betweenReads = async () => {
      /* **The real `fetch` for the length of the seed, and this is not a
         convenience.** The rejecting stub above is there to make *any model
         call* a visible failure, and it catches by being global — so it also
         catches `storeRawSource` putting the article's bytes in the Supabase
         bucket over HTTP, and the publication fails with `no model in tests`
         from inside the gap. Swapped for the duration and put straight back, so
         a mark reaching the provider is still a red. */
      const stub = globalThis.fetch;
      globalThis.fetch = realFetch;
      try {
        await scratchArticleInPg(MOVES_SLUG, {
          ownerId: TEST_OWNER,
          mutate: async (dir) => {
            const file = path.join(dir, "blocks.json");
            const parsed = JSON.parse(await readFile(file, "utf-8")) as { blocks: Block[] };
            /* **A paragraph, not the first block.** The tree records each
               section's `sourceHeading` and `checkTree` matches it against the
               heading block in its range, so rewriting a heading is refused at
               publication — *its sourceHeading does not match any heading block
               in its range* — and the case would then be about the guard rather
               than about the gap. The fingerprint covers every block's prose,
               so any paragraph moves it. */
            const moved = parsed.blocks.find((b) => b.tag === "p" && b.text.length > 100);
            if (!moved) throw new Error("the fixture has no paragraph long enough to rewrite");
            moved.text = `${moved.text} And then the author added a paragraph.`;
            await writeFile(file, JSON.stringify(parsed, null, 2));
            await writeFile(path.join(dir, "quiz.json"), JSON.stringify(moves?.quiz, null, 2));
          },
        });
      } finally {
        globalThis.fetch = stub;
      }
    };

    const answered = await mark(MOVES_SLUG, {
      batchId: moves?.quiz.batchId,
      questionId: moves?.quiz.questions[0]?.id,
      answer: "I think it says the quoted thing.",
    });

    /* The same 409 and the same sentence as a quiz that was stale on arrival —
       because it is the same fact, found one await later. */
    expect(answered.status).toBe(409);
    expect(answered.streamed).toBe(false);
    expect(answered.body).toMatch(/article has changed/i);
  }, 60_000);

  it("still marks when nothing moved, so the re-check is not simply a refusal", async () => {
    /* The negative control for the case above: the second read must be a
       check, not a second chance to fail. `fetch` rejects in this file, so
       reaching the provider is as far as a passing request can get. On the
       untouched article, so it says nothing about whichever order the two
       cases happen to run in. */
    const answered = await mark(SLUG, {
      batchId: current?.quiz.batchId,
      questionId: current?.quiz.questions[0]?.id,
      answer: "I think it says the quoted thing.",
    });

    expect(answered.status).toBe(200);
    expect(answered.streamed).toBe(true);
  });
});

when("the reader leaving stops the paid call", () => {
  it("aborts the provider request, not just the writing of frames", async () => {
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

    const call = serve(SLUG, {
      batchId: current?.quiz.batchId,
      questionId: current?.quiz.questions[0]?.id,
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
