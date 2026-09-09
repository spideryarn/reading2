/**
 * The usage chart's series layer: what it may and may not claim.
 *
 * Every test here is a way a usage chart can be confidently wrong. The recurring
 * shape is that the *drawable* answer and the *true* answer differ, and the
 * drawable one always looks better.
 */
import { describe, expect, it } from "vitest";

import type {
  UsageHistorySample,
  UsageHistoryView,
  UsageIncidentView,
  UsageWindowView,
} from "../tools/fleet/web/src/usage-history-client";
import { plotUsageHistory } from "../tools/fleet/web/src/usage-history-series";

const T0 = Date.parse("2026-09-09T00:00:00.000Z");
const FIVE_MIN = 300_000;

function windowValue(pct: number, window = "five_hour"): UsageWindowView {
  return {
    kind: "value",
    window,
    utilizationPercent: pct,
    resetsAt: "2026-09-09T05:00:00.000Z",
    resetsAtMs: Date.parse("2026-09-09T05:00:00.000Z"),
  };
}

function sample(
  atMs: number,
  over: {
    windows?: UsageWindowView[];
    cacheKind?: "attributed" | "unattributed" | "unknown";
    incidents?: UsageIncidentView[];
    conclusive?: boolean;
    nextDueMs?: number;
    accountUuid?: string;
  } = {},
): UsageHistorySample {
  const cacheKind = over.cacheKind ?? "attributed";
  return {
    kind: "sample",
    sourceAtMs: atMs,
    line: {
      nextDueMs: over.nextDueMs ?? FIVE_MIN,
      recordedAt: new Date(atMs).toISOString(),
      pass: {
        kind: "pass",
        collectedAt: new Date(atMs).toISOString(),
        accountUuid: over.accountUuid ?? "acct-A",
        cache:
          cacheKind === "attributed"
            ? {
                kind: "attributed",
                accountUuid: over.accountUuid ?? "acct-A",
                fetchedAt: new Date(atMs).toISOString(),
                windows: over.windows ?? [windowValue(40)],
              }
            : { kind: cacheKind, why: "no account could be named" },
        scan: { conclusive: over.conclusive ?? true, why: null, incidents: over.incidents ?? [] },
        publication: { decision: "take-fresh", why: "finished" },
      },
    },
  };
}

function view(samples: UsageHistorySample[], over: Partial<Extract<UsageHistoryView, { kind: "history" }>> = {}) {
  return {
    kind: "history" as const,
    windowHours: 24,
    fromMs: T0 - 24 * 60 * 60 * 1000,
    toMs: T0 + 60 * 60 * 1000,
    samples,
    predecessor: null,
    holes: [],
    earliestAt: null,
    rotated: false,
    unreadableLines: 0,
    unsupportedLines: 0,
    recorder: { lastRecordedAt: null, expectedEveryMs: null, overdueByMs: null },
    refreshMs: 60_000,
    latestCodex: { kind: "absent" as const, why: "not part of this chart fixture" },
    ...over,
  };
}

function incident(over: Partial<UsageIncidentView> = {}): UsageIncidentView {
  return {
    id: "five_hour@2026-09-09T05:00:00.000Z",
    window: "five_hour",
    resetsAt: "2026-09-09T05:00:00.000Z",
    firstHitAt: new Date(T0 - 60_000).toISOString(),
    lastHitAt: new Date(T0).toISOString(),
    rejections: 1,
    unidentifiedRejections: 0,
    conversations: 1,
    ...over,
  };
}

