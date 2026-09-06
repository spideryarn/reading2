/**
 * **No rule in styles.css may name a table element without scoping it.**
 *
 * ## The failure this exists for
 *
 * `styles.css` is written for the reading view, and the reading view is a
 * table. So the obvious place to put its geometry is on `thead th` and `td` —
 * and that is what happened, which meant those declarations reached **every
 * table in the app**:
 *
 *   thead th { position: sticky; top: var(--bar-bottom); height: var(--head-h); … }
 *   td       { border-right: 1px solid var(--rule-strong); … }
 *
 * On the shelf (`src/web/lib/DataTable.tsx`) that put every header cell 44px
 * down the page — measured 2026-09-06 at th 495.3–527.8 against a first row of
 * 484.3–536.8, so the header overlapped the first article's title by its whole
 * height, at every scroll position — and drew a vertical column grid the shelf
 * never asked for. Greg reported it as "the table view … is pretty ugly".
 *
 * **What makes it worth a test is that it was found three times and fixed
 * none.** `.design-table td` carried a `border-right: 0` whose comment named
 * this exact rule; `.prose th, .prose td` restated `border` in full for the
 * same reason; and the shelf's own `DataTable` was left broken because the two
 * workarounds meant nobody upstream ever saw a symptom. Each author patched
 * their own table and moved on. A fourth table would have done it again.
 *
 * ## Why it is scoped to table tags, and has no allowlist
 *
 * The first draft asserted that *no* selector anywhere may go unscoped.
 * Measured over this stylesheet that fires on **42** selector branches, nearly
 * all legitimate — `*`, `body`, keyframe stops, and the arguments of
 * `:is(h2, h3, …)`, which are not branches at all. A test that fails on forty
 * things acquires an allowlist, and an allowlist is where a real violation goes
 * to hide.
 *
 * Restricted to table tags there were exactly **four**, all of them this bug,
 * all fixed together. So this ships with **no allowlist**, which is the only
 * version of it that is still true in six months. Narrowed on GPT Sol's review,
 * 2026-09-06.
 *
 * `h1`, `h1 a` and `h1 a:hover` are the same mistake one element along — written
 * for the article title in the masthead section, landing on the homepage
 * wordmark and every other <h1> in the app. Real, out of scope here, and
 * deliberately not smuggled in as an allowlist entry.
 *
 * ## What "scoped" means
 *
 * A branch naming a table tag must also carry a class, id or attribute
 * selector. `:where(table.zoom > thead) > tr > th` passes — and `:where()` is
 * how it keeps the specificity the bare selector had, so scoping it does not
 * start beating `thead th.pin-left` and break the pinned end columns.
 *
 * See docs/plans/260906g-the-shelf-table-is-ugly-because-the-reading-view-s-css-leaks-into-it.md.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A table tag standing on its own in a branch.
 *
 * `(` and `,` are boundary characters as well as the combinators, so a tag
 * hidden inside a functional pseudo — `:is(td, th)` — is still found. Without
 * them that spelling was a false green, which GPT Sol pointed out on
 * 2026-09-06 while reviewing the built code.
 */
