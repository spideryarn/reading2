/**
 * The shelf's writes, and the library-wide search box — the Postgres halves.
 *
 * Split out of src/store/pg.ts rather than added to it for the reason that file
 * gives about itself: it is the **read** store, and the one property a read
 * store has going for it is that it cannot change anything. These are writes.
 * Search is here rather than there for a weaker but real reason — it is the only
 * thing in the codebase that touches `revision_blocks.fts`, and keeping the one
 * `tsvector` query beside the one column it queries means the two cannot drift
 * apart unnoticed.
 *
 * Same three rules as pg.ts, and they bite here too:
 *
 * 1. `exactOptionalPropertyTypes` is on — every optional field is a conditional
 *    spread, because Postgres says `null` where the file said nothing.
 * 2. Errors carry a `status`, or routes.ts turns "no such article" into a 500.
 * 3. **No fallback to the filesystem, ever.** Not even for "the article is only
 *    on disk". A silent fallback hides the divergence the parity test exists to
 *    find. See docs/plans/260826e-postgres-storage-implementation.md § Rules.
 */

import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articles, articleRevisions, revisionBlocks } from "../db/schema.js";
import { MAX_TITLE_CHARS } from "../shelf.js";
import { MAX_PURPOSE_CHARS, normaliseProfileText } from "../profile.js";
import { log } from "../log.js";
import { notFound, ownedByReader, ownedSlug, requireSlug, shelfFrom } from "./pg.js";
import type { LibrarySearch, LibrarySearchOptions, ShelfStore } from "./contracts.js";
import type { LibraryEntry, LibraryHit, ShelfState } from "../types.js";
import { pgArticleReader } from "./pg.js";

/**
 * The text-search configuration, in the one place that is allowed to name it.
 *
 * It must be the same string the generated column in src/db/schema.ts uses. A
 * vector built with `'english'` and queried with `'simple'` matches almost
 * nothing and raises no error at all — the query is valid, the stems just never
 * line up. That is the whole failure: a search box that returns nothing and
 * looks like an empty library.
 */
const CONFIG = "english";

export const pgShelfStore: ShelfStore = {
  async read(slug: string): Promise<ShelfState> {
    requireSlug(slug);
    const db = getDb();
    const [row] = await db.select().from(articles).where(ownedSlug(slug)).limit(1);
    if (!row) throw notFound(slug);
    return shelfFrom(row);
  },

  /**
   * Both fields in **one** `UPDATE`.
   *
   * Two statements would be two chances for a reader to see half of one act,
   * and — worse on the route side — a chance to write the first and reject the
   * second. See `ShelfStore.patch`.
   */
  async patch(slug, change): Promise<LibraryEntry> {
    requireSlug(slug);

    const title = change.title === undefined ? undefined : (change.title?.trim() ?? "");
    if (title !== undefined && title.length > MAX_TITLE_CHARS) {
      throw Object.assign(new Error(`Title must be ${MAX_TITLE_CHARS} characters or fewer`), {
        status: 400,
      });
    }

    // `normaliseProfileText`, not `trim()` — this column has to agree with the
    // filesystem store's normalisation byte for byte, or the same purpose typed
    // twice would hash to two different values. See src/shelf.ts.
    const purpose =
      change.purpose === undefined ? undefined : normaliseProfileText(change.purpose);
    if (purpose && purpose.length > MAX_PURPOSE_CHARS) {
      throw Object.assign(new Error(`Purpose must be ${MAX_PURPOSE_CHARS} characters or fewer`), {
        status: 400,
      });
    }

    const set: Record<string, unknown> = {};
    // Whitespace-only clears the override, exactly as it does on disk.
    if (title !== undefined) set.titleOverride = title || null;
    if (purpose !== undefined) set.purpose = purpose || null;
    if (change.archived !== undefined) {
      /* `coalesce(archived_at, now())` rather than a plain `now()`: archiving
         something already archived keeps the ORIGINAL date. Undo is one click
         away and a second Delete must not quietly reset the clock — the same
         rule src/shelf.ts keeps on the filesystem side. */
      set.archivedAt = change.archived ? sql`coalesce(${articles.archivedAt}, now())` : null;
    }
    // The route refuses an empty change before it gets here; this is the
    // belt-and-braces that stops a future caller producing `UPDATE … SET` with
    // nothing after it, which is a syntax error rather than a no-op.
    if (Object.keys(set).length === 0) return entryFor(slug, false);

    const [row] = await db().update(articles).set(set).where(ownedSlug(slug)).returning();
    if (!row) throw notFound(slug);
    return entryFor(slug, !!row.archivedAt);
  },

  async recordOpen(slug: string): Promise<void> {
    requireSlug(slug);
    /* `opens + 1` computed by Postgres, never read-then-write from here. Two
       tabs opening the same article at once would otherwise both read 4, both
       write 5, and lose one — with both writes reporting success, which is the
       failure this repo keeps finding (docs/reusable/silent-success.md). The
       filesystem side gets the same guarantee a different way, by serialising
       its read-modify-write in one process. */
    const [row] = await db()
      .update(articles)
      .set({ opens: sql`${articles.opens} + 1`, lastOpenedAt: sql`now()` })
      .where(ownedSlug(slug))
      .returning({ slug: articles.slug });
    if (!row) throw notFound(slug);
  },
};

/** `getDb()`, named so the statements above read as statements. */
const db = () => getDb();

/**
 * The article as the shelf now describes it.
 *
 * Through `listArticles` rather than assembled here, so the card the client
 * renders after a write comes from the same derivation as the card before it.
 * A second way of building a `LibraryEntry` is the divergence this seam exists
 * to make impossible — and it is worth the extra query at this size.
 */
