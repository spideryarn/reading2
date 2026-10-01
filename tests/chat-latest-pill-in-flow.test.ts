/**
 * **Chat's "Latest" pill takes its own room rather than floating over text.**
 *
 * It was `position: absolute; bottom: 3.6rem` against the band or the dialog —
 * a guess at the composer's height, which grows with the textarea, wraps, and
 * starts six rows tall in Remember. Measured 2026-10-01 it straddled the
 * transcript and the composer at every width and hid the conversation's last
 * line on a phone (docs/plans/261001f-long-url-wraps-and-chat-latest-pill-clears-the-text.md).
 * In normal flow, between the scroller and the composer, it covers nothing.
 *
 * Geometry is for the browser; this pins that the rule no longer floats.
 */
import { describe, expect, it } from "vitest";
import { readerCssNoComments } from "./helpers/stylesheets.js";

const CSS = readerCssNoComments();

describe("the jump-to-latest pill", () => {
  const rules = [...CSS.matchAll(/\.chat-to-bottom\s*\{([^}]*)\}/g)].map((m) => m[1] ?? "");
  /* The declarations have to live on the shared rule. Finding `flex` in a
     Remember-only rule and `align-self` in a dialog-only rule would leave both
     places half-fixed while a joined search stayed green. */
  const shared = [...CSS.matchAll(/(?:^|})\s*\.chat-to-bottom\s*\{([^}]*)\}/g)].map((m) => m[1] ?? "");

  it("has a rule to check", () => {
    expect(rules.length).toBeGreaterThan(0);
  });

  it("is never positioned or offset, so nothing can float it over the text", () => {
    for (const body of rules) {
      expect(body).not.toMatch(/position:\s*(absolute|fixed|relative|sticky)/);
      expect(body).not.toMatch(/(^|[\s;])(top|bottom|left|right|inset|transform|translate):/);
    }
  });

  it("is a centred row that does not shrink", () => {
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatch(/(?:^|;)\s*flex:\s*none\s*(?:;|$)/);
    expect(shared[0]).toMatch(/(?:^|;)\s*align-self:\s*center\s*(?:;|$)/);
  });

  it("the dialog makes its conversation a column, so the transcript is the scroller", () => {
    const bodies = [
      ...CSS.matchAll(/(?:^|})\s*\.chat-dialog-body:has\(>\s*\.chat-scroll\)\s*\{([^}]*)\}/g),
    ].map((m) => m[1] ?? "");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatch(/(?:^|;)\s*display:\s*flex\s*(?:;|$)/);
    expect(bodies[0]).toMatch(/(?:^|;)\s*flex-direction:\s*column\s*(?:;|$)/);
    expect(bodies[0]).toMatch(/(?:^|;)\s*overflow:\s*hidden\s*(?:;|$)/);

    const scroll = [...CSS.matchAll(/(?:^|})\s*\.chat-scroll\s*\{([^}]*)\}/g)].map((m) => m[1] ?? "");
    expect(scroll).toHaveLength(1);
    expect(scroll[0]).toMatch(/(?:^|;)\s*overflow-y:\s*auto\s*(?:;|$)/);
    expect(scroll[0]).toMatch(/(?:^|;)\s*min-height:\s*0\s*(?:;|$)/);
  });
});
