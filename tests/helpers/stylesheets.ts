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
 * will go on meaning after the next split. It returns the resolved contents,
 * not the import statements whose targets the walker has already inserted.
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

/**
 * **The one hand-written sheet in a layer above the utilities**, imported from
 * `ENTRY` as `layer(tone)` rather than from `styles.css` (plan 261020z; the
 * note above its import in tailwind.css). It is part of the reading view's
 * cascade, and the last of it.
 */
export const TONE_SHEET = "src/web/button-tone.css";

/**
 * **The per-voice faces, in a layer of their own between `app` and the
 * utilities**, imported from `ENTRY` as `layer(voices)` (plan 261025k § 2; the
 * note above its import in tailwind.css). After every app sheet, before tone.
 */
export const VOICES_SHEET = "src/web/voices.css";

/**
 * The cascade layer a reading-view sheet lands in, from `tailwind.css`'s
 * `@layer theme, base, app, voices, utilities, tone;`. The utilities sit
 * between `voices` and `tone` but are generated, so no hand-written sheet is
 * in that layer.
 */
export type ReaderLayer = "app" | "voices" | "tone";

export interface ReaderSheet extends Sheet {
  layer: ReaderLayer;
}

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
 * parsed. **Three relative imports do carry one**, all in `tailwind.css`:
 * `@import "./styles.css" layer(app)`, which is the whole mechanism that puts
 * the reading-view rules in `@layer app` (see that file's header),
 * `@import "./voices.css" layer(voices)`, the per-voice faces just above it,
 * and `@import "./button-tone.css" layer(tone)`, the one sheet above the
 * utilities. A fourth anywhere would be the bug, and
 * `tests/styles-entry-is-imports-only.test.ts` is what refuses it.
 */
/**
 * **Both spellings, because CSS has two and the ban is only worth what it
 * cannot be spelled around.**
 *
 * This matched `@import "…"` alone until GPT Sol's F23. `@import url("./x.css")`
 * is the same import to every real processor, and it was invisible here — so a
 * sheet could import another sheet, and both the leaf prohibition below and the
 * duplicate-visit check would pass while the cascade quietly gained a second
 * copy. A guard that only sees the spelling nobody was going to use anyway is
 * not a guard. The unquoted `url(./x.css)` is legal too, so it is here as well.
 */
function relativeImportsOf(css: string): string[] {
  const found: string[] = [];
  const IMPORT =
    /^\s*@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)|"([^"]*)"|'([^']*)')/gm;
  for (const m of css.matchAll(IMPORT)) {
    const id = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
    if (id?.startsWith(".")) found.push(id);
  }
  return found;
}

/**
 * **The 37 sheets the split created, which are leaves and must stay leaves.**
 *
 * Each is a contiguous slice of what was one 15,489-line file, and none imports
 * anything. A relative `@import` appearing in one of them is the hazard `walk()`
 * describes: a second, invisible load order underneath the one `styles.css`
 * exists to show, which is the thing that file was split up to prevent
 * (`tests/styles-entry-is-imports-only.test.ts`).
 *
 * Deliberately **not** a ban on nested imports generally. The repo-root
 * `styles/tokens.css` imports `./colourscales.css`, that chain predates all of
 * this, and `allSheets()` must go on resolving it —
 * design-css-overview.md's load-order table, rows 4 and 5. GPT Sol's review said
 * the tree had no nested imports at all; it has that one.
 */
const LEAF_DIR = "src/web/styles/";

