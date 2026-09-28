/**
 * **What a reset does to each step**, in one exhaustive map — and the columns
 * that follows from it.
 *
 * A reset puts an article back "as if it had just been imported for the first
 * time" (Greg, 2026-09-28): the import steps run again over the stored copy,
 * and everything a *mode* made and stored on the revision is dropped from the
 * new draft. docs/plans/260928a-reset-and-regenerate-article.md is the design;
 * this file is the one place that says which step is which.
 *
 * ## Three roles
 *
 * - **`import`** — `DEFAULT_INGEST_STEPS`. The reset job runs these, with
 *   `extract` forced and `cascadeForce` sweeping the rest in behind it.
 * - **`successor`** — `labels`. Not dropped by hand: a forced `hierarchy`
 *   writes a pending manifest and the reset's publication buys the free labels
 *   job exactly as any import's does.
 * - **`extra`** — everything a mode makes on demand. Dropped from the reset's
 *   draft, columns and step-run rows both; queued again after publication when
 *   the reader asked.
 *
 * `Record<StepName, …>` rather than a list of extras, so a step added to the
 * pipeline is a compile error here until somebody decides what a reset does
 * to it. A list would quietly leave the new step's artefact riding along on a
 * "fresh" article.
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
import { STEP_ORDER } from "./step-order.js";
import { STORAGE, type WholeColumn } from "./store/artifact-storage.js";
import { ownedSlug } from "./store/owned-slug.js";
import type { StepName } from "./types.js";

export type ResetRole = "import" | "successor" | "extra";

export const RESET_ROLE: Record<StepName, ResetRole> = {
  fetch: "import",
  extract: "import",
  blocks: "import",
  hierarchy: "import",
  labels: "successor",
  assets: "import",
  arc: "extra",
  tweets: "extra",
  glossary: "extra",
  quotes: "extra",
  trajectory: "extra",
  ideas: "extra",
  timeline: "extra",
  quiz: "extra",
  faq: "extra",
  sketch: "extra",
  illustrated: "extra",
  debate: "extra",
  citations: "extra",
};

/** The extra steps, in `STEP_ORDER` order — the order they are queued again in. */
export function extraSteps(): StepName[] {
  return STEP_ORDER.filter((step) => RESET_ROLE[step] === "extra");
}

/** Whether a step is one a reset drops. */
export function isExtra(step: StepName): boolean {
  return RESET_ROLE[step] === "extra";
}

/**
 * **The `article_revisions` columns each extra step owns**, read off `STORAGE`.
 *
 * Every site of an extra must be a whole column: an extra that one day writes
 * into `revision_blocks` or an assembled group would need a different kind of
 * drop, so it throws rather than silently dropping nothing. Checked when first
 * called, which the reset tests do.
 */
export function extraColumns(): { step: StepName; column: WholeColumn }[] {
  const out: { step: StepName; column: WholeColumn }[] = [];
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
export async function extrasPresent(slug: string): Promise<StepName[]> {
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
