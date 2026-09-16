/**
 * **Reading time, through the route and Postgres** — `GET` and
 * `POST /api/reading-time/:slug`, src/store/pg-reading-time.ts,
 * docs/plans/260916c-show-where-you-have-spent-time-reading-in-the-spine-and-gutter.md
 * § Stages, stage 1.
 *
 * 1. **A POST adds**, so two batches for one block read back as their sum.
 * 2. **An id this article never had is dropped** and the rest of its batch
 *    still lands — the join to `block_identities` does that, not the validator.
 * 3. **A stranger's slug is a 404 on both verbs**, through the real route.
 * 4. **Every validation arm is a 400**, and writes nothing.
 * 5. **Deleting the article removes the rows**, through `block_identities`'
 *    cascade.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { readingTime } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { EVAL_OWNER_ID } from "../src/owner.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-reading-time-route";
const STRANGERS = "test-reading-time-route-strangers";
const DOOMED = "test-reading-time-route-doomed";

await pgReady({
  suite: "tests/reading-time-route.test.ts",
  tables: ["spideryarn.block_identities", "spideryarn.reading_time"],
});

const { handleApi } = await import("../src/routes.js");

let article: ScratchArticle | undefined;
let strangers: ScratchArticle | undefined;
let doomed: ScratchArticle | undefined;

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  /* Owned by somebody else: the request below still authenticates as
     `TEST_OWNER`, so this article is not theirs. */
  strangers = await scratchArticleInPg(STRANGERS, { ownerId: EVAL_OWNER_ID });
  doomed = await scratchArticleInPg(DOOMED, { ownerId: TEST_OWNER });
}, 120_000);

afterAll(async () => {
  await article?.remove();
  await strangers?.remove();
  await doomed?.remove();
  await closeDb();
});

/** One request and its response. `raw` is sent as the body exactly. */
async function request(
  method: string,
  url: string,
  raw = "",
): Promise<{ status: number; body: unknown }> {
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

const post = (slug: string, body: unknown) =>
  request("POST", `/api/reading-time/${slug}`, typeof body === "string" ? body : JSON.stringify(body));
const get = (slug: string) => request("GET", `/api/reading-time/${slug}`);

function blockOf(which: ScratchArticle | undefined, i: number): string {
  const id = which?.blocks[i]?.id;
  if (!id) throw new Error(`the scratch article has no block ${i}`);
  return id;
}

/**
 * The `n`th of a run of well-formed ids that are not this article's, spelled in
 * the id alphabet (src/ids.ts) so every one passes `isSpideryarnId`.
 */
function nthId(lead: string, n: number): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz023456789";
  let body = "";
  for (let i = 0, rest = n; i < 5; i++, rest = Math.floor(rest / 32)) body = alphabet.charAt(rest % 32) + body;
  return `spya-${lead}${body}`;
}

async function rowsOf(which: ScratchArticle | undefined): Promise<number> {
  const rows = await getDb()
    .select()
    .from(readingTime)
    .where(eq(readingTime.articleId, which?.articleId ?? ""));
  return rows.length;
}

describe("GET and POST /api/reading-time/:slug", () => {
  it("adds each batch to the running total, and reads it back", async () => {
    const first = blockOf(article, 0);
    const second = blockOf(article, 1);
    expect(await get(SLUG)).toEqual({ status: 200, body: { seconds: {} } });

    expect((await post(SLUG, { seconds: { [first]: 2.5, [second]: 1 } })).status).toBe(204);
    expect((await post(SLUG, { seconds: { [first]: 4 } })).status).toBe(204);

    expect(await get(SLUG)).toEqual({ status: 200, body: { seconds: { [first]: 6.5, [second]: 1 } } });
  });

  it("treats an empty batch as nothing to do", async () => {
    const before = await get(SLUG);
    expect((await post(SLUG, { seconds: {} })).status).toBe(204);
    expect(await get(SLUG)).toEqual(before);
  });

  it("drops an id this article never had, and keeps the rest of the batch", async () => {
    const known = blockOf(article, 2);
    /* Well-formed, and not one of this article's. */
    const unknown = "spya-rtqz2x";
    expect(article?.blocks.some((b) => b.id === unknown)).toBe(false);

    expect((await post(SLUG, { seconds: { [unknown]: 9, [known]: 3 } })).status).toBe(204);
    const { body } = await get(SLUG);
    const seconds = (body as { seconds: Record<string, number> }).seconds;
    expect(seconds[known]).toBe(3);
    expect(seconds).not.toHaveProperty(unknown);
  });

  it("is a 404 on both verbs for an article somebody else owns, and writes nothing", async () => {
    expect((await get(STRANGERS)).status).toBe(404);
    const batch = { seconds: { [blockOf(strangers, 0)]: 5 } };
    expect((await post(STRANGERS, batch)).status).toBe(404);
    expect(await rowsOf(strangers)).toBe(0);
  });

  describe("refuses a malformed batch with a 400, and writes nothing", () => {
    const valid = () => blockOf(article, 3);
    const cases: [string, () => unknown][] = [
      ["a body that is not an object", () => "[1, 2]"],
      ["a JSON null", () => "null"],
      ["no seconds at all", () => ({})],
      ["seconds that is not an object", () => ({ seconds: 5 })],
      ["seconds that is an array", () => ({ seconds: [5] })],
      [
        "more than 5,000 entries",
        () => ({
          seconds: Object.fromEntries(
            Array.from({ length: 5001 }, (_, i) => [nthId("w", i), 1]),
          ),
        }),
      ],
      /* Beside a good entry, so "writes nothing" means the whole batch. */
      ["a key that is not a block id", () => ({ seconds: { [valid()]: 1, "not-an-id": 1 } })],
      ["a string value", () => ({ seconds: { [valid()]: "5" } })],
      /* JSON cannot carry NaN or Infinity; `JSON.stringify` writes them as null. */
      ["a NaN, which arrives as null", () => ({ seconds: { [valid()]: Number.NaN } })],
      ["zero", () => ({ seconds: { [valid()]: 0 } })],
      ["a negative", () => ({ seconds: { [valid()]: -1 } })],
      ["more than an hour", () => ({ seconds: { [valid()]: 3601 } })],
    ];
    for (const [name, body] of cases) {
      it(name, async () => {
        const before = await get(SLUG);
        const got = await post(SLUG, body());
        expect(got.status).toBe(400);
        expect(await get(SLUG)).toEqual(before);
      });
    }

    it("but a batch of exactly 5,000 entries at the hour's limit fits through the door", async () => {
      /* The body limit is derived from these two caps, so the largest batch
         the validator accepts must not be a 413. The ids are well-formed and
         not this article's, so the store drops them all. */
      const seconds = Object.fromEntries(
        Array.from({ length: 5000 }, (_, i) => [nthId("x", i), 3599.9999999999995]),
      );
      expect((await post(SLUG, { seconds })).status).toBe(204);
    });
  });

  it("goes when the article does", async () => {
    const block = blockOf(doomed, 0);
    expect((await post(DOOMED, { seconds: { [block]: 12 } })).status).toBe(204);
    expect(await rowsOf(doomed)).toBe(1);
    await doomed?.remove();
    expect(await rowsOf(doomed)).toBe(0);
  });
});
