/**
 * **The two lines both AI wires log about a failure** — `ai transport retry` as
 * a retry's attempt starts, `ai call died part-way` when a call fails after its
 * answer began. Plan
 * docs/plans/261006b-count-ai-calls-that-die-part-way-and-transport-retries.md.
 *
 * What is asserted is what a line carries **and that it carries nothing else**:
 * job, wire, model, attempt, class and status. Every fixture puts a sentence
 * about badgers where a provider's or a reader's words would be — in an error's
 * message, a cause's code, an error chunk — and the capture is searched for it.
 *
 * In-process, through tests/helpers/log-capture.ts, whose header says why a
 * spy on `process.stdout` would capture nothing and pass anyway.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* `LOG_LEVEL` before the imports: src/log.ts reads it once, at load, and is
   `silent` under vitest. tests/helpers/log-capture.ts § 1. */
const HOISTED = vi.hoisted(() => {
  const previousLevel = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = "warn";
  return { previousLevel };
});

import { openRouterJson, openRouterStream } from "../src/ai-call.js";
import { collectSpend } from "../src/ai-spend.js";
import { CallDeadlineReached, StallReached } from "../src/call-failure.js";
import { streamMessage } from "../src/messages-stream.js";
import { logLinesWhile } from "./helpers/log-capture.js";

