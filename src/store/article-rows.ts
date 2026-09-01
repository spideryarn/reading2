/**
 * **One owner-scoped walk over everything that hangs off an article**, returned
 * as the rows Postgres actually holds.
 *
 * Two things read an article whole: [`export.ts`](export.ts), which is the
 * rollback and projects these rows into the filesystem store's legacy layout,
 * and the export bundle the reader downloads, which projects them faithfully.
 * The thing worth sharing between those two is **the queries** — the join, the
 * owner filter, and the orderings — not a synthesized middle model, because the
 * rows are already the faithful representation and a second one would have to
 * be both rich enough for the bundle and lossily projectable back to a format
 * that is pinned byte for byte.
 *
 * That pinning is the whole reason this file does no shaping of its own.
 * `tests/store-roundtrip.test.ts` compares the rollback's output against what
 * the filesystem store writes, so the legacy projection is deliberately lossy —
 * a `candidates` thread comes out as `chat`, `passages` and `interrupted` are
 * dropped, `extractedHtml` is never written — and **it cannot be enriched in
 * place**. Anything that "improves" a value on the way out of here changes the
 * rollback. Give the caller the row; let the caller lose what it must.
 * docs/plans/260901h-export-article-data.md § The design.
 */

import { asc, eq } from "drizzle-orm";

import { getDb } from "../db/client.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  chatMessages,
  chatThreads,
  comments as commentsTable,
  glossaryLookups,
  refereeClaims,
  refereeCriteria,
  revisionBlocks,
  searchRuns,
} from "../db/schema.js";
import { ownedSlug } from "./owned-slug.js";

/**
 * No article of this reader's by that slug, or one with no current revision.
 *
 * **A type rather than a message**, because a caller has to be able to tell it
 * apart. `exportArticle` threw a plain `Error` here, which a route can only turn
 * into a 500 — and "somebody else's slug" is a 404: the reader asked for
 * something that, as far as they are concerned, does not exist. Note the two
 * cases are deliberately one: an article whose current revision is missing is
 * not something to explain to a stranger, and distinguishing them out loud would
 * tell them a slug they cannot see does exist.
 */
export class ArticleNotFound extends Error {
  readonly slug: string;

  constructor(slug: string) {
    /* The wording is the one `exportArticle` has always thrown. `npm run
       db:export`'s output is somebody's rollback log; there is no reason to
       change what it says. */
    super(`${slug}: no article with a current revision in Postgres`);
    this.name = "ArticleNotFound";
    this.slug = slug;
  }
}

/**
 * Every row of one article, as Postgres holds it.
 *
 * Keyed by the Drizzle table, and typed by `$inferSelect` rather than by a
 * hand-written interface, so a column added to the schema arrives here without
 * anybody remembering to add it — which is how `tools`, `stance`, `criterionId`
 * and `valence` each went missing from an export for a while.
 */
export interface ArticleRows {
  readonly article: typeof articles.$inferSelect;
  /** The CURRENT revision only. Older ones are history — see `readArticleRows`. */
  readonly revision: typeof articleRevisions.$inferSelect;
  /** **In document order.** See the ordering note on `readArticleRows`. */
  readonly blocks: readonly (typeof revisionBlocks.$inferSelect)[];
  /**
   * Every block id this article has ever minted, including ones no longer in
   * the current revision.
   *
   * **Not read by the rollback**, which declares the table `exported: false`
   * because stage 3 recovers ids from `output/<slug>.html`. That reasoning holds
   * for re-ingestion and fails for anchor integrity: a comment or a chat thread
   * can point at a block that has since left the article, so a bundle without
   * these rows contains anchors pointing at nothing.
   */
  readonly blockIdentities: readonly (typeof blockIdentities.$inferSelect)[];
  readonly comments: readonly (typeof commentsTable.$inferSelect)[];
  readonly chatThreads: readonly (typeof chatThreads.$inferSelect)[];
  /**
   * Every message of every thread, flat. Ordered by thread and then `ordinal`,
   * so filtering to one thread leaves that thread's messages in order.
   */
  readonly chatMessages: readonly (typeof chatMessages.$inferSelect)[];
  readonly searchRuns: readonly (typeof searchRuns.$inferSelect)[];
  readonly refereeCriteria: readonly (typeof refereeCriteria.$inferSelect)[];
  /**
   * At most one row — `referee_claims.article_id` is its primary key. An array
   * because every other member here is one, and because the caller reading
   * `[0]` says what the shape is at the point it matters.
   */
  readonly refereeClaims: readonly (typeof refereeClaims.$inferSelect)[];
  readonly glossaryLookups: readonly (typeof glossaryLookups.$inferSelect)[];
}

