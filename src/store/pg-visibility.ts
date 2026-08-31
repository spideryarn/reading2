/**
 * **The switch.** Turning sharing on and off, and writing down that it happened.
 *
 * One method, and it is a write — the only write this whole feature has. The
 * *reads* it enables are in [public-reader.ts](public-reader.ts) and share
 * nothing with this file but the two columns.
 *
 * ## Why it is not a field on `PATCH /api/library/:slug`
 *
 * That route edits **shelf state** — the relationship between a reader and a
 * document: their rename, their purpose, whether it is archived. Visibility is
 * a property of **the work**. Stage 3 of docs/plans/260827ai-public-read-only-access.md
 * splits `articles` from `shelf_entries` along exactly that line, so putting
 * them together now would mean moving the API twice. GPT Sol's reasoning,
 * adopted.
 *
 * ## One transaction, and what each part of it is for
 *
 * `select … for update`, then the `update`, then the log row, all inside one
 * transaction. Two readers pressing the toggle at once would otherwise both see
 * `private`, both write `public`, and write **two** publish events for one
 * transition — a log that says a thing happened twice is worse than no log,
 * because it is the kind of wrong that gets believed.
 *
 * ## Idempotence, on purpose
 *
 * Asking for the state a document is already in returns the current
 * representation and **changes nothing**: `public_at` is not moved and no event
 * is appended. `PUT` says "make it so", and it having been so already is not a
 * failure. Sol's answer 6 spells this out and it is the difference between an
 * audit log and a click counter.
 */

import { eq } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articleVisibilityChanges, articles } from "../db/schema.js";
import { currentOwnerId } from "../owner.js";
import type { Visibility, VisibilityState, VisibilityStore } from "./contracts.js";
import { ownedSlug } from "./owned-slug.js";

/**
 * **404, not 403**, for a slug that is not yours — the same rule and the same
 * sentence as every other owner-filtered lookup. A 403 would confirm the
 * article exists.
 *
 * It falls out of the design rather than being a second decision: `ownedSlug`
 * simply does not match the row.
 */
function notFound(slug: string): Error {
  return Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
}

/**
 * **The row this switch is about to change, read and locked**, taking its
 * builder so a test can read the SQL rather than a constant beside it.
 *
 * The same reason `publicCurrentRevisionQuery` takes one, and here it is the
 * only way to check the one clause the whole concurrency argument rests on.
 * Deleting `.for("update")` left the entire suite green — GPT Sol's finding 6,
 * 2026-08-28 — and the behavioural race test that now catches it can only catch
 * it while the window is open, which on a fast local socket it very often is
 * not. tests/public-reads.test.ts reads this statement instead, and that
 * assertion fires on the mutation every time.
 *
 * **Through `ownedSlug`, like everything else.** The owner check and the lookup
 * are one clause, so there is no window between "whose is it" and "change it",
 * and no unfiltered read in this file for anybody to reuse without the question.
 *
 * **`for update`, because the row is read in order to decide what to write.**
 * Without it two concurrent toggles both see the old value, both write, and both
 * append an event — a log saying a thing happened twice, which is worse than no
 * log. A row lock rather than an advisory one, because Supabase's transaction
 * pooler silently does nothing with session advisory locks (src/db/client.ts).
 */
export function lockedArticleQuery(
  db: Pick<ReturnType<typeof getDb>, "select">,
  slug: string,
) {
  return db
    .select({
      id: articles.id,
      slug: articles.slug,
      visibility: articles.visibility,
      publicAt: articles.publicAt,
    })
    .from(articles)
    .where(ownedSlug(slug))
    .for("update")
    .limit(1);
}

export const pgVisibilityStore: VisibilityStore = {
  async set(slug: string, to: Visibility, rightsConfirmed: boolean): Promise<VisibilityState> {
    return getDb().transaction(async (tx) => {
      const [row] = await lockedArticleQuery(tx, slug);
      if (!row) throw notFound(slug);

      const from = row.visibility as Visibility;
      /* Already there. Return what is true, touch nothing, log nothing. */
      if (from === to) {
        return { visibility: from, publicAt: row.publicAt?.toISOString() ?? null };
      }

      /* On the way up, stamp it; on the way down, clear it. `public_at` answers
         "how long has this been up", which has no answer for a private
         document — and leaving a stale one behind would make the field read as
         "was public once", which is a different question and the log's job. */
      const publicAt = to === "public" ? new Date() : null;

      await tx.update(articles).set({ visibility: to, publicAt }).where(eq(articles.id, row.id));

      /* Transitions only, which is what makes the table a history rather than a
         tally of button presses. The database agrees:
         `article_visibility_changes_moved` refuses a row whose from and to are
         the same, so the `if` above and the constraint say the same thing in two
         places and neither can drift alone. */
      await tx.insert(articleVisibilityChanges).values({
        articleId: row.id,
        slug: row.slug,
        actorOwnerId: currentOwnerId(),
        fromVisibility: from,
        toVisibility: to,
        rightsConfirmed,
      });

      return { visibility: to, publicAt: publicAt?.toISOString() ?? null };
    });
  },
};
