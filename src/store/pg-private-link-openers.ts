/**
 * **Who opened a private link, and whose article it is — for the
 * administrator.** Greg, 2026-10-20 (reply `spya-xug3kf` to q-agbc89):
 *
 * > As an admin, I want to be able to see anything. Because after all, I've got
 * > access to the database anyway. And it may be useful for debugging. And yes,
 * > I'm interested to know and store which users open which articles.
 *
 * He chose 1B (the owner of an article read through a private link) and 2C
 * (the signed-in accounts that open a private link, plus a count of signed-out
 * opens), and nothing wider.
 * docs/plans/261021d-admin-sees-a-private-link-s-owner-and-who-opened-it.md.
 *
 * Two things here, both outside the public graph
 * (tests/public-imports.test.ts forbids `private_link_openers` there):
 *
 * - `recordOpener` — the signed-in visitor's write, behind `requireUser`. The
 *   reader is an argument, the verified session's id, never `currentOwnerId()`.
 * - `articleAccessForAdmin` — the read behind `GET /api/admin/articles/:slug/
 *   access`, under the admin namespace gate. **Only for an article the
 *   administrator can already read**: their own, or one a visitor holding this
 *   request's key could read (public, or private with the right key). A private
 *   article named without its key is not found, so this cannot be used to learn
 *   whose a slug is without the link. `share_token` is never selected; whether
 *   a link is on is `share_token_at is not null`.
 *
 * The signed-out count is [private-link-signed-out-opens.ts](private-link-signed-out-opens.ts).
 */

import { and, desc, eq, ne, or, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articles, privateLinkOpeners, privateLinkSignedOutOpens } from "../db/schema.js";
import type { ShareKey } from "../share-key.js";
import { ownedSlug } from "./owned-slug.js";
import { accessFor, privateLinkWhere, publicAccessWhere } from "./public-access.js";

/**
 * Record that `readerId`, signed in, opened `slug` through its private link —
 * if `key` opens it, the article is private, and the reader is not its owner.
 * Anything else writes nothing, and the caller is not told which. One
 * statement: a second open bumps `opens` and `last_opened_at`, and two tabs at
 * once make two increments on one row.
 */
export async function recordOpener(slug: string, key: ShareKey, readerId: string): Promise<void> {
  const t = privateLinkOpeners;
  await getDb()
    .insert(t)
    .select(
      getDb()
        .select({
          articleId: articles.id,
          readerId: sql<string>`${readerId}::uuid`.as("reader_id"),
          opens: sql<number>`1`.as("opens"),
          firstOpenedAt: sql<Date>`now()`.as("first_opened_at"),
          lastOpenedAt: sql<Date>`now()`.as("last_opened_at"),
        })
        .from(articles)
        .where(and(privateLinkWhere(slug, key), ne(articles.ownerId, readerId))),
    )
    .onConflictDoUpdate({
      target: [t.articleId, t.readerId],
      /* Saturating, as the signed-out count is; a signed-in reader is not
         throttled, since each row is theirs alone. */
      set: { opens: sql`least(${t.opens}::bigint + 1, 2147483647)::integer`, lastOpenedAt: sql`now()` },
    });
}

/** One signed-in account that opened the link. */
export interface OpenerRow {
  readerId: string;
  opens: number;
  firstOpenedAt: Date;
  lastOpenedAt: Date;
}

/** What the administrator is told about one article. No title, slug or key. */
export interface ArticleAccessRow {
  ownerId: string;
  /** A private link is on now. */
  privateLink: boolean;
  openers: OpenerRow[];
  signedOut: { opens: number; firstOpenedAt: Date; lastOpenedAt: Date } | null;
}

/** The most openers one answer lists, most recent first. */
export const OPENERS_LISTED = 100;

/**
 * The article the administrator can already read by this slug and key, with
 * who opened its private link. `null` when there is none — the same answer
 * for an unknown slug and for somebody else's private article without its key.
 */
export async function articleAccessForAdmin(slug: string, key: ShareKey | null): Promise<ArticleAccessRow | null> {
  const db = getDb();
  const [article] = await db
    .select({
      id: articles.id,
      ownerId: articles.ownerId,
      privateLink: sql<boolean>`${articles.shareTokenAt} is not null`,
    })
    .from(articles)
    .where(or(ownedSlug(slug), publicAccessWhere(slug, accessFor(key))))
    .limit(1);
  if (!article) return null;

  const [openers, signedOut] = await Promise.all([
    db
      .select({
        readerId: privateLinkOpeners.readerId,
        opens: privateLinkOpeners.opens,
        firstOpenedAt: privateLinkOpeners.firstOpenedAt,
        lastOpenedAt: privateLinkOpeners.lastOpenedAt,
      })
      .from(privateLinkOpeners)
      .where(eq(privateLinkOpeners.articleId, article.id))
      .orderBy(desc(privateLinkOpeners.lastOpenedAt), privateLinkOpeners.readerId)
      .limit(OPENERS_LISTED),
    db
      .select({
        opens: privateLinkSignedOutOpens.opens,
        firstOpenedAt: privateLinkSignedOutOpens.firstOpenedAt,
        lastOpenedAt: privateLinkSignedOutOpens.lastOpenedAt,
      })
      .from(privateLinkSignedOutOpens)
      .where(eq(privateLinkSignedOutOpens.articleId, article.id)),
  ]);
  return {
    ownerId: article.ownerId,
    privateLink: Boolean(article.privateLink),
    openers,
    signedOut: signedOut[0] ?? null,
  };
}
