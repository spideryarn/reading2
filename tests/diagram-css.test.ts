/**
 * **The stylesheet and the layout arithmetic agree about font sizes.**
 *
 * The Diagram mode cuts every label to fit by counting characters at a font
 * size (`wrapText` / `LABEL_PX` in src/web/diagram.ts), and the stylesheet then
 * paints it at whatever `§ diagram mode` says. Two numbers, two files, and
 * **nothing at all happens when they disagree**: budget too small and the band
 * is emptier than it needed to be, budget too large and the text runs out over
 * the article — and SVG neither wraps nor clips, so there is no overflow to see
 * and nothing in the console.
 *
 * Both directions were live in this feature before this test existed. Tree
 * titles were budgeted at 12px and painted at 10, because a `.diag-node.diag-d1`
 * override written for `strata` also matched the tree; mindmap twigs were
 * budgeted at 10.5 and painted at 11, which is the direction that overflows.
 *
 * This is the only way a test can reach a CSS file — parse it. Crude, and it
 * only checks the rules it can find, so **a missing rule is a failure here**
 * rather than a silent pass: `LABEL_PX` names every pair, and every pair must
 * appear.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DIAGRAMS, GIST_PX, LABEL_PX } from "../src/web/diagram.js";

const CSS = readFileSync("src/web/styles.css", "utf8");

/** The `font-size` a selector declares, in px, or null if it declares none. */
function fontSizeOf(selector: string): number | null {
  // One rule per line is the house style for these; a multi-line rule is caught
  // by the [\s\S] and the first font-size inside its braces.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = CSS.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  if (!m) return null;
  const f = m[1]?.match(/font-size:\s*([\d.]+)px/);
  return f?.[1] ? Number(f[1]) : null;
}

describe("the diagram's font sizes are declared in both files and match", () => {
  for (const kind of DIAGRAMS) {
    for (const depth of [0, 1, 2]) {
      const selector = `.diag-${kind} .diag-node.diag-d${depth} .diag-label`;
      it(`${kind} depth ${depth}`, () => {
        expect(fontSizeOf(selector), `no rule for \`${selector}\``).not.toBeNull();
        expect(fontSizeOf(selector)).toBe(LABEL_PX[kind]?.[depth]);
      });
    }
  }

  it("the gist", () => {
    expect(fontSizeOf(".diag-gist")).toBe(GIST_PX);
  });

  it("no bare `.diag-label` font-size, which would beat nothing and be beaten by everything", () => {
    /* A base size plus per-depth overrides is how the tree's titles ended up at
       10px: `.diag-node.diag-d1 .diag-label` was written for `strata` and also
       matched the tree, and a base rule cannot say which. The nine rules above
       are all at one specificity, so there is nothing left for a base to do —
       and a base that came back would make this suite pass while the browser
       used a different number. */
    expect(fontSizeOf(".diag-label")).toBeNull();
  });
});

describe("the diagram's colours go through the palette rather than naming one", () => {
  /* Comments stripped first — this block explains at length why an `oklch()`
     fallback is wrong, and a check that reads its own explanation as a
     violation is a check nobody keeps. */
  const BLOCK = CSS.slice(CSS.indexOf("§ diagram mode")).replace(/\/\*[\s\S]*?\*\//g, "");

  it("uses the shared --cat-* slots and never a literal colour", () => {
    /* The eight hues live in styles/colourscales.css, where the reasoning about
       a near-black ground is (docs/project/colour-scales.md). A hex or an oklch
       here would be a ninth palette nobody had that argument about. */
    expect(BLOCK).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(BLOCK).not.toMatch(/\boklch\(/);
    expect(BLOCK).toMatch(/var\(--cat-rgb/);
  });

  it("falls back to a triplet, never to a colour", () => {
    /* `rgb(var(--cat-rgb, var(--ink-faint)) / 0.8)` parses and then throws the
       whole declaration away at computed-value time, because `--ink-faint` is an
       `oklch()` colour and not three numbers. The border simply inherits, and
       there is nothing in devtools that says why. */
    for (const [, fallback] of BLOCK.matchAll(/var\(--cat-rgb,\s*var\((--[\w-]+)\)\s*\)/g)) {
      expect(fallback, `\`${fallback}\` is not an rgb triplet`).toMatch(/-rgb$/);
    }
  });
});
