/**
 * The Postgres schema, as TypeScript. Nothing reads this yet.
 *
 * This is step 3 of docs/plans/postgres-migration.md, written ahead of the
 * storage contracts because it is the artefact everything else is judged
 * against. **No table here is live**; the store is still JSON files under
 * `data/<slug>/` (docs/project/database.md).
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
 * docs/plans/postgres-migration.md#the-client-drizzle-for-data-supabase-for-auth.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  foreignKey,
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
import type { Arc, Citation, Glossary, JobStep, Tree, TweetThread } from "../types.js";

export const spideryarn = pgSchema("spideryarn");

/**
 * Drizzle 0.45 has no `bytea` column type — checked, not assumed. The plan said
 * it did, on a review's say-so.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
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
 * docs/plans/postgres-migration.md#the-deferrable-fk-we-talked-ourselves-out-of.
 */
export const articles = spideryarn.table("articles", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** `auth.users(id)`. FK in the custom migration — see the header. */
  ownerId: uuid("owner_id").notNull(),
  slug: text("slug").notNull().unique(),
  currentRevisionId: uuid("current_revision_id"),
  createdAt: createdAt(),
});

/**
 * One extraction of one article. Immutable once published.
 *
 * The pipeline builds a *draft* and publishes it in one step, so a reader sees
 * either the previous published revision or the complete new one and never a
 * mixture. Today a failed re-extraction overwrites a good article in place.
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
  },
  (t) => [
    primaryKey({ columns: [t.revisionId, t.blockId] }),
    unique("revision_blocks_revision_ordinal").on(t.revisionId, t.ordinal),
    check("revision_blocks_ordinal", sql`${t.ordinal} >= 0`),
    check(
      "revision_blocks_kind",
      sql`${t.kind} in ('heading','text','quote','code','media','caption','other')`,
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
    check("comments_status", sql`${t.status} in ('pending','done','error')`),
    check("comments_start", sql`${t.start} >= 0`),
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
    /**
     * At most one running job, enforced by the database rather than by every
     * claimant following the locking convention correctly. `queue_state` gives
     * concurrency 1 only while they do; this is the backstop for when one does
     * not. A unique index on a constant, restricted to running rows.
     */
    uniqueIndex("jobs_only_one_running").on(sql`(true)`).where(sql`${t.status} = 'running'`),
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
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.revisionId, t.stepName] }),
    check(
      "revision_step_runs_step",
      sql`${t.stepName} in ('fetch','extract','blocks','toc','arc','tweets','glossary')`,
    ),
    check(
      "revision_step_runs_status",
      sql`${t.status} in ('running','done','error')`,
    ),
  ],
);

/* ------------------------------------------------------------- ai calls -- */

/**
 * One row per model call. Borrowed wholesale from the old app, which is the one
 * idea from it worth taking — see
 * docs/project/original-version/llm-plumbing.md. Their table was overkill for
 * their app; it is not overkill once there is a database anyway.
 *
 * `rawResponse` is why: in the old project `ai_calls` was 31 MB and dominated
 * the entire database. Worth keeping, worth pruning on a schedule, and worth
 * knowing about before it surprises someone.
 */
export const aiCalls = spideryarn.table("ai_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  articleId: uuid("article_id").references(() => articles.id, { onDelete: "set null" }),
  revisionId: uuid("revision_id").references(() => articleRevisions.id, { onDelete: "set null" }),
  /** `toc`, `arc`, `tweets`, `glossary`, or `explain` for a reader's question. */
  purpose: text("purpose").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  /** Micro-dollars, so this stays an integer and never a drifting float. */
  costMicros: integer("cost_micros"),
  latencyMs: integer("latency_ms"),
  finishReason: text("finish_reason"),
  error: text("error"),
  rawResponse: jsonb("raw_response"),
  createdAt: createdAt(),
});
