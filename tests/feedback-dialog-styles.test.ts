/**
 * The Feedback dialog's asks, in the stylesheet.
 *
 * - **Bigger still on a large window** (`spya-tfp3zw`, plan 261011h): a 1280px
 *   step, wider, and taller on a window tall enough, above the 1024px step
 *   261008i made.
 * - **Green to send, red to back out** (`spya-zjsqe6`, plan 261011h, then
 *   `spya-as0et6`, plan 261020f): one shared pair, `.tone-positive` and
 *   `.tone-negative` in button-tone.css, weighty enough to beat every family
 *   rule that can paint a Feedback button.
 *
 * The classes reaching the right buttons is `feedback-dialog.test.tsx`'s job.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  enclosing,
  mediaBlock,
  readerCssNoComments,
  readerSheets,
  stripComments,
} from "./helpers/stylesheets.js";

/* The whole reader cascade, not the file that owns these rules: a later sheet
   touching the same hooks is part of the answer too. */
const CSS = readerCssNoComments();

interface FoundDeclaration {
  at: number;
  value: string;
}

/** Every declaration of `prop` in a rule whose selector list includes `selector`. */
function declarations(css: string, selector: string, prop: string): FoundDeclaration[] {
  const out: FoundDeclaration[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.split(",").map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const d of m[2]!.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "g"))) {
      out.push({ at: m.index, value: d[1]!.trim() });
    }
  }
  return out;
}

function declared(css: string, selector: string, prop: string): string[] {
  return declarations(css, selector, prop).map(({ value }) => value);
}

/** A colour rule for every viewport, rather than the same text hidden in an at-rule. */
function expectUnconditional(selector: string, prop: string, value: string): void {
  const found = declarations(CSS, selector, prop);
  expect(
    found.map((declaration) => declaration.value),
    selector,
  ).toEqual([value]);
  for (const declaration of found) {
    expect(enclosing(CSS, declaration.at), `${selector} is conditional`).toEqual([]);
  }
}

/** Specificity for the simple class/attribute/pseudo-class selectors below. */
function specificity(selector: string): number {
  return (selector.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
}

/** The Feedback dialog's button hooks, and the two shared tones. */
const BUTTON_HOOK = /\.(?:fb-(?:copy|reply-thread|reply-send|defer|send|cancel)|tone-(?:positive|negative))\b/;

/** Paint declarations on any of them, in any sheet: `selector | property: value`. */
function buttonPaint(css: string): string[] {
  const out: string[] = [];
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = rule[1]!.split(",").map((selector) => selector.trim());
    for (const selector of selectors) {
      if (!BUTTON_HOOK.test(selector)) continue;
      for (const declaration of rule[2]!.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)/g)) {
        const property = declaration[1]!;
        if (!/^(?:color|border(?:-color)?|background(?:-color)?)$/.test(property)) continue;
        out.push(`${selector} | ${property}: ${declaration[2]!.trim()}`);
      }
    }
  }
  return out;
}

describe("the Feedback dialog on a large window", () => {
  it("is 56rem wide from 1280px", () => {
    expect(declared(mediaBlock(CSS, "(min-width: 1280px)", "width: min(90vw, 56rem)"), ".fb-panel", "width")).toEqual([
      "min(90vw, 56rem)",
    ]);
  });

  it("is at least 56rem tall from 1280×900, still capped by the 90% everywhere", () => {
    const tall = mediaBlock(CSS, "(min-width: 1280px) and (min-height: 900px)", ".fb-panel");
    expect(declared(tall, ".fb-panel", "min-height")).toEqual(["min(90%, 56rem)"]);
    expect(declared(CSS, ".fb-panel", "max-height")).toEqual(["90%"]);
  });
});

/* spya-as0et6 (Greg, 2026-10-19): "color the buttons red and green, and for
   close as well, just so it's easier to see what's … effectively a cancel and
   what's a submit". */
