/**
 * Reader-facing words about how long a thorough (meaning) search takes.
 * Measured in production: median 9 s, 90th centile about 20 s, so "about half
 * a minute" overstated it. docs/plans/261005h-*.md, item A.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("thorough search duration copy", () => {
  it("the thorough button title says about ten seconds", () => {
    const src = read("src/web/SearchPanel.tsx");
    const line = src.split("\n").find((l) => l.includes("Run the thorough (meaning) search"));
    expect(line).toBeDefined();
    expect(line).not.toContain("half a minute");
    expect(line).toContain("ten seconds");
  });

  it("the /help Search section says about ten seconds", () => {
    /* The file as written, with its line breaks taken out: Help's words are
       Markdown since 2026-10-07 and a sentence wraps where the file wraps. */
    const src = read("src/web/help/pages/modes/search.md").replace(/\s+/g, " ");
    const i = src.indexOf("on a quick search runs the full meaning search");
    expect(i).toBeGreaterThan(-1);
    const passage = src.slice(i, i + 200);
    expect(passage).not.toContain("half a minute");
    expect(passage).toContain("ten seconds");
  });
});
