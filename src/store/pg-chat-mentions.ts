/**
 * **The rows behind chat @-mentions** — `chat_mentions`, written beside a
 * question and read back per turn. Plan
 * docs/plans/261012d-chat-at-mention-your-own-articles.md § 2.
 *
 * Persistence only. Whether a mention is still *available* — the article
 * still this reader's, readable, and under the cap — is decided per turn by
 * `resolveMentions` in src/chat-mentions.ts, which reads these rows.
 *
 * ## The one join, and why it is owner-scoped
 *
 * `mentionRows` hands back the mentioned article's **slug only when the
 * article is still the current owner's**: the join to `articles` carries
 * `owner_id = currentOwnerId()` in its `ON`. An article that has changed hands
 * comes back with its id and stored title and a null slug, so nothing past
 * this function can reach another reader's slug, title or blocks through a
 * mention. An unscoped join here would be the leak the plan's § 3 rules out.
 *
 * Never logs a title: it is the reader's (and an author's) words.
 */

import { and, asc, eq } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articles, chatMentions, chatMessages } from "../db/schema.js";
import { currentOwnerId } from "../owner.js";
import type { MentionRow, MentionToStore } from "./contracts.js";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Write one question's mentions. Inside `begin`'s transaction, after the question row. */
export async function insertMentions(
  tx: Tx,
  articleId: string,
  threadId: string,
  messageId: string,
  mentions: readonly MentionToStore[],
): Promise<void> {
  if (mentions.length === 0) return;
  await tx.insert(chatMentions).values(
    mentions.map((m, position) => ({
      articleId,
      threadId,
      messageId,
      position,
      mentionedArticleId: m.articleId,
      title: m.title,
    })),
  );
}

/**
 * Every mention on an article's conversations — or on one of them — oldest
 * question first, then in the order each question named them.
 *
 * `articleId` must already be the caller's own (`articleIdForOwned`): this
 * reads the conversation's rows by it without asking again.
 */
export async function mentionRows(
  articleId: string,
  threadId?: string,
  db: Pick<Db, "select"> = getDb(),
): Promise<MentionRow[]> {
  const rows = await db
    .select({
      threadId: chatMentions.threadId,
      messageId: chatMentions.messageId,
      ordinal: chatMessages.ordinal,
      position: chatMentions.position,
      mentionedArticleId: chatMentions.mentionedArticleId,
      title: chatMentions.title,
      ownedSlug: articles.slug,
    })
    .from(chatMentions)
    .innerJoin(
      chatMessages,
      and(
        eq(chatMessages.articleId, chatMentions.articleId),
        eq(chatMessages.threadId, chatMentions.threadId),
        eq(chatMessages.id, chatMentions.messageId),
      ),
    )
    /* **Owner-scoped in the ON, not the WHERE.** A left join filtered in the
       WHERE would drop the transferred article's row altogether, and the
       conversation would then forget it ever had one, title and all. */
    .leftJoin(
      articles,
      and(eq(articles.id, chatMentions.mentionedArticleId), eq(articles.ownerId, currentOwnerId())),
    )
    .where(
      threadId === undefined
        ? eq(chatMentions.articleId, articleId)
        : and(eq(chatMentions.articleId, articleId), eq(chatMentions.threadId, threadId)),
    )
    .orderBy(asc(chatMentions.threadId), asc(chatMessages.ordinal), asc(chatMentions.position));
  return rows;
}

/**
 * The distinct articles a thread already holds, as `begin` counts them against
 * `MENTIONS_MAX_PER_THREAD` inside its transaction: by article id, and a
 * deleted one (null id) by its stored title, the same identity
 * `resolveMentions` dedupes on.
 */
export async function heldMentionKeys(tx: Tx, articleId: string, threadId: string): Promise<Set<string>> {
  const rows = await tx
    .select({ id: chatMentions.mentionedArticleId, title: chatMentions.title })
    .from(chatMentions)
    .where(and(eq(chatMentions.articleId, articleId), eq(chatMentions.threadId, threadId)));
  return new Set(rows.map((r) => mentionKey(r.id, r.title)));
}

/** What makes two mention rows the same article. */
export function mentionKey(id: string | null, title: string): string {
  return id === null ? `deleted:${title}` : `id:${id}`;
}
