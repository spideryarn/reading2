/**
 * The glossary entries an owner has hidden from their own view of one article —
 * docs/plans/261002c-glossary-hide-an-entry-dig-deeper-from-the-card-hyphens-match-spaces.md § 2.
 * The shape is src/store/pg-reading-time.ts's: ownership first, through
 * `articleIdForOwned`, so a slug the caller does not own is a 404 here as
 * everywhere.
 *
 * - **`hide` refuses an id the current glossary does not have.** A format check
 *   alone would let an owner store any number of rows for invented ids (GPT
 *   Sol's plan review, finding 6). The check reads the current revision's
 *   stored list in the same statement as the insert.
 * - **`unhide` checks nothing but the format and ownership**, so a row whose
 *   entry has since left the glossary can still be removed.
 *
 * Both are idempotent: hiding a hidden entry, or unhiding a shown one, is a 204.
 *
 * ## What may be logged from this file
 *
 * Nothing, and nothing is. Which terms a reader already knows is theirs.
 */

import { and, eq, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { glossaryHiddenEntries } from "../db/schema.js";
import { isSpideryarnId } from "../ids.js";
import type { GlossaryHiddenStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { articleIdForOwned } from "./pg.js";

function requireEntryId(entryId: string): void {
  if (!isSpideryarnId(entryId)) {
    throw Object.assign(new Error("That is not a glossary entry's id."), { status: 400 });
  }
}

const rawPgGlossaryHiddenStore: GlossaryHiddenStore = {
  async hide(slug: string, entryId: string): Promise<void> {
    const articleId = await articleIdForOwned(slug);
    requireEntryId(entryId);
    /* One statement: insert only when the current revision's glossary has an
       entry with this id. `on conflict do nothing` makes a second hide a no-op,
       so "nothing inserted" is ambiguous — the `exists` below says which. */
    const result = await getDb().execute(sql`
      with present as (
        select 1
        from spideryarn.articles a
        join spideryarn.article_revisions r on r.id = a.current_revision_id
        cross join lateral jsonb_array_elements(coalesce(r.glossary -> 'entries', '[]'::jsonb)) e
        where a.id = ${articleId} and e ->> 'id' = ${entryId}
        /* Or a term the reader added, which is a lookup row with a name
           rather than an entry in the document — plan 261002f. */
        union all
        select 1
        from spideryarn.glossary_lookups l
        where l.article_id = ${articleId} and l.entry_id = ${entryId} and l.added_name is not null
        limit 1
      ), inserted as (
        insert into spideryarn.glossary_hidden_entries (article_id, entry_id)
        select ${articleId}, ${entryId} where exists (select 1 from present)
        on conflict (article_id, entry_id) do nothing
        returning 1
      )
      select exists (select 1 from present) as present
    `);
    const present = (result.rows[0] as { present?: boolean } | undefined)?.present === true;
    if (!present) {
      throw Object.assign(new Error("That term is not in this article's glossary."), {
        status: 404,
      });
    }
  },

  async unhide(slug: string, entryId: string): Promise<void> {
    const articleId = await articleIdForOwned(slug);
    requireEntryId(entryId);
    await getDb()
      .delete(glossaryHiddenEntries)
      .where(
        and(
          eq(glossaryHiddenEntries.articleId, articleId),
          eq(glossaryHiddenEntries.entryId, entryId),
        ),
      );
  },
};

/* The read is not here: `loadGlossary` (src/store/pg.ts) selects the hidden
   ids itself, in its own `Promise.all`, because importing this file from pg.ts
   would be an import cycle. */

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgGlossaryHiddenStore: GlossaryHiddenStore = guardDbStore(
  "glossary-hidden",
  rawPgGlossaryHiddenStore,
);
