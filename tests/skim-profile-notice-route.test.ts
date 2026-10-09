/**
 * **Sending Skim's profile-changed notice away, through the route and
 * Postgres** — `POST /api/skim/:slug/profile-notice-dismissal`,
 * src/store/pg-skim-notice.ts, and `GET /api/skim/:slug`'s
 * `profileNoticeDismissed`. docs/plans/261009i-skim-profile-notice-can-be-dismissed.md
 * (Greg, 2026-10-09, `spya-ud2w92`).
 *
 * The reader's profile is the test owner's global half, which other suites
 * own, plus this article's `purpose`, which this file owns — so every change
 * of profile here is a change of `purpose`, and no assertion needs to know
 * what the global half says. The one place the current hash is needed, it is
 * read back out of a stored key.
 *
 * 1. **A round trip**: dismissed, the read says so, and the time is stored.
 * 2. **It holds for that route under that profile**: a further profile change
 *    brings it back, changing back hides it again, and a re-plan — even under
 *    the same profile hash — brings it back.
 * 3. **An old `generatedAt` is a 409** and writes nothing.
 * 4. **Nothing to dismiss is a 204 and writes nothing.**
 * 5. **A second dismiss moves the time forward.**
 * 6. **A stranger's slug, an article with no route, and a bad body.**
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { EVAL_OWNER_ID } from "../src/owner.js";
import type { Skim, SkimResponse } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-skim-profile-notice-route";
const STRANGERS = "test-skim-profile-notice-route-strangers";
const ROUTELESS = "test-skim-profile-notice-route-routeless";

/** A profile hash nobody's profile has, so the notice is up whatever the global half says. */
const NOBODYS = "f".repeat(64);
const FIRST = "2026-10-09T01:00:00.000Z";
const SECOND = "2026-10-09T02:00:00.000Z";

await pgReady({
  suite: "tests/skim-profile-notice-route.test.ts",
  tables: ["spideryarn.articles", "spideryarn.article_revisions"],
});

const { handleApi } = await import("../src/routes.js");

let article: ScratchArticle | undefined;
let strangers: ScratchArticle | undefined;
let routeless: ScratchArticle | undefined;

async function revisionOf(which: ScratchArticle | undefined): Promise<string> {
  if (!which) throw new Error("no scratch article");
  const [row] = await getDb()
    .select({ revisionId: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.id, which.articleId));
  if (!row?.revisionId) throw new Error(`${which.slug} has no current revision`);
  return row.revisionId;
}

/** Put a one-stop route on the article, as the step would after a (re-)plan. */
async function plan(which: ScratchArticle | undefined, generatedAt: string, profileHash: string | null) {
  const route: Skim = {
    version: "test",
    generator: "test",
    slug: which?.slug ?? "",
    sourceHash: "hash",
    profileHash,
    stops: [{ quoteId: "spya-sk2nqt", depth: 1, role: null, cue: "Look." }],
    visible: [1, 1, 1],
    offered: 1,
    dropped: { unknownQuote: 0, duplicate: 0, sameBlock: 0, malformed: 0, badRole: 0, overCap: 0, collapsed: 0 },
    generatedAt,
    elapsedMs: 1,
  };
  await getDb()
    .update(articleRevisions)
    .set({ skim: route })
    .where(eq(articleRevisions.id, await revisionOf(which)));
}

async function setPurpose(which: ScratchArticle | undefined, purpose: string | null) {
  await getDb().update(articles).set({ purpose }).where(eq(articles.id, which?.articleId ?? ""));
}

async function stored(which: ScratchArticle | undefined) {
  const [row] = await getDb()
    .select({ key: articles.skimProfileNoticeDismissedFor, at: articles.skimProfileNoticeDismissedAt })
    .from(articles)
    .where(eq(articles.id, which?.articleId ?? ""));
  return row ?? { key: null, at: null };
}

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  /* Owned by somebody else: the requests below authenticate as `TEST_OWNER`. */
  strangers = await scratchArticleInPg(STRANGERS, { ownerId: EVAL_OWNER_ID });
  routeless = await scratchArticleInPg(ROUTELESS, { ownerId: TEST_OWNER });
  await plan(article, FIRST, NOBODYS);
  await plan(strangers, FIRST, NOBODYS);
  await getDb()
    .update(articleRevisions)
    .set({ skim: null })
    .where(eq(articleRevisions.id, await revisionOf(routeless)));
}, 120_000);

afterAll(async () => {
  await article?.remove();
  await strangers?.remove();
  await routeless?.remove();
  await closeDb();
});

async function request(method: string, url: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* chunks;
    })(),
    { method, url, headers: { ...AUTHED_HEADERS, "content-type": "application/json" } },
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