/**
 * Depth-first from `start`, following relative `@import`s, yielding each sheet
 * in **cascade order** — which this can only do because the graph has no repeats
 * and no importer below `styles.css`, and because it now **fails loudly** rather
 * than quietly guessing when either stops being true.
 *
 * **It used to guess, and it guessed wrong.** It emitted every child before its
 * parent with one global `seen` set, so a sheet came out at the FIRST place
 * anything mentioned it and the later mention was dropped. GPT Sol appended
 * `@import "./spine.css"` to `table.css` on 2026-09-06: nineteen tests stayed
 * green while this helper hoisted Spine above Table and threw away the
 * manifest's own later Spine import — and the real build, which inlines
 * positionally, emitted Spine twice. The concatenation every migrated test
 * greps was in an order the browser never sees, and this file's own header
 * claimed cascade order throughout.
 *
 * **Two constraints rather than a model.** Modelling nested imports properly
 * means emitting source *chunks* at each import position and keeping a separate
 * active-recursion set for cycles — more machinery, for a shape this tree does
 * not have and does not want. Instead:
 *
 *   1. **no relative import inside `src/web/styles/`** (`LEAF_DIR` above), the
 *      hazard Sol demonstrated and the one place a sheet has no business
 *      importing anything;
 *   2. **no file visited twice**, anywhere, because the build would emit it
 *      twice and this walk can only emit it once.
 *
 * What that leaves is a chain of importers — `tailwind.css` →
 * `src/web/styles.css` → `styles/tokens.css` → `colourscales.css` — and every
 * one of them writes its imports **above its own rules**, so emitting an
 * importer after the sheets it names is right. That last part is an invariant
 * this walk relies on rather than checks; the files are three, and each says so
 * in its own header.
 *
 * Cycles cannot arise while (2) holds: the second visit throws instead.
 */
function walk(start: string): Sheet[] {
  const out: Sheet[] = [];
  const seen = new Set<string>();

  const visit = (rel: string, importedBy: string | null): void => {
    if (seen.has(rel)) {
      throw new Error(
        `${rel} is imported twice (most recently by ${importedBy}). The build inlines each ` +
          "@import where it is written, so a second import emits the whole sheet a second " +
          "time, later in the cascade — a real duplicate in the bundle, not a no-op, and this " +
          "helper can only put it in one place. Import each sheet exactly once.",
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
    if (imports.length > 0 && rel.startsWith(LEAF_DIR)) {
      throw new Error(
        `${rel} has a relative @import (${imports.join(", ")}), and a sheet under ${LEAF_DIR} ` +
          `may not have one. Those 37 files are leaves: ${READER_ROOT} is the single visible ` +
          "statement of what loads in what order, and an import down here puts a second order " +
          "underneath it that nobody reading that file can see — the build would inline the " +
          "sheet at BOTH positions. Import it from " +
          `${READER_ROOT} instead, at the position it belongs in the cascade. (The nested ` +
          "import in the repo-root styles/tokens.css is a different thing and is fine.)",
      );
    }
    for (const id of imports) {
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(rel), id)), rel);
    }
    /* The importer last, which is right because every importer in this tree
       writes its imports above its own rules — see the note above. */
    out.push({ path: rel, css });
  };

  visit(start, null);
  return out;
}

/**
 * **Every sheet the client loads**, in cascade order: the two under `styles/`,
 * the reading-view sheets, the voices sheet, the tone sheet and `tailwind.css`.
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
export function readerSheets(): ReaderSheet[] {
  const inLayer = (layer: ReaderLayer, sheets: Sheet[]): ReaderSheet[] =>
    sheets.filter((s) => s.path.startsWith("src/web/")).map((s) => ({ ...s, layer }));
  return [
    ...inLayer("app", walk(READER_ROOT)),
    ...inLayer("voices", walk(VOICES_SHEET)),
    ...inLayer("tone", walk(TONE_SHEET)),
  ];
}

/** A rule's selector and its declarations, innermost rules only. Give it comment-stripped CSS. */
const RULE = /([^{}]+)\{([^{}]*)\}/g;

/** One declaration's `property: value` inside a rule body. */
const DECLARATION = /(?:^|;)\s*([a-z-]+)\s*:\s*([^;]+?)\s*(?=;|$)/g;

/** Five ids' weight that matches every element: `:not(#x)` weighs one id. */
const LAYER_WEIGHT = ":not(#jsdom-voices-layer)".repeat(5);

/**
 * **One reader sheet's text for a `<style>` in jsdom, with the `voices` layer
 * emulated.**
 *
 * jsdom implements no cascade layers: it drops an `@layer {…}` block's contents
 * outright, and it decides between two rules by specificity and then order
 * (jsdom 29.1.1, `living/css/helpers/computed-style.js`, read 2026-10-25). Fed
 * `readerSheets()` as written, it lets every app rule that sets a face beat a
 * voice, because every voice rule is `:where(…)` and weighs nothing — the
 * opposite of the browser, where the later layer wins whatever the weights.
 *
 * So each voices rule goes in with five ids' weight in front of its `:where(…)`,
 * as `:not(#…)` five times, which matches everything. That beats any app rule
 * without ids, and the voices rules all weigh the same, so among them order
 * decides: both halves of what the layer does. `!important` would be the
 * obvious stand-in and does not work: jsdom drops the priority from a value
 * that is a `var()`, and every face here is one (measured the same day).
 *
 * The stand-in is right only while nothing it cannot see is in play, so it
 * **throws** rather than guesses when a sheet in another layer declares one of
 * the voices' properties `!important` (the browser would let that beat a
 * voice), under a selector with an id (it might outweigh the stand-in), or in
 * `tone` at all (the browser puts tone over a voice; here it would lose).
 */
