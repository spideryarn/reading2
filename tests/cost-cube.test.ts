/**
 * The pure half of `/admin/costs` — [src/cost-cube.ts](../src/cost-cube.ts).
 * docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md.
 *
 * No database: the SQL is held in tests/admin-costs-store.test.ts. What this
 * pins is the naming and the arithmetic the page and the analysis script share.
 */
import { describe, expect, it } from "vitest";

import {
  type CostCubeRow,
  type CubeTotals,
  DIMENSIONS,
  amountPerPricedCall,
  articleKeyOf,
  articleKeyString,
  dimensionValue,
  estimatedCashNanos,
  filterRows,
  groupRows,
  modelOf,
  parseCostWindow,
  pivotRows,
  recordedNanos,
  taskOf,
  totalsOf,
} from "../src/cost-cube.js";

const ANN = "owner-ann";
const BEN = "owner-ben";
const OWNERS = new Map<string, string | null>([
  [ANN, "ann@example.test"],
  [BEN, null],
]);

function row(over: Partial<CostCubeRow>): CostCubeRow {
  return {
    day: "2033-05-01",
    ownerId: ANN,
    articleId: null,
    articleSlug: null,
    recordedSlugHash: null,
    scopeKind: "job_step",
    job: "structure",
    stepName: "structure",
    wire: "messages",
    requestedModel: "vendor/asked",
    answeredModel: "vendor/asked",
    upstream: "Vendor",
    providerAccount: "openrouter",
    costSource: "provider",
    isByok: false,
    outcome: "ok",
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

const ROWS: CostCubeRow[] = [
  row({ articleId: "art-1", articleSlug: "ann-own-piece", calls: 4, creditsNanos: 400 }),
  row({
    articleId: "art-1",
    articleSlug: "ann-own-piece",
    scopeKind: "request",
    job: "chat",
    stepName: null,
    category: "interactive request work",
    calls: 2,
    creditsNanos: 100,
    unpricedCalls: 1,
  }),
  row({
    ownerId: BEN,
    articleId: "art-2",
    job: "glossary",
    stepName: "glossary",
    category: "on-demand enrichment",
    day: "2033-05-02",
    calls: 3,
    creditsNanos: 30,
    byokNanos: 20,
    computedNanos: 10,
    computedCalls: 1,
  }),
  row({
    ownerId: BEN,
    recordedSlugHash: "0a1b2c3d4e",
    outcome: "error",
    day: "2033-05-02",
    calls: 1,
    creditsNanos: 7,
  }),
];

function sum(list: readonly CubeTotals[], pick: (t: CubeTotals) => number): number {
  return list.reduce((n, t) => n + pick(t), 0);
}

const TOTAL_FIELDS = [
  "calls",
  "creditsNanos",
  "byokNanos",
  "computedNanos",
  "recordedNanos",
  "unpricedCalls",
  "pricedCalls",
  "failedCalls",
  "failedRecordedNanos",
  "computedCalls",
  "settledCalls",
] as const satisfies readonly (keyof CubeTotals)[];

describe("the money in a row", () => {
  it("adds the three pockets, and puts the fee on credits only", () => {
    const pockets = { creditsNanos: 1_000, byokNanos: 200, computedNanos: 30 };
    expect(recordedNanos(pockets)).toBe(1_230);
    expect(estimatedCashNanos(pockets)).toBe(1_055 + 200 + 30);
  });

  it("divides by priced calls, never by all of them", () => {
    const totals = totalsOf([row({ calls: 5, unpricedCalls: 3, creditsNanos: 100 })]);
    expect(totals.pricedCalls).toBe(2);
    expect(amountPerPricedCall(totals)).toBe(50);
    expect(amountPerPricedCall(totalsOf([row({ calls: 2, unpricedCalls: 2 })]))).toBeNull();
    expect(amountPerPricedCall(totalsOf([]))).toBeNull();
  });

  it("counts failed calls and their money from the outcome", () => {
    const totals = totalsOf(ROWS);
    expect(totals.calls).toBe(10);
    expect(totals.failedCalls).toBe(1);
    expect(totals.failedRecordedNanos).toBe(7);
    expect(totals.recordedNanos).toBe(400 + 100 + 60 + 7);
    expect(totals.computedCalls).toBe(1);
    expect(totals.unpricedCalls).toBe(1);
    expect(totals.settledCalls).toBe(4);
  });
});

describe("taskOf and modelOf", () => {
  it("names step work by its step and a request by its job", () => {
    expect(taskOf({ job: "labels", stepName: "structure" })).toBe("structure");
    expect(taskOf({ job: "chat", stepName: null })).toBe("chat");
  });

  it("reads a renamed historical name as its successor", () => {
    expect(taskOf({ job: "trajectory", stepName: "trajectory" })).toBe("skim");
    expect(taskOf({ job: "labels", stepName: "hierarchy" })).toBe("structure");
    expect(taskOf({ job: "hierarchy", stepName: null })).toBe("structure");
  });

  it("prefers the model that answered", () => {
    expect(modelOf({ requestedModel: "a", answeredModel: "b" })).toBe("b");
    expect(modelOf({ requestedModel: "a", answeredModel: null })).toBe("a");
  });
});

describe("which article a row is", () => {
  it("is the article when the row has an id", () => {
    const key = articleKeyOf(row({ articleId: "art-1", articleSlug: "ann-own-piece" }));
    expect(key).toEqual({ kind: "article", id: "art-1" });
    expect(articleKeyString(key)).toBe("article:art-1");
  });

  it("is only a recorded name without one — keyed by an opaque hash, per owner", () => {
    const own = articleKeyOf(row({ articleSlug: "ann-deleted", recordedSlugHash: "own-opaque" }));
    expect(own).toEqual({ kind: "recorded", ownerId: ANN, id: "own-opaque" });
    expect(articleKeyString(own)).not.toContain("ann-deleted");
    const theirs = articleKeyOf(row({ ownerId: BEN, recordedSlugHash: "0a1b2c3d4e" }));
    expect(theirs).toEqual({ kind: "recorded", ownerId: BEN, id: "0a1b2c3d4e" });
    /* The same recorded name under two owners is two keys. */
    const other = articleKeyOf(row({ ownerId: ANN, recordedSlugHash: "0a1b2c3d4e" }));
    expect(articleKeyString(other)).not.toBe(articleKeyString(theirs));
  });

  it("is none when the row names nothing", () => {
    expect(articleKeyOf(row({}))).toEqual({ kind: "none" });
    expect(articleKeyString({ kind: "none" })).toBe("none");
  });

  it("never merges an id with a recorded name of the same spelling", () => {
    const byId = dimensionValue(row({ articleId: "x", articleSlug: "same" }), "article");
    const recorded = dimensionValue(row({ articleSlug: "same", recordedSlugHash: "opaque-same" }), "article");
    expect(byId.key).not.toBe(recorded.key);
  });

  it("gives a renamed article one key and one group", () => {
    const before = row({ articleId: "art-renamed", articleSlug: "old-name", creditsNanos: 2 });
    const after = row({ articleId: "art-renamed", articleSlug: "new-name", creditsNanos: 3 });
    expect(dimensionValue(before, "article").key).toBe(dimensionValue(after, "article").key);
    expect(groupRows([before, after], "article")).toHaveLength(1);
    expect(groupRows([before, after], "article")[0]?.recordedNanos).toBe(5);
  });
});

describe("dimensionValue", () => {
  it("answers for every dimension", () => {
    const sample = row({ articleId: "art-1" });
    for (const dim of DIMENSIONS) {
      const value = dimensionValue(sample, dim, OWNERS);
      expect(value.key, dim).not.toBe("");
      expect(value.label, dim).not.toBe("");
    }
  });

  it("labels a user by email, or a short id when there is none", () => {
    expect(dimensionValue(row({}), "user", OWNERS)).toEqual({ key: ANN, label: "ann@example.test" });
    expect(dimensionValue(row({ ownerId: BEN }), "user", OWNERS).label).toBe(BEN.slice(0, 8));
    expect(dimensionValue(row({ ownerId: BEN }), "user").key).toBe(BEN);
  });

  it("gives an absent upstream a key of its own", () => {
    const a = dimensionValue(row({ upstream: null }), "upstream");
    const b = dimensionValue(row({ upstream: "Vendor" }), "upstream");
    expect(a.key).not.toBe(b.key);
  });

  it("does not merge an absent upstream with that literal provider name", () => {
    const absent = dimensionValue(row({ upstream: null }), "upstream");
    const literal = dimensionValue(row({ upstream: "(not recorded)" }), "upstream");
    expect(absent.key).not.toBe(literal.key);
    expect(groupRows([row({ upstream: null }), row({ upstream: "(not recorded)" })], "upstream")).toHaveLength(2);
  });
});

describe("filterRows", () => {
  it("keeps rows matching every named dimension", () => {
    expect(filterRows(ROWS, {})).toHaveLength(4);
    expect(filterRows(ROWS, { user: [BEN] })).toHaveLength(2);
    expect(filterRows(ROWS, { user: [BEN], outcome: ["error"] })).toHaveLength(1);
    expect(filterRows(ROWS, { scope: ["request", "job_step"] })).toHaveLength(4);
    expect(filterRows(ROWS, { article: ["article:art-1"] })).toHaveLength(2);
  });

  it("an empty list of values matches nothing", () => {
    expect(filterRows(ROWS, { user: [] })).toEqual([]);
  });
});

describe("groupRows", () => {
  it("totals per key, largest recorded amount first", () => {
    const groups = groupRows(ROWS, "user", OWNERS);
    expect(groups.map((g) => [g.label, g.recordedNanos, g.calls])).toEqual([
      ["ann@example.test", 500, 6],
      [BEN.slice(0, 8), 67, 4],
    ]);
    expect(groups[1]).toMatchObject({
      creditsNanos: 37,
      byokNanos: 20,
      computedNanos: 10,
      failedCalls: 1,
      failedRecordedNanos: 7,
      pricedCalls: 4,
    });
  });

  it("loses nothing: the groups sum to the whole, for every dimension", () => {
    const whole = totalsOf(ROWS);
    for (const dim of DIMENSIONS) {
      const groups = groupRows(ROWS, dim, OWNERS);
      expect(sum(groups, (g) => g.calls), dim).toBe(whole.calls);
      expect(sum(groups, (g) => g.recordedNanos), dim).toBe(whole.recordedNanos);
      expect(sum(groups, (g) => g.unpricedCalls), dim).toBe(whole.unpricedCalls);
    }
  });

  it("groups step work with a renamed step under one task", () => {
    const groups = groupRows(
      [row({ stepName: "hierarchy", job: "hierarchy", creditsNanos: 1 }), row({ creditsNanos: 2 })],
      "task",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: "structure", recordedNanos: 3 });
  });
});

describe("pivotRows", () => {
  const pivot = pivotRows(ROWS, "user", "task", OWNERS);

  it("has a row and a column for every key", () => {
    expect(pivot.rows.map((r) => r.key)).toEqual([ANN, BEN]);
    expect(pivot.columns.map((c) => c.key)).toEqual(["structure", "chat", "glossary"]);
  });

  it("cells sum to their row total, their column total and the grand total", () => {
    for (const r of pivot.rows) {
      const cells = pivot.columns.flatMap((c) => pivot.cells.get(r.key)?.get(c.key) ?? []);
      for (const field of TOTAL_FIELDS) expect(sum(cells, (t) => t[field]), `${r.key}.${field}`).toBe(r[field]);
    }
    for (const c of pivot.columns) {
      const cells = pivot.rows.flatMap((r) => pivot.cells.get(r.key)?.get(c.key) ?? []);
      for (const field of TOTAL_FIELDS) expect(sum(cells, (t) => t[field]), `${c.key}.${field}`).toBe(c[field]);
    }
    for (const field of TOTAL_FIELDS) {
      expect(sum(pivot.rows, (t) => t[field]), `rows.${field}`).toBe(pivot.total[field]);
      expect(sum(pivot.columns, (t) => t[field]), `columns.${field}`).toBe(pivot.total[field]);
    }
    expect(pivot.total).toEqual(totalsOf(ROWS));
  });

  it("leaves a cell out where nothing was spent", () => {
    expect(pivot.cells.get(ANN)?.get("glossary")).toBeUndefined();
    expect(pivot.cells.get(ANN)?.get("chat")?.recordedNanos).toBe(100);
  });
});

describe("parseCostWindow", () => {
  it("takes both, either or neither bound", () => {
    expect(parseCostWindow(null, null)).toEqual({ ok: true, since: null, until: null });
    expect(parseCostWindow("2033-05-01T00:00:00.000Z", "2033-06-01T00:00:00Z")).toEqual({
      ok: true,
      since: "2033-05-01T00:00:00.000Z",
      until: "2033-06-01T00:00:00.000Z",
    });
    expect(parseCostWindow(null, "2033-06-01T00:00:00.000Z")).toMatchObject({ ok: true, since: null });
  });

  it("refuses anything that is not a UTC instant, with a sentence", () => {
    for (const bad of ["yesterday", "2033-05-01", "2033-02-31T00:00:00.000Z", "", "2033-05-01T00:00:00+01:00"]) {
      const parsed = parseCostWindow(bad, null);
      expect(parsed.ok, bad).toBe(false);
      if (!parsed.ok) expect(parsed.message).toMatch(/since/);
    }
    expect(parseCostWindow(null, "nope")).toMatchObject({ ok: false });
  });

  it("refuses a window that ends at or before its start", () => {
    const at = "2033-05-01T00:00:00.000Z";
    expect(parseCostWindow(at, at).ok).toBe(false);
    expect(parseCostWindow("2033-06-01T00:00:00.000Z", at).ok).toBe(false);
  });
});
