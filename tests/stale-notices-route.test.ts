/**
 * **Dismissing an "older version of the article" notice, through the route and
 * Postgres** — `GET`/`POST /api/stale-notices/:slug`, src/store/pg-stale-notices.ts.
 * docs/plans/261010a-dismiss-older-version-notices.md.
 *
 * 1. **A round trip**: POST is a 204 and the next GET lists that mode's
 *    identities, and no other mode's.
 * 2. **A second POST replaces the mode's list**, keeps `created_at`, and moves
 *    `dismissed_at` forward. One row per (article, mode), however many presses.
 * 3. **A stranger's slug is a 404 on both verbs**, and writes nothing.
 * 4. **A bad body is a 400**: an unknown mode, no identities, more than fifty,
 *    a malformed identity, an extra field, not an object.
 * 5. **Deleting the article removes the rows.**
 * 6. **The table refuses what the route refuses**, so a writer that skips the
 *    route cannot store an unbounded list either.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { STALE_NOTICE_TABLE, staleNoticeDismissals } from "../src/db/schema.js";
import {
  MAX_DISMISSED_IDENTITIES,
  MAX_IDENTITY_LENGTH,
  RETIRED_STALE_NOTICE_MODES,
  STALE_NOTICE_MODES,
} from "../src/stale-notice.js";
import { loadEnvLocal } from "../src/env.js";
import { EVAL_OWNER_ID } from "../src/owner.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-stale-notices-route";
const STRANGERS = "test-stale-notices-route-strangers";
const DOOMED = "test-stale-notices-route-doomed";
const LEGACY = "test-stale-notices-route-legacy";
const LEGACY_TAB = "test-stale-notices-route-legacy-tab";

const FIRST = "2026-10-10T08:00:00.000Z";
const SECOND = "2026-10-10T09:00:00.000Z";

await pgReady({
  suite: "tests/stale-notices-route.test.ts",
  tables: ["spideryarn.stale_notice_dismissals"],
});

const { handleApi } = await import("../src/routes.js");

let article: ScratchArticle | undefined;
let strangers: ScratchArticle | undefined;
let doomed: ScratchArticle | undefined;
let legacy: ScratchArticle | undefined;
let legacyTab: ScratchArticle | undefined;

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  /* Owned by somebody else: the requests below authenticate as `TEST_OWNER`. */
  strangers = await scratchArticleInPg(STRANGERS, { ownerId: EVAL_OWNER_ID });
  doomed = await scratchArticleInPg(DOOMED, { ownerId: TEST_OWNER });
  legacy = await scratchArticleInPg(LEGACY, { ownerId: TEST_OWNER });
  legacyTab = await scratchArticleInPg(LEGACY_TAB, { ownerId: TEST_OWNER });
}, 120_000);

afterAll(async () => {
  await article?.remove();
  await strangers?.remove();
  await doomed?.remove();
  await legacy?.remove();
  await legacyTab?.remove();
  await closeDb();
});

