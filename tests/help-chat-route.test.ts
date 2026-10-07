/**
 * **`POST /api/help-chat` — *Ask about Spideryarn*, through `handleApi`.**
 * Plan docs/plans/261007k-help-chatbot.md, Stage 1; GPT Sol's F5 and F7.
 *
 * What the route does in what order: a bad body is refused before the
 * allowance is asked; the allowance's refusals answer as JSON before a header
 * of the stream is written or a provider is asked; an allowed question streams
 * `delta` frames and one `done`, and frees its slot; a failure mid-answer is an
 * `error` frame with a reader's sentence; and — the lifetime half — the request
 * stays open until the answer is finished, and the reader closing the
 * connection aborts the provider call.
 *
 * **No provider is called and no database is opened.** `openRouterStream`
 * (src/ai-call.ts) is replaced by a script each case writes, and the store's
 * `fetchAllowanceStore` by one that answers what each case says — the
 * allowance itself is tests/fetch-allowance.test.ts's. So the request body seen
 * here is the one `askHelp` builds, before `outgoing` adds the route and the
 * reasoning; those two are rows of `AI_JOB_ROUTE` and `CHAT_REASONING`, held
 * in tests/help-chat.test.ts.
 */
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadEnvLocal } from "../src/env.js";
import { HELP_CHAT_BUSY, HELP_CHAT_LIMITED, HELP_CHAT_RESTING } from "../src/messages.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

loadEnvLocal();

interface Chunk {
  choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
  usage?: Record<string, unknown>;
}

/** What one provider call does, given its options: the chunks it yields, and when. */
type Script = (options: { signal: AbortSignal; end: { terminated: boolean; finishReason?: string | null } }) => AsyncGenerator<Chunk>;

const seen = vi.hoisted(() => ({
  taken: [] as { bucket: string; policy: unknown }[],
  finished: [] as string[],
  allowance: "allowed" as "allowed" | "rate" | "concurrency" | "global",
  calls: [] as { job: string; body: Record<string, unknown>; signal: AbortSignal }[],
  script: null as Script | null,
}));

vi.mock("../src/store/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/store/index.js")>()),
  fetchAllowanceStore: {
    async take(bucket: string, policy: unknown) {
      seen.taken.push({ bucket, policy });
      return seen.allowance === "allowed" ? { kind: "allowed", id: "lease-1" } : { kind: seen.allowance };
    },
    async finish(id: string) {
      seen.finished.push(id);
    },
  },
}));

vi.mock("../src/ai-call.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/ai-call.js")>()),
  async *openRouterStream(
    job: string,
    body: Record<string, unknown>,
    options: { signal: AbortSignal; end: { terminated: boolean; finishReason?: string | null } },
  ) {
    seen.calls.push({ job, body, signal: options.signal });
    if (!seen.script) throw new Error("a provider call began that no case scripted");
    yield* seen.script(options);
  },
}));

const { handleApi } = await import("../src/routes.js");
const { HELP_CHAT_SYSTEM, HELP_CHAT_RATE_POLICY } = await import("../src/help-chat-call.js");
const { ProviderRefused } = await import("../src/ai-call.js");

/** A finished answer, in two pieces, as OpenRouter streams one. */
const answers =
  (...pieces: string[]): Script =>
  async function* ({ end }) {
    for (const content of pieces) yield { choices: [{ delta: { content } }] };
    yield { choices: [{ delta: {}, finish_reason: "stop" }] };
    end.finishReason = "stop";
    end.terminated = true;
  };

interface Call {
  /** Settles when `handleApi` does. */
  done: Promise<void>;
  settled: () => boolean;
  status: () => number;
  streamed: () => boolean;
  ended: () => boolean;
  text: () => string;
  /** The reader closing the connection: what Node does to `res` when the socket goes. */
  close: () => void;
}

/**
 * Drive `handleApi` with a response that can be streamed to **and closed** —
 * `on("close")` is real here, because `sse` listens on it for `gone`.
 */