describe("utilisation", () => {
  it("plots a line per account and window", () => {
    const plot = plotUsageHistory(view([sample(T0), sample(T0 + FIVE_MIN, { windows: [windowValue(45)] })]));
    expect(plot.accounts).toHaveLength(1);
    expect(plot.accounts[0]?.accountUuid).toBe("acct-A");
    expect(plot.accounts[0]?.windows[0]?.points).toEqual([
      { atMs: T0, value: 40 },
      { atMs: T0 + FIVE_MIN, value: 45 },
    ]);
  });

  it("BREAKS the line at an unattributed cache — never a zero", () => {
    /* The /login-swap case: the cache was read fine and carries no account, so
       it has no windows at all. Drawing 0 would say headroom was exhausted;
       drawing nothing and joining across would say it never changed. */
    const plot = plotUsageHistory(
      view([sample(T0), sample(T0 + FIVE_MIN, { cacheKind: "unattributed" }), sample(T0 + 2 * FIVE_MIN)]),
    );
    const series = plot.accounts[0]?.windows[0];
    expect(series?.points.map((p) => p.value)).toEqual([40, 40]);
    expect(series?.points.some((p) => p.value === 0)).toBe(false);
    expect(series?.breaks.length).toBeGreaterThan(0);
  });

  it("breaks the line when the cache could not be read at all", () => {
    const plot = plotUsageHistory(view([sample(T0), sample(T0 + FIVE_MIN, { cacheKind: "unknown" }), sample(T0 + 2 * FIVE_MIN)]));
    expect(plot.accounts[0]?.windows[0]?.breaks.length).toBeGreaterThan(0);
  });

  it("never re-adjudicates an expired window, and never plots one", () => {
    /* An expired arm is the producer's decision, taken at the reading's own
       instant. It carries no percentage, so there is nothing to plot — and
       nothing here recomputes whether it "has expired by now", which would
       delete valid points as the day wore on. */
    const plot = plotUsageHistory(
      view([
        sample(T0, { windows: [{ kind: "expired", window: "five_hour", resetsAt: null, why: "already reset" }] }),
      ]),
    );
    expect(plot.accounts).toEqual([]);
  });

  it("keeps an unknown window as a NAMED row with its reason, never as 0%", () => {
    /* Three of these are live on this box: nimbus_quill, spend and
       member_dashboard_available. Their unvalidated percentage is literally 0. */
    const plot = plotUsageHistory(
      view([
        sample(T0, {
          windows: [
            windowValue(40),
            { kind: "unknown", window: "nimbus_quill", why: "no resets_at, so the utilization (0) cannot be checked" },
          ],
        }),
      ]),
    );
    expect(plot.unknownWindows).toEqual([
      { window: "nimbus_quill", why: "no resets_at, so the utilization (0) cannot be checked" },
    ]);
    /* And it is NOT a series. */
    expect(plot.accounts[0]?.windows.map((w) => w.window)).toEqual(["five_hour"]);
  });
});

