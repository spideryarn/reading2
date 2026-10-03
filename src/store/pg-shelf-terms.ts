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

import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb, type Db } from "../db/client.js";
import {
  articleRevisions,
  articles,
  revisionBlocks,
  revisionPhraseRuns,
  shelfTopicScores,
  shelfTopicSets,
} from "../db/schema.js";
import { currentOwnerId } from "../owner.js";
import { type ChooseArticle, type ChooseResult, chooseTerms } from "../shelf-terms/choose.js";
import {
  EXTRACTOR_VERSION,
  extractCandidates,
  segmentsFromBlocks,
  type Extraction,
  type SegmentBlock,
  type SkipReason,
} from "../shelf-terms/extract.js";
import type { LibraryTermsResponse } from "../types.js";
import type {
  ShelfTermsSnapshot,
  ShelfTermsStore,
  ShelfTopicArticle,
  StoredTopicScores,
  StoredTopicSet,
  TopicScope,
  TopicScoresResult,
  TopicSetResult,
  TopicShelfArticle,
} from "./contracts.js";
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
  /**
   * The reader's rename, or null. Never read by step 1 (see `title`); the
   * model is shown it, because it is the title the reader sees
   * (src/shelf-topics.ts).
   */
  titleOverride: string | null;
  /** `article_revisions.root_gist` — the card's one-sentence blurb. Shown to the model only. */
  gist: string | null;
}

export interface ShelfScope {
  /** False: the shelf proper. True: active **and** archived — not archived only, unlike `listArticles`. */
  archived: boolean;
}

/**
 * **The shelf boundary, once**: owned by the ambient reader, on the shelf, and
 * a current revision the shelf can show (the caller joins it). Both
 * `shelfRevisionsQuery` and `topicShelfQuery` take it, so the two cannot
 * disagree about which articles are the reader's shelf.
 */
function shelfBoundary(scope: ShelfScope) {
  return and(
    ownedByReader(),
    onTheShelf(),
    /* `listArticles` drops these two cases after its query. Mirror that
       exact readable-revision boundary here so a slug cannot receive a
       topic while having no card (or get a cache row for a revision the
       shelf does not expose). The scalar fallback is the same one
       `scalarsForShelf` uses: a stored count wins; older rows with no
       count are judged by their actual block rows. */
    sql`${articleRevisions.tree} is not null`,
    sql`coalesce(
      ${articleRevisions.blockCount},
      (select count(*)::integer from ${revisionBlocks}
       where ${revisionBlocks.revisionId} = ${articleRevisions.id})
    ) > 0`,
    /* `=== "1"` upstream; here, both halves or the shelf proper. */
    scope.archived ? undefined : isNull(articles.archivedAt),
  );
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
      titleOverride: articles.titleOverride,
      gist: articleRevisions.rootGist,
    })
    .from(articles)
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    .where(shelfBoundary(scope))
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
    titleOverride: r.titleOverride,
    gist: r.gist,
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
 * The delete compares against the article's current revision in that
 * statement's `read committed` snapshot, not against `entry.revisionId`: if a
 * republication committed before cleanup, the row just written is stale and
 * goes; the new revision's row, if a peer already wrote it, stays. A
 * publication after that snapshot can leave the old cache row until the new
 * revision's first fill, but no read can select it because reads start from the
 * current-revision set. The owner is in the subquery too, so a revision id that
 * somehow was not the reader's deletes nothing.
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
    if (run && !run.skipped)
      out.push({ slug: s.slug, words: run.words, textHash: run.textHash, candidates: run.candidates });
  }
  return out;
}

/**
 * **Everything the chooser needs**: the owner-scoped set, its stored runs, a
 * bounded fill of the rest — and, for the model, each read article's title and
 * gist, newest first.
 */
