/**
 * **The rail stops at the bottom bar, not behind it.**
 *
 * Until 2026-10-22 `.spine` ended at `--safe-bottom` alone, and the dock
 * (z-index 96, over the rail's 45) covered its last 40-odd pixels: the end of
 * every article, and the on-screen band whenever the reader was there
 * (plan 261022c, found on the browser pass for spya-wzssyu). jsdom does no
 * layout, so what this can pin is that the rail's bottom edge is the one the
 * mode band already stops at — the shared formula that follows the bar down
 * when it slides away — rather than a number of its own.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const BAR_EDGE = "calc(max(var(--dock-bottom), var(--safe-bottom)) + var(--hint-now))";

function bottomOf(file: string, selector: string): string | undefined {
  const css = readFileSync(file, "utf8");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? "";
  // The last `bottom:` declaration in the rule, comments stripped.
  const decls = rule.replace(/\/\*[\s\S]*?\*\//g, "").match(/(?:^|[;\s])bottom:\s*([^;]+);/g) ?? [];
  return decls.at(-1)?.replace(/^[;\s]*bottom:\s*/, "").replace(/;$/, "").trim();
}

describe("the rail's foot", () => {
  it("is the mode band's: clear of the bottom bar, following it when it hides", () => {
    expect(bottomOf("src/web/styles/mode-band.css", ".mode-band"), "the formula this mirrors").toBe(
      BAR_EDGE,
    );
    expect(bottomOf("src/web/styles/spine.css", ".spine")).toBe(BAR_EDGE);
  });
});

describe("the viewport lens's minimum height", () => {
  it("keeps the veil's opening equal to the bordered viewport in every contrast mode", () => {
    const css = readFileSync("src/web/styles/spine.css", "utf8");

    /* The ordinary 1px top and bottom edges need 2px; increased contrast makes
       both edges 2px, so a floor smaller than 4px cannot contain them. One
       custom property must drive both boxes or the veil can close inside the
       orange border on an article long enough for the percentage to be tiny. */
    expect(css).toMatch(/\.spine\s*{[^}]*--spine-view-floor:\s*2px;/s);
    expect(css).toMatch(/\.spine-viewport\s*{[^}]*min-height:\s*var\(--spine-view-floor\);/s);
    expect(css).toMatch(
      /\.spine-veil-track::after\s*{[^}]*top:\s*max\(var\(--view-h\),\s*var\(--spine-view-floor\)\);/s,
    );
    expect(css).toMatch(
      /@media \(prefers-contrast: more\)\s*{[^}]*\.spine\s*{[^}]*--spine-view-floor:\s*4px;/s,
    );
  });
});
