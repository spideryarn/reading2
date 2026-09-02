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
  directionWords,
  DIVERGING_STEPS,
  signedValence,
  valenceDirection,
  valenceLabel,
  valenceRgbToken,
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

  /**
   * **The same check for the other spelling, and it is the one that fails
   * silently in a different place.**
   *
   * `valenceRgbToken` names a `--*-rgb` triple, which the prose mark
   * interpolates as `rgb(var(--h0))` (styles.css § stacked hues). Hand that a
   * property nobody defines — or the plain `--div-rg-0`, whose value is itself
   * an `rgb(…)` expression — and the declaration is invalid at computed-value
   * time, so the stripe paints nothing while every other mark on the page still
   * works. Read out of the stylesheet rather than trusted from the comment
   * beside it, which is the rule tests/hit-colours.test.ts follows for the
   * categorical palette.
   */
  it.each(DIVERGING_SCALES)("defines an -rgb triple for every step of the %s ramp", (scale) => {
    /* The self-guard again, in the shape this block needs: a triple that exists
       and a triple that must not, so a regex that matched nothing could not pass
       by matching everything. */
    expect(defined.has("--div-rg-0-rgb")).toBe(true);
    expect(defined.has(`--div-${DIVERGING_STEPS}-rgb`)).toBe(false);

    const missing: string[] = [];
    for (const valence of AT_STEP) {
      const token = valenceRgbToken(scale, valence);
      const property = /^var\((--[a-z0-9-]+-rgb)\)$/i.exec(token)?.[1]?.toLowerCase();
      expect(property, `${token} is not a bare reference to an -rgb triple`).toBeTruthy();
      if (!defined.has(property as string)) missing.push(`${token} (valence ${valence})`);
    }
    expect(
      missing,
      `styles/colourscales.css defines no such property, so the mark's stripe ` +
        `paints nothing at all and nothing anywhere errors.`,
    ).toEqual([]);
  });

  it("names the same step in both spellings, so a swatch and a mark cannot disagree", () => {
    /* The two functions share `valenceStep` precisely so this holds. A second
       copy of the step arithmetic is how the panel and the prose end up saying
       opposite things about one passage — which is the bug this whole change
       started from, in its other form. */
    for (const scale of DIVERGING_SCALES) {
      for (const valence of AT_STEP) {
        expect(valenceRgbToken(scale, valence)).toBe(
          valenceToken(scale, valence).replace(")", "-rgb)"),
        );
      }
    }
  });
});

/**
 * **The direction in a word**, which is what `data-dir` carries and what the
 * `::after` sign is drawn from.
 *
 * It exists because the prose is painted by valence and has no words in it, so
 * without this the colour would be the only carrier of a good/bad judgement —
 * which docs/project/colour-scales.md forbids.
 */
