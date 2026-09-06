/**
 * **`src/web/styles.css` is a manifest, not a stylesheet.**
 *
 * It was 15,489 lines until 2026-09-06, when it became an ordered list of 37
 * `@import`s — one per semantic sheet under `src/web/styles/`, in the order the
 * rules were in before the split, because **the import order IS the cascade
 * order** (docs/plans/260906d-make-style-ownership-visible-and-a-new-mode-fail-to-compile.md).
 *
 * The file's whole value is that it says the load order at the top, in one
 * screen. A rule written into it takes that away: the reader can no longer see
 * the order without scrolling past whatever was added, and the next person adds
 * theirs below that.
 *
 * **This checks the top-level NODES, not "does it contain a style rule."** The
 * weaker version passes an `@media` or `@supports` block dropped between two
 * imports, which is exactly the shape somebody reaches for when they want "just
 * one small responsive tweak here" — and it carries rules inside it. GPT Sol,
 * reviewing the plan, 2026-09-06.
 *
 * ## What this is NOT about
 *
 * It is **not** portability to a plain, spec-conformant CSS pipeline, and an
 * earlier draft of the plan claimed it was. Under the CSS specification an
 * `@import` following any style rule is invalid and dropped — but Tailwind
 * inlines it *positionally* instead (measured 2026-09-06 against Tailwind's own
 * `compile()`), so under the pipeline we actually run, a late import is not a
 * correctness bug. And the tree is not portable anyway: `tailwind.css` already
 * places `@custom-variant` rules before its own `@import "./styles.css"`.
 *
 * So this guard is about **ownership and a visible load order**, which is worth
 * having on its own. Changing bundlers is a separate import-prelude review.
 */

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ENTRY = "src/web/styles.css";
const css = readFileSync(ENTRY, "utf8");

/**
 * The top-level nodes, with comments and whitespace removed.
 *
 * A hand scan rather than a CSS parser: the file is meant to be trivial, and a
 * parser dependency to check that a file stayed trivial is the wrong trade. If
 * this ever needs one, the file has stopped being a manifest.
 */
function topLevelNodes(source: string): string[] {
  const nodes: string[] = [];
  let buf = "";
  let depth = 0;
  let inComment = false;
  let inString: string | null = null;

  for (let i = 0; i < source.length; i++) {
    const two = source.slice(i, i + 2);
    if (inComment) {
      if (two === "*/") {
        inComment = false;
        i++;
      }
      continue;
    }
    const ch = source[i] as string;
    if (inString) {
      buf += ch;
      if (ch === "\\") {
        buf += source[i + 1] ?? "";
        i++;
      } else if (ch === inString) inString = null;
      continue;
    }
    if (two === "/*") {
      inComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      buf += ch;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        nodes.push(`${buf}{…}`.trim());
        buf = "";
        continue;
      }
    }
    if (ch === ";" && depth === 0) {
      nodes.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail !== "") nodes.push(tail);
  return nodes.filter((n) => n !== "");
}

/**
 * The brand palette, which has to be the first node in the file.
 *
 * `styles/tokens.css` (the brand palette, shared with nothing else) is a
 * different file from `styles/tokens.css` under `src/web/` (the semantic layer
 * over it). The brand one has to come first or the semantic layer reads names
 * nothing has defined yet.
 */
const BRAND_TOKENS = '@import "../../styles/tokens.css"';

/**
 * **The sheets, in the order they load — written out here, by hand, on
 * purpose.**
 *
 * This list is the expectation; `src/web/styles.css` is the implementation. It
 * used to be neither: the check read the directory and sorted both sides, so
 * **import order was not checked at all**. GPT Sol moved `glossary.css` below
 * `timeline.css` and `debate.css` on 2026-09-06 and every test here stayed
 * green — reversing the equal-specificity `.gloss-quiet` / `.tl-thin` /
 * `.dbt-empty` overrides and silently breaking the phone layout's padding.
 *
 * **The order IS the cascade**, so it needs an independent witness rather than
 * a restatement of the thing it is meant to witness. Sorted directory contents
 * agree with any permutation.
 *
 * Adding a sheet therefore means a deliberate edit here, at a chosen position.
 * That is the cost and it is the point: choosing where a sheet lands in the
 * cascade is a decision, and it should be made once, visibly, by a person.
 */
