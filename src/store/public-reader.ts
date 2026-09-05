/**
 * **Reads for somebody who is not signed in.** A second reader, hardwired to
 * `publicSlug`, and deliberately not the owner's reader with an argument.
 *
 * ## Why not `ArticleReader`, and why no predicate parameter
 *
 * GPT Sol's answer 5, 2026-08-28, and both halves are worth keeping:
 *
 * > Making a public implementation "compatible" invites precisely the fields
 * > being removed.
 *
 * and, on the obvious alternative of one reader taking a `where`:
 *
 * > owned and public predicates have the same Drizzle SQL type; swapping them
 * > compiles and leaks or hides data.
 *
 * So `publicCurrentRevisionQuery` below takes a slug and a projection and
 * **nothing else**. There is no `where`, no `predicate`, no `scope`, no
 * `{ kind: "owned" | "public" }`. The only way to make this reader return a
 * private article is to edit the one `.where(publicSlug(slug))` in this file,
 * which is a change a reviewer can see rather than a call site that compiles.
 *
 * The cost is duplication, and it is the point rather than a regret: the owner
 * reader's mappings are *wrong here on purpose*. It runs the meta through
 * `titleFor()`, so the masthead shows the reader's private rename; its
 * `blocksQuery` selects per-block `note`; its glossary read joins
 * `glossary_lookups`. Every one of those is correct for the owner and is a leak
 * here. The risk the other way — the two drifting — is a local failure that
 * tests catch, not an authorization decision hiding in an argument.
 *
 * ## What this file may import
 *
 * The schema, the connection, `publicSlug`, the sanitiser, and pure helpers.
 * **Not** `src/api.ts`, `src/store/index.ts`, `src/store/pg.ts`, any writer, or
 * anything that can reach the AI gateway — tests/public-imports.test.ts walks
 * the graph from `src/public/routes.ts` and fails if any of those appear.
 * `currentOwnerId` is not in the graph either, and that is the fourth of the
 * four reinforcing boundaries Sol listed: a branded `VerifiedUser` for
 * authenticated dispatch, a public import graph with no owner module, a reader
 * that takes no predicate, and `currentOwnerId()` still throwing as the runtime
 * tripwire.
 *
 * See docs/plans/260827ai-public-read-only-access.md.
 */

import { and, asc, eq, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articleRevisions, articles, comments, revisionBlocks, searchRuns } from "../db/schema.js";
import { headingTitleOf } from "../library-scalars.js";
import { log } from "../log.js";
import { STORAGE_FAILED } from "../messages.js";
import type { PublicArticle, PublicBlock } from "../public-types.js";
import { sanitizeStoredBlocks } from "../sanitize.js";
import { isStale } from "../search-stale.js";
import { hashBlocks } from "../source-hash.js";
import { isSlug } from "../ingest.js";
import { publicSlug } from "./public-slug.js";
import { publicArticle } from "../public/dto.js";

/**
 * What a public reader can be asked for.
 *
 * **Two methods, and only one of them is a route.** Sol's answer 5 sketched six
 * — tweets, glossary and ideas as well — and those became slice 1b of
 * docs/plans/260827ai-public-read-only-access.md, which carried them on the
 * article payload rather than as endpoints of their own. Declaring methods
 * nothing implements would be shapes nobody has checked against a real row,
 * which is the sort of thing that gets believed.
 *
 * A third, `loadMetadata`, was deleted on 2026-09-02 along with its route, its
 * DTO and its projection: the client had stopped calling it in slice 1b, and
 * the one thing left calling it was a deployment checker.
 * docs/plans/260902j-public-read-only-access-audit-and-improvements.md § Cluster B.
 *
 * `loadHead` is not a route either — the stage 2 page function calls it
 * directly — which is why the interface is wider than the inventory.
 */
/**
 * **What a document head is built from — server-side only, never a wire type.**
 *
 * Deliberately not in `src/public-types.ts`, which is the contract with the
 * client. Nothing here is sent to a browser as JSON: it is read by the stage 2
 * function, turned into tags, and thrown away. `canonical` in particular is the
 * article's own address, and a *candidate* rather than a decision — whether any
 * `<link rel="canonical">` is published at all is `safePublicCanonical`'s
 * answer, in src/urls.ts, and the reasons it says no are not this file's
 * business.
 *
 * Keeping it out of `PublicMeta` is the point. A visible "read the original"
 * link is a product decision nobody has made, and if it is ever made it wants
 * its own named and separately sanitised field — not this one having quietly
 * become part of the payload because it was already there.
 */
