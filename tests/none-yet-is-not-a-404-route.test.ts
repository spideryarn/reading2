/**
 * **"Not made yet" is a `200 null` to a client that asks for one** — the
 * sixteen artefact reads in `ROUTES` below. Quiz, crossrefs and citations first
 * (docs/plans/261006g-none-yet-is-not-a-404-and-admin-costs-scroll-cue.md §
 * Stage 1), seven more after
 * (docs/plans/261006h-the-other-seven-artefact-reads-answer-none-yet-as-200-null.md),
 * and the last six — tweets, relations, Skim, Sketch, Illustrated and Arc —
 * in docs/plans/261007n-the-last-six-artefact-reads-answer-none-yet-as-200-null.md.
 *
 * 1. **With the header, an article that has none of the sixteen answers
 *    `200 null`** — no 4xx for the browser to print in red.
 * 2. **Without it, the same read is still a 404**, which is what a tab left
 *    open across the deploy expects.
 * 3. **"No such article" stays a 404 with the header.** It is a different
 *    fact, and the helper must not swallow it.
 * 4. **An artefact that exists is unchanged by the header.**
 * 5. **`Cache-Control: private, no-store` on all of them**, the legacy 404
 *    included: the answer depends on a header no HTTP cache was told about.
 * 6. **"None" is "no usable artefact", as each loader tests it** (GPT Sol's F1
 *    on plan 261006h): a legacy Simple, a FAQ without its `questions` and a
 *    debate without its rows are in the same throw as absence, so they are the
 *    same `200 null`. A valid but empty FAQ, timeline or debate is an
 *    artefact, and is served.
 *
 * Real store, real routes; harness after tests/quiz-attempts-route.test.ts.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { runAsOwner } from "../src/owner.js";
import { ArtefactNotMadeYet } from "../src/store/artefact-not-made-yet.js";
import { loadArc, loadIllustrated, loadRelations, loadSketch, loadSkim, loadTweets } from "../src/store/index.js";
import { NONE_YET_AS_NULL_HEADER } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const BARE = "test-none-yet-bare";
const WITH_QUIZ = "test-none-yet-with-quiz";
const UNUSABLE = "test-none-yet-unusable";
const NO_SUCH = "test-none-yet-no-such-article";

await pgReady({
  suite: "tests/none-yet-is-not-a-404-route.test.ts",
  tables: ["spideryarn.article_revisions"],
});

const { handleApi } = await import("../src/routes.js");

const ROUTES = [
  "quiz",
  "crossrefs",
  "bibliography",
  "simple",
  "ideas",
  "faq",
  "timeline",
  "debate",
  "glossary",
  "quotes",
  "tweets",
  "relations",
  "skim",
  "sketch",
  "illustrated",
  "arc",
] as const;

let bare: ScratchArticle | undefined;
let withQuiz: ScratchArticle | undefined;
let unusable: ScratchArticle | undefined;

/**
 * Write artefact columns straight onto an article's published revision.
 *
 * Not through the store: `SHAPE` at its boundary refuses the documents case 6
 * needs, and they are rows that exist anyway — written before the check was.
 */
async function setOnCurrentRevision(
  article: ScratchArticle,
  values: Partial<typeof articleRevisions.$inferInsert>,
): Promise<void> {
  const [row] = await getDb()
    .select({ revisionId: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.id, article.articleId));
  if (!row?.revisionId) throw new Error(`${article.slug} has no published revision`);
  const written = await getDb()
    .update(articleRevisions)
    .set(values)
    .where(eq(articleRevisions.id, row.revisionId))
    .returning({ id: articleRevisions.id });
  /* An UPDATE that matches no row succeeds, and the cases below would then
     pass for the wrong reason: the column still empty. */
  if (written.length !== 1) throw new Error(`${article.slug}: wrote ${written.length} revisions, not 1`);
}

