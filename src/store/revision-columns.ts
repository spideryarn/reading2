/**
 * **The columns of `article_revisions` that new code reads, as a projection.**
 *
 * During an expand and contract rename (plan 261009w) a renamed column keeps
 * its old name in the table, declared in src/db/schema.ts only so that
 * `drizzle-kit generate` does not propose dropping it, and a trigger keeps it
 * equal to the new one. Nothing should read it. A bare `.select()` or a
 * `revision: articleRevisions` projection would, and would then carry it into
 * whatever the row feeds: the export bundle's `content/revision.json` above all
 * (plan 261009w § After GPT Sol's plan review, F6 and F8).
 *
 * So a read that wants the whole row selects `ACTIVE_REVISION_COLUMNS`, and
 * its row type is `ActiveRevisionRow`. The contract migration drops the
 * legacy columns and empties `LEGACY_REVISION_COLUMNS`; this file can then
 * stay, empty-handed, for the next rename.
 */
import { getTableColumns } from "drizzle-orm";
import { articleRevisions } from "../db/schema.js";

/**
 * The retired names, as their `schema.ts` keys. `legacyCitations` is the
 * `citations` column, Bibliography's before 2026-10-09; `legacyDebate` and
 * `legacyDebateClaims` are `debate` and `debate_claims`, Reception's and the
 * claims list's before the same day. Dropped by the contract migration.
 */
export const LEGACY_REVISION_COLUMNS = ["legacyCitations", "legacyDebate", "legacyDebateClaims"] as const;

export type LegacyRevisionColumn = (typeof LEGACY_REVISION_COLUMNS)[number];

type AllColumns = ReturnType<typeof getTableColumns<typeof articleRevisions>>;

/** Every column but the legacy ones, as a drizzle projection. */
export const ACTIVE_REVISION_COLUMNS: Omit<AllColumns, LegacyRevisionColumn> = (() => {
  const all: Partial<AllColumns> = { ...getTableColumns(articleRevisions) };
  for (const name of LEGACY_REVISION_COLUMNS) delete all[name];
  return all as Omit<AllColumns, LegacyRevisionColumn>;
})();

/** A whole revision row as new code sees it: no legacy columns. */
export type ActiveRevisionRow = Omit<typeof articleRevisions.$inferSelect, LegacyRevisionColumn>;
