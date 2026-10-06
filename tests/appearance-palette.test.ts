/**
 * **The light palette exists for every token that needs one, and its core
 * pairs are legible** — styles/tokens.css and src/web/styles/tokens.css, each
 * with a dark `:root` block and a `:root[data-theme="light"]` block.
 *
 * Two kinds of check, and they answer different questions (GPT Sol, plan
 * review of 261003e):
 *
 * - **Parity is a tripwire for a forgotten name, no more.** Every token in a
 *   dark block whose value is written as a literal colour — not an alias of
 *   another token — must be redefined in the light block or be on the
 *   theme-neutral list below with a reason. It cannot tell a good light value
 *   from a copied dark one.
 * - **Contrast is the check on the values.** The few pairs that decide whether
 *   the page can be read at all, measured in both themes.
 *
 * The scales in styles/colourscales.css have their own invariants per theme in
 * tests/colour-scales.test.ts; component stylesheets are swept for fixed
 * white and black in tests/appearance-fixed-colours.test.ts.
 */
import { describe, expect, it } from "vitest";

import { contrast, DARK_BLOCK as dark, LIGHT_BLOCK as light, PALETTE } from "./helpers/theme-palette.js";

/** A value that names a colour itself rather than pointing at another token. */
const LITERAL = /oklch\(|#[0-9a-f]{3,8}\b|^\d+ \d+ \d+$|\b(white|black)\b/i;

/** The same in both themes, on purpose. */
const NEUTRAL: Record<string, string> = {
  "--spideryarn-orange": "the brand; unchanged as a fill on either ground",
  "--primary": "the brand orange in OKLCH",
  "--figure-sheet": "article figures are printed on a light sheet in both themes",
};

describe("every literal colour token has a light value", () => {
  const needs = [...dark].filter(([k, v]) => LITERAL.test(v) && !(k in NEUTRAL)).map(([k]) => k);

  it("finds the tokens it is meant to be checking", () => {
    /* A parser that found nothing would pass the next test vacuously. */
    expect(needs).toEqual(expect.arrayContaining(["--background", "--foreground", "--ink-soft"]));
    expect(needs.length).toBeGreaterThan(20);
  });

  it.each(needs)("%s", (name) => {
    expect(light.has(name), `${name} has no light value, and is not on NEUTRAL`).toBe(true);
  });

  it("tells the browser which furniture to draw", () => {
    expect(dark.get("color-scheme")).toBe("dark");
    expect(light.get("color-scheme")).toBe("light");
  });
});

/* ------------------------------------------------------------- contrast -- */

/** [foreground, background, the WCAG floor it must clear] */
const PAIRS: [string, string, number][] = [
  ["--foreground", "--background", 7],
  ["--ink-soft", "--background", 4.5],
  ["--muted-foreground", "--background", 4.5],
  ["--foreground", "--sidebar", 7],
  ["--muted-foreground", "--sidebar", 4.5],
  ["--highlight-ink", "--background", 4.5],
  ["--highlight-foreground", "--highlight", 4.5],
  ["--popover-foreground", "--popover", 7],
  /* A focus indicator is non-text: 3:1 (WCAG 1.4.11). */
  ["--ring", "--background", 3],
  ["--highlight-text", "--background", 3],
  /* Error text, on each of the three surfaces a status row sits on: the page,
     the band, and the raised chat dialog. `--destructive` is a fill and is not
     held to this; on Dark's raised surface it reads 4.37:1. */
  ["--danger", "--page", 4.5],
  ["--danger", "--panel", 4.5],
  ["--danger", "--surface-raised", 4.5],
];

describe.each([
  ["dark", PALETTE.dark],
  ["light", PALETTE.light],
] as const)("the %s theme's core pairs", (_theme, palette) => {
  it.each(PAIRS)("%s on %s clears %s:1", (fg, bg, floor) => {
    expect(contrast(fg, bg, palette)).toBeGreaterThanOrEqual(floor);
  });
});

it("keeps Dark's former filled-control ink while making Light's destructive button legible", () => {
  expect(dark.get("--highlight-foreground")).toBe("var(--page)");
  expect(dark.get("--destructive-button-foreground")).toBe("oklch(1 0 0)");

  expect(contrast("--destructive-button-foreground", "--destructive", PALETTE.light)).toBeGreaterThanOrEqual(
    4.5,
  );
});
