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
 *    exactly as it was in src/api.ts, or a missing article starts reporting as a
 *    server fault.
 * 3. **Staleness is computed at read time, never stored.** A flag written when
 *    the artefact was generated is right up until the moment it matters.
 *
 * ## What is deliberately NOT here
 *
 * A fallback to the filesystem. Nothing in this file may catch an error and
 * call into src/store/fs.ts — see docs/plans/260826e-postgres-storage-implementation.md
 * § Rules. It would hide exactly the divergence the parity test is looking for.
 */

import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import type { Assets } from "../assets.js";
import { ASSETS_VERSION, assetsInputHash } from "../collect-assets.js";
import { getDb } from "../db/client.js";
import {
  articleRevisions,
  articles,
  comments as commentsTable,
  glossaryLookups,
  revisionBlocks,
  revisionStepRuns,
} from "../db/schema.js";
import { isStale as arcIsStale, PROMPT_VERSION as ARC_PROMPT_VERSION } from "../arc.js";
import { isStale as glossaryIsStale, PROMPT_VERSION } from "../glossary.js";
import {
  isStale as quotesAreStale,
  PROMPT_VERSION as QUOTES_PROMPT_VERSION,
} from "../quotes.js";
import {
  isStale as ideasAreStale,
  inputFingerprint as ideasFingerprint,
  PROMPT_VERSION as IDEAS_PROMPT_VERSION,
} from "../ideas.js";
import {
  inputFingerprint as timelineFingerprint,
  isStale as timelineIsStale,
  PROMPT_VERSION as TIMELINE_PROMPT_VERSION,
} from "../timeline.js";
import {
  inputFingerprint as quizFingerprint,
  isStale as quizIsStale,
  PROMPT_VERSION as QUIZ_PROMPT_VERSION,
} from "../quiz.js";
import {
  inputFingerprint as debateFingerprint,
  isDebateDocument,
  isStale as debateIsStale,
  PROMPT_VERSION as DEBATE_PROMPT_VERSION,
} from "../debate.js";
import {
  inputFingerprint as sketchFingerprint,
  isStale as sketchIsStale,
  PROMPT_VERSION as SKETCH_PROMPT_VERSION,
} from "../sketch.js";
import type { Sketch } from "../sketch-scene.js";
import {
  inputFingerprint as illustratedFingerprint,
  isStale as illustratedIsStale,
  PROMPT_VERSION as ILLUSTRATED_PROMPT_VERSION,
} from "../illustrated.js";
import type { Illustrated } from "../illustrated-plate.js";
import {
  deriveLibraryScalars,
  describeArticle,
  headingTitleOf,
  titleFor,
  type LibraryScalars,
} from "../library-scalars.js";
import { LABELS_PROMPT_VERSION } from "../labels.js";
import { log } from "../log.js";
import { CAPABLE_MODEL, modelFor } from "../models.js";
import { currentOwnerId } from "../owner.js";
import { STEP_ORDER, STEPS } from "../pipeline.js";
import { sanitizeStoredBlocks } from "../sanitize.js";
import {
  articleFingerprint,
  type BlockFingerprint,
  hashBlocks,
  type MetaFingerprint,
  type MetaFingerprintDated,
  type MetaFingerprintWithUrl,
} from "../source-hash.js";
import { isStale as tweetsStale } from "../tweets.js";
import type {
  Arc,
  ArcFound,
  Article,
  ArticleMetadata,
  StageState,
  Block,
  Debate,
  DebateFound,
  Glossary,
  GlossaryFound,
  Quiz,
  QuizFound,
  PublicArtefacts,
  Quotes,
  QuotesFound,
  Ideas,
  IdeasFound,
  IllustratedFound,
  SketchFound,
  Timeline,
  TimelineFound,
  LibraryEntry,
  ListOptions,
  Meta,
  ShelfState,
  StepName,
  ThreadFound,
  Tree,
  TweetThread,
  Visibility,
} from "../types.js";
import { hierarchyCurrency, metaRawSha256, sameStamp } from "./artifacts.js";
import type { ArtifactMap } from "./artifacts.js";
import type { ArticleReader, RawSource } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { postgresBlobStore } from "./blobs.js";
import { readRawDocument } from "./raw-document.js";
import { pgReaderStore } from "./pg-reader.js";

/** A 404 shaped exactly like the filesystem store's, so routes.ts could not tell them apart. */
export function notFound(slug: string): Error {
  return Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
}

/* **Moved to a leaf, and re-exported from here so nothing else changed** — the
   same move, for the same reason, as `ownedSlug` below. `pg.ts` imports
   the read layer, so a store file that wanted only this guard would inherit the
   whole of it; [require-slug.ts](require-slug.ts) imports `isSlug` and
   nothing else. It has a dozen callers here, so it is re-exported rather than
   re-imported at each of them. */
export { requireSlug } from "./require-slug.js";
import { requireSlug } from "./require-slug.js";

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
   `pg.ts` imports the read layer, so anything importing this file inherits the
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
 * **The article's uuid for a slug this reader owns, or a tagged 400 / 404.**
 *
 * Three guarantees, in the order they are checked, and each one used to be a
 * private decision in six different files:
 *
 * 1. **The slug is a slug.** `requireSlug` throws a 400 before any query, so a
 *    pasted title never reaches Postgres and never gets answered as though it
 *    named something.
 * 2. **It is scoped to the owner.** `ownedSlug`, never `eq(articles.slug, …)` —
 *    `articles.slug` is globally unique, so the bare comparison finds a real
 *    article belonging to somebody else and every method downstream would then
 *    read and write it. The referee reading a stranger's paper is exactly the
 *    reader this matters for.
 * 3. **A miss is a 404, not a 403.** "There is no such article" is all a
 *    stranger should learn about a slug they do not own; a 403 confirms it
 *    exists.
 *
 * ## Why it lives here
 *
 * It was copied into `pg-chat.ts`, `pg-searches.ts`, `pg-referee-claims.ts`,
 * `pg-referee-criteria.ts`, `pg-lookups.ts` and `pg-comments.ts`, and by
 * 2026-09-03 **five of the six called `requireSlug` and `pg-comments.ts` did
 * not** — so a malformed slug reaching a comment method fell through to a query
 * and came back as this function's own 404. Nothing was leaked; a fix simply
 * failed to reach one of six copies, which is the shape that predicts the
 * seventh. docs/plans/260903a-improve-the-codebase-sweep.md § T1.2, and
 * tests/store-slug-guard.test.ts asks all six the question.
 *
 * `notFound`, `requireSlug` and `ownedSlug` are already here, so this is where
 * the invariant lives rather than a new home for it.
 *
 * ## The two variants that stay where they are
 *
 * `articleIdFor` in `src/store/ai-calls-pg.ts` and
 * `src/store/realtime-sessions-pg.ts` look like copies and are **not**: they take
 * an explicit owner rather than the ambient one, and they return `null` rather
 * than throwing, because a ledger row for an article since deleted must not take
 * a report down. Different contract, different function.
 *
 * The `db` parameter is `Pick<…, "select">` in this file's house style, so both
 * a handle and a transaction satisfy it — a caller inside a transaction must
 * pass its `tx`, or the lookup reads outside the lock it is about to take.
 */
export async function articleIdForOwned(
  slug: string,
  db: Pick<ReturnType<typeof getDb>, "select"> = getDb(),
): Promise<string> {
  requireSlug(slug);
  const rows = await db.select({ id: articles.id }).from(articles).where(ownedSlug(slug)).limit(1);
  const found = rows[0];
  if (!found) throw notFound(slug);
  return found.id;
}

/**
 * **Take the article row, so nothing else in this article writes until we commit.**
 *
 * A serialising lock on a row that is already known to exist, held by four
 * stores that keep one run or one thread per article: chat, searches, referee
 * claims and referee criteria all read the current state and then write a new
 * one, and two requests doing that at once would otherwise both win.
 *
 * **It is safe only because the id came from `articleIdForOwned`**, so the row
 * is there to be locked. `select … for update` locks the rows the statement
 * *returns*, so the same call made with an id that might not exist would lock
 * nothing while reading as though it locked something — which is
 * docs/postmortems/260901f-a-for-update-that-locks-nothing.md, whose audit table
 * clears these four call sites for exactly this reason. Anything that wants to
 * lock a row it may have to create wants
 * [`lockOrCreateArticle`](pg-revisions.ts) instead.
 *
 * Named `lockArticleRow` rather than `lockArticle` because `pg-revisions.ts`
 * has a `lockArticle(tx, slug)` of its own with a different contract — it takes
 * a *slug*, returns the whole row, and is allowed to find nothing. Two functions
 * with one name and two contracts is how the wrong one gets called.
 */
