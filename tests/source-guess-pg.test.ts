/**
 * **An uploaded paper's guessed web address, in Postgres** — the claim, the
 * fence, the attempt cap, the owner's payload and the public projection.
 * src/store/pg-source-guesses.ts; docs/plans/260929g-canonical-link-for-an-uploaded-paper.md.
 *
 * What each case guards:
 *
 * - **The race.** Two first opens at once must not both search. The claim is
 *   one `insert … on conflict do update … where` statement, and two of them
 *   are fired together here, over separate pool connections, several times.
 * - **The fence.** A search that outlives its claim must not overwrite the
 *   answer of the claim that replaced it.
 * - **The cap.** A third claim is refused and the row settles as `none`.
 * - **The payload.** `loadArticle` carries the row; the public projection
 *   never does, because a visitor sees no guess (plan § Decisions 4).
 *
 * Skips loudly when there is no database — tests/helpers/pg-ready.ts.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articles, uploadSourceGuesses } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId, EVAL_OWNER_ID, runAsOwner } from "../src/owner.js";
import { pgSourceGuessStore } from "../src/store/pg-source-guesses.js";
import { pgPublicReader } from "../src/store/public-reader.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

await pgReady({
  suite: "tests/source-guess-pg.test.ts",
  tables: ["spideryarn.upload_source_guesses"],
});

const { handleApi } = await import("../src/routes.js");
const { guessSource, loadArticle } = await import("../src/store/index.js");

/** One run's suffix, so two processes running this file cannot collide. */
const RUN = randomUUID().slice(0, 8);
const SLUG = `test-source-guess-store-${RUN}`;
const ARTICLE_ID = randomUUID();
const SCRATCH_SLUG = `test-source-guess-payload-${RUN}`;
const STALE = { staleMs: 90_000 };
const store = pgSourceGuessStore;

const FOUND = {
  status: "found",
  url: "https://doi.org/10.1234/hpc.2024.5678",
  host: "doi.org",
  kind: "canonical",
  matchedBy: "doi",
  searches: 1,
  model: "test/model",
} as const;

/** Push the live claim back past its staleness, as a process that died would leave it. */
async function ageClaim(articleId: string = ARTICLE_ID): Promise<void> {
  await getDb()
    .update(uploadSourceGuesses)
    .set({ claimedAt: sql`now() - interval '1 hour'` })
    .where(eq(uploadSourceGuesses.articleId, articleId));
}

async function row(articleId: string = ARTICLE_ID) {
  const [found] = await getDb().select().from(uploadSourceGuesses).where(eq(uploadSourceGuesses.articleId, articleId));
  return found;
}

beforeAll(async () => {
  await getDb().insert(articles).values({ id: ARTICLE_ID, ownerId: currentOwnerId(), slug: SLUG }).onConflictDoNothing();
});

afterEach(async () => {
  await getDb().delete(uploadSourceGuesses).where(eq(uploadSourceGuesses.articleId, ARTICLE_ID));
});

afterAll(async () => {
  await getDb().delete(articles).where(eq(articles.id, ARTICLE_ID));
  await closeDb();
});

describe("the claim", () => {
  it("is taken by the first caller, and the row reads as searching", async () => {
    const claim = await store.claim(SLUG, STALE);
    expect(claim).toMatchObject({ kind: "claimed", attempt: 1 });
    expect(await store.read(SLUG)).toEqual({ status: "searching" });
  });

  it("goes to exactly one of two callers racing for it", async () => {
    /* Several rounds, because one round can be won by arrival order alone. */
    for (let round = 0; round < 6; round++) {
      await getDb().delete(uploadSourceGuesses).where(eq(uploadSourceGuesses.articleId, ARTICLE_ID));
      const both = await Promise.all([store.claim(SLUG, STALE), store.claim(SLUG, STALE)]);
      expect(both.map((c) => c.kind).sort(), `round ${round}`).toEqual(["busy", "claimed"]);
    }
  });

  it("is refused while a live claim stands, and taken again once it is stale", async () => {
    await store.claim(SLUG, STALE);
    expect(await store.claim(SLUG, STALE)).toEqual({ kind: "busy" });
    await ageClaim();
    expect(await store.claim(SLUG, STALE)).toMatchObject({ kind: "claimed", attempt: 2 });
  });

  it("is never taken a third time: the row settles as none, why attempts", async () => {
    await store.claim(SLUG, STALE);
    await ageClaim();
    await store.claim(SLUG, STALE);
    await ageClaim();
    expect(await store.claim(SLUG, STALE)).toEqual({ kind: "settled", guess: { status: "none" } });
    expect(await row()).toMatchObject({ status: "none", why: "attempts", attempts: 2, claimToken: null });
  });

  it("answers the settled guess rather than claiming a finished one", async () => {
    const claim = await store.claim(SLUG, STALE);
    if (claim.kind !== "claimed") throw new Error("expected a claim");
    await store.finish(SLUG, claim.token, FOUND);
    await ageClaim();
    expect(await store.claim(SLUG, STALE)).toEqual({
      kind: "settled",
      guess: { status: "found", url: FOUND.url, host: "doi.org", kind: "canonical", matchedBy: "doi" },
    });
  });

  it("is a 404 for an article that is not there", async () => {
    await expect(store.claim("no-such-article-at-all", STALE)).rejects.toMatchObject({ status: 404 });
  });
});

