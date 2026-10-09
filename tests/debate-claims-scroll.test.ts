/**
 * **Debate's claims list scrolls inside the band** — the half of that a test
 * can reach.
 *
 * Measured in Chrome on 2026-10-09 (261008i's browser check): at 1440 × 900 the
 * band held 1,226px of Claims in an 816px box, so the claims past the fifth,
 * the "Check a claim of your own" box and the Check button were below the dock
 * and unreachable. `.mode-band` is fixed with `overflow: visible`, so nothing
 * clipped it or said so. `.dbt-listed-wrap`, the list's wrapper, had no rule
 * at all; `.dbt-scroll` beside it has the rule that fixes exactly this
 * (debate.css § the scroller).
 *
 * jsdom has no layout, so this reads the stylesheet: the wrapper must be the
 * flex child that gives way and scrolls. tests/referee-band-fits.test.ts says
 * why a measurement here would be green before the fix.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/web/styles/debate.css", import.meta.url), "utf8");

function ruleFor(selector: string): string {
  const at = css.search(new RegExp(`(^|[\\s,}])${selector.replace(".", "\\.")}\\s*[,{]`, "m"));
  if (at < 0) return "";
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

describe("the claims list's wrapper", () => {
  it("scrolls inside the band, as Reception's list does", () => {
    const rule = ruleFor(".dbt-listed-wrap");
    expect(rule).toMatch(/overflow-y:\s*auto/);
    expect(rule).toMatch(/min-height:\s*0/);
    expect(rule).toMatch(/flex:\s*1/);
  });
});
