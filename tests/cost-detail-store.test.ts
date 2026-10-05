/**
 * The cost analysis's two reads — `spendDetail`, and `spendCube` run on a
 * database handed to it — in
 * [src/store/ai-calls-spend-pg.ts](../src/store/ai-calls-spend-pg.ts).
 * docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md § stage 3.
 *
 * What this file holds:
 *
 * - **a database passed in gives the rows the default one does** — the
 *   production read goes through a client the script built, so the column
 *   mapping of that second handle has to be the same;
 * - **the detail rows mask slugs exactly as the cube does**, searched as text;
 * - **the detail rows add up to the cube**, call for call and nano for nano.
 *
 * Postgres-only, like tests/admin-costs-store.test.ts, whose fixtures' shapes
 * these repeat under their own ids and their own month.
 */

import { afterAll, describe, expect, it } from "vitest";

import type { AiCallRow } from "../src/ai-spend.js";
import { loadEnvLocal } from "../src/env.js";
import type { OwnerId } from "../src/owner.js";
import { bareArticles, removeBareArticles } from "./helpers/bare-article.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

/* July 2033: the cube's own suite has May, and nothing else looks here. */
const SINCE = "2033-07-01T00:00:00.000Z";
const UNTIL = "2033-08-01T00:00:00.000Z";

const RUN = "00000000-0000-4000-8000-0000de7a0f01";
const ASKER = "00000000-0000-4000-8000-0000de7a0a01";
const OTHER = "00000000-0000-4000-8000-0000de7a0a02";

const ASKER_SLUG = "detail-asker-live-piece-d1";
const ASKER_GONE_SLUG = "detail-asker-deleted-piece-d2";
const OTHER_SLUG = "detail-other-live-piece-d3";
const OTHER_GONE_SLUG = "detail-other-deleted-piece-d4";
const KEY = "cost-detail-test-privacy-key";

function row(n: number, over: Partial<AiCallRow>): AiCallRow {
  return {
    id: `00000000-0000-4000-8000-0000de7a1${String(n).padStart(3, "0")}`,
    runId: RUN,
    generationId: null,
    scopeKind: "job_step",
    ownerId: OTHER,
    articleSlug: null,
    jobId: null,
    stepName: "structure",
    wire: "messages",
    job: "structure",
    requestedModel: "anthropic/claude-sonnet-5",
    answeredModel: "anthropic/claude-sonnet-5",
    upstream: "Anthropic",
    providerAccount: "openrouter",
    costSource: "provider",
    computedCostNanos: null,
    priceVersion: null,
    credentialFingerprint: "abcdef012345",
    startedAt: "2033-07-10T10:00:00.000Z",
    finishedAt: "2033-07-10T10:00:01.000Z",
    durationMs: 1000,
    outcome: "ok",
    creditsUsedNanos: 1_000_000,
    byokUpstreamNanos: null,
    isByok: false,
    reportedInputTokens: 13,
    outputTokens: 4,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheWrite5mTokens: null,
    cacheWrite1hTokens: null,
    reasoningTokens: 0,
    webSearches: null,
    serviceTier: null,
    inferenceGeo: null,
    realtimeSessionId: null,
    providerEventId: null,
    eventKind: null,
    providerStatus: null,
    inputTextTokens: null,
    inputAudioTokens: null,
    inputImageTokens: null,
    cachedTextTokens: null,
    cachedAudioTokens: null,
    outputTextTokens: null,
    outputAudioTokens: null,
    transcriptionSeconds: null,
    voiceSeconds: null,
    ...over,
  };
}

const FIXTURES: AiCallRow[] = [
  row(1, {
    ownerId: ASKER,
    articleSlug: ASKER_SLUG,
    jobId: "detail-job-1",
    generationId: "gen-detail-1",
    creditsUsedNanos: 10_000_000,
    reportedInputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 300,
    cacheWriteTokens: 40,
    reasoningTokens: 5,
    webSearches: 2,
    durationMs: 1234,
  }),
  row(2, { ownerId: ASKER, articleSlug: ASKER_GONE_SLUG, creditsUsedNanos: 2_000_000 }),
  row(3, {
    articleSlug: OTHER_SLUG,
    scopeKind: "request",
    job: "chat",
    stepName: null,
    wire: "chat",
    creditsUsedNanos: 5_000_000,
  }),
  row(4, { articleSlug: OTHER_GONE_SLUG, creditsUsedNanos: 3_000_000 }),
  row(5, { outcome: "error", creditsUsedNanos: 7_000_000 }),
  row(6, { creditsUsedNanos: 0, byokUpstreamNanos: 6_000_000, isByok: true }),
  row(7, {
    providerAccount: "anthropic",
    costSource: "computed",
    creditsUsedNanos: null,
    computedCostNanos: 8_000_000,
    priceVersion: "test",
  }),
  /* Happened and reported nothing. */
  row(8, { costSource: "none", creditsUsedNanos: null, outcome: "aborted" }),
  /* On the upper bound: the next window's. */
  row(9, { startedAt: UNTIL, finishedAt: UNTIL, creditsUsedNanos: 999_000_000 }),
];

