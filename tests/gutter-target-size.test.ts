/**
 * **The prose gutter's targets are 24 × 24 CSS pixels at every root font size,
 * and the two halves of that claim live in different files.**
 *
 * WCAG 2.5.8 asks for 24 × 24 **CSS pixels**, and `--blk-slot: 1.5rem` is that
 * at a 16px root and 18px at the 12px root a reader can choose in their
 * browser's settings. This app explicitly supports other roots — `fitView` takes
 * `rootFontPx` and `tests/layout.test.ts` asserts 12 and 20 — so for a month the
 * comment on `td.text`, this plan and `prose-gutter-icons.md` all claimed a
 * standard the code met at one root out of three. GPT Sol's stage 1 review,
 * 2026-09-04, and it was commit-blocking.
 *
 * Its warning is the reason this file checks **two** dimensions: a `max()` on
 * the slot height alone would have left the grid's *columns* at 18px, so the
 * targets would have been 24 tall and 18 wide and every assertion about height
 * would have passed.
 *
 * **Why a stylesheet parser rather than a browser.** The 49 tests that passed
 * over this stage exercise none of the gutter's rendered geometry: deleting the
 * row-height floor, or `.blk-cmt { pointer-events: auto }`, leaves all of them
 * green, and both of those are bugs this gutter has actually shipped. Sol asked
 * for a retained browser fixture and did not block on one; this is the part of
 * it that is deterministic, runs in milliseconds, and needs no Chrome — the
 * *sizes*, which is where the commit-blocking failure was. The rendered
 * geometry is still checked by hand through `preview-gutter.html`, and the
 * numbers are in docs/plans/260904b-… § Built, and measured.
 *
 * The other half of its job is the copy: `layout.ts` holds `BLK_SLOT_MIN_PX`
 * and `BLK_SLOT_REM` because the lone-column cap has to know the gutter's real
 * width at a given root and cannot read CSS. A copy is only safe if something
 * fails when the two disagree. This is that something.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BLK_SLOT_MIN_PX, BLK_SLOT_REM, PROSE_ALONE_MAX_REM, proseAloneMaxPx } from "../src/web/layout.js";

const css = readFileSync(new URL("../src/web/styles.css", import.meta.url), "utf8")
  // Both files quote the declarations under test at length, so a check that read
  // them raw would be satisfied by a sentence describing what the code used to
  // do — the trap `tests/text-alone-centring.test.ts` documents.
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** Every root a reader can actually land on: Chrome's font-size settings. */
const ROOTS = [9, 12, 16, 20, 24];

/**
 * One CSS rule body, by selector, with whitespace flattened.
 *
 * **Anchored to the start of a line**, for the reason
 * `tests/text-alone-centring.test.ts` gives: `td.text` is also the tail of
 * `tr.row-active td.text` and a dozen other descendant selectors, and a helper
 * that matched one of those would read a rule that is perfectly correct and has
 * nothing to do with the assertion.
 */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /* **Every** rule with this exact selector, joined — not the first. `td.text`
     has several (§ text, § a narrow window, § plain), and the first one carries
     the padding while the floor asserted here is three thousand lines further
     down. Taking `exec`'s single match read a rule that was perfectly correct
     and had nothing to do with the question. */
  const found = [...css.matchAll(new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, "gm"))];
  expect(found.length, `no rule for \`${selector}\` in styles.css`).toBeGreaterThan(0);
  return found.map((m) => m[1] ?? "").join(" ").replace(/\s+/g, " ").trim();
}

/**
 * `max(<a>rem, <b>px)` as the pair it is, from a custom property's declaration.
 *
 * Deliberately strict about the *shape* rather than tolerant: a slot written any
 * other way is a slot this file cannot reason about, and failing to parse must
 * be a failure rather than a skip.
 */
