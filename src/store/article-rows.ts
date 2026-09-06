/**
 * **One owner-scoped walk over everything that hangs off an article**, returned
 * as the rows Postgres actually holds.
 *
 * Two things read an article whole: [`export.ts`](export.ts), which is the
 * rollback and projects these rows into the filesystem store's legacy layout,
 * and the export bundle the reader downloads, which projects them faithfully.
 * The thing worth sharing between those two is **the queries** — the join, the
 * owner filter, and the orderings — not a synthesized middle model, because the
 * rows are already the faithful representation and a second one would have to
 * be both rich enough for the bundle and lossily projectable back to a format
 * that is pinned byte for byte.
 *
 * That pinning is the whole reason this file does no shaping of its own.
 * `tests/store-roundtrip.test.ts` compares the rollback's output against what
 * the filesystem store writes, so the legacy projection is deliberately lossy —
 * a `candidates` thread comes out as `chat`, `passages` and `interrupted` are
 * dropped, `extractedHtml` is never written — and **it cannot be enriched in
 * place**. Anything that "improves" a value on the way out of here changes the
 * rollback. Give the caller the row; let the caller lose what it must.
 * docs/plans/260901h-export-article-data.md § The design.
 */

import { asc, eq } from "drizzle-orm";

import { type Db, getDb } from "../db/client.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  chatMessages,
  chatThreads,
  comments as commentsTable,
  glossaryLookups,
  refereeClaims,
  refereeCriteria,
  revisionBlocks,
  searchRuns,
} from "../db/schema.js";
import { ownedSlug } from "./owned-slug.js";

/**
 * The handle inside a transaction — derived from `Db`, so it cannot drift from
 * whatever drizzle hands the callback.
 */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * What one projection does about one table: names the file it lands in, or says
 * in words why it does not.
 *
 * There is no third state, and in particular there is no **silence** — which is
 * what `referee_criteria` got when it was added on 2026-08-31, so `db:export`
 * dropped every criterion a referee had written and reported success.
 */
export type Destination =
  /**
   * Written into this file — and a row of this table must actually come back
   * out of that file when the projection runs.
   *
   * `tests/store-export-covers-tables.test.ts` puts a sentinel string in every
   * declared table, runs **both** projections, and looks for that string in the
   * file named here. A declaration that says "exported" while nothing writes the
   * row is worse than no declaration: it reads as the check having been done.
   */
  | { readonly exported: true; readonly into: string }
  /** Deliberately left out of this projection, for this stated reason. */
  | { readonly exported: false; readonly why: string };

/**
 * What the **two** projections each do about one table.
 *
 * Two fields rather than one, because the two outputs genuinely disagree and
 * flattening that would make one of them lie. `block_identities` is the case
 * that forced it: the rollback omits it because stage 3 recovers ids from
 * `output/<slug>.html`, which is true for re-ingestion and **false for anchor
 * integrity** — a comment can point at a block that has since left the article,
 * so the reader's bundle must carry the ids and the rollback need not.
 */
export interface TableCoverage {
  /** `npm run db:export` — the rollback, into `data/<slug>/`. [export.ts](export.ts) */
  readonly rollback: Destination;
  /** The zip a reader downloads. [export-bundle.ts](export-bundle.ts) */
  readonly bundle: Destination;
}

/**
 * **Every table that hangs off an article, and what each projection does with it.**
 *
 * **It lives here, beside the query walk, and not beside either projection.**
 * That is the point of the file: `readArticleRows` is the one place an article
 * is read whole, so a table declared here is a table both outputs are answerable
 * for, and a table added to `src/db/schema.ts` fails the guard on the day it
 * lands for *both* of them rather than for whichever file somebody remembered.
 * (It used to live in `export.ts`, which re-exports it for its old importers.)
 *
 * Keyed by the SQL table name, because that is what the schema and a migration
 * both call it. In scope is anything that reaches an article at all: an
 * `article_id` column, a foreign key to something that has one, or — one hop —
 * something an in-scope table itself points at. Each of those three was added
 * after the one before it was found to be missing something, on 2026-09-01:
 * `revision_step_runs` is keyed by `revision_id` alone and was invisible to a
 * collector that only looked for `articleId`; `raw_sources` and `uploads` are
 * pointed *at* rather than pointing, and were invisible to one that only walked
 * child → parent. The collector is
 * tests/store-export-covers-tables.test.ts § `articleScopedTables`.
 *
 * **The foreign-key rule over-reaches, deliberately.** It follows every key, not
 * only the ones that mean ownership, so `jobs` arrives here because it points at
 * the draft revision it is building, and `queue_state` because it points at
 * `jobs`. Narrowing it would drop those two and would also drop the next child
 * table that happens to hold a nullable parent id, which is the silence this
 * record exists to prevent. The cost of over-reach is one written-down sentence
 * per table; the cost of under-reach is a rollback that quietly loses somebody's
 * work. So some entries are here to say, on the record, that they are not
 * article data.
 */
