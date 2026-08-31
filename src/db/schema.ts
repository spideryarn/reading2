/**
 * The Postgres schema, as TypeScript.
 *
 * Written ahead of the storage contracts (step 3 of
 * docs/plans/260825f-postgres-migration.md) because it is the artefact everything else
 * is judged against. **These tables are now live for reads**: src/store/pg.ts
 * serves the reading view and the library out of them when
 * `SPIDERYARN_STORE=postgres`, and src/store/pg-comments.ts writes to them.
 * The pipeline still writes JSON files under `data/<slug>/`, and the two are
 * kept in step by src/store/import.ts. docs/project/database.md says which is
 * true of what today; docs/plans/260826e-postgres-storage-implementation.md tracks the
 * rest of the cutover.
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
import type { Sketch } from "../sketch-scene.js";
import type { LabelsFile } from "../labels.js";
import type {
  Arc,
  Citation,
  Glossary,
  Ideas,
  JobStep,
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
  currentRevisionId: uuid("current_revision_id"),
  createdAt: createdAt(),

  /**
   * **This article is the shipped demo, not something a reader added.**
   *
   * `example/` is a checked-in fixture that the filesystem reader serves as an
   * ordinary article (src/api.ts § `FIXTURE_SLUG`), and at cutover it has to
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
 * The comment also rested on a claim that was simply false — *"nothing deletes
 * an article today"*. `src/store/import.ts` deletes orphaned articles, so this
 * was a live loss rather than a choice about a hypothetical path.
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
 * Only `fetch`, `extract` and `blocks` mint a revision. `toc`, `arc`, `tweets`
 * and `glossary` write their own column onto the revision that is
 * already published, in one `UPDATE`. That weakens the plain reading of
 * "immutable" and it belongs here rather than arriving as a surprise to
 * whoever reads this comment and then reads the code.
 *
 * What the property is *for* is the sentence below it: a failed re-extraction
 * must not overwrite a good article in place. That is about the **text**. A
 * revision per glossary regeneration would copy every `revision_blocks` row and
 * every `raw_bytes` blob to add one JSONB value, and no reader could tell the
 * difference — a single-column `UPDATE` is already atomic.
 *
 * **The limit of that licence, which a review found and which the code
 * enforces:** `toc` is not one of the five. It owns `tree` *and* `labels`, and
 * a job that runs `toc` then `arc` would otherwise show every reader the new
 * tree beside the old arc for the length of a model call. So `toc` mints a
 * revision like the structural steps do, and only genuinely independent
 * on-demand artefacts update in place.
 */
