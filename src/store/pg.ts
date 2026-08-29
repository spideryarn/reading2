/**
 * The Postgres store. Same questions as src/store/fs.ts, same answers.
 *
 * "Same answers" is meant literally and is tested literally: tests/store-parity.test.ts
 * asks both stores for every article in `data/` and compares the **API-shaped**
 * result — the `Article` the client receives — not SQL rows. Comparing rows
 * passes while the thing the client gets has changed shape, which is the
 * failure this whole exercise exists to catch.
 *
 * ## Three things here are easy to get subtly wrong
 *
 * 1. **`exactOptionalPropertyTypes` is on.** An absent property and a property
 *    explicitly set to `undefined` are different types, and they serialise
 *    differently: `JSON.stringify({a: undefined})` is `{}`, but the property is
 *    there for `in` and for `Object.keys`. Postgres gives back `null` where the
 *    file had *nothing*, so every optional field is a conditional spread. This
 *    is the single biggest source of near-miss parity failures.
 * 2. **Errors carry a status.** `src/routes.ts` turns `status: 404` into a 404;
 *    an untagged throw becomes a 500. So "no such article" must be tagged here
 *    exactly as it is in src/api.ts, or a missing article starts reporting as a
 *    server fault.
 * 3. **Staleness is computed at read time, never stored.** A flag written when
 *    the artefact was generated is right up until the moment it matters.
 *
 * ## What is deliberately NOT here
 *
 * A fallback to the filesystem. Nothing in this file may catch an error and
 * call into src/store/fs.ts — see docs/plans/postgres-storage-implementation.md
 * § Rules. It would hide exactly the divergence the parity test is looking for.
 */

import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { describeArticle, titleFor } from "../api.js";
import type { Assets } from "../assets.js";
import { ASSETS_VERSION } from "../collect-assets.js";
import { getDb } from "../db/client.js";
import {
  articleRevisions,
  articles,
  comments as commentsTable,
  glossaryLookups,
  revisionBlocks,
  revisionStepRuns,
} from "../db/schema.js";
import { isStale as glossaryIsStale, PROMPT_VERSION } from "../glossary.js";
import {
  isStale as ideasAreStale,
  inputFingerprint as ideasFingerprint,
  PROMPT_VERSION as IDEAS_PROMPT_VERSION,
} from "../ideas.js";
import { isSlug } from "../ingest.js";
import { deriveLibraryScalars, headingTitleOf, type LibraryScalars } from "../library-scalars.js";
import { log } from "../log.js";
import { CAPABLE_MODEL } from "../models.js";
import { currentOwnerId } from "../owner.js";
import { STEP_ORDER, STEPS } from "../pipeline.js";
import { sanitizeStoredBlocks } from "../sanitize.js";
import { hashBlocks, type BlockFingerprint } from "../source-hash.js";
import { isStale as summariesStale } from "../summarise.js";
import { isStale as tweetsStale } from "../tweets.js";
import type {
  Arc,
  Article,
  ArticleMetadata,
  StageState,
  Block,
  Glossary,
  GlossaryFound,
  Ideas,
  IdeasFound,
  LibraryEntry,
  ListOptions,
  Meta,
  ShelfState,
  StepName,
  Summaries,
  SummariesFound,
  ThreadFound,
  Tree,
  TweetThread,
  Visibility,
} from "../types.js";
import { metaRawSha256, sameStamp } from "./artifacts.js";
import type { ArticleReader } from "./contracts.js";
import { pgReaderStore } from "./pg-reader.js";

/** A 404 shaped exactly like src/api.ts's, so routes.ts cannot tell them apart. */
export function notFound(slug: string): Error {
  return Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
}

/** A slug that is about to reach a query, or a 400 — the same guard src/api.ts keeps. */
export function requireSlug(slug: string): void {
  if (isSlug(slug)) return;
  throw Object.assign(new Error(`Not a slug: ${JSON.stringify(slug)}`), { status: 400 });
}

/**
 * The four shelf columns, as the shape `describeArticle` wants.
 *
 * Conditional spreads because `exactOptionalPropertyTypes` is on and Postgres
 * hands back `null` where the file simply had no key — the single biggest
 * source of near-miss parity failures in this store, per the file header.
 */
export function shelfFrom(article: typeof articles.$inferSelect): ShelfState {
  return {
    ...(article.archivedAt ? { archivedAt: article.archivedAt.toISOString() } : {}),
    ...(article.titleOverride ? { title: article.titleOverride } : {}),
    opens: article.opens,
    ...(article.lastOpenedAt ? { lastOpenedAt: article.lastOpenedAt.toISOString() } : {}),
    ...(article.purpose ? { purpose: article.purpose } : {}),
  };
}

/**
 * **The one way to name an article: by slug AND by owner.**
 *
 * `articles.slug` is globally unique, so `eq(articles.slug, slug)` on its own
 * finds *anybody's* article — which was fine for exactly as long as there was
 * one person. Since the gate started admitting real Supabase accounts
 * (src/auth.ts, 2026-08-27) it is the difference between a private shelf and a
 * shared one, and the failure is silent in the worst way: the query works, a
 * real article comes back, and it is somebody else's.
 *
 * A predicate rather than twelve hand-written `and(...)`s, for two reasons.
 * There were five near-identical `articleIdFor` helpers across the pg modules
 * and no way to tell by looking whether all five had been done. And
 * tests/owner-isolation.test.ts can now assert that **no file under src/store/
 * writes `eq(articles.slug, …)` outside this one** — so the thirteenth site,
 * written months from now by somebody who never read this comment, fails a test
 * instead of leaking a library.
 *
 * The 404 that follows a miss is the right answer as well as the convenient
 * one: "there is no such article" is all a stranger should learn about a slug
 * they do not own. A 403 would confirm it exists.
 */
/* **Moved to a leaf, and re-exported from here so nothing else changed.**
   `pg.ts` imports `src/api.ts`, so anything importing this file inherits the
   whole read layer — which closed an import cycle the moment the AI ledger
   needed the predicate. [owned-slug.ts](owned-slug.ts) imports the schema and
   the owner and nothing else. It also takes an optional owner now, for a caller
   that already knows whose row it is writing. */
export { ownedSlug } from "./owned-slug.js";
import { ownedSlug } from "./owned-slug.js";


/* **`slugIsTaken` moved to [slug-is-taken.ts](slug-is-taken.ts) on 2026-08-28**,
   and is deliberately NOT re-exported from here.

   It was the only reason this file was exempt from the owner-isolation grep, and
   the exemption covered fourteen hundred lines to protect six — so a fourth
   unfiltered lookup added anywhere in here would have passed. GPT Sol's finding
   4. Moving the function removed the exemption, and this file is now swept like
   every other. `ownedSlug` above is re-exported because it has a dozen callers;
   this one had exactly one, so it is imported from its new home instead. */


/** Every article this reader owns — the `where` for a list rather than a lookup. */
export function ownedByReader() {
  return eq(articles.ownerId, currentOwnerId());
}

/**
 * **What counts as an article on somebody's shelf**, in SQL.
 *
 * Two rules, and neither is obvious from the outside:
 *
 * - **It has a published revision.** `beginRevision` creates the `articles` row
 *   before there is anything in it (pg-revisions.ts), so a first ingest that
 *   fails leaves a row with `current_revision_id` null — a slug with no
 *   article behind it. `listArticles` never sees one, because its `innerJoin`
 *   on that column drops it.
 * - **Its slug does not start with `_`.** `data/_jobs/` is the ingest queue's
 *   directory and the filesystem walk has always skipped the prefix; see
 *   `listArticles` below for why this is `left(slug, 1)` rather than `not
 *   like`, which is a trap.
 *
 * A predicate rather than a comment because there is now a **second** caller:
 * src/store/pg-admin.ts counts articles per owner for the admin page, and a
 * count that included failed ingests would say somebody has four articles while
 * their shelf shows three. GPT Sol found exactly that, 2026-08-27 — the
 * aggregate had been written from the column rather than from the rule.
 *
 * **It is the SQL-expressible half and not the whole rule.** `listArticles`
 * additionally drops a row whose revision has no tree, or no blocks, per row in
 * TypeScript. Those are not in here: the first is a column test that would be
 * easy to add and the second is an `exists`, and neither has ever excluded a
 * published article — `publishRevision` will not publish one. If that stops
 * being true, this is where the third rule goes.
 */
export function onTheShelf() {
  return and(isNotNull(articles.currentRevisionId), sql`left(${articles.slug}, 1) <> '_'`);
}