/**
 * Read one article whole, **owner-scoped**, or throw `ArticleNotFound`.
 *
 * `ownedSlug` and nothing else: `articles.slug` is globally unique, so
 * `eq(articles.slug, …)` on its own finds anybody's article and the failure is
 * silent in the worst way — the query works and a real article comes back.
 * [`owned-slug.ts`](owned-slug.ts) has the long version.
 *
 * ## Only the current revision
 *
 * A rollback wants the article as it is being served, not an archive, and the
 * bundle makes the same product choice deliberately rather than out of
 * necessity — revisions do carry lineage (`basedOnRevisionId`).
 *
 * ## The orderings, all of which are load-bearing
 *
 * - **Blocks by `ordinal`.** This is the whole ballgame. Block ids are random
 *   and carry no position (docs/project/block-ids.md), so a missing ORDER BY
 *   here silently produces a shuffled article that still validates.
 * - **Everything else by `created_at, id`** (or the natural key where there is
 *   one). A `select` with no `order by` returns rows in whatever order Postgres
 *   finds them, which is usually insertion order and is guaranteed to be
 *   nothing: the day `import.ts` started deleting and re-inserting reader state
 *   the physical order changed and `searches.json` came back shuffled. `id`
 *   breaks the tie between two rows written in the same millisecond, so two
 *   exports of an unchanged article cannot differ.
 */
export async function readArticleRows(slug: string): Promise<ArticleRows> {
  const db = getDb();
  const found = (
    await db
      .select({ article: articles, revision: articleRevisions })
      .from(articles)
      .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
      .where(ownedSlug(slug))
      .limit(1)
  )[0];
  if (!found) throw new ArticleNotFound(slug);
  const { article, revision } = found;

  /* In parallel because they are independent reads of one article and nothing
     here holds a transaction; `pg`'s pool queues when it is smaller than this. */
  const [
    blocks,
    identities,
    comments,
    threads,
    messages,
    runs,
    criteria,
    claims,
    lookups,
  ] = await Promise.all([
    db
      .select()
      .from(revisionBlocks)
      .where(eq(revisionBlocks.revisionId, revision.id))
      .orderBy(revisionBlocks.ordinal),
    db
      .select()
      .from(blockIdentities)
      .where(eq(blockIdentities.articleId, article.id))
      .orderBy(asc(blockIdentities.firstSeenAt), asc(blockIdentities.blockId)),
    db
      .select()
      .from(commentsTable)
      .where(eq(commentsTable.articleId, article.id))
      .orderBy(asc(commentsTable.createdAt), asc(commentsTable.id)),
    db
      .select()
      .from(chatThreads)
      .where(eq(chatThreads.articleId, article.id))
      .orderBy(asc(chatThreads.createdAt), asc(chatThreads.id)),
    /* One query for every thread's messages rather than one per thread. The
       filter is on `article_id` — a thread id is unique only within its article
       (`chat_threads`'s primary key is `(article_id, id)`, the same rule as
       block ids), so a query keyed on `thread_id` alone would mix two articles'
       conversations together. */
    db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.articleId, article.id))
      .orderBy(asc(chatMessages.threadId), asc(chatMessages.ordinal)),
    db
      .select()
      .from(searchRuns)
      .where(eq(searchRuns.articleId, article.id))
      .orderBy(asc(searchRuns.createdAt), asc(searchRuns.id)),
    db
      .select()
      .from(refereeCriteria)
      .where(eq(refereeCriteria.articleId, article.id))
      .orderBy(asc(refereeCriteria.createdAt), asc(refereeCriteria.id)),
    db.select().from(refereeClaims).where(eq(refereeClaims.articleId, article.id)).limit(1),
    db
      .select()
      .from(glossaryLookups)
      .where(eq(glossaryLookups.articleId, article.id))
      .orderBy(asc(glossaryLookups.entryId)),
  ]);

  return {
    article,
    revision,
    blocks,
    blockIdentities: identities,
    comments,
    chatThreads: threads,
    chatMessages: messages,
    searchRuns: runs,
    refereeCriteria: criteria,
    refereeClaims: claims,
    glossaryLookups: lookups,
  };
}

/**
 * One thread's messages, in order — the grouping every caller of
 * `ArticleRows.chatMessages` needs.
 *
 * A thread with no messages is a real state, so this can legitimately answer
 * empty; the rollback counts what comes back rather than assuming a thread row
 * implies a message row, because `chat.json` is written from two tables and
 * claiming coverage it had not exercised is the shape of thing the coverage
 * record exists to stop.
 */
export function messagesOfThread(
  rows: ArticleRows,
  threadId: string,
): readonly (typeof chatMessages.$inferSelect)[] {
  return rows.chatMessages.filter((message) => message.threadId === threadId);
}
