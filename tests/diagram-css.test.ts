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
import {
  CHAIN_NEAR_LEVELS,
  DIAGRAMS,
  LABEL_PX,
  LINK_KINDS,
  UNLABELLED,
} from "../src/web/diagram.js";

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
     violation is a check nobody keeps.

     **Bounded at the next section, which it was not until 2026-09-03.** The
     slice ran from `§ diagram mode` to the end of the file, so this test — whose
     whole subject is *the diagram's* colours — was reading every rule below it
     as well. The signed-out marketing redesign landed two brand hexes and some
     `#000` mask stencils further down and turned it red, on `dev`, for everyone.
     A `#000` inside `-webkit-mask: linear-gradient(#000 0 0)` is a stencil
     rather than a colour at all, which is the clearest sign the reach was
     accidental.

     **Whether the marketing CSS should name a hex is a separate question and
     this test is not the one asking it.** Narrowing here hides nothing it was
     built to catch; it restores it. If the palette rule ought to cover the whole
     stylesheet, that wants its own check and its own argument —
     docs/project/design-css-overview.md. */
  const FROM = CSS.indexOf("§ diagram mode");
  const NEXT = CSS.slice(FROM).search(/\n\/\* -{8,}[^\n]*§/);
  const BLOCK = (NEXT < 0 ? CSS.slice(FROM) : CSS.slice(FROM, FROM + NEXT)).replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

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

  it("draws the reader's own stretch of the chain more strongly than the rest", () => {
    /* Greg, 2026-08-30: *"making the connections directly either side of the
       current node most prominent. Then a bit fainter for the ones at one
       remove, then a bit fainter for the ones at two removes, etc etc."*

       `chainNearness` (src/web/diagram.ts) emits `diag-near-0` … `diag-near-7`
       and nothing else, so a level with no rule is a segment silently drawn at
       the base weight — the exact failure this whole block exists for: the
       picture still draws, and the ramp just has a hole in it. */
    for (const picture of ["force", "trail"]) {
      const missing = Array.from({ length: CHAIN_NEAR_LEVELS }, (_, i) => i).filter(
        (i) => !new RegExp(`\\.diag-${picture} [^{]*\\.diag-near-${i}[\\s,{]`).test(CSS),
      );
      expect(missing, `${picture} is missing a step`).toEqual([]);
    }
  });

  it("lands the ramp's far end on the weight the chain has anyway", () => {
    /* **The ramp only ever brightens** — see `chainNearness`. Its last step has
       to equal the unclassed chain, or every article gets a visible edge at the
       point the ramp stops, which is worse than no ramp: it reads as a boundary
       in the article rather than as the end of a highlight.

       Force only. Trail's chain has a global fade underneath it, so its far
       step is a blend rather than a match, and asserting equality there would
       be asserting a number nobody chose. */
    const base = /\.diag-force \.diag-link-sequence\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    const last =
      new RegExp(
        `\\.diag-force \\.diag-link-sequence\\.diag-near-${CHAIN_NEAR_LEVELS - 1}\\s*\\{([^}]*)\\}`,
      ).exec(CSS)?.[1] ?? "";
    const of = (rule: string, prop: string) =>
      Number(new RegExp(`${prop}:\\s*([\\d.]+)`).exec(rule)?.[1] ?? Number.NaN);
    expect(of(base, "opacity")).toBeGreaterThan(0);
    expect(of(last, "opacity")).toBe(of(base, "opacity"));
    expect(of(last, "stroke-width")).toBe(of(base, "stroke-width"));

    // And step 0 really is the loud end, or the ramp is pointing the wrong way.
    const first =
      /\.diag-force \.diag-link-sequence\.diag-near-0\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    expect(of(first, "opacity")).toBeGreaterThan(of(last, "opacity"));
    expect(of(first, "stroke-width")).toBeGreaterThan(of(last, "stroke-width"));
  });

  it("lands Trail's ramp on the global fade the segment would have had anyway", () => {
    /* **The cliff GPT Sol found on 2026-08-30, and the test that would have.**
       Trail's chain carries two fades: how far through the article a segment is
       (`diag-d0`–`diag-d6`, 0.16 → 0.5) and how near the reader it is
       (`diag-near-*`). Both were plain `opacity`, equally specific, and the near
       rules came second — so the ramp's *last* step, which exists to be
       indistinguishable from no step at all, painted an early-article segment at
       0.52 beside an unclassed neighbour at 0.16. A threefold jump at exactly
       the boundary the design claims not to have.

       The fix is composition: the global fade is a custom property, and every
       near step is a lerp that resolves to it at level 7. So what has to hold is
       that no `diag-d*` rule spends `opacity` — spending it there is what makes
       the two fades fight instead of compose — and that level 7 spends no
       literal of its own.

       Probed by putting the eight literal opacities back: this reddens on both
       counts, and the Force boundary test above stays green, which is why this
       one has to exist separately. */
    for (let d = 0; d <= 6; d++) {
      const rule = new RegExp(`\\.diag-trail \\.diag-link\\.diag-d${d}\\s*\\{([^}]*)\\}`).exec(CSS)?.[1];
      expect(rule, `no rule for diag-d${d}`).toBeTruthy();
      expect(rule, `diag-d${d} should carry the fade as a property`).toContain("--chain-fade");
      expect(/(^|[\s;])opacity\s*:/.test(rule ?? ""), `diag-d${d} spends opacity`).toBe(false);
    }

    const base = /\.diag-trail \.diag-link\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    expect(base).toMatch(/opacity:\s*var\(--chain-fade/);

    const last =
      new RegExp(
        `\\.diag-trail \\.diag-link\\.diag-near-${CHAIN_NEAR_LEVELS - 1}\\s*\\{([^}]*)\\}`,
      ).exec(CSS)?.[1] ?? "";
    // No literal: the last step IS the global fade, whatever it happens to be.
    expect(last).toMatch(/opacity:\s*var\(--chain-fade/);
    // …and the near end is still the loud one, or the ramp points the wrong way.
    const first =
      /\.diag-trail \.diag-link\.diag-near-0\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    expect(first).toMatch(/opacity:\s*1\b/);
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

describe("the heading row that carries the caveat cannot grow a second line", () => {
  /* The scatter's caveat is an icon in `.band-head` rather than a strip of
     prose above the picture, and the whole case for putting it there is that
     the row costs no vertical space. That case was made three times and was
     wrong twice — `margin-left: auto` right-aligns on whichever line the item
     lands on, and `flex-wrap: nowrap` on a rebuilt `.diag-opts` only changed
     *which* item took the new line. Both were true about the thing they named.
     The third route is not a flex line at all: `.band-head h2` is `flex: 1`,
     and a flexible item that runs out of room wraps its own text, which makes
     the row taller by exactly as much.

     jsdom has no layout, so no rendering test can see any of this. What a test
     can do is hold the row to the shape that makes the height argument true
     without measuring anything. */
  /* **Comments stripped first, and this is not fussiness.** The rule below
     carries a comment that names `min-width: 0` in prose, so a regex over the
     raw block matches the explanation whether or not the declaration is there.
     Deleting the property and watching this file stay green is how that was
     found — the test agreed with the bug because it was reading the sentence
     about the bug. */
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const head = /\.band-head h2\s*\{([\s\S]*?)\}/.exec(bare)?.[1];

  it("declares the four properties that keep the heading on one line", () => {
    expect(head, "`.band-head h2` has no rule at all").toBeTruthy();
    /* `min-width: 0` is listed first because it is the one whose absence does
       nothing visible: without it the item's automatic minimum is its longest
       word, `text-overflow` never gets to act, and the other three read as
       present and working. */
    for (const decl of [
      /min-width:\s*0\b/,
      /overflow:\s*hidden\b/,
      /text-overflow:\s*ellipsis\b/,
      /white-space:\s*nowrap\b/,
    ]) {
      expect(head, `\`.band-head h2\` is missing ${decl.source}`).toMatch(decl);
    }
  });

  it("still leaves the icon unshrinkable, or the row cuts the wrong thing", () => {
    /* If the caveat button could shrink, the h2 would win the space and the
       icon would collapse to nothing at exactly the widths this is all about —
       the caveat would be gone rather than the heading being shortened. */
    const about = /\.diag-about\s*\{([\s\S]*?)\}/.exec(bare)?.[1];
    expect(about, "`.diag-about` has no rule at all").toBeTruthy();
    expect(about).toMatch(/flex:\s*none\b/);
  });
});