async function entryFor(slug: string, archived: boolean): Promise<LibraryEntry> {
  const entries = await pgArticleReader.listArticles({ archived });
  const entry = entries.find((e) => e.slug === slug);
  if (!entry) {
    // The write above already proved the row exists, so this is "not a complete
    // article" (no tree, no blocks), not "no such article". Different problem,
    // different place to look.
    throw Object.assign(
      new Error(`No shelf entry for ${slug} after writing — is it a complete article?`),
      { status: 404 },
    );
  }
  return entry;
}

export const pgLibrarySearch: LibrarySearch = {
  async searchLibrary(query: string, limit: number, opts: LibrarySearchOptions = {}) {
    const trimmed = query.trim();
    if (!trimmed) return { hits: [], capped: false };

    const db = getDb();

    /* `websearch_to_tsquery`, not `to_tsquery` or `plainto_tsquery`.
       `to_tsquery` demands operator syntax and throws a 42601 on a bare
       sentence — a search box that 500s when you type two words. `plainto_`
       ANDs everything and understands no syntax at all. `websearch_to_` is the
       one that takes what a person types: quoted phrases, `or`, a leading `-`
       to exclude. It never throws on malformed input, which is the property
       that matters when the input is a half-typed word.

       So `qualia OR "hard problem"` becomes `'qualia' | ( 'hard' <-> 'problem' )`
       — a real disjunction with a real phrase in it. The filesystem adapter
       cannot do any of that and does not pretend to; src/library-search.ts
       § parseQuery says so out loud. */
    const tsquery = sql`websearch_to_tsquery(${CONFIG}, ${trimmed})`;

    /* `ts_headline` is deliberately NOT used for the snippet. It re-parses the
       document per row, is the expensive half of a query like this, and returns
       HTML we would then have to sanitise — for a result the client can get by
       finding the words itself, which it already does for in-article hits
       (src/web/search-hits.ts). So: return the block's text and let the client
       mark it. One highlighter, not two that disagree. */
    /* Normalisation flag **1** — divide the rank by `1 + log(document length)`
       — not the default 0, which is no normalisation at all. Without it a long
       paragraph outranks a short one simply by containing more words, and the
       filesystem adapter explicitly damps for length, so the two would have
       disagreed about which hit is best for a reason nobody had chosen.
       https://www.postgresql.org/docs/17/textsearch-controls.html */
    const rank = sql<number>`ts_rank_cd(${revisionBlocks.fts}, ${tsquery}, 1)`;

    /* One more than asked for, so "there were more" is a fact rather than a
       guess. A list that is silently cut reads as "that is everything". */
    const rows = await db
      .select({
        slug: articles.slug,
        title: sql<string>`coalesce(${articles.titleOverride}, ${articleRevisions.title}, ${articles.slug})`,
        blockId: revisionBlocks.blockId,
        text: revisionBlocks.text,
        rank,
      })
      .from(revisionBlocks)
      .innerJoin(articleRevisions, eq(articleRevisions.id, revisionBlocks.revisionId))
      /* Joined on `current_revision_id`, not just on `article_id`. Without it a
         search would return the same paragraph once per historical revision —
         and since the pipeline publishes a new revision on every re-run, an
         article you had rebuilt three times would quietly outrank everything
         else by having three copies of itself in the results. */
      .innerJoin(
        articles,
        and(eq(articles.id, revisionBlocks.articleId), eq(articles.currentRevisionId, revisionBlocks.revisionId)),
      )
      .where(
        and(
          /* **Your library, not the union of everybody's.** This one is reached
             by chat's `search_library` tool as well as by the reader's own box,
             so without it a model answering your question could quote a
             stranger's article back at you. src/store/pg.ts § `ownedSlug`. */
          ownedByReader(),
          // Archived articles are out of the index, not filtered from the
          // results: a hit that opens an article you deleted reads as a ghost.
          isNull(articles.archivedAt),
          /* In the WHERE clause, so it happens before `limit` below. Chat's
             `search_library` asks for this to leave out the article the reader
             already has open, and removing it from the returned rows instead
             would let it spend every place in the list first — which is
             exactly the bug `LibrarySearchOptions` in ./contracts.ts describes.
             An unknown slug simply excludes nothing; `ne` on a column with no
             such value is true for every row. */
          ...(opts.excludeSlug ? [ne(articles.slug, opts.excludeSlug)] : []),
          /* Headings and media carry no prose worth a snippet, and a hit on a
             one-word heading is noise at the top of the list.

             **And no `treatment <> 'supplement'` beside it, deliberately.** This
             is library full-text search, and `isSearchable` in
             src/block-policy.ts is the one predicate of the five that includes
             supplements: a note is often the best sentence in a piece, and a
             reader who searches for it has to find it. docs/plans/260828o-footnotes.md
             recorded the opposite as work to do and was wrong; GPT Sol's
             decision 4. tests/library-search.test.ts holds the filesystem half
             to the same rule, and tests/block-policy.test.ts guards this line. */
          eq(revisionBlocks.gistable, true),
          sql`${revisionBlocks.fts} @@ ${tsquery}`,
        ),
      )
      /* Tie-broken by slug then position, so two equally-ranked passages come
         back in the same order every time. Without it the cap below silently
         keeps a different hit on different runs, and a result list that
         reshuffles for no visible reason reads as a bug. */
      .orderBy(desc(rank), asc(articles.slug), asc(revisionBlocks.ordinal))
      .limit(limit + 1);

    const capped = rows.length > limit;
    const hits: LibraryHit[] = rows.slice(0, limit).map((row) => ({
      slug: row.slug,
      title: row.title,
      blockId: row.blockId,
      text: row.text,
      rank: Number(row.rank),
    }));

    log("store").debug({ hits: hits.length, capped }, "library search");
    return { hits, capped };
  },
};
