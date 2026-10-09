/**
 * **The guide's next steps, on the server** — plan
 * docs/plans/261009u-the-guide-offers-next-steps-as-buttons-and-a-press-to-start-an-action.md.
 *
 * The tool's checks (src/next-steps.ts through `runTool`), who is offered it,
 * and `converse` ending the turn on a round that asked only for it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { GUIDE_TOOLS, runTool, toolsFor } from "../src/chat-tools.js";
import { converse, type ConverseEvent } from "../src/converse.js";
import { checkNextSteps, MAX_ASK_CHARS } from "../src/next-steps.js";
import type { Block, Meta } from "../src/types.js";

const ctx = (kind: "guide" | "chat") => ({ slug: "s", kind, meta: {} as Meta, blocks: [] as Block[], power: "standard" as const });
const names = (tools: { function: { name: string } }[]) => tools.map((t) => t.function.name);

describe("offer_next_steps, the tool", () => {
  it("is offered to a typed guide only, and not to Live's guide", () => {
    expect(names(toolsFor("guide"))).toContain("offer_next_steps");
    expect(names(GUIDE_TOOLS)).not.toContain("offer_next_steps");
    for (const kind of ["chat", "learn", "tutorial", "explore", "candidates"] as const) {
      expect(names(toolsFor(kind))).not.toContain("offer_next_steps");
    }
  });

  it("is refused outside a guide, running nothing", async () => {
    const out = await runTool("offer_next_steps", { steps: [{ kind: "share" }] }, ctx("chat"));
    expect(out.steps).toBeUndefined();
    expect(out.content).toMatch(/no tool called/);
  });

  it("hands back each of the five kinds, checked", async () => {
    const out = await runTool(
      "offer_next_steps",
      {
        steps: [
          { kind: "ask", words: "  Help me pick\nwhat to read closely " },
          { kind: "mode", mode: "submode:summary:brief" },
          { kind: "search", words: "attention heads" },
        ],
      },
      ctx("guide"),
    );
    expect(out.steps).toEqual([
      { kind: "ask", words: "Help me pick what to read closely" },
      { kind: "mode", mode: "submode:summary:brief" },
      { kind: "search", words: "attention heads" },
    ]);
    expect(out.content).toMatch(/never write any of it\s+again/);
    const actions = await runTool("offer_next_steps", { steps: [{ kind: "share" }, { kind: "archive" }] }, ctx("guide"));
    expect(actions.steps).toEqual([{ kind: "share" }, { kind: "archive" }]);
  });

  it("drops what it cannot draw, and says so", async () => {
    const out = await runTool(
      "offer_next_steps",
      {
        steps: [
          { kind: "publish" },
          { kind: "mode", mode: "mode:not-a-mode" },
          { kind: "ask", words: "x".repeat(MAX_ASK_CHARS + 1) },
          { kind: "ask", words: "   " },
          { kind: "share" },
        ],
      },
      ctx("guide"),
    );
    expect(out.steps).toEqual([{ kind: "share" }]);
    expect(out.content).toMatch(/Left out/);
  });

  it("shows nothing when nothing is valid, and tells the model not to mention a button", async () => {
    const out = await runTool("offer_next_steps", { steps: "share" }, ctx("guide"));
    expect(out.steps).toBeUndefined();
    expect(out.content).toMatch(/Do not mention any button/);
  });

  it("keeps three at most, and no duplicates", () => {
    const { steps, problems } = checkNextSteps([
      { kind: "share" },
      { kind: "share" },
      { kind: "archive" },
      { kind: "ask", words: "a" },
      { kind: "ask", words: "b" },
    ]);
    expect(steps).toEqual([{ kind: "share" }, { kind: "archive" }, { kind: "ask", words: "a" }]);
    expect(problems.join()).toMatch(/only the first 3/);
  });
});

/* ------------------------------------------------------- converse -- */

const meta = { title: "A piece", url: "https://example.com/a" } as Meta;
const blocks = [{ id: "spya-k3m9qt", html: "<p>alpha</p>", text: "alpha" }] as Block[];
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

