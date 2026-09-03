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
import type { AiCallRow } from "../src/ai-spend.js";
import { by, marginPeriod, parseArgs, printMargin } from "../scripts/ai-cost.js";

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

describe("the breakdowns", () => {
  /** The four fields `by` actually reads; the rest of a row is irrelevant here. */
  const row = (over: Partial<AiCallRow>): AiCallRow =>
    ({
      job: "pdf",
      isByok: false,
      costSource: "provider",
      creditsUsedNanos: 0,
      byokUpstreamNanos: null,
      computedCostNanos: null,
      ...over,
    }) as AiCallRow;

  it("counts our own arithmetic, and not only OpenRouter's figure", () => {
    /* **The bug this pins.** `by` summed `credits + upstream`, so every
       breakdown printed `$0.0000` for a declared bypass — money really spent,
       grouped by day and by model, showing as nothing at all. Found by running
       `npm run cost` after a live probe, not by any assertion. The pocket lines
       keep the three kinds apart deliberately; a breakdown wants the total. */
    const groups = by(
      [
        row({ creditsUsedNanos: 1_000 }),
        row({ costSource: "computed", creditsUsedNanos: null, computedCostNanos: 32_000 }),
      ],
      (r) => r.job,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.nanos).toBe(33_000);
    expect(groups[0]?.calls).toBe(2);
  });

  it("counts BYOK, whose credits are legitimately zero", () => {
    const groups = by(
      [row({ isByok: true, creditsUsedNanos: 0, byokUpstreamNanos: 4_000 })],
      (r) => r.job,
    );
    expect(groups[0]?.nanos).toBe(4_000);
  });

  it("carries how many calls in the line reported no cost at all", () => {
    /* **The bug this pins.** `by` threw the unpriced count away, so only the
       top-level pocket line could say the total was short — a day, a job, a
       model, an article or an owner could not. GPT Sol's wording for why it
       matters: *"'chat: $4.20, 16 calls unpriced' is useful; 'chat: $4.20' is
       false precision."*

       A row with `creditsUsedNanos: null` is a call that happened and reported
       no money. It is not a free call, and a breakdown that shows it as one is
       wrong in the direction that looks like good news. */
    const groups = by(
      [
        row({ creditsUsedNanos: 1_000 }),
        row({ creditsUsedNanos: null }),
        row({ creditsUsedNanos: null }),
      ],
      (r) => r.job,
    );
    expect(groups[0]?.nanos).toBe(1_000);
    expect(groups[0]?.calls).toBe(3);
    expect(groups[0]?.unpriced).toBe(2);
  });

  it("keeps the count per line rather than per report", () => {
    /* The whole point is that the shortfall is attributable. One job's unpriced
       calls must not be smeared across every line, and a line with none must
       say zero so that `table` can stay silent about it. */
    const groups = by(
      [
        row({ job: "chat", creditsUsedNanos: null }),
        row({ job: "pdf", creditsUsedNanos: 2_000 }),
      ],
      (r) => r.job,
    );
    const chat = groups.find((g) => g.name === "chat");
    const pdf = groups.find((g) => g.name === "pdf");
    expect(chat?.unpriced).toBe(1);
    expect(pdf?.unpriced).toBe(0);
  });
});

/**
 * `--owners` is a **different report**, not a flag on this one: per-owner spend
 * by category, from a Postgres `GROUP BY`. These two tests are about the flags
 * only — what the report draws is
 * tests/cost-report.test.ts and tests/ai-calls-spend-pg.test.ts.
 */
describe("--owners and --price", () => {
  it("carries both through every range shape, including --all", () => {
    /* The `--all` branch builds a fresh object rather than spreading, and it has
       already dropped a flag that way once — a `--reconcile --all` that silently
       did not reconcile. Both new flags go through the same door. */
    expect(parseArgs(["--owners"]).owners).toBe(true);
    expect(parseArgs(["--owners", "--all"]).owners).toBe(true);
    expect(parseArgs(["--owners", "--price", "20", "--all"]).price).toBe(20);
    expect(parseArgs(["--month", "2026-08", "--owners"]).owners).toBe(true);
    expect(parseArgs([]).owners).toBe(false);
    expect(parseArgs([]).price).toBeUndefined();
  });

  it("refuses a price it cannot subtract rather than printing $NaN", () => {
    /* `Number("twenty")` is `NaN`, and every margin computed from it would print
       as `$NaN` on a page whose whole purpose is a number somebody will act on.
       Zero is refused for the same reason a zero pocket is not printed: it is
       not a candidate price. */
    expect(() => parseArgs(["--price", "twenty"])).toThrow(/positive number of dollars/);
    expect(() => parseArgs(["--price", "0"])).toThrow(/positive number of dollars/);
    expect(() => parseArgs(["--price", "-5"])).toThrow(/positive number of dollars/);
    expect(() => parseArgs(["--price"])).toThrow(/needs a value/);
  });
});

