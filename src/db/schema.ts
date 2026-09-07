/**
 * The Postgres schema, as TypeScript.
 *
 * Written ahead of the storage contracts (step 3 of
 * docs/plans/260825f-postgres-migration.md) because it is the artefact everything else
 * is judged against. **These tables are live for both reads and writes**: src/store/pg.ts
 * serves the reading view and the library out of them, src/store/pg-comments.ts
 * writes to them, and a pipeline job commits its steps straight into a draft
 * revision here instead of writing `data/<slug>/*.json` — there is no importer
 * keeping the two in step any more (docs/project/database.md).
 * docs/plans/260826e-postgres-storage-implementation.md tracks the rest of the cutover.
 *
 * Two rules that outrank convenience, both from docs/project/block-ids.md:
 *
 * 1. **A block id is an identity; a block's text is a revision.** That is why
 *    `blockIdentities` exists separately from `revisionBlocks`, and why a row
 *    is never deleted from it. A re-extraction that drops a paragraph must not
 *    destroy the reader's question about it — src/web/comment-nav.ts keeps such
 *    comments deliberately, and an earlier draft of this schema would have made
 *    that impossible.
 * 2. **Block ids are unique only WITHIN an article.** Every key that touches one
 *    is composite on `(articleId, blockId)`. A global unique index starts
 *    rejecting valid rows at roughly a hundred articles; a global upsert
 *    silently overwrites one article's paragraph with another's. Nobody may
 *    "tidy" these into single-column keys.
 *
 * What is deliberately NOT here, and lives in a `drizzle-kit generate --custom`
 * migration instead:
 *
 * - **Foreign keys into `auth.users`.** Declaring Supabase's table here would
 *   invite migration generation to treat an Auth-owned object as ours to manage
 *   — and dropping it is not a mistake we would get to undo. `ownerId` is a
 *   plain `uuid not null`; the FK is added by hand.
 * - **Roles and grants.** The `spideryarn` schema is never exposed through the
 *   Data API; a dedicated least-privilege runtime role is.
 *
 * Drizzle's snapshot does not know about that companion migration, so a future
 * generated migration that drops and recreates one of these tables can lose the
 * Auth FK silently. The guard is tests/db-schema.test.ts, which queries
 * `pg_constraint` and asserts the FKs are still there. See
 * docs/plans/260825f-postgres-migration.md#the-client-drizzle-for-data-supabase-for-auth.
 */

import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { ID_PATTERN } from "../ids.js";
import type { Assets } from "../assets.js";
/* Referee mode's stored result shape. It lives in src/referee-criteria.ts
   rather than src/types.ts because the validator that guarantees it is in the
   same file, and the two are one decision — see that file's header. */
import type { RefereeResult } from "../referee-criteria.js";
/* Referee mode's second sub-mode, and the same reasoning as the line above: the
   shape and the validator that guarantees it live together in
   src/referee-claims.ts. */
import type { Claim } from "../referee-claims.js";
import type { Sketch } from "../sketch-scene.js";
import type { Illustrated } from "../illustrated-plate.js";
import type { LabelsFile } from "../labels.js";
import type {
  Arc,
  Citation,
  Debate,
  FeedbackDiagnosticsPayload,
  Glossary,
  Ideas,
  JobStep,
  NavLabelStatus,
  Quiz,
  Quotes,
  SearchHit,
  Timeline,
  ToolRun,
  Tree,
  TweetThread,
} from "../types.js";

export const spideryarn = pgSchema("spideryarn");

/**
 * Drizzle 0.45 has no `bytea` column type — checked, not assumed. The plan said
 * it did, on a review's say-so.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * Postgres's own full-text type. Drizzle has no `tsvector` either.
 *
 * Typed as `string` because that is what `pg` hands back, and because **nothing
 * in TypeScript should ever read this column**. It exists to be matched against
 * with `@@` and ranked with `ts_rank_cd` inside SQL; selecting it would ship a
 * lexeme dump to the client. See src/store/pg-shelf.ts.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/**
 * The id format, as a database constraint — **taken from `ID_PATTERN` rather
 * than written out again.**
 *
 * The first version of this file hand-copied the regex and got it wrong in
 * three ways: it accepted a digit as the first character, and it accepted `1`
 * anywhere. Both are ids `mintId()` can never produce (`1` is not in the
 * alphabet, and the first character is always a letter so the id is a valid CSS
 * selector without escaping). A CHECK that is too permissive is the worst kind
 * — it passes every test written against real ids and silently admits garbage
 * from anywhere else.
 *
 * Postgres's `~` is POSIX, and `ID_PATTERN` uses only literal character lists
 * and a bounded repeat, which mean the same thing in both flavours.
 *
 * Named for Spideryarn ids in general, not blocks: `src/jobs.ts` mints job ids
 * with the same `mintId()`, so the same constraint applies to them. Two tables
 * sharing one constant is correct here precisely because they share one minter.
 */
const SPIDERYARN_ID_REGEX = ID_PATTERN.source;

/* ------------------------------------------------------------- articles -- */

/**
 * One article, for as long as it exists. `slug` is globally unique because it
 * is the URL contract (`/read/<slug>`), unlike block ids.
 *
 * `currentRevisionId` is an ordinary nullable FK, added in the custom migration
 * because it points at a table declared below this one. It is deliberately NOT
 * deferrable: creation is insert article, insert revision, update pointer, and
 * no intermediate state violates anything. See
 * docs/plans/260825f-postgres-migration.md#the-deferrable-fk-we-talked-ourselves-out-of.
 */
export const articles = spideryarn.table("articles", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** `auth.users(id)`. FK in the custom migration — see the header. */
  ownerId: uuid("owner_id").notNull(),
  slug: text("slug").notNull().unique(),
  /**
   * **The stable handle the slug is only a copy of.**
   *
   * > Yes, let's add a short id — and actually then we could in future allow
   * > users to rename the slug, and redirect/find it from the short id. So make
   * > sure it's globally unique. I'm fine with adding that to all slugs.
   * >
   * > — Greg, 2026-08-31
   *
   * A `spya-k3m9qt` from src/ids.ts, the same shape as a block id, minted with
   * the slug and repeated on the end of it (src/ingest.ts §
   * `slugWithShortId`). Two articles can therefore never want the same name,
   * which is what deleted `freeSlug`'s collision ladder and the whole of
   * `freeUploadSlug`.
   *
   * **A column and not a substring of the slug**, and that is the second half
   * of the decision rather than tidiness: a slug the reader has renamed no
   * longer contains an id, and this is what the rename would redirect through.
   * `slugForShortId` (src/store/find-article.ts) is the lookup; the rename
   * itself is not built.
   *
   * **Nullable, and nothing backfills it.** Every article added before
   * 2026-08-31 keeps the slug it has and has no id — so a lookup by short id
   * is a lookup that can miss, deliberately. Unique because Greg asked for
   * globally unique, and NULLs are distinct in Postgres, so the older rows do
   * not collide with each other. docs/plans/260831b-finish-the-database-move.md
   * § Stage 3 item 0.
   */
  shortId: text("short_id").unique(),
  currentRevisionId: uuid("current_revision_id"),
  createdAt: createdAt(),

  /**
   * **This article is the shipped demo, not something a reader added.**
   *
   * `example/` is a checked-in fixture that the filesystem reader served as an
   * ordinary article, and at cutover it has to
   * exist in Postgres or a fresh clone opens onto an empty shelf. Greg's call
   * on 2026-08-26 was that it **goes in, marked as one** — so the flag is a
   * column rather than a slug the code special-cases, because "is this the
   * demo" is a fact about the row and a hardcoded `slug === "example"` is a
   * fact about a string that anybody may later rename.
   *
   * Not null with a default, so every existing row and every future insert
   * answers the question. Step 13 (docs/plans/260826e-postgres-storage-implementation.md)
   * is what sets it true for exactly one article.
   */
  fixture: boolean("fixture").notNull().default(false),

  /* ---- shelf state: what the reader has done to the card. src/shelf.ts ----
     Columns here rather than a table of their own, because there is exactly one
     row per article and it is per-owner state on a table that already carries
     `owner_id`. A join for five scalars would be ceremony.

     All five are on `articles` and NOT on `article_revisions`, and that is the
     load-bearing part: a revision is one extraction, and re-extracting an
     article must not un-archive it, forget the reader's title, reset the
     count or forget why they are reading it. Reader state outlives revisions —
     the same rule `block_identities` exists to enforce for block ids. */

  /** Set means it is off the shelf. Never a delete; Greg chose archive + Undo. */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  /**
   * The reader's own title, overriding whatever stage 2 extracted.
   *
   * An override rather than an edit of `article_revisions.title`, because that
   * one is rewritten by every re-extraction — so a rename stored there would be
   * silently undone weeks later. src/shelf.ts has the long version.
   */
  titleOverride: text("title_override"),
  opens: integer("opens").notNull().default(0),
  lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
  /**
   * "Why you're reading this one" — the per-article half of
   * docs/plans/260826t-reader-profile.md. The global half ("about you", true on every
   * article) is `reader_profiles` below, keyed by owner rather than by
   * article, because it is not this article's state to lose.
   */
  purpose: text("purpose"),

  /* ---- sharing: may a stranger read this? docs/plans/260827ai-public-read-only-access.md --

     On `articles` rather than on `article_revisions`, and that is a decision
     rather than the nearest column: sharing is about the *document*, not about
     one extraction of it, so a re-extraction must not silently share or
     silently unshare anything. Same rule as the five shelf columns above.

     On `articles` rather than on the shelf PATCH, too. `PATCH /api/library/:slug`
     edits the relationship between a reader and a document; visibility is a
     property of the work. Stage 3 of the plan splits along exactly that line,
     so putting them together now would mean moving the API twice. */

  /**
   * `private` or `public`, and **never `published`**.
   *
   * `article_revisions.status` already has a value called `published` and it
   * means *the pipeline finished*, not *anybody may read this*. Two meanings of
   * one word, two tables apart, is how a mistake gets made at three in the
   * morning — so this column and its values are spelled differently on purpose.
   *
   * `not null default 'private'` plus the CHECK below is fail-closed twice
   * over: a `NULL` cannot be stored, and even if one somehow existed,
   * `visibility = 'public'` would not match it. GPT Sol confirmed that shape,
   * 2026-08-28.
   */
  visibility: text("visibility").notNull().default("private"),
  /**
   * When it was last switched on, or null while it is private.
   *
   * **Not an audit log**, and it cannot be made into one: cleared on unshare it
   * loses the history, kept on unshare it no longer says whether the document
   * is public now. `article_visibility_changes` below is the honest version,
   * and this column is the cheap answer to "how long has this been up" that a
   * card can print without a join.
   */
  publicAt: timestamp("public_at", { withTimezone: true }),
}, (t) => [
  /**
   * Two spellings, and a third is a row every public read silently ignores.
   *
   * The predicate is `visibility = 'public'` (src/store/public-slug.ts), so a
   * typo fails closed — which is the safe direction and also the one nobody
   * notices. The CHECK is what makes it loud instead.
   */
  check("articles_visibility", sql`${t.visibility} in ('private','public')`),
  /**
   * **The shelf's own index, and what makes `limit 200` a bound on work rather
   * than only on rows.**
   *
   * `publicLibraryQuery` (src/store/public-library.ts) is the one query on this
   * table that anybody can run without signing in, and it asks for
   * `visibility = 'public'` ordered by `public_at desc nulls last, slug`. With
   * no index matching that, Postgres filters and **sorts the whole public corpus
   * before applying the limit** — so the ceiling bounds what comes back and not
   * what it cost, on an endpoint with no rate limit and no session. GPT Sol's
   * finding 3 on stage 3a, 2026-09-04.
   *
   * **Partial, on `visibility = 'public'`**, which is the shape that earns its
   * keep here: almost every row in this table is private and will stay private,
   * so a full index would be mostly entries no reader can ever reach, paid for
   * on every write. The predicate is written the same way the query writes it,
   * because a partial index is only used when the planner can prove the query's
   * clause implies the index's.
   *
   * The columns are the `order by`, in its order and its direction — including
   * `nulls last`, which is not the default under `desc` and which the query
   * spells out for its own reasons. Getting either wrong yields an index the
   * planner will not use for the sort, which is the failure that looks like
   * success. `slug` is there because the ordering is deliberately total.
   */
  index("articles_public_listing")
    .on(t.publicAt.desc().nullsLast(), t.slug.asc())
    .where(sql`${t.visibility} = 'public'`),
]);

/**
 * **Who shared this, when, and had they said they were entitled to.**
 *
 * Append-only. One row per *actual transition* — asking to publish an article
 * that is already public writes nothing, because "Alice pressed the button
 * again" is not a fact about the document's history.
 *
 * Landed with the switch itself rather than deferred, on GPT Sol's advice
 * (2026-08-28): the migration and the transaction were being written anyway,
 * and the alternative — `visibility_changed_at` plus `visibility_changed_by` —
 * preserves only the latest act. That is useful operational evidence and it is
 * not history, so it would not be an audit substitute.
 *
 * What it is for is in
 * docs/plans/260827ai-public-read-only-access.md § Rights and takedown: serving a third
 * party's full text from our origin is reproduction, and if a complaint ever
 * arrives the question is *who turned this on, when, and did they confirm they
 * had the right*. `public_at` alone cannot answer it.
 *
 * **`on delete set null`, and NOT the cascade every other child of `articles`
 * has.** That is the one place this table is deliberately unlike its siblings,
 * and it was wrong here for a day.
 *
 * It shipped as `on delete cascade` on 2026-08-28 with the reasoning that a log
 * row naming an article nobody holds any more answers nothing anybody would
 * ask. GPT Sol's finding 2 the same day put it the other way round, and it is
 * right: the log's whole purpose is the complaint that arrives **after** a
 * document is taken down, and cascade erases the record at exactly the moment
 * somebody needs it. *"Who shared this, when, and had they said they were
 * entitled to"* is a question about an article we no longer have.
 *
 * The comment also rested on a claim that was false at the time — *"nothing
 * deletes an article today"*. `src/store/import.ts` deleted orphaned articles,
 * so this was a live loss rather than a choice about a hypothetical path. That
 * importer went on 2026-09-01, and nothing in `src/`, `scripts/` or `api/`
 * deletes an article now — only tests do — so the claim is true again. It
 * changes nothing here: the decision rests on what the log is *for*, not on the
 * current count of deleters, and the next path that removes an article should
 * not have to remember this table.
 *
 * So `article_id` is nullable and the reference clears on delete. Everything
 * that makes the row *evidence* survives without it: the slug that was shared,
 * who shared it, the transition, whether they confirmed the right to, and when.
 * The FK is kept rather than dropped so that a row pointing at a live article
 * still cannot point at a missing one.
 */
export const articleVisibilityChanges = spideryarn.table(
  "article_visibility_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * **Nullable, because the row outlives the article.** See the header: the
     * takedown question is asked about documents we no longer serve, so a log
     * that vanishes with the article answers it in exactly the case it exists
     * for. Null means the article has been deleted, and `slug` below is then
     * the only name the row has.
     */
    articleId: uuid("article_id").references(() => articles.id, { onDelete: "set null" }),
    /**
     * The slug as it stood at the moment of the act.
     *
     * A second copy of something `articles.slug` already holds, deliberately: a
     * log line has to be readable on its own, and the URL that was shared is
     * the thing a complaint will name. `articles.slug` is what the article is
     * called *now* — and after a deletion there is no `articles` row at all, so
     * this is the only name left. **Not null**, unlike `article_id`, for that
     * reason: a row with neither is not evidence of anything.
     */
    slug: text("slug").notNull(),
    /** Who pressed it. The owner, because only the owner can — src/routes.ts. */
    actorOwnerId: uuid("actor_owner_id").notNull(),
    fromVisibility: text("from_visibility").notNull(),
    toVisibility: text("to_visibility").notNull(),
    /**
     * Did they confirm they had the right to share it?
     *
     * True only on a publish that carried `rightsConfirmed: true`, which is the
     * only kind of publish the endpoint accepts. False on every unpublish, and
     * that is honest rather than a gap: nobody is asked to confirm anything to
     * take something down.
     */
    rightsConfirmed: boolean("rights_confirmed").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("article_visibility_changes_from", sql`${t.fromVisibility} in ('private','public')`),
    check("article_visibility_changes_to", sql`${t.toVisibility} in ('private','public')`),
    /** Transitions only. A row saying private → private records nothing. */
    check("article_visibility_changes_moved", sql`${t.fromVisibility} <> ${t.toVisibility}`),
    /** The only question anybody asks of it: this article's history, in order. */
    index("article_visibility_changes_article_at").on(t.articleId, t.at),
  ],
);

/**
 * One extraction of one article. **Immutable in its text** once published.
 *
 * The pipeline builds a *draft* and publishes it in one step, so a reader sees
 * either the previous published revision or the complete new one and never a
 * mixture. src/store/pg-revisions.ts is that lifecycle:
 * `beginRevision` / `publishRevision` / `failRevision`.
 *
 * ## Why "in its text" and not simply "immutable"
 *
 * **Every pipeline job writes its steps into one draft and publishes that draft
 * once.** A job opens a draft (`openOrBeginJobDraft` → `beginDraftIn`, in
 * src/store/pg-revisions.ts), every step of that job writes into *that draft's*
 * row, and a `done` ending publishes it (`publishRevisionIn`, called from
 * src/store/pg-session.ts). `hierarchy`, `arc`, `tweets` and `glossary` take
 * exactly that path, the same as `fetch`, `extract` and `blocks`.
 *
 * **One draft per job, not one per step**, and that distinction is the whole
 * reason `openOrBeginJobDraft` exists rather than `beginRevision`: `advanceJob`
 * runs one step per HTTP request, so a draft minted per step would throw away
 * what the previous step wrote. Its own comment tells that story.
 *
 * What the property is *for* is the sentence below it: a failed re-extraction
 * must not overwrite a good article in place. That is about the **text**, and
 * what earns "in its text" rather than plain "immutable" is exactly one thing:
 * the glossary delete below, which nulls one column of a row that is already
 * published. Nothing else in this table writes a published revision.
 * Publication is the row's *last* change as a draft — `publishRevisionIn` sets
 * `status` and the library scalars and moves `articles.current_revision_id` in
 * one transaction — and `failRevisionIn`'s `UPDATE` names `status = 'draft'` in
 * its `WHERE`, so a published row is out of its reach too.
 *
 * ### This comment said the opposite until 2026-09-03, and two readers believed it
 *
 * It read: *"`hierarchy`, `arc`, `tweets` and `glossary` write their own column
 * onto the revision that is already published, in one `UPDATE`."* True when it
 * was written (docs/plans/260826e § *A new revision only when the text
 * changes*), false from the D1b work onwards, and nothing kept it in step. It
 * then contradicted its own last paragraph, which said `hierarchy` was *not* one
 * of them — and it was still not enough for anybody to check. What made it
 * expensive is that it was cited as a *reason* elsewhere:
 * docs/plans/260903e-glossary-delete-in-postgres.md built its first version on
 * this sentence and had to be sent back. CLAUDE.md § *One source of truth* is
 * about exactly this: a restatement of a fact that lives in the code, going
 * wrong by waiting.
 *
 * docs/project/database.md had it right the whole time — *"A `done` ending
 * publishes the draft"* — so the correction was one file away.
 *
 * **The first replacement was wrong too**, which is worth recording next to the
 * original: it said *"every step mints a revision"* and that a published row's
 * bookkeeping *"still moves after publication"*. Neither is true — one draft
 * serves a whole job, and after publication nothing moves a published row's
 * `status`. GPT Sol caught it on the built code, one review after catching the
 * sentence it replaced.
 *
 * ### The one deliberate exception, which is a reader's and not the pipeline's
 *
 * `pgGlossaryStore.deleteGlossary` (src/store/pg-glossary.ts) **does** update a
 * published revision in place: one `UPDATE` setting `glossary` to NULL, for the
 * glossary panel's *Start again*. Minting a revision to *remove* one JSONB value
 * would copy every `revision_blocks` row of the article to buy nothing a reader
 * could see, and `publishRevision` refuses a revision with no tree and no
 * blocks — so a delete-by-revision would have to carry the whole article forward
 * in order to null one column.
 *
 * It is one method, its own file says so at length, and the price of the
 * exception is written down there too: because the pointer does not move, a
 * draft opened before the delete would publish the copied glossary back over the
 * top, so the delete refuses with a 409 while a live job holds one.
 */
