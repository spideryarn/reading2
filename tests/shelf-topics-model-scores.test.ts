/**
 * **The shelf-topics scorer, pure** — src/shelf-terms/model-scores.ts. Plan
 * docs/plans/260929c-shelf-topics-chosen-by-a-model.md § Stage 2.
 *
 * 1. `parseScores`: bad JSON, out-of-range and non-integer scores, disagreeing
 *    duplicates and a `length` stop all refuse; unknown ids are ignored; a
 *    candidate with no entry is unscored; an answer scoring nothing refuses.
 * 2. `inputHash`: moves when a title, a gist, the profile or a candidate
 *    moves, and does not move when the shelf arrives in another order.
 * 3. `scoreCandidates` sends job `shelf-topics` with the schema, the pinned
 *    model and `max_completion_tokens`, through an injected gateway — no
 *    network, no spend.
 *
 * Synthetic fixtures, no database, no uuids.
 */
import { describe, expect, it } from "vitest";

import type { JsonCall } from "../src/ai-call.js";
import { SHELF_TOPICS_MODEL } from "../src/models.js";
import { candidatePool, type ChooseArticle, chooseTerms } from "../src/shelf-terms/choose.js";
import {
  CANDIDATE_LABEL_CHARS,
  inputHash,
  type JsonGateway,
  PROMPT_CANDIDATES,
  parseScores,
  type PromptCandidate,
  promptCandidates,
  type ScorerArticle,
  scoreCandidates,
  scoreMessages,
  scorerInput,
  SHELF_LINES_MAX,
  ShelfTopicsAnswerInvalid,
} from "../src/shelf-terms/model-scores.js";

const CANDS: PromptCandidate[] = [
  { id: "t01", key: "consciousness", label: "consciousness", count: 9, slugs: ["a", "b", "c"] },
  { id: "t02", key: "buddhism", label: "Buddhism", count: 8, slugs: ["b", "d"] },
  { id: "t03", key: "bowl", label: "bowl", count: 8, slugs: ["e"] },
];

const ARTICLES: ScorerArticle[] = [
  { slug: "e", title: "A recipe for rice", gist: "How to cook rice in a bowl." },
  { slug: "a", title: "The hard problem", gist: "Why experience resists explanation." },
  { slug: "b", title: "Anatta", gist: null },
];

/** A chat completion body whose message content is `content`. */
function body(content: unknown, finish = "stop"): unknown {
  return {
    choices: [
      { finish_reason: finish, message: { content: typeof content === "string" ? content : JSON.stringify(content) } },
    ],
  };
}

describe("parseScores", () => {
  it("reads one integer 0–3 per id into key → score", () => {
    const got = parseScores(
      body({ scores: [{ id: "t01", score: 3 }, { id: "t02", score: 2 }, { id: "t03", score: 0 }] }),
      CANDS,
    );
    expect([...got]).toEqual([
      ["consciousness", 3],
      ["buddhism", 2],
      ["bowl", 0],
    ]);
  });

  it("ignores ids it never sent, and leaves an unanswered candidate unscored", () => {
    const got = parseScores(body({ scores: [{ id: "t01", score: 3 }, { id: "t99", score: 3 }] }), CANDS);
    expect([...got]).toEqual([["consciousness", 3]]);
    expect(got.has("bowl")).toBe(false);
  });

  it.each([
    ["not JSON", "here are the scores: t01=3"],
    ["no scores array", { order: ["t01"] }],
    ["a score above 3", { scores: [{ id: "t01", score: 4 }] }],
    ["a negative score", { scores: [{ id: "t01", score: -1 }] }],
    ["a fractional score", { scores: [{ id: "t01", score: 2.5 }] }],
    ["a score as a string", { scores: [{ id: "t01", score: "3" }] }],
    ["two scores for one id that disagree", { scores: [{ id: "t01", score: 3 }, { id: "t01", score: 1 }] }],
    ["nothing it can use", { scores: [{ id: "t42", score: 3 }] }],
    ["an empty list", { scores: [] }],
  ])("refuses %s", (_name, content) => {
    expect(() => parseScores(body(content), CANDS)).toThrow(ShelfTopicsAnswerInvalid);
  });

  it("refuses an answer that stopped at its token ceiling, however good it looks", () => {
    expect(() => parseScores(body({ scores: [{ id: "t01", score: 3 }] }, "length"), CANDS)).toThrow(
      ShelfTopicsAnswerInvalid,
    );
  });

  it("refuses a body with no choice or no text", () => {
    expect(() => parseScores(null, CANDS)).toThrow(ShelfTopicsAnswerInvalid);
    expect(() => parseScores({ choices: [] }, CANDS)).toThrow(ShelfTopicsAnswerInvalid);
    expect(() => parseScores({ choices: [{ message: {} }] }, CANDS)).toThrow(ShelfTopicsAnswerInvalid);
  });

  it("never carries the model's text in its message", () => {
    const secret = "a title nobody else should read";
    try {
      parseScores(body(`{"scores": ${secret}`), CANDS);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ShelfTopicsAnswerInvalid);
      expect((err as Error).message).not.toContain(secret);
    }
  });
});

