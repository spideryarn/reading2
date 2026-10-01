import { describe, expect, it } from "vitest";

import { messagesVerdict, type WireCall } from "../evals/prompt-caching.js";

function call(overrides: Partial<WireCall> = {}): WireCall {
  return {
    label: "call",
    effort: "medium",
    calls: 1,
    pending: 0,
    writeFailures: 0,
    otherCalls: 0,
    inputTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 2_000,
    outputTokens: 10,
    costUsd: 0.01,
    upstream: "Anthropic",
    ms: 1,
    ...overrides,
  };
}

describe("the Messages-wire prompt-caching verdict", () => {
  it("passes only an established cold control, cold writer, and exact readback", () => {
    const verdict = messagesVerdict([
      call({ label: "control", effort: "low" }),
      call({ label: "glossary" }),
      call({ label: "quotes", cacheReadTokens: 2_000, cacheWriteTokens: 0 }),
    ]);

    expect(verdict.verdict).toBe("PASS");
  });

  it("does not pass when only 90% of the marked prefix is read", () => {
    const verdict = messagesVerdict([
      call({ label: "control", effort: "low" }),
      call({ label: "glossary" }),
      call({ label: "quotes", cacheReadTokens: 1_800, cacheWriteTokens: 0 }),
    ]);

    expect(verdict.verdict).toBe("FAIL");
  });

  it("fails rather than selecting the first row when a stage makes two calls", () => {
    const verdict = messagesVerdict([
      call({ label: "control", effort: "low" }),
      call({ label: "glossary", calls: 2 }),
      call({ label: "quotes", cacheReadTokens: 2_000, cacheWriteTokens: 0 }),
    ]);

    expect(verdict.verdict).toBe("FAIL");
    expect(verdict.why.join(" ")).toContain("2 matching ledger rows");
  });

  it("treats an already-warm control key as inconclusive, not a broken effort key", () => {
    const verdict = messagesVerdict([
      call({ label: "control", effort: "low", cacheReadTokens: 2_000, cacheWriteTokens: 0 }),
      call({ label: "glossary" }),
      call({ label: "quotes", cacheReadTokens: 2_000, cacheWriteTokens: 0 }),
    ]);

    expect(verdict.verdict).toBe("WARM, INCONCLUSIVE");
  });

  it("accepts a real write below Sonnet's floor because the serving model owns the floor", () => {
    const verdict = messagesVerdict([
      call({ label: "control", effort: "low", cacheWriteTokens: 700 }),
      call({ label: "glossary", cacheWriteTokens: 700 }),
      call({ label: "quotes", cacheReadTokens: 700, cacheWriteTokens: 0 }),
    ]);

    expect(verdict.verdict).toBe("PASS");
  });
});
