/**
 * **The quiz model comparison's half that calls nothing** — evals/quiz-models-lib.ts,
 * plan 261029i § Stage 4. The run waits for the OpenRouter key (it resets on
 * 2026-11-01), so these are what say the harness is ready before then.
 *
 * The one worth having is the smaller-questions arm: a replacement that no
 * longer finds its passage must throw, or the arm quietly runs today's prompt
 * under another name and the comparison measures noise (silent-success.md).
 */
import { describe, expect, it } from "vitest";
import { MAX_QUESTIONS, QUIZ_SYSTEM, renderPrompt, toQuestions } from "../src/quiz.js";
import path from "node:path";
import type { Block, Quiz, QuizDropped } from "../src/types.js";
import { readArticleFromDir } from "./helpers/article-from-dir.js";
import { FIXTURE_ROOT } from "./helpers/require-fixture.js";
import {
  ARTICLES,
  batchStats,
  CURRENT_MARKER,
  CURRENT_WRITER,
  experimentFor,
  HAIKU,
  incumbentIsA,
  MARK_ARMS,
  plan,
  RUNS,
  SMALLER_MAX_QUESTIONS,
  SMALLER_REPLACEMENTS,
  smallerInstructions,
  WRITE_ARMS,
} from "../evals/quiz-models-lib.js";
import { CASES } from "../evals/quiz-cases.js";

describe("the smaller-questions prompt", () => {
  it("replaces each passage exactly once, and nothing else", () => {
    const smaller = smallerInstructions();
    for (const { from, to } of SMALLER_REPLACEMENTS) {
      expect(QUIZ_SYSTEM).toContain(from);
      expect(smaller).not.toContain(from);
      expect(smaller).toContain(to);
    }
    expect(smaller).not.toBe(QUIZ_SYSTEM);
  });

  it("raises the cap in the request and the validator too, or the extra questions are asked for and thrown away", async () => {
    const { tree } = await readArticleFromDir(path.join(FIXTURE_ROOT, "data", ARTICLES[0]));
    expect(renderPrompt({ tree, profile: null })).toContain(`up to ${MAX_QUESTIONS} questions`);
    const smaller = experimentFor(WRITE_ARMS.find((a) => a.prompt === "smaller")!);
    expect(smaller.maxQuestions).toBe(SMALLER_MAX_QUESTIONS);
    expect(renderPrompt({ tree, profile: null, maxQuestions: smaller.maxQuestions! })).toContain(
      `up to ${SMALLER_MAX_QUESTIONS} questions`,
    );
    expect(experimentFor(WRITE_ARMS[0]!)).toEqual({ model: CURRENT_WRITER });

    const blocks = [{ id: "spya-aaaaaa", text: "The words." } as unknown as Block];
    const raw = Array.from({ length: SMALLER_MAX_QUESTIONS + 2 }, (_, i) => ({
      question: `Question ${i}?`,
      referenceAnswer: `Answer ${i}.`,
      evidence: [{ blockId: "spya-aaaaaa", quote: "The words." }],
    }));
    const fresh = () => ({ unknownIds: 0, unquoted: 0, truncated: 0, overCap: 0, malformed: 0, duplicate: 0, unanchored: 0 }) as QuizDropped;
    expect(toQuestions(raw, blocks, new Set(), fresh())).toHaveLength(MAX_QUESTIONS);
    expect(toQuestions(raw, blocks, new Set(), fresh(), SMALLER_MAX_QUESTIONS)).toHaveLength(SMALLER_MAX_QUESTIONS);
  });

  it("refuses to run when the real prompt has moved under it", () => {
    const moved = QUIZ_SYSTEM.replace(SMALLER_REPLACEMENTS[0]!.from, "something else");
    expect(() => smallerInstructions(moved)).toThrow(/rewrite SMALLER_REPLACEMENTS/);
  });
});

describe("the arms", () => {
  it("compares Haiku with what writes and marks a quiz today, the incumbent first", () => {
    expect(WRITE_ARMS[0]).toEqual({ name: "sonnet-current", model: CURRENT_WRITER, prompt: "current" });
    expect(MARK_ARMS[0]).toEqual({ name: "sonnet", model: CURRENT_MARKER });
    expect(WRITE_ARMS.some((a) => a.model === HAIKU)).toBe(true);
    expect(MARK_ARMS.some((a) => a.model === HAIKU)).toBe(true);
    expect(CURRENT_WRITER).not.toBe(HAIKU);
  });

  it("plans every arm on every article for every run, and every mark case", () => {
    const calls = plan(CASES.map((c) => c.name));
    expect(calls.filter((c) => c.half === "write")).toHaveLength(RUNS * ARTICLES.length * WRITE_ARMS.length);
    expect(calls.filter((c) => c.half === "mark")).toHaveLength(RUNS * MARK_ARMS.length * CASES.length);
    expect(calls.every((c) => c.estimate > 0)).toBe(true);
  });

  it("labels a pair the same way every time", () => {
    const names = ["write-a-run1-haiku-current", "mark-noIdea-run2", "x", "y", "z"];
    expect(names.map(incumbentIsA)).toEqual(names.map(incumbentIsA));
    /* Not all one way, or A would always be the incumbent and the read would not be blind. */
    const many = Array.from({ length: 20 }, (_, i) => incumbentIsA(`pair-${i}`));
    expect(new Set(many).size).toBe(2);
  });
});

describe("batchStats", () => {
  const blocks = Array.from({ length: 10 }, (_, i) => ({ id: `spya-b${i}`, text: "t" }) as unknown as Block);
  const q = (id: string, evidence: string[], words: string) =>
    ({
      id,
      question: words,
      referenceAnswer: "one two three",
      evidence: evidence.map((blockId) => ({ blockId, quote: "t", start: 0 })),
    }) as unknown as Quiz["questions"][number];
  const dropped = { unknownIds: 1, unquoted: 0, truncated: 5, overCap: 0, unanchored: 0, malformed: 0, duplicate: 1, gaps: 2 } as unknown as QuizDropped;

  it("counts how far apart a reader meets the questions, by each one's last evidence block", () => {
    const quiz = { questions: [q("q1", ["spya-b1", "spya-b2"], "a b"), q("q2", ["spya-b8"], "a b c d"), q("q3", ["spya-b5"], "a")] } as unknown as Quiz;
    const s = batchStats({ quiz, dropped }, blocks);
    /* Anchors 2, 5, 8 in document order, whatever the path order: gaps of 3 and 3. */
    expect(s.blocksBetween).toBe(3);
    expect(s.longestGap).toBe(3);
    expect(s.questions).toBe(3);
    expect(s.questionWords).toBeCloseTo(7 / 3);
    expect(s.answerWords).toBe(3);
    /* Evidence trimmed past the cap is not a dropped question. */
    expect(s.dropped).toBe(2);
    expect(s.gaps).toBe(2);
  });
});
