// @vitest-environment jsdom
/**
 * The work strip is an evidence display, not an activity inference.
 *
 * These tests keep its three clocks separate (health sample, work scan, job
 * timing), and keep "looked and found nothing" separate from every kind of
 * missing or unreadable observation.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { THRESHOLDS } from "../tools/fleet/web/src/health-view";
import { parseSample, type HealthSampleView, type HistoryView } from "../tools/fleet/web/src/health-history-client";
import { plotHistory, SERIES } from "../tools/fleet/web/src/history-series";
import { WorkHistory } from "../tools/fleet/web/src/WorkHistory";
import type { StoredWorkGroup, StoredWorkTurn } from "../tools/fleet/wire";

const START = Date.parse("2026-09-10T08:00:00.000Z");
const MINUTE = 60_000;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function group(overrides: Partial<StoredWorkGroup> = {}): StoredWorkGroup {
  return {
    session: "resource-history",
    recogniser: "vitest",
    jobs: 1,
    timing: {
      kind: "known",
      oldestStartedAt: new Date(START - 12 * MINUTE).toISOString(),
      longestRanForMs: 12 * MINUTE,
    },
    ...overrides,
  };
}

function dueScan(scannedAtMs: number, groups: StoredWorkGroup[], cannotTell = 0, groupsDropped = 0): StoredWorkTurn {
  return {
    kind: "due",
    result: {
      kind: "scan",
      scannedAt: new Date(scannedAtMs).toISOString(),
      groups,
      groupsDropped,
      panes: { work: groups.length, none: groups.length === 0 ? 2 : 0, cannotTell },
    },
  };
}

function sample(atMs: number, workTurn?: StoredWorkTurn, overrides: Record<string, unknown> = {}): HealthSampleView {
  const report = {
    load: { kind: "value", ratio1: 0.7 },
    memory: { kind: "value", availableFraction: 0.5 },
    swap: { kind: "value", usedFraction: 0.7 },
    swapActivity: { kind: "value", activelySwapping: false, waPercent: 2 },
    disk: { kind: "value", usePercent: 55 },
    attribution: { kind: "value", groups: [] },
    verdict: { level: "ok", reasons: [] },
    ...overrides,
  };
  return { kind: "reading", atMs, nextDueMs: 73_000, report, ...(workTurn === undefined ? {} : { workTurn }) };
}

function view(samples: HealthSampleView[], hours = 1): HistoryView {
  return {
    kind: "history",
    windowHours: hours,
    fromMs: START,
    toMs: START + hours * 60 * MINUTE,
    samples,
    predecessor: null,
    holes: [],
    earliestAtMs: samples[0]?.atMs ?? null,
    rotated: false,
    unreadableLines: 0,
    refreshMs: 73_000,
    unreadableSamples: 0,
    retention: null,
  };
}

function label(ms: number): string {
  return `T+${Math.round((ms - START) / MINUTE)}m`;
}

describe("work history", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(history: HistoryView): void {
    if (history.kind !== "history") throw new Error("test fixture must be history");
    const plot = plotHistory(history, history.toMs);
    act(() => root.render(<WorkHistory view={history} plot={plot} at={label} />));
  }

  it("uses the scan clock and calls out a stale reading instead of placing it on its carrier sample", () => {
    render(view([sample(START + 20 * MINUTE, dueScan(START, [group()]))]));

    expect(host.textContent).toContain("observed at T+0m — 20 minutes before this point");
    expect(host.textContent).not.toContain("observed at T+20m");
  });

  it("draws one source sighting for repeated carriers and says the reading did not change", () => {
    const turn = dueScan(START + 5 * MINUTE, [group()]);
    render(view([
      sample(START + 5 * MINUTE, turn),
      sample(START + 10 * MINUTE, turn),
      sample(START + 15 * MINUTE, turn),
    ]));

    expect(host.textContent).toContain("This reading is the same one as the previous sample's");
    expect(host.textContent).toContain("3 carrier samples, one observation");
    expect(host.querySelectorAll('svg[aria-label*="resource-history"] rect')).toHaveLength(1);
  });

  it("distinguishes a successful empty scan from a window with no work records", () => {
    render(view([sample(START + 5 * MINUTE, dueScan(START + 5 * MINUTE, []))]));
    expect(host.textContent).toContain("Nothing recognised was running");
    expect(host.textContent).not.toContain("No work records in this window");
  });

  it("explains when work retention is newer than the requested window", () => {
    render(view([sample(START + 5 * MINUTE)]));
    expect(host.textContent).toContain("No work records in this window");
    expect(host.textContent).toContain("Work retention is newer than this window");
  });

  it("does not claim an exact five-minute cadence across dashboard restarts", () => {
    render(view([sample(START + 5 * MINUTE, dueScan(START + 5 * MINUTE, []))]));

    expect(host.textContent).toContain("about every five minutes during an uninterrupted dashboard run, and once on startup");
    expect(host.textContent).not.toContain("Sampled every five minutes:");
  });

  it("keeps a valid health reading when only its work envelope is unreadable, and says so", () => {
    const health = sample(START);
    if (health.kind !== "reading") throw new Error("test fixture must be a reading");
    const parsed = parseSample({
      at: new Date(START + 5 * MINUTE).toISOString(),
      nextDueMs: 73_000,
      kind: "reading",
      report: health.report,
      workTurn: { kind: "a-new-work-turn-this-page-does-not-understand" },
    });

    expect(parsed).not.toBeNull();
    if (parsed === null) return;
    expect(parsed.kind).toBe("reading");
    render(view([parsed]));
    expect(host.textContent).toContain("Every work record in this window was unavailable");
    expect(host.textContent).toContain("1 unreadable work record");
  });

  it("excludes expired source events and names the actual short window", () => {
    render(view([sample(START + 5 * MINUTE, dueScan(START - MINUTE, [group()]))], 1));
    expect(host.textContent).not.toContain("resource-history");
    expect(host.textContent).toContain("0 distinct work observations in this 60 min window");
    expect(host.textContent).not.toContain("24 hour window");
  });

  it("groups the daemon's unavailable reasons instead of repeating carrier copies", () => {
    const failed: StoredWorkTurn = {
      kind: "due",
      result: {
        kind: "probe-failed",
        attemptedAt: new Date(START + 5 * MINUTE).toISOString(),
        sourceCollectedAt: new Date(START + 4 * MINUTE).toISOString(),
        why: "ps timed out",
      },
    };
    render(view([sample(START + 5 * MINUTE, failed), sample(START + 10 * MINUTE, failed)]));
    expect(host.textContent).toContain("Every work record in this window was unavailable");
    expect(host.textContent?.match(/ps timed out/g)).toHaveLength(1);
  });

  it("keeps partial timing and unreadable panes visible only when they occurred", () => {
    const partial = group({
      jobs: 3,
      timing: {
        kind: "partial",
        knownJobs: 2,
        oldestStartedAt: new Date(START - 12 * MINUTE).toISOString(),
        longestRanForMs: 12 * MINUTE,
      },
    });
    render(view([sample(START + 5 * MINUTE, dueScan(START + 5 * MINUTE, [partial], 2))]));

    expect(host.textContent).toContain("Timing was unavailable for 1 of these jobs");
    expect(host.textContent).toContain("2 panes could not be read at this sample");
  });

  it("says when the byte budget omitted lower-ranked groups from a scan", () => {
    render(view([sample(START + 5 * MINUTE, dueScan(START + 5 * MINUTE, [group()], 0, 2))]));

    expect(host.textContent).toContain("2 lower-ranked groups were omitted from this scan to keep the stored reading bounded");
  });

  it("does not print conditional uncertainty when every pane and timing was readable", () => {
    render(view([sample(START + 5 * MINUTE, dueScan(START + 5 * MINUTE, [group()]))]));
    expect(host.textContent).not.toContain("Timing was unavailable");
    expect(host.textContent).not.toContain("panes could not be read");
  });

  it("names the load clock, bounds the nearby scan, and describes attribution as the same survey turn", () => {
    const peakAt = START + 30 * MINUTE;
    render(
      view([
        sample(START + 10 * MINUTE, dueScan(START + 10 * MINUTE, [group()])),
        sample(peakAt, dueScan(peakAt - 3 * MINUTE, [group()]), {
          load: { kind: "value", ratio1: 5.4 },
          attribution: {
            kind: "value",
            groups: [
              { kind: "vitest", procs: 3, rssKiB: 1_200_000 },
              { kind: "node", procs: 1, rssKiB: 300_000 },
            ],
          },
        }),
      ]),
    );

    expect(host.textContent).toContain("The peak line names the load sample's timestamp: T+30m");
    expect(host.textContent).toContain("observed at T+27m — 3 minutes before the load reading");
    expect(host.textContent).toContain("collected in the same health survey turn");
    expect(host.textContent).toContain("vitest");
  });

  it("does not reach beyond the named nearby window for a work scan", () => {
    render(
      view([
        sample(START + 2 * MINUTE, dueScan(START + 2 * MINUTE, [group()])),
        sample(START + 30 * MINUTE, { kind: "not-due" }, { load: { kind: "value", ratio1: 5.4 } }),
      ]),
    );
    expect(host.textContent).toMatch(/no nearby work reading exists/i);
    expect(host.textContent).not.toContain("28 minutes before the load reading");
  });
});

describe("the fifth health series", () => {
  it("uses the policy disk bands, a fixed 0–100 axis, and clips values above it", () => {
    const disk = SERIES.find((spec) => spec.key === "disk");
    expect(disk).toMatchObject({ max: 100, bands: THRESHOLDS.diskUsed });
    expect(disk?.mark).toBeUndefined();

    const history = view([sample(START + MINUTE, undefined, { disk: { kind: "value", usePercent: 130 } })]);
    if (history.kind !== "history") throw new Error("test fixture must be history");
    const plotted = plotHistory(history, history.toMs).series.find((series) => series.spec.key === "disk");
    expect(plotted?.overCeiling).toHaveLength(1);
    expect(plotted?.overCeiling[0]?.fromMs).toBe(START + MINUTE);
  });

  it("does not turn quiet swap residency into an activity event", () => {
    const history = view([sample(START + MINUTE)]);
    if (history.kind !== "history") throw new Error("test fixture must be history");
    const io = plotHistory(history, history.toMs).series.find((series) => series.spec.key === "io");
    expect(io?.marks).toEqual([]);
  });
});