export const ARTICLE_TABLE_COVERAGE = {
  /* The article's own row — the shelf state the reader made, plus (for the
     bundle) the identity and sharing columns the rollback has nowhere to put:
     `data/` has no public sharing at all. `purpose` went missing from the
     rollback once already. */
  articles: {
    rollback: { exported: true, into: "shelf.json" },
    bundle: { exported: true, into: "article.json" },
  },
  /* The current revision. Some of its columns are files of their own in both
     outputs — the HTML, and every artefact column from `tree` to `labels` — but
     the file named here is where **the row itself** lands, and that is what
     both checks in tests/store-export-covers-tables.test.ts follow.

     **The bundle's answer said `manifest.json` until 2026-09-01, and that was
     the bug.** The manifest carries exactly one column of this table — `title` —
     so of forty-six columns, fifteen were files of their own and the other
     thirty were in no file in the zip at all: `byline`, `siteName`, `excerpt`,
     `publishedAt` and `wordCount` among them. The sentinel went into `title`, so
     one column out of forty-six satisfied the guard for the whole table. Naming
     the file the **whole row** goes into, rather than a file some of it reaches,
     is what lets the column check in that test ask the right question. */
  article_revisions: {
    rollback: { exported: true, into: "meta.json" },
    bundle: { exported: true, into: "content/revision.json" },
  },
  revision_blocks: {
    rollback: { exported: true, into: "blocks.json" },
    bundle: { exported: true, into: "content/blocks.json" },
  },
  comments: {
    rollback: { exported: true, into: "comments.json" },
    bundle: { exported: true, into: "augmentations/comments.json" },
  },
  chat_threads: {
    rollback: { exported: true, into: "chat.json" },
    bundle: { exported: true, into: "augmentations/chat.json" },
  },
  chat_messages: {
    rollback: { exported: true, into: "chat.json" },
    bundle: { exported: true, into: "augmentations/chat.json" },
  },
  search_runs: {
    rollback: { exported: true, into: "searches.json" },
    bundle: { exported: true, into: "augmentations/searches.json" },
  },
  referee_criteria: {
    rollback: { exported: true, into: "referee-criteria.json" },
    bundle: { exported: true, into: "augmentations/referee-criteria.json" },
  },
  referee_claims: {
    rollback: { exported: true, into: "referee-claims.json" },
    bundle: { exported: true, into: "augmentations/referee-claims.json" },
  },
  glossary_lookups: {
    rollback: { exported: true, into: "glossary-lookups.json" },
    bundle: { exported: true, into: "augmentations/glossary-lookups.json" },
  },

  /** The one table the two projections disagree about — see `TableCoverage`. */
  block_identities: {
    rollback: {
      exported: false,
      why:
        "Recovered from output/<slug>.html, which that export writes. Stage 3 reads " +
        "the ids back out of that file rather than re-minting them, which is the " +
        "whole of docs/project/block-ids.md's preservation promise.",
    },
    bundle: { exported: true, into: "content/block-identities.json" },
  },
  link_summaries: {
    rollback: {
      exported: false,
      why:
        "A cache of a model's line on where a hovered link goes, keyed by the reader, " +
        "the article, the address and the block it is linked from, and validated " +
        "against four fingerprints of its own inputs — src/db/schema.ts § " +
        "linkSummaries. Every one of those inputs is " +
        "exported or is somebody else's public page, so the row can be rebuilt for " +
        "about a hundredth of a penny, and nothing here is anything the reader wrote.",
    },
    bundle: {
      exported: false,
      why:
        "The same cache, and the bundle has a second reason: a row is written from the " +
        "reader's own profile, so it is the one per-article artefact that says more " +
        "about the person than about the piece. Rebuilding it costs a fraction of a " +
        "penny and it is meaningless outside the card it is drawn on.",
    },
  },
  checkpoints: {
    rollback: {
      exported: false,
      why:
        "A cache of work a failed attempt already paid for, keyed by content hash — " +
        "docs/project/database.md § Checkpoints. Losing it costs money on the next " +
        "run and loses nothing the reader made.",
    },
    bundle: {
      exported: false,
      why:
        "A cache of model output keyed by content hash, not something the reader " +
        "wrote and not meaningful outside Spideryarn's own pipeline. Every finished " +
        "artefact it stands behind is in the bundle already.",
    },
  },
  ai_calls: {
    rollback: {
      exported: false,
      why:
        "The spend ledger, and it is not article state: src/store/ai-calls-fs.ts " +
        "writes it to data/_ai-calls.jsonl, one file for the whole library, not to " +
        "any data/<slug>/. An article's directory has nowhere to put it.",
    },
    bundle: {
      exported: false,
      why:
        "The spend ledger. `article_id` is nullable and many of an article's calls " +
        "carry none, so a per-article total would be quietly wrong rather than " +
        "merely absent — which is worse than saying nothing.",
    },
  },
  realtime_sessions: {
    rollback: {
      exported: false,
      why:
        "The live-conversation journal — one row per issued session, and the parent " +
        "the realtime `ai_calls` rows hang off. Accounting rather than article " +
        "state, and it follows `ai_calls` straight above for the same reason: the " +
        "filesystem store keeps it in data/_realtime-sessions.json, one file for " +
        "the whole library, and an article's directory has nowhere to put it.",
    },
    bundle: {
      exported: false,
      why:
        "The live-conversation journal. What the reader actually made in a spoken " +
        "conversation is already in the bundle as chat rows (`withSpokenTurn` in " +
        "src/chat.ts); this table is the accounting shadow of it — when a token was " +
        "minted, when a channel opened, when it closed — which is our record of our " +
        "own spending rather than anything of theirs.",
    },
  },
  /**
   * **The quota ledger, which started reaching an article on 2026-09-05.**
   *
   * It follows `ai_calls` and `realtime_sessions` above, and it is here at all
   * because of one column: `ingest_events.article_id`, added so that usage could
   * ask whether the article a charge produced is public right now — a public one
   * costs half a slot (src/billing/half-units.ts). Before that column this table
   * did not reach an article and this guard had nothing to say about it.
   */
  ingest_events: {
    rollback: {
      exported: false,
      why:
        "The ingest quota's ledger — one row per *attempt to spend*, carrying when " +
        "a slot was reserved and whether it was charged or given back. It is an " +
        "abuse boundary against model spend, not article state " +
        "(docs/project/billing.md § The quota), and it is deliberately Postgres-" +
        "only: there is no filesystem quota and there will not be one, so a " +
        "rollback to data/<slug>/ has nothing that could read it back. It is also " +
        "not one-to-one with an article — a re-added URL adopts the same article " +
        "and charges again — so there is no single row an article's directory " +
        "could hold.",
    },
    bundle: {
      exported: false,
      why:
        "The ingest quota's ledger: our accounting of what adding this article " +
        "cost *us*, not anything the reader wrote or the pipeline produced. An " +
        "export is one article's data out (docs/project/export.md), and handing a " +
        "reader rows about slots and settlements would be answering a question " +
        "they did not ask with a number they cannot act on. It would also be " +
        "incomplete twice over: `article_id` is null for every row charged before " +
        "the column existed and for every row whose article was later deleted, and " +
        "an administrator's ingests are never written here at all. This changes " +
        "the day the ledger holds something the reader is owed — a receipt, a " +
        "per-article cost they are billed on — rather than the day it merely gets " +
        "another column.",
    },
  },
  article_visibility_changes: {
    rollback: {
      exported: false,
      why:
        "An append-only audit of who made an article public and when " +
        "(src/store/pg-visibility.ts). The filesystem store has no public sharing " +
        "at all, so a rollback to data/ has nothing that could read it back.",
    },
    bundle: {
      exported: false,
      why:
        "An append-only audit of the sharing switch, kept for takedown evidence. " +
        "The state it audits is in article.json as `visibility` and `publicAt`; " +
        "the history of switching is about the decision, not about the article.",
    },
  },
  jobs: {
    rollback: {
      exported: false,
      why:
        "The ingest queue's own state, reachable from here only because a job " +
        "points at the draft revision it is building (`draft_revision_id`). It is " +
        "not one article's data: the filesystem store keeps jobs in data/_jobs, " +
        "one file for the whole library, and a finished job is scaffolding.",
    },
    bundle: {
      exported: false,
      why:
        "The ingest queue's own state, reachable only because a job points at the " +
        "draft revision it built. Scaffolding once the article exists — and it " +
        "carries a reader-profile snapshot, which is not this article's data.",
    },
  },
  queue_state: {
    rollback: {
      exported: false,
      why:
        "One row saying which job is running, reachable from an article only " +
        "through `jobs` above. It describes this machine at this moment, not any " +
        "article, and a rollback that restored it would name a job that is not " +
        "running.",
    },
    bundle: {
      exported: false,
      why:
        "One row saying which job this server is running now, reachable from an " +
        "article only through `jobs`. It describes the machine at this instant and " +
        "says nothing about the article.",
    },
  },
  /* The two the record could not see until 2026-09-01, because the guard's
     closure only ever walked **child → parent**: nothing an article *points at*
     was ever discovered. Both are now found by one outward hop in
     tests/store-export-covers-tables.test.ts, and being here is the whole point
     — `manifest.json`'s `omitted` list is derived from this record, so a table
     missing from it is a table no reader is ever told about. The plan said
     `uploads` was deliberately omitted; that was true in the plan and in
     nothing a reader could see. GPT Sol's second code review, finding 3. */
  raw_sources: {
    rollback: {
      exported: false,
      why:
        "The catalogue of the sources bucket — one row per stored document, by " +
        "hash and kind. The rollback writes the document's bytes themselves, " +
        "through writeRawDocument into data/<slug>/, and the filesystem store has " +
        "no bucket for a catalogue to describe.",
    },
    bundle: {
      exported: false,
      why:
        "One row describing an object in the sources bucket: its hash, kind, size " +
        "and content type. The document it names is the original PDF or page, " +
        "which Greg's call keeps out of the zip anyway — and content/revision.json " +
        "carries rawSourceSha256 and rawSourceKind, so the object is named even " +
        "though neither it nor its catalogue row is carried.",
    },
  },
  uploads: {
    rollback: {
      exported: false,
      why:
        "One upload attempt: the grant we minted, its expiry, what the browser " +
        "claimed and what actually landed. Reachable from an article only because " +
        "a job points at it, and joined to the article it became by a bare `slug` " +
        "text column with no key. Queue state, kept for the whole library beside " +
        "data/_jobs, not one article's data.",
    },
    bundle: {
      exported: false,
      why:
        "The record of a file being uploaded — grant, expiry, the hash the browser " +
        "claimed and the one we computed. It is about how the article arrived, not " +
        "about the article, and its only link to one is an unconstrained `slug` " +
        "column. What the upload produced is in the zip as content/stamped.html.",
    },
  },
  revision_step_runs: {
    rollback: {
      exported: false,
      why:
        "Whether a pipeline step's output is CURRENT, keyed by input hash — the " +
        "same class of thing as checkpoints, and derived from artefacts this " +
        "export does write. A rollback to data/ recovers currency the way the " +
        "filesystem store always has, by looking at the files.",
    },
    bundle: {
      exported: false,
      why:
        "Whether each pipeline step's output is still current, keyed by input " +
        "hash. Derived from the artefacts the bundle already carries, and " +
        "meaningless outside Spideryarn's own pipeline.",
    },
  },
} as const satisfies Readonly<Record<string, TableCoverage>>;