export const articleRevisions = spideryarn.table(
  "article_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    status: text("status").notNull(),

    /**
     * **The revision this one was copied from** — written once, when the draft
     * is minted, and never changed afterwards.
     *
     * `beginDraftIn` copies whichever revision is current at that moment
     * (src/store/pg-revisions.ts), and this column is that value. It is the
     * lineage a publication is checked against: `publishRevisionIn` refuses to
     * move `articles.current_revision_id` off anything but the revision the
     * draft actually saw, so a job that ran for minutes cannot bury a
     * publication that landed while it ran. The check is in the publication
     * primitive rather than in one of its callers, since 2026-09-01 — GPT Sol,
     * finding 1 of docs/plans/260901d-stage3-code-review-sol.md.
     *
     * **It exists because reading the article's current revision instead is not
     * the same question.** A job runs one step per HTTP request and reopens its
     * draft on the next claim, so a draft can be minutes old by the time it
     * publishes; asking the article what it is serving *now* answers with
     * whatever landed in the meantime, which is exactly the value the guard is
     * supposed to catch. It has to be recorded on the row at mint time or it is
     * not recoverable at all. GPT Sol, 2026-08-31, finding 1 of
     * docs/plans/260831b-stage3-items3and4-review-sol.md.
     *
     * **Null means copied from nothing** — an article's first draft — and it is
     * also what a revision minted before 2026-09-01 carries, which the guard
     * then reads as a base that does not match and refuses. Fail-closed is the
     * right direction for a draft whose lineage nobody recorded.
     *
     * `mint` in `REVISION_CARRY_POLICY`, and that classification is the
     * dangerous half of this column: carried, every draft would inherit its
     * parent's base and the guard would compare the wrong pair for ever.
     *
     * `on delete set null` rather than cascade, for the same reason
     * `jobs.draft_revision_id` has it: losing the base must not take the
     * revision with it, and a lineage that has gone reads as "unknown, refuse"
     * rather than as a licence.
     */
    basedOnRevisionId: uuid("based_on_revision_id").references(
      (): AnyPgColumn => articleRevisions.id,
      { onDelete: "set null" },
    ),

    // The identity of the piece, as this extraction saw it — `Meta` in src/types.ts.
    title: text("title"),
    byline: text("byline"),
    siteName: text("site_name"),
    lang: text("lang"),
    excerpt: text("excerpt"),
    /**
     * **`Meta.publishedAt` — `text`, not `timestamp`, and that is the whole
     * decision.**
     *
     * The publisher's own ISO string, verbatim, in the publisher's own frame.
     * `timestamp with time zone` is the obvious choice and it is wrong here:
     * Postgres would normalise it to UTC, and 8pm on 31 December in New York
     * comes back as 1 January. **The calendar day is the entire content of this
     * field** — it is the reference frame the timeline reads a year-less "on
     * July 7" against — so a column that can move it by one is a column that
     * silently mis-dates a row. Same rule as src/timeline-time.ts, which never
     * builds a `Date` for the same reason.
     *
     * `fetched_at` above is a real `timestamp` because it is an instant we
     * recorded; this is a claim somebody else published. The two look alike and
     * are not the same kind of fact — docs/plans/260831i-timeline-mode.md
     * § There is no publication date until stage 2 is taught to keep one.
     *
     * Null on every revision written before 2026-08-31, and it stays null until
     * that article is re-extracted.
     */
    publishedAt: text("published_at"),
    /** `Meta.note`. Real articles carry one — the noema article's meta.json does. */
    note: text("note"),

    /**
     * Stage 1's real output. `requestedUrl` and `finalUrl` differ whenever a
     * fetch redirected, and only `finalUrl` resolves relative links correctly.
     */
    requestedUrl: text("requested_url"),
    finalUrl: text("final_url"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),

    /**
     * The origin's own `Content-Type` header, kept beside the encoding for the
     * reason docs/project/fetching.md gives: the encoding cannot be re-derived
     * later.
     *
     * **`raw_bytes` used to sit above this**, a `bytea` holding the entire
     * fetched document. It was dropped on 2026-09-01
     * (docs/plans/260831b-finish-the-database-move.md § *Stage 4*): the document
     * is a content-addressed object in the `sources` bucket now, named by
     * `raw_source_sha256`/`raw_source_kind` below, and every article in the
     * corpus had been refetched through that reference first.
     */
    rawContentType: text("raw_content_type"),
    rawEncoding: text("raw_encoding"),
    /**
     * SHA-256 of the fetched bytes. Null for everything fetched before
     * `raw.json` existed, and null in a *backfilled* manifest — where only the
     * decoded string survives, and hashing that would answer a different
     * question convincingly. docs/project/fetching.md § `RawManifest`.
     */
    rawSha256: text("raw_sha256"),
    /**
     * **How many bytes the origin sent** — `RawManifest.bytes`, and not the size
     * of anything we kept.
     *
     * A column rather than `length(raw_bytes)`, because `raw_bytes` was dropped
     * on 2026-09-01 and this number had to outlive it — which it now has.
     * `raw_sources.bytes` is not a substitute: that describes the
     * object at `raw_source_sha256`, which for any page that was not already
     * UTF-8 is a *different byte string* — `writeRaw` stores the decoded text,
     * so the stored size and the network size differ for exactly the reason the
     * two hashes do. GPT Sol, 2026-08-28, reviewing that plan.
     *
     * Null for every revision written before this existed, and for one whose
     * manifest never recorded it.
     */
    rawByteCount: integer("raw_byte_count"),
    /**
     * **The reader's own name for an uploaded file** — `RawManifest.filename`.
     *
     * Not `RawManifest.file`, which is `raw.html` or `raw.pdf` and is derived
     * from the kind rather than stored. This is the name the file had on the
     * reader's disk, and it is the name an uploaded PDF should download as, so
     * it is reader-facing and there is nowhere else for it: `origin` is
     * derivable from the two URLs being null and `uploadId` is already on
     * `jobs.upload_id`, but this is homeless.
     * docs/plans/260827aa-delete-the-importer.md § The raw provenance has nowhere to go.
     *
     * Null for a fetched document, which never had one.
     */
    rawFilename: text("raw_filename"),

    /**
     * **Which object in the `sources` bucket this revision's document is.**
     *
     * Two columns rather than one because a key needs the media kind as well as
     * the digest — `canonicalKey(sha, kind)` in src/source.ts — and there is no
     * way to recover the kind from `raw_content_type`, which is *the server's
     * claim*: src/fetch.ts is blunt that a PDF served as `application/octet-stream`
     * is still a PDF and a challenge page served as `application/pdf` is still
     * HTML.
     *
     * **Both or neither**, enforced by `article_revisions_raw_source_both`
     * below, because two nullable columns forming one pointer is a half-pointer
     * waiting to happen — one set and the other null names an object that
     * cannot be addressed, and nothing would say so.
     *
     * Null is a real answer and means **we do not hold the source document**:
     * an article imported before we kept them. It is told apart from *we tried
     * and failed* by `revision_step_runs` — a revision with a successful `fetch`
     * run in its lineage must carry this reference.
     *
     * **That rule is intent, not a guard. Nothing enforces it today**, and this
     * comment said `publishRevision` did until 2026-08-27, which was simply
     * untrue: that function checks blocks, the tree, `checkTree` and the `hierarchy`
     * run, and has never looked at these two columns. Nothing writes them yet
     * either, so the claim was vacuous rather than merely wrong — there is no
     * revision it could have been false about.
     *
     * Writing it down as a fact was the same mistake as the comment in
     * src/store/pg.ts that claimed the ToC guard checked what it did not —
     * docs/postmortems/260827d-toc-status-never-checked.md, found the same day. The
     * rule lands in `reasonsNotToPublish` with the live write path;
     * docs/plans/260827aa-delete-the-importer.md § The publication gate has the full
     * truth table, including the failed-fetch case this sentence omits.
     *
     * Note this is **not** `raw_sha256` above. That one is the hash of what the
     * network sent; this is the hash of what we stored, and for HTML in any
     * encoding but UTF-8 those differ, because `writeRaw` stores the decoded
     * string.
     */
    rawSourceSha256: text("raw_source_sha256"),
    rawSourceKind: text("raw_source_kind"),

    /**
     * **How this revision was extracted, when the answer is not "Readability".**
     *
     * All six are null for a web page and that is the common case — they exist
     * because a PDF is read by a *model*, and a reader is owed the difference.
     * docs/plans/260826c-pdf-ingestion.md.
     *
     * `recall` and `pagesChecked` belong together and must be read together: a
     * mean over one page of seventeen is arithmetically fine and means nothing,
     * which is why a scan records no recall at all rather than the 1.0 its one
     * checkable page would otherwise average to.
     */
    source: text("source"),
    extractMethod: text("extract_method"),
    pages: integer("pages"),
    /**
     * A scan: no text layer existed, so nothing checked the transcription.
     * Deliberately not `verified` with a false value — two machines agreeing
     * would still not be verification, and "verified" is the word a reader
     * would rely on.
     */
    unverified: boolean("unverified"),
    recall: doublePrecision("recall"),
    pagesChecked: integer("pages_checked"),

    extractedHtml: text("extracted_html"),
    /** Post-sanitiser, post-id-stamping. docs/project/security.md — stage 3 owns this. */
    stampedHtml: text("stamped_html"),

    /**
     * Generated wholesale, validated wholesale, replaced wholesale, and no
     * feature owns a tree-node row — so it stays a document. Node ids are
     * regenerated every run and must never become foreign keys.
     * Drizzle does not validate JSONB at runtime: parse at the boundary.
     */
    tree: jsonb("tree").$type<Tree>(),
    /**
     * The WHOLE `Arc`, not just its entries — `version`, `generator` and `slug`
     * travel with it. Storing the entries alone loses the provenance that says
     * which generator wrote them.
     */
    arc: jsonb("arc").$type<Arc>(),
    /**
     * The WHOLE `TweetThread`. Storing `Tweet[]` alone would drop `sourceHash`,
     * and `sourceHash` is the entire reason this feature can say a thread
     * describes an older version of the article — the thing the original
     * version could never answer. It would also drop `limit`, which is what
     * `chars` was counted against. Not a tidy-up: a functional break.
     */
    tweets: jsonb("tweets").$type<TweetThread>(),
    /**
     * The WHOLE `Glossary`, for the same reason as the two above, plus one of
     * its own: `passes` and `elapsedMs` accumulate across calls, so a column
     * holding `GlossaryEntry[]` alone would lose the record of how many model
     * calls built the list — and the "Find more terms" button would have
     * nothing to show for itself.
     *
     * **A document, not an `entries` table**, and that is a real decision
     * rather than the lazy one. Entries are generated wholesale, deduplicated
     * against each other wholesale (src/glossary.ts § `dedupe`), and their
     * `blocks` are recomputed from the current text on every write. A row per
     * entry would invite a foreign key from some future feature onto an id that
     * only survives because dedup happens to preserve it. If a reader ever
     * edits or annotates one, that is the day this becomes a table — and the
     * day entry ids become a promise rather than an implementation detail.
     */
    glossary: jsonb("glossary").$type<Glossary>(),

    /**
     * The propositions a reader has to hold — `Ideas`, stage 5f.
     *
     * The WHOLE artefact, like the four above, and here the reason is the
     * `occurrences`: each one is a block id plus the verbatim quote the model
     * pointed at, validated against `revision_blocks` at generation time. A
     * column holding `Idea[]` without `sourceHash` and `profileHash` could not
     * answer either of the two questions the panel has to ask before drawing
     * anything — has the article moved under these, and were they written for
     * the reader who is looking at them.
     *
     * **No foreign key from an occurrence's `blockId` to `revision_blocks`**,
     * deliberately, and the same argument the glossary makes about entry ids
     * applies from the other end: a re-extraction may drop a paragraph, and an
     * idea that named it should degrade to *"we can no longer find this in the
     * article"* rather than take a delete with it or block one.
     */
    ideas: jsonb("ideas").$type<Ideas>(),

    /**
     * The lines worth keeping, in the article's own words — `Quotes`,
     * src/types.ts, written by the `quotes` step. docs/project/quotes.md.
     *
     * The WHOLE artefact, like its neighbours, and here `sourceHash` earns its
     * place twice over. Every quote carries a `blockId` **we** found rather than
     * one the model named, and it carries `text` that was verified to be in the
     * article at write time — so a re-extraction can invalidate a row in two
     * ways at once: the block may be gone, and the words may no longer be in the
     * piece. A column holding `quotes` without the hash could not answer either
     * question, and the panel would go on offering the author's supposed
     * sentences over an article that no longer contains them.
     *
     * **No foreign key from a quote's `blockId` to `revision_blocks`**, on the
     * same argument the glossary, the ideas and the sketch make: a dropped
     * paragraph should cost that quote its jump rather than take a delete with
     * it or block one.
     */
    quotes: jsonb("quotes").$type<Quotes>(),

    /**
     * When the piece says things happened, in what order, and how sure it is —
     * `Timeline`, src/types.ts, written by the `timeline` step.
     * docs/project/timeline.md.
     *
     * The WHOLE artefact, like its neighbours, and here `sourceHash` is doing
     * something none of theirs does: it covers the **publication date** as well
     * as the blocks and the tree (`datedArticleFingerprint`, src/source-hash.ts,
     * and this is the only stage that uses it). The date is the reference frame
     * for nineteen of the twenty-four temporal expressions on the test article,
     * so a publisher re-dating a post changes almost every row in this column
     * and not one word in any other. A column holding `events` without the hash
     * could not answer whether the dates in it were read against the date the
     * article now claims.
     *
     * **No `profileHash`, unlike `ideas` and `sketch`** — and that is a decision
     * rather than a gap. Who is reading changes what an *idea* is; it does not
     * change when something happened.
     *
     * **No foreign key from an occurrence's `blockId` to `revision_blocks`**, on
     * the same argument the glossary, the ideas, the quotes and the sketch make:
     * a dropped paragraph should cost that event its jump rather than take a
     * delete with it or block one.
     */
    timeline: jsonb("timeline").$type<Timeline>(),

    /**
     * The questions the piece can ask you back — `Quiz`, src/types.ts, written
     * by the `quiz` step. docs/plans/260831al-review-quiz-sub-mode.md.
     *
     * The WHOLE artefact, like its neighbours, and here two of its fields are
     * doing work no other column's do. `sourceHash` is
     * `articleWithIdsFingerprint` — the blocks, the tree and a metadata head —
     * so the panel can ask whether the article has moved underneath the
     * questions. And **`batchId`**, which is what a mark binds to: between a
     * reader seeing a question and pressing Answer, a forced regeneration can
     * replace every reference answer in this column while the shape of the
     * document stays exactly the same. `POST /api/quiz/:slug/mark` answers 409
     * on a mismatch rather than marking one batch's answer against another's
     * reference, which is a failure nothing else here would notice.
     *
     * **No `profileHash`, like `timeline` and unlike `ideas` and `sketch`** — a
     * decision rather than a gap, and a cheap one to reverse, because
     * `profileHash` is a field on the JSON rather than a column.
     *
     * **No attempts table beside it.** v1 stores no answers: a reader answers,
     * reads the reply and moves on. The questions persist because they are an
     * artefact. docs/plans/260831al-review-quiz-sub-mode.md § Attempts are not
     * stored.
     *
     * **No foreign key from an evidence `blockId` to `revision_blocks`**, on
     * the same argument the glossary, the ideas, the quotes, the timeline and
     * the sketch make: a dropped paragraph should cost that question its jump
     * rather than take a delete with it or block one.
     */
    quiz: jsonb("quiz").$type<Quiz>(),

    /**
     * The picture a model drew of the argument — `Sketch`,
     * src/sketch-scene.ts, written by the `sketch` step.
     * docs/project/diagram.md § Sketch.
     *
     * The WHOLE artefact, like the six above, and here the reason is sharper
     * than for any of them: **a scene is a set of coordinates that only means
     * anything against the article it was drawn for.** Every node may carry a
     * `block`, and a re-extraction moves every block id — so a column holding
     * `scenes` without `sourceHash` and `profileHash` could not answer whether
     * the picture is still about this text, and the panel would go on drawing a
     * confident diagram whose clicks land nowhere. The source hash covers the
     * **tree** as well as the blocks, because the prompt shows the model the
     * outline: re-cut the sections and the question changes with every block
     * byte-identical (src/ideas.ts § inputFingerprint has the reasoning).
     *
     * **No foreign key from a node's `block` to `revision_blocks`**, on the
     * same argument the glossary and the ideas make: a dropped paragraph should
     * cost that node its click, which is what `readSketch` does, rather than
     * take the picture down with it or block the delete.
     */
    sketch: jsonb("sketch").$type<Sketch>(),

    /**
     * The same argument painted — `Illustrated`, src/illustrated-plate.ts,
     * written by the `illustrated` step. docs/project/diagram.md § Illustrated.
     *
     * **The brief and where the pictures are, never the pictures.** A plate
     * holds a sha256, an extension and the dimensions; the bytes are
     * content-addressed objects in the `sources` bucket at
     * `sha256/<hash>.jpeg`, the same place the article's own figures go, put
     * there by `storePlateImage` (src/illustrated-image.ts). Base64 here would
     * be about 200 KB a plate dragged along by every read of this revision that
     * named the column — the same call `assets` makes below.
     *
     * **`sourceHash` here is a hash of the SKETCH, not of the article**, which
     * is the one thing about this column that will surprise somebody. A forced
     * Sketch redraw changes the scene with every article byte identical, so an
     * article-shaped fingerprint would call a stale illustration current
     * (src/illustrated.ts § the header). And **`profileHash` is inherited from
     * the Sketch** rather than taken from the reader's current profile: a
     * personalised picture must not quietly become an impersonal one.
     *
     * **No foreign key from a vignette's `block` to `revision_blocks`**, on the
     * same argument the glossary, the ideas and the sketch make: a dropped
     * paragraph should cost that vignette its jump rather than take the picture
     * down with it or block the delete. `readIllustrated` drops what it cannot
     * resolve, in the browser as well as on the server.
     */
    illustrated: jsonb("illustrated").$type<Illustrated>(),

    /**
     * What the rest of the web says about this piece — `Debate`, src/types.ts,
     * written by the `debate` step.
     * docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md.
     *
     * **The only artefact column here holding text this app did not make and
     * did not fetch**, and that is the one thing about it to know. Every row
     * carries quoted passages of a stranger's web page, returned by
     * OpenRouter's server-side search and capped at
     * `MAX_EVIDENCE_EXCERPT` (8,000 characters) before they reach memory. They
     * are stored so a reader can check the claim being made about that page,
     * they are rendered as text and never as markup, and every URL in here is
     * re-judged by `publicCitationUrl` at the public boundary rather than
     * trusted because it is stored.
     *
     * The WHOLE artefact, like its neighbours, and `sourceHash` is
     * `articleWithIdsFingerprint` — the blocks, the tree and the cited head —
     * because pass B shows the model the article with its block ids on it. A
     * column holding the rows without the hash could not answer whether the
     * claims those rows answer are still in the piece.
     *
     * **`searchedAt` is not staleness and must not be read as it.** It is when
     * the search ran, it crosses both DTOs deliberately, and a visitor opening a
     * year-old shared article is owed the date without the artefact declaring
     * itself invalid. `stale` continues to mean the article changed.
     *
     * **No `profileHash`**, like `timeline` and `quiz`: who is reading does not
     * change what the web said.
     *
     * **No foreign key from a claim row's `blockId` to `revision_blocks`**, on
     * the same argument the glossary, the ideas, the quotes, the timeline, the
     * quiz and the sketch make: a dropped paragraph should cost that row its
     * jump rather than take a delete with it or block one.
     */
    debate: jsonb("debate").$type<Debate>(),

    /**
     * The article's own images, and what became of each — `Assets`,
     * src/assets.ts, written by the `assets` step.
     *
     * **The manifest, never the bytes.** Each stored image is a
     * content-addressed object in the `sources` bucket at `sha256/<hash>.<ext>`,
     * written through `storeRawSource`, and this column is the list saying
     * which of those objects are this article's. That is what replaces the
     * per-article folder Greg pictured: content addressing dedups a publisher's
     * logo across forty articles, and a name that IS the hash of its contents
     * can always be re-checked against them.
     * docs/plans/260829b-hosting-the-articles-images.md § Where the bytes go.
     *
     * **No foreign key to `raw_sources`, and no row there either**, which is
     * the decision most likely to be undone by somebody tidying. That table
     * exists so a revision can point at *the document* it was made from, and
     * its `kind` CHECK is `in ('pdf','html')`. An image is not the document: it
     * has no revision pointing at it, no `raw_sources_kind` value, and nothing
     * to certify. The manifest IS the record. Objects nothing references are
     * kept on purpose — there is no sweeper to race — so orphaned image bytes
     * are a known, accepted cost.
     *
     * The WHOLE artefact, like the five above. `sourceHash` is the blocks it
     * was built from and `version` is the code that built it, and dropping
     * either would leave the step unable to say whether the article has moved
     * underneath its images. Three states, not two: a `failed` entry, a
     * `stored` entry, and **no column at all**, which means this step never ran
     * on this article and the reader must hot-link exactly as before.
     */
    assets: jsonb("assets").$type<Assets>(),

    /**
     * The tree's navigation labels — `LabelsFile`, stage 4's second model pass.
     *
     * **Not a `nav_label` column on `revision_blocks`, even though the key
     * would fit.** That would give stage 4b write access to stage 3's rows, and
     * a re-run of labels would mutate rows that are otherwise immutable once
     * the revision is published. `labels.json` is one of the `hierarchy` step's
     * OUTPUTS (src/pipeline.ts), so its currency rides with the `hierarchy` row in
     * `revisionStepRuns` and `labels` is deliberately NOT a step name of its
     * own. Checked against the code, not assumed — an earlier draft of this
     * work had it as a step and would have added a CHECK value for it.
     */
    labels: jsonb("labels").$type<LabelsFile>(),

    /**
     * **Where this revision's paragraph nav labels are** — `NavLabelStatus` in
     * src/types.ts, one of `pending` / `ready` / `failed`.
     *
     * **It sits among the artefact columns and is not one of them**: it holds a
     * lifecycle rather than a thing, which on this table only `status` above
     * does, and `status` is about the revision where this is about one artefact
     * inside it. It exists because absence on `TreeNode.navLabel` already means
     * something else. A leaf with no label is
     * a caption or a pull-quote, deliberately unlabelled and legal since the
     * tree was written; *not written yet* is a different claim and had nowhere
     * to live. src/hierarchy.ts asked for it by name — deferring the labels
     * "needs a state that says 'still arriving' rather than an absence that says
     * nothing".
     *
     * **A column rather than a field on `tree` or on `labels`**, and that is
     * GPT Sol's F6 rather than a preference: a labels run that fails has to mark
     * **the revision the reader is actually looking at**, which is the published
     * one — its own candidate tree is thrown away, and a terminal job's history
     * is not permanent. So the state has to be reachable and writable
     * independently of whatever draft was in flight, exactly as
     * `pgGlossaryStore.deleteGlossary` reaches the published revision (see the
     * `glossary` note above for the price that exception pays).
     *
     * **`not null default 'ready'`, and the default is a true statement about
     * every existing row**: they have their labels, because until stage 2 of
     * docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md the
     * `hierarchy` step could not finish without producing them. So the migration
     * backfills nothing and there is no null to read as a fourth state.
     *
     * **`carry` in `REVISION_CARRY_POLICY`**, beside `tree` and `labels`: a
     * `{ steps: ["blocks"] }` job copies those two forward, and a status that
     * did not travel with them would say `ready` about labels the draft had not
     * inherited — or, worse, `pending` for ever about labels that are right
     * there.
     *
     * The CHECK is the guard the type cannot be: `text` with a two-word typo in
     * it compiles, and the client's `switch` would then fall to whichever arm it
     * happens to have. Drizzle does not validate a `$type` at runtime.
     */
    navLabelStatus: text("nav_label_status")
      .$type<NavLabelStatus>()
      .notNull()
      .default("ready"),

    /**
     * The library's scalars, computed once here instead of by a directory walk
     * per request — the discipline `LibraryEntry` was already written to.
     */
    wordCount: integer("word_count"),
    blockCount: integer("block_count"),
    partCount: integer("part_count"),
    sectionCount: integer("section_count"),
    rootGist: text("root_gist"),

    createdAt: createdAt(),
  },
  (t) => [
    check("article_revisions_status", sql`${t.status} in ('draft','published','failed')`),
    /**
     * The three of `NavLabelStatus`, and **this literal is hand-kept** — the
     * same standing hazard `revision_step_runs_step` has, which has drifted
     * twice and has `tests/db-step-constraint.test.ts` watching it.
     * `drizzle-kit generate` diffs the TypeScript and knows nothing about a
     * CHECK expression, so a fourth member added to the union in src/types.ts
     * would compile, migrate cleanly and then be rejected at the UPDATE with a
     * `23514 check_violation` naming none of this.
     * `tests/nav-label-status.test.ts` compares the two.
     */
    check(
      "article_revisions_nav_label_status",
      sql`${t.navLabelStatus} in ('pending','ready','failed')`,
    ),
    /** Lets children key on (article_id, revision_id) and inherit the article. */
    unique("article_revisions_article_id_id").on(t.articleId, t.id),
    /**
     * The half-pointer guard. `(a is null) = (b is null)` rather than two
     * separate rules, so it reads as the one fact it is — and it is the same
     * shape as `jobs_upload_both_or_neither`, which exists for the same reason
     * one field of a pair going missing produces a value the TypeScript type
     * cannot express.
     */
    check(
      "article_revisions_raw_source_both",
      sql`(${t.rawSourceSha256} is null) = (${t.rawSourceKind} is null)`,
    ),
    /**
     * No `onDelete`, because nothing ever deletes a `raw_sources` row — see
     * that table on why there is no lifecycle. If that ever changes, this is
     * the line that has to be revisited first.
     */
    foreignKey({
      name: "article_revisions_raw_source_fk",
      columns: [t.rawSourceSha256, t.rawSourceKind],
      foreignColumns: [rawSources.sha256, rawSources.kind],
    }),
  ],
);

/* --------------------------------------------------------------- blocks -- */

/**
 * THE SPINE. A block id, once minted, is never deleted from this table.
 *
 * Everything the reader creates — comments, and later highlights and notes —
 * points here rather than at the current revision's rows, which is what lets a
 * paragraph disappear from the article without the question about it
 * disappearing too.
 */
export const blockIdentities = spideryarn.table(
  "block_identities",
  {
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    blockId: text("block_id").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.articleId, t.blockId] }),
    check("block_identities_id_format", sql`${t.blockId} ~ ${sql.raw(`'${SPIDERYARN_ID_REGEX}'`)}`),
  ],
);

/**
 * A block's content as one revision saw it. `Block` in src/types.ts.
 *
 * `ordinal` IS document order and is written explicitly from the array index —
 * never inferred from insertion order, a sequence, or anything that could be
 * reordered on the way in. Block ids are random and carry no position
 * (docs/project/block-ids.md#why-random-and-not-sequential), so if this column
 * is wrong there is nothing to recover the order from.
 */