export interface PublicHead {
  slug: string;
  /**
   * The article's title, its first `<h1>`, or its slug — the same three-step
   * fallback `metaFrom` uses in src/public/dto.ts, because the client sets
   * `document.title` from that one a second after this head is served, and any
   * difference is a tab that changes in front of the reader.
   *
   * Still `string | null` rather than `string`: the type is the shape of a head,
   * and src/public/page-head.ts composes a default one for the 404, 400 and 503
   * paths where there is no article to have a title. `loadHead` itself now
   * always has one.
   */
  title: string | null;
  /** The description, from `root_gist` — already the gist/summary/excerpt fallback. */
  gist: string | null;
  /** The address the fetcher finally landed on. A candidate canonical, unsanitised. */
  canonical: string | null;
}

export interface PublicArticleReader {
  loadArticle(slug: string): Promise<PublicArticle>;
  loadHead(slug: string): Promise<PublicHead>;
}

/**
 * A 404 shaped like every other one here, and the **only** answer a public read
 * has to a slug it cannot serve.
 *
 * Three quite different situations collapse into it, deliberately: there is no
 * such article, there is one and it is private, and there is one and it has no
 * readable revision. Telling them apart would tell a stranger whether a
 * document exists — the same rule that makes a slug you do not own a 404 rather
 * than a 403 (docs/project/auth.md § Whose data is it).
 */
function notShared(slug: string): Error {
  return Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
}

/** The same 400 the owner routes give, so a bad slug reads the same everywhere. */
function requireSlug(slug: string): void {
  if (isSlug(slug)) return;
  throw Object.assign(new Error(`Not a slug: ${JSON.stringify(slug)}`), { status: 400 });
}

/**
 * **Nothing a database said leaves this file**, and this is the local version of
 * the rule [db-errors.ts](db-errors.ts) states at length.
 *
 * It is not `guardDbStore`, and that is about the import graph rather than
 * about disagreeing with it: that module imports `src/chat.ts`,
 * `src/store/jobs.ts` and `src/store/uploads.ts` to recognise their error
 * classes, and the public graph is asserted closed against the writers.
 *
 * It is also narrower on purpose. `guardDbStore` classifies transient failures
 * so a caller can be told to try again; there is nothing here to try again —
 * the whole public surface is a handful of `select`s, and a visitor who reloads
 * has already done the only remedy there is.
 *
 * An error that names its own `status` passes through, because that is this
 * codebase's mark for "I chose this failure and I chose its wording": the 404
 * above and the 400 beside it.
 */
async function scrubbed<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (typeof (err as { status?: number }).status === "number") throw err;
    /* **The class name, never the message**, which is the same discipline
       `guardDbStore` keeps and for the same reason: a failed Drizzle query puts
       every bound parameter into `Error.message`, and pino's redaction matches
       key paths rather than text, so it cannot reach anything written there.
       Here the bound value is only ever a slug — but "only ever" is a fact about
       today's two queries, and this guard is for tomorrow's. */
    log("store").error({ what, err: (err as Error)?.name }, "a public read failed");
    throw Object.assign(new Error(STORAGE_FAILED.message), { status: 500 });
  }
}

/**
 * The title fallback, in SQL — the article's own first `<h1>`.
 *
 * `metaFrom` on the owner side is `title ?? headingTitle ?? slug`, and a public
 * page showing a slug where the owner sees a heading would be a visible
 * divergence for no reason. The article read has the blocks in memory and uses
 * `headingTitleOf`; the head read does not, so it asks Postgres for the one
 * row.
 *
 * **Two chains that arrive at the same value separately, and that is worth
 * keeping.** `scripts/check-public-shell.ts` compares a deployed `<title>`
 * against the article route's `meta.title` precisely because one side of that
 * comparison is this SQL and the other is `headingTitleOf(blocks)`; a single
 * shared expression would have made the check agree with itself.
 *
 * Guarded by a `case`, so it runs for almost no articles: consulted only when
 * nothing stored a title. Without the guard, an article with no `<h1>` at all
 * filters every one of its block rows to find that out.
 *
 * **No `articles.title_override` in the guard**, unlike the owner's version of
 * this expression. That column decides nothing here.
 */
