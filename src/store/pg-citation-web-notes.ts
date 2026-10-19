/**
 * **Where a web note for one cited work is kept** — `citation_web_notes`,
 * docs/plans/261018o-citation-notes-web-search-for-the-clicked-work-and-registry-keys.md
 * § Stage 2 as amended by R4. The press (src/citation-web-note.ts) reads and
 * writes through here; the owner's Bibliography read attaches the notes in
 * `loadBibliography` (src/store/pg.ts). The column mapping both use is
 * src/store/citation-web-note-row.ts.
 *
 * `citation_finds`' shape: one row per `(article_id, entry_id)`, an upsert, so
 * a later press replaces the earlier one — a negative turned into a note, or a
 * note made again under new checks — rather than keeping a history.
 *
 * ## What may be logged from this file
 *
 * Nothing, and nothing is: the sentences and the page are about what
 * somebody's article cites.
 */
import { and, eq } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { citationWebNotes } from "../db/schema.js";
import { currentOwnerId } from "../owner.js";
import type { Bibliography, CitationWebNote, CitedWork } from "../types.js";
import { webNoteColumns, webNoteFromRow } from "./citation-web-note-row.js";
import type { CitationWebNoteStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { articleIdForOwned, currentRevisionQuery, notFound, requireSlug } from "./pg.js";

const rawPgCitationWebNoteStore: CitationWebNoteStore = {
  async read(slug: string, entryId: string): Promise<{ row: CitedWork; note: CitationWebNote | null } | null> {
    requireSlug(slug);
    /* Owner-scoped by `currentRevisionQuery`'s own filter: a slug the caller
       does not own reads as no article, and that is a 404. */
    const [found] = await currentRevisionQuery(getDb(), slug, "bibliography");
    if (!found) throw notFound(slug);
    /* **The row as the revision stores it**, never the owner's upgraded read:
       the note's identity is `rowIdentity` of this row (contracts.ts). */
    const bibliography = found.revision.bibliography as Bibliography | null;
    const citations = bibliography && Array.isArray(bibliography.citations) ? bibliography.citations : [];
    const row = citations.find((work) => work.id === entryId);
    if (row === undefined) return null;
    const [stored] = await getDb()
      .select()
      .from(citationWebNotes)
      .where(and(eq(citationWebNotes.articleId, found.article.id), eq(citationWebNotes.entryId, entryId)))
      .limit(1);
    return { row, note: stored ? webNoteFromRow(stored) : null };
  },

  async save(slug: string, entryId: string, note: CitationWebNote): Promise<void> {
    /* Owner-scoped: a slug the caller does not own is a 404, before anything
       is written. */
    const articleId = await articleIdForOwned(slug);
    /* Every column but `created_at`, so the first press's moment stays. */
    const values = webNoteColumns(note);
    await getDb()
      .insert(citationWebNotes)
      .values({ articleId, entryId, ownerId: currentOwnerId(), ...values })
      .onConflictDoUpdate({
        target: [citationWebNotes.articleId, citationWebNotes.entryId],
        set: { ...values, ownerId: currentOwnerId() },
      });
  },
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgCitationWebNoteStore: CitationWebNoteStore = guardDbStore("citation-web-notes", rawPgCitationWebNoteStore);
