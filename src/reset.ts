/**
 * **What a reset drops**, on the database side — the columns each extra owns,
 * and which extras an article has now.
 *
 * Which step is an import, the successor, or an extra is `RESET_ROLE` in
 * src/reset-role.ts: a leaf, so the browser's reset section reads the same
 * classification the server acts on rather than a copy of it (Sol F14 on
 * docs/plans/260928a-reset-and-regenerate-article-stage2-review-sol.md). It is
 * re-exported here so nothing that imported it from this file had to move.
 * docs/plans/260928a-reset-and-regenerate-article.md is the design.
 *
 * ## The columns come from `STORAGE`, not from a second list
 *
 * `extraColumns` reads src/store/artifact-storage.ts, the one map of where each
 * artefact lives. A column list typed out here would be right on the day it
 * was written and wrong the day an extra grew a second column.
 */

import { eq, sql } from "drizzle-orm";

import { getDb } from "./db/client.js";
import { articleRevisions, articles } from "./db/schema.js";
import { extraSteps, type ExtraStep } from "./reset-role.js";
import { STORAGE, type WholeColumn } from "./store/artifact-storage.js";
import { ownedSlug } from "./store/owned-slug.js";

export {
  RESET_ROLE,
  extraSteps,
  isExtra,
  type ExtraStep,
  type ResetRole,
} from "./reset-role.js";

/**
 * **The `article_revisions` columns each extra step owns**, read off `STORAGE`.
 *
 * Every site of an extra must be a whole column: an extra that one day writes
 * into `revision_blocks` or an assembled group would need a different kind of
 * drop, so it throws rather than silently dropping nothing. Checked when first
 * called, which the reset tests do.
 */
export function extraColumns(): { step: ExtraStep; column: WholeColumn }[] {
  const out: { step: ExtraStep; column: WholeColumn }[] = [];
  for (const step of extraSteps()) {
    const sites = Object.values(STORAGE[step]);
    if (sites.length === 0) {
      throw new Error(`${step} is an extra with no storage site — a reset would drop nothing`);
    }
    for (const site of sites) {
      if (site.at !== "column") {
        throw new Error(
          `${step} is an extra stored as "${site.at}", and a reset only knows how to drop whole columns`,
        );
      }
      out.push({ step, column: site.column });
    }
  }
  return out;
}

/**
 * **The extras this reader's article has now** — every extra step with a
 * non-null column on the current published revision, in `STEP_ORDER` order.
 * This is what "regenerate" makes again (assumption 7 of the plan: only the
 * extras the article had, not every extra there is).
 *
 * Owner-scoped through `ownedSlug`, so somebody else's slug answers `[]`
 * rather than describing their article; the caller refuses it as a 404 before
 * asking. An article with no published revision has no extras.
 */
export async function extrasPresent(slug: string): Promise<ExtraStep[]> {
  const columns = extraColumns();
  /* `is not null` per column rather than the columns: a debate or an
     illustrated brief is a large document, and all this asks is whether it is
     there. */
  const [row] = await getDb()
    .select(
      Object.fromEntries(
        columns.map(({ column }) => [column, sql<boolean>`${articleRevisions[column]} is not null`]),
      ),
    )
    .from(articles)
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    .where(ownedSlug(slug))
    .limit(1);
  if (!row) return [];
  const present = new Set(
    columns.filter(({ column }) => row[column] === true).map(({ step }) => step),
  );
  return extraSteps().filter((step) => present.has(step));
}