export const revisionBlocks = spideryarn.table(
  "revision_blocks",
  {
    articleId: uuid("article_id").notNull(),
    revisionId: uuid("revision_id").notNull(),
    blockId: text("block_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    tag: text("tag").notNull(),
    kind: text("kind").notNull(),
    /** Heading depth 1–6, on headings only. */
    level: smallint("level"),
    text: text("text").notNull(),
    words: integer("words").notNull(),
    html: text("html").notNull(),
    /** False for media, rules and code — blocks with no prose to summarise. */
    gistable: boolean("gistable").notNull(),
    note: text("note"),

    /**
     * What this text is, and how the argument machinery must treat it — two
     * orthogonal closed axes, `Block.role` and `Block.treatment` in
     * src/types.ts. Null on both means ordinary article content.
     *
     * Only `'footnote'` is written today. The other four are in the constraint
     * because a stored role means *this revision classifies this content as X*,
     * and narrowing the set now would make widening it a migration
     * (docs/plans/260828o-footnotes-stage345-upfront-sol.md, decision 2).
     */
    role: text("role"),
    treatment: text("treatment"),
    /**
     * Which note this block belongs to. **A note is a range of blocks**, so
     * this is many-rows-to-one-value and deliberately not a key of anything: it
     * is minted by stage 2 from the note's own text (src/notes.ts) and is
     * unique only within a revision. No CHECK — its shape is stage 2's to
     * decide, and `NOTE_ID_PATTERN` is where stage 3 enforces it.
     */
    noteId: text("note_id"),
    /**
     * **The authored box this block sits inside** — `Block.context` in
     * src/types.ts, recognised at stage 2 before Readability deletes the markup
     * that says so.
     *
     * Two columns rather than a membership table, and the reason is that
     * nothing can produce the case a table would buy: stage 2 collapses a
     * callout inside a callout into one, so a block has at most one context by
     * construction. This is also the path `role`, `treatment` and `note_id`
     * already cut, and a second way to say "this block belongs to an authored
     * group" is exactly what the work that added these was avoiding. When a
     * second context type has to co-exist with the first, this becomes
     * `revision_block_contexts` — with a real case to design against.
     * docs/plans/260831af-carrying-markup-facts-past-readability.md.
     *
     * **Not an address.** Comments, URLs and the tree address block ids, which
     * are permanent (docs/project/block-ids.md). This is revision-local, and it
     * is stable across re-runs only so a diff shows real changes.
     */
    contextId: text("context_id"),
    contextType: text("context_type"),

    /**
     * The block's prose, as Postgres's full-text type — the home page's search box.
     *
     * **Per block, not per article**, and that is the design rather than an
     * accident of where there was room. The whole point of the library search is
     * that a hit deep-links to the paragraph (`/read/<slug>?at=<blockId>`), and a
     * `tsvector` over the whole article can tell you only which article. Ranking
     * follows the same logic: `ts_rank_cd` over one paragraph is a statement
     * about that paragraph, which is what the result list shows.
     *
     * **Generated, not written.** A column the pipeline had to remember to fill
     * is a column that is empty for exactly the article somebody just re-ran —
     * and an empty `tsvector` matches nothing, silently, which is the shape of
     * bug this repo keeps writing postmortems about. `stored` rather than
     * `virtual` because it is indexed, and Postgres will only index a stored one.
     *
     * `'english'` is hardcoded here, matching `to_tsquery`'s configuration in
     * src/store/pg-shelf.ts. The two must agree: a vector built with one
     * configuration and queried with another silently matches almost nothing.
     * `article_revisions.lang` exists and is deliberately NOT consulted — a
     * generated column may only reference its own row.
     */
    fts: tsvector("fts").generatedAlwaysAs(
      (): SQL => sql`to_tsvector('english', coalesce(${revisionBlocks.text}, ''))`,
    ),
  },
  (t) => [
    primaryKey({ columns: [t.revisionId, t.blockId] }),
    /** GIN, because this column is queried with `@@` and never selected. */
    index("revision_blocks_fts").using("gin", t.fts),
    unique("revision_blocks_revision_ordinal").on(t.revisionId, t.ordinal),
    check("revision_blocks_ordinal", sql`${t.ordinal} >= 0`),
    /**
     * `callout` joined the list on 2026-08-31 (migration 0033). Widening a
     * CHECK is the safe direction — every row that satisfied the old one still
     * satisfies this — but it has to land *before* an article extracted by the
     * new stage 2 is published. Blocks are written in one batched statement
     * inside a transaction (src/store/artifacts-pg.ts), so
     * the failure is loud and total: the statement is refused and the whole
     * revision rolls back. It does not leave half an article. `npm run deploy`
     * migrates before it pushes code, which is the right order.
     * docs/plans/260831ae-callouts-the-box-the-author-drew.md.
     */
    check(
      "revision_blocks_kind",
      sql`${t.kind} in ('heading','text','quote','callout','code','media','caption','other')`,
    ),
    /**
     * The two closed axes, nullable — so `is null or in (…)`, where `kind`
     * above is `notNull` and needs no null arm. A bare `in` would be satisfied
     * by null anyway (`null in (…)` is null, not false, and a CHECK passes on
     * null), so writing the null arm out is documentation rather than logic.
     */
    /**
     * The context columns agree with each other, and the type is closed.
     *
     * Both-or-neither is the constraint worth having: a `context_id` with no
     * type is a group nothing can draw, and a type with no id is a claim with
     * no members. Postgres enforces it for every writer, including the
     * backfill somebody runs at midnight.
     */
    check(
      "revision_blocks_context",
      sql`(${t.contextId} is null) = (${t.contextType} is null)`,
    ),
    check("revision_blocks_context_type", sql`${t.contextType} is null or ${t.contextType} in ('callout')`),
    check(
      "revision_blocks_role",
      sql`${t.role} is null or ${t.role} in ('footnote','reference','acknowledgment','credit','appendix')`,
    ),
    check(
      "revision_blocks_treatment",
      sql`${t.treatment} is null or ${t.treatment} in ('supplement')`,
    ),
    /**
     * A block cannot be attached to a revision of a different article: the
     * article id travels in both keys and has to agree.
     */
    foreignKey({
      name: "revision_blocks_revision_fk",
      columns: [t.articleId, t.revisionId],
      foreignColumns: [articleRevisions.articleId, articleRevisions.id],
    }).onDelete("cascade"),
    /**
     * No cascade, and no `restrict` either — identities are never deleted, so
     * this FK only ever fires on an id that was never minted. That is a real
     * bug (stage 3 re-minting instead of carrying ids forward) and it should
     * fail loudly rather than insert.
     */
    foreignKey({
      name: "revision_blocks_identity_fk",
      columns: [t.articleId, t.blockId],
      foreignColumns: [blockIdentities.articleId, blockIdentities.blockId],
    }),
  ],
);

/* ----------------------------------------------------- referee criteria -- */

/**
 * **One criterion a peer reviewer is judging a paper against, and what came
 * back when it was run over the piece.**
 *
 * Reader state, article-scoped, `(article_id, id)` — the same shape as
 * comments, chat threads and searches, for the same reasons.
 *
 * **It sits here, above `comments`, because `comments` references it.** The
 * natural home is beside `search_runs`, which it is modelled on almost column
 * for column; a table's definition has to precede anything whose foreign key
 * names it, and the referee's own mark lives on a comment. See
 * `comments.criterion_id` below for why the mark is a comment rather than a
 * table of its own.
 *
 * ## It is not `search_runs` with a column added
 *
 * The plan for this said `search_runs` "has the right shape already". GPT Sol's
 * review, finding 6, showed it does not: no criterion kind, no poles, no
 * citations, no scale — and, the one that would have broken first,
 * `SearchHit.confidence` is a 0–100 *match strength* whose validator clamps
 * negatives to zero (`validateHits`, src/search.ts). A signed valence pushed
 * through that field does not arrive wrong, it arrives as `0`, and every
 * negative judgement the referee asked for is gone with nothing to see.
 *
 * So there are two numbers in this feature and they are never one field.
 * `results` carries the model's `confidence` (0–100) and, on a `diverging`
 * criterion, its `valence` (−100…+100); `comments.valence` carries the
 * *referee's own* placement. All three are separate on purpose, and
 * src/referee-criteria.ts is where the rules are written down and tested.
 *
 * **`results` stays JSONB**, for the reason `search_runs.hits` gives in full: it
 * is one model call's wholesale output, generated together, replaced together,
 * never edited one at a time, and the only key splitting it would buy is one
 * onto `block_identities` that we specifically do not want. The poles and the
 * scale are *columns*, because docs/project/sql.md says the default is a column
 * and a blob has to argue for itself — and a pole is a short string the database
 * can constrain.
 */
export const refereeCriteria = spideryarn.table(
  "referee_criteria",
  {
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    /** `auth.users(id)`. FK in the custom migration, like every other owner key. */
    ownerId: uuid("owner_id").notNull(),
    /**
     * **What sort of question this is** — `single`, `diverging` or `literature`.
     *
     * A discriminator rather than a flag, because the three differ in what a
     * *result* carries: `diverging` adds a signed valence, `literature` adds
     * citations and a search count. `REFEREE_CRITERION_KINDS` in
     * src/referee-criteria.ts is the same list, and the check below is what
     * makes it true for every writer rather than only for the ones that went
     * through that TypeScript.
     */
    kind: text("kind").notNull(),
    /** What the reader typed, in their own words. **Never logged** — it is prose. */
    criterion: text("criterion").notNull(),
    /**
     * **What the two ends of a `diverging` criterion mean, in the referee's own
     * words.** `pole_against` is −100 and prints as "counts against";
     * `pole_favour` is +100 and prints as "counts for".
     *
     * Null on the other two kinds, and the check below makes that both-or-
     * neither: a diverging criterion with one pole has a signed number pointing
     * at nothing, and the panel could not print the direction in words — which
     * docs/project/colour-scales.md requires, because colour may never be the
     * only carrier of a good/bad judgement.
     */
    poleAgainst: text("pole_against"),
    poleFavour: text("pole_favour"),
    /**
     * **Which diverging ramp this criterion is drawn with**, `rg` or `br`, and
     * **`rg` — red ↔ green — is the default on purpose.**
     *
     * docs/project/colour-scales.md calls `--div-*` (blue ↔ red) "the one to
     * use", because red–green confusion is what colour blindness overwhelmingly
     * is. The same page permits `--div-rg-*` under one stated condition: *use it
     * where the reader already knows which end is which from something other
     * than the colour — a printed number, a label, a position.* Referee mode
     * meets that condition by construction — every row prints the rank, the
     * signed number, the direction in words, and the referee's own mark beside
     * the model's — and Greg asked for red ↔ green three times.
     *
     * **If the panel ever stops printing the direction in words, this default
     * stops being permitted.** That is the condition, and it is written here as
     * well as on `DivergingScale` (src/referee-criteria.ts) so that a change to
     * one has somewhere to find the other.
     *
     * The check is deliberately narrow rather than open, unlike
     * `search_runs.colour`: this is a name for a stylesheet block that either
     * exists or does not, and an unrecognised one would draw nothing at all.
     */
    scale: text("scale"),
    /** Written before the model is called, so a crash leaves a visible unfinished run. */
    status: text("status").notNull(),
    /**
     * The passages this criterion turned up — a `RefereeResult[]`, discriminated
     * by `kind`, validated by `validateResults` in src/referee-criteria.ts. Every
     * one is anchored by `blockId` + `quote` (+ `start` as a disambiguator only),
     * which is the contract in docs/project/block-ids.md.
     */
    results: jsonb("results").$type<RefereeResult[]>().notNull().default([]),
    model: text("model"),
    error: text("error"),
    createdAt: createdAt(),
    /**
     * **The article this run was answered against** — `hashBlocks`,
     * src/source-hash.ts. Same field, same function and same word for it as
     * `search_runs`, the glossary and the summaries carry, and null counts as
     * stale for the same reason: not knowing is not the same as knowing it is
     * fine.
     */
    sourceHash: text("source_hash"),
    /**
     * **Which attempt is in flight, so a second server cannot kill it.** The
     * full argument is on `search_runs.attempt_id` and is not repeated; the
     * short version is that an in-process `Set` of running work is wrong the
     * moment two processes share a database, which on Vercel is the ordinary
     * shape rather than an edge case.
     */
    attemptId: text("attempt_id"),
    attemptStartedAt: timestamp("attempt_started_at", { withTimezone: true }),
    /**
     * **The palette slot the reader picked** — null means "whichever one the
     * hash gives it". The same column, the same loose bound and the same
     * reasoning as `search_runs.colour`: the database does not know what colour
     * a slot is, so a value past the end of the palette is ignored by
     * `assignSlots` and the row falls back to its automatic hue.
     *
     * This is the *categorical* colour that says **which criterion** a mark in
     * the prose came from. It is not `scale`, which says which way a valence
     * runs. Sol's finding 7 is that those two must not be the same channel.
     */
    colour: integer("colour"),
  },
  (t) => [
    primaryKey({ columns: [t.articleId, t.id] }),
    check("referee_criteria_id_format", sql`${t.id} ~ ${sql.raw(`'${SPIDERYARN_ID_REGEX}'`)}`),
    check("referee_criteria_kind", sql`${t.kind} in ('single','diverging','literature')`),
    check("referee_criteria_status", sql`${t.status} in ('pending','done','error')`),
    check(
      "referee_criteria_colour",
      sql`${t.colour} is null or (${t.colour} >= 0 and ${t.colour} < 64)`,
    ),
    /* Poles and scale are exactly the diverging kind's, and all three arrive or
       none of them does. Half a diverging criterion is one that cannot be drawn
       and cannot be described in words, and it would reach the panel looking
       fine. */
    check(
      "referee_criteria_diverging_shape",
      sql`(${t.kind} = 'diverging') = (${t.poleAgainst} is not null and ${t.poleFavour} is not null and ${t.scale} is not null)`,
    ),
    check("referee_criteria_scale", sql`${t.scale} is null or ${t.scale} in ('rg','br')`),
    /* An attempt is both columns or neither — see `search_runs_attempt_both`.
       Half of one is a run that either cannot be swept (no age) or cannot be
       finished (no id), and both fail by leaving `pending` on screen for ever. */
    check(
      "referee_criteria_attempt_both",
      sql`(${t.attemptId} is null) = (${t.attemptStartedAt} is null)`,
    ),
  ],
);

/* -------------------------------------------------------- referee claims -- */

/**
 * **The claims a paper makes about itself, and where it takes each one up** —
 * Referee mode's second sub-mode. `ClaimsRun` in src/referee-claims.ts is the
 * shape; src/store/pg-referee-claims.ts is the store.
 *
 * ## One row per article, and the primary key says so
 *
 * `referee_criteria` beside it is keyed `(article_id, id)` because a referee
 * writes several criteria. This one is keyed on `article_id` **alone**: a
 * referee asks the paper what *it* claims exactly once, so running it again
 * replaces the row rather than adding one. There is no minted id, no cap and no
 * three-condition retry rule, because there is nothing to collide with — the
 * answer a second run overwrites was about the same paper.
 *
 * That is not a shape to tidy into line with its neighbour. A surrogate id here
 * would let two runs exist, and then something would have to decide which one
 * the panel shows, which is the decision the single key removes.
 *
 * ## Why this table exists at all, having been argued against
 *
 * It was deliberately *not* built on 2026-08-31, and the reasoning is worth the
 * two sentences: a claims run is an article-derived reusable artefact, so its
 * right long-term home is a **pipeline artefact** — a `StepName`, an
 * `ArtifactKind` and an `article_revisions` column — rather than a bespoke table
 * beside the criteria. That is still true, and this table is still an interim.
 *
 * What changed on 2026-09-01 is the *other* half of the argument. The reason not
 * to build it then was that src/store/export.ts was being rewritten in another
 * session, so a table could only have landed without an `ARTICLE_TABLE_COVERAGE`
 * entry — which is exactly the accident this repo carries a postmortem for, a
 * day of `db:export` silently dropping every `referee_criteria` row. That file
 * is settled, so the table lands *with* its coverage entry and its behavioural
 * fixture. Against it stood a sub-mode that returned 501 for every operation in
 * the only configuration that deploys.
 *
 * ## `claims` is JSONB for the reason `referee_criteria.results` is
 *
 * One model call's wholesale output, written together and never edited a row at
 * a time. docs/project/sql.md's default is a column, and this is the case that
 * argues itself out: the passages under a claim are read as a unit, replaced as
 * a unit, and nothing ever queries across them.
 */
export const refereeClaims = spideryarn.table(
  "referee_claims",
  {
    /** The key, on its own. See the header: one run per article. */
    articleId: uuid("article_id")
      .primaryKey()
      .references(() => articles.id, { onDelete: "cascade" }),
    /** `auth.users(id)`. FK in the migration by hand, like every other owner key. */
    ownerId: uuid("owner_id").notNull(),
    /** Written before the model is called, so a crash leaves a visible unfinished run. */
    status: text("status").notNull(),
    /**
     * The claims and their passages — a `Claim[]`, validated by `validateClaims`
     * in src/referee-claims.ts. Every claim and every passage under it is
     * anchored by `blockId` + `quote` (+ `start` as a disambiguator only), which
     * is the contract in docs/project/block-ids.md.
     */
    claims: jsonb("claims").$type<Claim[]>().notNull().default([]),
    model: text("model"),
    /**
     * **How many claims `MAX_CLAIMS` cut off the end of this run** — `ClaimsRun.
     * claimsOmitted`, and a column rather than a field inside `claims` because
     * it is a fact about the run and not about any claim in it.
     *
     * Nullable, and null means *not recorded* rather than *none omitted*. Those
     * are genuinely different: the route that stores a run writes `claims` and
     * `model` and nothing else today, so every run stored before it learns to
     * write this has no answer, and the panel's fallback copy depends on telling
     * that from a truthful zero.
     */
    claimsOmitted: integer("claims_omitted"),
    /**
     * Whatever the call threw. **Never logged** — a provider that echoes the
     * request back would put the paper's own prose in here, which is the trap
     * src/searches.ts § `finishRun` sets out and which three files have now had
     * to write down.
     */
    error: text("error"),
    /**
     * When this run *started*, and it is also the sweep's clock.
     *
     * `begin` sets it and `finish` never touches it, so the age of a `pending`
     * row is how long that attempt has been in flight. `referee_criteria` needs
     * a separate `attempt_started_at` because a criterion outlives its attempts;
     * here a second run **is** a new row's worth of state written over the old
     * one, so there is exactly one clock and no way for the two to disagree.
     * src/store/pg-referee-claims.ts § `sweep`.
     */
    createdAt: createdAt(),
    /**
     * **The article this run was answered against** — `hashBlocks`,
     * src/source-hash.ts. Same field, same function and same word as
     * `search_runs` and `referee_criteria`, and null counts as stale for the
     * same reason: not knowing is not the same as knowing it is fine.
     */
    sourceHash: text("source_hash"),
  },
  (t) => [
    check("referee_claims_status", sql`${t.status} in ('pending','done','error')`),
    /* **No `empty unless done` check, deliberately.** It was written and taken
       out again: `begin` does write `[]` over whatever was there, so a `pending`
       row carrying claims would be a half-applied write — but the filesystem
       store cannot refuse one, and a constraint only one of the two stores keeps
       turns a shrug on a laptop into a 500 on Vercel. The invariant is held
       where both stores can hold it, in `begin`. */
  ],
);

/* ------------------------------------------------------------- comments -- */

/**
 * A reader's question about a stretch of prose, and the model's answer.
 *
 * Anchored to the block IDENTITY, not to the current revision's rows. The
 * anchor is `blockId` plus the exact `quote`; `start` only picks between
 * repeats of the same words inside one block. An offset alone would drift
 * silently the moment the paragraph changed.
 *
 * `id` is client-minted so that creating one is idempotent on retry.
 * `attemptId` and `leaseExpiresAt` replace the in-process `answering` Set in
 * src/routes.ts, which cannot survive more than one server process.
 */
export const comments = spideryarn.table(
  "comments",
  {
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    /** `auth.users(id)`. FK in the custom migration. */
    ownerId: uuid("owner_id").notNull(),
    blockId: text("block_id").notNull(),
    quote: text("quote").notNull(),
    start: integer("start").notNull(),
    /**
     * The reader's own words. Null on a bare bookmark and on every explanation
     * made before 2026-08-28. `comments_body_nonempty` below is what keeps
     * "wrote nothing" from having two spellings.
     */
    body: text("body"),
    /** Set when the body is edited, and only then. Null means never edited. */
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    /**
     * The conversation this comment started. **No foreign key, on purpose** —
     * see docs/plans/260828a-comments-and-bookmarks.md § There is deliberately no
     * foreign key. The short version: the link is advisory, a deleted thread
     * leaves a comment that is still the reader's mark, and a constraint
     * Postgres can keep and the filesystem store cannot is exactly what
     * tests/store-parity.test.ts exists to catch.
     */
    threadId: text("thread_id"),
    status: text("status").notNull(),
    answer: text("answer"),
    citations: jsonb("citations").$type<Citation[]>(),
    /** How many web searches the model chose to run. 0 means it was sure. */
    searches: integer("searches"),
    model: text("model"),
    error: text("error"),
    /** Fences every write, so a stale attempt cannot overwrite a newer answer. */
    attemptId: uuid("attempt_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    createdAt: createdAt(),

    /**
     * **Which referee criterion this note is answering** — null on an ordinary
     * reading note, which is every comment written before 2026-08-31.
     *
     * Added for Referee mode (docs/plans/260831an-referee-mode-for-peer-reviewers.md).
     * The referee's own mark **is a comment**: their words, anchored to a
     * passage, in a table that already has the anchoring discipline, the
     * gutter, the API and the export. A second store would mean two places to
     * write about one passage, and Mirror would have to read both.
     *
     * It also answers, better than a boolean would, the question of how to tell
     * a review comment from a reading note: **a comment with a criterion is a
     * review comment, one without is a reading note.** The distinction falls
     * out of the data rather than being a separate switch nothing keeps in step.
     */
    criterionId: text("criterion_id"),

    /**
     * **The referee's own placement of this passage on that criterion's scale**,
     * −100…+100, or null if they wrote prose and did not score it.
     *
     * **This is not the model's valence and must never be reconciled with it.**
     * The model's lives on a `DivergingResult` in `referee_criteria.results`;
     * this one is the person's. The whole value is in the gap between them —
     * a passage the referee put at +70 and the model at −40 is a disagreement
     * about the paper, and it is the row worth opening. Averaging them, or
     * letting a write of one touch the other, deletes exactly that. See
     * `valenceGap` in src/referee-criteria.ts.
     *
     * Signed, and the check below says so, because the failure this whole
     * feature was designed around is a signed number travelling through a
     * field that clamps negatives to zero (`validateHits`, src/search.ts).
     */
    valence: integer("valence"),
  },
  (t) => [
    primaryKey({ columns: [t.articleId, t.id] }),
    /**
     * `none` is every comment made from 2026-08-28: the reader marked a passage
     * and no model call was ever attempted. The other three keep their meaning,
     * and `sweepOrphaned` in src/routes.ts still filters on exactly `pending`,
     * so a bookmark is invisible to it without that function changing at all.
     */
    check("comments_status", sql`${t.status} in ('none','pending','done','error')`),
    check("comments_start", sql`${t.start} >= 0`),
    /**
     * An empty body is a different value to no body, and the client cannot be
     * trusted to keep that straight across two stores and an archive
     * round-trip. `exactOptionalPropertyTypes` makes `""` and absent different
     * shapes in TypeScript; this makes them impossible in the database.
     */
    check("comments_body_nonempty", sql`${t.body} is null or length(btrim(${t.body})) > 0`),
    /**
     * Points at the IDENTITY. This is the whole design: the block's text can
     * vanish in a re-extraction and this row survives, because identities are
     * never deleted. src/web/comment-nav.ts already sorts such a comment to the
     * end rather than dropping it — "it is still the reader's question".
     */
    foreignKey({
      name: "comments_identity_fk",
      columns: [t.articleId, t.blockId],
      foreignColumns: [blockIdentities.articleId, blockIdentities.blockId],
    }),
    /**
     * A placement needs something to be a placement *on*. A `valence` with no
     * `criterion_id` is a number against nothing, and the one thing it could
     * plausibly be taken for later — "how the reader feels about this passage in
     * general" — is a feature nobody has asked for and would be a second meaning
     * for one column.
     *
     * The other direction is allowed: a criterion with no valence is a referee
     * who wrote a sentence about the criterion and did not score it, which is
     * the ordinary case.
     */
    check(
      "comments_valence_needs_criterion",
      sql`${t.valence} is null or ${t.criterionId} is not null`,
    ),
    check(
      "comments_valence_range",
      sql`${t.valence} is null or (${t.valence} >= -100 and ${t.valence} <= 100)`,
    ),
    check(
      "comments_criterion_id_format",
      sql`${t.criterionId} is null or ${t.criterionId} ~ ${sql.raw(`'${SPIDERYARN_ID_REGEX}'`)}`,
    ),
    /**
     * **`no action`, not `cascade` and not `restrict`** — and the difference
     * between the last two is the whole reason this comment exists.
     *
     * `cascade` is wrong on its face: deleting a criterion would delete the
     * referee's own sentences about the paper, which are theirs and are not
     * derived from anything.
     *
     * `restrict` says the right thing — you cannot delete a criterion people
     * have written against — but says it too early. It is checked row by row as
     * a delete cascades, so deleting the *article* (which cascades into both
     * this table and `referee_criteria`, in an order Postgres does not promise)
     * could hit this constraint while the comment rows are still there and
     * refuse a delete that is entirely legitimate.
     *
     * `no action` is the same rule checked at the end of the statement instead.
     * Deleting a criterion on its own still fails, loudly, with rows to point
     * at; deleting the article succeeds, because by then neither row exists.
     * Verified against the local database rather than reasoned about, and the
     * check is in tests/db-schema.test.ts. It is the same choice
     * `revision_blocks_identity_fk` above makes, for a related reason.
     */
    foreignKey({
      name: "comments_criterion_fk",
      columns: [t.articleId, t.criterionId],
      foreignColumns: [refereeCriteria.articleId, refereeCriteria.id],
    }),
  ],
);

/* -------------------------------------------------------------- uploads -- */

/**
 * **One upload attempt, written down** — from the grant we mint to the bytes we
 * verified, or the reason we would not take them. `UploadRecord` in
 * src/upload-records.ts, and the state machine it moves through is
 * `canTransition` in src/source.ts, which knows nothing about where a record is
 * kept and is what makes this a change of adapter rather than of rules.
 *
 * **Why it is here now.** It was on the filesystem beside `data/_jobs/`, on the
 * stated principle that an upload record is queue state and should live where
 * its neighbours live. The queue is moving, so it moves — and the reason both
 * had to is the same one: minting the grant and queueing the job are *two*
 * HTTP requests, and on a serverless host they may not run on the same machine.
 *
 * ## The two halves of what we know, and only one of them is believed
 *
 * `claimed_bytes` and `claimed_sha256` are **what the browser said**. They are
 * recorded so a mismatch can be reported — "the file that arrived is not the
 * file you chose" is a useful sentence — and are never treated as identity.
 * `sha256` and `bytes` without the prefix are ours, computed over what actually
 * landed, and exist only once `verified`. Nobody may tidy the pair into one
 * column: a claimed hash taken as identity would let anyone who knows a hash
 * claim somebody else's document, which is the sharpest thing either review of
 * the upload design found.
 */
export const uploads = spideryarn.table(
  "uploads",
  {
    /** A UUID **we** minted. Never the client's — src/upload-records.ts § `isUploadId`. */
    id: uuid("id").primaryKey(),
    /** `auth.users(id)`. FK in the custom migration — see the header. */
    ownerId: uuid("owner_id").notNull(),
    /** Cleaned by `cleanFilename`. Display only; nothing derives a storage key from it. */
    filename: text("filename").notNull(),
    claimedBytes: integer("claimed_bytes").notNull(),
    claimedSha256: text("claimed_sha256").notNull(),
    status: text("status").notNull(),
    mintedAt: timestamp("minted_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * When the grant stops working — **the token's clock, not this row's.**
     * A record's creation time can precede the token's `iat`, so a sweep
     * counting from `minted_at` counts from the wrong clock and can delete an
     * object while a grant over its key is still live — which *re-arms* that
     * grant. Storing what the issuer told us removes the arithmetic.
     */
    grantExpiresAt: timestamp("grant_expires_at", { withTimezone: true }).notNull(),
    /** Ours, over the bytes we read. Present only once `verified`. */
    sha256: text("sha256"),
    /**
     * **`integer`, not `bigint`.** `node-pg` returns `int8` as a *string*,
     * because in general it does not fit a JS number — so a `bigint` column
     * hands `52428800` back as `"52428800"` and every comparison downstream
     * starts quietly lying. The cap is 50 MB and `integer` holds 2 GB.
     */
    bytes: integer("bytes"),
    /** `RejectReason`. Present only once `rejected`. */
    reason: text("reason"),
    /** The article it became, once one exists. */
    slug: text("slug"),
  },
  (t) => [
    /**
     * **Five, not four.** `UploadStatus` in src/source.ts carries `expired` as
     * well, and a draft of this table listed four — which would have passed
     * every test and every migration and failed at the first expiry with a
     * constraint violation nobody could read. tests/db-schema.test.ts asserts
     * this list against the type's own `NEXT` keys, so a sixth status fails on
     * a laptop rather than in production.
     */
    check(
      "uploads_status",
      sql`${t.status} in ('pending','claimed','verified','rejected','expired')`,
    ),
    /** `MAX_UPLOAD_BYTES` in src/uploads.ts. Written out because a check cannot import. */
    check("uploads_claimed_bytes", sql`${t.claimedBytes} > 0 and ${t.claimedBytes} <= 52428800`),
    check("uploads_claimed_sha256", sql`${t.claimedSha256} ~ '^[0-9a-f]{64}$'`),
    check("uploads_sha256", sql`${t.sha256} is null or ${t.sha256} ~ '^[0-9a-f]{64}$'`),
    /**
     * The two terminal states carry their evidence, or they are not those
     * states. `verified` with no hash and `rejected` with no reason are things
     * the TypeScript type cannot express and this table could.
     */
    check(
      "uploads_verified_has_evidence",
      sql`${t.status} <> 'verified' or (${t.sha256} is not null and ${t.bytes} is not null)`,
    ),
    check("uploads_rejected_has_reason", sql`${t.status} <> 'rejected' or ${t.reason} is not null`),
    index("uploads_owner_minted").on(t.ownerId, t.mintedAt.desc()),
  ],
);

/* ----------------------------------------------------------------- jobs -- */

/**
 * One run of some steps against one article. `Job` in src/types.ts.
 *
 * **`id` is `text`, not `uuid`.** src/jobs.ts mints job ids with the same
 * `mintId()` as blocks, so they are `spya-` ids. Typing this `uuid` would break
 * every existing id on import.
 *
 * Worth knowing: jobs call bare `mintId()` where blocks call
 * `mintUniqueId(taken)`, so a job-id collision today silently overwrites a
 * file. A primary key turns that into an error for free.
 */
export const jobs = spideryarn.table(
  "jobs",
  {
    id: text("id").primaryKey(),
    /** `auth.users(id)`. FK in the custom migration. */
    ownerId: uuid("owner_id").notNull(),
    slug: text("slug").notNull(),
    url: text("url"),
    title: text("title"),
    /** Ordered, and small. The UI renders these directly. */
    steps: jsonb("steps").$type<JobStep[]>().notNull(),
    status: text("status").notNull(),
    error: text("error"),
    /** Stop was pressed and the abort has not landed yet. */
    cancelling: boolean("cancelling").notNull().default(false),
    /**
     * Fences every write against a worker whose lease expired mid-model-call.
     * Such a worker cannot be stopped, so it must be stopped from *writing*.
     */
    attemptId: uuid("attempt_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),

    /**
     * **The unpublished revision this job is filling in**, or null when it does
     * not own one.
     *
     * Nothing related a job to a revision before this column, and the absence
     * was not a gap in the record — it made two designs undecidable. "Carry
     * forward from this job's previous draft" had nothing to resolve, and
     * "the latest draft for this slug" would have picked up *another* job's
     * draft and resurrected exactly what copying-from-published exists to
     * prevent. GPT Sol's review of the step 11 design, 2026-08-26:
     * docs/plans/260826e-postgres-storage-implementation.md § What the review found.
     *
     * It is the anchor for the browser-driven advance endpoint too
     * (docs/plans/260826q-job-queue-rethink.md): one request runs one step, and the
     * only way the next request knows where to write is this column.
     *
     * `on delete set null` rather than cascade — a draft swept away by
     * retention must not take the job record with it, and a job whose draft has
     * gone is a job with no draft, which is a state the lifecycle already
     * handles. Cleared when the draft is published or failed, so a non-null
     * value always names something still in flight.
     */
    draftRevisionId: uuid("draft_revision_id").references(() => articleRevisions.id, {
      onDelete: "set null",
    }),

    /**
     * **The reader profile this job was queued with**, or null for none.
     *
     * On `Job` since the profile work and with no column until 2026-08-27, which
     * is a gap of exactly the kind `guidance`'s comment two fields up describes:
     * the profile rides in every prompt this job's steps send, so a job resumed
     * on another instance without it runs the plain prompt, stamps the artefact
     * as unprofiled, and reports success. Found by putting the type beside the
     * table rather than by reading either — which is the only way this kind of
     * gap is ever found. docs/project/reader-profile.md.
     */
    profile: text("profile"),

    /**
     * What kind of failure stopped it — and therefore **whether the card offers
     * Retry** (`jobWorthRetrying`, src/job-failure.ts).
     *
     * No check constraint listing the kinds, deliberately. `FailureKind` is a
     * closed union in src/messages.ts and it grows; a constraint here would turn
     * the next kind added to the type into a write that fails in production
     * rather than a test that fails on a laptop. Null means nobody said, and
     * that offers the retry — docs/postmortems/260826a-toc-max-tokens.md.
     */
    failureKind: text("failure_kind"),

    /**
     * The upload this job's document came off, when it came off a reader's disk.
     *
     * **Two columns rather than one jsonb `JobUpload`**, because the id is a
     * foreign key and a blob cannot be one. They move together or not at all —
     * `jobs_upload_both_or_neither` below is what makes that true rather than
     * intended, since `on delete set null` would otherwise leave a filename with
     * no id, which is a `JobUpload` the TypeScript type cannot express.
     *
     * `set null` rather than cascade, for the same reason `draft_revision_id`
     * has it: a swept upload must not take the job record with it.
     */
    uploadId: uuid("upload_id").references(() => uploads.id, { onDelete: "set null" }),
    uploadFilename: text("upload_filename"),

    /**
     * **What makes two requests the same work**, so that two instances cannot
     * each accept one Add click and pay for it twice.
     *
     * A hash over the canonical ordered `{step, force}` list plus
     * `profile` — the same comparison `sameWork` in src/jobs.ts makes today over
     * an in-memory Map, which is exactly what stops working the moment there is
     * a second instance. Immutable: a job's identity cannot change under a
     * partial unique index without the index becoming decorative.
     */
    workKey: text("work_key").notNull(),

    /**
     * **This request minted the slug rather than adopting one**, and so is the
     * one holding the name until it is over.
     *
     * Narrower than "arrived with a URL", which is what a draft of this called
     * it. `enqueue` fills `url` from `meta.json` for a late step, so
     * `{slug, steps:["ideas"]}` on an article already on the shelf carries a URL
     * exactly as a paste does — and that request is *naming* an article, not
     * claiming a name. The fact is known in one place only, at slug allocation:
     * `freeSlug` either hands back the slug something already holds for this URL
     * (adopted) or `slugWithShortId(slug)` (minted). An upload always mints,
     * there being no address that could make two uploads one article.
     *
     * Recovering it later — from `url`, from `upload`, from the shape of the
     * slug string — is the guess this column exists to avoid. GPT Sol,
     * 2026-09-02, docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md § 1b.
     *
     * Defaulted `false` so that a row written by anything that has not been
     * taught about it reserves nothing, which is the direction that can only
     * ever fail to block a name rather than wrongly block one.
     */
    reservesName: boolean("reserves_name").notNull().default(false),

    /**
     * **How many times this job has been given back to the queue after its
     * claimant stopped answering.** The budget's counter, and nothing else reads
     * it.
     *
     * `settleExpired` (src/store/pg-jobs.ts) used to end every lapsed claim
     * `error`, so a deploy landing during an ingest — or a step that overran its
     * lease — cost the reader their job and sent them to the Retry button. It
     * now puts the job back to `queued` on **this same row** instead, which is
     * what the filesystem store's `sweepStopped` has always done on restart, and
     * what keeps the slug, the article and therefore the article's checkpoints —
     * and, since 2026-09-04, the **draft** as well, without which the block ids
     * those checkpoints are keyed on move and reaching them is not the same as
     * being able to use them (src/store/pg-jobs.ts § the requeue's
     * `draftRevisionId`).
     *
     * **A counter rather than a flag, because without one it never stops.** A
     * job that overruns every lease would requeue for ever, buying model calls
     * nobody is waiting for. The budget is the caller's — `REQUEUE_BUDGET` in
     * src/jobs.ts, beside `LEASE_MS` — and enforcing it is the store's, the same
     * division `leaseMs` and `maxRunning` already have.
     *
     * **On the row, not in memory**, because the claimant that overran and the
     * process that sweeps it are routinely different machines. Nothing resets
     * it: a job is one attempt-with-resumptions, and pressing Retry makes a
     * *new* job with a fresh budget — so the reader is the outer loop, which is
     * deliberate.
     *
     * Defaulted `0` so that every row written before this column existed has a
     * full budget, which is the harmless direction: it can only offer a resume
     * that would not otherwise have happened.
     */
    requeues: integer("requeues").notNull().default(0),

    /**
     * **`urlKey(url)`** (src/ingest.ts), persisted so that `jobs_active_source`
     * can be an index rather than a comparison in TypeScript.
     *
     * Null for an upload, and for any request that arrived without an address —
     * and `jobs_active_source` is partial on `reserves_name`, so those rows are
     * outside it. That is right: two uploads of one file are two documents.
     *
     * Not the URL itself. `http://x.test/p` and `https://x.test/p/` are one
     * address, and only the normalised form makes them one row.
     */
    urlKey: text("url_key"),

    /**
     * **The quota slot this job is spending, or null if it is spending none.**
     *
     * Set by the authenticated new-ingest route and written by *this row's own
     * INSERT*, which is the entire point: the job and its provenance become
     * true in one statement, so there is no moment where a job exists and
     * nothing knows to charge for it. Every other shape was broken — see
     * `ingest_events` § *Provenance lives on the job*.
     *
     * Null for everything that must not be charged: pipeline work from the CLI,
     * a re-run of one step on an article already ingested, seeding. Those
     * settle nothing, because there is nothing to settle, and no flag anywhere
     * had to be remembered to make that true.
     *
     * **A foreign key, and composite on purpose** — see
     * `jobs_ingest_event_fk` in the custom migration. An earlier version of
     * this comment said a foreign key would be wrong because jobs are
     * reader-deletable and "a cascade in either direction would be wrong". That
     * was simply mistaken: the default is `NO ACTION`, nothing cascades, and
     * deleting a job never touches the reservation it was spending. GPT Sol,
     * 2026-09-02.
     *
     * It references `(id, owner_id)` rather than `id` alone, so a job cannot
     * spend **another owner's** reservation — a property no amount of
     * application code can promise as cheaply.
     */
    ingestEventId: uuid("ingest_event_id"),

    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "jobs_status",
      sql`${t.status} in ('queued','running','done','error','cancelled')`,
    ),
    check("jobs_id_format", sql`${t.id} ~ ${sql.raw(`'${SPIDERYARN_ID_REGEX}'`)}`),
    /**
     * A running job must carry the fencing token and lease that make it safe to
     * write. Without this the token is optional — and an attempt with a NULL
     * `attempt_id` fences nothing while looking exactly like one that does,
     * because every `where attempt_id = $1` then matches no rows. That reads as
     * "somebody else got there first" rather than as a bug.
     */
    check(
      "jobs_running_is_fenced",
      sql`${t.status} <> 'running' or (${t.attemptId} is not null and ${t.leaseExpiresAt} is not null)`,
    ),
    /*
     * **`jobs_only_one_running` was here, and it is gone on purpose.**
     *
     * It was `uniqueIndex(...).on(sql`(true)`).where(status = 'running')` — at
     * most one running row in the whole table, across every owner. A unique
     * index on a constant cannot express *at most N*, and N is what this is now:
     * `queue_state` is locked `FOR UPDATE` and the running rows are counted
     * inside that lock — src/store/pg-jobs.ts § `claim`. Which is what
     * `queue_state`'s own comment below has claimed since it was written, and
     * was not true until 2026-08-30: nothing locked it and the index carried the
     * whole guarantee.
     *
     * **So the backstop really is gone, and that is the cost.** Drop the index
     * and forget the counted check and nothing fails — `violatesConstraint(err,
     * "jobs_only_one_running")` simply never fires and every claim succeeds. The
     * parity suite's cap case is what stands between that and a green run;
     * docs/reusable/silent-success.md is why it is written to be seen red.
     *
     * The per-article rule is a different question and keeps indexes of its
     * own — see `jobs_one_running_per_slug` and its three neighbours below.
     */
    /**
     * A draft has exactly one owner, enforced rather than assumed.
     *
     * Two jobs pointing at one draft is the state in which "publish what I
     * built" publishes somebody else's work, and it would arise from an
     * ordinary bug — a retry that copies the old job's row, a rescue that
     * forgets to clear the pointer. Partial, because null means "owns no
     * draft" and any number of jobs may be in that state.
     */
    uniqueIndex("jobs_draft_revision_unique")
      .on(t.draftRevisionId)
      .where(sql`${t.draftRevisionId} is not null`),

    /** A `JobUpload` has both fields or the job has none. See `uploadId`. */
    check(
      "jobs_upload_both_or_neither",
      sql`(${t.uploadId} is null) = (${t.uploadFilename} is null)`,
    ),

    /**
     * **`cancelling` belongs to a running job and to nothing else.**
     *
     * Stop on a *queued* job settles it terminal in the same statement, because
     * nobody is inside it to notice a flag; Stop on a *running* one sets this
     * and waits for the claimant. Every transition that leaves `running`
     * clears it. So a `queued` row carrying `cancelling` is a state the
     * cancellation API cannot produce — and one nothing could clear either: it
     * would sit outside `jobs_active_work` (which excludes cancelling rows, so
     * no request would ever de-duplicate onto it) while still blocking its
     * article's line as a predecessor, for ever.
     *
     * Raised by GPT Sol as *"consider a check that `cancelling` implies
     * `running`"*, 2026-09-02, and taken: the alternative is a comment asking
     * every future transition to remember.
     */
    check(
      "jobs_cancelling_is_running",
      sql`not ${t.cancelling} or ${t.status} = 'running'`,
    ),

    /**
     * **The article mutex: at most one job actually *running* per article.**
     *
     * `jobs_active_slug` was here until 2026-09-02 — unique on
     * `(owner_id, slug)` `where status in ('queued','running')` — and it did
     * three jobs at once: reserve the name, de-duplicate the request, and
     * serialise the article. Doing all three meant a second, *different*
     * request for one article was refused at enqueue rather than queued behind
     * the first, which is what Greg asked to change. Each of the three now has
     * its own home, and the scope of each was a separate decision.
     *
     * **Global on `slug`, not `(owner_id, slug)`.** `articles.slug` is globally
     * unique — it is the URL contract — so two owners can build toward one
     * name, and until 2026-08-30 only `jobs_only_one_running` (above, and gone)
     * stopped them doing it at once. What this protects is not ambiguity but
     * corruption: until it was deleted 2026-09-05, src/store/artifacts-fs.ts
     * keyed every artefact write, the attempt marker and `interrupted()` on
     * `(slug, step)` in one shared `data/<slug>/` directory with no job
     * scoping, so two claimants on one article would overwrite each other's
     * output outright.
     *
     * It is a backstop, not the mechanism. The order rule in
     * src/store/pg-jobs.ts § `claim` — no older active row for this slug — is
     * what keeps a second claimant from getting here at all.
     */
    uniqueIndex("jobs_one_running_per_slug")
      .on(t.slug)
      .where(sql`${t.status} = 'running'`),

    /**
     * **Name reservation**: at most one active job may be *claiming* a slug.
     *
     * The half of `jobs_active_slug` that closed the check-then-use race, kept
     * exactly. Global on `slug` for the same reason as the mutex above, and
     * partial on `reserves_name` so that the many jobs merely *naming* an
     * existing article do not reserve anything and can therefore queue up
     * behind one another.
     *
     * **`cancelling` rows are still covered here**, deliberately, where
     * `jobs_active_work` excludes them: a stopped-but-still-running job's
     * claimant is inside it, so its name is not free until it is terminal.
     */
    uniqueIndex("jobs_reserved_slug")
      .on(t.slug)
      .where(sql`${t.status} in ('queued','running') and ${t.reservesName}`),

    /**
     * **De-duplication**: one active job per owner, article and piece of work.
     *
     * **This is the index the comment above `jobs_active_slug` said had been
     * dropped as "strictly subsumed", and the comment was right at the time.**
     * Any pair of rows violating `(owner_id, slug, work_key)` violated
     * `(owner_id, slug)` too while that covered `queued`. Relaxing it to allow a
     * line per article is exactly what un-subsumes this one, so it comes back —
     * and it is not decoration: without it a double-click on *Find quotes*
     * makes two jobs and pays for two model calls.
     *
     * **Owner-scoped**, unlike the two above. De-duplication is a fact about one
     * person's request; the article is not.
     *
     * **`cancelling` rows are excluded.** A request that de-duplicated onto a
     * job the reader has just stopped would vanish into a job that is about to
     * end, and the reader would watch a card that never does what they asked.
     * GPT Sol, 2026-09-02.
     */
    uniqueIndex("jobs_active_work")
      .on(t.ownerId, t.slug, t.workKey)
      .where(sql`${t.status} in ('queued','running') and not ${t.cancelling}`),

    /**
     * **One active mint per address**, which closes a race no other index here
     * catches.
     *
     * Two pastes of one URL at the same instant: both call `slugAlreadyHolding`,
     * both find nothing, and `freeSlug` mints `paper-a3f9k1` and `paper-x7d2m4`.
     * Every other key above contains the slug, so neither insert conflicts with
     * anything, and the reader gets two articles for one address and pays twice.
     * That is not a regression — `jobs_active_slug` did not catch it either,
     * for the same reason — but it is four lines to close. The loser re-reads,
     * finds this row, and **adopts its slug**, which is what `freeSlug` would
     * have done had it been able to see the other request.
     *
     * **Owner-scoped**, because *"if it was previously uploaded by a different
     * user, then reuse the source object, but add a new per-user article
     * object"* — Greg, 2026-08-26. And partial on `reserves_name`, so a late
     * step that happens to carry the article's URL is outside it.
     *
     * `url_key` is null for an upload, and a null is never equal to anything in
     * a unique index, so uploads are outside it too — which is right: two
     * uploads of one file are two documents.
     */
    uniqueIndex("jobs_active_source")
      .on(t.ownerId, t.urlKey)
      .where(sql`${t.status} in ('queued','running') and ${t.reservesName}`),

    /**
     * **The predecessor scan**, and it is the only index here that is not a
     * guarantee.
     *
     * `claim` asks whether any *older* active row exists for this slug, ordered
     * by `(created_at, id)`, and refuses if one does. Nothing above serves that
     * query: the two unique indexes on `slug` are partial on `running` and on
     * `reserves_name`, and `jobs_queued_idx` (drizzle/0001) leads on
     * `created_at` rather than on the slug. The scan runs **inside** the
     * `queue_state` lock every claimant takes, so a sequential scan there would
     * serialise the whole account behind it.
     */
    index("jobs_slug_order")
      .on(t.slug, t.createdAt, t.id)
      .where(sql`${t.status} in ('queued','running')`),
    /**
     * **One job per quota slot, enforced rather than intended.**
     *
     * A slot buys one ingest. Without this, two jobs carrying one
     * `ingest_event_id` would each be able to settle it, and the failure is
     * silent in the direction that costs money: the second publication finds
     * the row already `succeeded_at` and charges nothing. Unique rather than a
     * plain index so that the mistake is a constraint violation at the insert,
     * where somebody is looking.
     *
     * Partial, because null means "spends no quota" and there are a great many
     * of those — every CLI run and every step re-run.
     */
    uniqueIndex("jobs_ingest_event_unique")
      .on(t.ingestEventId)
      .where(sql`${t.ingestEventId} is not null`),
  ],
);

/**
 * One row, ever. Claiming locks it FOR UPDATE before choosing a job.
 *
 * This exists because `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1` does NOT give
 * concurrency 1 — it lets two workers claim two *different* queued jobs, which
 * is exactly the global guarantee docs/project/ingest-queue.md chose on
 * purpose. The singleton row is the guarantee.
 */
export const queueState = spideryarn.table(
  "queue_state",
  {
    /** Always 1. The check is what makes "singleton" a fact rather than a habit. */
    id: smallint("id").primaryKey().default(1),
    runningJobId: text("running_job_id").references(() => jobs.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("queue_state_singleton", sql`${t.id} = 1`)],
);
// The CHECK above says "no more than one row", NOT "exactly one row", and the
// dangerous case is the missing one: every claimant then locks nothing and
// believes it holds the queue. Postgres cannot express "this table always has a
// row" as a constraint, so the guard is a delete trigger in
// drizzle/0001_auth_fks_and_guards.sql, alongside the row being seeded there.

/* ------------------------------------------------------- step currency -- */

/**
 * Whether a pipeline step's output is CURRENT, not merely present.
 *
 * `stepIsDone` in src/pipeline.ts is an `access()` existence check: a file is
 * there, therefore the step is done, whatever it was generated from. Carrying
 * that across as "column is non-null" would carry the bug across too.
 *
 * `inputHash` should be computed the way src/tweets.ts `hashBlocks` does it —
 * over `id \t text` per block, joined. Deliberately NOT the bytes of the
 * artefact, because those change when an unread field is recomputed and do NOT
 * change when two blocks swap ids. That choice is the transferable part.
 */
export const revisionStepRuns = spideryarn.table(
  "revision_step_runs",
  {
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => articleRevisions.id, { onDelete: "cascade" }),
    stepName: text("step_name").notNull(),
    inputHash: text("input_hash").notNull(),
    /** Bump to invalidate every cached output of a step whose code changed. */
    implementationVersion: text("implementation_version").notNull(),
    promptVersion: text("prompt_version"),
    model: text("model"),
    status: text("status").notNull(),
    /**
     * When the run began. Without it a crashed `running` row has no timestamp
     * to judge it by, so "still going" and "died an hour ago" look identical.
     */
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /**
     * Which claim on the job wrote this row — the same token as
     * `jobs.attempt_id` (src/store/jobs.ts, `mintAttempt`).
     *
     * **Nullable, and it has to be.** Two kinds of run legitimately have no
     * attempt: every row that already exists, and every run started from a CLI
     * rather than from a job, which is most of what a developer does. So a null
     * here means "nobody claimed this", not "we lost the token" — and the fence
     * that reads it must treat those as the same refusal, since a step run that
     * cannot prove who wrote it cannot prove it was not somebody stale.
     *
     * `uuid`, not `text`, to match `jobs.attempt_id`. The two type as `string`
     * on the TypeScript side either way, so a mismatch here would compile,
     * read correctly, and fail with 22P02 on the first real advance —
     * docs/reusable/silent-success.md, and it has already happened once on
     * exactly this token.
     */
    attemptId: uuid("attempt_id"),
  },
  (t) => [
    primaryKey({ columns: [t.revisionId, t.stepName] }),
    check(
      "revision_step_runs_step",
      /**
       * Every name in `StepName` (src/types.ts). `'summary'` was one until
       * 2026-08-31 and came out with stage 5e
       * (docs/plans/260831s-gist-only-summaries.md) — and taking a name *out* is the
       * direction with a trap in it: Postgres validates a re-added CHECK
       * against the rows already in the table, so the migration has to delete
       * the `summary` step runs before it narrows the constraint. It does, in
       * that order.
       *
       * **`labels` IS here, since 2026-09-06**, and this sentence used to say
       * the opposite: *"`labels` is deliberately NOT here. `labels.json` is one
       * of the `hierarchy` step's OUTPUTS rather than a step of its own."* It
       * became a step of its own with
       * docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md — the
       * label pass was 79.5–92% of stage 4's wall clock, past what the job lease
       * allows — so it now has a `revision_step_runs` row like every other step,
       * and `drizzle/20260906…_labels_step.sql` is the migration that widened
       * this CHECK to admit it.
       */
      /* **This list is `STEP_ORDER` and it has drifted twice.** `sketch` was added
         to the database by drizzle/0031 and never got back into this literal,
         because `drizzle-kit generate` diffs the schema and knows nothing about a
         CHECK expression — so this one is hand-maintained and the migrations are
         the truth. `tests/db-step-constraint.test.ts` compares the last
         `ADD CONSTRAINT` in the migrations against `STEP_ORDER` in both
         directions, which is what makes there not be a third drift. */
      sql`${t.stepName} in ('fetch','extract','blocks','hierarchy','labels','assets','arc','tweets','glossary','quotes','ideas','timeline','quiz','sketch','illustrated','debate')`,
    ),
    check(
      "revision_step_runs_status",
      sql`${t.status} in ('running','done','error')`,
    ),
  ],
);

/* --------------------------------------------------------- raw sources -- */

/**
 * **What is in the `sources` bucket, as far as we know.**
 *
 * One row per distinct raw document, named by the hash of the bytes we actually
 * stored — which is not always the hash of the bytes we were *sent*, and that
 * distinction is the whole reason this table exists rather than a column.
 * `article_revisions.raw_sha256` stays what the network gave us;
 * `raw_sources.sha256` is what is at the key. For a PDF and for a UTF-8 page
 * they are equal. For anything else they are not, because `writeRaw` stores the
 * decoded string (src/fetch.ts says so in its own comment).
 *
 * ## No lifecycle, on purpose
 *
 * Two cross-family reviews argued for a state machine here — `uploading`, a
 * lease, `retire_after`, a `deleting` tombstone — and every part of it existed
 * to make deletion safe. Greg's answer to "how long may an object outlive its
 * last reference" was *"maybe keep them indefinitely (at least for now)"*, and
 * that removes the question rather than answering it: an object nothing
 * references is a **kept** object, not a leak, so there is no sweeper to race
 * and nothing to recover from. docs/plans/260827o-raw-bytes-in-storage.md.
 *
 * What survived is verification, which was never about deletion:
 * `storeRawSource` (src/store/blobs.ts) reads back and hashes a dedup hit
 * rather than believing it, so `verified_at` is `not null` here — a row exists
 * only once the bytes at that key have been shown to be those bytes.
 *
 * **Rows are never deleted**, so there is no `on delete` anywhere pointing at
 * this table, and `article_revisions` may reference it freely.
 */
export const rawSources = spideryarn.table(
  "raw_sources",
  {
    sha256: text("sha256").notNull(),
    kind: text("kind").notNull(),
    /**
     * `integer`, not `bigint` — the same trap `uploads.bytes` documents: node-pg
     * hands back `int8` as a *string*, so arithmetic on it silently
     * concatenates. Objects are capped at 50 MiB, four hundred times under the
     * `int4` ceiling.
     */
    bytes: integer("bytes").notNull(),
    contentType: text("content_type").notNull(),
    /** When the bytes at this key were last shown to hash to it. Never null. */
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.sha256, t.kind] }),
    /**
     * The format check that `canonicalKey` already enforces in TypeScript
     * (src/source.ts, `SHA256_RE`). Here too, because the column is half of a
     * key that gets rendered into an object name: a row that is not a digest
     * would name an object that cannot exist, and would do it silently.
     */
    check("raw_sources_sha256_format", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check("raw_sources_kind", sql`${t.kind} in ('pdf','html')`),
  ],
);

/* --------------------------------------------------- realtime sessions -- */

/**
 * **One row per live conversation this server issued a token for** — the parent
 * a live session's `ai_calls` rows hang off, and the only thing that can say a
 * session reported *nothing*.
 *
 * ## Why a session row exists at all, when the money is on `ai_calls`
 *
 * Because live conversation is metered from the **browser**. The audio is a
 * WebRTC connection from the reader's tab straight to OpenAI (src/live.ts says
 * why at length), so this process never sees a byte of it and never receives a
 * response body to read a token count out of. What arrives instead is a report,
 * posted back by the tab as each turn finishes.
 *
 * A report that never arrives is the ordinary case, not an attack: the reader
 * ends a conversation by shutting the laptop. Without this table that session is
 * simply **absent** — no row, no gap, and a total that looks healthy while being
 * short by an unknown amount. That is
 * docs/reusable/silent-success.md exactly, and it is the same move
 * `unscopedCalls()` already makes for calls with no collector open.
 *
 * So the row is written **when the client secret is minted**, in this order:
 * OpenAI mints the secret, we insert here, and only then does the token reach
 * the browser. If the insert fails the token is never released — a usable token
 * with no journal row is spend nothing can ever see.
 *
 * ## Issued is not connected, and the column names say so
 *
 * `issued_at` is a token handed out. It is **not** a conversation: a reader can
 * press the button, change their mind, and never open the data channel. A
 * denominator built on issued sessions would understate the cost of a real
 * conversation by however many of those there are. `connected_at` is the
 * separate, cheap, authenticated event the browser posts when the channel opens
 * — and a usage report backfills it too, because the event can itself be lost.
 *
 * ## `accepts_until` is stored, not computed
 *
 * The window a report is accepted in is a **server-owned** deadline, and it is
 * emphatically not the ephemeral client secret's expiry — that admits the
 * browser to one connection and is about ten minutes (`TOKEN_SECONDS` in
 * src/live.ts), while a conversation may run for twenty. Using the wrong clock
 * would silently drop the reports from the longest, most expensive sessions,
 * which are precisely the ones this whole job exists to measure.
 *
 * It is a column rather than `issued_at + a constant` because the constant will
 * change — the browser's own cap is a number in a React hook — and a stored
 * deadline means an old row keeps the rule it was issued under instead of
 * silently acquiring today's.
 *
 * **Rows are never deleted**, like `ai_calls`: `on delete restrict` on the
 * owner, so removing an account is a decision somebody has to take deliberately
 * rather than something that quietly erases billing history.
 */
export const realtimeSessions = spideryarn.table(
  "realtime_sessions",
  {
    /**
     * Ours, minted before OpenAI is asked for anything, so the id exists even
     * for a session that fails to start — the same reasoning as `ai_calls.id`.
     */
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    /**
     * `on delete set null` and a slug beside it, exactly as `ai_calls` does:
     * the id is the convenience and the slug is the historical fact a later
     * delete cannot revoke.
     */
    articleId: uuid("article_id").references(() => articles.id, { onDelete: "set null" }),
    articleSlug: text("article_slug"),
    /**
     * Which conversation this was spoken into. Text rather than a foreign key,
     * for the reason `ai_calls.job_id` gives: a thread the reader deletes must
     * not be able to take a billing row's context with it.
     */
    threadId: text("thread_id"),
    /**
     * The realtime model **as OpenAI created it**, not as we asked. They agree
     * only when the request was honoured, and `mintLiveToken` reads the created
     * session precisely so this column can be the answer rather than the
     * question.
     */
    model: text("model").notNull(),
    /** `gpt-live-transcribe` — a second model on a second rate card. src/live.ts. */
    transcriptionModel: text("transcription_model"),
    /** When the client secret was minted. A token handed out, not a conversation. */
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    /** The last instant a usage report for this session is accepted. See above. */
    acceptsUntil: timestamp("accepts_until", { withTimezone: true }).notNull(),
    /** When the data channel actually opened, or null if it never did. */
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    /** When the browser said it was over. Best-effort: a closed tab says nothing. */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /**
     * Why it ended, in the browser's own vocabulary — `hung_up`, `idle`,
     * `session_cap`, `error`. Free text with a length bound rather than a CHECK,
     * because the list belongs to a React hook this stage may not edit and a
     * constraint that lags it would refuse a true report.
     */
    closeReason: text("close_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    /** "What has this reader been talking to, and when" — the per-owner question. */
    index("realtime_sessions_owner_issued").on(t.ownerId, t.issuedAt.desc()),
    /**
     * **The deadline must be after the issue**, or the session was born unable
     * to accept a single report and nobody would find out until the reports
     * started bouncing. A constraint rather than a comment, per
     * docs/project/sql.md: it holds for the migration that backfills this
     * column in three months as well as for the one caller today.
     */
    check("realtime_sessions_window", sql`${t.acceptsUntil} > ${t.issuedAt}`),
    /** A channel cannot have opened before the token that admits it was minted. */
    check(
      "realtime_sessions_connected_after_issue",
      sql`${t.connectedAt} is null or ${t.connectedAt} >= ${t.issuedAt}`,
    ),
    check("realtime_sessions_close_reason_len", sql`length(${t.closeReason}) <= 64`),
  ],
);

/* ------------------------------------------------------------- ai calls -- */

/**
 * **One row per model call — the ledger.** Written when a call finishes, by the
 * sink in [`src/ai-spend.ts`](../ai-spend.ts), and never amended afterwards: a
 * finished call is a fact about the past.
 *
 * The shape is borrowed from the old app — see
 * docs/project/original-version/llm-plumbing.md — with three of its columns
 * deliberately not taken.
 *
 * - **`raw_response` is gone.** In the old project it was 31 MB over 306 rows
 *   and dominated their entire database — and, worse here, it would hold model
 *   output derived from the reader's article, their chat, or their dictated
 *   voice. That turns a small financial ledger into the project's largest and
 *   most sensitive store, kept alive by a pruner that can quietly stop. Every
 *   row carries `generation_id` instead, which is the handle to ask OpenRouter
 *   about the call afterwards. GPT Sol's call, 2026-08-28, reversing Greg's
 *   earlier "always store, with pruning" — written up in
 *   docs/plans/260827q-ai-cost-tracking.md rather than merely done.
 * - **`cost_micros` is gone**, in favour of nano-dollars in a `bigint`. A single
 *   query embedding costs about $0.0000006, which is **less than one
 *   micro-dollar** and rounded to zero — the row read as free.
 * - **No `attempt` column.** A retry is a separate call and gets its own row and
 *   its own id; `run_id` is what groups the calls one piece of work made.
 *
 * ## `owner_id` is here, and src/owner.ts's rule says it should not be
 *
 * That file lists the tables that deliberately do not carry an owner, because
 * each belongs to a row that does. Good rule, and this is its exception, for two
 * reasons: `article_id` is `on delete set null`, so an article going away would
 * strip a billing row of its person, permanently and without erroring; and not
 * every call has an article at all — library search, and an ordinary chat with
 * nothing open. `on delete restrict`, like every other owner FK here
 * (drizzle/0001_auth_fks_and_guards.sql): deleting an account is already a thing
 * this schema refuses to do quietly.
 */
export const aiCalls = spideryarn.table(
  "ai_calls",
  {
    /**
     * **Minted before the request goes out**, not when it comes back — so a call
     * that never returns still has a name. Hence no `defaultRandom()`: the
     * value comes from the process that made the call.
     */
    id: uuid("id").primaryKey(),
    /** Every call one collector saw, so a log line and its rows can be joined. */
    runId: uuid("run_id").notNull(),
    /** `x-generation-id` — the key to `GET /api/v1/generation?id=…` afterwards. */
    generationId: text("generation_id"),
    /** `request`, `job_step`, `cli` or `eval`. Eval spend is real and is not product spend. */
    scopeKind: text("scope_kind").notNull(),
    ownerId: uuid("owner_id").notNull(),
    articleId: uuid("article_id").references(() => articles.id, { onDelete: "set null" }),
    /**
     * The article as it was called at the time.
     *
     * Kept **beside** `article_id` rather than instead of it, because the id is
     * `on delete set null` on purpose and the slug is the historical fact a
     * later delete cannot revoke.
     */
    articleSlug: text("article_slug"),
    /**
     * Which ingest job, as text rather than a foreign key: finished jobs are
     * trimmed on a retention sweep, and a billing row must not be deletable by
     * housekeeping.
     */
    jobId: text("job_id"),
    stepName: text("step_name"),
    /**
     * `messages`, `chat` or `embeddings`.
     *
     * **On the row because the two wires do not mean the same thing by "input
     * tokens"** — the Messages shape reports cache reads and writes *outside*
     * `input_tokens`, and the chat shape reports them inside `prompt_tokens`. A
     * column summed across both without this is a number with no meaning.
     */
    wire: text("wire").notNull(),
    /** Which job made the call: `hierarchy`, `chat`, `embeddings`, … */
    purpose: text("purpose").notNull(),
    requestedModel: text("requested_model").notNull(),
    /** Which model answered, when the response said. Not always the one asked for. */
    answeredModel: text("answered_model"),
    /** Which upstream answered: `"Anthropic"`, `"Google"`, … */
    upstream: text("upstream"),
    /** The first 12 hex of the key's SHA-256. Never the key. See src/ai-spend.ts. */
    credentialFingerprint: text("credential_fingerprint"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
    /**
     * **Nullable since 2026-09-02, and only a realtime row may be null.**
     *
     * The two gateways time their own request, so every row they write has a
     * duration. A live session's input transcription does not: it arrives as one
     * `…input_audio_transcription.completed` event with no matching start, so
     * there is nothing to subtract from. Both alternatives were worse than a
     * null, and both would have been *invisible* — a `0` reads as an instant
     * call and skews any latency figure downwards, and the session's own
     * wall-clock is the length of a conversation rather than of a call, which is
     * the substitution GPT Sol's review named explicitly. src/ai-spend.ts §
     * `AiCallRow.durationMs`.
     */
    durationMs: integer("duration_ms"),
    /**
     * `ok`, `error` or `aborted`. A non-`ok` row's cost is a lower bound —
     * **except on a realtime row, where it is not.**
     *
     * The Realtime API reports the usage it billed on the terminal event
     * whatever the status, so a `cancelled` or `incomplete` response's figure is
     * complete even though its answer was not. OpenAI's four statuses are mapped
     * onto these three by `realtimeOutcome` in src/live.ts and kept verbatim in
     * `provider_status` below, because the map loses information on purpose and
     * that is the column where it is not lost.
     */
    outcome: text("outcome").notNull(),
    /**
     * **Which bill this call lands on** — `openrouter`, `anthropic` or `openai`.
     *
     * Not derivable from `credential_fingerprint`, which identifies a key
     * without saying whose. Money leaves this project from three accounts and
     * `npm run cost --reconcile` can only read one of them, so the row has to
     * say which side of that line it is on or the reconciliation is comparing
     * our total against somebody else's subtotal.
     *
     * `openai` is live conversation, added 2026-09-02 — and it is the one
     * **outside the account-level spend cap** set in OpenRouter, which is the
     * safety net the other two sit behind. The allowed list is a CHECK in SQL
     * (`ai_calls_provider_account_known`, first written in
     * drizzle/0023_ai_calls_cost_provenance.sql and widened in
     * drizzle/20260902150952_realtime_sessions_and_usage.sql), not a Drizzle
     * enum, so widening `ProviderAccount` in TypeScript is *not* enough on its
     * own — that is exactly how the third value nearly shipped with every
     * insert failing.
     */
    providerAccount: text("provider_account").notNull(),
    /**
     * **Where the dollar figure came from**: `provider`, `computed` or `none`.
     *
     * `provider` is OpenRouter's own `usage.cost` and is settled. `computed` is
     * our arithmetic over [`ANTHROPIC_PRICES`](../pricing.ts) for a call that
     * did not go through OpenRouter and therefore has nobody to ask. `none` is a
     * call that reported nothing and could not be priced.
     *
     * A column rather than an inference from which of the two nanos columns is
     * null, because "we were told" and "we worked it out" are different claims
     * and a total that mixes them silently is the thing this whole table exists
     * to stop.
     */
    costSource: text("cost_source").notNull(),
    /**
     * **Our own arithmetic**, in nano-dollars — kept apart from
     * `credits_used_nanos` on purpose, so that column keeps meaning exactly
     * "credits OpenRouter deducted" and nothing else ever lands in it.
     */
    computedCostNanos: bigint("computed_cost_nanos", { mode: "number" }),
    /**
     * Which price table row did the arithmetic, as `checked/effective-from` —
     * so a figure computed today and one computed in December can be told apart
     * without guessing which prices were current. Null unless `computed`.
     */
    priceVersion: text("price_version"),
    /**
     * **Credits OpenRouter deducted**, in nano-dollars — and the name says
     * credits rather than cash on purpose. Their margin is a fee on *buying*
     * credits, not a per-token markup, so a per-row x1.055 would invent a
     * precision that can never match a bank statement.
     */
    /* **`bigint`, against this file's own two warnings about `int8`.** Those are
       right — node-pg hands `int8` back as a *string* — and the reason it is
       safe here is specific rather than general: `mode: "number"` makes Drizzle
       map it back through `Number()` on the way out, where `uploads.bytes` and
       `raw_sources.bytes` are read raw. `integer` is not an option either way:
       nano-dollars overflow `int4` at $2.15. `tests/store-ai-calls.test.ts`
       asserts a round-trip comes back a `number`, because "it should" is exactly
       the assumption those two comments exist to distrust. */
    creditsUsedNanos: bigint("credits_used_nanos", { mode: "number" }),
    /**
     * **What the inference itself was worth, and ONLY on a BYOK row.**
     *
     * Under BYOK OpenRouter's own charge is legitimately `0` because somebody
     * else's key was billed upstream, so this is where that call's real money
     * is. On every other row it is `null`.
     *
     * It was called `upstream_inference_nanos` until 2026-09-02 and was written
     * on **every** chat-wire call, where OpenRouter reports
     * `cost_details.upstream_inference_cost` equal to `cost` — the same money
     * twice. So `SUM(credits_used_nanos) + SUM(upstream_inference_nanos)` was
     * double the truth, and the only expression that got it right lived in JS,
     * in `totalRows` (src/store/ai-calls.ts). An auditor writing the obvious SQL
     * got $23.54 where the truth was $11.77.
     *
     * The name now carries the condition, and
     * [migration 20260902141103](../../drizzle/20260902141103_byok_upstream_nanos.sql) enforces it
     * with a CHECK, so the obvious SQL sum
     * `COALESCE(credits,0) + COALESCE(byok_upstream,0) + COALESCE(computed,0)`
     * is now the correct one. The next thing anybody writes against this table
     * is a per-owner monthly aggregate for Stripe, and it should not have to
     * know a rule that is not in the schema.
     */
    byokUpstreamNanos: bigint("byok_upstream_nanos", { mode: "number" }),
    isByok: boolean("is_byok"),
    /**
     * **`reported_`, because the two wires do not agree what an input token
     * is.** The Messages shape reports cache reads and writes outside it; the
     * chat shape reports them inside. Summed across both without reading `wire`
     * it counts nothing in particular, and a column called `input_tokens` is an
     * invitation to that sum.
     */
    reportedInputTokens: integer("reported_input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    /** Priced at 1.25x and 2x input respectively, which is why one total will not do. */
    cacheWrite5mTokens: integer("cache_write_5m_tokens"),
    cacheWrite1hTokens: integer("cache_write_1h_tokens"),
    /** Inside `output_tokens`, never added to it. */
    reasoningTokens: integer("reasoning_tokens"),
    /** Billed per search and invisible to token arithmetic. */
    webSearches: integer("web_searches"),
    serviceTier: text("service_tier"),
    inferenceGeo: text("inference_geo"),

    /* ----------------------------------------------- live conversation -- */

    /**
     * **The realtime block — null on every row that is not a live conversation.**
     *
     * Explicit nullable columns rather than one JSON blob, per
     * docs/project/sql.md, and this is **not** a new pattern in this table: it
     * already carries `cache_write_5m_tokens` and `cache_write_1h_tokens` (the
     * Messages wire only), `service_tier` and `inference_geo` (Anthropic's own
     * fields) and `web_searches` (the chat wire only), each null on most rows.
     * A sibling table was the tempting alternative and that precedent settled
     * it — this follows the table's existing design rather than putting a second
     * shape beside it.
     *
     * **Why not the totals alone.** Audio input on `gpt-realtime-2.1` is $32 per
     * million tokens against $4 for text, and audio output $64 against $24. A
     * row holding only `reported_input_tokens` and `output_tokens` can be handed
     * a price once, by whoever wrote it, and can never be repriced or audited
     * afterwards. The splits are the whole point.
     *
     * Which session this call belongs to, and the thing that lets a `left join`
     * find sessions that reported nothing at all.
     */
    realtimeSessionId: uuid("realtime_session_id").references(() => realtimeSessions.id, {
      /* Billing history outlives everything, like `owner_id`. A session row is
         never deleted, so this only ever refuses a mistake. */
      onDelete: "restrict",
    }),
    /** OpenAI's `response.id`, or the transcribed item's id. Half the idempotency key. */
    providerEventId: text("provider_event_id"),
    /** `response` or `transcription` — which rate card, and the rest of the key. */
    eventKind: text("event_kind"),
    /** `completed`, `cancelled`, `failed`, `incomplete` — kept verbatim. See `outcome`. */
    providerStatus: text("provider_status"),
    /** Inside `reported_input_tokens`, never added to it. $4/Mtok. */
    inputTextTokens: integer("input_text_tokens"),
    /** Inside `reported_input_tokens`. **$32/Mtok** — the expensive half of a conversation. */
    inputAudioTokens: integer("input_audio_tokens"),
    /**
     * Always zero today: `liveSession` in src/live.ts configures no image input.
     * Stored so that the day it stops being zero is a visible fact rather than a
     * silently mispriced row — there is no image rate in `REALTIME_PRICES` and
     * `acceptRealtimeUsage` refuses a report carrying one.
     */
    inputImageTokens: integer("input_image_tokens"),
    /**
     * `cached_tokens_details` — the text/audio split of `cache_read_tokens`,
     * which carries the parent total.
     *
     * Cached audio is $0.40/Mtok against $32 uncached, eighty times cheaper, so
     * a single cached total cannot be priced. This is the same argument that
     * produced `cache_write_5m_tokens` and `cache_write_1h_tokens` above.
     */
    cachedTextTokens: integer("cached_text_tokens"),
    cachedAudioTokens: integer("cached_audio_tokens"),
    /** Inside `output_tokens`. $24/Mtok. */
    outputTextTokens: integer("output_text_tokens"),
    /** Inside `output_tokens`. **$64/Mtok** — the most expensive number in this table. */
    outputAudioTokens: integer("output_audio_tokens"),
    /**
     * **Seconds of audio transcribed**, for the half of live conversation that
     * is not billed per token at all.
     *
     * `gpt-live-transcribe` is $0.017 per audio *minute*. A token-only row shape
     * could not price it, which is why the usage DTO is a discriminated union —
     * token detail **or** seconds — rather than one bag of optional counts.
     *
     * `double precision`, not an integer: the event reports a duration in
     * milliseconds and rounding every turn up or down to a whole second would
     * accumulate a real error over a twenty-minute conversation of short turns.
     */
    transcriptionSeconds: doublePrecision("transcription_seconds"),
    createdAt: createdAt(),
  },
  (t) => [
    /** "What did this owner spend in August" — the query a spend limit would need. */
    index("ai_calls_owner_started").on(t.ownerId, t.startedAt.desc()),
    /** "What did this ingest cost", asked once per job at the end of it. */
    index("ai_calls_job").on(t.jobId),
    /**
     * "What did the product cost, as opposed to the measuring of it" — the
     * split `npm run cost` leads with, because a bake-off's forty PDF pages
     * landing in the number Greg sets a price against is how a price gets set
     * wrong.
     */
    index("ai_calls_scope_started").on(t.scopeKind, t.startedAt.desc()),
    /**
     * **The same report must not become two rows.**
     *
     * The browser posts each turn as it happens and retries what it did not see
     * acknowledged, so a dropped response — a request that succeeded and whose
     * `200` never arrived — is the ordinary case rather than the pathological
     * one. Double-counting is the direction that looks exactly like the thing
     * being measured, which is what makes it worth a constraint rather than a
     * check in TypeScript.
     *
     * `acceptRealtimeUsage` also derives the row's **primary key** from these
     * same three components, so the ordinary retry collides on `ai_calls.id`
     * and the existing `on conflict do nothing` absorbs it. This index is the
     * belt to that pair of braces: it holds even if the derivation is changed,
     * and it holds for anything writing this table that is not that function.
     *
     * Partial, because every non-realtime row has all three columns null and
     * `null` is not equal to `null` in a unique index — but a partial index says
     * what it means instead of relying on that, and it stays small.
     */
    uniqueIndex("ai_calls_realtime_event")
      .on(t.realtimeSessionId, t.providerEventId, t.eventKind)
      .where(sql`${t.realtimeSessionId} is not null`),
    /**
     * **A realtime row is fully identified or it is not a realtime row.**
     *
     * The three parts of the idempotency key arrive or refuse together. Without
     * this a report missing its `response.id` would insert happily, sit outside
     * the unique index above because one of its columns is null, and be counted
     * again on the next retry — the exact failure the index exists to stop,
     * walking in through the gap the index cannot cover.
     */
    check(
      "ai_calls_realtime_identified",
      sql`(${t.realtimeSessionId} is null and ${t.providerEventId} is null and ${t.eventKind} is null)
          or (${t.realtimeSessionId} is not null and ${t.providerEventId} is not null and ${t.eventKind} is not null)`,
    ),
    check("ai_calls_realtime_event_kind", sql`${t.eventKind} is null or ${t.eventKind} in ('response','transcription')`),
    /**
     * **The modality columns belong to the realtime wire and nowhere else.**
     *
     * A `input_audio_tokens` on a chat-wire row would be a number nobody can
     * price — there is no audio rate for `claude-sonnet-5` — and, worse, it
     * would be summed by the first person to write `SUM(input_audio_tokens)`
     * for a voice-minutes figure. This is the same shape as
     * `ai_calls_byok_upstream_only` from the migration before it: the column's
     * name carries a condition, and the database is what keeps the condition
     * true. docs/project/sql.md § Get the database to do the work.
     */
    check(
      "ai_calls_realtime_columns_need_realtime_wire",
      sql`${t.wire} = 'realtime' or (
            ${t.realtimeSessionId} is null
            and ${t.providerStatus} is null
            and ${t.inputTextTokens} is null
            and ${t.inputAudioTokens} is null
            and ${t.inputImageTokens} is null
            and ${t.cachedTextTokens} is null
            and ${t.cachedAudioTokens} is null
            and ${t.outputTextTokens} is null
            and ${t.outputAudioTokens} is null
            and ${t.transcriptionSeconds} is null
          )`,
    ),
    /**
     * **`duration_ms` may only be null on a realtime row**, which is the whole
     * of the licence the `NOT NULL` was dropped for.
     *
     * Dropping a `NOT NULL` widens what every *other* writer may do too, and the
     * two gateways always know how long their own request took. Without this,
     * the day one of them stops passing a duration is a day nothing goes red.
     */
    check(
      "ai_calls_duration_known_off_realtime",
      sql`${t.durationMs} is not null or ${t.wire} = 'realtime'`,
    ),
    /**
     * **A cost is never negative.**
     *
     * Cheap, and it earns its place because of the direction the failure runs.
     * A missing cost is loud — `cost_source: 'none'` is counted and printed by
     * `npm run cost` as "short by an unknown amount". A *negative* one is
     * silent and worse than missing: every reader of this table sums a column,
     * so a negative row quietly pays for somebody else's, and the total stays
     * plausible while being wrong in the direction that flatters a price.
     *
     * It is not hypothetical. `computed_cost_nanos` is the one figure this repo
     * works out itself, by subtracting cached tokens from their modality total
     * and multiplying by a rate — and on 2026-09-03 GPT Sol produced a browser
     * report that made that subtraction go negative and wrote a row claiming
     * minus $0.0032. `parseRealtimeUsage` in src/live.ts now refuses the report
     * that caused it; this is the belt to that pair of braces, and it holds for
     * arithmetic nobody has written yet.
     *
     * All three pockets, not only the computed one: `totalRows()` and the
     * per-owner SQL add `COALESCE` of all three, so a negative in any of them
     * has the same effect on the number Greg sets a price against. Neither
     * provider figure has ever been negative — OpenRouter bills, it does not
     * refund through this column — so this constrains nothing that happens
     * today, which is exactly when a constraint is cheap to add.
     */
    check(
      "ai_calls_costs_not_negative",
      sql`(${t.creditsUsedNanos} is null or ${t.creditsUsedNanos} >= 0)
          and (${t.byokUpstreamNanos} is null or ${t.byokUpstreamNanos} >= 0)
          and (${t.computedCostNanos} is null or ${t.computedCostNanos} >= 0)`,
    ),
  ],
);

/* ------------------------------------------------------------------ chat -- */

/**
 * One conversation about one article. Reader state, so it hangs off the
 * ARTICLE and not off a revision — a re-extraction must not delete a
 * conversation, for the same reason it must not delete a comment.
 *
 * Keyed `(article_id, id)` like comments, because thread ids are minted per
 * article by the same `mintId()` and are not promised to be globally unique.
 */
export const chatThreads = spideryarn.table(
  "chat_threads",
  {
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    /** `auth.users(id)`. FK in the custom migration. */
    ownerId: uuid("owner_id").notNull(),
    /** Derived from the reader's first message rather than demanded up front. */
    title: text("title").notNull(),
    createdAt: createdAt(),
    /** Bumped on every stored message, so the list can show recent first. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

    /**
     * **The passage this conversation was started from**, as three columns.
     *
     * A selection in the prose sets all three; a paragraph's chat button sets
     * only the block; an ordinary chat sets none. See `ChatAnchor` in
     * src/types.ts for why that is a union there and not three optional fields.
     *
     * **Points at the IDENTITY**, exactly as `comments.blockId` does, and the
     * plan this came from argued against that key on a premise that was simply
     * false: a re-extraction replaces *revision blocks*, and identities are
     * never deleted (see `blockIdentities` above). Pointing here is the whole
     * reason a comment survives losing its paragraph, and a conversation has
     * strictly more to lose than a comment does. Hence no `on delete set null`
     * — there is no delete to react to.
     *
     * Written **on insert only**: `upsertThread`'s conflict clause does not
     * name them, for the same reason it does not name `created_at`.
     */
    anchorBlockId: text("anchor_block_id"),
    anchorQuote: text("anchor_quote"),
    anchorStart: integer("anchor_start"),

    /**
     * A question about the article, or the reader saying what they took from
     * it — which chooses the system prompt the whole conversation is answered
     * with. See docs/plans/260827ah-review-mode.md.
     *
     * **Written on insert only**, and `upsertThread`'s conflict clause does not
     * name it, for a sharper version of the reason it does not name the anchor
     * columns: every later turn of a Remember thread comes through that upsert,
     * so a stale tab sending `kind: "chat"` would turn a Remember thread into a
     * chat on its second question. The prompt would change, the list tag would
     * change, and the transcript would still read as one conversation.
     *
     * `default 'chat'` is what makes the original migration additive: every
     * thread that existed before the mode is a chat, and no backfill was needed.
     *
     * **The second value was `'review'` until 2026-09-01**, when the mode was
     * renamed to Remember. `drizzle-kit generate` cannot see a check expression
     * on its own, and it cannot see a data movement at all, so
     * drizzle/0048_rename_review_thread_kind.sql was hand-completed: DROP the
     * constraint, UPDATE the rows, then re-ADD it. Re-adding a narrowed CHECK
     * validates it against the rows already there, so the order is the whole
     * point — the other order passes on an empty container and fails wherever
     * there is history.
     * docs/plans/260901d-rename-review-mode-to-remember-mode-everywhere.md.
     *
     * **The third value, `'candidates'`, arrived on 2026-09-01** with Referee
     * mode's fourth sub-mode — drizzle/0050_candidates_thread_kind.sql. That one
     * is the *safe* direction of the same move: every row already in the table
     * satisfies a wider CHECK, so the drop and the re-add need nothing between
     * them and the migration cannot fail on history. The order still matters for
     * the reason above, which is why it is spelled out there and not repeated
     * here.
     */
    kind: text("kind").notNull().default("chat"),
  },
  (t) => [
    primaryKey({ columns: [t.articleId, t.id] }),
    check("chat_threads_id_format", sql`${t.id} ~ ${sql.raw(`'${SPIDERYARN_ID_REGEX}'`)}`),
    /* A quote is meaningless without the block it sits in. */
    check(
      "chat_threads_anchor_quote_needs_block",
      sql`${t.anchorQuote} is null or ${t.anchorBlockId} is not null`,
    ),
    /* Both or neither. Half an anchor is a mark drawn a few characters to the
       left of the words it belongs to — wrong, and wrong in a way that looks
       like a styling glitch. Same rule, same reason, as
       `chat_messages_attempt_both`. */
    check(
      "chat_threads_anchor_both",
      sql`(${t.anchorQuote} is null) = (${t.anchorStart} is null)`,
    ),
    check(
      "chat_threads_anchor_start",
      sql`${t.anchorStart} is null or ${t.anchorStart} >= 0`,
    ),
    /* These checks are necessary and nowhere near sufficient, which is worth
       saying next to them: a malformed id, an empty quote, an offset past the
       end of the block, and a quote that is not the text at that offset all
       pass every one of them. Format and existence are the foreign key's job;
       the rest is route validation against the rendered block. */
    foreignKey({
      name: "chat_threads_anchor_identity_fk",
      columns: [t.articleId, t.anchorBlockId],
      foreignColumns: [blockIdentities.articleId, blockIdentities.blockId],
    }),
    check("chat_threads_kind", sql`${t.kind} in ('chat','remember','candidates')`),
  ],
);

/**
 * One turn of a conversation. **A row, not an element of a JSONB array**, and
 * this is the clearest "a feature owns a row" in the codebase: a message is
 * individually created, retried, edited and stopped.
 *
 * `ordinal` IS conversation order, written from the array index — for exactly
 * the reason `revisionBlocks.ordinal` exists. `createdAt` cannot do the job:
 * a user turn and the pending assistant turn that answers it are written
 * together and collide within the millisecond. It is also what makes "editing a
 * question discards every turn after it" a `delete where ordinal > n` rather
 * than a scan.
 *
 * **No foreign key from the block ids this message cites**, and that is
 * deliberate. Those ids live inside prose, and they are the *model's claims*
 * about blocks rather than an anchor our code wrote. `src/web/ChatPanel.tsx`
 * already renders a citation the article does not have as plain text rather
 * than a chip. An FK would turn a wrong id into a rejected write that loses the
 * whole answer — the failure shape the summaries' partial salvage exists to
 * prevent. Contrast `comments`, whose `blockId` IS the anchor and IS keyed.
 */
export const chatMessages = spideryarn.table(
  "chat_messages",
  {
    articleId: uuid("article_id").notNull(),
    threadId: text("thread_id").notNull(),
    id: text("id").notNull(),
    ordinal: integer("ordinal").notNull(),
    role: text("role").notNull(),
    text: text("text").notNull(),
    /** Written before the model is called, so a crash leaves a visible unfinished turn. */
    status: text("status").notNull(),
    citations: jsonb("citations").$type<Citation[]>(),
    /** How many web searches it ran. 0 means it answered from the article. */
    searches: integer("searches"),
    /**
     * The tools this answer ran, in order — see docs/project/chat-tools.md.
     *
     * `jsonb` rather than a `chat_message_tools` table, and that is the same
     * call `citations` above made: a run is read only ever as *the whole list
     * for one message*, never queried across messages, never joined to, never
     * ordered by anything but its own position. A table would buy a foreign key
     * over data nothing else references and cost a join on every read.
     *
     * Null, not `[]`, when the answer used none — matching the filesystem store,
     * which omits the key. The two have to agree byte for byte or
     * tests/store-roundtrip.test.ts fails, which is exactly how this column came
     * to exist: chat grew tools, `chat.json` grew the field, and the Postgres
     * store dropped it silently on the way through.
     */
    tools: jsonb("tools").$type<ToolRun[]>(),
    model: text("model"),
    error: text("error"),
    /**
     * The reader pressed stop, so this answer is short on purpose.
     *
     * A flag rather than a fourth status, and the distinction is the whole
     * point: a stopped answer is `done`. Nothing went wrong, so it must not
     * render as a failure, be swept, or be retried — but it does need to say
     * so, because an answer ending mid-sentence reads exactly like a bug.
     */
    stopped: boolean("stopped").notNull().default(false),
    /**
     * **Passages a spoken answer pointed at instead of citing in words.**
     *
     * `jsonb` and nullable, for exactly the reasons `tools` above gives at
     * length: read only as the whole list for one message, never queried
     * across messages, never joined to. Null — not `[]` — when the answer
     * pointed at nothing, because the filesystem store omits the key and
     * tests/store-roundtrip.test.ts compares the two byte for byte. That test
     * is how `tools` was caught going missing, and this column is the same
     * shape of thing arriving by the same door.
     *
     * See `ChatMessage.passages` in src/types.ts for why this is not folded
     * into `citations` and not spliced into the text.
     */
    passages: jsonb("passages").$type<{ blockIds: string[]; why: string }[]>(),
    /**
     * **The reader talked over this answer, so it may contain words nobody
     * heard.**
     *
     * Beside `stopped` and shaped like it — `notNull().default(false)`, so
     * every existing row reads as "not interrupted", which is true of all of
     * them. The two flags mean opposite things about history: a stopped
     * answer's text is what the reader read and is kept; this one's tail is
     * words the realtime server generated and then truncated out of the audio,
     * so `recentHistory` in src/converse.ts drops the pair.
     */
    interrupted: boolean("interrupted").notNull().default(false),
    /** When the reader last rewrote this. User turns only; the old text is not kept. */
    editedAt: timestamp("edited_at", { withTimezone: true }),
    /**
     * Which stance produced this answer — review threads, assistant rows only.
     *
     * **Written with the PENDING row, never on finish**, which is the whole
     * rule and the reason it is a column rather than something derived. An
     * answer that crashed, errored, was stopped, or was buried by the sweep
     * still has to say which instruction produced the words that did arrive,
     * and a retry of that row inherits this field by name. Writing it on finish
     * would leave every one of those blank.
     *
     * Null on every chat answer and every user turn, matching the filesystem
     * store, which omits the key — `tests/store-roundtrip.test.ts` compares the
     * two byte for byte, which is how `tools` was caught going missing.
     */
    stance: text("stance"),
    /**
     * **The reader pressed the "?" beside a paragraph rather than typing.**
     * User rows only.
     *
     * Report 1R's metadata, and a column of its own rather than a fourth
     * `chat_threads.kind` — the refusal that keeps a help conversation an
     * ordinary anchored chat, and therefore keeps every mark the reading view
     * draws a chat. See `ChatMessage.help` in src/types.ts for why it is on the
     * message rather than on the thread; the short version is that a retry has
     * to inherit it, and a thread-level flag would have had to be refused.
     *
     * `notNull().default(false)`, shaped like `stopped` and `interrupted` beside
     * it, so every existing row reads as "not a help press" — which is true of
     * all of them except the "?" presses of 2026-09-04..05. Those are **not**
     * backfilled: the only way to find them is to match stored question text
     * against two historical wordings, and that is a heuristic rewrite of real
     * readers' rows. The preflight `SELECT` and the exact `UPDATE` are Greg's to
     * run or refuse. docs/plans/260905c-gutter-comment-chip-explanation-metadata-and-prompt.md.
     */
    help: boolean("help").notNull().default(false),
    createdAt: createdAt(),

    /**
     * **Which attempt is producing this answer.** Same rule, same reason, as
     * `search_runs` — see the long note there.
     *
     * Chat needs it *more*, not less. A retry keeps the message id, because
     * that is what makes it a retry rather than a new turn: everything already
     * pointing at the answer goes on pointing at it. So identity cannot be the
     * fence. Process A starts an answer, process B's sweep buries it, the
     * reader retries into the same row, A's model call returns — and a finish
     * matching on `(article, thread, message)` writes the dead answer over the
     * live one while the reader watches.
     *
     * Null on a finished message, and on every imported one: `chat.json` never
     * recorded an attempt.
     */
    attemptId: text("attempt_id"),
    attemptStartedAt: timestamp("attempt_started_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.articleId, t.threadId, t.id] }),
    /* Both columns or neither: half an attempt is a message that can never be
       swept (no age) or never be finished (no id), and both end as a spinner
       nobody can clear. */
    check(
      "chat_messages_attempt_both",
      sql`(${t.attemptId} is null) = (${t.attemptStartedAt} is null)`,
    ),
    unique("chat_messages_thread_ordinal").on(t.articleId, t.threadId, t.ordinal),
    check("chat_messages_role", sql`${t.role} in ('user','assistant')`),
    check("chat_messages_status", sql`${t.status} in ('pending','done','error')`),
    check("chat_messages_ordinal", sql`${t.ordinal} >= 0`),
    check(
      "chat_messages_stance",
      sql`${t.stance} is null or ${t.stance} in ('balanced','respond','socratic','signposts')`,
    ),
    /* A stance is an instruction to the model, so only the model's own rows may
       carry one. Without this, a bug that wrote it onto the reader's message
       would be invisible: nothing reads it there, and the transcript would look
       right. */
    check(
      "chat_messages_stance_assistant_only",
      sql`${t.stance} is null or ${t.role} = 'assistant'`,
    ),
    /* The mirror of the rule above it, and there for the same reason: `help`
       describes the reader's own request, so only the reader's rows may carry
       one. Without this a bug that wrote it onto the answer would be invisible —
       nothing reads it there, and the transcript would look right. */
    check("chat_messages_help_user_only", sql`${t.help} = false or ${t.role} = 'user'`),
    foreignKey({
      name: "chat_messages_thread_fk",
      columns: [t.articleId, t.threadId],
      foreignColumns: [chatThreads.articleId, chatThreads.id],
    }).onDelete("cascade"),
  ],
);

/* ---------------------------------------------------------------- search -- */

/**
 * One saved meaning-search: what the reader asked for, and what came back.
 *
 * Reader state, article-scoped, `(article_id, id)` — the same shape as comments
 * and chat threads for the same reasons.
 *
 * **`hits` stays JSONB.** A run's hits are one model call's wholesale output:
 * generated together, replaced together, never edited one at a time. Splitting
 * them into rows would buy only a foreign key onto `block_identities`, and that
 * is a key we specifically do not want — see the note on `chatMessages`. A
 * `SearchHit.blockId` is the model's claim about a block, and `src/quote-match.ts`
 * already re-finds the quote rather than trusting it. Rejecting the write
 * because one hit of ten named a block that is not there would be much worse
 * than rendering nine.
 *
 * Only the *meaning* half of search has a stored shape at all. Matching on the
 * letters you typed happens in the browser and is fully described by `?find=`
 * in the URL; a stored one would be a cache of an instant computation.
 */
export const searchRuns = spideryarn.table(
  "search_runs",
  {
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    /** `auth.users(id)`. FK in the custom migration. */
    ownerId: uuid("owner_id").notNull(),
    /** What the reader typed, in their own words. **Never logged** — it is prose. */
    criterion: text("criterion").notNull(),
    /** Written before the model is called, so a crash leaves a visible unfinished run. */
    status: text("status").notNull(),
    hits: jsonb("hits").$type<SearchHit[]>().notNull().default([]),
    model: text("model"),
    error: text("error"),
    createdAt: createdAt(),

    /**
     * **The article this run was answered against** — `hashBlocks`,
     * src/source-hash.ts, sixteen hex characters.
     *
     * Without it a saved search survives a re-extraction still presenting
     * itself as an answer about *this* article: hits whose blocks are gone are
     * silently dropped and the rest may quote text that has moved. Nothing
     * about that has a symptom. The same field, the same function and the same
     * word for it as `tweet_threads`, the glossary and the summaries carry —
     * one definition of "current" for the whole article, which is the reason
     * src/source-hash.ts exists.
     *
     * Nullable for the two cases where there is honestly no answer: a run
     * imported from a `searches.json` written before 2026-08-26, and an article
     * whose blocks could not be read at the moment the run started. Null counts
     * as **stale** (`isStale`, src/searches.ts) — not knowing is not the same as
     * knowing it is fine.
     */
    sourceHash: text("source_hash"),

    /**
     * **Which attempt is in flight, so a second server cannot kill it.**
     *
     * `src/searches.ts` sweeps stale `pending` runs by asking an in-process
     * `Set` which ones it started. That works for one server on one disk and
     * breaks the moment two processes share a database, which on Vercel is not
     * an edge case but the ordinary shape: process A takes the POST, process B
     * takes a GET a second later, sees A's `pending` run in nobody's set, and
     * marks it `error`. The reader retries. A's model call then returns and
     * `finishRun` — matching on identity alone — overwrites the retry with the
     * older answer.
     *
     * So the attempt gets an identity of its own. The sweep may only error an
     * attempt whose `attempt_started_at` is genuinely old, and `finishRun` may
     * only write to the attempt it started: `where id = $ and attempt_id = $
     * and status = 'pending'`. Naming the status as well as the identity is the
     * rule step 12's job lease arrives at independently — a conditional write
     * must say what it expects to find, not only what it wants to change.
     *
     * Nullable because an imported run has no attempt: it is finished, and
     * `data/<slug>/searches.json` never recorded one. GPT Sol's review called
     * this the single change that most reduces risk in step 10.
     */
    attemptId: text("attempt_id"),
    attemptStartedAt: timestamp("attempt_started_at", { withTimezone: true }),

    /**
     * **The palette slot the reader picked** — null means "whichever one the
     * hash gives it", which is every run written before 2026-08-27.
     *
     * The one column on this table that neither the model nor the pipeline
     * writes: it is the reader's own choice, from Greg's ask on 2026-08-27.
     *
     * **The database does not know what colour this is, and that is on
     * purpose.** The eight hues live in styles/colourscales.css and the
     * slot-to-hue step happens in the browser (src/web/hit-colours.ts § the
     * seam). So the check below bounds it loosely rather than at the size of
     * today's palette: a value past the end of the palette is ignored by
     * `assignSlots` and the row falls back to its automatic hue, which is the
     * safe way to be wrong. A tight check would instead refuse a reader's
     * choice the day the palette grows, from a constraint nobody thought to
     * migrate. `MAX_STORED_COLOUR`, src/searches.ts, is the same number.
     */
    colour: integer("colour"),
  },
  (t) => [
    primaryKey({ columns: [t.articleId, t.id] }),
    check("search_runs_status", sql`${t.status} in ('pending','done','error')`),
    check("search_runs_id_format", sql`${t.id} ~ ${sql.raw(`'${SPIDERYARN_ID_REGEX}'`)}`),
    check("search_runs_colour", sql`${t.colour} is null or (${t.colour} >= 0 and ${t.colour} < 64)`),
    /* An attempt is both columns or neither. Half of one is a run that either
       cannot be swept (no age) or cannot be finished (no id), and both of those
       fail by leaving a `pending` row on the reader's screen for ever. */
    check(
      "search_runs_attempt_both",
      sql`(${t.attemptId} is null) = (${t.attemptStartedAt} is null)`,
    ),
  ],
);

/* ------------------------------------------------------ glossary lookups -- */

/**
 * "Check this term on the web" — the model's answer about one glossary entry.
 *
 * **A table, and article-scoped rather than revision-scoped.** Both halves
 * matter. Article-scoped because a lookup is reader state that must survive the
 * glossary being regenerated, which is the whole subject of
 * src/glossary-lookups.ts. A table rather than one JSONB map because the map
 * has a read-modify-write race — two lookups finishing close together, or one
 * landing while a glossary job is writing — and a row upsert deletes that race
 * for free rather than carrying the file's bug into Postgres.
 *
 * **No foreign key on `entryId`**, because there is no entries table to point
 * at and there should not be: the glossary stays a document. A lookup whose
 * entry was deduped away on a regeneration is simply not attached at read time,
 * exactly as today.
 *
 * What this table does change is the status of an entry id. The comment on
 * `articleRevisions.glossary` used to call them an implementation detail; they
 * are a promise now, because this row and the `?term=` URL both address one.
 */
export const glossaryLookups = spideryarn.table(
  "glossary_lookups",
  {
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    /** A `GlossaryEntry.id`, minted by the same `mintId()` as everything else. */
    entryId: text("entry_id").notNull(),
    /** `auth.users(id)`. FK in the custom migration. */
    ownerId: uuid("owner_id").notNull(),
    answer: text("answer").notNull(),
    /** Every URL passed `safeUrl` before it was stored. */
    citations: jsonb("citations").$type<Citation[]>().notNull().default([]),
    /**
     * How many web searches the model chose to run — **`0` is a real answer**,
     * not a missing one, so this is `not null` rather than nullable.
     */
    searches: integer("searches").notNull(),
    model: text("model").notNull(),
    /** ISO 8601 on the artefact: an answer is about the web on the day it was asked. */
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.articleId, t.entryId] }),
    check(
      "glossary_lookups_entry_id_format",
      sql`${t.entryId} ~ ${sql.raw(`'${SPIDERYARN_ID_REGEX}'`)}`,
    ),
    check("glossary_lookups_searches", sql`${t.searches} >= 0`),
  ],
);

/* -------------------------------------------------------- reader profile -- */

/**
 * "About you" — the global half of docs/plans/260826t-reader-profile.md, true on
 * every article rather than on one. `ShelfState.purpose` on `articles` above
 * is the other half; src/profile.ts joins the two into one string a prompt
 * can carry.
 *
 * `ownerId` IS the primary key, not a foreign key on a surrogate id: there is
 * exactly one profile per reader, so there is nothing for a second key to
 * distinguish. `src/store/pg-reader.ts` upserts on it — see
 * src/store/pg-lookups.ts for the same shape used for the same reason.
 *
 * **It is the reader's row rather than only their prose**, which is what makes
 * `experimental_since` below belong here rather than in a settings table of its
 * own: one nullable column on a row that already exists, against a table, a
 * foreign key and a join, for one switch. Revisit at three or four settings.
 */
export const readerProfiles = spideryarn.table("reader_profiles", {
  /** `auth.users(id)`. FK in the custom migration, as with every other `owner_id`. */
  ownerId: uuid("owner_id").primaryKey(),
  /** Absent (no row) and empty are treated the same by src/profile.ts; this
      column is simply `null` for "never written". */
  profile: text("profile"),
  /**
   * **Experimental features: null is off, a timestamp is on since then.**
   *
   * A nullable `timestamptz` rather than a `boolean not null default false`, at
   * Greg's direction and for the reason docs/project/sql.md now states
   * generally: the same storage carries strictly more of the truth. "On" and
   * "on since Tuesday" are one column; "on" and a second `experimental_set_at`
   * beside it are two columns that can disagree.
   *
   * Nullable also means **nothing to backfill**: every existing row is already
   * off, because off is what the absence of a date means. (A `not null default
   * false` would not have rewritten the table either — Postgres has stored a
   * constant default as metadata since 11 — but it would have put a value in
   * every reader's row to mean "nobody ever asked them".)
   *
   * `src/store/pg-reader.ts` keeps the *first* date across a re-assertion —
   * turning it on when it is already on must not move it, or the value answers
   * "when did the client last send true" instead of "since when".
   * docs/project/experimental-features.md.
   */
  experimentalSince: timestamp("experimental_since", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------------------------- feedback -- */

/**
 * **A bug report, filed by the reader who is looking at the thing that went
 * wrong.** docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md.
 *
 * Sentry hears about a *throw*. It does not hear about a summary that is subtly
 * wrong, a column that will not scroll, or a job that reports success and
 * produces nothing — and docs/reusable/silent-success.md says that last class is
 * most of what goes wrong here. The reader is the only instrument that detects
 * those, and this table is the wire from that instrument.
 *
 * ## The row is the authoritative report, which is why it holds everything
 *
 * A copy also goes to Sentry, and Sentry is the *second* destination: the row is
 * written first, and its success is what the reader is told about. So the row has
 * to be the whole report rather than a stub beside it — which is why
 * `diagnostics` and `screenshot` are stored here as well, and why an earlier
 * draft that left screenshot storage undecided was refused in review. If part of
 * a report exists only in Sentry, "the durable row is the report" is false for
 * that part.
 *
 * `mirrored_at` records that Sentry took it. The crash window between the insert
 * and the mirror is real, small, and accepted rather than engineered away; an
 * outbox is more machinery than an alpha feedback button is worth, and
 * `mirrored_at is null` is the query that finds anything stranded.
 *
 * ## One answer, and it used to be three
 *
 * *Steps to reproduce*, *what you expected*, *what you saw* were three `text`
 * columns, on the argument that "how many reports mention scrolling" should be a
 * query rather than a regex over prose — docs/project/sql.md. They are gone, and
 * the argument for splitting them turned out to be worth less than what it cost
 * at the other end. Greg, 2026-09-02:
 *
 * > It has three input boxes. I worry that will be intimidating/off-putting to
 * > users, so let's combine them into one.
 *
 * Three boxes is a form, and a form is a thing you fill in once you have decided
 * to file a bug. The reader this feature exists for is the one who was merely
 * annoyed — docs/reusable/silent-success.md is why: most of what goes wrong in
 * this app never throws, so the reader is the only instrument that detects it,
 * and an instrument you have to fill in a form to use is an instrument nobody
 * uses.
 *
 * So there is one `body`, and `kind` beside it. The three old columns were
 * **backfilled into `body` with their headings kept and then dropped** — Greg's
 * call, over keeping them as dead nullable columns:
 * docs/plans/260902m-one-feedback-box-with-a-kind-toggle-and-dictation.md.
 *
 * ## What is deliberately NOT here
 *
 * **This section used to begin with the URL**, and had gone on saying so for a
 * day after the `url` column below arrived — it was Greg's call to reverse it,
 * and the reasoning is on that column. What is still true is the *reason* the
 * vocabulary existed: this app's addresses carry `?q=` and `?find=`, which are
 * reader-typed search text, and `/add/<a whole third-party URL>`, which may
 * carry a token. So the address is now stored knowingly and the reader is told
 * so (docs/project/privacy.md § What a bug report carries), rather than kept
 * out.
 *
 * **Article prose.** The diagnostics blob carries block *ids*, never block text
 * — docs/project/block-ids.md is why an id is enough, and src/monitoring-scrub.ts
 * is why the text may not go. Greg's own question contains the argument:
 * *"presumably we already have it in our database"*.
 *
 * ## No foreign key on `slug`
 *
 * `articles.slug` is unique, so one is possible, and it is wrong. A report is a
 * historical fact about a moment; deleting the article must not delete the
 * report of the bug, and must not fail because a report exists. The slug is
 * recorded as what the reader was looking at, and it is looked up by hand
 * afterwards.
 */
export const feedback = spideryarn.table(
  "feedback",
  {
    /**
     * **Client-minted, and the idempotency key**, exactly as `comments.id` is:
     * a double-clicked Save and a retried POST carry the id the browser already
     * has, so the second one finds the first and files nothing.
     */
    id: text("id").notNull(),
    /** `auth.users(id)`. FK in a custom migration, as with every other `owner_id`. */
    ownerId: uuid("owner_id").notNull(),
    /**
     * **A snapshot of the gate's email, not a join.** `auth.users` is not ours
     * and an address can change; what we want months later is the address this
     * reader had when they wrote to us. Never a value the browser supplied.
     */
    reporterEmail: text("reporter_email").notNull(),
    /**
     * **What the reader wrote**, in one box, in their own order.
     *
     * `not null`, which is the whole of the old `feedback_says_something`: a
     * report with nothing in it is not a report, and that is now the column's
     * type rather than a constraint beside it. Reports filed before 2026-09-02
     * carry the three old answers glued together with their headings, so the
     * backfill is what made this possible — see the migration.
     */
    body: text("body").notNull(),
    /**
     * *A problem* or *a suggestion* — `FEEDBACK_KINDS` in src/types.ts.
     *
     * **Nullable, and starting unset is the design.** Greg, 2026-09-02: *"don't
     * default to Problem. Default to null/unknown."* So null means the reader
     * did not say, which is also true of every report filed before the toggle
     * existed, and the two are the same fact rather than two that have to be
     * told apart.
     */
    kind: text("kind"),
    /**
     * Whether the reader ticked *Send extra diagnostics*, recorded as its own
     * fact rather than inferred from `diagnostics` being present: "they said yes
     * and there was nothing to collect" and "they said no" are different
     * answers, and only one of them is a bug in the collector.
     */
    consented: boolean("consented").notNull(),
    /**
     * **The address the reader was at, whole** — `route_kind`, a closed
     * vocabulary of ten route names, until 2026-09-02.
     *
     * The vocabulary existed to keep the address bar out of this table, and it
     * was Greg's call to reverse that: *"I think it's fine (and even
     * advantageous) to store the url with the Feedback"*. What it cost was a
     * migration for every new page, and a 500 on a valid report whenever its
     * four hand-mirrored copies drifted. `isWebUrl` at the seam
     * (src/urls.ts) and the length CHECK below are what replace it, and this
     * column is `text` because a URL has no vocabulary to close.
     *
     * The whole address reaches Sentry too, deliberately — see
     * docs/project/privacy.md § What a bug report carries, which is where the
     * reader is told so.
     *
     * **Nullable, and that is the stale-tab case rather than laziness.** A
     * reader whose bundle was loaded before this deploy posts `routeKind` and
     * no `url` at all, and this is the one endpoint where a client and a server
     * disagreeing is likely to be the very thing they are trying to report. So
     * an old report is filed with `null` here rather than refused — the same
     * call `LEGACY_ANSWER_FIELDS` in src/routes.ts makes one field over. `null`
     * means *an old client*, and it stops meaning anything once those bundles
     * are gone.
     */
    url: text("url"),
    /** The article they were on, where there was one. No FK — see the header. */
    slug: text("slug"),
    /** `__SPIDERYARN_BUILD_COMMIT__`, so a report names a deploy and its source maps. */
    buildCommit: text("build_commit"),
    environment: text("environment").notNull(),
    /**
     * `x-vercel-id` for the submit itself — Greg's *"anything else that will
     * help us correlate it with our Vercel logs"*, and the only thing in this
     * repo that ties a browser to a line in one.
     */
    requestVercelId: text("request_vercel_id"),
    /**
     * The opt-in diagnostics, as **one opaque blob**.
     *
     * The JSONB exception docs/project/sql.md allows, and here is the sentence
     * it demands: this is a versioned artefact that only means anything as a
     * whole, its shape will change, and **no part of it is queried** — the
     * fields worth pivoting on (the route, the slug, the build, the Vercel id)
     * are columns beside it, precisely so that nothing ever needs to index into
     * this. `article_revisions.summary` is the precedent.
     */
    diagnostics: jsonb("diagnostics").$type<FeedbackDiagnosticsPayload>(),
    /**
     * Which shape `diagnostics` has. A column rather than a key inside the blob,
     * so an old report can be found without reading every blob — and so there is
     * one copy of the number rather than two that can disagree.
     */
    diagnosticsVersion: integer("diagnostics_version"),
    /**
     * A screenshot the reader pasted in — already downscaled, and capped here in
     * **decoded** bytes because client-side downscaling is not validation.
     *
     * `bytea` and not a bucket reference: it is small, it is bounded, and a
     * reference would give the report a second place to be incomplete.
     * 400,000 is `MAX_FEEDBACK_SCREENSHOT_BYTES` in src/types.ts, written out
     * here for the same reason the answer cap is. The filename and content type
     * are never stored — the route writes a constant pair, so a client-supplied
     * MIME type or filename can never be forwarded.
     */
    screenshot: bytea("screenshot"),
    /**
     * **Null until the report was handed to Sentry**, which is a different fact
     * from Sentry having taken it — and they were one column until GPT Sol's
     * code review, 2026-08-31, pointed out that the SDK sends asynchronously and
     * swallows transport failures, so the one column said *delivered* for
     * reports that went nowhere.
     */
    mirrorAttemptedAt: timestamp("mirror_attempted_at", { withTimezone: true }),
    /** Null until Sentry **acknowledged** it. See the header on the crash window. */
    mirroredAt: timestamp("mirrored_at", { withTimezone: true }),
    sentryEventId: text("sentry_event_id"),
    createdAt: createdAt(),
  },
  (t) => [
    /**
     * **The composite key IS the idempotency key**, the same shape
     * `comments` uses for the same reason: the id is minted by a browser, so it
     * is unique within the thing it was minted for and not globally. One
     * constraint doing both jobs rather than a surrogate key plus a unique
     * index that nothing else ever uses.
     */
    primaryKey({ columns: [t.ownerId, t.id] }),
    /** The same CHECK every other minted id is held to — `mintId()`, one regex. */
    check("feedback_id_format", sql`${t.id} ~ ${sql.raw(`'${SPIDERYARN_ID_REGEX}'`)}`),
    /**
     * **The closed vocabulary, written out by hand** — like `comments_status`
     * and `checkpoints_namespace` above, and unlike the temptation.
     *
     * `FEEDBACK_ENVIRONMENTS` in src/types.ts is the same list, and building
     * this constraint *from* that array was tried and reverted: it would make
     * this file import src/types.ts at **runtime**, and
     * src/store/public-slug.ts imports this one — so the public read path's
     * import graph would grow a node, which tests/public-imports.test.ts calls a
     * regression whatever the node is.
     *
     * So the list is in two places, and the drift is caught **behaviourally**
     * instead: tests/feedback-store.test.ts files a report under every value of
     * the union and watches the database take it. A value added to the union and
     * not to the CHECK below goes red there, at the insert, which is where it
     * would have hurt.
     *
     * **There were two of these until 2026-09-02.** `feedback_route_kind` held
     * ten route names, and it is gone with the column — see `url` above for why,
     * and note the shape of the argument, because it applies to the next
     * constraint somebody is tempted to write: a vocabulary that has to be
     * widened by migration every time the product grows a page is a vocabulary
     * whose escape hatch gets used, and an escape hatch in use is worse data
     * than no constraint.
     */
    check(
      "feedback_environment",
      sql`${t.environment} in ('production', 'preview', 'development', 'test')`,
    ),
    /**
     * **Non-empty and capped**, which is the whole of what this column
     * promises. `MAX_FEEDBACK_URL_CHARS` in src/types.ts is the same 2048, and
     * it is written out here for the runtime-import reason above.
     *
     * That the value is an `http(s)` address is `isWebUrl`'s job at the route,
     * not this constraint's: a URL grammar in SQL would be a second, worse
     * parser, and the one place that decides what a web URL is already exists.
     */
    check(
      "feedback_url_shape",
      sql`${t.url} is null or (length(btrim(${t.url})) > 0 and length(${t.url}) <= 2048)`,
    ),
    /**
     * Non-empty when present, and **capped**.
     *
     * The cap is the one that matters: it is what stops one paste of an entire
     * article becoming an attachment on its way to Sentry. In the database as
     * well as in the route, because a rule enforced in TypeScript holds only for
     * the callers that went through that TypeScript.
     *
     * **4,000 is `MAX_FEEDBACK_ANSWER_CHARS`** in src/types.ts, which is where
     * the dialog's `maxlength` and the route's refusal read it from. Written out
     * here rather than imported for the reason the vocabularies above are — and
     * pinned to that constant behaviourally by tests/feedback-store.test.ts,
     * which writes exactly the cap and exactly one character more.
     *
     * **12,072 is `MAX_FEEDBACK_BODY_CHARS`, and it is deliberately not 4,000.**
     * The cap the reader meets is `MAX_FEEDBACK_ANSWER_CHARS` — the route
     * refuses more and the dialog says so — but the backfill glued three
     * separately-capped answers under their headings, and three full ones come
     * to exactly this. A 4,000 CHECK would either fail the migration on a row
     * that was legal when it was filed, or force it to truncate, which throws
     * away something a reader wrote. GPT Sol's review of the plan, 2026-09-02.
     */
    check(
      "feedback_body_shape",
      sql`length(btrim(${t.body})) > 0 and length(${t.body}) <= 12072`,
    ),
    /**
     * The third closed vocabulary, written out by hand for the reason the two
     * above are. `FEEDBACK_KINDS` in src/types.ts is the same list, and
     * tests/feedback-store.test.ts files a report under every value of it.
     *
     * **Null is a member of the domain and not of the list**: it means the
     * reader did not say, which is what the toggle starts as.
     */
    check("feedback_kind", sql`${t.kind} is null or ${t.kind} in ('problem', 'suggestion')`),
    check("feedback_reporter_email", sql`length(btrim(${t.reporterEmail})) > 0`),
    /**
     * **Diagnostics cannot exist without consent.** The tick-box is the whole
     * argument for this feature being an exception to
     * src/monitoring-scrub.ts's rule, so it is a constraint rather than an
     * intention: a row that carries diagnostics the reader did not agree to is
     * a state this database does not have.
     *
     * The screenshot is deliberately not covered. Pasting a picture into the
     * box *is* the consent for that picture, and it is a separate act from the
     * tick-box — gating it on `consented` would refuse a report a reader
     * knowingly assembled.
     */
    check("feedback_diagnostics_consented", sql`${t.consented} or ${t.diagnostics} is null`),
    /** The blob and its version arrive together or not at all. */
    check(
      "feedback_diagnostics_version",
      sql`(${t.diagnostics} is null) = (${t.diagnosticsVersion} is null)`,
    ),
    check(
      "feedback_screenshot_size",
      sql`${t.screenshot} is null or octet_length(${t.screenshot}) <= 400000`,
    ),
    /**
     * An event id without a time it was mirrored would be a row that says Sentry
     * both did and did not take this. `markMirrored` writes both in one
     * statement; this is what makes that the only possibility.
     */
    check(
      "feedback_mirrored_pair",
      sql`${t.sentryEventId} is null or ${t.mirroredAt} is not null`,
    ),
    /**
     * **Delivered implies attempted.** A row saying Sentry acknowledged a report
     * we never handed over is the state this pair of columns exists to make
     * impossible, so it is a constraint rather than an ordering somebody
     * remembers in src/feedback.ts.
     */
    check(
      "feedback_mirror_attempted_first",
      sql`${t.mirroredAt} is null or ${t.mirrorAttemptedAt} is not null`,
    ),
    /**
     * **The rate cap's only query**, and the reason it can be a `count` rather
     * than a scan: a fixed number of reports an hour, per owner, counted over
     * `(owner_id, created_at)` inside the transaction that is about to insert.
     * src/store/pg-feedback.ts.
     */
    index("feedback_owner_created_idx").on(t.ownerId, t.createdAt),
  ],
);

/* ----------------------------------------------------------- checkpoints -- */

/**
 * **Work a failed attempt already paid for, so the next attempt does not buy it
 * again.** The Postgres home of `labels-progress.json` and `pdf-chunks/<key>.json`
 * — docs/plans/260827aa-delete-the-importer.md § B3.
 *
 * ## The key is the article and the question, never the revision
 *
 * A retry is a **new job** (src/jobs.ts), and a new job begins a new draft
 * revision. So a checkpoint keyed on `revision_id` is written on every run and
 * read on none, and the only symptom is a larger bill — the plan's own § *B3's
 * key is not the revision* says this at length. `article_id` is stable across
 * every attempt, so it may be in the key and `revision_id` may not.
 *
 * `key` is a caller-supplied content address — a digest over everything the
 * work was about. Nothing here interprets it, and nothing may start to: what
 * makes an entry reusable is that the question is identical, and what makes it
 * unusable is that the question changed. Both are the same sentence, which is
 * why no part of this table ever has to invalidate anything.
 *
 * ## Why `article_id` and not a globally shared row
 *
 * A pure content address with no article would let two readers who uploaded the
 * same PDF share one transcription. That is not today's behaviour — the labels
 * checkpoint already gates on `slug`, and `pdf-chunks/` already lives inside
 * `data/<slug>/` — so removing the article would be *adding* cross-reader
 * sharing, which nobody asked for and which would need its own argument about
 * what a cache hit tells a stranger. Scoping to the article keeps every reuse
 * that matters (every retry, and every re-run of the same article) and costs
 * only the reuse nobody has ever had.
 *
 * ## And therefore no `owner_id`
 *
 * `article_id` is `not null`, so every row belongs to exactly one article, and
 * `articles.owner_id` is the owner. That is the rule src/owner.ts states and
 * `revision_blocks`, `revision_step_runs` and `block_identities` all follow:
 * carrying the owner twice is a second copy to disagree with the first.
 * `ai_calls` is the documented exception because its `article_id` is `on delete
 * set null` and half its rows have no article at all — neither is true here.
 *
 * `on delete cascade` is doing privacy work, not tidiness: a checkpoint holds a
 * transcription of the reader's own document, and deleting the article has to
 * take it with it rather than leave it for a sweep.
 *
 * ## Retention
 *
 * `last_used_at` is bumped on every hit as well as on the write, because
 * `created_at` cannot tell a hot cache entry from a dead one — an article
 * re-read every week would be swept on its birthday. The sweep is
 * `scripts/checkpoints-sweep.ts`; nothing schedules it yet, and
 * docs/plans/260827aa-delete-the-importer.md § B3 says why that is safe.
 */
export const checkpoints = spideryarn.table(
  "checkpoints",
  {
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    /**
     * Which checkpoint this is. **Deliberately not a `StepName`** — `labels` is
     * not a step (the `revision_step_runs_step` CHECK rejects it, and the plan
     * has already been bitten once by that), and two different checkpoints
     * under one step name would share a key space for no reason. A closed set,
     * with the CHECK below, for the same reason `revision_step_runs_step` is
     * closed: a typo would otherwise open a namespace nothing ever reads.
     */
    namespace: text("namespace").notNull(),
    /** The content address. Opaque here; `CHECKPOINT_KEY_RE` in src/store/checkpoints.ts. */
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    createdAt: createdAt(),
    /** When something last asked this question and got this answer. */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.articleId, t.namespace, t.key] }),
    /**
     * **The other copy of `CheckpointNamespace`** (src/store/checkpoints.ts),
     * and the two are checked against each other by *"the checkpoints namespace
     * CHECK lists exactly the namespaces the type has"* in
     * tests/db-schema.test.ts. Adding a name to the union without adding it here
     * is a write Postgres refuses — and the callers deliberately treat a failed
     * checkpoint write as a `warn`, so the only symptom would be the bill.
     */
    check(
      "checkpoints_namespace",
      sql`${t.namespace} in ('hierarchy-deepen','hierarchy-labels','hierarchy-structure','pdf-chunk')`,
    ),
    /**
     * The same rule as `CHECKPOINT_KEY_RE`, here as well, because the
     * filesystem adapter turns this string into a **file name**. A key the
     * database would take and the filesystem would not is a divergence that
     * shows up as one store working and the other quietly not — and no dot is
     * allowed at all, so `..` is impossible by construction rather than by a
     * second check. Lower case only: macOS filesystems are case-insensitive, so
     * two keys differing only in case would be one file and two rows.
     */
    check("checkpoints_key_format", sql`${t.key} ~ '^[a-z0-9][a-z0-9_-]{0,127}$'`),
    /** The sweep's only query. */
    index("checkpoints_last_used_at").on(t.lastUsedAt),
  ],
);

/* --------------------------------------------------------------- billing -- */

/**
 * **What we sell — as rows, so it can be changed without a deploy.**
 *
 * Greg's call, 2026-09-02, asked for after the tiers had already been built as
 * constants: *"instead of adding them as environment variables, could we add
 * them to the database, so that it's easier to modify (e.g. for agents, in UI,
 * etc)"*. He was offered ids-only, ids-and-quotas, or the whole table, and took
 * the whole table with the costs stated.
 *
 * **This table is the source of truth and Stripe follows it.** Edit a row (or
 * insert one), run `npx tsx scripts/stripe-setup.ts --apply`, and the script
 * creates or replaces the Stripe product and price to match and writes
 * `stripe_price_id` back. Nothing is ever pasted into an environment file, on
 * any machine — which is the whole point, and why `STRIPE_PRICE_READER` and its
 * siblings are gone.
 *
 * ## What that bought, and what it cost
 *
 * `PaidTier` used to be a TypeScript union of two literals, so the compiler
 * refused an unknown tier and `tests/billing-tiers.test.ts` could check the
 * invariants over constants. Tier ids are now strings from a database and none
 * of that is available. The invariants did not go away; they moved **into the
 * schema**, where they hold for every writer including a hand-typed `UPDATE` at
 * midnight, which is what docs/project/sql.md § *Get the database to do the
 * work* asks for. See the CHECKs below.
 *
 * The one invariant a CHECK cannot express — a dearer tier must not allow fewer
 * ingests, which is a statement about *pairs* of rows — is asserted in
 * `tests/billing-tiers.test.ts` against the seeded rows instead.
 *
 * ## Sold, not merely defined
 *
 * `stripe_price_id` is null until the setup script has run. A tier with no
 * price cannot be sold and is not offered — `entitlementForRow` will never
 * match a subscription to it, because matching happens by price id.
 */
export const billingTiers = spideryarn.table(
  "billing_tiers",
  {
    /**
     * Internal id — `reader`, `researcher`. Appears in logs and in
     * `billing_accounts` reporting, never to a customer.
     *
     * The primary key rather than a surrogate uuid: it is a short stable name
     * chosen by a person, it is what a human editing this table will type, and
     * a second key would only add a number to remember.
     */
    id: text("id").primaryKey(),
    /** Customer-visible, on the Stripe product and the Checkout page. */
    productName: text("product_name").notNull(),
    description: text("description").notNull(),
    /** New article ingests allowed per billing period. */
    ingestsPerPeriod: integer("ingests_per_period").notNull(),
    /**
     * The stable handle Stripe indexes, and what makes the setup script
     * idempotent. **Never change one on a tier that has been sold**: it is how
     * a re-run finds the price it made last time rather than minting a second
     * one that nobody notices until two customers are on different prices.
     */
    lookupKey: text("lookup_key").notNull(),
    /** Written back by the setup script. Null means "not yet created in Stripe". */
    stripePriceId: text("stripe_price_id"),
    /** Which side of Stripe's test/live divide the price above came from. */
    livemode: boolean("livemode"),
    /**
     * Off the pricing page without deleting the row.
     *
     * Deleting a tier somebody is subscribed to would orphan their
     * entitlement; this is how a tier stops being *offered* while existing
     * subscribers keep working, which is the ordinary way tiers retire.
     */
    active: boolean("active").notNull().default(true),
    /** Cheapest first on the pricing page. Nothing else reads it. */
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /* A tier that allows nothing is not a tier, and a negative one would make
       every account instantly over its limit. */
    check("billing_tiers_ingests_positive", sql`${t.ingestsPerPeriod} > 0`),
    /* The id is typed by a person and reaches logs and URLs. Same shape as the
       slug rules elsewhere: lower-case, no spaces, no surprises. */
    check("billing_tiers_id_format", sql`${t.id} ~ '^[a-z][a-z0-9_-]{1,30}$'`),
    /* Two tiers sharing a lookup key would fight over one Stripe price on
       every run of the setup script. */
    unique("billing_tiers_lookup_key").on(t.lookupKey),
    /* And two tiers sharing a price id would make `price_id → tier` ambiguous,
       which is the lookup entitlement is decided by. */
    unique("billing_tiers_price_id").on(t.stripePriceId),
  ],
);

/**
 * **What a tier costs, one row per currency.**
 *
 * A child table rather than `amount_usd`/`amount_gbp`/`amount_eur` columns, and
 * the reason is the request this whole change came from: adding a currency has
 * to be something a person or an agent can *do*, and with columns it is a
 * migration. Here it is an insert.
 *
 * docs/project/sql.md prefers columns over JSON, and this is neither — it is
 * the ordinary relational answer to a repeating group, which is what a set of
 * per-currency amounts is.
 *
 * **Amounts are chosen, never converted at run time.** A customer seeing €8.62
 * knows they are being shown somebody else's price. The seeded numbers were set
 * at roughly GBP/USD 1.35 and EUR/USD 1.16 and rounded up to whole units,
 * landing 4–8% above spot — headroom on purpose, because Stripe prices are
 * immutable and one set at spot goes underwater on the next move.
 */
export const billingTierPrices = spideryarn.table(
  "billing_tier_prices",
  {
    tierId: text("tier_id")
      .notNull()
      .references(() => billingTiers.id, { onDelete: "cascade" }),
    /** ISO 4217, lower case, as Stripe spells it. */
    currency: text("currency").notNull(),
    /** In the smallest unit — cents, pence, cents. */
    unitAmount: integer("unit_amount").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tierId, t.currency] }),
    /* Free is the absence of a subscription, not a zero-priced one. */
    check("billing_tier_prices_amount_positive", sql`${t.unitAmount} > 0`),
    /* Stripe's currency codes are three lower-case letters. A `USD` here would
       be accepted by us and rejected by Stripe, one run of the setup script
       later and a long way from the row somebody typed. */
    check("billing_tier_prices_currency_format", sql`${t.currency} ~ '^[a-z]{3}$'`),
  ],
);

