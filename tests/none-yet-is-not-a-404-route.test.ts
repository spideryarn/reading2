/**
 * **"Not made yet" is a `200 null` to a client that asks for one** —
 * `GET /api/quiz/:slug`, `/api/crossrefs/:slug` and `/api/citations/:slug`,
 * the three reads every owner's article view makes whichever mode is open.
 * docs/plans/261006g-none-yet-is-not-a-404-and-admin-costs-scroll-cue.md § Stage 1.
 *
 * 1. **With the header, an article that has none of the three answers
 *    `200 null`** — no 4xx for the browser to print in red.
 * 2. **Without it, the same read is still a 404**, which is what a tab left
 *    open across the deploy expects.
 * 3. **"No such article" stays a 404 with the header.** It is a different
 *    fact, and the helper must not swallow it.
 * 4. **An artefact that exists is unchanged by the header.**
 * 5. **`Cache-Control: private, no-store` on all of them**, the legacy 404
 *    included: the answer depends on a header no HTTP cache was told about.
 *
 * Real store, real routes; harness after tests/quiz-attempts-route.test.ts.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { NONE_YET_AS_NULL_HEADER } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const BARE = "test-none-yet-bare";
const WITH_QUIZ = "test-none-yet-with-quiz";
const NO_SUCH = "test-none-yet-no-such-article";

await pgReady({
  suite: "tests/none-yet-is-not-a-404-route.test.ts",
  tables: ["spideryarn.article_revisions"],
});

const { handleApi } = await import("../src/routes.js");

const ROUTES = ["quiz", "crossrefs", "citations"] as const;

let bare: ScratchArticle | undefined;
let withQuiz: ScratchArticle | undefined;

beforeAll(async () => {
  /* The corpus article carries a quiz and neither of the other two; the bare
     one loses the quiz as well, so all three are "not made yet". */
  bare = await scratchArticleInPg(BARE, {
    ownerId: TEST_OWNER,
    mutate: async (dir) => {
      await rm(path.join(dir, "quiz.json"), { force: true });
    },
  });
  withQuiz = await scratchArticleInPg(WITH_QUIZ, { ownerId: TEST_OWNER });
}, 180_000);

afterAll(async () => {
  await bare?.remove();
  await withQuiz?.remove();
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

describe("an article with none of the three", () => {
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