const TABLE_TAG = /(^|[\s>+~(,])(table|thead|tbody|tfoot|tr|th|td)($|[\s>+~:.#[),])/;

/** A class, id or attribute — the thing that turns a tag into *this* table's tag. */
const SCOPED = /[.#[]/;

/**
 * What `SCOPED` is allowed to look at.
 *
 * **A class inside `:not()` scopes nothing** — it *widens* the rule. `td:not(.zoom)`
 * carries a dot and matches every cell in the app bar one, so testing the raw
 * branch called it scoped and let it through. Stripping the negation's argument
 * first is what makes the check mean what its name says. Also GPT Sol, 2026-09-06.
 */
function withoutNegations(branch: string): string {
  let out = branch;
  let previous: string;
  do {
    previous = out;
    out = out.replace(/:not\([^()]*\)/g, "");
  } while (out !== previous);
  return out;
}

/** Does this branch name a table element without saying *which* table? */
function offends(branch: string): boolean {
  return TABLE_TAG.test(branch) && !SCOPED.test(withoutNegations(branch));
}

/** Every selector branch in a stylesheet, with the line it starts on, skipping @keyframes bodies. */
function selectorBranches(css: string): { line: number; branch: string }[] {
  /* Comments are blanked rather than removed so offsets — and therefore line
     numbers — survive. A failure message has to point at a line somebody can
     open. */
  const blanked = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

  const out: { line: number; branch: string }[] = [];
  let depth = 0;
  /* The brace depth the enclosing @keyframes opened at, or -1 for "not in one".
     Counting *blocks* rather than depth was the first version, and it came back
     out of the keyframes block on the closing brace of the first stop — so `to`
     was read as a selector. Caught by this file's own calibration test. */
  let keyframeAt = -1;
  let start = 0;

  for (let i = 0; i < blanked.length; i++) {
    const ch = blanked[i];
    if (ch !== "{" && ch !== "}") continue;

    if (ch === "}") {
      if (keyframeAt === depth) keyframeAt = -1;
      depth--;
      start = i + 1;
      continue;
    }

    const raw = blanked.slice(start, i);
    const selector = raw.trim().replace(/\s+/g, " ");
    start = i + 1;
    depth++;

    if (keyframeAt === -1 && /^@keyframes/i.test(selector)) keyframeAt = depth;
    if (keyframeAt !== -1 || !selector || selector.startsWith("@")) continue;

    /* Split on top-level commas only: `:is(h2, h3)` is one branch, and
       splitting inside it invents selectors nobody wrote.

       **Each branch gets its own line**, not the first branch's. A selector list
       here is routinely a dozen lines long (`.controls, .dock, …, thead th, …`),
       and reporting the head of the list sends the reader to an innocent
       selector — which is worse than reporting nothing. It only looked right
       before because `thead th` happened to come first in the lists it was in.
       GPT Sol, 2026-09-06. */
    const selectorStart = i - raw.length;
    for (const { branch, offset } of splitTopLevel(raw)) {
      out.push({ line: lineAt(blanked, selectorStart + offset), branch });
    }
  }
  return out;
}

/** 1-based line number of a character offset. */
function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

/** `a, :is(b, c) d` → ["a", ":is(b, c) d"]. Commas inside parentheses are not separators. */
function splitTopLevel(selector: string): { branch: string; offset: number }[] {
  const out: { branch: string; offset: number }[] = [];
  let depth = 0;
  let start = 0;

  const take = (from: number, to: number) => {
    const slice = selector.slice(from, to);
    const lead = slice.length - slice.trimStart().length;
    const branch = slice.trim().replace(/\s+/g, " ");
    if (branch) out.push({ branch, offset: from + lead });
  };

  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      take(start, i);
      start = i + 1;
    }
  }
  take(start, selector.length);
  return out;
}

describe("table selectors in styles.css are scoped", () => {
  /* Calibration first: the assertion below is only worth anything if it would
     actually have caught the bug, and would not fire on the fix. These are the
     real before-and-after strings. */
  it("recognises the selectors that caused the bug, and the ones that fixed it", () => {
    // The two that leaked, in the spellings they actually had.
    expect(offends("td")).toBe(true);
    expect(offends("thead th")).toBe(true);

    // The fix, and the two workarounds that were written instead of it.
    expect(offends(":where(table.zoom > thead) > tr > th")).toBe(false);
    expect(offends(":where(table.zoom > tbody > tr) > td")).toBe(false);
    expect(offends(".prose td")).toBe(false);
    expect(offends("td.gist")).toBe(false);
    expect(offends(".design-table td")).toBe(false);

    // And it must not fire on selectors that merely contain those letters.
    expect(offends(".mode-band")).toBe(false);
    expect(offends(".controls")).toBe(false);
    expect(offends(".install-hint")).toBe(false);
  });

  /**
   * The spellings that got past the first version of this check, all found by a
   * cross-family review of the built code rather than by the check itself.
   *
   * Each is a real way of writing the same bug: a rule that reaches every table
   * in the app while *looking* scoped. They are here because the check is a
   * pattern match rather than a parser, so the only honest way to state what it
   * covers is to enumerate what it has been shown to catch.
   */
  it("is not fooled by a tag inside :is(), or by a class inside :not()", () => {
    // Hidden behind a functional pseudo: still every td and th in the app.
    expect(offends(":is(td, th)")).toBe(true);
    expect(offends(":is(thead, tbody) tr")).toBe(true);
    // A class inside a negation widens the rule; it does not scope it.
    expect(offends("td:not(.zoom)")).toBe(true);
    expect(offends("th:not(.pin-left):not(.pin-right)")).toBe(true);
    // But a negation alongside a real scope is still scoped.
    expect(offends("td.gist:not(.continuation)")).toBe(false);
    expect(offends(".prose td:not(:first-child)")).toBe(false);
  });

  /**
   * **The known hole, written down rather than papered over.** `:is(table, .zoom) td`
   * carries a dot, so it reads as scoped, and it still matches every `td` in the
   * app. Closing it needs a real selector parser rather than a pattern match,
   * which is more machinery than this tripwire is worth — but a reader deserves
   * to know the boundary of what it promises, and a test that asserts the
   * current behaviour will fail loudly if someone ever does write the parser.
   */
  it("documents what it cannot see: a class in one branch of :is() reads as scope", () => {
    expect(offends(":is(table, .zoom) td")).toBe(false);
  });

  it("skips @keyframes stops and does not split inside :is()", () => {
    const css =
      "@keyframes spin { from { top: 0 } to { top: 1px } }\n:is(h2, h3) td.gist { color: red }\n";
    const branches = selectorBranches(css).map((b) => b.branch);
    expect(branches).not.toContain("from");
    expect(branches).not.toContain("to");
    expect(branches).toEqual([":is(h2, h3) td.gist"]);
  });

  /**
   * The line number is the whole value of the failure message, and a wrong one
   * is worse than none — it sends the reader to an innocent rule. Comments are
   * blanked rather than stripped precisely so this stays true; asserted here
   * because nothing else would notice it drifting.
   */
  it("reports the line the selector is on, counting through comments", () => {
    const css = ["a {", "  color: red;", "}", "", "/* a comment", "   over lines */", "td {", "  x: 1;", "}"].join("\n");
    expect(selectorBranches(css)).toEqual([
      { line: 1, branch: "a" },
      { line: 7, branch: "td" },
    ]);
  });

  /**
   * **Each branch of a list gets its own line, not the head of the list.**
   *
   * The selector lists in this stylesheet run to a dozen lines, and the two
   * transition rules that leaked had `thead th` several lines into one. The
   * first version reported the whole list at its first branch's line, which
   * only looked right because `thead th` happened to come first in the lists
   * this bug was in. Pointing a reader at an innocent selector is worse than
   * pointing them nowhere.
   */
  it("gives every branch of a multi-line list its own line", () => {
    const css = [".controls,", ".dock,", "thead th,", ".spine {", "  transition: none;", "}"].join("\n");
    expect(selectorBranches(css)).toEqual([
      { line: 1, branch: ".controls" },
      { line: 2, branch: ".dock" },
      { line: 3, branch: "thead th" },
      { line: 4, branch: ".spine" },
    ]);
  });

  it("no branch names a table element without a class, id or attribute", () => {
    const css = readFileSync(new URL("../src/web/styles.css", import.meta.url), "utf8");
    const offenders = selectorBranches(css).filter(({ branch }) => offends(branch));

    expect(
      offenders.map(({ line, branch }) => `styles.css:${line}  ${branch}`),
      "A bare `td` or `thead th` reaches every table in the app — the shelf and " +
        "an article's own tables, not just the reading view. Scope it with " +
        "`:where(table.zoom > …)`, which adds no specificity. See the header of this file.",
    ).toEqual([]);
  });
});
