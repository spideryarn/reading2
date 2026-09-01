/**
 * The comment sweep, and the one thing it must not do on Vercel.
 *
 * `sweepOrphaned` in src/routes.ts used to decide "is anybody answering this?"
 * from a module-scope `Map` — a fact about *this process*. Every request on
 * Vercel may land on a different machine and they share nothing, so a
 * `GET /api/comments/:slug` arriving on machine B while machine A streamed an
 * answer for that same comment saw a `pending` row nobody *local* was working
 * on and immediately patched it to `error` — while the reader watched the words
 * arrive.
 *
 * The reproduction needs no second process. The fault is that the sweep
 * consulted process-local state, so sweeping **without** the local `keep` entry
 * is exactly what machine B does, and the honest question is whether a freshly
 * begun answer survives it. Before the fix it did not.
 *
 * The complement matters just as much: a comment whose lease has run out must
 * still be swept, or the bug has been traded for a leak — a spinner that spins
 * for ever because nothing will ever declare the attempt dead.
 *
 * Both stores are here, because they are allowed to differ and the difference
 * has to be pinned rather than assumed. See `CommentStore.sweepPending` in
 * src/store/contracts.ts.
 */

import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import {
  COMMENT_SWEPT,
  createComment,
  beginAnswer as fsBeginAnswer,
  patchComment,
  sweepPendingComments,
} from "../src/comments.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articles, blockIdentities, comments as commentsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import { pgCommentStore } from "../src/store/pg-comments.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/* ------------------------------------------------------- the filesystem -- */

const FS_SLUG = "test-comment-sweep-fixture";
const FS_DIR = path.resolve(import.meta.dirname, "..", "data", FS_SLUG);
const anchor = { blockId: "spya-k3m9qt", quote: "the hard problem", start: 12 };

describe("the filesystem comment sweep", () => {
  afterEach(() => rm(FS_DIR, { recursive: true, force: true }));

  it("errors a pending comment nobody is answering", async () => {
    const made = await createComment(FS_SLUG, { ...anchor, id: "spya-fsa999" });
    await patchComment(FS_SLUG, made.id, { status: "error", error: "the model fell over" });
    await fsBeginAnswer(FS_SLUG, made.id);

    const [swept] = await sweepPendingComments(FS_SLUG, new Set());

    expect(swept?.status).toBe("error");
    expect(swept?.error).toBe(COMMENT_SWEPT);
  });

  it("spares one this process is answering", async () => {
    const made = await createComment(FS_SLUG, { ...anchor, id: "spya-fsb222" });
    await patchComment(FS_SLUG, made.id, { status: "error", error: "the model fell over" });
    await fsBeginAnswer(FS_SLUG, made.id);

    const [kept] = await sweepPendingComments(FS_SLUG, new Set([made.id]));

    expect(kept?.status).toBe("pending");
  });

  it("leaves a bookmark alone — it was never an answer that failed to arrive", async () => {
    await createComment(FS_SLUG, { ...anchor, id: "spya-fsc333" });
    const [free] = await sweepPendingComments(FS_SLUG, new Set());
    expect(free?.status).toBe("none");
  });
});

/* ---------------------------------------------------------- and Postgres -- */

const SLUG = "comment-sweep-fixture";
/** Its own article, invisible to the library — tests/store-comments.test.ts § why. */
const ARTICLE_ID = "00000000-0000-4000-8000-0000000000c1";
const BLOCK_ID = "spya-aaa222";

const { reachable } = await pgReady({
  suite: "tests/comment-sweep.test.ts",
  tables: ["spideryarn.comments"],
});

const when = reachable ? describe : describe.skip;

/** Create, fail, retry — the only path that still produces a `pending` comment. */
async function nowPending(id: string): Promise<void> {
  await pgCommentStore.create(SLUG, { id, blockId: BLOCK_ID, quote: "the question", start: 3 });
  await pgCommentStore.patch(SLUG, id, { status: "error", error: "the model fell over" });
  await pgCommentStore.beginAnswer(SLUG, id);
}

const statusOf = async (id: string) =>
  (await pgCommentStore.load(SLUG)).find((c) => c.id === id)?.status;

