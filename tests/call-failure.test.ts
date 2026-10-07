/**
 * The label a failed model call's row carries —
 * [`src/call-failure.ts`](../src/call-failure.ts), plan
 * docs/plans/261006b-count-ai-calls-that-die-part-way-and-transport-retries.md.
 *
 * **What this file is for is the negative**: that nothing an error carries can
 * reach `ai_calls.failure_class` unless it is, character for character, a
 * literal this repo wrote down. A filter that kept "safe-looking" strings would
 * pass every positive case here, which is why half of these hand the function
 * something that looks safe and assert it comes back as the fallback.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CallDeadlineReached,
  NETWORK_CODES,
  PROVIDER_EVENT_TYPES,
  StallReached,
  abortClass,
  isErrorEnvelope,
  networkClass,
  providerEventClass,
  thrownClass,
} from "../src/call-failure.js";

/** An error shaped the way undici shapes a dead socket: the code is on the cause. */
const withCause = (cause: unknown, message = "fetch failed"): TypeError => new TypeError(message, { cause });
const coded = (code: unknown): Error => Object.assign(new Error("socket hang up"), { code });

describe("networkClass", () => {
  it("names a code on the allowlist", () => {
    expect(networkClass(coded("ECONNRESET"))).toBe("network:ECONNRESET");
    expect(networkClass(withCause(coded("UND_ERR_SOCKET")))).toBe("network:UND_ERR_SOCKET");
  });

  it("finds the code two causes down, where the Anthropic SDK leaves it", () => {
    /* `APIConnectionError { cause: TypeError("fetch failed") { cause: { code } } }` */
    const sdk = Object.assign(new Error("Connection error."), { cause: withCause(coded("ECONNRESET")) });
    expect(networkClass(sdk)).toBe("network:ECONNRESET");
  });

  it("has every allowlisted code as its own label", () => {
    for (const code of NETWORK_CODES) expect(networkClass(coded(code))).toBe(`network:${code}`);
  });

  it("is plain `network` for a code it was not told about, however harmless it looks", () => {
    expect(networkClass(coded("reader_search_term"))).toBe("network");
    expect(networkClass(coded("ECONNRESET2"))).toBe("network");
    expect(networkClass(coded("econnreset"))).toBe("network");
    expect(networkClass(withCause(coded("sk-or-v1-abcdef")))).toBe("network");
  });

  it("is plain `network` for a code that is not a string, and for no code at all", () => {
    expect(networkClass(coded(104))).toBe("network");
    expect(networkClass(coded({ toString: () => "ECONNRESET" }))).toBe("network");
    expect(networkClass(new TypeError("fetch failed"))).toBe("network");
    expect(networkClass(undefined)).toBe("network");
    expect(networkClass("ECONNRESET")).toBe("network");
  });

  it("stops walking: a cause chain that loops, or runs deep, ends as `network`", () => {
    const a: { cause?: unknown } = new Error("a");
    const b: { cause?: unknown } = new Error("b");
    a.cause = b;
    b.cause = a;
    expect(networkClass(a)).toBe("network");
    let deep: unknown = coded("ECONNRESET");
    for (let i = 0; i < 12; i++) deep = withCause(deep);
    expect(networkClass(deep)).toBe("network");
  });

  it("never reads a name or a message", () => {
    const named = Object.assign(new Error("ECONNRESET"), { name: "ECONNRESET" });
    expect(networkClass(named)).toBe("network");
  });
});

describe("thrownClass", () => {
  it("is a network label when a code is found, or when the error is a TypeError", () => {
    expect(thrownClass(withCause(coded("UND_ERR_BODY_TIMEOUT"), "terminated"))).toBe("network:UND_ERR_BODY_TIMEOUT");
    expect(thrownClass(new TypeError("terminated"))).toBe("network");
    /* The SDK's wrapper around a body that broke: not a TypeError itself. */
    expect(thrownClass(Object.assign(new Error("terminated"), { cause: new TypeError("terminated") }))).toBe("network");
  });

  it("is `other` for anything else, and keeps none of it", () => {
    expect(thrownClass(new Error("the reader's question was about badgers"))).toBe("other");
    expect(thrownClass(Object.assign(new Error("x"), { name: "reader_search_term" }))).toBe("other");
    expect(thrownClass(coded("reader_search_term"))).toBe("other");
    expect(thrownClass(null)).toBe("other");
    expect(thrownClass("ECONNRESET")).toBe("other");
  });
});

describe("providerEventClass", () => {
  it("gives two different event types two different labels", () => {
    expect(providerEventClass("overloaded_error")).toBe("provider:overloaded_error");
    expect(providerEventClass("authentication_error")).toBe("provider:authentication_error");
  });

  it("has every allowlisted type as its own label", () => {
    for (const type of PROVIDER_EVENT_TYPES) expect(providerEventClass(type)).toBe(`provider:${type}`);
  });

  it("is `in_band` for a type it was not told about, and for none", () => {
    expect(providerEventClass("reader_search_term")).toBe("in_band");
    expect(providerEventClass("overloaded_error ")).toBe("in_band");
    expect(providerEventClass(undefined)).toBe("in_band");
    expect(providerEventClass(null)).toBe("in_band");
    expect(providerEventClass({ toString: () => "api_error" })).toBe("in_band");
  });
});

