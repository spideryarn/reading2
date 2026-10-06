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
  FAILURE_DEFINITIONS,
  FAILURE_NOTES,
  amountPerPricedCall,
  articleKeyOf,
  articleKeyString,
  dimensionValue,
  estimatedCashNanos,
  failureCauses,
  failureCountsBy,
  failureCountsOf,
  failureSummary,
  nothingMeasured,
  stoppedFigure,
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
    failurePhase: null,
    failureClass: null,
    failureStatus: null,
    category: "default-step work",
    calls: 1,
    creditsNanos: 0,
    byokNanos: 0,
    computedNanos: 0,
    unpricedCalls: 0,
    computedCalls: 0,
    settledCalls: 1,
    counted: 0,
    retries: 0,
    gaveUp: 0,
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

describe("failures and retries", () => {
  const before = { outcome: "error", failurePhase: "before_answer" } as const;
  const partWay = { outcome: "error", failurePhase: "mid_answer" } as const;
  /* No stopped row at all: nothing was stopped, by anyone, and that is a zero. */
  const NO_STOPS = {
    stalled: { attempts: 0, partWay: 0 },
    timedOut: { attempts: 0, partWay: 0 },
    stopsClassified: 0,
    stopsNotClassified: 0,
  } as const;
  const stop = (failureClass: string | null, failurePhase: string | null, calls = 1) =>
    row({ outcome: "aborted", failureClass, failurePhase, calls });

  /* One counted day and one that nothing counted. */
  const LEDGER: CostCubeRow[] = [
    /* Ten answered attempts, three of them a second or third go. */
    row({ calls: 10, counted: 10, retries: 3 }),
    /* Four that failed before the answer: a 503, two of them the last go. */
    row({
      ...before,
      failureClass: "refused",
      failureStatus: 503,
      calls: 4,
      counted: 4,
      retries: 2,
      gaveUp: 2,
    }),
    /* A dropped connection, same task, another upstream. */
    row({ ...before, failureClass: "network:ECONNRESET", upstream: "Other", calls: 1, counted: 1 }),
    /* Two that died after the answer began. */
    row({
      ...partWay,
      failureClass: "unfinished",
      failureStatus: 200,
      job: "chat",
      stepName: null,
      calls: 2,
      counted: 2,
    }),
    /* A stop: an attempt, and no failure. */
    row({ outcome: "aborted", calls: 1, counted: 1 }),
    /* The day before any of this was recorded. */
    row({ day: "2033-04-30", calls: 7 }),
    row({ day: "2033-04-30", outcome: "error", calls: 2 }),
  ];

  it("adds the counted attempts, the retries, the calls that gave up and the ones that died part-way", () => {
    expect(failureCountsOf(LEDGER)).toEqual({
      attempts: 27,
      counted: 18,
      retries: 5,
      gaveUp: 2,
      diedPartWay: 2,
      /* Its one stop does not say who stopped it. */
      stalled: null,
      timedOut: null,
      stopsClassified: 0,
      stopsNotClassified: 1,
    });
  });

  it("says not measured, never zero, where no attempt was counted", () => {
    const old = LEDGER.filter((r) => r.day === "2033-04-30");
    expect(failureCountsOf(old)).toEqual({
      attempts: 9,
      counted: 0,
      retries: null,
      gaveUp: null,
      diedPartWay: null,
      ...NO_STOPS,
    });
    expect(failureCountsOf([])).toMatchObject({ attempts: 0, counted: 0, retries: null });
  });

  it("says zero where attempts were counted and none of them was one", () => {
    expect(failureCountsOf([row({ calls: 3, counted: 3 })])).toEqual({
      attempts: 3,
      counted: 3,
      retries: 0,
      gaveUp: 0,
      diedPartWay: 0,
      ...NO_STOPS,
    });
  });

  it("shows a part-way death that a loop of somebody else's recorded, beside retries it could not count", () => {
    /* The PDF reader's row: a phase and a class, and no attempt number. */
    expect(failureCountsOf([row({ ...partWay, failureClass: "in_band", calls: 1 })])).toEqual({
      attempts: 1,
      counted: 0,
      retries: null,
      gaveUp: null,
      diedPartWay: 1,
      ...NO_STOPS,
    });
  });

  it("shows a measured zero for deaths when an unnumbered failure recorded its phase", () => {
    expect(failureCountsOf([row({ ...before, failureClass: "refused", failureStatus: 503 })])).toEqual({
      attempts: 1,
      counted: 0,
      retries: null,
      gaveUp: null,
      diedPartWay: 0,
      ...NO_STOPS,
    });
  });

  it("defines acceptance separately from answer content and caller-owned retry loops", () => {
    expect(FAILURE_DEFINITIONS).toContain("third and last go");
    expect(FAILURE_DEFINITIONS).toContain("before any of the answer arrived");
    expect(FAILURE_DEFINITIONS).toContain("the PDF reader's own loop may");
    expect(FAILURE_DEFINITIONS).not.toContain("never asked again");
    expect(FAILURE_NOTES.join(" ")).toContain("Retries and give-ups are counted only on attempts our retry loop numbered");
    expect(FAILURE_NOTES.join(" ")).toContain("numbered or not");
  });

  it("does not call a stopped row a death, whatever phase it carries", () => {
    const stopped = row({ outcome: "aborted", failurePhase: "mid_answer", calls: 1, counted: 1 });
    expect(failureCountsOf([stopped]).diedPartWay).toBe(0);
  });

  describe("the calls our own clock stopped", () => {
    it("counts a stall part-way as stalled and as stalled part-way, and never as a death", () => {
      const counts = failureCountsOf([stop("stall", "mid_answer", 2), stop("stall", "before_answer")]);
      expect(counts.stalled).toEqual({ attempts: 3, partWay: 2 });
      expect(counts.timedOut).toEqual({ attempts: 0, partWay: 0 });
      /* Beside a real death, the two stay apart. */
      expect(
        failureCountsOf([stop("stall", "mid_answer", 2), row({ ...partWay, failureClass: "unfinished", calls: 1 })]),
      ).toMatchObject({ diedPartWay: 1, stalled: { attempts: 2, partWay: 2 } });
    });

    it("counts a deadline as timed out, part-way or not", () => {
      const counts = failureCountsOf([stop("deadline", "before_answer", 4), stop("deadline", "mid_answer")]);
      expect(counts.timedOut).toEqual({ attempts: 5, partWay: 1 });
      expect(counts.stalled).toEqual({ attempts: 0, partWay: 0 });
    });

    it("counts neither for a reader's Stop, and takes it as proof the row could have said", () => {
      expect(failureCountsOf([stop("abort", "mid_answer", 3)])).toMatchObject({
        stalled: { attempts: 0, partWay: 0 },
        timedOut: { attempts: 0, partWay: 0 },
        stopsClassified: 3,
        stopsNotClassified: 0,
      });
    });

    it("does not count an error that happens to carry one of the three classes", () => {
      expect(failureCountsOf([row({ ...partWay, failureClass: "stall", calls: 1 })])).toMatchObject({
        stalled: { attempts: 0, partWay: 0 },
        stopsClassified: 0,
        diedPartWay: 1,
      });
    });

    it("says not measured where every stop is one that does not say who stopped it", () => {
      /* An old row, or the live-conversation wire's. */
      expect(failureCountsOf([row({ calls: 5, counted: 5 }), stop(null, null, 2)])).toMatchObject({
        stalled: null,
        timedOut: null,
        stopsClassified: 0,
        stopsNotClassified: 2,
      });
    });

    it("says zero where nothing was stopped at all", () => {
      expect(failureCountsOf([row({ calls: 5 })])).toMatchObject(NO_STOPS);
      expect(failureCountsOf([])).toMatchObject(NO_STOPS);
    });

    it("gives the number and the stops it cannot speak for when a group holds both", () => {
      expect(
        failureCountsOf([stop("stall", "mid_answer"), stop("abort", "before_answer"), stop(null, null, 4)]),
      ).toMatchObject({
        stalled: { attempts: 1, partWay: 1 },
        timedOut: { attempts: 0, partWay: 0 },
        stopsClassified: 2,
        stopsNotClassified: 4,
      });
    });

    it("writes a figure as the count and how many of them were part-way", () => {
      expect(stoppedFigure({ attempts: 3, partWay: 2 })).toBe("3 (2 part-way)");
      expect(stoppedFigure({ attempts: 1200, partWay: 0 })).toBe("1,200 (0 part-way)");
      expect(stoppedFigure({ attempts: 0, partWay: 0 })).toBe("0");
    });

    it("ranks a task with stalls above a quiet one", () => {
      const tasks = failureCountsBy(
        [
          row({ calls: 9, counted: 9 }),
          row({ job: "chat", stepName: null, outcome: "aborted", failureClass: "stall", failurePhase: "mid_answer" }),
        ],
        "task",
      );
      expect(tasks.map((t) => t.label)).toEqual(["chat", "structure"]);
    });

    it("keeps a known count of stops even when their causes were not measured", () => {
      expect(nothingMeasured(failureCountsOf([row({ calls: 2 }), stop(null, null)]))).toBe(false);
      expect(nothingMeasured(failureCountsOf([row({ calls: 2 })]))).toBe(true);
      expect(nothingMeasured(failureCountsOf([stop("abort", "before_answer")]))).toBe(false);
      expect(nothingMeasured(failureCountsOf([row({ calls: 2, counted: 2 })]))).toBe(false);
    });

    it("includes only errors and clock stops with a phase in causes", () => {
      const rows = [
        row({ outcome: "ok", failureClass: "stall", failurePhase: "mid_answer", calls: 9 }),
        row({ outcome: "ok", failureClass: "refused", failurePhase: "before_answer", calls: 8 }),
        stop("stall", null, 7),
        stop("deadline", null, 6),
        stop("abort", "mid_answer", 5),
        stop(null, "mid_answer", 4),
        row({ ...before, failureClass: "refused", calls: 3 }),
        stop("stall", "mid_answer", 2),
        stop("deadline", "before_answer"),
      ];
      expect(failureCauses(rows).map((c) => [c.failureClass, c.attempts])).toEqual([
        ["refused", 3], ["stall", 2], ["deadline", 1],
      ]);
    });

    it("lists a stall and a deadline among the causes, and never a reader's Stop", () => {
      const causes = failureCauses([
        stop("stall", "mid_answer", 2),
        stop("deadline", "before_answer"),
        stop("abort", "mid_answer", 7),
        stop(null, null, 3),
      ]);
      expect(causes.map((c) => [c.phase, c.failureClass, c.attempts])).toEqual([
        ["part-way through the answer", "stall", 2],
        ["before the answer began", "deadline", 1],
      ]);
    });

    it("says what a stall and a timeout are, and what these counts miss", () => {
      const notes = FAILURE_NOTES.join(" ");
      expect(notes).not.toContain("Stalls are not measured");
      expect(notes).toContain("live conversation");
      expect(notes).toContain("whole job");
      expect(notes).toContain("if the provider had already sent an error, the row keeps that error");
      expect(FAILURE_DEFINITIONS).toContain("stalled");
      expect(FAILURE_DEFINITIONS).toContain("timed out");
      expect(`${notes} ${FAILURE_DEFINITIONS}`).not.toMatch(/acceptance boundary|seam/);
    });
  });

  it("says the totals in one sentence each way, and never as a share", () => {
    expect(failureSummary(failureCountsOf(LEDGER))).toBe(
      "Of 27 attempts, 18 were numbered by our retry loop: 5 retries and 2 calls that gave up after the last go. 2 attempts died part-way. " +
        "Stalls and timeouts are not measured: 1 stop does not say who stopped it.",
    );
    expect(failureSummary({ attempts: 1, counted: 1, retries: 1, gaveUp: 1, diedPartWay: 1, ...NO_STOPS })).toBe(
      "Of 1 attempt, 1 was numbered by our retry loop: 1 retry and 1 call that gave up after the last go. 1 attempt died part-way. " +
        "0 attempts stalled and 0 timed out.",
    );
    expect(failureSummary({ attempts: 9, counted: 0, retries: null, gaveUp: null, diedPartWay: null, ...NO_STOPS })).toBe(
      "Retries, give-ups and part-way deaths are not measured: none of the 9 attempts was numbered by our retry loop. " +
        "0 attempts stalled and 0 timed out.",
    );
    expect(failureSummary({ attempts: 4, counted: 0, retries: null, gaveUp: null, diedPartWay: 1, ...NO_STOPS })).toBe(
      "None of the 4 attempts was numbered by our retry loop, so retries and give-ups are not measured. 1 attempt died part-way. " +
        "0 attempts stalled and 0 timed out.",
    );
    /* Classified and unclassified stops together: the number, and how many it cannot speak for. */
    expect(
      failureSummary({
        attempts: 9,
        counted: 9,
        retries: 0,
        gaveUp: 0,
        diedPartWay: 0,
        stalled: { attempts: 3, partWay: 2 },
        timedOut: { attempts: 1, partWay: 0 },
        stopsClassified: 5,
        stopsNotClassified: 2,
      }),
    ).toBe(
      "Of 9 attempts, 9 were numbered by our retry loop: 0 retries and 0 calls that gave up after the last go. 0 attempts died part-way. " +
        "3 attempts stalled (2 part-way) and 1 timed out (0 part-way). 2 stops not classified.",
    );
    expect(failureSummary(failureCountsOf(LEDGER))).not.toContain("%");
  });

  it("groups by day and by mode or task, the most trouble first", () => {
    const days = failureCountsBy(LEDGER, "day");
    expect(days.map((d) => [d.key, d.counted, d.retries, d.gaveUp, d.diedPartWay])).toEqual([
      ["2033-05-01", 18, 5, 2, 2],
      ["2033-04-30", 0, null, null, null],
    ]);
    const tasks = failureCountsBy(
      LEDGER.filter((r) => r.day === "2033-05-01"),
      "task",
    );
    expect(tasks.map((t) => [t.label, t.counted, t.retries, t.gaveUp, t.diedPartWay])).toEqual([
      ["structure", 16, 5, 2, 0],
      ["chat", 2, 0, 0, 2],
    ]);
    /* Every group together is the whole. */
    const whole = failureCountsOf(LEDGER);
    expect(days.reduce((n, d) => n + d.attempts, 0)).toBe(whole.attempts);
    expect(days.reduce((n, d) => n + d.counted, 0)).toBe(whole.counted);
  });

  it("lists the causes of the failed attempts, the commonest first, and nothing that did not fail", () => {
    const causes = failureCauses(LEDGER);
    expect(
      causes.map((c) => [c.phase, c.failureClass, c.status, c.upstream, c.model, c.task, c.attempts]),
    ).toEqual([
      ["before the answer began", "refused", "503", "Vendor", "vendor/asked", "structure", 4],
      ["part-way through the answer", "unfinished", "200", "Vendor", "vendor/asked", "chat", 2],
      ["before the answer began", "network:ECONNRESET", "(not recorded)", "Other", "vendor/asked", "structure", 1],
    ]);
    expect(new Set(causes.map((c) => c.key)).size).toBe(causes.length);
  });

  it("adds two cube rows with one cause together, and keeps two causes apart", () => {
    const causes = failureCauses([
      row({ ...before, failureClass: "refused", failureStatus: 503, calls: 1 }),
      row({ ...before, failureClass: "refused", failureStatus: 503, day: "2033-05-02", ownerId: BEN, calls: 2 }),
      row({ ...before, failureClass: "refused", failureStatus: 529, calls: 1 }),
    ]);
    expect(causes.map((c) => [c.status, c.attempts])).toEqual([
      ["503", 3],
      ["529", 1],
    ]);
  });

  it("reads the three failure columns as dimensions, so a filter can hold one", () => {
    const failed = row({ ...before, failureClass: "refused", failureStatus: 503 });
    expect(dimensionValue(failed, "failurePhase")).toEqual({
      key: "value:before_answer",
      label: "before the answer began",
    });
    expect(dimensionValue(failed, "failureClass")).toEqual({ key: "value:refused", label: "refused" });
    expect(dimensionValue(failed, "failureStatus")).toEqual({ key: "value:503", label: "503" });
    expect(dimensionValue(row({}), "failureStatus")).toEqual({ key: "missing", label: "(not recorded)" });
    expect(filterRows(LEDGER, { failurePhase: ["value:mid_answer"] })).toHaveLength(1);
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
