/**
 * A free, deterministic stand-in for the model, for proving the plumbing.
 * Plan 261005j § Stage 2 ("a dry run with the fake model").
 *
 * It replaces `globalThis.fetch`, the same seam tests/messages-stream.test.ts
 * uses, so every arm runs its real code: the gateway, the spend scope, the
 * ledger, the parsers and the final build. `runSlices` has no model seam of its
 * own, which is why the fake sits under the transport and not above it.
 *
 * Each request is recognised by its system prompt and answered with a valid
 * answer of that prompt's shape, cut at fixed strides. Its "costs" are made up
 * (the listed price times a made-up token count) so the cap is exercised too.
 *
 * `injections` make chosen requests fail in chosen ways. A request is named by
 * its kind and by the order in which a new request of that kind was first
 * seen, so "the second part-sections request, twice" hits a call and its
 * re-ask and nothing else.
 */
import { ROOT_SYSTEM, SLICE_NOTE } from "../../src/structure-slices.js";
import { EXPAND_SYSTEM } from "../../src/structure-expand.js";
import { SYSTEM } from "../../src/structure.js";
import { GISTS_SYSTEM, SECTIONS_SYSTEM, TOP_SYSTEM } from "./prompts.js";

export type FakeKind = "whole" | "slice" | "root" | "expand" | "top" | "sections" | "gists" | "judge";

export type FakeFault =
  /* `stop_reason: "refusal"`. */
  | "refuse"
  /* `stop_reason: "max_tokens"`, half an answer. */
  | "truncate"
  /* A whole answer that is not the JSON asked for. */
  | "garbage"
  /* A whole, well-formed answer whose starts are not blocks it was given. */
  | "bad-starts"
  /* The connection fails before the response begins. */
  | "transport";

export interface Injection {
  kind: FakeKind;
  /** 0-based: the nth distinct request of this kind, in the order first seen. */
  nth: number;
  fault: FakeFault;
  /** How many times that request fails before it is answered properly. */
  times: number;
}

export interface FakeStats {
  requests: Record<string, number>;
  injected: { kind: FakeKind; nth: number; fault: FakeFault }[];
}

/** What the fake judge answers: given the model asked for and the prompt, the reply's JSON. */
export type FakeJudge = (model: string, prompt: string) => unknown;

const sse = (type: string, data: unknown): string => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

