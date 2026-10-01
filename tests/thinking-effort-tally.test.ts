import { describe, expect, it } from "vitest";

import { armSelection, judgingSubdir } from "../evals/thinking-effort/tally.js";

describe("thinking-effort tally inputs", () => {
  it("uses the requested judging round and refuses a missing value", () => {
    expect(judgingSubdir(["--judging", "illustrated-low"], "illustrated")).toBe("illustrated-low");
    expect(judgingSubdir([], "sketch")).toBe("sketch");
    expect(() => judgingSubdir(["--judging"], "illustrated")).toThrow(/needs a subdirectory/);
    expect(() => judgingSubdir(["--judging", "--mode"], "illustrated")).toThrow(/needs a subdirectory/);
  });

  it("takes the candidate family and exact arms from a lineup key", () => {
    const selected = armSelection({ W: "base-a", X: "medium-b", Y: "base-b", Z: "medium-a" });
    expect(selected.candidatePrefix).toBe("medium-");
    expect([...selected.judgedArms]).toEqual(["base-a", "medium-b", "base-b", "medium-a"]);
  });

  it("refuses a key that mixes candidate families instead of dropping one silently", () => {
    expect(() => armSelection({ W: "base-a", X: "low-a", Y: "base-b", Z: "medium-b" })).toThrow(
      /one candidate family/,
    );
  });
});
