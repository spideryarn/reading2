/**
 * **The rail's width, on both sides of a boundary the compiler cannot cross.**
 *
 * `SPINE_W` in layout.ts and `--spine-w` in styles.css are the same number
 * written twice, and two `@media` queries are *derived* from it by hand —
 * both of them `GIST_MIN + PROSE_MIN + SPINE_W - 1` — because a media query
 * cannot read a custom property and `@custom-media` is not shipped anywhere.
 *
 * **There was a third copy, in `scroll.ts` as a `matchMedia` string, and it went
 * on 2026-09-07** — `watchBarVisibility` asked the breakpoint so a large window
 * would attach no scroll listener, and then the top bar started hiding at every
 * width and there was nothing left to gate
 * (docs/plans/260907b-the-top-bar-leaves-while-you-read-at-every-width.md). The
 * last describe below keeps the half of that guard which still has a subject:
 * the query is written once, and no copy of it has come back.
 *
 * **There was a fourth, the mode crossover, and it is gone rather than
 * checked** — the last describe in this file says why, and stands where it was.
 * A number the stylesheet cannot get right in both spine states is not one to
 * keep in step; it is one to stop writing down.
 *
 * That paid on 2026-09-06, when the crossover moved from `MODE_MIN + PROSE_MIN
 * + SPINE_W` (844) to `MODE_MIN + MODE_PROSE_FLOOR + SPINE_W` (700) so that a phone
 * in landscape could have the band beside its article. One constant changed in
 * layout.ts and nothing in the stylesheet had to move with it. Had the query
 * still been there it would have been a fifth hand-copy to find.
 *
 * So there are four places one number lives — five until 2026-09-07 — no tool
 * checks any of them against the others, and **the failure is silent in the
 * direction that matters**. Move
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
 * unit test — docs/plans/260828ay-spine-rail.md § Evidence.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readerCss } from "./helpers/stylesheets.js";
import { GIST_MIN, MODE_MIN, MODE_PROSE_FLOOR, PROSE_MIN, SPINE_W, fitView } from "../src/web/layout.js";

const SCROLL_PATH = new URL("../src/web/scroll.ts", import.meta.url);

/* The reading-view sheets as a set, concatenated in cascade order. One file
   until 2026-09-06 and thirty-eight since, and the `spine-width-check` markers
   below are matched against the query on the line after them, which the
   concatenation preserves. tests/helpers/stylesheets.ts. */
const css = readerCss();
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
  /* Here so that a marker naming it evaluates rather than throwing "unknown
     term" — not because one may. `MODE_PROSE_FLOOR` is the mode crossover's term,
     and the mode crossover is the sum the stylesheet is not allowed to write
     down at all (see below). If a marker ever does name it, the assertion three
     describes down is what should fail, and it should fail on the sum rather
     than on the parser. */
  MODE_PROSE_FLOOR,
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
  it("has both markers, each followed directly by its query", () => {
    /* Pinned, so that deleting a marker is a failure rather than a way to make
       this file stop asking. Two: § a narrow window and § a small device.

       **It was three until 2026-09-03**, and losing one is the fix rather than a
       regression: § a band with no room was `@media (max-width: 843px)`, a
       derivation the stylesheet could not get right because the sum it derives
       moves with `?spine=0`. It keys off `.band-covers` now — see the last
       describe in this file, which is what stops the query coming back. */
    const found = markers();
    expect(found.length).toBe(2);
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

  it("is the gist crossover, and only that one", () => {
    /* Both remaining markers are the same sum — the last width at which a gist
       column fits beside the prose — so this asserts the *set*, which is the
       half a per-marker check cannot see.

       **The mode crossover is deliberately absent**, and asserting that is the
       point of the equality rather than a side effect: `MODE_MIN + MODE_PROSE_FLOOR
       + SPINE_W - 1` is not a width the stylesheet is allowed to know, because
       it is only that number while the rail is on. Somebody re-deriving it here
       fails this line and the agreement check below.

       Both the sum it must not be are checked — the live one and `PROSE_MIN`,
       which was the live one until 2026-09-06 — because a stale hand-copy of
       the *old* crossover is at least as likely as a fresh copy of the new. */
    const sums = new Set(markers().map((m) => evaluate(m.expr)));
    expect([...sums]).toEqual([GIST_MIN + PROSE_MIN + SPINE_W - 1]);
    expect(sums.has(MODE_MIN + MODE_PROSE_FLOOR + SPINE_W - 1)).toBe(false);
    expect(sums.has(MODE_MIN + PROSE_MIN + SPINE_W - 1)).toBe(false);
  });
});