function post(body: unknown, headers: Record<string, string> = AUTHED_HEADERS): Call {
  const payload = [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method: "POST", url: "/api/help-chat", headers },
  ) as unknown as IncomingMessage;

  const events = new EventEmitter();
  let status = 0;
  let streamed = false;
  let ended = false;
  let destroyed = false;
  let text = "";
  /* Accessors with `defineProperties`, not `Object.assign`, which would copy
     each getter's value once and leave a field that never changes. */
  Object.defineProperties(events, {
    statusCode: {
      get: () => status,
      set: (v: number) => {
        status = v;
      },
    },
    writableEnded: { get: () => ended },
    destroyed: { get: () => destroyed },
  });
  const res = Object.assign(events, {
    setHeader() {},
    flushHeaders() {},
    writeHead(code: number) {
      streamed = true;
      status = code;
    },
    write(chunk: string) {
      text += chunk;
      return true;
    },
    end(chunk?: string) {
      if (chunk) text += chunk;
      ended = true;
    },
  }) as unknown as ServerResponse;

  let settled = false;
  const done = handleApi(req, res, acceptAny).then(() => {
    settled = true;
  });
  return {
    done,
    settled: () => settled,
    status: () => status,
    streamed: () => streamed,
    ended: () => ended,
    text: () => text,
    close: () => {
      destroyed = true;
      events.emit("close");
    },
  };
}

/** The SSE text back as frames, heartbeats dropped. */
function frames(text: string): { name: string; data: Record<string, unknown> }[] {
  const out: { name: string; data: Record<string, unknown> }[] = [];
  for (const chunk of text.split("\n\n")) {
    const name = /^event: (.+)$/m.exec(chunk)?.[1];
    const data = /^data: (.+)$/m.exec(chunk)?.[1];
    if (name && data) out.push({ name, data: JSON.parse(data) as Record<string, unknown> });
  }
  return out;
}

beforeEach(() => {
  seen.taken.length = 0;
  seen.finished.length = 0;
  seen.calls.length = 0;
  seen.allowance = "allowed";
  seen.script = null;
});

afterEach(() => {
  seen.script = null;
});

