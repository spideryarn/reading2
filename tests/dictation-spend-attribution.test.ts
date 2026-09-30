/**
 * **Dictation into an article is that article's spend** — `POST /api/transcribe`
 * wraps its model call in `withSpendAttribution` when the body's `context` names
 * an article. Before 2026-09-30 it did not, and every dictation row had
 * `article_slug = null`, so the metadata page's cost section could not see it.
 * docs/plans/260930f-article-cost-on-the-metadata-page.md.
 *
 * The slug is in the body, not the path, so the route table's `article` field
 * cannot do this — which is why the route answers `"handler"` there.
 *
 * `transcribe` is replaced by one that records a spend and returns, so the row
 * the request leaves is the observation; `costStore.record` is captured rather
 * than written. What is under test is the route's wrap and nothing else.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiCallRow, SpendRecord } from "../src/ai-spend.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

const seen = vi.hoisted(() => ({ rows: [] as AiCallRow[] }));

vi.mock("../src/store/ai-calls.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/store/ai-calls.js")>();
  return {
    ...actual,
    costStore: {
      ...actual.costStore,
      record: async (row: AiCallRow) => {
        seen.rows.push(row);
      },
    },
  };
});

vi.mock("../src/transcribe.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/transcribe.js")>();
  const { providerCost, recordSpend } = await import("../src/ai-spend.js");
  return {
    ...actual,
    transcribe: async () => {
      const record: SpendRecord = {
        job: "dictation",
        answeredBy: "openai/gpt-transcribe",
        upstreamCostNanos: null,
        model: "openai/gpt-transcribe",
        cost: providerCost(123_000),
        generationId: null,
        upstream: "OpenAI",
        isByok: false,
        providerAccount: "openrouter",
        credentialFingerprint: "abcdef012345",
        wire: "transcription",
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        cacheWrite5mTokens: null,
        cacheWrite1hTokens: null,
        reasoningTokens: null,
        webSearches: null,
        serviceTier: null,
        inferenceGeo: null,
        ms: 10,
        outcome: "ok",
      };
      recordSpend(record);
      return { text: "hello", ms: 10 };
    },
  };
});

const { handleApi } = await import("../src/routes.js");

/** Base64 long enough to clear `MIN_AUDIO_BASE64`, and canonically padded. */
const AUDIO = `${"A".repeat(3000)}AA==`;

async function dictate(context: unknown): Promise<number> {
  const req = Object.assign(
    (async function* () {
      yield Buffer.from(JSON.stringify({ audio: AUDIO, format: "webm", context }));
    })(),
    { method: "POST", url: "/api/transcribe", headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;
  let status = 0;
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    writeHead(code: number) {
      status = code;
    },
    end() {},
    write() {
      return true;
    },
    on() {},
    off() {},
  } as unknown as ServerResponse;
  await handleApi(req, res, acceptAny);
  return status;
}

beforeEach(() => {
  seen.rows.length = 0;
});

describe("the ledger row a dictation leaves", () => {
  it("names the article it was dictated into", async () => {
    expect(await dictate({ kind: "article", slug: "an-article-spya-abc123" })).toBe(200);
    expect(seen.rows.map((r) => [r.job, r.articleSlug])).toEqual([
      ["dictation", "an-article-spya-abc123"],
    ]);
  });

  it("names none when it went into a profile box", async () => {
    expect(await dictate({ kind: "profile" })).toBe(200);
    expect(seen.rows.map((r) => r.articleSlug)).toEqual([null]);
  });
});