export async function shelfSnapshot(scope: ShelfScope, opts: FillOptions = {}): Promise<ShelfTermsSnapshot> {
  const set = await currentShelfRevisions(scope);
  const runs = await readPhraseRuns(set);
  const { filled, pending } = await fillPhraseRuns(missingRuns(set, runs), opts);
  for (const [id, run] of filled) runs.set(id, run);

  let skipped = 0;
  for (const run of runs.values()) if (run.skipped) skipped += 1;
  const shown: ShelfTopicArticle[] = [];
  for (const s of set) {
    const run = runs.get(s.revisionId);
    if (run && !run.skipped)
      shown.push({ slug: s.slug, title: s.titleOverride ?? s.title ?? s.slug, gist: s.gist });
  }
  return { input: chooseInput(set, runs), articles: shown, scope: { articles: set.length, skipped }, pending };
}

/** The wire shape, from a snapshot and whatever the chooser picked from it. */
export function termsResponse(snap: ShelfTermsSnapshot, chosen: ChooseResult): LibraryTermsResponse {
  return {
    terms: chosen.terms.map((t) => ({
      key: t.key,
      label: t.label,
      articles: t.articles.map((a) => ({ slug: a.slug, count: a.count })),
    })),
    scope: { articles: snap.scope.articles, works: chosen.works, skipped: snap.scope.skipped },
    pending: snap.pending,
    chosenBy: "program",
    refreshing: false,
  };
}

/**
 * **The program's answer, with no model anywhere** — the snapshot and the
 * deterministic chooser. The route asks src/shelf-topics.ts instead, which
 * starts from the same snapshot.
 */
export async function shelfTerms(scope: ShelfScope, opts: FillOptions = {}): Promise<LibraryTermsResponse> {
  const snap = await shelfSnapshot(scope, opts);
  return termsResponse(snap, chooseTerms(snap.input));
}

/* ------------------------------------------------- the model's scores -- */

/**
 * The model's scores for the ambient reader. Every statement names
 * `ownedScoreRow()` — the owner from the request's own box — so one reader
 * can neither read nor fence nor overwrite another's row. Nothing here is
 * logged: the row is a map of the reader's own phrases.
 */
function ownedScoreRow(scope: TopicScope) {
  return and(eq(shelfTopicScores.ownerId, currentOwnerId()), eq(shelfTopicScores.scope, scope));
}

export async function readTopicScores(scope: TopicScope): Promise<StoredTopicScores | null> {
  const [r] = await getDb().select().from(shelfTopicScores).where(ownedScoreRow(scope));
  if (!r) return null;
  /* The CHECK constraints hold each group to all-or-nothing, so one field
     stands for its group. */
  const result =
    r.inputHash !== null && r.model !== null && r.promptVersion !== null && r.scores !== null && r.computedAt !== null
      ? {
          inputHash: r.inputHash,
          model: r.model,
          promptVersion: r.promptVersion,
          scores: r.scores,
          computedAt: r.computedAt,
        }
      : null;
  const claim =
    r.claimId !== null && r.claimHash !== null && r.claimedUntil !== null
      ? { hash: r.claimHash, until: r.claimedUntil }
      : null;
  return { result, claim, failures: r.failures, retryAfter: r.retryAfter };
}

/**
 * **One statement, so two concurrent requests cannot both claim**: insert the
 * row with the claim, or update the existing one — and the update's `where`
 * refuses while a live claim stands, while the backoff has not passed, or when
 * the stored result is already for this input. `returning` is empty exactly
 * when it refused. The database's clock throughout, like the rate limiter.
 */
