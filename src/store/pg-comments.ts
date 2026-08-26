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
   */
  async create(slug: string, input: NewComment): Promise<Comment> {
    const db = getDb();
    const articleId = await articleIdFor(slug);

    return db.transaction(async (tx) => {
      const existingRows = input.id
        ? await tx
            .select()
            .from(commentsTable)
            .where(and(eq(commentsTable.articleId, articleId), eq(commentsTable.id, input.id)))
            .limit(1)
        : [];
      const existing = existingRows[0];

      if (existing) {
        const [updated] = await tx
          .update(commentsTable)
          .set({
            blockId: input.blockId,
            quote: input.quote,
            start: input.start,
            status: "pending",
            answer: null,
            citations: null,
            searches: null,
            model: null,
            error: null,
          })
          .where(and(eq(commentsTable.articleId, articleId), eq(commentsTable.id, existing.id)))
          .returning();
        // `updated!`: the row was selected in this transaction a moment ago, so
        // the update matched it. `noUncheckedIndexedAccess` cannot know that.
        const stored = toComment(updated!);
        logger.info(
          { slug, id: stored.id, blockId: stored.blockId, reset: true },
          "comment created",
        );
        return stored;
      }

      /* Minting needs the ids already taken FOR THIS ARTICLE. Block ids are
         unique only within an article and so are these — the primary key is
         `(article_id, id)`. Passing every comment id in the database would be
         both wrong and slower. */
      const takenRows = await tx
        .select({ id: commentsTable.id })
        .from(commentsTable)
        .where(eq(commentsTable.articleId, articleId));
      const taken = new Set(takenRows.map((r) => r.id));

      const id =
        input.id !== undefined && isSpideryarnId(input.id) ? input.id : mintUniqueId(taken);

      const [inserted] = await tx
        .insert(commentsTable)
        .values({
          articleId,
          id,
          ownerId: currentOwnerId(),
          blockId: input.blockId,
          quote: input.quote,
          start: input.start,
          status: "pending",
        })
        .returning();

      // `inserted!`: an insert with `returning()` yields exactly the row it wrote.
      const stored = toComment(inserted!);
      logger.info(
        { slug, id: stored.id, blockId: stored.blockId, reset: false },
        "comment created",
      );
      return stored;
    });
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
