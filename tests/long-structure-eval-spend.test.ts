import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { beginSpend, collectSpend, providerCost, recordSpend, type AiCallRow, type SpendRecord } from "../src/ai-spend.js";
import { evalSpend, Ledger } from "../evals/long-structure/calls.js";

const mocks = vi.hoisted(() => ({ record: vi.fn(), owner: vi.fn() }));
vi.mock("../src/store/ai-calls.js", () => ({ costStore: { record: mocks.record } }));
vi.mock("../src/owner.js", () => ({
  environmentOwnerId: mocks.owner,
  // The collector also resolves its ambient owner while turning a spend record into a row.
  currentOwnerId: () => "00000000-0000-4000-8000-000000000001",
}));

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  mocks.record.mockReset();
  mocks.owner.mockReset();
});

it.each([false, true])("a ledger with fake=%s keeps local rows and writes database rows only when real", async (fake) => {
  const dir = mkdtempSync(path.join(tmpdir(), "eval-spend-"));
  dirs.push(dir);
  const ledger = new Ledger(path.join(dir, "ledger.jsonl"), 10, fake);
  const owner = "00000000-0000-4000-8000-000000000001";
  mocks.owner.mockImplementation(() => {
    if (fake) throw new Error("a fake run must not resolve a database owner");
    return owner;
  });
  mocks.record.mockImplementation(async () => {
    if (fake) throw new Error("a fake run must not write invented spend");
  });
  const rows: AiCallRow[] = [];
  const spend: SpendRecord = {
    job: "structure", model: "test-model", answeredBy: "test-model", wire: "messages",
    cost: providerCost(100), upstreamCostNanos: null, generationId: null, upstream: null,
    isByok: false, providerAccount: "openrouter", credentialFingerprint: null,
    inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
    cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, reasoningTokens: 0, webSearches: null,
    serviceTier: null, inferenceGeo: null, ms: 1, outcome: "ok",
  };
  await collectSpend(async () => {
    const id = beginSpend("structure", "test-model");
    recordSpend(spend, id);
  }, evalSpend(ledger, "fixture", rows));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ scopeKind: "eval", articleSlug: "fixture", creditsUsedNanos: 100 });
  expect(mocks.owner).toHaveBeenCalledTimes(fake ? 0 : 1);
  expect(mocks.record).toHaveBeenCalledTimes(fake ? 0 : 1);
  if (!fake) {
    expect(rows[0]?.ownerId).toBe(owner);
    expect(mocks.record).toHaveBeenCalledWith(rows[0]);
  }
});
