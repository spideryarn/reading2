/**
 * **The rail's width, on both sides of a boundary the compiler cannot cross.**
 *
 * `SPINE_W` in layout.ts and `--spine-w` in styles.css are the same number
 * written twice, and three `@media` queries are *derived* from it by hand —
 * `GIST_MIN + PROSE_MIN + SPINE_W - 1` and `MODE_MIN + PROSE_MIN + SPINE_W - 1`
 * — because a media query cannot read a custom property and `@custom-media` is
 * not shipped anywhere. A fourth copy of the first sum lives in `scroll.ts` as
 * a `matchMedia` string.
 *
 * So there are six places one number lives, no tool checks any of them against
 * the others, and **the failure is silent in the direction that matters**. Move
 * `SPINE_W` and leave the stylesheet behind and there is a band of window widths
 * where `fitView` offers a gist column the stylesheet has already decided there
 * is no room for; move the mode query and leave `fitMode` behind and every mode
 * panel is a correctly-positioned element nought pixels wide, which is what
 * actually happened on 2026-08-27 (styles.css § a band with no room). Nothing
 * throws either way.
 *
 * This file is the check, and it is the same species as `tests/doc-links.test.ts`
 * — cheap, deterministic, and standing where a compiler cannot.
 *
 * ## Why the stylesheet carries markers rather than this file carrying regexes
 *
 * The first design was "grep styles.css for `731`". GPT Sol's review of the plan
 * named it as the most likely thing here to report success while doing nothing,
 * and it was right: a regex can match the number inside a *comment*, can match
 * one of two queries and miss the other, and nudging the number to watch it go
 * red only proves the regex sees that string — not that the browser uses it.
 *
 * So the stylesheet says out loud, at each site, which sum the query is:
 *
 * ```css
 * &#47;* spine-width-check: GIST_MIN + PROSE_MIN + SPINE_W - 1 *&#47;
 * @media (max-width: 731px) {
 * ```
 *
 * and this file evaluates that expression against the real constants and checks
 * the query on the very next line. A drift now fails whichever half moved, the
 * derivation is legible where it is performed, and deleting a marker fails too
 * (the count is pinned below).
 *
 * What this still cannot see: whether the browser lays anything out at that
 * width. That needs a rendered check, and it is a browser pass rather than a
 * unit test — docs/plans/spine-rail.md § Evidence.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GIST_MIN, MODE_MIN, PROSE_MIN, SPINE_W } from "../src/web/layout.js";

const CSS_PATH = new URL("../src/web/styles.css", import.meta.url);
const SCROLL_PATH = new URL("../src/web/scroll.ts", import.meta.url);

const css = readFileSync(CSS_PATH, "utf8");
const scroll = readFileSync(SCROLL_PATH, "utf8");

/**
 * The stylesheet with every comment removed.
 *
 * Used for the *declaration* checks, and it is the difference between a test and
 * a decoration: this file is full of prose that quotes CSS, including the old
 * `1.5rem` and the old `743px`, and a check that reads the file raw would happily
 * match a sentence describing what the code used to do.
 */
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The named constants a marker may refer to. */
const CONSTANTS: Record<string, number> = {
  GIST_MIN,
  MODE_MIN,
  PROSE_MIN,
  SPINE_W,
};

/**
 * Evaluate a marker's expression — `NAME (+|-) NAME|number`, left to right.
 *
 * Deliberately not `eval`, and deliberately not a general expression parser: the
 * grammar is four names, two operators and integers, and anything outside it
 * should fail loudly rather than be interpreted generously.
 */
function evaluate(expr: string): number {
  const tokens = expr.trim().split(/\s+/);
  const value = (t: string): number => {
    if (t in CONSTANTS) return CONSTANTS[t]!;
    const n = Number(t);
    if (!Number.isInteger(n)) throw new Error(`unknown term ${JSON.stringify(t)} in ${expr}`);
    return n;
  };
  let acc = value(tokens[0]!);
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i];
    const rhs = value(tokens[i + 1] ?? "");
    if (op === "+") acc += rhs;
    else if (op === "-") acc -= rhs;
    else throw new Error(`unknown operator ${JSON.stringify(op)} in ${expr}`);
  }
  return acc;
}

interface Marker {
  expr: string;
  /** Every `max-width` in the query on the line after the marker. */
  widths: number[];
  query: string;
}

/**
 * Every `spine-width-check` marker, with the query it introduces.
 *
 * The marker must be immediately followed by the `@media` line — no blank line,
 * no second comment — so that a marker cannot drift away from the query it
 * claims to describe and go on passing against a different one.
 */
