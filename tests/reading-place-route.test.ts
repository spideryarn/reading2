/**
 * **Your place in an article, on the server** — `place` on
 * `POST /api/reading-time/:slug`, and `readingPlace` on the owner's
 * `GET /api/article/:slug`. src/store/pg-reading-time.ts § `readPlace`,
 * `setPlace`; docs/plans/261029f-your-place-in-an-article-follows-you-to-another-device.md.
 *
 * 1. **Never opened anywhere is `null`**; read before places were kept (some
 *    reading time, no row) is `{ block: null }`.
 * 2. **A place replaces the last one**, may come with no seconds, and `null`
 *    is the top.
 * 3. **A block the article never had writes nothing**, and leaves the last
 *    place standing.
 * 4. **A stranger's slug is a 404**, and a malformed place a 400 that writes
 *    neither half.
 * 5. **Deleting the article removes the row.**
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { readingPlace, readingTime } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { EVAL_OWNER_ID } from "../src/owner.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-reading-place-route";
const OLD = "test-reading-place-route-old";
const STRANGERS = "test-reading-place-route-strangers";
const DOOMED = "test-reading-place-route-doomed";

await pgReady({
  suite: "tests/reading-place-route.test.ts",
  tables: ["spideryarn.block_identities", "spideryarn.reading_time", "spideryarn.reading_place"],
});

const { handleApi } = await import("../src/routes.js");

let article: ScratchArticle | undefined;
let old: ScratchArticle | undefined;
let strangers: ScratchArticle | undefined;
let doomed: ScratchArticle | undefined;

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  old = await scratchArticleInPg(OLD, { ownerId: TEST_OWNER });
  strangers = await scratchArticleInPg(STRANGERS, { ownerId: EVAL_OWNER_ID });
  doomed = await scratchArticleInPg(DOOMED, { ownerId: TEST_OWNER });
}, 120_000);

afterAll(async () => {
  await article?.remove();
  await old?.remove();
  await strangers?.remove();
  await doomed?.remove();
  await closeDb();
});

/** One request and its response, as tests/reading-time-route.test.ts makes them. */
async function request(method: string, url: string, raw = ""): Promise<{ status: number; body: unknown }> {
  const req = Object.assign(
    (async function* () {
      if (raw) yield Buffer.from(raw);
    })(),
    { method, url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;
  let written = "";
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    writeHead(s: number) {
      (this as { statusCode: number }).statusCode = s;
    },
    flushHeaders() {},
    on() {},
    write(piece: string) {
      written += piece;
      return true;
    },
    end(piece?: string) {
      if (piece) written += piece;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, acceptAny);
  return {
    status: (res as unknown as { statusCode: number }).statusCode,
    body: written ? JSON.parse(written) : null,
  };
}

const post = (slug: string, body: unknown) => request("POST", `/api/reading-time/${slug}`, JSON.stringify(body));

/** What the owner's article read says about the place. */
async function placeOf(slug: string): Promise<unknown> {
  const got = await request("GET", `/api/article/${slug}`);
  expect(got.status).toBe(200);
  return (got.body as { readingPlace?: unknown }).readingPlace;
}

function blockOf(which: ScratchArticle | undefined, i: number): string {
  const id = which?.blocks[i]?.id;
  if (!id) throw new Error(`the scratch article has no block ${i}`);
  return id;
}

/** Well-formed, and not any scratch article's. */
const FOREIGN = "spya-zzzz99";

async function rowsOf(which: ScratchArticle | undefined): Promise<number> {
  const rows = await getDb()
    .select()
    .from(readingPlace)
    .where(eq(readingPlace.articleId, which?.articleId ?? ""));
  return rows.length;
}

describe("the owner's place in an article", () => {
  it("is null before the article has been opened anywhere", async () => {
    expect(await placeOf(SLUG)).toBeNull();
  });

  it("is the top, unknown, for an article read before places were kept", async () => {
    await getDb()
      .insert(readingTime)
      .values({ articleId: old?.articleId ?? "", blockId: blockOf(old, 0), seconds: 30 });
    expect(await placeOf(OLD)).toEqual({ block: null });
  });

  it("is replaced by each place sent, with or without seconds, and null is the top", async () => {
    expect((await post(SLUG, { seconds: {}, place: blockOf(article, 2) })).status).toBe(204);
    expect(await placeOf(SLUG)).toEqual({ block: blockOf(article, 2) });

    expect((await post(SLUG, { seconds: { [blockOf(article, 1)]: 3 }, place: blockOf(article, 1) })).status).toBe(204);
    expect(await placeOf(SLUG)).toEqual({ block: blockOf(article, 1) });

    /* A batch with no `place` leaves it alone. */
    expect((await post(SLUG, { seconds: { [blockOf(article, 0)]: 2 } })).status).toBe(204);
    expect(await placeOf(SLUG)).toEqual({ block: blockOf(article, 1) });

    expect((await post(SLUG, { seconds: {}, place: null })).status).toBe(204);
    expect(await placeOf(SLUG)).toEqual({ block: null });
    expect(await rowsOf(article)).toBe(1);
  });

  it("drops a block this article never had, leaving the last place standing", async () => {
    expect((await post(SLUG, { seconds: {}, place: blockOf(article, 3) })).status).toBe(204);
    expect((await post(SLUG, { seconds: {}, place: FOREIGN })).status).toBe(204);
    expect(await placeOf(SLUG)).toEqual({ block: blockOf(article, 3) });
  });

  it("refuses a stranger's slug, and a malformed place writes neither half", async () => {
    expect((await post(STRANGERS, { seconds: {}, place: blockOf(strangers, 0) })).status).toBe(404);
    expect(await rowsOf(strangers)).toBe(0);
    expect((await request("GET", `/api/article/${STRANGERS}`)).status).toBe(404);

    const secondsBefore = await request("GET", `/api/reading-time/${SLUG}`);
    for (const place of ["not-an-id", 7, { block: blockOf(article, 0) }]) {
      expect((await post(SLUG, { seconds: { [blockOf(article, 0)]: 1 }, place })).status).toBe(400);
    }
    expect(await placeOf(SLUG)).toEqual({ block: blockOf(article, 3) });
    expect(await request("GET", `/api/reading-time/${SLUG}`)).toEqual(secondsBefore);
  });

  it("goes when the article does", async () => {
    expect((await post(DOOMED, { seconds: {}, place: blockOf(doomed, 0) })).status).toBe(204);
    expect(await rowsOf(doomed)).toBe(1);
    const id = doomed?.articleId;
    await doomed?.remove();
    doomed = undefined;
    const rows = await getDb()
      .select()
      .from(readingPlace)
      .where(eq(readingPlace.articleId, id ?? ""));
    expect(rows).toHaveLength(0);
  });
});