export async function lockArticleRow(
  tx: Pick<ReturnType<typeof getDb>, "select">,
  articleId: string,
): Promise<void> {
  await tx.select({ id: articles.id }).from(articles).where(eq(articles.id, articleId)).for("update");
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
 * `stamped_html` — the whole article, twice — plus the tree, the labels and the
 * ideas, in order to return a 10 KB glossary. About 508 KB of
 * it on a 360-block article, measured from the artefacts on disk that became
 * those columns. GPT Sol's review of docs/plans/260827am-glossary-read-latency.md said a
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
 * docs/plans/260828c-library-read-latency.md § 3.
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
  | "quotes"
  | "ideas"
  | "timeline"
  | "quiz"
  | "sketch"
  | "illustrated"
  | "debate"
  | "arc"
  /**
   * **The image manifest on its own**, for the route that serves one asset's
   * bytes — src/routes.ts § `sendArticleAsset`.
   *
   * Its own projection rather than reusing `article`, and the reason is the
   * same one `rawSource` gives below: this read runs once per *picture*, so a
   * PDF with eight figures runs it eight times on one page load, and the
   * `article` projection carries the whole tree — 37 KB on one article — plus
   * every metadata column, to answer a question that needs one `jsonb`.
   */
  | "assets"
  /**
   * **The raw document, and it is the only read that goes looking for it.**
   *
   * Its own projection rather than columns added to `article`, which every page
   * load runs. It held `raw_bytes` until 2026-09-01 — up to 32 MiB of source
   * document — and putting that on the read that draws the reading view would
   * have spent it on every article anybody opens. The bytes are an object in
   * the `sources` bucket now and this takes the reference, but the split still
   * earns its keep: this read runs once, when somebody presses *view the
   * original*, and it is the only request that is *for* the document.
   *
   * **`rawSource`, not `source`**, because `source` is already a *column* on
   * this table (`Meta.source`, which says "pdf"). One word for two things in one
   * file is the collision the `toc` rename was made to end (src/modes.ts).
   *
   * docs/plans/plain-mode-and-the-way-out.md § 5.
   */
  | "rawSource";

const REVISION_READ_POLICY: Record<
  keyof typeof articleRevisions.$inferSelect,
  Partial<Record<RevisionReader, ColumnUse>>
> = {
  /* Identity. Every read has to know which revision it is looking at. */
  /* Every read, without exception — a projection with no `id` cannot say which
     revision it read. `sketch` and `arc` were absent until 2026-08-30, and
     their projections had been selecting it all along: the two reads were not
     in the loop in tests/store-revision-columns.test.ts, so nothing compared
     them to this. */
  id: {
    article: "value", library: "value", metadata: "value", publish: "value",
    tweets: "value", glossary: "value", quotes: "value", ideas: "value",
    sketch: "value", arc: "value", timeline: "value", quiz: "value", rawSource: "value",
    illustrated: "value", debate: "value", assets: "value",
  },
  articleId: { publish: "value" },
  /* `publish` refuses a revision that is not still a draft. */
  status: { publish: "value" },
  /* **`publish`, and only `publish`.** The lineage a draft records at mint
     (src/db/schema.ts, drizzle/0047) is what `publishRevisionIn` compares with
     the pointer it is about to move — a draft may replace the revision it was
     copied from and nothing else — so the publication's own projection has to
     be able to see it.

     It was `{}` until 2026-09-01, when the guard lived in `pgStoreSession` and
     read the column through `openOrBeginJobDraft` instead. That was a guard in
     one caller, which the next caller forgets: standalone `publishRevision`
     never read the column and buried whatever had published while a draft sat
     there. GPT Sol, finding 1 of docs/plans/260901d-stage3-code-review-sol.md.

     Still no *reader* grant, and that is deliberate: nothing a page draws
     depends on which revision a draft was copied from, so a grant to `article`,
     `library` or `metadata` would widen a projection for a fact nobody
     prints. */
  basedOnRevisionId: { publish: "value" },

  /* `metaFrom` — the reading view's masthead and the library card. */
  /* `metadata` reads these three because the freshness fingerprint of every
     article-reading artefact covers them — src/source-hash.ts §
     `articleFingerprint` — and so, since 2026-08-31, does each of those
     artefacts' own read. The prompt head carries `TITLE:`, `BY:` and
     `PUBLISHED IN:` (src/article-prompt.ts), so a changed *extracted* title is
     a different question, and a read that could not see the name would report
     every one of them current for ever. Three columns, never `...META_COLUMNS`:
     `fetchedAt` in a fingerprint would mark everything stale on every
     re-fetch. */
  title: {
    article: "value", library: "value", metadata: "value", arc: "value",
    tweets: "value", glossary: "value", quotes: "value", ideas: "value",
    sketch: "value", timeline: "value", quiz: "value",
    /* Pass B sends `articleWithIds`, so this stage is judged on the cited head
       exactly as `ideas`, `sketch`, `timeline` and `quiz` are. */
    debate: "value",
    /* **Not because this stage's own prompt prints them** — its prompt prints
       the scene — but because this read reports the *Sketch's* staleness as
       well as its own, and answering that needs exactly what the `sketch` read
       needs. src/store/pg.ts § `REVISION_PROJECTIONS.illustrated`. */
    illustrated: "value",
  },
  byline: {
    article: "value", library: "value", metadata: "value", arc: "value",
    tweets: "value", glossary: "value", quotes: "value", ideas: "value",
    sketch: "value", timeline: "value", quiz: "value",
    /* Pass B sends `articleWithIds`, so this stage is judged on the cited head
       exactly as `ideas`, `sketch`, `timeline` and `quiz` are. */
    debate: "value",
    /* **Not because this stage's own prompt prints them** — its prompt prints
       the scene — but because this read reports the *Sketch's* staleness as
       well as its own, and answering that needs exactly what the `sketch` read
       needs. src/store/pg.ts § `REVISION_PROJECTIONS.illustrated`. */
    illustrated: "value",
  },
  siteName: {
    article: "value", library: "value", metadata: "value", arc: "value",
    tweets: "value", glossary: "value", quotes: "value", ideas: "value",
    sketch: "value", timeline: "value", quiz: "value",
    /* Pass B sends `articleWithIds`, so this stage is judged on the cited head
       exactly as `ideas`, `sketch`, `timeline` and `quiz` are. */
    debate: "value",
    /* **Not because this stage's own prompt prints them** — its prompt prints
       the scene — but because this read reports the *Sketch's* staleness as
       well as its own, and answering that needs exactly what the `sketch` read
       needs. src/store/pg.ts § `REVISION_PROJECTIONS.illustrated`. */
    illustrated: "value",
  },
  lang: { article: "value", library: "value" },
  excerpt: { article: "value", library: "value", publish: "value" },
  note: { article: "value", library: "value" },
  /* **`timeline` and `metadata`, and it is on no other artefact's read** — this
     is the one stage whose freshness fingerprint carries the publication date
     (src/source-hash.ts § `datedArticleFingerprint`), because it is the frame a
     year-less "on July 7" is read against. `article` and `library` take it
     because it is a `Meta` field and both rebuild a `Meta` through `metaFrom`;
     the library sorts on `fetchedAt` and shows this nowhere yet, but a `Meta`
     assembled without it would be a different artefact from the one on disk and
     tests/store-parity.test.ts compares the two.

     Deliberately **not** on `ideas`, `sketch`, `arc`, `tweets`, `glossary` or
     `quotes`: none of their prompts prints a date, so a fingerprint over it
     would spend a paid model call every time a publisher re-dated a post. */
  publishedAt: {
    article: "value", library: "value", metadata: "value", timeline: "value",
  },
  /* `ideas`, `sketch` and `metadata` since 2026-08-31: those two stages send
     `articleWithIds`, whose head prints a `URL:` line, so their freshness
     fingerprint covers it and a read that could not see the column would report
     them stale for ever. src/source-hash.ts § `articleWithIdsFingerprint`. Not
     on the other four — `articleText` never prints a URL, and a fingerprint
     over a line the model was never shown spends a model call for nothing. */
  finalUrl: {
    article: "value", library: "value", metadata: "value", ideas: "value", sketch: "value",
    /* `timeline` sends `articleWithIds` too, so its head prints the same
       `URL:` line — it is the cited set plus the date, not a set of its own. */
    timeline: "value",
    /* `quiz` for the same reason as `ideas` and `sketch`: it sends
       `articleWithIds`, whose head prints a `URL:` line, so its freshness
       fingerprint covers it. A read that could not see the column would compute
       a fingerprint with an empty URL in it and report every quiz stale for
       ever, on every article that has one. */
    quiz: "value",
    /* `debate` for that reason and for one more of its own: this is the stage
       that sends the article's own address to a *web search*, so the URL is not
       merely printed in its head — it is the thing pass A asks the web about,
       and it is what `selfSource` compares every returned citation against. A
       read that could not see the column would compute the same fingerprint
       every other article has. */
    debate: "value",
    /* **Not because this stage's own prompt prints them** — its prompt prints
       the scene — but because this read reports the *Sketch's* staleness as
       well as its own, and answering that needs exactly what the `sketch` read
       needs. src/store/pg.ts § `REVISION_PROJECTIONS.illustrated`. */
    illustrated: "value",
  },
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
    /* `arc` and `sketch` for the same reason `ideas` has it: all three hash the
       outline as well as the blocks, so a blocks-only comparison would call a
       re-sectioned article's artefact current while the filesystem store called
       it stale — see `REVISION_PROJECTIONS.sketch`.

       **`tweets` and `glossary` joined them on 2026-08-31**, when
       the other fingerprints were completed to match: every one of these
       prompts is built out of `partsOf(tree)`, so all of them
       were always reading it and only some were comparing it. The marginal
       cost is small where it lands — each of these reads already pulls every
       block's id and text through `blockHashInputs` to compute the same
       fingerprint, which is the whole article. */
    arc: "value", sketch: "value", timeline: "value", quiz: "value",
    tweets: "value", glossary: "value",
    /* Pass B renders the article from the tree's body blocks and its
       `sourceHash` is `articleWithIdsFingerprint`, which hashes the outline as
       well as the paragraphs — so a blocks-only comparison would call a
       re-sectioned article's debate current while the filesystem store called
       it stale. */
    debate: "value",
    /* `quotes` arrived from another session on 2026-08-31 taking
       `FINGERPRINT_COLUMNS` in its projection, which is right — it hashes the
       outline like its five neighbours — and this line had not caught up.
       tests/store-revision-columns.test.ts is what noticed. */
    quotes: "value",
    /* **Not because this stage's own prompt prints them** — its prompt prints
       the scene — but because this read reports the *Sketch's* staleness as
       well as its own, and answering that needs exactly what the `sketch` read
       needs. src/store/pg.ts § `REVISION_PROJECTIONS.illustrated`. */
    illustrated: "value",
    library: "presence",
  },
  arc: { article: "value", library: "presence", metadata: "value", arc: "value" },

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
     nobody draws is a column in a query for no reason.

     **And on `assets`, which is the read that exists for exactly this column**
     — `sendArticleAsset` (src/routes.ts) looks a hash up in this manifest and
     rebuilds the storage key from what it finds, so the manifest *is* the
     authorisation for handing over the bytes. GPT Sol, I-5. */
  assets: { article: "value", metadata: "value", assets: "value" },

  /* Each artefact goes to the one read that returns it, and to the metadata
     page, which asks of every artefact "would we write this again today".

     **The library takes all four by presence**, which is the whole of what a
     card shows: four ticks in a tooltip. Reading the documents to compare them
     with null was the second half of docs/plans/260828c-library-read-latency.md. */
  tweets: { metadata: "value", tweets: "value", library: "presence" },
  glossary: { metadata: "value", glossary: "value", library: "presence" },
  /* Its own reader and the metadata page, and **not the library**: a card shows
     four ticks and a fifth would not fit — the same call `sketch` makes below. */
  quotes: { metadata: "value", quotes: "value" },
  ideas: { metadata: "value", ideas: "value" },
  /* Its own reader and the metadata page, and **not the library**, on the same
     call `quotes` and `sketch` make: a card shows four ticks and a fifth would
     not fit. */
  timeline: { metadata: "value", timeline: "value" },
  /* Its own reader and the metadata page, and **not the library**: a card shows
     four ticks and a fifth would not fit, and a scene is the widest artefact
     here — up to 46KB of coordinates — so reading it to answer a boolean on a
     list of forty articles is exactly the cost docs/plans/260828c-library-read-latency.md
     was written about. */
  sketch: {
    metadata: "value",
    sketch: "value",
    /* **The Illustrated read takes the SKETCH**, which is the only read here
       that wants somebody else's artefact — and it is the whole of what it
       wants, because what a plate was painted from is the scene rather than the
       article. src/illustrated.ts § `inputFingerprint`. */
    illustrated: "value",
  },
  /* **Its own reader, and the metadata page.** Not the library, on the same
     call `quotes`, `timeline` and `sketch` make: a card shows four ticks and a
     fifth would not fit.

     **The `metadata` grant is not optional and the plan asked for it to be
     left out.** Two things make it impossible: `ProfileCarrying` is derived
     from `ArtifactMap`, so `personalisedSteps` will not compile without this
     column — and the sentence an owner reads before publishing would otherwise
     name five personalised artefacts while a sixth, painted for their profile,
     goes public unmentioned, which is the exact bug that list was rewritten to
     end. And `isCurrent` has to have an arm for every stamped step
     (tests/store-revision-columns.test.ts), which it cannot answer without the
     column: falling to `default: true` is the failure that has caught `ideas`,
     `sketch` and `timeline` in turn. The column is cheap — the plates' bytes
     are in the blob store and this holds only their hashes — so the cost the
     instruction was guarding against is not there. */
  illustrated: { metadata: "value", illustrated: "value" },
  /* Its own reader and the metadata page, and **not the library**, on the same
     call `quotes`, `timeline` and `sketch` make: a card shows four ticks and a
     fifth would not fit. */
  quiz: { metadata: "value", quiz: "value" },
  /* Its own reader and the metadata page, and **not the library**, on the same
     call `quotes`, `timeline`, `sketch` and `quiz` make: a card shows four ticks
     and a fifth would not fit.

     The `metadata` grant is not optional, for the reason spelled out on
     `illustrated` above: `isCurrent` has to have an arm for every stamped step
     (tests/store-revision-columns.test.ts), and it cannot answer without the
     column. Falling to `default: true` is the failure that has caught `ideas`,
     `sketch` and `timeline` in turn. */
  debate: { metadata: "value", debate: "value" },

  /* **Read by nobody through here.** The two HTML columns are the whole article
     again, and they are pipeline artefacts reached through
     src/store/artifacts.ts and src/store/export.ts, never through a revision
     read — traced by grep, and independently by GPT Sol, 2026-08-27. `labels`
     likewise.

     `rawBytes` used to head this list, at up to 32 MiB of source document, and
     it was the finding this whole map was written for. The column was dropped
     on 2026-09-01; the document is an object in the `sources` bucket now, and
     the `rawSource` read takes the reference to it rather than the bytes. */
  extractedHtml: {},
  stampedHtml: {},
  /**
   * **Still nobody, and it stayed that way when `labels` became a step**
   * (2026-09-06), which was a real decision rather than an omission.
   *
   * The metadata page draws a row for every name in `STEP_ORDER` and asks each
   * one *"would we write this again today"*, so this step needs an `isCurrent`
   * arm or it falls to `default: true` and reports every run current for ever.
   * That arm reads the step's **run row** instead of this column — the three
   * values it needs are on the row, the runs are already selected, and this
   * column is one of the largest on the table at a label per paragraph. See
   * `isCurrent` § `case "labels"`.
   */
  labels: {},
  /* **The reading view, and only the reading view.** It is not an artefact and
     nothing about it is a freshness question, so `metadata` has no use for it —
     `isCurrent` asks "would we write this again today" of a *step*, and this
     column answers a different question about the same labels. The library shows
     four ticks and this is not a fifth.

     The `article` grant is not optional: without it every reader gets a run of
     blank leaf cells the moment stage 2 starts writing `pending`, which is the
     regression this whole stage exists to prevent (src/web/nav-labels.ts). It is
     one short text value on a read that already pulls every block. */
  navLabelStatus: { article: "value" },
  requestedUrl: {},
  /* **Not on any read**, and deliberately not on `rawSource`. It is the
     *origin's* Content-Type header, and the response's is decided from
     `raw_source_kind` instead — a valid PDF fetched as
     `application/octet-stream` would otherwise be served as one. It was granted
     to `rawSource` only so that `readRawDocument` could sniff the legacy
     `raw_bytes` branch, which had no recorded kind to prefer; that branch went
     with the column on 2026-09-01. `db:export` still writes it into `raw.json`,
     but that reads the whole table rather than coming through here. */
  rawContentType: {},
  rawEncoding: {},
  rawSourceKind: { rawSource: "value" },
  rawSourceSha256: { rawSource: "value" },
  /* Raw-source provenance, arriving 2026-08-28 with another agent's
     delete-the-importer work. Reached through src/store/export.ts and the
     artefact store, never through a revision read — `rawFilename` is
     reader-facing (it is what an uploaded PDF should download as) and will
     want a grant here the day something serves it, which is exactly what this
     map is for. */
  rawByteCount: {},
  /* **The grant this map's own note predicted.** It said `rawFilename` is
     reader-facing — *"it is what an uploaded PDF should download as"* — and
     *"will want a grant here the day something serves it, which is exactly what
     this map is for"*. `GET /api/source/:slug` is that day, 2026-08-31. */
  rawFilename: { rawSource: "value" },
  /* **The library's cached scalars, and the library now reads them.**
     They are written by `deriveLibraryScalars` (src/library-scalars.ts) inside
     the same transaction that writes the blocks and the tree they describe —
     by `publishRevision` — so they cannot describe text that is no longer
     there. That atomicity, not immutability, is the invariant.

     This used to name "the importer's in-place update" as the second writer,
     and the importer was deleted on 2026-09-01. `publishRevision` is the only
     one left. docs/plans/260903e-glossary-delete-in-postgres.md.

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
  publishedAt: articleRevisions.publishedAt,
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
 * What every article-reading artefact's freshness check needs beside its own
 * document: the outline, and the three metadata fields the prompt head carries.
 *
 * Named once because six projections take exactly these four and a seventh
 * spelling of them is a seventh chance to leave one out — which would not fail,
 * it would report that one artefact stale for ever in Postgres while the
 * filesystem store called the same article current. src/source-hash.ts §
 * `articleFingerprint`.
 *
 * Three metadata columns, never `...META_COLUMNS`: a projection that selects
 * more than its reader needs is the habit this whole map exists to break, and
 * `fetchedAt` inside a fingerprint would mark every artefact stale on every
 * re-fetch of an unchanged page.
 */
const FINGERPRINT_COLUMNS = {
  tree: articleRevisions.tree,
  title: articleRevisions.title,
  byline: articleRevisions.byline,
  siteName: articleRevisions.siteName,
} as const;

/**
 * The same four **plus `final_url`**, for the two reads whose stage sends
 * `articleWithIds` — `ideas` and `sketch`, whose prompt head prints a `URL:`
 * line that the other four never send (src/source-hash.ts §
 * `articleWithIdsFingerprint`).
 *
 * A second constant rather than widening the first, so the four stages that
 * must **not** be judged on a URL cannot quietly acquire one. `citedMetaFinger‑
 * printOf` requires the column in its argument type, so a projection that
 * forgot it is a compile error at the call site rather than a fingerprint built
 * without it.
 */
const CITED_FINGERPRINT_COLUMNS = {
  ...FINGERPRINT_COLUMNS,
  finalUrl: articleRevisions.finalUrl,
} as const;

/**
 * The cited set **plus `published_at`**, for the one read whose stage is judged
 * on the publication date — `timeline`, and no other
 * (src/source-hash.ts § `MetaFingerprintDated`).
 *
 * A third constant rather than widening the second, for the identical reason
 * the second is not a widening of the first: `ideas` and `sketch` must **not**
 * be judged on a date their prompt never prints, and a shared set is how they
 * would quietly acquire one. Widening `MetaFingerprint` itself would have been
 * worse still — it feeds five paid stages, so the first article re-extracted
 * would mark all five stale over bytes no model ever saw.
 */
const DATED_FINGERPRINT_COLUMNS = {
  ...CITED_FINGERPRINT_COLUMNS,
  publishedAt: articleRevisions.publishedAt,
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
    /* Not an artefact — where the paragraph nav labels are in their life, so
       the client can withhold that layer rather than draw it empty. See the
       policy entry above, and src/db/schema.ts § `navLabelStatus`. */
    navLabelStatus: articleRevisions.navLabelStatus,
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
  },
  metadata: {
    id: articleRevisions.id,
    tree: articleRevisions.tree,
    /* `arc` and the three metadata columns joined this projection on 2026-08-29,
       when the arc gained a freshness check. Three columns rather than
       `...META_COLUMNS`, because the fingerprint reads exactly `title`, `byline`
       and `siteName` (src/article-prompt.ts § `articleText`) and a projection
       that selects more than its reader needs is what this whole map exists to
       prevent. */
    arc: articleRevisions.arc,
    title: articleRevisions.title,
    byline: articleRevisions.byline,
    siteName: articleRevisions.siteName,
    /* For `ideas`, whose head prints it — see `CITED_FINGERPRINT_COLUMNS`. This
       page asks every step "would we write this again today", so it needs
       whatever the widest of them is judged on. */
    finalUrl: articleRevisions.finalUrl,
    assets: articleRevisions.assets,
    tweets: articleRevisions.tweets,
    glossary: articleRevisions.glossary,
    quotes: articleRevisions.quotes,
    ideas: articleRevisions.ideas,
    timeline: articleRevisions.timeline,
    quiz: articleRevisions.quiz,
    /* For `timeline`, and for it alone — this page asks every step "would we
       write this again today", so it needs whatever the widest of them is
       judged on, and `timeline` is judged on the publication date. */
    publishedAt: articleRevisions.publishedAt,
    /* The fifth artefact that can carry a `profileHash`, and it is here for
       that alone: `personalisedSteps` must be exhaustive or the confirmation
       dialog tells an owner nothing was personalised while a picture drawn for
       their profile goes public with the article. */
    sketch: articleRevisions.sketch,
    /* The sixth artefact that can carry a `profileHash`, and here for that and
       for `isCurrent`'s arm — see the policy entry, which has the argument
       about why this column could not be left off this read. */
    illustrated: articleRevisions.illustrated,
    /* For `isCurrent`'s arm alone — this one carries no `profileHash`. Without
       the column that arm falls to `default: true` and a debate written against
       an article that has since moved reports itself current on the one page
       whose job is to say otherwise. */
    debate: articleRevisions.debate,
  },
  publish: {
    id: articleRevisions.id,
    articleId: articleRevisions.articleId,
    status: articleRevisions.status,
    /* The lineage the publication checks itself against — see the policy entry
       above, and `publishRevisionIn` in src/store/pg-revisions.ts. */
    basedOnRevisionId: articleRevisions.basedOnRevisionId,
    tree: articleRevisions.tree,
    excerpt: articleRevisions.excerpt,
  },
  /* **All six of these carry `FINGERPRINT_COLUMNS`, and none of them did until
     2026-08-31 except `arc`** (which had all four) and `ideas`/`sketch` (which
     had the tree and not the name). Each of these reads answers `stale` for its
     artefact, and `stale` is a comparison against the fingerprint the pipeline
     would stamp — so a read that cannot see the outline or the title answers a
     narrower question than the one the writer asked, and the two stores
     disagree about the same article. src/source-hash.ts § `articleFingerprint`,
     docs/plans/260831b-finish-the-database-move.md § stage 1. */
  tweets: { id: articleRevisions.id, tweets: articleRevisions.tweets, ...FINGERPRINT_COLUMNS },
  glossary: { id: articleRevisions.id, glossary: articleRevisions.glossary, ...FINGERPRINT_COLUMNS },
  /* `FINGERPRINT_COLUMNS` and not the cited set: `quotes` sends `articleText`,
     whose head prints no `URL:` line — src/models.ts § ARTICLE_RENDERER. */
  quotes: { id: articleRevisions.id, quotes: articleRevisions.quotes, ...FINGERPRINT_COLUMNS },
  ideas: { id: articleRevisions.id, ideas: articleRevisions.ideas, ...CITED_FINGERPRINT_COLUMNS },
  /* **The one projection on `DATED_FINGERPRINT_COLUMNS`.** Everything the cited
     set has, plus `published_at`, because this artefact's `sourceHash` covers
     the date — and a read that could not see the column would compute a
     fingerprint with an empty date in it and report the timeline stale for
     ever, on every article that has one. */
  timeline: {
    id: articleRevisions.id,
    timeline: articleRevisions.timeline,
    ...DATED_FINGERPRINT_COLUMNS,
  },
  /* `CITED_FINGERPRINT_COLUMNS`, exactly like `ideas` and `sketch`: this stage
     sends `articleWithIds`, whose head prints a `URL:` line, so the cited set
     is the one its `sourceHash` covers. Not the dated set — no date appears in
     this prompt, so hashing one would spend a paid model call every time a
     publisher re-dated a post. */
  quiz: {
    id: articleRevisions.id,
    quiz: articleRevisions.quiz,
    ...CITED_FINGERPRINT_COLUMNS,
  },
  sketch: {
    id: articleRevisions.id,
    sketch: articleRevisions.sketch,
    ...CITED_FINGERPRINT_COLUMNS,
  },
  /* `CITED_FINGERPRINT_COLUMNS`, like `ideas`, `sketch` and `quiz`: pass B sends
     `articleWithIds`, whose head prints a `URL:` line, so the cited set is what
     its `sourceHash` covers. Not the dated set — no publication date appears in
     either prompt, so hashing one would spend up to $0.27 every time a publisher
     re-dated a post. */
  debate: {
    id: articleRevisions.id,
    debate: articleRevisions.debate,
    ...CITED_FINGERPRINT_COLUMNS,
  },
  /**
   * **The one projection that takes another artefact's column**, and it takes
   * the cited fingerprint set as well.
   *
   * `illustrated`'s own `sourceHash` is a hash of the `sketch` column, so that
   * is the first thing this needs. The fingerprint columns are the second, and
   * they are not belt-and-braces: this read reports `stale` when the **Sketch**
   * has gone stale too, and answering that is exactly the question the `sketch`
   * projection one entry up exists for. A picture painted from a Sketch that
   * has since drifted off the article is two hops away from it, and calling it
   * current because nobody has pressed the Sketch button would be the most
   * confidently wrong answer in the mode.
   */
  illustrated: {
    id: articleRevisions.id,
    illustrated: articleRevisions.illustrated,
    sketch: articleRevisions.sketch,
    ...CITED_FINGERPRINT_COLUMNS,
  },
  arc: { id: articleRevisions.id, arc: articleRevisions.arc, ...FINGERPRINT_COLUMNS },
  /**
   * **One column, and no fingerprint** — the narrowest read in this map.
   *
   * `loadAssets` answers *does this article hold an object under this hash*,
   * which is a question about the manifest and about nothing else. There is no
   * staleness to report: a manifest that is out of date still describes objects
   * that really are in the bucket, and refusing to serve a picture because the
   * paragraph beside it has been re-extracted would take a figure off the page
   * for a reason the reader cannot act on.
   *
   * A projection of its own rather than `article`, for `rawSource`'s reason
   * one entry down: the route that uses it runs once per picture — eight times
   * on the PDF this was built for — and `article` carries the whole tree.
   */
  assets: { id: articleRevisions.id, assets: articleRevisions.assets },
  /**
   * **The reference `readRawDocument` follows, and `rawFilename` for the name to
   * download it under.** src/store/raw-document.ts owns what those columns mean;
   * this only says which read may take them.
   *
   * A projection of its own rather than columns bolted onto `article`: this read
   * runs when somebody presses *view the original* and nothing else needs the
   * reference. Until 2026-09-01 it also took `raw_bytes`, up to 32 MiB of source
   * document, which is why it was split out in the first place.
   *
   * **Not the projection the source route uses.** That one is
   * `sourceReferenceQuery` in src/store/pg-source.ts, which answers only *is
   * this article a PDF, and where is it*. This is
   * `pgArticleReader.loadSource`, which answers the whole-document question in
   * one go.
   */
  rawSource: {
    id: articleRevisions.id,
    rawSourceSha256: articleRevisions.rawSourceSha256,
    rawSourceKind: articleRevisions.rawSourceKind,
    rawFilename: articleRevisions.rawFilename,
  },
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
      contextId: revisionBlocks.contextId,
      contextType: revisionBlocks.contextType,
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
    ...(row.contextId === null || row.contextType === null
      ? {}
      : { context: { id: row.contextId, type: row.contextType as "callout" } }),
  }));

  /* The same guard src/api.ts put on the filesystem reader, because there were
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
 * `loadTweets`, `loadGlossary` and `loadIdeas` each read every
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
 * **The same fingerprint read, keyed on the article rather than the revision.**
 *
 * `blockHashQuery` above takes a revision id, which the caller already has.
 * These callers do not: a saved search, a referee criterion and a referee claim
 * each know only which article they belong to, and want the hash of whatever
 * that article's *current* revision says now. So this is `blockHashQuery` plus
 * the join that resolves `articles.currentRevisionId`, and it must keep the
 * same four columns and the same `order by` for the reasons that query gives.
 *
 * **The same `hashBlocks`, not a second one that agrees today.** That is the
 * whole reason src/source-hash.ts is its own module: two fingerprints of one
 * article can only ever disagree, and the day they do, a run stored through one
 * store reports itself current against the other's idea of current.
 *
 * It is one function because it was three. `pg-searches.ts`, `pg-referee-criteria.ts`
 * and `pg-referee-claims.ts` each carried a byte-identical private copy, and
 * `pg-referee-claims.ts`'s comment called itself "the third copy of this query
 * in src/store/" and named the two things that must not drift — while nothing
 * compared them and no test named any of them. Written down is not checked; see
 * docs/reusable/written-down-is-not-checked.md.
 *
 * Grepping the genre rather than the three the comments named turned up a fourth
 * relative: `blockHashQuery` above, which is this query without the join and
 * was already extracted and already tested. This one now sits beside it.
 */
