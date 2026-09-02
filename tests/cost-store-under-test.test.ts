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
 * A ledger a test can write to is a ledger nobody can trust, and this file is
 * what says the redirect is still there.
 *
 * **No database needed**, deliberately: the failure it guards is a *selection*,
 * and asking the selection is cheaper and more direct than looking for rows
 * afterwards. That is also what makes it run on a fresh clone.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `SPIDERYARN_STORE=postgres`, set before **any** import runs.
 *
 * `vi.hoisted` and not a plain statement, for the reason tests/chat-route.test.ts
 * gives: `src/store/live.ts` reads the flag once, the first time anything
 * imports it, and imports are hoisted above every statement in a module. An
 * ordinary assignment would run after the import below had already settled the
 * answer to `files` — and this file would then pass while proving nothing,
 * because `files` is the store that was never the problem.
 */
const PREVIOUS_STORE_FLAG = vi.hoisted(() => {
  const previous = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return previous;
});

const { costStore } = await import("../src/store/ai-calls.js");
const { STORE } = await import("../src/store/live.js");

/* Put the flag back straight after the imports: vitest reuses a worker across
   test files and does not reset `process.env` between them. */
if (PREVIOUS_STORE_FLAG === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = PREVIOUS_STORE_FLAG;

describe("the ledger a test writes to", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "spya-cost-store-"));
    process.env.SPIDERYARN_LEDGER = path.join(dir, "ai-calls.jsonl");
  });

  afterAll(async () => {
    delete process.env.SPIDERYARN_LEDGER;
    await rm(dir, { recursive: true, force: true });
  });

  it("really did select postgres, so the assertions below mean something", () => {
    /* Without this the whole file is green on a `files` run, which is the
       configuration that never had the bug. */
    expect(STORE).toBe("postgres");
    expect(process.env.NODE_ENV).toBe("test");
  });

  it("hands out the filesystem ledger even though the app store is postgres", () => {
    const where = costStore.describe();
    expect(where).toMatch(/\.jsonl$/);
    expect(where).not.toContain("ai_calls");
  });

  it("writes a fixture row to that file and not into the table", async () => {
    await costStore.record({
      id: "00000000-0000-4000-8000-0000000c05ce",
      runId: "00000000-0000-4000-8000-0000000c05cf",
      generationId: null,
      scopeKind: "request",
      ownerId: "00000000-0000-4000-8000-0000000c05d0",
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
    });
    const text = await readFile(process.env.SPIDERYARN_LEDGER as string, "utf8");
    expect(text).toContain("0000000c05ce");
  });

  it("goes back to postgres the moment it is not a test run", () => {
    /* **The selection is made per call, not once at module load**, and this is
       what proves it. A constant would have been decided before any test body
       ran — the exact trap `ledger()` in ai-calls-fs.ts carries a comment
       about, where ESM hoisting meant a suite setting an environment variable in
       `beforeAll` had already lost. It also means the redirect cannot leak into
       a real run: change `NODE_ENV` and the Postgres adapter answers again.
       `describe()` opens no connection, so this costs nothing. */
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      expect(costStore.describe()).toContain("spideryarn.ai_calls");
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
