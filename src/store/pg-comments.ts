/**
 * Comments in Postgres. Same semantics as src/comments.ts, enforced differently.
 *
 * The interesting difference is not the storage, it is what the storage makes
 * impossible. `src/comments.ts` reads the whole file, changes one entry and
 * writes it back — so two requests answering two comments on the same article
 * at the same time can lose one of them, and nothing reports it. Here each
 * comment is a row and the two writes do not touch.
 *
 * ## The anchor is the block IDENTITY
 *
 * `comments_identity_fk` points at `block_identities`, not at the current
 * revision's blocks. That is the whole design: a re-extraction can drop the
 * paragraph and the reader's question survives, because identities are never
 * deleted. `src/web/comment-nav.ts` already sorts such a comment to the end
 * rather than dropping it — "it is still the reader's question".
 *
 * The corollary is that the identity has to exist *before* the comment. It
 * always does for a block the reader can select, because stage 3 minted it. A
 * failure here therefore means something real — stage 3 re-minted ids instead
 * of carrying them forward — and it should fail loudly rather than insert.
 *
 * ## Order
 *
 * `comments.json` is an array in insertion order; a table has no order at all
 * until you ask for one. `created_at, id` reproduces insertion order for
 * anything written chronologically, and `id` breaks the tie so the answer is
 * deterministic rather than merely usually-right — two comments created inside
 * the same millisecond would otherwise swap places between requests.
 */

import { and, asc, eq } from "drizzle-orm";

import type { NewComment } from "../comments.js";
import { getDb } from "../db/client.js";
import { articles, comments as commentsTable } from "../db/schema.js";
import { isSpideryarnId, mintUniqueId } from "../ids.js";
import { log } from "../log.js";
import { currentOwnerId } from "../owner.js";
import type { Comment } from "../types.js";
import type { CommentStore } from "./contracts.js";

const logger = log("store");

/** The article's uuid, or a tagged 404 — the same shape src/api.ts throws. */
async function articleIdFor(slug: string): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({ id: articles.id })
    .from(articles)
    .where(eq(articles.slug, slug))
    .limit(1);
  const found = rows[0];
  if (!found) {
    throw Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
  }
  return found.id;
}

/** A row as the client sees it. Absent, not null — `exactOptionalPropertyTypes`. */
function toComment(row: typeof commentsTable.$inferSelect): Comment {
  return {
    id: row.id,
    blockId: row.blockId,
    quote: row.quote,
    start: row.start,
    createdAt: row.createdAt.toISOString(),
    status: row.status as Comment["status"],
    ...(row.answer === null ? {} : { answer: row.answer }),
    ...(row.citations === null ? {} : { citations: row.citations }),
    ...(row.searches === null ? {} : { searches: row.searches }),
    ...(row.model === null ? {} : { model: row.model }),
    ...(row.error === null ? {} : { error: row.error }),
  };
}

async function listFor(articleId: string): Promise<Comment[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(commentsTable)
    .where(eq(commentsTable.articleId, articleId))
    .orderBy(asc(commentsTable.createdAt), asc(commentsTable.id));
  return rows.map(toComment);
}