describe("the direction, which is the sign the mark wears", () => {
  it("has three answers, and zero is one of them", () => {
    expect(valenceDirection(-1)).toBe("against");
    expect(valenceDirection(0)).toBe("neither");
    expect(valenceDirection(1)).toBe("for");
  });

  it("agrees with the words on every step of the ramp", () => {
    /* Two ways of saying one thing, in two places — the panel row says
       "counts against" and the mark says `−`. They are separate functions
       because they have separate readers, and this is what stops them drifting
       into disagreeing about a passage. */
    for (let valence = -100; valence <= 100; valence += 5) {
      const words = valenceWords(valence);
      const dir = valenceDirection(valence);
      expect(
        dir === "against" ? words === "counts against" : dir === "for" ? words === "counts for" : words === "counts neither way",
        `${valence}: "${words}" and "${dir}"`,
      ).toBe(true);
    }
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

/**
 * **The sign in the prose, read out of the stylesheet** — because the sign is
 * generated content and no assertion on the DOM can see it.
 *
 * `annotateHtml` writes `data-dir` and stops. Everything a reader actually
 * meets — which glyph, and what a screen reader is handed instead of it — is in
 * four `::after` rules in src/web/styles.css, where nothing in TypeScript can
 * reach and where swapping two `content` lines is a one-character edit that
 * turns every *counts against* in the paper into a plus sign, with the whole
 * suite green through it. That is the same gap the block above closes between
 * the emitter and `colourscales.css`, closed the same way: read the stylesheet.
 *
 * The alt text is checked against `directionWords` rather than against a
 * literal, so the copy of the four phrases the stylesheet is forced to hold
 * cannot drift from the panel's.
 */
describe("the sign the mark wears, which only the stylesheet knows", () => {
  const STYLES = readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "web", "styles.css"),
    "utf8",
  );

  /**
   * The generated content of one `::after` rule — the glyph, and the
   * alternative text after the slash.
   *
   * The **last** `content` declaration in the block, because each of these
   * rules writes two: a plain one first, as the fallback for a browser that
   * does not parse the alt-text syntax, and the real one after it.
   */
  function generated(selector: string): { glyph: string; alt: string } {
    const at = STYLES.indexOf(`${selector}::after {`);
    expect(at, `styles.css has no ${selector}::after rule at all`).toBeGreaterThan(-1);
    const body = STYLES.slice(at, STYLES.indexOf("}", at));
    const decl = [...body.matchAll(/content:\s*"([^"]*)"\s*\/\s*"([^"]*)"\s*;/g)].at(-1);
    expect(decl, `${selector}::after has no content with alternative text`).toBeTruthy();
    return { glyph: decl?.[1] ?? "", alt: decl?.[2] ?? "" };
  }

  /** The four states a mark can be in, and the glyph each one prints. */
  const SIGNS = [
    ["against", "", "−"],
    ["for", '="for"', "+"],
    ["neither", '="neither"', "·"],
    ["mixed", '="mixed"', "±"],
  ] as const;

  it.each(SIGNS)("draws %s as its own glyph", (_dir, value, glyph) => {
    /* Pinned per direction, because the failure this catches is the two
       `content` lines being swapped: a paper whose *against* passages all wear
       a plus sign is wrong in the most confident possible way, and nothing
       errors. The first is a real minus, U+2212, matching `signedValence`. */
    expect(generated(`mark.hit[data-dir${value}]`).glyph).toBe(glyph);
  });

  it("gives every direction a distinct glyph", () => {
    /* The other half of the same worry. Two directions printing one character
       would leave the mark unable to say anything at all, while every
       per-direction assertion above still passed. */
    const drawn = SIGNS.map(([, value]) => generated(`mark.hit[data-dir${value}]`).glyph);
    expect(new Set(drawn).size).toBe(SIGNS.length);
  });

  it.each(SIGNS)("says %s in words to a screen reader", (dir, value) => {
    /* **The alt text was empty for a day**, on the argument that a stray minus
       announced inside the author's sentence is worse than silence. GPT Sol's
       finding 4 is that this leaves the one carrier that is not a colour
       inaudible to the reader who most needs it, and that the panel is no
       substitute for somebody who arrived at the prose rather than at the
       panel. */
    expect(generated(`mark.hit[data-dir${value}]`).alt).toBe(directionWords(dir));
  });

  it.each(SIGNS)("keeps the reader's own comment marker beside a %s sign", (dir, value, glyph) => {
    /* **GPT Sol's finding 2, and it erased the reader's work rather than
       ours.** A merged mark carries every class that applies, so a passage the
       reader has commented on and a criterion has marked carries both
       `data-mark-end` and `data-dir` — and an element has one `::after`. The
       two rules had equal specificity, so the later one won and the comment's
       own marker silently disappeared from exactly the passages the reader
       cared enough to write on.

       So there is a rule per direction that prints **both**, at a specificity
       that beats both of the rules it replaces. Checked here for existence and
       content; that it actually wins in a browser is
       tests/mark-sign-in-chrome.test.ts, which is the only place the cascade is
       observable at all. */
    const both = generated(`mark.cmt.hit[data-mark-end][data-dir${value}]`);
    expect(both.glyph).toContain(glyph);
    expect(both.glyph, "the comment's own marker").toContain("✳");
    expect(both.alt).toBe(directionWords(dir));
  });
});