const PUBLIC_HEADING_TITLE = sql<string | null>`case
  when ${articleRevisions.title} is null then (
    select ${revisionBlocks.text} from ${revisionBlocks}
    where ${revisionBlocks.revisionId} = ${articleRevisions.id}
      and ${revisionBlocks.kind} = 'heading'
      and ${revisionBlocks.level} = 1
    order by ${revisionBlocks.ordinal}
    limit 1)
end`;

/**
 * The columns a public **article** read may have.
 *
 * Written out rather than derived, for the reason
 * `REVISION_PROJECTIONS` in [pg.ts](pg.ts) gives: a projection assembled at
 * runtime is opaque to Drizzle, which then types the row as the whole table and
 * stops being able to tell a selected column from an unselected one — which is
 * most of what a projection is for.
 *
 * Read the absences. No `fetched_at`, no `note`, and none of the six PDF
 * provenance columns. `articles.title_override` is not selected either, so there
 * is nothing here for a `titleFor()` to be called on.
 *
 * **`final_url` is selected, since 2026-08-30, and does not reach the wire as
 * itself.** It was held back here with a note saying a visible "read the
 * original" link was a separate product decision; Greg made it — *"Public-readable
 * articles should show their provenance-url to all reader[s]"* — and it wanted
 * *"its own named field rather than this one leaking sideways into a DTO"*, which
 * is what it now has. `publicMeta` in src/public/dto.ts runs the column through
 * `publicSourceUrl` (src/urls.ts) and publishes the result under `PublicMeta.url`;
 * the credential clause that made this column dangerous is enforced there, at the
 * one boundary a reviewer reads, rather than by the column being absent here.
 */