/**
 * **What period a margin is a margin over** — the second P1 of GPT Sol's review
 * of 2026-09-03, and the one Greg reproduced independently.
 *
 * `--price 20` is a *monthly* subscription price, and `printMargin` subtracts
 * whatever the report's range cost from it. The default range is the whole
 * current calendar month — `[Sep 1, Oct 1)` — so on 3 September the report
 * subtracted **two days** of spend from a month's price and headed it as the
 * contribution margin. Every figure in it was correct; the sentence around them
 * was not, and it was wrong in the direction that says "we can afford this".
 */
describe("the period a --price margin is measured over", () => {
  const SEP_3 = new Date("2026-09-03T00:36:00.000Z");

  it("knows a completed calendar month when it sees one", () => {
    const p = marginPeriod(parseArgs(["--month", "2026-08"]), SEP_3);
    expect(p.kind).toBe("month");
    expect(p.label).toBe("2026-08");
  });

  it("knows a month that has not finished yet, and says how much of it has", () => {
    /* September asked for by name rather than by default, so this pins the
       arithmetic to a fixed month: `parseArgs([])` reads the system clock, and a
       test that let it would assert "30 days" until October and then go red for
       a reason that is nothing to do with the code. */
    const p = marginPeriod(parseArgs(["--month", "2026-09"]), SEP_3);
    expect(p.kind).toBe("part-month");
    if (p.kind !== "part-month") throw new Error("unreachable");
    expect(p.of).toBe(30);
    /* Two days and change, said to one decimal rather than rounded to a whole
       number that would read as a fact. */
    expect(p.elapsed).toBeCloseTo(2.03, 1);
  });

  it("says the DEFAULT range is one of those, whatever day it is run on", () => {
    /* **The case that was actually shipping**, and the one that has to be
       clock-independent to be worth anything: `npm run cost -- --price 20` with
       no range asks for the whole current calendar month, whose `until` is by
       construction in the future. `now` is derived from the range rather than
       named, so this holds on the 1st of January and on the 30th of June. */
    const args = parseArgs([]);
    const twoDaysIn = new Date(Date.parse(args.since as string) + 2 * 24 * 60 * 60 * 1000);
    const p = marginPeriod(args, twoDaysIn);
    expect(p.kind).toBe("part-month");
    if (p.kind !== "part-month") throw new Error("unreachable");
    expect(p.elapsed).toBeCloseTo(2, 5);
    expect(p.of).toBeGreaterThanOrEqual(28);
  });

  it("knows a custom range and --all are not months at all", () => {
    expect(marginPeriod(parseArgs(["--all"]), SEP_3).kind).toBe("other");
    expect(
      marginPeriod(parseArgs(["--since", "2026-08-01", "--until", "2026-08-15"]), SEP_3).kind,
    ).toBe("other");
    /* The first half of a month starts on the 1st, which is the trap a
       "does it start on the 1st" check falls into on its own. */
    expect(marginPeriod(parseArgs(["--since", "2026-08-01"]), SEP_3).kind).toBe("other");
  });

  it("does not present a partial month as a monthly margin", () => {
    const lines = capture(() =>
      printMargin(
        20,
        [1_000_000_000, 2_000_000_000],
        marginPeriod(parseArgs(["--month", "2026-09"]), SEP_3),
      ),
    );
    const heading = lines[0] ?? "";
    /* The claim that was false: "per account", full stop, over a month's price
       and two days' spend. The heading now has to name the period it covers. */
    expect(heading).not.toMatch(/per account$/);
    expect(heading).toMatch(/NOT a monthly margin/);
    expect(lines.join("\n")).toContain("of 30 days");
    /* And it says where a monthly one comes from, which is the whole point of
       refusing to print a wrong one. */
    expect(lines.join("\n")).toMatch(/--month/);
  });

  it("does present a completed month as a monthly margin", () => {
    const lines = capture(() =>
      printMargin(20, [1_000_000_000], marginPeriod(parseArgs(["--month", "2026-08"]), SEP_3)),
    );
    expect(lines[0]).toContain("per account per month");
    expect(lines[0]).toContain("2026-08");
    expect(lines.join("\n")).not.toContain("NOT a monthly margin");
  });
});

/** Collect what a printer wrote, so the sentence around a number can be asserted. */
function capture(run: () => void): string[] {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    run();
  } finally {
    console.log = original;
  }
  return lines.filter((l) => l.trim() !== "");
}
