/**
 * **The bar's order is Greg's**, and one piece of it is pinned here: Quotes
 * and then Trajectory straight after Summary, ahead of Glossary. Greg,
 * 2026-09-28: *"move Quotes mode and Trajectory mode further towards the left
 * (after Summary)"*. `MODES_UI` in src/web/Dock.tsx is where the order lives
 * (docs/project/new-mode.md); this reads it through `visibleModes`, which is
 * what the bar draws, with the switch on so every mode is present.
 * docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md § 5c.
 */
import { describe, expect, it } from "vitest";
import { visibleModes } from "../src/web/Dock.js";

describe("the mode bar's order", () => {
  it("puts Quotes then Trajectory straight after Summary, before Glossary", () => {
    const order = visibleModes(true, undefined).map((m) => m.mode);
    const at = order.indexOf("summary");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(order.slice(at, at + 4)).toEqual(["summary", "quotes", "trajectory", "glossary"]);
  });
});
