/**
 * **The parts of the Dig deeper answer-model eval that can be wrong silently**
 * — plan 261001s § Stages, stage 2 (evals/dig-deeper/). No model is called:
 * `fetch` is stubbed, and the budget's spend records are made by hand.
 *
 * Each guard here was **seen red once** while building it (2026-10-01): the
 * guard broken in the source, this file run, the named test failing, the guard
 * restored. The note on each `describe` says what was broken.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordSpend } from "../src/ai-spend.js";
import { INVESTIGATE_SYSTEM, investigateRequest } from "../src/citation-investigate.js";
import type { DigFindings } from "../src/dig-deeper.js";
import { explainStream } from "../src/explain.js";
import type { Block, Meta } from "../src/types.js";
import { acceptCitation, acceptExplain } from "../evals/dig-deeper/accept.js";
import { answerKey, cellRequests, serverToolFeesUpperBound, totalReportedWebSearches } from "../evals/dig-deeper/answer.js";
import {
  ARMS,
  EXPLAIN_FROZEN_RESEARCH,
  EXPLAIN_WEB_RESEARCH,
  EXPLAIN_SEARCH_AGAIN,
  INVESTIGATE_HAS_WEB_TOOL,
  INVESTIGATE_SEARCH_AGAIN,
  INVESTIGATE_WHAT_TO_SEARCH,
  NO_MORE_SEARCH,
  armById,
  isolatedRequest,
  lastPartText,
  modelMatches,
  readCheckVerdict,
  systemText,
} from "../evals/dig-deeper/arms.js";
import { BudgetHalted, BudgetRefused, openBudget, paidStep, requestChars, upperBoundUsd } from "../evals/dig-deeper/budget.js";
import { type Capture, productionExplainRequest } from "../evals/dig-deeper/capture.js";
import { decodeScores, JUDGE_SYSTEM, judgeArticlePart, judgeRequest, judgementIsComplete, pointerOf, readJudgement } from "../evals/dig-deeper/judge.js";
import { expectedSlots } from "../evals/dig-deeper/manifest.js";
import { orderForCache } from "../evals/dig-deeper/preflight.js";
import { acceptability, bootstrapByExample, cacheStateOf, citationRepeatSkipsLookup, frontier, judgeStability, positionBias, probeResultFor, reconstructCold } from "../evals/dig-deeper/report.js";
import { EXAMPLES, type Example, exampleById } from "../evals/dig-deeper/examples.js";

const seen = vi.hoisted(() => ({ calls: [] as Array<{ job: unknown; body: unknown }> }));

vi.mock("../src/ai-call.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/ai-call.js")>();
  return {
    ...real,
    openRouterStream(...args: Parameters<typeof real.openRouterStream>) {
      seen.calls.push({ job: args[0], body: args[1] });
      return real.openRouterStream(...args);
    },
  };
});

const meta = { title: "A piece", url: "https://example.com/a" } as Meta;
const blocks = [
  { id: "spya-k3m9qt", html: "<p>alpha</p>", text: "Alpha is the first letter, said the author." },
  { id: "spya-aaaaaa", html: "<p>beta</p>", text: "beta" },
] as Block[];
const FINDINGS: DigFindings = {
  sources: [{ url: "https://example.org/a", title: "A page", excerpt: "What the page says." }],
  searches: 1,
  libraryQuery: '"alpha"',
  library: [{ slug: "another", title: "Another piece", blockId: "spya-bbbbbb", text: "alpha again" }],
};

const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
function finished(model: string): Response {
  const bytes = new TextEncoder().encode(
    frame({ model, choices: [{ delta: { content: "Because of X." } }] }) +
      frame({ choices: [{ finish_reason: "stop", delta: {} }], usage: {} }) +
      "data: [DONE]\n\n",
  );
  let sent = false;
  return {
    ok: true,
    headers: new Headers(),
    body: new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent) c.close();
        else {
          sent = true;
          c.enqueue(bytes);
        }
      },
    }),
  } as unknown as Response;
}

const MODEL = "anthropic/claude-opus-5.5";

function explainCapture(entry: "glossary" | "comment"): Capture {
  return {
    version: 1,
    exampleId: "t",
    entry,
    slug: "s",
    capturedAt: "x",
    commit: "x",
    articleSha256: "x",
    production: { job: "dig-deeper", request: productionExplainRequest(meta, blocks, "spya-k3m9qt", "Alpha", FINDINGS) },
    findings: FINDINGS,
    timings: { searchMs: 0, lookupMs: null, paperMs: null, passagesMs: null },
    shared: [],
  };
}

const CONTEXT = {
  title: "The Work",
  authors: "Someone",
  year: "1950",
  reference: null,
  url: "https://scholar.example/q",
  linkFrom: "search" as const,
  why: "background",
  passages: ["Alpha is the first letter, said the author."],
};
const citationProduction = () =>
  investigateRequest({ meta, blocks, context: CONTEXT, profile: null, matched: null, paper: null, findings: FINDINGS, model: MODEL });

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  seen.calls.length = 0;
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => finished(MODEL)));
});
afterEach(() => vi.unstubAllGlobals());

/* Seen red: a `max_tokens: 1500` in productionExplainRequest; and the
   EXPLAIN_SEARCH_AGAIN sentence edited by one word (replaceOnce threw). */