const text = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((p) => (typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("\n\n")
      : "";

const idsIn = (rendered: string): string[] => [...rendered.matchAll(/^\[\d+\] (\S+) </gm)].map((m) => m[1]!);

const SECTION_GIST =
  "This fake section holds that its blocks say one particular thing for one particular reason, which is twenty-two words or more in all.";

/** Starts every `stride` ids, never leaving a last run shorter than 3. */
function strides(ids: string[], stride: number): string[] {
  const starts: string[] = [];
  for (let i = 0; i < ids.length; i += stride) {
    if (i > 0 && ids.length - i < 3) break;
    starts.push(ids[i]!);
  }
  return starts;
}

function wholeAnswer(ids: string[]): unknown {
  const chapters: unknown[] = [];
  const size = Math.max(40, Math.ceil(ids.length / 9));
  for (let i = 0, c = 1; i < ids.length; i += size, c++) {
    const own = ids.slice(i, i + size);
    const sections = strides(own, 10);
    chapters.push({
      title: `Fake chapter ${c}`,
      gist: `Fake chapter ${c} argues one thing about its own stretch of the document.`,
      question: `Fake chapter ${c} — why does its stretch hold together? (an argument)`,
      start: own[0],
      ...(sections.length >= 2 ? { children: sections.map((start, s) => ({ title: `Fake section ${c}.${s + 1}`, gist: SECTION_GIST, start })) } : {}),
    });
  }
  return {
    root: {
      title: "Fake document",
      gist: "A fake document makes one fake claim.",
      question: "Fake documents — why do they hold together? (an argument)",
      children: chapters,
    },
  };
}

function topAnswer(ids: string[]): unknown {
  const size = Math.max(13, Math.ceil(ids.length / 8));
  /* The second part is 8 blocks, so the "small part gets no second call" path always runs. */
  const starts = [0, size, size + 8];
  for (let i = size + 8 + size; i < ids.length - 3; i += size) starts.push(i);
  return {
    gist: "A fake document makes one fake claim.",
    question: "Fake documents — why do they hold together? (an argument)",
    parts: starts
      .filter((i) => i < ids.length)
      .map((i, p) => ({
        start: ids[i],
        title: `Fake part ${p + 1}`,
        gist: `Fake part ${p + 1} argues one thing about its own stretch of the document.`,
        question: `Fake part ${p + 1} — why does its stretch hold together? (an argument)`,
      })),
  };
}

function answerFor(kind: FakeKind, user: string): unknown {
  if (kind === "whole" || kind === "slice") return wholeAnswer(idsIn(user));
  if (kind === "top") return topAnswer(idsIn(user));
  if (kind === "root") {
    return { gist: "Fake pieces share one fake claim.", question: "Fake documents — why do they hold together? (an argument)" };
  }
  if (kind === "expand") {
    const ids = idsIn(user.slice(user.indexOf("ITS BLOCKS")));
    return {
      sections: [
        {
          section: 1,
          children: strides(ids, 10).map((start, s) => ({ start, title: `Fake section ${s + 1}`, gist: SECTION_GIST, verdict: "finished", why: "fake" })),
        },
      ],
    };
  }
  if (kind === "sections") {
    const ids = idsIn(user.slice(user.indexOf("ITS BLOCKS")));
    return { sections: strides(ids, 10).map((start, s) => ({ start, title: `Fake section ${s + 1}` })) };
  }
  const count = [...user.matchAll(/^SECTION \d+ OF \d+: /gm)].length;
  return { gists: Array.from({ length: count }, (_x, i) => ({ section: i + 1, gist: SECTION_GIST })) };
}

function kindOf(system: string, user: string): FakeKind {
  if (system === SYSTEM) return user.startsWith(SLICE_NOTE) ? "slice" : "whole";
  if (system === ROOT_SYSTEM) return "root";
  if (system === EXPAND_SYSTEM) return "expand";
  if (system === TOP_SYSTEM) return "top";
  if (system === SECTIONS_SYSTEM) return "sections";
  if (system === GISTS_SYSTEM) return "gists";
  throw new Error("the fake model was sent a prompt it does not know");
}

/** Made-up prices, so a fake run has a ledger total to cap: $2 and $10 a million tokens. */
const fakeCost = (input: number, output: number): number => (input * 2 + output * 10) / 1e6;

/**
 * Put the fake under the transport. Returns the stats it keeps and the way
 * back. Sets a made-up `OPENROUTER_API_KEY`, so nothing can reach the real
 * provider while it is installed.
 */
export function installFakeModel(opts: { injections?: Injection[]; judge?: FakeJudge; latencyMs?: number } = {}): {
  stats: FakeStats;
  restore: () => void;
} {
  const original = globalThis.fetch;
  const savedKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "sk-or-fake-not-a-real-key";
  const stats: FakeStats = { requests: {}, injected: [] };
  const seen = new Map<string, number>();
  const perKind = new Map<FakeKind, number>();
  const used = new Map<Injection, number>();
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    const url = String((input as { url?: string })?.url ?? input);
    const body = JSON.parse(init?.body ?? "{}") as {
      model?: string;
      system?: unknown;
      messages?: { role: string; content: unknown }[];
    };
    await sleep(opts.latencyMs ?? 15);

    /* The chat wire: only the judge uses it here. */
    if (url.endsWith("/chat/completions")) {
      stats.requests.judge = (stats.requests.judge ?? 0) + 1;
      const prompt = text(body.messages?.find((m) => m.role === "user")?.content);
      const reply = JSON.stringify(opts.judge ? opts.judge(body.model ?? "", prompt) : {});
      const inTokens = Math.ceil(prompt.length / 4);
      const outTokens = Math.ceil(reply.length / 4);
      return new Response(
        JSON.stringify({
          id: `gen-fake-${stats.requests.judge}`,
          model: body.model,
          provider: "Fake",
          choices: [{ finish_reason: "stop", message: { role: "assistant", content: reply } }],
          usage: { prompt_tokens: inTokens, completion_tokens: outTokens, cost: fakeCost(inTokens, outTokens) },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    const system = text(body.system);
    const user = text(body.messages?.[0]?.content);
    const kind = kindOf(system, user);
    stats.requests[kind] = (stats.requests[kind] ?? 0) + 1;
    const key = `${kind}\n${user}`;
    if (!seen.has(key)) {
      seen.set(key, perKind.get(kind) ?? 0);
      perKind.set(kind, (perKind.get(kind) ?? 0) + 1);
    }
    const nth = seen.get(key)!;
    const injection = (opts.injections ?? []).find((i) => i.kind === kind && i.nth === nth && (used.get(i) ?? 0) < i.times);
    if (injection) {
      used.set(injection, (used.get(injection) ?? 0) + 1);
      stats.injected.push({ kind, nth, fault: injection.fault });
      if (injection.fault === "transport") throw new TypeError("fetch failed");
    }
    const fault = injection?.fault;
    let answer = JSON.stringify(answerFor(kind, user));
    if (fault === "garbage") answer = "I could not make a table of contents for this.";
    if (fault === "truncate") answer = answer.slice(0, Math.floor(answer.length / 2));
    if (fault === "bad-starts") answer = answer.replace(/"start":"[^"]+"/g, '"start":"spya-zzzzzz"');
    if (fault === "refuse") answer = "";
    const stop = fault === "refuse" ? "refusal" : fault === "truncate" ? "max_tokens" : "end_turn";
    const inTokens = Math.ceil((system.length + user.length) / 4);
    const outTokens = Math.ceil(answer.length / 4);
    const usage = { input_tokens: inTokens, output_tokens: outTokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    const stream =
      sse("message_start", {
        type: "message_start",
        message: {
          id: `gen-fake-${kind}-${stats.requests[kind]}`,
          type: "message",
          role: "assistant",
          model: body.model,
          content: [],
          stop_reason: null,
          stop_details: null,
          usage: { ...usage, output_tokens: 1 },
          provider: "Fake",
        },
      }) +
      sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) +
      sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: answer } }) +
      sse("content_block_stop", { type: "content_block_stop", index: 0 }) +
      sse("message_delta", {
        type: "message_delta",
        delta: { stop_reason: stop, stop_details: null, stop_sequence: null },
        usage: {
          ...usage,
          output_tokens_details: { thinking_tokens: 0 },
          service_tier: "standard",
          cost: fakeCost(inTokens, outTokens),
          is_byok: false,
          cost_details: { upstream_inference_cost: fakeCost(inTokens, outTokens) },
        },
      }) +
      sse("message_stop", { type: "message_stop" });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof globalThis.fetch;

  return {
    stats,
    restore: () => {
      globalThis.fetch = original;
      if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = savedKey;
    },
  };
}
