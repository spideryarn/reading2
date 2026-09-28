/**
 * **The shelf's filter terms, the Postgres half** — the reader's current
 * revisions, their stored candidate phrases, the bounded fill, and the one
 * function the route calls. docs/plans/260928a-shelf-facet-terms.md § Storage,
 * § Filling it and § The route; the pure halves are src/shelf-terms/.
 *
 * ## The one isolation argument
 *
 * **Every read and every write starts from `currentShelfRevisions`**, which is
 * owner-scoped with the shelf's own predicates (`ownedByReader`, `onTheShelf`,
 * the same `archived_at` test and the same join to the current revision as
 * `listArticlesQuery` in pg.ts). Candidate rows are read only for revision ids
 * in that set, blocks only for `(article, revision)` pairs in it, and a fill
 * only writes for pairs in it. So another reader's articles never reach the
 * candidates, the document frequencies or the idf — which is the whole of the
 * leak surface (docs/project/security-map.md; Sol F10).
 *
 * ## A GET that writes
 *
 * `shelfTerms` fills what is missing inside a time budget. The write is an
 * idempotent cache fill of a deterministic function: a retry, a prefetch or a
 * second tab writes the same row or nothing (`on conflict do nothing`). The
 * plan § Filling it has the argument and the alternative that was not taken.
 *
 * ## What may be logged from this file
 *
 * Nothing, and nothing is. Phrases are the reader's articles' words.
 */

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb, type Db } from "../db/client.js";
import { articleRevisions, articles, revisionBlocks, revisionPhraseRuns } from "../db/schema.js";
import { chooseTerms, type ChooseArticle } from "../shelf-terms/choose.js";
import {
  EXTRACTOR_VERSION,
  extractCandidates,
  segmentsFromBlocks,
  type Extraction,
  type SegmentBlock,
  type SkipReason,
} from "../shelf-terms/extract.js";
import type { LibraryTermsResponse } from "../types.js";
import type { ShelfTermsStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { READ_COMMITTED } from "./isolation.js";
import { ADDED_AT, onTheShelf, ownedByReader } from "./pg.js";

/** About two seconds of extraction per request — the plan § Filling it (Sol F2). */
export const DEFAULT_FILL_BUDGET_MS = 2000;

/** One article in scope: its current revision, as the shelf sees it. */
export interface ShelfRevision {
  articleId: string;
  revisionId: string;
  slug: string;
  archived: boolean;
  /** The revision's own title — not the reader's rename, so the row stays a function of the revision. */
  title: string | null;
}

export interface ShelfScope {
  /** False: the shelf proper. True: active **and** archived — not archived only, unlike `listArticles`. */
  archived: boolean;
}

/**
 * **The one owner-scoped query**, taking its builder so a test can read the
 * SQL it sends. Newest first, by the shelf's own `ADDED_AT`, which is the order
 * the fill works in.
 */
export function shelfRevisionsQuery(db: Pick<Db, "select">, scope: ShelfScope) {
  return db
    .select({
      articleId: articles.id,
      revisionId: articleRevisions.id,
      slug: articles.slug,
      archivedAt: articles.archivedAt,
      title: articleRevisions.title,
    })
    .from(articles)
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    .where(
      and(
        ownedByReader(),
        onTheShelf(),
        /* `=== "1"` upstream; here, both halves or the shelf proper. */
        scope.archived ? undefined : isNull(articles.archivedAt),
      ),
    )
    .orderBy(desc(ADDED_AT), asc(articles.slug));
}

export async function currentShelfRevisions(scope: ShelfScope): Promise<ShelfRevision[]> {
  const rows = await shelfRevisionsQuery(getDb(), scope);
  return rows.map((r) => ({
    articleId: r.articleId,
    revisionId: r.revisionId,
    slug: r.slug,
    archived: r.archivedAt !== null,
    title: r.title,
  }));
}

/** Step 1's output as stored: an `Extraction`, keyed by the revision it was read from. */
export type StoredRun = Extraction;

/**
 * The stored runs for this extractor version, **for revisions in `set` and no
 * others**. Absent from the map means not yet computed.
 */
export async function readPhraseRuns(
  set: readonly ShelfRevision[],
  version: number = EXTRACTOR_VERSION,
): Promise<Map<string, StoredRun>> {
  if (!set.length) return new Map();
  const rows = await getDb()
    .select({
      revisionId: revisionPhraseRuns.revisionId,
      words: revisionPhraseRuns.words,
      textHash: revisionPhraseRuns.textHash,
      skipped: revisionPhraseRuns.skipped,
      candidates: revisionPhraseRuns.candidates,
    })
    .from(revisionPhraseRuns)
    .where(
      and(
        eq(revisionPhraseRuns.extractorVersion, version),
        inArray(
          revisionPhraseRuns.revisionId,
          set.map((s) => s.revisionId),
        ),
      ),
    );
  return new Map(
    rows.map((r) => [
      r.revisionId,
      {
        words: r.words,
        textHash: r.textHash,
        /* The CHECK constraint holds it to these two. */
        skipped: r.skipped as SkipReason | null,
        candidates: r.candidates,
      },
    ]),
  );
}

/** The set's entries with no stored run, in the set's order (newest first). */
export function missingRuns(
  set: readonly ShelfRevision[],
  runs: ReadonlyMap<string, StoredRun>,
): ShelfRevision[] {
  return set.filter((s) => !runs.has(s.revisionId));
}

/** One revision's blocks, in document order — both halves of the key, as the composite FK has them. */
export async function readRevisionBlocks(entry: ShelfRevision): Promise<SegmentBlock[]> {
  const rows = await getDb()
    .select({
      text: revisionBlocks.text,
      kind: revisionBlocks.kind,
      level: revisionBlocks.level,
      role: revisionBlocks.role,
      treatment: revisionBlocks.treatment,
      gistable: revisionBlocks.gistable,
    })
    .from(revisionBlocks)
    .where(
      and(eq(revisionBlocks.articleId, entry.articleId), eq(revisionBlocks.revisionId, entry.revisionId)),
    )
    .orderBy(asc(revisionBlocks.ordinal));
  /* The CHECK constraint holds `treatment` to null or 'supplement' (schema.ts). */
  return rows.map((b) => ({ ...b, treatment: b.treatment === "supplement" ? "supplement" : null }));
}

/** Read and extract, **writing nothing** — the report script's path, and the fill's first half. */
export async function extractRevision(entry: ShelfRevision): Promise<Extraction> {
  return extractCandidates(segmentsFromBlocks(entry.title, await readRevisionBlocks(entry)));
}

/**
 * Write one run, and remove this article's rows for any revision that is no
 * longer its current one. One transaction, `read committed` like every
 * transaction in this store (isolation.ts).
 *
 * The delete compares against the article's current revision **as it is now**,
 * not against `entry.revisionId`: if the article was republished while this
 * fill ran, the row just written is the stale one, and it goes; the new
 * revision's row, if a peer already wrote it, stays. The owner is in the
 * subquery too, so a revision id that somehow was not the reader's deletes
 * nothing.
 */
export async function writePhraseRun(
  entry: ShelfRevision,
  run: Extraction,
  version: number = EXTRACTOR_VERSION,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx
      .insert(revisionPhraseRuns)
      .values({
        revisionId: entry.revisionId,
        articleId: entry.articleId,
        extractorVersion: version,
        words: run.words,
        textHash: run.textHash,
        skipped: run.skipped,
        candidates: run.candidates,
      })
      .onConflictDoNothing();
    await tx.delete(revisionPhraseRuns).where(
      and(
        eq(revisionPhraseRuns.articleId, entry.articleId),
        sql`${revisionPhraseRuns.revisionId} <> (
          select ${articles.currentRevisionId} from ${articles}
          where ${articles.id} = ${entry.articleId} and ${ownedByReader()})`,
      ),
    );
  }, READ_COMMITTED);
}