function slotDeclaration(): { rem: number; px: number } {
  const found = /--blk-slot:\s*max\(\s*([\d.]+)rem\s*,\s*([\d.]+)px\s*\)/.exec(css);
  expect(
    found,
    "`--blk-slot` is not `max(<n>rem, <n>px)` — the px half is what holds the target at 24 CSS px when the root is not 16",
  ).not.toBeNull();
  return { rem: Number(found?.[1]), px: Number(found?.[2]) };
}

const slotPx = (root: number) => {
  const { rem, px } = slotDeclaration();
  return Math.max(rem * root, px);
};

describe("the gutter's targets meet WCAG 2.5.8 at every root", () => {
  it.each(ROOTS)("is at least 24 CSS px tall and wide at a %ipx root", (root) => {
    // Height: `min-height: var(--blk-slot)` on `.blk-gutter > *`.
    expect(slotPx(root)).toBeGreaterThanOrEqual(24);
    // Width: the grid's columns are one slot each, and each child fills its
    // column. Both of those are asserted below; here it is the same number.
    expect(slotPx(root)).toBeGreaterThanOrEqual(24);
  });

  it("sizes the grid's columns from the slot, not from a fraction of the box", () => {
    /* Sol's specific warning. `1fr 1fr` of a two-slot box is the same width
       today, but it says "share what there is" where the claim is "each of these
       is a 24px target" — and it is the declaration that stops being true first
       if the box's width is ever changed independently. */
    expect(css).toContain("grid-template-columns: repeat(2, var(--blk-slot))");
    expect(css).toContain("width: var(--blk-gutter-w)");
    expect(css).toContain("--blk-gutter-w: calc(var(--blk-slot) * 2)");
  });

  it("gives every child the whole column rather than the glyph's own width", () => {
    // Without this each target is the SVG's own 12px, whatever the column says.
    const box = /\.blk-gutter > \*\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(box).toContain("min-height: var(--blk-slot)");
    expect(box).toContain("width: 100%");
  });

  it("floors every row at the slots its gutter has to hold", () => {
    /* **Deleting these is the failure Sol named**: the 49 tests that passed over
       this stage would all have stayed green without them, and a control that
       hangs out of its row is an input bug — it sits inside the upper row's
       `<tr>`, so pointing at it marks the wrong row active.

       Three rules, because there are three shapes: the pad, an ordinary row, and
       a heading whose gutter hangs from the *bottom* and therefore needs the slot
       plus that offset rather than `--blk-top`. The second one is newer than the
       other two — a 24px target in a 39px row fits by 0.04px at a 16px root, and
       `--blk-slot`'s px floor turns that into a 1.56px overhang at 12px, because
       the row keeps shrinking with the root and the target stops.

       This is a structural check, not a geometric one: it says the rules are
       there and are written off the same tokens. What they actually measure is
       docs/plans/260904b-… § Built, and measured. */
    expect(rule("td.text.gutter-pad")).toContain(
      "height: calc(var(--blk-top) + var(--blk-slot) * 2 + var(--block-pad))",
    );
    expect(rule("td.text")).toContain("height: calc(var(--blk-top) + var(--blk-slot) + var(--block-pad))");
    expect(rule("td.text.kind-heading:not(.gutter-pad)")).toContain(
      "height: calc(var(--blk-slot) + var(--block-pad))",
    );
  });

  it("derives the cell's left padding from the gutter instead of restating it", () => {
    /* The three numbers this replaced — 3rem, 0.35rem, 3.7rem — were correct and
       had to be kept in step by hand. Written as `calc()` they cannot drift, and
       the px floor flows into the padding for free. */
    expect(css).toContain("--text-pad-l: calc(var(--blk-gutter-w) + var(--blk-gutter-x) * 2)");
  });
});

/** Every rule whose selector *list* contains this exact selector. */
function rulesWith(selector: string): Array<{ sel: string; body: string }> {
  const out: Array<{ sel: string; body: string }> = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] ?? "").replace(/\s+/g, " ").trim();
    const parts = sel.split(",").map((p) => p.trim());
    if (parts.includes(selector)) out.push({ sel, body: (m[2] ?? "").replace(/\s+/g, " ").trim() });
  }
  return out;
}

