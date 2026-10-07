/**
 * The pure view helpers of `/admin/costs` —
 * [src/web/admin-costs-view.ts](../src/web/admin-costs-view.ts): the money
 * formatter, the periods, the days of a window and the "Other" fold.
 * docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md.
 */
import { describe, expect, it } from "vitest";

import { type CostCubeRow, parseCostWindow, totalsOf } from "../src/cost-cube.js";
import {
  OTHER_KEY,
  PERIODS,
  amountText,
  colourOrder,
  dayPivot,
  daySeries,
  daysInWindow,
  foldedPivot,
  formatCostNanos,
  formatShare,
  shadeAlpha,
  nextDrillDimension,
  periodWindow,
  scopedRows,
} from "../src/web/admin-costs-view.js";

const DOLLAR = 1_000_000_000;

function row(over: Partial<CostCubeRow>): CostCubeRow {
  return {
    day: "2033-05-01",
    ownerId: "owner-a",
    articleId: null,
    articleSlug: null,
    recordedSlugHash: null,
    scopeKind: "job_step",
    job: "structure",
    stepName: "structure",
    wire: "messages",
    requestedModel: "vendor/one",
    answeredModel: "vendor/one",
    upstream: "Vendor",
    providerAccount: "openrouter",
    costSource: "provider",
    isByok: false,
    outcome: "ok",
    failurePhase: null,
    failureClass: null,
    failureStatus: null,
    counted: 0,
    retries: 0,
    gaveUp: 0,
    category: "default-step work",
    calls: 1,
    creditsNanos: 0,
    byokNanos: 0,
    computedNanos: 0,
    unpricedCalls: 0,
    computedCalls: 0,
    settledCalls: 1,
    ...over,
  };
}

describe("formatCostNanos", () => {
  it("draws two decimals from a dollar up", () => {
    expect(formatCostNanos(12.345 * DOLLAR)).toBe("$12.35");
    expect(formatCostNanos(DOLLAR)).toBe("$1.00");
    expect(formatCostNanos(1234.5 * DOLLAR)).toBe("$1234.50");
  });

  it("draws enough precision below a dollar, without padding", () => {
    expect(formatCostNanos(4_200_000)).toBe("$0.0042");
    expect(formatCostNanos(250_000_000)).toBe("$0.25");
    expect(formatCostNanos(105_000_000)).toBe("$0.105");
    expect(formatCostNanos(100_000)).toBe("$0.0001");
  });

  it("never draws a real cost as zero", () => {
    expect(formatCostNanos(1)).toBe("<$0.0001");
    expect(formatCostNanos(99_999)).toBe("<$0.0001");
    for (const nanos of [1, 500, 99_999, 100_000, 4_200_000]) {
      expect(formatCostNanos(nanos)).not.toMatch(/^\$0(\.0+)?$/);
    }
  });

  it("does not print 1.0000 for a cost a hair under a dollar", () => {
    expect(formatCostNanos(999_960_000)).toBe("$1.00");
    expect(formatCostNanos(999_900_000)).toBe("$0.9999");
  });

  it("draws a true zero as zero, and no priced call as an em dash", () => {
    expect(formatCostNanos(0)).toBe("$0.00");
    expect(amountText({ recordedNanos: 0, pricedCalls: 2 })).toBe("$0.00");
    expect(amountText({ recordedNanos: 0, pricedCalls: 0 })).toBe("—");
  });
});

