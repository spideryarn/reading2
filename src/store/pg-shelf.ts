/**
 * The shelf's writes, and the library-wide search box — the Postgres halves.
 *
 * Split out of src/store/pg.ts rather than added to it for the reason that file
 * gives about itself: it is the **read** store, and the one property a read
 * store has going for it is that it cannot change anything. These are writes.
 * Search is here rather than there for a weaker but real reason — it is the only
 * thing in the codebase that touches `revision_blocks.fts`, and keeping the one
 * `tsvector` query beside the one column it queries means the two cannot drift
 * apart unnoticed.
 *
 * Same three rules as pg.ts, and they bite here too:
 *
 * 1. `exactOptionalPropertyTypes` is on — every optional field is a conditional
 *    spread, because Postgres says `null` where the file said nothing.
 * 2. Errors carry a `status`, or routes.ts turns "no such article" into a 500.
 * 3. **No fallback to the filesystem, ever.** Not even for "the article is only
 *    on disk". A silent fallback hides the divergence the parity test exists to
 *    find. See docs/plans/260826e-postgres-storage-implementation.md § Rules.
 */

import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articles, articleRevisions, jobs, revisionBlocks } from "../db/schema.js";
import { MAX_TITLE_CHARS } from "../shelf.js";
import { MAX_PURPOSE_CHARS, normaliseProfileText } from "../profile.js";
import { log } from "../log.js";
import { currentOwnerId, type OwnerId } from "../owner.js";
import { READ_COMMITTED } from "./isolation.js";
import { lockBillingAccount } from "./pg-billing.js";
import { TERMINAL } from "./pg-jobs.js";
import { notFound, ownedByReader, ownedSlug, requireSlug, shelfFrom } from "./pg.js";
import type { LibrarySearch, LibrarySearchOptions, ShelfStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import type { LibraryEntry, LibraryHit, ShelfState } from "../types.js";
import { pgArticleReader } from "./pg.js";

/**
 * The text-search configuration, in the one place that is allowed to name it.
 *
 * It must be the same string the generated column in src/db/schema.ts uses. A
 * vector built with `'english'` and queried with `'simple'` matches almost
 * nothing and raises no error at all — the query is valid, the stems just never
 * line up. That is the whole failure: a search box that returns nothing and
 * looks like an empty library.
 */
const CONFIG = "english";

/**
 * **The article this delete is about to destroy, read and locked** — taking its
 * builder so a test can read the SQL rather than a constant beside it.
 *
 * The same shape and the same reason as `lockedGlossaryArticleQuery`
 * ([pg-glossary.ts](pg-glossary.ts)) and `lockedArticleQuery`
 * ([pg-visibility.ts](pg-visibility.ts)), and the finding behind all three is
 * one finding: deleting `.for("update")` leaves the entire suite green, because
 * a lock's absence is only visible while a race is actually happening.
 * `tests/store-shelf-pg.test.ts` reads this statement instead, and that
 * assertion fires every time.
 *
 * **`for update` is the whole ordering argument here, and it is doing more work
 * than it does for the glossary.** It is the same row `lockOrCreateArticle`
 * takes (src/store/pg-revisions.ts) and — since Sol's F4, 2026-09-06 — the same
 * row `tryEnqueue` takes before inserting a job. So the three are serialised
 * against each other: either the delete gets it and a later enqueue re-reads
 * absence and answers 404, or the enqueue gets it and the job check below sees
 * a committed row and refuses. Without it, an enqueue that had already passed
 * `articleExists` can insert *after* the check and *before* the delete, and the
 * worker that picks that job up recreates the article the reader destroyed.
 *
 * **Through `ownedSlug`, like everything else**, so the owner check and the
 * lookup are one clause and there is no window between "whose is it" and
 * "destroy it".
 */
export function lockedArticleForDestroyQuery(
  db: Pick<ReturnType<typeof getDb>, "select">,
  slug: string,
  ownerId: OwnerId,
) {
  return db
    .select({ id: articles.id })
    .from(articles)
    .where(ownedSlug(slug, ownerId))
    .for("update")
    .limit(1);
}

/**
 * **Is anything working on this article right now?**
 *
 * Deliberately **broader** than `liveJobHoldingADraftQuery` in
 * [pg-glossary.ts](pg-glossary.ts), which this was first written as a copy of,
 * and the two narrowings that file makes on purpose are the two this must not
 * inherit. GPT Sol's F3, 2026-09-06.
 *
 * - **A claimed job that has not opened its draft yet counts.** The glossary
 *   query misses it, correctly for its own question — it is asking whether a
 *   job could put the deleted list back, and a job with no draft cannot. This
 *   asks a different question, and `draft_revision_id is null` is the ordinary
 *   *first* state of every ingest (src/db/schema.ts § `draft_revision_id`).
 *   That job is charged, and deleting the article under it strands its
 *   reservation.
 * - **A running job whose lease has expired counts.** The glossary query
 *   excludes it through `leaseIsLive`, again correctly: a fenced-out job cannot
 *   publish. But it is not finished — `settleExpired` puts it back to `queued`
 *   on the same row and it carries on (src/db/schema.ts § `requeues`) — so it
 *   is a wait the reader can end by pressing Stop, not a row to delete under.
 *
 * `done`, `error` and `cancelled` are the three this does **not** match, and
 * that is measured rather than assumed: both slug indexes are partial on
 * `status in ('queued','running')`, so a terminal row blocks nothing and the
 * reader can re-add the same URL afterwards. It does not stay as history
 * either — `deleteTerminalJobs` below says why the delete takes it.
 *
 * **Owner-scoped as well as slug-scoped.** `jobs.slug` carries no foreign key
 * and no owner filter of its own, so without `owner_id` this would let one
 * reader's job refuse another reader's delete — which is both a leak (the 409
 * says the slug is busy) and a denial of service.
 *
 * **No `limit`, because it locks.** Every matching row is locked, not just the
 * first: the point is to hold whatever is live still for the length of this
 * transaction. Nothing is locked when nothing matches, which is exactly the
 * hole the article lock above closes
 * (docs/postmortems/260901f-a-for-update-that-locks-nothing.md).
 */
function liveJobsForQuery(
  db: Pick<ReturnType<typeof getDb>, "select">,
  slug: string,
  ownerId: OwnerId,
) {
  return db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.ownerId, ownerId),
        eq(jobs.slug, slug),
        inArray(jobs.status, ["queued", "running"]),
      ),
    )
    .for("update");
}

