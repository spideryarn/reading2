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
 * **Both stores used to be here**, because they were allowed to differ and the
 * difference had to be pinned rather than assumed. The filesystem half went on
 * 2026-09-05 with the store it was about
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md,
 * the stage-G section), and all four of its cases had a counterpart here
 * already: *errors a pending comment nobody is answering* (§ *still errors an
 * attempt whose lease has run out* and § *errors a pending row that never had a
 * lease at all*), *spares one this process is answering* (§ *spares a fresh
 * answer swept by a machine that is not the one answering*), *leaves a bookmark
 * alone*, and *hands a comment left pending by a dead process to the next Try
 * again* (§ *lets Try again claim an abandoned attempt with no sweep first*).
 *
 * What went with them is the *asymmetry* — `CommentStore.sweepPending` in
 * src/store/contracts.ts explains why one store could get by on `keep` alone
 * and the other could not, and there is now only the one that could not.
 *
 * ## And the two interleavings the lease opened up
 *
 * A lease means a sweep can genuinely take a comment away from an attempt that
 * is still running, which is a second thing to get right and a second thing to
 * pin here. GPT Sol set both out in the final review, 2026-09-01:
 *
 * - **A buried attempt must not overwrite the one that replaced it.** Terminal
 *   writes carry the token `beginAnswer` returned, and a write from a superseded
 *   attempt matches no row.
 * - **An abandoned attempt must heal through *Try again*, with no `GET` first.**
 *   The sweep runs only on the comments `GET`; the retry button does not do one.
 *
 * The lease is aged **in SQL** rather than waited out — a `setTimeout` long
 * enough to be true would be two and a half minutes, and on a machine running
 * other suites it would be a test that sometimes fails for no reason.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";

import { COMMENT_SWEPT } from "../src/comments.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articles, blockIdentities, comments as commentsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import { pgCommentStore } from "../src/store/pg-comments.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/* ---------------------------------------------------------- and Postgres -- */

const SLUG = "comment-sweep-fixture";
/** Its own article, invisible to the library — tests/store-comments.test.ts § why. */
const ARTICLE_ID = "00000000-0000-4000-8000-0000000000c1";
const BLOCK_ID = "spya-aaa222";

await pgReady({
  suite: "tests/comment-sweep.test.ts",
  tables: ["spideryarn.comments"],
});

/**
 * Create, fail, retry — the only path that still produces a `pending` comment.
 *
 * The middle step is raw SQL because `patch` will no longer write a terminal
 * state onto a row no attempt has claimed; see `legacyAnswered` in
 * tests/store-comments.test.ts for the same fixture and the same reason.
 * Returns the attempt token, which the fence cases below need.
 */
async function nowPending(id: string): Promise<string | undefined> {
  await pgCommentStore.create(SLUG, { id, blockId: BLOCK_ID, quote: "the question", start: 3 });
  await getDb()
    .update(commentsTable)
    .set({ status: "error", error: "the model fell over" })
    .where(and(eq(commentsTable.articleId, ARTICLE_ID), eq(commentsTable.id, id)));
  return (await pgCommentStore.beginAnswer(SLUG, id)).attempt;
}

const statusOf = async (id: string) =>
  (await pgCommentStore.load(SLUG)).find((c) => c.id === id)?.status;

/**
 * Age the attempt's lease past its deadline, in SQL.
 *
 * The clock is on the row, so this is what "two and a half minutes went by"
 * looks like without a `setTimeout` — which on a shared machine is a test that
 * sometimes fails for reasons that are nothing to do with the code.
 * `clock_timestamp()`, not `now()`, which is frozen for the transaction —
 * tests/store-jobs-parity.test.ts caught that one by hand.
 */
const expire = (id: string) =>
  getDb()
    .update(commentsTable)
    .set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
    .where(and(eq(commentsTable.articleId, ARTICLE_ID), eq(commentsTable.id, id)));

