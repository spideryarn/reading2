/**
 * **No new text under 13px on a touch screen** (plan 261021c; Greg on an
 * iPhone, 2026-10-20: the investigate chat's sources were "too small … for an
 * iPhone", and *"make a minimal update to our sort of design system
 * documentation to avoid this problem going forwards"*).
 *
 * The floor is `--text-min` (src/web/styles/tokens.css): 0px with a mouse, and
 * under `any-pointer: coarse` 13px that grows with the reader's text size. A
 * size reads it as `font-size: max(var(--text-min), <size>)`. This file holds:
 *
 * 1. the token to its two values, and `tw:text-xs` to the floor (tailwind.css);
 * 2. **an exact baseline** of every small literal that skips the floor — in a
 *    stylesheet, `file › selector › value` from `font-size` or the `font:`
 *    shorthand; in TSX, an arbitrary `tw:text-[…]`. A new one fails; one that
 *    has gone fails too, so the list stays tight. Exact rather than counted per
 *    file, so swapping one old size for a new one is not green (GPT Sol, plan
 *    review R4). Regenerate with `UPDATE_SMALL_TEXT=1 npx vitest run
 *    tests/minimum-text-size.test.ts`, and say in the commit why a new entry
 *    is allowed to be small.
 *
 * **Under the floor** means px under 13, or rem/em under 0.85 — 13px at the
 * 15.36px root a reader's phone was measured at, so `0.83rem` (12.75px) counts.
 * **What it cannot see**: an `em` that is big against a small parent (a
 * `0.9em` inside 12px is 10.8px), and anything sized from script. A computed
 * sweep at 390 is the check for those — plan 261021c § Stage 2.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allSheets, enclosing, stripComments } from "./helpers/stylesheets.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASELINE_FILE = path.join(ROOT, "tests/fixtures/small-text-baseline.json");

const FLOOR_PX = 13;
const FLOOR_REM = 0.85;

/** True when a bare literal like `0.72em` or `11px` is under the floor. */
function under(literal: string): boolean {
  const m = /^(\d*\.?\d+)(px|rem|em)$/i.exec(literal);
  if (!m) return false;
  const n = Number(m[1]);
  return m[2]?.toLowerCase() === "px" ? n < FLOOR_PX : n < FLOOR_REM;
}

/** The px/rem/em literals in a value, including inside `calc()`/`clamp()`/etc. */
function literals(value: string): string[] {
  return [...value.matchAll(/(?<![-\w.])(\d*\.?\d+(?:px|rem|em))\b/gi)].map((m) => m[1] ?? "");
}

/** The one supported floor spelling — merely mentioning the token is not enough. */
function takesFloor(value: string): boolean {
  return /^\s*max\(\s*var\(--text-min\)\s*,[\s\S]+\)\s*(?:!important)?\s*$/i.test(value);
}

/** True when one `font-size` value contains an under-floor literal and does not take the floor. */
function smallLiteral(value: string): boolean {
  if (takesFloor(value)) return false;
  /* This deliberately over-reports a small term inside arithmetic whose final
     result might be larger. The guard cannot evaluate CSS maths in every
     environment; asking the author to use the house floor is the safe side. */
  return literals(value.replace(/!important/i, "")).some(under);
}

/** `font: 600 0.7rem/1.2 var(--font-ui)` → `0.7rem`; a shorthand with no literal size → null. */
function shorthandSize(value: string): string | null {
  /* A `font:` shorthand necessarily has family and may have `/line-height`
     after the size, so its floor cannot occupy the whole declaration value. */
  if (/(?:^|\s)max\(\s*var\(--text-min\)\s*,/i.test(value)) return null;
  const start = value.search(/(?<![-\w.])\d*\.?\d+(?:px|rem|em)\b/i);
  if (start < 0) return null;
  /* Stop before a top-level `/` so a small length used as line-height does
     not get mistaken for the font size. A slash inside CSS maths is part of
     that size expression and stays. */
  let depth = 0;
  for (let i = start; i < value.length; i++) {
    if (value[i] === "(") depth++;
    else if (value[i] === ")") depth--;
    else if (value[i] === "/" && depth === 0) return value.slice(start, i);
  }
  return value.slice(start);
}

function sheetEntries(): string[] {
  const out: string[] = [];
  for (const s of allSheets()) {
    const css = stripComments(s.css);
    for (const m of css.matchAll(/(?<![-\w])(font-size|font)\s*:\s*([^;}]+)/g)) {
      const value = (m[2] ?? "").trim();
      const size = m[1] === "font-size" ? value : shorthandSize(value);
      if (size === null || !smallLiteral(size)) continue;
      const where = enclosing(css, m.index ?? 0)
        .reverse()
        .map((p) => p.replace(/\s+/g, " "))
        .join(" › ");
      out.push(`${s.path} › ${where} › ${m[1]}: ${value.replace(/\s+/g, " ")}`);
    }
  }
  return out.sort();
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}

