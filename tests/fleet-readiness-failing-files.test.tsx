// @vitest-environment jsdom
/**
 * **The browser half of "which test files failed".**
 *
 * The record now names them
 * (docs/plans/261006m-seventh-sweep-readiness-records-name-the-failing-test-files.md);
 * these are the ways the page could say more than the record does — an empty
 * list drawn as "none failed", names beside a pass, a run with no names
 * vanishing from the count so the day looks cleaner than it was.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ReadinessPanel } from "../tools/fleet/web/src/ReadinessPanel";
import {
  failingFilesOverDay,
  parseReadiness,
  type ReadinessApi,
  type ReadinessView,
} from "../tools/fleet/web/src/readiness-client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SHA = "1111111111111111111111111111111111111111";
const NOW = Date.parse("2026-09-09T06:00:00.000Z");
const HOUR = 60 * 60 * 1000;

/** One reading as the server sends it, `hoursAgo` before the collection. */
function sent(hoursAgo: number, over: { state?: string; record?: Record<string, unknown> } = {}): unknown {
  return {
    atMs: NOW - hoursAgo * HOUR,
    state: over.state ?? "fail",
    why: null,
    record: {
      runId: `run-${hoursAgo}`,
      check: "check",
      scope: "full",
      source: "wrapper",
      treeAtStart: { kind: "known", sha: SHA, branch: "dev", dirty: false },
      treeAtEnd: { kind: "known", sha: SHA, branch: "dev", dirty: false },
      ...over.record,
    },
  };
}

function view(readings: unknown[]): Extract<ReadinessView, { kind: "readiness" }> {
  const parsed = parseReadiness({
    schema: 1,
    kind: "readiness",
    collectedAt: "2026-09-09T06:00:00.000Z",
    windowHours: 24,
    refreshMs: 120_000,
    readings,
    verdict: { kind: "unknown", why: "…", sha: SHA, evidence: [] },
    dev: { kind: "known", devSha: SHA, primarySha: SHA, primaryBehind: 0, trunkGap: 3, observedAt: "…", caveat: "…" },
    diagnostics: {
      unreadableRecords: [],
      unreadableLogs: [],
      unreadableRoots: [],
      scanTruncated: false,
      rootsTruncated: false,
      logsSkippedForBudget: 0,
      checkoutsScanned: 13,
      storeRefused: null,
      tmuxWhy: null,
    },
  });
  if (parsed.kind !== "readiness") throw new Error(`the fixture did not parse: ${JSON.stringify(parsed)}`);
  return parsed;
}

const names = (files: string[], total = files.length) => ({ failedTestFiles: { files, total } });

describe("reading the names off the wire", () => {
  it("keeps a well-formed list on a failed run", () => {
    const [first] = view([sent(1, { record: names(["tests/a.test.ts", "tests/b.test.ts"]) })]).readings;
    expect(first?.failedTestFiles).toEqual({ files: ["tests/a.test.ts", "tests/b.test.ts"], total: 2 });
  });

  it("reads an absent list as not-known, and never as an empty one", () => {
    /* Every record written before 2026-10-06 looks like this. */
    const [first] = view([sent(1)]).readings;
    expect(first?.state).toBe("fail");
    expect(first?.failedTestFiles).toBeNull();
  });

  it("reads anything malformed as not-known and keeps the reading", () => {
    for (const bad of [
      { files: [], total: 0 },
      { files: ["tests/a.test.ts"], total: 0 },
      { files: ["tests/a.test.ts", "tests/a.test.ts"], total: 2 },
      { files: ["tests/a.test.ts", 7], total: 2 },
      { files: ["<b>bold</b> and a space"], total: 1 },
      { files: ["/etc/passwd"], total: 1 },
      { files: "tests/a.test.ts", total: 1 },
      [],
      "tests/a.test.ts",
    ]) {
      const [first] = view([sent(1, { record: { failedTestFiles: bad } })]).readings;
      expect(first?.state, JSON.stringify(bad)).toBe("fail");
      expect(first?.failedTestFiles, JSON.stringify(bad)).toBeNull();
    }
  });

  it("never puts failing files beside a pass, a void or a run still going", () => {
    for (const state of ["pass", "void", "running"]) {
      const [first] = view([sent(1, { state, record: names(["tests/a.test.ts"]) })]).readings;
      expect(first?.state).toBe(state);
      expect(first?.failedTestFiles, state).toBeNull();
    }
  });
});

