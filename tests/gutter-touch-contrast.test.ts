/**
 * **The gutter's touch opacity reaches WCAG 1.4.11's 3:1 on every ground it can
 * land on — computed from the tokens, not trusted from the comment beside it.**
 *
 * These are icon-only controls, so 1.4.11 applies to them, and the number that
 * satisfies it is not a constant: `opacity` composites against whatever the row
 * is painted, and the reading view paints rows three different colours. For a
 * day the file carried 0.35, which is **1.65:1**. On 2026-09-07 it carried
 * 0.653 — exactly 3:1 against `--page`, and 2.95:1 against the `--panel` a
 * selected row is painted, which was a documented corner case right up until
 * the change that made the selected row *the only row an affordance appears
 * on*. GPT Sol caught that at plan stage; nothing in the suite would have.
 *
 * **Why this is arithmetic rather than a screenshot.** The claim is about the
 * relationship between four token values and one opacity, all of which are
 * written down, and a rendered-pixel check would answer it only at the device
 * pixel ratio it happened to run at (see the 1x shortfall the stylesheet
 * records). It is also the shape that can go red for the right reason: darken
 * `--sidebar`, re-point `--ink-faint`, or lower the opacity, and this fails
 * naming which. The rendered half — that a finger can reach the row at all —
 * is `tests/block-selection-by-tap.test.tsx` and a browser pass.
 *
 * The colour maths is the stylesheet's own, quoted in its comment and confirmed
 * against Chrome to the digit: for an achromatic `oklch(L 0 0)`, linear-light
 * sRGB is `L³` and that *is* the relative luminance, and `opacity` composites in
 * gamma-encoded sRGB. `assertAchromatic` below is what stops that shortcut
 * outliving its premise.
 */
import { describe, expect, it } from "vitest";
import { allSheets, mediaBlock, readerCssNoComments, stripComments } from "./helpers/stylesheets.js";

const tokens = stripComments(
  allSheets()
    .map((s) => s.css)
    .join("\n"),
);
const css = readerCssNoComments();

/**
 * A custom property's declared value, whitespace flattened.
 *
 * **Several tokens are declared twice** — `styles/tokens.css` is the palette and
 * `src/web/styles/tokens.css` re-states the aliases the reading view uses — so
 * this insists the declarations *agree* rather than that there is one. Taking
 * the first would read whichever file the walker happened to emit first and
 * would go on being green after the two diverged, which is the only interesting
 * thing that can go wrong here.
 */
function token(name: string): string {
  const found = [...tokens.matchAll(new RegExp(`--${name}:\\s*([^;}]+)`, "g"))].map((m) =>
    (m[1] ?? "").replace(/\s+/g, " ").trim(),
  );
  expect(found.length, `\`--${name}\` is not declared in any sheet the client loads`).toBeGreaterThan(0);
  expect(new Set(found).size, `\`--${name}\` is declared as ${[...new Set(found)].join(" and ")}`).toBe(1);
  return found[0] ?? "";
}

/**
 * The lightness of an achromatic `oklch(L 0 0)` token, **failing rather than
 * approximating** if anyone gives it a hue.
 *
 * The `L³` shortcut below is exact only for greys. A tinted `--panel` would
 * still parse, still produce a plausible number, and quietly answer a different
 * question — which is the failure this whole file exists to catch one level up.
 */
function greyL(name: string): number {
  const value = token(name);
  const found = /^oklch\(\s*([\d.]+)\s+0\s+0\s*\)$/.exec(value);
  expect(
    found,
    `\`--${name}\` is \`${value}\`, not an achromatic \`oklch(L 0 0)\` — the L³ shortcut in this file is only exact for greys, so re-derive it from a real colour conversion rather than loosening this`,
  ).not.toBeNull();
  return Number(found?.[1]);
}

/** `--a: var(--b)`, asserted, so re-pointing an alias breaks this rather than the reader. */
function aliasOf(name: string, expected: string): void {
  expect(token(name), `\`--${name}\` no longer resolves through \`--${expected}\``).toBe(
    `var(--${expected})`,
  );
}

const encode = (y: number) => (y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055);
const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const grey = (L: number) => encode(L ** 3);
const luminance = ([r, g, b]: number[]) =>
  0.2126 * linear(r ?? 0) + 0.7152 * linear(g ?? 0) + 0.0722 * linear(b ?? 0);
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const composite = (fg: number[], bg: number[], alpha: number) =>
  fg.map((c, i) => (bg[i] ?? 0) + alpha * (c - (bg[i] ?? 0)));