describe("an arm's request is production's with only the declared fields changed", () => {
  it("productionExplainRequest is exactly what explainStream sends for a dug press", async () => {
    for await (const _ of explainStream({ power: "high", meta, blocks, blockId: "spya-k3m9qt", quote: "Alpha", dig: FINDINGS, model: MODEL })) {
      // drain
    }
    expect(seen.calls).toHaveLength(1);
    expect(seen.calls[0]?.job).toBe("dig-deeper");
    expect(seen.calls[0]?.body).toEqual(productionExplainRequest(meta, blocks, "spya-k3m9qt", "Alpha", FINDINGS));
  });

  it("explain: model and tools change, the search-again sentence is replaced, nothing else moves", () => {
    const prod = productionExplainRequest(meta, blocks, "spya-k3m9qt", "Alpha", FINDINGS);
    const arm = isolatedRequest(prod, "comment", "openai/gpt-6-luna");
    expect(Object.keys(arm).sort()).toEqual(Object.keys(prod).filter((k) => k !== "tools").sort());
    expect(arm.model).toBe("openai/gpt-6-luna");
    expect(arm.max_tokens).toBe(prod.max_tokens);
    expect(systemText(prod)).toContain(EXPLAIN_WEB_RESEARCH);
    expect(systemText(arm)).not.toContain(EXPLAIN_WEB_RESEARCH);
    expect(systemText(arm)).toContain(NO_MORE_SEARCH);
    const before = lastPartText(prod);
    const after = lastPartText(arm);
    expect(before).toContain(EXPLAIN_SEARCH_AGAIN);
    expect(after).not.toContain(EXPLAIN_SEARCH_AGAIN);
    expect(after).toBe(before.replace(EXPLAIN_SEARCH_AGAIN, NO_MORE_SEARCH));
    /* The article part, with its breakpoint, byte for byte. */
    const expected = structuredClone(prod.messages) as { content: { text: string }[] }[];
    (expected[0] as unknown as { content: string }).content = systemText(prod).replace(EXPLAIN_WEB_RESEARCH, EXPLAIN_FROZEN_RESEARCH);
    const parts = expected[1]?.content ?? [];
    const last = parts[parts.length - 1];
    if (last) last.text = last.text.replace(EXPLAIN_SEARCH_AGAIN, NO_MORE_SEARCH);
    expect(arm.messages).toEqual(expected);
  });

  it("citations: the sentence in DIG_INVESTIGATE and the What to search section are both replaced", () => {
    const prod = citationProduction();
    expect(INVESTIGATE_SYSTEM).toContain(INVESTIGATE_WHAT_TO_SEARCH);
    expect(INVESTIGATE_SYSTEM).toContain(INVESTIGATE_HAS_WEB_TOOL);
    const arm = isolatedRequest(prod, "citation", "x-ai/grok-4.7");
    expect(systemText(arm)).not.toContain(INVESTIGATE_WHAT_TO_SEARCH);
    expect(systemText(arm)).not.toContain(INVESTIGATE_HAS_WEB_TOOL);
    expect(systemText(arm)).toContain(NO_MORE_SEARCH);
    expect(lastPartText(prod)).toContain(INVESTIGATE_SEARCH_AGAIN);
    expect(lastPartText(arm)).toBe(lastPartText(prod).replace(INVESTIGATE_SEARCH_AGAIN, NO_MORE_SEARCH));
    expect("tools" in arm).toBe(false);
  });

  it("refuses to edit a prompt whose sentence is not there, rather than sending it unedited", () => {
    const prod = productionExplainRequest(meta, blocks, "spya-k3m9qt", "Alpha", null as unknown as DigFindings);
    expect(() => isolatedRequest(prod, "comment", "openai/gpt-6-luna")).toThrow(/not there/);
  });

  it("the check's base is the Opus arm's own request, so it reads the Opus prefix", () => {
    const cap = explainCapture("comment");
    const [draft, base] = cellRequests({ capture: cap, arm: armById("luna+check"), ceiling: 4_000, mode: "isolated", article: { meta, blocks } });
    const [opus] = cellRequests({ capture: cap, arm: armById("opus"), ceiling: 4_000, mode: "isolated", article: { meta, blocks } });
    expect(draft?.request.model).toBe("openai/gpt-6-luna");
    expect(draft?.job).toBe("eval");
    expect(base?.request).toEqual(opus?.request);
    expect(base?.job).toBe("dig-deeper");
  });

  it("puts an enforced tool-call ceiling on the production-shaped finalist and reserves every possible search", () => {
    const cap = explainCapture("comment");
    const [call] = cellRequests({ capture: cap, arm: armById("sol"), ceiling: 4_000, mode: "production", article: { meta, blocks } });
    expect(call?.request.max_tool_calls).toBe(8);
    expect(serverToolFeesUpperBound(call?.request as never)).toBe(0.08);
  });

  it("does not turn an absent provider search count into a claimed zero", () => {
    expect(totalReportedWebSearches([{ webSearches: 0 }, { webSearches: 2 }])).toBe(2);
    expect(totalReportedWebSearches([{ webSearches: null }])).toBeNull();
    expect(totalReportedWebSearches([{} as never])).toBeNull();
  });
});

