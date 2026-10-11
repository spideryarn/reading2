/**
 * The Feedback dialog's two asks of 2026-10-11, in the stylesheet (plan 261011h).
 *
 * - **Bigger still on a large window** (`spya-tfp3zw`): a 1280px step, wider,
 *   and taller on a window tall enough, above the 1024px step 261008i made.
 * - **Green to send, red to defer** in a Needs-a-decision thread
 *   (`spya-zjsqe6`): from the measured tokens, and weighty enough to beat
 *   `.fb-copy`, which comes later in the file at one class.
 *
 * The classes reaching the right buttons is `feedback-dialog.test.tsx`'s job.
 */
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

/** Paint declarations on the shared shape or either semantic hook, in any sheet. */
function buttonPaint(css: string): string[] {
  const out: string[] = [];
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = rule[1]!.split(",").map((selector) => selector.trim());
    for (const selector of selectors) {
      if (!/\.fb-(?:copy|reply-thread|reply-send|defer)\b/.test(selector)) continue;
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

describe("a Needs-a-decision thread's Send reply and Defer for now", () => {
  const SEND = ".fb-reply-thread .fb-copy.fb-reply-send";
  const DEFER = ".fb-reply-thread .fb-copy.fb-defer";

  it("draws Send reply in --positive and Defer for now in --danger, hover included", () => {
    for (const sel of [SEND, `${SEND}:hover`]) {
      expectUnconditional(sel, "color", "var(--positive)");
    }
    for (const sel of [DEFER, `${DEFER}:hover`]) {
      expectUnconditional(sel, "color", "var(--danger)");
    }
  });

  it("keeps the coloured border on hover, and puts no wash behind the words", () => {
    for (const sel of [SEND, `${SEND}:hover`, DEFER, `${DEFER}:hover`]) {
      expectUnconditional(sel, "border-color", "currentColor");
      /* A tint behind takes Light under the 4.5:1 the tokens are held to. */
      expect(declared(CSS, sel, "background"), sel).toEqual([]);
    }
  });

  it("outweighs every generic rest, hover and unavailable selector that can match these buttons", () => {
    for (const semantic of [SEND, DEFER]) {
      expect(specificity(semantic)).toBeGreaterThan(specificity(".fb-copy"));
      expect(specificity(semantic)).toBeGreaterThan(specificity(".fb-reply-send:disabled"));
      expect(specificity(semantic)).toBeGreaterThan(specificity('.fb-copy[aria-disabled="true"]'));
      expect(specificity(`${semantic}:hover`)).toBeGreaterThan(specificity(".fb-copy:hover"));
      expect(specificity(`${semantic}:hover`)).toBeGreaterThan(
        specificity('.fb-copy[aria-disabled="true"]:hover'),
      );
    }
  });

  it("accounts for every paint rule that can name the shared or semantic button hooks", () => {
    expect(buttonPaint(CSS)).toEqual([
      `${SEND} | border-color: currentColor`,
      `${SEND}:hover | border-color: currentColor`,
      `${DEFER} | border-color: currentColor`,
      `${DEFER}:hover | border-color: currentColor`,
      `${SEND} | color: var(--positive)`,
      `${SEND}:hover | color: var(--positive)`,
      `${DEFER} | color: var(--danger)`,
      `${DEFER}:hover | color: var(--danger)`,
      ".fb-copy | border: 1px solid var(--rule-strong)",
      ".fb-copy | background: none",
      ".fb-copy | color: var(--ink)",
      ".fb-copy:hover | color: var(--highlight-text)",
      ".fb-copy:hover | border-color: var(--rule-strong)",
      '.fb-copy[aria-disabled="true"]:hover | color: var(--ink)',
    ]);
  });

  it("has one stylesheet owner for all four semantic hooks", () => {
    for (const hook of ["fb-reply-thread", "fb-copy", "fb-reply-send", "fb-defer"]) {
      expect(
        readerSheets()
          .filter(({ css }) => new RegExp(`\\.${hook}\\b`).test(stripComments(css)))
          .map(({ path }) => path),
        hook,
      ).toEqual(["src/web/styles/feedback.css"]);
    }
  });

  it("leaves the shared send box and a bare .fb-defer uncoloured", () => {
    expect(declared(CSS, ".fb-reply-send", "color")).toEqual([]);
    expect(declared(CSS, ".fb-defer", "color")).toEqual([]);
  });
});