/**
 * **Which reads may take which column of `article_revisions`.**
 *
 * Every column is named here, and the map is asserted exhaustive against
 * `getTableColumns` in tests/store-revision-columns.test.ts. That exhaustiveness
 * is the whole mechanism: adding a column to the schema fails the test until
 * somebody says which reads want it, so a new column is never silently pulled
 * into a query nor silently dropped out of one.
 *
 * ## Why this replaced "everything except `raw_bytes`"
 *
 * One shared projection served six reads. `raw_bytes` came out of it on
 * 2026-08-27, after the library page was measured dragging the whole corpus
 * across the wire — 8 articles, **23.89 MB** against 0.01 MB for the columns
 * actually read, because `listArticles` runs its query once per article and
 * `raw_bytes` is the entire fetched document, up to 32 MiB at stage 1's
 * ceiling. Everything else was then frozen in place by the test written at the
 * same time, which asserted the selection was *exactly* "all columns but that
 * one".
 *
 * What that left behind: a glossary read pulling `extracted_html` and
 * `stamped_html` — the whole article, twice — plus the tree, the labels, the
 * ideas and the summaries, in order to return a 10 KB glossary. About 508 KB of
 * it on a 360-block article, measured from the artefacts on disk that became
 * those columns. GPT Sol's review of docs/plans/glossary-read-latency.md said a
 * shared *narrow* set would still be the wrong shape, and it was right: the fix
 * is a projection per use.
 *
 * ## Two ways to want a column, since 2026-08-28
 *
 * The library asks four artefact columns one question — "is there one?" — and
 * it used to answer it by pulling the whole JSONB document across the wire and
 * writing `!= null`. On eight short articles that was 154 KB of tree, glossary,
 * summary, arc and tweets, per shelf load, to produce twenty booleans.
 *
 * So a read may take a column by `"value"` or by `"presence"`, and the two are
 * genuinely different facts about a query: presence is `is not null` evaluated
 * *in Postgres*, and the document never leaves the server. The distinction has
 * to be in the map because tests/store-revision-columns.test.ts asserts that a
 * query's projection is exactly what the policy grants it, and one axis cannot
 * say that the library may look at `glossary` but not read it.
 * docs/plans/library-read-latency.md § 3.
 */

/** By its value, or only by whether it is null. */
type ColumnUse = "value" | "presence";

/**
 * Which `has…` flag is the presence of which column — declared once.
 *
 * The projection spells its expressions out literally (see `REVISION_PROJECTIONS`
 * for why nothing here is built at runtime), the row type maps these keys to
 * `boolean`, and the policy test builds its expected key set from this rather
 * than from a naming convention it would otherwise have to guess.
 */
const PRESENCE_OF = {
  hasTree: "tree",
  hasArc: "arc",
  hasTweets: "tweets",
  hasGlossary: "glossary",
  hasSummary: "summary",
} as const satisfies Record<string, keyof typeof articleRevisions.$inferSelect>;

/** Exported for the test that guards the policy. Not a read seam. */
export const PRESENCE_OF_FOR_TEST = PRESENCE_OF;
type RevisionReader =
  | "article"
  | "library"
  | "metadata"
  | "publish"
  | "tweets"
  | "glossary"
  | "summaries"
  | "ideas";

const REVISION_READ_POLICY: Record<
  keyof typeof articleRevisions.$inferSelect,
  Partial<Record<RevisionReader, ColumnUse>>
> = {
  /* Identity. Every read has to know which revision it is looking at. */
  id: {
    article: "value", library: "value", metadata: "value", publish: "value",
    tweets: "value", glossary: "value", summaries: "value", ideas: "value",
  },
  articleId: { publish: "value" },
  /* `publish` refuses a revision that is not still a draft. */
  status: { publish: "value" },

  /* `metaFrom` — the reading view's masthead and the library card. */
  title: { article: "value", library: "value" },
  byline: { article: "value", library: "value" },
  siteName: { article: "value", library: "value" },
  lang: { article: "value", library: "value" },
  excerpt: { article: "value", library: "value", publish: "value" },
  note: { article: "value", library: "value" },
  finalUrl: { article: "value", library: "value" },
  fetchedAt: { article: "value", library: "value" },
  rawSha256: { article: "value", library: "value" },
  source: { article: "value", library: "value" },
  extractMethod: { article: "value", library: "value" },
  pages: { article: "value", library: "value" },
  unverified: { article: "value", library: "value" },
  recall: { article: "value", library: "value" },
  pagesChecked: { article: "value", library: "value" },

  /* The tree: the article renders it, `ideas` compares it (src/ideas.ts §
     `inputFingerprint` — that artefact is written from the skeleton as much as
     from the paragraphs), the metadata page checks it, and `publish` refuses a
     revision without one.

     The library only asks whether there is one, and asks it in SQL. It used to
     take the whole document — 37 KB on one article — to write `if (!tree)
     continue`. */
  tree: {
    article: "value", metadata: "value", publish: "value", ideas: "value",
    library: "presence",
  },
  arc: { article: "value", library: "presence" },

  /* **The image manifest, and the reading view is the only read that takes
     it.** It is what tells the reader which `<img src>` we hold a copy of, so
     an `article` read without it is an article that hot-links every image to
     the publisher — the feature reporting success by doing nothing, which is
     the whole reason `Article.assets` (src/types.ts) is a required key holding
     `Assets | undefined` rather than an optional one.

     **And on `metadata`, because that page draws a row for every step in
     `STEP_ORDER` automatically and asks each one "would we write this again
     today".** Without the column here, `isCurrent` below falls to its
     `default: true` arm and a manifest built against paragraphs that have since
     changed reports itself current on the one page whose whole job is to say
     otherwise — while the filesystem store, which asks the step's own `stamp`,
     says the opposite about the same article.

     Not on the library: a card says nothing about images, and a presence flag
     nobody draws is a column in a query for no reason. */
  assets: { article: "value", metadata: "value" },

  /* Each artefact goes to the one read that returns it, and to the metadata
     page, which asks of every artefact "would we write this again today".

     **The library takes all four by presence**, which is the whole of what a
     card shows: four ticks in a tooltip. Reading the documents to compare them
     with null was the second half of docs/plans/library-read-latency.md. */
  tweets: { metadata: "value", tweets: "value", library: "presence" },
  glossary: { metadata: "value", glossary: "value", library: "presence" },
  summary: { metadata: "value", summaries: "value", library: "presence" },
  ideas: { metadata: "value", ideas: "value" },

  /* **Read by nobody through here**, and the first three are why this map
     exists. `raw_bytes` is up to 32 MiB of source document. The two HTML
     columns are the whole article again, and they are pipeline artefacts
     reached through src/store/artifacts.ts and src/store/export.ts, never
     through a revision read — traced by grep, and independently by GPT Sol,
     2026-08-27. `labels` likewise. */
  rawBytes: {},
  extractedHtml: {},
  stampedHtml: {},
  labels: {},
  requestedUrl: {},
  rawContentType: {},
  rawEncoding: {},
  rawSourceKind: {},
  rawSourceSha256: {},
  /* Raw-source provenance, arriving 2026-08-28 with another agent's
     delete-the-importer work. Reached through src/store/export.ts and the
     artefact store, never through a revision read — `rawFilename` is
     reader-facing (it is what an uploaded PDF should download as) and will
     want a grant here the day something serves it, which is exactly what this
     map is for. */
  rawByteCount: {},
  rawFilename: {},
  /* **The library's cached scalars, and the library now reads them.**
     They are written by `deriveLibraryScalars` (src/library-scalars.ts) inside
     the same transaction that writes the blocks and the tree they describe —
     by `publishRevision`, and by the importer's in-place update — so they
     cannot describe text that is no longer there. That atomicity, not
     immutability, is the invariant: GPT Sol's second finding on the plan showed
     the importer updates a published revision in place.

     Until 2026-08-28 no read selected them and the shelf recomputed all five
     from every block row of every article, once per homepage load. */
  wordCount: { library: "value" },
  blockCount: { library: "value" },
  partCount: { library: "value" },
  sectionCount: { library: "value" },
  rootGist: { library: "value" },
  createdAt: {},
};

/* The `metaFrom` scalars, which two reads want and neither should spell twice. */
const META_COLUMNS = {
  title: articleRevisions.title,
  byline: articleRevisions.byline,
  siteName: articleRevisions.siteName,
  lang: articleRevisions.lang,
  excerpt: articleRevisions.excerpt,
  note: articleRevisions.note,
  finalUrl: articleRevisions.finalUrl,
  fetchedAt: articleRevisions.fetchedAt,
  rawSha256: articleRevisions.rawSha256,
  source: articleRevisions.source,
  extractMethod: articleRevisions.extractMethod,
  pages: articleRevisions.pages,
  unverified: articleRevisions.unverified,
  recall: articleRevisions.recall,
  pagesChecked: articleRevisions.pagesChecked,
} as const;

