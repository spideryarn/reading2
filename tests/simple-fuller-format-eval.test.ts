/**
 * The deterministic boundary around 261004b's formatting judge. The ship
 * decision reads this tally, so a malformed answer must fail rather than turn
 * into a vote for either side.
 */
import { describe, expect, it } from "vitest";

import { guardCell, parseFormatVerdicts } from "../evals/simple/fuller-format.js";

describe("the Fuller-format judge tally", () => {
  it("refuses duplicate, missing and unexpected pair numbers instead of preserving only the count", () => {
    /* Map.set used to overwrite the first verdict for 1. The two surviving
       keys, 1 and 99, then matched the expected cardinality of [1, 2], and the
       missing verdict for 2 fell through as a vote for the plain side. */
    expect(() => parseFormatVerdicts("1: X\n1: Y\n99: X\n", [1, 2])).toThrow(/pair 1 judged twice/);
    expect(() => parseFormatVerdicts("1: X\n99: Y\n", [1, 2])).toThrow(/unexpected pair 99/);
    expect(() => parseFormatVerdicts("1: X\n", [1, 2])).toThrow(/no verdict for pair 2/);
  });

  it("says when a final pass followed a fidelity flag", () => {
    expect(guardCell("simple", { result: "passed", attempts: 2, stored: 2, retriedAfterFlag: true })).toBe(
      "s:passed/2 after flag",
    );
    expect(guardCell("fuller", { result: "passed", attempts: 2, stored: 2, retriedAfterFlag: false })).toBe(
      "f:passed/2",
    );
  });
});
