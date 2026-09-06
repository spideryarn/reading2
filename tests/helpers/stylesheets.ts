/**
 * **The stylesheets the client loads, resolved from the `@import` graph rather
 * than named one by one.**
 *
 * Written on 2026-09-06, when `src/web/styles.css` stopped being a
 * 15,489-line file and became an ordered list of `@import`s
 * (docs/plans/260906d-make-style-ownership-visible-and-a-new-mode-fail-to-compile.md).
 * Thirteen tests read that one path and grepped it for a rule, so every one of
 * them broke the moment a rule moved into a sibling file — and several would
 * have gone **green over nothing** instead, because a regex that stops matching
 * looks exactly like a rule that is correct. That is the
 * [silent-success](../../docs/reusable/silent-success.md) shape, and it is the
 * whole reason this file exists rather than a longer list of paths.
 *
 * The rule for a test author: **ask for the set you mean, never for a file.**
 * `readerCss()` is what "the hand-written reading-view rules" means today and
 * will go on meaning after the next split.
 *
 * The order matters and is preserved. `@import` is inlined *positionally* by
 * the build (measured 2026-09-06 against Tailwind's own `compile()` — it is not
 * hoisted, which is what makes the extraction cascade-preserving), so the
 * concatenations below are in the same order the browser sees.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** The one file `main.tsx` imports. Everything else hangs off it. */
export const ENTRY = "src/web/tailwind.css";

/** The former contents of `styles.css`, rooted at the file that still names them. */
const READER_ROOT = "src/web/styles.css";

export interface Sheet {
  /** Repo-relative, with forward slashes, as a test would write it. */
  path: string;
  css: string;
}

/**
 * The relative `@import`s in one sheet, in written order.
 *
 * **Relative only.** `@import "tailwindcss/theme.css"` and the three
 * `@fontsource-variable/…` lines are packages; following them would drag
 * Tailwind's own generated theme into every grep and make a test that looks for
 * `--color-…` match something nobody in this repo wrote.
 *
 * The `layer(...)`/`prefix(...)`/`source(...)` suffixes are ignored rather than
 * parsed: no relative import in this tree carries one, because the layer is
 * inherited from `tailwind.css`'s single `layer(app)` and adding a second would
 * be the bug (see that file's header).
 */
function relativeImportsOf(css: string): string[] {
  const found: string[] = [];
  for (const m of css.matchAll(/^\s*@import\s+["']([^"']+)["']/gm)) {
    const id = m[1];
    if (id?.startsWith(".")) found.push(id);
  }
  return found;
}

/**
 * Depth-first from `start`, following relative `@import`s, yielding each sheet
 * **at the position its rules land in the cascade** — a sheet's imports come
 * before its own rules only where they are written before them, which for every
 * file in this tree they are.
 *
 * Cycles would hang a naive walk; CSS permits them and would simply ignore the
 * second visit, so `seen` does the same.
 */
function walk(start: string): Sheet[] {
  const out: Sheet[] = [];
  const seen = new Set<string>();

  const visit = (rel: string): void => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) {
      throw new Error(
        `${rel} is imported but does not exist. If a stylesheet moved, the import that ` +
          "names it moved with it — this walker follows the file, so nothing here needs a list.",
      );
    }
    const css = readFileSync(abs, "utf8");
    for (const id of relativeImportsOf(css)) {
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(rel), id)));
    }
    out.push({ path: rel, css });
  };

  visit(start);
  return out;
}

/**
 * **Every sheet the client loads**, in cascade order: `tailwind.css`, the
 * reading-view sheets beneath it, and the two under `styles/`.
 *
 * For a test that asks a question about *all* the CSS — that no sheet reads a
 * custom property nothing defines, say. `tests/css-tokens.test.ts` is the
 * caller this was shaped for; it named four paths by hand before.
 */
export function allSheets(): Sheet[] {
  return walk(ENTRY);
}

/**
 * **The hand-written reading-view rules**, and nothing else — the set that used
 * to be exactly `src/web/styles.css`.
 *
 * Restricted to `src/web/`, which deliberately leaves out `styles/tokens.css`
 * and `styles/colourscales.css`. Those are the brand palette, they were always
 * separate files, and the tests that grep for a rule never read them. Including
 * them would add `:root` blocks to every search and change what a dozen
 * existing assertions match, which is precisely the silent change this helper
 * was introduced to avoid.
 */
export function readerSheets(): Sheet[] {
  return walk(READER_ROOT).filter((s) => s.path.startsWith("src/web/"));
}

/** `readerSheets()` concatenated, in cascade order. */
export function readerCss(): string {
  return readerSheets()
    .map((s) => s.css)
    .join("\n");
}

/**
 * Comments stripped.
 *
 * Prose *about* a rule is not a rule, and this file is mostly prose — every
 * grep in the suite that did this for itself had the same reason: a class name
 * mentioned in a comment would otherwise answer a question about the cascade.
 */
export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** `readerCss()` with comments stripped — what most callers actually want. */
export function readerCssNoComments(): string {
  return stripComments(readerCss());
}