/**
 * The projections themselves — **written out, not built from the policy**.
 *
 * A projection derived from the map at runtime is opaque to Drizzle, which then
 * types every row as `never` or as the whole table; either way the compiler
 * stops being able to tell a selected column from an unselected one, which is
 * most of what these are for. Written literally, reading a field a read did not
 * ask for is a type error at the call site rather than an `undefined` that
 * looks like missing data.
 *
 * The cost is that the map and these can drift, so
 * tests/store-revision-columns.test.ts asserts each projection's keys equal the
 * columns the policy assigns it. That is the assertion GPT Sol asked for: the
 * map alone proves only that somebody classified every column, not that any
 * query obeys the classification.
 */
export const REVISION_PROJECTIONS = {
  article: {
    id: articleRevisions.id,
    ...META_COLUMNS,
    tree: articleRevisions.tree,
    arc: articleRevisions.arc,
    assets: articleRevisions.assets,
  },
  /**
   * The shelf. **Five cached scalars and five booleans, and not one document.**
   *
   * `sql<boolean>` rather than drizzle's `isNotNull()`, and the difference is a
   * type rather than a value: 0.45.2 types `isNotNull()` as `SQL<unknown>`, so
   * every flag would arrive as `unknown` and the first `if (row.hasArc)` would
   * compile against anything. node-postgres parses a Postgres boolean into a
   * real `true`/`false` either way — checked against the database, not assumed.
   *
   * `.as(…)` on each, and it is **not** load-bearing today: this driver runs
   * selects in `rowMode: "array"` and drizzle rebuilds the row by column index,
   * so five expressions Postgres would all name `?column?` cannot be mixed up.
   * It is there because a statement you might have to read in a slow-query log
   * should say which flag is which, and because "the driver happens to be
   * positional" is a thing that could change under us. GPT Sol checked the
   * mechanism in the installed version, 2026-08-28.
   */
  library: {
    id: articleRevisions.id,
    ...META_COLUMNS,
    wordCount: articleRevisions.wordCount,
    blockCount: articleRevisions.blockCount,
    partCount: articleRevisions.partCount,
    sectionCount: articleRevisions.sectionCount,
    rootGist: articleRevisions.rootGist,
    hasTree: sql<boolean>`${articleRevisions.tree} is not null`.as("has_tree"),
    hasArc: sql<boolean>`${articleRevisions.arc} is not null`.as("has_arc"),
    hasTweets: sql<boolean>`${articleRevisions.tweets} is not null`.as("has_tweets"),
    hasGlossary: sql<boolean>`${articleRevisions.glossary} is not null`.as("has_glossary"),
    hasSummary: sql<boolean>`${articleRevisions.summary} is not null`.as("has_summary"),
  },
  metadata: {
    id: articleRevisions.id,
    tree: articleRevisions.tree,
    assets: articleRevisions.assets,
    tweets: articleRevisions.tweets,
    glossary: articleRevisions.glossary,
    summary: articleRevisions.summary,
    ideas: articleRevisions.ideas,
  },
  publish: {
    id: articleRevisions.id,
    articleId: articleRevisions.articleId,
    status: articleRevisions.status,
    tree: articleRevisions.tree,
    excerpt: articleRevisions.excerpt,
  },
  tweets: { id: articleRevisions.id, tweets: articleRevisions.tweets },
  glossary: { id: articleRevisions.id, glossary: articleRevisions.glossary },
  summaries: { id: articleRevisions.id, summary: articleRevisions.summary },
  ideas: { id: articleRevisions.id, ideas: articleRevisions.ideas, tree: articleRevisions.tree },
} as const;

/** Exported for the test that guards the policy. Not a read seam. */
export const REVISION_READ_POLICY_FOR_TEST = REVISION_READ_POLICY;

/**
 * A revision row **as the `article` read has it**.
 *
 * `metaFrom` is the one helper shared by two projections, and this is the
 * narrower of the two — never `$inferSelect`, which is the shape of the
 * *table*. Asking the compiler for a field nobody selected is how a column gets
 * back into a query: the cheapest way to satisfy it is to fetch it again.
 */
type Selected = typeof articleRevisions.$inferSelect;

/**
 * The row one read gets back: exactly the columns its projection names.
 *
 * Three arms, and the last one is the mechanism. A key that is a column gets
 * that column's type; a key that is a declared `has…` flag gets `boolean`;
 * anything else gets `never`, so a projection key nobody classified is a type
 * error at every use rather than an `undefined` that reads as missing data.
 */
type RevisionRowFor<K extends RevisionReader> = {
  [C in keyof (typeof REVISION_PROJECTIONS)[K]]: C extends keyof Selected
    ? Selected[C]
    : C extends keyof typeof PRESENCE_OF
      ? boolean
      : never;
};

/** The shelf's row, which is no longer shaped like the reading view's. */
type LibraryRow = RevisionRowFor<"library">;

export type RevisionRead = RevisionRowFor<"article">;

/**
 * The query, taking its builder, so a test can read the SQL this will send.
 *
 * Same reason as `blockHashQuery` below, and GPT Sol's second finding on the
 * built code: a test that compares projection *objects* to the policy proves
 * nothing about whether any query uses them. Reverting this to
 * `revision: articleRevisions` left every projection test green and still
 * typechecked. The SQL is the only place the two facts meet.
 */
export function currentRevisionQuery<K extends RevisionReader>(
  db: Pick<ReturnType<typeof getDb>, "select">,
  slug: string,
  read: K,
) {
  return db
    .select({ article: articles, revision: REVISION_PROJECTIONS[read] })
    .from(articles)
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    .where(ownedSlug(slug))
    .limit(1);
}

/** One article's current published revision, or undefined. */
async function currentRevision<K extends RevisionReader>(slug: string, read: K) {
  const rows = await currentRevisionQuery(getDb(), slug, read);
  /* The cast is the one place the projection's runtime shape and its type meet.
     Drizzle infers the row correctly for a literal projection but not through
     the generic `K`, and widening the return type to the whole table here would
     undo the entire point of the projections. */
  return rows[0] as { article: typeof articles.$inferSelect; revision: RevisionRowFor<K> } | undefined;
}

/**
 * A revision's blocks, in document order.
 *
 * **`order by ordinal`, and nothing else.** Block ids are random and carry no
 * position, so if this clause is dropped the rows come back in whatever order
 * the planner likes — which for a small table is usually insertion order, so it
 * looks right in development and reorders the article in production. That is
 * why `ordinal` is written explicitly from the array index rather than inferred.
 */
/**
 * The rendering read's query, taking its builder for the same reason
 * `blockHashQuery` does: so a test can read the SQL rather than a constant
 * beside it. Reverting this to a bare `.select()` would silently put `fts` back
 * and nothing would have failed — GPT Sol's fifth finding on the built code.
 */
export function blocksQuery(db: Pick<ReturnType<typeof getDb>, "select">, revisionId: string) {
  return db
    /* **Named, not `.select()`.** The bare form takes every column, and one of
       them is `fts` — a generated tsvector whose own schema comment says it is
       *"queried with `@@` and never selected"*. It was selected on every
       article load, and it is roughly half the size of the text it indexes. */
    .select({
      blockId: revisionBlocks.blockId,
      tag: revisionBlocks.tag,
      kind: revisionBlocks.kind,
      level: revisionBlocks.level,
      text: revisionBlocks.text,
      words: revisionBlocks.words,
      html: revisionBlocks.html,
      gistable: revisionBlocks.gistable,
      note: revisionBlocks.note,
      role: revisionBlocks.role,
      treatment: revisionBlocks.treatment,
      noteId: revisionBlocks.noteId,
    })
    .from(revisionBlocks)
    .where(eq(revisionBlocks.revisionId, revisionId))
    .orderBy(asc(revisionBlocks.ordinal));
}

async function blocksFor(revisionId: string): Promise<Block[]> {
  const rows = await blocksQuery(getDb(), revisionId);

  const blocks = rows.map((row) => ({
    id: row.blockId,
    tag: row.tag,
    kind: row.kind as Block["kind"],
    // Conditional spreads throughout: the file simply had no `level` key, and
    // `level: undefined` is a different type under exactOptionalPropertyTypes.
    ...(row.level === null ? {} : { level: row.level }),
    text: row.text,
    words: row.words,
    html: row.html,
    gistable: row.gistable,
    ...(row.note === null ? {} : { note: row.note }),
    ...(row.role === null ? {} : { role: row.role as NonNullable<Block["role"]> }),
    ...(row.treatment === null ? {} : { treatment: row.treatment as NonNullable<Block["treatment"]> }),
    ...(row.noteId === null ? {} : { noteId: row.noteId }),
  }));

  /* The same guard src/api.ts puts on the filesystem reader, because there are
     two `loadArticle`s and guarding one of them passes every test — the fs half
     is genuinely protected, the suite is green, and the store that is in the
     middle of *replacing* the filesystem serves old HTML unchecked.

     `undefined` for the stamp, deliberately, and not because nobody got round
     to it: there is no column to keep one in yet, and absent reads as stale,
     which cleans. That is the safe direction and the honest one — it costs a
     re-clean on every Postgres article load until the column exists, and the
     alternative is claiming a cleanliness nothing has checked.

     The column belongs on `article_revisions` rather than `revision_blocks`
     when it lands: a revision is exactly one blocks.json and one cleaning pass,
     so per-block would store the same integer several hundred times and invite
     a revision whose own blocks disagree about when they were cleaned. See
     docs/project/security.md § There are two stores. */
  return sanitizeStoredBlocks(blocks, undefined).blocks;
}

