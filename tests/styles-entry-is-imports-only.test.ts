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

describe("the stylesheet entry point is an import manifest", () => {
  const nodes = topLevelNodes(css);

  it("has nodes to check", () => {
    /* The vacuity guard. A scanner that finds nothing agrees with every
       assertion below, and would do so most loudly on the day somebody empties
       this file. */
    expect(nodes.length, `no top-level nodes parsed out of ${ENTRY} — the scanner is broken`)
      .toBeGreaterThan(30);
  });

  it("contains nothing but @import", () => {
    const strays = nodes.filter((n) => !n.startsWith("@import"));
    expect(
      strays,
      `${ENTRY} is the map of the cascade and must stay readable in one screen: every ` +
        "top-level node has to be an @import. Put the rule in the sheet that owns it under " +
        "src/web/styles/, or add a new sheet and import it at the right position — the position " +
        "IS the cascade order. See docs/project/design-css-overview.md.",
    ).toEqual([]);
  });

  it("imports the brand tokens before any of the reading-view sheets", () => {
    /* `styles/tokens.css` (the brand palette, shared with nothing else) is a
       different file from `styles/tokens.css` under src/web/ (the semantic layer
       over it). The brand one has to come first or the semantic layer reads
       names nothing has defined yet. */
    const first = nodes[0];
    expect(first, "the first import is no longer the brand palette").toBe(
      '@import "../../styles/tokens.css"',
    );
  });

  it("imports every sheet that exists under src/web/styles/, and nothing that does not", () => {
    const imported = nodes
      .map((n) => /^@import\s+["'](\.\/styles\/[^"']+)["']/.exec(n)?.[1])
      .filter((v): v is string => v !== undefined)
      .map((v) => v.replace("./styles/", ""));

    /* Read the directory rather than repeating the list: a sheet added to the
       folder and never imported is dead CSS that nobody notices, and that is the
       failure this direction catches. */
    const present = readdirSync("src/web/styles")
      .filter((f) => f.endsWith(".css"))
      .sort();

    expect(
      [...imported].sort(),
      "every .css under src/web/styles/ must be imported by styles.css exactly once — an " +
        "unimported sheet is dead, and an import with no file behind it fails the build",
    ).toEqual(present);
  });
});
