/**
 * The two COMPOSITIONS of the attention pass — tools/overseer/attention-cli.ts.
 *
 * `runAttentionPass` defaults its prompt version to 1, and `classifyTail` picks
 * its prompt from its own options, so a caller that chose version 2 and forgot
 * to say so in either place files a version-1 answer under version 2, or the
 * other way round (plan 260910f D3; the comment at
 * `AttentionPassOptions.promptVersion`). The unit tests of the pass cannot see
 * that, because they hand it a version themselves. So this drives the daemon's
 * runner and the hand-run command as they are composed, with only the edges
 * faked: the fleet (no tmux), the gateway (no network, no key), and the switch.
 *
 * Mutation-checked: dropping `promptVersion` from either caller's
 * `runAttentionPass` call, or from either caller's classifier options, turns
 * one of these red.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AttentionList } from "../tools/fleet/wire.js";
import {
  CLASSIFIER_PROMPT_VERSION,
  PROPOSAL_PROMPT_VERSION,
  buildClassifierPrompt,
} from "../tools/overseer/attention-classify.js";
import { attentionRunner, describeList, runAttentionCommand, type AttentionSeams } from "../tools/overseer/attention-cli.js";
import { readAttentionMemory } from "../tools/overseer/attention-memory.js";

const PANE = readFileSync(new URL("./fixtures/overseer-turn-tails/ended-prose-question-shut-it-down.txt", import.meta.url), "utf8");

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-attention-cli-"));
  roots.push(root);
  return root;
}

/** Every edge faked, and a record of what reached the gateway. */
function seams(proposals: boolean): { seams: AttentionSeams; systems: string[] } {
  const systems: string[] = [];
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    systems.push(body.messages[0]?.content ?? "");
    // A version-2-shaped answer whatever was asked: under version 1 the extra
    // fields must be ignored, under version 2 they must be read.
    const content = JSON.stringify({
      asked: true,
      topic: "whether to shut the idle stack down",
      why: "it offered and stopped",
      kind: "irreversible",
      answerable: "phone",
      answerableWhy: "",
      recipient: "fable",
      reason: "it is a question of wording",
      asks: "Say the word and I'll shut it down.",
    });
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { cost: 0.0001 } }), { status: 200 });
  }) as typeof fetch;
  return {
    systems,
    seams: {
      apiKey: () => "not-a-real-key",
      proposals: () => proposals,
      listSessions: async () => [{ sessionId: "$1", sessionName: "asks", paneId: "%1" }],
      capture: () => PANE,
      tmuxGeneration: async () => 7,
      fetchImpl,
    },
  };
}

function onlyProposalKind(list: AttentionList): string {
  if (list.kind === "unknown") throw new Error(`expected an item, got unknown: ${list.why}`);
  const item = list.items[0];
  if (item === undefined) throw new Error("expected an item");
  return item.proposal.kind;
}

function rememberedVersions(root: string): (number | null)[] {
  const read = readAttentionMemory(root);
  if (read.kind !== "memory") throw new Error(`expected memory, got ${read.kind}`);
  return [...read.memory.verdicts.values()].map((v) => v.promptVersion);
}

async function runCommand(root: string, s: AttentionSeams): Promise<AttentionList> {
  let printed = "";
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    printed += String(line);
  });
  const code = await runAttentionCommand(
    { root, maxCalls: 12, dry: false, json: true, write: true, out: null, panes: null, captureTo: null },
    s,
  );
  expect(code).toBe(0);
  return (JSON.parse(printed) as { list: AttentionList }).list;
}

describe("OVERSEER_PROPOSALS reaches both halves of both compositions", () => {
  it("the daemon's runner: on ⇒ version 2 asked, filed and proposed", async () => {
    const root = tempRoot();
    const { seams: s, systems } = seams(true);
    const run = attentionRunner(root, "test-instance", s);
    if (run === null) throw new Error("expected a runner");
    const list = await run();
    expect(systems).toEqual([buildClassifierPrompt("x", PROPOSAL_PROMPT_VERSION).system]);
    expect(rememberedVersions(root)).toEqual([PROPOSAL_PROMPT_VERSION]);
    expect(onlyProposalKind(list)).toBe("proposed");
  });

  it("the daemon's runner: off ⇒ version 1 asked, filed, and every card `off`", async () => {
    const root = tempRoot();
    const { seams: s, systems } = seams(false);
    const run = attentionRunner(root, "test-instance", s);
    if (run === null) throw new Error("expected a runner");
    const list = await run();
    expect(systems).toEqual([buildClassifierPrompt("x", CLASSIFIER_PROMPT_VERSION).system]);
    expect(rememberedVersions(root)).toEqual([CLASSIFIER_PROMPT_VERSION]);
    expect(onlyProposalKind(list)).toBe("off");
  });

  it("the hand-run command: on ⇒ version 2 asked, filed and proposed", async () => {
    const root = tempRoot();
    const { seams: s, systems } = seams(true);
    const list = await runCommand(root, s);
    expect(systems).toEqual([buildClassifierPrompt("x", PROPOSAL_PROMPT_VERSION).system]);
    expect(rememberedVersions(root)).toEqual([PROPOSAL_PROMPT_VERSION]);
    expect(onlyProposalKind(list)).toBe("proposed");
  });

  it("the hand-run command: off ⇒ version 1 asked, filed, and every card `off`", async () => {
    const root = tempRoot();
    const { seams: s, systems } = seams(false);
    const list = await runCommand(root, s);
    expect(systems).toEqual([buildClassifierPrompt("x", CLASSIFIER_PROMPT_VERSION).system]);
    expect(rememberedVersions(root)).toEqual([CLASSIFIER_PROMPT_VERSION]);
    expect(onlyProposalKind(list)).toBe("off");
  });

  it("the daemon's runner still declines to run without a key, proposals or not", () => {
    const { seams: s } = seams(true);
    expect(attentionRunner(tempRoot(), "test-instance", { ...s, apiKey: () => null })).toBeNull();
  });
});