export interface FillOptions {
  /** Stop starting new articles once this many ms have passed. At least one is always filled. */
  budgetMs?: number;
}

export interface FillResult {
  /** What this call computed, by revision id — already written. */
  filled: Map<string, Extraction>;
  /** How many of `missing` are still not computed. */
  pending: number;
}

/**
 * Fill `missing` in order (newest first) until the budget is spent. **At least
 * one per call**, so a budget smaller than one article still makes progress
 * and the client's "ask again" loop cannot spin.
 */
export async function fillPhraseRuns(
  missing: readonly ShelfRevision[],
  opts: FillOptions = {},
): Promise<FillResult> {
  const budget = opts.budgetMs ?? DEFAULT_FILL_BUDGET_MS;
  const started = performance.now();
  const filled = new Map<string, Extraction>();
  for (const entry of missing) {
    if (filled.size > 0 && performance.now() - started >= budget) break;
    const run = await extractRevision(entry);
    await writePhraseRun(entry, run);
    filled.set(entry.revisionId, run);
  }
  return { filled, pending: missing.length - filled.size };
}

/** Step 2's input from what is known; pending articles are left out, not guessed at. */
export function chooseInput(
  set: readonly ShelfRevision[],
  runs: ReadonlyMap<string, Extraction>,
): ChooseArticle[] {
  const out: ChooseArticle[] = [];
  for (const s of set) {
    const run = runs.get(s.revisionId);
    if (run) out.push({ slug: s.slug, words: run.words, textHash: run.textHash, candidates: run.candidates });
  }
  return out;
}

/**
 * **The route's whole answer**: the owner-scoped set, its stored runs, a
 * bounded fill of the rest, and the chooser over everything known.
 */
export async function shelfTerms(
  scope: ShelfScope,
  opts: FillOptions = {},
): Promise<LibraryTermsResponse> {
  const set = await currentShelfRevisions(scope);
  const runs = await readPhraseRuns(set);
  const { filled, pending } = await fillPhraseRuns(missingRuns(set, runs), opts);
  for (const [id, run] of filled) runs.set(id, run);

  const input = chooseInput(set, runs);
  const { terms, works } = chooseTerms(input);
  let skipped = 0;
  for (const run of runs.values()) if (run.skipped) skipped += 1;
  return {
    terms: terms.map((t) => ({
      key: t.key,
      label: t.label,
      articles: t.articles.map((a) => ({ slug: a.slug, count: a.count })),
    })),
    scope: { articles: set.length, works, skipped },
    pending,
  };
}

const rawPgShelfTermsStore: ShelfTermsStore = {
  terms: (scope, opts) => shelfTerms(scope, opts),
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgShelfTermsStore: ShelfTermsStore = guardDbStore("shelf-terms", rawPgShelfTermsStore);