/** A table name this record knows about. */
export type ArticleTable = keyof typeof ARTICLE_TABLE_COVERAGE;

/** Every table name in the record whose `projection` destination is a file. */
type ExportedInto<Projection extends keyof TableCoverage> = {
  [K in ArticleTable]: (typeof ARTICLE_TABLE_COVERAGE)[K][Projection]["exported"] extends true
    ? K
    : never;
}[ArticleTable];

/**
 * A table the record says the **rollback** exports — and the only thing
 * `exportArticle`'s `put` will take.
 *
 * The compiler half of the promise. Attributing a write to a table declared
 * `exported: false`, or to one the record has never heard of, does not compile;
 * and every write that does compile lands in `ExportResult.tables`, so the test
 * can ask what the export touched rather than reading its source.
 */
export type RollbackTable = ExportedInto<"rollback">;

/** A table the record says the reader's **bundle** carries. */
export type BundledTable = ExportedInto<"bundle">;

/**
 * No article of this reader's by that slug, or one with no current revision.
 *
 * **A type rather than a message**, because a caller has to be able to tell it
 * apart. `exportArticle` threw a plain `Error` here, which a route can only turn
 * into a 500 — and "somebody else's slug" is a 404: the reader asked for
 * something that, as far as they are concerned, does not exist. Note the two
 * cases are deliberately one: an article whose current revision is missing is
 * not something to explain to a stranger, and distinguishing them out loud would
 * tell them a slug they cannot see does exist.
 */
