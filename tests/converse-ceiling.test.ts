/**
 * **The token ceiling a reader's answer is sent with, by model.**
 *
 * `max_tokens` covers the model's thinking as well as its answer, and the
 * high-power model is sent `effort: "high"` (src/ai-call.ts § `wireEffort`), so
 * a ceiling sized for the standard model is one Opus can spend thinking. Chat's
 * 4,000 and explain's 1,500 were both sized that way.
 * docs/plans/261009e-high-powered-chat-cut-off-at-its-ceiling.md.
 *
 * What is pinned is the request body each call puts on the wire — the one
 * thing the provider sees — not a constant that might not reach it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHAT_HIGH_POWER_ANSWER_TOKENS, converse } from "../src/converse.js";
import { DIG_ANSWER_TOKENS } from "../src/dig-deeper.js";
import { explainStream } from "../src/explain.js";
import { HIGH_POWER_MODEL_OPENROUTER, isHighPowerModel } from "../src/high-power-model.js";
import { modelFor } from "../src/models.js";
import type { Block, Meta } from "../src/types.js";

const meta = { title: "A piece", url: "https://example.com/a" } as Meta;
const blocks = [{ id: "spya-k3m9qt", html: "<p>alpha</p>", text: "alpha" }] as Block[];

const encoder = new TextEncoder();
const finishedBody = () =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ model: "test/model", choices: [{ delta: { content: "Because." } }] })}\n\n`,
        ),
      );
      c.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ finish_reason: "stop", delta: {} }] })}\n\n`));
      c.enqueue(encoder.encode("data: [DONE]\n\n"));
      c.close();
    },
  });

/** Every request body `fetch` was handed, parsed. */
let sent: Array<{ model: string; max_tokens?: number }>;

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)) as { model: string; max_tokens?: number });
      return { ok: true, status: 200, headers: new Headers(), body: finishedBody() } as Response;
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function chatCeiling(opts: {
  power: "standard" | "high";
  kind?: "chat" | "candidates";
  model?: string;
}) {
  for await (const _ of converse({
    power: opts.power,
    ...(opts.kind ? { kind: opts.kind } : {}),
    ...(opts.model ? { model: opts.model } : {}),
    meta,
    blocks,
    history: [],
    question: "why?",
    slug: "example",
  })) {
    // drain
  }
  return sent.map((b) => ({ model: b.model, ceiling: b.max_tokens }));
}

async function explainCeiling(power: "standard" | "high", model?: string) {
  for await (const _ of explainStream({
    power,
    ...(model ? { model } : {}),
    meta,
    blocks,
    blockId: "spya-k3m9qt",
    quote: "alpha",
  })) {
    // drain
  }
  return sent.map((b) => ({ model: b.model, ceiling: b.max_tokens }));
}

describe("chat's ceiling", () => {
  it("is 4,000 on the standard model", async () => {
    const [request] = await chatCeiling({ power: "standard" });
    expect(isHighPowerModel(request?.model ?? "")).toBe(false);
    expect(request?.ceiling).toBe(4_000);
  });

  it("is 6,000 on the high-power model, which thinks at `high` out of the same allowance", async () => {
    const [request] = await chatCeiling({ power: "high" });
    /* The precondition: a high-powered turn really is on the high-power model.
       If that ever stops being true this test says so rather than passing. */
    expect(request?.model).toBe(HIGH_POWER_MODEL_OPENROUTER);
    expect(request?.ceiling).toBe(CHAT_HIGH_POWER_ANSWER_TOKENS);
    expect(CHAT_HIGH_POWER_ANSWER_TOKENS).toBe(6_000);
  });

  it("keeps Candidates at 12,000 on either model", async () => {
    expect((await chatCeiling({ power: "standard", kind: "candidates" }))[0]?.ceiling).toBe(12_000);
    sent = [];
    expect((await chatCeiling({ power: "high", kind: "candidates" }))[0]?.ceiling).toBe(12_000);
  });
});

/* **Keyed on the model, not on `power`** — a production environment override
   can put either power on either model, and it is the model that is sent `high`
   (`wireEffort`). These cases set the real task override rather than passing
   `model`, which is the test/eval seam. GPT Sol, plan 261009e F3. */
describe("the ceiling follows the model actually sent", () => {
  it("chat: a production override to the high-power model gets the high-power ceiling", async () => {
    vi.stubEnv("SPIDERYARN_CHAT_MODEL", HIGH_POWER_MODEL_OPENROUTER);
    const [request] = await chatCeiling({ power: "standard" });
    expect(request?.model).toBe(HIGH_POWER_MODEL_OPENROUTER);
    expect(request?.ceiling).toBe(CHAT_HIGH_POWER_ANSWER_TOKENS);
  });

  it("chat: a production override away from the high-power model gets the standard ceiling", async () => {
    const other = modelFor("chat", "standard");
    expect(isHighPowerModel(other)).toBe(false);
    vi.stubEnv("SPIDERYARN_CHAT_MODEL", other);
    const [request] = await chatCeiling({ power: "high" });
    expect(request?.model).toBe(other);
    expect(request?.ceiling).toBe(4_000);
  });

  it("explain: likewise in both directions", async () => {
    vi.stubEnv("SPIDERYARN_EXPLAIN_MODEL", HIGH_POWER_MODEL_OPENROUTER);
    expect((await explainCeiling("standard"))[0]?.ceiling).toBe(DIG_ANSWER_TOKENS);
    sent = [];
    vi.unstubAllEnvs();
    const other = modelFor("explain", "standard");
    expect(isHighPowerModel(other)).toBe(false);
    vi.stubEnv("SPIDERYARN_EXPLAIN_MODEL", other);
    expect((await explainCeiling("high"))[0]?.ceiling).toBe(1_500);
  });
});

describe("explain's ceiling", () => {
  it("is 1,500 on the standard model", async () => {
    const [request] = await explainCeiling("standard");
    expect(request?.model).toBe(modelFor("explain", "standard"));
    expect(request?.ceiling).toBe(1_500);
  });

  it("is dig deeper's 4,000 on the high-power model, where a probe stopped at 1,500", async () => {
    const [request] = await explainCeiling("high");
    expect(isHighPowerModel(request?.model ?? "")).toBe(true);
    expect(request?.ceiling).toBe(DIG_ANSWER_TOKENS);
  });
});
