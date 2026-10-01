/**
 * The blind order in evals/quiz-reading-goal.ts — the one deterministic part of
 * a paid measurement, and the part docs/project/prompting-guide.md warns about:
 * a float coin once put the new arm on one side 94 times in 95. Plan:
 * docs/plans/261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md.
 */
import { describe, expect, it } from "vitest";
import { blindOrder } from "../evals/quiz-reading-goal.js";

const items = (arms: string[], n: number) => arms.flatMap((arm) => Array.from({ length: n }, (_, index) => ({ arm, index })));

describe("the blind order", () => {
  it("is fixed by its seed, and another seed gives another order", () => {
    const xs = items(["old-goal-1", "new-goal-1"], 20);
    expect(blindOrder("s1", xs)).toEqual(blindOrder("s1", xs));
    expect(blindOrder("s1", xs)).not.toEqual(blindOrder("s2", xs));
  });

  it("keeps every item, once", () => {
    const xs = items(["a", "b", "c"], 19);
    const out = blindOrder("seed", xs);
    expect(out).toHaveLength(xs.length);
    expect(new Set(out.map((x) => `${x.arm}/${x.index}`)).size).toBe(xs.length);
  });

  it("does not bunch one arm into one half of the sheet, over many seeds", () => {
    /* Two arms of twenty: the first half should hold about ten of each. Across
       200 seeds the mean share stays near a half and no seed is all-one-side. */
    const xs = items(["old", "new"], 20);
    let total = 0;
    for (let s = 0; s < 200; s++) {
      const firstHalf = blindOrder(`seed-${s}`, xs).slice(0, 20);
      const news = firstHalf.filter((x) => x.arm === "new").length;
      expect(news).toBeGreaterThan(2);
      expect(news).toBeLessThan(18);
      total += news;
    }
    expect(total / 200).toBeGreaterThan(9);
    expect(total / 200).toBeLessThan(11);
  });
});
