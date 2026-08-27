/**
 * The ledger in Postgres — one row per model call, inserted and never amended.
 *
 * The filesystem half is [ai-calls-fs.ts](ai-calls-fs.ts), and it is a genuine
 * second implementation rather than a fallback: the store flag picks one at
 * boot and the other is never consulted. [index.ts](index.ts) explains why that
 * distinction matters everywhere else in this directory.
 *
 * ## What may be logged from this file
 *
 * Ids, models, counts, money. **Nothing else, ever** — and there is very little
 * here that could go wrong that way, because the row carries no prose: no
 * prompt, no answer, no article text, and deliberately no raw response. That is
 * a schema decision rather than a discipline one, which is the stronger kind.
 * See `aiCalls` in [../db/schema.ts](../db/schema.ts).
 *
 * The insert still goes through `guardDbStore` like every other store here, for
 * the reason [db-errors.ts](db-errors.ts) gives: a failed Drizzle query puts
 * every bound parameter into `Error.message`, and a slug and an owner id are
 * bound parameters.
 */

import { and, asc, eq, gte, lt } from "drizzle-orm";

import type { AiCallRow } from "../ai-spend.js";
import { getDb } from "../db/client.js";
import { aiCalls, articles } from "../db/schema.js";
import type { CostStore, LedgerRead } from "./contracts.js";
import { ownedSlug } from "./owned-slug.js";

type Row = typeof aiCalls.$inferSelect;

/**
 * The article's uuid for a slug, or `null`.
 *
 * **Never throws, and that is the point.** This runs on the accounting path,
 * after a model call the reader is waiting on has already returned. A slug that
 * no longer resolves — a deleted article, a race, a scope with nobody
 * authenticated — must cost the row its `article_id` and nothing else:
 * `article_slug` is still written, and it is the historical fact anyway.
 */
async function articleIdFor(slug: string, ownerId: string): Promise<string | null> {
  try {
    const rows = await getDb()
      .select({ id: articles.id })
      .from(articles)
      /* `ownedSlug`, never a bare slug match: the column is globally unique, so
         an unfiltered lookup finds anybody's article. `tests/owner-isolation.ts`
         greps this directory for the unsanctioned spelling and it caught this
         file writing one.

         **The row's own owner, not the ambient one.** They agree today, and
         would stop agreeing the moment a CLI or eval scope names an owner
         explicitly — at which point the ambient answer would be the environment
         and the row's would be the one the ledger is billing. GPT Sol. */
      .where(ownedSlug(slug, ownerId))
      .limit(1);
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

function toRow(r: Row): AiCallRow {
  return {
    id: r.id,
    runId: r.runId,
    generationId: r.generationId,
    scopeKind: r.scopeKind as AiCallRow["scopeKind"],
    ownerId: r.ownerId,
    articleSlug: r.articleSlug,
    jobId: r.jobId,
    stepName: r.stepName,
    wire: r.wire as AiCallRow["wire"],
    job: r.purpose as AiCallRow["job"],
    requestedModel: r.requestedModel,
    answeredModel: r.answeredModel,
    upstream: r.upstream,
    credentialFingerprint: r.credentialFingerprint,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt.toISOString(),
    durationMs: r.durationMs,
    outcome: r.outcome as AiCallRow["outcome"],
    creditsUsedNanos: r.creditsUsedNanos,
    upstreamInferenceNanos: r.upstreamInferenceNanos,
    isByok: r.isByok,
    reportedInputTokens: r.reportedInputTokens,
    outputTokens: r.outputTokens,
    cacheReadTokens: r.cacheReadTokens,
    cacheWriteTokens: r.cacheWriteTokens,
    cacheWrite5mTokens: r.cacheWrite5mTokens,
    cacheWrite1hTokens: r.cacheWrite1hTokens,
    reasoningTokens: r.reasoningTokens,
    webSearches: r.webSearches,
    serviceTier: r.serviceTier,
    inferenceGeo: r.inferenceGeo,
  };
}

export const pgCostStore: CostStore = {
  describe: () => "postgres: spideryarn.ai_calls",

  async record(row: AiCallRow): Promise<void> {
    const articleId = row.articleSlug
      ? await articleIdFor(row.articleSlug, row.ownerId)
      : null;
    await getDb()
      .insert(aiCalls)
      .values({
        id: row.id,
        runId: row.runId,
        generationId: row.generationId,
        scopeKind: row.scopeKind,
        ownerId: row.ownerId,
        articleId,
        articleSlug: row.articleSlug,
        jobId: row.jobId,
        stepName: row.stepName,
        wire: row.wire,
        purpose: row.job,
        requestedModel: row.requestedModel,
        answeredModel: row.answeredModel,
        upstream: row.upstream,
        credentialFingerprint: row.credentialFingerprint,
        startedAt: new Date(row.startedAt),
        finishedAt: new Date(row.finishedAt),
        durationMs: row.durationMs,
        outcome: row.outcome,
        creditsUsedNanos: row.creditsUsedNanos,
        upstreamInferenceNanos: row.upstreamInferenceNanos,
        isByok: row.isByok,
        reportedInputTokens: row.reportedInputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        cacheWrite5mTokens: row.cacheWrite5mTokens,
        cacheWrite1hTokens: row.cacheWrite1hTokens,
        reasoningTokens: row.reasoningTokens,
        webSearches: row.webSearches,
        serviceTier: row.serviceTier,
        inferenceGeo: row.inferenceGeo,
      })
      /* **The same call must not produce two rows.** The id is minted before the
         request goes out, so a retry of the *insert* — not of the call — has a
         key to collide on, and a ledger that double-counts is wrong in the
         direction that looks like the thing you were measuring. */
      .onConflictDoNothing({ target: aiCalls.id });
  },

  async read(since?: string, until?: string): Promise<LedgerRead> {
    /* Half-open, and the same rule as the filesystem half: `until` is the first
       instant *not* included, so two adjacent months cannot both claim a call. */
    const bounds = [
      ...(since ? [gte(aiCalls.startedAt, new Date(since))] : []),
      ...(until ? [lt(aiCalls.startedAt, new Date(until))] : []),
    ];
    const rows = await getDb()
      .select()
      .from(aiCalls)
      .where(bounds.length > 0 ? and(...bounds) : undefined)
      .orderBy(asc(aiCalls.startedAt));
    /* Nothing can be unreadable here — a row either parsed on the way in or was
       never written. The field exists so that the two stores answer the same
       question in the same shape. */
    return { rows: rows.map(toRow), unreadable: 0 };
  },

  async forJob(jobId: string): Promise<LedgerRead> {
    const rows = await getDb()
      .select()
      .from(aiCalls)
      .where(eq(aiCalls.jobId, jobId))
      .orderBy(asc(aiCalls.startedAt));
    return { rows: rows.map(toRow), unreadable: 0 };
  },

  /** Not a question a table answers cheaply, and nothing needs it to. */
  size: async () => null,
};
