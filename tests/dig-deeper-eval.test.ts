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
import { recordSpend } from "../src/ai-spend.js";
import { INVESTIGATE_SYSTEM, investigateRequest } from "../src/citation-investigate.js";
import type { DigFindings } from "../src/dig-deeper.js";
import { explainStream } from "../src/explain.js";
import type { Block, Meta } from "../src/types.js";
import { acceptCitation, acceptExplain } from "../evals/dig-deeper/accept.js";
import { answerKey, cellRequests } from "../evals/dig-deeper/answer.js";
import {
  ARMS,
  EXPLAIN_SEARCH_AGAIN,
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
import { BudgetHalted, BudgetRefused, openBudget, paidStep } from "../evals/dig-deeper/budget.js";
import { type Capture, productionExplainRequest } from "../evals/dig-deeper/capture.js";
import { decodeScores, judgeRequest, readJudgement } from "../evals/dig-deeper/judge.js";
import { expectedSlots } from "../evals/dig-deeper/manifest.js";
import { frontier } from "../evals/dig-deeper/report.js";
import { EXAMPLES, exampleById } from "../evals/dig-deeper/examples.js";

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
    expect(systemText(arm)).toBe(systemText(prod));
    const before = lastPartText(prod);
    const after = lastPartText(arm);
    expect(before).toContain(EXPLAIN_SEARCH_AGAIN);
    expect(after).not.toContain(EXPLAIN_SEARCH_AGAIN);
    expect(after).toBe(before.replace(EXPLAIN_SEARCH_AGAIN, NO_MORE_SEARCH));
    /* The article part, with its breakpoint, byte for byte. */
    const expected = structuredClone(prod.messages) as { content: { text: string }[] }[];
    const parts = expected[1]?.content ?? [];
    const last = parts[parts.length - 1];
    if (last) last.text = last.text.replace(EXPLAIN_SEARCH_AGAIN, NO_MORE_SEARCH);
    expect(arm.messages).toEqual(expected);
  });

  it("citations: the sentence in DIG_INVESTIGATE and the What to search section are both replaced", () => {
    const prod = citationProduction();
    expect(INVESTIGATE_SYSTEM).toContain(INVESTIGATE_WHAT_TO_SEARCH);
    const arm = isolatedRequest(prod, "citation", "x-ai/grok-4.7");
    expect(systemText(arm)).toBe(INVESTIGATE_SYSTEM.replace(INVESTIGATE_WHAT_TO_SEARCH, NO_MORE_SEARCH));
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
});

/* Seen red: decodeScores reading `order[position + 1]`; planBatches dropping the
   anchor from the second batch. */
describe("the blind batches", () => {
  const sel = { examples: EXAMPLES.map((e) => e.id), arms: ARMS.map((a) => a.id), runs: 3, judges: ["opus", "sol", "kimi"], rejudge: true };
  const { judgements } = expectedSlots(sel, "opus", "261001s");

  it("decode sentinels back to the arm that wrote them", () => {
    for (const slot of judgements.slice(0, 30)) {
      const request = judgeRequest({
        model: "openai/gpt-6.1-sol",
        example: exampleById(slot.example),
        armRequest: productionExplainRequest(meta, blocks, "spya-k3m9qt", "Alpha", FINDINGS),
        lastPart: "evidence",
        answers: slot.order.map((arm, i) => ({ label: slot.labels[i] as string, text: `SENTINEL ${arm}` })),
      });
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