export class ArticleNotFound extends Error {
  readonly slug: string;

  constructor(slug: string) {
    /* The wording is the one `exportArticle` has always thrown. `npm run
       db:export`'s output is somebody's rollback log; there is no reason to
       change what it says. */
    super(`${slug}: no article with a current revision in Postgres`);
    this.name = "ArticleNotFound";
    this.slug = slug;
  }
}

/**
 * Every row of one article, as Postgres holds it.
 *
 * Keyed by the Drizzle table, and typed by `$inferSelect` rather than by a
 * hand-written interface, so a column added to the schema arrives here without
 * anybody remembering to add it — which is how `tools`, `stance`, `criterionId`
 * and `valence` each went missing from an export for a while.
 */
export interface ArticleRows {
  readonly article: typeof articles.$inferSelect;
  /** The CURRENT revision only. Older ones are history — see `readArticleRows`. */
  readonly revision: typeof articleRevisions.$inferSelect;
  /** **In document order.** See the ordering note on `readArticleRows`. */
  readonly blocks: readonly (typeof revisionBlocks.$inferSelect)[];
  /**
   * Every block id this article has ever minted, including ones no longer in
   * the current revision.
   *
   * **Not read by the rollback**, which declares the table `exported: false`
   * because stage 3 recovers ids from `output/<slug>.html`. That reasoning holds
   * for re-ingestion and fails for anchor integrity: a comment or a chat thread
   * can point at a block that has since left the article, so a bundle without
   * these rows contains anchors pointing at nothing.
   */
  readonly blockIdentities: readonly (typeof blockIdentities.$inferSelect)[];
  readonly comments: readonly (typeof commentsTable.$inferSelect)[];
  readonly chatThreads: readonly (typeof chatThreads.$inferSelect)[];
  /**
   * Every message of every thread, flat. Ordered by thread and then `ordinal`,
   * so filtering to one thread leaves that thread's messages in order.
   */
  readonly chatMessages: readonly (typeof chatMessages.$inferSelect)[];
  readonly searchRuns: readonly (typeof searchRuns.$inferSelect)[];
  readonly refereeCriteria: readonly (typeof refereeCriteria.$inferSelect)[];
  /**
   * At most one row — `referee_claims.article_id` is its primary key. An array
   * because every other member here is one, and because the caller reading
   * `[0]` says what the shape is at the point it matters.
   */
  readonly refereeClaims: readonly (typeof refereeClaims.$inferSelect)[];
  readonly glossaryLookups: readonly (typeof glossaryLookups.$inferSelect)[];
}

