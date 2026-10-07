/**
 * **A finished mark is kept, and the owner's read hands it back** —
 * `POST /api/quiz/:slug/mark` writing `quiz_attempts`, and
 * `GET /api/quiz/:slug` returning `attempts`.
 * docs/plans/261005b-quiz-answers-are-kept-and-restored.md (report spya-e8ujxn).
 *
 * 1. **A round trip**: a mark that reaches `done` is one row, the `done` frame
 *    carries the row's own time as `answeredAt`, and the next GET returns the
 *    answer and the mark under `attempts`.
 * 2. **Append, latest wins**: a second answer to the same question is a second
 *    row, and the read returns the later one.
 * 3. **A replaced batch shows nothing and loses nothing**: the read is scoped
 *    to the current batch, and the rows stay.
 * 4. **A mark that failed stores nothing.**
 * 5. **A save that fails does not fail the mark**: `done` still goes, with
 *    `kept: false` and no `answeredAt`.
 * 6. **A mark that finished is kept whether or not its last frame was
 *    delivered** (GPT Sol's F8): the reader hangs up, the stream still yields
 *    its `done`, and the row is written with nobody listening.
 * 7. **"Could not read" is not "none"** (F5): a failed attempts read leaves the
 *    questions and answers `attempts: null`.
 * 8. **A stranger's article is a 404 on the read**, with nothing of the
 *    owner's answer in it, and the rows go when the article does.
 *
 * ## What is mocked, and why
 *
 * `markAnswerStream` is replaced by a script, because a mark that reaches
 * `done` needs two provider calls (the mark and the hidden verdict) and this
 * file is about what the route does with the `done`, not about how one is
 * made — tests/quiz-mark-stream.test.tsx is that. Everything from the store is
 * the real one except the two switches below, which make one call throw.
 *
 * Harness copied from tests/quiz-mark-route.test.ts.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { QuizMarkEvent, QuizMarkRequest } from "../src/quiz-mark.js";

/** What the marker does in the next call. Reset before every case. */
let script: ((req: QuizMarkRequest) => AsyncGenerator<QuizMarkEvent>) | null = null;
vi.mock("../src/quiz-mark.js", async () => {
  const actual = await vi.importActual<typeof import("../src/quiz-mark.js")>("../src/quiz-mark.js");
  return {
    ...actual,
    markAnswerStream: (req: QuizMarkRequest) => {
      if (!script) throw new Error("this case did not say what the marker does");
      return script(req);
    },
  };
});

let failTheSave = false;
let failTheRead = false;
vi.mock("../src/store/index.js", async () => {
  const actual = await vi.importActual<typeof import("../src/store/index.js")>(
    "../src/store/index.js",
  );
  return {
    ...actual,
    quizAttemptStore: {
      record: async (...args: Parameters<typeof actual.quizAttemptStore.record>) => {
        if (failTheSave) throw new Error("the database went away");
        return actual.quizAttemptStore.record(...args);
      },
      latestForBatch: async (...args: Parameters<typeof actual.quizAttemptStore.latestForBatch>) => {
        if (failTheRead) throw new Error("the database went away");
        return actual.quizAttemptStore.latestForBatch(...args);
      },
    },
  };
});

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, quizAttempts } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { EVAL_OWNER_ID } from "../src/owner.js";
import { buildQuiz, inputFingerprint } from "../src/quiz.js";
import type { Block, Quiz, QuizResponse, Tree } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-quiz-attempts-route";
const STRANGERS = "test-quiz-attempts-route-strangers";
const DOOMED = "test-quiz-attempts-route-doomed";

await pgReady({
  suite: "tests/quiz-attempts-route.test.ts",
  tables: ["spideryarn.quiz_attempts", "spideryarn.article_revisions"],
});

const { handleApi } = await import("../src/routes.js");

