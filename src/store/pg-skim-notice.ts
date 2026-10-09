/**
 * The Skim notice the owner sent away — *"This route was planned before your
 * profile said what it says now"* — on one article.
 * docs/plans/261009i-skim-profile-notice-can-be-dismissed.md (report
 * `spya-ud2w92`). Two columns on `articles`, not a table: one per article, the
 * owner's state, beside `purpose`.
 *
 * Ownership first, through `articleIdForOwned`, so a stranger's slug is a 404
 * here as everywhere. **The write is conditional on the route** in the same
 * statement: a re-plan between the reader's read and their press re-stamps
 * `generatedAt`, and the dismissal must not land on a route they never saw.
 *
 * ## What may be logged from this file
 *
 * Nothing, and nothing is. The key carries a hash of the reader's profile.
 */

import { sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import type { SkimNoticeStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { articleIdForOwned } from "./pg.js";

const rawPgSkimNoticeStore: SkimNoticeStore = {
  async dismissProfileNotice(slug: string, generatedAt: string, key: string): Promise<boolean> {
    const articleId = await articleIdForOwned(slug);
    const result = await getDb().execute(sql`
      update spideryarn.articles a
      set skim_profile_notice_dismissed_for = ${key},
          skim_profile_notice_dismissed_at = now()
      from spideryarn.article_revisions r
      where a.id = ${articleId}
        and r.id = a.current_revision_id
        and r.skim ->> 'generatedAt' = ${generatedAt}
      returning 1
    `);
    return result.rows.length > 0;
  },
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgSkimNoticeStore: SkimNoticeStore = guardDbStore("skim-notice", rawPgSkimNoticeStore);
