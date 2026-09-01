/**
 * Saying which way a passage cuts — src/web/valence.ts.
 *
 * Small, and it is here because of what it is a test *of*: the red↔green ramp
 * this mode ships with is permitted by docs/project/colour-scales.md only on
 * one stated condition — that the reader knows which end is which from
 * something other than the colour. The words, the sign and the rank are that
 * something.
 *
 * **This file used to say those were "not tests of a formatter, they are the
 * condition", and that was a claim it could not keep.** Every assertion here
 * calls `valenceStep`/`valenceWords`/`valenceLabel` directly, so what they
 * establish is that four small functions return what they return. The condition
 * is a property of what reaches a reader, and that lives in
 * `tests/referee-criteria-panel.test.tsx`, which renders the real panel — the
 * demonstration is that swapping the two poles in `CriterionResult` left this
 * file, and the rest of the suite, entirely green.
 *
 * What is genuinely a condition, and is here, is the block at the bottom: the
 * token this file's emitter names has to be a custom property the stylesheet
 * defines, or the swatch is drawn with nothing at all and no check anywhere
 * says so.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { RefereePoles } from "../src/referee-criteria.js";
import { DIVERGING_SCALES } from "../src/referee-criteria.js";
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

/**
 * **The join, and nothing else had it.**
 *
 * `valenceToken` emits a custom-property name; `styles/colourscales.css`
 * defines the properties. Nothing connected the two. If the emitter names
 * `--div-rg-4` and the stylesheet has stopped defining it — a renamed ramp, a
 * step dropped, a prefix changed — the swatch is an element with **no
 * background** and nothing errors anywhere: no console message, no failing
 * rule, no red test. tests/colour-scales.test.ts reads the stylesheet and never
 * the emitter; tests/valence.test.ts above read the emitter and never the
 * stylesheet. Each was individually right and the gap between them was the
 * whole failure. docs/reusable/silent-success.md § "the check you ran and the
 * code you are checking would fail together".
 *
 * Derived at both ends: the scales come from `DIVERGING_SCALES`, the steps from
 * `DIVERGING_STEPS`, and the defined properties are parsed out of the
 * stylesheet. Nothing here is a hand-kept list, so a ramp renamed on either
 * side is caught rather than needing a second edit.
 */
describe("every token the emitter names is a property the stylesheet defines", () => {
  const CSS = readFileSync(
    path.resolve(import.meta.dirname, "..", "styles", "colourscales.css"),
    "utf8",
  );

  /** Every `--name` the stylesheet declares a value for. */
  const defined = new Set(
    [...CSS.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => (m[1] as string).toLowerCase()),
  );

  /**
   * The valence that lands on each step. `valenceStep` maps −100…+100 onto
   * 0…8, so the steps are 25 apart — and this is asserted rather than assumed,
   * because a scan that walks the wrong steps still passes.
   */
  const AT_STEP = Array.from({ length: DIVERGING_STEPS }, (_, i) => -100 + i * (200 / (DIVERGING_STEPS - 1)));

  it("found a stylesheet with properties in it, so a miss means a miss", () => {
    /* The self-guard. A regex that stopped matching would define nothing, and
       a scan over an empty set answers "not defined" for everything — which
       looks like a real failure, where a scan over a set containing everything
       looks like a pass. Both directions are pinned: something real is in
       there, and something that must not be is not. */
    expect(defined.size).toBeGreaterThan(20);
    expect(defined.has("--div-rg-0")).toBe(true);
    expect(defined.has("--div-0")).toBe(true);
    // One past the end of a nine-step ramp. If this were defined, the check
    // below could not tell a real property from any name at all.
    expect(defined.has(`--div-${DIVERGING_STEPS}`)).toBe(false);
  });

  it("walks the whole ramp, one valence per step", () => {
    expect(AT_STEP.map(valenceStep)).toEqual([...AT_STEP.keys()]);
  });

  it.each(DIVERGING_SCALES)("defines every step of the %s ramp", (scale) => {
    const missing: string[] = [];
    for (const valence of AT_STEP) {
      const token = valenceToken(scale, valence);
      const property = /^var\((--[a-z0-9-]+)\)$/i.exec(token)?.[1]?.toLowerCase();
      expect(property, `${token} is not a bare custom-property reference`).toBeTruthy();
      if (!defined.has(property as string)) missing.push(`${token} (valence ${valence})`);
    }
    expect(
      missing,
      `styles/colourscales.css defines no such property, so the swatch is drawn ` +
        `with no background at all and nothing anywhere errors.`,
    ).toEqual([]);
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
