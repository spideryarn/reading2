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
import { hierarchyTreeFile, ideasForJudging, labelsFor, stripProvenance } from "../evals/thinking-effort/lineup.js";
import { assertTreeSound } from "../src/tree-invariants.js";
import { qualityFromRanking, uStatistic, verdictOf } from "../evals/thinking-effort/tally.js";
import {
  accountingFaults,
  armEffort,
  armFormat,
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

  it("keeps the frozen no-schema arm at production effort", () => {
    expect(armEffort("no-schema", "low")).toEqual({ override: null, expectedOnWire: "low" });
  });

  it("requires schemas for Ideas and shipping Sketch, but not Sketch's frozen arm", () => {
    expect(armFormat("ideas", "base")).toBe("json_schema");
    expect(armFormat("ideas", "low")).toBe("json_schema");
    expect(armFormat("sketch", "base")).toBe("json_schema");
    expect(armFormat("sketch", "no-schema")).toBeNull();
    expect(armFormat("illustrated", "base")).toBeNull();
  });
});

describe("the arms", () => {
  it("runs two draws of base and two of low by default, and medium only when named", () => {
    expect(DEFAULT_ARMS).toEqual(["base-a", "base-b", "low-a", "low-b"]);
    expect(ARM_NAMES.filter((a) => levelOf(a) === "medium")).toEqual(["medium-a", "medium-b"]);
    expect(ARM_NAMES.filter((a) => levelOf(a) === "no-schema")).toEqual(["no-schema-a", "no-schema-b"]);
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

  it("maps the blind hierarchy aliases onto both repeats of both measured arms", () => {
    expect([
      hierarchyTreeFile("base-a", "article"),
      hierarchyTreeFile("base-b", "article"),
      hierarchyTreeFile("toc11-a", "article"),
      hierarchyTreeFile("toc11-b", "article"),
    ]).toEqual([
      "toc10-frozen.article.r1.json",
      "toc10-frozen.article.r2.json",
      "incumbent.article.r1.json",
      "incumbent.article.r2.json",
    ]);
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

  it("renders Hierarchy's sampled deep gists reproducibly", () => {
    /* Built here rather than read from a run's corpus: evals/results/ is
       gitignored, so a test that read it passed only on the checkout where the
       eval ran (docs/postmortems/261002a). Six deep gisted nodes, so the sample
       of three is a real draw and not the whole pool. */
    const blocks: Block[] = Array.from({ length: 12 }, (_, i) => {
      const text = `Paragraph ${i} says one thing. Then another.`;
      return {
        id: `spya-b${String(i).padStart(5, "0")}`,
        tag: "p",
        kind: "text",
        text,
        words: text.split(/\s+/).length,
        html: `<p>${text}</p>`,
        gistable: true,
      };
    });
    const id = (i: number) => blocks[i]!.id;
    const nodes: Tree["nodes"] = {
      root: { id: "root", depth: 0, parent: null, children: ["p0", "p1"], range: [id(0), id(11)], title: "Root", gist: "g" },
    };
    for (const p of [0, 1]) {
      const deep = [0, 1, 2].map((d) => `p${p}d${d}`);
      nodes[`p${p}`] = { id: `p${p}`, depth: 1, parent: "root", children: deep, range: [id(p * 6), id(p * 6 + 5)], title: `Part ${p}`, gist: `part ${p}` };
      for (const [d, nid] of deep.entries()) {
        const lo = p * 6 + d * 2;
        const leaves = [0, 1].map((leaf) => `${nid}l${leaf}`);
        nodes[nid] = { id: nid, depth: 2, parent: `p${p}`, children: leaves, range: [id(lo), id(lo + 1)], title: nid, gist: `deep gist ${nid}` };
        for (const [leaf, leafId] of leaves.entries()) {
          nodes[leafId] = { id: leafId, depth: 3, parent: nid, children: [], range: [id(lo + leaf), id(lo + leaf)], title: `${nid} leaf` };
        }
      }
    }
    const tree: Tree = { version: "v", generator: "test", slug: "s", rootId: "root", nodes };
    expect(() => assertTreeSound(blocks, tree)).not.toThrow();

    const once = renderForJudging(blocks, tree, "W");
    expect(renderForJudging(blocks, tree, "W")).toBe(once);
    expect(once.match(/^- gist: deep gist \S+$/gm)).toEqual([
      "- gist: deep gist p0d2",
      "- gist: deep gist p1d2",
      "- gist: deep gist p0d0",
    ]);
  });
});

describe("tally: U and the plan's verdict bands", () => {
  it("counts candidate wins over base, ties as a half", () => {
    // low-a best, then a tie of base-a and low-b, then base-b last.
    const q = qualityFromRanking([["W"], ["X", "Y"], ["Z"]]);
    const byArm = { "low-a": q.W as number, "base-a": q.X as number, "low-b": q.Y as number, "base-b": q.Z as number };
    // low-a beats both (2); low-b ties base-a (0.5) and beats base-b (1).
    expect(uStatistic(byArm)).toBe(3.5);
    expect(uStatistic({ "base-a": 5, "base-b": 4, "low-a": 1, "low-b": 2 })).toBe(0);
    expect(uStatistic({ "base-a": 3, "base-b": 3, "low-a": 3, "low-b": 3 })).toBe(2);
    expect(verdictOf(1.1)).toBe("clear loss");
    expect(verdictOf(1.5)).toBe("possible loss");
    expect(verdictOf(1.51)).toBe("no visible loss");
  });

  it("refuses a lineup that is not two against two", () => {
    expect(() => uStatistic({ "base-a": 1, "low-a": 2, "low-b": 3 })).toThrow();
  });
});
