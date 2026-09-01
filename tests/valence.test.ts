/**
 * Saying which way a passage cuts — src/web/valence.ts.
 *
 * Small, and it is here because of what it is a test *of*: the red↔green ramp
 * this mode ships with is permitted by docs/project/colour-scales.md only on
 * one stated condition — that the reader knows which end is which from
 * something other than the colour. The words, the sign and the rank are that
 * something. So these are not tests of a formatter, they are the condition
 * under which `DEFAULT_DIVERGING_SCALE` is allowed to be `rg` at all.
 */
import { describe, expect, it } from "vitest";

import type { RefereePoles } from "../src/referee-criteria.js";
import {
  DIVERGING_STEPS,
  signedValence,
  valenceLabel,
  valenceStep,
  valenceToken,
  valenceWords,
} from "../src/web/valence.js";

const POLES: RefereePoles = { against: "a control is missing", favour: "the controls settle it" };

describe("the pivot", () => {
  /**
   * **Anchored at zero, never at the data.** Scaling to the range the results
   * happen to cover would paint the least-bad of three bad passages at the
   * favourable end, in green, and nothing would error.
   */
  it("puts zero on the middle step, whatever else is in the list", () => {
    expect(valenceStep(0)).toBe((DIVERGING_STEPS - 1) / 2);
  });

  it("puts the ends on the ends", () => {
    expect(valenceStep(-100)).toBe(0);
    expect(valenceStep(100)).toBe(DIVERGING_STEPS - 1);
  });

  it("clamps rather than emitting a property nothing defines", () => {
    // A step of -1 would emit `var(--div-rg--1)`, which is not an error
    // anywhere: it is an element with no background.
    expect(valenceStep(-500)).toBe(0);
    expect(valenceStep(500)).toBe(DIVERGING_STEPS - 1);
    expect(valenceStep(Number.NaN)).toBe((DIVERGING_STEPS - 1) / 2);
  });

  it("names a token on the ramp the criterion chose, and never a colour", () => {
    expect(valenceToken("rg", -100)).toBe("var(--div-rg-0)");
    expect(valenceToken("br", 100)).toBe("var(--div-8)");
    expect(valenceToken("rg", 0)).toBe("var(--div-rg-4)");
  });
});

describe("the words, which are the carrier the colour decorates", () => {
  it("has three answers, because zero is a real one", () => {
    expect(valenceWords(-40)).toBe("counts against");
    expect(valenceWords(40)).toBe("counts for");
    expect(valenceWords(0)).toBe("counts neither way");
  });

  it("prints the sign, because the sign is the direction", () => {
    expect(signedValence(70)).toBe("+70");
    expect(signedValence(-40)).toBe("−40");
    expect(signedValence(0)).toBe("0");
  });

  /* The accessible name has to carry everything the visible row does, in the
     same order: rank first, then the direction, then the referee's own end in
     their own words, then the number. */
  it("puts all four facts into the accessible name, rank first", () => {
    const label = valenceLabel(2, -80, POLES);
    expect(label.startsWith("2.")).toBe(true);
    expect(label).toContain("counts against");
    expect(label).toContain("a control is missing");
    expect(label).toContain("−80");
    expect(label).not.toContain("the controls settle it");
  });

  it("names neither end at zero rather than picking one", () => {
    const label = valenceLabel(1, 0, POLES);
    expect(label).toContain("counts neither way");
    expect(label).not.toContain("a control is missing");
    expect(label).not.toContain("the controls settle it");
  });
});
