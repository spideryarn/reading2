/**
 * A paper's claims run — the Postgres half. src/referee-claims-store.ts is the
 * other, and it holds the shape both of them keep.
 *
 * **src/store/pg-referee-criteria.ts is this file's model**, and that file in
 * turn points at src/store/pg-searches.ts for the reasoning behind the article
 * lock, the `DB_NOW` clock and the conditional spreads. None of it is repeated
 * here. What is written out below is only what a claims run has that a
 * criterion does not.
 *
 * ## One run per article, so the table has no id and this file has no retry rule
 *
 * A referee writes several criteria and asks the paper what *it* claims exactly
 * once. `begin` therefore **replaces** the row: no `wantedId`, no
 * three-condition retry rule, no `MAX_` trim, because there is nothing to
 * collide with — a second run is a run, and the answer it overwrites was about
 * the same paper. src/referee-claims-store.ts § What differs has the corollary
 * worth reading before changing anything here: starting a run throws away the
 * last answer before the new one exists, deliberately, because a panel showing
 * yesterday's claims under today's spinner is the one state a referee cannot
 * interpret.
 *
 * ## Why this store exists, having been argued against
 *
 * Claims shipped on 2026-08-31 files-only, and under `SPIDERYARN_STORE=postgres`
 * — which is what deploys — every method refused with a 501. That was recorded
 * rather than pending, on two grounds. The first still stands and is why the
 * table calls itself an interim: a claims run is an article-derived reusable
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

import { and, asc, eq, lt } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articles, refereeClaims, revisionBlocks } from "../db/schema.js";
import { log } from "../log.js";
import { currentOwnerId } from "../owner.js";
import type { Claim, ClaimsRun } from "../referee-claims.js";
import { CLAIMS_TIMEOUT_MS } from "../referee-claims-run.js";
import { CLAIMS_SWEPT } from "../referee-claims-store.js";
import { hashBlocks } from "../source-hash.js";
import type { RefereeClaimsStore } from "./contracts.js";
import { notFound, ownedSlug, requireSlug } from "./pg.js";

const logger = log("store");

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Db = ReturnType<typeof getDb>;

/**
 * **How long another process's `pending` run is left alone.**
 *
 * `RefereeClaimsStore.sweep` takes one boolean — *is this process running it* —
 * where `SweepOptions` takes a set of ids **and** a grace window, and
 * contracts.ts is explicit about why both are needed: `keep` alone is a
 * cross-process bug. Process B sees process A's live row in nobody's set and
 * errors an answer that is still arriving, which on Vercel is the ordinary shape
 * rather than an edge case. The filesystem store can live with one boolean
 * because two servers sharing one `data/` directory is a thing nobody does.
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
export const CLAIMS_ORPHAN_GRACE_MS = CLAIMS_TIMEOUT_MS + 30_000;

/** The article's uuid, or a tagged 404 — the same shape src/api.ts throws. */
async function articleIdFor(slug: string, db: Db | Tx = getDb()): Promise<string> {
  requireSlug(slug);
  const rows = await db
    .select({ id: articles.id })
    .from(articles)
    /* **`ownedSlug`, never `eq(articles.slug, …)`.** A referee reading somebody
       else's paper is exactly the reader this predicate exists for: the slug is
       globally unique, so the bare comparison finds a real article belonging to
       somebody else and every method below would then read and write it. 404
       rather than 403, because a 403 confirms the article exists. */
    .where(ownedSlug(slug))
    .limit(1);
  const found = rows[0];
  if (!found) throw notFound(slug);
  return found.id;
}

/**
 * The fingerprint of the article as this store has it.
 *
 * **The third copy of this query in src/store/**, after pg-searches.ts and
 * pg-referee-criteria.ts, and it is a copy rather than a call because neither of
 * those exports it. It belongs in pg.ts beside `blocksFor`; moving it is one
 * edit in three files that two other sessions are currently inside, so it is
 * written down here instead of done badly. The two things that must not drift
 * are in both originals and in this one: the **four** columns `hashBlocks` folds
 * in, and `order by ordinal` — block ids carry no position, so without the
 * clause a hash computed here matches the file's in development and drifts in
 * production, presenting every stored run as out of date with nothing to say
 * why.
 *
 * `undefined` for an article with no blocks, which `isStale` counts as stale:
 * not knowing is not the same as knowing it is fine.
 */
