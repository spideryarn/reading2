/**
 * The per-owner spend aggregate —
 * [src/store/ai-calls-spend-pg.ts](../src/store/ai-calls-spend-pg.ts).
 *
 * **The one assertion this file exists for** is that Postgres and
 * `totalRows()` agree about what a set of rows cost. They did not, until
 * 2026-09-02: `upstream_inference_nanos` was written on every chat-wire call
 * whether or not it was BYOK, so the obvious `SUM(credits) + SUM(upstream)` was
 * twice the truth — an auditor got $23.54 where the ledger meant $11.77 — and
 * the conditional that made a total right lived only in JavaScript. The column
 * was renamed and narrowed so that the naive SQL is finally the correct SQL, and
 * this is what stops the two drifting apart again.
 *
 * A held-against-each-other test rather than two separate expectations, because
 * a fixture's *expected* total is a third number written by hand and the bug
 * would be as easy to write there as in either implementation.
 *
 * Postgres-only, and it skips loudly without a database like every other `*-pg`
 * suite here.
 */

import { afterAll, describe, expect, it } from "vitest";

import type { AiCallRow } from "../src/ai-spend.js";
import { loadEnvLocal } from "../src/env.js";
import { totalRows } from "../src/store/ai-calls.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";
import { bareArticles, removeBareArticles } from "./helpers/bare-article.js";
import type { OwnerId } from "../src/owner.js";

loadEnvLocal();

/**
 * **The year 2031**, so these rows are in no window any other test or any real
 * report looks at.
 *
 * The alternative — filtering on the run id — is not available: the aggregate
 * groups by owner and takes a time range, which is the whole of its interface.
 * A date nothing else uses is what makes "sum the window" a statement about
 * this suite's fixtures rather than about whatever the dev ledger happens to
 * hold today.
 */
const SINCE = "2031-03-01T00:00:00.000Z";
const UNTIL = "2031-04-01T00:00:00.000Z";

const RUN = "00000000-0000-4000-8000-00000000d901";
const ALICE = "00000000-0000-4000-8000-00000000ad01";
const BOB = "00000000-0000-4000-8000-00000000ad02";
const SILENT_SESSION = "00000000-0000-4000-8000-00000000d911";
const REPORTED_SESSION = "00000000-0000-4000-8000-00000000d912";
const UNCONNECTED_SESSION = "00000000-0000-4000-8000-00000000d913";
const ARTICLE_SESSION_IDS = [SILENT_SESSION, REPORTED_SESSION, UNCONNECTED_SESSION];

function row(id: string, over: Partial<AiCallRow>): AiCallRow {
  return {
    id,
    runId: RUN,
    generationId: null,
    scopeKind: "job_step",
    ownerId: ALICE,
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
    startedAt: "2031-03-15T10:00:00.000Z",
    finishedAt: "2031-03-15T10:00:01.200Z",
    durationMs: 1200,
    outcome: "ok",
    creditsUsedNanos: 21_523_500,
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
    ...over,
  };
}

/**
 * **One of each of the four ways a row can carry money**, which is the set the
 * agreement has to hold over. Three of them are the exact cases that made the
 * naive SQL wrong before the rename, and the fourth is the one that makes a
 * total short rather than wrong.
 */