/**
 * The blocks **as a fingerprint**, for the four reads that only want `stale`.
 *
 * `loadTweets`, `loadGlossary`, `loadSummaries` and `loadIdeas` each read every
 * block row — `text`, `html` and, until 2026-08-27, the generated `fts` vector
 * too — put them through the sanitiser, and then reduce the lot to a sixteen
 * character hash and throw them away. On a 360-block article that is roughly
 * 370 KB and an 80–180ms jsdom parse to compute one boolean.
 *
 * `hashBlocks` reads `id`, `text`, `role` and `treatment` and nothing else
 * (src/source-hash.ts), so that is what this selects — the block HTML and the
 * generated tsvector are what it exists to leave behind, and the two role
 * columns are four bytes each. **Aliased to `id`**, because the column is
 * `block_id` and the two have to be spelled to agree — a mismatch here would
 * hash `undefined` for every block, which is a perfectly stable hash that
 * happens to be the same for every article.
 *
 * **No sanitiser, and the reason is a contract rather than a guess.**
 * `sanitizeStoredBlocks` *"does not touch `text`"* — its docstring says so and
 * its implementation only ever rewrites `html` (src/sanitize.ts). So the hash
 * over these rows is byte-identical to the one the filesystem store computes
 * over sanitised blocks, which is what keeps the two stores agreeing about
 * `stale`. That agreement is what tests/store-parity.test.ts exists for.
 *
 * `order by ordinal` for the same reason `blocksFor` has it: block ids are
 * random and carry no position, so without it the rows arrive in whatever order
 * the planner likes — and `hashBlocks` joins them in the order it is given, so
 * a reordering silently changes the hash and every artefact reports itself
 * stale.
 */
async function blockHashInputs(revisionId: string): Promise<BlockFingerprint[]> {
  return blockHashQuery(getDb(), revisionId);
}

/**
 * The query itself, taking its builder, so that a test can read **the SQL this
 * server will actually send** rather than a constant beside it.
 *
 * GPT Sol's eighth finding on the plan: a selected-column constant can be
 * perfectly correct while the real query still says `.select()`, and a fixture
 * array that is already in order proves nothing about `order by`. Both of those
 * are only visible in the generated SQL, so the query has to be reachable
 * without a database — `QueryBuilder` from `drizzle-orm/pg-core` is enough of
 * one. tests/store-block-reads.test.ts.
 */
export function blockHashQuery(
  db: Pick<ReturnType<typeof getDb>, "select">,
  revisionId: string,
) {
  return db
    .select({
      id: revisionBlocks.blockId,
      text: revisionBlocks.text,
      role: revisionBlocks.role,
      treatment: revisionBlocks.treatment,
    })
    .from(revisionBlocks)
    .where(eq(revisionBlocks.revisionId, revisionId))
    .orderBy(asc(revisionBlocks.ordinal));
}

/**
 * Rebuild `Meta` from the revision's columns.
 *
 * The fallback matters: `src/api.ts` invents a title from the article's own
 * first `h1` when `meta.json` is absent, and keeps the slug only as a last
 * resort. An imported article with no `meta.json` has `title` null, so without
 * the same fallback here the reading view would show a slug where the
 * filesystem showed a heading — a visible, silent divergence.
 */
/**
 * The `metaFrom` columns as a row — what both reads that call it must supply.
 *
 * Narrower than either projection on purpose. The shelf's row and the reading
 * view's row now genuinely differ (one has the tree, the other has five
 * scalars), and this is the part they share.
 */
type MetaRow = { [C in keyof typeof META_COLUMNS]: Selected[C] };

function metaFrom(
  slug: string,
  /* **`MetaRow`, not `$inferSelect`** — the columns this function actually
     reads, which is a good deal less than the table. Widening it back would
     compile, and would quietly re-require columns no read fetches, so the next
     person to satisfy the typechecker would do it by putting them back in the
     query. The narrow type is the thing stopping that. `REVISION_READ_POLICY`
     above says which read takes what. */
  revision: MetaRow,
  /**
   * The first depth-1 heading's text, or null — **the input to the fallback,
   * not the fallback itself.**
   *
   * The rule ("no stored title? use the article's own h1") lives here, once.
   * What differs is how each caller finds that heading, because one of them has
   * the blocks in memory and the other must not read them: `loadArticle` scans
   * the array it already has, and `listArticles` asks Postgres for one row.
   * docs/plans/library-read-latency.md § 5.
   */
  headingTitle: string | null,
): Meta {
  const title = revision.title ?? headingTitle ?? slug;
  const rawSha256 = metaRawSha256(revision);

  return {
    slug,
    title,
    ...(revision.byline === null ? {} : { byline: revision.byline }),
    ...(revision.siteName === null ? {} : { siteName: revision.siteName }),
    ...(revision.lang === null ? {} : { lang: revision.lang }),
    ...(revision.finalUrl === null ? {} : { url: revision.finalUrl }),
    ...(revision.fetchedAt === null ? {} : { fetchedAt: revision.fetchedAt.toISOString() }),
    ...(revision.excerpt === null ? {} : { excerpt: revision.excerpt }),
    ...(revision.note === null ? {} : { note: revision.note }),
    /* PDF provenance, so the spread pattern above is load-bearing here too:
       `source: null` in `meta.json` is not the same artefact as no `source`
       key, and the round-trip test compares them. docs/plans/pdf-ingestion.md.

       **All of these are null on every web page except `raw_sha256`**, which
       used to be the sentence this comment led with. That column is stage 1's
       hash of whatever it fetched and an HTML page has one, so reading it
       straight put a PDF-only field on every web page — `metaRawSha256` is the
       rule, and src/store/artifacts.ts is where it says why. */
    ...(revision.source === null ? {} : { source: revision.source as "pdf" }),
    ...(revision.extractMethod === null ? {} : { method: revision.extractMethod }),
    ...(revision.pages === null ? {} : { pages: revision.pages }),
    ...(rawSha256 === null ? {} : { rawSha256 }),
    ...(revision.unverified === null ? {} : { unverified: revision.unverified }),
    ...(revision.recall === null ? {} : { recall: revision.recall }),
    ...(revision.pagesChecked === null ? {} : { pagesChecked: revision.pagesChecked }),
  };
}


/**
 * Where each pipeline step's output lives once it is in Postgres.
 *
 * `StageState.outputs` is repo-relative file paths on the filesystem side. It
 * cannot be here, and pretending otherwise would be worse than the change: the
 * metadata page's job is to say where an artefact actually is, and after the
 * cutover the answer is a column, not a path. **This is a deliberate,
 * user-visible divergence between the two stores** — the one place the
 * migration does not preserve behaviour exactly — and it is listed as such in
 * docs/plans/postgres-storage-implementation.md rather than left for somebody
 * to find on the page.
 *
 * **`Record<StepName, …>`, and no `?? []` at the lookup.** It was
 * `Record<string, …>` with a fallback, which made a step nobody had added here
 * come out as an empty list — a row on the metadata page saying the artefact is
 * stored nowhere, which reads like a finding rather than like the omission it
 * is. Exhaustive over `StepName` means adding a step to the pipeline fails the
 * typecheck here instead. Found in a review of the built seam, 2026-08-26.
 */
const STEP_STORAGE: Record<StepName, string[]> = {
  fetch: ["article_revisions.raw_bytes"],
  extract: ["article_revisions.title", "article_revisions.extracted_html"],
  blocks: ["revision_blocks", "block_identities"],
  toc: ["article_revisions.tree", "article_revisions.labels"],
  /* The manifest is the column; the bytes it names are objects in the `sources`
     bucket, which is not a table and so is not listed here. */
  assets: ["article_revisions.assets"],
  arc: ["article_revisions.arc"],
  tweets: ["article_revisions.tweets"],
  glossary: ["article_revisions.glossary"],
  summary: ["article_revisions.summary"],
  ideas: ["article_revisions.ideas"],
};

