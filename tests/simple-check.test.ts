/**
 * **Simple's fidelity guard, on the wire** — plan 261001i.
 *
 * The rates that justified building it (24 of 30 faults caught, 1–2% false
 * alarms, $0.0027 a press) belong to one exact request: the probe's prompt,
 * through `link-summary`'s route, at low effort, with its token ceiling
 * (scripts/probes/261001h-fidelity-guard-probe.ts). The guard's other tests stub
 * the gateway, so they cannot see what the gateway adds — the reasoning effort
 * and the provider policy. This file runs the real gateway against a stubbed
 * `fetch` and holds the bytes that go out to the bytes that were measured
 * (Sol's plan review, P1-3).
 *
 * It also holds the store boundary: a `check` record is optional, and one that
 * is present must be whole.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type AiRequestBody, openRouterJson } from "../src/ai-call.js";
import { modelFor } from "../src/models.js";
import { checkLevel, checkMessage, SIMPLE_CHECK_SYSTEM, tallyChecks } from "../src/simple-check.js";
import { type BlockId, isUsableSimpleSummary, type SimpleParagraph, type SimpleSummary } from "../src/types.js";

const A = "spya-aaaaaa" as BlockId;
const B = "spya-bbbbbb" as BlockId;
const PARAGRAPHS: SimpleParagraph[] = [
  { text: "Synergy grows with more loops.", ids: [A] },
  { text: "Feedback lowers it.", ids: [A, B] },
];
const TEXT = new Map<string, string>([
  [A, "Recurrent connections raised synergy."],
  [B, "Feedback connections reduced synergy."],
]);

/** What the stubbed provider does next. `hang` answers only when the request's signal fires. */
let reply:
  | { kind: "answer"; content: string; finishReason?: string; refusal?: unknown }
  | { kind: "hang" } = { kind: "answer", content: "" };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  reply = { kind: "answer", content: '{"verdicts":[{"n":1,"verdict":"ok"},{"n":2,"verdict":"ok"}]}' };
  fetchMock = vi.fn(async (_url: string, init: { signal?: AbortSignal }) => {
    if (reply.kind === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    const { content, finishReason = "stop", refusal } = reply;
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () =>
        JSON.stringify({
          choices: [
            {
              finish_reason: finishReason,
              message: {
                content,
                ...(refusal === undefined ? {} : { refusal }),
              },
            },
          ],
          usage: { prompt_tokens: 120, completion_tokens: 9 },
        }),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const lastBody = () => {
  const init = fetchMock.mock.calls.at(-1)?.[1] as { body?: string } | undefined;
  if (!init?.body) throw new Error("nothing was sent");
  return JSON.parse(init.body) as Record<string, unknown>;
};

describe("the request the checker sends", () => {
  it("is the prompt 261001h measured, byte for byte", () => {
    /* The SHA-256 of the probe's `SYSTEM` at 596653d0. A change here is a new
       checker, to be measured and to bump `SIMPLE_CHECK_VERSION`. */
    expect(createHash("sha256").update(SIMPLE_CHECK_SYSTEM, "utf8").digest("hex")).toBe(
      "b4144c9f998ca8b3f32df592bf84454593d673341ab4d8526a58f51fc81d15da",
    );
  });

  it("keeps the measured request and adds only the strict response schema", async () => {
    await openRouterJson("link-summary", {
      /* The model 261001h measured, literally: link-summary's own moved to
         GPT-6 Luna on 2026-10-09 and the checker did not (plan 261009a). */
      model: "openai/gpt-5.6-luna",
      max_completion_tokens: 4000,
      messages: [
        { role: "system", content: SIMPLE_CHECK_SYSTEM },
        { role: "user", content: checkMessage(PARAGRAPHS, TEXT) },
      ],
    } as AiRequestBody);
    const measured = lastBody();
    await checkLevel(PARAGRAPHS, TEXT);
    const built = lastBody();
    const { response_format: responseFormat, ...withoutFormat } = built;
    expect(withoutFormat).toEqual(measured);
    expect(responseFormat).toEqual({
      type: "json_schema",
      json_schema: {
        name: "simple_check",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["verdicts"],
          properties: {
            verdicts: {
              type: "array",
              items: {
                anyOf: [
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["n", "verdict"],
                    properties: {
                      n: { type: "integer" },
                      verdict: { type: "string", enum: ["ok"] },
                    },
                  },
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["n", "verdict", "why"],
                    properties: {
                      n: { type: "integer" },
                      verdict: { type: "string", enum: ["contradicts"] },
                      why: { type: "string" },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    });
    /* And, named, the parts the gateway adds that the probe depended on. */
    expect(built.model).toBe(modelFor("simple-check", "standard"));
    /* The rates in 261001h belong to Luna, not merely to whichever model the
       quick tier happens to name later. A tier move is a new measurement. */
    expect(built.model).toBe("openai/gpt-5.6-luna");
    expect(built.max_completion_tokens).toBe(4000);
    expect(built).not.toHaveProperty("max_tokens");
    expect(built.reasoning).toEqual({ effort: "low" });
    expect(built.provider).toMatchObject({ require_parameters: true });
    expect(built.provider).not.toHaveProperty("order");
  });

  it("quotes each paragraph's own passages and nothing else", () => {
    expect(checkMessage(PARAGRAPHS, TEXT)).toBe(
      "PARAGRAPH 1\nSynergy grows with more loops.\n\nITS PASSAGES\n[spya-aaaaaa] Recurrent connections raised synergy." +
        "\n\n=====\n\n" +
        "PARAGRAPH 2\nFeedback lowers it.\n\nITS PASSAGES\n[spya-aaaaaa] Recurrent connections raised synergy.\n\n" +
        "[spya-bbbbbb] Feedback connections reduced synergy.",
    );
  });
});

describe("checkLevel", () => {
  it("reads a flag, with its paragraph and its reason, and the chat-wire tokens", async () => {
    reply = {
      kind: "answer",
      content: '{"verdicts":[{"n":1,"verdict":"contradicts","why":"Loops are recurrent."},{"n":2,"verdict":"ok"}]}',
    };
    await expect(checkLevel(PARAGRAPHS, TEXT)).resolves.toEqual({
      outcome: { kind: "flagged", flags: [{ paragraph: 0, why: "Loops are recurrent." }] },
      inputTokens: 120,
      outputTokens: 9,
    });
  });

  it("calls a check that runs past its own deadline a failed check, not an abort", async () => {
    reply = { kind: "hang" };
    const out = await checkLevel(PARAGRAPHS, TEXT, { timeoutMs: 20 });
    expect(out.outcome).toEqual({ kind: "failed", failure: "call" });
  });

  it("stops when the caller's signal fires, and never throws", async () => {
    reply = { kind: "hang" };
    const job = new AbortController();
    const pending = checkLevel(PARAGRAPHS, TEXT, { signal: job.signal });
    job.abort();
    await expect(pending).resolves.toMatchObject({ outcome: { kind: "failed", failure: "call" } });
  });

  it("calls an unreadable answer unreadable", async () => {
    reply = { kind: "answer", content: "Both look fine." };
    await expect(checkLevel(PARAGRAPHS, TEXT)).resolves.toMatchObject({
      outcome: { kind: "failed", failure: "unreadable" },
    });
  });

  it("refuses a non-stop finish before parsing an otherwise valid answer", async () => {
    reply = {
      kind: "answer",
      finishReason: "length",
      content: '{"verdicts":[{"n":1,"verdict":"ok"},{"n":2,"verdict":"ok"}]}',
    };
    await expect(checkLevel(PARAGRAPHS, TEXT)).resolves.toMatchObject({
      outcome: { kind: "failed", failure: "call" },
    });
  });

  it("refuses a body-level refusal before parsing an otherwise valid answer", async () => {
    reply = {
      kind: "answer",
      refusal: "I cannot do that.",
      content: '{"verdicts":[{"n":1,"verdict":"ok"},{"n":2,"verdict":"ok"}]}',
    };
    await expect(checkLevel(PARAGRAPHS, TEXT)).resolves.toMatchObject({
      outcome: { kind: "failed", failure: "call" },
    });
  });
});

describe("tallyChecks", () => {
  it("counts each kind of outcome once, and the first check's flags from both of their traces", () => {
    const t = tallyChecks([
      { result: "passed", attempts: 1, retriedAfterFlag: false, stored: 1 },
      { result: "passed", attempts: 2, retriedAfterFlag: false, stored: 2 },
      { result: "passed", attempts: 2, retriedAfterFlag: true, stored: 2 },
      { result: "flagged", attempts: 2, retriedAfterFlag: true, stored: 2, flags: [{ paragraph: 0, why: "" }] },
      { result: "flagged", attempts: 2, retriedAfterFlag: true, stored: 1, retryFailure: "call", flags: [{ paragraph: 0, why: "" }] },
      { result: "flagged", attempts: 2, retriedAfterFlag: false, stored: 2, flags: [{ paragraph: 1, why: "" }] },
      { result: "unchecked", attempts: 1, retriedAfterFlag: false, stored: 1, failure: "call" },
      { result: "unchecked", attempts: 2, retriedAfterFlag: true, stored: 2, failure: "unreadable" },
    ]);
    expect(t).toEqual({
      levels: 8,
      /* All but the one whose first check failed. */
      firstAnswered: 7,
      /* Three retries bought by a flag, one spent-budget flag. */
      firstFlagged: 5,
      retriedAfterFlag: 4,
      keptFirst: 1,
      budgetSpent: 1,
      storedFlagged: 3,
      unchecked: { call: 1, unreadable: 1 },
    });
  });
});

describe("the store boundary", () => {
  const p = (text: string): SimpleParagraph => ({ text, ids: [A] });
  const BASE: SimpleSummary = {
    version: "simple/2",
    generator: "m",
    slug: "s",
    sourceHash: "h",
    generatedAt: "2026-10-01T00:00:00.000Z",
    elapsedMs: 1,
    profileHash: null,
    levels: { brief: [p("a"), p("b")], fuller: [p("a"), p("b"), p("c")] },
  };
  const passed = { result: "passed", attempts: 1, retriedAfterFlag: false, stored: 1 };
  const withCheck = (fuller: unknown) => ({
    ...BASE,
    check: { checker: "simple-check/1", requestedModel: "q", levels: { brief: passed, fuller } },
  });

  it("reads a row with no record, and one with a whole record", () => {
    expect(isUsableSimpleSummary(BASE)).toBe(true);
    expect(isUsableSimpleSummary(withCheck(passed))).toBe(true);
    expect(
      isUsableSimpleSummary(
        withCheck({ result: "flagged", attempts: 2, retriedAfterFlag: true, stored: 1, retryFailure: "validation", flags: [{ paragraph: 2, why: "opposite" }] }),
      ),
    ).toBe(true);
  });

  it.each([
    ["a retry after a flag in one attempt", { result: "passed", attempts: 1, retriedAfterFlag: true, stored: 1 }],
    ["a first-attempt flag that did not spend the available retry", { result: "flagged", attempts: 1, retriedAfterFlag: false, stored: 1, flags: [{ paragraph: 0, why: "x" }] }],
    ["the first attempt kept with no flag to explain it", { result: "passed", attempts: 2, retriedAfterFlag: false, stored: 1 }],
    ["a passed result while the flagged first attempt was kept", { result: "passed", attempts: 2, retriedAfterFlag: true, stored: 1 }],
    ["an unchecked result while the flagged first attempt was kept", { result: "unchecked", attempts: 2, retriedAfterFlag: true, stored: 1, failure: "call" }],
    ["a kept first attempt with no retry failure", { result: "flagged", attempts: 2, retriedAfterFlag: true, stored: 1, flags: [{ paragraph: 0, why: "x" }] }],
    ["a kept first attempt with an unknown retry failure", { result: "flagged", attempts: 2, retriedAfterFlag: true, stored: 1, retryFailure: "timeout", flags: [{ paragraph: 0, why: "x" }] }],
    ["three attempts", { result: "passed", attempts: 3, retriedAfterFlag: false, stored: 3 }],
    ["a failure kind it does not know", { ...passed, result: "unchecked", failure: "timeout" }],
    ["a flag with no flags", { ...passed, result: "flagged", flags: [] }],
    ["a flag past the level's last paragraph", { ...passed, result: "flagged", flags: [{ paragraph: 3, why: "" }] }],
    ["a result it does not know", { ...passed, result: "maybe" }],
    ["no record for the level", undefined],
  ])("refuses a record with %s", (_, fuller) => {
    expect(isUsableSimpleSummary(withCheck(fuller))).toBe(false);
  });
});

describe("the report's SQL claims", () => {
  const report = readFileSync(new URL("../scripts/simple-check-report.ts", import.meta.url), "utf8");

  it("counts checker-active product step runs as presses, excluding eval calls and retries of the same job", () => {
    expect(report).toContain("scope_kind = 'job_step'");
    expect(report).toContain("step_name = 'simple'");
    expect(report).toContain("count(distinct run_id) as presses");
    expect(report).not.toContain("count(distinct job_id) as jobs");
  });

  it("calls a BYOK row with no upstream figure unpriced", () => {
    expect(report).toContain("is_byok is true and byok_upstream_nanos is null");
  });
});
