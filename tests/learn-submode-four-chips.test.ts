import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * Layout cannot go red in jsdom. This only pins the four-chip rule's shape in
 * quiz.css: tight only in a narrow band head (an iPad's 288px band), the shared
 * part-switcher padding everywhere else. The real check is the browser probe
 * (Playwright at 1440, 1024, 820 and 390), whose numbers are in plan 261007h
 * § What landed, F2; plan 261005h item B measured the first version.
 */
const css = readFileSync(new URL("../src/web/styles/quiz.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);
const FOUR = /\.learn-submode:has\(> \.learn-submode-btn:nth-child\(4\)\) > \.learn-submode-btn\s*\{[^}]*padding-inline:\s*0\.25rem/;

describe("Learn's four chips", () => {
  it("tighten their padding only when the group holds four, and only in a narrow head", () => {
    const query = css.match(/@container\s+learn-head\s+\(max-width:\s*([\d.]+)rem\)\s*\{([\s\S]*?)\n\}/);
    expect(query, "the four-chip rule sits in a width query on the head").not.toBeNull();
    expect(query?.[2]).toMatch(FOUR);
    // The head is the container the query asks about.
    expect(css).toMatch(/\.band-head:has\(> \.learn-submode\)\s*\{[^}]*container:\s*learn-head\s*\/\s*inline-size/);
  });

  it("is not tight anywhere outside that query", () => {
    const outside = css.replace(/@container[^{]*\{[\s\S]*?\n\}/g, "");
    expect(outside).not.toMatch(FOUR);
  });
});
