/**
 * A referee's criteria — the Postgres half. src/referee-criteria-store.ts is
 * the other.
 *
 * **src/store/pg-searches.ts is this file's model, and it is worth reading
 * first**: the attempt fence, the article lock as the mutex, the `DB_NOW`
 * clock, the trim, and why every one of them is there. Nothing in that
 * reasoning changes here, so none of it is repeated. What is written out below
 * is only what a criterion has that a search run does not.
 *
 * ## The decision is not here
 *
 * `withCriterion` in src/referee-criteria-store.ts holds it, and both stores
 * call it — the three-condition retry rule this repo carries a postmortem for
 * (docs/postmortems/260826f-search-retry-remints-instead-of-resetting.md), with one
 * deliberate addition: a reset adopts the **new** config. See that function.
 *
 * ## Poles and scale are columns, results are JSONB
 *
 * `configToRow` / `configFromRow` in src/referee-criteria.ts are the only two
 * places that know which is which, so this file never assembles a config from
 * loose columns and never takes one apart. docs/project/sql.md says the default
 * is a column and a blob has to argue for itself; `results` argues for itself
 * the way `search_runs.hits` does — one model call's wholesale output, replaced
 * together, never edited one at a time.
 *
 * ## What may be logged from this file
 *
 * Ids, slugs, counts, statuses, kinds. **Never `criterion`, never a pole, never
 * a result's quote or reasoning, never the stored `error` string** — the last
 * one for the reason src/searches.ts sets out: the string is whatever the call
 * threw, and one provider echoes the request back.
 */

import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { refereeCriteria } from "../db/schema.js";
import { log } from "../log.js";
import { currentOwnerId } from "../owner.js";
import {
  configFromRow,
  configToRow,
  type RefereeCriterionConfig,
  type RefereeResult,
} from "../referee-criteria.js";
import { CRITERION_SWEPT, withCriterion } from "../referee-criteria-store.js";
import { MAX_CRITERIA, type SavedCriterion } from "../saved-criteria.js";
import { requireColour } from "../searches.js";
import type { RefereeCriteriaStore, SweepOptions } from "./contracts.js";
import { READ_COMMITTED } from "./isolation.js";
import { articleIdForOwned, lockArticleRow, sourceHashFor } from "./pg.js";

const logger = log("store");

/** The database's clock at the moment the statement runs — pg-searches.ts § `DB_NOW`. */
const DB_NOW = sql`clock_timestamp()` as unknown as Date;

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Db = ReturnType<typeof getDb>;

/**
 * A row as the client sees it, or `null` if its config cannot be read back.
 *
 * **`null` can only mean a row the check constraints forbid** —
 * `referee_criteria_kind` pins the kind to the three we have and
 * `referee_criteria_diverging_shape` makes the poles and the scale all-or-none
 * — so this is an imported row, a hand-edited one, or a row from a future
 * spelling of the union. Dropping it is the honest answer: the alternative is
 * inventing `{kind:"single"}` for it, which would silently turn somebody's
 * two-ended criterion into a plain search and look completely fine. The caller
 * counts what it dropped and says so in the log, because "no criteria" and "one
 * criterion we could not read" must not render the same
 * (docs/reusable/silent-success.md).
 */
function toCriterion(row: typeof refereeCriteria.$inferSelect): SavedCriterion | null {
  const config = configFromRow(row);
  if (!config) return null;
  return {
    id: row.id,
    criterion: row.criterion,
    config,
    createdAt: row.createdAt.toISOString(),
    status: row.status as SavedCriterion["status"],
    results: row.results as RefereeResult[],
    // Absent, not null — `exactOptionalPropertyTypes`, and the wire form has to
    // match what the filesystem store writes or the parity test is comparing
    // two spellings of the same fact.
    ...(row.model === null ? {} : { model: row.model }),
    ...(row.error === null ? {} : { error: row.error }),
    ...(row.sourceHash === null ? {} : { sourceHash: row.sourceHash }),
    ...(row.colour === null ? {} : { colour: row.colour }),
  };
}

/** The rows worth showing, with a line when one had to be dropped. */
function readable(rows: (typeof refereeCriteria.$inferSelect)[], slug?: string): SavedCriterion[] {
  const out: SavedCriterion[] = [];
  let unreadable = 0;
  for (const row of rows) {
    const one = toCriterion(row);
    if (one) out.push(one);
    else unreadable++;
  }
  if (unreadable) logger.warn({ slug, unreadable }, "dropped criteri(a) with an unreadable config");
  return out;
}

/**
 * Every criterion for the article, oldest first.
 *
 * `created_at, id` and not `created_at` alone — pg-searches.ts § `runsFor` has
 * the reason: two rows started in the same microsecond would otherwise swap
 * places between requests, where the file's order is insertion order and never
 * moves.
 */
