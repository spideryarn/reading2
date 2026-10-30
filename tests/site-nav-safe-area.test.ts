/**
 * **The signed-out bar starts below the clock, on every page that has it.**
 * Report `spya-tfsjvq`, Greg, 2026-10-25: on an iPhone the landing page's
 * wordmark and *Sign in* were drawn under the status bar.
 * docs/plans/261026a-signed-out-nav-below-the-clock-on-an-iphone.md.
 *
 * Only `DocumentPage`'s wrapper carried the inset; the six pages that render
 * `SiteNav` bare did not. So the rule belongs on `.site-nav` itself. jsdom lays
 * nothing out and the inset is `0px` here anyway, so the rule is what a test
 * can hold; the browser geometry check is `scripts/safe-area-check.ts --site`.
 */
import { describe, expect, it } from "vitest";
import { readerCss } from "./helpers/stylesheets.js";

const BARE = readerCss().replace(/\/\*[\s\S]*?\*\//g, "");

/** Every declaration block whose selector list is exactly `selector`. */
function blocks(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
  return [...BARE.matchAll(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "g"))].map((m) => m[1] ?? "");
}
const decl = (block: string, prop: string) =>
  new RegExp(`(?:^|;)\\s*${prop.replace(/-/g, "\\-")}\\s*:\\s*([^;]+)`).exec(block)?.[1]?.trim();

describe("the signed-out bar and the status bar (spya-tfsjvq)", () => {
  it("adds the top inset on the bar itself, not only inside DocumentPage", () => {
    const bar = blocks(".site-nav").find((b) => decl(b, "position") === "sticky");
    expect(bar, "the sticky .site-nav rule").toBeDefined();
    expect(decl(bar!, "top")).toBe("0");
    expect(decl(bar!, "padding-top")).toBe("var(--safe-top)");
  });
});
