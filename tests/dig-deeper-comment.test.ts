/**
 * **A comment's *Dig deeper* is refused by its allowance before any model call,
 * and before the row is touched** — `POST /api/comments/:slug/:id/answer`
 * with `{ deep: true }`, `answer` in src/routes.ts. Plan 261001p stage 1,
 * Sol F5.
 *
 * And the first answer — no `deep` — never spends it: the tick-box stays
 * outside the allowance.
 *
 * Through `handleApi`, against Postgres, because the claims are about what the
 * route does in what order: the allowance is the store's `fetchAllowanceStore`
 * (replaced here with one that answers what each case says), the search and
 * the answer are stubbed and counted.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../src/db/client.js";
import { comments as commentsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-dig-deeper-comment";

const seen = vi.hoisted(() => ({
  taken: [] as string[],
  finished: [] as string[],
  answer: "allowed" as "allowed" | "rate" | "concurrency" | "global",
  searches: [] as unknown[],
  explains: [] as unknown[],
  searchFailure: null as Error | null,
}));

vi.mock("../src/store/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/store/index.js")>()),
  fetchAllowanceStore: {
    async take(bucket: string) {
      seen.taken.push(bucket);
      return seen.answer === "allowed" ? { kind: "allowed", id: "lease" } : { kind: seen.answer };
    },
    async finish(id: string) {
      seen.finished.push(id);
    },
  },
}));

vi.mock("../src/dig-deeper.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/dig-deeper.js")>()),
  async searchFirst(input: unknown) {
    seen.searches.push(input);
    if (seen.searchFailure) throw seen.searchFailure;
    return { sources: [], searches: 1, libraryQuery: null, library: [] };
  },
}));

vi.mock("../src/explain.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/explain.js")>()),
  async *explainStream(req: { dig?: unknown }) {
    seen.explains.push(req.dig ?? null);
    yield {
      type: "done",
      ending: "finished",
      answer: "a deeper explanation",
      citations: [],
      searches: 2,
      model: "stub",
    };
  },
}));

await pgReady({
  suite: "tests/dig-deeper-comment.test.ts",
  tables: ["spideryarn.comments", "spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");
const { commentStore } = await import("../src/store/index.js");

async function post(url: string, body: unknown): Promise<{ status: number; written: string }> {
  const payload = [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method: "POST", url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;
  let written = "";
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    flushHeaders() {},
    writeHead(status: number) {
      (this as { statusCode: number }).statusCode = status;
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
  return { status: res.statusCode, written };
}

describe("Dig deeper on a comment", { timeout: 60_000 }, () => {
  let article: ScratchArticle;
  let id = "";

  beforeAll(async () => {
    article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  }, 60_000);

  beforeEach(async () => {
    seen.taken.length = 0;
    seen.finished.length = 0;
    seen.searches.length = 0;
    seen.explains.length = 0;
    seen.searchFailure = null;
    const long = article.blocks.find((b) => b.text.length > 40);
    if (!long) throw new Error("the fixture has no block long enough to quote");
    await asTestOwner(async () => {
      for (const c of await commentStore.load(SLUG)) await commentStore.remove(SLUG, c.id);
    });
    const made = await asTestOwner(() =>
      commentStore.create(SLUG, { blockId: long.id, quote: long.text.slice(0, 20), start: 0 }),
    );
    id = made.id;
    await getDb()
      .update(commentsTable)
      .set({ status: "done", answer: "an old explanation" })
      .where(and(eq(commentsTable.articleId, article.articleId), eq(commentsTable.id, id)));
  });

  afterAll(async () => {
    await article?.remove();
  });

  it.each([
    ["rate", 429],
    ["concurrency", 429],
    ["global", 503],
  ] as const)("refuses on %s before any model call, leaving the answer as it was", async (kind, status) => {
    seen.answer = kind;
    const got = await post(`/api/comments/${SLUG}/${id}/answer`, { deep: true, useProfile: false });
    expect(got.status).toBe(status);
    expect(seen.taken).toEqual(["dig-deeper"]);
    expect(seen.searches).toEqual([]);
    expect(seen.explains).toEqual([]);
    const row = (await asTestOwner(() => commentStore.load(SLUG))).find((c) => c.id === id);
    expect(row).toMatchObject({ status: "done", answer: "an old explanation" });
  });

  it("searches, answers with the findings, and frees the slot", async () => {
    seen.answer = "allowed";
    await post(`/api/comments/${SLUG}/${id}/answer`, { deep: true, useProfile: false });
    expect(seen.taken).toEqual(["dig-deeper"]);
    expect(seen.searches).toHaveLength(1);
    expect(seen.explains).toHaveLength(1);
    expect(seen.explains[0]).toMatchObject({ searches: 1 });
    expect(seen.finished).toEqual(["lease"]);
  });

  it("leaves the old answer untouched when the forced search fails", async () => {
    seen.answer = "allowed";
    seen.searchFailure = Object.assign(new Error("The forced search failed."), { status: 502 });

    const got = await post(`/api/comments/${SLUG}/${id}/answer`, { deep: true, useProfile: false });
    expect(got.status).toBe(502);
    expect(seen.explains).toEqual([]);
    const row = (await asTestOwner(() => commentStore.load(SLUG))).find((c) => c.id === id);
    expect(row).toMatchObject({ status: "done", answer: "an old explanation" });
    expect(seen.finished).toEqual(["lease"]);
  });

  it("refuses a press on a comment already being answered before spending anything", async () => {
    seen.answer = "allowed";
    await asTestOwner(() => commentStore.beginAnswer(SLUG, id));

    const got = await post(`/api/comments/${SLUG}/${id}/answer`, { deep: true, useProfile: false });
    expect(got.status).toBe(409);
    expect(seen.taken).toEqual([]);
    expect(seen.searches).toEqual([]);
  });

  it("does not spend the allowance on an answer that is not a dig", async () => {
    seen.answer = "rate";
    await post(`/api/comments/${SLUG}/${id}/answer`, { useProfile: false });
    expect(seen.taken).toEqual([]);
    expect(seen.searches).toEqual([]);
    expect(seen.explains).toEqual([null]);
  });
});
