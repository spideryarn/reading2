/**
 * The work-history projection is where a carried checkpoint reading becomes
 * observations on the work scan's own clock. These tests pin that boundary:
 * a stale daemon must not manufacture activity merely because health kept
 * recording copies of its last answer.
 */
import { describe, expect, it } from "vitest";

import type { StoredWork, StoredWorkTurn } from "../tools/fleet/wire.js";
import type { WorkHistorySample, WorkHistoryView } from "../tools/fleet/web/src/work-series.js";
import {
  NEARBY_WORK_MS,
  projectWorkHistory,
} from "../tools/fleet/web/src/work-series.js";

const MINUTE = 60_000;
const T0 = Date.parse("2026-09-10T08:00:00.000Z");

function due(result: StoredWork): StoredWorkTurn {
  return { kind: "due", result };
}

function scan(
  scannedAtMs: number,
  groups: Extract<StoredWork, { kind: "scan" }>["groups"] = [],
  panes: Extract<StoredWork, { kind: "scan" }>["panes"] = { work: 0, none: 1, cannotTell: 0 },
): StoredWorkTurn {
  return due({
    kind: "scan",
    scannedAt: new Date(scannedAtMs).toISOString(),
    groups,
    groupsDropped: 0,
    panes,
  });
}

function reading(atMs: number, workTurn?: StoredWorkTurn, load = 1): WorkHistorySample {
  return {
    kind: "reading",
    atMs,
    nextDueMs: MINUTE,
    report: {
      load: { kind: "value", ratio1: load },
      attribution: {
        kind: "value",
        groups: [
          { kind: "node", procs: 5, rssKiB: 900 },
          { kind: "vitest", procs: 2, rssKiB: 1_500 },
        ],
      },
    },
    ...(workTurn === undefined ? {} : { workTurn }),
  };
}

function view(
  samples: WorkHistorySample[],
  over: Partial<WorkHistoryView> = {},
): WorkHistoryView {
  return {
    kind: "history",
    windowHours: 1,
    fromMs: T0,
    toMs: T0 + 60 * MINUTE,
    samples,
    predecessor: null,
    holes: [],
    earliestAtMs: samples[0]?.atMs ?? null,
    rotated: false,
    unreadableLines: 0,
    refreshMs: MINUTE,
    unreadableSamples: 0,
    retention: null,
    ...over,
  };
}

function loadPlot(atMs: number, value = 5) {
  return {
    fromMs: T0,
    toMs: T0 + 60 * MINUTE,
    windowHours: 1,
    series: [
      {
        spec: { key: "load" as const },
        worst: { atMs, value },
      },
    ],
  };
}

const codex = {
  session: "resource-history",
  sessionName: null,
  recogniser: "codex-exec",
  jobs: 3,
  timing: {
    kind: "known" as const,
    oldestStartedAt: "2026-09-10T07:20:00.000Z",
    longestRanForMs: 40 * MINUTE,
  },
};