/**
 * Read one article whole, **owner-scoped and as one snapshot**, or throw
 * `ArticleNotFound`.
 *
 * ## One snapshot, not ten
 *
 * Every statement runs inside a single read-only `repeatable read` transaction
 * — `SNAPSHOT` below says why, and `walk` says what that costs. The short
 * version: the rows this returns have to agree with each other, because the
 * callers join them (a message is nested under its thread) and a caller handed
 * a message whose thread it was never given **drops it in silence**.
 *
 * ## Owner scoping
 *
 * `ownedSlug` and nothing else: `articles.slug` is globally unique, so
 * `eq(articles.slug, …)` on its own finds anybody's article and the failure is
 * silent in the worst way — the query works and a real article comes back.
 * [`owned-slug.ts`](owned-slug.ts) has the long version.
 *
 * ## Only the current revision
 *
 * A rollback wants the article as it is being served, not an archive, and the
 * bundle makes the same product choice deliberately rather than out of
 * necessity — revisions do carry lineage (`basedOnRevisionId`).
 *
 * ## The invariant the owner scoping rests on, once `ownedSlug` has answered
 *
 * **`ownedSlug` is the only owner predicate in this function.** The nine child
 * reads below are `where article_id = …` and nothing else, and that is correct
 * *today* for one reason worth writing down rather than rediscovering: **every
 * row that hangs off an article was written by that article's owner.** Every
 * write path stamps `currentOwnerId()`, and the public surface — a shared
 * article a stranger reads — is read-only, so a stranger's row cannot exist.
 *
 * **The schema does not itself forbid the other case.** `glossary_lookups` is
 * the clearest example: its primary key is `(article_id, entry_id)` and
 * `owner_id` sits outside it, so a row whose owner differs from the article's is
 * a legal row that nothing rejects. Several of the others are the same shape.
 *
 * So the day anyone can annotate, comment on or chat about **someone else's**
 * shared article, this walk starts exporting their rows into the owner's
 * download, and every test here will stay green: the article is the right
 * article, the query is the right query, and the rows are simply somebody
 * else's. That change is the trigger to add `owner_id` to these predicates —
 * not a redundant one now, which would read as the guard and hide the fact that
 * the guarantee currently comes from the write paths.
 *
 * ## The orderings, all of which are load-bearing
 *
 * - **Blocks by `ordinal`.** This is the whole ballgame. Block ids are random
 *   and carry no position (docs/project/block-ids.md), so a missing ORDER BY
 *   here silently produces a shuffled article that still validates.
 * - **Everything else by `created_at, id`** (or the natural key where there is
 *   one). A `select` with no `order by` returns rows in whatever order Postgres
 *   finds them, which is usually insertion order and is guaranteed to be
 *   nothing: the day `import.ts` started deleting and re-inserting reader state
 *   the physical order changed and `searches.json` came back shuffled. `id`
 *   breaks the tie between two rows written in the same millisecond, so two
 *   exports of an unchanged article cannot differ.
 */
