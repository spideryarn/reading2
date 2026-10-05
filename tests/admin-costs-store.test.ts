/**
 * The cost cube's query — `spendCube` in
 * [src/store/ai-calls-spend-pg.ts](../src/store/ai-calls-spend-pg.ts).
 * docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md.
 *
 * Two things this file exists for:
 *
 * - **the cube's totals equal the rows' own**, held against `totalRows()` over
 *   the same fixtures rather than against a hand-written figure;
 * - **no other owner's slug leaves the database** — the whole result is
 *   stringified and searched, so a slug in a field nobody thought of is caught.
 *
 * Postgres-only, and it skips loudly without a database like every `*-pg` suite.
 */

import { afterAll, describe, expect, it } from "vitest";

import type { AiCallRow } from "../src/ai-spend.js";
import { loadEnvLocal } from "../src/env.js";
import type { OwnerId } from "../src/owner.js";
import { totalRows } from "../src/store/ai-calls.js";
import { bareArticles, removeBareArticles } from "./helpers/bare-article.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

/* **The year 2033**, which no other suite and no real report looks at — the
   aggregate's whole interface is a time range, so a window nothing else uses
   is what makes these totals a statement about these fixtures. */
const SINCE = "2033-05-01T00:00:00.000Z";
const UNTIL = "2033-06-01T00:00:00.000Z";

const RUN = "00000000-0000-4000-8000-0000c0be0f01";
/** Whoever is asking. Not the real administrator: the rule keys on the argument. */
const ASKER = "00000000-0000-4000-8000-0000c0be0a01";
const OTHER = "00000000-0000-4000-8000-0000c0be0a02";

const ASKER_SLUG = "cube-asker-live-piece-c1";
const ASKER_GONE_SLUG = "cube-asker-deleted-piece-c2";
const OTHER_SLUG = "cube-other-live-piece-c3";
const OTHER_GONE_ONE = "cube-other-deleted-first-c4";
const OTHER_GONE_TWO = "cube-other-deleted-second-c5";
const OTHER_SLUGS = [OTHER_SLUG, OTHER_GONE_ONE, OTHER_GONE_TWO];

