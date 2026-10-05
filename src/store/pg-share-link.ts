/**
 * **The private link: making one, reading it back, turning it off.**
 *
 * The owner's side of
 * docs/plans/261005e-share-an-article-with-some-people-a-private-link-first.md.
 * The reads a link lets a visitor make are in
 * [public-reader.ts](public-reader.ts) and share nothing with this file but
 * the one column.
 *
 * ## This is the only place the key is read out of the database
 *
 * `articles.share_token` is a credential. `currentShareLinkQuery` below is the
 * one statement in `src/` that selects it, it is scoped by `ownedSlug`, and its
 * answer goes to the owner's `GET /api/article/:slug/share-link` and nowhere
 * else. tests/share-link-token-stays-home.test.ts greps the tree for a second
 * reader. Nothing here logs the key or puts it in an error.
 *
 * ## One transaction per change
 *
 * `select … for update` on the owner's row, the `update`, then the audit row,
 * in one transaction, so there is never a key without the record of who made
 * it or a record of a key that was not made.
 *
 * **The row lock is for the same writer `pg-visibility.ts` names**: the
 * publication that flips a minimal paper to `full` holds only the article
 * lock, and `create` reads `processing` to decide whether a link is allowed.
 * It also queues two changes to one link.
 *
 * **No billing lock, unlike the visibility switch.** That switch takes the
 * owner's `billing_accounts` row because a public article costs half a slot.
 * A link-shared article stays at the private rate (Greg, 2026-10-05:
 * *"private, full rate"*), so nothing here changes what anybody has used.
 *
 * ## Not idempotent, on purpose, in one direction
 *
 * `create` always makes a new key, including when one is on. That is the
 * owner's way to cut off everybody holding the old link while keeping the
 * article shared, and the old key is gone in the same statement. `turnOff`
 * when there is no link changes nothing and writes no audit row.
 */

import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articleShareLinkEvents, articles } from "../db/schema.js";
import { NOT_READ_YET_SHARE } from "../messages.js";
import { NotProcessed } from "../not-processed.js";
import { currentOwnerId } from "../owner.js";
import type { ShareLinkState } from "../types.js";
import type { ShareLinkStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { READ_COMMITTED } from "./isolation.js";
import { ownedSlug } from "./owned-slug.js";
import { requireSlug } from "./require-slug.js";

/** 404, not 403, for a slug that is not yours: `pg-visibility.ts` § `notFound`. */
function notFound(slug: string): Error {
  return Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
}

/**
 * **A new key: 128 bits from the operating system's generator, as base64url.**
 *
 * Sixteen bytes is 22 characters unpadded, which is the shape
 * `parseShareKey` (src/share-key.ts) and the CHECK `articles_share_token_shape`
 * both hold. `randomBytes` and not `Math.random`: a slug's suffix comes from
 * the second and is about 30 bits, which is why a slug is not a secret and a
 * private link needs this.
 */
export function mintShareKey(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * **The owner's row, with the key on it**, taking its builder so a test can
 * read the statement. `lock` is for the two writes, which read in order to
 * decide what to write.
 *
 * Through `ownedSlug`, so another reader's slug matches nothing and is the
 * same 404 as a slug nobody has.
 */
export function currentShareLinkQuery(
  db: Pick<ReturnType<typeof getDb>, "select">,
  slug: string,
  lock: boolean,
) {
  const query = db
    .select({
      id: articles.id,
      slug: articles.slug,
      shareToken: articles.shareToken,
      shareTokenAt: articles.shareTokenAt,
      /* A minimal paper may not be link-shared, as it may not be made public. */
      processing: articles.processing,
    })
    .from(articles)
    .where(ownedSlug(slug));
  return lock ? query.for("update").limit(1) : query.limit(1);
}

/**
 * The state a row is in. Both columns or neither is what
 * `articles_share_token_pair` guarantees; a row that somehow had one reads as
 * off, which is the closed direction.
 */
function stateOf(row: { shareToken: string | null; shareTokenAt: Date | null }): ShareLinkState {
  if (row.shareToken === null || row.shareTokenAt === null) return { on: false };
  return { on: true, key: row.shareToken, since: row.shareTokenAt.toISOString() };
}

const rawPgShareLinkStore: ShareLinkStore = {
  async read(slug: string): Promise<ShareLinkState> {
    requireSlug(slug);
    const [row] = await currentShareLinkQuery(getDb(), slug, false);
    if (!row) throw notFound(slug);
    return stateOf(row);
  },

  async create(slug: string): Promise<ShareLinkState> {
    requireSlug(slug);
    return getDb().transaction(async (tx) => {
      const [row] = await currentShareLinkQuery(tx, slug, true);
      if (!row) throw notFound(slug);

      /* The refusal going public gives, in the same words: there is nothing to
         read but a title and an abstract, and the public reader needs a tree. */
      if (row.processing === "minimal") throw new NotProcessed(NOT_READ_YET_SHARE.message);

      const key = mintShareKey();
      const since = new Date();
      /* One statement replaces any key that was on, so there is no moment when
         both open the article and none when neither does. */
      await tx
        .update(articles)
        .set({ shareToken: key, shareTokenAt: since })
        .where(eq(articles.id, row.id));

      /* **Never the key.** What is recorded is who made a link and that they
         confirmed the right to; the route refuses a create that did not. */
      await tx.insert(articleShareLinkEvents).values({
        articleId: row.id,
        slug: row.slug,
        actorOwnerId: currentOwnerId(),
        event: "created",
        rightsConfirmed: true,
      });

      return { on: true, key, since: since.toISOString() };
    }, READ_COMMITTED);
  },

  async turnOff(slug: string): Promise<ShareLinkState> {
    requireSlug(slug);
    return getDb().transaction(async (tx) => {
      const [row] = await currentShareLinkQuery(tx, slug, true);
      if (!row) throw notFound(slug);

      /* Already off. Say what is true, touch nothing, log nothing. */
      if (row.shareToken === null) return { on: false };

      await tx
        .update(articles)
        .set({ shareToken: null, shareTokenAt: null })
        .where(eq(articles.id, row.id));

      await tx.insert(articleShareLinkEvents).values({
        articleId: row.id,
        slug: row.slug,
        actorOwnerId: currentOwnerId(),
        event: "turned-off",
        rightsConfirmed: false,
      });

      return { on: false };
    }, READ_COMMITTED);
  },
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgShareLinkStore: ShareLinkStore = guardDbStore("share-link", rawPgShareLinkStore);