function markers(): Marker[] {
  const out: Marker[] = [];
  const re = /\/\*\s*spine-width-check:\s*([^*]+?)\s*\*\/\n(@media[^{]*)\{/g;
  for (const m of css.matchAll(re)) {
    const query = m[2]!.trim();
    const widths = [...query.matchAll(/max-width:\s*(\d+)px/g)].map((w) => Number(w[1]));
    out.push({ expr: m[1]!, widths, query });
  }
  return out;
}

describe("--spine-w in styles.css is SPINE_W in layout.ts", () => {
  it("declares the rail in px, never in rem", () => {
    /* **A `rem` here is a bug even when the arithmetic looks right**, and this
       is the assertion that would have caught the pair the halving replaced:
       `SPINE_W = 24` against `--spine-w: 1.5rem` are equal only at a 16px root,
       and nothing in this app locks the root font size. A reader at 20px got a
       30px rail and a layout that subtracted 24. GPT Sol, 2026-08-28. */
    const decls = [...cssCode.matchAll(/--spine-w:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(decls.length).toBeGreaterThanOrEqual(2);
    for (const d of decls) expect(d).toMatch(/^\d+px$/);
  });

  it("every non-zero declaration is exactly SPINE_W px", () => {
    const decls = [...cssCode.matchAll(/--spine-w:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    const nonZero = decls.filter((d) => d !== "0px");
    // The default on `.reader` and the on-state on `.reader.spine-on`. More is
    // fine — another rule may need its own — but they must all agree.
    expect(nonZero.length).toBeGreaterThanOrEqual(2);
    for (const d of nonZero) expect(d).toBe(`${SPINE_W}px`);
  });

  it("the on state and the off state are both declared", () => {
    expect(cssCode).toContain(`.reader.spine-on { --spine-w: ${SPINE_W}px; }`);
    expect(cssCode).toContain(".reader.spine-off { --spine-w: 0px; }");
  });
});

describe("the derived breakpoints are the sums they say they are", () => {
  it("has all three markers, each followed directly by its query", () => {
    /* Pinned, so that deleting a marker is a failure rather than a way to make
       this file stop asking. Three: § a narrow window, § a band with no room,
       and § a small device. */
    const found = markers();
    expect(found.length).toBe(3);
    for (const m of found) expect(m.widths.length).toBe(1);
  });

  it("each query is its marker's expression, evaluated", () => {
    for (const m of markers()) {
      expect(
        m.widths[0],
        `${m.query} should be ${m.expr} = ${evaluate(m.expr)}`,
      ).toBe(evaluate(m.expr));
    }
  });

  it("covers both of the two distinct sums", () => {
    /* A marker check passes vacuously if every marker happens to be the same
       sum — so the *pair* is asserted, not just the individual queries. These
       are the two crossovers the two comments in styles.css describe: the last
       width at which a gist column fits beside the prose, and the last width at
       which the mode band fits beside it. */
    const sums = new Set(markers().map((m) => evaluate(m.expr)));
    expect([...sums].sort((a, b) => a - b)).toEqual([
      GIST_MIN + PROSE_MIN + SPINE_W - 1,
      MODE_MIN + PROSE_MIN + SPINE_W - 1,
    ]);
  });
});

describe("scroll.ts's SMALL_DEVICE is the same query as § a small device", () => {
  /**
   * The fourth copy, and the one whose own comment used to say no test could
   * catch it drifting — because the failure is "the bar never hides", which
   * looks exactly like the feature being off.
   */
  it("carries the narrow-window number", () => {
    const m = scroll.match(/const SMALL_DEVICE = "([^"]+)"/);
    expect(m, "SMALL_DEVICE literal not found in scroll.ts").not.toBeNull();
    const width = m![1]!.match(/max-width:\s*(\d+)px/);
    expect(width, `no max-width in ${m![1]}`).not.toBeNull();
    expect(Number(width![1])).toBe(GIST_MIN + PROSE_MIN + SPINE_W - 1);
  });

  it("is the same string the stylesheet uses, character for character", () => {
    /* Not just the same number: the `max-height` half and the comma are load
       bearing too (the comma is an OR — styles.css § a small device), and a
       copy that agreed on the width while disagreeing on the height would
       attach the listener on a different set of devices from the one the rules
       apply to. */
    const literal = scroll.match(/const SMALL_DEVICE = "([^"]+)"/)![1]!;
    /* **`cssCode`, not `css`**: this file is full of prose quoting media
       queries, including the one this literal used to be, so the raw text would
       be satisfied by a *comment* describing a rule that no longer exists. And
       an exact count rather than `toContain`, so that a second copy of the query
       appearing somewhere — which is how § a small device and § a narrow window
       drifted apart in the first place — is a failure rather than a shrug.
       GPT Sol, 2026-08-28. */
    const uses = cssCode.split(`@media ${literal} {`).length - 1;
    expect(uses, `styles.css should use "@media ${literal} {" exactly once`).toBe(1);
  });
});