const toolCall = (name: string, args: unknown, content?: string) =>
  frame({
    model: "test/model",
    choices: [
      {
        delta: {
          ...(content === undefined ? {} : { content }),
          tool_calls: [{ index: 0, id: `toolu_${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
        },
      },
    ],
  });
const endsWithTools = frame({ choices: [{ finish_reason: "tool_calls", delta: {} }] });
const endsWithLength = frame({ choices: [{ finish_reason: "length", delta: {} }] });
const usage = (input: number, output: number) =>
  frame({ choices: [], usage: { prompt_tokens: input, completion_tokens: output } });
const answer = (text: string) => [
  frame({ model: "test/model", choices: [{ delta: { content: text } }] }),
  frame({ choices: [{ finish_reason: "stop", delta: {} }] }),
];

async function run(rounds: string[][], runToolWith?: typeof runTool) {
  let n = 0;
  const sent: Record<string, unknown>[] = [];
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return { ok: true, status: 200, headers: new Headers(), body: body(rounds[n++] ?? []) } as Response;
  });
  vi.stubGlobal("fetch", fetch);
  let done: Extract<ConverseEvent, { type: "done" }> | undefined;
  for await (const event of converse({
    power: "standard",
    meta,
    blocks,
    history: [],
    question: "Where should I start?",
    slug: "example",
    kind: "guide",
    saved: { purpose: null, profile: null },
    ...(runToolWith === undefined ? {} : { runToolWith }),
  })) {
    if (event.type === "done") done = event;
  }
  return { requests: fetch.mock.calls.length, sent, done };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("converse, when the guide offers its next steps", () => {
  it("stops after a round that asked only for them, once the answer has words", async () => {
    const { requests, done } = await run([
      [toolCall("offer_next_steps", { steps: [{ kind: "share" }] }, "Start with the abstract."), endsWithTools],
      answer("Start with the abstract."),
    ]);
    expect(requests).toBe(1);
    expect(done?.text).toBe("Start with the abstract.");
    expect(done?.tools?.[0]?.steps).toEqual([{ kind: "share" }]);
  });

  it("keeps the terminal round's usage and truncation verdict", async () => {
    const { requests, done } = await run([
      [
        toolCall("offer_next_steps", { steps: [{ kind: "share" }] }, "Start with the abstract, because"),
        usage(123, 45),
        endsWithLength,
      ],
    ]);
    expect(requests).toBe(1);
    expect(done?.usage).toMatchObject({ inputTokens: 123, outputTokens: 45 });
    expect(done?.truncated).toBe(true);
    expect(done?.tools[0]?.steps).toEqual([{ kind: "share" }]);
  });

  it("goes round again when the answer has no words yet", async () => {
    const { requests, done } = await run([
      [toolCall("offer_next_steps", { steps: [{ kind: "share" }] }), endsWithTools],
      answer("Start with the abstract."),
    ]);
    expect(requests).toBe(2);
    expect(done?.text).toBe("Start with the abstract.");
  });

  it("goes round again when another tool was asked for in the same round", async () => {
    const both = frame({
      model: "test/model",
      choices: [
        {
          delta: {
            content: "Start with the abstract.",
            tool_calls: [
              { index: 0, id: "toolu_a", type: "function", function: { name: "offer_next_steps", arguments: JSON.stringify({ steps: [{ kind: "share" }] }) } },
              { index: 1, id: "toolu_b", type: "function", function: { name: "offer_to_save", arguments: JSON.stringify({ field: "reason", text: "For a club." }) } },
            ],
          },
        },
      ],
    });
    const { requests, done } = await run([[both, endsWithTools], answer("You can save it with the button.")]);
    expect(requests).toBe(2);
    /* Both runs survive, each carrying what its card or row is drawn from. */
    expect(done?.tools?.map((t) => t.name)).toEqual(["offer_next_steps", "offer_to_save"]);
    expect(done?.tools?.[0]?.steps).toEqual([{ kind: "share" }]);
    expect(done?.tools?.[1]?.offer).toMatchObject({ field: "purpose", text: "For a club." });
    expect(done?.text).toBe("Start with the abstract.\n\nYou can save it with the button.");
  });

  /* GPT Sol's F1 on the plan: the turn's text is not this round's. */
  it("goes round again when only an earlier round wrote words", async () => {
    const { requests, done } = await run([
      [toolCall("search_article_words", { query: "abstract" }, "Let me check where that is."), endsWithTools],
      [toolCall("offer_next_steps", { steps: [{ kind: "share" }] }), endsWithTools],
      answer("It is in the first section."),
    ]);
    expect(requests).toBe(3);
    expect(done?.text).toBe("Let me check where that is.\n\nIt is in the first section.");
  });

  it("reaches the tool-disabled last round when a late offer has no prose of its own", async () => {
    const { requests, sent, done } = await run([
      [toolCall("search_article_words", { query: "abstract" }, "Let me check where that is."), endsWithTools],
      [toolCall("search_article_words", { query: "method" }), endsWithTools],
      [toolCall("offer_next_steps", { steps: [{ kind: "share" }] }), endsWithTools],
      answer("It is in the first section."),
    ]);
    expect(requests).toBe(4);
    expect(sent.at(-1)?.tool_choice).toBe("none");
    expect(done?.text).toBe("Let me check where that is.\n\nIt is in the first section.");
    expect(done?.tools.at(-1)?.steps).toEqual([{ kind: "share" }]);
  });

  /* F2: an offer that drew nothing goes back, so the model hears that no
     button is shown. */
  it("goes round again when the offer was refused", async () => {
    const { requests, done } = await run([
      [toolCall("offer_next_steps", { steps: [{ kind: "publish" }] }, "Start with the abstract."), endsWithTools],
      answer(""),
    ]);
    expect(requests).toBe(2);
    expect(done?.tools?.[0]?.steps).toBeUndefined();
    expect(done?.text).toBe("Start with the abstract.");
  });

  it("goes round again when the offer tool throws", async () => {
    const { requests, done } = await run(
      [
        [toolCall("offer_next_steps", { steps: [{ kind: "share" }] }, "Start with the abstract."), endsWithTools],
        answer("I could not offer buttons."),
      ],
      async (name, args, context) => {
        if (name === "offer_next_steps") throw new Error("test failure");
        return runTool(name, args, context);
      },
    );
    expect(requests).toBe(2);
    expect(done?.tools[0]).toMatchObject({ name: "offer_next_steps", status: "error" });
    expect(done?.text).toBe("Start with the abstract.\n\nI could not offer buttons.");
  });
});