const FIXTURES: AiCallRow[] = [
  /* Ordinary settled OpenRouter call. */
  row("00000000-0000-4000-8000-00000000e001", {}),
  /* BYOK: OpenRouter's charge is legitimately zero and somebody else's key was
     billed for the inference. Both figures are real and they are different
     pockets. This is the row whose upstream figure used to be duplicated onto
     every non-BYOK row as well. */
  row("00000000-0000-4000-8000-00000000e002", {
    scopeKind: "request",
    job: "chat",
    stepName: null,
    wire: "chat",
    creditsUsedNanos: 0,
    byokUpstreamNanos: 5_000_000,
    isByok: true,
  }),
  /* Our own arithmetic, for a call that never went through OpenRouter. */
  row("00000000-0000-4000-8000-00000000e003", {
    ownerId: BOB,
    scopeKind: "eval",
    job: "eval",
    stepName: null,
    providerAccount: "anthropic",
    costSource: "computed",
    creditsUsedNanos: null,
    computedCostNanos: 3_000_000,
    priceVersion: "test",
  }),
  /* Happened, cost something, reported nothing. The total is short by an
     unknown amount, which is a different statement from "it was free". */
  row("00000000-0000-4000-8000-00000000e004", {
    scopeKind: "request",
    job: "chat",
    stepName: null,
    wire: "chat",
    costSource: "none",
    creditsUsedNanos: null,
  }),
  /* A dev CLI run. Real money and ours, not a reader's — the row the admin
     column has to leave out. */
  row("00000000-0000-4000-8000-00000000e005", {
    ownerId: BOB,
    scopeKind: "cli",
    stepName: null,
    creditsUsedNanos: 1_000_000,
  }),
  /* **BYOK, and OpenRouter reported no upstream figure.** `cost_source` is
     `provider` — their zero is an answer rather than an absence — so this row is
     settled AND unpriced at the same time, and `totalRows()` counts it as
     unpriced because the money it actually cost is missing. It is the one row
     that tells the SQL filter apart from the tempting shortcut
     `cost_source = 'none'`, which is why it is here. */
  row("00000000-0000-4000-8000-00000000e007", {
    scopeKind: "request",
    job: "chat",
    stepName: null,
    wire: "chat",
    creditsUsedNanos: 0,
    byokUpstreamNanos: null,
    isByok: true,
  }),
  /* **Exactly on the upper bound**, so the half-open rule has something to
     exclude. A row at `until` belongs to the next period; if both periods
     claimed it, a Stripe invoice would bill it twice. */
  row("00000000-0000-4000-8000-00000000e006", {
    startedAt: UNTIL,
    finishedAt: UNTIL,
    creditsUsedNanos: 999_000_000,
  }),
];

/**
 * **One article's rows, as the metadata page's admin section reads them** —
 * `spendForArticle`. In 2031 (and one in 2020), outside every window the
 * per-owner tests above ask about, so they change none of those counts.
 *
 * Alice owns a real article row with this slug, created when the suite runs.
 * The rows are written in two batches, and the order is the test:
 *
 * - `BEFORE_ARTICLE` is recorded **before the article row exists**, so
 *   `articleIdFor` resolves nothing and each row has the slug and no id. One is
 *   dated 2031 (after the article's creation — the fallback must include it);
 *   one is dated 2020 (a previous article under the same slug — the fallback
 *   must not).
 * - `AFTER_ARTICLE` is recorded once it exists, so Alice's rows carry its id.
 *   Bob's rows on the same slug do not (he does not own it) and must not count:
 *   the query is the owner's article, not every row that names the slug.
 */
const ARTICLE = "spend-fixture-article-a1";
const BEFORE_ARTICLE: AiCallRow[] = [
  /* Fell back to the slug, after the article was born: counted. */
  row("00000000-0000-4000-8000-00000000e106", {
    articleSlug: ARTICLE,
    job: "labels",
    startedAt: "2031-06-01T10:00:00.000Z",
    finishedAt: "2031-06-01T10:00:01.000Z",
    creditsUsedNanos: 3_000_000,
    outcome: "error",
  }),
  /* A previous article that had this slug and was deleted: not counted. */
  row("00000000-0000-4000-8000-00000000e107", {
    articleSlug: ARTICLE,
    startedAt: "2020-01-01T10:00:00.000Z",
    finishedAt: "2020-01-01T10:00:01.000Z",
    creditsUsedNanos: 800_000_000,
  }),
];
const AFTER_ARTICLE: AiCallRow[] = [
  row("00000000-0000-4000-8000-00000000e101", {
    articleSlug: ARTICLE,
    startedAt: "2031-06-02T10:00:00.000Z",
    finishedAt: "2031-06-02T10:00:01.000Z",
    creditsUsedNanos: 40_000_000,
  }),
  row("00000000-0000-4000-8000-00000000e102", {
    articleSlug: ARTICLE,
    job: "labels",
    startedAt: "2031-06-02T10:01:00.000Z",
    finishedAt: "2031-06-02T10:01:01.000Z",
    creditsUsedNanos: 7_000_000,
  }),
  row("00000000-0000-4000-8000-00000000e108", {
    articleSlug: ARTICLE,
    scopeKind: "request",
    job: "chat",
    stepName: null,
    wire: "chat",
    startedAt: "2031-06-03T09:00:00.000Z",
    finishedAt: "2031-06-03T09:00:02.000Z",
    creditsUsedNanos: 2_000_000,
  }),
  row("00000000-0000-4000-8000-00000000e109", {
    articleSlug: ARTICLE,
    scopeKind: "request",
    job: "chat",
    stepName: null,
    wire: "chat",
    costSource: "none",
    creditsUsedNanos: null,
    startedAt: "2031-06-04T09:00:00.000Z",
    finishedAt: "2031-06-04T09:00:02.000Z",
  }),
  /* Another account naming the same slug: not Alice's article, not counted. */
  row("00000000-0000-4000-8000-00000000e103", {
    ownerId: BOB,
    articleSlug: ARTICLE,
    scopeKind: "request",
    job: "chat",
    stepName: null,
    wire: "chat",
    startedAt: "2031-06-03T09:00:00.000Z",
    finishedAt: "2031-06-03T09:00:02.000Z",
    creditsUsedNanos: 90_000_000,
  }),
  /* A different article. */
  row("00000000-0000-4000-8000-00000000e105", {
    articleSlug: "spend-fixture-article-b2",
    startedAt: "2031-06-02T11:00:00.000Z",
    finishedAt: "2031-06-02T11:00:01.000Z",
    creditsUsedNanos: 500_000_000,
  }),
];
/** The rows the article's figure must be made of, and nothing else. */
const ARTICLE_ROWS = [
  ...BEFORE_ARTICLE.filter((r) => r.startedAt > "2031"),
  ...AFTER_ARTICLE.filter((r) => r.articleSlug === ARTICLE && r.ownerId === ALICE),
];