async function sourceHashFor(articleId: string, db: Db | Tx = getDb()): Promise<string | undefined> {
  const rows = await db
    .select({
      id: revisionBlocks.blockId,
      text: revisionBlocks.text,
      role: revisionBlocks.role,
      treatment: revisionBlocks.treatment,
    })
    .from(revisionBlocks)
    .innerJoin(articles, eq(articles.currentRevisionId, revisionBlocks.revisionId))
    .where(eq(articles.id, articleId))
    .orderBy(asc(revisionBlocks.ordinal));
  return rows.length ? hashBlocks(rows) : undefined;
}

/**
 * The stored row as the client sees it, or `null` when this paper has never been
 * asked.
 *
 * Conditional spreads rather than nulls, for the reason pg-searches.ts gives:
 * `exactOptionalPropertyTypes` is on, Postgres hands back `null` where the file
 * simply had no key, and a `"model": null` on the wire is a different shape from
 * the filesystem's — which is the single commonest near-miss in this store.
 */
function toRun(row: typeof refereeClaims.$inferSelect): ClaimsRun {
  return {
    status: row.status as ClaimsRun["status"],
    createdAt: row.createdAt.toISOString(),
    claims: row.claims as Claim[],
    ...(row.model === null ? {} : { model: row.model }),
    /* Absent, not zero. Null means *not recorded* — the route does not write it
       yet — and a zero here would tell the panel that nothing was cut off, which
       is a different sentence from the one it prints when it does not know. */
    ...(row.claimsOmitted === null ? {} : { claimsOmitted: row.claimsOmitted }),
    ...(row.error === null ? {} : { error: row.error }),
    ...(row.sourceHash === null ? {} : { sourceHash: row.sourceHash }),
  };
}

/** The one run for this article, or `null`. */
async function runFor(articleId: string, db: Db | Tx = getDb()): Promise<ClaimsRun | null> {
  const rows = await db
    .select()
    .from(refereeClaims)
    .where(eq(refereeClaims.articleId, articleId))
    .limit(1);
  const row = rows[0];
  return row ? toRun(row) : null;
}

/** Take the article row, so nothing else in this article writes until we commit. */
async function lockArticle(tx: Tx, articleId: string): Promise<void> {
  await tx.select({ id: articles.id }).from(articles).where(eq(articles.id, articleId)).for("update");
}