const STAMP = { sourceHash: "0".repeat(64), generatedAt: "2026-10-06T00:00:00.000Z", elapsedMs: 1, generator: "test" };
const EMPTY = {
  faq: { ...STAMP, slug: WITH_QUIZ, version: "faq/test", questions: [] },
  timeline: { ...STAMP, slug: WITH_QUIZ, version: "timeline/test", events: [] },
  debate: { ...STAMP, slug: WITH_QUIZ, version: "debate/test", direct: { rows: [] }, claims: { rows: [] } },
};

beforeAll(async () => {
  /* The corpus article carries a quiz, a glossary and ideas, and none of the
     other seven; the bare one loses those three as well, so all ten are "not
     made yet". */
  const strip = async (dir: string) => {
    for (const file of ["quiz.json", "glossary.json", "glossary-lookups.json", "ideas.json"]) {
      await rm(path.join(dir, file), { force: true });
    }
  };
  bare = await scratchArticleInPg(BARE, { ownerId: TEST_OWNER, mutate: strip });
  /* And the two of the last six that the corpus article carries. */
  await setOnCurrentRevision(bare, { tweets: null, arc: null });
  withQuiz = await scratchArticleInPg(WITH_QUIZ, { ownerId: TEST_OWNER });
  await setOnCurrentRevision(withQuiz, EMPTY as never);
  unusable = await scratchArticleInPg(UNUSABLE, { ownerId: TEST_OWNER, mutate: strip });
  await setOnCurrentRevision(unusable, {
    /* `simple/1`: the artefact before it had levels. */
    simpleSummary: { ...STAMP, slug: UNUSABLE, version: "simple/1", paragraphs: [] },
    /* No `questions` array. */
    faq: { ...STAMP, slug: UNUSABLE, version: "faq/test" },
    /* `direct` without its rows — fails `isDebateDocument`. */
    debate: { ...STAMP, slug: UNUSABLE, version: "debate/test", direct: {}, claims: { rows: [] } },
  } as never);
}, 240_000);

afterAll(async () => {
  await bare?.remove();
  await withQuiz?.remove();
  await unusable?.remove();
  await closeDb();
});

async function get(url: string, asks: boolean) {
  const req = Object.assign(
    (async function* () {})(),
    {
      method: "GET",
      url,
      headers: asks ? { ...AUTHED_HEADERS, [NONE_YET_AS_NULL_HEADER]: "1" } : AUTHED_HEADERS,
    },
  ) as unknown as IncomingMessage;
  let written = "";
  const headers = new Map<string, string>();
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), String(value));
    },
    on() {},
    write(chunk: string) {
      written += chunk;
      return true;
    },
    end(chunk?: string) {
      if (chunk) written += chunk;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, acceptAny);
  return {
    status: (res as unknown as { statusCode: number }).statusCode,
    body: written,
    cacheControl: headers.get("cache-control"),
  };
}

describe("an article with none of the sixteen", () => {
  for (const route of ROUTES) {
    it(`${route}: 200 null to a client that asks`, async () => {
      const res = await get(`/api/${route}/${BARE}`, true);
      expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: "null" });
      expect(res.cacheControl).toBe("private, no-store");
    });

    it(`${route}: still a 404 to a client that does not`, async () => {
      const res = await get(`/api/${route}/${BARE}`, false);
      expect(res.status).toBe(404);
      expect(res.cacheControl).toBe("private, no-store");
    });
  }
});

/**
 * **The last six loaders say "not made yet" with the type the helper reads.**
 * Tweets, relations, Skim, Sketch, Illustrated and Arc threw a plain error with
 * `status: 404` until plan 261007d; `orNullWhenNotMadeYet` passes anything
 * that is not an `ArtefactNotMadeYet` through as the error it is, so the route
 * cases above rest on this.
 */
const LAST_SIX = {
  tweets: loadTweets,
  relations: loadRelations,
  skim: loadSkim,
  sketch: loadSketch,
  illustrated: loadIllustrated,
  arc: loadArc,
} as const;