async function request(method: string, url: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* chunks;
    })(),
    {
      method,
      url,
      headers: { ...AUTHED_HEADERS, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    },
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

const dismiss = (slug: string, body: unknown) => request("POST", `/api/stale-notices/${slug}`, body);
const read = (slug: string) => request("GET", `/api/stale-notices/${slug}`);

async function rowsOf(which: ScratchArticle | undefined) {
  return getDb()
    .select()
    .from(staleNoticeDismissals)
    .where(eq(staleNoticeDismissals.articleId, which?.articleId ?? ""));
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("GET and POST /api/stale-notices/:slug", () => {
  it("dismisses, and the next read lists it under its mode and no other", async () => {
    expect(await read(SLUG)).toEqual({ status: 200, body: { dismissed: {} } });
    expect((await dismiss(SLUG, { mode: "glossary", identities: [FIRST] })).status).toBe(204);
    expect(await read(SLUG)).toEqual({ status: 200, body: { dismissed: { glossary: [FIRST] } } });
  });

  it("replaces the mode's list on a second dismissal, keeps created_at, and moves dismissed_at forward", async () => {
    expect((await dismiss(SLUG, { mode: "search", identities: [`spya-aaaaaa@${FIRST}`] })).status).toBe(204);
    const [before] = (await rowsOf(article)).filter((r) => r.mode === "search");
    await pause(20);
    expect(
      (await dismiss(SLUG, { mode: "search", identities: [`spya-aaaaaa@${FIRST}`, `spya-bbbbbb@${SECOND}`] }))
        .status,
    ).toBe(204);
    const [after] = (await rowsOf(article)).filter((r) => r.mode === "search");
    expect(after?.dismissedFor).toEqual([`spya-aaaaaa@${FIRST}`, `spya-bbbbbb@${SECOND}`]);
    expect(after?.createdAt.getTime()).toBe(before?.createdAt.getTime());
    expect(after?.dismissedAt.getTime()).toBeGreaterThan(before?.dismissedAt.getTime() ?? Infinity);

    /* And a narrower list replaces it outright: the client sends what it wants kept. */
    expect((await dismiss(SLUG, { mode: "search", identities: [`spya-cccccc@${SECOND}`] })).status).toBe(204);
    const body = (await read(SLUG)).body as { dismissed: Record<string, string[]> };
    expect(body.dismissed.search).toEqual([`spya-cccccc@${SECOND}`]);
    expect((await rowsOf(article)).filter((r) => r.mode === "search")).toHaveLength(1);
  });

  /* Plan 261009w renamed the Bibliography's notice `citations` → `bibliography`
     by expand and contract: the table admits both, the code writes the new
     word, and a row (or an open tab's request) in the old one reads as the new. */
  it("dismisses Bibliography's notice under its own name", async () => {
    expect((await dismiss(SLUG, { mode: "bibliography", identities: [FIRST] })).status).toBe(204);
    const body = (await read(SLUG)).body as { dismissed: Record<string, string[]> };
    expect(body.dismissed.bibliography).toEqual([FIRST]);
    expect(body.dismissed).not.toHaveProperty("citations");
    expect((await rowsOf(article)).filter((r) => r.mode === "bibliography")).toHaveLength(1);
  });

  it("reads a row the old code stored as `citations` as Bibliography's, and the later of the two wins", async () => {
    await getDb().execute(sql`
      insert into spideryarn.stale_notice_dismissals (article_id, mode, dismissed_for)
      values (${legacy?.articleId ?? ""}, 'citations', array[${FIRST}])
    `);
    expect((await read(LEGACY)).body).toEqual({ dismissed: { bibliography: [FIRST] } });

    /* The new code's dismissal is later, so it is the one read. */
    await pause(20);
    expect((await dismiss(LEGACY, { mode: "bibliography", identities: [SECOND] })).status).toBe(204);
    expect((await read(LEGACY)).body).toEqual({ dismissed: { bibliography: [SECOND] } });

    /* And an old row written after it (the old code, mid-deploy) wins in turn. */
    await pause(20);
    await getDb().execute(sql`
      update spideryarn.stale_notice_dismissals set dismissed_for = array[${FIRST}], dismissed_at = now()
      where article_id = ${legacy?.articleId ?? ""} and mode = 'citations'
    `);
    expect((await read(LEGACY)).body).toEqual({ dismissed: { bibliography: [FIRST] } });
  });

  it("stores a request in the old word, from a tab open across the deploy, under the new one", async () => {
    expect((await dismiss(LEGACY_TAB, { mode: "citations", identities: [FIRST] })).status).toBe(204);
    expect((await rowsOf(legacyTab)).map((r) => r.mode)).toEqual(["bibliography"]);
    expect((await read(LEGACY_TAB)).body).toEqual({ dismissed: { bibliography: [FIRST] } });
  });

  it("is a 404 on both verbs for an article somebody else owns, and writes nothing", async () => {
    expect((await read(STRANGERS)).status).toBe(404);
    expect((await dismiss(STRANGERS, { mode: "glossary", identities: [FIRST] })).status).toBe(404);
    expect(await rowsOf(strangers)).toEqual([]);
  });

  it.each([
    ["an unknown mode", { mode: "quiz", identities: [FIRST] }],
    ["no identities", { mode: "glossary", identities: [] }],
    ["more than fifty", { mode: "search", identities: Array.from({ length: 51 }, (_, i) => `run-${i}`) }],
    ["an identity with a space in it", { mode: "glossary", identities: ["two words"] }],
    ["an identity that is too long", { mode: "glossary", identities: ["x".repeat(121)] }],
    ["an identity that is not a string", { mode: "glossary", identities: [7] }],
    ["an extra field", { mode: "glossary", identities: [FIRST], also: true }],
    ["a body that is not an object", [FIRST]],
  ])("refuses %s with a 400, and writes nothing", async (_what, body) => {
    const before = (await rowsOf(article)).length;
    expect((await dismiss(SLUG, body)).status).toBe(400);
    expect((await rowsOf(article)).length).toBe(before);
  });

  it("goes when the article does", async () => {
    expect((await dismiss(DOOMED, { mode: "tweets", identities: [FIRST] })).status).toBe(204);
    expect(await rowsOf(doomed)).toHaveLength(1);
    await doomed?.remove();
    expect(await rowsOf(doomed)).toEqual([]);
  });

  it.each([
    ["an empty list", sql`'{}'::text[]`],
    ["a null element", sql`array['a', null]::text[]`],
    ["an element with a space", sql`array['a b']::text[]`],
    ["an element with a newline", sql`array['a' || chr(10) || 'b']::text[]`],
    ["an element over 120 characters", sql`array[repeat('x', 121)]::text[]`],
    ["fifty-one elements", sql`array(select 'x' || g from generate_series(1, 51) g)`],
  ])("the table itself refuses %s", async (_what, list) => {
    await expect(
      getDb().execute(sql`
        insert into spideryarn.stale_notice_dismissals (article_id, mode, dismissed_for)
        values (${article?.articleId ?? ""}, 'faq', ${list})
      `),
    ).rejects.toThrow();
  });

  it("the table's copy of the list and the bounds is the route's, plus the retired words it still admits", () => {
    expect(STALE_NOTICE_TABLE.modes).toEqual(STALE_NOTICE_MODES);
    expect(STALE_NOTICE_TABLE.retiredModes).toEqual(Object.keys(RETIRED_STALE_NOTICE_MODES));
    expect(STALE_NOTICE_TABLE.maxIdentities).toBe(MAX_DISMISSED_IDENTITIES);
    expect(STALE_NOTICE_TABLE.maxIdentityLength).toBe(MAX_IDENTITY_LENGTH);
  });

  it("the table refuses a mode outside the list", async () => {
    await expect(
      getDb().execute(sql`
        insert into spideryarn.stale_notice_dismissals (article_id, mode, dismissed_for)
        values (${article?.articleId ?? ""}, 'quiz', array['a'])
      `),
    ).rejects.toThrow();
  });

  it("the table accepts every route mode and the exact identity bounds", async () => {
    const maxIdentity = "x".repeat(MAX_IDENTITY_LENGTH);
    const maxList = Array.from(
      { length: MAX_DISMISSED_IDENTITIES },
      (_, i) => `${String(i).padStart(2, "0")}-${"x".repeat(MAX_IDENTITY_LENGTH - 3)}`,
    );
    await getDb()
      .insert(staleNoticeDismissals)
      .values({ articleId: article?.articleId ?? "", mode: "faq", dismissedFor: maxList });

    for (const mode of STALE_NOTICE_MODES) {
      await getDb()
        .insert(staleNoticeDismissals)
        .values({ articleId: article?.articleId ?? "", mode, dismissedFor: [maxIdentity] })
        .onConflictDoUpdate({
          target: [staleNoticeDismissals.articleId, staleNoticeDismissals.mode],
          set: { dismissedFor: [maxIdentity] },
        });
    }
    expect(await rowsOf(article)).toEqual(
      expect.arrayContaining(STALE_NOTICE_MODES.map((mode) => expect.objectContaining({ mode }))),
    );
  });
});