const hex = (s: string) => [1, 3, 5].map((i) => Number.parseInt(s.slice(i, i + 2), 16) / 255);

/** The opacity the touch reveal actually declares. */
function touchOpacity(): number {
  const block = mediaBlock(css, "(hover: none)", ".blk-permalink");
  /* Deliberately blind to the selector. Whether the reveal is gated on
     `.row-active`, and whether the gate is written so it cannot outrank a state
     mark, is `tests/gutter-target-size.test.ts`'s question — asking it here too
     would make this file fail with a message about contrast when the selector
     moved, which is the least useful thing a failure can say. */
  const found = [...block.matchAll(/opacity:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  expect(found.length, "the touch reveal declares no opacity").toBeGreaterThan(0);
  expect(new Set(found).size, `the touch block declares ${found.length} different opacities — this file assumes one`).toBe(1);
  return found[0] ?? 0;
}

describe("the gutter's touch reveal is legible on every row it can appear on", () => {
  /* The three grounds, and why each is in the list rather than only `--page`:

     - `--page` is an ordinary paragraph.
     - `--panel` is what `tr.row-active td.text` paints (prose.css), and since
       the reveal became conditional it is the ground the affordances are
       *usually* on — the selected row is the only row that has any.
     - `--muted` is what `td.text.opaque` paints for media and captions, and it
       **wins over `row-active`**: the two selectors have the same specificity
       and `.opaque` is written later. So a selected figure row is the darkest
       ink on the lightest ground, which is the worst case and the one nobody
       would think to open. */
  const GROUNDS = ["page", "panel", "muted"] as const;

  it("resolves through the aliases this file's arithmetic assumes", () => {
    /* Every number below is computed from four tokens. If an alias is
       re-pointed the numbers stay plausible and stop being about the gutter,
       which is exactly the way a contrast check dies quietly. */
    aliasOf("page", "background");
    aliasOf("panel", "sidebar");
    aliasOf("ink-faint", "muted-foreground");
    aliasOf("highlight", "spideryarn-orange");
  });

  it.each(GROUNDS)("reaches 3:1 against --%s", (name) => {
    const source = { page: "background", panel: "sidebar", muted: "muted" }[name];
    const bg = Array(3).fill(grey(greyL(source)));
    const ink = Array(3).fill(grey(greyL("muted-foreground")));
    const drawn = ratio(luminance(composite(ink, bg, touchOpacity())), luminance(bg));
    /* **The unrounded number.** This asserted `Number(drawn.toFixed(3))` for one
       commit, which is a check that answers a weaker question than it states: at
       `0.705` the `--muted` ratio is 3.0049, and an opacity of `0.7039` gives
       2.99982 — which rounds to 3.000 and passes a test whose message says "at
       least 3:1". The rounding belongs in the message, never in the comparison.
       GPT Sol, 2026-09-08. */
    expect(
      drawn,
      `the gutter's affordances draw at ${drawn.toFixed(3)}:1 over --${name}, short of WCAG 1.4.11's 3:1`,
    ).toBeGreaterThanOrEqual(3);
  });

  it("stays under the ceiling, where the reader's own mark stops leading", () => {
    /* **Not "round it up to be safe".** The gutter's grammar is that the
       reader's mark carries the weight and the affordances do not, so there is a
       maximum here as well as a minimum: `.blk-cmt` is `--highlight` at 0.75,
       and above about 0.87 the buttons out-shine the bookmark and the column
       starts reading as a toolbar. The lead is 1.35:1 at 0.705 — plus a hue,
       which the affordances have none of. */
    const bg = Array(3).fill(grey(greyL("background")));
    const ink = Array(3).fill(grey(greyL("muted-foreground")));
    const markOpacity = Number(/opacity:\s*([\d.]+)/.exec(/^\.blk-cmt\s*\{([^}]*)\}/m.exec(css)?.[1] ?? "")?.[1]);
    expect(markOpacity, "`.blk-cmt` declares no opacity").toBeGreaterThan(0);

    const mark = luminance(composite(hex(token("spideryarn-orange")), bg, markOpacity));
    const affordance = luminance(composite(ink, bg, touchOpacity()));
    expect(
      mark,
      "the gutter's affordances are now brighter than the reader's own bookmark — state is supposed to lead",
    ).toBeGreaterThan(affordance);
  });
});