const dismiss = (slug: string, generatedAt: unknown) =>
  request("POST", `/api/skim/${slug}/profile-notice-dismissal`, { generatedAt });

async function read(slug: string): Promise<SkimResponse> {
  const got = await request("GET", `/api/skim/${slug}`);
  expect(got.status).toBe(200);
  return got.body as SkimResponse;
}

describe("POST /api/skim/:slug/profile-notice-dismissal", () => {
  it("dismisses the notice, the read says so, and the time is stored", async () => {
    await setPurpose(article, "to see whether attention is all you need");
    const before = await read(SLUG);
    expect(before.profileChanged).toBe(true);
    expect(before.profileNoticeDismissed).toBe(false);
    expect("profileNoticeDismissedFor" in before, "the stored key leaked into the reply").toBe(false);

    expect((await dismiss(SLUG, FIRST)).status).toBe(204);
    const after = await read(SLUG);
    expect(after.profileChanged).toBe(true);
    expect(after.profileNoticeDismissed).toBe(true);
    const row = await stored(article);
    expect(row.key?.startsWith(`${FIRST} `)).toBe(true);
    expect(row.at).toBeInstanceOf(Date);
  });

  it("comes back when the profile changes again, and goes when it changes back", async () => {
    await setPurpose(article, "to see whether attention is all you need");
    expect((await dismiss(SLUG, FIRST)).status).toBe(204);
    await setPurpose(article, "for a reading group on transformers");
    expect((await read(SLUG)).profileNoticeDismissed).toBe(false);
    await setPurpose(article, "to see whether attention is all you need");
    expect((await read(SLUG)).profileNoticeDismissed).toBe(true);
  });

  it("comes back after a re-plan, even one under the profile hash the old route had", async () => {
    await setPurpose(article, "to see whether attention is all you need");
    await plan(article, FIRST, NOBODYS);
    expect((await dismiss(SLUG, FIRST)).status).toBe(204);
    /* GPT Sol's plan review, finding 1: the same stamp, a new route. */
    await plan(article, SECOND, NOBODYS);
    const got = await read(SLUG);
    expect(got.profileChanged).toBe(true);
    expect(got.profileNoticeDismissed).toBe(false);
  });

  it("refuses a route that is no longer the one on the article, and writes nothing", async () => {
    await plan(article, SECOND, NOBODYS);
    await setPurpose(article, "something written only for this case");
    const was = await stored(article);
    expect((await dismiss(SLUG, FIRST)).status).toBe(409);
    expect(await stored(article)).toEqual(was);
  });

  it("answers 204 and writes nothing when there is no notice to dismiss", async () => {
    await setPurpose(article, "to see whether attention is all you need");
    await plan(article, SECOND, NOBODYS);
    expect((await dismiss(SLUG, SECOND)).status).toBe(204);
    /* The hash the server sees now, read back out of the key it just stored. */
    const nowHash = (await stored(article)).key?.split(" ")[1];
    expect(nowHash).toMatch(/^[0-9a-f]+$/);
    await plan(article, FIRST, nowHash ?? null);
    expect((await read(SLUG)).profileChanged).toBe(false);
    const was = await stored(article);
    expect((await dismiss(SLUG, FIRST)).status).toBe(204);
    expect(await stored(article)).toEqual(was);
    await plan(article, FIRST, NOBODYS);
  });

  it("moves the time forward on a second dismiss", async () => {
    await plan(article, FIRST, NOBODYS);
    expect((await dismiss(SLUG, FIRST)).status).toBe(204);
    const first = (await stored(article)).at;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await dismiss(SLUG, FIRST)).status).toBe(204);
    const second = (await stored(article)).at;
    expect(second && first && second.getTime() > first.getTime()).toBe(true);
  });

  it("is a 404 on a stranger's slug and writes nothing there", async () => {
    expect((await dismiss(STRANGERS, FIRST)).status).toBe(404);
    expect(await stored(strangers)).toEqual({ key: null, at: null });
  });

  it("is a 404 on an article with no route", async () => {
    expect((await dismiss(ROUTELESS, FIRST)).status).toBe(404);
    expect(await stored(routeless)).toEqual({ key: null, at: null });
  });

  it("is a 400 on a body without a route's time, or with anything else", async () => {
    expect((await dismiss(SLUG, 7)).status).toBe(400);
    expect((await dismiss(SLUG, "")).status).toBe(400);
    expect((await request("POST", `/api/skim/${SLUG}/profile-notice-dismissal`, { generatedAt: FIRST, x: 1 })).status).toBe(400);
  });
});