/**
 * **§ a small device's query, which used to have a twin in TypeScript.**
 *
 * `scroll.ts` held a `SMALL_DEVICE` constant carrying this string
 * character-for-character, because `watchBarVisibility` asked `matchMedia` the
 * same question the stylesheet asked and attached its scroll listener only
 * while it matched. The two tests here were the guard against those drifting,
 * and the failure they caught was a bad one: "the bar never hides" looks
 * exactly like the feature being off.
 *
 * **That constant went on 2026-09-07**, when the top bar started hiding at every
 * width and there was nothing left to gate
 * (docs/plans/260907b-the-top-bar-leaves-while-you-read-at-every-width.md).
 * The half that asserted the *number* is covered by the marker check above,
 * which reads every `spine-width-check` comment in the stylesheets and this
 * query carries one.
 *
 * **What is kept is the half the markers cannot do**: the whole string, once.
 * The `max-height` clause and the comma are load-bearing — the comma is an OR,
 * so a query agreeing on the width while disagreeing on the height applies the
 * dock's half of the switch on a different set of devices — and a *second* copy
 * appearing somewhere is how § a small device and § a narrow window drifted
 * apart in the first place.
 */
describe("§ a small device's query", () => {
  const SMALL_DEVICE = `(max-height: 620px), (max-width: ${GIST_MIN + PROSE_MIN + SPINE_W - 1}px)`;

  it("is written exactly once across the reader stylesheets", () => {
    /* **`cssCode`, not `css`**: this file is full of prose quoting media
       queries, so the raw text would be satisfied by a *comment* describing a
       rule that no longer exists. An exact count rather than `toContain`, so a
       second copy is a failure rather than a shrug. GPT Sol, 2026-08-28. */
    const uses = cssCode.split(`@media ${SMALL_DEVICE} {`).length - 1;
    expect(
      uses,
      `the reader stylesheets should use "@media ${SMALL_DEVICE} {" exactly once`,
    ).toBe(1);
  });

  it("no longer has a copy in scroll.ts", () => {
    /* The point of this line is that the constant is *gone*, not merely
       unused: a `SMALL_DEVICE` sitting in scroll.ts with nothing reading it is
       a breakpoint two files still appear to agree on, and the next person to
       need one would reach for it. */
    expect(scroll).not.toMatch(/SMALL_DEVICE\s*=/);
  });
});

/* ------------------------------------------------------------------------
 * The band that covers the article: a fact, not a width
 * ---------------------------------------------------------------------- */

/**
 * **The one query in this file that could not be right, and why it is gone.**
 *
 * `fitMode` compares `MODE_MIN + MODE_PROSE_FLOOR` against the window *minus
 * the rail*, so the width at which the band stops fitting beside the prose is
 * **700 with the rail on and 688 with `?spine=0`** — and it was `PROSE_MIN`,
 * 844 and 832, when the accident below happened. The numbers in the rest of
 * this note are that era's, because it is a reproduction of a specific bug.
 * A media query cannot see `?spine=0`, so the
 * `@media (max-width: 843px)` that used to widen the band disagreed with
 * `fitMode` across **832–843 with the rail off**: layout.ts handed the band
 * 288–299px and squeezed the table to make room, while the stylesheet widened
 * that same band to the whole window and laid it over the article. Measured by
 * GPT Sol, 2026-08-28, and left in place with a comment for six days.
 *
 * The fix is not a fourth hand-copied breakpoint — that would be a *fifth* copy
 * of a number this file exists because there are already too many of. It is to
 * stop the stylesheet deriving a fact it cannot see: `App.tsx` writes
 * `--mode-w` from `fit.modeW`, so it writes `band-covers` from the same value,
 * and the covering rules key off the class.
 *
 * ## What these checks can and cannot see
 *
 * They read text, like the rest of this file. `coversRule()` finds the rule that
 * makes the band full-screen and reports what gates it; the agreement check
 * below then models the stylesheet's decision from that gate. While the rule is
 * class-keyed the model is the class's own definition, so the loop cannot fail —
 * and that is the point: it goes red the moment a `max-width` comes back and
 * disagrees with `fitMode` in either spine state, which is exactly the drift
 * that was there. What it cannot see is whether the browser applies the class;
 * that is a browser pass (docs/project/browser-testing.md).
 */
const FULL_WIDTH_BAND = "width: calc(100vw - var(--spine-w) - var(--safe-left) - var(--safe-right));";

/**
 * The at-rule preludes enclosing `index`, innermost first, plus the rule's own
 * selector at position 0.
 *
 * Walks backwards counting braces rather than parsing: an unmatched `{` seen
 * from inside is an enclosing block, and the text back to the previous `}`,
 * `{` or `;` is its prelude.
 */