describe("POST /api/help-chat", () => {
  it("is refused signed out, before anything else is asked", async () => {
    const call = post({ question: "What is the spine?" }, {});
    await call.done;
    expect(call.status()).toBe(401);
    expect(call.streamed()).toBe(false);
    expect(seen.taken).toEqual([]);
    expect(seen.calls).toEqual([]);
  });

  it.each([
    ["not an object", ["a list"]],
    ["an unknown key", { question: "What is the spine?", history: [] }],
    ["no question", {}],
    ["an empty question", { question: "   " }],
    ["a question that is not a string", { question: 42 }],
    ["a question over a thousand characters", { question: "x".repeat(1001) }],
  ])("refuses %s with a 400, before the allowance is taken or a model asked", async (_what, body) => {
    const call = post(body);
    await call.done;
    expect(call.status()).toBe(400);
    expect(call.streamed()).toBe(false);
    expect(seen.taken).toEqual([]);
    expect(seen.calls).toEqual([]);
  });

  it.each([
    ["concurrency", 429, HELP_CHAT_BUSY],
    ["rate", 429, HELP_CHAT_LIMITED],
    ["global", 503, HELP_CHAT_RESTING.message],
  ] as const)("answers the allowance's %s refusal as JSON %i, before any provider call", async (kind, status, sentence) => {
    seen.allowance = kind;
    const call = post({ question: "What is the spine?" });
    await call.done;
    expect(call.status()).toBe(status);
    expect(call.streamed()).toBe(false);
    expect(JSON.parse(call.text())).toMatchObject({ error: sentence });
    expect(seen.taken.map((t) => t.bucket)).toEqual(["help-chat"]);
    expect(seen.calls).toEqual([]);
    expect(seen.finished).toEqual([]);
  });

  it("streams the answer, ends with one done, and frees its slot", async () => {
    seen.script = answers("The spine is ", "the strip on the left. See [Reading the spine](/help/spine).");
    const call = post({ question: "  What is the spine?  " });
    await call.done;

    expect(call.status()).toBe(200);
    expect(call.ended()).toBe(true);
    const got = frames(call.text());
    expect(got.map((f) => f.name)).toEqual(["delta", "delta", "done"]);
    expect(got.at(-1)?.data).toEqual({
      answer: "The spine is the strip on the left. See [Reading the spine](/help/spine).",
      complete: true,
    });
    expect(seen.taken).toEqual([{ bucket: "help-chat", policy: HELP_CHAT_RATE_POLICY }]);
    expect(seen.finished).toEqual(["lease-1"]);

    /* One call, the Help job, the whole Help as the system message and the
       trimmed question as the only other one. */
    expect(seen.calls).toHaveLength(1);
    const [only] = seen.calls;
    expect(only?.job).toBe("help-chat");
    expect(only?.body.messages).toEqual([
      { role: "system", content: HELP_CHAT_SYSTEM },
      { role: "user", content: "A reader of the Help pages asks:\n\nWhat is the spine?" },
    ]);
    expect(only?.body).not.toHaveProperty("tools");
  });

  it("keeps an answer cut off at the ceiling, and says it is not complete", async () => {
    seen.script = async function* ({ end }) {
      yield { choices: [{ delta: { content: "The spine is the strip" } }] };
      yield { choices: [{ delta: {}, finish_reason: "length" }] };
      end.finishReason = "length";
      end.terminated = true;
    };
    const call = post({ question: "What is the spine?" });
    await call.done;
    expect(frames(call.text()).at(-1)).toEqual({ name: "done", data: { answer: "The spine is the strip", complete: false } });
  });

  it.each([
    ["content_filter", "done", false],
    ["end_turn", "done", false],
    ["tool_calls", "error", null],
    ["error", "error", null],
  ] as const)(
    "maps a provider ending of %s to one terminal %s frame",
    async (reason, terminal, complete) => {
      seen.script = async function* ({ end }) {
        yield { choices: [{ delta: { content: "Part of an answer" } }] };
        yield { choices: [{ delta: {}, finish_reason: reason }] };
        end.finishReason = reason;
        end.terminated = true;
      };
      const call = post({ question: "What is the spine?" });
      await call.done;
      const got = frames(call.text());
      expect(got.map((f) => f.name)).toEqual(["delta", terminal]);
      if (terminal === "done") expect(got.at(-1)?.data.complete).toBe(complete);
      expect(seen.finished).toEqual(["lease-1"]);
    },
  );

  it("ends an unterminated provider stream with one error and frees its slot", async () => {
    seen.script = async function* () {
      yield { choices: [{ delta: { content: "Part of an answer" } }] };
    };
    const call = post({ question: "What is the spine?" });
    await call.done;
    expect(frames(call.text()).map((f) => f.name)).toEqual(["delta", "error"]);
    expect(seen.finished).toEqual(["lease-1"]);
  });

  it("turns a provider refusal before its first word into one safe error frame and frees its slot", async () => {
    const echoed = "SENTINEL QUESTION THE PROVIDER ECHOED";
    seen.script = async function* () {
      /* Keep the mock's async-generator shape without sending a chunk. */
      if (echoed.length === 0) yield { choices: [] };
      throw new ProviderRefused(429, echoed, new Headers(), false);
    };
    const call = post({ question: "What is the spine?" });
    await call.done;
    const got = frames(call.text());
    expect(got.map((f) => f.name)).toEqual(["error"]);
    expect(call.text()).not.toContain(echoed);
    expect(seen.finished).toEqual(["lease-1"]);
  });

  it("ends a stream that breaks mid-answer with an error frame carrying a reader's sentence, and frees its slot", async () => {
    seen.script = async function* () {
      yield { choices: [{ delta: { content: "The spine is" } }] };
      throw new Error("socket hang up — not a sentence for a reader");
    };
    const call = post({ question: "What is the spine?" });
    await call.done;
    const got = frames(call.text());
    expect(got.map((f) => f.name)).toEqual(["delta", "error"]);
    const error = got.at(-1)?.data.error;
    expect(typeof error).toBe("string");
    expect(error).not.toContain("socket hang up");
    expect(error).toMatch(/\[[a-z0-9-]+\]$/);
    expect(call.ended()).toBe(true);
    expect(seen.finished).toEqual(["lease-1"]);
  });

  it("refuses an empty answer rather than sending an empty done", async () => {
    seen.script = answers("   ");
    const call = post({ question: "What is the spine?" });
    await call.done;
    expect(frames(call.text()).map((f) => f.name)).toEqual(["delta", "error"]);
  });
});