const MANIFEST = [
  "tokens.css",
  "shell.css",
  "table.css",
  "prose.css",
  "spine.css",
  "tooltip.css",
  "annotations.css",
  "column-context.css",
  "dock.css",
  "design-page.css",
  "mode-band.css",
  "glossary.css",
  "prose-hover-card.css",
  "footnotes.css",
  "dock-fit.css",
  "search.css",
  "referee.css",
  "summary.css",
  "chat-actions.css",
  "touch.css",
  "profile.css",
  "diagram.css",
  "dialogs.css",
  "gutter.css",
  "ideas.css",
  "diagram-sketch.css",
  "diagram-illustrated.css",
  "diagram-drift.css",
  "narrow-window.css",
  "lightbox.css",
  "outline-mode.css",
  "quotes.css",
  "timeline.css",
  "debate.css",
  "quiz.css",
  "feedback.css",
  "site.css",
];

/**
 * The one shape a sheet import may take: bare, relative, `./styles/`, `.css`.
 *
 * **No trailing qualifier, and that is the whole of it.** `@import` takes a
 * media query, a `layer()`, a `supports()` — and every one of them is a way to
 * make a whole sheet apply somewhere it was never meant to, from a line that
 * still reads as an ordinary import. Sol added `@import "./styles/table.css"
 * print;` and every guard here stayed green while **every table rule in the app
 * became print-only**.
 *
 * The layer is inherited from `tailwind.css`'s single `@import "./styles.css"
 * layer(app)` (see that file's header); a second one written here would be the
 * bug, not the fix.
 */
const SHEET_IMPORT = /^@import "\.\/styles\/([a-z0-9-]+\.css)"$/;

describe("the stylesheet entry point is an import manifest", () => {
  const nodes = topLevelNodes(css);

  it("has nodes to check", () => {
    /* The vacuity guard. A scanner that finds nothing agrees with every
       assertion below, and would do so most loudly on the day somebody empties
       this file. */
    expect(nodes.length, `no top-level nodes parsed out of ${ENTRY} — the scanner is broken`)
      .toBeGreaterThan(30);
  });

  it("contains nothing but the two shapes of import it is allowed", () => {
    /* `startsWith("@import")` was the check until 2026-09-06, and it is not one:
       it accepts a typo (`@important;` starts with `@import`), an external
       `@import "https://…"`, a path outside `src/web/styles/` that no
       `readerCss()` test would ever read, and any qualifier at all. Sol landed
       all four at once and nothing here noticed. Exact shapes instead — an
       allowlist, so the failure mode of a new syntax is a red test rather than
       a silent hole. */
    const strays = nodes.filter(
      (n, i) => !(i === 0 ? n === BRAND_TOKENS : SHEET_IMPORT.test(n)),
    );
    expect(
      strays,
      `${ENTRY} is the map of the cascade and must stay readable in one screen. Every node ` +
        `after the first has to be exactly \`@import "./styles/<sheet>.css";\` — no media ` +
        "query, no layer(), no supports(), no other path — and the first has to be " +
        `\`${BRAND_TOKENS};\`. Put the rule in the sheet that owns it under src/web/styles/, ` +
        "or add a new sheet, import it at the right position and name it in MANIFEST above — " +
        "the position IS the cascade order. See docs/project/design-css-overview.md.",
    ).toEqual([]);
  });

  it("imports the brand tokens before any of the reading-view sheets", () => {
    expect(nodes[0], "the first import is no longer the brand palette").toBe(BRAND_TOKENS);
  });

  it("loads the sheets in exactly the order MANIFEST gives", () => {
    const imported = nodes
      .map((n) => SHEET_IMPORT.exec(n)?.[1])
      .filter((v): v is string => v !== undefined);

    expect(
      imported,
      "the load order in styles.css no longer matches MANIFEST in this file. The order IS the " +
        "cascade: two sheets of equal specificity are decided by which loaded second. If the " +
        "move was deliberate, say so by editing MANIFEST — and check what the sheets either " +
        "side of the new position override.",
    ).toEqual(MANIFEST);
  });

  it("imports every sheet that exists under src/web/styles/, and nothing that does not", () => {
    /* The other direction, and the one MANIFEST cannot give on its own: read the
       directory, because a sheet added to the folder and never imported is dead
       CSS that nobody notices. Sorted, deliberately — order is the assertion
       above's job, and this one is about existence. */
    const present = readdirSync("src/web/styles")
      .filter((f) => f.endsWith(".css"))
      .sort();

    expect(
      [...MANIFEST].sort(),
      "every .css under src/web/styles/ must be named by MANIFEST exactly once — an " +
        "unimported sheet is dead, and an import with no file behind it fails the build",
    ).toEqual(present);
  });
});