/**
 * What the library calls `addedAt`, as SQL.
 *
 * **`coalesce(fetched_at, articles.created_at)`, never `fetched_at` alone.** On
 * the filesystem `addedAt` is `meta.fetchedAt` where stage 2 recorded one and
 * the mtime of `blocks.json` otherwise, and src/store/import.ts seeds both
 * `created_at` columns from that same mtime so the two agree exactly.
 *
 * Ordering on `fetched_at` by itself puts every article that never got one at
 * the TOP, because Postgres sorts NULLs first under DESC. That is what this
 * query did, and the parity test passed anyway: the one article with a null
 * `fetched_at` happens to be the newest. Exported so the test can exercise the
 * real expression against data that is not lucky — asserting the property
 * against the articles we happen to have could not fail.
 *
 * ## The fallback is the ARTICLE's created_at, not the revision's
 *
 * It was the revision's, and that was safe only while no article had ever been
 * re-extracted. `beginRevision` (src/store/pg-revisions.ts) mints a fresh
 * `created_at` for every new revision — it has to, or the retention sweep would
 * judge a brand-new draft by its ancestor's age — so with the old fallback,
 * re-extracting an article whose `meta.json` never had a `fetchedAt` would jump
 * it to the top of the shelf. Nothing about that has a symptom: the shelf is
 * simply in a different order than it was, and both halves succeeded.
 *
 * "When was this added" is a fact about the article, and `articles.created_at`
 * is the column that already holds it. A review named the fix in these words;
 * the plan's original reasoning had it exactly backwards, blaming the *copy*
 * for a reordering that only minting can cause.
 */
export const ADDED_AT = sql`coalesce(${articleRevisions.fetchedAt}, ${articles.createdAt})`;

/**
 * Is the stored `ideas` artefact one we would write again today?
 *
 * **A function rather than a fifth arm of `isCurrent`**, and not only because
 * it took that switch past Biome's complexity ceiling: it is the only step
 * whose answer needs four values rather than three, so inlining it would have
 * made the longest arm of a switch the one carrying the exception.
 *
 * Without this the step fell through to `default: true` and **every completed
 * run reported itself current** — on the metadata page and in filesystem /
 * Postgres parity — while `loadIdeas` a few hundred lines below was correctly
 * calling the same artefact stale. Two answers to one question, and the
 * confident one was wrong. GPT Sol's review of the built code, 2026-08-27.
 */
function ideasAreCurrent(
  revision: { ideas: unknown; tree: unknown },
  blocks: readonly Block[],
): boolean {
  const found = revision.ideas as Ideas | null;
  const tree = revision.tree as Tree | null;
  if (!found || !tree || blocks.length === 0) return false;
  /* The blocks AND the tree — src/ideas.ts § `inputFingerprint`. This artefact
     is written from the skeleton as much as from the paragraphs, so a
     re-sectioned article is a different question even when every block is
     byte-identical. */
  const profile =
    found.profileHash !== undefined ? { profileHash: found.profileHash } : {};
  return sameStamp(
    {
      inputHash: found.sourceHash,
      promptVersion: found.version,
      model: found.generator,
      ...profile,
    },
    {
      inputHash: ideasFingerprint(blocks, tree),
      promptVersion: IDEAS_PROMPT_VERSION,
      model: CAPABLE_MODEL,
      /* The artefact's own value on both sides, deliberately. The profile the
         pipeline would stamp with today is resolved per job (src/jobs.ts) and
         this read has no access to it; a guess here would mark every profiled
         artefact stale on a page that only lists which stages have run. The
         reader is told about a changed profile by `loadIdeas`'s
         `profileChanged`, and whether to RE-RUN is decided by the stamp in
         src/pipeline.ts, which does know. */
      ...profile,
    },
  );
}

/**
 * The shelf's query, taking its builder, **so a test can read the SQL it sends.**
 *
 * Extracted for the same reason `currentRevisionQuery` and `blockHashQuery`
 * were, and GPT Sol's fourth finding on docs/plans/library-read-latency.md said
 * it before this was built: a test that assembles SQL from
 * `REVISION_PROJECTIONS.library` proves the projection is right and nothing
 * whatever about the query. That is exactly how the last change's projection
 * tests stayed green while `currentRevision` selected the whole table. The
 * projection and the query only meet in the statement.
 */
export function listArticlesQuery(
  db: Pick<ReturnType<typeof getDb>, "select">,
  opts: ListOptions,
) {
  return db
    .select({
      article: articles,
      revision: REVISION_PROJECTIONS.library,
      /**
       * `metaFrom`'s fallback, one row rather than the article.
       *
       * **Beside `revision` and not inside it**, deliberately: it is not a
       * column of `article_revisions`, so `REVISION_READ_POLICY` — which is
       * keyed by that table's columns and asserted exhaustive against it —
       * has nowhere to classify it, and the test that checks a projection's
       * keys against the policy would have to grow an exception. Sol's third
       * finding on the plan.
       *
       * `order by ordinal`, matching `headingTitleOf`, which reads an array
       * `blocksQuery` ordered the same way. `level` is nullable and `= 1` does
       * not match null, exactly as `b.level === 1` does not.
       *
       * **Guarded by a `case`, so it runs for almost no rows.** The fallback is
       * only consulted when nothing stored a title, and a reader's rename wins
       * over both — so a row with either is asking a question whose answer it
       * will throw away. Without the guard, an article with no `<h1>` at all
       * filters every one of its block rows to find that out, once per shelf
       * load. GPT Sol's sixth finding on the built code.
       */
      headingTitle: sql<string | null>`case
        when ${articleRevisions.title} is null and ${articles.titleOverride} is null then (
          select ${revisionBlocks.text} from ${revisionBlocks}
          where ${revisionBlocks.revisionId} = ${articleRevisions.id}
            and ${revisionBlocks.kind} = 'heading'
            and ${revisionBlocks.level} = 1
          order by ${revisionBlocks.ordinal}
          limit 1)
      end`.as("heading_title"),
    })
    .from(articles)
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    /* `is null` / `is not null`, never `= null`. The archived half is asked
       for by name so that both halves come out of this one query and cannot
       disagree about what an article is — the same reason src/api.ts filters
       after its walk rather than skipping during it. */
    .where(
      and(
        /* **Yours, not everyone's.** Without this the shelf is the union of
           every account's, which is what it was until 2026-08-27 — see
           `ownedSlug` above for why that is worse than it sounds. */
        ownedByReader(),
        opts.archived ? isNotNull(articles.archivedAt) : isNull(articles.archivedAt),
        /* `_`-prefixed slugs are not articles, exactly as in src/api.ts:
           `data/_jobs/` is the ingest queue's directory, and the filesystem
           walk has always skipped the prefix. Postgres had no equivalent, so
           the two libraries disagreed about any slug starting with an
           underscore — invisible until a test fixture used one, and then
           visible only as tests/store-parity.test.ts failing in a full run
           and passing alone.

           `left(slug, 1)` rather than `not like`, because `_` is LIKE's
           single-character wildcard: `not like '_%'` excludes every slug with
           at least one character, which is all of them. Written that way
           first, and the library came back empty. Escaping it works and reads
           like a typo. Both this and the `innerJoin` above are now stated
           once, in `onTheShelf` — the admin page counts the same rows and
           two spellings of "is this an article" is how the shelf and a count
           of it come to disagree. */
        onTheShelf(),
      ),
    )
    .orderBy(desc(ADDED_AT));
}

/**
 * How many comments each of these articles has — **one query for the page.**
 *
 * It was one per article, and it was not a `count`: it selected every comment
 * row's id and took the array's length, so a well-annotated article paid for
 * every mark on it on every homepage load.
 *
 * An article with no comments is **absent** from the result rather than present
 * with zero — that is what `group by` means, and the caller defaults to 0. The
 * empty case is short-circuited because there is nothing to ask, not because
 * the SQL would be invalid: drizzle compiles `inArray(col, [])` to a literal
 * `false`. (The plan claimed `in ()` would be a syntax error. It would not.)
 *
 * Ownership needs no clause here that the per-article query did not have: the
 * ids come from `listArticlesQuery`, which is already filtered to this reader's
 * articles, and the old query keyed on `article_id` alone too.
 */
async function commentCounts(
  db: Pick<ReturnType<typeof getDb>, "select">,
  articleIds: readonly string[],
): Promise<Map<string, number>> {
  if (!articleIds.length) return new Map();
  const rows = await db
    .select({ articleId: commentsTable.articleId, n: count() })
    .from(commentsTable)
    .where(inArray(commentsTable.articleId, [...articleIds]))
    .groupBy(commentsTable.articleId);
  return new Map(rows.map((row) => [row.articleId, row.n]));
}

