/**
 * scripts/overseer-watchdog-checks.ts — the two checks the watchdog gained on
 * 2026-10-08, after the Overseer session's pacer expired silently and
 * production went 17 hours undeployed
 * (docs/plans/261008e-watchdog-alarms-for-a-stopped-pacer-and-production-lagging-dev.md).
 *
 * The thing under test above all is that `unknown` never reads as `ok`
 * (docs/reusable/silent-success.md): a heartbeat that will not parse, a tmux
 * that cannot be asked, a fetch that failed, an unreadable readiness record.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_DEPLOY_LAG_MS,
  MAX_PACER_AGE_MS,
  PACER_HEARTBEAT_FILE,
  assessDeployLag,
  assessPacer,
  formatCheck,
  readPacerHeartbeat,
  readTrunk,
  readinessStreak,
  type ReadinessStreak,
  type SessionCheck,
  type TrunkRead,
} from "../scripts/overseer-watchdog-checks.js";
import { READINESS_RUNNER_WORKTREE, type FinishedRecord, type Reading, type TreeStamp } from "../tools/fleet/readiness.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-watchdog-checks-"));
  roots.push(root);
  return root;
}

const NOW = Date.parse("2026-10-08T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const iso = (ms: number): string => new Date(ms).toISOString();

describe("assessPacer", () => {
  const present = { kind: "present", name: "Overseer" } as const;

  it("is ok when the heartbeat is fresh", () => {
    const check = assessPacer({ kind: "text", text: `${iso(NOW - 20 * 60_000)}\n` }, present, NOW);
    expect(check.state).toBe("ok");
  });

  it("is unhealthy when the heartbeat is older than 90 minutes, and says to recreate the jobs", () => {
    expect(MAX_PACER_AGE_MS).toBe(90 * 60_000);
    const check = assessPacer({ kind: "text", text: iso(NOW - 2 * HOUR) }, present, NOW);
    expect(check.state).toBe("unhealthy");
    expect(check.detail).toContain("standing-jobs.md");
    expect(check.detail).toMatch(/120 min|2\.0 h/);
  });

  it("is unhealthy when the heartbeat is missing while the Overseer session exists", () => {
    const check = assessPacer({ kind: "absent" }, present, NOW);
    expect(check.state).toBe("unhealthy");
    expect(check.detail).toContain("standing-jobs.md");
  });

  it("is unhealthy, not ok, when there is no heartbeat and no Overseer session either", () => {
    // Nothing is pacing the queue. That is not a reason to be quiet.
    const check = assessPacer({ kind: "absent" }, { kind: "absent" }, NOW);
    expect(check.state).toBe("unhealthy");
    expect(check.detail).toMatch(/no Overseer session/i);
  });

  it("is unknown, never ok, when the heartbeat will not parse", () => {
    const check = assessPacer({ kind: "text", text: "not a time" }, present, NOW);
    expect(check.state).toBe("unknown");
  });

  it("is unknown when the heartbeat file could not be read", () => {
    const check = assessPacer({ kind: "unreadable", why: "EACCES" }, present, NOW);
    expect(check.state).toBe("unknown");
    expect(check.detail).toContain("EACCES");
  });

  it("is unknown when the heartbeat is missing and tmux could not be asked", () => {
    const check = assessPacer({ kind: "absent" }, { kind: "cannot-tell", why: "tmux exploded" }, NOW);
    expect(check.state).toBe("unknown");
    expect(check.detail).toContain("tmux exploded");
  });

  it("is unknown when the heartbeat is in the future, rather than calling it fresh", () => {
    const check = assessPacer({ kind: "text", text: iso(NOW + HOUR) }, present, NOW);
    expect(check.state).toBe("unknown");
  });

  it("a stale heartbeat is unhealthy even when tmux cannot be asked", () => {
    const check = assessPacer({ kind: "text", text: iso(NOW - 3 * HOUR) }, { kind: "cannot-tell", why: "x" }, NOW);
    expect(check.state).toBe("unhealthy");
  });
});

describe("readPacerHeartbeat", () => {
  it("absent, text and unreadable are three different answers", () => {
    const root = tempRoot();
    expect(readPacerHeartbeat(root)).toEqual({ kind: "absent" });
    writeFileSync(join(root, PACER_HEARTBEAT_FILE), "2026-10-08T16:08:23Z\n");
    expect(readPacerHeartbeat(root)).toEqual({ kind: "text", text: "2026-10-08T16:08:23Z\n" });
    // A directory where the file should be cannot be read as one.
    const other = tempRoot();
    execFileSync("mkdir", [join(other, PACER_HEARTBEAT_FILE)]);
    expect(readPacerHeartbeat(other).kind).toBe("unreadable");
  });

  it("parses the exact shape the pacer writes, `date -u +%FT%TZ`", () => {
    const text = execFileSync("date", ["-u", "+%FT%TZ"], { encoding: "utf8" });
    const check = assessPacer({ kind: "text", text }, { kind: "present", name: "Overseer" }, Date.now());
    expect(check.state).toBe("ok");
  });
});

/* ------------------------------------------------------------------ */

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const LOOP_CWD = `/home/greg/code/spideryarn2/${READINESS_RUNNER_WORKTREE}`;
const clean = (sha: string): TreeStamp => ({ kind: "known", sha, branch: "readiness-checks", dirty: false });

