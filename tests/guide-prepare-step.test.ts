/**
 * **The guide's `prepare` step, on the server** — plan
 * docs/plans/261019p-guide-chat-plainer.md § Stage 2b (Greg's reply to
 * q-y4p2ct). The list it may name, and the guards that keep `now` — the one
 * press the page makes by itself — to a typed turn, once a conversation, and
 * off Skim beside a reason offer. The thread's durable claim and the route are
 * tests/guide-prepare-route.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTool, type ToolContext } from "../src/chat-tools.js";
import { converse, type ConverseEvent } from "../src/converse.js";
import { guideModeKeys } from "../src/guide.js";
import { checkNextSteps, startedAMode } from "../src/next-steps.js";
import { PREPARABLE } from "../src/preparable-modes.js";
import type { Block, ChatMessage, Meta } from "../src/types.js";

const ctx = (over: Partial<ToolContext> = {}): ToolContext => ({
  slug: "s",
  kind: "guide",
  meta: {} as Meta,
  blocks: [] as Block[],
  power: "standard",
  saved: { purpose: null, profile: null },
  typed: "I want to know whether to cite this",
  ...over,
});
const prepare = (mode: string, now: boolean) => ({ steps: [{ kind: "prepare", mode, now }] });

describe("the list a prepare step may name", () => {
  it("is inside the guide's own modes, and leaves out Summary's bare key", () => {
    const keys = guideModeKeys();
    for (const key of Object.keys(PREPARABLE)) expect(keys.has(key), key).toBe(true);
    expect(Object.keys(PREPARABLE)).not.toContain("mode:summary");
  });

  it("refuses a key off it, keeps one prepare step, and reads now as a strict true", () => {
    const { steps, problems } = checkNextSteps([
      { kind: "prepare", mode: "mode:sources" },
      { kind: "prepare", mode: "mode:skim", now: "yes" },
      { kind: "prepare", mode: "mode:glossary", now: true },
    ]);
    expect(steps).toEqual([{ kind: "prepare", mode: "mode:skim", now: false }]);
    expect(problems.join()).toMatch(/not a mode that can be prepared/);
    expect(problems.join()).toMatch(/only one prepare step/);
  });
});

describe("offer_next_steps with a prepare step", () => {
  it("keeps now on a turn the reader typed", async () => {
    const out = await runTool("offer_next_steps", prepare("mode:skim", true), ctx());
    expect(out.steps).toEqual([{ kind: "prepare", mode: "mode:skim", now: true }]);
    expect(out.content).toMatch(/never say a mode is ready/);
  });

  it("makes it a button on a turn the reader did not type", async () => {
    for (const typed of [null, undefined]) {
      const out = await runTool("offer_next_steps", prepare("mode:glossary", true), ctx({ typed }));
      expect(out.steps).toEqual([{ kind: "prepare", mode: "mode:glossary", now: false }]);
      expect(out.content).toMatch(/only after a message the reader typed/);
    }
  });

  it("makes it a button once an earlier answer started one", async () => {
    const out = await runTool("offer_next_steps", prepare("mode:glossary", true), ctx({ preparedEarlier: true }));
    expect(out.steps).toEqual([{ kind: "prepare", mode: "mode:glossary", now: false }]);
    expect(out.content).toMatch(/already been started once/);
  });

  it("drops Skim, pressed or not, in an answer that offered a reason, but not another mode", async () => {
    const turn = ctx();
    const offered = await runTool("offer_to_save", { field: "reason", text: "To decide whether to cite it" }, turn);
    expect(offered.offer?.field).toBe("purpose");
    for (const now of [true, false]) {
      const out = await runTool("offer_next_steps", prepare("mode:skim", now), turn);
      expect(out.steps).toBeUndefined();
      expect(out.content).toMatch(/same answer as an offer to save their reason/);
    }
    const other = await runTool("offer_next_steps", prepare("mode:glossary", true), turn);
    expect(other.steps).toEqual([{ kind: "prepare", mode: "mode:glossary", now: true }]);
    /* About you is not a reason: Skim stays. */
    const aboutYou = ctx();
    await runTool("offer_to_save", { field: "about_you", text: "I am a statistician." }, aboutYou);
    const skim = await runTool("offer_next_steps", prepare("mode:skim", true), aboutYou);
    expect(skim.steps).toEqual([{ kind: "prepare", mode: "mode:skim", now: true }]);
  });
});

describe("startedAMode", () => {
  const answered = (steps: unknown): Pick<ChatMessage, "tools"> => ({
    tools: [{ name: "offer_next_steps", label: "offered next steps", status: "done", steps } as never],
  });
  it("is true only for an accepted prepare step marked now", () => {
    expect(startedAMode(answered([{ kind: "prepare", mode: "mode:skim", now: true }]))).toBe(true);
    expect(startedAMode(answered([{ kind: "prepare", mode: "mode:skim", now: false }]))).toBe(false);
    expect(startedAMode(answered([{ kind: "prepare", mode: "mode:nonsense", now: true }]))).toBe(false);
    expect(startedAMode({})).toBe(false);
  });
});

/* ------------------------------------------------------- converse -- */

const frame = (body: unknown) => `data: ${JSON.stringify(body)}\n\n`;
function body(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const f of frames) c.enqueue(encoder.encode(f));
      c.enqueue(encoder.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
}
const offer = (args: unknown) =>
  frame({
    model: "test/model",
    choices: [
      {
        delta: {
          content: "Start at the method.",
          tool_calls: [{ index: 0, id: "toolu_0", type: "function", function: { name: "offer_next_steps", arguments: JSON.stringify(args) } }],
        },
      },
    ],
  });
const endsWithTools = frame({ choices: [{ finish_reason: "tool_calls", delta: {} }] });

async function stepsAfter(history: ChatMessage[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, headers: new Headers(), body: body([offer(prepare("mode:skim", true)), endsWithTools]) }) as Response),
  );
  let done: Extract<ConverseEvent, { type: "done" }> | undefined;
  for await (const event of converse({
    power: "standard",
    meta: { title: "A piece", url: "https://example.com/a" } as Meta,
    blocks: [{ id: "spya-k3m9qt", html: "<p>alpha</p>", text: "alpha" }] as Block[],
    history,
    question: "Help me decide whether to cite it",
    typed: "Help me decide whether to cite it",
    slug: "example",
    kind: "guide",
    saved: { purpose: null, profile: null },
  })) {
    if (event.type === "done") done = event;
  }
  return done?.tools?.[0]?.steps;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("converse reads the conversation's earlier start", () => {
  const earlier = (now: boolean): ChatMessage[] => [
    { id: "q1", role: "user", text: "hi", status: "done" } as ChatMessage,
    {
      id: "a1",
      role: "assistant",
      text: "Start here.",
      status: "done",
      tools: [{ name: "offer_next_steps", label: "offered next steps", status: "done", steps: [{ kind: "prepare", mode: "mode:glossary", now }] }],
    } as ChatMessage,
  ];

  it("keeps now when no earlier answer started a mode", async () => {
    expect(await stepsAfter(earlier(false))).toEqual([{ kind: "prepare", mode: "mode:skim", now: true }]);
  });

  it("makes it a button when one did", async () => {
    expect(await stepsAfter(earlier(true))).toEqual([{ kind: "prepare", mode: "mode:skim", now: false }]);
  });
});