const PUBLIC_PROJECTIONS = {
  article: {
    id: articleRevisions.id,
    title: articleRevisions.title,
    byline: articleRevisions.byline,
    siteName: articleRevisions.siteName,
    lang: articleRevisions.lang,
    excerpt: articleRevisions.excerpt,
    finalUrl: articleRevisions.finalUrl,
    tree: articleRevisions.tree,
    arc: articleRevisions.arc,
    /* **The image manifest, and it is not yet doing anything.** This comment
       used to claim the projection was what stopped a public article
       hot-linking to the publisher. It is not: nothing on the client reads
       `assets`, there is no public asset route, and every image and lazy embed
       on a shared page is still fetched from wherever it was published — the
       audit's finding S3, proved by absence on 2026-09-02 and accepted by Greg.
       What the projection does is put the manifest *within reach* of the
       delivery half, which is Cluster D:
       docs/plans/260902j-public-read-only-access-audit-and-improvements.md,
       stages C, D and E of
       docs/plans/260829b-hosting-the-articles-images.md#delivery. Fix this comment when
       that lands, because then it becomes true. */
    assets: articleRevisions.assets,
    /**
     * **The artefacts slice 1b carries, off the same row.**
     *
     * They are JSONB columns on `article_revisions` — the row this query is
     * already fetching — so a visitor gets the glossary, the ideas, the quotes
     * and the tweet thread for no extra query and no extra round trip.
     * That is the whole of what Greg's "no new endpoints" decision buys, and it
     * is why there is no `PublicArtefactReader` beside this one.
     *
     * Read what is **not** here, because it is a longer list than usual and the
     * absences are the projection. No `glossary_lookups` join, which is what
     * the owner's `loadGlossary` does at the read seam and is the leak this
     * feature was most exposed on. No freshness: `stale` and `outdated` are
     * computed by `isStale` in the writer modules, which the public graph
     * cannot reach at all (tests/public-imports.test.ts) — and a visitor could
     * not act on either, since both mean *the owner might want to regenerate
     * this*. The provenance inside each document — `profileHash`, `guidance`,
     * `generatedAt`, `elapsedMs`, `generator`, `version`, `sourceHash`,
     * `passes` — comes across the wire from Postgres inside the JSONB and is
     * dropped by [dto.ts](../public/dto.ts), which is the one place in this
     * feature where a projection is doing the work rather than the `select`.
     * There is no column-level alternative: a JSONB document is one column.
     */
    glossary: articleRevisions.glossary,
    ideas: articleRevisions.ideas,
    quotes: articleRevisions.quotes,
    tweets: articleRevisions.tweets,
    /* **The sixth, and it is on the same row** — `article_revisions.timeline`
       is a `jsonb` column like the four above it, so a visitor gets the
       timeline for no extra query either.
       docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 1.

       **Leaving a line out of this list is the one silent failure in the whole
       public path**: the value arrives `undefined`, the reader hands `null` to
       the projection, the key is absent, and the article reports itself as
       never having had a timeline. Nothing goes red anywhere.
       tests/public-projection-columns.test.ts is what would. */
    timeline: articleRevisions.timeline,
    /* **The seventh, and the one that cost real money to make.** A visitor sees
       the Sketch the owner already paid for; nothing on their side can start
       another. docs/project/security-map.md § the hazard this section is really
       about. */
    sketch: articleRevisions.sketch,
  },
  /**
   * **Enough to fill in a `<head>`, and deliberately not enough to render.**
   *
   * Stage 2 serves `/read/:slug` from a function that fills in a `<title>`, a
   * description and the `og:*` tags before the bundle loads, so a shared link
   * previews as something. That function must **not** become a second renderer
   * — the moment it produces body HTML we own two reading views — and the
   * cheapest way to hold that line is here: it cannot render a body from this
   * projection because the blocks are not in it.
   * docs/plans/260827ai-public-read-only-access.md § Stage 2.
   *
   * Six values. `title` and `headingTitle` are a pair for the reason
   * `metaFrom` gives — an article whose `<h1>` is its only title still has one.
   * `rootGist` is the description, and it is that column rather than
   * `excerpt` because `deriveLibraryScalars()` already encodes the fallback we
   * want (`root?.gist ?? root?.summary ?? excerpt ?? null`) and its comment says
   * that is what a card wants; a preview card is a card.
   *
   * **`hasBlocks` is not redundant with `hasTree`.** A revision can have a tree
   * and no blocks, which is a page React cannot draw; a head that answered 200
   * there would put a title and a description on a link to a blank screen —
   * worse than no preview, because it is a claim. `loadArticle` refuses that
   * revision by counting the blocks it fetched; this read has no blocks to
   * count, so it asks in SQL. Until 2026-09-02 there was a third read that
   * checked only the tree and served it, and the two bars disagreeing was
   * written down rather than fixed; the disagreement went with the route.
   *
   * `finalUrl` never reaches the wire as-is here either: for a head it is the
   * *candidate* canonical, and `safePublicCanonical` in src/urls.ts decides
   * whether a `<link rel="canonical">` is published at all.
   *
   * **This paragraph used to end by saying the column stays out of `PublicMeta`
   * because a visible "read the original" link was a separate product decision.**
   * Greg made that decision on 2026-08-30, so the article projection above
   * selects the column too — and the two publish it under different policies,
   * which is the point rather than an inconsistency. A canonical is a machine's
   * claim about which document this is and refuses any query string; the
   * reader's link is a person clicking through to the piece and keeps it.
   * src/urls.ts § `publicSourceUrl` weighs the two against each other.
   */
  head: {
    id: articleRevisions.id,
    title: articleRevisions.title,
    headingTitle: PUBLIC_HEADING_TITLE.as("heading_title"),
    rootGist: articleRevisions.rootGist,
    finalUrl: articleRevisions.finalUrl,
    hasTree: sql<boolean>`${articleRevisions.tree} is not null`.as("has_tree"),
    /* `exists`, not a count: the question is whether there is at least one, and
       counting every block of a long article to learn that it is more than zero
       is work the planner can skip only if we do not ask for it. */
    hasBlocks: sql<boolean>`exists (
      select 1 from ${revisionBlocks}
      where ${revisionBlocks.revisionId} = ${articleRevisions.id})`.as("has_blocks"),
  },
} as const;

export type PublicRead = keyof typeof PUBLIC_PROJECTIONS;

