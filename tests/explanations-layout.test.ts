/**
 * The width fix is a CSS ownership rule: only the first visible row clears the
 * corner controls, while the scrolling list keeps its ordinary right padding.
 * Component tests cannot see that relationship, so hold the selectors here.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const explanations = readFileSync("src/web/styles/explanations.css", "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);
const glossary = readFileSync("src/web/styles/glossary.css", "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

describe("Explanations' corner clearance and full-width list", () => {
  it("does not reserve the corner's width down the scrolling list", () => {
    expect(explanations).not.toMatch(
      /\.mode-band\.expl\.has-about\s*>\s*\.tl-scroll\s*\{[^}]*--band-about-room/,
    );
  });

  it("keeps every top status clear of the corner controls", () => {
    for (const state of ["gloss-quiet", "gloss-empty", "gloss-stale", "read-error"]) {
      expect(explanations).toMatch(
        new RegExp(`\\.mode-band\\.expl\\.has-about\\s*>\\s*\\.${state}`),
      );
    }
    expect(explanations).toMatch(
      /\.mode-band\.expl\.has-about\s*>\s*\.read-error\s*\{[^}]*padding-right:\s*calc\(0\.9rem \+ var\(--band-about-room\)\)/,
    );
  });

  it("keeps the shared run and order rows clear when either is first", () => {
    for (const row of ["gloss-more", "gloss-sort"]) {
      expect(glossary).toMatch(
        new RegExp(
          `\\.mode-band\\.has-about \\.${row}\\s*\\{[^}]*padding-right:\\s*calc\\(0\\.7rem \\+ var\\(--band-about-room\\)\\)`,
        ),
      );
    }
  });
});