async function criteriaFor(
  articleId: string,
  db: Db | Tx = getDb(),
  slug?: string,
): Promise<SavedCriterion[]> {
  const rows = await db
    .select()
    .from(refereeCriteria)
    .where(eq(refereeCriteria.articleId, articleId))
    .orderBy(asc(refereeCriteria.createdAt), asc(refereeCriteria.id));
  return readable(rows, slug);
}

export const pgRefereeCriteriaStore: RefereeCriteriaStore = {
  async load(slug: string): Promise<SavedCriterion[]> {
    return criteriaFor(await articleIdForOwned(slug), getDb(), slug);
  },

  async sourceHash(slug: string): Promise<string | undefined> {
    return sourceHashFor(await articleIdForOwned(slug));
  },

  async begin(
    slug: string,
    criterion: string,
    config: RefereeCriterionConfig,
    wantedId?: string,
    now: () => string = () => new Date().toISOString(),
  ): Promise<{ row: SavedCriterion; attempt: string | undefined }> {
    const db = getDb();
    const articleId = await articleIdForOwned(slug);
    const at = now();
    const attempt = randomUUID();

    const row = await db.transaction(async (tx) => {
      await lockArticleRow(tx, articleId);
      /* Inside the lock, so the fingerprint and the row are written against one
         state of the article — pg-searches.ts § begin. */
      const sourceHash = await sourceHashFor(articleId, tx);
      const existing = await criteriaFor(articleId, tx, slug);
      const { row: decided, kind } = withCriterion(
        existing,
        criterion,
        config,
        wantedId,
        at,
        sourceHash,
      );
      const columns = configToRow(decided.config);

      if (kind === "reset") {
        /* The predicate is repeated in the UPDATE on purpose — pg-searches.ts
           says why at length. `results`, `model` and `error` are cleared rather
           than left, or a failed attempt's error survives underneath a later
           successful answer and the panel shows both.

           The pole and scale columns are **set**, not left: a reset adopts the
           new config (`withCriterion`), and leaving them would answer the fixed
           question with the broken configuration. */
        const reset = await tx
          .update(refereeCriteria)
          .set({
            kind: columns.kind,
            poleAgainst: columns.poleAgainst,
            poleFavour: columns.poleFavour,
            scale: columns.scale,
            status: "pending",
            results: [],
            model: null,
            error: null,
            sourceHash: decided.sourceHash ?? null,
            attemptId: attempt,
            attemptStartedAt: DB_NOW,
          })
          .where(
            and(
              eq(refereeCriteria.articleId, articleId),
              eq(refereeCriteria.id, decided.id),
              eq(refereeCriteria.criterion, criterion),
              eq(refereeCriteria.status, "error"),
            ),
          )
          .returning();
        if (!reset[0]) {
          throw new Error(
            `Criterion "${decided.id}" was not resettable after all — it changed under the article lock.`,
          );
        }
        const back = toCriterion(reset[0]);
        if (!back) throw new Error(`Criterion "${decided.id}" was written and cannot be read back.`);
        return back;
      }

      const [inserted] = await tx
        .insert(refereeCriteria)
        .values({
          articleId,
          id: decided.id,
          ownerId: currentOwnerId(),
          criterion,
          kind: columns.kind,
          poleAgainst: columns.poleAgainst,
          poleFavour: columns.poleFavour,
          scale: columns.scale,
          status: "pending",
          results: [],
          sourceHash: decided.sourceHash ?? null,
          createdAt: new Date(decided.createdAt),
          attemptId: attempt,
          attemptStartedAt: DB_NOW,
        })
        .returning();

      /* Trim to MAX_CRITERIA, excluding the row just written. The file keeps
         the last N array elements and this keeps the N newest by timestamp;
         pg-searches.ts § the trim works through exactly how far apart those two
         can get and why the guarantee that matters — *the row this `begin`
         returns survives this transaction* — is the one a reader needs. */
      const others = await tx
        .select({ id: refereeCriteria.id })
        .from(refereeCriteria)
        .where(
          and(
            eq(refereeCriteria.articleId, articleId),
            notInArray(refereeCriteria.id, [decided.id]),
          ),
        )
        .orderBy(sql`${refereeCriteria.createdAt} desc`, sql`${refereeCriteria.id} desc`)
        .offset(MAX_CRITERIA - 1);
      if (others.length) {
        await tx.delete(refereeCriteria).where(
          and(
            eq(refereeCriteria.articleId, articleId),
            inArray(
              refereeCriteria.id,
              others.map((r) => r.id),
            ),
          ),
        );
      }

      // `inserted!`: an insert with `returning()` yields the row it wrote.
      const back = toCriterion(inserted!);
      if (!back) throw new Error(`Criterion "${decided.id}" was written and cannot be read back.`);
      return back;
    }, READ_COMMITTED);

    logger.info({ slug, criterionId: row.id, kind: config.kind }, "criterion started");
    return { row, attempt };
  },

  async finish(
    slug: string,
    id: string,
    patch: Partial<SavedCriterion>,
    attempt?: string,
  ): Promise<SavedCriterion | undefined> {
    const db = getDb();
    const articleId = await articleIdForOwned(slug);

    /* Refused without an attempt rather than falling back to identity — the
       token is optional in the interface because the filesystem store has none,
       and accepting `undefined` here would silently reopen the cross-process
       race the column exists to close. pg-searches.ts § finish. */
    if (attempt === undefined) {
      throw new Error(
        `finish("${slug}") needs the attempt that begin() returned. ` +
          "Without it a model call the sweep already buried can overwrite the retry.",
      );
    }
    /* And the status has to be one this run can end on: the attempt is released
       below whatever the patch says, so a patch leaving the row `pending` would
       strip the fence off a row still waiting for an answer. */
    if (patch.status !== "done" && patch.status !== "error") {
      throw new Error(
        `finish("${slug}") must end a criterion: status was ${JSON.stringify(patch.status)}, ` +
          'expected "done" or "error".',
      );
    }

    /* `id`, `criterion` and the config columns are deliberately not settable
       here — a finish reports an answer, and changing the question while
       answering it is what `begin` is for. */
    const rows = await db
      .update(refereeCriteria)
      .set({
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.results === undefined ? {} : { results: patch.results }),
        ...(patch.model === undefined ? {} : { model: patch.model }),
        ...(patch.error === undefined ? {} : { error: patch.error }),
        // The attempt is over either way. Both columns or neither — the CHECK
        // says so, and half an attempt is a row that can never be swept or
        // never be finished.
        attemptId: null,
        attemptStartedAt: null,
      })
      .where(
        and(
          eq(refereeCriteria.articleId, articleId),
          eq(refereeCriteria.id, id),
          /* Three parts, not one — pg-searches.ts § finish. Identity says which
             row, status says it is still waiting, and the attempt says it is
             waiting for *this* call. */
          eq(refereeCriteria.status, "pending"),
          eq(refereeCriteria.attemptId, attempt),
        ),
      )
      .returning();

    if (patch.status === "error") logger.warn({ slug, criterionId: id }, "criterion failed");
    // Zero rows is not an error: "deleted while running", or "this attempt is
    // no longer the live one". The caller stays quiet, as search's does.
    return rows[0] ? (toCriterion(rows[0]) ?? undefined) : undefined;
  },

  async remove(slug: string, id: string): Promise<SavedCriterion[]> {
    const db = getDb();
    const articleId = await articleIdForOwned(slug);
    await db
      .delete(refereeCriteria)
      .where(and(eq(refereeCriteria.articleId, articleId), eq(refereeCriteria.id, id)));
    const remaining = await criteriaFor(articleId, db, slug);
    logger.info({ slug, criterionId: id, remaining: remaining.length }, "criterion deleted");
    return remaining;
  },

  async recolour(slug: string, id: string, colour: number | null): Promise<SavedCriterion[]> {
    /* Before the article lookup, and in TypeScript rather than left to the
       check constraint — pg-searches.ts § recolour: a store relying on the
       constraint alone answers a bad value with a `StoreFailure` where the
       filesystem answers with a 400, and two stores disagreeing about what a
       bad request *is* is exactly the divergence a happy-path parity test never
       sees. */
    requireColour(colour);
    const db = getDb();
    const articleId = await articleIdForOwned(slug);
    /* Unconditional on status: a colour is not part of the answer, so there is
       no attempt fence here and nothing to race. An id that names nothing is a
       no-op — a second tab can have deleted it, and the list that comes back
       says so. */
    await db
      .update(refereeCriteria)
      .set({ colour })
      .where(and(eq(refereeCriteria.articleId, articleId), eq(refereeCriteria.id, id)));
    return criteriaFor(articleId, db, slug);
  },

  async sweepPending(slug: string, opts: SweepOptions): Promise<SavedCriterion[]> {
    const db = getDb();
    const articleId = await articleIdForOwned(slug);
    const cutoff = new Date(Date.now() - opts.graceMs);

    /* Two guards, and each one alone is a bug — pg-searches.ts § sweepPending.
       `keep` is what THIS process is writing; the age check is for every other
       process. A `pending` row with no attempt at all is sweepable outright:
       that is an imported row, and the process that started it is long gone. */
    const stale = and(
      eq(refereeCriteria.articleId, articleId),
      eq(refereeCriteria.status, "pending"),
      or(
        isNull(refereeCriteria.attemptStartedAt),
        lt(refereeCriteria.attemptStartedAt, cutoff),
      ),
      // `notInArray(col, [])` compiles to the literal `true` in Drizzle — see
      // the measured note on the same line in pg-searches.ts.
      notInArray(refereeCriteria.id, [...opts.keep]),
    );

    const swept = await db
      .update(refereeCriteria)
      .set({ status: "error", error: CRITERION_SWEPT, attemptId: null, attemptStartedAt: null })
      .where(stale)
      .returning({ id: refereeCriteria.id });

    if (swept.length) {
      logger.warn({ slug, orphans: swept.length }, "swept abandoned criteri(a)");
    }
    return criteriaFor(articleId, db, slug);
  },
};