/**
 * **One row per owner, and every owner gets one** — the anchor the ingest quota
 * serialises on, whether or not anybody has ever paid.
 *
 * docs/project/billing.md, and
 * docs/plans/260902i-stripe-payments-and-subscription-tiers.md.
 *
 * ## Why a free reader has a row here
 *
 * It reads like waste — a table of subscriptions holding rows for people with
 * no subscription — and it is the whole reason the quota cannot be bypassed.
 * Admission takes `select … for update` on this row so that concurrent requests
 * for one owner are counted one at a time, and **a row lock is taken on rows
 * the statement returns, so a `for update` that matches nothing locks nothing**
 * (docs/postmortems/260901f-a-for-update-that-locks-nothing.md). The free tier
 * is exactly where the boundary matters, so exactly there the row must exist.
 * Admission creates it with `on conflict do nothing` and then locks it, which
 * is that postmortem's prescribed shape; measured on 2026-09-02, a second
 * transaction blocks for as long as the first holds it and then reads the
 * first's committed value.
 *
 * It is also where a comp subscription will live — a journalist given a free
 * month has no Stripe subscription at all, so there is nowhere else to put it.
 *
 * ## What is stored, and what is deliberately not
 *
 * Opaque Stripe ids and the few fields entitlement is derived from. **No card
 * data, ever** — hosted Checkout and the hosted Customer Portal mean none of it
 * reaches this server, which is what keeps us in Stripe's lightest PCI scope.
 * `status` is raw Stripe text rather than an enum or a CHECK: entitlement comes
 * from an allowlist in src/billing/tiers.ts, so a status Stripe invents next
 * year falls to the free tier instead of failing an insert inside a webhook.
 */