/* Seen red: decodeScores reading `order[position + 1]`; planBatches dropping the
   anchor from the second batch. */
describe("the blind batches", () => {
  const sel = { examples: EXAMPLES.map((e) => e.id), arms: ARMS.map((a) => a.id), runs: 3, judgeRuns: 2, judges: ["opus", "sol", "kimi"], rejudge: true };
  const { judgements } = expectedSlots(sel, "opus", "261001s");

  it("buys three answer runs but judges only the two declared runs", () => {
    const slots = expectedSlots(sel, "opus", "261001s");
    expect(new Set(slots.answers.map((s) => s.run))).toEqual(new Set([1, 2, 3]));
    expect(new Set(slots.judgements.filter((s) => s.pass === "main").map((s) => s.run))).toEqual(new Set([1, 2]));
  });

  it("tries the shortest article first while keeping same-article examples together", () => {
    const ordered = orderForCache(
      [{ id: "long-a", slug: "long" }, { id: "short", slug: "short" }, { id: "medium", slug: "medium" }, { id: "long-b", slug: "long" }],
      (e) => ({ short: 1, medium: 50, long: 100 })[e.slug] ?? 0,
    );
    expect(ordered.map((e) => e.id)).toEqual(["short", "long-a", "long-b", "medium"]);
  });

  it("decode sentinels back to the arm that wrote them", () => {
    for (const slot of judgements.slice(0, 30)) {
      const request = judgeRequest({
        model: "openai/gpt-6.1-sol",
        example: exampleById(slot.example),
        armRequest: productionExplainRequest(meta, blocks, "spya-k3m9qt", "Alpha", FINDINGS),
        lastPart: "evidence",
        answers: slot.order.map((arm, i) => ({ label: slot.labels[i] as string, text: `SENTINEL ${arm}` })),
      });
      expect(request.max_tokens).toBe(8_000);
      expect(request).not.toHaveProperty("response_format");
      /* A judge that scores each answer by the arm its sentinel names. */
      const text = ((request.messages as { content: { text: string }[] }[])[1]?.content[1]?.text ?? "") as string;
      const shown = [...text.matchAll(/=== ANSWER ([A-Z]) ===\n\nSENTINEL (\S+)/g)].map((m) => ({ label: m[1] as string, arm: m[2] as string }));
      expect(shown).toHaveLength(slot.order.length);
      const reply = shown.map((s) => ({ label: s.label, accuracy: 3, sourcing: 3, depth: 3, plain_words: 3, overall: ARMS.findIndex((a) => a.id === s.arm) % 10 + 1, errors: [] }));
      const read = readJudgement(JSON.stringify({ scores: reply }), slot.labels);
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      const decoded = decodeScores(read.scores, slot.order, slot.labels);
      for (const arm of slot.order) expect(decoded[arm]?.overall).toBe(ARMS.findIndex((a) => a.id === arm) % 10 + 1);
    }
  });

  it("shows a finalist judge each labelled answer's own search evidence without an arm name", () => {
    const request = judgeRequest({
      model: "openai/gpt-6.1-sol",
      example: exampleById("feynman-millikan"),
      armRequest: productionExplainRequest(meta, blocks, "spya-k3m9qt", "Alpha", FINDINGS),
      lastPart: "common evidence",
      answers: [{
        label: "Q",
        text: "an answer",
        searches: 1,
        evidence: [
          { url: "https://search.example/result", title: "Result", excerpt: "supporting extract" },
          { url: "https://search.example/huge", excerpt: `${"x".repeat(30_000)}TAIL-MUST-BE-CAPPED` },
        ],
      }],
    });
    const shown = JSON.stringify(request.messages);
    expect(shown).toContain("https://search.example/result");
    expect(shown).toContain("supporting extract");
    expect(shown).not.toContain("TAIL-MUST-BE-CAPPED");
    expect(shown).toContain("result extract was clipped");
    expect(shown).not.toContain("gpt-6-luna");
    expect(JUDGE_SYSTEM).toMatch(/production-shaped answer may have searched again/);
  });

  it("replaces an article that leaves no safe judging context with a declared gold-grounded evidence packet", () => {
    const example = {
      id: "long",
      entry: "comment",
      slug: "long",
      article: "long article",
      hard: "context",
      blockId: "spya-aaaaaa",
      quote: "target",
      gold: {
        good: "uses the relevant passage",
        weak: "misses it",
        grounded: [{ claim: "the relevant fact", blocks: ["spya-bbbbbb"] }],
        hints: [],
      },
    } as unknown as Example;
    const huge = [
      "Here is the whole article.\n\nTITLE: Long\n\n---",
      "spya-aaaaaa: target",
      "spya-bbbbbb: gold evidence",
      "spya-cccccc: nearby context",
      "spya-dddddd: nearby context",
      `spya-eeeeee: ${"irrelevant ".repeat(250_000)}`,
    ].join("\n\n");
    const request = productionExplainRequest(meta, blocks, "spya-k3m9qt", "x", FINDINGS);
    const messages = structuredClone(request.messages) as Array<{ role: string; content: unknown }>;
    const user = messages.at(-1);
    if (!user) throw new Error("test request has no user message");
    (user.content as Array<{ type: string; text: string }>)[0]!.text = huge;
    const part = judgeArticlePart(example, { ...request, messages });
    expect(part).toContain("ARTICLE EVIDENCE PACKET");
    expect(part).toContain("spya-aaaaaa: target");
    expect(part).toContain("spya-bbbbbb: gold evidence");
    expect(part).not.toContain("irrelevant irrelevant");
    expect(part.length).toBeLessThan(10_000);

    /* A Kuhn-sized article (~255k tokens) is judged whole: every judge's
       window is 1M or more, and the far-away passages are the test. */
    (user.content as Array<{ type: string; text: string }>)[0]!.text = huge.replace(
      "irrelevant ".repeat(250_000),
      "irrelevant ".repeat(92_000),
    );
    const kuhnSized = judgeArticlePart(example, { ...request, messages });
    expect(kuhnSized).not.toContain("ARTICLE EVIDENCE PACKET");
    expect(kuhnSized).toContain("irrelevant irrelevant");
  });

  it("every batch has the anchor, every arm is in exactly one batch per judging, and letters are distinct", () => {
    const groups = new Map<string, string[][]>();
    for (const s of judgements) {
      expect(s.order).toContain("opus");
      expect(new Set(s.labels).size).toBe(s.labels.length);
      expect(s.order.length).toBeGreaterThanOrEqual(4);
      expect(s.order.length).toBeLessThanOrEqual(5);
      const k = `${s.example}|${s.run}|${s.judge}|${s.pass}`;
      groups.set(k, [...(groups.get(k) ?? []), s.order]);
    }
    for (const orders of groups.values()) {
      const members = orders.flatMap((o) => o.filter((a) => a !== "opus")).sort();
      expect(members).toEqual(ARMS.map((a) => a.id).filter((a) => a !== "opus").sort());
    }
  });

  it("balances positions: no arm sits mostly first or mostly last", () => {
    const rel = new Map<string, number[]>();
    for (const s of judgements) {
      s.order.forEach((arm, i) => {
        rel.set(arm, [...(rel.get(arm) ?? []), i / (s.order.length - 1)]);
      });
    }
    for (const [arm, xs] of rel) {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      expect(m, arm).toBeGreaterThan(0.35);
      expect(m, arm).toBeLessThan(0.65);
    }
  });
});