/** Small arbitrary values in source: `tw:text-[length:calc(0.7rem)]` keeps its whole value. */
function smallArbitrary(text: string): string[] {
  return [...text.matchAll(/tw:text-\[([^\]]+)\]/g)]
    .map((m) => m[1] ?? "")
    .filter((value) => smallLiteral(value.replace(/^length:/, "")));
}

function tsxEntries(): string[] {
  const out: string[] = [];
  for (const file of sourceFiles(path.join(ROOT, "src/web"))) {
    for (const size of smallArbitrary(readFileSync(file, "utf8"))) {
      out.push(`${path.relative(ROOT, file)} › tw:text-[${size}]`);
    }
  }
  return out.sort();
}

function current(): string[] {
  return [...sheetEntries(), ...tsxEntries()];
}

if (process.env.UPDATE_SMALL_TEXT === "1") {
  writeFileSync(BASELINE_FILE, `${JSON.stringify(current(), null, 2)}\n`);
}

const BASELINE: string[] = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));

/** `a` minus `b`, as multisets. */
function minus(a: string[], b: string[]): string[] {
  const left = new Map<string, number>();
  for (const x of b) left.set(x, (left.get(x) ?? 0) + 1);
  return a.filter((x) => {
    const n = left.get(x) ?? 0;
    if (n === 0) return true;
    left.set(x, n - 1);
    return false;
  });
}

describe("the text floor", () => {
  it("is 0px with a mouse, and 13px growing with the root under any-pointer: coarse", () => {
    const tokens = allSheets().find((s) => s.path === "src/web/styles/tokens.css");
    expect(tokens, "tokens.css is not in the import graph").toBeDefined();
    const css = stripComments(tokens?.css ?? "");
    const where = (value: string): string[][] =>
      [...css.matchAll(new RegExp(`--text-min:\\s*${value.replace(/[()]/g, "\\$&")};`, "g"))].map((m) =>
        enclosing(css, m.index ?? 0),
      );
    expect(where("0px")).toEqual([[":root"]]);
    expect(where("max(13px, 0.8125rem)")).toEqual([[":root", "@media (any-pointer: coarse)"]]);
  });

  it("reaches tw:text-xs through Tailwind's theme", () => {
    const tw = stripComments(readFileSync(path.join(ROOT, "src/web/tailwind.css"), "utf8"));
    expect(tw).toMatch(/@theme inline \{[^}]*--text-xs:\s*max\(var\(--text-min\), 0\.75rem\);/);
  });

  it("knows a small literal from a floored or large one", () => {
    expect(smallLiteral("0.72em")).toBe(true);
    expect(smallLiteral(" 11px")).toBe(true);
    expect(smallLiteral(".58rem !important")).toBe(true);
    expect(smallLiteral("0.83rem")).toBe(true);
    expect(smallLiteral("calc(0.72em)")).toBe(true);
    expect(smallLiteral("min(var(--text-min), 0.72em)")).toBe(true);
    expect(smallLiteral("calc(max(var(--text-min), 0.72em) / 2)")).toBe(true);
    expect(smallLiteral("max(var(--text-min), 0.72em)")).toBe(false);
    expect(smallLiteral("0.85rem")).toBe(false);
    expect(smallLiteral("13px")).toBe(false);
    expect(smallLiteral("inherit")).toBe(false);
    expect(smallLiteral("var(--type-meta)")).toBe(false);
    expect(shorthandSize("600 0.7rem/1.2 var(--font-ui)")).toBe("0.7rem");
    expect(shorthandSize("inherit")).toBe(null);
  });

  it("finds sizes in both places it looks", () => {
    // Guards the scanner itself: an empty scan would pass the ratchet over nothing.
    // The stylesheets still hold small sizes (the diagrams'); TSX holds none, so
    // its scanner is checked on a sample instead.
    expect(current().some((e) => e.startsWith("src/web/styles/"))).toBe(true);
    const sample =
      '<p className="tw:text-[0.7rem] tw:text-[length:11px] tw:text-[length:calc(0.72rem)] tw:text-[0.9rem] tw:text-[length:max(var(--text-min),0.7rem)]">';
    expect(smallArbitrary(sample)).toEqual(["0.7rem", "length:11px", "length:calc(0.72rem)"]);
  });

  it("adds no small literal size that skips the floor", () => {
    expect(minus(current(), BASELINE), "use max(var(--text-min), …), or regenerate the baseline with a reason").toEqual(
      [],
    );
  });

  it("keeps the baseline tight: a floored size leaves it", () => {
    expect(minus(BASELINE, current()), "regenerate the baseline: UPDATE_SMALL_TEXT=1").toEqual([]);
  });
});
