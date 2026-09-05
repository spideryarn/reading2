/**
 * **The ledger a test may write to** — `costStore` in
 * [src/store/ai-calls.ts](../src/store/ai-calls.ts).
 *
 * Several suites drive real requests through `handleApi`, which opens a spend
 * collector with this store behind it, so every one of them writes ledger rows.
 * The filesystem adapter has always known that and sends them to
 * `data/_ai-calls.test.jsonl`; the Postgres adapter never had the other half of
 * that contract, so with `SPIDERYARN_STORE=postgres` those fixture calls went
 * into the **real dev ledger**. On 2026-09-02 that was 4,714 of 4,750 rows —
 * `test-chat-route-fixture`, `test-remember-route-fixture` and
 * `test-candidates-route-fixture` — which made every `By owner` and `By article`
 * line in `npm run cost` meaningless and buried the unpriced-call warning under
 * thousands of fixtures.
 *
 * A ledger a test can write to is a ledger nobody can trust. That sentence has
 * not changed; **what enforces it has.**
 *
 * ## The defence used to be a redirect, and since 2026-09-05 it is a database
 *
 * From 2026-09-02, `selected()` began `if (process.env.NODE_ENV === "test")
 * return fsCostStore;` — under the harness the ledger was always the filesystem
 * one, whatever the flag said. Redirecting rather than refusing was GPT Sol's
 * call, and the reasoning was sound for what existed then: a store that threw
 * under test would have stopped the route suites exercising the metering
 * lifecycle at all, which is the half of the ledger those suites are the only
 * cover for.
 *
 * What it cost was coverage of the thing that actually deploys. Production runs
 * `SPIDERYARN_STORE=postgres`, so **no route suite in the tree had ever put a
 * row through `pgCostStore`** — the adapter that meters real money was exercised
 * only by tests importing it directly.
 *
 * Stage T built a private test database per run
 * ([`tests/setup/private-db.ts`](setup/private-db.ts)), which is a stronger
 * answer to the same question: the rows are real Postgres rows, written by the
 * real adapter, into a database that is minted for this run and dropped after
 * it. So stage C removed the redirect
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § C), and this file — which existed to say the redirect was still there — now
 * says where the rows actually land.
 *
 * **This file needs a database now, and that is the change.** Its old header
 * said *"No database needed, deliberately"*, because asking a selection is
 * cheaper than looking for rows. That is no longer true of the failure being
 * guarded: the selection being `postgres` is half an answer, and *which*
 * Postgres is the other half. It moved from the `unit` lane to
 * `private-postgres` in the same change.
 */
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import type { AiCallRow } from "../src/ai-spend.js";
import { urlForDatabase } from "../scripts/db-test-create.js";
import { pgReady } from "./helpers/pg-ready.js";

const { costStore } = await import("../src/store/ai-calls.js");
const { currentOwnerId } = await import("../src/owner.js");
const { getDb, closeDb } = await import("../src/db/client.js");
const { sql } = await import("drizzle-orm");

/**
 * `credits_used_nanos` and `owner_id` are what the row below carries, and
 * `article_id` is what `pgCostStore.record` resolves before writing — a probe
 * naming only the table would let a half-migrated database fail inside the store
 * with a bare `42703`. tests/helpers/pg-ready.ts § what to name.
 */
await pgReady({
  suite: "tests/cost-store-under-test.test.ts",
  tables: ["spideryarn.ai_calls", "auth.users"],
  columns: [
    { table: "spideryarn.ai_calls", column: "credits_used_nanos" },
    { table: "spideryarn.ai_calls", column: "realtime_session_id" },
  ],
});

/** The fixture call. One row, spelled out, so a new column has to be decided. */
function fixtureRow(): AiCallRow {
  return {
    id: "00000000-0000-4000-8000-0000000c05ce",
    runId: "00000000-0000-4000-8000-0000000c05cf",
    generationId: null,
    scopeKind: "request",
    /* `currentOwnerId()` rather than a uuid of this file's own: the private
       database seeds the local accounts and nothing else, so a hand-written
       owner would fail the `auth.users` foreign key — which is exactly what the
       stage-C spike measured, 5 rows refused of 5. */
    ownerId: currentOwnerId(),
    articleSlug: null,
    jobId: null,
    stepName: null,
    wire: "chat",
    job: "chat",
    requestedModel: "anthropic/claude-sonnet-5",
    answeredModel: null,
    upstream: null,
    credentialFingerprint: null,
    startedAt: "2026-09-02T10:00:00.000Z",
    finishedAt: "2026-09-02T10:00:01.000Z",
    durationMs: 1000,
    outcome: "ok",
    creditsUsedNanos: 1_000,
    byokUpstreamNanos: null,
    isByok: false,
    providerAccount: "openrouter",
    costSource: "provider",
    computedCostNanos: null,
    priceVersion: null,
    reportedInputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    cacheWrite5mTokens: null,
    cacheWrite1hTokens: null,
    reasoningTokens: null,
    webSearches: null,
    serviceTier: null,
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
  };
}