/* Seen red: the `would > cap` check removed from reserve; settle accepting a
   null cost; a finished call with no cost not halting; a cut-off call settled
   at zero instead of its bound. */
describe("the budget", () => {
  const record = (
    cost: { source: "provider"; costNanos: number } | { source: "none" },
    outcome: "ok" | "error" | "aborted" = "ok",
    answered = outcome !== "error",
  ) =>
    recordSpend({
      job: "eval",
      wire: "chat",
      model: "openai/gpt-6-luna",
      answeredBy: answered ? "openai/gpt-6-luna" : null,
      cost,
      upstreamCostNanos: null,
      providerAccount: "openrouter",
      generationId: null,
      upstream: null,
      credentialFingerprint: null,
      isByok: null,
      inputTokens: outcome === "ok" ? 100 : null,
      outputTokens: outcome === "ok" ? 10 : null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      cacheWrite5mTokens: null,
      cacheWrite1hTokens: null,
      reasoningTokens: null,
      webSearches: null,
      serviceTier: null,
      inferenceGeo: null,
      ms: 1,
      outcome,
    } as Parameters<typeof recordSpend>[0]);

  it("refuses before the call when the bound would pass the cap, and the call never runs", async () => {
    const budget = openBudget(null, 1);
    const fn = vi.fn(async () => "ran");
    await paidStep(budget, { id: "a", label: "a", boundUsd: 0.6 }, {}, async () => {
      record({ source: "provider", costNanos: 500_000_000 });
      return "ok";
    });
    expect(budget.state().spentUsd).toBeCloseTo(0.5);
    await expect(paidStep(budget, { id: "b", label: "b", boundUsd: 0.6 }, {}, fn)).rejects.toBeInstanceOf(BudgetRefused);
    expect(fn).not.toHaveBeenCalled();
  });

  it("persists the run's cap and refuses a later invocation that tries to raise it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dig-budget-"));
    const file = path.join(dir, "budget.json");
    try {
      const first = openBudget(file, 1);
      first.close();
      expect(() => openBudget(file, 2)).toThrow(/planned with a .* cap/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prices a reservation from a true token upper bound, including non-ASCII bytes", () => {
    /* Kimi input is $0.41/M. Six UTF-8 bytes cannot be more than six tokens. */
    const bytes = requestChars("££");
    expect(bytes).toBe(Buffer.byteLength(JSON.stringify("££")));
    expect(upperBoundUsd("moonshotai/kimi-k3", bytes, 0)).toBeGreaterThanOrEqual((bytes * 0.41) / 1e6);
  });

  it("halts on a call that answered and reported no cost, and refuses everything after", async () => {
    const budget = openBudget(null, 10);
    await expect(
      paidStep(budget, { id: "a", label: "a", boundUsd: 0.1 }, {}, async () => {
        record({ source: "none" });
        return "ok";
      }),
    ).rejects.toBeInstanceOf(BudgetHalted);
    expect(budget.state().halted).toMatch(/no usable cost/);
    const fn = vi.fn(async () => "ran");
    await expect(paidStep(budget, { id: "b", label: "b", boundUsd: 0.01 }, {}, fn)).rejects.toBeInstanceOf(BudgetHalted);
    expect(fn).not.toHaveBeenCalled();
  });

  it("settles a call our clock cut off, with no cost reported, at the step's whole bound", async () => {
    const budget = openBudget(null, 10);
    await paidStep(budget, { id: "a", label: "a", boundUsd: 0.3 }, {}, async () => {
      record({ source: "none" }, "aborted");
      return "timed out";
    });
    expect(budget.state().halted).toBeNull();
    expect(budget.state().spentUsd).toBeCloseTo(0.3);
    expect(budget.state().settled[0]?.note).toMatch(/cut off/);
  });

  it("does not add a known first call on top of the whole-step bound when a later call is cut off", async () => {
    const budget = openBudget(null, 10);
    await paidStep(budget, { id: "a", label: "a", boundUsd: 0.3 }, {}, async () => {
      record({ source: "provider", costNanos: 50_000_000 });
      record({ source: "none" }, "aborted");
      return "timed out";
    });
    expect(budget.state().spentUsd).toBeCloseTo(0.3);
  });

  it("settles a refusal that generated nothing at zero, with a note", async () => {
    const budget = openBudget(null, 10);
    await paidStep(budget, { id: "a", label: "a", boundUsd: 0.1 }, {}, async () => {
      record({ source: "none" }, "error");
      return "refused";
    });
    expect(budget.state().halted).toBeNull();
    expect(budget.state().settled[0]?.note).toMatch(/refused before answering/);
  });
});

