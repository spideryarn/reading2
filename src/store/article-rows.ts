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

import { getDb } from "../db/client.js";
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
 * `article_id` column, or a foreign key to something that has one. The second
 * half was missing until 2026-09-01 and `revision_step_runs` was the table it
 * missed — keyed by `revision_id` alone, article-scoped in substance, and
 * invisible to a collector that only looked for `articleId`.
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
 * Read one article whole, **owner-scoped**, or throw `ArticleNotFound`.
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
  const db = getDb();
  const found = (
    await db
      .select({ article: articles, revision: articleRevisions })
      .from(articles)
      .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
      .where(ownedSlug(slug))
      .limit(1)
  )[0];
  if (!found) throw new ArticleNotFound(slug);
  const { article, revision } = found;

  /* In parallel because they are independent reads of one article and nothing
     here holds a transaction; `pg`'s pool queues when it is smaller than this. */
  const [
    blocks,
    identities,
    comments,
    threads,
    messages,
    runs,
    criteria,
    claims,
    lookups,
  ] = await Promise.all([
    db
      .select()
      .from(revisionBlocks)
      .where(eq(revisionBlocks.revisionId, revision.id))
      .orderBy(revisionBlocks.ordinal),
    db
      .select()
      .from(blockIdentities)
      .where(eq(blockIdentities.articleId, article.id))
      .orderBy(asc(blockIdentities.firstSeenAt), asc(blockIdentities.blockId)),
    db
      .select()
      .from(commentsTable)
      .where(eq(commentsTable.articleId, article.id))
      .orderBy(asc(commentsTable.createdAt), asc(commentsTable.id)),
    db
      .select()
      .from(chatThreads)
      .where(eq(chatThreads.articleId, article.id))
      .orderBy(asc(chatThreads.createdAt), asc(chatThreads.id)),
    /* One query for every thread's messages rather than one per thread. The
       filter is on `article_id` — a thread id is unique only within its article
       (`chat_threads`'s primary key is `(article_id, id)`, the same rule as
       block ids), so a query keyed on `thread_id` alone would mix two articles'
       conversations together. */
    db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.articleId, article.id))
      .orderBy(asc(chatMessages.threadId), asc(chatMessages.ordinal)),
    db
      .select()
      .from(searchRuns)
      .where(eq(searchRuns.articleId, article.id))
      .orderBy(asc(searchRuns.createdAt), asc(searchRuns.id)),
    db
      .select()
      .from(refereeCriteria)
      .where(eq(refereeCriteria.articleId, article.id))
      .orderBy(asc(refereeCriteria.createdAt), asc(refereeCriteria.id)),
    db.select().from(refereeClaims).where(eq(refereeClaims.articleId, article.id)).limit(1),
    db
      .select()
      .from(glossaryLookups)
      .where(eq(glossaryLookups.articleId, article.id))
      .orderBy(asc(glossaryLookups.entryId)),
  ]);

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