describe("POST /api/help-chat — the request's lifetime", () => {
  /** A provider call held open after its first words, until the case lets it go or the signal fires. */
  function held(): { script: Script; reached: Promise<void>; release: () => void } {
    let arrive!: () => void;
    const reached = new Promise<void>((r) => {
      arrive = r;
    });
    let release!: () => void;
    const released = new Promise<void>((r) => {
      release = r;
    });
    const script: Script = async function* ({ signal, end }) {
      yield { choices: [{ delta: { content: "The spine is" } }] };
      arrive();
      await Promise.race([
        released,
        new Promise<void>((_, reject) => {
          if (signal.aborted) reject(signal.reason);
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
      ]);
      yield { choices: [{ delta: { content: " the strip." }, finish_reason: "stop" }] };
      end.finishReason = "stop";
      end.terminated = true;
    };
    return { script, reached, release };
  }

  it("holds the request open until the answer is finished, and only then settles", async () => {
    const gate = held();
    seen.script = gate.script;
    const call = post({ question: "What is the spine?" });
    await gate.reached;
    /* Give a floating promise every chance to settle first. */
    await new Promise((r) => setTimeout(r, 20));
    expect(call.settled(), "the request settled while the model was still writing").toBe(false);
    expect(call.ended()).toBe(false);
    expect(seen.finished).toEqual([]);

    gate.release();
    await call.done;
    expect(call.ended()).toBe(true);
    expect(frames(call.text()).at(-1)).toEqual({ name: "done", data: { answer: "The spine is the strip.", complete: true } });
    expect(seen.finished).toEqual(["lease-1"]);
  });

  it("aborts the provider call when the reader closes the connection, and still frees the slot", async () => {
    const gate = held();
    seen.script = gate.script;
    const call = post({ question: "What is the spine?" });
    await gate.reached;
    const [only] = seen.calls;
    if (!only) throw new Error("no provider call was made");
    expect(only.signal.aborted).toBe(false);

    /* **Promptly, and because of the reader.** The call's signal also carries
       our stall clock, which would abort it twenty seconds later whatever the
       route did — so "aborted by the end" proves nothing, and was watched
       passing with `gone` not handed on. A second is the bound. */
    const aborted = new Promise<"aborted">((resolve) => {
      only.signal.addEventListener("abort", () => resolve("aborted"), { once: true });
    });
    call.close();
    const first = await Promise.race([aborted, new Promise<"still running">((r) => setTimeout(() => r("still running"), 1_000))]);
    expect(first, "the reader left and the paid call ran on").toBe("aborted");
    expect(only.signal.reason?.name).not.toBe("StallReached");
    await call.done;

    /* Nobody is there to read a frame: no done, and no error. */
    expect(frames(call.text()).map((f) => f.name)).toEqual(["delta"]);
    expect(call.ended()).toBe(true);
    expect(seen.finished).toEqual(["lease-1"]);
  });
});