export async function readArticleRows(slug: string): Promise<ArticleRows> {
  return getDb().transaction((tx) => walk(tx, slug), SNAPSHOT);
}

/**
 * **One snapshot for the whole walk**, and nothing may be written down it.
 *
 * `repeatable read` because the ten statements below are one *logical* read
 * and must agree with each other. At `read committed` — Postgres's default, and
 * what an unpinned transaction inherits — every statement takes its own
 * snapshot, so a thread committed between the `chat_threads` read and the
 * `chat_messages` read gives the caller a message whose thread it has never
 * heard of. `export-bundle.ts` nests messages under the threads it was handed,
 * so that message is dropped in silence, out of a zip that says it holds
 * everything. GPT Sol's second review of
 * docs/plans/260901h-export-article-data.md, finding 2; the proof is
 * tests/article-rows-snapshot.test.ts, which commits exactly that row mid-walk.
 *
 * `read only` because neither caller writes and because `BEGIN … READ ONLY` is
 * the cheapest possible statement of that: a future edit that tries to write
 * down this connection is refused by the server rather than reviewed by a human.
 * It also tells Postgres this transaction can never contribute to a conflict.
 *
 * **`serializable` would be wrong**, not merely stronger: it makes a read-only
 * transaction abortable with `40001`, nothing in `src/` retries that code
 * (docs/postmortems/260901f-a-for-update-that-locks-nothing.md is the last time
 * that mattered), and a snapshot is all a read needs.
 */
const SNAPSHOT = { isolationLevel: "repeatable read", accessMode: "read only" } as const;