describe("green to send, red to back out: button-tone.css", () => {
  const TONES = [
    [".tone-positive", "var(--positive)"],
    [".tone-negative", "var(--danger)"],
  ] as const;
  /** Every state a rival rule paints, as the tone selector that answers it. */
  const STATES = ["", ":hover", '[aria-disabled="true"]:hover'] as const;

  it("draws the text and the border in the tone, in every state, with no wash behind", () => {
    for (const [tone, colour] of TONES) {
      for (const state of STATES) {
        expectUnconditional(`${tone}${state}`, "color", colour);
        expectUnconditional(`${tone}${state}`, "border-color", "currentColor");
        /* A tint behind takes Light under the 4.5:1 the tokens are held to. */
        expect(declared(CSS, `${tone}${state}`, "background"), tone).toEqual([]);
      }
    }
  });

  it("dims a toned button that cannot be pressed, and not one that is working", () => {
    for (const [tone] of TONES) {
      expect(declared(CSS, `${tone}:disabled`, "opacity")).toEqual(["0.45"]);
      expect(declared(CSS, `${tone}[data-working]:disabled`, "opacity")).toEqual(["1"]);
    }
  });

  it("is the last sheet styles.css imports, so a family rule of equal weight loses", () => {
    const imports = [...readFileSync("src/web/styles.css", "utf8").matchAll(/^@import\s+"([^"]+)"/gm)].map(
      (m) => m[1],
    );
    expect(imports.at(-1)).toBe("./styles/button-tone.css");
  });

  it("matches or outweighs every other paint rule on a Feedback button, state for state", () => {
    const rivals = buttonPaint(CSS)
      .map((line) => line.split(" | ")[0]!)
      .filter((selector) => !/\.tone-/.test(selector));
    expect(rivals.length).toBeGreaterThan(0);
    for (const rival of rivals) {
      const state = !rival.includes(":hover")
        ? STATES[0]
        : rival.includes("[aria-disabled")
          ? STATES[2]
          : STATES[1];
      for (const [tone] of TONES) {
        expect(specificity(`${tone}${state}`), `${tone}${state} vs ${rival}`).toBeGreaterThanOrEqual(
          specificity(rival),
        );
      }
    }
  });

  it("accounts for every paint rule that can name a Feedback button hook or a tone", () => {
    expect(buttonPaint(CSS)).toEqual([
      ".fb-copy | border: 1px solid var(--rule-strong)",
      ".fb-copy | background: none",
      ".fb-copy | color: var(--ink)",
      ".fb-copy:hover | color: var(--highlight-text)",
      ".fb-copy:hover | border-color: var(--rule-strong)",
      '.fb-copy[aria-disabled="true"]:hover | color: var(--ink)',
      ".fb-cancel | border: 1px solid var(--rule-strong)",
      ".fb-cancel | background: none",
      ".fb-send | border: 1px solid var(--rule-strong)",
      ".fb-send | background: none",
      ".tone-positive | color: var(--positive)",
      ".tone-positive | border-color: currentColor",
      ".tone-positive:hover | color: var(--positive)",
      ".tone-positive:hover | border-color: currentColor",
      '.tone-positive[aria-disabled="true"]:hover | color: var(--positive)',
      '.tone-positive[aria-disabled="true"]:hover | border-color: currentColor',
      ".tone-negative | color: var(--danger)",
      ".tone-negative | border-color: currentColor",
      ".tone-negative:hover | color: var(--danger)",
      ".tone-negative:hover | border-color: currentColor",
      '.tone-negative[aria-disabled="true"]:hover | color: var(--danger)',
      '.tone-negative[aria-disabled="true"]:hover | border-color: currentColor',
    ]);
  });

  it("has one stylesheet owner for each hook, and none paints the thread's", () => {
    for (const [hook, owner] of [
      ["fb-copy", "src/web/styles/feedback.css"],
      ["fb-send", "src/web/styles/feedback.css"],
      ["fb-cancel", "src/web/styles/feedback.css"],
      ["fb-reply-send", null],
      ["fb-defer", null],
      ["tone-positive", "src/web/styles/button-tone.css"],
      ["tone-negative", "src/web/styles/button-tone.css"],
    ] as const) {
      expect(
        readerSheets()
          .filter(({ css }) => new RegExp(`\\.${hook}\\b`).test(stripComments(css)))
          .map(({ path }) => path),
        hook,
      ).toEqual(owner === null ? [] : [owner]);
    }
  });
});

describe("Earlier's footer pager", () => {
  it("keeps the pager's 40px touch targets apart when its flex row wraps", () => {
    const coarse = mediaBlock(CSS, "(any-pointer: coarse)", ".fb-thread-nav");
    expect(declared(coarse, ".fb-thread-nav", "row-gap")).toEqual(["max(0.4rem, 18px)"]);
  });
});