export const articleRevisions = spideryarn.table(
  "article_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    status: text("status").notNull(),

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
     * The fetched bytes, undecoded — NOT a `raw_html` text column.
     * `data/<slug>/raw.html` is misnamed: src/pipeline.ts writes a decoded
     * string there and throws away the bytes, the content type and the sniffed
     * encoding. Naming a column `raw_html` would bless that permanently. See
     * docs/project/fetching.md for why the encoding cannot be re-derived later.
     */
    rawBytes: bytea("raw_bytes"),
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
     * A column rather than `length(raw_bytes)`, because `raw_bytes` is dropped
     * at the end of docs/plans/260827aa-delete-the-importer.md and this number has to
     * outlive it. `raw_sources.bytes` is not a substitute: that describes the
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
     * untrue: that function checks blocks, the tree, `checkTree` and the `toc`
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
     * the revision is published. `labels.json` is one of the `toc` step's
     * OUTPUTS (src/pipeline.ts), so its currency rides with the `toc` row in
     * `revisionStepRuns` and `labels` is deliberately NOT a step name of its
     * own. Checked against the code, not assumed — an earlier draft of this
     * work had it as a step and would have added a CHECK value for it.
     */
    labels: jsonb("labels").$type<LabelsFile>(),

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
     * new stage 2 is imported. Blocks are written in one batched statement
     * inside a transaction (src/store/import.ts, src/store/artifacts-pg.ts), so
     * the failure is loud and total: the statement is refused and the whole
     * revision rolls back. It does not leave half an article. `npm run deploy`
     * migrates before it pushes code, which is the right order.
     * docs/plans/callout-blocks.md.
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
     * The per-article rule is a different question and keeps an index of its
     * own — see `jobs_active_slug` below.
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
     * **One active job per article** — `activeFor` and `freeSlug` as a
     * constraint, and the conflict target `enqueueOrGet` inserts against.
     *
     * It does two jobs at once, which is why there is one index here and not
     * two. It **reserves the slug**, closing the check-then-use race in which
     * two uploads both named `paper.pdf` each choose `paper` and the second
     * publishes into the first's article. And it **de-duplicates**, because a
     * second request for work already in flight conflicts here first: the
     * caller re-reads the row and compares `work_key` — same work, hand back
     * that job; different work, allocate the next slug suffix and retry.
     *
     * **There was very nearly a second index on `(owner_id, slug, work_key)`,
     * and it could never have fired.** Any pair of rows violating it violates
     * this one too, so it was strictly subsumed — a unique index that is a claim
     * in the schema and does nothing. Found by inserting the rows rather than by
     * reading the definitions, 2026-08-27. `work_key` stays as a *column*
     * because it is what the caller compares after this index refuses.
     *
     * Partial, because two finished jobs for one article are ordinary history.
     */
    uniqueIndex("jobs_active_slug")
      .on(t.ownerId, t.slug)
      .where(sql`${t.status} in ('queued','running')`),
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
       * `labels` is deliberately NOT here. `labels.json` is one of the `toc`
       * step's OUTPUTS rather than a step of its own, so its currency rides
       * with the `toc` row. Verified against src/pipeline.ts rather than
       * inferred from the file existing.
       */
      /* **This list is `STEP_ORDER` and it has drifted twice.** `sketch` was added
         to the database by drizzle/0031 and never got back into this literal,
         because `drizzle-kit generate` diffs the schema and knows nothing about a
         CHECK expression — so this one is hand-maintained and the migrations are
         the truth. `tests/db-step-constraint.test.ts` compares the last
         `ADD CONSTRAINT` in the migrations against `STEP_ORDER` in both
         directions, which is what makes there not be a third drift. */
      sql`${t.stepName} in ('fetch','extract','blocks','toc','assets','arc','tweets','glossary','quotes','ideas','timeline','sketch')`,
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
    /** Which job made the call: `toc`, `chat`, `embeddings`, … */
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
    durationMs: integer("duration_ms").notNull(),
    /** `ok`, `error` or `aborted`. A non-`ok` row's cost is a lower bound. */
    outcome: text("outcome").notNull(),
    /**
     * **Which bill this call lands on** — `openrouter` or `anthropic`.
     *
     * Not derivable from `credential_fingerprint`, which identifies a key
     * without saying whose. Money leaves this project from two accounts and
     * `npm run cost --reconcile` can only read one of them, so the row has to
     * say which side of that line it is on or the reconciliation is comparing
     * our total against somebody else's subtotal.
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
    /** What the inference itself was worth. Under BYOK this is real and the above is 0. */
    upstreamInferenceNanos: bigint("upstream_inference_nanos", { mode: "number" }),
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
     * columns: every later turn of a review thread comes through that upsert,
     * so a stale tab sending `kind: "chat"` would turn a review into a chat on
     * its second question. The prompt would change, the list tag would change,
     * and the transcript would still read as one conversation.
     *
     * `default 'chat'` is what makes the migration additive: every thread that
     * existed before review mode is a chat, and no backfill is needed.
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
    check("chat_threads_kind", sql`${t.kind} in ('chat','review')`),
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
    check("checkpoints_namespace", sql`${t.namespace} in ('toc-labels','pdf-chunk')`),
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