/**
 * The five scalars for every row on the shelf — recomputing, **once**, for any
 * row that has none.
 *
 * ## When it recomputes, and when it must not
 *
 * The four **numbers** are the signal, compared with `=== null`.
 *
 * Not `rootGist`: `deriveLibraryScalars` returns null for it deliberately, for
 * an article with no root gist, no root summary and no excerpt. That is a
 * correct answer, not a missing one — and treating it as missing would send
 * every shelf request for that article back to reading its whole text, for
 * ever, while logging a warning about data that was fine. GPT Sol's first
 * finding on docs/plans/library-read-latency.md, where the rule was written as
 * "any of the five".
 *
 * Not falsiness either, one step further along: `wordCount`, `partCount` and
 * `sectionCount` are all legitimately `0`.
 *
 * ## Why there is a fallback at all
 *
 * The columns are nullable and this is now the only thing that reads them.
 * Every published revision in the database has them, and both writers —
 * `publishRevision` and the importer — set them in the transaction that writes
 * the blocks and tree they describe. But "every row I looked at" is not a
 * constraint, and the alternatives are worse than a branch: `?? 0` prints a
 * wrong number, and skipping the row makes an article vanish from its owner's
 * shelf. The right long-term answer is a check constraint saying published
 * implies the four numbers are non-null; that needs a migration.
 *
 * ## Why it is one query and one line, whatever the damage
 *
 * The first version did this per row: two queries and a `warn` each. On a shelf
 * where many rows were affected that is `2 + 2M` statements and `M` log lines —
 * and Vercel drops everything past **256 lines per request**, so the shape of a
 * widespread problem would have been "the tail of the logs is missing".
 * docs/project/logging.md's rule is explicit about it: *if the number of lines a
 * piece of code emits grows with the data, the caller says it once instead*, as
 * `{ count, first five names, of }`, with the names **ordered** so the same
 * broken shelf accuses the same articles twice running.
 *
 * **And one statement, not two, because two cannot see one database.** The
 * blocks and the tree used to be separate concurrent queries; under `READ
 * COMMITTED` each takes its own snapshot, so an importer committing between
 * them could have this derive a word count from one version's blocks and a part
 * count from another version's tree — a wrong number, arrived at atomically
 * nowhere. Both come out of the statement below. GPT Sol's second finding on
 * the built code.
 */
async function scalarsForShelf(
  rows: readonly { article: { slug: string }; revision: LibraryRow }[],
): Promise<Map<string, LibraryScalars>> {
  const out = new Map<string, LibraryScalars>();
  const missing: { slug: string; revisionId: string; excerpt: string | null }[] = [];

  for (const row of rows) {
    const r = row.revision;
    if (
      r.wordCount !== null &&
      r.blockCount !== null &&
      r.partCount !== null &&
      r.sectionCount !== null
    ) {
      out.set(r.id, {
        wordCount: r.wordCount,
        blockCount: r.blockCount,
        partCount: r.partCount,
        sectionCount: r.sectionCount,
        rootGist: r.rootGist,
      });
    } else {
      missing.push({ slug: row.article.slug, revisionId: r.id, excerpt: r.excerpt });
    }
  }

  if (!missing.length) return out;

  /* Loud, once. Slugs only — never a title, never any prose. In shelf order, so
     the five named are the same five next time. */
  log("store").warn(
    {
      count: missing.length,
      slugs: missing.slice(0, 5).map((m) => m.slug),
      of: rows.length,
    },
    "published revisions have no library scalars; recomputing from their blocks",
  );

  const recomputed = await scalarInputsQuery(
    getDb(),
    missing.map((m) => m.revisionId),
  );
  const byId = new Map(recomputed.map((r) => [r.id, r]));
  for (const { revisionId, excerpt } of missing) {
    const found = byId.get(revisionId);
    out.set(
      revisionId,
      deriveLibraryScalars({
        /* `deriveLibraryScalars` wants blocks, and it reads `words` and
           `treatment` — so this rebuilds the shape rather than summing in SQL,
           which would be a second implementation of the thing this whole change
           exists to have one of.

           `words` **and** `treatment`, in one ordered aggregate. The shelf is
           deliberately not a special case: `deriveLibraryScalars` now counts
           only the body, so a shape carrying `words` alone would silently make
           this fallback the one place on the shelf that still counts the
           bibliography — and the two numbers would differ only for articles
           whose scalars were missing, which is the rarest path and the last
           anyone would look at. */
        blocks: (found?.words ?? []).map((words, i) => ({
          words,
          treatment: (found?.treatments ?? [])[i] ?? null,
        })),
        tree: (found?.tree ?? null) as Tree | null,
        excerpt,
      }),
    );
  }
  return out;
}

/**
 * One revision's tree and its blocks' word counts, **in one statement**.
 *
 * Taking its builder, like the other queries here, so a test can read the SQL.
 * `array_agg` rather than a join, because a join would repeat a 37 KB tree once
 * per block row; and rather than `sum(words)`, because the sum belongs to
 * `deriveLibraryScalars` and nowhere else. That last reason is what made
 * `treatment` a second aggregate rather than a `where treatment is distinct
 * from 'supplement'` inside the sum: the policy is
 * `countsTowardReadingTime` in src/block-policy.ts, and a SQL predicate here
 * would be a second copy of it that no test compares against the first.
 *
 * **The two arrays are read positionally, so both carry the same `order by`.**
 * `array_agg` without one is in whatever order the planner likes, and two
 * aggregates ordered independently would pair a block's words with another
 * block's treatment — a mis-count that is stable, plausible, and invisible.
 */
export function scalarInputsQuery(
  db: Pick<ReturnType<typeof getDb>, "select">,
  revisionIds: readonly string[],
) {
  return db
    .select({
      id: articleRevisions.id,
      tree: articleRevisions.tree,
      words: sql<number[]>`coalesce((
        select array_agg(${revisionBlocks.words} order by ${revisionBlocks.ordinal})
        from ${revisionBlocks}
        where ${revisionBlocks.revisionId} = ${articleRevisions.id}), '{}')`,
      /* Typed as the union rather than as `string`, and the CHECK constraint
         `revision_blocks_treatment` in src/db/schema.ts is what makes that a
         statement rather than a hope — the column cannot hold anything else,
         and `checkNoteFields` refuses an import that tries. */
      treatments: sql<(Block["treatment"] | null)[]>`coalesce((
        select array_agg(${revisionBlocks.treatment} order by ${revisionBlocks.ordinal})
        from ${revisionBlocks}
        where ${revisionBlocks.revisionId} = ${articleRevisions.id}), '{}')`,
    })
    .from(articleRevisions)
    .where(inArray(articleRevisions.id, [...revisionIds]));
}


/**
 * **Which of this revision's artefacts were written for a reader profile.**
 *
 * `profileHash` is non-null exactly when one was used — `src/profile.ts` — and
 * only four artefacts can carry it. The tree and the arc deliberately do not
 * vary by profile (docs/project/reader-profile.md: a reader-specific tree is one
 * that shifts under a reader who edits their box), and `fetch`, `extract` and
 * `blocks` have no model call to personalise. So this is exhaustive over the
 * artefacts that *can* be personalised rather than over `STEP_ORDER`.
 *
 * **Only artefacts that EXIST are listed, and that is a requirement rather than
 * a side effect.** An artefact never generated cannot have been personalised,
 * and listing one would have the confirmation dialog name a glossary that is not
 * there. `document?.profileHash` on a null document is `undefined`, so absent
 * artefacts drop out here — but the property is stated because it is the kind a
 * refactor loses silently.
 *
 * `!= null` rather than truthiness, and rather than `!== undefined`: the field
 * is `string | null | undefined`, and **`null` means written deliberately
 * without a profile** (src/types.ts), which is a different thing from personalised
 * and must not be listed. A truthy test would also drop an empty-string hash,
 * which no writer produces but which would be a hash all the same.
 *
 * Ordered by `STEP_ORDER`, so the dialog lists them in the order the page shows
 * the stages rather than in the order this function happens to check.
 */
function personalisedSteps(revision: {
  tweets: TweetThread | null;
  glossary: Glossary | null;
  summary: Summaries | null;
  ideas: Ideas | null;
}): StepName[] {
  const carriers: Partial<Record<StepName, { profileHash?: string | null } | null>> = {
    tweets: revision.tweets,
    glossary: revision.glossary,
    summary: revision.summary,
    ideas: revision.ideas,
  };
  return STEP_ORDER.filter((step) => carriers[step]?.profileHash != null);
}

export const pgArticleReader: Pick<
  ArticleReader,
  | "loadArticle"
  | "listArticles"
  | "articleMetadata"
  | "loadTweets"
  | "loadGlossary"
  | "loadSummaries"
  | "loadIdeas"
