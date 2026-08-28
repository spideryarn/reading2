/**
 * The Postgres comment store, held to `src/comments.ts`'s semantics.
 *
 * Not a parity test — those compare reads, and these are writes with side
 * effects. What matters here is the behaviour the filesystem version documents
 * at length and that a row-per-comment implementation could easily lose:
 * the reset-on-retry, the surviving `createdAt`, the id that a patch cannot
 * rename, and the anchor pointing at the block IDENTITY rather than at the
 * current revision's blocks.
 *
 * ## Why it builds its own article
 *
 * It would be easier to write comments onto one of the imported articles. It
 * would also make tests/store-parity.test.ts flaky: that suite compares the
 * filesystem's comments against Postgres's for every article under `data/`, so
 * a comment this file adds — even for a moment, since vitest runs files
 * concurrently — is a comment the filesystem does not have.
 *
 * So this builds an article that is invisible to the library: a row with **no
 * current revision**. `listArticles` inner-joins on `current_revision_id`, so
 * nothing lists it, while `articleIdFor` still resolves it by slug. Cleanup
 * then only has to remove what this file made.
 *
 * Skips loudly when there is no database — see tests/db-schema.test.ts.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

import { CommentIdTaken, NotAnExplanation } from "../src/comments.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articles, blockIdentities, comments as commentsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import { pgCommentStore } from "../src/store/pg-comments.js";

loadEnvLocal();

const SLUG = "store-comments-fixture";
const ARTICLE_ID = "00000000-0000-4000-8000-0000000000c0";
const BLOCK_ID = "spya-aaa222";
/** A block id that exists as an identity but is in no revision — see the last test. */
const ORPHAN_BLOCK_ID = "spya-bbb333";

let reachable = false;

if (process.env.DATABASE_URL) {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  let why = "";
  try {
    const probe = await pool.query("select to_regclass('spideryarn.comments') is not null as ready");
    reachable = probe.rows[0]?.ready === true;
    if (!reachable) why = "the spideryarn schema is not there — run npm run db:migrate";
  } catch (err) {
    reachable = false;
    why = `could not reach it: ${(err as Error).message}`;
  }
  await pool.end();
  if (!reachable) {
    console.warn(`\n  ⚠ DATABASE_URL is set but these tests are skipping: ${why}\n`);
  }
}

const when = reachable ? describe : describe.skip;

