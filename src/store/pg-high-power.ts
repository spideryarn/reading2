/**
 * **High-powered AI's column: the one write, and the job runner's one read** —
 * docs/plans/260930f-high-powered-ai-per-article.md.
 *
 * `articles.high_power_since` is null for off and the moment it was switched on
 * otherwise. Whether an article's calls actually go to Opus is `articlePower` in
 * src/models.ts: the column set is the answer.
 *
 * **Both methods are owner-scoped through `ownedSlug`**, so another owner's slug
 * is not found — a 404 at the route — rather than a row changed or read across
 * owners. `set` writes **no charge**: the route calls it only for the
 * administrator and for switching off. A reader's switch-on goes through
 * `switchOnHighPower` (src/store/pg-billing.ts), which charges and sets the
 * column in one transaction — plan 260930k.
 *
 * **Idempotent, like the sharing switch** (src/store/pg-visibility.ts): asking
 * for the state an article is already in changes nothing, so switching on twice
 * keeps the first `since`.
 */

import { and, isNull, isNotNull } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articles } from "../db/schema.js";
import type { HighPowerStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { ownedSlug } from "./owned-slug.js";
import { requireSlug } from "./require-slug.js";


function notFound(slug: string): Error {
  return Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
}

const rawPgHighPowerStore: HighPowerStore = {
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

export const pgHighPowerStore: HighPowerStore = guardDbStore("high-power", rawPgHighPowerStore);