export const pgRefereeClaimsStore: RefereeClaimsStore = {
  async load(slug: string): Promise<ClaimsRun | null> {
    return runFor(await articleIdFor(slug));
  },

  async sourceHash(slug: string): Promise<string | undefined> {
    return sourceHashFor(await articleIdFor(slug));
  },

  async begin(
    slug: string,
    now: () => string = () => new Date().toISOString(),
  ): Promise<ClaimsRun> {
    const db = getDb();
    const articleId = await articleIdFor(slug);
    const at = now();

    const run = await db.transaction(async (tx) => {
      await lockArticle(tx, articleId);
      /* Inside the lock, so the fingerprint and the row are written against one
         state of the article — pg-referee-criteria.ts § begin. */
      const sourceHash = await sourceHashFor(articleId, tx);

      /* **An upsert, and the `set` clause is the whole shape of this sub-mode.**
         Every field is written, not merged: `claims` back to `[]`, `model` and
         `error` to null. Leaving any of them would put a finished answer's
         claims, or a failed attempt's error, underneath a run that has not
         happened yet — and the panel would show both.

         `owner_id` is set from `currentOwnerId()` on both paths rather than left
         alone on the update. `articleIdFor` has already refused a slug this
         reader does not own, so the two can only agree; writing it keeps the row
         self-describing instead of inheriting an owner from a previous write. */
      const [written] = await tx
        .insert(refereeClaims)
        .values({
          articleId,
          ownerId: currentOwnerId(),
          status: "pending",
          claims: [],
          createdAt: new Date(at),
          sourceHash: sourceHash ?? null,
        })
        .onConflictDoUpdate({
          target: refereeClaims.articleId,
          set: {
            ownerId: currentOwnerId(),
            status: "pending",
            claims: [],
            model: null,
            claimsOmitted: null,
            error: null,
            /* Re-stamped, and that is not cosmetic: `created_at` is the sweep's
               clock (see the column), so a second run keeping the first run's
               date would be sweepable the instant it started. */
            createdAt: new Date(at),
            sourceHash: sourceHash ?? null,
          },
        })
        .returning();

      // `written!`: an insert with `returning()` yields the row it wrote.
      return toRun(written!);
    });

    logger.info({ slug }, "claims run started");
    return run;
  },

  async finish(
    slug: string,
    patch: Pick<ClaimsRun, "status"> & Partial<ClaimsRun>,
  ): Promise<ClaimsRun | null> {
    const db = getDb();
    const articleId = await articleIdFor(slug);

    /* **No attempt fence, and no `status = 'pending'` guard**, which is a
       deliberate parity choice rather than an omission. `RefereeClaimsStore` has
       no attempt token to present — there is one run and identity is the slug —
       so a guard here would refuse writes the filesystem store accepts, and two
       stores disagreeing about what a bad request *is* is the divergence a
       happy-path parity test never sees. The cost is the one src/routes.ts
       already writes down: two tabs running Claims at once have the slower
       answer win, where a criterion's attempt would have refused the stale one.

       `createdAt` and `sourceHash` are not settable, exactly as the filesystem
       store takes them from the row on disk rather than from the patch: a finish
       must not re-date a run or claim it was answered against a different
       version of the paper than the one `begin` fingerprinted.

       **Every other field of `ClaimsRun` is written here, and a new one has to
       be added to this list.** `claimsOmitted` arrived on 2026-09-01 while this
       file was being written, and a store that maps the run field by field —
       which is what a table is — drops a field it has not been told about,
       silently, while `finish` reports success. That is the shape
       docs/reusable/silent-success.md is about, and it is the standing cost of
       columns over a blob. tests/store-pg-referee-claims.test.ts holds the round
       trip that goes red when it happens, and `EVERY_RUN_FIELD` in that file
       makes the *next* one a typecheck failure rather than a silent drop. */
    const rows = await db
      .update(refereeClaims)
      .set({
        status: patch.status,
        ...(patch.claims === undefined ? {} : { claims: patch.claims }),
        ...(patch.model === undefined ? {} : { model: patch.model }),
        ...(patch.claimsOmitted === undefined ? {} : { claimsOmitted: patch.claimsOmitted }),
        ...(patch.error === undefined ? {} : { error: patch.error }),
      })
      .where(eq(refereeClaims.articleId, articleId))
      .returning();

    if (patch.status === "error") logger.warn({ slug }, "claims run failed");
    /* Zero rows is `null`, never a resurrection: the row went away underneath
       the call, and inserting one here would store an answer for a paper nobody
       asked about any more. */
    return rows[0] ? toRun(rows[0]) : null;
  },

  async sweep(slug: string, live: boolean): Promise<ClaimsRun | null> {
    const db = getDb();
    const articleId = await articleIdFor(slug);

    if (!live) {
      /* Two guards, and each one alone is a bug — the same pair pg-searches.ts §
         sweepPending sets out. `live` is what THIS process is doing; the age
         check is for every other process, and without it a GET arriving on a
         second lambda would error a run the first lambda is halfway through
         streaming. See `CLAIMS_ORPHAN_GRACE_MS`. */
      const cutoff = new Date(Date.now() - CLAIMS_ORPHAN_GRACE_MS);
      const swept = await db
        .update(refereeClaims)
        .set({ status: "error", error: CLAIMS_SWEPT })
        .where(
          and(
            eq(refereeClaims.articleId, articleId),
            eq(refereeClaims.status, "pending"),
            lt(refereeClaims.createdAt, cutoff),
          ),
        )
        .returning({ articleId: refereeClaims.articleId });
      if (swept.length) logger.warn({ slug }, "swept an abandoned claims run");
    }

    /* The run as it now stands, so a GET is one call — the filesystem store
       answers the same way. */
    return runFor(articleId, db);
  },
};
