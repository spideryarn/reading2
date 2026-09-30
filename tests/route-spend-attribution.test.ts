/**
 * **The route table says which article a request's spend belongs to**, and the
 * dispatcher does the attributing — src/routes.ts § `ArticleAttribution` and
 * `dispatchAuthRoute`; docs/project/cost-tracking.md.
 *
 * Driven with rows of its own rather than through a real route, because every
 * real route that spends today also wraps itself by hand (the wraps predate the
 * field), so a real route would stay green with the dispatcher's half deleted.
 * Here the handler records a spend and nothing else, and the ledger row it
 * produces is the observation.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

import {
  type AiCallRow,
  collectSpend,
  providerCost,
  recordSpend,
  type SpendRecord,
} from "../src/ai-spend.js";

const { dispatchAuthRoute } = await import("../src/routes.js");

type Rows = Parameters<typeof dispatchAuthRoute>[0];
type Context = Parameters<typeof dispatchAuthRoute>[1];

function call(): SpendRecord {
  return {
    job: "chat",
    answeredBy: "anthropic/claude-sonnet-5",
    upstreamCostNanos: null,
    model: "anthropic/claude-sonnet-5",
    cost: providerCost(1_000_000),
    generationId: null,
    upstream: "Anthropic",
    isByok: false,
    providerAccount: "openrouter",
    credentialFingerprint: "abcdef012345",
    wire: "chat",
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheWrite5mTokens: null,
    cacheWrite1hTokens: null,
    reasoningTokens: 0,
    webSearches: null,
    serviceTier: null,
    inferenceGeo: null,
    ms: 10,
    outcome: "ok",
  };
}

/** One request to one row, and the ledger rows its handler's spend became. */
async function dispatch(
  row: Record<string, unknown>,
  path: string,
): Promise<{ handled: boolean; ran: boolean; rows: AiCallRow[] }> {
  const rows: AiCallRow[] = [];
  let ran = false;
  const route = {
    method: "GET",
    ...row,
    handler: async () => {
      ran = true;
      recordSpend(call());
    },
  };
  const context = {
    user: { id: "00000000-0000-4000-8000-00000000ab01" },
    request: {
      req: { method: "GET" } as IncomingMessage,
      res: {} as ServerResponse,
      rawUrl: path,
      path,
      query: new URLSearchParams(),
    },
  } as unknown as Context;
  const { result } = await collectSpend(() => dispatchAuthRoute([route] as unknown as Rows, context), {
    attribution: { scopeKind: "request", ownerId: "00000000-0000-4000-8000-00000000ab01" },
    sink: async (r) => {
      rows.push(r);
    },
  });
  return { handled: result, ran, rows };
}

const PATTERN = /^\/api\/thing\/([\w.%-]+)$/;

describe("the route table's article field", () => {
  it('"first-capture" puts the slug on every call the handler makes', async () => {
    const out = await dispatch(
      { kind: "pattern", pattern: PATTERN, article: "first-capture" },
      "/api/thing/my-article-spya-abc123",
    );
    expect(out.handled).toBe(true);
    expect(out.rows.map((r) => r.articleSlug)).toEqual(["my-article-spya-abc123"]);
  });

  it('"none" attributes nothing', async () => {
    const out = await dispatch(
      { kind: "pattern", pattern: PATTERN, article: "none" },
      "/api/thing/my-article-spya-abc123",
    );
    expect(out.rows.map((r) => r.articleSlug)).toEqual([null]);
  });

  it('"handler" on an exact row leaves it to the handler', async () => {
    const out = await dispatch({ kind: "exact", path: "/api/thing", article: "handler" }, "/api/thing");
    expect(out.rows.map((r) => r.articleSlug)).toEqual([null]);
  });

  it("a capture that is not a slug attributes nothing and still reaches the handler", async () => {
    /* Accounting, not validation: the handler's own `slugPart` is what answers
       400, and the dispatcher must not pre-empt it with a throw of its own. */
    for (const path of ["/api/thing/Not.A.Slug", "/api/thing/%E0%A4%A"]) {
      const out = await dispatch({ kind: "pattern", pattern: PATTERN, article: "first-capture" }, path);
      expect(out.ran, path).toBe(true);
      expect(out.rows.map((r) => r.articleSlug), path).toEqual([null]);
    }
  });
});