let runCounter = 0;
function loopReading(sha: string, check: "test" | "typecheck", outcome: "pass" | "fail", atMs: number, cwd = LOOP_CWD): Reading {
  runCounter += 1;
  const record: FinishedRecord = {
    schema: 1,
    runId: `run${String(runCounter).padStart(6, "0")}`,
    startedAt: iso(atMs - 60_000),
    pid: 1,
    host: "box",
    procStartToken: "1",
    cwd,
    check,
    scope: "full",
    commandLine: null,
    treeAtStart: clean(sha),
    source: "wrapper",
    state: "finished",
    at: iso(atMs),
    durationMs: 60_000,
    outcome,
    exit: outcome === "pass" ? 0 : 1,
    counts: check === "test" ? { kind: "vitest", files: null, tests: null } : { kind: "typecheck", projects: null, errors: null },
    treeAtEnd: clean(sha),
    logPath: null,
    why: null,
    failedTestFiles: null,
  };
  return { record, state: outcome, atMs, why: null };
}
const green = (sha: string, atMs: number): Reading[] => [loopReading(sha, "test", "pass", atMs), loopReading(sha, "typecheck", "pass", atMs)];

describe("readinessStreak", () => {
  const WINDOW = 72 * HOUR;

  it("is ready when dev's head has passed both required checks", () => {
    const streak = readinessStreak({ readings: green(SHA_A, NOW - HOUR), unreadable: 0 }, SHA_A, NOW, WINDOW);
    expect(streak.kind).toBe("ready");
  });

  it("measures from the last commit the loop showed ready, when dev's head is red", () => {
    const readings = [...green(SHA_A, NOW - 17 * HOUR), loopReading(SHA_B, "test", "fail", NOW - 16 * HOUR), loopReading(SHA_C, "test", "fail", NOW - HOUR)];
    const streak = readinessStreak({ readings, unreadable: 0 }, SHA_C, NOW, WINDOW);
    expect(streak.kind).toBe("not-ready");
    if (streak.kind !== "not-ready") return;
    expect(streak.lastReady).toEqual({ sha: SHA_A, atMs: NOW - 17 * HOUR });
    expect(streak.headVerdict).toBe("not-ready");
  });

  it("does not count a green run made outside the readiness loop's checkout", () => {
    const readings = [
      ...green(SHA_A, NOW - 17 * HOUR),
      loopReading(SHA_B, "test", "pass", NOW - 2 * HOUR, "/some/worktree"),
      loopReading(SHA_B, "typecheck", "pass", NOW - 2 * HOUR, "/some/worktree"),
    ];
    const streak = readinessStreak({ readings, unreadable: 0 }, SHA_B, NOW, WINDOW);
    expect(streak.kind).toBe("not-ready");
    if (streak.kind === "not-ready") expect(streak.lastReady?.sha).toBe(SHA_A);
  });

  it("says there was no ready commit in the window, rather than inventing one", () => {
    const streak = readinessStreak({ readings: [loopReading(SHA_B, "test", "fail", NOW - HOUR)], unreadable: 0 }, SHA_B, NOW, WINDOW);
    expect(streak.kind).toBe("not-ready");
    if (streak.kind === "not-ready") expect(streak.lastReady).toBeNull();
  });

  it("is unknown when the loop has no readings at all", () => {
    expect(readinessStreak({ readings: [], unreadable: 0 }, SHA_A, NOW, WINDOW).kind).toBe("unknown");
  });

  it("is unknown when any record could not be read -- the newest may be the one that matters", () => {
    expect(readinessStreak({ readings: green(SHA_A, NOW - HOUR), unreadable: 1 }, SHA_A, NOW, WINDOW).kind).toBe("unknown");
  });

  it("an old sha that was green and later failed does not count as ready", () => {
    const readings = [...green(SHA_A, NOW - 10 * HOUR), loopReading(SHA_A, "test", "fail", NOW - 9 * HOUR)];
    const streak = readinessStreak({ readings, unreadable: 0 }, SHA_B, NOW, WINDOW);
    expect(streak.kind).toBe("not-ready");
    if (streak.kind === "not-ready") expect(streak.lastReady).toBeNull();
  });
});

/* ------------------------------------------------------------------ */

const knownTrunk = (oldestAgoMs: number | null, undeployed = 3): TrunkRead => ({
  kind: "known",
  mainSha: SHA_A,
  devSha: SHA_C,
  undeployed: oldestAgoMs === null ? 0 : undeployed,
  oldestUndeployed: oldestAgoMs === null ? null : { sha: SHA_B, committedAtMs: NOW - oldestAgoMs },
});
const ready: ReadinessStreak = { kind: "ready", sha: SHA_C };

