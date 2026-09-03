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
import { by, parseArgs, duplicateJobSteps } from "../scripts/ai-cost.js";

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
 * **Would it have fired on the actual incident?** — the bar
 * docs/reusable/improve-the-codebase.md sets for a check added after the fact.
 *
 * On 2026-08-30 one article's `hierarchy` step ran eleven times at once under a
 * single job id, and nothing ever asked the ledger about it: the two big ones
 * were spotted by eye three days later and the six on `read` were never found
 * at all. docs/postmortems/260902c-the-truncation-retry-cost-storm.md.
 *
 * So the first test below is that shape, built to scale, rather than a
 * two-and-two case that would pass against a check counting rows instead of
 * collectors.
 */
describe("steps that ran more than once", () => {
  /** The six fields `duplicateJobSteps` reads; the rest of a row is irrelevant. */
  const row = (over: Partial<AiCallRow>): AiCallRow =>
    ({
      scopeKind: "job_step",
      runId: "run-1",
      jobId: "job-1",
      stepName: "hierarchy",
      isByok: false,
      costSource: "provider",
      creditsUsedNanos: 1_000,
      byokUpstreamNanos: null,
      computedCostNanos: null,
      ...over,
    }) as AiCallRow;

  it("finds the eleven runs of one step that nobody ever looked for", () => {
    /* Three calls per run, because the step really did make several — which is
       the distinction the check turns on. Counting *rows* would say 33 and mean
       nothing; counting collectors says 11 and means eleven executions. */
    const rows = Array.from({ length: 11 }, (_, run) =>
      Array.from({ length: 3 }, (_, call) =>
        row({ runId: `run-${run}`, id: `call-${run}-${call}` }),
      ),
    ).flat();
    const found = duplicateJobSteps(rows);
    expect(found).toHaveLength(1);
    expect(found[0]?.jobId).toBe("job-1");
    expect(found[0]?.stepName).toBe("hierarchy");
    expect(found[0]?.runs).toBe(11);
    expect(found[0]?.calls).toBe(33);
    /* And what it cost, which is the argument for reading it at all: eleven
       runs of a step that should have run once, billed eleven times. */
    expect(found[0]?.nanos).toBe(33_000);
  });

  it("says nothing about one run that made forty calls, which is what steps do", () => {
    /* **The case that makes this useful rather than noisy.** Every one of these
       rows shares a `job_id`, a `step_name` AND a `run_id`: one execution that
       fanned out into forty calls, which `summarise` really does. Counting rows
       instead of collectors would report every ordinary step in the ledger.

       It is also the boundedness half: a healthy ledger returns an empty list,
       so the report prints no line at all — no threshold to tune and nothing
       that fires on ordinary traffic. */
    const rows = Array.from({ length: 40 }, (_, i) => row({ id: `call-${i}` }));
    expect(duplicateJobSteps(rows)).toEqual([]);
  });

  it("ignores a row that is not a job step, whatever it happens to carry", () => {
    /* `scopeKind` is the row's own word for what it was. A `cli` or `request`
       row carrying a job id is not a step the queue ran, and reading it as one
       would give this line a quiet third meaning. */
    const rows = [
      row({ scopeKind: "cli", runId: "run-a" }),
      row({ scopeKind: "cli", runId: "run-b" }),
      row({ scopeKind: "request", runId: "run-c" }),
      row({ scopeKind: "request", runId: "run-d" }),
    ];
    expect(duplicateJobSteps(rows)).toEqual([]);
  });

  it("does not pile every unattributed call into one enormous group", () => {
    /* A chat answer or a search has no job and no step. Grouped under a shared
       `—` key they would look like hundreds of runs of one thing, which is the
       wall of output this must not produce. */
    const rows = [
      row({ runId: "run-a", jobId: null, stepName: null }),
      row({ runId: "run-b", jobId: null, stepName: null }),
      row({ runId: "run-c", jobId: "job-9", stepName: null }),
      row({ runId: "run-d", jobId: "job-9", stepName: null }),
    ];
    expect(duplicateJobSteps(rows)).toEqual([]);
  });

  it("keeps two steps of one job apart, and two jobs running the same step", () => {
    const rows = [
      row({ runId: "run-a", jobId: "job-1", stepName: "hierarchy" }),
      row({ runId: "run-b", jobId: "job-1", stepName: "summarise" }),
      row({ runId: "run-c", jobId: "job-2", stepName: "hierarchy" }),
    ];
    expect(duplicateJobSteps(rows)).toEqual([]);
  });

  it("puts the most-repeated step first, whatever order the ledger is in", () => {
    /* The report shows the worst few and counts the rest, so which ones are at
       the top is what a reader actually sees. */
    const rows = [
      row({ runId: "run-a", jobId: "job-1", stepName: "hierarchy" }),
      row({ runId: "run-b", jobId: "job-1", stepName: "hierarchy" }),
      row({ runId: "run-c", jobId: "job-2", stepName: "summarise" }),
      row({ runId: "run-d", jobId: "job-2", stepName: "summarise" }),
      row({ runId: "run-e", jobId: "job-2", stepName: "summarise" }),
    ];
    expect(duplicateJobSteps(rows).map((r) => [r.jobId, r.runs])).toEqual([
      ["job-2", 3],
      ["job-1", 2],
    ]);
  });
});
