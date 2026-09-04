/**
 * "Find every passage that…" — the Postgres half. src/searches.ts is the other.
 *
 * The decision about *which* run a request produces is not here. It is
 * `withRun` in src/searches.ts, which both stores call, because it holds the
 * three-condition retry rule this repo carries a postmortem for
 * (docs/postmortems/260826f-search-retry-remints-instead-of-resetting.md) and a rule
 * with two implementations is a rule with two behaviours. What is here is
 * persistence, plus the one thing the filesystem cannot express: **which
 * attempt is speaking**.
 *
 * ## The attempt fence
 *
 * A *run* is the reader's question. An *attempt* is one call to the model. The
 * filesystem store has only the first, and sweeps stale runs by asking an
 * in-process `Set` which ones it started — right for one server on one disk,
 * and wrong the moment two processes share a database:
 *
 * 1. Process A takes the POST and starts a run.
 * 2. Process B takes a GET a second later, finds A's `pending` run in nobody's
 *    set, and marks it `error`.
 * 3. The reader sees a failure and retries.
 * 4. A's model call returns, and `finishRun` — matching on the run's identity
 *    and nothing else — writes the old answer over the retry.
 *
 * Nothing in that sequence is exotic; on Vercel it is the ordinary shape. So
 * every attempt gets an id and a start time, the sweep may only bury an attempt
 * old enough that no process could still be on it, and a finish must name the
 * attempt it is reporting for. GPT Sol's review called this the single change
 * that most reduces risk in this step.
 *
 * ## The article lock is the mutex
 *
 * src/searches.ts serialises every write in the process through one promise
 * chain. Here it is `select … from articles … for update`, which is stronger
 * (it holds across processes) and observably the same (every concurrent pair
 * that both succeed today both succeed here). Article-wide rather than
 * per-run because minting scans every id in the article.
 *
 * **No model call happens inside these transactions.** The lock is held for the
 * two or three statements it takes to write rows the caller already has.
 *
 * ## What may be logged from this file
 *
 * Ids, slugs, counts, statuses. **Never `criterion`, never a hit's `quote` or
 * `reasoning`, never the stored `error` string** — src/searches.ts explains at
 * length why the last one matters, and it is the same reason here: the string
 * is whatever the provider said, and one provider echoes the request back.
 */

import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { searchRuns } from "../db/schema.js";
import { log } from "../log.js";
import { currentOwnerId } from "../owner.js";
import { MAX_RUNS, requireColour, withRun } from "../searches.js";
import type { SearchHit, SearchRun } from "../types.js";
import { MissingAttempt, type SearchStore, type SweepOptions } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { READ_COMMITTED } from "./isolation.js";
import { articleIdForOwned, lockArticleRow, sourceHashFor } from "./pg.js";

const logger = log("store");

/**
 * The database's clock at the moment the statement runs — **not this process's,
 * and not `now()`**.
 *
 * Taking the time in TypeScript before the transaction is wrong twice over. It
 * is a different clock from the one the sweep compares against, so skew between
 * two servers becomes a birth defect in every lease; and it is read before the
 * wait for the article lock, so a write that queued for four seconds starts
 * life four seconds old and can be swept before its model call has begun.
 *
 * `clock_timestamp()` rather than `now()` for the second reason again: `now()`
 * is the *transaction's* start time, which is also before the lock wait. GPT
 * Sol raised both, 2026-08-26.
 */
const DB_NOW = sql`clock_timestamp()` as unknown as Date;

/** What the sweep writes. Identical to src/routes.ts's string, deliberately. */
const SWEPT = "The server stopped before this search finished.";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Db = ReturnType<typeof getDb>;

/** A row as the client sees it. Absent, not null — `exactOptionalPropertyTypes`. */
function toRun(row: typeof searchRuns.$inferSelect): SearchRun {
  return {
    id: row.id,
    criterion: row.criterion,
    createdAt: row.createdAt.toISOString(),
    status: row.status as SearchRun["status"],
    hits: row.hits as SearchHit[],
    ...(row.model === null ? {} : { model: row.model }),
    ...(row.error === null ? {} : { error: row.error }),
    ...(row.sourceHash === null ? {} : { sourceHash: row.sourceHash }),
    ...(row.colour === null ? {} : { colour: row.colour }),
  };
}

/**
 * Every run for the article, oldest first.
 *
 * `created_at, id` and **not** `created_at` alone: two runs started in the same
 * microsecond would otherwise swap places between requests, where the file's
 * order is insertion order and never moves. It is the identical clause
 * src/store/export.ts uses, and it has to stay identical — a write through this
 * store and a read through the exporter disagreeing about array order turns the
 * round-trip test red for a reason that is not a bug.
 */