function row(n: number, over: Partial<AiCallRow>): AiCallRow {
  return {
    id: `00000000-0000-4000-8000-0000c0be1${String(n).padStart(3, "0")}`,
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
    startedAt: "2033-05-10T10:00:00.000Z",
    finishedAt: "2033-05-10T10:00:01.000Z",
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
  /* The asker's live article: carries its id, and its slug may be named. */
  row(1, { ownerId: ASKER, articleSlug: ASKER_SLUG, creditsUsedNanos: 10_000_000 }),
  row(2, { ownerId: ASKER, articleSlug: ASKER_SLUG, creditsUsedNanos: 11_000_000 }),
  /* The asker's slug with no article behind it: a recorded name only. */
  row(3, { ownerId: ASKER, articleSlug: ASKER_GONE_SLUG, creditsUsedNanos: 2_000_000 }),
  /* Somebody else's live article — and the model that answered is not the one asked for. */
  row(4, {
    articleSlug: OTHER_SLUG,
    scopeKind: "request",
    job: "chat",
    stepName: null,
    wire: "chat",
    requestedModel: "vendor/asked-for",
    answeredModel: "vendor/answered-instead",
    creditsUsedNanos: 5_000_000,
  }),
  /* Two recorded slugs of somebody else's, alike in every other column. */
  row(5, { articleSlug: OTHER_GONE_ONE, creditsUsedNanos: 3_000_000 }),
  row(6, { articleSlug: OTHER_GONE_TWO, creditsUsedNanos: 4_000_000 }),
  /* Failed, and it still cost. */
  row(7, { outcome: "error", creditsUsedNanos: 7_000_000 }),
  /* BYOK: a zero from OpenRouter and the money on somebody else's key. */
  row(8, { creditsUsedNanos: 0, byokUpstreamNanos: 6_000_000, isByok: true }),
  /* Our own arithmetic. */
  row(9, {
    providerAccount: "anthropic",
    costSource: "computed",
    creditsUsedNanos: null,
    computedCostNanos: 8_000_000,
    priceVersion: "test",
  }),
  /* Happened and reported nothing. */
  row(10, { costSource: "none", creditsUsedNanos: null }),
  /* Another UTC day, half an hour before midnight. */
  row(11, {
    startedAt: "2033-05-11T23:30:00.000Z",
    finishedAt: "2033-05-11T23:30:01.000Z",
    creditsUsedNanos: 9_000_000,
  }),
  /* Exactly on the upper bound: the next window's. */
  row(12, { startedAt: UNTIL, finishedAt: UNTIL, creditsUsedNanos: 999_000_000 }),
];

const IN_WINDOW = FIXTURES.filter((r) => r.startedAt < UNTIL);

await pgReady({
  suite: "tests/admin-costs-store.test.ts",
  tables: ["spideryarn.ai_calls"],
  columns: [{ table: "spideryarn.ai_calls", column: "byok_upstream_nanos" }],
  max: 3,
});

describe("the cost cube", () => {
  afterAll(async () => {
    const { getDb, closeDb } = await import("../src/db/client.js");
    const { aiCalls } = await import("../src/db/schema.js");
    const { eq } = await import("drizzle-orm");
    /* The ledger rows and the articles. The two accounts stay: `owner_id` is
       `ON DELETE RESTRICT` on purpose (tests/ai-calls-spend-pg.test.ts). */
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
      email: "cube-asker@spideryarn.local",
      onConflictDoNothing: true,
    });
    await seedAuthUser(getDb(), {
      id: OTHER,
      email: "cube-other@spideryarn.local",
      onConflictDoNothing: true,
    });
    /* The two live articles exist before their rows are written, so those rows
       resolve an id; the "gone" slugs never had one. */
    await bareArticles([ASKER_SLUG], ASKER as OwnerId);
    await bareArticles([OTHER_SLUG], OTHER as OwnerId);
    for (const fixture of FIXTURES) await pgCostStore.record(fixture);
  })();

  async function cube(
    asker = ASKER,
    maxGroups?: number,
    privacyKey = "cost-cube-test-privacy-key",
  ) {
    await written;
    const { spendCube } = await import("../src/store/ai-calls-spend-pg.js");
    return spendCube(SINCE, UNTIL, asker, privacyKey, maxGroups);
  }

  it("adds up to the rows it was made from, pocket by pocket", async () => {
    const groups = await cube();
    const js = totalRows(IN_WINDOW);
    const sum = (pick: (g: (typeof groups)[number]) => number) =>
      groups.reduce((n, g) => n + pick(g), 0);
    expect(sum((g) => g.calls)).toBe(IN_WINDOW.length);
    expect(sum((g) => g.creditsNanos)).toBe(js.credits);
    expect(sum((g) => g.byokNanos)).toBe(js.upstream);
    expect(sum((g) => g.computedNanos)).toBe(js.computed);
    expect(sum((g) => g.unpricedCalls)).toBe(js.unpriced);
    expect(sum((g) => g.computedCalls)).toBe(1);
    expect(sum((g) => g.settledCalls)).toBe(IN_WINDOW.length - 2);
    /* The row on the bound would show here before anywhere else. */
    expect(js.credits).toBeLessThan(999_000_000);
    expect(js.credits).toBeGreaterThan(0);
  });

  it("returns numbers, not the strings node-postgres hands back", async () => {
    const groups = await cube();
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      for (const key of [
        "calls",
        "creditsNanos",
        "byokNanos",
        "computedNanos",
        "unpricedCalls",
        "computedCalls",
        "settledCalls",
      ] as const) {
        expect(typeof g[key], key).toBe("number");
      }
      expect(g.day).toMatch(/^2033-05-\d{2}$/);
    }
    expect(groups.some((g) => g.isByok === true)).toBe(true);
  });

  it("names the asker's own slugs and nobody else's, in any field", async () => {
    const text = JSON.stringify(await cube());
    expect(text).toContain(ASKER_SLUG);
    expect(text).toContain(ASKER_GONE_SLUG);
    for (const slug of OTHER_SLUGS) expect(text, slug).not.toContain(slug);
  });

  it("keys the rule on who is asking", async () => {
    const text = JSON.stringify(await cube(OTHER));
    for (const slug of OTHER_SLUGS) expect(text, slug).toContain(slug);
    expect(text).not.toContain(ASKER_SLUG);
    expect(text).not.toContain(ASKER_GONE_SLUG);
  });

  it("gives somebody else's live article its id and nothing else", async () => {
    const groups = await cube();
    const theirs = groups.filter((g) => g.ownerId === OTHER && g.articleId !== null);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ articleSlug: null, recordedSlugHash: null, creditsNanos: 5_000_000 });
    /* And the asker's live article is one group of two calls, slug beside its id. */
    const mine = groups.filter((g) => g.ownerId === ASKER && g.articleId !== null);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ articleSlug: ASKER_SLUG, recordedSlugHash: null, calls: 2 });
  });

  it("keeps two recorded slugs apart, as two opaque names", async () => {
    const groups = await cube();
    const recorded = groups.filter((g) => g.ownerId === OTHER && g.recordedSlugHash !== null);
    expect(recorded.map((g) => g.creditsNanos).sort()).toEqual([3_000_000, 4_000_000]);
    const hashes = recorded.map((g) => g.recordedSlugHash);
    expect(new Set(hashes).size).toBe(2);
    for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const underAnotherKey = await cube(ASKER, undefined, "another-cost-cube-privacy-key");
    const otherHashes = underAnotherKey
      .filter((g) => g.ownerId === OTHER && g.recordedSlugHash !== null)
      .map((g) => g.recordedSlugHash);
    expect(otherHashes).not.toEqual(hashes);
    for (const g of recorded) expect(g.articleId).toBeNull();
    /* The asker's own recorded slug is named, but its address-bar key is still opaque. */
    const own = groups.find((g) => g.articleSlug === ASKER_GONE_SLUG);
    expect(own).toMatchObject({ articleId: null });
    expect(own?.recordedSlugHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the model asked for beside the one that answered", async () => {
    const groups = await cube();
    const swapped = groups.filter((g) => g.answeredModel !== g.requestedModel);
    expect(swapped).toHaveLength(1);
    expect(swapped[0]).toMatchObject({
      requestedModel: "vendor/asked-for",
      answeredModel: "vendor/answered-instead",
      job: "chat",
      stepName: null,
      wire: "chat",
    });
  });

  it("separates failed money by outcome, and one day from the next", async () => {
    const groups = await cube();
    const failed = groups.filter((g) => g.outcome !== "ok");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ outcome: "error", calls: 1, creditsNanos: 7_000_000 });
    const nextDay = groups.filter((g) => g.day === "2033-05-11");
    expect(nextDay).toHaveLength(1);
    expect(nextDay[0]?.creditsNanos).toBe(9_000_000);
  });

  it("refuses, rather than truncates, past the cap", async () => {
    const all = await cube();
    const { SpendCubeTooLarge } = await import("../src/store/ai-calls-spend-pg.js");
    await expect(cube(ASKER, all.length - 1)).rejects.toBeInstanceOf(SpendCubeTooLarge);
    expect(await cube(ASKER, all.length)).toHaveLength(all.length);
  });
});