export function cssForJsdom(sheet: ReaderSheet): string {
  if (sheet.layer !== "voices") return sheet.css;
  const css = stripComments(sheet.css);
  const declared = (body: string) => [...body.matchAll(DECLARATION)].map((d) => d);
  const voiced = new Set([...css.matchAll(RULE)].flatMap((r) => declared(r[2]!).map((d) => d[1]!)));
  for (const other of readerSheets()) {
    if (other.layer === "voices") continue;
    for (const [, selector, body] of stripComments(other.css).matchAll(RULE)) {
      for (const [, property, value] of declared(body!)) {
        if (!voiced.has(property!)) continue;
        if (other.layer === "tone" || /!important$/.test(value!) || selector!.includes("#")) {
          throw new Error(
            `${other.path} declares \`${selector!.trim()} { ${property}: ${value} }\`, which ` +
              "cssForJsdom cannot place against the voices layer: its stand-in for that layer is " +
              "right only while no other sheet declares a voices property !important or under an " +
              "id, and the tone sheet declares none.",
          );
        }
      }
    }
  }
  return css.replace(/(^|\})(\s*):where\(/g, `$1$2${LAYER_WEIGHT}:where(`);
}

/** `readerSheets()` concatenated, in cascade order. */
export function readerCss(): string {
  return readerSheets()
    /* `walk()` has already resolved these edges. Leaving the written imports
       in the concatenation is not merely redundant: an imports-only sheet
       immediately before a rule makes a naive `selector { … }` scanner read
       all of its `@import` text as part of that selector. Several tests use
       exactly that deliberately small scanner. The built CSS contains the
       imported rules here, not the import statements, so remove them once in
       the shared helper instead of teaching every consumer the same repair. */
    .map((s) => s.css.replace(/^\s*@import\s+[^;]+;\s*$/gm, ""))
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

/**
 * **The body of one `@media <query> { … }` block, chosen by what is inside it.**
 *
 * Two things here are the point rather than plumbing, and both were bought by a
 * check that could not fail for the reason it gave.
 *
 * **Braces are counted**, because a lazy `\{([\s\S]*?)\}` stops at the first
 * nested rule's `}` and hands back a fragment — every assertion against it then
 * passes or fails on a third of the block, with nothing to say which.
 *
 * **And the block is found by `mustContain`**, not by being the first match:
 * the reading-view sheets have several `@media (hover: none)` blocks and, since
 * 2026-09-08, several `(hover: hover)` ones, and reading the wrong one is a test
 * that is green about somebody else's rules.
 *
 * Shared rather than copied because two files now ask this question —
 * `gutter-target-size` and `gutter-touch-contrast` — and a subtle helper in two
 * places drifts in one of them.
 */
export function mediaBlock(css: string, query: string, mustContain: string): string {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const m of css.matchAll(new RegExp(`@media ${escaped}`, "g"))) {
    const open = css.indexOf("{", m.index);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) {
        const body = css.slice(open + 1, i);
        if (body.includes(mustContain)) return body;
        break;
      }
    }
  }
  throw new Error(`no \`@media ${query}\` block containing \`${mustContain}\``);
}

/**
 * The at-rule preludes enclosing `index`, innermost first, plus the rule's own
 * selector at position 0.
 *
 * Walks backwards counting braces rather than parsing: an unmatched `{` seen
 * from inside is an enclosing block, and the text back to the previous `}`,
 * `{` or `;` is its prelude. Give it comment-stripped CSS.
 *
 * Here since 2026-10-03, from tests/spine-width.test.ts, when
 * tests/crumbs-narrow.test.ts became the second file to ask it.
 */
export function enclosing(source: string, index: number): string[] {
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