describe("the day's failing files", () => {
  it("tells a test that is red all day from one that failed once", () => {
    const day = view([
      sent(9, { record: names(["tests/red.test.ts"]) }),
      sent(6, { record: names(["tests/flake.test.ts", "tests/red.test.ts"]) }),
      sent(3, { record: names(["tests/red.test.ts"]) }),
      sent(1, { record: names(["tests/red.test.ts"]) }),
    ]);
    const summary = failingFilesOverDay(day.readings);
    expect(summary.namedRuns).toBe(4);
    expect(summary.rows).toEqual([
      { file: "tests/red.test.ts", runs: 4, firstAtMs: NOW - 9 * HOUR, lastAtMs: NOW - 1 * HOUR, inLatest: true },
      { file: "tests/flake.test.ts", runs: 1, firstAtMs: NOW - 6 * HOUR, lastAtMs: NOW - 6 * HOUR, inLatest: false },
    ]);
  });

  it("counts a failed wrapper run with no names instead of losing it", () => {
    /* Without this the denominator shrinks to the runs that happened to name
       something, and "1 of 1" is drawn over a day with five failures in it. */
    const summary = failingFilesOverDay(view([sent(5), sent(4), sent(1, { record: names(["tests/a.test.ts"]) })]).readings);
    expect(summary.namedRuns).toBe(1);
    expect(summary.unnamedRuns).toBe(2);
  });

  it("leaves out passes, and log reconstructions, which can never carry names", () => {
    const summary = failingFilesOverDay(
      view([
        sent(5, { state: "pass" }),
        sent(4, { record: { source: "tmux-log" } }),
        sent(1, { record: names(["tests/a.test.ts"]) }),
      ]).readings,
    );
    expect(summary).toMatchObject({ namedRuns: 1, unnamedRuns: 0 });
    expect(summary.rows.map((r) => r.file)).toEqual(["tests/a.test.ts"]);
  });

  it("says when a run's list was cut, because then a count is only a lower bound", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `tests/f${String(i).padStart(2, "0")}.test.ts`);
    const summary = failingFilesOverDay(
      view([sent(2, { record: names(twenty, 31) }), sent(1, { record: names(["tests/a.test.ts"]) })]).readings,
    );
    expect(summary.cappedRuns).toBe(1);
    expect(summary.unlistedFiles).toBe(11);
    expect(summary.namedRuns).toBe(2);
  });

  it("is empty, not broken, on a day with no failures", () => {
    expect(failingFilesOverDay(view([sent(1, { state: "pass" })]).readings)).toEqual({
      rows: [],
      namedRuns: 0,
      unnamedRuns: 0,
      cappedRuns: 0,
      unlistedFiles: 0,
    });
  });
});

describe("the Failing test files card", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function draw(readings: unknown[]): Promise<string> {
    const api: ReadinessApi = { fetch: async () => view(readings) };
    await act(async () => {
      root.render(<ReadinessPanel api={api} nowMs={NOW} skew={{ kind: "known", ms: 0 }} />);
    });
    return host.textContent ?? "";
  }

  const card = (): HTMLElement | null => host.querySelector('[data-testid="readiness-failing-files"]');

  it("names each file with how many of the day's failed runs it failed in", async () => {
    await draw([
      sent(9, { record: names(["tests/red.test.ts"]) }),
      sent(6, { record: names(["tests/flake.test.ts", "tests/red.test.ts"]) }),
      sent(1, { record: names(["tests/red.test.ts"]) }),
    ]);
    const rows = [...(card()?.querySelectorAll("li") ?? [])].map((li) => li.textContent ?? "");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("tests/red.test.ts");
    expect(rows[0]).toContain("3 of 3 failed runs");
    expect(rows[0]).not.toContain("at least");
    expect(rows[0]).toContain("in the latest");
    expect(rows[1]).toContain("tests/flake.test.ts");
    expect(rows[1]).toContain("1 of 3");
    expect(rows[1]).not.toContain("in the latest");
  });

  it("says so when failed runs named nothing, rather than showing a shorter day", async () => {
    await draw([sent(5), sent(4), sent(1, { record: names(["tests/a.test.ts"]) })]);
    expect(card()?.textContent).toContain("2 other failed runs did not record which files");
  });

  it("says the names are not recorded when no failed run has any — never that nothing failed", async () => {
    await draw([sent(5), sent(4)]);
    expect(card()?.querySelectorAll("li")).toHaveLength(0);
    expect(card()?.textContent).toContain("2 failed runs did not record which files");
  });

  it("says when a list was cut", async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `tests/f${String(i).padStart(2, "0")}.test.ts`);
    await draw([sent(1, { record: names(twenty, 31) })]);
    const rows = [...(card()?.querySelectorAll("li") ?? [])].map((li) => li.textContent ?? "");
    expect(rows).toHaveLength(12);
    expect(rows[0]).toContain("at least 1 of 1 failed run");
    expect(card()?.textContent).toContain("and 8 more files");
    expect(card()?.textContent).toContain("1 run failed in more files than a record lists (11 more)");
  });

  it("is not drawn at all on a day with no failed wrapper run", async () => {
    const text = await draw([sent(1, { state: "pass" })]);
    expect(card()).toBeNull();
    expect(text).not.toContain("Failing test files");
  });

  it("puts the names in the failed mark's own tooltip", async () => {
    await draw([sent(1, { record: names(["tests/a.test.ts", "tests/b.test.ts"]) })]);
    const titles = [...host.querySelectorAll("span[title]")].map((el) => el.getAttribute("title") ?? "");
    expect(titles.some((t) => t.includes("failing: tests/a.test.ts, tests/b.test.ts"))).toBe(true);
  });
});
