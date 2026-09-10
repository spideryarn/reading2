/**
 * The pure reduction from the Overseer's validated pane readings to the
 * bounded shape a history can retain.
 *
 * These tests begin after `resolveWork`: parser and inventory failures belong
 * to overseer-status.test.ts, while this file pins what one accepted scan says.
 */
import { describe, expect, it } from "vitest";

import { MAX_GROUPS, projectStoredWork } from "../tools/fleet/work-groups.js";
import type { PaneJob, PaneWork } from "../tools/fleet/wire.js";

const SCANNED_AT = "2026-09-10T10:30:00.000Z";

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
  return projectStoredWork({ kind: "scanned", scannedAt: SCANNED_AT, panes });
}

describe("projectStoredWork", () => {
  it("preserves the resolver's own reason when no scan is available", () => {
    expect(projectStoredWork({ kind: "unavailable", why: "ps was denied by the kernel" })).toEqual({
      kind: "unavailable",
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
          oldestStartedAt: "2026-09-10T10:12:00.000Z",
          longestRanForMs: 18 * 60_000,
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
        oldestStartedAt: "2026-09-10T10:05:00.000Z",
        longestRanForMs: 25 * 60_000,
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

  it("caps groups by jobs, then longest run, then session and reports every dropped group", () => {
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
    expect(result.groups).toHaveLength(MAX_GROUPS);
    expect(result.groupsDropped).toBe(3);
    expect(result.groups.slice(0, 3).map((group) => group.session)).toEqual([
      "zz-two-jobs",
      "zz-longest",
      "session-00",
    ]);
    expect(result.groups.at(-1)?.session).toBe("session-27");
    expect(result.groups.map((group) => group.session)).not.toContain("session-28");
  });

  it("keeps the known minimum when only some job starts are known", () => {
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
    expect(result.groups[0]).toMatchObject({
      oldestStartedAt: "2026-09-10T10:08:00.000Z",
      longestRanForMs: 22 * 60_000,
    });
  });

  it("keeps all-unknown starts and durations null rather than manufacturing zero", () => {
    const result = scan(new Map([
      [
        "session-unknown-clocks",
        working([
          job({ pid: 9_202, startedAt: null, ranForMs: null }),
          job({ pid: 9_203, startedAt: null, ranForMs: null }),
        ]),
      ],
    ]));

    expect(result.kind).toBe("scan");
    if (result.kind !== "scan") return;
    expect(result.groups[0]).toMatchObject({ oldestStartedAt: null, longestRanForMs: null });
  });
});