/** A real two-question quiz over the article's real blocks — quiz-mark-route's `quizInto`. */
async function quizInto(dir: string): Promise<Quiz> {
  const { blocks } = JSON.parse(await readFile(path.join(dir, "blocks.json"), "utf-8")) as {
    blocks: Block[];
  };
  const tree = JSON.parse(await readFile(path.join(dir, "tree.json"), "utf-8")) as Tree;
  const meta = JSON.parse(await readFile(path.join(dir, "meta.json"), "utf-8"));
  const long = blocks.filter((b) => b.text.length > 120);
  const [first, second] = long;
  if (!first || !second) throw new Error("the fixture has too few blocks long enough to quote");
  const quiz = buildQuiz(
    {
      questions: [first, second].map((block, i) => ({
        question: `What does the piece say in passage ${i + 1}?`,
        referenceAnswer: "It says the quoted thing. Then it moves on.",
        evidence: [{ blockId: block.id, quote: block.text.slice(0, 60) }],
      })),
    },
    {
      power: "standard",
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

interface Seeded {
  readonly article: ScratchArticle;
  readonly quiz: Quiz;
}

async function seed(slug: string, ownerId: typeof TEST_OWNER): Promise<Seeded> {
  let built: Quiz | undefined;
  const article = await scratchArticleInPg(slug, {
    ownerId,
    mutate: async (dir) => {
      built = await quizInto(dir);
    },
  });
  if (!built) throw new Error("the seed did not run its own mutate, so there are no questions");
  return { article, quiz: built };
}

let mine: Seeded | undefined;
let strangers: Seeded | undefined;
let doomed: Seeded | undefined;

beforeAll(async () => {
  mine = await seed(SLUG, TEST_OWNER);
  /* Owned by somebody else: every request below authenticates as `TEST_OWNER`. */
  strangers = await seed(STRANGERS, EVAL_OWNER_ID as typeof TEST_OWNER);
  doomed = await seed(DOOMED, TEST_OWNER);
}, 180_000);

afterAll(async () => {
  await mine?.article.remove();
  await strangers?.article.remove();
  await doomed?.article.remove();
  await closeDb();
});

beforeEach(async () => {
  script = null;
  failTheSave = false;
  failTheRead = false;
  /* Each case starts with nothing kept on the main article. */
  await getDb().delete(quizAttempts).where(eq(quizAttempts.articleId, mine?.article.articleId ?? ""));
});

/** The response a route writes to, with the reader hanging up as a lever. */
function serve(method: string, url: string, body?: unknown) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;
  let written = "";
  const closers: (() => void)[] = [];
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    writeHead(status: number) {
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
    run: () => handleApi(req, res, acceptAny),
    close(): void {
      (res as unknown as { destroyed: boolean }).destroyed = true;
      for (const fn of closers) fn();
    },
    status: () => (res as unknown as { statusCode: number }).statusCode,
    body: () => written,
  };
}

/** The data of the one frame of this kind, or undefined. */
function frameOf(body: string, event: string): Record<string, unknown> | undefined {
  const at = body.indexOf(`event: ${event}\ndata: `);
  if (at < 0) return undefined;
  const line = body.slice(at).split("\n")[1] ?? "";
  return JSON.parse(line.slice("data: ".length)) as Record<string, unknown>;
}

async function mark(slug: string, quiz: Quiz | undefined, questionAt: number, answer: string) {
  const call = serve("POST", `/api/quiz/${slug}/mark`, {
    batchId: quiz?.batchId,
    questionId: quiz?.questions[questionAt]?.id,
    answer,
  });
  await call.run();
  return { status: call.status(), body: call.body(), done: frameOf(call.body(), "done") };
}

async function read(slug: string): Promise<{ status: number; body: string; json: QuizResponse | null }> {
  const call = serve("GET", `/api/quiz/${slug}`);
  await call.run();
  const body = call.body();
  return { status: call.status(), body, json: call.status() === 200 ? (JSON.parse(body) as QuizResponse) : null };
}

const rowsOf = (which: Seeded | undefined) =>
  getDb()
    .select()
    .from(quizAttempts)
    .where(eq(quizAttempts.articleId, which?.article.articleId ?? ""))
    .orderBy(asc(quizAttempts.createdAt));

/** A marker that says two things and finishes. */
const finishes = (reply: string) =>
  async function* (): AsyncGenerator<QuizMarkEvent> {
    yield { type: "delta", text: reply.slice(0, 5) };
    yield { type: "delta", text: reply.slice(5) };
    yield { type: "done", reply, model: "test/marker" };
  };

describe("a finished mark is kept", () => {
  it("writes one row, sends its time on `done`, and the read hands the answer back", async () => {
    expect((await read(SLUG)).json?.attempts).toEqual([]);

    script = finishes("You have the main point [spya-aaaaaa].");
    const marked = await mark(SLUG, mine?.quiz, 0, "  It says the quoted thing.  ");
    expect(marked.status).toBe(200);
    expect(marked.done).toBeDefined();
    expect(marked.done?.kept).toBeUndefined();

    const rows = await rowsOf(mine);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({
      batchId: mine?.quiz.batchId,
      questionId: mine?.quiz.questions[0]?.id,
      /* The question's own words, so the row still means something once the
         batch has been replaced. */
      question: mine?.quiz.questions[0]?.question,
      /* Trimmed, as it went to the marker. */
      answer: "It says the quoted thing.",
      reply: "You have the main point [spya-aaaaaa].",
    });
    /* The database's time for the row, not a clock in the route. */
    expect(marked.done?.answeredAt).toBe(row?.createdAt.toISOString());

    expect((await read(SLUG)).json?.attempts).toEqual([
      {
        questionId: mine?.quiz.questions[0]?.id,
        answer: "It says the quoted thing.",
        reply: "You have the main point [spya-aaaaaa].",
        answeredAt: row?.createdAt.toISOString(),
      },
    ]);
  });

  it("appends a second answer to the same question, and the read returns the later one", async () => {
    script = finishes("First mark.");
    await mark(SLUG, mine?.quiz, 0, "First answer.");
    script = finishes("Second mark.");
    await mark(SLUG, mine?.quiz, 0, "Second answer.");
    script = finishes("Another question's mark.");
    await mark(SLUG, mine?.quiz, 1, "An answer to the other question.");

    expect(await rowsOf(mine)).toHaveLength(3);
    const attempts = (await read(SLUG)).json?.attempts ?? [];
    expect(attempts).toHaveLength(2);
    const byQuestion = new Map(attempts.map((a) => [a.questionId, a]));
    expect(byQuestion.get(mine?.quiz.questions[0]?.id ?? "")).toMatchObject({
      answer: "Second answer.",
      reply: "Second mark.",
    });
    expect(byQuestion.get(mine?.quiz.questions[1]?.id ?? "")).toMatchObject({
      answer: "An answer to the other question.",
    });
  });

  it("stores nothing for a mark that failed", async () => {
    script = async function* (): AsyncGenerator<QuizMarkEvent> {
      yield { type: "delta", text: "You have " };
      throw new Error("the provider stopped");
    };
    const marked = await mark(SLUG, mine?.quiz, 0, "It says the quoted thing.");
    expect(marked.body).toContain("event: error");
    expect(marked.done).toBeUndefined();
    expect(await rowsOf(mine)).toEqual([]);
    expect((await read(SLUG)).json?.attempts).toEqual([]);
  });

  it("still sends `done` when the save fails, and says it was not kept", async () => {
    failTheSave = true;
    script = finishes("You have the main point.");
    const marked = await mark(SLUG, mine?.quiz, 0, "It says the quoted thing.");
    /* The reader watched the mark arrive; a failed write must not turn it into
       an error frame. */
    expect(marked.body).not.toContain("event: error");
    expect(marked.done).toMatchObject({ reply: "You have the main point.", kept: false });
    /* No row, so no row's time: the client stamps this one itself. */
    expect(marked.done?.answeredAt).toBeUndefined();
    expect(await rowsOf(mine)).toEqual([]);
  });

  it("keeps a mark that finished after the reader had gone", async () => {
    /* GPT Sol's F8: the verdict call swallows the reader's abort, so the
       stream yields `done` to a socket that is closed. The row is the record
       that the mark finished; the frame is not. */
    let hangUp = () => {};
    script = async function* (): AsyncGenerator<QuizMarkEvent> {
      yield { type: "delta", text: "You have " };
      hangUp();
      yield { type: "done", reply: "You have the main point.", model: "test/marker" };
    };
    const call = serve("POST", `/api/quiz/${SLUG}/mark`, {
      batchId: mine?.quiz.batchId,
      questionId: mine?.quiz.questions[0]?.id,
      answer: "It says the quoted thing.",
    });
    hangUp = () => call.close();
    await call.run();

    expect(call.body()).not.toContain("event: done");
    expect(await rowsOf(mine)).toHaveLength(1);
    expect((await read(SLUG)).json?.attempts).toHaveLength(1);
  });
});

describe("the read", () => {
  it("answers `attempts: null`, with the questions, when the attempts could not be read", async () => {
    script = finishes("A mark.");
    await mark(SLUG, mine?.quiz, 0, "An answer.");
    failTheRead = true;
    const got = await read(SLUG);
    expect(got.status).toBe(200);
    expect(got.json?.quiz.batchId).toBe(mine?.quiz.batchId);
    /* Not `[]`, which would say "you have answered nothing". */
    expect(got.json?.attempts).toBeNull();
  });

  it("is a 404 for somebody else's article, with none of their answer in it", async () => {
    await getDb().insert(quizAttempts).values({
      articleId: strangers?.article.articleId ?? "",
      batchId: strangers?.quiz.batchId ?? "",
      questionId: strangers?.quiz.questions[0]?.id ?? "",
      question: strangers?.quiz.questions[0]?.question ?? "",
      answer: "SENTINEL-strangers-own-answer",
      reply: "SENTINEL-strangers-own-mark",
    });
    const got = await read(STRANGERS);
    expect(got.status).toBe(404);
    expect(got.body).not.toContain("SENTINEL");

    /* And a mark against it is refused before anything is written. */
    script = finishes("A mark.");
    const marked = await mark(STRANGERS, strangers?.quiz, 0, "An answer.");
    expect(marked.status).toBe(404);
    expect(await rowsOf(strangers)).toHaveLength(1);
  });

  it("shows nothing from a batch that has been replaced, and keeps its rows", async () => {
    script = finishes("A mark of the old batch.");
    await mark(SLUG, mine?.quiz, 0, "An answer to the old batch.");
    expect((await read(SLUG)).json?.attempts).toHaveLength(1);

    /* *Write them again*, as the database sees it: the same question ids under
       a new `batchId` — the case a read keyed on question id alone would get
       wrong. Put back afterwards, so the order of cases does not matter. */
    const db = getDb();
    const [row] = await db
      .select({ revisionId: articles.currentRevisionId })
      .from(articles)
      .where(eq(articles.id, mine?.article.articleId ?? ""));
    if (!row?.revisionId || !mine) throw new Error("the article has no current revision");
    const rewritten = { ...mine.quiz, batchId: "spya-newbat" };
    await db.update(articleRevisions).set({ quiz: rewritten }).where(eq(articleRevisions.id, row.revisionId));
    try {
      const got = await read(SLUG);
      expect(got.json?.quiz.batchId).toBe("spya-newbat");
      expect(got.json?.attempts).toEqual([]);
      const rows = await rowsOf(mine);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.question).toBe(mine.quiz.questions[0]?.question);
    } finally {
      await db.update(articleRevisions).set({ quiz: mine.quiz }).where(eq(articleRevisions.id, row.revisionId));
    }
  });

  it("loses the rows when the article is deleted", async () => {
    script = finishes("A mark.");
    await mark(DOOMED, doomed?.quiz, 0, "An answer.");
    expect(await rowsOf(doomed)).toHaveLength(1);
    await doomed?.article.remove();
    expect(await rowsOf(doomed)).toEqual([]);
  });
});