/**
 * The query, taking its builder so a test can read **the SQL this server will
 * send** rather than a constant beside it.
 *
 * Same reason as `currentRevisionQuery` and `blockHashQuery` in [pg.ts](pg.ts),
 * and it matters more here: a test comparing projection *objects* to an
 * expected key set proves nothing about whether any query uses them, and the
 * one clause this whole feature rests on — `where publicSlug(slug)` — is only
 * visible in the statement. tests/public-reads.test.ts asserts the generated
 * SQL contains `"visibility" = 'public'` and does not contain `owner_id`.
 *
 * **`articles` is joined but never selected wholesale.** The danger Sol named
 * is a public query that one day does `select({ article: articles })` and picks
 * up `owner_id`, `title_override` and `purpose` in one careless line. Only
 * `slug` comes off that table, and it is the one the caller already knows.
 *
 * **Every public read goes through here, and that is the rule rather than a
 * convenience.** A read that builds its own `select` gets its predicate from
 * itself, and the SQL test goes on reading this helper — which is exactly what
 * happened until 2026-08-28: one read had an inline `select` that said the same
 * thing, so the test passed against a query production never ran, and deleting
 * the real `where publicSlug(slug)` left the whole suite green while a private
 * article was reachable at a public URL. GPT Sol's finding 3.
 */
export function publicCurrentRevisionQuery<K extends PublicRead>(
  db: Pick<ReturnType<typeof getDb>, "select">,
  slug: string,
  read: K,
) {
  return db
    .select({ slug: articles.slug, revision: PUBLIC_PROJECTIONS[read] })
    .from(articles)
    /* The same join the owner read uses, and it carries the same guarantee for
       free: `current_revision_id` only ever points at a published revision, so
       there is no `status` clause to remember here. */
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    .where(publicSlug(slug))
    .limit(1);
}

/**
 * **The two rows a visitor must never be handed**, refused in SQL.
 *
 * Written as a named constant beside the query rather than inline, because
 * these are the whole of stage 3's row-level policy and both were found by GPT
 * Sol in review rather than by anybody writing the feature.
 *
 *  - **`criterion_id is null`.** A comment with a criterion is **referee**
 *    work — a peer reviewer's placement of a passage on a scale — and not a
 *    reading note. src/types.ts § `Comment.criterionId` draws that line
 *    explicitly. Leaving `criterionId` and `valence` out of the DTO does *not*
 *    make the row a reading note; it publishes the body of a peer review with
 *    its context stripped off, which is worse than publishing it whole. The
 *    row goes.
 *  - **`status in ('none','done')`.** `none` is a bare bookmark, which is a
 *    finished and very common state; `done` has an answer. `pending` and
 *    `error` are a model call in flight or failed, and publishing one without
 *    its `error`, its retry and its polling leaves a visitor an item that is
 *    permanently blank with nothing saying why.
 *
 * **In the `where` and not in the projection**, for the reason this whole file
 * exists: a filter in a `map` is one satisfied typechecker away from being
 * widened, and a row that was never selected has to be put back on purpose.
 */
const PUBLIC_COMMENTS_WHERE = sql`${comments.criterionId} is null and ${comments.status} in ('none','done')`;

/**
 * **A public article's comments — its own query, never the owner's reader.**
 *
 * The obvious implementation was to resolve the article id and hand it to
 * `listFor(articleId)` in src/store/pg-comments.ts, and GPT Sol blocked it,
 * 2026-09-04. Two reasons, and the second is the one that matters:
 *
 *  - that method is an unrestricted `.select()` that maps every operational
 *    column — `model`, `error`, `searches`, the lease — so the allowlist would
 *    be the DTO alone, in a file that is not this one;
 *  - **"obtain an article id, then read a child table by id" is the escape
 *    hatch tests/public-imports.test.ts exists to close.** That test keeps
 *    `comments`, `chat_messages` and `search_runs` out of the public graph's
 *    table allowlist, and it was written after somebody demonstrated the hole
 *    in six lines. Widening it silently would be exactly the move it watches
 *    for; widening it *deliberately*, with this comment as the reason, is the
 *    sanctioned version.
 *
 * So: named columns, a join back to `articles`, and **`publicSlug` repeated in
 * this query's own `where`**. A naked `articleId` is not authority — there is
 * no moment here where the article's visibility is taken on trust from an
 * earlier statement.
 *
 * Ordered like the owner's read (`created_at`, then `id`) so a visitor and the
 * owner see one list in one order.
 */
export function publicCommentsQuery(
  db: Pick<ReturnType<typeof getDb>, "select">,
  slug: string,
) {
  return db
    .select({
      id: comments.id,
      blockId: comments.blockId,
      quote: comments.quote,
      start: comments.start,
      createdAt: comments.createdAt,
      body: comments.body,
      answer: comments.answer,
      citations: comments.citations,
    })
    .from(comments)
    .innerJoin(articles, eq(articles.id, comments.articleId))
    .where(and(publicSlug(slug), PUBLIC_COMMENTS_WHERE))
    .orderBy(asc(comments.createdAt), asc(comments.id));
}