export const billingAccounts = spideryarn.table(
  "billing_accounts",
  {
    /** `auth.users(id)`. FK in the custom migration, as with every other `owner_id`. */
    ownerId: uuid("owner_id").primaryKey(),
    /**
     * The Stripe customer, once one exists. Nullable because admission creates
     * this row long before anybody visits Checkout, and **unique** because two
     * owners sharing a customer would cross two people's billing — Postgres
     * allows many nulls under a unique constraint, which is exactly the
     * behaviour wanted here.
     */
    stripeCustomerId: text("stripe_customer_id").unique(),
    /** The current subscription, if any. Unique for the same reason. */
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    /** Which price it is on — the key into the tier map. */
    priceId: text("price_id"),
    /** Raw Stripe status. See the header: an allowlist decides, not this column. */
    status: text("status"),
    /**
     * The billing period, **read from the subscription item rather than the
     * subscription** — Stripe's Basil release (2025-03-31) removed these from
     * the Subscription object. Half-open `[start, end)` everywhere that reads
     * them. src/billing/stripe.ts pins the API version that keeps this true.
     */
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    /** Cancelled, but paid up until the period ends — still entitled until then. */
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    /**
     * When Stripe will end the subscription, when an ending is scheduled.
     *
     * **Beside the boolean rather than instead of it**, because they are two
     * raw Stripe facts and neither implies the other: a cancellation through
     * the hosted Customer Portal sets this and leaves `cancel_at_period_end`
     * at `false`, which is how a real cancellation went untold on 2026-09-03
     * (docs/project/billing.md § *The first live sale*). Dropping the boolean
     * would buy nothing and lose the record of what Stripe actually said.
     *
     * A timestamp rather than a second boolean because *when* is the thing the
     * reader is owed — docs/project/sql.md. Entitlement never reads it: a
     * subscription scheduled to end is `active` and entitled until it does.
     * `planEndsAt` (src/billing-plan.ts) turns it and the boolean into the one
     * date `/profile` shows.
     */
    cancelAt: timestamp("cancel_at", { withTimezone: true }),
    /**
     * **How far a mid-period plan change moved this account's allowance**, in
     * ingests, away from what its tier sells.
     *
     * Null is the ordinary state and means *ask the tier and nothing else*.
     * Negative for an upgrade — a Reader who upgraded with three days left is
     * 117 short of a whole Researcher month — and positive for a downgrade.
     * `entitlementFromRow` (../store/pg-billing.ts) adds it to
     * `billing_tiers.ingests_per_period`, so admission still reads stored
     * integers and does no arithmetic about time under the row lock.
     *
     * **A delta and not a limit, which is the whole of the difference between a
     * tier table that still governs and one that has been opted out of.**
     * Raising a quota is one `UPDATE` and no deploy (docs/project/billing.md);
     * an account carrying an absolute 33 would have sat at 33 through every
     * future raise, for ever. What the change was *worth* does not go stale when
     * the tier moves. GPT Sol, 2026-09-04.
     *
     * It exists because **Stripe prorates the price and we handed over the
     * allowance whole**. Upgrading with an hour left of the period costs a few
     * pence and used to buy the full 150 ingests — Researcher volume at the
     * Reader price, monthly, from a script. Written only by
     * `syncSubscriptionFromStripe` (../billing/sync.ts), in the same locked
     * write as `price_id`, `stripe_subscription_id` and the period, all of which
     * the arithmetic reads. There is deliberately **no range CHECK**: the bound
     * a delta needs is a function of `billing_tiers`, which a row constraint
     * cannot see, so the clamp lives at the read in ../billing/quota-adjustment.ts
     * where the tier is known.
     */
    quotaLimitDelta: integer("quota_limit_delta"),
    /**
     * Which period the delta above belongs to.
     *
     * **Two columns rather than one**, because without this a period *roll* and
     * a mid-period *switch* are the same event seen from the row: both arrive as
     * a sync carrying a period, and only the stored start says which. It is also
     * what makes a stale delta inert — the read side applies one only when this
     * equals `current_period_start`, so a sync that forgot to clear one still
     * cannot meter anybody on last month's number.
     */
    quotaPeriodStart: timestamp("quota_period_start", { withTimezone: true }),
    /**
     * Which side of Stripe's test/live divide this row came from.
     *
     * Stored rather than inferred so that a row written by a misconfigured
     * deployment can be *seen* afterwards. A production deployment on a test
     * key would write `false` here while granting real quota, and this column
     * is the only thing that would say so — src/billing/stripe.ts refuses such
     * a key, and this is the record of what happened if it ever did not.
     */
    livemode: boolean("livemode"),
    /** When Stripe was last asked. Diagnostic; entitlement never reads it. */
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /* A period that ends before it starts would make every half-open count
       empty, which reads as "no ingests used" rather than as an error. */
    check(
      "billing_accounts_period_order",
      sql`${t.currentPeriodStart} is null or ${t.currentPeriodEnd} is null or ${t.currentPeriodStart} < ${t.currentPeriodEnd}`,
    ),
    /* A subscription belongs to a customer. A row with the second and not the
       first could only come from a bug, and it would leave the customer→owner
       mapping — the authoritative one — unreachable from the subscription. */
    check(
      "billing_accounts_subscription_needs_customer",
      sql`${t.stripeSubscriptionId} is null or ${t.stripeCustomerId} is not null`,
    ),
    /* **And the four columns a subscription writes belong to one.** They are
       written in a single `UPDATE` by `syncSubscriptionFromStripe`
       (../billing/sync.ts), all of them on every sync and all of them to null
       together, so any of them set without an id is a row nothing in this
       codebase can have produced.

       It is here because that row was **schema-valid and it spent money**.
       `status = 'active'` with a known price and a readable period made
       `entitlementFromRow` answer *paying Reader* while every "do they already
       have a subscription" test — which reads the id — said no, so `/profile`
       offered a Reader the Reader plan and pressing it would have opened a
       second, concurrently billed subscription. GPT Sol found it on 2026-09-04;
       `subscriptionState` (../billing/tiers.ts) is the code half, which fails
       closed for the same row, and this is the half that holds for every writer.

       `num_nonnulls` rather than four disjunctions, the same idiom as
       `billing_accounts_quota_delta_is_dated` below: it says the rule instead of
       encoding it. `cancel_at_period_end` is not in the list — it is `not null`
       with a default of false, so it has no "unset" to mean anything by. */
    check(
      "billing_accounts_subscription_fields_need_subscription",
      sql`${t.stripeSubscriptionId} is not null or num_nonnulls(${t.status}, ${t.priceId}, ${t.currentPeriodStart}, ${t.currentPeriodEnd}) = 0`,
    ),
    /* A delta without a period cannot be applied and a period without a delta
       says nothing, so one of the two alone is a bug rather than a state.
       `num_nonnulls` rather than a pair of disjunctions because it says the rule
       instead of encoding it — the same idiom as `ingest_events_settled_once`
       below.

       **There is no companion range check, and that is deliberate.** The
       previous column held an absolute limit and carried a `>= 0`; a delta is
       legitimately negative, and the bound it would actually need — that
       `ingests_per_period + delta` lands inside `[0, the largest tier]` — is a
       function of another table, which a row constraint cannot see. The clamp
       therefore lives at the read, in ../billing/quota-adjustment.ts, where the
       tier is in hand. */
    check(
      "billing_accounts_quota_delta_is_dated",
      sql`num_nonnulls(${t.quotaLimitDelta}, ${t.quotaPeriodStart}) <> 1`,
    ),
  ],
);