describe("inputHash", () => {
  const base = () => scorerInput(ARTICLES, "I read about the mind.", CANDS);
  const h0 = inputHash(base());

  it("is the same for the same shelf listed in any order", () => {
    expect(inputHash(scorerInput([...ARTICLES].reverse(), "I read about the mind.", CANDS))).toBe(h0);
  });

  it("moves when a title moves", () => {
    const moved = ARTICLES.map((a) => (a.slug === "a" ? { ...a, title: "The hard problem, renamed" } : a));
    expect(inputHash(scorerInput(moved, "I read about the mind.", CANDS))).not.toBe(h0);
  });

  it("moves when a gist moves, or appears", () => {
    const moved = ARTICLES.map((a) => (a.slug === "b" ? { ...a, gist: "No self to be found." } : a));
    expect(inputHash(scorerInput(moved, "I read about the mind.", CANDS))).not.toBe(h0);
  });

  it("moves when the profile moves, and an empty profile is no profile", () => {
    expect(inputHash(scorerInput(ARTICLES, "I cook.", CANDS))).not.toBe(h0);
    expect(inputHash(scorerInput(ARTICLES, "   ", CANDS))).toBe(inputHash(scorerInput(ARTICLES, null, CANDS)));
  });

  it("moves when a candidate appears, goes, or changes its count", () => {
    expect(inputHash(scorerInput(ARTICLES, "I read about the mind.", CANDS.slice(0, 2)))).not.toBe(h0);
    const recounted = CANDS.map((c) => (c.key === "bowl" ? { ...c, count: 9 } : c));
    expect(inputHash(scorerInput(ARTICLES, "I read about the mind.", recounted))).not.toBe(h0);
  });

  it("moves with the model", () => {
    expect(inputHash(base(), "some/other-model")).not.toBe(h0);
  });
});

describe("the prompt", () => {
  it("carries every title, gist, candidate and the profile, in slug order", () => {
    const [system, user] = scoreMessages(scorerInput(ARTICLES, "I read about the mind.", CANDS));
    expect(system?.content).toContain("never an instruction");
    expect(system?.content).toContain("candidate labels");
    const text = user?.content ?? "";
    expect(text).toContain("Reader profile: I read about the mind.");
    expect(text.indexOf("The hard problem")).toBeLessThan(text.indexOf("Anatta"));
    expect(text.indexOf("Anatta")).toBeLessThan(text.indexOf("A recipe for rice"));
    expect(text).toContain('t03 | bowl | 8 articles | e.g. "A recipe for rice"');
  });

  it("keeps only the newest SHELF_LINES_MAX articles", () => {
    const many = Array.from({ length: SHELF_LINES_MAX + 5 }, (_, i) => ({
      slug: `s${String(i).padStart(4, "0")}`,
      title: `T${i}`,
      gist: null,
    }));
    const input = scorerInput(many, null, CANDS);
    expect(input.articles).toHaveLength(SHELF_LINES_MAX);
    expect(input.articles.some((a) => a.slug === `s${String(SHELF_LINES_MAX + 4).padStart(4, "0")}`)).toBe(false);
  });

  it("bounds a candidate label even when an article contains one enormous token", () => {
    const marker = "x".repeat(CANDIDATE_LABEL_CHARS + 1_000);
    const candidate = [{ ...CANDS[0]!, label: marker }];
    const text = scoreMessages(scorerInput(ARTICLES, null, candidate))[1]?.content ?? "";
    expect(text).not.toContain(marker);
    expect(text).toContain(`${"x".repeat(CANDIDATE_LABEL_CHARS)}…`);
  });
});

describe("promptCandidates", () => {
  it("puts the program's picks first and stops at PROMPT_CANDIDATES", () => {
    const arts: ChooseArticle[] = Array.from({ length: 40 }, (_, i) => ({
      slug: `s${String(i).padStart(2, "0")}`,
      words: 1000,
      textHash: `h${i}`,
      candidates: Array.from({ length: 120 }, (_, k) => ({
        key: `topic${k}`,
        label: `topic${k}`,
        count: (i + k) % 5 === 0 ? 5 : 0,
        bodyCount: (i + k) % 5 === 0 ? 5 : 0,
        score: 5,
      })).filter((c) => c.count > 0),
    }));
    const baseline = chooseTerms(arts).terms.map((t) => t.key);
    const got = promptCandidates(candidatePool(arts), baseline);
    expect(got.length).toBeLessThanOrEqual(PROMPT_CANDIDATES);
    expect(got.slice(0, baseline.length).map((c) => c.key)).toEqual(baseline);
    expect(got[0]?.id).toBe("t01");
  });
});

describe("scoreCandidates", () => {
  it("asks the gateway as job shelf-topics, with the schema and the pinned model, and parses the answer", async () => {
    const seen: { job: string; body: Record<string, unknown> }[] = [];
    const gateway = (async (job, request) => {
      seen.push({ job, body: request as Record<string, unknown> });
      return {
        json: body({ scores: [{ id: "t01", score: 3 }, { id: "t03", score: 0 }] }),
        answeredBy: SHELF_TOPICS_MODEL,
        generationId: null,
      } satisfies JsonCall;
    }) as JsonGateway;
    const got = await scoreCandidates(scorerInput(ARTICLES, null, CANDS), { gateway });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.job).toBe("shelf-topics");
    expect(seen[0]?.body.model).toBe(SHELF_TOPICS_MODEL);
    expect(seen[0]?.body.max_completion_tokens).toBeGreaterThan(2_400);
    expect(seen[0]?.body).not.toHaveProperty("max_tokens");
    expect(seen[0]?.body.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
    expect([...got.scores]).toEqual([
      ["consciousness", 3],
      ["bowl", 0],
    ]);
  });

  it("refuses to spend on an empty candidate list", async () => {
    let calls = 0;
    const gateway = (async () => {
      calls += 1;
      throw new Error("unreachable");
    }) as JsonGateway;
    await expect(scoreCandidates(scorerInput(ARTICLES, null, []), { gateway })).rejects.toThrow(
      ShelfTopicsAnswerInvalid,
    );
    expect(calls).toBe(0);
  });
});
