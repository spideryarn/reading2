/**
 * **Where Bibliography's *Investigate* keeps an answer** — the write half. The read
 * half is `loadBibliography` in src/store/pg.ts; the column mapping both use is
 * src/store/citation-investigation-row.ts.
 * docs/plans/260930a-citations-investigate-one-work-on-demand.md.
 *
 * `citation_finds`' shape: one row per `(article_id, entry_id)`, an upsert, so a
 * second press replaces the first rather than keeping a history (the plan's
 * *Kept, one per work*).
 *
 * ## What may be logged from this file
 *
 * Nothing, and nothing is: the answer and the sources are about what
 * somebody's article cites. src/citation-investigate.ts logs counts only.
 */
import { getDb } from "../db/client.js";
import { citationInvestigations } from "../db/schema.js";
import { currentOwnerId } from "../owner.js";
import type { CitationInvestigation } from "../types.js";
import { investigationColumns } from "./citation-investigation-row.js";
import type { CitationInvestigationStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { articleIdForOwned } from "./pg.js";

const rawPgCitationInvestigationStore: CitationInvestigationStore = {
  async save(slug: string, entryId: string, investigation: CitationInvestigation): Promise<void> {
    /* Owner-scoped: a slug the caller does not own is a 404, before anything
       is written. */
    const articleId = await articleIdForOwned(slug);
    const values = investigationColumns(investigation);
    await getDb()
      .insert(citationInvestigations)
      .values({ articleId, entryId, ownerId: currentOwnerId(), ...values })
      .onConflictDoUpdate({
        target: [citationInvestigations.articleId, citationInvestigations.entryId],
        set: values,
      });
  },
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgCitationInvestigationStore: CitationInvestigationStore = guardDbStore(
  "citation-investigations",
  rawPgCitationInvestigationStore,
);
