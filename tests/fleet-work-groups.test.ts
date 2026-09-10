/**
 * The pure reduction from the Overseer's validated pane readings to the
 * bounded shape a history can retain.
 *
 * These tests begin after `resolveWork`: parser and inventory failures belong
 * to overseer-status.test.ts, while this file pins what one accepted scan says.
 */
import { describe, expect, it } from "vitest";

import type { HealthReport } from "../tools/fleet/health.js";
import { MAX_FILE_BYTES, sampleLine } from "../tools/fleet/health-history.js";
import { MAX_STORED_WORK_BYTES, projectStoredWork } from "../tools/fleet/work-groups.js";
import type { PaneJob, PaneWork } from "../tools/fleet/wire.js";

const SCANNED_AT = "2026-09-10T10:30:00.000Z";
const CHECKED_AT = "2026-09-10T10:31:00.000Z";

function encodedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function pessimisticHealthReport(): HealthReport {
  return {
    load: { kind: "value", load1: 72.5, load5: 61, load15: 44, cores: 16, ratio1: 72.5 / 16 },
    memory: {
      kind: "value",
      totalBytes: 32_000_000_000,
      availableBytes: 1_400_000_000,
      availableFraction: 0.04375,
    },
    swap: {
      kind: "value",
      totalBytes: 34_000_000_000,
      usedBytes: 33_500_000_000,
      usedFraction: 33.5 / 34,
      areas: 2,
    },
    disk: { kind: "value", totalKiB: 150_000_000, usedKiB: 146_000_000, availableKiB: 4_000_000, usePercent: 97 },
    swapActivity: { kind: "value", siKBs: 18_000, soKBs: 9_000, waPercent: 63, activelySwapping: true },
    attribution: {
      kind: "value",
      groups: [
        { kind: "vitest", procs: 38, rssKiB: 8_518_356 },
        { kind: "vite", procs: 12, rssKiB: 2_518_356 },
        { kind: "chrome", procs: 18, rssKiB: 4_518_356 },
        { kind: "node", procs: 20, rssKiB: 6_518_356 },
        { kind: "other", procs: 9, rssKiB: 1_518_356 },
      ],
    },
    verdict: {
      level: "critical",
      reasons: [
        "the one-minute load average is more than four times the available core count",
        "less than five percent of memory remains available after reclaimable cache",
        "more than ninety-eight percent of configured swap is resident",
        "the root filesystem is at the critical disk-use boundary",
        "the sampled CPU interval spent more than half its time waiting for IO",
      ],
    },
    collectedAt: "2026-09-10T10:30:00.000Z",
    tookMs: 29_874,
  };
}

function job(over: Partial<PaneJob> = {}): PaneJob {
  return {
    recogniser: "codex-exec",
    label: "GPT review or task (non-interactive codex)",
    startedAt: "2026-09-10T10:12:00.000Z",
    ranForMs: 18 * 60_000,
    pid: 8_123,
    depth: 8,
    command: "codex exec",
    ...over,
  };
}

function working(jobs: readonly [PaneJob, ...PaneJob[]], inspected = 24): PaneWork {
  return {
    kind: "work",
    jobs,
    inspected,
    paneCommand: "claude",
    paneStartedAt: "2026-09-10T08:00:00.000Z",
  };
}

function scan(panes: ReadonlyMap<string, PaneWork>) {
  return projectStoredWork({ kind: "scanned", scannedAt: SCANNED_AT, panes }, CHECKED_AT);
}