export async function claimTopicScores(scope: TopicScope, inputHash: string, leaseMs: number): Promise<string | null> {
  const claimId = randomUUID();
  const leaseSeconds = leaseMs / 1000;
  const rows = await getDb()
    .insert(shelfTopicScores)
    .values({
      ownerId: currentOwnerId(),
      scope,
      claimId,
      claimHash: inputHash,
      claimedUntil: sql`now() + make_interval(secs => ${leaseSeconds})`,
    })
    .onConflictDoUpdate({
      target: [shelfTopicScores.ownerId, shelfTopicScores.scope],
      set: {
        claimId: sql`excluded.claim_id`,
        claimHash: sql`excluded.claim_hash`,
        claimedUntil: sql`excluded.claimed_until`,
      },
      setWhere: sql`(${shelfTopicScores.claimedUntil} is null or ${shelfTopicScores.claimedUntil} <= now())
        and (${shelfTopicScores.retryAfter} is null or ${shelfTopicScores.retryAfter} <= now())
        and ${shelfTopicScores.inputHash} is distinct from excluded.claim_hash`,
    })
    .returning({ claimId: shelfTopicScores.claimId });
  return rows[0]?.claimId === claimId ? claimId : null;
}

export async function writeTopicScores(scope: TopicScope, claimId: string, result: TopicScoresResult): Promise<boolean> {
  const rows = await getDb()
    .update(shelfTopicScores)
    .set({
      inputHash: result.inputHash,
      model: result.model,
      promptVersion: result.promptVersion,
      scores: result.scores,
      computedAt: sql`now()`,
      claimId: null,
      claimHash: null,
      claimedUntil: null,
      failures: 0,
      retryAfter: null,
    })
    .where(and(ownedScoreRow(scope), eq(shelfTopicScores.claimId, claimId)))
    .returning({ scope: shelfTopicScores.scope });
  return rows.length > 0;
}

/**
 * **The backoff**: 2 minutes after the first failure, ×4 each time after —
 * 2, 8, 32, 128 minutes — and never more than six hours. Counted in SQL so it
 * is the database's clock, like the claim. A broken provider therefore costs
 * each reader about a dozen calls on its first day and four a day after that,
 * before the daily cap is even consulted.
 */
export const SCORE_BACKOFF_FIRST_SECONDS = 120;
export const SCORE_BACKOFF_MAX_SECONDS = 6 * 60 * 60;

export async function failTopicScores(scope: TopicScope, claimId: string): Promise<void> {
  await getDb()
    .update(shelfTopicScores)
    .set({
      claimId: null,
      claimHash: null,
      claimedUntil: null,
      failures: sql`${shelfTopicScores.failures} + 1`,
      retryAfter: sql`now() + make_interval(secs => least(
        ${SCORE_BACKOFF_MAX_SECONDS}::double precision,
        ${SCORE_BACKOFF_FIRST_SECONDS}::double precision * power(4, ${shelfTopicScores.failures})))`,
    })
    .where(and(ownedScoreRow(scope), eq(shelfTopicScores.claimId, claimId)));
}

export async function releaseTopicScores(scope: TopicScope, claimId: string, retryAfterMs: number): Promise<void> {
  await getDb()
    .update(shelfTopicScores)
    .set({
      claimId: null,
      claimHash: null,
      claimedUntil: null,
      retryAfter: sql`now() + make_interval(secs => ${retryAfterMs / 1000})`,
    })
    .where(and(ownedScoreRow(scope), eq(shelfTopicScores.claimId, claimId)));
}

/* --------------------------------------------- the model's topic set -- */

/**
 * **The topic model's view of the shelf, in one query**: every article inside
 * `shelfBoundary` — active **and** archived — newest first, with the stored
 * phrase run's `text_hash` for the current revision at this extractor version
 * (left join: null when there is no run yet; nothing is filled here).
 *
 * `article_revisions` is read by three short text columns, named directly as
 * `shelfRevisionsQuery` names its own; this is not one of
 * `REVISION_PROJECTIONS`' reads (src/store/pg.ts).
 */