describe("the Postgres comment sweep", () => {
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

  /**
   * **A buried attempt must not overwrite the one that replaced it.**
   *
   * The interleaving GPT Sol set out in the final review, 2026-09-01, and the
   * reason `patch` now carries the attempt token:
   *
   * 1. A begins, and stalls somewhere before the model call — a slow profile
   *    read, a cold lambda. There is no query timeout on that read.
   * 2. A `GET` on another machine finds A's lease expired and sweeps it.
   * 3. The reader presses Try again; B claims the row.
   * 4. A wakes up and writes its answer.
   *
   * Before the fence, step 4 landed: the `UPDATE` named the article and the
   * comment and nothing else. Run this against that version and B's answer is
   * replaced by A's while the reader is reading it.
   */
  it("refuses a buried attempt's answer, so it cannot overwrite the retry", async () => {
    const a = await nowPending("spya-swp777");
    await expire("spya-swp777");
    await pgCommentStore.sweepPending(SLUG, new Set()); // machine B's GET

    const b = await pgCommentStore.beginAnswer(SLUG, "spya-swp777"); // Try again
    expect(b.comment.status).toBe("pending");
    expect(b.attempt).not.toBe(a);

    const refused = await pgCommentStore.patch(
      SLUG,
      "spya-swp777",
      { status: "done", answer: "A's answer, hours late" },
      a,
    );
    // `undefined` is "you were superseded" — not an error, and not a write.
    expect(refused).toBeUndefined();
    expect(await statusOf("spya-swp777")).toBe("pending");

    // B still finishes, and B's answer is the one that is there.
    const kept = await pgCommentStore.patch(
      SLUG,
      "spya-swp777",
      { status: "done", answer: "B's answer" },
      b.attempt,
    );
    expect(kept?.find((c) => c.id === "spya-swp777")?.answer).toBe("B's answer");

    /* And A's *failure* is refused just as its success was. This is the half
       that would have been worse: A's `error` patch landing on a `done` row
       replaces a good answer with "the model fell over". */
    const alsoRefused = await pgCommentStore.patch(
      SLUG,
      "spya-swp777",
      { status: "error", error: "A finally gave up" },
      a,
    );
    expect(alsoRefused).toBeUndefined();
    const after = (await pgCommentStore.load(SLUG)).find((c) => c.id === "spya-swp777");
    expect(after?.status).toBe("done");
    expect(after?.answer).toBe("B's answer");
  });

  it("refuses a terminal write that carries no attempt at all", async () => {
    /* The token is optional in the interface because the filesystem store has
       none. A caller that simply forgot to carry it must not get identity-only
       writes back in silence — `pgSearchStore.finish` refuses for the same
       reason, and this is the assertion that the refusal is real.
     *
     * ## Asserted by its wording again, and the round trip is the point
     *
     * For a few hours on 2026-09-03 this asserted the *generic* sentence. Both
     * refusals were plain `Error`s — no `status`, no place on
     * `mayPassThrough`'s class list — so once `pgCommentStore` was guarded at
     * its own export the sentence naming which rule was broken was replaced by
     * the generic one on the way out. **That had been true of every request
     * production served since 2026-08-26**, and this file could not see it,
     * because it imported the raw object
     * (docs/postmortems/260901d-a-409-and-a-404-arrived-as-500.md).
     *
     * The open question then was whether these two deserved a `status` of their
     * own the way `CommentIdTaken` does, which is a reader-facing copy decision.
     * They now have one: `MissingAttempt` (src/store/contracts.ts) and the
     * `must end an answer` refusal beside it both carry `500`, which is
     * src/store/db-errors.ts § *"Adding another closed class: don't. Give it a
     * `status` instead."* So the naming sentence survives the guard, and this
     * asserts it.
     *
     * The consequence assertions below stay regardless, and are the half no
     * wording stands in for. */
    const attempt = await nowPending("spya-swp223");
    await expect(
      pgCommentStore.patch(SLUG, "spya-swp223", { status: "done", answer: "x" }),
    ).rejects.toThrow(/needs the attempt/);
    // And a patch that would leave the row `pending` while releasing the fence.
    await expect(
      pgCommentStore.patch(SLUG, "spya-swp223", { answer: "x" }, attempt),
    ).rejects.toThrow(/must end an answer/);
    /* The harm the two refusals exist to prevent, which no wording stands in
       for: neither write reached the row. It is still pending, still fenced,
       and carries none of the answer either call tried to put on it. */
    const row = (await pgCommentStore.load(SLUG)).find((c) => c.id === "spya-swp223");
    expect(row?.status).toBe("pending");
    expect(row?.answer).toBeUndefined();
  });

  /**
   * **The second half of Sol's finding 2: Retry heals without a `GET`.**
   *
   * Sweeping happens only on the comments `GET`, and *Try again* posts straight
   * at the answer endpoint. So the claim itself has to be able to take an
   * abandoned row — otherwise an open page 409s for ever and only a reload
   * fixes it. No sweep is called anywhere in this test, deliberately.
   */
  it("lets Try again claim an abandoned attempt with no sweep first", async () => {
    await nowPending("spya-swq444");
    await expire("spya-swq444"); // the answering machine died

    const { comment, attempt } = await pgCommentStore.beginAnswer(SLUG, "spya-swq444");

    expect(comment.status).toBe("pending");
    expect(attempt).toBeDefined();
    // The previous attempt's error went with it — this is a fresh attempt.
    expect("error" in comment).toBe(false);
  });

  it("claims a pending row that never had a lease at all", async () => {
    // Imported, or begun before the column existed. Whatever process started it
    // is long gone — the same rule the sweep applies to the same row.
    await nowPending("spya-swr444");
    await getDb()
      .update(commentsTable)
      .set({ attemptId: null, leaseExpiresAt: null })
      .where(eq(commentsTable.id, "spya-swr444"));

    expect((await pgCommentStore.beginAnswer(SLUG, "spya-swr444")).comment.status).toBe(
      "pending",
    );
  });

  it("still refuses a retry while the lease is live", async () => {
    /* The guard on the reclaim, and without it the reclaim is the 2026-08-28
       bug back again: two presses of Try again buying two model calls. */
    await nowPending("spya-sws555");
    await expect(pgCommentStore.beginAnswer(SLUG, "spya-sws555")).rejects.toThrow(
      /already being answered/,
    );
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
