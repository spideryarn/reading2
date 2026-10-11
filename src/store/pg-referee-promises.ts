/**
 * A paper's promises run. The only half — src/referee-promises-store.ts, the
 * filesystem one, went on 2026-09-05 with the rest of the filesystem store
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md,
 * the stage-G section), and what it held that outlives it is here: the
 * corollary below, `PROMISES_SWEPT`, and the logging rule.
 *
 * **src/store/pg-referee-criteria.ts is this file's model**, and that file in
 * turn points at src/store/pg-searches.ts for the reasoning behind the article
 * lock, the `DB_NOW` clock and the conditional spreads. None of it is repeated
 * here. What is written out below is only what a promises run has that a
 * criterion does not.
 *
 * ## One run per article, so the table has no id and this file has no retry rule
 *
 * A referee writes several criteria and asks the paper what *it* claims exactly
 * once. `begin` therefore **replaces** the row: no `wantedId`, no
 * three-condition retry rule, no `MAX_` trim, because there is nothing to
 * collide with — a second run is a run, and the answer it overwrites was about
 * the same paper. And the corollary worth reading before changing anything
 * here: `begin` writes `status: "pending"` over whatever was stored, so
 * **starting a run throws away the last answer before the new one exists.**
 * That is deliberate — a panel showing yesterday's claims under today's spinner
 * is the one state a referee cannot interpret — and it is survivable because
 * the whole thing is one model call away from being rebuilt.
 *
 * ## One run per article, and still an attempt
 *
 * No id does not mean no identity. Two tabs can each `begin`, and the row then
 * belongs to the second: `begin` writes a fresh `attempt_id`, and `finish` lands
 * only on a `pending` row carrying the token it was given. The first tab's
 * answer finds nothing to write to and is dropped, as a criterion's would be.
 * Until 2026-10-03 `finish` updated by article id alone and the slower answer
 * overwrote the newer run
 * (docs/plans/261003h-referee-answers-are-not-lost-or-overwritten.md).
 *
 * And `begin` is **told** the fingerprint rather than reading it. The caller has
 * already loaded the blocks it is about to send; a re-extraction between that
 * load and a read here would label an answer about the old blocks with the new
 * revision's hash, and a stale answer would read as current.
 *
 * ## What may be logged from this file
 *
 * Slugs, statuses, counts. **Never a claim, never a quote, never a passage's
 * reasoning.** A paper under review is somebody else's unpublished work, and
 * the rule src/referee-criteria-store.ts keeps applies with the volume turned
 * up: this artefact is nothing but quotations from it. The stored `error`
 * string is deliberately **not** logged either — it is whatever the call threw,
 * and a provider that echoes the request back would put the paper's prose into
 * a field a comment claimed could never hold it.
 *
 * ## Why this store exists, having been argued against
 *
 * Promises (then Claims) shipped on 2026-08-31 files-only, and under `SPIDERYARN_STORE=postgres`
 * — which is what deploys — every method refused with a 501. That was recorded
 * rather than pending, on two grounds. The first still stands and is why the
 * table calls itself an interim: a promises run is an article-derived reusable
 * artefact whose right home is a **pipeline artefact**
 * (docs/plans/260831an-referee-mode-for-peer-reviewers.md § 2). The second was
 * the blocking one and has expired: src/store/export.ts was being rewritten in
 * another session, so a table could only have landed without an
 * `ARTICLE_TABLE_COVERAGE` entry — the exact accident this repo carries from the
 * day before, when `db:export` silently dropped every criterion for a day. That
 * file is settled, so the table lands *with* its entry and with a fixture that
 * makes the entry true. drizzle/0051_referee_claims.sql § the header.
 *
 * ## What may be logged from this file
 *
 * Slugs, statuses, counts. **Never a claim, never a quote, never a passage's
 * reasoning, and never the stored `error` string.** A paper under review is
 * somebody else's unpublished work and this artefact is nothing but quotations
 * from it; the `error` exclusion is the one src/searches.ts § `finishRun` sets
 * out, because the string is whatever the call threw and one provider echoes the
 * request back.
 */

import { randomUUID } from "node:crypto";