/**
 * **The import the reader is being asked to stop**, in the words they will see.
 *
 * A sentence rather than a code, and written for somebody who pressed a button:
 * it says what is in the way and what to do about it, and nothing about leases,
 * reservations or drafts. The same discipline as `jobRunning` in
 * [pg-glossary.ts](pg-glossary.ts).
 *
 * **Refusing is the cheap answer, not the cautious one.** The first draft of
 * this deleted the slug's non-terminal jobs instead, to clear the
 * `jobs_reserved_slug` collision the Stage A spike measured — and that leaks the
 * job's quota slot for ever, because deleting a job deliberately does not touch
 * its reservation (src/db/schema.ts § `ingest_event_id`) and an unsettled
 * reservation deliberately never expires (§ `ingest_events`). Refusing solves
 * the collision as well: the reader stops the import, which settles the
 * reservation through the path that exists for it, and then deletes.
 */
function importRunning(): Error {
  return Object.assign(
    new Error(
      "An import is running on this article, so it cannot be deleted yet. Stop it, or wait " +
        "for it to finish, then delete.",
    ),
    { status: 409 },
  );
}

/**
 * **Why the finished jobs go with the article, when the running ones stop it.**
 *
 * Not a function — the delete is three lines inside `destroy` — but the argument
 * needs a home, because the two halves look contradictory: a live job makes the
 * delete refuse, and a terminal one is deleted outright.
 *
 * ## What a leftover terminal row can do
 *
 * `jobs` has no `article_id`; it is keyed by `slug` text and is invisible to the
 * cascade. Stage C left the terminal rows on the grounds that they are inert
 * against all four of the queue's partial unique indexes, which is true and is
 * not the whole question. `retryJob` (src/jobs.ts) copies the failed attempt's
 * own `url` or `upload` into the new request, and `slugForRetry` deliberately
 * keeps the failed attempt's own slug — so **Retry on a long-dead failure
 * queues a job for the destroyed slug, and the worker's `lockOrCreateArticle`
 * remakes the article.** That is not a race the reader has to win: the row
 * survives on purpose, so they can do it weeks later. GPT Sol's F20,
 * docs/plans/260906h-delete-an-article-permanently.md.
 *
 * ## Why deleting them cannot leak a quota slot, where deleting a live one can
 *
 * F3 is why an *active* job is refused rather than deleted: it may be holding an
 * unsettled reservation, deleting the row does not settle it
 * (src/db/schema.ts § `ingest_event_id`), and an unsettled reservation never
 * expires (§ `ingest_events`).
 *
 * A terminal job cannot be in that state, and this is a property of the code
 * rather than an observation about the rows. **Every transition into a terminal
 * status settles the reservation inside the same transaction**, and there are
 * only four of them: `settlingIfTerminal` (pg-jobs.ts) wraps `releaseStep` and
 * `finish`, `requestCancel` settles on the branch that answers `cancelled`,
 * `settleExpired`'s sweep releases everything it ended, and `settleIn`
 * (pg-session.ts) succeeds the slot in the publishing transaction. So by the
 * time a row is `done`, `error` or `cancelled` its slot is already `succeeded_at`
 * or `released_at`, and the `ingest_events` row — which is what the bill is
 * computed from — is untouched by this delete in either case. `jobs.ingest_event_id`
 * is `NO ACTION` in both directions.
 *
 * `pgJobStore.forget` and `trimFinished` have deleted terminal rows on exactly
 * this reasoning since before any of it was written down; this is the same
 * operation, chosen by article rather than by hand.
 *
 * ## Owner-scoped, like everything else here
 *
 * `articles.slug` is globally unique, so another owner cannot have this article
 * — but they *can* have a terminal job that lost the race for the name, and it
 * is not this delete's business. Their retry would create *their* article, which
 * is a different row and already possible today.
 */