/**
 * **Finished runs only**, and the same argument `PUBLIC_COMMENTS_WHERE` makes
 * one screen up.
 *
 * A `pending` run is a model call still in flight and an `error` one is a call
 * that failed. Neither is an answer, and a visitor can do nothing about either:
 * the owner's panel offers a spinner and a retry button, and both of those are
 * spend. Published without them, an unfinished run is a row that says nothing
 * and never will.
 *
 * **In the `where` rather than in a `map`**, because a filter in a projection is
 * one satisfied typechecker away from being widened, and a row that was never
 * selected has to be put back on purpose.
 */
const PUBLIC_SEARCHES_WHERE = sql`${searchRuns.status} = 'done'`;

/**
 * **A public article's saved searches — its own query, never the owner's
 * reader**, for the two reasons `publicCommentsQuery` gives above and does not
 * repeat: the owner's `list` maps every operational column, and *"obtain an
 * article id, then read a child table by id"* is the exact escape hatch
 * tests/public-imports.test.ts exists to close. So: named columns, a join back
 * to `articles`, and **`publicSlug` repeated in this query's own `where`**.
 *
 * **`sourceHash` is selected and does not cross.** It is what
 * `isStale` compares against the fingerprint of the blocks in this same
 * payload, and the caller turns the answer into `PublicSearchRun.stale`. That
 * is the one column here whose presence in the `select` is not a promise about
 * the wire — see the mapping in `loadArticle`, which is where it stops.
 *
 * Ordered like the owner's read, so a visitor and the owner see one list in one
 * order.
 */
export function publicSearchesQuery(
  db: Pick<ReturnType<typeof getDb>, "select">,
  slug: string,
) {
  return db
    .select({
      id: searchRuns.id,
      criterion: searchRuns.criterion,
      hits: searchRuns.hits,
      colour: searchRuns.colour,
      createdAt: searchRuns.createdAt,
      sourceHash: searchRuns.sourceHash,
    })
    .from(searchRuns)
    .innerJoin(articles, eq(articles.id, searchRuns.articleId))
    .where(and(publicSlug(slug), PUBLIC_SEARCHES_WHERE))
    .orderBy(asc(searchRuns.createdAt), asc(searchRuns.id));
}

/**
 * A public article's blocks — **and `note` is not selected**, rather than
 * projected away afterwards.
 *
 * Sol's wording, 2026-08-28: *"projecting it away after selecting it is weaker
 * than never fetching it."* It is weaker in a specific way: a projection is one
 * `map` away from being widened by somebody satisfying a typechecker, while a
 * column that was never in the `select` has to be put back on purpose.
 *
 * `fts` is absent for the reason the owner's query gives — a generated tsvector
 * roughly half the size of the text it indexes, queried with `@@` and never
 * selected. `order by ordinal`, because block ids are random and carry no
 * position, so without it the article comes back in whatever order the planner
 * likes: right in development, reordered in production.
 */