export function topicShelfQuery(db: Pick<Db, "select">) {
  return db
    .select({
      articleId: articles.id,
      slug: articles.slug,
      archivedAt: articles.archivedAt,
      title: articleRevisions.title,
      titleOverride: articles.titleOverride,
      rootGist: articleRevisions.rootGist,
      abstract: articleRevisions.abstract,
      textHash: revisionPhraseRuns.textHash,
    })
    .from(articles)
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    .leftJoin(
      revisionPhraseRuns,
      and(
        eq(revisionPhraseRuns.revisionId, articleRevisions.id),
        eq(revisionPhraseRuns.extractorVersion, EXTRACTOR_VERSION),
      ),
    )
    .where(shelfBoundary({ archived: true }))
    .orderBy(desc(ADDED_AT), asc(articles.slug));
}

export async function topicShelf(): Promise<TopicShelfArticle[]> {
  const rows = await topicShelfQuery(getDb());
  return rows.map((r) => ({
    articleId: r.articleId,
    slug: r.slug,
    archived: r.archivedAt !== null,
    title: r.titleOverride ?? r.title ?? r.slug,
    gist: r.rootGist ?? r.abstract ?? null,
    textHash: r.textHash,
  }));
}

/**
 * The ambient reader's topic-set row. Every statement below names it — the
 * owner from the request's own box — so one reader can neither read nor claim
 * nor fence nor overwrite another's row. Nothing here is logged: the row is
 * topics named from the reader's own reading.
 */
function ownedTopicSetRow() {
  return eq(shelfTopicSets.ownerId, currentOwnerId());
}

export async function readTopicSet(): Promise<StoredTopicSet | null> {
  const [r] = await getDb().select().from(shelfTopicSets).where(ownedTopicSetRow());
  if (!r) return null;
  /* The CHECK constraints hold each group to all-or-nothing; the tests are
     spelled out so the compiler sees each field non-null. */
  const result =
    r.model !== null &&
    r.promptVersion !== null &&
    r.profileHash !== null &&
    r.topics !== null &&
    r.members !== null &&
    r.works !== null &&
    r.unplaced !== null &&
    r.rethoughtAt !== null
      ? {
          model: r.model,
          promptVersion: r.promptVersion,
          profileHash: r.profileHash,
          topics: r.topics,
          members: r.members,
          works: r.works,
          unplaced: r.unplaced,
          rethoughtAt: r.rethoughtAt,
          filedAt: r.filedAt,
        }
      : null;
  const claim = r.claimId !== null && r.claimedUntil !== null ? { until: r.claimedUntil } : null;
  return { result, claim, failures: r.failures, retryAfter: r.retryAfter };
}

/**
 * **One statement, so two concurrent requests cannot both claim** —
 * `claimTopicScores` without the input hash: insert the row with the claim, or
 * update the existing one, and the update's `where` refuses while a live claim
 * stands or the backoff has not passed. `returning` is empty exactly when it
 * refused. The database's clock throughout.
 */
export async function claimTopicSet(leaseMs: number): Promise<string | null> {
  const claimId = randomUUID();
  const rows = await getDb()
    .insert(shelfTopicSets)
    .values({
      ownerId: currentOwnerId(),
      claimId,
      claimedUntil: sql`now() + make_interval(secs => ${leaseMs / 1000})`,
    })
    .onConflictDoUpdate({
      target: shelfTopicSets.ownerId,
      set: { claimId: sql`excluded.claim_id`, claimedUntil: sql`excluded.claimed_until` },
      setWhere: sql`(${shelfTopicSets.claimedUntil} is null or ${shelfTopicSets.claimedUntil} <= now())
        and (${shelfTopicSets.retryAfter} is null or ${shelfTopicSets.retryAfter} <= now())`,
    })
    .returning({ claimId: shelfTopicSets.claimId });
  return rows[0]?.claimId === claimId ? claimId : null;
}

