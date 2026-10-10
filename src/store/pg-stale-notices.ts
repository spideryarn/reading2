/**
 * The "older version of the article" notices an owner sent away, by mode, on
 * one article — docs/plans/261010a-dismiss-older-version-notices.md (report
 * `spya-mutgym`). The table is `stale_notice_dismissals`, one row per
 * (article, mode); the shape is src/store/pg-glossary-hidden.ts's: ownership
 * first, through `articleIdForOwned`, so a slug the caller does not own is a
 * 404 here as everywhere.
 *
 * A dismissal **replaces** the mode's array (GPT Sol's plan review, finding 5):
 * the client sends the whole list it wants kept, so storage stays bounded at
 * one row per mode however often anyone presses ×.
 *
 * ## What may be logged from this file
 *
 * Nothing, and nothing is. Which notices a reader chose not to act on is theirs.
 */

import { asc, eq, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { staleNoticeDismissals } from "../db/schema.js";
import { currentStaleNoticeMode, isStaleNoticeMode, type StaleNoticeMode } from "../stale-notice.js";
import type { StaleNoticeStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { articleIdForOwned } from "./pg.js";

const rawPgStaleNoticeStore: StaleNoticeStore = {
  async list(slug: string): Promise<Partial<Record<StaleNoticeMode, string[]>>> {
    const articleId = await articleIdForOwned(slug);
    const rows = await getDb()
      .select({ mode: staleNoticeDismissals.mode, dismissedFor: staleNoticeDismissals.dismissedFor })
      .from(staleNoticeDismissals)
      .where(eq(staleNoticeDismissals.articleId, articleId))
      /* Oldest dismissal first, so where a renamed mode has a row under each
         word the later one is the one kept below. */
      .orderBy(asc(staleNoticeDismissals.dismissedAt), asc(staleNoticeDismissals.mode));
    const out: Partial<Record<StaleNoticeMode, string[]>> = {};
    /* The column's check holds the same list, plus the retired words, so a row
       outside it cannot be stored. A retired word is read as its successor
       (`RETIRED_STALE_NOTICE_MODES`: Bibliography's was `citations` until plan
       261009w, and the code before it may still write that word mid-deploy);
       one from a mode a later build drops is simply not sent. */
    for (const row of rows) {
      const mode = currentStaleNoticeMode(row.mode);
      if (isStaleNoticeMode(mode)) out[mode] = row.dismissedFor;
    }
    return out;
  },

  async dismiss(slug: string, mode: StaleNoticeMode, identities: readonly string[]): Promise<void> {
    const articleId = await articleIdForOwned(slug);
    await getDb()
      .insert(staleNoticeDismissals)
      .values({ articleId, mode, dismissedFor: [...identities] })
      .onConflictDoUpdate({
        target: [staleNoticeDismissals.articleId, staleNoticeDismissals.mode],
        /* `created_at` is left alone: it is the first dismissal's. */
        set: { dismissedFor: [...identities], dismissedAt: sql`now()` },
      });
  },
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgStaleNoticeStore: StaleNoticeStore = guardDbStore("stale-notices", rawPgStaleNoticeStore);