export function sourceHashQuery(
  db: Pick<ReturnType<typeof getDb>, "select">,
  articleId: string,
) {
  return db
    .select({
      id: revisionBlocks.blockId,
      text: revisionBlocks.text,
      role: revisionBlocks.role,
      treatment: revisionBlocks.treatment,
    })
    .from(revisionBlocks)
    .innerJoin(articles, eq(articles.currentRevisionId, revisionBlocks.revisionId))
    .where(eq(articles.id, articleId))
    .orderBy(asc(revisionBlocks.ordinal));
}

/**
 * The hash of an article's current blocks, or `undefined` when it has none —
 * which every caller's `isStale` treats as stale, the same answer the
 * filesystem store gives for a `blocks.json` it cannot read.
 */
export async function sourceHashFor(
  articleId: string,
  db: Pick<ReturnType<typeof getDb>, "select"> = getDb(),
): Promise<string | undefined> {
  const rows = await sourceHashQuery(db, articleId);
  return rows.length ? hashBlocks(rows) : undefined;
}

/**
 * Rebuild `Meta` from the revision's columns.
 *
 * The fallback matters: `src/api.ts` invented a title from the article's own
 * first `h1` when `meta.json` was absent, and kept the slug only as a last
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
   * docs/plans/260828c-library-read-latency.md § 5.
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
    /* **Straight through, never re-parsed.** The column is `text` holding the
       publisher's own ISO string in the publisher's own frame, and
       `new Date(s).toISOString()` here would move the calendar day — which is
       the whole content of this field. src/db/schema.ts § `publishedAt`. */
    ...(revision.publishedAt === null ? {} : { publishedAt: revision.publishedAt }),
    ...(revision.note === null ? {} : { note: revision.note }),
    /* PDF provenance, so the spread pattern above is load-bearing here too:
       `source: null` in `meta.json` is not the same artefact as no `source`
       key, and the round-trip test compares them. docs/plans/260826c-pdf-ingestion.md.

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
 * docs/plans/260826e-postgres-storage-implementation.md rather than left for somebody
 * to find on the page.
 *
 * **`Record<StepName, …>`, and no `?? []` at the lookup.** It was
 * `Record<string, …>` with a fallback, which made a step nobody had added here
 * come out as an empty list — a row on the metadata page saying the artefact is
 * stored nowhere, which reads like a finding rather than like the omission it
 * is. Exhaustive over `StepName` means adding a step to the pipeline fails the
 * typecheck here instead. Found in a review of the built seam, 2026-08-26.
 */