/* Seen red: the duplicate-label check removed; the range check widened to 0-10. */
describe("a judge's reply is refused unless it is exactly right", () => {
  const good = (label: string) => ({ label, accuracy: 4, sourcing: 4, depth: 3, plain_words: 5, overall: 7, errors: [{ error: "x", evidence: "spya-k3m9qt" }] });
  it("accepts a complete reply", () => {
    expect(readJudgement(JSON.stringify({ scores: [good("A"), good("Q")] }), ["A", "Q"]).ok).toBe(true);
    expect(readJudgement(`\`\`\`json\n${JSON.stringify({ scores: [good("A"), good("Q")] })}\n\`\`\``, ["A", "Q"]).ok).toBe(true);
  });
  it("shows the judge valid JSON as the exact reply shape", () => {
    const shown = /The exact shape is (\{[\s\S]*?\})\. Replace A/.exec(JUDGE_SYSTEM)?.[1];
    expect(() => JSON.parse(shown ?? "")).not.toThrow();
  });
  it.each([
    ["a missing label", { scores: [good("A")] }, /not scored: Q/],
    ["a duplicate label", { scores: [good("A"), good("A"), good("Q")] }, /twice/],
    ["an extra label", { scores: [good("A"), good("Q"), good("Z")] }, /unexpected label Z/],
    ["a score out of range", { scores: [good("A"), { ...good("Q"), accuracy: 6 }] }, /accuracy is 6/],
    ["a non-integer score", { scores: [good("A"), { ...good("Q"), overall: 7.5 }] }, /overall is 7.5/],
    ["an extra key", { scores: [good("A"), { ...good("Q"), confidence: 3 }] }, /keys/],
    ["an extra top-level key", { scores: [good("A"), good("Q")], note: "hi" }, /top-level/],
    ["an error without evidence", { scores: [good("A"), { ...good("Q"), errors: [{ error: "x" }] }] }, /malformed error/],
  ])("refuses %s", (_name, reply, why) => {
    const read = readJudgement(JSON.stringify(reply), ["A", "Q"]);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.why).toMatch(why);
  });
  it("refuses prose", () => {
    expect(readJudgement("Here are my scores: A 7", ["A"]).ok).toBe(false);
  });

  it("does not count a failed judge call as a complete cell", () => {
    expect(judgementIsComplete({ order: ["opus"], scores: null, failure: "refused reply: prose" })).toBe(false);
    expect(judgementIsComplete({ order: ["opus"], scores: {}, failure: null })).toBe(false);
    expect(judgementIsComplete({ order: ["opus"], scores: { opus: {} as never }, failure: null })).toBe(true);
    expect(judgementIsComplete({ order: ["opus"], scores: null, failure: "skipped: the anchor was not delivered" })).toBe(true);
  });
});