/**
 * **Every new ingest an owner is charged for, reserved before it runs and
 * settled when it ends.** One row per *attempt to spend* — not per article, and
 * not per job.
 *
 * ## Why this is not a count of jobs, or of articles
 *
 * Jobs are reader-deletable (`DELETE /api/jobs/:id`), so a quota derived from
 * job rows is erasable by the person being counted — which is the one thing an
 * abuse boundary may not be. Articles answer a different question again: they
 * can be archived, and deleting one does not refund the slot. Nothing deletes
 * from this table.
 *
 * ## The three timestamps, and why they are not one status column
 *
 * **This was written in the future tense, and the future arrived on 2026-09-03.**
 * It read "none of this is wired up yet … nothing calls them", which was true
 * when the columns landed and false a few hours later: `reserveIngest` is
 * reached from `POST /api/jobs` via `withIngestSlot`
 * ([src/billing/admission.ts](../billing/admission.ts)), and settlement runs
 * from `settleIn` ([src/store/pg-session.ts](../store/pg-session.ts)) and from
 * three places in [pg-jobs.ts](../store/pg-jobs.ts). `pg-billing.ts`'s own
 * header said "it is wired up" while this said the opposite. So what follows is
 * the contract **and** what the app does.
 *
 * `reserved_at` is set at admission, inside the transaction holding the owner's
 * `billing_accounts` lock — that write is what makes a second concurrent
 * request see the first one. `succeeded_at` is to be set in the *same* Postgres
 * transaction that publishes the revision (src/store/pg-session.ts `settleIn`,
 * the `done` branch), so that there is no window in which an ingest has
 * succeeded and not been counted, and none in which a failure has been charged.
 * `released_at` likewise, from the branch that ends a failed or cancelled job.
 *
 * Nullable timestamps rather than a status enum because a nullable timestamp
 * says more than a boolean (docs/project/sql.md): each of these is genuinely an
 * event with a moment, they can be read independently, and there is no second
 * column to disagree with the first. The CHECK below rules out the one
 * combination that is not a state.
 *
 * ## Usage, and why an unsettled reservation never expires
 *
 * An owner's usage is successes inside the period **plus** every reservation
 * that has not settled:
 *
 *     succeeded_at >= start and succeeded_at < end        -- charged
 *     succeeded_at is null and released_at is null        -- in flight
 *
 * **There is deliberately no age limit on the second clause**, and an earlier
 * draft of this table had a six-hour one. GPT Sol's review, 2026-09-02, showed
 * it was a straightforward bypass rather than a safety valve: with a limit of
 * 100, hold 100 jobs queued for six hours, reserve 100 more, and all 200 can
 * then succeed inside one period — repeatable in cohorts, and *easier* the more
 * contended the job queue is, because contention is what ages the queue. Any
 * expiry rule has to be able to prove the reservation never produced a job, and
 * the honest v1 answer is not to have one: a leaked reservation costs its owner
 * one slot, which is a support conversation, and the bypass costs unbounded
 * model spend, which is the thing this table exists to stop.
 *
 * The leak needs the process to die between the reservation committing and
 * `enqueue()` returning — every other path releases it. A reconciliation that
 * frees only reservations *provably* without a job is possible later, because
 * `jobs.ingest_event_id` makes "without a job" a query rather than a guess.
 *
 * ## Provenance lives on the job, not here
 *
 * The link is `jobs.ingest_event_id`, written by the same INSERT that creates
 * the job, and this table has no `job_id` column. That direction is the whole
 * safety argument, and the other way round was broken three ways: a job that
 * published before a follow-up `update … set job_id` landed was never charged;
 * a crash in that gap left a runnable job nobody paid for; and two duplicate
 * Adds that `enqueueOrGet` deduplicates into one job would have pointed two
 * reservations at it, so one publication settled both.
 *
 * A job with a null `ingest_event_id` — pipeline work from the CLI, a re-run of
 * one step, seeding — settles nothing and is therefore free. That is the entire
 * provenance mechanism: no flag to set, and none to forget.
 */