import { and, eq, lt, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { refereePromises } from "../db/schema.js";
import { log } from "../log.js";
import { currentOwnerId } from "../owner.js";
import type { PaperPromise, PromisesRun } from "../referee-promises.js";
import { PROMISES_TIMEOUT_MS } from "../referee-promises-run.js";
import type { PromisesFinish, RefereePromisesStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { articleIdForOwned, sourceHashFor } from "./pg.js";

const logger = log("store");

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Db = ReturnType<typeof getDb>;

/**
 * **How long another process's `pending` run is left alone.**
 *
 * `RefereePromisesStore.sweep` takes one boolean — *is this process running it* —
 * where `SweepOptions` takes a set of ids **and** a grace window, and
 * contracts.ts is explicit about why both are needed: `keep` alone is a
 * cross-process bug. Process B sees process A's live row in nobody's set and
 * errors an answer that is still arriving, which on Vercel is the ordinary shape
 * rather than an edge case. The filesystem store could live with one boolean
 * because two servers sharing one `data/` directory was a thing nobody did.
 *
 * So the window is applied **here**, in the store that has other processes to be
 * wrong about, rather than being pushed into a signature src/routes.ts would
 * have to change with it. `created_at` is the clock — see the column.
 *
 * Derived from the call's own deadline rather than written down beside it, so
 * the two cannot drift into a sweep that fires before the model has given up.
 * The same relationship `CRITERION_ORPHAN_GRACE_MS` and `LITERATURE_TIMEOUT_MS`
 * have in src/routes.ts, where an assertion holds it; here the arithmetic makes
 * it unfalsifiable instead.
 */
export const PROMISES_ORPHAN_GRACE_MS = PROMISES_TIMEOUT_MS + 30_000;

/**
 * What a sweep writes over an abandoned `pending` run.
 *
 * It lived in `src/referee-promises-store.ts` until 2026-09-05, when that module
 * — the filesystem claims store — was deleted with the rest of the filesystem
 * store
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md,
 * the stage-G section). There is one sweep now, so the sentence lives with it,
 * which is where `SEARCH_SWEPT` below already was. `COMMENT_SWEPT`
 * (src/comments.ts) and `CHAT_SWEPT` (src/chat.ts) stayed put instead, because
 * those modules still hold a vocabulary their stores are written against and
 * this one held nothing else.
 *
 * The words are unchanged: docs/project/copy.md says a reader-facing sentence
 * is matched on the constant rather than pinned by a test, so moving it must
 * not be an excuse to reword it.
 */
export const PROMISES_SWEPT = "The server stopped before the promises run finished.";

/**
 * The stored row as the client sees it, or `null` when this paper has never been
 * asked.
 *
 * Conditional spreads rather than nulls, for the reason pg-searches.ts gives:
 * `exactOptionalPropertyTypes` is on, Postgres hands back `null` where the file
 * simply had no key, and a `"model": null` on the wire is a different shape from
 * the filesystem's — which is the single commonest near-miss in this store.
 */
function toRun(row: typeof refereePromises.$inferSelect): PromisesRun {
  return {
    status: row.status as PromisesRun["status"],
    createdAt: row.createdAt.toISOString(),
    promises: row.promises as PaperPromise[],
    ...(row.model === null ? {} : { model: row.model }),
    /* Absent, not zero. Null means *not recorded*: an older run, a pending one,
       or a failed one. The route records it on success. A zero here would tell
       the panel that nothing was cut off, which is a different sentence from
       the one it prints when it does not know. */
    ...(row.promisesOmitted === null ? {} : { promisesOmitted: row.promisesOmitted }),
    ...(row.error === null ? {} : { error: row.error }),
    ...(row.sourceHash === null ? {} : { sourceHash: row.sourceHash }),
  };
}

/** The one run for this article, or `null`. */
async function runFor(articleId: string, db: Db | Tx = getDb()): Promise<PromisesRun | null> {
  const rows = await db
    .select()
    .from(refereePromises)
    .where(eq(refereePromises.articleId, articleId))
    .limit(1);
  const row = rows[0];
  return row ? toRun(row) : null;
}

const rawPgRefereePromisesStore: RefereePromisesStore = {
  async load(slug: string): Promise<PromisesRun | null> {
    return runFor(await articleIdForOwned(slug));
  },

  async sourceHash(slug: string): Promise<string | undefined> {
    return sourceHashFor(await articleIdForOwned(slug));
  },

  async begin(
    slug: string,
    sourceHash: string,
    now: () => string = () => new Date().toISOString(),
  ): Promise<{ run: PromisesRun; attempt: string }> {
    const db = getDb();
    const articleId = await articleIdForOwned(slug);
    const at = now();
    const attempt = randomUUID();

    /* **An upsert, and the `set` clause is the whole shape of this sub-mode.**
       Every field is written, not merged: `claims` back to `[]`, `model` and
       `error` to null. Leaving any of them would put a finished answer's
       claims, or a failed attempt's error, underneath a run that has not
       happened yet — and the panel would show both.

       One statement and no article lock. The lock was there so the fingerprint
       read and the row agreed on one state of the article, and the fingerprint
       is no longer read here: it is the caller's, of the blocks it is sending.

       `owner_id` is set from `currentOwnerId()` on both paths rather than left
       alone on the update. `articleIdFor` has already refused a slug this
       reader does not own, so the two can only agree; writing it keeps the row
       self-describing instead of inheriting an owner from a previous write. */
    const [written] = await db
      .insert(refereePromises)
      .values({
        articleId,
        ownerId: currentOwnerId(),
        status: "pending",
        promises: [],
        createdAt: new Date(at),
        sourceHash,
        attemptId: attempt,
      })
      .onConflictDoUpdate({
        target: refereePromises.articleId,
        set: {
          ownerId: currentOwnerId(),
          status: "pending",
          promises: [],
          model: null,
          promisesOmitted: null,
          error: null,
          /* Re-stamped, and that is not cosmetic: `created_at` is the sweep's
             clock (see the column), so a second run keeping the first run's
             date would be sweepable the instant it started. */
          createdAt: new Date(at),
          sourceHash,
          // The row is this run's now; an older run's `finish` matches nothing.
          attemptId: attempt,
          /* A run that has just begun has not finished. Named here because the
             upsert writes over the last run's row; a first run is the insert
             above, where the column is simply absent. */
          finishedAt: null,
        },
      })
      .returning();

    logger.info({ slug }, "promises run started");
    // `written!`: an insert with `returning()` yields the row it wrote.
    return { run: toRun(written!), attempt };
  },

  async finish(slug: string, patch: PromisesFinish, attempt: string): Promise<PromisesRun | null> {
    const db = getDb();
    const articleId = await articleIdForOwned(slug);

    /* **Three parts to the predicate below, as in pg-referee-criteria.ts §
       finish.** The article says which row, `pending` says it is still waiting,
       and the attempt says it is waiting for *this* call. A run that a newer
       `begin` replaced, or that the sweep has already failed, matches nothing
       and gets `null` — the same answer as a row that went away.

       `createdAt` and `sourceHash` are not settable: a finish must not re-date
       a run or claim it was answered against a different version of the paper
       than the one `begin` was told.

       **Every other field of `PromisesRun` is written here, and a new one has to
       be added to this list.** `promisesOmitted` arrived on 2026-09-01 while this
       file was being written, and a store that maps the run field by field —
       which is what a table is — drops a field it has not been told about,
       silently, while `finish` reports success. That is the shape
       docs/reusable/silent-success.md is about, and it is the standing cost of
       columns over a blob. tests/store-pg-referee-promises.test.ts holds the round
       trip that goes red when it happens, and `EVERY_RUN_FIELD` in that file
       makes the *next* one a typecheck failure rather than a silent drop. */
    /* `PromisesFinish` is a two-armed union; this is its fields with the arms
       folded together, so each is written when it is there. An `error` arm's
       `claims` can only be `[]` (the type), and the row it lands on is `pending`
       and so already empty (`referee_promises_empty_unless_done`): whatever is
       written here is written as given, and a caller that cast its way past
       the type is refused by the database rather than tidied up. */
    const fields: Partial<Pick<PromisesRun, "promises" | "model" | "promisesOmitted" | "error">> = patch;
    const rows = await db
      .update(refereePromises)
      .set({
        status: patch.status,
        ...(fields.promises === undefined ? {} : { promises: fields.promises }),
        ...(fields.model === undefined ? {} : { model: fields.model }),
        ...(fields.promisesOmitted === undefined ? {} : { promisesOmitted: fields.promisesOmitted }),
        ...(fields.error === undefined ? {} : { error: fields.error }),
        // The attempt is over either way.
        attemptId: null,
        /* **When the claims landed, or the call failed** — in the fenced
           statement, so a run a newer `begin` replaced stamps nothing. The
           database's clock; `created_at` stays the run's start. */
        finishedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(refereePromises.articleId, articleId),
          eq(refereePromises.status, "pending"),
          eq(refereePromises.attemptId, attempt),
        ),
      )
      .returning();

    if (patch.status === "error") logger.warn({ slug }, "promises run failed");
    /* Zero rows is `null`, never a resurrection: the row went away underneath
       the call, or it is no longer this attempt's to write. Inserting one here
       would store an answer for a paper nobody asked about any more. */
    return rows[0] ? toRun(rows[0]) : null;
  },

  async sweep(slug: string, live: boolean): Promise<PromisesRun | null> {
    const db = getDb();
    const articleId = await articleIdForOwned(slug);

    if (!live) {
      /* Two guards, and each one alone is a bug — the same pair pg-searches.ts §
         sweepPending sets out. `live` is what THIS process is doing; the age
         check is for every other process, and without it a GET arriving on a
         second lambda would error a run the first lambda is halfway through
         streaming. See `PROMISES_ORPHAN_GRACE_MS`. */
      const cutoff = new Date(Date.now() - PROMISES_ORPHAN_GRACE_MS);
      const swept = await db
        .update(refereePromises)
        // `finished_at` is when the sweep ended the run — the only ending it had.
        .set({
          status: "error",
          error: PROMISES_SWEPT,
          attemptId: null,
          finishedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(refereePromises.articleId, articleId),
            eq(refereePromises.status, "pending"),
            lt(refereePromises.createdAt, cutoff),
          ),
        )
        .returning({ articleId: refereePromises.articleId });
      if (swept.length) logger.warn({ slug }, "swept an abandoned promises run");
    }

    /* The run as it now stands, so a GET is one call — the filesystem store
       answered the same way. */
    return runFor(articleId, db);
  },
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgRefereePromisesStore: RefereePromisesStore = guardDbStore("referee-promises", rawPgRefereePromisesStore);
