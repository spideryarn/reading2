/**
 * The free half of the Explore eval's saved-label compatibility. Old judge
 * files predate `critique`; rescoring them must name that field unlabelled,
 * not silently turn a missing key into zero critiques.
 */
import { describe, expect, it } from "vitest";

import { normaliseSavedAnswer } from "../evals/learn-explore.js";

const oldRaw = JSON.stringify({
  own_material: "notes",
  move: "idea",
  applied_profile_case: "no",
  took_up_their_case: "na",
  invented: "no",
  invented_what: "",
  outside: "none",
  opens_with_verdict: "no",
  remarks_on_absence: "no",
  hard: "",
});

describe("the Explore eval's saved judge answers", () => {
  it("marks a pre-critique answer unlabelled when it is rescored", () => {
    const oldLabels = JSON.parse(oldRaw) as ReturnType<typeof normaliseSavedAnswer>["labels"];
    expect(normaliseSavedAnswer({ raw: oldRaw, labels: oldLabels })?.labels?.critique).toBe("unlabelled");
  });
});