describe("the fence", () => {
  it("discards an answer whose claim was taken over, and keeps the successor's", async () => {
    const first = await store.claim(SLUG, STALE);
    await ageClaim();
    const second = await store.claim(SLUG, STALE);
    if (first.kind !== "claimed" || second.kind !== "claimed") throw new Error("expected two claims");
    expect(await store.finish(SLUG, first.token, { status: "none", why: "judge:title-mismatch", searches: 1, model: "m" })).toBe(false);
    expect(await store.finish(SLUG, second.token, FOUND)).toBe(true);
    expect(await store.read(SLUG)).toMatchObject({ status: "found", url: FOUND.url });
    // And a finished row cannot be finished again, by anybody.
    expect(await store.finish(SLUG, second.token, { status: "none", why: "x", searches: null, model: null })).toBe(false);
  });
});

describe("release", () => {
  it("with a refund, gives the attempt back and is reclaimable at once", async () => {
    const claim = await store.claim(SLUG, STALE);
    if (claim.kind !== "claimed") throw new Error("expected a claim");
    expect(await store.release(SLUG, claim.token, { refund: true })).toBe(true);
    expect(await row()).toMatchObject({ status: "searching", attempts: 0 });
    expect(await store.claim(SLUG, STALE)).toMatchObject({ kind: "claimed", attempt: 1 });
  });

  it("without one, keeps the attempt counted and is reclaimable at once", async () => {
    const claim = await store.claim(SLUG, STALE);
    if (claim.kind !== "claimed") throw new Error("expected a claim");
    await store.release(SLUG, claim.token, { refund: false });
    expect(await store.claim(SLUG, STALE)).toMatchObject({ kind: "claimed", attempt: 2 });
  });

  it("is fenced too: a stale token releases nothing", async () => {
    await store.claim(SLUG, STALE);
    expect(await store.release(SLUG, "not-the-token", { refund: true })).toBe(false);
    expect(await store.claim(SLUG, STALE)).toEqual({ kind: "busy" });
  });
});

describe("the table's CHECKs", () => {
  it("refuse a found row with no address", async () => {
    await expect(
      getDb()
        .insert(uploadSourceGuesses)
        .values({ articleId: ARTICLE_ID, status: "found", host: "doi.org", kind: "canonical", matchedBy: "doi", finishedAt: new Date() }),
    ).rejects.toThrow();
  });

  it("refuse a canonical link that no identifier verified", async () => {
    await expect(
      getDb().insert(uploadSourceGuesses).values({
        articleId: ARTICLE_ID,
        status: "found",
        url: "https://example.org/p",
        host: "example.org",
        kind: "canonical",
        matchedBy: "content",
        finishedAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});

/* ---------------------------------------------------- payload, route -- */

describe("the owner's payload, the visitor's, and the route", () => {
  let scratch: ScratchArticle | undefined;

  beforeAll(async () => {
    scratch = await scratchArticleInPg(SCRATCH_SLUG, { ownerId: TEST_OWNER });
  }, 120_000);

  afterAll(async () => {
    await scratch?.remove();
  });

  it("is undefined until somebody has looked, and the stored guess once they have", async () => {
    const id = scratch?.articleId ?? "";
    await runAsOwner(TEST_OWNER, async () => {
      expect((await loadArticle(SCRATCH_SLUG)).sourceGuess).toBeUndefined();
    });
    await getDb().insert(uploadSourceGuesses).values({
      articleId: id,
      status: "found",
      url: FOUND.url,
      host: "doi.org",
      kind: "canonical",
      matchedBy: "doi",
      attempts: 1,
      finishedAt: new Date(),
    });
    await runAsOwner(TEST_OWNER, async () => {
      expect((await loadArticle(SCRATCH_SLUG)).sourceGuess).toEqual({
        status: "found",
        url: FOUND.url,
        host: "doi.org",
        kind: "canonical",
        matchedBy: "doi",
      });
    });
  });

  it("never reaches a visitor, even on a shared article", async () => {
    await getDb()
      .update(articles)
      .set({ visibility: "public", publicAt: new Date() })
      .where(eq(articles.slug, SCRATCH_SLUG));
    const shared = await pgPublicReader.loadArticle(SCRATCH_SLUG);
    /* The row from the case above is still there; neither the key nor the
       address may be anywhere in what a stranger is sent. */
    expect(await row(scratch?.articleId)).toMatchObject({ status: "found" });
    expect("sourceGuess" in shared).toBe(false);
    expect(JSON.stringify(shared)).not.toContain("10.1234/hpc.2024.5678");
  });

  it("the route refuses an article that was not uploaded with a 409, and a stranger's with a 404", async () => {
    const got = await post(`/api/source-guess/${SCRATCH_SLUG}`);
    expect(got.status).toBe(409);
    await expect(runAsOwner(EVAL_OWNER_ID, () => guessSource(SCRATCH_SLUG))).rejects.toMatchObject({ status: 404 });
  });
});

/** One POST through the real router, as the authenticated test owner. */
async function post(url: string): Promise<{ status: number; body: unknown }> {
  const req = Object.assign(
    (async function* () {
      yield* [Buffer.from("{}")];
    })(),
    { method: "POST", url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;
  let written = "";
  let status = 0;
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    writeHead(s: number) {
      status = s;
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
  return { status: status || (res as unknown as { statusCode: number }).statusCode, body: written ? JSON.parse(written) : null };
}
