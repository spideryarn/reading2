/**
 * **What a control owes a finger** — the two rules the reading view had no
 * statement of until 2026-09-08, and a tripwire over each.
 *
 * Written for [SPIDERYARN-READING2-2J], where the glossary's *order* row could
 * not be pressed on a touch device while the byte-identical row in Quotes
 * could. The incident was never reproduced
 * (docs/plans/260908a-glossary-order-button-not-clickable-on-touch.md has the
 * seven things that were ruled out and how), but it stood on two real absences,
 * and these are them:
 *
 * - **A control a finger has to hit was 23px tall.** `@media (pointer: coarse)`
 *   in narrow-window.css gives the dock a 40px floor per button, because Greg
 *   asked for exactly that on 2026-08-28. In the fortnight after, the query
 *   reached one further control — the footnote's *back to your place* link — and
 *   **no control inside a mode band at all**. 64% of the order row's own box was
 *   not on a button.
 * - **Every text field in the reading view was under 16px**, which is the size
 *   below which iOS Safari zooms the whole page on focus and does not zoom back
 *   out. The glossary is the only band with a field *above* its order row
 *   (`AskATerm`, owner-only — and the reporter is the owner), which is the only
 *   asymmetry with Quotes that was found at all.
 *
 * ## What this does NOT prove
 *
 * Named in the shape `tests/css-tokens.test.ts` insists on, and for the same
 * reason. **This is a text scanner, not a rendering engine.** A green run says
 * the declarations are written and that the floor out-weighs the rules it is
 * racing; it cannot say a finger lands on a button, because nothing in this
 * suite has layout. The evidence for that half is the measured before/after in
 * the plan doc, taken in a real browser — and it is not a formality: **each of
 * the two times this rule shipped broken, the browser caught it and this file
 * was green.**
 *
 * Nor can it see the whole cascade. It compares specificity between selectors
 * it can find in the sheets this helper walks. Source order, `@layer`
 * (the Tailwind utilities layer outranks all of this, which is why four
 * `tw:`-styled fields carry `tw:any-pointer-coarse:text-base` at their own call
 * sites), inline styles and `font` shorthands are all outside it.
 */
import { describe, expect, it } from "vitest";
import { readerCssNoComments, readerSheets, stripComments } from "./helpers/stylesheets.js";

/**
 * Every coarse-pointer block's body, concatenated.
 *
 * **Both queries, and they ask different questions.** `(pointer: coarse)` is
 * for the size rules — it reports what the browser calls the *primary* pointer,
 * so an iPad with a trackpad does not get 52px of chrome it will never touch.
 * `(any-pointer: coarse)` is for the no-zoom rule — it asks whether a
 * touchscreen exists at all, because that same iPad's reader still taps the
 * glass. narrow-window.css argues both out loud; a helper that saw only one of
 * them would report the other's rules as missing, which is a green-over-nothing
 * failure rather than a red one.
 */
function coarseBlocks(css: string): string {
  const out: string[] = [];
  const re = /@media\s*\(\s*(?:any-)?pointer:\s*coarse\s*\)\s*\{/g;
  for (const m of css.matchAll(re)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    out.push(css.slice(start, i - 1));
  }
  return out.join("\n");
}

/** Every `selector { declarations }` pair in a block, as written. */
function rules(css: string): { selector: string; decls: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: (m[1] ?? "").trim(),
    decls: m[2] ?? "",
  }));
}

/**
 * A selector list split into its members — on **top-level** commas only.
 *
 * `:is(:not([type]), [type="text"], …)` is one selector containing six commas,
 * and splitting on all of them turns one rule into seven fragments, none of
 * which parses. Depth-counting is the whole of the fix.
 */
function selectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out.filter(Boolean);
}

/**
 * CSS specificity's `(b, c)` columns for one selector — classes/attributes/
 * pseudo-classes, then element names and pseudo-elements. `a` (ids) is omitted
 * because nothing in these sheets uses one.
 *
 * **`:is()` takes its most specific argument, and getting that wrong is a
 * green-over-nothing failure rather than a red one.** Summing the arguments
 * instead would score `input:is([type="text"], [type="email"], …)` at eight
 * where the browser scores it at one, and this file would then cheerfully
 * report a floor as strong enough while the browser let a field slip under it.
 * `:not()` behaves the same way; `:where()` contributes nothing at all.
 */
