import { describe, expect, it } from "vitest";

import { ARMS, assertArmRunnable, HAIKU } from "../evals/citations-recall/run.js";

const CURRENT = {
  promptVersion: "citations/8",
  model: HAIKU,
  effort: "high" as const,
};

describe("the citations-recall run's arm guards", () => {
  it("accepts the production arm only when its model and effort are production's", () => {
    expect(() => assertArmRunnable("P", ARMS.P!, CURRENT)).not.toThrow();
    expect(() => assertArmRunnable("P", ARMS.P!, { ...CURRENT, model: "another/model" })).toThrow(/model|production sends/i);
    expect(() => assertArmRunnable("P", ARMS.P!, { ...CURRENT, effort: "low" })).toThrow(/effort|production sends/i);
  });

  it("refuses every citations/7 arm after production's prompt changes", () => {
    for (const [name, arm] of Object.entries(ARMS).filter(([, arm]) => arm.prompt !== "production")) {
      expect(() => assertArmRunnable(name, arm, CURRENT), name).toThrow(/measured against citations\/7/);
      expect(() => assertArmRunnable(name, arm, { ...CURRENT, promptVersion: "citations/7" }), name).not.toThrow();
    }
  });
});