/** Everything the window should see — the last fixture is outside it. */
const IN_WINDOW = FIXTURES.filter((r) => r.startedAt < UNTIL);

await pgReady({
  suite: "tests/ai-calls-spend-pg.test.ts",
  tables: ["spideryarn.ai_calls"],
  /* The column the whole agreement rests on. A database one migration behind
     would otherwise fail with a bare `42703 column does not exist`, which says
     nothing about what to run. */
  columns: [{ table: "spideryarn.ai_calls", column: "byok_upstream_nanos" }],
  max: 3,
});

describe("the per-owner spend aggregate", () => {
  afterAll(async () => {
    const { getDb, closeDb } = await import("../src/db/client.js");
    const { aiCalls, realtimeSessions } = await import("../src/db/schema.js");
    const { inArray } = await import("drizzle-orm");
    /* The ledger rows only. The two seeded accounts stay: `ai_calls.owner_id`
       is `ON DELETE RESTRICT` on purpose so that billing history survives a
       customer deletion, and a suite that fought that would be fighting the
       thing the column is for. */
    await getDb().delete(aiCalls).where(inArray(aiCalls.runId, [RUN, REPORTED_SESSION]));
    await getDb().delete(realtimeSessions).where(inArray(realtimeSessions.id, ARTICLE_SESSION_IDS));
    await removeBareArticles([ARTICLE], ALICE as OwnerId);
    await closeDb();
  });

  /* Written once, because every test below reads the same rows and
     re-inserting them per test would be round trips for nothing.
     `onConflictDoNothing` on the id makes a re-run harmless.

     **The two accounts have to exist first.** `ai_calls.owner_id` carries a
     foreign key into `auth.users`, which is the schema saying a bill belongs to
     somebody — so a fixture owner id invented here is rejected rather than
     silently orphaned.

     **And the article rows go in on either side of the article's birth** —
     see `BEFORE_ARTICLE`. */
  const written = (async () => {
    const { getDb } = await import("../src/db/client.js");
    const { pgCostStore } = await import("../src/store/ai-calls-pg.js");
    await seedAuthUser(getDb(), {
      id: ALICE,
      email: "spend-alice@spideryarn.local",
      onConflictDoNothing: true,
    });
    await seedAuthUser(getDb(), {
      id: BOB,
      email: "spend-bob@spideryarn.local",
      onConflictDoNothing: true,
    });
    /* A previous run's article would give the "before" rows an id. */
    await removeBareArticles([ARTICLE], ALICE as OwnerId);
    for (const fixture of [...FIXTURES, ...BEFORE_ARTICLE]) await pgCostStore.record(fixture);
    await bareArticles([ARTICLE], ALICE as OwnerId);
    for (const fixture of AFTER_ARTICLE) await pgCostStore.record(fixture);
  })();

  /** Alice's article as the route establishes it — id and birth from the row. */
  async function theArticle() {
    await written;
    const { getDb } = await import("../src/db/client.js");
    const { articles } = await import("../src/db/schema.js");
    const { and, eq } = await import("drizzle-orm");
    const [found] = await getDb()
      .select({ id: articles.id, createdAt: articles.createdAt })
      .from(articles)
      .where(and(eq(articles.slug, ARTICLE), eq(articles.ownerId, ALICE)));
    if (!found) throw new Error("the fixture article was not created");
    return { ...found, slug: ARTICLE, ownerId: ALICE };
  }

  it("totals the owner's article, and not another account's rows under its slug", async () => {
    const { spendForArticle } = await import("../src/store/ai-calls-spend-pg.js");
    const groups = await spendForArticle(await theArticle());
    const js = totalRows(ARTICLE_ROWS);
    const sql = groups.reduce(
      (acc, g) => ({
        credits: acc.credits + g.creditsNanos,
        byok: acc.byok + g.byokNanos,
        computed: acc.computed + g.computedNanos,
        calls: acc.calls + g.calls,
        unpriced: acc.unpriced + g.unpricedCalls,
        nonOk: acc.nonOk + g.nonOkCalls,
      }),
      { credits: 0, byok: 0, computed: 0, calls: 0, unpriced: 0, nonOk: 0 },
    );
    /* Held against `totalRows()` over the rows that should count, as the
       per-owner test above is — and against a hand figure too, because Bob's
       $0.09, the old article's $0.80 or the other slug's $0.50 leaking in would
       move both. */
    expect(sql.credits).toBe(js.credits);
    expect(sql.byok).toBe(js.upstream);
    expect(sql.computed).toBe(js.computed);
    expect(sql.unpriced).toBe(js.unpriced);
    expect(sql.calls).toBe(5);
    expect(sql.credits).toBe(3_000_000 + 40_000_000 + 7_000_000 + 2_000_000);
    expect(sql.unpriced).toBe(1);
    expect(sql.nonOk).toBe(1);
  });

  it("does not inherit a deleted article's rows through a reused slug", async () => {
    const { spendForArticle } = await import("../src/store/ai-calls-spend-pg.js");
    const groups = await spendForArticle(await theArticle());
    /* The 2020 row has the slug, Alice as owner and no id — everything but a
       date after this article's birth. */
    expect(groups.every((g) => g.firstAt.getUTCFullYear() === 2031)).toBe(true);
  });

  it("splits one article by step and job, so a mode is a line of its own", async () => {
    const { spendForArticle } = await import("../src/store/ai-calls-spend-pg.js");
    const groups = await spendForArticle(await theArticle());
    const key = (g: { scopeKind: string; job: string; stepName: string | null }) =>
      `${g.scopeKind}/${g.job}/${g.stepName ?? "-"}`;
    expect(groups.map(key).sort()).toEqual([
      "job_step/labels/structure",
      "job_step/structure/structure",
      "request/chat/-",
    ]);
    const chat = groups.find((g) => g.job === "chat");
    /* Two chat turns are one line, one of them unpriced. */
    expect(chat).toMatchObject({ calls: 2, creditsNanos: 2_000_000, unpricedCalls: 1 });
    expect(chat?.firstAt.toISOString()).toBe("2031-06-03T09:00:00.000Z");
    expect(chat?.lastAt.toISOString()).toBe("2031-06-04T09:00:00.000Z");
    /* The labels line joins the id-keyed row and the slug-fallback one. */
    expect(groups.find((g) => g.job === "labels")).toMatchObject({
      calls: 2,
      creditsNanos: 10_000_000,
      nonOkCalls: 1,
    });
    for (const g of groups) expect(typeof g.creditsNanos).toBe("number");
  });

  it("answers an article nobody has spent on with no lines, not an error", async () => {
    const { spendForArticle } = await import("../src/store/ai-calls-spend-pg.js");
    const article = await theArticle();
    expect(
      await spendForArticle({
        ...article,
        id: "00000000-0000-4000-8000-00000068a0ff",
        slug: "spend-fixture-article-never",
      }),
    ).toEqual([]);
  });

  it("counts only connected live sessions on the article that left no usage row", async () => {
    const article = await theArticle();
    const { getDb } = await import("../src/db/client.js");
    const { realtimeSessions } = await import("../src/db/schema.js");
    const { acceptRealtimeUsage } = await import("../src/live.js");
    const { pgCostStore } = await import("../src/store/ai-calls-pg.js");
    const { silentLiveSessionsForArticle } = await import(
      "../src/store/ai-calls-spend-pg.js"
    );
    const issuedAt = "2031-06-05T10:00:00.000Z";
    const connectedAt = "2031-06-05T10:00:01.000Z";
    const acceptsUntil = "2031-06-06T10:00:00.000Z";
    const session = (id: string, connected: string | null) => ({
      id,
      ownerId: ALICE,
      articleId: article.id,
      articleSlug: ARTICLE,
      threadId: null,
      model: "gpt-realtime-2.1",
      transcriptionModel: "gpt-live-transcribe",
      issuedAt: new Date(issuedAt),
      acceptsUntil: new Date(acceptsUntil),
      connectedAt: connected ? new Date(connected) : null,
      closedAt: null,
      closeReason: null,
    });
    await getDb()
      .insert(realtimeSessions)
      .values([
        session(SILENT_SESSION, connectedAt),
        session(REPORTED_SESSION, connectedAt),
        session(UNCONNECTED_SESSION, null),
      ])
      .onConflictDoNothing();

    /* One connected session really did report. Build its row through the same
       trust-boundary function as the route, so the fixture obeys every
       realtime CHECK rather than hand-copying that evolving shape. */
    await pgCostStore.record(
      acceptRealtimeUsage({
        session: {
          id: REPORTED_SESSION,
          ownerId: ALICE,
          articleSlug: ARTICLE,
          threadId: null,
          model: "gpt-realtime-2.1",
          transcriptionModel: "gpt-live-transcribe",
          issuedAt,
          acceptsUntil,
          connectedAt,
          closedAt: null,
          closeReason: null,
        },
        usage: {
          kind: "transcription",
          providerEventId: "transcription-for-article-cost-test",
          startedAt: null,
          finishedAt: "2031-06-05T10:00:02.000Z",
          audioSeconds: 1,
        },
        receivedAt: new Date("2031-06-05T10:00:03.000Z"),
      }),
    );

    expect(await silentLiveSessionsForArticle(article)).toBe(1);
  });

  it("agrees with totalRows() about what the same rows cost", async () => {
    await written;
    const { spendGroupedByOwner } = await import("../src/store/ai-calls-spend-pg.js");
    const groups = await spendGroupedByOwner(SINCE, UNTIL);

    const sql = groups.reduce(
      (acc, g) => ({
        credits: acc.credits + g.creditsNanos,
        byok: acc.byok + g.byokNanos,
        computed: acc.computed + g.computedNanos,
        calls: acc.calls + g.calls,
      }),
      { credits: 0, byok: 0, computed: 0, calls: 0 },
    );
    const js = totalRows(IN_WINDOW);

    /* Pocket by pocket, not just the grand total: two errors in opposite
       directions cancel in a single number, and the whole reason these are
       three columns is that they are three different kinds of fact. */
    expect(sql.credits).toBe(js.credits);
    expect(sql.byok).toBe(js.upstream);
    expect(sql.computed).toBe(js.computed);
    expect(sql.calls).toBe(IN_WINDOW.length);

    /* And the sum, which is the expression anybody writing their own query will
       reach for. This is the assertion that would have caught the double-count:
       before the rename it came out at twice `js`. */
    expect(sql.credits + sql.byok + sql.computed).toBe(js.credits + js.upstream + js.computed);
  });

  it("agrees with totalRows() about how many rows reported no money", async () => {
    await written;
    const { spendGroupedByOwner } = await import("../src/store/ai-calls-spend-pg.js");
    const groups = await spendGroupedByOwner(SINCE, UNTIL);
    const unpriced = groups.reduce((n, g) => n + g.unpricedCalls, 0);
    /* A per-owner figure that cannot say it is short is false precision — GPT
       Sol's wording. The SQL `filter` is a restatement of `totalRows()`'s
       branching, and restatements drift. */
    expect(unpriced).toBe(totalRows(IN_WINDOW).unpriced);
    /* Two, not one. The obvious `cost_source = 'none'` would say one and look
       entirely right — the BYOK row above is settled and unpriced at once, and
       a report that missed it would understate how much of itself it cannot
       see, which is the one direction that matters. */
    expect(unpriced).toBe(2);
  });

  it("keeps the range half-open, so two periods cannot both bill one call", async () => {
    await written;
    const { spendGroupedByOwner } = await import("../src/store/ai-calls-spend-pg.js");
    const inside = await spendGroupedByOwner(SINCE, UNTIL);
    const next = await spendGroupedByOwner(UNTIL, "2031-05-01T00:00:00.000Z");
    const money = (gs: { creditsNanos: number }[]) => gs.reduce((n, g) => n + g.creditsNanos, 0);
    /* The $0.999 row sits exactly on the boundary and must appear in the second
       period only. Getting this wrong is invisible in any single report — both
       months look plausible, and only the invoice is wrong. */
    expect(money(inside)).toBe(21_523_500 + 0 + 1_000_000);
    expect(money(next)).toBe(999_000_000);
    expect(inside.reduce((n, g) => n + g.calls, 0)).toBe(IN_WINDOW.length);
  });

  it("gives each owner their own money and nobody else's", async () => {
    await written;
    const { spendGroupedByOwner } = await import("../src/store/ai-calls-spend-pg.js");
    const groups = await spendGroupedByOwner(SINCE, UNTIL);
    const mine = (owner: string) =>
      groups
        .filter((g) => g.ownerId === owner)
        .reduce((n, g) => n + g.creditsNanos + g.byokNanos + g.computedNanos, 0);
    expect(mine(ALICE)).toBe(21_523_500 + 5_000_000);
    expect(mine(BOB)).toBe(3_000_000 + 1_000_000);
  });

  it("keeps the four provenance keys, so a category can be derived from them", async () => {
    await written;
    const { spendGroupedByOwner } = await import("../src/store/ai-calls-spend-pg.js");
    const groups = await spendGroupedByOwner(SINCE, UNTIL);
    /* The grouping is `(owner, scope, job, step)` rather than `(owner,
       category)` on purpose — the naming is a judgement about what the schema
       can honestly claim and belongs where a unit test can reach it. If the
       group ever loses one of these keys, categorisation silently coarsens. */
    const chat = groups.find((g) => g.job === "chat" && g.ownerId === ALICE && g.byokNanos > 0);
    expect(chat).toMatchObject({ scopeKind: "request", job: "chat", stepName: null });
  });

  it("leaves eval and CLI spend out of the per-account figure the admin page shows", async () => {
    await written;
    const { productSpendByOwner } = await import("../src/store/ai-calls-spend-pg.js");
    const spend = await productSpendByOwner(SINCE, UNTIL);
    /* Bob's only rows in this window are one eval and one CLI run — both ours
       rather than a reader's. On a per-account page they would draw whoever's
       owner id the environment was carrying as costing far more than anybody
       else, which is a number that would be believed. */
    expect(spend.get(BOB)).toBeUndefined();
    expect(spend.get(ALICE)).toMatchObject({
      nanos: 21_523_500 + 5_000_000,
      calls: 4,
      unpricedCalls: 2,
    });
  });

  it("hands nano-dollars back as numbers, not as the strings node-pg would give", async () => {
    await written;
    const { spendGroupedByOwner } = await import("../src/store/ai-calls-spend-pg.js");
    const groups = await spendGroupedByOwner(SINCE, UNTIL);
    /* `sum()` is `numeric` and `count()` is `bigint`, and node-postgres hands
       both back as **strings** so that precision cannot be lost. Without
       `.mapWith(Number)` every figure here would concatenate under `+` and sort
       "10" below "9" — a per-owner bill that is wrong in a way no type catches.
       Asserting the type rather than the value is the only way to see it. */
    for (const g of groups) {
      expect(typeof g.creditsNanos).toBe("number");
      expect(typeof g.byokNanos).toBe("number");
      expect(typeof g.computedNanos).toBe("number");
      expect(typeof g.calls).toBe("number");
      expect(typeof g.unpricedCalls).toBe("number");
    }
  });

  it("names the credential every row was paid on", async () => {
    await written;
    const { credentialsInWindow } = await import("../src/store/ai-calls-spend-pg.js");
    const tallies = await credentialsInWindow(SINCE, UNTIL);
    const mine = tallies.find((t) => t.fingerprint === "abcdef012345");
    expect(mine?.calls).toBe(IN_WINDOW.length);
    /* Credits only. OpenRouter's `/api/v1/key` has no opinion about a BYOK row
       or one that never reached them, so including either would guarantee a gap
       that is nobody's fault — and a difference that is always non-zero for a
       reason nobody names is a check everybody learns to ignore. */
    expect(mine?.creditsNanos).toBe(21_523_500 + 0 + 1_000_000);
  });

  it("splits the window by which BILL each row lands on, not just which key", async () => {
    /* `credentialsInWindow` above tallies one fingerprint across all six rows,
       including the Anthropic one — which is precisely why it cannot answer
       "what is on the OpenRouter account". The fixtures carry two accounts and
       one key, so the two functions must disagree, and this is the disagreement
       that matters since Greg declined a per-reader cap on 2026-09-06 and left a
       single OpenRouter ceiling as the only control. */
    await written;
    const { accountsInWindow } = await import("../src/store/ai-calls-spend-pg.js");
    const bills = await accountsInWindow(SINCE, UNTIL);

    const openrouter = bills.find((b) => b.account === "openrouter");
    const anthropic = bills.find((b) => b.account === "anthropic");
    expect(openrouter?.calls).toBe(5);
    expect(anthropic?.calls).toBe(1);
    /* Five OpenRouter rows: the ordinary settled one, the CLI one, two BYOK
       zeroes and one that reported nothing. */
    expect(openrouter?.creditsNanos).toBe(21_523_500 + 1_000_000);
    expect(openrouter?.byokNanos).toBe(5_000_000);
    expect(openrouter?.computedNanos).toBe(0);
    expect(anthropic?.computedNanos).toBe(3_000_000);
    /* Every row is on the one key, so the credential tally sees six and cannot
       tell these apart. That is the whole point of the new query. */
    expect(bills.reduce((n, b) => n + b.calls, 0)).toBe(IN_WINDOW.length);
  });

  it("counts BYOK money as outside the cap even though its row says openrouter", async () => {
    /* **The trap GPT Sol named (F3), and the reason the report groups by account
       AND pocket rather than by account alone.** A BYOK row carries
       `provider_account = 'openrouter'` while `byok_upstream_nanos` was charged
       to somebody else's key entirely. Grouping by account and calling
       everything under `openrouter` "capped" would therefore be wrong on our
       largest non-OpenRouter pocket — and wrong in the reassuring direction. */
    await written;
    const { accountsInWindow } = await import("../src/store/ai-calls-spend-pg.js");
    const bills = await accountsInWindow(SINCE, UNTIL);
    const outside = bills.reduce(
      (sum, b) =>
        sum + b.byokNanos + (b.account === "openrouter" ? 0 : b.creditsNanos + b.computedNanos),
      0,
    );
    /* $0.005 of BYOK sitting on an openrouter row, plus $0.003 of Anthropic. */
    expect(outside).toBe(5_000_000 + 3_000_000);
    /* And it is NOT the same as "everything not on the openrouter account",
       which is the shortcut this test exists to refuse. */
    const naive = bills
      .filter((b) => b.account !== "openrouter")
      .reduce((sum, b) => sum + b.creditsNanos + b.byokNanos + b.computedNanos, 0);
    expect(naive).toBe(3_000_000);
    expect(naive).not.toBe(outside);
  });
});

describe("the reporting period the admin column and the CLI share", () => {
  it("is the current UTC month, half-open", async () => {
    const { currentUtcMonth } = await import("../src/store/ai-calls-spend-pg.js");
    const month = currentUtcMonth();
    const since = new Date(month.since);
    const until = new Date(month.until);
    expect(since.getUTCDate()).toBe(1);
    expect(since.getUTCHours()).toBe(0);
    expect(until.getUTCDate()).toBe(1);
    expect(until.getTime()).toBeGreaterThan(since.getTime());
    expect(month.label).toBe(
      `${since.getUTCFullYear()}-${String(since.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  });

  it("is the same period npm run cost defaults to", async () => {
    /* The admin column is headed with a month and the CLI reports one, and if
       the two ever named different windows the discrepancy would be argued
       about for an hour before anybody suspected the boundary. One definition;
       this is the line that keeps it one. */
    const { currentUtcMonth } = await import("../src/store/ai-calls-spend-pg.js");
    const { parseArgs } = await import("../scripts/ai-cost.js");
    const args = parseArgs([]);
    expect(args.since).toBe(currentUtcMonth().since);
    expect(args.until).toBe(currentUtcMonth().until);
  });
});