afterAll(() => {
  if (HOISTED.previousLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = HOISTED.previousLevel;
});

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "sk-test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const SECRET = "the reader asked about badgers";

/** One step per request: reject with this, or answer with that. Past the end is a plain `Error`, which nothing retries. */
function script(...steps: (Error | (() => Response))[]): void {
  let n = 0;
  vi.stubGlobal("fetch", async () => {
    const step = steps[n++];
    if (step === undefined) throw new Error("the script ran out");
    if (step instanceof Error) throw step;
    return step();
  });
}

/** A dropped connection, with a code and with words that must go nowhere. */
const dropped = () =>
  new TypeError(SECRET, { cause: Object.assign(new Error(SECRET), { code: "ECONNRESET", name: SECRET }) });

const whole = (status: number, body: unknown) => () =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

const sse = (...frames: string[]) => () =>
  new Response(frames.join(""), { status: 200, headers: { "content-type": "text/event-stream" } });

const frame = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
const event = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

const MESSAGE_START = event("message_start", {
  type: "message_start",
  message: {
    id: "gen-1",
    type: "message",
    role: "assistant",
    model: "anthropic/claude-sonnet-5",
    content: [],
    stop_reason: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  },
});
const MESSAGE_DONE =
  event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) +
  event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } }) +
  event("content_block_stop", { type: "content_block_stop", index: 0 }) +
  event("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } }) +
  event("message_stop", { type: "message_stop" });

/** What the logger itself puts on every line (src/log.ts). Everything else on a line is ours. */
const PINO = new Set(["level", "time", "pid", "hostname", "service", "env", "component", "msg"]);

/** Run `body` in a collector, swallowing its error; hand back the captured lines whose `msg` is `msg`, and the whole capture. */
async function linesSaying(msg: string, body: () => Promise<unknown>): Promise<{ lines: Record<string, unknown>[]; all: string }> {
  const all = await logLinesWhile(async () => {
    await collectSpend(async () => {
      await body().catch(() => undefined);
    });
  });
  const lines = all
    .split("\n")
    .filter((l) => l.trim().startsWith("{"))
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((l) => l.msg === msg);
  return { lines, all };
}

/** A line's own fields, without pino's. */
const ours = (line: Record<string, unknown> | undefined): Record<string, unknown> =>
  Object.fromEntries(Object.entries(line ?? {}).filter(([k]) => !PINO.has(k)));

const drain = async (stream: AsyncIterable<{ error?: unknown }>) => {
  for await (const c of stream) if (c.error) throw new Error("the provider stopped mid-answer");
};
const chat = () =>
  drain(
    openRouterStream(
      "chat",
      { model: "m", messages: [] },
      { signal: new AbortController().signal, onActivity: () => {}, end: { terminated: false } },
    ),
  );
const pdf = (retryTransport?: false) =>
  openRouterJson("pdf", { model: "m", messages: [] }, retryTransport === false ? { retryTransport } : undefined);
const arc = () =>
  streamMessage("arc", { max_tokens: 16, messages: [{ role: "user", content: "x" }] }, { power: "standard" }).finalMessage();

describe("ai transport retry", () => {
  it("is one warn line as the retry starts, on a whole call", async () => {
    script(dropped(), whole(200, { choices: [{ message: { content: "ok" } }] }));
    const { lines, all } = await linesSaying("ai transport retry", () => pdf());
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe("warn");
    expect(ours(lines[0])).toEqual({
      job: "pdf",
      wire: "chat",
      model: "m",
      attempt: 2,
      class: "network:ECONNRESET",
      status: null,
    });
    expect(all).not.toContain("badgers");
  });

  it("is one line per retry on a stream, with the status that caused it", async () => {
    script(whole(503, { error: { message: SECRET } }), dropped(), sse(frame({ choices: [{ delta: { content: "hi" } }] }), "data: [DONE]\n\n"));
    const { lines, all } = await linesSaying("ai transport retry", chat);
    expect(lines.map(ours)).toEqual([
      { job: "chat", wire: "chat", model: "m", attempt: 2, class: "refused", status: 503 },
      { job: "chat", wire: "chat", model: "m", attempt: 3, class: "network:ECONNRESET", status: null },
    ]);
    expect(all).not.toContain("badgers");
  });

  it("is one line on the Messages wire, under the same six names", async () => {
    script(dropped(), sse(MESSAGE_START, MESSAGE_DONE));
    const { lines, all } = await linesSaying("ai transport retry", arc);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe("warn");
    expect(ours(lines[0])).toMatchObject({ job: "arc", wire: "messages", attempt: 2, class: "network:ECONNRESET", status: null });
    expect(Object.keys(ours(lines[0])).sort()).toEqual(["attempt", "class", "job", "model", "status", "wire"]);
    expect(all).not.toContain("badgers");
  });

  it("is not logged for a failure nothing asked again about", async () => {
    script(whole(400, { error: { message: SECRET } }));
    const refused = await linesSaying("ai transport retry", () => pdf());
    expect(refused.lines).toEqual([]);
    script(dropped(), dropped());
    const optedOut = await linesSaying("ai transport retry", () => pdf(false));
    expect(optedOut.lines).toEqual([]);
    /* Nor is either one a part-way death: both failed before any answer. */
    expect(optedOut.all).not.toContain("died part-way");
  });
});

describe("ai call died part-way", () => {
  it("is one warn line when a stream says, in-band, that it failed", async () => {
    script(sse(frame({ choices: [{ delta: { content: "hi" } }] }), frame({ error: { message: SECRET } })));
    const { lines, all } = await linesSaying("ai call died part-way", chat);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe("warn");
    expect(ours(lines[0])).toEqual({ job: "chat", wire: "chat", model: "m", attempt: 1, class: "in_band", status: 200 });
    expect(all).not.toContain("badgers");
  });

  it("is one line for a 200 that will not parse, with a null attempt where the caller owns the loop", async () => {
    script(whole(200, `<html>${SECRET}</html>`));
    const { lines, all } = await linesSaying("ai call died part-way", () => pdf(false));
    expect(lines.map(ours)).toEqual([
      { job: "pdf", wire: "chat", model: "m", attempt: null, class: "unreadable", status: 200 },
    ]);
    expect(all).not.toContain("badgers");
  });

  it("is one line on the Messages wire when the stream fails after message_start", async () => {
    script(sse(MESSAGE_START, event("error", { type: "error", error: { type: "overloaded_error", message: SECRET } })));
    const { lines, all } = await linesSaying("ai call died part-way", arc);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe("warn");
    expect(ours(lines[0])).toMatchObject({
      job: "arc",
      wire: "messages",
      attempt: 1,
      class: "provider:overloaded_error",
      status: 200,
    });
    expect(Object.keys(ours(lines[0])).sort()).toEqual(["attempt", "class", "job", "model", "status", "wire"]);
    expect(all).not.toContain("badgers");
  });

  it("is not logged for a call that answered, nor for one a reader stopped", async () => {
    script(sse(frame({ choices: [{ delta: { content: "hi" } }] }), "data: [DONE]\n\n"));
    const fine = await linesSaying("ai call died part-way", chat);
    expect(fine.lines).toEqual([]);
    script(sse(frame({ choices: [{ delta: { content: "hi" } }] }), frame({ choices: [{ delta: { content: "ho" } }] }), "data: [DONE]\n\n"));
    const stopped = await linesSaying("ai call died part-way", async () => {
      for await (const _ of openRouterStream(
        "chat",
        { model: "m", messages: [] },
        { signal: new AbortController().signal, onActivity: () => {}, end: { terminated: false } },
      )) {
        break;
      }
    });
    expect(stopped.lines).toEqual([]);
  });
});

/* Plan docs/plans/261006d-count-stalls-and-deadlines-apart-from-a-reader-s-stop.md. */
describe("ai call stopped by our clock", () => {
  /**
   * A transport that hangs until the request's signal fires, as a real one
   * does: before any response, or after a `200` that carried `frames`.
   */
  function hanging(frames?: string): { sent: () => number } {
    let sent = 0;
    vi.stubGlobal("fetch", (_url: unknown, init?: { signal?: AbortSignal }) => {
      sent += 1;
      const signal = init?.signal;
      if (frames === undefined) {
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
      let pulled = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!pulled) {
            pulled = true;
            controller.enqueue(new TextEncoder().encode(frames));
            return;
          }
          return new Promise<void>((resolve) => {
            signal?.addEventListener(
              "abort",
              () => {
                controller.error(signal.reason);
                resolve();
              },
              { once: true },
            );
          });
        },
      });
      return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
    });
    return { sent: () => sent };
  }

  /** A signal that fires with `reason` 20 ms from now. */
  const stopsWith = (reason: unknown): AbortSignal => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(reason), 20);
    return controller.signal;
  };

  const chatOn = (signal: AbortSignal) =>
    drain(openRouterStream("chat", { model: "m", messages: [] }, { signal, onActivity: () => {}, end: { terminated: false } }));
  const arcOn = (signal: AbortSignal) =>
    streamMessage("arc", { max_tokens: 16, messages: [{ role: "user", content: "x" }] }, { power: "standard", signal }).finalMessage();

  it("is one warn line when a stall clock stops a stream part-way, and it is not a death", async () => {
    hanging(frame({ choices: [{ delta: { content: "hi" } }] }));
    const { lines, all } = await linesSaying("ai call stopped by our clock", () => chatOn(stopsWith(new StallReached())));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe("warn");
    expect(ours(lines[0])).toEqual({ job: "chat", wire: "chat", model: "m", attempt: 1, class: "stall", status: 200 });
    expect(all).not.toContain("died part-way");
  });

  it("is one line when a deadline stops a whole call before any answer, with none of the reason's words", async () => {
    hanging();
    const { lines, all } = await linesSaying("ai call stopped by our clock", () =>
      openRouterJson("pdf", { model: "m", messages: [] }, { signal: AbortSignal.timeout(20) }),
    );
    expect(lines.map(ours)).toEqual([{ job: "pdf", wire: "chat", model: "m", attempt: 1, class: "deadline", status: null }]);
    hanging();
    const worded = await linesSaying("ai call stopped by our clock", () =>
      openRouterJson("pdf", { model: "m", messages: [] }, { signal: stopsWith(new CallDeadlineReached(SECRET)) }),
    );
    expect(worded.lines.map(ours)).toEqual([{ job: "pdf", wire: "chat", model: "m", attempt: 1, class: "deadline", status: null }]);
    expect(all + worded.all).not.toContain("badgers");
  });

  /* F16. Before the answer is where this wire would ask again, and an abort
     that now carries failure fields must still not be taken for a failure. */
  it("is one line on the Messages wire for a clock that fires before the answer, with one request and no retry", async () => {
    const t = hanging();
    const { lines, all } = await linesSaying("ai call stopped by our clock", () => arcOn(stopsWith(new StallReached())));
    expect(t.sent()).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe("warn");
    expect(ours(lines[0])).toMatchObject({ job: "arc", wire: "messages", attempt: 1, class: "stall", status: null });
    expect(Object.keys(ours(lines[0])).sort()).toEqual(["attempt", "class", "job", "model", "status", "wire"]);
    expect(all).not.toContain("ai transport retry");
    expect(all).not.toContain("died part-way");
  });

  it("is one line on the Messages wire for a deadline after message_start", async () => {
    hanging(MESSAGE_START);
    const { lines, all } = await linesSaying("ai call stopped by our clock", () => arcOn(AbortSignal.timeout(20)));
    expect(lines.map(ours)).toMatchObject([{ job: "arc", wire: "messages", attempt: 1, class: "deadline", status: 200 }]);
    expect(all).not.toContain("died part-way");
  });

  it("is not logged for a reader's Stop, on either wire, at either phase", async () => {
    const stop = () => stopsWith(new Error(SECRET));
    hanging();
    const early = await linesSaying("ai call stopped by our clock", () => chatOn(stop()));
    hanging(frame({ choices: [{ delta: { content: "hi" } }] }));
    const late = await linesSaying("ai call stopped by our clock", () => chatOn(stop()));
    hanging();
    const earlyArc = await linesSaying("ai call stopped by our clock", () => arcOn(stop()));
    hanging(MESSAGE_START);
    const lateArc = await linesSaying("ai call stopped by our clock", () => arcOn(stop()));
    for (const run of [early, late, earlyArc, lateArc]) {
      expect(run.lines).toEqual([]);
      expect(run.all).not.toContain("badgers");
      expect(run.all).not.toContain("died part-way");
      expect(run.all).not.toContain("ai transport retry");
    }
  });
});
