import { afterEach, expect, it, vi } from "vitest";
import { beginSpend, collectSpend, lateCalls, providerCost, recordSpend, resetUnscopedCalls, type AiCallRow, type SpendRecord } from "../src/ai-spend.js";

const mocks = vi.hoisted(() => ({ generateGlossary: vi.fn(), rows: [] as unknown[] }));
vi.mock("../src/is-main.js", () => ({ isMain: () => true }));
vi.mock("../src/store/index.js", () => ({ loadArticle: async () => ({ blocks: [], tree: {}, meta: {} }) }));
vi.mock("../src/glossary.js", () => ({ generateGlossary: mocks.generateGlossary }));
vi.mock("../src/cli-ledger.js", () => ({
  withLedger: async (_kind: string, main: () => Promise<void>) => collectSpend(main, {
    attribution: { scopeKind: "eval", ownerId: "00000000-0000-4000-8000-000000000001" },
    sink: async (row: AiCallRow) => { mocks.rows.push(row); },
  }),
}));

function call(): SpendRecord {
  return {
    job: "glossary", model: "test-model", answeredBy: "test-model", wire: "messages",
    cost: providerCost(100), upstreamCostNanos: null, generationId: null, upstream: null,
    isByok: false, providerAccount: "openrouter", credentialFingerprint: null,
    inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
    cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, reasoningTokens: 0, webSearches: null,
    serviceTier: null, inferenceGeo: null, ms: 1, outcome: "ok",
  };
}

afterEach(() => { vi.restoreAllMocks(); });

it("keeps a converted eval's ledger open until paid siblings finish after one fails", async () => {
  resetUnscopedCalls();
  mocks.rows.length = 0;
  const failure = new Error("first glossary failed");
  let siblingStarted!: () => void;
  const started = new Promise<void>((resolve) => { siblingStarted = resolve; });
  let finishSibling!: () => void;
  const finish = new Promise<void>((resolve) => { finishSibling = resolve; });
  mocks.generateGlossary.mockImplementationOnce(async () => {
    const id = beginSpend("glossary", "test-model");
    await started;
    recordSpend(call(), id);
    throw failure;
  }).mockImplementationOnce(async () => {
    const id = beginSpend("glossary", "test-model");
    siblingStarted();
    await finish;
    recordSpend(call(), id);
    return { glossary: { entries: [] } };
  });
  const original = process.argv[2];
  process.argv[2] = "2";
  let finished = false;
  const invocation = import("../evals/plain-words/glossary-people.js").then(
    () => { finished = true; return null; },
    (error: unknown) => { finished = true; return error; },
  );
  try {
    await started;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(finished, "failure must wait for the sibling's paid completion").toBe(false);
  } finally {
    finishSibling();
    if (original === undefined) delete process.argv[2]; else process.argv[2] = original;
    await invocation;
  }
  expect(await invocation).toBe(failure);
  expect(mocks.rows).toHaveLength(2);
  expect(lateCalls()).toBe(0);
});