function spec(selector: string): [number, number] {
  let b = 0;
  let c = 0;
  let rest = selector;
  for (;;) {
    const fn = /:(is|not|where)\(/.exec(rest);
    if (!fn) break;
    const open = fn.index + fn[0].length - 1;
    let depth = 0;
    let close = rest.length - 1;
    for (let i = open; i < rest.length; i++) {
      if (rest[i] === "(") depth++;
      else if (rest[i] === ")") {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (fn[1] !== "where") {
      let best: [number, number] = [0, 0];
      for (const arg of selectors(rest.slice(open + 1, close))) {
        const got = spec(arg);
        if (got[0] > best[0] || (got[0] === best[0] && got[1] > best[1])) best = got;
      }
      b += best[0];
      c += best[1];
    }
    rest = `${rest.slice(0, fn.index)} ${rest.slice(close + 1)}`;
  }
  b += (rest.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? []).length;
  c += (
    rest
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/[.#:][\w-]+/g, " ")
      .match(/[a-zA-Z][\w-]*/g) ?? []
  ).length;
  return [b, c];
}

/** Does `a` win over `b` in the cascade on specificity alone? */
function beats(a: [number, number], b: [number, number]): boolean {
  return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
}

/* ------------------------------------------------------------------------- */

describe("a control a finger has to hit", () => {
  /* The two order rows are one control written twice — `.gloss-sort-btn` in
     glossary.css and `.quotes-rank-btn` in quotes.css carry the same
     declarations, character for character. Whatever floor they get, they get
     together, or the next report is about the other one. */
  const BARS = [".gloss-sort-btn", ".quotes-rank-btn"] as const;
  const FLOOR_REM = 2.5; // 40px — the dock's floor, and its comment says why.

  for (const cls of BARS) {
    it(`${cls} has at least a ${FLOOR_REM}rem hit height on a coarse pointer`, () => {
      const rule = rules(coarseBlocks(readerCssNoComments())).find((r) =>
        selectors(r.selector).includes(cls),
      );
      expect(rule, `${cls} has no rule inside a coarse-pointer block`).toBeDefined();
      const min = /min-height:\s*([\d.]+)rem/.exec(rule?.decls ?? "");
      expect(min, `${cls} sets no min-height on a coarse pointer`).not.toBeNull();
      expect(Number(min?.[1])).toBeGreaterThanOrEqual(FLOOR_REM);
    });

    /* **A finger has no hover, so the wash must not be its only feedback — and
       must not be mistaken for the pressed state.** The two paint nearly the
       same box, and on iOS the hover sticks to whatever was last touched, so an
       unpressed order could sit there looking like the one in force. This is
       the half squarely shared with SPIDERYARN-READING2-2G. */
    it(`${cls} keeps its hover behind (hover: hover) and offers :active`, () => {
      const css = readerCssNoComments();
      const hovers = rules(css).filter((r) => selectors(r.selector).includes(`${cls}:hover`));
      expect(hovers.length, `${cls}:hover should be written exactly once`).toBe(1);
      /* The rule has to sit inside a `(hover: hover)` block. Asking the text
         rather than the parse tree: the query opens before the selector and
         closes after it, so the selector's index falls inside the span. */
      const query = /@media\s*\(\s*hover:\s*hover\s*\)\s*\{/g;
      const at = css.indexOf(`${cls}:hover`);
      const gated = [...css.matchAll(query)].some((m) => {
        let depth = 1;
        let i = m.index + m[0].length;
        const start = i;
        while (i < css.length && depth > 0) {
          if (css[i] === "{") depth++;
          else if (css[i] === "}") depth--;
          i++;
        }
        return at > start && at < i;
      });
      expect(gated, `${cls}:hover is not inside @media (hover: hover)`).toBe(true);
      expect(
        rules(css).some((r) => selectors(r.selector).includes(`${cls}:active`)),
        `${cls} has no :active, so a finger gets no feedback that a press landed`,
      ).toBe(true);
    });
  }
});

describe("a text field iOS must not zoom into", () => {
  /* iOS Safari zooms the page on focus of any field under 16px and leaves it
     zoomed; index.html permits it (`initial-scale=1`, no `maximum-scale`, and
     capping the scale would take pinch-zoom off the article, which is not a
     trade this app makes for a form field). So the field is what has to move. */
  const floorRule = () =>
    rules(coarseBlocks(readerCssNoComments())).find((r) => r.selector.includes("textarea"));

  it("one rule raises every field to 1rem on a coarse pointer", () => {
    const rule = floorRule();
    expect(rule, "no rule names `textarea` inside a coarse-pointer block").toBeDefined();
    const parts = selectors(rule?.selector ?? "");
    expect(parts.some((p) => p.includes("input")), "the floor must have an `input` half").toBe(true);
    expect(parts.some((p) => p.includes("textarea")), "and a `textarea` half").toBe(true);
    /* Added 2026-09-08 with SPIDERYARN-READING2-2H. iOS zooms on FOCUS, not on
       the keyboard, and a `<select>` takes focus — the composer's stance picker
       was still 13.28px after the first two halves shipped. */
    expect(parts.some((p) => p.includes("select")), "and a `select` half").toBe(true);
    expect(rule?.decls ?? "").toMatch(/font-size:\s*1rem/);
  });

  /**
   * **And it has to out-weigh the field rules it is a floor for, by name.**
   *
   * This is the check that matters, and it exists because writing the rule was
   * not enough — twice.
   *
   * `textarea` was written bare, which is (0,0,1) against `.chat-input`'s
   * (0,1,0), so the chat composer stayed at 15.04px with the floor sitting
   * three lines above it in the same block. A browser measurement caught that;
   * this file was green, because the rule really was written.
   *
   * Then its replacement only claimed to beat *one* class — and
   * `.remember .chat-input` in mode-band.css is (0,2,0), so Remember mode was
   * still 15.68px and every test here still passed. GPT Sol's F1, 2026-09-08.
   * Naming the competitors is what closes it: a floor is worth exactly what it
   * out-weighs, so the test has to know who it is racing.
   *
   * Both halves are checked separately, because they apply to different
   * elements and a strong `input` half cannot cover a weak `textarea` one —
   * which is precisely the hole the first version of this test had.
   */
  it("out-weighs the field rules it has to beat", () => {
    const parts = selectors(floorRule()?.selector ?? "");
    const inputHalf = parts.find((p) => p.includes("input")) ?? "";
    const textareaHalf = parts.find((p) => p.includes("textarea")) ?? "";
    const selectHalf = parts.find((p) => p.includes("select")) ?? "";

    /* The heaviest hand-written rule of each kind, **found rather than
       listed** — so a new one that out-weighs the floor turns red here instead
       of quietly leaving one field small. */
    const FIELDS =
      /\.(gloss-ask-input|srch-input|chat-input|chat-edit-box|cmt-note|cnd-box|crit-text|prof-box-input|quiz-answer|fb-input)\b/;
    const TEXTAREAS =
      /\.(chat-input|chat-edit-box|cmt-note|cnd-box|crit-text|prof-box-input|quiz-answer|fb-input)\b/;
    /* A `<select>` is styled through its container rather than a class of its
       own — `.chat-live-mic select`, not `.mic-select` — so it cannot be found
       by the class list above. Matched on the element instead, which also
       catches a container nobody has written yet. */
    const SELECTS = /\bselect\b/;
    let worstInput = { sel: "(none found)", at: [0, 0] as [number, number] };
    let worstTextarea = { sel: "(none found)", at: [0, 0] as [number, number] };
    let worstSelect = { sel: "(none found)", at: [0, 0] as [number, number] };
    for (const rule of rules(readerCssNoComments())) {
      const size = /font-size:\s*([\d.]+)rem/.exec(rule.decls);
      if (!size || Number(size[1]) >= 1) continue;
      for (const part of selectors(rule.selector)) {
        const at = spec(part);
        if (SELECTS.test(part)) {
          if (beats(at, worstSelect.at)) worstSelect = { sel: part, at };
          continue;
        }
        if (!FIELDS.test(part)) continue;
        if (TEXTAREAS.test(part)) {
          if (beats(at, worstTextarea.at)) worstTextarea = { sel: part, at };
        } else if (beats(at, worstInput.at)) {
          worstInput = { sel: part, at };
        }
      }
    }

    expect(
      beats(spec(inputHalf), worstInput.at),
      `the input half (${inputHalf}, ${spec(inputHalf).join(",")}) must out-specify ` +
        `${worstInput.sel} (${worstInput.at.join(",")}), the heaviest rule holding a field under 1rem`,
    ).toBe(true);
    expect(
      beats(spec(textareaHalf), worstTextarea.at),
      `the textarea half (${textareaHalf}, ${spec(textareaHalf).join(",")}) must out-specify ` +
        `${worstTextarea.sel} (${worstTextarea.at.join(",")}), the heaviest rule holding a field under 1rem`,
    ).toBe(true);
    /* **A tie is a loss here, so this one is checked strictly.** A bare
       `:root select` is (0,1,1) and so is `.chat-live-mic select` — equal, and
       decided only by narrow-window.css being imported after mode-band.css.
       That is the source-order dependence that let this rule ship applying to
       nothing twice, so the select half carries `:not([hidden])` to win
       outright, and `beats()` is what refuses the tie. */
    expect(
      beats(spec(selectHalf), worstSelect.at),
      `the select half (${selectHalf}, ${spec(selectHalf).join(",")}) must out-specify ` +
        `${worstSelect.sel} (${worstSelect.at.join(",")}), the heaviest rule holding a select under 1rem`,
    ).toBe(true);
    /* Named, because it is the one that got past the previous version of this
       test, and a search that stopped finding it would go green over nothing. */
    expect(
      worstTextarea.sel,
      "`.remember .chat-input` should still be the heaviest textarea rule the search finds",
    ).toBe(".remember .chat-input");
  });

  /* **A file picker is not a field, and the floor must not reach it.** It did:
     the negative selector this replaced (`input:not([type="range"])…`) matched
     the visible `type="file"` input in the feedback dialog, whose deliberate
     0.72rem would have become 16px inside a fixed-size dialog — for a control
     with no keyboard and nothing to zoom. GPT Sol's F3. A positive list of the
     types that raise a keyboard cannot go wrong that way, so this keeps it
     positive. */
  it("covers the types that raise a keyboard, and no others", () => {
    const selector = floorRule()?.selector ?? "";
    for (const type of ["text", "search", "email", "password", "url", "tel", "number"]) {
      expect(selector, `the floor should cover [type="${type}"]`).toContain(`[type="${type}"]`);
    }
    expect(selector, "an input with no type attribute defaults to text").toContain(":not([type])");
    expect(selector, "the floor must not name file, range, checkbox or radio").not.toMatch(
      /\[type="(file|range|checkbox|radio)"\]/,
    );
  });

  /* The rule above is a floor, and a floor is only worth what nothing steps
     under. A `font-size` below 1rem written *inside* a coarse-pointer block
     would win on source order and reopen the hole for one field, which is the
     "reset that covers a minority of what it names" shape
     docs/project/controls.md was written about. This sees only that one shape —
     a rule outside these blocks is the previous test's business. */
  it("no coarse-pointer rule puts a field back under 1rem", () => {
    const offenders: string[] = [];
    for (const sheet of readerSheets()) {
      for (const rule of rules(coarseBlocks(stripComments(sheet.css)))) {
        if (
          !/\binput\b|\btextarea\b|\bselect\b|-input\b|-box\b|-note\b|-text\b|-answer\b/.test(
            rule.selector,
          )
        ) {
          continue;
        }
        const size = /font-size:\s*([\d.]+)rem/.exec(rule.decls);
        if (size && Number(size[1]) < 1) {
          offenders.push(`${sheet.path}: ${rule.selector} → ${size[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
