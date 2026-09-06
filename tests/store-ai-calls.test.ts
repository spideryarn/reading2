/**
 * The ledger — [ai-calls-pg.ts](../src/store/ai-calls-pg.ts) — and the pure
 * arithmetic over its rows, `totalRows` in
 * [ai-calls.ts](../src/store/ai-calls.ts).
 *
 * A second, filesystem ledger stood beside it until 2026-09-05 and this file
 * drove both. Its half is gone with the module; what it was the only home for
 * is recorded in
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md.
 *
 * **What this file is really for is the round trip**, and one assertion inside
 * it. `credits_used_nanos` is an `int8`, and `node-pg` hands `int8` back as a
 * *string* — src/db/schema.ts warns about that twice, in two other columns'
 * comments, because it has bitten this project before. A `"21523500"` where a
 * number belongs does not throw: it concatenates in the next `+`, and the total
 * is wrong in a way that looks like a very expensive month. So the check is that
 * what comes back is a `number`, not merely that it is truthy.
 *
 * A database this suite cannot use is a failure, not a skip — see
 * tests/helpers/pg-ready.ts.
 */

import { afterAll, describe, expect, it } from "vitest";

import type { AiCallRow } from "../src/ai-spend.js";
import { loadEnvLocal } from "../src/env.js";
import { totalRows } from "../src/store/ai-calls.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/** A plausible finished call. Override whatever the test is about. */
function row(over: Partial<AiCallRow> = {}): AiCallRow {
  return {
    id: "00000000-0000-4000-8000-00000000a001",
    runId: "00000000-0000-4000-8000-00000000b001",
    generationId: "gen-1787844432-JKwGQebcNXfkCfTX5mUq",
    scopeKind: "job_step",
    ownerId: "00000000-0000-4000-8000-00000000ac01",
    articleSlug: "a-slug",
    jobId: "job-7",
    stepName: "hierarchy",
    wire: "messages",
    job: "hierarchy",
    requestedModel: "anthropic/claude-sonnet-5",
    answeredModel: "anthropic/claude-sonnet-5",
    upstream: "Anthropic",
    providerAccount: "openrouter",
    costSource: "provider",
    computedCostNanos: null,
    priceVersion: null,
    credentialFingerprint: "abcdef012345",
    startedAt: "2026-08-15T10:00:00.000Z",
    finishedAt: "2026-08-15T10:00:01.200Z",
    durationMs: 1200,
    outcome: "ok",
    creditsUsedNanos: 21_523_500,
    /* **Null, because this row is not BYOK.** It carried the credits figure a
       second time until 2026-09-02, which is exactly the shape that made
       `SUM(credits) + SUM(upstream)` twice the truth — and it is now refused by
       `ai_calls_byok_upstream_only`, so a fixture in the old shape would not
       reach Postgres at all. */
    byokUpstreamNanos: null,
    isByok: false,
    reportedInputTokens: 13,
    outputTokens: 4,
    cacheReadTokens: 0,
    cacheWriteTokens: 8583,
    cacheWrite5mTokens: 8583,
    cacheWrite1hTokens: 0,
    reasoningTokens: 0,
    webSearches: null,
    serviceTier: "standard",
    inferenceGeo: null,
    /* **The realtime block, null because this is a chat-wire row.** Spelled out
       rather than spread from a helper, so that a field arriving on `AiCallRow`
       makes this fixture fail to compile and somebody decides what it means for
       an ordinary call — which is how these twelve got here.
       drizzle/20260902150952_realtime_sessions_and_usage.sql. */
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

/* ------------------------------------------------------------ the sums -- */

describe("totalRows", () => {
  it("keeps our own arithmetic in its own pocket, and out of `unpriced`", () => {
    /* A declared bypass does not go through OpenRouter, so there is nobody to
       ask what it cost and the figure is ours. Two things must not happen to
       it: being added to `credits`, which is the number `--reconcile` compares
       against OpenRouter's own running total and would then never match; and
       being counted as `unpriced`, which it is the opposite of. */
    const t = totalRows([
      row(),
      row({
        costSource: "computed",
        creditsUsedNanos: null,
        computedCostNanos: 7_000_000,
        providerAccount: "anthropic",
        priceVersion: "claude-sonnet-5@2026-08-01",
      }),
    ]);
    expect(t.credits).toBe(21_523_500);
    expect(t.computed).toBe(7_000_000);
    expect(t.unpriced).toBe(0);
  });

  it("counts a declared call that reported nothing at all as unpriced", () => {
    /* `cost_source: "none"` — the call happened, it may well have been billed,
       and we cannot say for how much. Distinct from `computed`. */
    const t = totalRows([
      row({ costSource: "none", creditsUsedNanos: null, computedCostNanos: null }),
    ]);
    expect(t.credits).toBe(0);
    expect(t.computed).toBe(0);
    expect(t.unpriced).toBe(1);
  });

  it("counts a call that reported nothing as unpriced rather than as free", () => {
    const t = totalRows([row(), row({ creditsUsedNanos: null })]);
    expect(t.credits).toBe(21_523_500);
    expect(t.unpriced).toBe(1);
  });

  it("keeps BYOK money, which is a zero that is not free", () => {
    /* Under somebody else's key OpenRouter's own charge is legitimately `0`
       while the inference was billed upstream. Summed naively that call
       contributes nothing and `unpriced` stays zero, so the total reads correct
       while missing real money. */
    const t = totalRows([
      row({ isByok: true, creditsUsedNanos: 0, byokUpstreamNanos: 9_000_000 }),
    ]);
    expect(t.upstream).toBe(9_000_000);
    expect(t.unpriced).toBe(0);
    expect(t.credits).toBe(0);
  });

  it("counts a BYOK call with no upstream figure as unpriced, not as zero", () => {
    const t = totalRows([
      row({ isByok: true, creditsUsedNanos: 0, byokUpstreamNanos: null }),
    ]);
    expect(t.unpriced).toBe(1);
    expect(t.upstream).toBe(0);
  });

  it("keeps a failed BYOK call's money, which a credits-only total prints as zero", () => {
    /* The report's "having spent at least $x" line took `credits` alone, so a
       failed BYOK call that cost real money upstream printed `$0.0000` — the
       same zero-that-is-not-free the whole ledger is arranged against, put back
       at the last step. GPT Sol. The fix is in the caller; this pins what the
       caller has to add. */
    const failed = totalRows([
      row({ outcome: "error", isByok: true, creditsUsedNanos: 0, byokUpstreamNanos: 10_000_000 }),
    ]);
    expect(failed.credits + failed.upstream).toBe(10_000_000);
    expect(failed.credits).toBe(0);
  });

  it("does not add the two pockets together on an ordinary call", () => {
    /* On a non-BYOK call `cost` and `upstream_inference_cost` are the same money
       — measured equal to seven decimal places on 2026-08-27 — so adding both
       would double every bill. Since the rename a stored row cannot carry the
       duplicate, but this stays the last line of defence: `totalRows` is handed
       `AiCallRow`s from a hand-written JSONL line as well as from Postgres. */
    const t = totalRows([row({ byokUpstreamNanos: 21_523_500 })]);
    expect(t.credits + t.upstream).toBe(21_523_500);
    expect(t.upstream).toBe(0);
  });

  /**
   * **The obvious SQL sum, written in JS.**
   *
   * `COALESCE(credits_used_nanos,0) + COALESCE(byok_upstream_nanos,0) +
   * COALESCE(computed_cost_nanos,0)` is what anybody writing a per-owner
   * monthly aggregate for Stripe will write, because it is the only expression
   * the schema suggests. Before the rename it was double the truth on every
   * non-BYOK row. The Postgres half of this file runs the same expression as
   * real SQL; this is the arithmetic on its own, with no database needed.
   */
  const naive = (rows: readonly AiCallRow[]): number =>
    rows.reduce(
      (n, r) =>
        n + (r.creditsUsedNanos ?? 0) + (r.byokUpstreamNanos ?? 0) + (r.computedCostNanos ?? 0),
      0,
    );

  it("agrees with the obvious sum over provider, BYOK, computed and unpriced rows", () => {
    const rows = [
      row({ creditsUsedNanos: 1_000 }),
      row({ isByok: true, creditsUsedNanos: 0, byokUpstreamNanos: 9_000_000 }),
      row({
        costSource: "computed",
        creditsUsedNanos: null,
        computedCostNanos: 7_000,
        providerAccount: "anthropic",
        priceVersion: "claude-sonnet-5@2026-08-01",
      }),
      row({ costSource: "none", creditsUsedNanos: null }),
    ];
    const t = totalRows(rows);
    expect(t.credits + t.upstream + t.computed).toBe(naive(rows));
    /* And the unpriced row is a *count*, not a zero folded into the money — the
       total above is short by an unknown amount and something has to say so. */
    expect(t.unpriced).toBe(1);
  });

  it("would have doubled the total on a row in the pre-rename shape", () => {
    /* **The defect, reproduced.** Until 2026-09-02 an ordinary chat-wire row
       carried OpenRouter's `cost_details.upstream_inference_cost` — equal to
       `cost` — in this column, so the obvious sum counted the same money twice.
       `totalRows` was right because of a conditional that existed nowhere but
       in it. This is what the rename, the backfill and the CHECK removed, kept
       as an executable statement of what "wrong" looked like. */
    const preRename = [row({ byokUpstreamNanos: 21_523_500 })];
    expect(naive(preRename)).toBe(2 * 21_523_500);
    const t = totalRows(preRename);
    expect(t.credits + t.upstream + t.computed).toBe(21_523_500);
  });
});

/* ------------------------------------------------------ the Postgres store -- */

/* Both, and in that order. The table has existed since 0000 with a different
   shape, so a probe that only asks whether it exists would let this suite run
   against the old columns and fail in a way that reads like a bug in the
   store.

   **Two columns are asked for, not `credits_used_nanos`, and both are named
   for the same reason.** `byok_upstream_nanos` is what three of the tests below
   are actually about (drizzle/20260902141103). `realtime_session_id` is not
   the subject of any of them — it is named because `pgCostStore.record` writes
   every column of `AiCallRow`, so a database that has the first migration and
   not drizzle/20260902150952 fails these tests with a bare `42703 column does
   not exist` from inside the store, which says nothing about what to do.
   Watched doing exactly that on 2026-09-02, in the window where a peer had
   applied one of the two and not the other.

   A probe that names only the columns a suite *asserts on* is therefore too
   narrow: what it has to cover is every column the code under test will touch.
   See tests/helpers/pg-ready.ts. */
await pgReady({
  suite: "tests/store-ai-calls.test.ts",
  tables: ["spideryarn.ai_calls"],
  columns: [
    { table: "spideryarn.ai_calls", column: "byok_upstream_nanos" },
    { table: "spideryarn.ai_calls", column: "realtime_session_id" },
  ],
  max: 4,
});

describe("the Postgres ledger", () => {
  const RUN = "00000000-0000-4000-8000-00000000c001";
  /**
   * A second run id for the money tests, so the sum below counts its own four
   * fixtures and nothing the two round-trip tests above happen to have left.
   *
   * **The cleanup below is a belt, and the braces are the lane.** It was
   * written when these were the only tests reaching a real `ai_calls` table:
   * from 2026-09-02 `costStore` handed the *filesystem* store to anything under
   * the test harness, and this file deliberately went round that by importing
   * `pgCostStore` directly, because a Postgres CHECK is not something a JSONL
   * file can prove. It paid for that by having to tidy up after itself.
   *
   * Since stage C, 2026-09-05, this file runs in the `private-postgres` lane
   * against a database minted for the run and dropped after it, so there is
   * nothing left to tidy. The delete stays: it is two lines, it makes the file
   * runnable against any database somebody points it at, and a cleanup that has
   * become unnecessary is cheaper than one that turns out not to have been.
   */
  const MONEY = "00000000-0000-4000-8000-00000000c002";
  /**
   * A third, for the two cases at the foot of this block.
   *
   * Its own id for the same reason `MONEY` has one: those two count their own
   * fixtures, and a row from a round-trip test above landing in the window or
   * on the job id would make them pass for the wrong reason.
   */
  const RANGE = "00000000-0000-4000-8000-00000000c003";

  afterAll(async () => {
    const { getDb, closeDb } = await import("../src/db/client.js");
    const { aiCalls } = await import("../src/db/schema.js");
    const { inArray } = await import("drizzle-orm");
    await getDb().delete(aiCalls).where(inArray(aiCalls.runId, [RUN, MONEY, RANGE]));
    await closeDb();
  });

  it("hands nano-dollars back as a number, not as the string node-pg would give", async () => {
    const { pgCostStore } = await import("../src/store/ai-calls-pg.js");
    const { currentOwnerId } = await import("../src/owner.js");
    const written = row({
      id: "00000000-0000-4000-8000-00000000a101",
      runId: RUN,
      ownerId: currentOwnerId(),
      /* Deliberately over `int4`'s ceiling — $2.15 in nano-dollars — so a column
         that quietly went back to `integer` fails here rather than in a month
         with a big bill in it. */
      creditsUsedNanos: 9_000_000_000,
      /* A slug nothing owns, so `article_id` comes back null and the row is
         still written. That is the designed behaviour: the slug is the
         historical fact and the id is the convenience. */
      articleSlug: "no-such-article-here",
    });
    await pgCostStore.record(written);
    const { rows } = await pgCostStore.read();
    const found = rows.find((r) => r.id === written.id);
    expect(found?.creditsUsedNanos).toBe(9_000_000_000);
    expect(typeof found?.creditsUsedNanos).toBe("number");
    expect(found?.articleSlug).toBe("no-such-article-here");
    expect(found?.cacheWrite5mTokens).toBe(8583);
  });

  it("refuses a non-BYOK row that carries a BYOK upstream figure", async () => {
    /* **The constraint, watched doing its job.** `byok_upstream_nanos` was
       written on every chat-wire call until 2026-09-02 — OpenRouter reports
       `cost_details.upstream_inference_cost` equal to `cost` on an ordinary
       call — so the column held the same money as `credits_used_nanos` and the
       obvious `SUM(a) + SUM(b)` was double the truth. The rule that made a
       total correct lived only in `totalRows()`, in TypeScript, where the next
       person writing SQL for Stripe would never see it.

       An earlier draft of this plan proposed proving the fix by *computing a
       total the wrong way and watching the constraint catch it*, which cannot
       work: a CHECK does not inspect a SELECT. GPT Sol said so, and this is
       what it asked for instead. */
    const { pgCostStore } = await import("../src/store/ai-calls-pg.js");
    const { currentOwnerId } = await import("../src/owner.js");
    const bad = row({
      id: "00000000-0000-4000-8000-00000000a103",
      runId: MONEY,
      ownerId: currentOwnerId(),
      articleSlug: null,
      isByok: false,
      byokUpstreamNanos: 21_523_500,
    });
    /* **Asserted on the driver error, not on the message.** drizzle wraps a
       rejection as `Failed query: insert into …` with the whole column list in
       it, so a `toThrow(/ai_calls_byok_upstream_only/)` fails against a write
       the constraint *did* refuse — which is a test that goes red while the
       schema is right, the most misleading way for this one to fail. `pg` puts
       the name on `constraint`, one link down the `cause` chain. */
    const refused = await pgCostStore.record(bad).then(
      () => null,
      (e: unknown) => e,
    );
    expect(refused, "the constraint let a non-BYOK upstream figure through").not.toBeNull();
    const names: string[] = [];
    for (let e = refused; e instanceof Error; e = e.cause) {
      const named = (e as { constraint?: unknown }).constraint;
      if (typeof named === "string") names.push(named);
    }
    expect(names).toContain("ai_calls_byok_upstream_only");
  });

  it("adds up the same way in SQL as totalRows does in JavaScript", async () => {
    /* **The assertion the whole rename exists for.** `COALESCE(credits,0) +
       COALESCE(byok_upstream,0) + COALESCE(computed,0)` is the expression
       anybody writing a per-owner monthly aggregate will write, because it is
       the only one the schema suggests. It has to be right on every kind of
       row, so all four are here: a settled provider figure, a BYOK call whose
       OpenRouter charge is legitimately zero, one of our own computed bypass
       figures, and a call that reported no money at all.

       Real SQL rather than the JS restatement in the `totalRows` block above,
       because the point is that the *database* now supports the naive query. */
    const { pgCostStore } = await import("../src/store/ai-calls-pg.js");
    const { currentOwnerId } = await import("../src/owner.js");
    const { getDb } = await import("../src/db/client.js");
    const { sql } = await import("drizzle-orm");
    const owner = currentOwnerId();
    const base = { runId: MONEY, ownerId: owner, articleSlug: null };
    const fixtures = [
      row({ ...base, id: "00000000-0000-4000-8000-00000000a201", creditsUsedNanos: 1_000 }),
      row({
        ...base,
        id: "00000000-0000-4000-8000-00000000a202",
        isByok: true,
        creditsUsedNanos: 0,
        byokUpstreamNanos: 9_000_000,
      }),
      row({
        ...base,
        id: "00000000-0000-4000-8000-00000000a203",
        providerAccount: "anthropic",
        costSource: "computed",
        creditsUsedNanos: null,
        computedCostNanos: 7_000,
        priceVersion: "claude-sonnet-5@2026-08-01",
      }),
      row({
        ...base,
        id: "00000000-0000-4000-8000-00000000a204",
        costSource: "none",
        creditsUsedNanos: null,
      }),
    ];
    for (const f of fixtures) await pgCostStore.record(f);

    const answer = await getDb().execute(sql`
      select coalesce(sum(
               coalesce(credits_used_nanos, 0)
             + coalesce(byok_upstream_nanos, 0)
             + coalesce(computed_cost_nanos, 0)
             ), 0)::bigint as total
        from spideryarn.ai_calls
       where run_id = ${MONEY}
    `);
    const inSql = Number((answer.rows[0] as { total: string | number }).total);

    const { rows } = await pgCostStore.read();
    const mine = rows.filter((r) => r.runId === MONEY);
    expect(mine).toHaveLength(fixtures.length);
    const t = totalRows(mine);
    expect(inSql).toBe(t.credits + t.upstream + t.computed);
    expect(inSql).toBe(9_008_000);
    /* The unpriced row is a count and not a zero folded into the money. SQL
       cannot say this, which is why the report reads rows rather than only
       summing them. */
    expect(t.unpriced).toBe(1);
  });

  it("writes one row for one call, however often the insert is retried", async () => {
    const { pgCostStore } = await import("../src/store/ai-calls-pg.js");
    const { currentOwnerId } = await import("../src/owner.js");
    const written = row({
      id: "00000000-0000-4000-8000-00000000a102",
      runId: RUN,
      ownerId: currentOwnerId(),
      articleSlug: null,
    });
    await pgCostStore.record(written);
    await pgCostStore.record(written);
    const { rows } = await pgCostStore.read();
    expect(rows.filter((r) => r.id === written.id)).toHaveLength(1);
  });

  /* --------------------------------------------------------------------------
     **The two below were the filesystem ledger's, and are here because nothing
     else had them.**

     Stage G deleted `ai-calls-fs.ts` and the `describe("the filesystem ledger")`
     that drove it, on the rule that a case dies with the module it is about.
     Most of that block was about JSONL — a truncated tail, a line written before
     a column existed, an append mutex — and none of it survives a table. These
     two were not: they are `CostStore` contract behaviour that the Postgres
     adapter implements too (src/store/ai-calls-pg.ts § `read`, § `forJob`), and
     a sweep for a second home found none. Dropping them would have left the
     range predicate behind `npm run cost` and the read behind every job's spend
     reconciliation with no test at all, and a green compiler cannot see that.
     -------------------------------------------------------------------------- */

  it("filters a range half-open, so two months cannot both claim one call", async () => {
    /* **The boundary, and it is money.** `scripts/ai-cost.ts` asks for
       `[since, until)` per month (`:467`, `:1240`) and `tests/ai-cost-cli.test.ts`
       pins the two instants it computes — but nothing checked that the store
       honours them, so an inclusive upper bound would have put the midnight call
       in both months' reports and looked right from either end. */
    const { pgCostStore } = await import("../src/store/ai-calls-pg.js");
    const { currentOwnerId } = await import("../src/owner.js");
    const owner = currentOwnerId();
    const july = row({
      id: "00000000-0000-4000-8000-00000000a104",
      runId: RANGE,
      ownerId: owner,
      articleSlug: null,
      startedAt: "2026-07-31T23:59:59.000Z",
    });
    const august = row({
      id: "00000000-0000-4000-8000-00000000a105",
      runId: RANGE,
      ownerId: owner,
      articleSlug: null,
      /* Exactly on the bound. The whole case is this one instant. */
      startedAt: "2026-08-01T00:00:00.000Z",
    });
    await pgCostStore.record(july);
    await pgCostStore.record(august);
    const ids = async (since: string, until: string) =>
      (await pgCostStore.read(since, until)).rows
        .filter((r) => r.runId === RANGE)
        .map((r) => r.id);
    const inJuly = await ids("2026-07-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");
    expect(inJuly).toContain(july.id);
    expect(inJuly).not.toContain(august.id);
    const inAugust = await ids("2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
    expect(inAugust).toContain(august.id);
    expect(inAugust).not.toContain(july.id);
  });

  it("finds one job's calls across every advance that ran it", async () => {
    /* `src/jobs.ts` (`:1212`) and both eval harnesses read a job's spend this
       way rather than by a time window, because a job is what the money is
       attributed to. Two rows, two steps, one job id — a `forJob` that had
       quietly become "the latest advance" would come back with one. */
    const { pgCostStore } = await import("../src/store/ai-calls-pg.js");
    const { currentOwnerId } = await import("../src/owner.js");
    const owner = currentOwnerId();
    const JOB = "job-parted-pg";
    const first = row({
      id: "00000000-0000-4000-8000-00000000a106",
      runId: RANGE,
      ownerId: owner,
      articleSlug: null,
      jobId: JOB,
    });
    const second = row({
      id: "00000000-0000-4000-8000-00000000a107",
      runId: RANGE,
      ownerId: owner,
      articleSlug: null,
      jobId: JOB,
      stepName: "arc",
      startedAt: "2026-08-15T10:05:00.000Z",
    });
    await pgCostStore.record(first);
    await pgCostStore.record(second);
    const found = await pgCostStore.forJob(JOB);
    expect(found.rows.map((r) => r.stepName).sort()).toEqual(["arc", "hierarchy"]);
    /* **Zero, and it is not the same zero the filesystem reported.** There, a
       damaged line belonging to this job was counted so a short total could not
       look confident. A row here either parsed on the way in or was never
       written, so nothing is unknowable — and `src/jobs.ts` reconciles against
       what the steps said they bought precisely because this number cannot
       report a row that was never inserted. tests/cost-eval.test.ts § the
       ledger-short findings is where that gap is covered. */
    expect(found.unreadable).toBe(0);
  });
});
