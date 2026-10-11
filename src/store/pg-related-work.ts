/**
 * **Sources' *Not cited*, in Postgres** — the mechanical half of
 * src/related-work.ts: the owner's loader, and the one row per article in
 * `related_work_searches` (src/db/schema.ts).
 *
 * - **The loader reads everything one request needs in one snapshot** (the
 *   plan review's F6): the imported title, authors, DOI, address and year, the
 *   opening paragraphs, the current Bibliography and whether it is stale, and
 *   the kept search. `repeatable read`, `read only`, as
 *   src/store/article-rows.ts § `SNAPSHOT`: a Bibliography made again between
 *   two of these reads would otherwise be judged against the other's blocks, or
 *   filter a search kept for another version.
 * - **Owner-scoped by `ownedSlug`**: somebody else's slug is the same 404 as one
 *   that does not exist, thrown before anything is asked of OpenAlex.
 * - **The title is the revision's own, never the reader's rename** (as
 *   `loadArticleIdentity`), falling back to the first top-level heading — but
 *   never to the slug, which is not words to search with.
 * - **The write replaces the row whole**: one upsert keyed on the article, so a
 *   second press's answer simply wins (F8). `created_at` never moves.
 *
 * ## What may be logged from this file
 *
 * Nothing: src/related-work.ts logs the search.
 */

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { decodeAuthors } from "../authors.js";
import { isStale as bibliographyIsStale } from "../bibliography.js";
import { getDb } from "../db/client.js";
import { articleRevisions, articles, relatedWorkSearches, revisionBlocks } from "../db/schema.js";
import {
  MAX_QUERY_BODY,
  type RelatedWorkLoaded,
  type RelatedWorkSearch,
  type StoredRelatedWork,
  relatedWorkOf,
} from "../related-work.js";
import { citedMetaFingerprintOf } from "../source-hash.js";
import type { Bibliography, RelatedWork, Tree } from "../types.js";
import type { RelatedWorkStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { ownedSlug } from "./owned-slug.js";
import { blockHashQuery, notFound, requireSlug } from "./pg.js";

/**
 * **One consistent picture of the article for one request.** See the header;
 * tests/store-transaction-isolation.test.ts § `EXCEPTIONS` names it.
 */
const SNAPSHOT = { isolationLevel: "repeatable read", accessMode: "read only" } as const;

/** How many leading blocks are read for the opening: far more than `MAX_QUERY_BODY` ever needs. */
const OPENING_BLOCKS = 40;

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** The first body paragraphs' text, until there is enough for the query. Not headings, notes, quotes or supplements. */
async function openingOf(tx: Tx, revisionId: string): Promise<string[]> {
  const rows = await tx
    .select({ text: revisionBlocks.text })
    .from(revisionBlocks)
    .where(
      and(
        eq(revisionBlocks.revisionId, revisionId),
        eq(revisionBlocks.kind, "text"),
        isNull(revisionBlocks.role),
        isNull(revisionBlocks.treatment),
        isNull(revisionBlocks.note),
      ),
    )
    .orderBy(asc(revisionBlocks.ordinal))
    .limit(OPENING_BLOCKS);
  const opening: string[] = [];
  let length = 0;
  for (const { text } of rows) {
    const flat = text.trim();
    if (flat === "") continue;
    opening.push(flat);
    length += flat.length + 1;
    if (length > MAX_QUERY_BODY) break;
  }
  return opening;
}

/** The first top-level heading, for a revision with no stored title — `firstHeadingTitle` in pg.ts. */
async function firstHeading(tx: Tx, revisionId: string): Promise<string | null> {
  const [row] = await tx
    .select({ text: revisionBlocks.text })
    .from(revisionBlocks)
    .where(and(eq(revisionBlocks.revisionId, revisionId), eq(revisionBlocks.kind, "heading"), eq(revisionBlocks.level, 1)))
    .orderBy(asc(revisionBlocks.ordinal))
    .limit(1);
  const text = row?.text.trim() ?? "";
  return text === "" ? null : text;
}

/** The kept row, its results checked again; null when there is none, or it is not the shape it should be. */
function storedOf(row: typeof relatedWorkSearches.$inferSelect | undefined): StoredRelatedWork | null {
  if (row === undefined || !Array.isArray(row.results)) return null;
  const works = row.results.map(relatedWorkOf).filter((work): work is RelatedWork => work !== null);
  return {
    fingerprint: row.fingerprint,
    yearLimit: row.yearLimit,
    works,
    searchedAt: new Date(row.searchedAt).toISOString(),
  };
}

/**
 * **What `GET` and `POST /api/related-work/:slug` read**, in one snapshot.
 * Throws the store's 404 for a slug that is not the caller's.
 */
async function loadRelatedWork(slug: string): Promise<RelatedWorkLoaded> {
  requireSlug(slug);
  return getDb().transaction(async (tx): Promise<RelatedWorkLoaded> => {
    const [found] = await tx
      .select({
        articleId: articles.id,
        revisionId: articleRevisions.id,
        title: articleRevisions.title,
        byline: articleRevisions.byline,
        siteName: articleRevisions.siteName,
        finalUrl: articleRevisions.finalUrl,
        authors: articleRevisions.authors,
        doi: articleRevisions.doi,
        abstract: articleRevisions.abstract,
        publishedAt: articleRevisions.publishedAt,
        publishedYear: articleRevisions.publishedYear,
        tree: articleRevisions.tree,
        bibliography: articleRevisions.bibliography,
      })
      .from(articles)
      .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
      .where(ownedSlug(slug))
      .limit(1);
    if (!found) throw notFound(slug);

    const bibliography = found.bibliography as Bibliography | null;
    const listed = bibliography !== null && Array.isArray(bibliography.citations) ? bibliography : null;
    /* One after another: a transaction is one connection. */
    const opening = await openingOf(tx, found.revisionId);
    const title = found.title ?? (await firstHeading(tx, found.revisionId));
    /* Only for staleness, and only when there is a list to judge. */
    const blocks = listed !== null ? await blockHashQuery(tx, found.revisionId) : [];
    const kept = await tx
      .select()
      .from(relatedWorkSearches)
      .where(eq(relatedWorkSearches.articleId, found.articleId))
      .limit(1);
    const authors = decodeAuthors(found.authors);
    const tree = found.tree as Tree | null;
    return {
      articleId: found.articleId,
      article: {
        title,
        ...(found.byline === null ? {} : { byline: found.byline }),
        ...(authors ? { authors } : {}),
        ...(found.doi === null ? {} : { doi: found.doi }),
        ...(found.finalUrl === null ? {} : { url: found.finalUrl }),
        ...(found.publishedAt === null ? {} : { publishedAt: found.publishedAt }),
        ...(found.publishedYear === null ? {} : { publishedYear: found.publishedYear }),
        ...(found.abstract === null ? {} : { abstract: found.abstract }),
      },
      opening,
      bibliography:
        listed === null
          ? null
          : {
              citations: listed.citations,
              /* Unknown counts as stale, as `loadBibliography` has it. */
              stale: !tree || bibliographyIsStale(listed, blocks, tree, citedMetaFingerprintOf(found)),
              capped: listed.capped === true,
            },
      stored: storedOf(kept[0]),
    };
  }, SNAPSHOT);
}

const rawPgRelatedWorkStore: RelatedWorkStore = {
  load: loadRelatedWork,

  async write(articleId: string, search: RelatedWorkSearch): Promise<string> {
    const [row] = await getDb()
      .insert(relatedWorkSearches)
      .values({
        articleId,
        fingerprint: search.fingerprint,
        yearLimit: search.yearLimit,
        results: search.works,
        searchedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: relatedWorkSearches.articleId,
        set: {
          fingerprint: search.fingerprint,
          yearLimit: search.yearLimit,
          results: search.works,
          searchedAt: sql`now()`,
        },
      })
      .returning({ searchedAt: relatedWorkSearches.searchedAt });
    if (!row) throw new Error("related_work_searches: the upsert returned no row");
    return new Date(row.searchedAt).toISOString();
  },
};

/** Guarded at the export, like every adapter here — tests/store-guarded.test.ts. */
export const pgRelatedWorkStore: RelatedWorkStore = guardDbStore("related-work", rawPgRelatedWorkStore);