export const ingestEvents = spideryarn.table(
  "ingest_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** `auth.users(id)`. FK in the custom migration. */
    ownerId: uuid("owner_id").notNull(),
    reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set inside the publish transaction. Null until the ingest succeeds. */
    succeededAt: timestamp("succeeded_at", { withTimezone: true }),
    /** Set when the job failed, was cancelled, or never became a job at all. */
    releasedAt: timestamp("released_at", { withTimezone: true }),
    /**
     * **The article this charge produced** — written in the same statement that
     * sets `succeeded_at`, and null on every other kind of row.
     *
     * ## Why it had to exist
     *
     * A currently-public article costs **half** what a private one does
     * (docs/project/billing.md § *A public article counts half*), and usage is
     * recomputed live from `articles.visibility` rather than credited once — so
     * the usage query has to get from a charged row to the article it produced.
     * Before this column there was no route. `slug` is diagnostic and worse than
     * mutable: it is the pre-allocation stem for a URL add and **null** for an
     * upload. The only other path, `ingest_events → jobs.ingest_event_id →
     * jobs.slug → articles.slug`, fails at both hops — jobs are hard-deleted by
     * the reader and by the retention sweep, and a slug is not identity.
     *
     * `ai_calls.article_id` is the precedent: a real foreign key with
     * `on delete set null`. The *text-not-a-key* reasoning recorded there is
     * about `job_id`, which points at something disposable; an article is not.
     *
     * ## Nullable for ever, so the type is the only guard
     *
     * Every row charged before 2026-09-05 has no way to be backfilled, so a
     * `NOT NULL` constraint is impossible. `usageSql` therefore reads
     * `coalesce(visibility, article_visibility_at_delete, 'private')` over a
     * **left** join: a row that cannot be resolved is charged **full price**,
     * which is the direction that cannot be gamed. The guard against a future
     * caller quietly charging a public article full price for ever is in the
     * type: `settleReservation` takes a discriminated outcome that *carries* the
     * article id, so a successful settlement cannot be expressed without one.
     *
     * ## Deleting an article would silently raise its owner's usage
     *
     * `on delete set null` turns each of that article's charged rows back into
     * something unresolvable, and therefore back into full price — so a reader
     * who destroyed a public article would watch their usage go **up** for
     * having thrown something away. That is what `articleVisibilityAtDelete`
     * below and the `ingest_events_freeze_article_price` trigger exist to stop;
     * read them together with this. The alternative — `on delete restrict` —
     * would make the ledger able to veto a deletion, which is worse.
     *
     * Since 2026-09-07 the `set null` is a **backstop that finds nothing**: the
     * freeze trigger unlinks and stamps in the same `UPDATE`, so the FK's action
     * has no rows left to touch by the time it runs. It stays declared because
     * if that trigger ever drifts away the FK still unlinks — and
     * `ingest_events_require_price_on_unlink` then makes the delete fail loudly
     * rather than quietly change the bill (GPT Sol's F8).
     *
     * A deletion path must still take the owner's `billing_accounts` lock before
     * the article row (the lock order in src/store/pg-billing.ts). It no longer
     * has to *say what it will cost*, because it costs nothing.
     */
    articleId: uuid("article_id").references(() => articles.id, { onDelete: "set null" }),
    /**
     * **What the article was, at the instant it stopped existing** — `'private'`
     * or `'public'`, and null for every row whose article is still there.
     *
     * ## Why the price freezes at deletion rather than at charge
     *
     * A currently-public article costs half a slot, and usage is recomputed
     * **live** from `articles.visibility` on every read, so sharing lowers it
     * and unsharing puts it straight back. Stamping the price when the ingest is
     * charged is the design docs/project/billing.md rejects in as many words —
     * *"charging half at add time misses the article you decide to share three
     * weeks later, which is most of them"* — and it would misprice in both
     * directions. So the live column goes on winning for as long as there is
     * one, and this only answers once there is not.
     *
     * ## Not a second source of truth
     *
     * It is null while the article exists, so there is nothing here for
     * `articles.visibility` to disagree with; the two are never both readable.
     * That is the whole reason it is safe (GPT Sol, F2, 2026-09-06), and it is
     * why nothing may stamp it early. Since 2026-09-07 that is a rule the
     * database keeps rather than one the comments assert — see
     * `ingest_events_frozen_only_after_unlink` below (Sol's F9).
     *
     * ## Written by a trigger, not by the application
     *
     * `ingest_events_freeze_article_price`, a `BEFORE DELETE` on
     * `spideryarn.articles`
     * (drizzle/20260906230500_ingest_events_freeze_price_at_delete.sql) — so it
     * holds for *every* route out of existence: the store method, a future admin
     * path, a cascade, a statement somebody runs by hand. Application code that
     * has to remember is application code that will one day forget, and the
     * ledger is not a place to find that out. drizzle's snapshot knows nothing
     * about triggers, so tests/db-schema.test.ts is the drift guard.
     *
     * It stamps this column **and** nulls `article_id` in one `UPDATE`
     * (drizzle/20260907200800_ingest_events_unlink_atomically.sql), which is
     * what leaves the forbidden state unreachable rather than merely brief.
     *
     * Read by `isPublicPrice` in src/store/pg-billing.ts, which is the one
     * spelling both the quota wall and the admin page use.
     */
    articleVisibilityAtDelete: text("article_visibility_at_delete"),
    /**
     * What the article was called at the time — **diagnostic only**. A slug is
     * mutable, so it could never be this row's identity; it is here so that a
     * support conversation about "which article was that" has an answer.
     */
    slug: text("slug"),
  },
  (t) => [
    /* A reservation settles once, and only one way. `num_nonnulls` rather than
       a pair of `is null` disjunctions because it says the rule rather than
       encoding it — GPT Sol, 2026-09-02. In the database rather than in
       TypeScript because three separate code paths write these columns, and a
       rule that lives in one of them is not a rule. */
    check("ingest_events_settled_once", sql`num_nonnulls(${t.succeededAt}, ${t.releasedAt}) <= 1`),
    /* Neither terminal moment can precede the reservation it settles. Cheap,
       and it is the constraint that would catch a clock or a code path writing
       one of these from somewhere unexpected. */
    check(
      "ingest_events_settled_after_reserved",
      sql`(${t.succeededAt} is null or ${t.succeededAt} >= ${t.reservedAt})
          and (${t.releasedAt} is null or ${t.releasedAt} >= ${t.reservedAt})`,
    ),
    /* The frozen price is one of the two visibilities or nothing at all — the
       same check `articles_visibility` puts on the live column, because the
       fallback reads them as one value and a third spelling would silently be
       neither branch. Null is the ordinary state: every row whose article still
       exists, and every row charged before this column landed. */
    check(
      "ingest_events_visibility_at_delete",
      sql`${t.articleVisibilityAtDelete} is null
          or ${t.articleVisibilityAtDelete} in ('private','public')`,
    ),
    /**
     * **Never both readable, enforced rather than asserted.** The frozen price
     * is a *second* answer to what an ingest cost, and the only thing that makes
     * a second answer safe is that it is unreadable while the first one exists.
     * The vocabulary check above did not say that, so a live public article's
     * row could carry a frozen `'private'` — no wrong bill today, because
     * `isPublicPrice` reads the live column first, and a trap for whoever
     * reorders that `coalesce`. GPT Sol's F9, 2026-09-07.
     *
     * It is only a constraint the deletion path can satisfy because
     * `ingest_events_freeze_article_price` unlinks and stamps in ONE statement.
     * If it went back to stamping and letting the FK's `on delete set null`
     * unlink afterwards, the intermediate row would violate this and every
     * delete would fail — which is the loud version of the drift.
     */
    check(
      "ingest_events_frozen_only_after_unlink",
      sql`${t.articleId} is null or ${t.articleVisibilityAtDelete} is null`,
    ),
    /* The admission query, which runs on the critical path of every ingest. */
    index("ingest_events_owner_reserved").on(t.ownerId, t.reservedAt.desc()),
    /**
     * **Postgres does not index the referencing side of a foreign key**, and
     * deleting an article reads exactly this column: the freeze trigger's
     * `update ... where article_id = OLD.id`. The ledger is append-only and
     * unbounded, so without this every deletion is a sequential scan of it, and
     * the way that finally shows up is a delete exceeding the runtime role's
     * two-minute statement timeout — a symptom nobody would trace back to a
     * missing index. GPT Sol's F7, 2026-09-07.
     *
     * **Partial**, because a row with no article can never match the predicate
     * that reads this, and those are the rows that accumulate for ever.
     */
    index("ingest_events_article_id_live")
      .on(t.articleId)
      .where(sql`${t.articleId} is not null`),
    /**
     * **Redundant as a uniqueness claim, and not here for that.** `id` is
     * already the primary key, so `(id, owner_id)` cannot repeat. It exists so
     * that `jobs.ingest_event_id` can carry a *composite* foreign key against
     * `(id, owner_id)` — Postgres requires a unique constraint on exactly the
     * referenced columns — which is what makes "a job cannot spend another
     * owner's reservation" a thing the database refuses rather than a thing the
     * application remembers. GPT Sol, 2026-09-02.
     */
    unique("ingest_events_id_owner").on(t.id, t.ownerId),
  ],
);