/**
 * The walk itself, on one connection, in order.
 *
 * **The cost, measured rather than waved at.** The nine child reads used to run
 * through the pool with `Promise.all`, on up to five connections at once. A
 * transaction is *one* connection, and one connection runs one statement at a
 * time, so that parallelism is gone. Against
 * `noema-mythology-of-conscious-ai` (141 blocks, 58 chat messages) on the local
 * database, 40 runs of each interleaved in one process so they share the
 * machine's noise:
 *
 *     Promise.all, no transaction   median 20.1 ms   (what this replaced)
 *     sequential, in the snapshot   median 32.5 ms   (what this is)
 *     Promise.all inside that same transaction   median 27.9 ms
 *
 * So the snapshot costs about **12 ms per walk** here, and about 5 ms of that
 * is the sequencing rather than the transaction. That third line is not taken,
 * deliberately: `pg` does queue statements on one connection, so it is *safe*
 * for consistency, but when one of nine fails the other eight are still queued,
 * drizzle's `rollback` lands behind them, and each of the eight rejects into a
 * `Promise.all` that has already settled — eight unhandled rejections in
 * exchange for five milliseconds. Sequential also stops at the first failure.
 *
 * The walk is now **twelve round trips** — `BEGIN`, ten selects, `COMMIT` —
 * where it was one select and then nine over five connections. That is the
 * number that matters somewhere latency-bound; against the remote pooler each
 * one is tens of milliseconds. It is paid on an explicit Export press and on
 * `npm run db:export`, neither of which is a hot path, and the alternative is a
 * download that silently omits rows. If it ever needs to be cheaper, the honest
 * fix is fewer statements, not a wider snapshot.
 *
 * The other cost is that a caller now **holds a pooled connection for the whole
 * walk** rather than borrowing one per statement. The pool is five
 * (src/db/client.ts § `poolMax`), so four concurrent exports and the server is
 * out of connections. That is a reason not to grow this function into anything
 * slow, and the reason the zip is assembled *after* it returns rather than
 * inside it.
 */
async function walk(tx: Tx, slug: string): Promise<ArticleRows> {
  const found = (
    await tx
      .select({ article: articles, revision: articleRevisions })
      .from(articles)
      .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
      .where(ownedSlug(slug))
      .limit(1)
  )[0];
  if (!found) throw new ArticleNotFound(slug);
  const { article, revision } = found;

  const blocks = await tx
    .select()
    .from(revisionBlocks)
    .where(eq(revisionBlocks.revisionId, revision.id))
    .orderBy(revisionBlocks.ordinal);
  const identities = await tx
    .select()
    .from(blockIdentities)
    .where(eq(blockIdentities.articleId, article.id))
    .orderBy(asc(blockIdentities.firstSeenAt), asc(blockIdentities.blockId));
  const comments = await tx
    .select()
    .from(commentsTable)
    .where(eq(commentsTable.articleId, article.id))
    .orderBy(asc(commentsTable.createdAt), asc(commentsTable.id));
  const threads = await tx
    .select()
    .from(chatThreads)
    .where(eq(chatThreads.articleId, article.id))
    .orderBy(asc(chatThreads.createdAt), asc(chatThreads.id));
  /* One query for every thread's messages rather than one per thread. The
     filter is on `article_id` — a thread id is unique only within its article
     (`chat_threads`'s primary key is `(article_id, id)`, the same rule as
     block ids), so a query keyed on `thread_id` alone would mix two articles'
     conversations together. */
  const messages = await tx
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.articleId, article.id))
    .orderBy(asc(chatMessages.threadId), asc(chatMessages.ordinal));
  const runs = await tx
    .select()
    .from(searchRuns)
    .where(eq(searchRuns.articleId, article.id))
    .orderBy(asc(searchRuns.createdAt), asc(searchRuns.id));
  const criteria = await tx
    .select()
    .from(refereeCriteria)
    .where(eq(refereeCriteria.articleId, article.id))
    .orderBy(asc(refereeCriteria.createdAt), asc(refereeCriteria.id));
  const claims = await tx
    .select()
    .from(refereeClaims)
    .where(eq(refereeClaims.articleId, article.id))
    .limit(1);
  const lookups = await tx
    .select()
    .from(glossaryLookups)
    .where(eq(glossaryLookups.articleId, article.id))
    .orderBy(asc(glossaryLookups.entryId));

  return {
    article,
    revision,
    blocks,
    blockIdentities: identities,
    comments,
    chatThreads: threads,
    chatMessages: messages,
    searchRuns: runs,
    refereeCriteria: criteria,
    refereeClaims: claims,
    glossaryLookups: lookups,
  };
}

/**
 * One thread's messages, in order — the grouping every caller of
 * `ArticleRows.chatMessages` needs.
 *
 * A thread with no messages is a real state, so this can legitimately answer
 * empty; the rollback counts what comes back rather than assuming a thread row
 * implies a message row, because `chat.json` is written from two tables and
 * claiming coverage it had not exercised is the shape of thing the coverage
 * record exists to stop.
 */
export function messagesOfThread(
  rows: ArticleRows,
  threadId: string,
): readonly (typeof chatMessages.$inferSelect)[] {
  return rows.chatMessages.filter((message) => message.threadId === threadId);
}