function deleteTerminalJobs(
  tx: Pick<ReturnType<typeof getDb>, "delete">,
  slug: string,
  ownerId: OwnerId,
) {
  return tx
    .delete(jobs)
    .where(and(eq(jobs.ownerId, ownerId), eq(jobs.slug, slug), inArray(jobs.status, TERMINAL)));
}

const rawPgShelfStore: ShelfStore = {
  async read(slug: string): Promise<ShelfState> {
    requireSlug(slug);
    const db = getDb();
    const [row] = await db.select().from(articles).where(ownedSlug(slug)).limit(1);
    if (!row) throw notFound(slug);
    return shelfFrom(row);
  },

  /**
   * Both fields in **one** `UPDATE`.
   *
   * Two statements would be two chances for a reader to see half of one act,
   * and — worse on the route side — a chance to write the first and reject the
   * second. See `ShelfStore.patch`.
   */
  async patch(slug, change): Promise<LibraryEntry> {
    requireSlug(slug);

    const title = change.title === undefined ? undefined : (change.title?.trim() ?? "");
    if (title !== undefined && title.length > MAX_TITLE_CHARS) {
      throw Object.assign(new Error(`Title must be ${MAX_TITLE_CHARS} characters or fewer`), {
        status: 400,
      });
    }

    // `normaliseProfileText`, not `trim()` — this column has to agree with the
    // filesystem store's normalisation byte for byte, or the same purpose typed
    // twice would hash to two different values. See src/shelf.ts.
    const purpose =
      change.purpose === undefined ? undefined : normaliseProfileText(change.purpose);
    if (purpose && purpose.length > MAX_PURPOSE_CHARS) {
      throw Object.assign(new Error(`Purpose must be ${MAX_PURPOSE_CHARS} characters or fewer`), {
        status: 400,
      });
    }

    const set: Record<string, unknown> = {};
    // Whitespace-only clears the override, exactly as it does on disk.
    if (title !== undefined) set.titleOverride = title || null;
    if (purpose !== undefined) set.purpose = purpose || null;
    if (change.archived !== undefined) {
      /* `coalesce(archived_at, now())` rather than a plain `now()`: archiving
         something already archived keeps the ORIGINAL date. Undo is one click
         away and a second Delete must not quietly reset the clock — the same
         rule src/shelf.ts keeps on the filesystem side. */
      set.archivedAt = change.archived ? sql`coalesce(${articles.archivedAt}, now())` : null;
    }
    // The route refuses an empty change before it gets here; this is the
    // belt-and-braces that stops a future caller producing `UPDATE … SET` with
    // nothing after it, which is a syntax error rather than a no-op.
    if (Object.keys(set).length === 0) return entryFor(slug, false);

    const [row] = await db().update(articles).set(set).where(ownedSlug(slug)).returning();
    if (!row) throw notFound(slug);
    return entryFor(slug, !!row.archivedAt);
  },

  async recordOpen(slug: string): Promise<void> {
    requireSlug(slug);
    /* `opens + 1` computed by Postgres, never read-then-write from here. Two
       tabs opening the same article at once would otherwise both read 4, both
       write 5, and lose one — with both writes reporting success, which is the
       failure this repo keeps finding (docs/reusable/silent-success.md). The
       filesystem side gets the same guarantee a different way, by serialising
       its read-modify-write in one process. */
    const [row] = await db()
      .update(articles)
      .set({ opens: sql`${articles.opens} + 1`, lastOpenedAt: sql`now()` })
      .where(ownedSlug(slug))
      .returning({ slug: articles.slug });
    if (!row) throw notFound(slug);
  },

  /**
   * **One statement, and the cascade does the rest.** See `ShelfStore.destroy`
   * for what the three answers mean; this is why it is shaped the way it is.
   *
   * ## Why nothing is tidied up first
   *
   * `articles_current_revision_fk` is `NO ACTION` and **not deferrable**, so it
   * is checked at the end of each *statement* rather than at commit. Deleting
   * the children by hand first therefore fails, and wrapping that in a
   * transaction rescues nothing — measured, both ways round, by the Stage A
   * spike on a fully populated article
   * (docs/plans/260906h-delete-an-article-permanently.md § What the spike
   * found). The single `delete from articles` succeeds on exactly that row.
   *
   * So the transaction here is not for the delete. It is for the three
   * decisions in front of it, which have to be taken against a state nothing
   * can move underneath them.
   *
   * ## The lock order, which is not negotiable
   *
   * `billing_accounts` **before** `articles`, everywhere — the rule
   * [pg-billing.ts](pg-billing.ts) § *The lock order* states and the reason it
   * is stated as *everywhere*: a consistent order is what stops this
   * deadlocking, so a second writer that took the article first and the billing
   * row second would be the cycle. Deleting an article moves usage in exactly
   * the way an unshare does, which is why this transaction is in the rule at
   * all — and since 2026-09-06 the price is frozen by a `BEFORE DELETE` trigger
   * on `articles` (Stage B), which runs inside this lock and therefore cannot
   * read a visibility somebody is changing.
   *
   * `lockBillingAccount` creates the row if the reader has none, because a
   * `FOR UPDATE` that matches nothing locks nothing
   * (docs/postmortems/260901f-a-for-update-that-locks-nothing.md) — a free
   * reader is precisely the case the boundary is for.
   *
   * ## What survives, deliberately
   *
   * The four `on delete set null` tables keep their rows with a null
   * `article_id`: `ai_calls` and `ingest_events` because the ledger outlives
   * everything, `article_visibility_changes` because takedown evidence about a
   * document we no longer serve is exactly what a late complaint needs, and
   * `realtime_sessions`. Terminal `jobs` rows and the `uploads` row survive
   * with a stale `slug` and no foreign key at all — neither has a unique index
   * on it, so they dangle harmlessly.
   *
   * **The `uploads` row is left alone on purpose.** Deleting it destroys the
   * only durable mapping from this article back to its staging object
   * ([pg-uploads.ts](pg-uploads.ts) § `forget`), and Stage E owns removing that
   * object. Removing the row here would make the bytes unreachable rather than
   * deleted, which is the failure that stage exists to prevent.
   */
  async destroy(slug: string): Promise<{ destroyed: string }> {
    /* Before any query, so a pasted title comes back as "that is not a name"
       rather than as "there is no such article". tests/store-slug-guard.test.ts. */
    requireSlug(slug);

    /* Read once, out here, and passed down. Asking `currentOwnerId()` again at
       each of the three sites would be three opinions that can differ — the
       argument `ownedSlug` (src/store/owned-slug.ts) already makes about the AI
       ledger, and it matters more here than anywhere: the owner in the `where`
       of the DELETE has to be the owner the lock was taken as. */
    const ownerId = currentOwnerId();

    return getDb().transaction(async (tx) => {
      /* **An unlocked read, and it has to come first.** `lockBillingAccount`
         below *creates* the reader's billing row if they have none — so taking
         it before establishing that the article is theirs means a request that
         is about to be refused writes a row on its way out. For a stranger with
         a real account that is a harmless empty anchor; for one without,
         `billing_accounts.owner_id` references `auth.users(id)` and the whole
         thing comes back as a `23503` wearing a 500 instead of the 404 it is.
         Watched doing exactly that, 2026-09-06, by
         tests/owner-isolation.test.ts.

         **This is not the authorising read**, and moving the locked one up here
         instead would break the lock order (`billing_accounts` before
         `articles`, everywhere) and put the documented deadlock cycle back. A
         plain `SELECT` takes no row lock at all, so it is outside that order and
         cannot be half of a cycle. It refuses early and never permits: the
         answer that counts is the locked re-read below, which is the one the
         DELETE is ordered against. */
      const [seen] = await tx
        .select({ id: articles.id })
        .from(articles)
        .where(ownedSlug(slug, ownerId))
        .limit(1);
      if (!seen) throw notFound(slug);

      await lockBillingAccount(tx, ownerId);

      const [article] = await lockedArticleForDestroyQuery(tx, slug, ownerId);
      if (!article) throw notFound(slug);

      const live = await liveJobsForQuery(tx, slug, ownerId);
      if (live.length > 0) throw importRunning();

      /* **And the finished ones go with it**, in this transaction, and only
         after the refusal above has established there are no others. See
         `deleteTerminalJobs` for why a terminal row is safe to delete and an
         active one is not. */
      await deleteTerminalJobs(tx, slug, ownerId);

      const result = await tx.delete(articles).where(ownedSlug(slug, ownerId));

      /* `rowCount === 1`, never `>= 1` and never ignored — the house idiom for a
         conditional write. The `where` names a globally unique slug, so any
         other number is a bug rather than a busier day, and reporting
         `{ destroyed }` over a zero would be the silent success this repo keeps
         writing up: the client navigates away and the article is still there. */
      if (result.rowCount !== 1) throw notFound(slug);

      return { destroyed: slug };
    }, READ_COMMITTED);
  },
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgShelfStore: ShelfStore = guardDbStore("shelf", rawPgShelfStore);

/** `getDb()`, named so the statements above read as statements. */
const db = () => getDb();

/**
 * The article as the shelf now describes it.
 *
 * Through `listArticles` rather than assembled here, so the card the client
 * renders after a write comes from the same derivation as the card before it.
 * A second way of building a `LibraryEntry` is the divergence this seam exists
 * to make impossible — and it is worth the extra query at this size.
 */
async function entryFor(slug: string, archived: boolean): Promise<LibraryEntry> {
  const entries = await pgArticleReader.listArticles({ archived });
  const entry = entries.find((e) => e.slug === slug);
  if (!entry) {
    // The write above already proved the row exists, so this is "not a complete
    // article" (no tree, no blocks), not "no such article". Different problem,
    // different place to look.
    throw Object.assign(
      new Error(`No shelf entry for ${slug} after writing — is it a complete article?`),
      { status: 404 },
    );
  }
  return entry;
}

const rawPgLibrarySearch: LibrarySearch = {
  async searchLibrary(query: string, limit: number, opts: LibrarySearchOptions = {}) {
    const trimmed = query.trim();
    if (!trimmed) return { hits: [], capped: false };

    const db = getDb();

    /* `websearch_to_tsquery`, not `to_tsquery` or `plainto_tsquery`.
       `to_tsquery` demands operator syntax and throws a 42601 on a bare
       sentence — a search box that 500s when you type two words. `plainto_`
       ANDs everything and understands no syntax at all. `websearch_to_` is the
       one that takes what a person types: quoted phrases, `or`, a leading `-`
       to exclude. It never throws on malformed input, which is the property
       that matters when the input is a half-typed word.

       So `qualia OR "hard problem"` becomes `'qualia' | ( 'hard' <-> 'problem' )`
       — a real disjunction with a real phrase in it. The filesystem adapter
       cannot do any of that and does not pretend to; src/library-search.ts
       § parseQuery says so out loud. */
    const tsquery = sql`websearch_to_tsquery(${CONFIG}, ${trimmed})`;

    /* `ts_headline` is deliberately NOT used for the snippet. It re-parses the
       document per row, is the expensive half of a query like this, and returns
       HTML we would then have to sanitise — for a result the client can get by
       finding the words itself, which it already does for in-article hits
       (src/web/search-hits.ts). So: return the block's text and let the client
       mark it. One highlighter, not two that disagree. */
    /* Normalisation flag **1** — divide the rank by `1 + log(document length)`
       — not the default 0, which is no normalisation at all. Without it a long
       paragraph outranks a short one simply by containing more words, and the
       filesystem adapter explicitly damps for length, so the two would have
       disagreed about which hit is best for a reason nobody had chosen.
       https://www.postgresql.org/docs/17/textsearch-controls.html */
    const rank = sql<number>`ts_rank_cd(${revisionBlocks.fts}, ${tsquery}, 1)`;

    /* One more than asked for, so "there were more" is a fact rather than a
       guess. A list that is silently cut reads as "that is everything". */
    const rows = await db
      .select({
        slug: articles.slug,
        title: sql<string>`coalesce(${articles.titleOverride}, ${articleRevisions.title}, ${articles.slug})`,
        blockId: revisionBlocks.blockId,
        text: revisionBlocks.text,
        rank,
      })
      .from(revisionBlocks)
      .innerJoin(articleRevisions, eq(articleRevisions.id, revisionBlocks.revisionId))
      /* Joined on `current_revision_id`, not just on `article_id`. Without it a
         search would return the same paragraph once per historical revision —
         and since the pipeline publishes a new revision on every re-run, an
         article you had rebuilt three times would quietly outrank everything
         else by having three copies of itself in the results. */
      .innerJoin(
        articles,
        and(eq(articles.id, revisionBlocks.articleId), eq(articles.currentRevisionId, revisionBlocks.revisionId)),
      )
      .where(
        and(
          /* **Your library, not the union of everybody's.** This one is reached
             by chat's `search_library` tool as well as by the reader's own box,
             so without it a model answering your question could quote a
             stranger's article back at you. src/store/pg.ts § `ownedSlug`. */
          ownedByReader(),
          // Archived articles are out of the index, not filtered from the
          // results: a hit that opens an article you deleted reads as a ghost.
          isNull(articles.archivedAt),
          /* In the WHERE clause, so it happens before `limit` below. Chat's
             `search_library` asks for this to leave out the article the reader
             already has open, and removing it from the returned rows instead
             would let it spend every place in the list first — which is
             exactly the bug `LibrarySearchOptions` in ./contracts.ts describes.
             An unknown slug simply excludes nothing; `ne` on a column with no
             such value is true for every row. */
          ...(opts.excludeSlug ? [ne(articles.slug, opts.excludeSlug)] : []),
          /* Headings and media carry no prose worth a snippet, and a hit on a
             one-word heading is noise at the top of the list.

             **And no `treatment <> 'supplement'` beside it, deliberately.** This
             is library full-text search, and `isSearchable` in
             src/block-policy.ts is the one predicate of the five that includes
             supplements: a note is often the best sentence in a piece, and a
             reader who searches for it has to find it. docs/plans/260828o-footnotes.md
             recorded the opposite as work to do and was wrong; GPT Sol's
             decision 4. tests/library-search.test.ts holds the filesystem half
             to the same rule, and tests/block-policy.test.ts guards this line. */
          eq(revisionBlocks.gistable, true),
          sql`${revisionBlocks.fts} @@ ${tsquery}`,
        ),
      )
      /* Tie-broken by slug then position, so two equally-ranked passages come
         back in the same order every time. Without it the cap below silently
         keeps a different hit on different runs, and a result list that
         reshuffles for no visible reason reads as a bug. */
      .orderBy(desc(rank), asc(articles.slug), asc(revisionBlocks.ordinal))
      .limit(limit + 1);

    const capped = rows.length > limit;
    const hits: LibraryHit[] = rows.slice(0, limit).map((row) => ({
      slug: row.slug,
      title: row.title,
      blockId: row.blockId,
      text: row.text,
      rank: Number(row.rank),
    }));

    log("store").debug({ hits: hits.length, capped }, "library search");
    return { hits, capped };
  },
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgLibrarySearch: LibrarySearch = guardDbStore("library", rawPgLibrarySearch);
