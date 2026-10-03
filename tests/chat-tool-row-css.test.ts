/**
 * **A tool row's long detail gives way before its label does.**
 * `.chat-tool*` in src/web/styles/mode-band.css, drawn by `ToolStrip` in
 * ChatPanel.tsx and by CandidatesPanel.tsx.
 *
 * The browser check of 2026-10-03 had a row reading "pointed at" followed by
 * eight block ids, and the label was drawn one character per line. The detail
 * was `flex: none`, so it kept its whole unwrapped width; the label beside it
 * was `min-width: 0` with `overflow-wrap: anywhere`, so it was the only thing
 * in the row that could shrink, and it shrank to one character wide.
 *
 * jsdom lays nothing out, so this cannot measure the row. It holds the three
 * declarations the fix is made of, read out of the stylesheet by hand as
 * tests/voices-css.test.ts does, so that putting `flex: none` back is a red
 * test rather than a screenshot somebody has to notice.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const CSS = readFileSync("src/web/styles/mode-band.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the one rule whose selector is exactly `selector`. */
function declarations(selector: string): Map<string, string> {
  const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1]!.trim() === selector);
  if (rules.length !== 1) throw new Error(`expected one \`${selector}\` rule in mode-band.css, found ${rules.length}`);
  const out = new Map<string, string>();
  for (const line of rules[0]![2]!.split(";")) {
    const at = line.indexOf(":");
    if (at > 0) out.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return out;
}

/** `flex: <grow> <shrink> <basis>`, the only form these two rules use. */
function shrinkOf(rule: Map<string, string>): number {
  const flex = rule.get("flex") ?? "";
  const parts = flex.split(/\s+/);
  if (parts.length !== 3) throw new Error(`expected a three-value flex, got "${flex}"`);
  return Number(parts[1]);
}

describe("a tool row in the chat thread", () => {
  const label = declarations(".chat-tool-label");
  const detail = declarations(".chat-tool-detail");

  it("lets the detail shrink, and long before the label", () => {
    expect(detail.get("flex")).not.toBe("none");
    expect(shrinkOf(detail)).toBeGreaterThan(0);
    /* Far more, not merely more: free space is taken in proportion to
       shrink × width, and the label must lose none of it while the detail
       still has some to give. */
    expect(shrinkOf(detail)).toBeGreaterThanOrEqual(shrinkOf(label) * 1000);
  });

  it("wraps the detail inside the width it is left, with a floor so it is never a column of letters itself", () => {
    expect(detail.get("overflow-wrap")).toBe("anywhere");
    expect(detail.get("min-width")).toMatch(/^\d+(\.\d+)?em$/);
  });

  it("still lets a long label wrap rather than push the panel wider", () => {
    expect(label.get("min-width")).toBe("0");
    expect(label.get("overflow-wrap")).toBe("anywhere");
  });
});
