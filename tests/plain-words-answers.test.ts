import { describe, expect, it } from "vitest";
import { type Answer, assertCompleteArm } from "../evals/plain-words/answers.js";

const CASES: Record<string, string[]> = {
  "entropy-24-00930-spya-pywwkq": ["transfer entropy", "synergistic"],
  "olah-a4-spya-ujr7p0": ["superposition", "monosemantic"],
  "noema-mythology-of-conscious-ai": ["computational functionalism", "autopoiesis"],
};

function completeArm(): Answer[] {
  return Object.entries(CASES).flatMap(([slug, terms]) =>
    terms.flatMap((term) =>
      (["term", "sentence", "chat"] as const).map((kind) => ({
        slug,
        term,
        kind,
        asked: `${kind}: ${term}`,
        text: "answer",
        searches: 0,
      })),
    ),
  );
}

describe("the fixed answer-eval cases", () => {
  it("rejects 18 distinct answers when one fixed case was replaced", () => {
    const answers = completeArm();
    answers[0] = { ...answers[0]!, term: "substituted case" };

    expect(() => assertCompleteArm("test", answers)).toThrow(/transfer entropy/);
  });
});
