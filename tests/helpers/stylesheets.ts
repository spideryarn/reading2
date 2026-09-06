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
 * The order matters and is preserved — but only because the graph is kept
 * **flat**, and `walk()` below now enforces that rather than assuming it. See
 * its comment: a resolver that emits a sheet at the first place it is mentioned
 * cannot be positional, and this one silently was not.
 *
 * `@import` is inlined *positionally* by the build (measured 2026-09-06 against
 * Tailwind's own `compile()` — it is not hoisted, which is what makes the
 * extraction cascade-preserving), so with a flat graph the concatenations below
 * are in the same order the browser sees.
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
 * parsed. **One relative import does carry one** — `tailwind.css`'s
 * `@import "./styles.css" layer(app)`, which is the whole mechanism that puts
 * the reading-view rules in `@layer app` (see that file's header). A second one
 * anywhere would be the bug, and
 * `tests/styles-entry-is-imports-only.test.ts` is what refuses it, in the only
 * file that could grow one.
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
 * **The only files allowed to import a sheet.** Everything else is a leaf, and
 * `walk()` throws if it is not — the constraint that makes the walk's output
 * equal the cascade rather than merely resemble it.
 *
 * Each one writes every relative import **above its own rules**, which is what
 * makes emitting an importer after the sheets it names correct. That invariant
 * is the price of admission here: check it before adding a fourth, and prefer
 * not adding one at all.
 *
 * - `src/web/tailwind.css` — one relative import, `./styles.css layer(app)`,
 *   with its own `@layer base` blocks below it.
 * - `src/web/styles.css` — nothing but imports;
 *   `tests/styles-entry-is-imports-only.test.ts` keeps it that way.
 * - `styles/tokens.css` — the brand palette, which pulls in its own
 *   `./colourscales.css` at the top before defining anything. **GPT Sol's
 *   review missed this one** and said the tree had no nested imports at all.
 */
const IMPORTERS = new Set([ENTRY, READER_ROOT, "styles/tokens.css"]);

/**
 * Depth-first from `start`, following relative `@import`s, yielding each sheet
 * in **cascade order** — which this can only do because the graph is two levels
 * deep and has no repeats, and because it now **fails loudly** rather than
 * quietly guessing when either stops being true.
 *
 * **It used to guess, and it guessed wrong.** It emitted every child before its
 * parent with one global `seen` set, so a sheet came out at the FIRST place
 * anything mentioned it and the later mention was dropped. GPT Sol appended
 * `@import "./spine.css"` to `table.css` on 2026-09-06: nineteen tests stayed
 * green while this helper hoisted Spine above Table and threw away the
 * manifest's own later Spine import — and the real build, which inlines
 * positionally, emitted Spine twice. The concatenation every migrated test
 * greps was in an order the browser never sees. The docblock above this file
 * claimed cascade order throughout.
 *
 * **So the allowlist rather than the model.** Modelling nested imports properly
 * means emitting source *chunks* at each import position and keeping a separate
 * active-recursion set for cycles — more machinery, for a shape this tree does
 * not have and does not want. A sheet under `src/web/styles/` importing a
 * sibling would put a second, invisible load order underneath the one
 * `styles.css` exists to show, which is the thing that file was split up to
 * prevent (`tests/styles-entry-is-imports-only.test.ts`). Make it an error and
 * the guess never has to be made: `IMPORTERS` above names the three files that
 * may import, and each of them puts its imports above its own rules, so
 * emitting the importer after them is right.
 *
 * Cycles cannot arise: an importer only ever names leaves.
 */
function walk(start: string): Sheet[] {
  const out: Sheet[] = [];
  const seen = new Set<string>();

  const visit = (rel: string, importedBy: string | null): void => {
    if (seen.has(rel)) {
      throw new Error(
        `${rel} is imported twice (most recently by ${importedBy}). The build inlines each ` +
          "@import where it is written, so a second import emits the whole sheet a second " +
          "time, later in the cascade — a real duplicate in the bundle, not a no-op. Import " +
          `each sheet exactly once, from ${READER_ROOT}.`,
      );
    }
    seen.add(rel);
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) {
      throw new Error(
        `${rel} is imported but does not exist. If a stylesheet moved, the import that ` +
          "names it moved with it — this walker follows the file, so nothing here needs a list.",
      );
    }
    const css = readFileSync(abs, "utf8");
    const imports = relativeImportsOf(css);
    if (imports.length > 0 && !IMPORTERS.has(rel)) {
      throw new Error(
        `${rel} has a relative @import (${imports.join(", ")}), and only ` +
          `${[...IMPORTERS].join(", ")} may have one. A sheet that imports a sibling ` +
          "creates a second load order underneath the one styles.css exists to show, and this " +
          "helper — which every migrated CSS test reads — cannot represent it. Import the " +
          `sheet from ${READER_ROOT}, at the position it belongs in the cascade.`,
      );
    }
    for (const id of imports) {
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(rel), id)), rel);
    }
    /* The importer last. Both manifest files carry imports and no cascading
       rules of their own — bar `tailwind.css`'s `@layer base` blocks, which are
       ordered by layer rather than by position, so nothing here can put them
       wrong. */
    out.push({ path: rel, css });
  };

  visit(start, null);
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
