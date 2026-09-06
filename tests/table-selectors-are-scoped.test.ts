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

const TABLE_TAG = /(^|[\s>+~])(table|thead|tbody|tfoot|tr|th|td)($|[\s>+~:.#[])/;
const SCOPED = /[.#[]/;

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

    const line = lineAt(blanked, i - raw.length + (raw.length - raw.trimStart().length));
    /* Split on top-level commas only: `:is(h2, h3)` is one branch, and
       splitting inside it invents selectors nobody wrote. */
    for (const branch of splitTopLevel(selector)) out.push({ line, branch });
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
function splitTopLevel(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of selector) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

describe("table selectors in styles.css are scoped", () => {
  /* Calibration first: the assertion below is only worth anything if it would
     actually have caught the bug, and would not fire on the fix. These are the
     real before-and-after strings. */
  it("recognises the selectors that caused the bug, and the ones that fixed it", () => {
    const offends = (branch: string) => TABLE_TAG.test(branch) && !SCOPED.test(branch);

    // The four that leaked.
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

  it("no branch names a table element without a class, id or attribute", () => {
    const css = readFileSync(new URL("../src/web/styles.css", import.meta.url), "utf8");
    const offenders = selectorBranches(css).filter(
      ({ branch }) => TABLE_TAG.test(branch) && !SCOPED.test(branch),
    );

    expect(
      offenders.map(({ line, branch }) => `styles.css:${line}  ${branch}`),
      "A bare `td` or `thead th` reaches every table in the app — the shelf and " +
        "an article's own tables, not just the reading view. Scope it with " +
        "`:where(table.zoom > …)`, which adds no specificity. See the header of this file.",
    ).toEqual([]);
  });
});