describe("shadeAlpha", () => {
  it("leaves a zero or empty cell unshaded", () => {
    expect(shadeAlpha(0, 100)).toBeNull();
    expect(shadeAlpha(0, 0)).toBeNull();
    expect(shadeAlpha(5, 0)).toBeNull();
    expect(shadeAlpha(Number.NaN, 100)).toBeNull();
    expect(shadeAlpha(5, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("runs from 0.08 for the smallest real amount to 0.45 for the largest", () => {
    expect(shadeAlpha(1, 1_000_000)).toBe(0.08);
    expect(shadeAlpha(1_000_000, 1_000_000)).toBe(0.45);
    expect(shadeAlpha(2_000_000, 1_000_000)).toBe(0.45);
  });

  it("never goes down as the amount goes up, in nine steps", () => {
    const alphas = Array.from({ length: 101 }, (_, i) => shadeAlpha(i + 1, 101) ?? Number.NaN);
    for (let i = 1; i < alphas.length; i++) {
      expect(alphas[i]).toBeGreaterThanOrEqual(alphas[i - 1] ?? Number.NaN);
    }
    expect(new Set(alphas).size).toBe(9);
  });
});

describe("formatShare", () => {
  it("rounds, keeps a real sliver visible, and has nothing to say of an empty total", () => {
    expect(formatShare(73, 100)).toBe("73%");
    expect(formatShare(1, 1000)).toBe("<1%");
    expect(formatShare(0, 100)).toBe("0%");
    expect(formatShare(0, 0)).toBe("—");
  });
});

describe("periodWindow", () => {
  const now = Date.parse("2033-05-20T12:34:56.000Z");

  it("gives every period bounds the route accepts", () => {
    for (const period of PERIODS) {
      const { since, until } = periodWindow(period, now);
      expect(parseCostWindow(since, until), period).toEqual({ ok: true, since, until });
    }
  });

  it("means UTC months and UTC days", () => {
    expect(periodWindow("this-month", now)).toEqual({
      since: "2033-05-01T00:00:00.000Z",
      until: "2033-06-01T00:00:00.000Z",
    });
    expect(periodWindow("last-month", now)).toEqual({
      since: "2033-04-01T00:00:00.000Z",
      until: "2033-05-01T00:00:00.000Z",
    });
    /* Today and the six days before it. */
    expect(periodWindow("7d", now)).toEqual({
      since: "2033-05-14T00:00:00.000Z",
      until: "2033-05-21T00:00:00.000Z",
    });
    expect(periodWindow("30d", now).since).toBe("2033-04-21T00:00:00.000Z");
    expect(periodWindow("all", now)).toEqual({ since: null, until: null });
  });

  it("rolls a January back into December", () => {
    expect(periodWindow("last-month", Date.parse("2034-01-03T00:00:00.000Z")).since).toBe(
      "2033-12-01T00:00:00.000Z",
    );
  });
});

describe("daysInWindow", () => {
  const now = Date.parse("2033-05-20T12:00:00.000Z");

  it("lists every day of a bounded window up to today, with or without data", () => {
    const days = daysInWindow("2033-05-01T00:00:00.000Z", "2033-06-01T00:00:00.000Z", [], now);
    expect(days).toHaveLength(20);
    expect(days[0]).toBe("2033-05-01");
    expect(days.at(-1)).toBe("2033-05-20");
  });

  it("ends a past window on its last day, which `until` excludes", () => {
    const days = daysInWindow("2033-04-01T00:00:00.000Z", "2033-05-01T00:00:00.000Z", [], now);
    expect(days).toHaveLength(30);
    expect(days.at(-1)).toBe("2033-04-30");
  });

  it("runs an open window from the first day with data to the last", () => {
    const rows = [{ day: "2033-03-30" }, { day: "2033-04-02" }];
    expect(daysInWindow(null, null, rows, now)).toEqual([
      "2033-03-30",
      "2033-03-31",
      "2033-04-01",
      "2033-04-02",
    ]);
    expect(daysInWindow(null, null, [], now)).toEqual([]);
  });

  it("widens to a day the rows carry rather than dropping it", () => {
    const days = daysInWindow("2033-05-10T00:00:00.000Z", "2033-05-12T00:00:00.000Z", [{ day: "2033-05-13" }], now);
    expect(days).toEqual(["2033-05-10", "2033-05-11", "2033-05-12", "2033-05-13"]);
  });
});

describe("the Other fold", () => {
  /* Eleven models, $11 down to $1, over two owners. */
  const rows = Array.from({ length: 11 }, (_, i) =>
    row({
      ownerId: i % 2 === 0 ? "owner-a" : "owner-b",
      requestedModel: `vendor/m${String(i).padStart(2, "0")}`,
      answeredModel: `vendor/m${String(i).padStart(2, "0")}`,
      day: `2033-05-0${(i % 3) + 1}`,
      calls: i + 1,
      creditsNanos: (11 - i) * DOLLAR,
    }),
  );
  const whole = totalsOf(rows);

  it("keeps the largest columns and adds the rest into one", () => {
    const pivot = foldedPivot(rows, "user", "model", 8);
    expect(pivot.columns).toHaveLength(9);
    expect(pivot.columns.at(-1)?.key).toBe(OTHER_KEY);
    expect(pivot.columns.at(-1)?.recordedNanos).toBe(6 * DOLLAR);
    expect(pivot.columns.at(-1)?.calls).toBe(9 + 10 + 11);
  });

  it("keeps a real value named like the synthetic Other bucket separate", () => {
    const collision = [
      row({ requestedModel: OTHER_KEY, answeredModel: OTHER_KEY, creditsNanos: 20 * DOLLAR }),
      ...Array.from({ length: 9 }, (_, i) =>
        row({
          requestedModel: `vendor/c${i}`,
          answeredModel: `vendor/c${i}`,
          creditsNanos: (10 - i) * DOLLAR,
        }),
      ),
    ];
    const pivot = foldedPivot(collision, "user", "model", 8);
    expect(pivot.columns).toHaveLength(9);
    expect(new Set(pivot.columns.map((column) => column.key)).size).toBe(9);
    expect(pivot.columns.filter((column) => column.label === OTHER_KEY)).toHaveLength(1);
    expect(pivot.columns.filter((column) => column.label === "Other")).toHaveLength(1);
    expect(pivot.columns.reduce((total, column) => total + column.recordedNanos, 0)).toBe(
      totalsOf(collision).recordedNanos,
    );
    const chart = daySeries(dayPivot(collision, "model"), ["2033-05-01"]);
    expect(chart.series.find((series) => series.label === OTHER_KEY)?.isOther).toBe(false);
    expect(chart.series.find((series) => series.label === "Other")?.isOther).toBe(true);
  });

  it("loses no money and no calls: cells, rows and columns all reach the same total", () => {
    const pivot = foldedPivot(rows, "user", "model", 8);
    const sum = (list: number[]) => list.reduce((n, v) => n + v, 0);
    for (const r of pivot.rows) {
      const across = [...(pivot.cells.get(r.key)?.values() ?? [])];
      expect(sum(across.map((c) => c.recordedNanos))).toBe(r.recordedNanos);
      expect(sum(across.map((c) => c.calls))).toBe(r.calls);
    }
    expect(sum(pivot.columns.map((c) => c.recordedNanos))).toBe(whole.recordedNanos);
    expect(sum(pivot.columns.map((c) => c.calls))).toBe(whole.calls);
    expect(pivot.total.recordedNanos).toBe(whole.recordedNanos);
  });

  it("folds nothing when the columns fit", () => {
    const pivot = foldedPivot(rows, "user", "model", 11);
    expect(pivot.columns).toHaveLength(11);
    expect(pivot.columns.some((c) => c.key === OTHER_KEY)).toBe(false);
  });

  it("gives the chart at most eight series, Other among them, days oldest first", () => {
    const pivot = dayPivot(rows, "model");
    expect(pivot.columns).toHaveLength(8);
    expect(pivot.columns.at(-1)?.key).toBe(OTHER_KEY);
    expect(pivot.rows.map((r) => r.key)).toEqual(["2033-05-01", "2033-05-02", "2033-05-03"]);
    expect(pivot.columns.reduce((n, c) => n + c.recordedNanos, 0)).toBe(whole.recordedNanos);
  });
});

describe("the rest", () => {
  it("leaves evals and the dev CLI out of product spend", () => {
    const rows = [row({}), row({ scopeKind: "request" }), row({ scopeKind: "eval" }), row({ scopeKind: "cli" })];
    expect(scopedRows(rows, false).map((r) => r.scopeKind)).toEqual(["job_step", "request"]);
    expect(scopedRows(rows, true)).toHaveLength(4);
  });

  it("steps the drill-down user, article, task, model, and stays put elsewhere", () => {
    expect(nextDrillDimension("user")).toBe("article");
    expect(nextDrillDimension("article")).toBe("task");
    expect(nextDrillDimension("task")).toBe("model");
    expect(nextDrillDimension("model")).toBe("model");
    expect(nextDrillDimension("category")).toBe("category");
  });

  it("orders colour keys by the keys themselves, whatever order the rows come in", () => {
    const rows = [row({ category: "zeta" }), row({ category: "alpha" }), row({ category: "zeta" })];
    expect(colourOrder(rows, "category")).toEqual(["alpha", "zeta"]);
  });
});