const IN_WINDOW = FIXTURES.filter((r) => r.startedAt < UNTIL);

await pgReady({
  suite: "tests/cost-detail-store.test.ts",
  tables: ["spideryarn.ai_calls"],
  columns: [{ table: "spideryarn.ai_calls", column: "byok_upstream_nanos" }],
  max: 3,
});

describe("the cost analysis's reads", () => {
  afterAll(async () => {
    const { getDb, closeDb } = await import("../src/db/client.js");
    const { aiCalls } = await import("../src/db/schema.js");
    const { eq } = await import("drizzle-orm");
    await getDb().delete(aiCalls).where(eq(aiCalls.runId, RUN));
    await removeBareArticles([ASKER_SLUG], ASKER as OwnerId);
    await removeBareArticles([OTHER_SLUG], OTHER as OwnerId);
    await closeDb();
  });

  const written = (async () => {
    const { getDb } = await import("../src/db/client.js");
    const { pgCostStore } = await import("../src/store/ai-calls-pg.js");
    await seedAuthUser(getDb(), {
      id: ASKER,
      email: "detail-asker@spideryarn.local",
      onConflictDoNothing: true,
    });
    await seedAuthUser(getDb(), {
      id: OTHER,
      email: "detail-other@spideryarn.local",
      onConflictDoNothing: true,
    });
    await bareArticles([ASKER_SLUG], ASKER as OwnerId);
    await bareArticles([OTHER_SLUG], OTHER as OwnerId);
    for (const fixture of FIXTURES) await pgCostStore.record(fixture);
  })();

  /**
   * A second handle on the same database, made exactly as `npm run
   * cost:analyse` makes its own: the script's client, its read-only snapshot,
   * and `drizzleOver`.
   */
  async function withOwnClient<T>(work: (db: import("../src/db/client.js").Db) => Promise<T>): Promise<T> {
    const { localTarget, readSnapshot } = await import("../scripts/cost-analysis.js");
    const { drizzleOver } = await import("../src/db/client.js");
    const target = localTarget();
    expect(target.kind).toBe("local");
    return readSnapshot(target.client, () => work(drizzleOver(target.client)));
  }

  it("cannot write through the script's connection", async () => {
    await written;
    const { sql } = await import("drizzle-orm");
    const refused = await withOwnClient((db) =>
      db.execute(sql`delete from spideryarn.ai_calls where run_id = ${RUN}`),
    ).then(
      () => null,
      (err: { code?: string; cause?: { code?: string } }) => err.cause?.code ?? err.code ?? "no code",
    );
    /* 25006: read_only_sql_transaction. */
    expect(refused).toBe("25006");
    const { spendDetail } = await import("../src/store/ai-calls-spend-pg.js");
    expect(await spendDetail(SINCE, UNTIL, ASKER, KEY)).toHaveLength(IN_WINDOW.length);
  });

  const byEverything = (a: object, b: object) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);

  it("runs the cube on a database handed to it, and gets the default one's rows", async () => {
    await written;
    const { spendCube } = await import("../src/store/ai-calls-spend-pg.js");
    const usual = await spendCube(SINCE, UNTIL, ASKER, KEY);
    const passed = await withOwnClient((db) => spendCube(SINCE, UNTIL, ASKER, KEY, undefined, db));
    expect(usual.length).toBeGreaterThan(0);
    expect([...passed].sort(byEverything)).toEqual([...usual].sort(byEverything));
  });

  it("reads the detail rows on a database handed to it, inside a read-only transaction", async () => {
    await written;
    const { spendDetail } = await import("../src/store/ai-calls-spend-pg.js");
    const usual = await spendDetail(SINCE, UNTIL, ASKER, KEY);
    const passed = await withOwnClient((db) => spendDetail(SINCE, UNTIL, ASKER, KEY, { db }));
    expect(passed).toEqual(usual);
  });

  it("returns one row per call in the window, with the raw usage columns", async () => {
    await written;
    const { spendDetail } = await import("../src/store/ai-calls-spend-pg.js");
    const rows = await spendDetail(SINCE, UNTIL, ASKER, KEY);
    expect(rows.map((r) => r.id).sort()).toEqual(IN_WINDOW.map((r) => r.id).sort());
    const first = rows.find((r) => r.id === FIXTURES[0]?.id);
    expect(first).toMatchObject({
      runId: RUN,
      jobId: "detail-job-1",
      generationId: "gen-detail-1",
      startedAt: "2033-07-10T10:00:00.000Z",
      ownerId: ASKER,
      articleSlug: ASKER_SLUG,
      scopeKind: "job_step",
      job: "structure",
      stepName: "structure",
      wire: "messages",
      requestedModel: "anthropic/claude-sonnet-5",
      answeredModel: "anthropic/claude-sonnet-5",
      upstream: "Anthropic",
      providerAccount: "openrouter",
      costSource: "provider",
      isByok: false,
      outcome: "ok",
      eventKind: null,
      creditsUsedNanos: 10_000_000,
      byokUpstreamNanos: null,
      computedCostNanos: null,
      reportedInputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 300,
      cacheWriteTokens: 40,
      reasoningTokens: 5,
      webSearches: 2,
      durationMs: 1234,
    });
    expect(first?.articleId).toMatch(/^[0-9a-f-]{36}$/);
    /* A null is kept a null: "reported nothing" is not "cost nothing". */
    expect(rows.find((r) => r.id === FIXTURES[7]?.id)).toMatchObject({
      creditsUsedNanos: null,
      costSource: "none",
      outcome: "aborted",
    });
    for (const r of rows) {
      for (const key of ["creditsUsedNanos", "byokUpstreamNanos", "computedCostNanos"] as const) {
        expect(r[key] === null || typeof r[key] === "number", key).toBe(true);
      }
    }
  });

  it("names the asker's own slugs and nobody else's, in any field", async () => {
    await written;
    const { spendDetail } = await import("../src/store/ai-calls-spend-pg.js");
    const text = JSON.stringify(await spendDetail(SINCE, UNTIL, ASKER, KEY));
    expect(text).toContain(ASKER_SLUG);
    expect(text).toContain(ASKER_GONE_SLUG);
    expect(text).not.toContain(OTHER_SLUG);
    expect(text).not.toContain(OTHER_GONE_SLUG);
    /* And the rule keys on who is asking. */
    const asOther = JSON.stringify(await spendDetail(SINCE, UNTIL, OTHER, KEY));
    expect(asOther).toContain(OTHER_SLUG);
    expect(asOther).not.toContain(ASKER_SLUG);
  });

  it("masks an article exactly as the cube does", async () => {
    await written;
    const { spendCube, spendDetail } = await import("../src/store/ai-calls-spend-pg.js");
    const { articleKeyOf, articleKeyString } = await import("../src/cost-cube.js");
    const names = (rows: Parameters<typeof articleKeyOf>[0][]) =>
      [...new Set(rows.map((r) => `${articleKeyString(articleKeyOf(r))}|${r.articleSlug}`))].sort();
    const cube = await spendCube(SINCE, UNTIL, ASKER, KEY);
    const detail = await spendDetail(SINCE, UNTIL, ASKER, KEY);
    expect(names(detail)).toEqual(names(cube));
    /* Four articles and "no article". */
    expect(names(detail)).toHaveLength(5);
    const recorded = detail.filter((r) => r.recordedSlugHash !== null);
    expect(recorded).toHaveLength(2);
    for (const r of recorded) expect(r.recordedSlugHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("adds up to the cube, call for call and nano for nano", async () => {
    await written;
    const { spendCube, spendDetail } = await import("../src/store/ai-calls-spend-pg.js");
    const cube = await spendCube(SINCE, UNTIL, ASKER, KEY);
    const detail = await spendDetail(SINCE, UNTIL, ASKER, KEY);
    const sum = <T>(rows: readonly T[], pick: (r: T) => number | null) =>
      rows.reduce((n, r) => n + (pick(r) ?? 0), 0);
    expect(detail).toHaveLength(sum(cube, (g) => g.calls));
    expect(sum(detail, (r) => r.creditsUsedNanos)).toBe(sum(cube, (g) => g.creditsNanos));
    expect(sum(detail, (r) => r.byokUpstreamNanos)).toBe(sum(cube, (g) => g.byokNanos));
    expect(sum(detail, (r) => r.computedCostNanos)).toBe(sum(cube, (g) => g.computedNanos));
    expect(sum(cube, (g) => g.creditsNanos)).toBe(27_000_000);
  });

  it("refuses, rather than truncates, past the cap", async () => {
    await written;
    const { spendDetail, SpendDetailTooLarge } = await import("../src/store/ai-calls-spend-pg.js");
    await expect(
      spendDetail(SINCE, UNTIL, ASKER, KEY, { maxRows: IN_WINDOW.length - 1 }),
    ).rejects.toBeInstanceOf(SpendDetailTooLarge);
    expect(await spendDetail(SINCE, UNTIL, ASKER, KEY, { maxRows: IN_WINDOW.length })).toHaveLength(
      IN_WINDOW.length,
    );
  });
});
