import { afterEach, expect, it, vi } from "vitest";
import { beginSpend, lateCalls, providerCost, recordSpend, resetUnscopedCalls, type AiCallRow, type SpendRecord } from "../src/ai-spend.js";

const mocks = vi.hoisted(() => ({
  blocks: Array.from({ length: 2000 }, (_, i) => ({ id: `spya-a${i.toString(16).replaceAll("1", "x").padStart(5, "0")}`, kind: "text", tag: "p", text: "Fixture prose." })),
  rows: [] as AiCallRow[],
  request: vi.fn(),
  stream: vi.fn(),
}));
vi.mock("../src/env.js", () => ({ loadEnvLocal: () => {} }));
vi.mock("../src/store/ai-calls.js", () => ({ costStore: { record: async (row: AiCallRow) => { mocks.rows.push(row); } } }));
vi.mock("../src/store/index.js", () => ({ loadArticle: async () => ({ blocks: mocks.blocks, tree: { rootId: "root", nodes: { root: { title: "Fixture" } } } }) }));
vi.mock("../src/messages-stream.js", () => ({ streamMessage: mocks.stream, finishedText: () => "{}" }));
vi.mock("../src/labels.js", () => ({ unaskableBatches: () => [] }));
vi.mock("../src/heading-tree.js", () => ({ buildBoundedHeadingTree: () => ({ tree: { nodes: {
  first: { depth: 1, range: [mocks.blocks[0]!.id, mocks.blocks[999]!.id], children: ["child"] },
  second: { depth: 1, range: [mocks.blocks[1000]!.id, mocks.blocks[1999]!.id], children: ["child"] },
} } }) }));
vi.mock("../src/supplement.js", () => ({ splitBlocks: (blocks: unknown[]) => ({ body: blocks }), isSupplementNode: () => false, appendSupplement: () => {} }));
vi.mock("../src/structure.js", () => ({
  wholeDocumentRequest: mocks.request,
  parseWholeDocumentAnswer: () => ({ root: { children: [{ title: "Part", range: [mocks.blocks[0]!.id, mocks.blocks[999]!.id] }] } }),
  estimateStructureTokens: () => 1,
  STRUCTURE_HEADROOM: 1,
  MAX_QUESTION_DEPTH: 3,
  buildTree: () => ({}),
}));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, readFileSync: (...args: Parameters<typeof fs.readFileSync>) => {
    const file = String(args[0]);
    if (file.endsWith("/plan.json")) return JSON.stringify({ plans: [{ slices: Array.from({ length: 4 }, () => ({ lo: 0, hi: 999 })) }] });
    if (/\/slice-\d+-answer\.json$/.test(file)) return "{}";
    return fs.readFileSync(...args);
  } };
});

function call(): SpendRecord {
  return {
    job: "structure", model: "test-model", answeredBy: "test-model", wire: "messages",
    cost: providerCost(100), upstreamCostNanos: null, generationId: null, upstream: null,
    isByok: false, providerAccount: "openrouter", credentialFingerprint: null,
    inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
    cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, reasoningTokens: 0, webSearches: null,
    serviceTier: null, inferenceGeo: null, ms: 1, outcome: "ok",
  };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it.each(["spike-parts", "spike-followups"])("%s waits for paid siblings before closing a failed collector", async (file) => {
  resetUnscopedCalls();
  mocks.rows.length = 0;
  mocks.request.mockReset();
  mocks.stream.mockReset();
  vi.stubEnv("DATABASE_URL", "postgresql://fixture@127.0.0.1/never-connect");
  const failure = new Error("fixture request failed before its network call");
  let requestCount = 0;
  // Parts checks two slices during planning; its third request is the first paid task.
  const failAt = file === "spike-parts" ? 3 : 1;
  mocks.request.mockImplementation(() => {
    if (++requestCount === failAt) throw failure;
    return { params: {}, maxTokens: 100, user: "fixture" };
  });
  let siblingStarted!: () => void;
  const started = new Promise<void>((resolve) => { siblingStarted = resolve; });
  let finishSibling!: () => void;
  const finish = new Promise<void>((resolve) => { finishSibling = resolve; });
  mocks.stream.mockImplementation(() => ({ finalMessage: async () => {
    const id = beginSpend("structure", "test-model");
    siblingStarted();
    await finish;
    recordSpend(call(), id);
    throw new Error("fixture paid response failed");
  } }));
  const argv = process.argv;
  process.argv = [...argv.slice(0, 2), "run"];
  let ended = false;
  const invocation = (file === "spike-parts"
    ? import("../evals/long-documents/spike-parts.js")
    : import("../evals/long-documents/spike-followups.js")
  ).then(() => { ended = true; return null; }, (error: unknown) => { ended = true; return error; });
  try {
    await started;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(ended, "failure must wait for every paid sibling").toBe(false);
  } finally {
    finishSibling();
    await invocation;
    process.argv = argv;
  }
  expect(await invocation).toBe(failure);
  expect(mocks.rows).toHaveLength(file === "spike-parts" ? 1 : 5);
  expect(lateCalls()).toBe(0);
});
