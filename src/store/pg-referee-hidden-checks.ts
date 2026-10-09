/**
 * **Hidden text's Opus check, kept: the last finished answer, one per article**
 * — docs/plans/261009a-save-hidden-text-opinions.md. Until 2026-10-09 the
 * answer was thrown away on reload; Greg asked for it kept (report
 * spya-gqq38u, and docs/project/database.md § AI output we paid for is kept).
 *
 * src/store/pg-referee-claims.ts with most of it taken out. Only a validated
 * answer is written, as one upsert, so there is no `pending` row, no attempt
 * token and no sweep: a failed or abandoned run leaves the last good answer
 * where it was, and two tabs racing leave the answer from the newer press even
 * when the older call finishes last. Each judgment carries the inputs it was
 * made from, and the panel shows it only beside a row equal to them
 * (`sameInputs`, src/scan-groups.ts).
 *
 * Ownership first, through `articleIdForOwned`, so another owner's slug is a
 * 404 here as everywhere.
 *
 * ## What may be logged from this file
 *
 * Nothing, and nothing is. The reasons are model text that may quote a
 * manuscript's hidden words.
 */

import { eq, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { refereeHiddenChecks } from "../db/schema.js";
import { currentOwnerId } from "../owner.js";
import type { HiddenCheckResult, HiddenJudgment, StoredHiddenCheck } from "../referee-hidden-check-types.js";
import type { RefereeHiddenCheckStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { articleIdForOwned } from "./pg.js";

function toStored(row: typeof refereeHiddenChecks.$inferSelect): StoredHiddenCheck {
  return {
    judgments: row.judgments as HiddenJudgment[],
    unanswered: row.unanswered,
    notSent: row.notSent,
    model: row.model,
    checkedAt: row.finishedAt.toISOString(),
  };
}

const rawPgRefereeHiddenCheckStore: RefereeHiddenCheckStore = {
  async read(slug: string): Promise<StoredHiddenCheck | null> {
    const articleId = await articleIdForOwned(slug);
    const [row] = await getDb()
      .select()
      .from(refereeHiddenChecks)
      .where(eq(refereeHiddenChecks.articleId, articleId))
      .limit(1);
    return row ? toStored(row) : null;
  },

  async save(slug: string, result: HiddenCheckResult, startedAt: Date): Promise<StoredHiddenCheck> {
    const articleId = await articleIdForOwned(slug);
    /* Every column in the `set`, so nothing of the replaced answer survives
       under the new one. The finish is the database's clock. */
    const values = {
      judgments: result.judgments,
      unanswered: result.unanswered,
      notSent: result.notSent,
      model: result.model,
      createdAt: startedAt,
      finishedAt: sql`clock_timestamp()`,
    };
    /* **The newer press wins, not the later finish.** A call started before a
       re-import can finish after one started after it, and must not replace
       the newer answer (GPT Sol's plan review, finding 2). So the update lands
       only over a check pressed no later than this one; otherwise nothing is
       written and the kept, newer check is what this returns. */
    const [row] = await getDb()
      .insert(refereeHiddenChecks)
      .values({ articleId, ownerId: currentOwnerId(), ...values })
      .onConflictDoUpdate({
        target: refereeHiddenChecks.articleId,
        set: values,
        setWhere: sql`${refereeHiddenChecks.createdAt} <= excluded.created_at`,
      })
      .returning();
    if (row) return toStored(row);
    const kept = await this.read(slug);
    if (!kept) throw new Error(`saving the hidden-text check for ${slug} wrote nothing and found nothing`);
    return kept;
  },
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgRefereeHiddenCheckStore: RefereeHiddenCheckStore = guardDbStore(
  "referee-hidden-checks",
  rawPgRefereeHiddenCheckStore,
);