/**
 * **Mutation.** The stage-C line put back — `if (process.env.NODE_ENV ===
 * "test") return fsCostStore;` reinstated at the top of `selected()` in
 * src/store/ai-calls.ts, which is the state this file was written against for
 * three days. Run 2026-09-05: **3 of the 4 cases red**, and each message names
 * the right thing rather than merely being red. *names the private database and
 * not a file* — `expected '/…/data/_ai-calls.test.jsonl' to contain 'postgres:
 * spideryarn.ai_calls'`. *writes the fixture row into that database* —
 * `the row pgCostStore.record claims to have written: expected +0 to be 1`.
 * *puts nothing in the developer's own ledger* — red on its **control**, not on
 * its claim, which is the answer the design wanted: the dev ledger really did
 * still have zero of these rows, and the control refused to let that count as
 * evidence when the private database had none either.
 *
 * **Blind to.** Which *file* the filesystem adapter would have used. The
 * redirect and `SPIDERYARN_LEDGER` are two separate mechanisms and only the
 * first is mutated here, so a change that sent fixture rows to
 * `data/_ai-calls.jsonl` instead of `_ai-calls.test.jsonl` — the other half of
 * the same incident — is invisible to every case below.
 *
 * **Mutation.** `record` in src/store/ai-calls-pg.ts made a no-op, returning
 * before the `insert`. Run 2026-09-05: **2 of the 4 cases red**, both on the
 * count — `expected +0 to be 1` — which is what stage C's first acceptance
 * criterion asks for: *`pgCostStore.record` genuinely executed, not silently
 * skipped*, observed as a row rather than as a call that returned. The
 * describe-string case stayed green, and that is the point of running this one:
 * a store that names the right database and writes nothing looks exactly like a
 * store that works.
 *
 * **Blind to.** Everything between `handleApi` and this store. The row here goes
 * in through `costStore.record` directly, so a route that stopped opening a
 * spend collector, or an `ai-spend.ts` that stopped calling the sink, leaves
 * every case below green. What covers that is the route suites themselves, now
 * that they write into the same private database — tests/chat-route.test.ts and
 * the other twenty-one that pin the flag.
 */
describe("the ledger a test writes to", () => {
  afterAll(async () => {
    /* No `delete` of the fixture row, deliberately. The database is dropped
       whole at the end of the run (`tests/setup/private-db-global.ts`), which is
       stage C's third acceptance criterion — a suite that failed halfway leaves
       nothing behind because there is nothing left to leave it in. Cleaning up
       by hand here would hide a teardown that had stopped working. */
    await closeDb();
  });

  it("runs under NODE_ENV=test, so the harness is the one these claims are about", () => {
    /* A run where vitest had stopped setting it would be a different harness
       from the one every claim below is about. Its companion — `expect(STORE)`,
       which said the `postgres` flag had taken — went with the flag on
       2026-09-05: there is one store, so there is no `files` run for this file
       to be accidentally green on. */
    expect(process.env.NODE_ENV).toBe("test");
  });

  it("names the private database and not a file", () => {
    const where = costStore.describe();
    expect(where).toContain("postgres: spideryarn.ai_calls");
    expect(where).not.toMatch(/\.jsonl$/);
  });

  it("writes the fixture row into that database, and says which one it is", async () => {
    await costStore.record(fixtureRow());

    /**
     * **Over the store's own handle, and both halves in one statement.**
     * `getDb()` is the pool `pgCostStore` just wrote through, so
     * `current_database()` here is *where the row went* rather than what
     * `DATABASE_URL` says it should have been — the distinction
     * tests/setup/private-db.ts § two controls was written after getting wrong,
     * where a control opened its own connection and asked it its own name.
     */
    const answer = await getDb().execute(sql`
      select current_database() as db,
             (select count(*)::int from spideryarn.ai_calls where id = ${fixtureRow().id}) as n
    `);
    const seen = answer.rows[0] as { db: string; n: number };

    expect(seen.n, "the row pgCostStore.record claims to have written").toBe(1);
    /* A per-run database, by name. `spideryarn_test_` is what
       scripts/db-test-create.ts mints and the only prefix it will drop. */
    expect(seen.db).toMatch(/^spideryarn_test_/);
    expect(seen.db).not.toBe("postgres");
  });

  it("puts nothing in the developer's own ledger", async () => {
    /**
     * **The incident, asked as a question about the other database.** Every
     * assertion above is about where the row *is*, and each of them would still
     * hold if the row were in both places. This is the only one that speaks to
     * what 2026-09-02 actually cost, and it is deliberately the crudest: count
     * the fixture id in the dev ledger and require zero.
     *
     * `postgres` by name, because that is the database a Supabase stack serves
     * and the one `npm run cost` reads on this box — the same identification
     * tests/setup/shared-db.ts makes. Read-only, and the only statement in the
     * suite that touches anything outside the private database.
     *
     * Recorded again rather than relying on the case above having run: the
     * insert is `on conflict do nothing`, so a second call is free, and a case
     * that only holds in file order is a case that goes quietly vacuous the day
     * somebody reorders the file or runs one `it` on its own.
     */
    await costStore.record(fixtureRow());
    const dev = new Client({
      connectionString: urlForDatabase("postgres", process.env.DATABASE_URL ?? ""),
      connectionTimeoutMillis: 10_000,
    });
    await dev.connect();
    try {
      const mine = await dev.query<{ n: string }>(
        "select count(*) as n from spideryarn.ai_calls where id = $1",
        [fixtureRow().id],
      );
      expect(Number(mine.rows[0]?.n)).toBe(0);

      /* **The control, and it is not decoration.** A dev ledger that answered
         zero to everything — an empty table, a schema this connection cannot
         see — would satisfy the line above while proving nothing. So ask it for
         the row the test above has just proved is in the private database, and
         require the two databases to disagree about it. */
      const there = await getDb().execute(sql`
        select count(*)::int as n from spideryarn.ai_calls where id = ${fixtureRow().id}
      `);
      expect(
        (there.rows[0] as { n: number }).n,
        "the private database no longer has the row, so the zero above says nothing",
      ).toBe(1);
    } finally {
      await dev.end();
    }
  });
});