when("the Postgres comment store", () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(articles)
      // No `currentRevisionId`, so the library cannot see it. See the header.
      .values({ id: ARTICLE_ID, ownerId: currentOwnerId(), slug: SLUG })
      .onConflictDoNothing();
    await db
      .insert(blockIdentities)
      .values([
        { articleId: ARTICLE_ID, blockId: BLOCK_ID },
        { articleId: ARTICLE_ID, blockId: ORPHAN_BLOCK_ID },
      ])
      .onConflictDoNothing();
    await db.delete(commentsTable).where(eq(commentsTable.articleId, ARTICLE_ID));
  });

  afterAll(async () => {
    const db = getDb();
    // Comments cascade from the article, but delete them explicitly anyway:
    // a cleanup that depends on a cascade is a cleanup that stops working the
    // day somebody changes the cascade.
    await db.delete(commentsTable).where(eq(commentsTable.articleId, ARTICLE_ID));
    await db.delete(blockIdentities).where(eq(blockIdentities.articleId, ARTICLE_ID));
    await db.delete(articles).where(eq(articles.id, ARTICLE_ID));
    await closeDb();
  });

  it("stores a comment as free — no model call was ever attempted", async () => {
    const stored = await pgCommentStore.create(SLUG, {
      id: "spya-ccc444",
      blockId: BLOCK_ID,
      quote: "a stretch of prose",
      start: 12,
    });
    expect(stored.status).toBe("none");
    expect(stored.id).toBe("spya-ccc444");
    // Absent, not null: `exactOptionalPropertyTypes` is on and the wire form of
    // `{answer: null}` is not the wire form of `{}`. The same is true of all
    // three of the reader's fields, which is what the round-trip compares on.
    expect("answer" in stored).toBe(false);
    expect("error" in stored).toBe(false);
    expect("body" in stored).toBe(false);
    expect("updatedAt" in stored).toBe(false);
    expect("threadId" in stored).toBe(false);
  });

  it("carries the reader's words to Postgres and back", async () => {
    const stored = await pgCommentStore.create(SLUG, {
      id: "spya-bqd234",
      blockId: BLOCK_ID,
      quote: "a stretch of prose",
      start: 12,
      body: "this is the bit I doubt",
    });
    expect(stored.body).toBe("this is the bit I doubt");
    // Off a fresh read rather than off the insert's `returning()`, because
    // `toComment` is the seam and a returning row could be right while the
    // column mapping on the read path is wrong.
    const read = (await pgCommentStore.load(SLUG)).find((c) => c.id === "spya-bqd234");
    expect(read?.body).toBe("this is the bit I doubt");
  });

  it("edits the body, and clearing it leaves the mark", async () => {
    await pgCommentStore.create(SLUG, {
      id: "spya-bqd345",
      blockId: BLOCK_ID,
      quote: "a stretch of prose",
      start: 12,
      body: "first",
    });
    const edited = await pgCommentStore.patchBody(SLUG, "spya-bqd345", "second");
    expect(edited.body).toBe("second");
    expect(edited.updatedAt).toBeDefined();
    const cleared = await pgCommentStore.patchBody(SLUG, "spya-bqd345", null);
    expect("body" in cleared).toBe(false);
    expect((await pgCommentStore.load(SLUG)).some((c) => c.id === "spya-bqd345")).toBe(true);
  });

  it("links to one conversation, and refuses to be re-pointed", async () => {
    await pgCommentStore.create(SLUG, {
      id: "spya-knz456",
      blockId: BLOCK_ID,
      quote: "a stretch of prose",
      start: 12,
    });
    const at = { blockId: BLOCK_ID, quote: "a stretch of prose", start: 12 };
    expect(
      (await pgCommentStore.linkThread(SLUG, "spya-knz456", "spya-t2t2t2", at)).threadId,
    ).toBe("spya-t2t2t2");
    // The same link again is the client retrying: a no-op, reported as success.
    expect(
      (await pgCommentStore.linkThread(SLUG, "spya-knz456", "spya-t2t2t2", at)).threadId,
    ).toBe("spya-t2t2t2");
    // A different one would orphan the first conversation.
    await expect(
      pgCommentStore.linkThread(SLUG, "spya-knz456", "spya-t3t3t3", at),
    ).rejects.toBeInstanceOf(CommentIdTaken);
    // And a link naming a comment that is not about this passage is refused.
    await expect(
      pgCommentStore.linkThread(SLUG, "spya-knz456", "spya-t2t2t2", { ...at, quote: "elsewhere" }),
    ).rejects.toBeInstanceOf(CommentIdTaken);
  });

  it("mints an id when the client does not supply one", async () => {
    const stored = await pgCommentStore.create(SLUG, {
      blockId: BLOCK_ID,
      quote: "another",
      start: 0,
    });
    expect(stored.id).toMatch(/^spya-[a-z][a-z0-9]{5}$/);
  });

  it("resets in place on a retry, keeping everything the reader owns", async () => {
    const first = await pgCommentStore.create(SLUG, {
      id: "spya-ddd555",
      blockId: BLOCK_ID,
      quote: "the question",
      start: 3,
      body: "my note",
    });
    await pgCommentStore.linkThread(SLUG, "spya-ddd555", "spya-t4t4t4", {
      blockId: BLOCK_ID,
      quote: "the question",
      start: 3,
    });
    await pgCommentStore.patch(SLUG, "spya-ddd555", {
      status: "error",
      error: "the model fell over",
    });

    const before = (await pgCommentStore.load(SLUG)).length;
    const retried = await pgCommentStore.beginAnswer(SLUG, "spya-ddd555");
    const after = await pgCommentStore.load(SLUG);

    // A second row would leave the failed original behind, drawing a second
    // mark over the same words that nothing can clear — and would turn a
    // double-clicked POST into two model calls with one orphaned.
    expect(after.length).toBe(before);
    expect(retried.status).toBe("pending");
    // The previous attempt's error goes; it belonged to the attempt replaced.
    expect("error" in retried).toBe(false);
    // `createdAt` stays, because the reader marked the passage once.
    expect(retried.createdAt).toBe(first.createdAt);
    /* **And the reader's three survive.** This is the bug the split exists to
       prevent: the old `create` rebuilt the row from a named `fields` object,
       so a retry — which sends only the anchor — blanked the body and the link
       in the same statement that cleared the answer. GPT Sol, 2026-08-28. */
    expect(retried.body).toBe("my note");
    expect(retried.threadId).toBe("spya-t4t4t4");
  });

  it("refuses a stored id rather than overwriting the comment under it", async () => {
    await pgCommentStore.create(SLUG, {
      id: "spya-cks567",
      blockId: BLOCK_ID,
      quote: "the first one",
      start: 0,
    });
    await expect(
      pgCommentStore.create(SLUG, {
        id: "spya-cks567",
        blockId: BLOCK_ID,
        quote: "something else entirely",
        start: 1,
      }),
    ).rejects.toBeInstanceOf(CommentIdTaken);
    const stored = (await pgCommentStore.load(SLUG)).find((c) => c.id === "spya-cks567");
    expect(stored?.quote).toBe("the first one");
  });

  it("refuses a second answer while one is already running", async () => {
    await pgCommentStore.create(SLUG, {
      id: "spya-run999",
      blockId: BLOCK_ID,
      quote: "the question",
      start: 3,
    });
    await pgCommentStore.patch(SLUG, "spya-run999", { status: "done", answer: "old" });
    await pgCommentStore.beginAnswer(SLUG, "spya-run999"); // now pending
    await expect(pgCommentStore.beginAnswer(SLUG, "spya-run999")).rejects.toThrow(
      /already being answered/,
    );
  });

  it("will not answer a comment that was never a question", async () => {
    await pgCommentStore.create(SLUG, {
      id: "spya-fre889",
      blockId: BLOCK_ID,
      quote: "a bookmark",
      start: 0,
    });
    await expect(pgCommentStore.beginAnswer(SLUG, "spya-fre889")).rejects.toBeInstanceOf(
      NotAnExplanation,
    );
  });

  it("does not let a patch rename a comment", async () => {
    await pgCommentStore.create(SLUG, {
      id: "spya-eee666",
      blockId: BLOCK_ID,
      quote: "q",
      start: 0,
    });
    // src/comments.ts spreads `{...c, ...patch, id: c.id}` — the trailing `id`
    // puts it back. That guarantee must not depend on key order, so it is
    // asserted rather than assumed.
    await pgCommentStore.patch(SLUG, "spya-eee666", {
      id: "spya-fff777",
      status: "done",
      answer: "an answer",
    } as never);
    const all = await pgCommentStore.load(SLUG);
    expect(all.find((c) => c.id === "spya-eee666")?.answer).toBe("an answer");
    expect(all.some((c) => c.id === "spya-fff777")).toBe(false);
  });

  it("counts without loading, and removes", async () => {
    const before = await pgCommentStore.count(SLUG);
    expect(before).toBe((await pgCommentStore.load(SLUG)).length);
    await pgCommentStore.remove(SLUG, "spya-eee666");
    expect(await pgCommentStore.count(SLUG)).toBe(before - 1);
  });

  it("keeps a comment whose block is in no revision — the whole point of identities", async () => {
    /* This is the design the schema was rearranged for. A re-extraction that
       drops a paragraph must not destroy the reader's question about it:
       `comments_identity_fk` points at `block_identities`, which never loses a
       row, NOT at the current revision's blocks. src/web/comment-nav.ts already
       sorts such a comment to the end rather than dropping it, because it is
       still the reader's question. */
    const stored = await pgCommentStore.create(SLUG, {
      id: "spya-ggg888",
      blockId: ORPHAN_BLOCK_ID,
      quote: "a paragraph that no longer exists",
      start: 0,
    });
    expect(stored.blockId).toBe(ORPHAN_BLOCK_ID);
    expect((await pgCommentStore.load(SLUG)).some((c) => c.id === "spya-ggg888")).toBe(true);
  });

  it("refuses a comment on a block id that was never minted", async () => {
    /* The FK firing here means something real: stage 3 re-minted ids instead of
       carrying them forward. It must fail loudly rather than insert a comment
       anchored to nothing. */
    await expect(
      pgCommentStore.create(SLUG, {
        id: "spya-hhh999",
        blockId: "spya-zzz999",
        quote: "anchored to nothing",
        start: 0,
      }),
    ).rejects.toThrow();
  });

  it("survives a create arriving while an identical one is uncommitted", async () => {
    /* The collision tests above send the two creates one after the other, and
       that is the easy half. The hard half is the same two requests
       overlapping: a double-clicked Save, or the client retrying while the
       first request is still in flight. Both transactions look for the row,
       both find nothing — a transaction cannot lock a row that does not exist
       yet — and both insert. GPT Sol found this in review, 2026-08-26.

       The primary key stops the second row, so the damage was never corruption;
       it was the second request failing with a raw uniqueness error, which
       src/routes.ts turns into a 500. The reader sees their comment fail for a
       reason that has nothing to do with their comment.

       **What changed on 2026-08-28**: the fix used to be `on conflict do
       update`, which made the second request *overwrite* the first. That is
       right for a retry of a model call and wrong for a free comment, where a
       collision may be somebody else's mark. It is now `do nothing` plus a
       read, and this test says what that must mean: an identical create is the
       same Save arriving twice and returns the stored row.

       **Two concurrent `create` calls do not reproduce it.** I tried that
       first: they pass either way, because each transaction is short enough
       that Node happens to run them end to end. A test that cannot fail proves
       nothing, so this holds the losing side open by hand — an uncommitted row
       nobody can see, which is exactly the window the bug lives in. */
    const id = "spya-jjj000";
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const db = getDb();
    const holder = db.transaction(async (tx) => {
      await tx.insert(commentsTable).values({
        articleId: ARTICLE_ID,
        id,
        ownerId: currentOwnerId(),
        blockId: BLOCK_ID,
        quote: "the same passage",
        start: 7,
        status: "none",
      });
      await held; // the row exists, and nothing outside this transaction can see it
    });

    const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
    await settle();
    const second = pgCommentStore.create(SLUG, {
      id,
      blockId: BLOCK_ID,
      quote: "the same passage",
      start: 7,
    });
    await settle(); // long enough for the second insert to be blocking on the key
    release();
    await holder;

    const stored = await second;
    expect(stored.id).toBe(id);
    expect(stored.status).toBe("none");
    // The stored row comes back — not an exception, and not a second row.
    expect(stored.quote).toBe("the same passage");
    expect((await pgCommentStore.load(SLUG)).filter((c) => c.id === id)).toHaveLength(1);
  });

  it("turns a losing concurrent create into a refusal, not a raw key error", async () => {
    /* The other half of the race, and the one the reader must never see as a
       500: two *different* comments minting the same id at the same instant.
       The answer is a `CommentIdTaken` — which src/routes.ts maps to a 409 —
       rather than Postgres's `23505` arriving as an unhandled fault. */
    const id = "spya-jjk222";
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const db = getDb();
    const holder = db.transaction(async (tx) => {
      await tx.insert(commentsTable).values({
        articleId: ARTICLE_ID,
        id,
        ownerId: currentOwnerId(),
        blockId: BLOCK_ID,
        quote: "the first reader's passage",
        start: 7,
        status: "none",
      });
      await held;
    });

    const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
    await settle();
    const second = pgCommentStore
      .create(SLUG, { id, blockId: BLOCK_ID, quote: "a different passage", start: 2 })
      .then(
        () => "resolved",
        (e: unknown) => e,
      );
    await settle();
    release();
    await holder;

    expect(await second).toBeInstanceOf(CommentIdTaken);
    // And the row that got there first is exactly as it was.
    const stored = (await pgCommentStore.load(SLUG)).find((c) => c.id === id);
    expect(stored?.quote).toBe("the first reader's passage");
  });

  it("404s for an article that is not there", async () => {
    await expect(pgCommentStore.load("no-such-article-at-all")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("leaves no comment attached to another article", async () => {
    // `(article_id, id)` is the primary key, never `id` alone. A global key
    // would start rejecting valid ids at around a hundred articles, and a
    // global upsert would overwrite one article's comment with another's.
    const db = getDb();
    const strays = await db
      .select()
      .from(commentsTable)
      .where(and(eq(commentsTable.articleId, ARTICLE_ID), eq(commentsTable.blockId, "spya-zzz999")));
    expect(strays).toEqual([]);
  });
});