when("the Postgres comment sweep", () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(articles)
      .values({ id: ARTICLE_ID, ownerId: currentOwnerId(), slug: SLUG })
      .onConflictDoNothing();
    await db
      .insert(blockIdentities)
      .values({ articleId: ARTICLE_ID, blockId: BLOCK_ID })
      .onConflictDoNothing();
    await db.delete(commentsTable).where(eq(commentsTable.articleId, ARTICLE_ID));
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(commentsTable).where(eq(commentsTable.articleId, ARTICLE_ID));
    await db.delete(blockIdentities).where(eq(blockIdentities.articleId, ARTICLE_ID));
    await db.delete(articles).where(eq(articles.id, ARTICLE_ID));
    await closeDb();
  });

  afterEach(async () => {
    await getDb().delete(commentsTable).where(eq(commentsTable.articleId, ARTICLE_ID));
  });

  /**
   * **The cross-process reproduction, and the whole reason this file exists.**
   *
   * An empty `keep` is not a contrived state — it is what every machine except
   * the one holding the stream sees, and on Vercel that is most of them. The
   * answer is arriving; the sweep must not touch it.
   */
  it("spares a fresh answer swept by a machine that is not the one answering", async () => {
    await nowPending("spya-swp999");

    await pgCommentStore.sweepPending(SLUG, new Set());

    expect(await statusOf("spya-swp999")).toBe("pending");
  });

  /**
   * The complement. Without this the fix above is a leak: `pending` for ever,
   * a spinner that never resolves, and no way to retry.
   */
  it("still errors an attempt whose lease has run out", async () => {
    await nowPending("spya-swp222");
    // The attempt's clock is on the row, so age it there rather than waiting
    // out a two-and-a-half-minute lease. `clock_timestamp()`, not `now()`,
    // which is frozen for the transaction — tests/store-jobs-parity.test.ts.
    await getDb()
      .update(commentsTable)
      .set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(commentsTable.id, "spya-swp222"));

    const after = await pgCommentStore.sweepPending(SLUG, new Set());

    const swept = after.find((c) => c.id === "spya-swp222");
    expect(swept?.status).toBe("error");
    expect(swept?.error).toBe(COMMENT_SWEPT);
  });

  it("spares an expired lease this very process is still writing", async () => {
    // `keep` is the half a clock cannot supply: a four-minute answer must not
    // be killed by the server producing it. `SweepOptions` in
    // src/store/contracts.ts — each guard alone is a bug.
    await nowPending("spya-swp333");
    await getDb()
      .update(commentsTable)
      .set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 hour'` })
      .where(eq(commentsTable.id, "spya-swp333"));

    await pgCommentStore.sweepPending(SLUG, new Set(["spya-swp333"]));

    expect(await statusOf("spya-swp333")).toBe("pending");
  });

  it("errors a pending row that never had a lease at all", async () => {
    // An imported comment, or one written before the lease existed. Whatever
    // process began it is long gone — the same rule pg-searches.ts states for
    // a `pending` row with no attempt.
    await nowPending("spya-swp444");
    await getDb()
      .update(commentsTable)
      .set({ attemptId: null, leaseExpiresAt: null })
      .where(eq(commentsTable.id, "spya-swp444"));

    await pgCommentStore.sweepPending(SLUG, new Set());

    expect(await statusOf("spya-swp444")).toBe("error");
  });

  it("clears the dead attempt's fence, so no row keeps a lease nobody holds", async () => {
    await nowPending("spya-swp555");
    await getDb()
      .update(commentsTable)
      .set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(commentsTable.id, "spya-swp555"));

    await pgCommentStore.sweepPending(SLUG, new Set());

    const [row] = await getDb()
      .select({ attemptId: commentsTable.attemptId, lease: commentsTable.leaseExpiresAt })
      .from(commentsTable)
      .where(eq(commentsTable.id, "spya-swp555"));
    expect(row?.attemptId).toBeNull();
    expect(row?.lease).toBeNull();
  });

  it("leaves a bookmark alone, and an article with no comments at all", async () => {
    // `notInArray(col, [])` compiles to the literal `true` in Drizzle rather
    // than to a `not in ()` syntax error — pinned because the behaviour is
    // worth holding whatever the reason it works.
    expect(await pgCommentStore.sweepPending(SLUG, new Set())).toEqual([]);

    await pgCommentStore.create(SLUG, {
      id: "spya-swp666",
      blockId: BLOCK_ID,
      quote: "a bookmark",
      start: 0,
    });
    await pgCommentStore.sweepPending(SLUG, new Set());
    expect(await statusOf("spya-swp666")).toBe("none");
  });
});
