/**
 * **A finding's chat origin and the id the step mints are one shape** — plan
 * docs/plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md,
 * decision 9; queue item qi-mmtsxdhg.
 *
 * The route refuses a `situate` origin whose id is not `SITUATE_FINDING_ID`
 * (src/routes.ts § `parseSituateOrigin`), and the ids are minted by
 * src/situate.ts § `findingId`. Two files, one pattern: if the step ever mints
 * another shape, every finding's *Ask in chat* would get a 400, and this is
 * the test that says so first.
 */
import { describe, expect, it } from "vitest";

import { titleFromOrigin } from "../src/chat-title.js";
import { findingId } from "../src/situate.js";
import { SITUATE_FINDING_ID, SITUATE_FINDING_KINDS, sameOrigin, type ThreadOrigin } from "../src/types.js";

describe("a finding's id", () => {
  it("is what the origin's pattern admits, for every kind", () => {
    for (const kind of SITUATE_FINDING_KINDS) {
      const id = findingId(kind, "spya-k3m9qt", "https://example.org/a-paper");
      expect(id, kind).toMatch(SITUATE_FINDING_ID);
    }
  });

  it("is not a block-shaped id, and the pattern admits nothing looser", () => {
    expect("spya-k3m9qt").not.toMatch(SITUATE_FINDING_ID);
    expect("si-0123456789AB").not.toMatch(SITUATE_FINDING_ID);
    expect("si-0123456789abc").not.toMatch(SITUATE_FINDING_ID);
    expect(" si-0123456789ab").not.toMatch(SITUATE_FINDING_ID);
  });
});

describe("a finding's origin", () => {
  const FINDING: ThreadOrigin = { mode: "situate", itemId: "si-0123456789ab", quote: "Ignition is a step-function" };

  it("is found by its id, not its words, so a reworded search keeps the chat (qi-mmtsxdhg)", () => {
    expect(sameOrigin(FINDING, { ...FINDING, quote: "reworded" })).toBe(true);
    expect(sameOrigin(FINDING, { ...FINDING, itemId: "si-ba9876543210" })).toBe(false);
    /* The lens a finding's chat stored before plan 261025h is another origin. */
    expect(sameOrigin(FINDING, { mode: "reception", lens: "Ignition is a step-function" })).toBe(false);
  });

  it("names its chat after the passage", () => {
    expect(titleFromOrigin(FINDING)).toBe("Finding: Ignition is a step-function");
  });
});
