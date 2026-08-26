/**
 * `3 days ago`, and where it stops being useful — src/web/relative-time.ts.
 *
 * `now` is an argument rather than a clock read, so every one of these is
 * deterministic. What is deliberately *not* asserted is the English: the
 * formatter is `Intl.RelativeTimeFormat` on the runtime's own locale, so
 * pinning "3 days ago" would pin the test machine's language rather than the
 * behaviour. The assertions are about which unit is chosen and where the
 * thresholds are.
 */
import { describe, expect, it } from "vitest";
import { exactly, timeAgo } from "../src/web/relative-time.js";

const NOW = Date.parse("2026-08-26T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("timeAgo", () => {
  it("is undefined for absent and for unparseable alike", () => {
    /* The two are the same thing to a reader, and collapsing them here is what
       keeps every caller from having to check for NaN — which matters because
       NaN compares false in both directions, so a sort built on one silently
       does nothing at all. */
    expect(timeAgo(undefined, NOW)).toBeUndefined();
    expect(timeAgo("", NOW)).toBeUndefined();
    expect(timeAgo("soon", NOW)).toBeUndefined();
    expect(timeAgo("2026-13-45", NOW)).toBeUndefined();
  });

  it("says 'just now' under a minute", () => {
    expect(timeAgo(ago(0), NOW)).toBe("just now");
    expect(timeAgo(ago(59 * SECOND), NOW)).toBe("just now");
  });

  it("clamps a future timestamp rather than counting forwards", () => {
    // A date ahead of now is two clocks disagreeing — the server's and the
    // browser's — not a fact about the article. "in 4 seconds" next to
    // something you just opened reads as a bug; "just now" does not.
    expect(timeAgo(new Date(NOW + 5 * MINUTE).toISOString(), NOW)).toBe("just now");
  });

  it("steps up through minutes, hours and days", () => {
    // Asserted by unit rather than by wording: a different locale says
    // something else, correctly.
    expect(timeAgo(ago(5 * MINUTE), NOW)).toMatch(/minute/i);
    expect(timeAgo(ago(5 * HOUR), NOW)).toMatch(/hour/i);
    expect(timeAgo(ago(5 * DAY), NOW)).toMatch(/day/i);
  });

  it("hands back to a real date once relative stops helping", () => {
    /* The one decision in the file. "43 days ago" is worse than the date —
       nobody counts in days at that range. The threshold is 30 days. */
    expect(timeAgo(ago(29 * DAY), NOW)).toMatch(/day/i);
    const old = timeAgo(ago(200 * DAY), NOW);
    expect(old).not.toMatch(/day|ago/i);
    expect(old).toMatch(/2026/);
  });
});

describe("exactly", () => {
  it("is undefined for absent and unparseable, like timeAgo", () => {
    expect(exactly(undefined)).toBeUndefined();
    expect(exactly("nope")).toBeUndefined();
  });

  it("keeps the time, which is the whole point of it", () => {
    // The tooltip's job: the relative form is the readable one, this is the one
    // you check against. Both must exist or "opened 3 days ago" is unfalsifiable.
    expect(exactly("2026-08-25T14:02:00.000Z")).toMatch(/2026/);
  });
});
