/**
 * The free half of evals/thinking-effort/ (plan 261001p): what each arm must
 * put on the wire, how the wire is read back, and that the shuffles are
 * reproducible. The paid half is the smoke run in the plan.
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ARM_NAMES, DEFAULT_ARMS, levelOf, seededShuffle } from "../evals/thinking-effort/arms.js";
import { renderForJudging } from "../evals/hierarchy-structure/blind.js";
import { ideasForJudging, labelsFor, stripProvenance } from "../evals/thinking-effort/lineup.js";
import {
  accountingFaults,
  armEffort,
  claimRun,
  ensureModeConfig,
  modeOrderFile,
  modeRowsFile,
  outputValidityFailure,
  readCapture,
  selectedArmOrder,
} from "../evals/thinking-effort/run.js";
import type { Block, Idea, Tree } from "../src/types.js";

describe("armEffort", () => {
  it("leaves base on production's own path and expects production's effort on the wire", () => {
    expect(armEffort("base", "high")).toEqual({ override: null, expectedOnWire: "high" });
  });

  it("expects NO effort on the wire for Illustrated's base, which names none today", () => {
    expect(armEffort("base", null)).toEqual({ override: null, expectedOnWire: null });
  });

  it("sets and expects the lower arm's own level", () => {
    expect(armEffort("low", null)).toEqual({ override: "low", expectedOnWire: "low" });
    expect(armEffort("medium", "high")).toEqual({ override: "medium", expectedOnWire: "medium" });
  });
});

describe("the arms", () => {
  it("runs two draws of base and two of low by default, and medium only when named", () => {
    expect(DEFAULT_ARMS).toEqual(["base-a", "base-b", "low-a", "low-b"]);
    expect(ARM_NAMES.filter((a) => levelOf(a) === "medium")).toEqual(["medium-a", "medium-b"]);
  });

  it("shuffles reproducibly from one seed, differently per salt, and loses nothing", () => {
    const a = seededShuffle(ARM_NAMES, 42, "sketch/x");
    expect(seededShuffle(ARM_NAMES, 42, "sketch/x")).toEqual(a);
    expect([...a].sort()).toEqual([...ARM_NAMES].sort());
    const orders = new Set(["a", "b", "c", "d", "e", "f"].map((s) => seededShuffle(ARM_NAMES, 42, s).join()));
    expect(orders.size).toBeGreaterThan(1);
  });

  it("gives an arm the same recorded slot when a resume names only a subset", () => {
    const full = selectedArmOrder("sketch", "article", 42, ARM_NAMES);
    const lowOnly = selectedArmOrder("sketch", "article", 42, ["low-a", "low-b"]);
    expect(lowOnly).toEqual(full.filter(({ arm }) => arm === "low-a" || arm === "low-b"));
  });
});

describe("concurrent and resumed runs", () => {
  it("keeps rows, seeds and summaries mode-local", () => {
    expect(modeRowsFile("out", "sketch")).toBe(path.join("out", "runs.sketch.jsonl"));
    expect(modeRowsFile("out", "ideas")).toBe(path.join("out", "runs.ideas.jsonl"));
    expect(modeOrderFile("out", "sketch")).toBe(path.join("out", "order.sketch.json"));
  });

  it("accepts the same saved configuration and refuses a mixed one", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "thinking-effort-config-"));
    const config = { version: 1 as const, mode: "ideas" as const, model: "sonnet", plates: false };
    await ensureModeConfig(dir, config);
    await ensureModeConfig(dir, config);
    await expect(ensureModeConfig(dir, { ...config, model: "another-model" })).rejects.toThrow(/configuration/);
  });

  it("leaves an ambiguity marker before a paid cell and refuses to claim it twice", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "thinking-effort-claim-"));
    await claimRun(dir, "sketch", "sketch.low-a.article");
    await expect(claimRun(dir, "sketch", "sketch.low-a.article")).rejects.toThrow(/may already have spent/);
    expect(JSON.parse(await readFile(path.join(dir, "claims", "sketch", "sketch.low-a.article.json"), "utf-8"))).toMatchObject({
      key: "sketch.low-a.article",
      state: "started",
    });
  });
});

describe("hard validity", () => {
  it("does not let an Illustrated answer with no surviving plate pass", () => {
    expect(outputValidityFailure("illustrated", { platesInBrief: 0, vignettesKept: 0 })).toMatch(/no plate survived/);
  });

  it("does not confuse zero thinking with a degenerate answer", () => {
    expect(outputValidityFailure("ideas", { ideas: 4 })).toBeNull();
  });
});

describe("paid-call accounting", () => {
  it("requires accounting even when the generator rejected the answer", () => {
    expect(accountingFaults({
      wireCalls: 1,
      ledgerCalls: 0,
      inputTokens: null,
      outputTokens: null,
      thinkingTokens: null,
      thinkingTokensWire: 12,
      providerUsd: null,
      listUsd: null,
      pendingCalls: 0,
      ledgerWriteFailures: 0,
    })).toEqual(expect.arrayContaining([
      expect.stringMatching(/ledger row/),
      expect.stringMatching(/token accounting/),
      expect.stringMatching(/cost/),
    ]));
  });

  it("does not call a pre-provider validation failure an accounting fault", () => {
    expect(accountingFaults({
      wireCalls: 0,
      ledgerCalls: 0,
      inputTokens: null,
      outputTokens: null,
      thinkingTokens: null,
      thinkingTokensWire: null,
      providerUsd: null,
      listUsd: null,
      pendingCalls: 0,
      ledgerWriteFailures: 0,
    })).toEqual([]);
  });
});

describe("readCapture", () => {
  it("reads the effort and thinking a request carried, and how its stream ended", () => {
    const body = JSON.stringify({ model: "anthropic/claude-sonnet-5", max_tokens: 9, thinking: { type: "adaptive" }, output_config: { effort: "low" } });
    const sse = [
      "event: message_start",
      'data: {"type":"message_start","message":{"id":"m"}}',
      "event: content_block_delta",
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"raw answer"}}',
      "event: message_delta",
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":50,"output_tokens_details":{"thinking_tokens":12}}}',
    ].join("\n");
    expect(readCapture("u", body, sse)).toMatchObject({
      model: "anthropic/claude-sonnet-5",
      effort: "low",
      thinking: "adaptive",
      stopReason: "end_turn",
      thinkingTokens: 12,
      text: "raw answer",
    });
  });

  it("says a request with no output_config carried no effort, rather than a default", () => {
    expect(readCapture("u", JSON.stringify({ thinking: { type: "adaptive" } }), "").effort).toBeNull();
  });
});

describe("the lineup", () => {
  it("labels four candidates W to Z", () => {
    expect(labelsFor(4)).toEqual(["W", "X", "Y", "Z"]);
    expect(labelsFor(5)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("strips what a judge could read an arm off", () => {
    expect(stripProvenance({
      generator: "g",
      sourceHash: "h",
      version: "v",
      generatedAt: "later",
      elapsedMs: 123,
      scenes: [{ model: "m", usage: { thinking_tokens: 1 }, title: "keep" }],
    })).toEqual({ scenes: [{ title: "keep" }] });
  });

  it("puts each occurrence's block text beside its id", () => {
    const blocks = [{ id: "spya-aaaaaa", text: "The whole block." }] as Block[];
    const idea = { id: "i", name: "n", statement: "s", occurrences: [{ blockId: "spya-aaaaaa", quote: "whole", reasoning: "r" }] } as unknown as Idea;
    expect(ideasForJudging({ ideas: [idea] }, blocks)).toEqual([
      { ...idea, occurrences: [{ blockId: "spya-aaaaaa", quote: "whole", reasoning: "r", blockText: "The whole block." }] },
    ]);
  });

  it("renders Hierarchy's sampled deep gists reproducibly", async () => {
    const corpus = "evals/results/thinking-effort-smoke/corpus/cargocult-spya-rz663q";
    const { blocks } = JSON.parse(await readFile(path.join(corpus, "blocks.json"), "utf-8")) as { blocks: Block[] };
    const tree = JSON.parse(
      await readFile(
        "evals/results/hierarchy-structure/2026-10-01-17-39-07-incumbent+smart-off/trees/incumbent.cargocult-spya-rz663q.json",
        "utf-8",
      ),
    ) as Tree;
    expect(renderForJudging(blocks, tree, "W")).toBe(renderForJudging(blocks, tree, "W"));
  });
});