describe("source observations", () => {
  it("counts three carrier samples with one scannedAt as one observation", () => {
    const scannedAt = T0 + 5 * MINUTE;
    const carried = [10, 15, 20].map((minute) =>
      reading(T0 + minute * MINUTE, scan(scannedAt, [codex], { work: 1, none: 0, cannotTell: 0 })),
    );

    const result = projectWorkHistory(view(carried), loadPlot(T0 + 15 * MINUTE));

    expect(result.kind).toBe("groups");
    if (result.kind !== "groups") throw new Error(`expected groups, got ${result.kind}`);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.observations).toHaveLength(1);
    expect(result.rows[0]?.observations[0]).toMatchObject({
      atMs: scannedAt,
      firstCarrierAtMs: T0 + 10 * MINUTE,
      carrierAtMs: [T0 + 10 * MINUTE, T0 + 15 * MINUTE, T0 + 20 * MINUTE],
    });
    expect(result.unchangedReadings).toEqual([
      { atMs: scannedAt, copies: 3, consecutiveCopies: 2 },
    ]);
  });

  it("recognises an unchanged scan across the not-due turns that separate normal work reads", () => {
    const scannedAt = T0 + 5 * MINUTE;
    const result = projectWorkHistory(
      view([
        reading(T0 + 10 * MINUTE, scan(scannedAt, [codex], { work: 1, none: 0, cannotTell: 0 })),
        reading(T0 + 11 * MINUTE, { kind: "not-due" }),
        reading(T0 + 15 * MINUTE, scan(scannedAt, [codex], { work: 1, none: 0, cannotTell: 0 })),
      ]),
      loadPlot(T0 + 12 * MINUTE),
    );

    expect(result.kind).toBe("groups");
    if (result.kind !== "groups") throw new Error(`expected groups, got ${result.kind}`);
    expect(result.unchangedReadings).toEqual([
      { atMs: scannedAt, copies: 2, consecutiveCopies: 1 },
    ]);
  });

  it("uses the scan clock and excludes a group whose only source event is outside the window", () => {
    const inside = T0 + 4 * MINUTE;
    const staleButInside = reading(
      T0 + 45 * MINUTE,
      scan(inside, [codex], { work: 1, none: 0, cannotTell: 0 }),
    );
    const projected = projectWorkHistory(view([staleButInside]), loadPlot(T0 + 45 * MINUTE));
    expect(projected.kind).toBe("groups");
    if (projected.kind === "groups") {
      expect(projected.rows[0]?.observations[0]?.atMs).toBe(inside);
      expect(projected.rows[0]?.observations[0]?.firstCarrierAtMs).toBe(T0 + 45 * MINUTE);
    }

    const expired = reading(
      T0 + 2 * MINUTE,
      scan(T0 - MINUTE, [codex], { work: 1, none: 0, cannotTell: 0 }),
    );
    expect(projectWorkHistory(view([expired]), loadPlot(T0 + 2 * MINUTE))).toMatchObject({
      kind: "no-records",
      reason: "no-source-events-in-window",
    });
  });

  it("deduplicates unavailable events by discriminant and source timestamp, then groups their reasons", () => {
    const attemptedAt = new Date(T0 + 6 * MINUTE).toISOString();
    const failed = due({
      kind: "probe-failed",
      attemptedAt,
      sourceCollectedAt: new Date(T0 + 5 * MINUTE).toISOString(),
      why: "ps timed out",
    });
    const checkedAt = new Date(T0 + 7 * MINUTE).toISOString();
    const checkpoint = due({ kind: "checkpoint-unavailable", checkedAt, why: "ps timed out" });

    const result = projectWorkHistory(
      view([
        reading(T0 + 10 * MINUTE, failed),
        reading(T0 + 15 * MINUTE, failed),
        reading(T0 + 20 * MINUTE, checkpoint),
      ]),
      loadPlot(T0 + 12 * MINUTE),
    );

    expect(result.kind).toBe("all-unavailable");
    if (result.kind !== "all-unavailable") throw new Error(`expected unavailable, got ${result.kind}`);
    expect(result.observations).toHaveLength(2);
    expect(result.observations.map((item) => item.source)).toEqual(["probe-failed", "checkpoint-unavailable"]);
    expect(result.reasons).toEqual([{ kind: "source", why: "ps timed out", observations: 2 }]);
    /* The required repeated-reading sentence is specifically evidence about a
       repeated successful `scannedAt`; a repeated failed attempt remains one
       unavailable observation but is not mislabelled as a repeated scan. */
    expect("unchangedReadings" in result).toBe(false);
  });

  it("keeps different source discriminants separate even when their timestamps match", () => {
    const at = T0 + 6 * MINUTE;
    const result = projectWorkHistory(
      view([
        reading(T0 + 7 * MINUTE, due({ kind: "not-yet-run", asOf: new Date(at).toISOString(), why: "starting" })),
        reading(T0 + 8 * MINUTE, scan(at)),
      ]),
      loadPlot(T0 + 8 * MINUTE),
    );

    expect(result.kind).toBe("empty-scan");
    if (result.kind !== "empty-scan") throw new Error(`expected empty scan, got ${result.kind}`);
    expect(result.scans).toHaveLength(1);
    expect(result.unavailable).toMatchObject([{ source: "not-yet-run", atMs: at }]);
  });
});