/* **Exported for tests/labels-step-registration.test.ts alone**, which asks that
   every step producing `tree` lists both columns here. The compiler asks for a
   row; it cannot ask that the row names the right site, and a row naming the
   wrong one is a metadata page confidently pointing at the wrong column. */
export const STEP_STORAGE: Record<StepName, string[]> = {
  /* The fetched document's facts — `RAW_COLUMNS` in src/store/artifacts-pg.ts —
     of which `raw_source_sha256` names the object holding the bytes. That object
     is in the `sources` bucket, which is not a table; `raw_sources` is the row
     describing it. This said `article_revisions.raw_bytes` until 2026-09-01,
     when the column that held the document itself was dropped. */
  fetch: ["article_revisions.raw_source_sha256", "raw_sources"],
  extract: ["article_revisions.title", "article_revisions.extracted_html"],
  blocks: ["revision_blocks", "block_identities"],
  hierarchy: ["article_revisions.tree", "article_revisions.labels"],
  /* The same two columns as `hierarchy` above, and that is right rather than a
     copy-paste: stage 4 writes the tree and an empty manifest, and this step
     rewrites both with the labels merged in. Two steps over one site is a shape
     this store already has — `blocks`/`hierarchy` share the block rows
     (src/store/artifacts-pg.ts § STORAGE) — and what keeps their doneness apart
     is each step's own run row, pinned by
     tests/shared-site-run-row-gate.test.ts. */
  labels: ["article_revisions.labels", "article_revisions.tree"],
  /* The manifest is the column; the bytes it names are objects in the `sources`
     bucket, which is not a table and so is not listed here. */
  assets: ["article_revisions.assets"],
  arc: ["article_revisions.arc"],
  tweets: ["article_revisions.tweets"],
  glossary: ["article_revisions.glossary"],
  quotes: ["article_revisions.quotes"],
  ideas: ["article_revisions.ideas"],
  timeline: ["article_revisions.timeline"],
  quiz: ["article_revisions.quiz"],
  sketch: ["article_revisions.sketch"],
  /* The brief is the column; the plates it names are content-addressed objects
     in the `sources` bucket, which is not a table and so is not listed here —
     the same shape `assets` above has. */
  illustrated: ["article_revisions.illustrated"],
  debate: ["article_revisions.debate"],
};

/**
 * What the library calls `addedAt`, as SQL.
 *
 * **`coalesce(fetched_at, articles.created_at)`, never `fetched_at` alone.** On
 * the filesystem `addedAt` is `meta.fetchedAt` where stage 2 recorded one and
 * the mtime of `blocks.json` otherwise. In Postgres `fetched_at` is written from
 * the raw manifest at stage 1 (src/store/artifacts-pg.ts), and
 * `articles.created_at` is the fallback for a revision that never had one —
 * the article-level added-time that `REVISION_CARRY_POLICY` § `createdAt` in
 * src/store/pg-revisions.ts sends the reader here for. (src/store/import.ts used
 * to seed both `created_at` columns from that same mtime so the two agreed
 * exactly; it was deleted on 2026-09-01.)
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
 * The three metadata fields a staleness check is entitled to look at, rebuilt
 * from the revision's own columns.
 *
 * **One helper rather than the literal written out at six call sites**, because
 * the fields are the fingerprint's definition (src/source-hash.ts §
 * `MetaFingerprint`) and a call site that spelled one of them differently would
 * mark that artefact stale for ever, in Postgres only, with the filesystem
 * store calling the same article current. That is exactly the two-stores-
 * disagree failure the parity tests exist to catch.
 *
 * `?? ""` on the title matches what `articleFingerprint` does with an absent
 * one. The `byline` and `siteName` spreads are conditional because the columns
 * are nullable and `Meta`'s fields are optional — an explicit `undefined` and an
 * absent key hash the same, but the type does not accept the first.
 *
 * **Deliberately not `metaFrom`.** That builds a whole `Meta` for a reader,
 * including `url`, `lang` and `fetchedAt`, and falls back to the article's own
 * first heading for a missing title. None of that belongs in a fingerprint: the
 * head of a prompt carries three fields and a fingerprint over more of them
 * would invalidate artefacts for changes the model never saw.
 */
export function metaFingerprintOf(revision: {
  title: string | null;
  byline: string | null;
  siteName: string | null;
}): MetaFingerprint | null {
  /* **`null` when there is no title, matching `readMeta` in
     src/store/artifacts-pg.ts** — *"a null title has nothing that would make a
     usable `meta`"*. That is what the pipeline's stamp is handed, on both
     stores, and the fingerprint deliberately tells `null` from an object whose
     fields are empty: they are different states. Returning `{ title: "" }` here
     made an article with no metadata current to the pipeline and stale to every
     reader path, permanently and in Postgres only. GPT Sol, 2026-08-31;
     tests/store-revision-columns.test.ts asserts the two agree rather than
     asserting this returns null, so the assertion survives the fingerprint
     changing its mind about how it encodes "absent".

     `=== null`, not truthiness, for the reason `readMeta` gives: an
     empty-string title is a different fact — extraction ran and produced
     nothing usable — and should hash as the empty title it is. */
  if (revision.title === null) return null;
  return {
    title: revision.title,
    ...(revision.byline == null ? {} : { byline: revision.byline }),
    ...(revision.siteName == null ? {} : { siteName: revision.siteName }),
  };
}

/**
 * The same, **plus the final URL**, for the two stages whose prompt head prints
 * one — `ideas` and `sketch`, which send `articleWithIds`.
 *
 * **A separate function taking a wider row, and that is the point rather than a
 * cost.** A projection that forgot `final_url` cannot reach this: it is a type
 * error at the call site instead of a fingerprint quietly built without the
 * field, which is the failure mode this whole family keeps producing. The four
 * `articleText` stages go on calling `metaFingerprintOf`, so they cannot be
 * judged on a line their prompt never carries.
 *
 * The column exists and is already how Postgres reconstructs `Meta.url`
 * (`readMeta`, src/store/artifacts-pg.ts) — an earlier version of this work
 * claimed no Postgres call site carried a URL and left it out of the
 * fingerprint on that basis. That was simply wrong. GPT Sol, 2026-08-31.
 */