describe("projectStoredWork", () => {
  it("preserves the resolver's own reason when no scan is available", () => {
    expect(projectStoredWork({
      kind: "unavailable",
      source: {
        kind: "probe-failed",
        attemptedAt: "2026-09-10T10:29:00.000Z",
        sourceCollectedAt: "2026-09-10T10:28:30.000Z",
      },
      why: "ps was denied by the kernel",
    }, CHECKED_AT)).toEqual({
      kind: "probe-failed",
      attemptedAt: "2026-09-10T10:29:00.000Z",
      sourceCollectedAt: "2026-09-10T10:28:30.000Z",
      why: "ps was denied by the kernel",
    });
  });

  it("counts one recognised job with several descendants as one group and one job", () => {
    /* The pane walk stops at a recognised wrapper, so the high inspected count
       and depth-eight leaf are evidence of a large tree, not extra jobs. */
    const result = scan(new Map([["session-review", working([job()], 31)]]));

    expect(result).toEqual({
      kind: "scan",
      scannedAt: SCANNED_AT,
      groups: [
        {
          session: "session-review",
          recogniser: "codex-exec",
          jobs: 1,
          timing: {
            kind: "known",
            oldestStartedAt: "2026-09-10T10:12:00.000Z",
            longestRanForMs: 18 * 60_000,
          },
        },
      ],
      groupsDropped: 0,
      panes: { work: 1, none: 0, cannotTell: 0 },
    });
  });

  it("groups two jobs of one recogniser under one pane", () => {
    const result = scan(new Map([
      [
        "session-pair",
        working([
          job({ pid: 8_124, startedAt: "2026-09-10T10:20:00.000Z", ranForMs: 10 * 60_000 }),
          job({ pid: 8_125, startedAt: "2026-09-10T10:05:00.000Z", ranForMs: 25 * 60_000 }),
        ]),
      ],
    ]));

    expect(result.kind).toBe("scan");
    if (result.kind !== "scan") return;
    expect(result.groups).toEqual([
      {
        session: "session-pair",
        recogniser: "codex-exec",
        jobs: 2,
        timing: {
          kind: "known",
          oldestStartedAt: "2026-09-10T10:05:00.000Z",
          longestRanForMs: 25 * 60_000,
        },
      },
    ]);
  });

  it("keeps different recognisers under one pane as different groups", () => {
    const result = scan(new Map([
      [
        "session-mixed-work",
        working([
          job({ recogniser: "vitest", label: "Test suite", pid: 8_126, ranForMs: 5 * 60_000 }),
          job({ recogniser: "codex-exec", pid: 8_127, ranForMs: 20 * 60_000 }),
        ]),
      ],
    ]));

    expect(result.kind).toBe("scan");
    if (result.kind !== "scan") return;
    expect(result.groups.map((group) => [group.recogniser, group.jobs])).toEqual([
      ["codex-exec", 1],
      ["vitest", 1],
    ]);
  });

  it("counts a cannot-tell pane without turning it into work or a group", () => {
    const result = scan(new Map([
      ["session-unreadable", { kind: "cannot-tell", cause: "pane-not-in-table", why: "the pane exited" }],
    ]));

    expect(result.kind).toBe("scan");
    if (result.kind !== "scan") return;
    expect(result.groups).toEqual([]);
    expect(result.panes).toEqual({ work: 0, none: 0, cannotTell: 1 });
  });

  it("keeps a measured none with many inspected processes distinct from unreadable", () => {
    const result = scan(new Map([
      [
        "session-quiet",
        { kind: "none", inspected: 25, paneCommand: "claude", paneStartedAt: "2026-09-10T08:00:00.000Z" },
      ],
    ]));

    expect(result.kind).toBe("scan");
    if (result.kind !== "scan") return;
    expect(result.groups).toEqual([]);
    expect(result.panes).toEqual({ work: 0, none: 1, cannotTell: 0 });
  });

  it("partitions every pane between work, none and cannot-tell", () => {
    const panes = new Map<string, PaneWork>([
      ["session-work-a", working([job({ pid: 8_128 })])],
      ["session-work-b", working([job({ pid: 8_129 })])],
      ["session-none", { kind: "none", inspected: 7, paneCommand: "claude", paneStartedAt: "2026-09-10T08:00:00.000Z" }],
      ["session-unknown", { kind: "cannot-tell", cause: "no-pane-pid", why: "the inventory carried no pane pid" }],
    ]);

    const result = scan(panes);
    expect(result.kind).toBe("scan");
    if (result.kind !== "scan") return;
    expect(result.panes).toEqual({ work: 2, none: 1, cannotTell: 1 });
    expect(result.panes.work + result.panes.none + result.panes.cannotTell).toBe(panes.size);
  });

  it("ranks by jobs, then longest run, then session and reports every byte-budget drop", () => {
    const panes = new Map<string, PaneWork>();
    for (let i = 30; i >= 0; i -= 1) {
      panes.set(
        `session-${String(i).padStart(2, "0")}`,
        working([job({ pid: 9_000 + i, ranForMs: 5 * 60_000 })]),
      );
    }
    panes.set("zz-longest", working([job({ pid: 9_100, ranForMs: 99 * 60_000 })]));
    panes.set("zz-two-jobs", working([
      job({ pid: 9_101, ranForMs: 1 }),
      job({ pid: 9_102, ranForMs: 1 }),
    ]));

    const result = scan(panes);
    expect(result.kind).toBe("scan");
    if (result.kind !== "scan") return;
    expect(result.groupsDropped).toBeGreaterThan(0);
    expect(result.groups.length + result.groupsDropped).toBe(33);
    expect(encodedBytes(result)).toBeLessThanOrEqual(MAX_STORED_WORK_BYTES);
    expect(result.groups.slice(0, 3).map((group) => group.session)).toEqual([
      "zz-two-jobs",
      "zz-longest",
      "session-00",
    ]);
    expect(result.groups.map((group) => group.session)).not.toContain("session-30");
  });

  it("drops lowest-ranked enormous groups until the encoded value fits the byte budget", () => {
    const panes = new Map<string, PaneWork>();
    for (let i = 0; i < 40; i += 1) {
      panes.set(
        `${String(i).padStart(2, "0")}-${"session".repeat(2_000)}`,
        working([job({ recogniser: `recogniser-${"wide".repeat(2_000)}`, pid: 10_000 + i })]),
      );
    }

    const result = scan(panes);
    expect(result.kind).toBe("scan");
    if (result.kind !== "scan") return;
    expect(result.groupsDropped).toBeGreaterThan(0);
    expect(encodedBytes(result)).toBeLessThanOrEqual(MAX_STORED_WORK_BYTES);
  });

  it("visibly bounds unavailable reasons and every stored identifier", () => {
    const unavailable = projectStoredWork({
      kind: "unavailable",
      source: {
        kind: "probe-failed",
        attemptedAt: "2026-09-10T10:29:00.000Z",
        sourceCollectedAt: "2026-09-10T10:28:30.000Z",
      },
      why: "denied ".repeat(2_000),
    }, CHECKED_AT);
    expect(unavailable.kind).toBe("probe-failed");
    if (unavailable.kind === "probe-failed") expect(unavailable.why).toMatch(/truncated/);
    expect(encodedBytes(unavailable)).toBeLessThanOrEqual(MAX_STORED_WORK_BYTES);

    const identifiers = scan(new Map([["session ".repeat(2_000), working([
      job({ recogniser: "recogniser ".repeat(2_000) }),
    ])]]));
    expect(identifiers.kind).toBe("scan");
    if (identifiers.kind !== "scan") return;
    expect(identifiers.groups[0]?.session).toMatch(/truncated/);
    expect(identifiers.groups[0]?.recogniser).toMatch(/truncated/);
    expect(encodedBytes(identifiers)).toBeLessThanOrEqual(MAX_STORED_WORK_BYTES);
  });

  it("keeps a pessimistic day of health and maximum-sized work comfortably inside one rotation", () => {
    const panes = new Map<string, PaneWork>();
    for (let i = 0; i < 100; i += 1) {
      panes.set(
        `session-${String(i).padStart(3, "0")}`,
        working([job({ recogniser: `recogniser-${String(i).padStart(3, "0")}`, pid: 20_000 + i })]),
      );
    }
    const maximumWork = scan(panes);
    expect(maximumWork.kind).toBe("scan");
    const workBytes = encodedBytes(maximumWork);
    expect(workBytes).toBeGreaterThan(MAX_STORED_WORK_BYTES - 256);
    expect(workBytes).toBeLessThanOrEqual(MAX_STORED_WORK_BYTES);

    const healthBytes = Buffer.byteLength(sampleLine({
      schema: 1,
      at: "2026-09-10T10:30:00.000Z",
      nextDueMs: 60_000,
      kind: "reading",
      report: pessimisticHealthReport(),
    }), "utf8");
    const dueEnvelopeBytes = encodedBytes({ workTurn: { kind: "due", result: null } }) - encodedBytes(null);
    const notDueEnvelopeBytes = encodedBytes({ workTurn: { kind: "not-due" } });
    const healthSamples = 24 * 60;
    const workSamples = 24 * 60 / 5;
    const modeledDayBytes =
      healthSamples * healthBytes +
      workSamples * (dueEnvelopeBytes + workBytes) +
      (healthSamples - workSamples) * notDueEnvelopeBytes;

    expect(modeledDayBytes).toBeLessThan(MAX_FILE_BYTES / 2);
  });

  it("marks aggregates as partial when only some job timings are known", () => {
    const result = scan(new Map([
      [
        "session-partly-known",
        working([
          job({ pid: 9_200, startedAt: "2026-09-10T10:08:00.000Z", ranForMs: 22 * 60_000 }),
          job({ pid: 9_201, startedAt: null, ranForMs: null }),
        ]),
      ],
    ]));

    expect(result.kind).toBe("scan");
    if (result.kind !== "scan") return;
    expect(result.groups[0]?.timing).toEqual({
      kind: "partial",
      knownJobs: 1,
      oldestStartedAt: "2026-09-10T10:08:00.000Z",
      longestRanForMs: 22 * 60_000,
    });
  });

  it("marks all-unknown timing separately and does not rank it above a measured hour", () => {
    const result = scan(new Map([
      [
        "session-unknown-clocks",
        working([
          job({ pid: 9_202, startedAt: null, ranForMs: null }),
          job({ pid: 9_203, startedAt: null, ranForMs: null }),
        ]),
      ],
      [
        "session-known-hour",
        working([
          job({ pid: 9_204, startedAt: "2026-09-10T09:30:00.000Z", ranForMs: 60 * 60_000 }),
          job({ pid: 9_205, startedAt: "2026-09-10T09:30:00.000Z", ranForMs: 60 * 60_000 }),
        ]),
      ],
    ]));

    expect(result.kind).toBe("scan");
    if (result.kind !== "scan") return;
    expect(result.groups.map((group) => group.session)).toEqual([
      "session-known-hour",
      "session-unknown-clocks",
    ]);
    expect(result.groups[1]?.timing).toEqual({ kind: "unknown" });
  });
});
