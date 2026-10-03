/**
 * **High-powered AI's column: the one write, and the job runner's one read** —
 * docs/plans/260930f-high-powered-ai-per-article.md.
 *
 * `articles.high_power_since` is null for off and the moment it was switched on
 * otherwise. Whether an article's calls actually go to Opus is `articlePower` in
 * src/models.ts: the column set is the answer.
 *
 * **Every method is owner-scoped through `ownedSlug`**, so another owner's slug
 * is not found — a 404 at the route — rather than a row changed or read across
 * owners. The two write methods write **no charge**, which is why the on method
 * checks for the administrator itself. A reader's switch-on goes through
 * `switchOnHighPower` (src/store/pg-billing.ts), which charges and sets the
 * column in one transaction — plan 260930k.
 *
 * **Idempotent, like the sharing switch** (src/store/pg-visibility.ts): asking
 * for the state an article is already in changes nothing, so switching on twice
 * keeps the first `since`.
 */

import { and, isNull, isNotNull, sql } from "drizzle-orm";

import { isAdmin } from "../admin.js";
import { getDb } from "../db/client.js";
import { articles } from "../db/schema.js";
import { currentOwnerId } from "../owner.js";
import type { HighPowerStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { ownedSlug } from "./owned-slug.js";
import { requireSlug } from "./require-slug.js";

function notFound(slug: string): Error {
  return Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
}

async function writeState(slug: string, on: boolean): Promise<string | null> {
  requireSlug(slug);
  const db = getDb();
  /* One statement per direction, each conditional on the other state, so a
     repeat is a no-op that keeps the first `since` without a read-then-write
     window. The row is returned either way by the follow-up read.

     `updated_at` rides in the same conditional statement, so it moves on a real
     transition and not on a repeat — and it is the only thing switching *off*
     leaves behind, since that nulls `high_power_since`. Use the database wall
     clock rather than an application clock read before sending the query. */
  if (on) {
    const at = new Date();
    await db
      .update(articles)
      .set({ highPowerSince: at, updatedAt: sql`clock_timestamp()` })
      .where(and(ownedSlug(slug), isNull(articles.highPowerSince)));
  } else {
    await db
      .update(articles)
      .set({ highPowerSince: null, updatedAt: sql`clock_timestamp()` })
      .where(and(ownedSlug(slug), isNotNull(articles.highPowerSince)));
  }
  const [row] = await db
    .select({ highPowerSince: articles.highPowerSince })
    .from(articles)
    .where(ownedSlug(slug));
  if (!row) throw notFound(slug);
  return row.highPowerSince?.toISOString() ?? null;
}

const rawPgHighPowerStore: HighPowerStore = {
  async switchOff(slug) {
    return { highPowerSince: await writeState(slug, false) };
  },

  async switchOnForAdmin(slug) {
    if (!isAdmin(currentOwnerId())) {
      throw Object.assign(new Error("Only an administrator may switch on without a charge."), {
        status: 403,
      });
    }
    const highPowerSince = await writeState(slug, true);
    if (!highPowerSince) throw new Error(`switching ${slug} on wrote no timestamp`);
    return { highPowerSince };
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