describe("the last six loaders", () => {
  for (const [route, load] of Object.entries(LAST_SIX)) {
    it(`${route}: the loader says "not made yet" with the type the helper reads`, async () => {
      const err = await runAsOwner(TEST_OWNER, () => load(BARE)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ArtefactNotMadeYet);
      expect((err as ArtefactNotMadeYet).status).toBe(404);
      /* And "no such article" is still the other 404, not this type. */
      const none = await runAsOwner(TEST_OWNER, () => load(NO_SUCH)).catch((e: unknown) => e);
      expect(none).not.toBeInstanceOf(ArtefactNotMadeYet);
      expect((none as { status?: number }).status).toBe(404);
    });

    it(`${route}: the legacy 404 names the step, and is not "no such article"`, async () => {
      const plain = await get(`/api/${route}/${BARE}`, false);
      expect(plain.status).toBe(404);
      expect(JSON.parse(plain.body).error).toMatch(/ yet\. .* POST \/api\/jobs /);
      expect(plain.body).not.toBe((await get(`/api/${route}/${NO_SUCH}`, false)).body);
    });
  }
});

describe("no such article is a different fact", () => {
  for (const route of ROUTES) {
    it(`${route}: a 404 even to a client that asks`, async () => {
      const res = await get(`/api/${route}/${NO_SUCH}`, true);
      expect(res.status).toBe(404);
      expect(res.body).not.toBe("null");
    });
  }
});

describe("an artefact that exists", () => {
  it("quiz: the questions, whether or not the client asks", async () => {
    for (const asks of [true, false]) {
      const res = await get(`/api/quiz/${WITH_QUIZ}`, asks);
      expect(res.status, `asks=${asks}`).toBe(200);
      const body = JSON.parse(res.body) as { quiz?: { questions?: unknown[] }; attempts?: unknown };
      expect(body.quiz?.questions?.length, `asks=${asks}`).toBeGreaterThan(0);
      /* The kept-answers read and the old-client bridge are still on it. */
      expect(body.attempts, `asks=${asks}`).toEqual([]);
      expect(res.cacheControl, `asks=${asks}`).toBe("private, no-store");
    }
  });
});

describe("a stored document the loader cannot use is none yet", () => {
  for (const route of ["simple", "faq", "debate"] as const) {
    it(`${route}: 200 null to a client that asks, a 404 to one that does not`, async () => {
      const asked = await get(`/api/${route}/${UNUSABLE}`, true);
      expect({ status: asked.status, body: asked.body }).toEqual({ status: 200, body: "null" });
      expect(asked.cacheControl).toBe("private, no-store");
      expect((await get(`/api/${route}/${UNUSABLE}`, false)).status).toBe(404);
    });
  }
});

describe("a valid but empty artefact is an artefact", () => {
  for (const route of ["faq", "timeline", "debate"] as const) {
    it(`${route}: its document, whether or not the client asks`, async () => {
      for (const asks of [true, false]) {
        const res = await get(`/api/${route}/${WITH_QUIZ}`, asks);
        expect(res.status, `asks=${asks}`).toBe(200);
        expect((JSON.parse(res.body) as Record<string, unknown>)[route], `asks=${asks}`).toEqual(EMPTY[route]);
        expect(res.cacheControl, `asks=${asks}`).toBe("private, no-store");
      }
    });
  }
});

describe("the other artefacts the corpus article has", () => {
  /* Route, and the field its answer carries the artefact in. */
  const CARRIED = { glossary: "glossary", ideas: "ideas", tweets: "thread", arc: "arc" } as const;
  for (const [route, field] of Object.entries(CARRIED)) {
    it(`${route}: served, whether or not the client asks`, async () => {
      for (const asks of [true, false]) {
        const res = await get(`/api/${route}/${WITH_QUIZ}`, asks);
        expect(res.status, `asks=${asks}`).toBe(200);
        expect((JSON.parse(res.body) as Record<string, unknown>)[field], `asks=${asks}`).toBeTruthy();
        expect(res.cacheControl, `asks=${asks}`).toBe("private, no-store");
      }
    });
  }
});