/**
 * The body of the gutter's `@media (hover: none) { … }`, by counting braces.
 *
 * Two things here are the point rather than plumbing. **Braces are counted**
 * because a lazy regex stops at the first nested rule's `}` and would leave the
 * touch assertions below passing on a fragment. And **the block is found by
 * what is in it**, not by being the first one: this stylesheet has two, the
 * other one three thousand lines earlier, and reading that one would have been
 * a check that could never fail for the reason it says.
 */
function touchBlock(): string {
  for (const m of css.matchAll(/@media \(hover: none\)/g)) {
    const open = css.indexOf("{", m.index);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) {
        const body = css.slice(open + 1, i);
        if (body.includes(".blk-permalink")) return body;
        break;
      }
    }
  }
  throw new Error("no `@media (hover: none)` block covering the gutter");
}

/**
 * **The fourth cell, and the three ways it could be drawn and still be
 * unusable** — stage 2 of docs/plans/260904b-…: a "?" in the wrong cell, a "?"
 * that never appears on a device with no hover, and a "?" inside a container
 * that is `pointer-events: none`. The last is not hypothetical — it is exactly
 * what `.blk-cmt` would have shipped as, and the only reason it did not is a
 * declaration somebody remembered to write.
 */
describe('the "?" is the fourth cell of the pad', () => {
  it("names row 2 / column 2, which stage 1 left empty on purpose", () => {
    expect(rule(".blk-help")).toContain("grid-area: 2 / 2");
    /* And the pad is still a map rather than a queue: four slots, four cells,
       no two the same. Auto-placement is what used to shunt the chat button
       along when a comment arrived. */
    const cells = [".blk-permalink", ".block-chat", ".blk-cmt", ".blk-help"].map((sel) =>
      /grid-area:\s*([^;]+);/.exec(rule(sel))?.[1]?.trim(),
    );
    expect(cells).toEqual(["1 / 1", "1 / 2", "2 / 1", "2 / 2"]);
  });

  it("is an affordance: hidden at rest, revealed on hover and on focus", () => {
    /* The gutter's grammar, and the reason this is asserted rather than left to
       the eye: at rest the gutter shows *state*, on hover it shows
       *affordances*. A "?" painted on every paragraph of an unmarked article is
       eighty question marks. */
    const hidden = rulesWith(".blk-help").filter((r) => r.body.includes("opacity: 0;"));
    expect(hidden.length, "`.blk-help` is not hidden at rest").toBe(1);
    expect(hidden[0]?.body).toContain("pointer-events: none");
    expect(hidden[0]?.sel).toContain(".blk-permalink");

    const shown = rulesWith("tr:hover .blk-help");
    expect(shown.length, "nothing reveals `.blk-help` on hover").toBe(1);
    expect(shown[0]?.body).toContain("opacity: 1");
    /* Without this the reveal is a target that is visible and not clickable:
       the container is `pointer-events: none` and every child opts back in. */
    expect(shown[0]?.body).toContain("pointer-events: auto");
    /* A keyboard reader never produces `tr:hover`, so focus has to be in the
       same list, or the button is invisible for exactly the reader who cannot
       find it by waving a mouse at the page. */
    expect(shown[0]?.sel).toContain(".blk-help:focus-visible");
  });

  it("leaves the reader's marks alone on a touch device", () => {
    /* **The touch block may raise the affordances and must not touch state.**
       Two things live in this gutter that are facts rather than buttons — a
       block that already has a conversation, and the bookmark — and the
       grammar the whole column runs on is that those carry the weight while
       the affordances stay under them. `.block-chat.has` wins on specificity
       (0,2,0 against the touch rule's 0,1,0), which is *not* the same as being
       safe: a `color` declared in this block would land on `.block-chat.has`
       too, because nothing more specific sets its colour inside the query, and
       the blue mark would go grey on every touch device while every desktop
       check stayed green. That is this stylesheet's oldest failure mode.

       This is why the affordances are raised with `opacity` alone. It is also
       the reason the flat-grey alternative was refused: written as a colour it
       would have had to be scoped away from `.has` by hand. */
    const touch = touchBlock();
    expect(touch, "the touch block sets a colour — see `.block-chat.has`").not.toMatch(
      /(^|[;{\s])color\s*:/,
    );
    // And the mark's own colour is still declared, outside the query where it
    // applies to every device.
    expect(rule(".block-chat.has")).toContain("color: var(--chat-mark)");
    expect(rule(".blk-cmt")).toContain("color: var(--highlight)");
  });

  it("exists at all on a device with no hover, and can be pressed there", () => {
    /* This stylesheet has shipped a hover-only affordance twice — `.block-chat`
       and `.block-id` — and a desktop harness said fine both times, because
       `(hover: none)` never matches on one. Greg reads on an iPad. */
    const touch = touchBlock();
    const found = /([^{}]*\.blk-help[^{}]*)\{([^{}]*)\}/.exec(touch);
    expect(found, "`.blk-help` is not in the `(hover: none)` block").not.toBeNull();
    const body = (found?.[2] ?? "").replace(/\s+/g, " ");
    expect(body).toContain("pointer-events: auto");
    /* Faint but present, and never invisible: a 0 here is the hover-only bug
       with a different spelling. */
    const opacity = Number(/opacity:\s*([\d.]+)/.exec(body)?.[1]);
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
  });
});

describe("layout.ts's copy of the slot agrees with the stylesheet", () => {
  it("matches both halves of the declaration", () => {
    const { rem, px } = slotDeclaration();
    expect(BLK_SLOT_REM).toBe(rem);
    expect(BLK_SLOT_MIN_PX).toBe(px);
  });

  it("reserves the whole gutter in the lone-column cap, at every root", () => {
    /* The failure this replaces: a single rem constant under-reserved by 1.2px
       at a 12px root and 12.9px at 9px, because below 16 the gutter stops
       shrinking while everything else keeps going — so the cell's left padding
       grows *in rem terms* exactly where a rem constant cannot follow it.

       `--reading-measure` is 65ch, ≈46rem in the reading face; that
       approximation is the constant's own, and the assertion is the inequality
       rather than the total. `--text-pad-r` is read from the stylesheet so this
       fails if it moves. */
    const MEASURE_REM = 46;
    const padR = Number(/--text-pad-r:\s*([\d.]+)rem/.exec(css)?.[1]);
    const insetRem = Number(/--blk-gutter-x:\s*([\d.]+)rem/.exec(css)?.[1]);
    expect(padR).toBeGreaterThan(0);
    expect(insetRem).toBeGreaterThan(0);

    for (const root of ROOTS) {
      const needed = (MEASURE_REM + padR + insetRem * 2) * root + slotPx(root) * 2;
      expect(proseAloneMaxPx(root), `the cap clips the measure at a ${root}px root`).toBeGreaterThanOrEqual(
        Math.round(needed),
      );
      // And not so generous that the column stops looking capped: the rounding
      // runs upwards by design, but by under a rem.
      expect(proseAloneMaxPx(root), `the cap is loose at a ${root}px root`).toBeLessThan(needed + root);
    }
  });

  it("leaves the two common roots exactly where they were", () => {
    // The point of adding the gutter as its own term rather than raising the
    // constant: only the root that was wrong moves.
    expect(proseAloneMaxPx(16)).toBe(832);
    expect(proseAloneMaxPx(20)).toBe(1040);
    // 624 before, and 624 was the bug.
    expect(proseAloneMaxPx(12)).toBe(636);
  });

  it("keeps the rem part a whole number of rem", () => {
    // Everything derived from it is asserted by hand in tests/layout.test.ts,
    // which stops being possible the moment this is fractional.
    expect(PROSE_ALONE_MAX_REM).toBe(Math.round(PROSE_ALONE_MAX_REM));
  });
});