describe("assessDeployLag", () => {
  it("is ok when production has everything on dev", () => {
    expect(assessDeployLag(knownTrunk(null), ready, NOW).state).toBe("ok");
  });

  it("is ok when the oldest undeployed commit is younger than 12 hours", () => {
    expect(MAX_DEPLOY_LAG_MS).toBe(12 * HOUR);
    expect(assessDeployLag(knownTrunk(11 * HOUR), ready, NOW).state).toBe("ok");
  });

  it("is unhealthy past 12 hours, and says how long dev has been undeployable", () => {
    const streak: ReadinessStreak = { kind: "not-ready", headVerdict: "not-ready", why: "test failed on this commit", lastReady: { sha: SHA_A, atMs: NOW - 17 * HOUR } };
    const check = assessDeployLag(knownTrunk(17 * HOUR), streak, NOW);
    expect(check.state).toBe("unhealthy");
    expect(check.detail).toContain("17 hours behind");
    expect(check.detail).toContain("dev has been undeployable for 17 hours");
  });

  it("says 'at least' when no commit in the window was ready", () => {
    const streak: ReadinessStreak = { kind: "not-ready", headVerdict: "not-ready", why: "x", lastReady: null };
    expect(assessDeployLag(knownTrunk(20 * HOUR), streak, NOW, MAX_DEPLOY_LAG_MS, 72 * HOUR).detail).toContain(
      "undeployable for at least 72 hours",
    );
  });

  it("is unknown, never ok, when git could not say", () => {
    const check = assessDeployLag({ kind: "unknown", why: "git fetch failed: no network" }, ready, NOW);
    expect(check.state).toBe("unknown");
    expect(check.detail).toContain("no network");
  });

  it("keeps the readiness reading in the line even when it is unknown, and does not call it ok", () => {
    const check = assessDeployLag(knownTrunk(20 * HOUR), { kind: "unknown", why: "1 record unreadable" }, NOW);
    expect(check.state).toBe("unhealthy");
    expect(check.detail).toContain("1 record unreadable");
  });
});

describe("formatCheck", () => {
  it("prints the three states three different ways, each naming itself", () => {
    const lines = (["ok", "unhealthy", "unknown"] as const).map((state): string => formatCheck({ name: "pacer", state, detail: "d" } satisfies SessionCheck));
    expect(new Set(lines).size).toBe(3);
    expect(lines[0]).toMatch(/^✓ pacer ok/);
    expect(lines[1]).toMatch(/^✗ pacer unhealthy/);
    expect(lines[2]).toMatch(/^\? pacer unknown/);
  });
});

/* ------------------------------------------------------------------ */

describe("readTrunk, against real git", () => {
  function git(cwd: string, args: string[], date?: string): string {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
        ...(date === undefined ? {} : { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }),
      },
    }).trim();
  }

  function setup(): { clone: string; work: string } {
    const root = tempRoot();
    const origin = join(root, "origin.git");
    const work = join(root, "work");
    git(root, ["init", "--quiet", "--bare", origin]);
    git(root, ["init", "--quiet", "-b", "main", work]);
    git(work, ["commit", "--quiet", "--allow-empty", "-m", "base"], "2026-10-06T00:00:00Z");
    git(work, ["remote", "add", "origin", origin]);
    git(work, ["push", "--quiet", "origin", "main", "main:dev"]);
    const clone = join(root, "clone");
    git(root, ["clone", "--quiet", origin, clone]);
    return { clone, work };
  }

  it("finds the oldest commit dev has that main lacks, after fetching", () => {
    const { clone, work } = setup();
    git(work, ["checkout", "--quiet", "-b", "dev"]);
    git(work, ["commit", "--quiet", "--allow-empty", "-m", "one"], "2026-10-07T19:00:00Z");
    git(work, ["commit", "--quiet", "--allow-empty", "-m", "two"], "2026-10-08T09:00:00Z");
    git(work, ["push", "--quiet", "origin", "dev"]);
    // The clone has not fetched: only readTrunk's own fetch can see these.
    const trunk = readTrunk(clone);
    expect(trunk.kind).toBe("known");
    if (trunk.kind !== "known") return;
    expect(trunk.undeployed).toBe(2);
    expect(trunk.oldestUndeployed?.committedAtMs).toBe(Date.parse("2026-10-07T19:00:00Z"));
  });

  it("nothing undeployed when main has caught up", () => {
    const { clone } = setup();
    const trunk = readTrunk(clone);
    expect(trunk).toMatchObject({ kind: "known", undeployed: 0, oldestUndeployed: null });
  });

  it("is unknown when the fetch fails, rather than trusting refs it could not refresh", () => {
    const { clone } = setup();
    git(clone, ["remote", "set-url", "origin", join(tempRoot(), "nowhere.git")]);
    const trunk = readTrunk(clone);
    expect(trunk.kind).toBe("unknown");
    if (trunk.kind === "unknown") expect(trunk.why).toMatch(/fetch/);
  });
});