describe("the hand run's words for a proposal (GPT Sol's F16)", () => {
  it("never lets a model identifier stand where a speaker's name would, even one that reads `Greg`", () => {
    const text = describeList({
      kind: "list",
      items: [
        {
          id: "i",
          sessionId: "$1",
          sessionName: "asks",
          waitingSince: "2026-09-08T13:50:00.000Z",
          kind: "irreversible",
          evidence: { kind: "prose", excerpt: "Say the word and I'll shut it down.", why: "it offered and stopped" },
          answerability: { kind: "phone" },
          duplicates: [],
          proposal: {
            kind: "proposed",
            id: "fp:v2:Greg",
            recipient: "fable",
            reason: "it is a question of wording",
            asks: "Say the word and I'll shut it down.",
            by: { kind: "model", model: "Greg", via: "overseer" },
            reach: { kind: "available" },
          },
        },
      ],
      sessionsScanned: 1,
      sessionsUnreadable: 0,
      scannedAt: "2026-09-08T14:00:00.000Z",
    }).join("\n");
    expect(text).toContain("Greg");
    expect(text).not.toMatch(/by greg/i);
    expect(text.match(/Greg/g)?.length).toBe(text.match(/model: Greg/g)?.length);
  });
});

/**
 * The generation and the listing are separate awaited children now, so a tmux
 * restart can land between them: the generation of the OLD server beside a
 * listing from the NEW one, whose `$1` is a different session. The runner
 * therefore reads the generation on both sides of the listing, and a pass that
 * cannot show they agree runs as "generation unknown", which carries no wait in
 * from a real generation.
 */
describe("the daemon's runner brackets the listing with the tmux generation", () => {
  function epochOf(root: string): string | null {
    const read = readAttentionMemory(root);
    if (read.kind !== "memory") throw new Error(`expected memory, got ${read.kind}`);
    return read.memory.epoch;
  }

  /** Seams whose generation answers come from a script, recording the order of the two reads. */
  function bracketed(generations: (number | null)[]): { seams: AttentionSeams; order: string[] } {
    const order: string[] = [];
    const base = seams(false).seams;
    return {
      order,
      seams: {
        ...base,
        tmuxGeneration: async () => {
          order.push("generation");
          return generations.shift() ?? null;
        },
        listSessions: async () => {
          order.push("list");
          return [{ sessionId: "$1", sessionName: "asks", paneId: "%1" }];
        },
      },
    };
  }

  it("a generation that is the same before and after the listing is the pass's epoch", async () => {
    const root = tempRoot();
    const { seams: s, order } = bracketed([7, 7]);
    const run = attentionRunner(root, "test-instance", s);
    if (run === null) throw new Error("expected a runner");
    await run();
    expect(order).toEqual(["generation", "list", "generation"]);
    expect(epochOf(root)).toBe("test-instance:tmux-7");
  });

  it("a generation that moved across the listing is unknown, so no wait is carried onto it", async () => {
    const root = tempRoot();
    const first = attentionRunner(root, "test-instance", bracketed([7, 7]).seams);
    if (first === null) throw new Error("expected a runner");
    await first();
    const before = readAttentionMemory(root);
    if (before.kind !== "memory") throw new Error("expected memory");
    const waitsBefore = [...before.memory.waits.values()];
    expect(waitsBefore.length).toBeGreaterThan(0);

    const { seams: s, order } = bracketed([7, 8]);
    const second = attentionRunner(root, "test-instance", s);
    if (second === null) throw new Error("expected a runner");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await second();
    expect(order).toEqual(["generation", "list", "generation"]);
    expect(epochOf(root)).toBe("test-instance:tmux-unknown");
    // The same `$1`, asking the same thing — and its wait starts again, because
    // nothing shows it is the session the first pass was timing.
    const after = readAttentionMemory(root);
    if (after.kind !== "memory") throw new Error("expected memory");
    expect([...after.memory.waits.values()]).not.toEqual(waitsBefore);
  });

  it("a generation tmux could not give on either side is unknown too", async () => {
    const root = tempRoot();
    const run = attentionRunner(root, "test-instance", bracketed([7, null]).seams);
    if (run === null) throw new Error("expected a runner");
    await run();
    expect(epochOf(root)).toBe("test-instance:tmux-unknown");
  });
});