describe("the three absences, kept apart", () => {
  it("reports a recorder gap from the record's OWN cadence, not an assumed one", () => {
    /* A daemon on a ten-minute interval must not have every ordinary gap drawn
       as a failure — that is a monitor alarming at its own configuration. */
    const slow = [sample(T0, { nextDueMs: 900_000 }), sample(T0 + 600_000, { nextDueMs: 900_000 })];
    expect(plotUsageHistory(view(slow)).recorderGaps).toEqual([]);

    const fast = [sample(T0, { nextDueMs: FIVE_MIN }), sample(T0 + 600_000, { nextDueMs: FIVE_MIN })];
    expect(plotUsageHistory(view(fast)).recorderGaps).toHaveLength(1);
  });

  it("does NOT use a scan's conclusiveness to fill a recorder gap", () => {
    /* The tempting collapse. A complete scan at 10:00 says "no 429 found" and
       says nothing whatever about an hour in which no record arrived. Joining
       the line across it would claim continuous observation of a period nobody
       observed. */
    const plot = plotUsageHistory(
      view([sample(T0, { conclusive: true }), sample(T0 + 60 * 60 * 1000, { conclusive: true })]),
    );
    expect(plot.recorderGaps).toHaveLength(1);
    expect(plot.accounts[0]?.windows[0]?.breaks).toHaveLength(1);
  });

  it("breaks the series across an unsupported record rather than closing over it", () => {
    /* A record written by a newer build. Removing it would let the chart join
       the point before to the point after and claim it observed the interval. */
    const plot = plotUsageHistory(
      view(
        [
          sample(T0),
          { kind: "unsupported", summarySchema: 2, why: "written by summarySchema 2" },
          sample(T0 + FIVE_MIN),
        ],
        { unsupportedLines: 1 },
      ),
    );
    expect(plot.unsupportedLines).toBe(1);
    expect(plot.accounts[0]?.windows[0]?.breaks.length).toBeGreaterThan(0);
  });

  it("breaks the series across a collector failure", () => {
    const failed: UsageHistorySample = {
      kind: "sample",
      sourceAtMs: T0 + FIVE_MIN,
      line: {
        nextDueMs: FIVE_MIN,
        recordedAt: new Date(T0 + FIVE_MIN).toISOString(),
        pass: { kind: "collector-failed", at: new Date(T0 + FIVE_MIN).toISOString(), why: "ENOENT" },
      },
    };
    const plot = plotUsageHistory(view([sample(T0), failed, sample(T0 + 2 * FIVE_MIN)]));
    expect(plot.accounts[0]?.windows[0]?.breaks.length).toBeGreaterThan(0);
  });

  it("marks 'before history began' as its own region, distinct from a hole", () => {
    /* Nothing was ever recorded then, versus something was and we lost it. */
    const plot = plotUsageHistory(view([sample(T0)]));
    expect(plot.beforeHistory).toEqual({ fromMs: T0 - 24 * 60 * 60 * 1000, toMs: T0 });

    /* With a predecessor there IS earlier data, so the region is not claimed. */
    const withPred = plotUsageHistory(view([sample(T0)], { predecessor: sample(T0 - 60 * 60 * 1000) }));
    expect(withPred.beforeHistory).toBeNull();
  });

  it("REPORTS a clock regression and breaks the line, never sorts it away", () => {
    /* An NTP step backwards moves the source and the record instants together,
       so neither alone detects it. Preserve file order, break, and say so —
       smoothing it into plausibility hides the one condition worth seeing. */
    const plot = plotUsageHistory(view([sample(T0 + FIVE_MIN), sample(T0)]));
    expect(plot.clockRegressions).toEqual([{ fromMs: T0, toMs: T0 + FIVE_MIN }]);
    expect(plot.accounts[0]?.windows[0]?.breaks.length).toBeGreaterThan(0);
    /* The points stay in file order rather than being re-sorted. */
    expect(plot.accounts[0]?.windows[0]?.points.map((p) => p.atMs)).toEqual([T0 + FIVE_MIN, T0]);
  });
});

describe("what GPT Sol's code review found", () => {
  it("H6: breaks the series across a line the store could not read", () => {
    /* `view.holes` was carried faithfully from the store, through the route,
       into the client — and then ignored here, so the chart drew straight over
       bytes this build could not parse. */
    const plot = plotUsageHistory(
      view([sample(T0), sample(T0 + FIVE_MIN)], {
        holes: [{ afterAt: new Date(T0).toISOString(), beforeAt: new Date(T0 + FIVE_MIN).toISOString() }],
        unreadableLines: 1,
      }),
    );
    const series = plot.accounts[0]?.windows[0];
    expect(series?.breaks.length).toBeGreaterThan(0);
    /* And the runs are split, which is what the renderer actually draws. */
    expect(series?.runs.filter((r) => r.length > 0)).toHaveLength(2);
  });

  it("H7: a clock regression splits the RUNS, not just the breaks list", () => {
    /* The renderer used to re-derive runs by comparing timestamps, and for
       file-order points 10:05 then 10:00 its predicate asked `10:05 < 10:00`,
       got false, and drew one line across the regression it had just shaded. */
    const plot = plotUsageHistory(view([sample(T0 + FIVE_MIN), sample(T0)]));
    const series = plot.accounts[0]?.windows[0];
    expect(plot.clockRegressions).toHaveLength(1);
    expect(series?.runs.filter((r) => r.length > 0)).toHaveLength(2);
  });

  it("H8: an incident that ENDED before the window is not in the window", () => {
    /* They were all kept, and the renderer clamped a negative start to zero
       while computing width from two negative coordinates — a visible bar at the
       left edge for rejections that happened before the chart begins. */
    const longAgo = new Date(T0 - 40 * 60 * 60 * 1000).toISOString();
    const alsoLongAgo = new Date(T0 - 39 * 60 * 60 * 1000).toISOString();
    const plot = plotUsageHistory(
      view([sample(T0, { incidents: [incident({ firstHitAt: longAgo, lastHitAt: alsoLongAgo })] })]),
    );
    expect(plot.incidents).toEqual([]);
  });

  it("H8: one that STRADDLES the left edge is kept, and says it began earlier", () => {
    const before = new Date(T0 - 40 * 60 * 60 * 1000).toISOString();
    const plot = plotUsageHistory(
      view([sample(T0, { incidents: [incident({ firstHitAt: before, lastHitAt: new Date(T0).toISOString() })] })]),
    );
    expect(plot.incidents).toHaveLength(1);
    expect(plot.incidents[0]?.beganBeforeWindow).toBe(true);
  });

  it("H9: two sightings disagreeing about the window make it unreadable", () => {
    /* The browser had its own merge that never checked the invariants and
       published the first label with merged counts. One implementation now. */
    const plot = plotUsageHistory(
      view([
        sample(T0, { incidents: [incident({ window: "five_hour" })] }),
        sample(T0 + FIVE_MIN, { incidents: [incident({ window: "seven_day" })] }),
      ]),
    );
    expect(plot.incidents).toHaveLength(1);
    expect(plot.incidents[0]?.unreadable).toBe(true);
  });
});

