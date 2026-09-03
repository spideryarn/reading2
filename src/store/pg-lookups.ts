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
import { glossaryLookups } from "../db/schema.js";
import type { LookupsByTerm } from "../glossary-lookups.js";
import { currentOwnerId } from "../owner.js";
import type { Citation, GlossaryLookup } from "../types.js";
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
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgGlossaryLookupStore: GlossaryLookupStore = guardDbStore("glossary-lookup", rawPgGlossaryLookupStore);
