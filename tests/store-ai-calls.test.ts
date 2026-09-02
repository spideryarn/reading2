/**
 * The ledger's two stores — [ai-calls-fs.ts](../src/store/ai-calls-fs.ts) and
 * [ai-calls-pg.ts](../src/store/ai-calls-pg.ts).
 *
 * **What this file is really for is the round trip**, and one assertion inside
 * it. `credits_used_nanos` is an `int8`, and `node-pg` hands `int8` back as a
 * *string* — src/db/schema.ts warns about that twice, in two other columns'
 * comments, because it has bitten this project before. A `"21523500"` where a
 * number belongs does not throw: it concatenates in the next `+`, and the total
 * is wrong in a way that looks like a very expensive month. So the check is that
 * what comes back is a `number`, not merely that it is truthy.
 *
 * The Postgres half skips loudly when there is no database, like every other
 * `*-pg` test here.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

/* ------------------------------------------------------ the JSONL store -- */

describe("the filesystem ledger", () => {
  let store: typeof import("../src/store/ai-calls-fs.js").fsCostStore;

  beforeAll(async () => {
    /* **Its own file, set before the module is imported.** The ledger path is
       resolved once at load. Sharing the real one made a failed assertion leave
       fixture lines behind that the *next* run counted as unreadable — a test
       that poisons the next test is worse than one that fails. */
    process.env.SPIDERYARN_LEDGER = path.join(
      await mkdtemp(path.join(tmpdir(), "spya-ledger-")),
      "ai-calls.jsonl",
    );
    store = (await import("../src/store/ai-calls-fs.js")).fsCostStore;
  });

  afterAll(async () => {
    await rm(path.dirname(process.env.SPIDERYARN_LEDGER as string), {
      recursive: true,
      force: true,
    });
    delete process.env.SPIDERYARN_LEDGER;
  });

  it("writes a row and reads back exactly what it wrote", async () => {
    const written = row({ id: "00000000-0000-4000-8000-00000000a0f1" });
    await store.record(written);
    const { rows } = await store.read();
    const found = rows.find((r) => r.id === written.id);
    expect(found).toEqual(written);
  });

  it("filters a range half-open, so two months cannot both claim one call", async () => {
    const july = row({
      id: "00000000-0000-4000-8000-00000000a0f2",
      startedAt: "2026-07-31T23:59:59.000Z",
    });
    const august = row({
      id: "00000000-0000-4000-8000-00000000a0f3",
      startedAt: "2026-08-01T00:00:00.000Z",
    });
    await store.record(july);
    await store.record(august);
    const ids = async (since: string, until: string) =>
      (await store.read(since, until)).rows.map((r) => r.id);
    expect(await ids("2026-07-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z")).toContain(july.id);
    expect(await ids("2026-07-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z")).not.toContain(
      august.id,
    );
    expect(await ids("2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z")).toContain(august.id);
  });

  it("counts a line it cannot read rather than letting it shrink the total", async () => {
    /* A truncated tail is what a killed process leaves. Skipping it silently
       makes the ledger quietly short; refusing to read the file at all makes one
       bad byte lose a month. */
    const before = (await store.read()).unreadable;
    await writeFile(store.describe(), "{not json\n", { flag: "a" });
    expect((await store.read()).unreadable).toBe(before + 1);
  });

  it("refuses a line that parses but is not a row", async () => {
    /* **`{}` is valid JSON.** Counting only unparseable lines let it through as
       a row, where it passed the date filter with an `undefined` `startedAt` and
       poisoned the next total with `NaN`. Skipping and counting is only safe
       with a shape check behind it. GPT Sol. */
    const before = (await store.read()).unreadable;
    await writeFile(store.describe(), `{}\n{"id":"x","runId":"y"}\n`, { flag: "a" });
    const after = await store.read();
    expect(after.unreadable).toBe(before + 2);
    expect(after.rows.some((r) => r.id === "x")).toBe(false);
  });

  it("reads a line written before the provenance columns existed", async () => {
    /* **The regression this pins.** The shape check was tightened to require
       `provider_account` and `cost_source`, and every line written before those
       columns became `unreadable` — GPT Sol ran the reader over the existing
       ledger and counted 373 rows of real spend deleted from every total by the
       check meant to protect it.

       The backfill is not a guess. It is the one migration 0023 applies to the
       Postgres rows: those lines all came from a gateway that only talks to
       OpenRouter, and `provider` means "OpenRouter answered at all" — hence the
       null test rather than a non-zero one, since a BYOK zero is an answer. */
    const { costSource, providerAccount, computedCostNanos, priceVersion, ...old } = row({
      id: "00000000-0000-4000-8000-00000000f101",
      jobId: "job-pre-0023",
      creditsUsedNanos: 4_200,
    });
    const { costSource: _c, providerAccount: _p, computedCostNanos: _m, priceVersion: _v, ...free } =
      row({
        id: "00000000-0000-4000-8000-00000000f102",
        jobId: "job-pre-0023",
        creditsUsedNanos: null,
      });
    const before = (await store.read()).unreadable;
    await writeFile(
      store.describe(),
      `${JSON.stringify(old)}\n${JSON.stringify(free)}\n`,
      { flag: "a" },
    );
    const after = await store.read();
    expect(after.unreadable).toBe(before);
    const priced = after.rows.find((r) => r.id === "00000000-0000-4000-8000-00000000f101");
    expect(priced?.providerAccount).toBe("openrouter");
    expect(priced?.costSource).toBe("provider");
    /* A line that reported nothing is `none` — not `provider` with a zero, which
       would be the total claiming a call was free. */
    expect(
      after.rows.find((r) => r.id === "00000000-0000-4000-8000-00000000f102")?.costSource,
    ).toBe("none");
    /* And the money is in the total rather than silently missing from it. */
    expect(totalRows(after.rows.filter((r) => r.jobId === "job-pre-0023")).credits).toBe(4_200);
  });

  it("refuses a row whose cost_source disagrees with its two numbers", async () => {
    /* **The check the database does with `ai_calls_one_cost_source`, done by
       reading.** This store has no database. `totalRows` adds `computed` in one
       branch and `credits` in another, so a line carrying both is counted twice
       and a line claiming `provider` with nothing in it is counted as money that
       arrived. Nothing else stands between a hand-edited JSONL line and a wrong
       total. */
    const ok = JSON.stringify(
      row({
        id: "00000000-0000-4000-8000-00000000f001",
        /* Its own job id: these lines land in the shared fixture ledger, and the
           by-job test below counts rows. */
        jobId: "job-cost-source",
        costSource: "computed",
        creditsUsedNanos: null,
        computedCostNanos: 7_000,
        priceVersion: "claude-sonnet-5@1970-01-01",
      }),
    );
    const both = JSON.stringify(
      row({
        id: "00000000-0000-4000-8000-00000000f002",
        /* Its own job id: these lines land in the shared fixture ledger, and the
           by-job test below counts rows. */
        jobId: "job-cost-source",
        costSource: "computed",
        creditsUsedNanos: 5,
        computedCostNanos: 7_000,
        priceVersion: "claude-sonnet-5@1970-01-01",
      }),
    );
    const noVersion = JSON.stringify(
      row({
        id: "00000000-0000-4000-8000-00000000f003",
        /* Its own job id: these lines land in the shared fixture ledger, and the
           by-job test below counts rows. */
        jobId: "job-cost-source",
        costSource: "computed",
        creditsUsedNanos: null,
        computedCostNanos: 7_000,
        priceVersion: null,
      }),
    );
    const before = (await store.read()).unreadable;
    await writeFile(store.describe(), `${ok}\n${both}\n${noVersion}\n`, { flag: "a" });
    const after = await store.read();
    expect(after.unreadable).toBe(before + 2);
    /* And the honest one still gets through, so this is not simply rejecting
       everything. */
    expect(after.rows.some((r) => r.id === "00000000-0000-4000-8000-00000000f001")).toBe(true);
  });

  it("reads a live-conversation row rather than counting it as damage", async () => {
    /* **The bug this went red on, and it was found by a database dry run rather
       than by reading the code.** `looksLikeRow` enumerated the provider
       accounts — `openrouter || anthropic` — so the day live conversation
       started writing `openai` rows, every one of them would have been counted
       `unreadable` and dropped from every total. The most expensive feature in
       the app, invisible to `npm run cost`, through the very shape check that
       exists to stop a total being quietly short.

       Two hand-written copies of one union did it: this list and the SQL CHECK
       `ai_calls_provider_account_known`, neither of which the compiler can see
       when `ProviderAccount` in src/ai-spend.ts widens. The SQL half was caught
       first, by applying the migration inside a rolled-back transaction and
       inserting a realtime row; this half was found by looking for the other
       copies. docs/reusable/silent-success.md.

       A whole realtime row rather than just the account, so the modality
       columns and the null duration are on the same line the reader has to
       accept. */
    const live = JSON.stringify(
      row({
        id: "00000000-0000-4000-8000-00000000f301",
        jobId: "job-live-readable",
        wire: "realtime",
        job: "live_conversation",
        providerAccount: "openai",
        requestedModel: "gpt-realtime-2.1",
        costSource: "computed",
        creditsUsedNanos: null,
        computedCostNanos: 12_345_678,
        priceVersion: "gpt-realtime-2.1@1970-01-01",
        isByok: null,
        durationMs: null,
        /* Its own uuid, not the one `tests/realtime-usage.test.ts` uses for its
           own session fixture — tests/fixture-ids.test.ts insists on that, and
           caught these two sharing one. */
        realtimeSessionId: "00000000-0000-4000-8000-0000000005e9",
        providerEventId: "resp_readable",
        eventKind: "response",
        providerStatus: "completed",
        reportedInputTokens: 1000,
        outputTokens: 200,
        cacheReadTokens: 300,
        cacheWriteTokens: null,
        cacheWrite5mTokens: null,
        cacheWrite1hTokens: null,
        reasoningTokens: null,
        serviceTier: null,
        inputTextTokens: 400,
        inputAudioTokens: 600,
        inputImageTokens: 0,
        cachedTextTokens: 250,
        cachedAudioTokens: 50,
        outputTextTokens: 40,
        outputAudioTokens: 160,
      }),
    );
    const before = (await store.read()).unreadable;
    await writeFile(store.describe(), `${live}\n`, { flag: "a" });
    const after = await store.read();
    expect(after.unreadable).toBe(before);

    const mine = after.rows.find((r) => r.jobId === "job-live-readable");
    expect(mine?.providerAccount).toBe("openai");
    expect(mine?.outputAudioTokens).toBe(160);
    expect(mine?.durationMs).toBeNull();
    /* And it is money the total can see, in the `computed` pocket where our own
       arithmetic belongs — not `credits`, which `--reconcile` compares against
       OpenRouter's running total and could never match. */
    expect(totalRows([mine as AiCallRow])).toEqual({
      credits: 0,
      upstream: 0,
      computed: 12_345_678,
      unpriced: 0,
    });
  });

  it("reads a line written before the BYOK rename, and drops the double count", async () => {
    /* **The surface the plan had missed, and GPT Sol named.** This ledger is
       append-only and is never rewritten, so every line ever written still
       carries `upstreamInferenceNanos`. Renaming the TypeScript property
       without a read-time translation would make the whole historical file
       `unreadable` — the same accident the pre-0023 backfill above exists
       because of, at a larger scale.

       And the translation is conditional, which is the part that matters. On a
       BYOK line the old value is the real money and carries over. On any other
       line it was OpenRouter's `upstream_inference_cost`, equal to `cost` —
       the duplicate that made the obvious sum twice the truth — so it becomes
       null, exactly as the migration does to the Postgres rows. */
    const legacy = (over: Partial<AiCallRow>, upstream: number): string => {
      const r = row({ jobId: "job-byok-rename", ...over }) as unknown as Record<string, unknown>;
      delete r.byokUpstreamNanos;
      r.upstreamInferenceNanos = upstream;
      return JSON.stringify(r);
    };
    const ordinary = legacy(
      { id: "00000000-0000-4000-8000-00000000f201", creditsUsedNanos: 4_000, isByok: false },
      /* Equal to the credits, which is what OpenRouter actually reported. */
      4_000,
    );
    const byok = legacy(
      { id: "00000000-0000-4000-8000-00000000f202", creditsUsedNanos: 0, isByok: true },
      9_000_000,
    );
    const before = (await store.read()).unreadable;
    await writeFile(store.describe(), `${ordinary}\n${byok}\n`, { flag: "a" });
    const after = await store.read();
    /* Readable, not damage. This is the assertion that would have gone red on
       the whole ledger. */
    expect(after.unreadable).toBe(before);

    const mine = after.rows.filter((r) => r.jobId === "job-byok-rename");
    expect(mine).toHaveLength(2);
    const one = mine.find((r) => r.id === "00000000-0000-4000-8000-00000000f201");
    const two = mine.find((r) => r.id === "00000000-0000-4000-8000-00000000f202");
    expect(one?.byokUpstreamNanos).toBe(null);
    expect(two?.byokUpstreamNanos).toBe(9_000_000);
    /* The stale name is gone from the row, so nothing downstream can read it by
       accident and no round trip writes it back out. */
    expect(one).not.toHaveProperty("upstreamInferenceNanos");

    /* And the obvious sum now matches `totalRows` over lines that used to
       double it: 4,000 + 0 credits, 9,000,000 upstream. Written the naive way
       on the *old* shape it would have been 13,004,000. */
    const sum = mine.reduce(
      (n, r) =>
        n + (r.creditsUsedNanos ?? 0) + (r.byokUpstreamNanos ?? 0) + (r.computedCostNanos ?? 0),
      0,
    );
    const t = totalRows(mine);
    expect(sum).toBe(t.credits + t.upstream + t.computed);
    expect(sum).toBe(9_004_000);
  });

  it("does not interleave two writes racing each other", async () => {
    /* Append-only is not the same as atomic — Node says plainly that its
       promise-based fs calls are not synchronised, and nothing established that
       one `appendFile` is one `write(2)`. A half-written line would show up here
       as an unreadable count going up. GPT Sol asked for the serialisation; this
       is what would notice its removal on a bad day. */
    const before = await store.read();
    const many = Array.from({ length: 24 }, (_, i) =>
      row({ id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, "b")}` }),
    );
    await Promise.all(many.map((r) => store.record(r)));
    const after = await store.read();
    expect(after.unreadable).toBe(before.unreadable);
    expect(after.rows.length).toBe(before.rows.length + many.length);
  });

  it("finds one job's calls across every advance that ran it", async () => {
    const a = row({ id: "00000000-0000-4000-8000-00000000a0f4", jobId: "job-parted" });
    const b = row({
      id: "00000000-0000-4000-8000-00000000a0f5",
      jobId: "job-parted",
      stepName: "arc",
    });
    await store.record(a);
    await store.record(b);
    const found = await store.forJob("job-parted");
    expect(found.rows.map((r) => r.stepName).sort()).toEqual(["arc", "hierarchy"]);
    /* Carried through rather than dropped: a damaged line belonging to this job
       would otherwise make a short job total look confident. The lines the three
       tests above appended are still in this file, which is what makes this
       assertion mean something — one unparseable, two that parse but are not
       rows, and two whose `cost_source` disagrees with their own numbers. */
    expect(found.unreadable).toBe(5);
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
const { reachable } = await pgReady({
  suite: "tests/store-ai-calls.test.ts",
  tables: ["spideryarn.ai_calls"],
  columns: [
    { table: "spideryarn.ai_calls", column: "byok_upstream_nanos" },
    { table: "spideryarn.ai_calls", column: "realtime_session_id" },
  ],
  max: 4,
});

const when = reachable ? describe : describe.skip;

when("the Postgres ledger", () => {
  const RUN = "00000000-0000-4000-8000-00000000c001";
  /**
   * A second run id for the money tests, so the sum below counts its own four
   * fixtures and nothing the two round-trip tests above happen to have left.
   *
   * **Explicit cleanup, because these are the tests that still write to the
   * real dev ledger.** Since 2026-09-02 `costStore` hands the *filesystem*
   * store to anything running under the test harness — src/store/ai-calls.ts
   * says why — so the route suites no longer fill this table with fixture rows.
   * These tests deliberately go round that, by importing `pgCostStore`
   * directly, because a Postgres CHECK is not something a JSONL file can prove.
   * The cost of that is that they have to tidy up after themselves.
   */
  const MONEY = "00000000-0000-4000-8000-00000000c002";

  afterAll(async () => {
    const { getDb, closeDb } = await import("../src/db/client.js");
    const { aiCalls } = await import("../src/db/schema.js");
    const { inArray } = await import("drizzle-orm");
    await getDb().delete(aiCalls).where(inArray(aiCalls.runId, [RUN, MONEY]));
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
});