describe("incidents", () => {
  it("draws one incident per cluster however many records carried it", () => {
    /* The same rejection sits in every five-minute scan until it expires. One
       mark per sample would draw 288 rejections for one event. */
    const plot = plotUsageHistory(
      view([
        sample(T0, { incidents: [incident()] }),
        sample(T0 + FIVE_MIN, { incidents: [incident()] }),
        sample(T0 + 2 * FIVE_MIN, { incidents: [incident()] }),
      ]),
    );
    expect(plot.incidents).toHaveLength(1);
  });

  it("places it at WHEN IT HAPPENED, not when history first saw it", () => {
    const first = new Date(T0 - 3 * 60 * 60 * 1000).toISOString();
    const plot = plotUsageHistory(view([sample(T0, { incidents: [incident({ firstHitAt: first })] })]));
    expect(plot.incidents[0]?.fromMs).toBe(Date.parse(first));
  });

  it("says an incident BEGAN BEFORE the window rather than clipping it to the edge", () => {
    /* The scan looks back eight days, so this is common. Clipping would claim
       the rejections started at the left edge of the chart. */
    const before = new Date(T0 - 40 * 60 * 60 * 1000).toISOString();
    const plot = plotUsageHistory(view([sample(T0, { incidents: [incident({ firstHitAt: before })] })]));
    expect(plot.incidents[0]?.beganBeforeWindow).toBe(true);
  });

  it("keeps an incident with no hit time UNPLACED rather than pinning it to scan time", () => {
    const plot = plotUsageHistory(
      view([sample(T0, { incidents: [incident({ firstHitAt: null, lastHitAt: null })] })]),
    );
    expect(plot.incidents[0]).toMatchObject({ unplaced: true, fromMs: null });
  });

  it("takes counts from a scan that FINISHED, even when a partial one saw more", () => {
    const plot = plotUsageHistory(
      view([
        sample(T0, { conclusive: false, incidents: [incident({ rejections: 40, conversations: 30 })] }),
        sample(T0 + FIVE_MIN, { conclusive: true, incidents: [incident({ rejections: 27, conversations: 16 })] }),
      ]),
    );
    expect(plot.incidents[0]).toMatchObject({ rejections: 27, conversations: 16, fromConclusiveScan: true });
  });

  it("carries NO account identity on an incident, however many accounts are plotted", () => {
    /* A transcript 429 has no account id, and the scan spans eight days that may
       cross a /login swap. Splitting these by account would manufacture
       attribution the data cannot support. */
    const plot = plotUsageHistory(
      view([
        sample(T0, { accountUuid: "acct-A", incidents: [incident()] }),
        sample(T0 + FIVE_MIN, { accountUuid: "acct-B", incidents: [incident()] }),
      ]),
    );
    expect(plot.accounts).toHaveLength(2);
    expect(plot.incidents).toHaveLength(1);
    expect(JSON.stringify(plot.incidents)).not.toMatch(/acct-/);
  });
});