/* -------------------------------------------------------- link previews -- */

/**
 * **What a page on the far end of a hyperlink says about itself — fetched once,
 * for everybody.**
 *
 * Hovering an external link in the prose draws a card, and until 2026-09-05 the
 * only things on it were read off the href plus two lookups that answer for a
 * minority of links (docs/project/links.md). This table is the general case: our
 * own server fetches the destination, keeps its title, its site name, its own
 * description and its opening paragraph, and every later hover of that address —
 * by that reader or any other — is a cache hit.
 * docs/plans/260905f-external-link-panel-add-to-spideryarn-and-server-side-preview.md
 * § Stage 2.
 *
 * ## This is the first ownerless table in this schema, and that is deliberate
 *
 * The comment above `checkpoints` is the argument this table has to answer: a
 * row with no article in its key would be *adding* cross-reader sharing, "which
 * nobody asked for and which would need its own argument about what a cache hit
 * tells a stranger". Here the sharing **is** the privacy feature. A per-reader
 * cache would mean the destination's server learns that some particular reader
 * looked at some particular page at some particular moment, every time; one
 * shared row means it learns that Spideryarn fetched a URL once, ever.
 *
 * What survives that argument is a **limited accepted disclosure**, and the plan
 * § *Where the sharing stops* records it as accepted rather than argued away.
 * Three specific things close the parts that would not be:
 *
 * 1. **No timestamp ever leaves the server.** `fetched_at` is here for retention
 *    and for nothing else. Returning it would tell a caller whether — and when —
 *    some prior reader caused a fetch.
 * 2. **A defined retention**, rather than living for ever by default: a row is
 *    dead once `expires_at` has passed by the sweep horizon, and nothing here is
 *    worth keeping longer than the page it describes.
 * 3. **Credential-bearing URLs are refused before they get here**, by
 *    `carriesCredential` in src/urls.ts — an exact URL plus its content in an
 *    ownerless store is the worst available home for a signed link.
 *
 * The route itself does the rest of the work: it is article-scoped, so a caller
 * can only ever cause a fetch of a URL an author published in a piece that
 * caller owns. GPT Sol, 2026-09-05, findings P1-1 and P1-7.
 *
 * ## The key is the exact request target, and NOT `urlKey`
 *
 * `target` is `requestTarget(url)` (src/urls.ts): scheme, host, port, path and
 * query, ignoring only the fragment. `urlKey` folds `http` into `https`, `www.`
 * into the bare host and drops tracking parameters, which is right for *"is this
 * the article on my shelf?"* and wrong for *"what did we ask the network for?"*.
 * Two identities, and this table holds the second one. GPT Sol, P1-2.
 *
 * ## A row is one of five things, and `outcome` says which
 *
 * The TypeScript side is a discriminated union (`CachedPreview` in
 * src/link-previews.ts); this is that union flattened, with a CHECK that keeps
 * the columns and the tag in step, so no row can be an `ok` with no title or an
 * `alias` pointing nowhere.
 *
 * - `pending` — somebody is fetching this right now, and holds the claim until
 *   `expires_at`. This is the single-flight lease: two simultaneous cold hovers
 *   would otherwise both miss, both fetch and both spend, because a unique row
 *   prevents duplicate *storage* and never duplicate *traffic*. GPT Sol, P1-4.
 * - `ok` — we have something worth showing.
 * - `transient` — a timeout, a 429, a 5xx. Short expiry, and `Retry-After` is
 *   respected where the response carried one.
 * - `permanent` — a stable 404, a 403 behind a bot challenge, a PDF, a page with
 *   nothing extractable in it. Long expiry, but still an expiry: *"cache the
 *   failure"* with no clock lets one blip poison a global row for ever. GPT Sol,
 *   P2-2.
 * - `alias` — this target redirected, and the answer is under `final_target`.
 *   Without it, infinitely many redirecting spellings of one address go on
 *   producing independent misses. GPT Sol, P1-2.
 *
 * **The CHECK enforces the union rather than describing it**, and that is a
 * correction: the first version let an alias row carry a title and a failure row
 * carry a description. No writer did either, which is exactly the state in which
 * a later partial update quietly preserves stale content and passes the
 * constraint. Three code paths write this table, and a rule that lives in one of
 * them is not a rule — the argument `ingest_events_settled_once` already makes.
 * GPT Sol, P2-3.
 */
export const linkPreviews = spideryarn.table(
  "link_previews",
  {
    /** `requestTarget(url)`. See the header — never `urlKey`. */
    target: text("target").primaryKey(),
    /**
     * Where the fetch actually ended up, for an `alias` row. Null on every
     * other kind.
     *
     * Deliberately **not** a foreign key onto `target`: the pointed-at row can
     * expire and be replaced independently, and a `references` here would either
     * forbid that or cascade an alias away with it. Following the pointer is one
     * extra select and it is allowed to miss.
     */
    finalTarget: text("final_target"),
    /** Which of the five above. The CHECK below is the closed set. */
    outcome: text("outcome").notNull(),
    /**
     * `FetchFailureCode`, or one of this feature's own classes — diagnostic
     * only, and never shown to a reader. Null unless the outcome is a failure.
     */
    failure: text("failure"),
    /** `og:title` → `twitter:title` → `<title>`. */
    title: text("title"),
    /** `og:site_name`. Often absent, and never guessed from the host. */
    siteName: text("site_name"),
    /** `og:description` → `twitter:description` → `<meta name=description>`. */
    description: text("description"),
    /**
     * Readability's opening paragraph, **only when it survived a sanity check**.
     *
     * Measured 2026-09-05: noema's comes back as the word "Credits", which is a
     * byline artefact rather than an opening. `saneParagraph` in
     * src/link-previews.ts is the check, and null here means it failed — the
     * card then falls back to `description`, which is the right answer there.
     */
    firstParagraph: text("first_paragraph"),
    /** Readability's word count for the destination. Null when it found none. */
    words: integer("words"),
    /**
     * **The opening of Readability's plain text, capped — what the summariser
     * reads, and the only column here that never reaches a card.**
     *
     * Stage 3 asks a model how this destination stands to the piece the reader
     * is holding, and Greg's spec is *"run Mozilla Readability first before
     * passing to GPT Luna"*. The alternatives were both worse: summarising from
     * the four metadata fields above gives the model a CMS blurb to paraphrase,
     * and fetching the page a second time at summary time would undo the one
     * thing this table exists for — that a destination learns of one fetch,
     * ever, rather than of one per reader.
     *
     * **It is more of exactly what is already here**, not a new kind of thing:
     * the page's own public words, under the same expiry and the same retention
     * sweep, in a table that still holds nothing about who asked.
     *
     * **Two caps, and they are different numbers on purpose.**
     * `PREVIEW_EXCERPT_CHARS` in src/link-previews.ts is what is *stored* here —
     * 8,000 — and `SUMMARY_DEST_CHARS` in src/link-summary.ts is what reaches a
     * *prompt* — 6,000. The gap is slack: a modest change to the prompt's
     * appetite must not mean refetching every destination in the cache. Cutting
     * again at the prompt is not theatre either, for the mirror of that reason:
     * a row written by a build with a larger store must not silently become a
     * larger prompt.
     *
     * Null on every row that is not an `ok`, and null on an `ok` written before
     * this column existed — in which case there is no summary for that address
     * until its preview expires and is fetched again. A degradation, deliberately,
     * rather than a refetch on the summary path.
     */
    excerpt: text("excerpt"),
    /**
     * **Retention only, and it must never reach a caller.** See the header,
     * point 1: a `fetched_at` in a response says whether and when some prior
     * reader caused a fetch.
     *
     * Spelled out rather than taken from the `createdAt()` helper every other
     * table uses, because the helper's column is `created_at` and this is not a
     * creation time: a refreshed row keeps its primary key and this moves. The
     * comments here named `fetched_at` while the column said `created_at` for
     * about an hour on 2026-09-05, which is exactly the kind of confidently
     * wrong doc this repo treats as a bug. GPT Sol, P2-4.
     */
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * **The fencing token for the single-flight claim** — the id of the claim
     * that wrote this row, and null on any row nobody is holding.
     *
     * Without it a claim is a lock with no way to tell two holders apart, and
     * GPT Sol's P1-3 walked the sequence: A claims, A stalls past its lease, B
     * reclaims, A wakes up and its `release` deletes *B's* claim. The token
     * makes both destructive operations conditional on being the holder — see
     * `release` in src/store/pg-link-previews.ts.
     *
     * **It does not make "exactly one fetch" true**, and the claim's own comment
     * says so: a stalled winner still fetches after its lease has gone. What it
     * makes true is the property that actually matters, which is that a loser
     * cannot destroy a winner.
     */
    claimId: uuid("claim_id"),
    /**
     * When this row stops being an answer.
     *
     * On a `pending` row it is the claim's lease, which is why an abandoned
     * fetch cannot wedge a URL: the next request past the lease takes the claim.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    check(
      "link_previews_outcome",
      sql`${t.outcome} in ('pending','ok','transient','permanent','alias')`,
    ),
    /**
     * **The union, as a constraint.** Three code paths write this table and a
     * rule that lives in one of them is not a rule — the same argument
     * `ingest_events_settled_once` makes one table up.
     *
     * An `alias` has a `final_target` and nothing else; a failure has a
     * `failure` and no content; an `ok` has at least one of the three things
     * worth showing, because a row with none of them is a cache hit that draws
     * an empty section, which reads as a lookup that broke.
     *
     * **`excerpt` counts as content**, so only an `ok` may carry one — which is
     * what stops a failure row keeping the text of a page it never read.
     */
    check(
      "link_previews_shape",
      sql`case ${t.outcome}
            when 'alias' then ${t.finalTarget} is not null and ${t.failure} is null
                        and ${t.claimId} is null
                        and num_nonnulls(${t.title}, ${t.siteName}, ${t.description}, ${t.firstParagraph}, ${t.words}, ${t.excerpt}) = 0
            when 'ok' then ${t.finalTarget} is null and ${t.failure} is null
                        and ${t.claimId} is null
                        and num_nonnulls(${t.title}, ${t.description}, ${t.firstParagraph}) > 0
            when 'pending' then ${t.finalTarget} is null and ${t.failure} is null
                        and ${t.claimId} is not null
                        and num_nonnulls(${t.title}, ${t.siteName}, ${t.description}, ${t.firstParagraph}, ${t.words}, ${t.excerpt}) = 0
            else ${t.finalTarget} is null and ${t.failure} is not null
                        and ${t.claimId} is null
                        and num_nonnulls(${t.title}, ${t.siteName}, ${t.description}, ${t.firstParagraph}, ${t.words}, ${t.excerpt}) = 0
          end`,
    ),
    check("link_previews_words", sql`${t.words} is null or ${t.words} >= 0`),
    /** The sweep's only query — see the retention note in the header. */
    index("link_previews_expires_at").on(t.expiresAt),
  ],
);

/* ---------------------------------------------------------- rate limits -- */

/**
 * **One row per outbound fetch a reader's pointer caused**, so a bound on how
 * many of them there may be is a bound rather than a hope.
 *
 * `GET /api/link-preview` is the first endpoint in this app where a reader
 * *hovering* something makes us contact a third party and spend, and there was
 * no inbound rate-limit helper to reuse: the ingest quota is a billing
 * allowance, and `src/dictation-limits.ts` is about the size of one upload.
 * docs/plans/260905f-external-link-panel-add-to-spideryarn-and-server-side-preview.md
 * § Stage 2, and GPT Sol's finding P1-5.
 *
 * ## Keyed on the owner and nothing else
 *
 * Not on the article and not on the URL, which an attacker varies freely. The
 * cap is *per person*, and the article-membership check on the route is what
 * stops query-string variation being an unlimited source of cache misses.
 *
 * ## Two bounds out of one table
 *
 * - **A rolling window**: how many rows this owner has with `started_at` inside
 *   the last hour. A row per event rather than a counter column, for the reason
 *   `pg-feedback.ts` counts rows: a *rolling* window needs the times, and a
 *   fixed window that resets lets twice the allowance through at the seam.
 * - **Concurrency**: how many rows have a `lease_until` still in the future. The
 *   fetch clears it when it finishes, so an abandoned request costs the owner
 *   one slot until its lease runs out rather than for ever.
 *
 * Both are counted inside one transaction under an owner-scoped
 * `pg_advisory_xact_lock`, which is what makes them atomic across instances —
 * `count` then `insert` is raceable and a cap without the lock is a suggestion.
 *
 * ## What this records about a reader, and what it does not
 *
 * That an owner caused *n* outbound fetches at these times. **No URL, no article,
 * no host.** The link-preview row holds what was fetched and knows nothing about
 * who asked; this row knows who asked and nothing about what. Keeping them apart
 * is the whole point, and neither table may grow a column that joins them.
 *
 * Rows older than the window are deleted by the same statement that counts them,
 * so an **active** reader's rows are bounded by their allowance rather than by
 * their history.
 *
 * **It sweeps the asking owner's rows and nobody else's**, which is the honest
 * version of a sentence that used to say "rows older than the window are
 * deleted" and stop. A reader who stops hovering links leaves their last
 * window's rows behind for good: nothing counts them, nothing serves them, and
 * nothing comes back to remove them. That is a bounded leak — at most one
 * window's allowance per reader who ever used the feature, which at these caps
 * is a few hundred rows for a whole readership — and it is written down rather
 * than swept because a cron for it would be more machinery than the rows are.
 * The `ON DELETE CASCADE` on `owner_id` is what clears them when an account
 * goes. GPT Sol, 2026-09-05.
 */
export const rateLimitEvents = spideryarn.table(
  "rate_limit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** `auth.users(id)`. FK in the custom migration, as with every `owner_id`. */
    ownerId: uuid("owner_id").notNull(),
    /**
     * Which allowance. A closed set with a CHECK, for the reason
     * `checkpoints_namespace` is closed: a typo would otherwise open a bucket
     * with its own private, unenforced allowance.
     */
    bucket: text("bucket").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * In flight until this moment; null once the work finished or was released.
     *
     * A lease rather than a flag, because the process holding it can die.
     */
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
  },
  (t) => [
    check(
      "rate_limit_events_bucket",
      sql`${t.bucket} in ('link-preview-fetch', 'link-summary-fill')`,
    ),
    /** Both counting queries, and the sweep, run over exactly this. */
    index("rate_limit_events_owner_bucket_started").on(t.ownerId, t.bucket, t.startedAt),
    /**
     * **The global fuse's query, which is the one that reads across owners.**
     *
     * Everything else here is per-owner and served by the index above. The
     * daily fuse on Luna fills (`RatePolicy.daily.globalFills`) counts one
     * bucket over one window for *everybody*, and without this it is a scan of
     * every reader's rows on the cold path of a summary.
     */
    index("rate_limit_events_bucket_started").on(t.bucket, t.startedAt),
  ],
);

/* --------------------------------------------------------- link summaries -- */

/**
 * **How the page on the far end of a link stands to the piece the reader is
 * holding** — the Luna summary, and the owned half of the link card.
 *
 * `linkPreviews` above is ownerless because it holds *what a page says about
 * itself*, which is the same for everybody. This row is the opposite kind of
 * thing: it is written from the reader's own profile, from the article they are
 * in, and from the paragraph the link sits in, so it is about **this reader
 * reading this piece** and a shared row would be both wrong and a disclosure.
 * Two caches, deliberately, and the split is the most important structural fact
 * in
 * docs/plans/260905f-external-link-panel-add-to-spideryarn-and-server-side-preview.md.
 *
 * ## The owner IS in the key, unlike `glossary_lookups`
 *
 * The obvious shape to copy is `glossaryLookups`, whose primary key is
 * `(article_id, entry_id)` with `owner_id` as a column beside it — and that is
 * correct there, because an `articles` row has exactly one owner today, so the
 * owner in the key would be redundant.
 *
 * This table does not copy it, and the reason is what the two rows *are*. A
 * glossary lookup is a model's answer about **the article**; two readers of one
 * article would want the same one. This is a model's answer about **the
 * reader** — their profile is a prompt input. The day `articles` stops being
 * one row per owner (docs/plans/260827ai-public-read-only-access.md, stage 3,
 * splits `articles` from `shelf_entries` along exactly that line) an
 * article-keyed row would start serving one reader's personalised summary to
 * another. Redundancy today against a cross-reader leak later is not a close
 * call, and it costs one uuid in an index.
 *
 * ## Staleness is validated, not assumed
 *
 * `(owner, article, target)` alone never changes when the article is
 * re-extracted or the reader edits their profile, and both are prompt inputs —
 * so a personalised summary would be stale for ever. GPT Sol, 2026-09-05,
 * finding P1-3. The four fingerprints below are compared on every read and a
 * mismatch is a miss, which rewrites the row in place.
 *
 * They are four columns rather than one combined hash on purpose: when a
 * summary is being regenerated more often than it should be, the column that
 * changed is the whole diagnosis, and a single fingerprint would say only that
 * something did.
 */
export const linkSummaries = spideryarn.table(
  "link_summaries",
  {
    /** `auth.users(id)`. FK in the custom migration, as with every `owner_id`. */
    ownerId: uuid("owner_id").notNull(),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    /**
     * `requestTarget(url)` — the same identity `link_previews.target` uses, and
     * deliberately not `urlKey`. src/urls.ts, and GPT Sol's P1-2.
     */
    target: text("target").notNull(),
    /**
     * **Which sighting of that link this summary is about** — the id of the
     * block the reader's own pointer was in.
     *
     * In the key rather than beside it, because a destination linked twice in
     * one article is two questions: the answer is *how does this stand to the
     * paragraph you are standing in*, and the two paragraphs are different. The
     * four fingerprints below would already make the other mention a miss — the
     * passage is inside `context_hash` — but a miss on a shared key is the two
     * of them overwriting each other, paying for a model call on every glance
     * from one to the other. docs/project/links.md; GPT Sol, 2026-09-05, P1-1.
     *
     * Rows written before 2026-09-05 carry `''`, which is not a block id any
     * article has, so none of them can be read again; they expire and the sweep
     * takes them. The migration says the same thing at more length.
     */
    blockId: text("block_id").notNull(),
    /** `pending` while somebody is generating it; `ready` once there is one. */
    status: text("status").notNull(),
    /** The summary itself. Null on a `pending` row and never otherwise. */
    summary: text("summary"),
    /**
     * **The fencing token for the single-flight claim**, exactly as
     * `link_previews.claim_id` is, and for the reason written there: without one
     * a claimant that stalled past its lease could delete its successor's claim.
     * Here it also stops a loser writing its answer over a winner's.
     */
    claimId: uuid("claim_id"),
    /**
     * A hash of the destination text the model was given. Changes when the
     * far-end page is fetched again and says something different.
     */
    destHash: text("dest_hash").notNull(),
    /**
     * A hash of what the reader is currently reading, as the prompt carried it
     * — the title, the piece's one-sentence gist, the link's own words and the
     * paragraph it sits in. Changes when the article is re-extracted.
     */
    contextHash: text("context_hash").notNull(),
    /**
     * `hashProfile(renderProfile(…))`, or the sentinel for a reader who has
     * written nothing. src/profile.ts already mints this for exactly this
     * purpose, and it has a defined value for "no profile" so that *having no
     * profile* and *not having asked* cannot be the same string.
     */
    profileHash: text("profile_hash").notNull(),
    /**
     * The prompt's version, bumped by hand when the wording changes — see
     * `LINK_SUMMARY_PROMPT_VERSION` in src/link-summary.ts. A prompt edit that
     * left every stored summary standing would be a change nobody could see the
     * effect of.
     */
    promptVersion: integer("prompt_version").notNull(),
    /** Which model wrote it. A tier change makes every row stale, as it should. */
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * When this stops being an answer. On a `pending` row it is the claim's
     * lease, which is why an abandoned generation cannot wedge a link.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.articleId, t.target, t.blockId] }),
    check("link_summaries_status", sql`${t.status} in ('pending','ready')`),
    /**
     * The union, as a constraint — `link_previews_shape`'s argument, one table
     * down: a `pending` row holds a claim and no answer, a `ready` row holds an
     * answer and no claim.
     */
    check(
      "link_summaries_shape",
      sql`case ${t.status}
            when 'pending' then ${t.summary} is null and ${t.claimId} is not null
            else ${t.summary} is not null and ${t.claimId} is null
          end`,
    ),
    /** The sweep's query, and the only one that does not name a key. */
    index("link_summaries_expires_at").on(t.expiresAt),
  ],
);