async function runsFor(articleId: string, db: Db | Tx = getDb()): Promise<SearchRun[]> {
  const rows = await db
    .select()
    .from(searchRuns)
    .where(eq(searchRuns.articleId, articleId))
    .orderBy(asc(searchRuns.createdAt), asc(searchRuns.id));
  return rows.map(toRun);
}

const rawPgSearchStore: SearchStore = {
  async load(slug: string): Promise<SearchRun[]> {
    return runsFor(await articleIdForOwned(slug));
  },

  async sourceHash(slug: string): Promise<string | undefined> {
    return sourceHashFor(await articleIdForOwned(slug));
  },

  async begin(
    slug: string,
    criterion: string,
    wantedId?: string,
    now: () => string = () => new Date().toISOString(),
  ): Promise<{ run: SearchRun; attempt: string | undefined }> {
    const db = getDb();
    const articleId = await articleIdForOwned(slug);
    const at = now();
    const attempt = randomUUID();

    const run = await db.transaction(async (tx) => {
      await lockArticleRow(tx, articleId);
      /* Inside the lock, so the fingerprint and the row are written against one
         state of the article. Outside it, a re-extraction committing between
         **these two reads** would stamp a run with a hash of blocks the model
         was never shown. The filesystem half cannot take a lock and says so
         where it reads (src/searches.ts § beginRun).

         **What the lock does not cover, found by GPT Sol on 2026-09-04.** It
         ends when this transaction commits, and `search` in src/routes.ts calls
         `loadArticle(slug)` *after* that — so a re-extraction landing in the
         gap gives the model R2's blocks and leaves this row holding R1's hash.
         The run is then reported **stale when it is exactly current**, which is
         the opposite failure from the one above and the harmless one of the
         two: a false "older version" on a fresh answer, self-correcting on the
         next run. The comment here used to imply the lock closed both windows
         and it never did.

         Fixing it properly means fingerprinting the blocks the model was
         actually shown — `finishRun` writing the hash of `article.blocks`
         rather than `begin` writing the hash of whatever was current when it
         took the lock — which is a change to this store's write path and
         belongs to whoever owns searches, not to the public read that surfaced
         it. docs/plans/260904c-more-modes-on-a-shared-link.md § Still open. */
      const sourceHash = await sourceHashFor(articleId, tx);
      const existing = await runsFor(articleId, tx);
      const { run: decided, kind } = withRun(existing, criterion, wantedId, at, sourceHash);

      if (kind === "reset") {
        /* **The predicate is repeated in the UPDATE on purpose.**
           `withRun` already checked that this row exists, carries this
           criterion and has failed — under a lock, so it cannot have changed.
           Naming the conditions again costs nothing and means the statement is
           still correct on the day somebody collapses the select and the update
           into one, which is exactly the kind of correctness that evaporates
           when the guard lives only in the TypeScript branch above.

           `hits`, `model` and `error` are cleared rather than left. Without
           that, a failed attempt's error survives underneath a later
           successful answer, and the panel shows both. */
        const reset = await tx
          .update(searchRuns)
          .set({
            status: "pending",
            hits: [],
            model: null,
            error: null,
            /* `?? null`, not a conditional spread: this is an UPDATE, and
               leaving the key out would keep the *failed* attempt's hash on a
               row that is about to be answered afresh — the same reason `hits`,
               `model` and `error` are cleared rather than left. `withRun`
               rebuilds the run for exactly this. */
            sourceHash: decided.sourceHash ?? null,
            attemptId: attempt,
            attemptStartedAt: DB_NOW,
          })
          .where(
            and(
              eq(searchRuns.articleId, articleId),
              eq(searchRuns.id, decided.id),
              eq(searchRuns.criterion, criterion),
              eq(searchRuns.status, "error"),
            ),
          )
          .returning();
        // Zero rows means the row moved under a lock that should have made that
        // impossible. Louder than carrying on and answering under an id that
        // now means something else.
        if (!reset[0]) {
          throw new Error(
            `Search run "${decided.id}" was not resettable after all — it changed under the article lock.`,
          );
        }
        return toRun(reset[0]);
      }

      const [inserted] = await tx
        .insert(searchRuns)
        .values({
          articleId,
          id: decided.id,
          ownerId: currentOwnerId(),
          criterion,
          status: "pending",
          hits: [],
          sourceHash: decided.sourceHash ?? null,
          createdAt: new Date(decided.createdAt),
          attemptId: attempt,
          attemptStartedAt: DB_NOW,
        })
        .returning();

      /* Trim to MAX_RUNS, **excluding the row just written**.

         The file keeps the last thirty *array elements*; this keeps the thirty
         newest *by timestamp*, and the two are the same list only while the
         clock runs forwards. They come apart under a fixed clock, a clock that
         has gone back, imported data in hand-written order, or ties.

         **Be precise about how far apart, because the obvious summary is too
         kind.** It is not "a backdated run is dropped thirty searches early".
         With thirty future-dated rows in the table, a backdated run survives
         its own insert and is then the oldest candidate, so the *very next*
         search deletes it. Repeat that and Postgres keeps twenty-nine originals
         plus the latest insertion while the file keeps the latest thirty — the
         two sets can disagree on twenty-nine of their thirty members. GPT Sol
         worked that through, 2026-08-26.

         What is guaranteed, and all that is: **at most thirty rows, and the run
         this `begin` returns survives this transaction.** That second half is
         the one that matters to a reader — without it a model call finishes
         into a row that is already gone and they get a 404 for a search they
         are watching. Full behavioural parity needs an insertion ordinal, which
         is a column and has not been paid for. Recorded in
         docs/plans/260826e-postgres-storage-implementation.md. */
      const others = await tx
        .select({ id: searchRuns.id })
        .from(searchRuns)
        .where(and(eq(searchRuns.articleId, articleId), notInArray(searchRuns.id, [decided.id])))
        .orderBy(sql`${searchRuns.createdAt} desc`, sql`${searchRuns.id} desc`)
        .offset(MAX_RUNS - 1);
      if (others.length) {
        await tx.delete(searchRuns).where(
          and(
            eq(searchRuns.articleId, articleId),
            inArray(
              searchRuns.id,
              others.map((r) => r.id),
            ),
          ),
        );
      }

      // `inserted!`: an insert with `returning()` yields the row it wrote.
      return toRun(inserted!);
    }, READ_COMMITTED);

    logger.info({ slug, runId: run.id }, "search started");
    return { run, attempt };
  },

  async finish(
    slug: string,
    runId: string,
    patch: Partial<SearchRun>,
    attempt?: string,
  ): Promise<SearchRun | undefined> {
    const db = getDb();
    const articleId = await articleIdForOwned(slug);

    /* **Refused without an attempt, rather than falling back to identity.**

       The token is optional in the interface because the filesystem store has
       none. Letting it be optional *here* would mean a caller that simply
       forgot to carry it through got the whole cross-process race back — A's
       buried answer landing on B's retry — with nothing anywhere reporting it.
       The column exists to close that; accepting `undefined` would reopen it
       silently. GPT Sol, 2026-08-26. */
    if (attempt === undefined) {
      throw new MissingAttempt("SearchStore.finish", "begin()");
    }

    /* **And the status has to be one this run can end on.** The attempt is
       released below whatever the patch says, so a patch that leaves the run
       `pending` would strip the fence off a row that is still waiting for an
       answer — after which anybody's late write can land on it. */
    if (patch.status !== "done" && patch.status !== "error") {
      /* **`status`, so the guard lets the sentence through.** A fence violation
         is a caller's bug that never reached the database, and its whole
         content is which invariant broke — scrubbed, it arrives as *"this app
         asked its database for something it would not do"*, which is a false
         sentence about a real bug. Door 1 in src/store/db-errors.ts: a refusal
         a route answers with a number carries the number, rather than this
         file's name joining an allowlist. The class of bug is
         docs/postmortems/260901d-a-409-and-a-404-arrived-as-500.md; it was
         invisible here until the store was guarded at its export, because the
         test that covers it imports this module directly.

         **And the message names the method, not the slug.** A `status` is not a
         licence to leak — db-errors.ts says so of `CommentIdTaken` — and a slug is
         a URL path segment derived from a title, so it is exactly what that file
         refuses to let across. Which article it was is in the request the log
         already carries. Same shape as `MissingAttempt` in ./contracts.js, which
         is the sibling refusal in this same family. */
      throw Object.assign(
        new Error(
          `SearchStore.finish must end a run: status was ${JSON.stringify(patch.status)}, ` +
            'expected "done" or "error".',
        ),
        { status: 500 },
      );
    }

    /* `id` and `criterion` are deliberately not settable — src/searches.ts pins
       them back after the spread, and building the SET explicitly is the same
       guarantee without depending on key order. */
    const rows = await db
      .update(searchRuns)
      .set({
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.hits === undefined ? {} : { hits: patch.hits }),
        ...(patch.model === undefined ? {} : { model: patch.model }),
        ...(patch.error === undefined ? {} : { error: patch.error }),
        // The attempt is over either way. Both columns or neither — the CHECK
        // on the table says so, and half an attempt is a run that can never be
        // swept or never be finished.
        attemptId: null,
        attemptStartedAt: null,
      })
      .where(
        and(
          eq(searchRuns.articleId, articleId),
          eq(searchRuns.id, runId),
          /* **Three parts, not one.** The identity says which run, the status
             says it is still waiting for an answer, and the attempt says it is
             waiting for *this* one. Drop the last two and a call that another
             process already declared dead can overwrite the retry the reader
             is watching arrive. Same rule the job lease arrives at in step 12,
             from a different direction. */
          eq(searchRuns.status, "pending"),
          eq(searchRuns.attemptId, attempt),
        ),
      )
      .returning();

    if (patch.status === "error") logger.warn({ slug, runId }, "search failed");
    // Zero rows is not an error here: it is "deleted while running", or "this
    // attempt is no longer the live one". The caller answers 404, which is the
    // behaviour a reader deleting a run mid-search already gets.
    return rows[0] ? toRun(rows[0]) : undefined;
  },

  async remove(slug: string, runId: string): Promise<SearchRun[]> {
    const db = getDb();
    const articleId = await articleIdForOwned(slug);
    await db
      .delete(searchRuns)
      .where(and(eq(searchRuns.articleId, articleId), eq(searchRuns.id, runId)));
    const remaining = await runsFor(articleId);
    logger.info({ slug, runId, remaining: remaining.length }, "search deleted");
    return remaining;
  },

  async recolour(slug: string, runId: string, colour: number | null): Promise<SearchRun[]> {
    /* Before the article lookup, and in TypeScript rather than left to the
       check constraint. The constraint is real and stays, but a store that
       relies on it alone answers a bad value with a `StoreFailure` — "this app
       asked its database for something it would not do" — where the filesystem
       store answers with a 400. Two stores disagreeing about what a bad request
       *is* is exactly the divergence a parity test on the happy path never
       sees. GPT Sol's review, 2026-08-27. */
    requireColour(colour);
    const db = getDb();
    const articleId = await articleIdForOwned(slug);
    /* Unconditional on status, unlike every other write in this file. A colour
       is not part of the answer: recolouring a run that is still `pending`, or
       one that failed, is a perfectly ordinary thing for a reader to do to a
       row they can see. So there is no attempt fence here and nothing to
       race — two tabs setting different colours is last-write-wins, which for
       a value with no history is the correct resolution rather than a
       compromise.

       An id that names no run updates nothing and is not an error: a second
       tab can have deleted it, and the list that comes back says so. Same rule
       as `withColour` on the filesystem side. */
    await db
      .update(searchRuns)
      .set({ colour })
      .where(and(eq(searchRuns.articleId, articleId), eq(searchRuns.id, runId)));
    /* The whole list, not the row — one run's colour changes which slots are
       free, so it can move another row's. `SearchStore.recolour` says why. */
    return runsFor(articleId);
  },

  async sweepPending(slug: string, opts: SweepOptions): Promise<SearchRun[]> {
    const db = getDb();
    const articleId = await articleIdForOwned(slug);
    const cutoff = new Date(Date.now() - opts.graceMs);

    /* Two guards, and each one alone is a bug.

       `keep` is what THIS process is writing: never sweep it, whatever the
       clock says, or a four-minute search gets killed by the same server that
       started it. The age check is for every other process: an attempt younger
       than the grace window might still be in flight somewhere else, and
       burying it is what the filesystem store does wrong.

       A `pending` row with no attempt at all is sweepable outright. That is an
       imported run, or one from before this column existed — either way the
       process that started it is long gone. */
    const stale = and(
      eq(searchRuns.articleId, articleId),
      eq(searchRuns.status, "pending"),
      or(isNull(searchRuns.attemptStartedAt), lt(searchRuns.attemptStartedAt, cutoff)),
      /* **No empty-list guard here, and that is measured rather than assumed.**

         Raw SQL `not in ()` is a syntax error, not "matches everything", so a
         sweep written by hand would 500 on the first read of a quiet article —
         which is why the design for this step called it the single most likely
         way to ship a broken sweep. Drizzle does not do that: `notInArray(col,
         [])` compiles to the literal `true`, checked by printing the SQL rather
         than by reading the source. Wrapping it in a `size === 0` conditional
         would be a guard against a hazard this library has already handled, and
         a reader would reasonably conclude the hazard was live.

         The test for an article with no runs at all stays, because the
         behaviour is worth pinning whatever the reason it works. */
      notInArray(searchRuns.id, [...opts.keep]),
    );

    const swept = await db
      .update(searchRuns)
      .set({ status: "error", error: SWEPT, attemptId: null, attemptStartedAt: null })
      .where(stale)
      .returning({ id: searchRuns.id });

    if (swept.length) {
      logger.warn({ slug, orphans: swept.length }, "swept abandoned search(es)");
    }
    return runsFor(articleId);
  },
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgSearchStore: SearchStore = guardDbStore("searches", rawPgSearchStore);
