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
 * geometry is checked by a Playwright pass against real Chrome whenever this
 * layout moves, and the numbers are written into the plan of the day — most
 * recently docs/plans/260905b-… § What Greg is looking at. (This sentence used
 * to name a `preview-gutter.html`; there is no such file in the repo.)
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

  it("sizes the grid's column from the slot, not from a fraction of the box", () => {
    /* Sol's specific warning. `1fr` of a one-slot box is the same width today,
       but it says "share what there is" where the claim is "each of these is a
       24px target" — and it is the declaration that stops being true first if
       the box's width is ever changed independently. */
    expect(css).toContain("grid-template-columns: var(--blk-slot)");
    expect(css).toContain("grid-auto-rows: var(--blk-slot)");
    expect(css).toContain("width: var(--blk-gutter-w)");
    // One column since 2026-09-05: the bookmark went into the line, the second
    // column went with it, and the prose got 24px back on each side.
    expect(css).toContain("--blk-gutter-w: var(--blk-slot)");
  });

  it("gives every child the whole column rather than the glyph's own width", () => {
    // Without this each target is the SVG's own 12px, whatever the column says.
    const box = /\.blk-gutter > \*\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(box).toContain("min-height: var(--blk-slot)");
    expect(box).toContain("width: 100%");
  });

  it("floors every row at the one slot every gutter has to hold", () => {
    /* **Deleting these is the failure Sol named**: the 49 tests that passed over
       the 2026-09-04 stage would all have stayed green without them, and a
       control that hangs out of its row is an input bug — it sits inside the
       upper row's `<tr>`, so pointing at it marks the wrong row active.

       **There is one floor left, and it is the small one.** `.gutter-pad`, which
       reserved the whole column on every row a reader owned, went on 2026-09-05:
       the gutter now draws only what the row already has room for, so the row
       does not have to be made room in. What survives is the floor that keeps a
       *single* slot fitting — a 24px target in a 39px row fits by 0.04px at a
       16px root, and `--blk-slot`'s px floor turns that into a 1.56px overhang
       at 12px, because the row keeps shrinking with the root and the target
       stops.

       A heading's gutter hangs from the *bottom*, so its floor is the slot plus
       that offset rather than `--blk-top`.

       This is a structural check, not a geometric one: it says the rules are
       there and are written off the same tokens. What they actually measure is
       docs/plans/260905c-… § Built, and measured. */
    expect(rule("td.text")).toContain("height: calc(var(--blk-top) + var(--blk-slot) + var(--block-pad))");
    expect(rule("td.text.kind-heading")).toContain(
      "height: calc(var(--blk-slot) + var(--block-pad))",
    );
    // And the class that used to floor a row is gone entirely, rather than left
    // declared and unset — TableView.tsx no longer emits it.
    expect(css).not.toContain("td.text.gutter-pad");
  });

  it("measures the room the row has, which is what the whole mechanism rests on", () => {
    /* The gutter's own box IS the answer to "how much column will fit here":
       the cell, less where the column starts and the pad it must not sit on.
       Take either inset out and every query below is asking about the wrong
       number — and nothing would look wrong until a control hung into the next
       paragraph.

       Two insets rather than `height: calc(100% - …)`, which says the same thing
       and is defensible by spec: percentage heights inside table cells are an
       interoperability-sensitive corner and this is the number the overhang
       invariant rests on. GPT Sol's fifth finding on the plan, 2026-09-05. */
    const box = rule(".blk-gutter");
    expect(box).toContain("top: var(--blk-top)");
    expect(box).toContain("bottom: var(--block-pad)");
    // `line-height: 0` is in this rule too, so the check has to name the form
    // it is refusing rather than the word.
    expect(box).not.toContain("height: calc(100%");
    expect(box).toContain("container-type: size");
    /* A heading's box starts at the top of the *cell* rather than at
       `--blk-top`, which is doubled on a heading and would leave 18.8px — less
       than a target — for the query to measure. Bottom-aligned, so the slot sits
       beside the heading's words rather than a line above them. Sol's third. */
    const head = rule("td.text.kind-heading .blk-gutter");
    expect(head).toContain("top: 0");
    expect(head).toContain("bottom: calc(var(--block-pad) / 2)");
    expect(head).toContain("align-content: end");
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
 * **The foot of the line, and the three ways it could be drawn and still be
 * unusable** — stage 2 of docs/plans/260904b-…: a "?" in the wrong cell, a "?"
 * that never appears on a device with no hover, and a "?" inside a container
 * that is `pointer-events: none`. The last is not hypothetical — it is exactly
 * what `.blk-cmt` would have shipped as, and the only reason it did not is a
 * declaration somebody remembered to write.
 */
describe("the column shows as many controls as the row has room for", () => {
  it("draws nothing by default, so a browser without the query is safe", () => {
    /* **The default is the collapsed state on purpose.** Every rule that reveals
       a second control lives inside a container query; a browser that does not
       understand `@container` therefore gets one control and the way to the
       rest, rather than a column of four hanging into the paragraph below. Get
       this backwards — reveal by default, hide in the query — and the fallback
       is the overhang bug this whole section exists to prevent. */
    expect(css).toContain(".blk-gutter > * { display: none; }");
    // One control and nothing behind it: draw it, whatever it is.
    expect(css).toContain('.blk-gutter[data-controls="1"] > * { display: inline-flex; }');
    /* **And no `:has()` decides any of it.** The one that survived the plan
       review held the mark in the one-slot bracket and swapped the "…" in on
       hover; it was `(0,5,1)` against the count rules' `(0,3,0)`, so it forced
       the dot on at every capacity — a fifth item in a four-slot gutter, hanging
       below its own row. It was also unreachable by keyboard and by touch, which
       have no hover to swap with. GPT Sol's first two findings on the built
       code, 2026-09-05. This assertion is what stops it coming back: it is the
       kind of rule that looks obviously right in isolation. */
    expect(css).not.toContain(":has(.blk-cmt)");
    /* **And the class of bug stated once, rather than the instance.** What made
       that rule dangerous was not `:has()` — it was a `tr:hover` selector
       deciding `display`, which lets the pointer change *how many* controls are
       drawn, in a column whose whole safety argument is that the number is
       decided by the row. Hover may change `opacity` and `color` and nothing
       else. The browser sweep that missed the original bug hovered nothing;
       this is the assertion that does not need a pointer to hold. */
    const hoverRules = [...css.matchAll(/(tr:hover[^{]*)\{([^}]*)\}/g)].filter(
      ([, sel]) => /\.blk-|\.block-chat/.test(sel ?? ""),
    );
    // `§ the gutter` is not a usable landmark here: this fixture has its
    // comments stripped, which is the whole point of stripping them, and an
    // `indexOf` on a section heading therefore returns -1 and slices from the
    // end. An earlier draft of the assertion above did exactly that and passed
    // against one character of CSS.
    expect(hoverRules.length).toBeGreaterThan(0);
    for (const [, , body] of hoverRules) expect(body).not.toContain("display");
  });

  it("writes every threshold twice, because a query cannot read --blk-slot", () => {
    /* **This is the one that would be wrong at a 20px root and right at 16.**
       `--blk-slot` is `max(1.5rem, 24px)`, and a container query cannot read a
       custom property, so each threshold is spelled `(min-height: Npx) and
       (min-height: Mrem)` — which is `max()` in query syntax. Drop the rem half
       and a 20px reader is offered three 30px targets in room for two; drop the
       px half and a 9px reader is offered targets the px floor has stopped
       shrinking.

       Asserted as exact strings because the failure is silent: the wrong
       threshold still renders a gutter, just one slot too many, on a device the
       author is not using. */
    for (const [px, rem] of [
      [48, 3],
      [72, 4.5],
      [96, 6],
    ] as const) {
      expect(css).toContain(
        "@container (min-height: " + px + "px) and (min-height: " + rem + "rem)",
      );
      // Each pair is exactly one slot apart, which is the whole arithmetic.
      expect(px / 24).toBe(rem / 1.5);
    }
  });

  it("takes the controls in one order, and it is BlockGutter's render order", () => {
    /* **`:nth-child` is a copy of the JSX's order, and that is now deliberate.**
       Until 2026-09-04 every slot named its own `grid-area` precisely so the two
       could differ; a column that truncates cannot afford that, because "the
       first k that fit" has to mean something. So nothing is placed by
       `grid-area` any more — the assertion is that no rule reintroduces one —
       and the order is asserted from the other end in
       `tests/block-gutter.test.tsx`, which renders the component and reads the
       DOM.

       The mark is first: Greg's call, 2026-09-05, so a note never disappears
       because its paragraph is short. The price is that adding one pushes chat
       and the "?" down a slot, which is the guarantee the 2 x 2 pad bought. */
    expect(css).not.toContain("grid-area:");
    expect(css).toContain(".blk-gutter > :nth-child(1) { display: inline-flex; }");
    expect(css).toContain(".blk-gutter > :nth-child(-n + 2) { display: inline-flex; }");
  });

  it("shows the dot from the control count, never from a proxy for it", () => {
    /* **Every rule that hides or shows the "…" is keyed on `data-controls`.**
       The first draft asked `:has(.blk-cmt)` instead, on the reasoning that a
       note is what makes four controls out of three — and that is a proxy, not
       the count. `comments`, `onChatAbout` and `onHelp` are independent at the
       component's boundary, so a visitor with a note came out with a mark and no
       way to the address under it, and a caller passing one callback and a note
       had three controls treated as four. GPT Sol's fourth finding on the plan,
       2026-09-05; the eight combinations are rendered and read in
       tests/block-gutter.test.tsx.

       So: three controls fit in three slots and draw no dot; four do not. */
    expect(css).toContain('.blk-gutter[data-controls="3"] > .blk-more { display: none; }');
    expect(css).toContain('.blk-gutter[data-controls="4"] > .blk-more { display: inline-flex; }');
    const four = css.slice(css.indexOf("@container (min-height: 96px)"));
    expect(four).toContain(".blk-gutter > * { display: inline-flex; }");
    expect(four).toContain('.blk-gutter[data-controls="4"] > .blk-more { display: none; }');
  });

  it("unfolds over the rows below rather than growing its own", () => {
    /* The one deliberate overhang in this stylesheet, and the difference is
       consent: it exists because the reader pressed a button, and it closes on
       Escape, on choosing anything, and on a press anywhere else
       (BlockGutter.tsx).

       `container-type: normal` is the load-bearing half. Size containment means
       "your height does not depend on your contents", which is exactly what has
       to stop being true — leave it on and the unfolded column computes to
       nothing at all. */
    const at = css.indexOf(".blk-gutter[data-open] {");
    const open = css.slice(at, at + 600);
    expect(open).toContain("container-type: normal");
    expect(open).toContain("height: auto");
    expect(css).toContain(".blk-gutter[data-open] > * {");
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
      const needed = (MEASURE_REM + padR + insetRem * 2) * root + slotPx(root);
      expect(proseAloneMaxPx(root), `the cap clips the measure at a ${root}px root`).toBeGreaterThanOrEqual(
        Math.round(needed),
      );
      // And not so generous that the column stops looking capped: the rounding
      // runs upwards by design, but by under a rem.
      expect(proseAloneMaxPx(root), `the cap is loose at a ${root}px root`).toBeLessThan(needed + root);
    }
  });

  it("reserves exactly one slot of gutter at each root", () => {
    // Adding the gutter as its own term rather than raising the constant is
    // what makes this follow the stylesheet: one slot at 16 and 12 where the px
    // floor holds it at 24, and 30 at a 20px root where the rem wins.
    expect(proseAloneMaxPx(16)).toBe(808);
    expect(proseAloneMaxPx(20)).toBe(1010);
    // 624 before 2026-09-04, and 624 was the bug; 636 until 2026-09-05, when the
    // gutter went from two columns to one and every root lost a slot.
    expect(proseAloneMaxPx(12)).toBe(612);
  });

  it("keeps the rem part a whole number of rem", () => {
    // Everything derived from it is asserted by hand in tests/layout.test.ts,
    // which stops being possible the moment this is fractional.
    expect(PROSE_ALONE_MAX_REM).toBe(Math.round(PROSE_ALONE_MAX_REM));
  });
});