export function publicBlocksQuery(
  db: Pick<ReturnType<typeof getDb>, "select">,
  revisionId: string,
) {
  return db
    .select({
      blockId: revisionBlocks.blockId,
      tag: revisionBlocks.tag,
      kind: revisionBlocks.kind,
      level: revisionBlocks.level,
      text: revisionBlocks.text,
      words: revisionBlocks.words,
      html: revisionBlocks.html,
      gistable: revisionBlocks.gistable,
      /* All three cross, and `noteId` in particular is not optional: the hover
         preview has to render a note's whole *range*, and without an identity
         it has only "the block the marker landed on" to show. None of the three
         is about a person or about our pipeline — they are what the article
         is. docs/plans/260828o-footnotes.md, the stage-5 trap. */
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


export const pgPublicReader: PublicArticleReader = {
  async loadArticle(slug: string): Promise<PublicArticle> {
    requireSlug(slug);
    return scrubbed("article", async () => {
      const db = getDb();
      const [found] = await publicCurrentRevisionQuery(db, slug, "article");
      if (!found) throw notShared(slug);

      const rows = await publicBlocksQuery(db, found.revision.id);
      const tree = found.revision.tree;
      /* A revision with no tree, or with no blocks, is not a readable article —
         the same bar both owner readers set. A public 404 rather than a page
         with nothing on it. */
      if (!tree || !rows.length) throw notShared(slug);

      /* The same sanitiser pass the owner read makes, and for a sharper reason:
         this HTML is a third party's, extracted by us, and it is about to be
         served to somebody who never chose to trust either of us.
         `undefined` for the stamp because there is no column to keep one in,
         and absent reads as stale, which cleans — the safe direction.
         docs/project/security.md § There are two stores. */
      const blocks = sanitizeStoredBlocks(
        rows.map(
          (row): PublicBlock => ({
            id: row.blockId,
            tag: row.tag,
            /* The one cast, and the same one the owner reader makes: `kind` is a
               `text` column with a CHECK on it, so Postgres guarantees the value
               and TypeScript cannot see the guarantee. */
            kind: row.kind as PublicBlock["kind"],
            /* Conditional spreads, because `exactOptionalPropertyTypes` is on:
               Postgres hands back `null` where the shape simply has no key. */
            ...(row.level === null ? {} : { level: row.level }),
            text: row.text,
            words: row.words,
            html: row.html,
            gistable: row.gistable,
            /* The same cast `kind` gets, and for the same reason: `role` and
               `treatment` are `text` columns with a CHECK on them, so Postgres
               guarantees the value and TypeScript cannot see the guarantee. */
            ...(row.role === null ? {} : { role: row.role as NonNullable<PublicBlock["role"]> }),
            ...(row.treatment === null
              ? {}
              : { treatment: row.treatment as NonNullable<PublicBlock["treatment"]> }),
            ...(row.noteId === null ? {} : { noteId: row.noteId }),
            ...(row.contextId === null || row.contextType === null
              ? {}
              : { context: { id: row.contextId, type: row.contextType as "callout" } }),
          }),
        ),
        undefined,
      ).blocks;

      /* **A second statement, and it re-asks the visibility question rather
         than inheriting the answer.** `publicCommentsQuery` carries
         `publicSlug` in its own `where`, so nothing here passes an article id
         around as if it were a permission. The cost is one more round trip on a
         public article load, which is the trade the single-payload design
         makes: docs/plans/260904c-more-modes-on-a-shared-link.md § The one
         architectural call, where the measurement it owes is also written down.

         Awaited after the blocks rather than beside them, deliberately: an
         article that fails the tree-and-blocks bar below is a 404, and there is
         no point reading anybody's comments for a page that will not be
         served. */
      const commentRows = await publicCommentsQuery(db, slug);
      const searchRows = await publicSearchesQuery(db, slug);

      /**
       * **The article's fingerprint, from the rows this read already has.**
       *
       * `hashBlocks` (src/source-hash.ts) over `rows` — not over `blocks`,
       * which have been through the sanitiser, and not over a second query.
       * Three things make the two agree, and all three have to hold or every
       * saved search silently reports itself stale:
       *
       *  1. `sourceHashQuery` in pg.ts hashes `revision_blocks` for
       *     `articles.current_revision_id`, and `publicBlocksQuery` above
       *     fetches `revision_blocks` for the current revision. The same rows.
       *  2. Both order by `ordinal`, and the hash is order-sensitive.
       *  3. Both feed it `id`, `text`, `role`, `treatment` — the four fields
       *     `BlockFingerprint` names, and no others.
       *
       * The failure this can have is one-directional and quiet: get it wrong
       * and every run wears *older version*, which reads as a fact about the
       * article rather than as a bug. So the test that covers it asserts a run
       * whose hash matches comes back **not** stale — the positive control,
       * without which a derivation hardwired to `true` passes.
       */
      const current = rows.length
        ? hashBlocks(
            rows.map((row) => ({
              id: row.blockId,
              text: row.text,
              role: row.role,
              treatment: row.treatment,
            })),
          )
        : undefined;

      return publicArticle({
        slug: found.slug,
        title: found.revision.title,
        byline: found.revision.byline,
        siteName: found.revision.siteName,
        lang: found.revision.lang,
        excerpt: found.revision.excerpt,
        headingTitle: headingTitleOf(blocks),
        finalUrl: found.revision.finalUrl,
        blocks,
        tree,
        arc: found.revision.arc,
        assets: found.revision.assets,
        glossary: found.revision.glossary,
        ideas: found.revision.ideas,
        quotes: found.revision.quotes,
        tweets: found.revision.tweets,
        timeline: found.revision.timeline,
        sketch: found.revision.sketch,
        /* `null` columns become absent keys, exactly as the artefacts do — the
           mapping is here rather than in the DTO because Drizzle hands back
           `null` and `Comment` says `undefined`. */
        comments: commentRows.map((row) => ({
          id: row.id,
          blockId: row.blockId,
          quote: row.quote,
          start: row.start,
          createdAt: row.createdAt.toISOString(),
          ...(row.body === null ? {} : { body: row.body }),
          ...(row.answer === null ? {} : { answer: row.answer }),
          ...(row.citations === null ? {} : { citations: row.citations }),
          /* Required by `Comment` and constant by construction: the query
             refuses every other value (PUBLIC_COMMENTS_WHERE), and the public
             DTO drops the field. Written out rather than cast so that a change
             to the predicate has somewhere obvious to disagree. */
          status: "done" as const,
        })),
        searches: searchRows.map((row) => ({
          id: row.id,
          criterion: row.criterion,
          hits: row.hits,
          createdAt: row.createdAt.toISOString(),
          ...(row.colour === null ? {} : { colour: row.colour }),
          /* **Where `sourceHash` stops.** It was selected so that this line
             could ask the question; what leaves the server is the answer.
             `isStale` is the same function the owner's panel calls, which is
             what stops two definitions of *current* existing at once —
             src/search-stale.ts says why it is a module of its own. */
          stale: isStale(
            { ...(row.sourceHash === null ? {} : { sourceHash: row.sourceHash }) },
            current,
          ),
          /* Required by `SearchRun` and constant by construction: the query
             refuses every other value (PUBLIC_SEARCHES_WHERE), and the public
             DTO drops the field. Written out rather than cast, so that a change
             to the predicate has somewhere obvious to disagree. */
          status: "done" as const,
        })),
      });
    });
  },

  /**
   * The six values a `<head>` is filled in from, and the **two** bars a slug
   * has to clear to get them.
   *
   * `hasTree` is the bar the article read uses too. `hasBlocks` is the one this
   * read adds in SQL, and it is not belt-and-braces: a revision with a tree and
   * no blocks is a page React cannot draw, and answering 200 here would put a
   * title and a description on a link to a blank screen — worse than no
   * preview, because a preview is a claim. GPT Sol, 2026-08-29. `loadArticle`
   * clears the same bar a different way, by refusing the blocks it fetched when
   * there are none; this read never fetches them, which is the point of the
   * projection, so it has to ask.
   *
   * **The same `notShared` for all of it**, so a private slug, an absent one and
   * a broken revision are one answer here exactly as they are everywhere else in
   * this file. The head is a new surface and it must not become the one place a
   * stranger can tell those apart — a 404 whose `<title>` differs is as much of
   * a disclosure as a 403.
   */
  async loadHead(slug: string): Promise<PublicHead> {
    requireSlug(slug);
    return scrubbed("head", async () => {
      const db = getDb();
      const [found] = await publicCurrentRevisionQuery(db, slug, "head");
      if (!found) throw notShared(slug);
      if (!found.revision.hasTree || !found.revision.hasBlocks) throw notShared(slug);

      return {
        slug: found.slug,
        /* **The slug is the last resort, and it is not optional.** `metaFrom`
           in src/public/dto.ts is `title ?? headingTitle ?? slug`, and that is
           the value React assigns to `document.title` a second after this head
           was served. Without the third link the two chains disagree for an
           article with neither a title nor an `<h1>`: the tab said
           `Untitled · Spideryarn` and then changed to the slug in front of the
           reader. GPT Sol found it, 2026-08-30; the fixture that can reach it is
           `a public article with neither a title nor an <h1>` in
           tests/public-visibility-pg.test.ts, and there was none before, which
           is why nothing caught it.

           `??` and not `||`: an empty-string title is not a title, but neither
           is it the *absence* of one, and the heading fallback is already `null`
           when there is no `<h1>` — so `||` would turn "" into null twice over
           and hide which of the two the row actually has. The composer clamps
           and escapes; deciding what is missing is this file's job. */
        title: found.revision.title ?? found.revision.headingTitle ?? found.slug,
        gist: found.revision.rootGist,
        canonical: found.revision.finalUrl,
      };
    });
  },
};