describe("isErrorEnvelope", () => {
  it("is a top-level `error` with no `choices` and no `data`", () => {
    expect(isErrorEnvelope({ error: { code: 502, message: "upstream" } })).toBe(true);
    expect(isErrorEnvelope({ error: "upstream" })).toBe(true);
  });

  it("is not an answer that also carries an `error`, nor an `error` that says nothing", () => {
    expect(isErrorEnvelope({ error: { code: 502 }, choices: [{ message: { content: "ok" } }] })).toBe(false);
    expect(isErrorEnvelope({ error: null })).toBe(false);
    expect(isErrorEnvelope({ choices: [] })).toBe(false);
    expect(isErrorEnvelope({ data: [{ embedding: [0.1] }] })).toBe(false);
    expect(isErrorEnvelope({ error: { code: 502 }, data: [{ embedding: [0.1] }] })).toBe(false);
  });

  it("is not anything that is not an object", () => {
    expect(isErrorEnvelope(null)).toBe(false);
    expect(isErrorEnvelope("error")).toBe(false);
    expect(isErrorEnvelope([{ error: "x" }])).toBe(false);
  });
});

/* Plan docs/plans/261006d-count-stalls-and-deadlines-apart-from-a-reader-s-stop.md. */
describe("abortClass", () => {
  it("is `stall` for the reason every stall clock aborts with", () => {
    expect(abortClass(new StallReached())).toBe("stall");
  });

  it("is `deadline` for what `AbortSignal.timeout` aborts with, and for a hand-written per-call clock", async () => {
    const signal = AbortSignal.timeout(1);
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    expect(abortClass(signal.reason)).toBe("deadline");
    expect(abortClass(new DOMException("took too long", "TimeoutError"))).toBe("deadline");
    expect(abortClass(new CallDeadlineReached())).toBe("deadline");
    expect(abortClass(new CallDeadlineReached("pdf figures budget spent"))).toBe("deadline");
  });

  it("keeps the winning reason through `AbortSignal.any`, which is how a gateway sees it", () => {
    const reader = new AbortController();
    const stall = new AbortController();
    const signal = AbortSignal.any([reader.signal, stall.signal]);
    /* As `fetch`, `sseChunks` and `waitOrStop` all do while a call is in
       flight. It is not decoration: on Node 26 a composite nobody is
       listening to works its reason out when it is first read, from the first
       aborted source in list order, and this test without the listener says
       `abort`. */
    signal.addEventListener("abort", () => {});
    stall.abort(new StallReached());
    reader.abort(new Error("the reader pressed Stop"));
    expect(abortClass(signal.reason)).toBe("stall");
  });

  it("is `abort` for a reader's Stop, for an abort with no reason given, and for no reason at all", () => {
    const stop = new AbortController();
    stop.abort();
    expect(abortClass(stop.signal.reason)).toBe("abort");
    expect(abortClass(new Error("the reader pressed Stop"))).toBe("abort");
    expect(abortClass(undefined)).toBe("abort");
    expect(abortClass(null)).toBe("abort");
    expect(abortClass("stall")).toBe("abort");
  });

  it("is `abort` for anything that only looks like one of ours", () => {
    /* The reason a stall had before it had a class. */
    expect(abortClass(new Error("stalled"))).toBe("abort");
    /* A name is a writable property; only a real `DOMException` counts. */
    expect(abortClass({ name: "TimeoutError" })).toBe("abort");
    expect(abortClass(Object.assign(new Error("slow"), { name: "TimeoutError" }))).toBe("abort");
    expect(abortClass({ name: "StallReached", message: "stalled" })).toBe("abort");
    expect(abortClass(new DOMException("stopped", "AbortError"))).toBe("abort");
  });

  it("leaves the message as it was, for anything that reads it", () => {
    expect(new StallReached().message).toBe("stalled");
    expect(new StallReached()).toBeInstanceOf(Error);
    expect(new CallDeadlineReached("pdf figures budget spent").message).toBe("pdf figures budget spent");
  });
});

describe("every stall clock aborts with the shared class", () => {
  /** Every `.ts` and `.tsx` file under `dir`. */
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return /\.tsx?$/.test(entry.name) ? [path] : [];
    });
  const root = join(import.meta.dirname, "..", "src");
  const files = sources(root);
  const holding = (needle: RegExp): string[] =>
    files.filter((path) => needle.test(readFileSync(path, "utf8"))).map((path) => path.slice(root.length + 1));

  /* A plain `Error("stalled")` is recorded as `abort`, the same as a reader's
     Stop, so a ninth runner written the old way would be a stall nobody
     counts. A source scan, because the source is the only place that shows. */
  it("no file under src/ aborts with a plain `Error(\"stalled\")`", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(holding(/new Error\(\s*["'`]stalled["'`]\s*\)/)).toEqual([]);
  });

  it("the nine runners with a stall clock use `StallReached`", () => {
    expect(holding(/\.abort\(new StallReached\(\)\)/).sort()).toEqual([
      "converse.ts",
      "link-summary.ts",
      "quiz-mark.ts",
      "referee-claims-run.ts",
      "referee-criteria-run.ts",
      "referee-hidden-check.ts",
      "referee-mirror.ts",
      "search.ts",
      "stream-run.ts",
    ]);
  });
});
