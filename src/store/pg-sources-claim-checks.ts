/**
 * **Sources › Claims' reader-picked claim checks** — the `sources_claim_checks`
 * table (`debate_claim_checks` until 2026-10-09, plan 261009w, whose old name is
 * a view over it until the contract migration).
 * docs/plans/261008i-debate-claims-picked-by-the-reader.md § 3 is the design;
 * src/db/schema.ts § `sourcesClaimChecks` says why the table is shaped as it
 * is. src/store/pg-referee-claims.ts is this file's model for the attempt, the
 * sweep and the logging rule, and none of its reasoning is repeated here.
 *
 * ## The reservation is the insert
 *
 * `begin` inserts a `pending` row and nothing else. The partial unique index
 * `debate_claim_checks_one_pending` (its name kept through the table's rename;
 * see `ONE_PENDING`) refuses a second pending row on the same
 * article, and that refusal comes back as `CheckInFlight`, a 409 the route
 * answers before any allowance is taken or any model is called. There is no
 * read-then-insert here to race.
 *
 * ## What may be logged from this file
 *
 * Slugs, ids, statuses, counts. **Never a target** — a typed claim is the
 * reader's own words — **never a row, and never the stored `error`.**
 */

import { randomUUID } from "node:crypto";

import { and, asc, eq, lt, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { sourcesClaimChecks } from "../db/schema.js";
import { SOURCES_CLAIM_CHECK_TIMEOUT_MS, CHECK_PROMPT_VERSION } from "../reception.js";
import { mintId } from "../ids.js";
import { log } from "../log.js";
import { SOURCES_CLAIM_CHECK_IN_FLIGHT, SOURCES_CLAIM_CHECK_SWEPT } from "../messages.js";
import { currentOwnerId } from "../owner.js";
import type { SourcesClaimCheckCounts, SourcesClaimCheckStatus, SourcesClaimCheck } from "../types.js";
import type { ClaimCheckBegin, ClaimCheckFinish, SourcesClaimChecksStore } from "./contracts.js";
import { guardDbStore, violatesConstraint } from "./db-errors.js";
import { articleIdForOwned } from "./pg.js";

const logger = log("store");

/**
 * **How long another process's `pending` check is left alone** — the call's
 * own deadline and a margin, derived rather than written down beside it.
 * `CLAIMS_ORPHAN_GRACE_MS` in pg-referee-claims.ts is the sibling.
 *
 * **Both clocks start at the reservation**: this one at `created_at`, and the
 * call's deadline just after `begin` returns (src/routes.ts §
 * `runSourcesClaimCheck`), so setup comes out of the model's time (GPT Sol's
 * E6). The two minutes of margin cover the finish retries (14 s) and the gap
 * between the database stamping `created_at` and the route starting its
 * clock. What it cannot cover is a single store write that hangs for longer:
 * Postgres has no statement timeout here, and a store that slow is an outage.
 * Until the sweep ends an abandoned row, it holds the article's one check, so
 * a press there is a 409 for up to about eight minutes.
 */
export const CHECK_ORPHAN_GRACE_MS = SOURCES_CLAIM_CHECK_TIMEOUT_MS + 120_000;

/** The partial unique index the reservation leans on. src/db/schema.ts. */
/**
 * The partial unique index the reservation leans on, by **either** name.
 * src/db/schema.ts § `sourcesClaimChecks`: the expand migration of plan
 * 261009w renamed the table and kept the index's old name (GPT Sol's F3),
 * because the code deployed before it recognises the violation by that
 * literal; the contract migration renames it. Accepting both means neither
 * migration can turn a 409 into a 500.
 */
const ONE_PENDING = ["debate_claim_checks_one_pending", "sources_claim_checks_one_pending"] as const;

/**
 * **A check is already out on this article.** Carries its own status so it
 * passes `guardDbStore` and the route's error mapping as the 409 it is
 * (docs/postmortems/260901d-a-409-and-a-404-arrived-as-500.md).
 */
export class CheckInFlight extends Error {
  readonly status = 409;
  constructor() {
    super(SOURCES_CLAIM_CHECK_IN_FLIGHT);
    this.name = "CheckInFlight";
  }
}

type Row = typeof sourcesClaimChecks.$inferSelect;

/** The row as the panel reads it. Conditional spreads: absent, not null. */
function toCheck(row: Row): SourcesClaimCheck {
  return {
    id: row.id,
    status: row.status as SourcesClaimCheckStatus,
    listSourceHash: row.listSourceHash,
    promptVersion: row.promptVersion,
    digFurther: row.digFurther,
    targets: row.targets,
    results: row.results,
    ...(row.counts === null ? {} : { counts: row.counts as SourcesClaimCheckCounts }),
    ...(row.webSearches === null ? {} : { webSearches: row.webSearches }),
    ...(row.model === null ? {} : { model: row.model }),
    ...(row.error === null ? {} : { error: row.error }),
    createdAt: row.createdAt.toISOString(),
    ...(row.finishedAt === null ? {} : { finishedAt: row.finishedAt.toISOString() }),
  };
}

async function listFor(articleId: string): Promise<SourcesClaimCheck[]> {
  const rows = await getDb()
    .select()
    .from(sourcesClaimChecks)
    .where(eq(sourcesClaimChecks.articleId, articleId))
    .orderBy(asc(sourcesClaimChecks.createdAt), asc(sourcesClaimChecks.id));
  return rows.map(toCheck);
}

const rawStore: SourcesClaimChecksStore = {
  async list(slug) {
    return listFor(await articleIdForOwned(slug));
  },

  async begin(slug, check: ClaimCheckBegin) {
    const articleId = await articleIdForOwned(slug);
    const attempt = randomUUID();
    let written: Row | undefined;
    try {
      [written] = await getDb()
        .insert(sourcesClaimChecks)
        .values({
          articleId,
          id: mintId(),
          ownerId: currentOwnerId(),
          status: "pending",
          attemptId: attempt,
          listSourceHash: check.listSourceHash,
          promptVersion: CHECK_PROMPT_VERSION,
          digFurther: check.digFurther,
          targets: check.targets,
          results: [],
        })
        .returning();
    } catch (err) {
      if (ONE_PENDING.some((name) => violatesConstraint(err, name))) throw new CheckInFlight();
      throw err;
    }
    logger.info({ slug, targets: check.targets.length, dig: check.digFurther }, "claim check started");
    // `written!`: an insert with `returning()` yields the row it wrote.
    return { check: toCheck(written!), attempt };
  },

  async abandon(slug, id, attempt) {
    const articleId = await articleIdForOwned(slug);
    await getDb()
      .delete(sourcesClaimChecks)
      .where(
        and(
          eq(sourcesClaimChecks.articleId, articleId),
          eq(sourcesClaimChecks.id, id),
          eq(sourcesClaimChecks.status, "pending"),
          eq(sourcesClaimChecks.attemptId, attempt),
        ),
      );
  },

  async finish(slug, id, patch: ClaimCheckFinish, attempt) {
    const articleId = await articleIdForOwned(slug);
    /* **Fenced three ways**, as pg-referee-claims.ts § finish: this article,
       still `pending`, and still this attempt's. A check the sweep has ended
       matches nothing and gets `null` — never a resurrection. */
    const rows = await getDb()
      .update(sourcesClaimChecks)
      .set(
        patch.status === "done"
          ? {
              status: "done",
              results: patch.results,
              counts: patch.counts,
              webSearches: patch.webSearches,
              model: patch.model,
              attemptId: null,
              finishedAt: sql`clock_timestamp()`,
            }
          : {
              status: "error",
              error: patch.error,
              attemptId: null,
              finishedAt: sql`clock_timestamp()`,
            },
      )
      .where(
        and(
          eq(sourcesClaimChecks.articleId, articleId),
          eq(sourcesClaimChecks.id, id),
          eq(sourcesClaimChecks.status, "pending"),
          eq(sourcesClaimChecks.attemptId, attempt),
        ),
      )
      .returning();
    if (patch.status === "error") logger.warn({ slug, id }, "claim check failed");
    return rows[0] ? toCheck(rows[0]) : null;
  },

  async sweep(slug, live) {
    const articleId = await articleIdForOwned(slug);
    /* Two guards, each a bug alone (pg-searches.ts § sweepPending): `live` is
       this process; the age is every other process. */
    const cutoff = new Date(Date.now() - CHECK_ORPHAN_GRACE_MS);
    const old = await getDb()
      .select({ id: sourcesClaimChecks.id })
      .from(sourcesClaimChecks)
      .where(
        and(
          eq(sourcesClaimChecks.articleId, articleId),
          eq(sourcesClaimChecks.status, "pending"),
          lt(sourcesClaimChecks.createdAt, cutoff),
        ),
      );
    for (const { id } of old) {
      if (live(id)) continue;
      const swept = await getDb()
        .update(sourcesClaimChecks)
        .set({
          status: "error",
          error: SOURCES_CLAIM_CHECK_SWEPT,
          attemptId: null,
          finishedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(sourcesClaimChecks.articleId, articleId),
            eq(sourcesClaimChecks.id, id),
            eq(sourcesClaimChecks.status, "pending"),
            lt(sourcesClaimChecks.createdAt, cutoff),
          ),
        )
        .returning({ id: sourcesClaimChecks.id });
      if (swept.length) logger.warn({ slug, id }, "swept an abandoned claim check");
    }
    return listFor(articleId);
  },
};

/** Guarded where it is built — src/store/db-errors.ts. */
export const pgSourcesClaimChecksStore: SourcesClaimChecksStore = guardDbStore(
  "sources-claim-checks",
  rawStore,
);