describe("the report's predeclared statistics", () => {
  const score = (judge: string, accuracy = 4, sourcing = 4) => ({
    example: "e",
    run: 1,
    judge,
    pass: "main",
    batch: 0,
    anchor: 7,
    s: { accuracy, sourcing, depth: 4, plain_words: 4, overall: 7, errors: [], position: 0 },
  });

  it("never calls one judge acceptable under the declared two-of-three rule", () => {
    expect(acceptability([score("opus")], true)).toBe(false);
    expect(acceptability([score("opus"), score("sol")], true)).toBe(true);
  });

  it("counts a judge once when the anchor appears in several batches", () => {
    expect(acceptability([score("opus"), { ...score("opus"), batch: 1 }, score("sol", 3, 3)], true)).toBe(false);
  });

  it("requires the same outside-knowledge fact for the factual-error gate", () => {
    const withOutsideError = (judge: string, error: string) => ({
      ...score(judge),
      s: { ...score(judge).s, errors: [{ error, evidence: `outside knowledge: ${error}` }] },
    });
    expect(acceptability([withOutsideError("opus", "wrong date"), withOutsideError("sol", "wrong affiliation")], true)).toBe(true);
    expect(acceptability([withOutsideError("opus", "Wrong date."), withOutsideError("sol", "wrong   date")], true)).toBe(false);
    expect(pointerOf("[OWN 2] contradicts it")).toEqual({ kind: "source", ref: "[own:2]" });
  });

  it("reuses a probe only for the same arm and model", () => {
    const old = { arm: "sol", model: "openai/old", ok: true, searches: 1, status: "ok", usd: 0.01 };
    expect(probeResultFor([old], "sol", "openai/new")).toBeNull();
    expect(probeResultFor([old], "sol", "openai/old")).toEqual(old);
  });

  it("bootstraps example means, so an example with more judge rows gets no extra weight", () => {
    const ci = bootstrapByExample(new Map([
      ["one", [0]],
      ["two", [0]],
      ["three", [0]],
      ["four", [0]],
      ["five", [0]],
      ["six", Array.from({ length: 100 }, () => 10)],
    ]), "equal examples", 4_000);
    expect(ci?.[0]).toBe(0);
    expect(ci?.[1] ?? 10).toBeLessThan(7);
  });

  it("averages the repeated anchor batches before measuring judge stability", () => {
    const cell = (pass: "main" | "rejudge", batch: number, overall: number) => ({
      example: "e",
      run: 1,
      judge: "opus",
      pass,
      batch,
      scores: { opus: { overall } },
    });
    const judgements = new Map([
      ["m0", cell("main", 0, 1)],
      ["m1", cell("main", 1, 9)],
      ["r0", cell("rejudge", 0, 5)],
      ["r1", cell("rejudge", 1, 5)],
    ]);
    expect(judgeStability({ judgements } as never)).toEqual({ pairs: 1, meanAbs: 0, within1: 1 });
  });

  it("reports position against the same batch's anchor, not only a confounded raw mean", () => {
    const judgements = new Map([
      ["a", { pass: "main", scores: { opus: { overall: 9, position: 0 }, sol: { overall: 8, position: 1 } } }],
      ["b", { pass: "main", scores: { opus: { overall: 3, position: 1 }, sol: { overall: 4, position: 0 } } }],
    ]);
    expect(positionBias({ judgements } as never)).toEqual([
      { position: 0, anchorN: 1, anchorOverall: 9, relativeN: 1, vsAnchor: 1 },
      { position: 1, anchorN: 1, anchorOverall: 3, relativeN: 1, vsAnchor: -1 },
    ]);
  });

  it("treats a model with no cache price advantage as a valid repeat, not a cache miss", () => {
    expect(cacheStateOf({ requested: "moonshotai/kimi-k3", inputTokens: 100, cacheReadTokens: 0 } as never, 0.8)).toBe("not-applicable");
  });

  it("reconstructs a cold press from the provider's actual cached-token count, not a character-ratio cap", () => {
    const call = { requested: "anthropic/claude-opus-5.5", usd: 0.01, inputTokens: 100, cacheReadTokens: 80 } as never;
    expect(reconstructCold(call, 0.5)).toBeCloseTo(0.01 + (80 * (5 - 0.2)) / 1e6, 8);
  });

  it("charges a repeated Citation lookup again after no-match, but not after an assessed result", () => {
    const capture = explainCapture("comment");
    const citation = (lookupRan: boolean, lookupOutcome: "found" | "no-match" | null, lookupState: "assessed" | "unreadable" | null): Capture => ({
      ...capture,
      entry: "citation",
      citation: { context: CONTEXT, matched: null, lookupRan, lookupOutcome, lookupState, paperState: "no-address", paperRead: false, paperPassages: null },
    });
    expect(citationRepeatSkipsLookup(citation(true, "no-match", null))).toBe(false);
    expect(citationRepeatSkipsLookup(citation(true, "found", "unreadable"))).toBe(false);
    expect(citationRepeatSkipsLookup(citation(true, "found", "assessed"))).toBe(true);
    expect(citationRepeatSkipsLookup(citation(false, null, null))).toBe(true);
  });
});