export function citedMetaFingerprintOf(revision: {
  title: string | null;
  byline: string | null;
  siteName: string | null;
  finalUrl: string | null;
}): MetaFingerprintWithUrl | null {
  const base = metaFingerprintOf(revision);
  if (base === null) return null;
  return { ...base, ...(revision.finalUrl == null ? {} : { url: revision.finalUrl }) };
}

/**
 * The cited head **plus the publication date** — the fingerprint head for
 * `timeline`, and for nothing else.
 *
 * A third function rather than a fourth argument, for the reason
 * `citedMetaFingerprintOf` is a second one: the stages that must not be judged
 * on a date cannot then acquire one by a caller passing something extra.
 * `DATED_FINGERPRINT_COLUMNS` is the projection that feeds it, and requiring
 * `publishedAt` in the argument type makes a projection that forgot the column a
 * compile error here rather than a fingerprint quietly built with no date in it.
 *
 * **`null` propagates from the base.** No metadata at all is a real, common
 * state — most of the shelf — and it must hash the same way on both sides of the
 * seam, which is what `datedArticleFingerprint` handles by hashing the absent
 * date as `""`.
 */
export function datedMetaFingerprintOf(revision: {
  title: string | null;
  byline: string | null;
  siteName: string | null;
  finalUrl: string | null;
  publishedAt: string | null;
}): MetaFingerprintDated | null {
  const base = citedMetaFingerprintOf(revision);
  if (base === null) return null;
  return {
    ...base,
    ...(revision.publishedAt == null ? {} : { publishedAt: revision.publishedAt }),
  };
}

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
  /* The **cited** head: `ideas` sends `articleWithIds`, which prints a `URL:`
     line the other four never send. src/source-hash.ts. */
  meta: MetaFingerprintWithUrl | null,
): boolean {
  const found = revision.ideas as Ideas | null;
  const tree = revision.tree as Tree | null;
  if (!found || !tree || blocks.length === 0) return false;
  /* The blocks AND the tree AND the metadata head — src/ideas.ts §
     `inputFingerprint`. This artefact is written from the skeleton as much as
     from the paragraphs, so a re-sectioned article is a different question even
     when every block is byte-identical; and the prompt carries `TITLE:`, `BY:`
     and `PUBLISHED IN:`, so a changed extracted title is another one. */
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
      inputHash: ideasFingerprint(blocks, tree, meta),
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
 * Is the stored `glossary` one we would write again today?
 *
 * `sameStamp` rather than three comparisons written out again — one definition
 * of "current", and this artefact can be checked in full because its prompt
 * version is exported.
 *
 * **The article fingerprint, not the block hash.** The glossary's prompt is
 * built from the tree's skeleton and carries the metadata head, so the blocks
 * alone would call a re-sectioned or re-titled article's glossary current —
 * while the filesystem store, which asks `STEPS.glossary.stamp`, called it
 * stale. `null` is "we cannot tell", and `sameStamp` refuses a comparison that
 * declares nothing.
 *
 * A function rather than an arm of the switch for the reason `ideasAreCurrent`
 * is one: the switch has a complexity ceiling and this was the longest arm in
 * it. Nothing about the rule changed in the move.
 */
function glossaryIsCurrent(glossary: Glossary | null, articleHash: string | null): boolean {
  if (!glossary) return false;
  return sameStamp(
    {
      inputHash: glossary.sourceHash,
      promptVersion: glossary.version,
      model: glossary.generator,
    },
    {
      ...(articleHash ? { inputHash: articleHash } : {}),
      promptVersion: PROMPT_VERSION,
      model: CAPABLE_MODEL,
    },
  );
}

/**
 * Is the stored `sketch` artefact one we would draw again today?
 *
 * **A sibling of `ideasAreCurrent`, and it was missing until 2026-08-31** —
 * `sketch` fell through to `default: true`, so the metadata page reported every
 * carried sketch finished while `loadSketch` a few hundred lines below reported
 * the same artefact stale. Two answers to one question, and the confident one
 * was wrong; the identical bug `ideasAreCurrent` was written to fix, one step
 * along. GPT Sol, 2026-08-31.
 *
 * The **cited** head, like `ideas`: this stage sends `articleWithIds`, so its
 * fingerprint covers the `URL:` line and the synthetic title it falls back to
 * (src/source-hash.ts § `articleWithIdsFingerprint`).
 *
 * `profileHash` is taken from the artefact and put on **both** sides, for the
 * reason `ideasAreCurrent` gives: the profile the pipeline would stamp with is
 * resolved per job (src/jobs.ts) and this read has no access to it, so a guess
 * would mark every profiled picture stale on a page whose whole job is to list
 * which stages have run. Whether to redraw is decided by the stamp in
 * src/pipeline.ts, which does know.
 */
function sketchIsCurrent(
  revision: { sketch: unknown; tree: unknown },
  blocks: readonly Block[],
  meta: MetaFingerprintWithUrl | null,
): boolean {
  const found = revision.sketch as Sketch | null;
  const tree = revision.tree as Tree | null;
  /* An empty scene list counts as no sketch, the same rule `loadSketch` and
     `readSketchFile` keep: a column can hold `{"scenes": []}` from an import or
     a hand edit, and calling that a finished stage would put a tick over a band
     with nothing in it. */
  if (!found || !Array.isArray(found.scenes) || found.scenes.length === 0) return false;
  if (!tree || blocks.length === 0) return false;
  const profile = found.profileHash !== undefined ? { profileHash: found.profileHash } : {};
  /* **Spread rather than assigned**, because `Sketch.sourceHash` and
     `Sketch.generator` are optional and this project has
     `exactOptionalPropertyTypes` on: writing `inputHash: found.sourceHash`
     would put an explicit `undefined` on the key, which is a different thing
     from the key being absent. `sameStamp` compares the fields the *expected*
     stamp declares, so an absent one on the recorded side simply fails to
     match — which is the right answer for an artefact that recorded nothing. */
  return sameStamp(
    {
      ...(found.sourceHash === undefined ? {} : { inputHash: found.sourceHash }),
      promptVersion: found.version,
      ...(found.generator === undefined ? {} : { model: found.generator }),
      ...profile,
    },
    {
      inputHash: sketchFingerprint(blocks, tree, meta),
      promptVersion: SKETCH_PROMPT_VERSION,
      model: CAPABLE_MODEL,
      ...profile,
    },
  );
}

/**
 * Is the stored `illustrated` artefact one we would paint again today?
 *
 * **A sibling of `sketchIsCurrent` directly above, over a different input.**
 * That one asks whether the *article* has moved; this one asks whether the
 * *Sketch* has — src/illustrated.ts § `inputFingerprint` for why, and it is the
 * one place in this switch where the obvious answer is the wrong one.
 *
 * It deliberately does **not** also ask whether the Sketch is stale against the
 * article. That is a question `loadIllustrated` answers for the panel, because
 * the panel is offering to repaint; this page is listing which stages have run,
 * and a stage whose input is unchanged is a stage we would not run again. The
 * Sketch's own row on the same page is where the article's movement shows.
 *
 * `profileHash` on both sides, for `sketchIsCurrent`'s reason: the profile the
 * pipeline would stamp with is resolved per job and this read has no access to
 * it. Here it is inherited from the Sketch besides, so a guess would be wrong
 * twice over.
 */
function illustratedIsCurrent(revision: { illustrated: unknown; sketch: unknown }): boolean {
  const found = revision.illustrated as Illustrated | null;
  const sketch = revision.sketch as Sketch | null;
  /* An empty plate list counts as none, the same rule `SHAPE` and
     `loadIllustrated` keep. */
  if (!found || !Array.isArray(found.plates) || found.plates.length === 0) return false;
  if (!sketch || !Array.isArray(sketch.scenes) || sketch.scenes.length === 0) return false;
  const profile = found.profileHash !== undefined ? { profileHash: found.profileHash } : {};
  return sameStamp(
    {
      ...(found.sourceHash === undefined ? {} : { inputHash: found.sourceHash }),
      promptVersion: found.version,
      ...(found.generator === undefined ? {} : { model: found.generator }),
      ...profile,
    },
    {
      inputHash: illustratedFingerprint(sketch),
      promptVersion: ILLUSTRATED_PROMPT_VERSION,
      model: CAPABLE_MODEL,
      ...profile,
    },
  );
}

/**
 * The shelf's query, taking its builder, **so a test can read the SQL it sends.**
 *
 * Extracted for the same reason `currentRevisionQuery` and `blockHashQuery`
 * were, and GPT Sol's fourth finding on docs/plans/260828c-library-read-latency.md said
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
       disagree about what an article is — the same reason src/api.ts filtered
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
 * finding on docs/plans/260828c-library-read-latency.md, where the rule was written as
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
         statement rather than a hope — the column cannot hold anything else.
         (`checkNoteFields` used to be named here as a second enforcer; it was
         deleted unused with src/block-fields.ts on 2026-09-01, so **the CHECK is
         now the only one** — docs/plans/260831b-finish-the-database-move.md
         § Stage 4, and tests/block-roles.test.ts records what went with it.) */
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
 * only five artefacts can carry it (`sketch` was the fifth, and was missing from
 * this list for two hours on the afternoon it was written: the picture is drawn
 * for a profile like every other model call here, and an owner asking what would
 * go public was told about four of them). The tree and the arc deliberately do not
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
/**
 * **Every artefact whose own type says it can carry a `profileHash`** — derived
 * from `ArtifactMap`, not written down. `personalisedSteps` had a hand-written
 * list of four and `sketch` was the fifth; nothing said so, and the sentence an
 * owner reads before publishing was quietly wrong. A list that has to stay
 * exhaustive should not be a list.
 *
 * `"profileHash" extends keyof T` rather than `T extends { profileHash?: … }`,
 * because the first asks the question and the second only appears to. The
 * structural form does return the same five today — checked, not assumed — but
 * only because TypeScript refuses a type with *no* property in common with a
 * wholly-optional target. Give the probe one property these artefacts also
 * have and it collapses: `Tree extends { profileHash?: string | null }` is
 * false, and `Tree extends { profileHash?: string | null; version?: string }`
 * is **true**. A rule held up by the absence of a shared field is not a rule.
 */
export type ProfileCarrying = {
  [K in keyof ArtifactMap]: "profileHash" extends keyof ArtifactMap[K] ? K : never;
}[keyof ArtifactMap] &
  StepName;

function personalisedSteps(revision: {
  tweets: TweetThread | null;
  glossary: Glossary | null;
  quotes: Quotes | null;
  ideas: Ideas | null;
  sketch: Sketch | null;
  illustrated: Illustrated | null;
}): StepName[] {
  /* `Record`, not `Partial<Record>`: a seventh artefact gaining a `profileHash`
     has to fail here, at the compiler, rather than fall off the dialog. It has
     done its job once since — `quotes` joined on 2026-08-31. */
  const carriers: Record<ProfileCarrying, { profileHash?: string | null } | null> = {
    tweets: revision.tweets,
    glossary: revision.glossary,
    quotes: revision.quotes,
    ideas: revision.ideas,
    sketch: revision.sketch,
    /* The sixth, and the one whose `profileHash` is **inherited** rather than
       taken from the reader: a picture painted from a personalised Sketch is
       itself personalised, and an owner about to publish is owed that fact.
       src/illustrated.ts. */
    illustrated: revision.illustrated,
  };
  /* `Object.entries` rather than indexing `carriers` by `StepName`, because
     the record is now exactly the five that can be personalised and a
     `StepName` is not a key of it — which is the point. The filter over
     `STEP_ORDER` at the end is what keeps the dialog's order the page's. */
  const personalised = new Set<string>();
  for (const [step, artefact] of Object.entries(carriers)) {
    if (artefact?.profileHash != null) personalised.add(step);
  }
  return STEP_ORDER.filter((step) => personalised.has(step));
}

/**
 * **Which artefacts a shared link would carry** — presence, and nothing else.
 *
 * The same question `src/store/public-reader.ts` answers by reading the column:
 * `publicArticle` spreads an artefact in when it is not null and never asks
 * whether it is current. So this is `!== null` five times, deliberately, and
 * **not** `stages[].done` — which is `status === "done" && isCurrent(step)` a
 * few hundred lines below, and which calls a stale glossary absent while every
 * visitor is reading it. src/types.ts § PublicArtefacts says the same thing at
 * the type.
 *
 * `Record<keyof PublicArtefacts, …>` rather than an object literal, so a sixth
 * artefact joining the public payload is a red compiler here rather than a row
 * missing from the owner's inventory.
 */
export function shareableArtefacts(revision: {
  arc: Arc | null;
  tweets: TweetThread | null;
  glossary: Glossary | null;
  ideas: Ideas | null;
  quotes: Quotes | null;
  timeline: Timeline | null;
  sketch: Sketch | null;
}): PublicArtefacts {
  const present: Record<keyof PublicArtefacts, object | null> = {
    arc: revision.arc,
    tweets: revision.tweets,
    glossary: revision.glossary,
    ideas: revision.ideas,
    quotes: revision.quotes,
    timeline: revision.timeline,
    sketch: revision.sketch,
  };
  return {
    arc: present.arc !== null,
    tweets: present.tweets !== null,
    glossary: present.glossary !== null,
    ideas: present.ideas !== null,
    quotes: present.quotes !== null,
    timeline: present.timeline !== null,
    sketch: present.sketch !== null,
  };
}

/**
 * **The whole `ArticleReader`, annotated as one — not a `Pick` of the twelve
 * names that happen to be here today.**
 *
 * It was a `Pick` re-listing every method, and src/store/index.ts then cast it
 * back with `as ArticleReader`. Between them, a loader this file forgot was a
 * `TypeError` the first time a route called it in production, rather than a red
 * typecheck — the shape of postmortem
 * docs/postmortems/260901e-claims-shipped-filesystem-only-and-returned-501-in-production.md.
 * No supported adapter may legitimately omit a loader (GPT Sol, 2026-09-02), so
 * the `Pick` was recording nothing except which names existed when it was last
 * edited.
 *
 * **Annotated, not `satisfies`**, for two reasons. `fsArticleReader` in
 * src/store/fs.ts is annotated the same way, and the twin adapters should read
 * the same; and tests/store-seams-have-two-implementations.test.ts finds an
 * adapter by parsing its *type annotation* out of the source, so a `satisfies`
 * clause would make this one invisible to the test that counts sides of a seam.
 * The narrower inferred type buys callers nothing here: every method already
 * returns exactly what the interface declares.
 */
const rawPgArticleReader: ArticleReader = {
  /**
   * **The raw document, out of the object store the revision names.**
   *
   * All the judgement is in `readRawDocument` (src/store/raw-document.ts) and it
   * is imported rather than re-derived: the two storage eras, the refusal to fall
   * through from a dangling reference to the legacy column, and the re-hash of
   * what the bucket handed back. `db:export` and this route are the only two
   * callers, they want identical answers, and a second reading of the same four
   * columns is how two callers come to disagree about which era a row is in.
   * GPT Sol made that a blocker on the plan, 2026-08-31.
   *
   * **`postgresBlobStore(…)`, not `blobStore()`, and that was a real bug for
   * about an hour.** `blobStore()` picks the filesystem whenever the Supabase
   * credentials are absent, which is right for the pipeline and wrong here.
   * The running server never reaches that arm — src/store/index.ts constructs a
   * `postgresBlobStore` at boot and refuses to start without the pair — but
   * `pgArticleReader` is an exported adapter that scripts and tests import
   * directly, and a direct caller bypasses the boot guard entirely. Configure
   * Postgres without the credentials, call this, and it reads `data/_blobs/`:
   * either serving a local object that coincidentally hashes the same, or
   * reporting a dangling reference that is not dangling. GPT Sol, 2026-08-31.
   *
   * So this asks for the checked store by name and fails closed. **Not**
   * `exportBlobStore()`, which would put this file back in `export.ts`'s import
   * graph — the cycle the extraction into raw-document.ts was for.
   *
   * **Authorised by `currentRevision`**, which joins through `ownedSlug` — so
   * an article that is not the caller's is not found rather than refused, the
   * same 404 every other read here gives. There is no second ownership question
   * to get wrong.
   */
  async loadSource(slug: string): Promise<RawSource | null> {
    requireSlug(slug);
    const found = await currentRevision(slug, "rawSource");
    if (!found) throw notFound(slug);
    const document = await readRawDocument(
      slug,
      found.revision,
      postgresBlobStore("the Postgres store serves an article's source document"),
    );
    if (!document) return null;
    return { bytes: document.bytes, kind: document.kind, filename: found.revision.rawFilename };
  },

  async loadArticle(slug: string): Promise<Article> {
    requireSlug(slug);
    const found = await currentRevision(slug, "article");
    if (!found) throw notFound(slug);

    const blocks = await blocksFor(found.revision.id);
    const tree = found.revision.tree;
    // A revision with no tree is not a readable article — the same bar
    // src/api.ts set by requiring both blocks.json and tree.json.
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
      /* **Named, and never spread in from the row**, for the same reason
         `assets` above is: the key is required on `Article` precisely so that
         leaving this line out is a type error rather than a reader who gets a
         column of blank cells (src/types.ts § `navLabelStatus`).

         No cast and no `??`: the column is `not null` with a CHECK and drizzle
         carries the `$type`, so this is already the union. The runtime guard for
         a value the CHECK somehow let past lives at the one boundary that can
         act on it — `paragraphLabelsReady` in src/web/nav-labels.ts treats
         anything but `ready` as *withhold*, which fails in the safe direction. */
      navLabelStatus: found.revision.navLabelStatus,
      /* **Free, off the row `shelfFrom` is already reading**, and the reason
         the masthead's sharing mark costs no request: `currentRevision`
         selects `articles` whole.

         Always a value here, never conditional on it being `public` — the
         mark has three states and one of them is *we could not say*, which is
         what the filesystem store's absence means. `describeArticle` keeps the
         key only when it says `public` because the shelf has no private twin
         to draw (src/library-scalars.ts); this one draws a lock.

         The cast is the same boundary `articleMetadata` and `listArticles`
         cross: a `text` column with a CHECK on it (`articles_visibility`,
         drizzle/0024) is a two-member union TypeScript cannot see the
         guarantee for. */
      visibility: found.article.visibility as Visibility,
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
             docs/plans/260828c-library-read-latency.md. */
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
          },
          /* **Which of these the owner has put out in the world.** Free:
             `listArticlesQuery` selects `articles` whole, so this is a field
             of a row already on the wire rather than a query, a join or a
             projection change.

             The cast is the same boundary `articleMetadata` below crosses and
             for the same reason: a `text` column with a CHECK on it
             (`articles_visibility`, drizzle/0024) is a two-member union that
             TypeScript cannot see the guarantee for. `describeArticle` keeps
             the key only when it says `public`. */
          visibility: row.article.visibility as Visibility,
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
   * `hierarchy` is checked the way `publishRevision` checks it, so the metadata page
   * and the publication guard cannot disagree: the recorded `input_hash` must
   * equal `hashBlocks` of this revision's blocks.
   *
   * `tweets` and `glossary` carry their own `sourceHash`, so they
   * are checked against the artefact itself rather than against the step row —
   * the artefact is what a reader would actually be served.
   *
   * **The prompt-version and model half of the comparison is only done for the
   * glossary**, and that is a known, narrow divergence rather than an oversight:
   * `src/tweets.ts` keeps its `PROMPT_VERSION` module
   * private, so nothing outside it can say what stamp it *would* write.
   * The fix is its own and a review already named it — the stage exports an
   * `expectedStamp(blocks)` factory and keeps the constant private. Until then
   * a model change makes that step re-runnable on disk and still
   * green here.
   *
   * `arc` gained one on 2026-08-29 — `arc.json` records the blocks, the tree and
   * the three metadata fields its prompt carries (src/arc.ts §
   * `inputFingerprint`), so it is checked against the artefact like `tweets` and
   * `glossary`, and in full, because its `PROMPT_VERSION` is exported.
   *
   * `fetch`, `extract` and `blocks` have no currency rule in **either** store —
   * nothing they write records what it was made from — so they are the step row
   * alone, exactly as on the filesystem. **`assets` is not one of
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
    /* Read once, beside the blocks and for the same reason. Six of the eight
       checks below are about an artefact whose prompt read the tree and the
       metadata head as well as the paragraphs — src/source-hash.ts §
       `articleFingerprint` — and `null` here is "we cannot tell", which answers
       not-current for every one of them. */
    const tree = revision.tree as Tree | null;
    /* **Two heads, because there are two prompts.** `articleText` (arc, tweets,
       glossary) prints three metadata lines; `articleWithIds` (ideas,
       sketch) prints those three and a `URL:`, and falls back to the tree's slug
       when there is no metadata at all. src/source-hash.ts. */
    const metaFingerprint = metaFingerprintOf(revision);
    const citedFingerprint = citedMetaFingerprintOf(revision);
    /* The cited head plus the publication date, for `timeline` alone — the only
       stage judged on it. src/source-hash.ts § `MetaFingerprintDated`. */
    const datedFingerprint = datedMetaFingerprintOf(revision);
    /* The fingerprint every article-reading stage stamps, computed once beside
       `blocksHash` for the same reason: several arms below want it, and `null`
       is "we cannot tell", which answers not-current for all of them. */
    const articleHash =
      tree && blocks.length ? articleFingerprint(blocks, tree, metaFingerprint) : null;

    /** Is this step's output one we would write again today? */
    const isCurrent = (step: StepName): boolean => {
      switch (step) {
        case "hierarchy": {
          /* No tree and no blocks are this function's own preconditions, not
             `hierarchyCurrency`'s: it answers "is this run the one that
             describes these blocks", which is not a question you can ask when
             there are none. */
          if (!revision.tree || !blocksHash) return false;
          /* **Shared with `reasonsNotToPublish`** (src/store/pg-revisions.ts)
             since 2026-09-07, and the status half is the point of sharing it:
             **until `e18ac5f` on 2026-08-27** this call site had it and the
             publication guard did not, behind a comment three lines from here
             claiming they agreed. They have agreed since, and nothing said so
             until they were joined —
             docs/postmortems/260827d-toc-status-never-checked.md. `done` is
             still required by the caller below as well, which is belt and
             braces rather than duplication: this arm is the only one of the
             fifteen that could answer it, and every other arm relies on it. */
          return hierarchyCurrency(byStep.get("hierarchy"), blocksHash).current;
        }
        /**
         * **Asked of the run row, like `hierarchy` above and unlike everything
         * below** — and the reason is this step's own design rather than a
         * shortcut.
         *
         * The three values are on the row because `STEPS.labels.stamp` declares
         * all three and `recordStamp` writes them there; the artefact carries
         * the same three, so either would answer. The row wins on two counts:
         *
         * - **It is where this step's currency actually lives.** Writing an
         *   empty manifest *deletes* this revision's `labels` row
         *   (`writeArtefacts`, src/store/artifacts-pg.ts), and that deletion —
         *   not any hash — is what makes a re-cut tree invalidate its labels.
         *   Reading the row means this page answers the same question the
         *   pipeline does, from the same fact. A missing row is `undefined`
         *   here and answers not-current, which is right for both of its causes:
         *   never run, and invalidated by a fresh `hierarchy`.
         * - **The column is one of the largest on the table** — a label per
         *   paragraph — and `REVISION_READ_POLICY` exists to keep exactly that
         *   off a read that does not need it. Granting `labels` to `metadata`
         *   would put it on every load of that page for the sake of three
         *   fields that are already selected beside it.
         *
         * **Written out rather than left to `default: true`**, the arm that has
         * caught `ideas`, `sketch` and `timeline` in turn: a missing case makes
         * every completed run report itself current for ever, on this page
         * alone, while the pipeline correctly re-runs it.
         * tests/store-revision-columns.test.ts holds every stamped step to
         * having an arm.
         */
        case "labels": {
          const run = byStep.get("labels");
          if (!run || !blocksHash) return false;
          return sameStamp(
            {
              inputHash: run.inputHash,
              /* Only where the row actually holds one. `null` means *nothing was
                 recorded*, and `sameStamp` compares with `===`, so a declared
                 `undefined` and a declared `null` are two different wrong
                 answers — `stampForStep` reads the same row the same way. */
              ...(run.promptVersion === null ? {} : { promptVersion: run.promptVersion }),
              ...(run.model === null ? {} : { model: run.model }),
            },
            {
              inputHash: blocksHash,
              promptVersion: LABELS_PROMPT_VERSION,
              model: CAPABLE_MODEL,
            },
          );
        }
        /* The same two questions as `hierarchy`, and the same answer — but asked of
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
        /* **`assetsInputHash`, not `blocksHash`, since 2026-09-06** — and this
           arm is exactly why the divergence above is worth minding. The step
           stopped stamping `hashBlocks` when it gained PDF figures, because
           `hashBlocks` does not cover `block.html` and so could not see a
           figure marker arrive (src/collect-assets.ts § `assetsInputHash`).
           Left comparing the blocks hash, this page would have answered *not
           current* for every article in the library for ever, since the two
           hashes are of different things and can never be equal. */
        case "assets": {
          const assets = revision.assets as Assets | null;
          if (!assets || !blocks.length) return false;
          return sameStamp(
            { inputHash: assets.sourceHash, promptVersion: assets.version },
            { inputHash: assetsInputHash(blocks), promptVersion: ASSETS_VERSION },
          );
        }
        case "tweets": {
          const thread = revision.tweets as TweetThread | null;
          return Boolean(thread && tree && !tweetsStale(thread, blocks, tree, metaFingerprint));
        }
        case "glossary":
          return glossaryIsCurrent(revision.glossary as Glossary | null, articleHash);
        case "quotes": {
          const quotes = revision.quotes as Quotes | null;
          if (!quotes) return false;
          /* Checked in full, like the glossary above and for the same reason:
             its `PROMPT_VERSION` is exported. **`articleHash`, not
             `blocksHash`** — the prompt is built from the tree's skeleton and
             carries the metadata head, so the blocks alone would call a
             re-sectioned or renamed article's quotes current while the
             filesystem store called them stale. */
          return sameStamp(
            {
              inputHash: quotes.sourceHash,
              promptVersion: quotes.version,
              model: quotes.generator,
            },
            {
              ...(articleHash ? { inputHash: articleHash } : {}),
              promptVersion: QUOTES_PROMPT_VERSION,
              model: CAPABLE_MODEL,
            },
          );
        }
        case "ideas":
          return ideasAreCurrent(revision, blocks, citedFingerprint);
        /* The same shape as `ideas`, over one more value: the publication date.
           Without an arm here the step falls to `default: true` and every
           completed run reports itself current on the one page whose job is to
           say otherwise — which is what happened to `ideas` and then to
           `sketch`. tests/store-revision-columns.test.ts now holds every stamped
           step to having an arm. */
        case "timeline": {
          const timeline = revision.timeline as Timeline | null;
          if (!timeline || !tree || blocks.length === 0) return false;
          return sameStamp(
            {
              inputHash: timeline.sourceHash,
              promptVersion: timeline.version,
              model: timeline.generator,
            },
            {
              inputHash: timelineFingerprint(blocks, tree, datedFingerprint),
              promptVersion: TIMELINE_PROMPT_VERSION,
              model: CAPABLE_MODEL,
            },
          );
        }
        /* The same shape as `ideas`, over the same three values and the same
           **cited** head, because this stage sends `articleWithIds` too.

           **Written out here rather than left to `default: true`**, which is
           the arm that has caught `ideas`, `sketch` and `timeline` in turn: a
           missing case makes the one page whose job is to say whether a stage
           is current answer "yes" about every completed run for ever, while
           `loadQuiz` a few hundred lines below correctly calls the same
           artefact stale. Two answers to one question, and the confident one
           wrong. tests/store-revision-columns.test.ts holds every stamped step
           to having an arm. */
        case "quiz": {
          const quiz = revision.quiz as Quiz | null;
          if (!quiz || !tree || blocks.length === 0) return false;
          return sameStamp(
            {
              inputHash: quiz.sourceHash,
              promptVersion: quiz.version,
              model: quiz.generator,
            },
            {
              inputHash: quizFingerprint(blocks, tree, citedFingerprint),
              promptVersion: QUIZ_PROMPT_VERSION,
              model: CAPABLE_MODEL,
            },
          );
        }
        /* The same shape as `ideas`, and absent until 2026-08-31 — see
           `sketchIsCurrent`. tests/store-revision-columns.test.ts now holds
           every stamped step to having an arm here, rather than naming the one
           that was missing. */
        /* The same shape as `quiz` above, over the same three values and the
           same **cited** head, because pass B sends `articleWithIds` too.
           Written out rather than left to `default: true`, which is the arm that
           has caught `ideas`, `sketch` and `timeline` in turn.

           **`modelFor("debate")`, not `CAPABLE_MODEL`** — the one arm here of
           which that is true. This step is on the chat wire, where
           `SPIDERYARN_DEBATE_MODEL` can override the model, and comparing
           against the constant would report every run of an overridden model
           stale on this page while the step itself thought it was current.
           `STEPS.debate.stamp` (src/pipeline.ts) resolves it the same way; two
           spellings of one model is exactly the drift this switch exists to
           refuse. */
        case "debate": {
          const debate = revision.debate as Debate | null;
          if (!debate || !tree || blocks.length === 0) return false;
          return sameStamp(
            {
              inputHash: debate.sourceHash,
              promptVersion: debate.version,
              model: debate.generator,
            },
            {
              inputHash: debateFingerprint(blocks, tree, citedFingerprint),
              promptVersion: DEBATE_PROMPT_VERSION,
              model: modelFor("debate"),
            },
          );
        }
        case "sketch":
          return sketchIsCurrent(revision, blocks, citedFingerprint);
        /* **The only arm here that does not look at the article**, and the
           comment is the point: what this stage was painted from is the
           `sketch` column beside it. See `illustratedIsCurrent`. */
        case "illustrated":
          return illustratedIsCurrent(revision);
        /* **Added 2026-08-29, the day `arc.json` started recording what it was
           made from.** Before that this step genuinely had nothing to compare and
           sat in the `default` arm below with `fetch`, `extract` and `blocks`.

           It has to move out of that arm the moment the artefact gains a stamp,
           for the reason `assets` is not in it either: the filesystem store now
           answers this question from `STEPS.arc.stamp`, and a `default: true`
           here would have the metadata page call an arc current while the same
           article's ingest re-runs it. Two stores disagreeing about one article
           is the failure this switch exists to prevent.

           **Blocks, tree AND the three metadata fields**, because that is what
           `inputFingerprint` covers — the arc's prompt carries `TITLE:`, `BY:`
           and `PUBLISHED IN:` at its head (src/article-prompt.ts). The revision
           row stores those three as columns, so the meta is rebuilt from them by
           `metaFingerprintOf` rather than read again. Five of its neighbours
           above now do the same; this was the first. */
        case "arc": {
          const arc = revision.arc as Arc | null;
          if (!arc || !tree || blocks.length === 0) return false;
          return !arcIsStale(arc, blocks, tree, metaFingerprint);
        }
        default:
          // fetch, extract, blocks — nothing to compare, in either store.
          // `assets` and `arc` are NOT here; each has its own case above.
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
       purpose`, via `shelfFrom`) — docs/plans/260826t-reader-profile.md. */
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
         already carries all five artefacts that can hold a `profileHash`, so
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
        /* Presence, from the revision row already in hand — see
           `shareableArtefacts` for why this is not read off `stages` below. */
        available: shareableArtefacts({
          arc: revision.arc as Arc | null,
          tweets: revision.tweets as TweetThread | null,
          glossary: revision.glossary as Glossary | null,
          ideas: revision.ideas as Ideas | null,
          quotes: revision.quotes as Quotes | null,
          timeline: revision.timeline as Timeline | null,
          sketch: revision.sketch as Sketch | null,
        }),
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
        new Error(
          `No thread for "${slug}" yet. Write one with ` +
            `POST /api/jobs { "slug": "${slug}", "steps": ["tweets"] }.`,
        ),
        { status: 404 },
      );
    }
    const blocks = await blockHashInputs(found.revision.id);
    /* The tree and the metadata head as well as the blocks — the three inputs
       the thread's prompt reads (src/source-hash.ts § `articleFingerprint`). A
       tree we cannot read is "we cannot tell", which counts as stale here for
       the reason the filesystem half gives: the cost is a banner offering a
       regeneration nobody needed. */
    const tree = found.revision.tree as Tree | null;
    return {
      thread,
      stale: !tree || tweetsStale(thread, blocks, tree, metaFingerprintOf(found.revision)),
    };
  },

  async loadGlossary(slug: string): Promise<GlossaryFound> {
    requireSlug(slug);
    const found = await currentRevision(slug, "glossary");
    if (!found) throw notFound(slug);

    const glossary = found.revision.glossary as Glossary | null;
    if (!glossary) {
      throw Object.assign(
        new Error(
          `No glossary for "${slug}" yet. Find one with ` +
            `POST /api/jobs { "slug": "${slug}", "steps": ["glossary"] }.`,
        ),
        { status: 404 },
      );
    }
    const glossaryTree = found.revision.tree as Tree | null;
    const glossaryMeta = metaFingerprintOf(found.revision);
    /* Lookups are attached HERE, at the read seam, exactly as src/api.ts did
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
       than it can. docs/plans/260827am-glossary-read-latency.md. */
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
      /* Blocks, tree and metadata head — the glossary's prompt reads all
         three, so the fingerprint covers all three. */
      stale: !glossaryTree || glossaryIsStale(glossary, blocks, glossaryTree, glossaryMeta),
      /* A different fact from `stale`, and it needs its own field because it
         needs its own sentence: `stale` means the article moved underneath
         these terms; this means the article is the same and we would write them
         differently now. */
      outdated: glossary.version !== PROMPT_VERSION,
    };
  },

  async loadQuotes(slug: string): Promise<QuotesFound> {
    requireSlug(slug);
    const found = await currentRevision(slug, "quotes");
    if (!found) throw notFound(slug);

    const quotes = found.revision.quotes as Quotes | null;
    if (!quotes) {
      throw Object.assign(
        new Error(
          `No quotes for "${slug}" yet. Choose them with ` +
            `POST /api/jobs { "slug": "${slug}", "steps": ["quotes"] }.`,
        ),
        { status: 404 },
      );
    }
    const quotesTree = found.revision.tree as Tree | null;
    const quotesMeta = metaFingerprintOf(found.revision);
    const blocks = await blockHashInputs(found.revision.id);

    return {
      quotes,
      /* Blocks, tree and metadata head — the prompt reads all three, so the
         fingerprint covers all three. It matters more here than for its
         neighbours: a stale quote list holds block ids that may no longer
         exist, so pressing a row could jump nowhere, and the words themselves
         may no longer be in the piece. */
      stale: !quotesTree || quotesAreStale(quotes, blocks, quotesTree, quotesMeta),
      /* A different fact from `stale`, needing its own sentence: `stale` means
         the article moved underneath these quotes; this means the article is
         the same and we would choose differently now. */
      outdated: quotes.version !== QUOTES_PROMPT_VERSION,
    };
  },

  async loadIdeas(slug: string): Promise<IdeasFound> {
    requireSlug(slug);
    const found = await currentRevision(slug, "ideas");
    if (!found) throw notFound(slug);

    const ideas = found.revision.ideas as Ideas | null;
    if (!ideas) {
      throw Object.assign(
        new Error(
          `No ideas for "${slug}" yet. Find them with ` +
            `POST /api/jobs { "slug": "${slug}", "steps": ["ideas"] }.`,
        ),
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
      stale: !tree || ideasAreStale(ideas, blocks, tree, citedMetaFingerprintOf(found.revision)),
      outdated: ideas.version !== IDEAS_PROMPT_VERSION,
    };
  },

  /**
   * The timeline on its own — the Postgres half of `loadTimeline`.
   *
   * **Four inputs, where `loadIdeas` above needs three**, and the fourth is the
   * publication date. `datedArticleFingerprint` covers it because it is the
   * frame every year-less date in the artefact was read against, so a
   * comparison without it would call a re-dated article's timeline current
   * while the filesystem store called it stale.
   *
   * **An empty `events` list is NOT a 404**, unlike the sketch's empty scene
   * list below. Most articles have no chronology, so a timeline with nothing in
   * it is the expected answer for them and the panel has a sentence for it —
   * `SHAPE.timeline` in src/store/artifacts.ts makes the same call and says why.
   * A 404 here would send the reader to a POST that pays for the same empty
   * answer again on every open.
   */
  async loadTimeline(slug: string): Promise<TimelineFound> {
    requireSlug(slug);
    const found = await currentRevision(slug, "timeline");
    if (!found) throw notFound(slug);

    const timeline = found.revision.timeline as Timeline | null;
    if (!timeline) {
      throw Object.assign(
        new Error(
          `No timeline for "${slug}" yet. Build one with ` +
            `POST /api/jobs { "slug": "${slug}", "steps": ["timeline"] }.`,
        ),
        { status: 404 },
      );
    }
    const blocks = await blockHashInputs(found.revision.id);
    const tree = found.revision.tree as Tree | null;
    return {
      timeline,
      stale:
        !tree ||
        timelineIsStale(timeline, blocks, tree, datedMetaFingerprintOf(found.revision)),
      outdated: timeline.version !== TIMELINE_PROMPT_VERSION,
    };
  },

  /**
   * The quiz on its own — the Postgres half of `loadQuiz`.
   *
   * Three inputs like `loadIdeas` above and the same **cited** head, because
   * this stage sends `articleWithIds`: the fingerprint covers the tree and the
   * metadata as well as the blocks, so comparing only the blocks here would
   * call a re-sectioned or renamed article's questions current while the
   * filesystem store called them stale.
   *
   * **A 404 is the ordinary case**, like the sketch below and unlike the
   * timeline above: `quiz` is off `DEFAULT_INGEST_STEPS`, so most articles have
   * never had questions written, and the panel's job on a 404 is to offer the
   * button rather than to report a failure. An artefact with an EMPTY
   * `questions` list cannot exist — `buildQuiz` throws rather than write one
   * (`SHAPE.quiz`, src/store/artifacts.ts) — so there is no third state here.
   */
  async loadQuiz(slug: string): Promise<QuizFound> {
    requireSlug(slug);
    const found = await currentRevision(slug, "quiz");
    if (!found) throw notFound(slug);

    const quiz = found.revision.quiz as Quiz | null;
    if (!quiz) {
      throw Object.assign(
        new Error(
          `No quiz for "${slug}" yet. Build one with ` +
            `POST /api/jobs { "slug": "${slug}", "steps": ["quiz"] }.`,
        ),
        { status: 404 },
      );
    }
    const blocks = await blockHashInputs(found.revision.id);
    const tree = found.revision.tree as Tree | null;
    return {
      quiz,
      // Unknown counts as stale, the same way round as its neighbours.
      stale: !tree || quizIsStale(quiz, blocks, tree, citedMetaFingerprintOf(found.revision)),
      outdated: quiz.version !== QUIZ_PROMPT_VERSION,
    };
  },

  /**
   * The debate on its own — the Postgres half of `loadDebate`.
   *
   * Three inputs like `loadQuiz` above and the same **cited** head, because
   * pass B sends `articleWithIds`: the fingerprint covers the tree and the
   * metadata as well as the blocks, so comparing only the blocks here would
   * call a re-sectioned or re-addressed article's debate current while the
   * filesystem store called it stale.
   *
   * **A 404 is the ordinary case**, like the quiz above: `debate` is off
   * `DEFAULT_INGEST_STEPS`, so most articles have never had one.
   *
   * **But two EMPTY groups are a 200**, unlike the sketch's empty scene list
   * below and like the timeline's empty event list: most pieces have no critical
   * reception at all, so an artefact that honestly says so is the commonest
   * correct answer and the panel has a sentence for it. A 404 here would send
   * the reader to a POST that pays up to $0.27 for the same answer on every
   * open. `SHAPE.debate` (src/store/artifacts.ts) makes the same call.
   */
  async loadDebate(slug: string): Promise<DebateFound> {
    requireSlug(slug);
    const found = await currentRevision(slug, "debate");
    if (!found) throw notFound(slug);

    const debate = found.revision.debate as Debate | null;
    /* **The shape as well as the presence** — `isDebateDocument`, the same
       question `SHAPE.debate` and `readDebate` ask (Sol's F29). This served any
       non-null JSONB unchecked until 2026-09-05, so a half-written document
       reached the panel here and was refused on the filesystem. */
    if (!debate || !isDebateDocument(debate)) {
      throw Object.assign(
        new Error(
          `No debate for "${slug}" yet. Build one with ` +
            `POST /api/jobs { "slug": "${slug}", "steps": ["debate"] }.`,
        ),
        { status: 404 },
      );
    }
    const blocks = await blockHashInputs(found.revision.id);
    const tree = found.revision.tree as Tree | null;
    return {
      debate,
      // Unknown counts as stale, the same way round as its neighbours.
      stale: !tree || debateIsStale(debate, blocks, tree, citedMetaFingerprintOf(found.revision)),
      outdated: debate.version !== DEBATE_PROMPT_VERSION,
    };
  },

  /**
   * The Sketch picture on its own — the Postgres half of `loadSketch`.
   *
   * Three inputs like `loadIdeas` above, and the same reason for the third: the
   * fingerprint covers the tree as well as the blocks, so comparing only the
   * blocks here would call a re-sectioned article's picture current while the
   * filesystem store called it stale.
   */
  async loadSketch(slug: string): Promise<SketchFound> {
    requireSlug(slug);
    const found = await currentRevision(slug, "sketch");
    if (!found) throw notFound(slug);

    const sketch = found.revision.sketch as Sketch | null;
    /* **And a scene list that is empty counts as none**, which is the same hole
       `accept` closes when writing and `readSketchFile` closes on disk. A
       column can hold `{"scenes": []}` — from an import, or from a hand edit —
       and a panel handed that would draw an empty band and report success. */
    if (!sketch || !Array.isArray(sketch.scenes) || sketch.scenes.length === 0) {
      throw Object.assign(
        new Error(
          `No sketch for "${slug}" yet. Draw one with ` +
            `POST /api/jobs { "slug": "${slug}", "steps": ["sketch"] }.`,
        ),
        { status: 404 },
      );
    }
    const blocks = await blockHashInputs(found.revision.id);
    const tree = found.revision.tree as Tree | null;
    return {
      sketch,
      stale: !tree || sketchIsStale(sketch, blocks, tree, citedMetaFingerprintOf(found.revision)),
      outdated: sketch.version !== SKETCH_PROMPT_VERSION,
    };
  },

  /**
   * The Illustrated plates on their own — the Postgres half of
   * `loadIllustrated`. docs/project/diagram.md § Illustrated.
   *
   * **Two artefacts, not one article.** `loadSketch` above compares its scene
   * with the blocks and the tree; this compares its plates with the *scene*,
   * and then asks `loadSketch`'s question about that scene as well. Both halves
   * are needed and they are different facts:
   *
   *  - the Sketch was redrawn, so these plates paint a superseded argument;
   *  - the Sketch was not redrawn but the article moved under it, so these
   *    plates paint an argument that is itself out of date.
   *
   * The panel has one sentence for both, which is right — the offer either way
   * is *paint it again* — but reporting only the first would leave a picture two
   * hops from the article claiming to be current.
   */
  async loadIllustrated(slug: string): Promise<IllustratedFound> {
    requireSlug(slug);
    const found = await currentRevision(slug, "illustrated");
    if (!found) throw notFound(slug);

    const illustrated = found.revision.illustrated as Illustrated | null;
    /* An empty plate list counts as none — the same hole `SHAPE` closes at the
       store boundary and `loadIllustrated` closes on the filesystem. */
    if (!illustrated || !Array.isArray(illustrated.plates) || illustrated.plates.length === 0) {
      throw Object.assign(
        new Error(
          `No illustration for "${slug}" yet. Paint one with ` +
            `POST /api/jobs { "slug": "${slug}", "steps": ["illustrated"] }.`,
        ),
        { status: 404 },
      );
    }
    const sketch = found.revision.sketch as Sketch | null;
    const blocks = await blockHashInputs(found.revision.id);
    const tree = found.revision.tree as Tree | null;
    /* No Sketch at all is stale rather than an error: there is still a picture
       to look at, and "we cannot tell" answers not-current here as everywhere
       else. */
    const stale =
      !sketch ||
      illustratedIsStale(illustrated, sketch) ||
      !tree ||
      sketchIsStale(sketch, blocks, tree, citedMetaFingerprintOf(found.revision));
    return {
      illustrated,
      stale,
      outdated: illustrated.version !== ILLUSTRATED_PROMPT_VERSION,
    };
  },

  /**
   * The arc on its own — the Postgres half, and a read of its own since
   * 2026-08-29, when the arc stopped being built by every ingest.
   *
   * **Four inputs, where `loadIdeas` above needs three.** Blocks and tree for the
   * reason that one gives, and the metadata besides: the arc's prompt carries
   * `TITLE:`, `BY:` and `PUBLISHED IN:` at its head (src/article-prompt.ts), so a
   * changed extracted title is a different question. The revision row stores those three
   * as columns, which is why the `arc` projection selects them — a store that
   * compared only blocks and tree here would call an arc current while the
   * filesystem store called it stale, and two stores disagreeing about staleness
   * is what the parity tests exist to catch.
   *
   * `slug` is not in the fingerprint, so passing the requested one rather than a
   * stored one cannot affect the answer.
   */
  async loadArc(slug: string): Promise<ArcFound> {
    requireSlug(slug);
    const found = await currentRevision(slug, "arc");
    if (!found) throw notFound(slug);

    const arc = found.revision.arc as Arc | null;
    if (!arc) {
      throw Object.assign(
        new Error(
          `No arc for "${slug}" yet. Write one with ` +
            `POST /api/jobs { "slug": "${slug}", "steps": ["arc"] }.`,
        ),
        { status: 404 },
      );
    }
    const blocks = await blockHashInputs(found.revision.id);
    const tree = found.revision.tree as Tree | null;
    return {
      arc,
      stale: !tree || arcIsStale(arc, blocks, tree, metaFingerprintOf(found.revision)),
      outdated: arc.version !== ARC_PROMPT_VERSION,
    };
  },

  /**
   * The image manifest of this reader's own article — see the contract.
   *
   * **A missing article throws `notFound`; a missing manifest is `undefined`.**
   * The two are different answers and the caller has to be able to tell them
   * apart: *not yours, or not there* is a 404 about the article, and *the
   * assets step has never run here* is a 404 about one picture. Collapsing them
   * would tell an owner their article does not exist because a step they have
   * not run yet has not run yet.
   */
  async loadAssets(slug: string): Promise<Assets | undefined> {
    requireSlug(slug);
    const found = await currentRevision(slug, "assets");
    if (!found) throw notFound(slug);
    return (found.revision.assets as Assets | null) ?? undefined;
  },
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgArticleReader: ArticleReader = guardDbStore("reader", rawPgArticleReader);
