/**
 * **Debate's reader-picked claim checks** — the `debate_claim_checks` table.
 * docs/plans/261008i-debate-claims-picked-by-the-reader.md § 3 is the design;
 * src/db/schema.ts § `debateClaimChecks` says why the table is shaped as it
 * is. src/store/pg-referee-claims.ts is this file's model for the attempt, the
 * sweep and the logging rule, and none of its reasoning is repeated here.
 *
 * ## The reservation is the insert
 *
 * `begin` inserts a `pending` row and nothing else. The partial unique index
 * `debate_claim_checks_one_pending` refuses a second pending row on the same
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
import { debateClaimChecks } from "../db/schema.js";
import { DEBATE_CHECK_TIMEOUT_MS, CHECK_PROMPT_VERSION } from "../debate.js";
import { mintId } from "../ids.js";
import { log } from "../log.js";
import { DEBATE_CHECK_IN_FLIGHT, DEBATE_CHECK_SWEPT } from "../messages.js";
import { currentOwnerId } from "../owner.js";
import type { DebateCheckCounts, DebateCheckStatus, DebateClaimCheck } from "../types.js";
import type { ClaimCheckBegin, ClaimCheckFinish, DebateClaimChecksStore } from "./contracts.js";
import { guardDbStore, violatesConstraint } from "./db-errors.js";
import { articleIdForOwned } from "./pg.js";

const logger = log("store");

/**
 * **How long another process's `pending` check is left alone** — the call's
 * own deadline and a margin, derived rather than written down beside it, so a
 * sweep can never fire on a check whose model has not yet given up.
 * `CLAIMS_ORPHAN_GRACE_MS` in pg-referee-claims.ts is the sibling.
 *
 * **Two minutes of margin, not thirty seconds**, because the clocks start at
 * different moments: this one at the reservation (`created_at`), the model's
 * deadline only after the allowance is taken, the earlier checks read and the
 * stream opened. Thirty seconds of slow admission let another process sweep a
 * live check and lose its paid answer to the attempt fence (GPT Sol's E6).
 */
export const CHECK_ORPHAN_GRACE_MS = DEBATE_CHECK_TIMEOUT_MS + 120_000;

/** The partial unique index the reservation leans on. src/db/schema.ts. */
const ONE_PENDING = "debate_claim_checks_one_pending";

/**
 * **A check is already out on this article.** Carries its own status so it
 * passes `guardDbStore` and the route's error mapping as the 409 it is
 * (docs/postmortems/260901d-a-409-and-a-404-arrived-as-500.md).
 */
export class CheckInFlight extends Error {
  readonly status = 409;
  constructor() {
    super(DEBATE_CHECK_IN_FLIGHT);
    this.name = "CheckInFlight";
  }
}

type Row = typeof debateClaimChecks.$inferSelect;

/** The row as the panel reads it. Conditional spreads: absent, not null. */
function toCheck(row: Row): DebateClaimCheck {
  return {
    id: row.id,
    status: row.status as DebateCheckStatus,
    listSourceHash: row.listSourceHash,
    promptVersion: row.promptVersion,
    digFurther: row.digFurther,
    targets: row.targets,
    results: row.results,
    ...(row.counts === null ? {} : { counts: row.counts as DebateCheckCounts }),
    ...(row.webSearches === null ? {} : { webSearches: row.webSearches }),
    ...(row.model === null ? {} : { model: row.model }),
    ...(row.error === null ? {} : { error: row.error }),
    createdAt: row.createdAt.toISOString(),
    ...(row.finishedAt === null ? {} : { finishedAt: row.finishedAt.toISOString() }),
  };
}

async function listFor(articleId: string): Promise<DebateClaimCheck[]> {
  const rows = await getDb()
    .select()
    .from(debateClaimChecks)
    .where(eq(debateClaimChecks.articleId, articleId))
    .orderBy(asc(debateClaimChecks.createdAt), asc(debateClaimChecks.id));
  return rows.map(toCheck);
}

const rawStore: DebateClaimChecksStore = {
  async list(slug) {
    return listFor(await articleIdForOwned(slug));
  },

  async begin(slug, check: ClaimCheckBegin) {
    const articleId = await articleIdForOwned(slug);
    const attempt = randomUUID();
    let written: Row | undefined;
    try {
      [written] = await getDb()
        .insert(debateClaimChecks)
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
      if (violatesConstraint(err, ONE_PENDING)) throw new CheckInFlight();
      throw err;
    }
    logger.info({ slug, targets: check.targets.length, dig: check.digFurther }, "claim check started");
    // `written!`: an insert with `returning()` yields the row it wrote.
    return { check: toCheck(written!), attempt };
  },

  async abandon(slug, id, attempt) {
    const articleId = await articleIdForOwned(slug);
    await getDb()
      .delete(debateClaimChecks)
      .where(
        and(
          eq(debateClaimChecks.articleId, articleId),
          eq(debateClaimChecks.id, id),
          eq(debateClaimChecks.status, "pending"),
          eq(debateClaimChecks.attemptId, attempt),
        ),
      );
  },

  async finish(slug, id, patch: ClaimCheckFinish, attempt) {
    const articleId = await articleIdForOwned(slug);
    /* **Fenced three ways**, as pg-referee-claims.ts § finish: this article,
       still `pending`, and still this attempt's. A check the sweep has ended
       matches nothing and gets `null` — never a resurrection. */
    const rows = await getDb()
      .update(debateClaimChecks)
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
          eq(debateClaimChecks.articleId, articleId),
          eq(debateClaimChecks.id, id),
          eq(debateClaimChecks.status, "pending"),
          eq(debateClaimChecks.attemptId, attempt),
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
      .select({ id: debateClaimChecks.id })
      .from(debateClaimChecks)
      .where(
        and(
          eq(debateClaimChecks.articleId, articleId),
          eq(debateClaimChecks.status, "pending"),
          lt(debateClaimChecks.createdAt, cutoff),
        ),
      );
    for (const { id } of old) {
      if (live(id)) continue;
      const swept = await getDb()
        .update(debateClaimChecks)
        .set({
          status: "error",
          error: DEBATE_CHECK_SWEPT,
          attemptId: null,
          finishedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(debateClaimChecks.articleId, articleId),
            eq(debateClaimChecks.id, id),
            eq(debateClaimChecks.status, "pending"),
            lt(debateClaimChecks.createdAt, cutoff),
          ),
        )
        .returning({ id: debateClaimChecks.id });
      if (swept.length) logger.warn({ slug, id }, "swept an abandoned claim check");
    }
    return listFor(articleId);
  },
};

/** Guarded where it is built — src/store/db-errors.ts. */
export const pgDebateClaimChecksStore: DebateClaimChecksStore = guardDbStore(
  "debate-claim-checks",
  rawStore,
);