export async function writeTopicSet(claimId: string, result: TopicSetResult): Promise<boolean> {
  const rows = await getDb()
    .update(shelfTopicSets)
    .set({
      model: result.model,
      promptVersion: result.promptVersion,
      profileHash: result.profileHash,
      topics: result.topics,
      members: result.members,
      works: result.works,
      unplaced: result.unplaced,
      rethoughtAt: sql`now()`,
      filedAt: null,
      claimId: null,
      claimedUntil: null,
      failures: 0,
      retryAfter: null,
    })
    .where(and(ownedTopicSetRow(), eq(shelfTopicSets.claimId, claimId)))
    .returning({ ownerId: shelfTopicSets.ownerId });
  return rows.length > 0;
}

/**
 * Merge `members` over the stored map — `||`, so a key in both takes the new
 * value whole. **Refuses when there is no stored result** (`rethought_at is
 * not null` in the `where`): there are no topics to file into, and
 * `null || x` is null. A refusal leaves the claim standing, for the caller to
 * fail or release.
 */
export async function fileIntoTopicSet(claimId: string, members: Record<string, string[]>): Promise<boolean> {
  const rows = await getDb()
    .update(shelfTopicSets)
    .set({
      members: sql`${shelfTopicSets.members} || ${JSON.stringify(members)}::jsonb`,
      filedAt: sql`now()`,
      claimId: null,
      claimedUntil: null,
      failures: 0,
      retryAfter: null,
    })
    .where(
      and(ownedTopicSetRow(), eq(shelfTopicSets.claimId, claimId), sql`${shelfTopicSets.rethoughtAt} is not null`),
    )
    .returning({ ownerId: shelfTopicSets.ownerId });
  return rows.length > 0;
}

/** The scores' schedule: `SCORE_BACKOFF_FIRST_SECONDS`, ×4 each time, capped at `SCORE_BACKOFF_MAX_SECONDS`. */
export async function failTopicSet(claimId: string): Promise<void> {
  await getDb()
    .update(shelfTopicSets)
    .set({
      claimId: null,
      claimedUntil: null,
      failures: sql`${shelfTopicSets.failures} + 1`,
      retryAfter: sql`now() + make_interval(secs => least(
        ${SCORE_BACKOFF_MAX_SECONDS}::double precision,
        ${SCORE_BACKOFF_FIRST_SECONDS}::double precision * power(4, ${shelfTopicSets.failures})))`,
    })
    .where(and(ownedTopicSetRow(), eq(shelfTopicSets.claimId, claimId)));
}

export async function releaseTopicSet(claimId: string, retryAfterMs: number): Promise<void> {
  await getDb()
    .update(shelfTopicSets)
    .set({
      claimId: null,
      claimedUntil: null,
      retryAfter: sql`now() + make_interval(secs => ${retryAfterMs / 1000})`,
    })
    .where(and(ownedTopicSetRow(), eq(shelfTopicSets.claimId, claimId)));
}

const rawPgShelfTermsStore: ShelfTermsStore = {
  terms: (scope, opts) => shelfTerms(scope, opts),
  snapshot: (scope, opts) => shelfSnapshot(scope, opts),
  readScores: (scope) => readTopicScores(scope),
  claimScores: (scope, hash, leaseMs) => claimTopicScores(scope, hash, leaseMs),
  writeScores: (scope, claimId, result) => writeTopicScores(scope, claimId, result),
  failScores: (scope, claimId) => failTopicScores(scope, claimId),
  releaseScores: (scope, claimId, retryAfterMs) => releaseTopicScores(scope, claimId, retryAfterMs),
  topicShelf: () => topicShelf(),
  readTopicSet: () => readTopicSet(),
  claimTopicSet: (leaseMs) => claimTopicSet(leaseMs),
  writeTopicSet: (claimId, result) => writeTopicSet(claimId, result),
  fileIntoTopicSet: (claimId, members) => fileIntoTopicSet(claimId, members),
  failTopicSet: (claimId) => failTopicSet(claimId),
  releaseTopicSet: (claimId, retryAfterMs) => releaseTopicSet(claimId, retryAfterMs),
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgShelfTermsStore: ShelfTermsStore = guardDbStore("shelf-terms", rawPgShelfTermsStore);
