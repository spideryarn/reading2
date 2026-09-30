/**
 * **High-powered AI's column: the one write, and the job runner's one read** —
 * docs/plans/260930f-high-powered-ai-per-article.md.
 *
 * `articles.high_power_since` is null for off and the moment it was switched on
 * otherwise. Whether an article's calls actually go to Opus is not decided here:
 * that is `articlePower` in src/models.ts, which also asks whether the owner is
 * an administrator.
 *
 * **Both methods are owner-scoped through `ownedSlug`**, so another owner's slug
 * is not found — a 404 at the route — rather than a row changed or read across
 * owners. The route that calls `set` lives in the `/api/admin` namespace, whose
 * gate reads across owners; this deliberately does not write across them
 * (decision 8).
 *
 * **Idempotent, like the sharing switch** (src/store/pg-visibility.ts): asking
 * for the state an article is already in changes nothing, so switching on twice
 * keeps the first `since`.
 */

import { and, isNull, isNotNull } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articles } from "../db/schema.js";
import type { OwnerId } from "../owner.js";
import { ownedSlug } from "./owned-slug.js";
import { requireSlug } from "./require-slug.js";

export interface HighPowerStore {
  /**
   * Switch it on or off for one of the caller's own articles, and say what it
   * now is: the ISO moment it was switched on, or `null`. Throws a 404-shaped
   * error for a slug the caller does not own.
   */
  set(slug: string, on: boolean): Promise<{ highPowerSince: string | null }>;
  /**
   * The column for `slug` owned by `ownerId`, or `{ found: false }` when there
   * is no such row — which, for the job runner, is either a fresh ingest (the
   * row is born by a later step) or something that went wrong, and only the
   * caller can tell which.
   */
  read(
    slug: string,
    ownerId: OwnerId,
  ): Promise<{ found: false } | { found: true; highPowerSince: Date | null }>;
}

function notFound(slug: string): Error {
  return Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
}

export const pgHighPowerStore: HighPowerStore = {
  async set(slug, on) {
    requireSlug(slug);
    const db = getDb();
    /* One statement per direction, each conditional on the other state, so a
       repeat is a no-op that keeps the first `since` without a read-then-write
       window. The row is returned either way by the follow-up read. */
    if (on) {
      await db
        .update(articles)
        .set({ highPowerSince: new Date() })
        .where(and(ownedSlug(slug), isNull(articles.highPowerSince)));
    } else {
      await db
        .update(articles)
        .set({ highPowerSince: null })
        .where(and(ownedSlug(slug), isNotNull(articles.highPowerSince)));
    }
    const [row] = await db
      .select({ highPowerSince: articles.highPowerSince })
      .from(articles)
      .where(ownedSlug(slug));
    if (!row) throw notFound(slug);
    return { highPowerSince: row.highPowerSince?.toISOString() ?? null };
  },

  async read(slug, ownerId) {
    requireSlug(slug);
    const [row] = await getDb()
      .select({ highPowerSince: articles.highPowerSince })
      .from(articles)
      .where(ownedSlug(slug, ownerId));
    return row ? { found: true, highPowerSince: row.highPowerSince } : { found: false };
  },
};