describe("rows and honest empty states", () => {
  it("ranks by the longest measured run and preserves partial and unknown timing arms", () => {
    const groups: Extract<StoredWork, { kind: "scan" }>["groups"] = [
      {
        session: "partial",
        sessionName: null,
        recogniser: "vitest",
        jobs: 4,
        timing: {
          kind: "partial",
          knownJobs: 2,
          oldestStartedAt: "2026-09-10T07:00:00.000Z",
          longestRanForMs: 50 * MINUTE,
        },
      },
      codex,
      { session: "unknown", sessionName: null, recogniser: "vite", jobs: 1, timing: { kind: "unknown" } },
    ];
    const result = projectWorkHistory(
      view([reading(T0 + 10 * MINUTE, scan(T0 + 9 * MINUTE, groups, { work: 3, none: 0, cannotTell: 0 }))]),
      loadPlot(T0 + 10 * MINUTE),
    );

    expect(result.kind).toBe("groups");
    if (result.kind !== "groups") throw new Error(`expected groups, got ${result.kind}`);
    expect(result.rows.map((row) => [row.rank, row.session, row.label, row.longest.timing.kind])).toEqual([
      [1, "partial", "Test suite", "partial"],
      [2, "resource-history", "GPT review or task", "known"],
      [3, "unknown", "vite", "unknown"],
    ]);
    expect(result.rows[0]?.longest).toMatchObject({ jobs: 4, timing: { kind: "partial", knownJobs: 2 } });
  });

  it("keeps pre-retention, no due turn, unavailable, and a successful empty scan apart", () => {
    expect(projectWorkHistory(view([]), loadPlot(T0 + MINUTE))).toMatchObject({
      kind: "no-records",
      reason: "no-health-samples-in-window",
    });
    expect(projectWorkHistory(view([reading(T0 + MINUTE)]), loadPlot(T0 + MINUTE))).toMatchObject({
      kind: "no-records",
      reason: "work-retention-newer-than-window",
    });
    expect(
      projectWorkHistory(
        view([reading(T0 + MINUTE, { kind: "not-due" })]),
        loadPlot(T0 + MINUTE),
      ),
    ).toMatchObject({ kind: "no-records", reason: "no-due-turn-in-window" });
    expect(
      projectWorkHistory(
        view([reading(T0 + MINUTE, scan(T0 + MINUTE))]),
        loadPlot(T0 + MINUTE),
      ),
    ).toMatchObject({ kind: "empty-scan", scans: [{ atMs: T0 + MINUTE }] });
  });
});

describe("the peak's three clocks", () => {
  it("keeps the load clock, nearest work clock, and same-turn attribution distinct", () => {
    const loadAt = T0 + 30 * MINUTE;
    const workAt = loadAt - 4 * MINUTE;
    const result = projectWorkHistory(
      view([reading(loadAt, scan(workAt, [codex], { work: 1, none: 0, cannotTell: 0 }), 9)]),
      loadPlot(loadAt, 9),
    );

    expect(result.peak).toMatchObject({
      kind: "peak",
      loadAtMs: loadAt,
      load: 9,
      nearestWork: { kind: "nearby", atMs: workAt, deltaMs: -4 * MINUTE },
      attribution: {
        kind: "value",
        groups: [
          { kind: "vitest", procs: 2, rssKiB: 1_500 },
          { kind: "node", procs: 5, rssKiB: 900 },
        ],
      },
    });
  });

  it("does not reach beyond the named nearby window for a work scan", () => {
    const loadAt = T0 + 30 * MINUTE;
    const result = projectWorkHistory(
      view([
        reading(
          loadAt,
          scan(loadAt - NEARBY_WORK_MS - 1, [codex], { work: 1, none: 0, cannotTell: 0 }),
          9,
        ),
      ]),
      loadPlot(loadAt, 9),
    );
    expect(result.peak).toMatchObject({ kind: "peak", nearestWork: { kind: "none" } });
  });
});