> = {
  async loadArticle(slug: string): Promise<Article> {
    requireSlug(slug);
    const found = await currentRevision(slug, "article");
    if (!found) throw notFound(slug);

    const blocks = await blocksFor(found.revision.id);
    const tree = found.revision.tree;
    // A revision with no tree is not a readable article — the same bar
    // src/api.ts sets by requiring both blocks.json and tree.json.
    if (!tree || !blocks.length) throw notFound(slug);

    const arc = found.revision.arc;
    /* **Named, and never spread in from the row.** The key is required on
       `Article` precisely so that leaving this line out is a type error rather
       than an article that quietly hot-links every image (src/types.ts). `??
       undefined` because Postgres hands back `null` for a column nothing has
       written, and the third state the reader branches on is `undefined`. */
    const assets = found.revision.assets ?? undefined;
    return {
      /* Through `titleFor`, so the reading view's masthead calls a renamed
         article what the shelf calls it. The filesystem store does the same at
         the same seam; a review found this applied to the card only. */
      meta: titleFor(metaFrom(slug, found.revision, headingTitleOf(blocks)), shelfFrom(found.article)),
      blocks,
      tree: tree as Tree,
      ...(arc ? { arc: arc as Arc } : {}),
      assets,
    };
  },

  async listArticles(opts: ListOptions = {}): Promise<LibraryEntry[]> {
    const db = getDb();
    const rows = await listArticlesQuery(db, opts);

    /* One grouped query for the whole page, and it used to be one per article
       — which was not a count at all: it selected every comment row's id and
       took `rs.length`. */
    const counts = await commentCounts(db, rows.map((row) => row.article.id));

    /* The five numbers per row, off the columns — and one query and one log
       line for however many rows turn out not to have them.

       **Only the rows that survive `hasTree`.** A revision with no tree is not
       a readable article and is dropped below, so recomputing its scalars would
       be work and a warning about a row nobody is going to see. */
    const scalarsById = await scalarsForShelf(rows.filter((row) => row.revision.hasTree));

    const entries: LibraryEntry[] = [];
    for (const row of rows) {
      /* The two rules that say a published revision is not yet a readable
         article, and both now read a value the query already had rather than
         the artefact itself.

         **Neither is dead code**, and the plan said it was until GPT Sol showed
         otherwise. `publishRevision` refuses a revision with no tree or no
         blocks, but the importer does not go through it: it requires
         blocks.json to exist and parse, then guards its insert with
         `if (blocks.length)`, so an empty array publishes as a revision with no
         blocks and `block_count = 0`, and the pointer moves to it. */
      if (!row.revision.hasTree) continue;
      const scalars = scalarsById.get(row.revision.id);
      if (!scalars || !scalars.blockCount) continue;

      entries.push(
        describeArticle({
          slug: row.article.slug,
          meta: metaFrom(row.article.slug, row.revision, row.headingTitle),
          /* **The five numbers, not the artefacts they came from.** They were
             recomputed here from every block row and the whole tree of every
             article, once per homepage load — about 1.1 MB of blocks and 154 KB
             of JSONB across eight short articles, plus a jsdom sanitise each,
             to print eight word counts and eight blurbs. `describeArticle` now
             receives them, and `deriveLibraryScalars` is the one function that
             produces them: on this side it ran at publish and wrote columns; on
             the filesystem side it runs at read. One derivation, two moments.
             docs/plans/library-read-latency.md. */
          scalars,
          comments: counts.get(row.article.id) ?? 0,
          // The TypeScript half of `ADDED_AT`, and it has to agree with it —
          // one of them orders the list and the other prints the date on the
          // card, so a difference shows up as a card dated 2020 sitting at the
          // top of a list sorted by "newest first".
          addedAt: (row.revision.fetchedAt ?? row.article.createdAt).toISOString(),
          shelf: shelfFrom(row.article),
          /* Answered by Postgres, in the projection, as `is not null`. It used
             to be `!= null` on JSONB documents this query had dragged across
             the wire — the tooltip asks whether a glossary exists, not how many
             terms are in it, and it was reading all of them to find out. */
          has: {
            arc: row.revision.hasArc,
            tweets: row.revision.hasTweets,
            glossary: row.revision.hasGlossary,
            summary: row.revision.hasSummary,
          },
        }),
      );
    }
    return entries;
  },

  /**
   * Which stages have run **and still describe this article**.
   *
   * `revision_step_runs` answers the first half: it exists precisely to say
   * "has this stage run", and reading it keeps the honest distinction the
   * filesystem loses, between a step that never ran and a step that ran and
   * produced nothing.
   *
   * ## Why the row saying `done` is not enough, and the bug that proves it
   *
   * This used to be `status === 'done'` and nothing else. The filesystem
   * computes *present **and** current* — `stepIsDone` in src/pipeline.ts is
   * `has()` plus a stamp comparison — and the two agreed only because no
   * revision had ever been superseded and the importer stamps every row `done`.
   *
   * Carry-forward is what makes them disagree, on its first day. A new draft
   * copies the previous revision's glossary **and its step-run row, with
   * `input_hash` unchanged**, which is exactly right: the row then says *the
   * glossary ran against hash X* while the blocks hash Y. On disk the reader is
   * offered "regenerate"; here they were shown a green tick over a glossary
   * describing text that has since changed. Note that the parity test cannot
   * catch this, for the same reason it cannot catch carry-forward at all —
   * there is no re-extraction in between.
   *
   * ## What "current" means per step, and the one half that is still missing
   *
   * `toc` is checked the way `publishRevision` checks it, so the metadata page
   * and the publication guard cannot disagree: the recorded `input_hash` must
   * equal `hashBlocks` of this revision's blocks.
   *
   * `tweets`, `glossary` and `summary` carry their own `sourceHash`, so they
   * are checked against the artefact itself rather than against the step row —
   * the artefact is what a reader would actually be served.
   *
   * **The prompt-version and model half of the comparison is only done for the
   * glossary**, and that is a known, narrow divergence rather than an oversight:
   * `src/tweets.ts` and `src/summarise.ts` keep their `PROMPT_VERSION` module
   * private, so nothing outside them can say what stamp they *would* write.
   * The fix is theirs and a review already named it — each stage exports an
   * `expectedStamp(blocks)` factory and keeps the constant private. Until then
   * a model change makes those two steps re-runnable on disk and still
   * green here.
   *
   * `fetch`, `extract`, `blocks` and `arc` have no currency rule in **either**
   * store — nothing they write records what it was made from — so they are the
   * step row alone, exactly as on the filesystem. **`assets` is not one of
   * them**, and the `default` arm below is why it needed a case: its manifest
   * does record what it was made from, so falling through would have this page
   * call a stale one current while the filesystem store said otherwise about
   * the same article.
   */
  async articleMetadata(slug: string): Promise<ArticleMetadata> {
    requireSlug(slug);
    const found = await currentRevision(slug, "metadata");
    if (!found) throw notFound(slug);

    const db = getDb();
    const runs = await db
      .select()
      .from(revisionStepRuns)
      .where(eq(revisionStepRuns.revisionId, found.revision.id));
    const byStep = new Map(runs.map((r) => [r.stepName, r]));

    /* Read once, outside the loop: four of the eight checks need the blocks,
       and asking for a 360-row table four times to answer one page is the kind
       of thing that only shows up in production. */
    const blocks = await blocksFor(found.revision.id);
    const blocksHash = blocks.length ? hashBlocks(blocks) : null;
    const { revision } = found;

    /** Is this step's output one we would write again today? */
    const isCurrent = (step: StepName): boolean => {
      switch (step) {
        case "toc": {
          if (!revision.tree || !blocksHash) return false;
          return byStep.get("toc")?.inputHash === blocksHash;
        }
        /* The same two questions as `toc`, and the same answer — but asked of
           the artefact rather than of the step row, because the manifest
           carries its own `sourceHash` and its own version. That second half
           matters: the step re-runs when what it *decides* changes (which URLs
           it picks, which formats it hosts), and a page that compared only the
           blocks would call every old manifest current for ever.

           Written out here rather than shared with the filesystem's `stamp`
           because there is no seam yet that both stores can reach — the same
           divergence `glossary` above lives with. What must not happen is this
           step falling through to `default: true`, which would have the two
           stores disagree about the same article. */
        case "assets": {
          const assets = revision.assets as Assets | null;
          if (!assets || !blocksHash) return false;
          return sameStamp(
            { inputHash: assets.sourceHash, promptVersion: assets.version },
            { inputHash: blocksHash, promptVersion: ASSETS_VERSION },
          );
        }
        case "tweets": {
          const thread = revision.tweets as TweetThread | null;
          return Boolean(thread && !tweetsStale(thread, blocks));
        }
        case "glossary": {
          const glossary = revision.glossary as Glossary | null;
          if (!glossary) return false;
          // The one of the three that can be checked in full, because its
          // prompt version is exported. `sameStamp` rather than three
          // comparisons written out again — one definition of "current".
          return sameStamp(
            {
              inputHash: glossary.sourceHash,
              promptVersion: glossary.version,
              model: glossary.generator,
            },
            {
              ...(blocksHash ? { inputHash: blocksHash } : {}),
              promptVersion: PROMPT_VERSION,
              model: CAPABLE_MODEL,
            },
          );
        }
        case "summary": {
          const summaries = revision.summary as Summaries | null;
          return Boolean(summaries && !summariesStale(summaries, blocks));
        }
        case "ideas":
          return ideasAreCurrent(revision, blocks);
        default:
          // fetch, extract, blocks, arc — nothing to compare, in either store.
          // `assets` is NOT here; it has its own case above.
          return true;
      }
    };

    const stages: StageState[] = STEP_ORDER.map((step) => {
      const run = byStep.get(step);
      return {
        step,
        label: STEPS[step].label,
        outputs: STEP_STORAGE[step],
        done: run?.status === "done" && isCurrent(step),
        /* `finished_at` ONLY, and never `started_at`.

           The first version fell back to `started_at` for a run that is going
           or died mid-way, which is what that column is for elsewhere
           (src/db/schema.ts). A cross-model review took it apart: `ranAt` has
           to mean the same thing in both stores or the one sentence the UI
           writes about it is false in one of them, and the filesystem's answer
           is an mtime — *when this stage last wrote something*. A run that
           started and died wrote nothing anybody should believe, and it is not
           `done` here either, so a timestamp against it would be the store
           answering a question the reader did not ask with the one they did.

           No `bytes`: there are no files here, and a row count or a jsonb
           length would be a different measurement wearing the same label. */
        ranAt: run?.finishedAt?.toISOString() ?? null,
        bytes: null,
      };
    });

    const commentRows = await db
      .select({ id: commentsTable.id })
      .from(commentsTable)
      .where(eq(commentsTable.articleId, found.article.id));

    /* `profile` and `purpose` for the same reason `comments` above is read
       here rather than from a second endpoint. `profile` is global
       (`reader_profiles`) and `purpose` is this article's own (`articles.
       purpose`, via `shelfFrom`) — docs/plans/reader-profile.md. */
    const profile = await pgReaderStore.readProfile();

    return {
      slug,
      // The filesystem reports a repo-relative directory; there isn't one.
      dir: `spideryarn.article_revisions/${found.revision.id}`,
      stages,
      comments: commentRows.length,
      profile,
      purpose: shelfFrom(found.article).purpose ?? null,
      /* Off the same `shelfFrom` as `purpose`, so the two stores answer this
         from the same derivation rather than from two readings of one column. */
      archivedAt: shelfFrom(found.article).archivedAt ?? null,

      /* **Free, and that is why all three are here rather than behind a second
         endpoint.** `currentRevisionQuery` selects `articles` whole — the row
         `shelfFrom` above is reading — and `REVISION_PROJECTIONS.metadata`
         already carries all four artefacts that can hold a `profileHash`, so
         this costs no query, no projection change, and no widening of
         `REVISION_READ_POLICY`.

         **Present here and absent on the filesystem**, which is the whole point
         of the block being optional: this store can answer and that one cannot.

         See ArticleMetadata in src/types.ts for why the owner needs it at all —
         the card was asking the *public* endpoint about its own document, which
         cannot tell private from absent — and for why it is one block rather
         than three fields. */
      sharing: {
        /* The cast is the boundary between a `text` column with a CHECK on it
           and a two-member union: Postgres guarantees the value
           (`articles_visibility`, drizzle/0024) and TypeScript cannot see the
           guarantee. Same shape as `kind` in the block reads. */
        visibility: found.article.visibility as Visibility,
        publicAt: found.article.publicAt?.toISOString() ?? null,
        personalised: personalisedSteps(revision),
      },
    };
  },

  async loadTweets(slug: string): Promise<ThreadFound> {
    requireSlug(slug);
    const found = await currentRevision(slug, "tweets");
    if (!found) throw notFound(slug);

    const thread = found.revision.tweets as TweetThread | null;
    if (!thread) {
      throw Object.assign(
        new Error(`No thread for "${slug}" yet. Write one with \`npm run tweets -- ${slug}\`.`),
        { status: 404 },
      );
    }
    const blocks = await blockHashInputs(found.revision.id);
    return { thread, stale: tweetsStale(thread, blocks) };
  },

  async loadGlossary(slug: string): Promise<GlossaryFound> {
    requireSlug(slug);
    const found = await currentRevision(slug, "glossary");
    if (!found) throw notFound(slug);

    const glossary = found.revision.glossary as Glossary | null;
    if (!glossary) {
      throw Object.assign(
        new Error(`No glossary for "${slug}" yet. Write one with \`npm run glossary -- ${slug}\`.`),
        { status: 404 },
      );
    }
    /* Lookups are attached HERE, at the read seam, exactly as src/api.ts does
       it — not stored on the entry. Forgetting this would not fail; it would
       quietly drop every "checked on the web" answer from the panel while the
       glossary itself looked perfectly correct.

       **Together with the block read, not after it.** Both need only the ids
       already in hand, so the second was waiting on the first for nothing — one
       round trip to Supabase, on the request a reader is watching a spinner
       for. The driver is `pg`'s `Pool`, default `max: 5` (src/db/client.ts §
       poolMax), so the two queries usually take two connections and genuinely
       overlap — *usually*, because `DATABASE_POOL_MAX=1` or a saturated pool
       serialises them again, in which case this costs nothing and buys nothing.
       GPT Sol was right that the first version of this comment claimed more
       than it can. docs/plans/glossary-read-latency.md. */
    const db = getDb();
    const [blocks, stored] = await Promise.all([
      blockHashInputs(found.revision.id),
      db.select().from(glossaryLookups).where(eq(glossaryLookups.articleId, found.article.id)),
    ]);
    const byEntry = new Map(
      stored.map((row) => [
        row.entryId,
        {
          answer: row.answer,
          citations: row.citations,
          searches: row.searches,
          model: row.model,
          at: row.at.toISOString(),
        },
      ]),
    );
    const entries = glossary.entries.map((entry) => {
      const lookup = byEntry.get(entry.id);
      return lookup ? { ...entry, lookup } : entry;
    });

    return {
      glossary: { ...glossary, entries },
      stale: glossaryIsStale(glossary, blocks),
      /* A different fact from `stale`, and it needs its own field because it
         needs its own sentence: `stale` means the article moved underneath
         these terms; this means the article is the same and we would write them
         differently now. */
      outdated: glossary.version !== PROMPT_VERSION,
    };
  },

  async loadSummaries(slug: string): Promise<SummariesFound> {
    requireSlug(slug);
    const found = await currentRevision(slug, "summaries");
    if (!found) throw notFound(slug);

    const summaries = found.revision.summary as Summaries | null;
    if (!summaries) {
      throw Object.assign(
        new Error(
          `No summaries for "${slug}" yet. Write them with \`npm run summarise -- ${slug}\`.`,
        ),
        { status: 404 },
      );
    }
    const blocks = await blockHashInputs(found.revision.id);
    return { summaries, stale: summariesStale(summaries, blocks) };
  },

  async loadIdeas(slug: string): Promise<IdeasFound> {
    requireSlug(slug);
    const found = await currentRevision(slug, "ideas");
    if (!found) throw notFound(slug);

    const ideas = found.revision.ideas as Ideas | null;
    if (!ideas) {
      throw Object.assign(
        new Error(`No ideas for "${slug}" yet. Find them with \`npm run ideas -- ${slug}\`.`),
        { status: 404 },
      );
    }
    const blocks = await blockHashInputs(found.revision.id);
    /* **The tree as well as the blocks**, which is what makes this one line
       longer than its three neighbours. `ideas` is written from the skeleton as
       much as from the paragraphs (src/ideas.ts § `inputFingerprint`), so a
       re-sectioned article is a different question even when every block is
       byte-identical — and a blocks-only comparison here would report it
       current while the filesystem store reported it stale. Two stores
       disagreeing about staleness is precisely what the parity tests exist to
       catch, and precisely the kind of thing that looks fine until it doesn't. */
    const tree = found.revision.tree as Tree | null;
    return {
      ideas,
      stale: !tree || ideasAreStale(ideas, blocks, tree),
      outdated: ideas.version !== IDEAS_PROMPT_VERSION,
    };
  },
};