function enclosing(source: string, index: number): string[] {
  const out: string[] = [];
  let depth = 0;
  for (let i = index; i >= 0; i--) {
    const ch = source[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      if (depth > 0) {
        depth--;
        continue;
      }
      let j = i - 1;
      while (j >= 0 && source[j] !== "}" && source[j] !== "{" && source[j] !== ";") j--;
      out.push(source.slice(j + 1, i).trim());
    }
  }
  return out;
}

function coversRule(): { selector: string; gates: string[] } {
  const idx = cssCode.indexOf(FULL_WIDTH_BAND);
  expect(idx, `no rule in the reader stylesheets declares ${FULL_WIDTH_BAND}`).toBeGreaterThan(-1);
  expect(
    cssCode.indexOf(FULL_WIDTH_BAND, idx + 1),
    "more than one rule widens the band to the window; this check no longer knows which is which",
  ).toBe(-1);
  const chain = enclosing(cssCode, idx);
  return { selector: chain[0] ?? "", gates: chain.slice(1) };
}

/** The class `Reader` puts on `.reader` when the band has no room beside the prose. */
const COVERS_CLASS = "band-covers";

const bandFit = (windowWidth: number, spineOff: boolean) =>
  fitView({
    windowWidth,
    gistDepths: [0, 1],
    leafDepth: 2,
    showText: true,
    chosen: null,
    modeBand: true,
    showSpine: spineOff ? false : null,
  });

describe("the band covers the article on a fact, not on a width", () => {
  it("the full-screen rule is not gated on a window width", () => {
    const { gates } = coversRule();
    const width = gates.find((g) => /^@media/.test(g) && /max-width/.test(g));
    expect(
      width,
      `the reader stylesheets widen the band inside ${width} — a width the stylesheet cannot make conditional on ?spine=0`,
    ).toBeUndefined();
  });

  it("keys off the class instead", () => {
    const { selector } = coversRule();
    expect(selector).toContain(`.${COVERS_CLASS}`);
  });

  it("Reader.tsx writes that class from fit.modeW, beside --mode-w", () => {
    /* The two must come from the same number or the stylesheet is guessing
       again — with the guess hidden in a component rather than in a query.

       `Reader` left `App.tsx` for src/web/reader/Reader.tsx on 2026-09-06; the
       read is what fails if it moves again. */
    const reader = readFileSync(new URL("../src/web/reader/Reader.tsx", import.meta.url), "utf8");
    expect(reader).toContain(`"--mode-w": \`\${fit.modeW}px\``);
    expect(reader).toMatch(new RegExp(`fit\\.modeW === 0[^\\n]*\\n?[^\\n]*${COVERS_CLASS}`));
  });

  it("agrees with fitMode across 650–730, rail on and rail off", () => {
    /* 688 and 700 are the two crossovers, and the twelve pixels between them —
       the rail's width — are where a hand-copied query would be wrong in one
       spine state and right in the other. Both spine states, because that is
       the whole bug.

       **This range was 800–880 until 2026-09-06 and had to move with the
       crossover.** Left alone it would have gone on passing while asserting
       nothing: at every width from 800 to 880 both spine states are now
       side-by-side, so `js` is `false` throughout and a restored `@media`
       query anywhere near the real crossover would sail through. GPT Sol
       caught it reviewing the built code — a sweep pinned to the old constant
       is exactly the check that cannot fail.

       **Both halves of that were watched fail, 2026-09-06**, by injecting
       `@media (max-width: 699px)` around `.reader.band-covers .mode-band` —
       the exact mistake, since 699 is right with the rail on and wrong with it
       off. At 650–730 this assertion goes red with *"at 688px with the rail
       off: expected true to be false"*. At 800–880 it stays green and only the
       sibling assertion above — the one that forbids a `max-width` gate at all
       — notices. So the range is load-bearing, and that is also the answer to
       "why two assertions": the cheaper one was carrying this alone. */
    const { gates } = coversRule();
    const gate = gates.find((g) => /^@media/.test(g) && /max-width/.test(g));
    const limit = gate ? Number(gate.match(/max-width:\s*(\d+)px/)![1]) : null;

    for (const spineOff of [false, true]) {
      for (let w = 650; w <= 730; w++) {
        const js = bandFit(w, spineOff).modeW === 0;
        // The stylesheet's own decision: a width while it is gated on one, and
        // otherwise the class, which is `js` by construction.
        const css = limit === null ? js : w <= limit;
        expect(css, `at ${w}px with the rail ${spineOff ? "off" : "on"}`).toBe(js);
      }
    }
  });
});
