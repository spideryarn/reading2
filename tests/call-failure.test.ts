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
import { describe, expect, it } from "vitest";
import {
  NETWORK_CODES,
  PROVIDER_EVENT_TYPES,
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
