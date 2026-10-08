/**
 * **An answer stores the thinking it was given, and it is what was sent** —
 * plan 261008c § 2 (Greg, spya-pd9fnc: *"which model it had been using, and
 * perhaps even thinking level"*).
 *
 * The stored `effort` is only worth showing if it is the wire's value, so this
 * goes through `converse` with `fetch` stubbed and compares the `done` event's
 * `effort` with the `reasoning` the request body actually carried — at both
 * powers, because the high-power model is the one that gets an effort sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReasoningEffort } from "../src/ai-call.js";
import { converse } from "../src/converse.js";
import type { ModelPower } from "../src/models.js";
import type { AnswerEffort, Block, Meta } from "../src/types.js";

/* `AnswerEffort` is a literal copy for the browser's sake; it must be the
   wire's ladder plus "default", exactly. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameLadder: Same<AnswerEffort, ReasoningEffort | "default"> = true;

const meta = { title: "A piece", url: "https://example.com/a" } as Meta;
const blocks = [{ id: "spya-k3m9qt", html: "<p>alpha</p>", text: "alpha" }] as Block[];

function answered(): Response {
  const encoder = new TextEncoder();
  const frames = [
    `data: ${JSON.stringify({ model: "anthropic/claude-sonnet-5", choices: [{ delta: { content: "Because [spya-k3m9qt]." } }] })}\n\n`,
    `data: ${JSON.stringify({ model: "anthropic/claude-sonnet-5", choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    "data: [DONE]\n\n",
  ];
  return {
    ok: true,
    headers: new Headers(),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const f of frames) controller.enqueue(encoder.encode(f));
        controller.close();
      },
    }),
  } as unknown as Response;
}

let bodies: Record<string, unknown>[] = [];
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  bodies = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return answered();
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function finish(power: ModelPower) {
  let done: { effort: AnswerEffort } | null = null;
  for await (const event of converse({ power, meta, blocks, history: [], question: "why?", slug: "example" })) {
    if (event.type === "done") done = event;
  }
  return done;
}

describe("the effort an answer stores", () => {
  it("is the literal ladder the wire takes, plus default", () => {
    expect(sameLadder).toBe(true);
  });

  for (const power of ["standard", "high"] as const) {
    it(`is what the request carried, at ${power} power`, async () => {
      const done = await finish(power);
      expect(done, "control: the answer finished").not.toBeNull();
      expect(bodies.length).toBeGreaterThan(0);
      const sent = (bodies[0]?.reasoning as { effort?: string } | undefined)?.effort;
      expect(done?.effort).toBe(sent ?? "default");
    });
  }

  it("says default when nothing was sent, and high on the high-power model", async () => {
    expect((await finish("standard"))?.effort).toBe("default");
    expect((await finish("high"))?.effort).toBe("high");
  });
});