/* Seen red: answerKey with the requests left out of the hash. */
describe("a cell's key", () => {
  it("changes when the request does, and only then", () => {
    const cap = explainCapture("comment");
    const inp = { capture: cap, arm: armById("sol"), ceiling: 4_000, mode: "isolated" as const, article: { meta, blocks } };
    const k1 = answerKey(inp, "sha", "src");
    expect(answerKey(inp, "sha", "src")).toBe(k1);
    const changed: Capture = { ...cap, production: { ...cap.production, request: productionExplainRequest(meta, blocks, "spya-k3m9qt", "Alpha!", FINDINGS) } };
    expect(answerKey({ ...inp, capture: changed }, "sha", "src")).not.toBe(k1);
    expect(answerKey({ ...inp, ceiling: 8_000 }, "sha", "src")).not.toBe(k1);
    expect(answerKey(inp, "sha2", "src")).not.toBe(k1);
    expect(answerKey(inp, "sha", "src2")).not.toBe(k1);
    expect(answerKey({ ...inp, arm: armById("kimi-k3") }, "sha", "src")).not.toBe(k1);
  });
});

/* Seen red: acceptExplain skipping refuseUnfinished; acceptCitation with the
   quote guard swapped for a pass-through. (Deleting only the per-delta stop was
   NOT seen red: the guard's `end()` catches the same span, so that line is a
   belt to the braces, not the guard.) */
