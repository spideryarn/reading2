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
 * See docs/plans/public-read-only-access.md.
 */

import { asc, eq, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articleRevisions, articles, revisionBlocks } from "../db/schema.js";
import { headingTitleOf } from "../library-scalars.js";
import { log } from "../log.js";
import { STORAGE_FAILED } from "../messages.js";
import type { PublicArticle, PublicBlock, PublicMetadata } from "../public-types.js";
import { sanitizeStoredBlocks } from "../sanitize.js";
import { isSlug } from "../ingest.js";
import { publicSlug } from "./public-slug.js";
import { publicArticle, publicMetadata } from "../public/dto.js";

/**
 * What a public reader can be asked for.
 *
 * **Two methods, because two endpoints landed.** Sol's answer 5 sketched six —
 * tweets, glossary, summaries and ideas as well — and those are slice 1b of
 * docs/plans/public-read-only-access.md, along with their DTOs and their tests.
 * Declaring four methods nothing implements would be four shapes nobody has
 * checked against a real row, which is the sort of thing that gets believed.
 */
export interface PublicArticleReader {
  loadArticle(slug: string): Promise<PublicArticle>;
  loadMetadata(slug: string): Promise<PublicMetadata>;
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
 * `headingTitleOf`; the metadata read does not, so it asks Postgres for the one
 * row.
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
 * Read the absences. No `final_url` (the post-redirect URL, which can carry
 * credentials), no `fetched_at`, no `note`, and none of the six PDF provenance
 * columns. `articles.title_override` is not selected either, so there is
 * nothing here for a `titleFor()` to be called on.
 */
const PUBLIC_PROJECTIONS = {
  article: {
    id: articleRevisions.id,
    title: articleRevisions.title,
    byline: articleRevisions.byline,
    siteName: articleRevisions.siteName,
    lang: articleRevisions.lang,
    excerpt: articleRevisions.excerpt,
    tree: articleRevisions.tree,
    arc: articleRevisions.arc,
    /* **The image manifest, and this is the half of the feature that is easy to
       leave out.** Signed-out and non-owning readers cannot reach an
       authenticated route at all, so an owner-only projection would leave every
       public article hot-linking to the publisher — the privacy leak this whole
       feature exists to close, happening on exactly the page we invite
       strangers to, while looking finished from the owner's chair.
       docs/plans/hosting-the-articles-images.md#delivery. */
    assets: articleRevisions.assets,
    /**
     * **The four artefacts slice 1b carries, off the same row.**
     *
     * They are JSONB columns on `article_revisions` — the row this query is
     * already fetching — so a visitor gets the glossary, the summaries, the
     * ideas and the tweet thread for no extra query and no extra round trip.
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
    summary: articleRevisions.summary,
    ideas: articleRevisions.ideas,
    tweets: articleRevisions.tweets,
  },
  /**
   * **Five booleans and a title, and not one document.**
   *
   * `is not null` in SQL rather than reading the JSONB and comparing it here.
   * The metadata page asks whether a glossary exists, not how many terms are in
   * it, and the owner's shelf spent two days dragging every artefact across the
   * wire to answer exactly that question — docs/plans/library-read-latency.md.
   * This one starts on the right side of that.
   */
  metadata: {
    id: articleRevisions.id,
    title: articleRevisions.title,
    /**
     * **In the projection, so that the one query helper can serve both reads.**
     *
     * It is not a column of `article_revisions`, and on the owner's side that
     * would matter — `REVISION_READ_POLICY` in [pg.ts](pg.ts) is keyed by that
     * table's columns and asserted exhaustive against it, so `listArticles`
     * has to carry its own heading-title expression *beside* the projection
     * rather than inside it. There is no such policy here, so there is nothing
     * to make an exception in, and putting it here is what lets `loadMetadata`
     * go through `publicCurrentRevisionQuery` like the article read does.
     *
     * That mattered more than it looks. Until 2026-08-28 `loadMetadata` built
     * its own inline `select` and the SQL test exercised the helper — so the
     * test passed against a query production never ran, and deleting the real
     * `where publicSlug(slug)` left the whole suite green while a private
     * article's metadata was reachable at a public URL. GPT Sol's finding 3.
     */
    headingTitle: PUBLIC_HEADING_TITLE.as("heading_title"),
    hasTree: sql<boolean>`${articleRevisions.tree} is not null`.as("has_tree"),
    hasArc: sql<boolean>`${articleRevisions.arc} is not null`.as("has_arc"),
    hasTweets: sql<boolean>`${articleRevisions.tweets} is not null`.as("has_tweets"),
    hasGlossary: sql<boolean>`${articleRevisions.glossary} is not null`.as("has_glossary"),
    hasSummary: sql<boolean>`${articleRevisions.summary} is not null`.as("has_summary"),
    hasIdeas: sql<boolean>`${articleRevisions.ideas} is not null`.as("has_ideas"),
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
         is. docs/plans/footnotes.md, the stage-5 trap. */
      role: revisionBlocks.role,
      treatment: revisionBlocks.treatment,
      noteId: revisionBlocks.noteId,
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
          }),
        ),
        undefined,
      ).blocks;

      return publicArticle({
        slug: found.slug,
        title: found.revision.title,
        byline: found.revision.byline,
        siteName: found.revision.siteName,
        lang: found.revision.lang,
        excerpt: found.revision.excerpt,
        headingTitle: headingTitleOf(blocks),
        blocks,
        tree,
        arc: found.revision.arc,
        assets: found.revision.assets,
        glossary: found.revision.glossary,
        summary: found.revision.summary,
        ideas: found.revision.ideas,
        tweets: found.revision.tweets,
      });
    });
  },

  async loadMetadata(slug: string): Promise<PublicMetadata> {
    requireSlug(slug);
    return scrubbed("metadata", async () => {
      const db = getDb();
      /* **Through the same helper the article read uses**, which is the whole
         of GPT Sol's finding 3: this was an inline `select` that happened to say
         the same thing, so the test that reads the generated SQL was reading a
         query nothing ran. One `where publicSlug(slug)` in this file, exercised
         by tests/public-reads.test.ts, reached by both reads. */
      const [found] = await publicCurrentRevisionQuery(db, slug, "metadata");
      if (!found) throw notShared(slug);
      /* Same bar as the article read, and it has to be the same: a metadata page
         for an article whose own page is a 404 is a page about nothing. */
      if (!found.revision.hasTree) throw notShared(slug);

      return publicMetadata({
        slug: found.slug,
        title: found.revision.title,
        headingTitle: found.revision.headingTitle,
        available: {
          arc: found.revision.hasArc,
          tweets: found.revision.hasTweets,
          glossary: found.revision.hasGlossary,
          summary: found.revision.hasSummary,
          ideas: found.revision.hasIdeas,
        },
      });
    });
  },
};
