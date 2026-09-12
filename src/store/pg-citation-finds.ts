/**
 * Where Citations mode's *Find it* keeps a page it found — the write half. The
 * read half is `loadCitations` in src/store/pg.ts, which attaches each row to
 * its entry, exactly as glossary lookups are attached in `loadGlossary`.
 *
 * `glossary_lookups`' shape (src/store/pg-lookups.ts has the argument): one
 * row per `(article_id, entry_id)`, so two finds for two works never touch,
 * and an upsert, so finding a work again replaces the old page rather than
 * keeping the first for ever.
 *
 * ## What may be logged from this file
 *
 * Nothing, and nothing is. The URL and the title are what somebody's article
 * cites, and src/citation-find.ts logs the host and the counts only.
 */

import { getDb } from "../db/client.js";
import { citationFinds } from "../db/schema.js";
import { currentOwnerId } from "../owner.js";
import type { CitationFind } from "../types.js";
import type { CitationFindStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { articleIdForOwned } from "./pg.js";

const rawPgCitationFindStore: CitationFindStore = {
  async save(slug: string, entryId: string, find: CitationFind): Promise<void> {
    /* Owner-scoped: a slug the caller does not own is a 404 here, as
       everywhere, before anything is written. */
    const articleId = await articleIdForOwned(slug);
    const values = {
      url: find.url,
      title: find.title ?? null,
      host: find.host,
      searches: find.searches,
      model: find.model,
      foundAt: new Date(find.at),
    };
    await getDb()
      .insert(citationFinds)
      .values({ articleId, entryId, ownerId: currentOwnerId(), ...values })
      .onConflictDoUpdate({ target: [citationFinds.articleId, citationFinds.entryId], set: values });
  },
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgCitationFindStore: CitationFindStore = guardDbStore("citation-finds", rawPgCitationFindStore);
