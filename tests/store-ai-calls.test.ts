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
    stepName: "toc",
    wire: "messages",
    job: "toc",
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
    upstreamInferenceNanos: 21_523_500,
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
      row({ isByok: true, creditsUsedNanos: 0, upstreamInferenceNanos: 9_000_000 }),
    ]);
    expect(t.upstream).toBe(9_000_000);
    expect(t.unpriced).toBe(0);
    expect(t.credits).toBe(0);
  });

  it("counts a BYOK call with no upstream figure as unpriced, not as zero", () => {
    const t = totalRows([
      row({ isByok: true, creditsUsedNanos: 0, upstreamInferenceNanos: null }),
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
      row({ outcome: "error", isByok: true, creditsUsedNanos: 0, upstreamInferenceNanos: 10_000_000 }),
    ]);
    expect(failed.credits + failed.upstream).toBe(10_000_000);
    expect(failed.credits).toBe(0);
  });

  it("does not add the two pockets together on an ordinary call", () => {
    /* On a non-BYOK call `cost` and `upstream_inference_cost` are the same money
       — measured equal to seven decimal places on 2026-08-27 — so adding both
       would double every bill. */
    const t = totalRows([row()]);
    expect(t.credits + t.upstream).toBe(21_523_500);
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
    expect(found.rows.map((r) => r.stepName).sort()).toEqual(["arc", "toc"]);
    /* Carried through rather than dropped: a damaged line belonging to this job
       would otherwise make a short job total look confident. The lines the three
       tests above appended are still in this file, which is what makes this
       assertion mean something — one unparseable, two that parse but are not
       rows, and two whose `cost_source` disagrees with their own numbers. */
    expect(found.unreadable).toBe(5);
  });
});

/* ------------------------------------------------------ the Postgres store -- */

let reachable = false;

if (process.env.DATABASE_URL) {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 4,
    connectionTimeoutMillis: 10_000,
  });
  let why = "";
  try {
    const probe = await pool.query(
      "select to_regclass('spideryarn.ai_calls') is not null as ready",
    );
    reachable = probe.rows[0]?.ready === true;
    if (reachable) {
      /* The table has existed since 0000 with a different shape. A probe that
         only asks whether it exists would let this suite run against the old
         columns and fail in a way that reads like a bug in the store. */
      const shaped = await pool.query(
        "select count(*) as n from information_schema.columns " +
          "where table_schema='spideryarn' and table_name='ai_calls' and column_name='credits_used_nanos'",
      );
      reachable = Number(shaped.rows[0]?.n) === 1;
      if (!reachable) why = "ai_calls is the pre-0021 shape — run npm run db:migrate";
    } else why = "the spideryarn schema is not there — run npm run db:migrate";
  } catch (err) {
    reachable = false;
    why = `could not reach it: ${(err as Error).message}`;
  }
  await pool.end();
  if (!reachable) console.warn(`\n  ⚠ DATABASE_URL is set but these tests are skipping: ${why}\n`);
}

const when = reachable ? describe : describe.skip;

when("the Postgres ledger", () => {
  const RUN = "00000000-0000-4000-8000-00000000c001";

  afterAll(async () => {
    const { getDb, closeDb } = await import("../src/db/client.js");
    const { aiCalls } = await import("../src/db/schema.js");
    const { eq } = await import("drizzle-orm");
    await getDb().delete(aiCalls).where(eq(aiCalls.runId, RUN));
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
