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
import { DIAGRAMS, LABEL_PX, LINK_KINDS, UNLABELLED } from "../src/web/diagram.js";

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
      if (UNLABELLED.has(kind)) {
        /* **Checked in the other direction, rather than skipped.** A kind that
           writes nothing on a node has no font size to agree about — but "no
           rule" is also what a forgotten rule looks like, so the exemption is
           only honest if it *fails* when one of these grows a label. If that
           ever happens, `LABEL_PX` has to become real for it and this set has
           to lose a member. */
        it(`${kind} depth ${depth} writes no label, and declares no size`, () => {
          expect(fontSizeOf(selector), `\`${selector}\` exists, so ${kind} is not unlabelled`).toBeNull();
        });
        continue;
      }
      it(`${kind} depth ${depth}`, () => {
        expect(fontSizeOf(selector), `no rule for \`${selector}\``).not.toBeNull();
        expect(fontSizeOf(selector)).toBe(LABEL_PX[kind]?.[depth]);
      });
    }
  }

  it("no bare `.diag-label` font-size, which would beat nothing and be beaten by everything", () => {
    /* A base size plus per-depth overrides is how the cut Tree's titles ended up
       at 10px: `.diag-node.diag-d1 .diag-label` was written for `strata` and
       also matched the tree, and a base rule cannot say which. The rules above
       are all at one specificity, so there is nothing left for a base to do —
       and a base that came back would make this suite pass while the browser
       used a different number. It is more tempting now that Force is the only
       picture writing a label, which is why this stayed. */
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

/**
 * **The five kinds of Force link, and the arrowhead.**
 *
 * Same class of failure as the font sizes above and the same reason a test has
 * to read the CSS: the layout decides *what a line claims* and the stylesheet
 * decides *what a claim looks like*, and when they disagree nothing happens.
 * A kind with no rule is drawn in the base grey, indistinguishable from
 * containment — five claims rendered as one texture, which is the whole thing
 * this feature is trying not to be.
 *
 * GPT Sol's finding, 2026-08-27: the layout tests assert `l.kind`, and would
 * pass with every one of these rules deleted.
 */
const MARKER = readFileSync("src/web/DiagramPanel.tsx", "utf8");

describe("the Force picture's five kinds of line", () => {
  it("gives every kind a rule of its own", () => {
    /* A missing rule is a failure here rather than a silent pass — the same
       rule the font-size block above works by. */
    /* A word boundary after the kind, not a substring match: `.diag-link-anchor`
       is a prefix of `.diag-link-anchorXX`, so `includes` was satisfied by a
       renamed rule. Watched pass with the anchor rule renamed away. */
    const missing = LINK_KINDS.filter(
      (k) => !new RegExp(`\\.diag-force \\.diag-link-${k}[\\s,{]`).test(CSS),
    );
    expect(missing).toEqual([]);
  });

  it("makes the semantic line dotted and nothing else", () => {
    // The dash is not decoration: it is the drawing convention for "inferred",
    // and it is what tells a reader which line cost money and can be wrong.
    const dashed = LINK_KINDS.filter((k) => {
      const rule = new RegExp(`\\.diag-force \\.diag-link-${k}\\s*\\{[^}]*\\}`, "s").exec(CSS);
      return rule ? rule[0].includes("stroke-dasharray") : false;
    });
    expect(dashed).toEqual(["semantic"]);
  });

  it("draws the sequence chain thicker than every other kind", () => {
    const width = (k: string) => {
      const rule = new RegExp(`\\.diag-force \\.diag-link-${k}\\s*\\{[^}]*\\}`, "s").exec(CSS);
      return Number(/stroke-width:\s*([\d.]+)/.exec(rule?.[0] ?? "")?.[1] ?? 0);
    };
    for (const k of LINK_KINDS) {
      if (k === "sequence") continue;
      expect(width("sequence"), `sequence vs ${k}`).toBeGreaterThan(width(k));
    }
  });

  it("paints the arrowhead from the same token as the line it sits on", () => {
    /* One token, shared, because a head that is a different colour from its
       line reads as a stray mark. The alternative — SVG's `context-stroke` —
       falls back to **black** where it is not understood, and a black arrowhead
       on a near-black page is an arrow that is not there. */
    const head = /\.diag-force \.diag-arrowhead\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    const line = /\.diag-force \.diag-link-sequence\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    const token = /var\((--[\w-]+)\)/.exec(head)?.[1];
    expect(token, "the arrowhead should use a custom property").toBeTruthy();
    expect(line).toContain(`var(${token})`);
  });

  it("puts the marker's tip at the end of the path, in fixed units", () => {
    /* `arrowPath` trims the line to `r + HEAD_GAP` **because** the tip lands
       exactly on the last point. That is only true when `refX` equals the
       viewBox width and the units do not scale with the stroke — change either
       in the JSX and the arithmetic in diagram-d3.ts quietly stops meaning what
       its comment says. Two files, one geometry, nothing to see when they
       disagree. */
    const marker = /<marker[\s\S]*?>/.exec(MARKER)?.[0] ?? "";
    const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(marker);
    const refX = /refX="(\d+)"/.exec(marker)?.[1];
    expect(refX).toBe(viewBox?.[1]);
    expect(marker).toContain('markerUnits="userSpaceOnUse"');
    expect(marker).toContain('orient="auto"');
  });
});