describe("each entry point's acceptance rule", () => {
  it("a glossary press refuses a truncated answer; a comment keeps it", () => {
    expect(acceptExplain("glossary", "truncated", "half an answer").delivered).toBe(false);
    expect(acceptExplain("comment", "truncated", "half an answer").delivered).toBe(true);
    expect(acceptExplain("glossary", "finished", "a whole answer").delivered).toBe(true);
    expect(acceptExplain("glossary", "filtered", "x").delivered).toBe(false);
  });
  it("both refuse what explain throws on, and an empty answer", () => {
    for (const kind of ["timed-out", "went-quiet", "provider-failed", "unterminated"] as const) {
      expect(acceptExplain("comment", kind, "text").delivered).toBe(false);
    }
    expect(acceptExplain("comment", "finished", "   ").delivered).toBe(false);
  });
  const input = { blocks, context: CONTEXT, matched: null, findings: FINDINGS, ownEvidence: [], paperRead: false };
  it("Citations runs the quote guard", () => {
    expect(acceptCitation("finished", ["The work is about ", "“a thing nobody wrote”", " and more."], input).delivered).toBe(false);
    expect(acceptCitation("finished", ["Does it back the claim?\nYes, plainly."], input).delivered).toBe(true);
  });
  it("Citations keeps only finished, and refuses an answer with nothing read", () => {
    expect(acceptCitation("truncated", ["Fine prose."], input).delivered).toBe(false);
    expect(acceptCitation("unknown-finish-reason", ["Fine prose."], input).delivered).toBe(false);
    expect(acceptCitation("finished", ["Fine prose."], { ...input, findings: { ...FINDINGS, sources: [] } }).delivered).toBe(false);
    expect(acceptCitation("finished", ["Fine prose."], { ...input, findings: { ...FINDINGS, sources: [] }, paperRead: true }).delivered).toBe(true);
  });
});

/* Seen red: frontier comparing `>` on both axes (so ties dominated nothing). */
describe("the frontier", () => {
  it("keeps the arms nothing beats on both, and drops a tie that is dearer", () => {
    const points = [
      { arm: "opus", quality: 0.9, cost: 0.3 },
      { arm: "cheap", quality: 0.5, cost: 0.01 },
      { arm: "mid", quality: 0.8, cost: 0.1 },
      { arm: "worse-mid", quality: 0.7, cost: 0.12 },
      { arm: "same-dearer", quality: 0.8, cost: 0.2 },
    ];
    expect(frontier(points).sort()).toEqual(["cheap", "mid", "opus"]);
  });
});

/* Seen red: modelMatches accepting any suffix after the requested id;
   readCheckVerdict reading unparseable text (`OK`) as keep. */
describe("the answering model and the check's verdict", () => {
  it("accepts the asked-for model or a dated snapshot of it, and refuses anything else", () => {
    expect(modelMatches("openai/gpt-6-luna", "openai/gpt-6-luna")).toBe(true);
    expect(modelMatches("openai/gpt-6-luna", "openai/gpt-6-luna-20260922")).toBe(true);
    expect(modelMatches("deepseek/deepseek-v4.1-flash", "deepseek/deepseek-v4.1-flash-0731")).toBe(true);
    expect(modelMatches("openai/gpt-6-luna", "openai/gpt-6-sol")).toBe(false);
    expect(modelMatches("deepseek/deepseek-v4.1-flash", "deepseek/deepseek-v4.1-flash-latest")).toBe(false);
    expect(modelMatches("deepseek/deepseek-v4.1-flash", "deepseek/deepseek-v4.1-flash-vision-exp")).toBe(false);
    expect(modelMatches("anthropic/claude-opus-5.5", null)).toBe(false);
  });
  it("takes exactly keep or a non-empty replace", () => {
    expect(readCheckVerdict('{"action":"keep"}')).toEqual({ action: "keep" });
    expect(readCheckVerdict('```json\n{"action":"replace","answer":"Better."}\n```')).toEqual({ action: "replace", answer: "Better." });
    for (const bad of ["OK", "OK.", '{"action":"keep","why":"fine"}', '{"action":"replace","answer":"  "}', '{"action":"replace"}', '{"action":"rewrite","answer":"x"}', "[]"]) {
      expect(readCheckVerdict(bad), bad).toBeNull();
    }
  });
});
