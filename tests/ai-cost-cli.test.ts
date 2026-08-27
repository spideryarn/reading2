/**
 * The ranges `npm run cost` asks for — [scripts/ai-cost.ts](../scripts/ai-cost.ts).
 *
 * Only the arithmetic is tested here, and it is the part that is quietly wrong
 * rather than loudly wrong: a month boundary in the wrong timezone moves a few
 * calls between two reports and nothing looks broken from either end. **UTC,
 * half-open** — `[since, until)` — so a call at midnight belongs to exactly one
 * month, and the same boundary OpenRouter's own key limits reset on, which is
 * what makes the reconciliation comparable at all.
 */
import { describe, expect, it } from "vitest";
import { parseArgs } from "../scripts/ai-cost.js";

describe("--month", () => {
  it("runs from the first instant of the month to the first instant of the next", () => {
    const a = parseArgs(["--month", "2026-08"]);
    expect(a.since).toBe("2026-08-01T00:00:00.000Z");
    expect(a.until).toBe("2026-09-01T00:00:00.000Z");
  });

  it("rolls the year over in December rather than asking for month 13", () => {
    const a = parseArgs(["--month", "2026-12"]);
    expect(a.since).toBe("2026-12-01T00:00:00.000Z");
    expect(a.until).toBe("2027-01-01T00:00:00.000Z");
  });

  it("is UTC, so a British-summer midnight does not move a call into July", () => {
    /* 00:30 BST on 1 August is 23:30 UTC on 31 July — a July call. The bound
       below is what decides that, and it is the whole reason this is pinned. */
    const july = parseArgs(["--month", "2026-07"]);
    expect(Date.parse(july.until as string)).toBe(Date.UTC(2026, 7, 1));
    expect(new Date(july.until as string).toISOString()).toContain("T00:00:00.000Z");
  });

  it("refuses a shape it cannot read rather than guessing a range", () => {
    /* Guessing here is a report that silently covers the wrong days. */
    expect(() => parseArgs(["--month", "August"])).toThrow("YYYY-MM");
    expect(() => parseArgs(["--month", "2026-8"])).toThrow("YYYY-MM");
  });

  it("refuses a month number that is not a month", () => {
    /* **`2026-13` was accepted**, because the pattern was `\d{2}`, and
       `Date.UTC` normalises month 12 (zero-based) into January 2027 — so `since`
       came back *after* `until` and the report silently covered nothing. The
       test above was green against all of it: rejecting "August" says nothing
       about rejecting a number. GPT Sol. */
    expect(() => parseArgs(["--month", "2026-13"])).toThrow("01-12");
    expect(() => parseArgs(["--month", "2026-00"])).toThrow("01-12");
  });

  it("never returns an inverted range, whatever it accepts", () => {
    /* The property the check above defends, stated as itself: whatever gets
       past the parse must describe a real span of time. */
    for (const month of ["2026-01", "2026-06", "2026-12"]) {
      const a = parseArgs(["--month", month]);
      expect(Date.parse(a.until as string)).toBeGreaterThan(Date.parse(a.since as string));
    }
  });

  it("leaves the range open at both ends for --all", () => {
    const a = parseArgs(["--all"]);
    expect(a.since).toBeUndefined();
    expect(a.until).toBeUndefined();
    expect(a.label).toBe("all time");
  });

  it("defaults to the current month in UTC, not to everything", () => {
    /* A bare `npm run cost` that showed all time would grow a bigger number
       every week and never answer "what is this costing me now". */
    const a = parseArgs([]);
    expect(a.since).toBeTruthy();
    expect(a.until).toBeTruthy();
    expect(a.label).toContain("UTC");
  });

  it("says so rather than silently ignoring a flag it does not know", () => {
    expect(() => parseArgs(["--last-week"])).toThrow("Unknown flag");
  });
});
