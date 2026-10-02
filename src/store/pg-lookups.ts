/**
 * What the reader has asked the web about a glossary term — the Postgres half.
 * src/glossary-lookups.ts is the other.
 *
 * ## The upsert is the point, not a tidier way of writing the same thing
 *
 * On disk this is one file holding every lookup for the article, and
 * `saveLookup` reads it, merges one key and writes the whole thing back. **That
 * read happens inside the process-wide mutex, after the model call** — an
 * earlier version of this note said the map was read *before* the call and held
 * stale across it, which would have been much worse and is not what the code
 * does. src/glossary-lookups.ts.
 *
 * What is left is still real, and it is the thing Postgres changes: the mutex
 * is process-local. Two servers on one database both read the map, both merge
 * their own term, both write — and one reader's answer disappears, with no
 * error anywhere, because both writes succeeded. On a filesystem that scenario
 * needed two servers sharing a directory and so never happened; under shared
 * Postgres it is the ordinary case.
 *
 * One row per `(article_id, entry_id)` deletes it rather than narrowing it: two
 * lookups for two different terms do not touch, in any process, in any order.
 *
 * ## What may be logged from this file
 *
 * Ids, counts, the model. **Never the term and never the answer.** The term is
 * what somebody did not know, and the answer is prose from the web; both are
 * exactly the kind of string that ends up in a log line that felt harmless.
 */

import { asc, eq } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articleRevisions, articles, glossaryHiddenEntries, glossaryLookups } from "../db/schema.js";
import { coversWholly, withAddedEntries } from "../glossary-added.js";
import type { LookupsByTerm } from "../glossary-lookups.js";
import { mintUniqueId } from "../ids.js";
import { currentOwnerId } from "../owner.js";
import type { AddedTerm, Citation, Glossary, GlossaryLookup } from "../types.js";
import type { GlossaryLookupStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { articleIdForOwned } from "./pg.js";

function toLookup(row: typeof glossaryLookups.$inferSelect): GlossaryLookup {
  return {
    answer: row.answer,
    citations: row.citations as Citation[],
    searches: row.searches,
    model: row.model,
    at: row.at.toISOString(),
  };
}

/**
 * Every stored lookup for the article, keyed by entry id.
 *
 * Ordered by `entry_id` — the same clause src/store/export.ts uses. A map has
 * no order to a reader, but JSON does, and an export whose key order moves on
 * its own makes `git diff` useless during the one rollback anybody runs.
 */
async function lookupsFor(articleId: string): Promise<LookupsByTerm> {
  const rows = await getDb()
    .select()
    .from(glossaryLookups)
    .where(eq(glossaryLookups.articleId, articleId))
    .orderBy(asc(glossaryLookups.entryId));
  return Object.fromEntries(rows.map((row) => [row.entryId, toLookup(row)]));
}

const rawPgGlossaryLookupStore: GlossaryLookupStore = {
  async load(slug: string): Promise<LookupsByTerm> {
    return lookupsFor(await articleIdForOwned(slug));
  },

  async save(slug: string, termId: string, lookup: GlossaryLookup): Promise<LookupsByTerm> {
    const articleId = await articleIdForOwned(slug);
    /* `do update`, not `do nothing`. Re-checking a term is an ordinary thing to
       do — the web moves, and the reader is entitled to a fresher answer — and
       the file's behaviour is last-write-wins. A `do nothing` here would look
       correct, raise no error, and silently keep serving the first answer for
       ever, which is the kind of failure this migration keeps meeting. */
    await getDb()
      .insert(glossaryLookups)
      .values({
        articleId,
        entryId: termId,
        ownerId: currentOwnerId(),
        answer: lookup.answer,
        citations: lookup.citations,
        searches: lookup.searches,
        model: lookup.model,
        at: new Date(lookup.at),
      })
      .onConflictDoUpdate({
        target: [glossaryLookups.articleId, glossaryLookups.entryId],
        set: {
          answer: lookup.answer,
          citations: lookup.citations,
          searches: lookup.searches,
          model: lookup.model,
          at: new Date(lookup.at),
        },
      });
    return lookupsFor(articleId);
  },

  async addTerm(slug, { name, quote, lookup }): Promise<AddedTerm> {
    return getDb().transaction(async (tx): Promise<AddedTerm> => {
      const articleId = await articleIdForOwned(slug, tx);
      /* **The article row, locked, before anything is read.** "Already
         there" is a read and the insert depends on it, so two tabs adding
         *attention head* and *attention heads* at once would otherwise both
         see nothing and both insert — the names differ, so no key would
         catch it. The second now waits, and then sees the first. */
      const [locked] = await tx
        .select({ revisionId: articles.currentRevisionId })
        .from(articles)
        .where(eq(articles.id, articleId))
        .for("update");
      const revisionId = locked?.revisionId;
      const [revision] = revisionId
        ? await tx
            .select({ glossary: articleRevisions.glossary })
            .from(articleRevisions)
            .where(eq(articleRevisions.id, revisionId))
        : [];
      const glossary = (revision?.glossary ?? null) as Glossary | null;
      /* No list, nothing to add to: `loadGlossary` is a 404 without one, so
         a row written now would be invisible until a glossary exists. */
      if (!glossary) return { kind: "no-glossary" };

      const rows = await tx
        .select({ entryId: glossaryLookups.entryId, addedName: glossaryLookups.addedName })
        .from(glossaryLookups)
        .where(eq(glossaryLookups.articleId, articleId));
      const hiddenIds = new Set(
        (
          await tx
            .select({ entryId: glossaryHiddenEntries.entryId })
            .from(glossaryHiddenEntries)
            .where(eq(glossaryHiddenEntries.articleId, articleId))
        ).map((row) => row.entryId),
      );

      /* The list the reader sees, built the way `loadGlossary` builds it, so
         "already there" means "already drawn". */
      const { entries } = withAddedEntries(glossary.entries, rows);
      const match = entries.find((entry) => coversWholly(entry, quote));
      if (match) {
        return { kind: "existing", entryId: match.id, hidden: hiddenIds.has(match.id) };
      }

      /* **Unique against every id this article has spent**, not just this
         table's: a collision with an entry in the document would pass this
         table's key and then attach one explanation and one hide to two
         entries. `mintUniqueId`, as src/glossary.ts mints. */
      const taken = new Set<string>([
        ...glossary.entries.map((entry) => entry.id),
        ...rows.map((row) => row.entryId),
        ...hiddenIds,
      ]);
      const entryId = mintUniqueId(taken);
      await tx.insert(glossaryLookups).values({
        articleId,
        entryId,
        ownerId: currentOwnerId(),
        answer: lookup.answer,
        citations: lookup.citations,
        searches: lookup.searches,
        model: lookup.model,
        at: new Date(lookup.at),
        addedName: name,
      });
      return { kind: "added", entryId };
    });
  },
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgGlossaryLookupStore: GlossaryLookupStore = guardDbStore("glossary-lookup", rawPgGlossaryLookupStore);
