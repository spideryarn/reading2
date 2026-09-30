/**
 * **The premise rule** — whether a step on the quiz's path is shown with the
 * thread it leans on, or asked on its own.
 *
 * Pure: no model, no network, no React. That is the point of keeping the rule
 * in src/web/quiz-ladder.ts rather than inside the panel — it can be read and
 * tested one cell at a time, and the panel test only has to show it is wired.
 *
 * The cases worth having are the quiet ones. A rule that always hides the
 * premise, or always shows it, looks from the outside exactly like a quiz —
 * nothing goes red and nobody is told (docs/reusable/silent-success.md). So:
 *
 * - **the only case that hides**: the reader came here with Next, from a step
 *   that was just judged right;
 * - **every way of arriving that is not that** — a jump from the list, a step
 *   back with Previous, the opening question — which shows it even when the
 *   step before was right, because the reader did not just carry that thread
 *   here;
 * - **absence**, because a failed classifier or a skip leaves no verdict, and
 *   must err towards help rather than a bare question;
 * - **a path with a gap**, where a step was dropped mid-path and the premise is
 *   the bridge across it, so it is always shown;
 * - **no premise**, where there is nothing to show whatever happened.
 *
 * docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md § The walk,
 * and GPT Sol's round-2 R2-1, which is where `arrivedByNext` and the gap rule
 * came from.
 */
import { describe, expect, it } from "vitest";
import { showPremise } from "../src/web/quiz-ladder.js";
import type { QuizQuestion } from "../src/types.js";

/** A question with only the fields the rule reads. */
function q(premise?: string): QuizQuestion {
  return {
    id: "spya-qm9qt2",
    question: "Why does he doubt it?",
    ...(premise ? { premise } : {}),
    referenceAnswer: "",
    evidence: [],
  };
}

const WITH = q("Seth ties consciousness to being alive.");
const WITHOUT = q();

describe("showPremise", () => {
  it("hides it only when the reader came by Next from a step judged right", () => {
    expect(
      showPremise({ question: WITH, previousVerdict: "right", arrivedByNext: true, batchHasGaps: false }),
    ).toBe(false);
  });

  it("shows it after a wrong answer on the step before", () => {
    expect(
      showPremise({ question: WITH, previousVerdict: "wrong", arrivedByNext: true, batchHasGaps: false }),
    ).toBe(true);
  });

  it("shows it when the step before was never judged — a skip, or a classifier that failed", () => {
    expect(
      showPremise({ question: WITH, previousVerdict: undefined, arrivedByNext: true, batchHasGaps: false }),
    ).toBe(true);
  });

  it("shows it after a jump from the list, even when the step before was right", () => {
    /* The reader answered the step before at some point, and then went
       somewhere else. Arriving here by a pick is not carrying that thread. */
    expect(
      showPremise({ question: WITH, previousVerdict: "right", arrivedByNext: false, batchHasGaps: false }),
    ).toBe(true);
  });

  it("shows it on the opening question, which has no step before", () => {
    expect(
      showPremise({ question: WITH, previousVerdict: undefined, arrivedByNext: false, batchHasGaps: false }),
    ).toBe(true);
  });

  it("always shows it on a path with a gap, even after a right answer by Next", () => {
    /* A dropped step mid-path means the step before on screen is not the one
       this premise restates, so a right verdict on it says nothing about
       whether the reader has this thread. The premise is the bridge. */
    expect(
      showPremise({ question: WITH, previousVerdict: "right", arrivedByNext: true, batchHasGaps: true }),
    ).toBe(true);
  });

  it("has nothing to show on a question without a premise, whatever happened", () => {
    for (const previousVerdict of ["right", "wrong", undefined] as const) {
      for (const arrivedByNext of [true, false]) {
        for (const batchHasGaps of [true, false]) {
          expect(
            showPremise({ question: WITHOUT, previousVerdict, arrivedByNext, batchHasGaps }),
            `${previousVerdict} / next=${arrivedByNext} / gaps=${batchHasGaps}`,
          ).toBe(false);
        }
      }
    }
  });
});