export const pgCommentStore: CommentStore = {
  async load(slug: string): Promise<Comment[]> {
    return listFor(await articleIdFor(slug));
  },

  /**
   * **Idempotent on `input.id`, and the reset is the whole point.**
   *
   * A retry sends the id it already has. That must reset the existing comment
   * rather than add a second one: a second row leaves the failed original
   * behind, drawing a second mark over the same words that nothing can clear —
   * and turns a double-clicked POST into two model calls with one orphaned.
   *
   * `createdAt` survives the reset, because the reader asked the question once.
   * Everything from the previous attempt — answer, citations, searches, model,
   * error — goes, because it belonged to the attempt being replaced.
   *
   * ## Why this is one statement and not select-then-branch
   *
   * The first version read the row, then either updated it or inserted, inside
   * a transaction. That is correct for a retry that arrives *after* the first
   * request finished, and wrong for one that arrives *during* it: a transaction
   * cannot lock a row that does not exist yet, so both requests see nothing and
   * both insert, and the second gets a raw uniqueness error that src/routes.ts
   * turns into a 500. The reader's question fails for a reason that is not
   * about their question. GPT Sol found it in review, 2026-08-26;
   * docs/plans/postgres-storage-review-sol.md.
   *
   * `on conflict (article_id, id) do update` is the fix, and it is the same
   * statement for both cases — Postgres serialises the second writer on the
   * key it is about to insert, then hands it the update. There is no window
   * left to lose, because there is no gap between looking and writing.
   *
   * `created_at` is deliberately absent from the `set`. Leaving it out is what
   * preserves it; adding it "for completeness" would silently restart the clock
   * on a question the reader asked once.
   */
  async create(slug: string, input: NewComment): Promise<Comment> {
    const db = getDb();
    const articleId = await articleIdFor(slug);
    const supplied = input.id !== undefined && isSpideryarnId(input.id) ? input.id : undefined;

    const fields = {
      blockId: input.blockId,
      quote: input.quote,
      start: input.start,
      status: "pending",
      answer: null,
      citations: null,
      searches: null,
      model: null,
      error: null,
    } as const;

    const write = async (id: string, tx: typeof db = db) => {
      const [row] = await tx
        .insert(commentsTable)
        .values({ articleId, id, ownerId: currentOwnerId(), ...fields })
        .onConflictDoUpdate({
          target: [commentsTable.articleId, commentsTable.id],
          set: fields,
        })
        .returning();
      // `row!`: an insert with `returning()` yields exactly the row it wrote,
      // and `do update` yields the row it updated. `noUncheckedIndexedAccess`
      // cannot know that either branch always produces one.
      return toComment(row!);
    };

    if (supplied) {
      const stored = await write(supplied);
      /* `reset` is read off `createdAt` rather than off which branch ran,
         because with one statement there are no branches to read. A row whose
         `created_at` predates this call is a row that already existed. The
         second is slack for clock skew between the app and the database; this
         is a log field, and being approximately right about a retry is worth
         more than a second round trip to be exactly right. */
      const age = Date.now() - new Date(stored.createdAt).getTime();
      logger.info(
        { slug, id: stored.id, blockId: stored.blockId, reset: age > 1000 },
        "comment created",
      );
      return stored;
    }

    /* No usable id from the client, so mint one. This half still has to look
       before it writes — you cannot ask Postgres for "an id nothing is using" —
       so it keeps the transaction, and it retries on a key collision.

       Minting needs the ids already taken FOR THIS ARTICLE. Block ids are
       unique only within an article and so are these; the primary key is
       `(article_id, id)`. Passing every comment id in the database would be
       both wrong and slower. */
    for (let attempt = 0; ; attempt++) {
      try {
        const stored = await db.transaction(async (tx) => {
          const takenRows = await tx
            .select({ id: commentsTable.id })
            .from(commentsTable)
            .where(eq(commentsTable.articleId, articleId));
          return write(mintUniqueId(new Set(takenRows.map((r) => r.id))), tx as typeof db);
        });
        logger.info(
          { slug, id: stored.id, blockId: stored.blockId, reset: false },
          "comment created",
        );
        return stored;
      } catch (err) {
        /* 23505 is unique_violation, and here it means two requests minted the
           same random id in the same instant — one chance in a billion, which
           at enough requests is a Tuesday. Anything else is a real failure and
           must not be swallowed: 23503 in particular is the block identity FK,
           which means stage 3 re-minted ids and has to be seen. */
        const code = (err as { code?: string }).code;
        if (code !== "23505" || attempt >= 2) throw err;
      }
    }
  },

  async patch(
    slug: string,
    id: string,
    patch: Partial<Comment>,
    opts: { quiet?: boolean } = {},
  ): Promise<Comment[]> {
    const db = getDb();
    const articleId = await articleIdFor(slug);

    /* `id` is deliberately not settable. src/comments.ts spreads `{ ...c,
       ...patch, id: c.id }` — the trailing `id` puts it back — so a patch
       carrying an id cannot rename a comment. Building the set explicitly is
       the same guarantee without depending on key order. */
    await db
      .update(commentsTable)
      .set({
        ...(patch.blockId === undefined ? {} : { blockId: patch.blockId }),
        ...(patch.quote === undefined ? {} : { quote: patch.quote }),
        ...(patch.start === undefined ? {} : { start: patch.start }),
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.answer === undefined ? {} : { answer: patch.answer }),
        ...(patch.citations === undefined ? {} : { citations: patch.citations }),
        ...(patch.searches === undefined ? {} : { searches: patch.searches }),
        ...(patch.model === undefined ? {} : { model: patch.model }),
        ...(patch.error === undefined ? {} : { error: patch.error }),
      })
      .where(and(eq(commentsTable.articleId, articleId), eq(commentsTable.id, id)));

    /* The stored `error` string is deliberately NOT logged. It is whatever
       `explain` threw, and one of the things `explain` throws carries 400
       characters of a provider's response body — which, for a provider that
       echoes the request back, contains the reader's selected quote and the
       prose around it. src/explain.ts logs its own failure line with the model,
       the status and the elapsed time, which is what actually diagnoses this. */
    if (patch.status === "error" && !opts.quiet) {
      logger.warn({ slug, id }, "comment answer failed");
    }

    return listFor(articleId);
  },

  async remove(slug: string, id: string): Promise<Comment[]> {
    const db = getDb();
    const articleId = await articleIdFor(slug);
    await db
      .delete(commentsTable)
      .where(and(eq(commentsTable.articleId, articleId), eq(commentsTable.id, id)));
    const remaining = await listFor(articleId);
    // Logged because it is destructive and there is no undo. `remaining` is the
    // count, so a delete that removed nothing — a stale id from a second tab —
    // can be told apart from one that did.
    logger.info({ slug, id, remaining: remaining.length }, "comment deleted");
    return remaining;
  },

  async count(slug: string): Promise<number> {
    const rows = await getDb()
      .select({ id: commentsTable.id })
      .from(commentsTable)
      .where(eq(commentsTable.articleId, await articleIdFor(slug)));
    return rows.length;
  },
};
