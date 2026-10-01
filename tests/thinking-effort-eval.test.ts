/**
 * The free half of evals/thinking-effort/ (plan 261001p): what each arm must
 * put on the wire, how the wire is read back, and that the shuffles are
 * reproducible. The paid half is the smoke run in the plan.
 */
import { describe, expect, it } from "vitest";
import { ARM_NAMES, DEFAULT_ARMS, levelOf, seededShuffle } from "../evals/thinking-effort/arms.js";
import { ideasForJudging, labelsFor, stripProvenance } from "../evals/thinking-effort/lineup.js";
import { armEffort, readCapture } from "../evals/thinking-effort/run.js";
import type { Block, Idea } from "../src/types.js";

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
});

describe("readCapture", () => {
  it("reads the effort and thinking a request carried, and how its stream ended", () => {
    const body = JSON.stringify({ model: "anthropic/claude-sonnet-5", max_tokens: 9, thinking: { type: "adaptive" }, output_config: { effort: "low" } });
    const sse = [
      "event: message_start",
      'data: {"type":"message_start","message":{"id":"m"}}',
      "event: message_delta",
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":50,"output_tokens_details":{"thinking_tokens":12}}}',
    ].join("\n");
    expect(readCapture("u", body, sse)).toMatchObject({
      model: "anthropic/claude-sonnet-5",
      effort: "low",
      thinking: "adaptive",
      stopReason: "end_turn",
      thinkingTokens: 12,
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
    expect(stripProvenance({ generator: "g", sourceHash: "h", version: "v", scenes: [1] })).toEqual({ scenes: [1] });
  });

  it("puts each occurrence's block text beside its id", () => {
    const blocks = [{ id: "spya-aaaaaa", text: "The whole block." }] as Block[];
    const idea = { id: "i", name: "n", statement: "s", occurrences: [{ blockId: "spya-aaaaaa", quote: "whole", reasoning: "r" }] } as unknown as Idea;
    expect(ideasForJudging({ ideas: [idea] }, blocks)).toEqual([
      { ...idea, occurrences: [{ blockId: "spya-aaaaaa", quote: "whole", reasoning: "r", blockText: "The whole block." }] },
    ]);
  });
});
