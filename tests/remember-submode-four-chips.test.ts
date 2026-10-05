import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * Layout cannot go red in jsdom. This only pins that the four-chip rule is still
 * in quiz.css; the real check is the browser probe (Playwright at 768 and 820
 * with the bin present), whose before and after numbers are in the plan,
 * docs/plans/261005h-five-small-ui-fixes-from-the-queue-*.md § What was built, item B.
 */
const css = readFileSync(new URL("../src/web/styles/quiz.css", import.meta.url), "utf8");

describe("Remember's four chips", () => {
  it("tighten their padding only when the group holds four", () => {
    expect(css).toMatch(
      /\.remember-submode:has\(> \.remember-submode-btn:nth-child\(4\)\) > \.remember-submode-btn\s*\{[^}]*padding-inline:\s*0\.25rem/,
    );
  });
});
