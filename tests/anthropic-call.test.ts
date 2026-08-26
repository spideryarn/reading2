/**
 * `anthropicCallFailed` — what happens when the Anthropic SDK's own request
 * fails, in the six pipeline stages that call it directly (arc, labels,
 * summarise, toc, glossary, tweets).
 *
 * The installed SDK builds `Error.message` straight from the upstream
 * response body (`node_modules/@anthropic-ai/sdk/core/error.js`,
 * `APIError.makeMessage`: `${status} ${error.message}`), and what every one
 * of these six requests carries is the whole article. So the assertion that
 * matters is not "it throws" or "it throws the new sentence" — it is that
 * whatever the upstream said is nowhere in what gets thrown, the way
 * tests/explain.test.ts checks `providerRefused`. See src/anthropic-call.ts
 * and docs/project/logging.md.
 */
import { describe, expect, it } from "vitest";
import { APIError, AnthropicError } from "@anthropic-ai/sdk";
import { anthropicCallFailed } from "../src/anthropic-call.js";

/** A status-carrying failure, built the way the SDK itself builds one. */
function apiError(status: number, upstreamMessage: string): APIError {
  return APIError.generate(status, { error: { message: upstreamMessage } }, undefined, new Headers());
}

describe("anthropicCallFailed", () => {
  it("does not repeat the upstream body, and carries the mapped code", () => {
    const secret = "upstream exploded while reading: a very private paragraph of the article";
    const out = anthropicCallFailed(apiError(429, secret));
    expect(out.message).not.toContain(secret);
    expect(out.message).not.toContain("private paragraph");
    expect(out.message).toMatch(/\[ai-busy\]/);
  });

  it("keeps the status for the log, off the message", () => {
    const out = anthropicCallFailed(apiError(401, "key rejected: sk-ant-live-do-not-log-this")) as Error & {
      status?: number;
    };
    expect(out.status).toBe(401);
    expect(out.message).not.toContain("sk-ant-live-do-not-log-this");
    expect(out.message).toMatch(/\[ai-key\]/);
  });

  it("maps a handful of other statuses the same way providerHttpFailure does", () => {
    expect(anthropicCallFailed(apiError(402, "no money")).message).toMatch(/\[ai-no-credit\]/);
    expect(anthropicCallFailed(apiError(413, "too much")).message).toMatch(/\[ai-too-big\]/);
    expect(anthropicCallFailed(apiError(500, "internal")).message).toMatch(/\[ai-upstream\]/);
  });

  it("gives a connection failure — no status at all — the generic upstream-trouble message", () => {
    // What `APIError.generate` returns when it has no status and no headers:
    // an `APIConnectionError`, exactly what a DNS failure or a dropped socket
    // produces. Its own message can carry a hostname or an errno.
    const upstream = APIError.generate(undefined, undefined, "getaddrinfo ENOTFOUND api.anthropic.com", undefined);
    const out = anthropicCallFailed(upstream) as Error & { status?: number };
    expect(out.status).toBeUndefined();
    expect(out.message).not.toContain("ENOTFOUND");
    expect(out.message).toMatch(/\[ai-upstream\]/);
  });

  it("does not repeat an SDK config error either, and calls it not-set-up", () => {
    // What the SDK throws with no usable credential — not an HTTP failure at
    // all, so not an APIError, but its own message names the auth methods it
    // tried, which is developer instruction rather than something for a
    // reader who came here to read an article.
    const upstream = new AnthropicError(
      "Could not resolve authentication method. Expected one of apiKey, authToken, credentials, config, or profile to be set.",
    );
    const out = anthropicCallFailed(upstream);
    expect(out.message).not.toMatch(/authentication method/);
    expect(out.message).toMatch(/\[ai-not-set-up\]/);
  });

  it("leaves a bug in our own code alone, rather than mislabel it as a provider failure", () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'foo')");
    expect(anthropicCallFailed(bug)).toBe(bug);
  });

  it("still produces an Error for a non-Error throw, without inventing SDK involvement", () => {
    const out = anthropicCallFailed("nope");
    expect(out).toBeInstanceOf(Error);
    expect(out.message).toBe("nope");
  });
});
