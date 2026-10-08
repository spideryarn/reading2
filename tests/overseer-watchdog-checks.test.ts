/**
 * scripts/overseer-watchdog-checks.ts — the two checks the watchdog gained on
 * 2026-10-08, after the Overseer session's pacer expired silently and
 * production went 17 hours undeployed
 * (docs/plans/261008g-watchdog-alarms-for-a-stopped-pacer-and-production-lagging-dev.md).
 *
 * The thing under test above all is that `unknown` never reads as `ok`
 * (docs/reusable/silent-success.md): a heartbeat that will not parse, a tmux
 * that cannot be asked, a fetch that failed, an unreadable readiness record.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_DEPLOY_LAG_MS,
  MAX_PACER_AGE_MS,
  PACER_HEARTBEAT_FILE,
  assessDeployLag,
  assessPacer,
  formatCheck,
  findOverseerSession,
  readPacerHeartbeat,
  readReadinessStreak,
  readTrunk,
  readinessStreak,
  type ReadinessStreak,
  type SessionCheck,
  type TrunkRead,
} from "../scripts/overseer-watchdog-checks.js";
import { READINESS_RUNNER_WORKTREE, type FinishedRecord, type Reading, type TreeStamp } from "../tools/fleet/readiness.js";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
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

describe("tmux uncertainty", () => {
  // Inject at the process boundary: never contact the real tmux server.
  function ask(results: unknown[]): Parameters<typeof findOverseerSession>[0] {
    return () => results.shift() as ReturnType<NonNullable<Parameters<typeof findOverseerSession>[0]>>;
  }
  const listed = { ok: true, out: "$1\tOverseer\n" };
  const failed = (err: string, status: number | null = 1) => ({ ok: false, status, err });

  it("does not call a permission failure an absent server", () => {
    expect(findOverseerSession(ask([failed("error connecting to /tmp/tmux-1000/default (Permission denied)")])).kind).toBe("cannot-tell");
  });
  it("does not treat a nonzero role read on a live session as a missing variable", () => {
    expect(findOverseerSession(ask([listed, failed("server error"), { ok: true, out: "" }])).kind).toBe("cannot-tell");
  });
  it("preserves uncertainty when has-session also cannot answer", () => {
    expect(findOverseerSession(ask([listed, failed("unknown variable: GJD_ROLE"), failed("timeout", null)])).kind).toBe("cannot-tell");
  });
  it("recognizes a genuinely missing variable on a live session", () => {
    expect(findOverseerSession(ask([listed, failed("unknown variable: GJD_ROLE"), { ok: true, out: "" }])).kind).toBe("absent");
  });
  it("recognizes a session that disappeared between calls", () => {
    expect(findOverseerSession(ask([listed, failed("can't find session: $1"), failed("can't find session: $1")])).kind).toBe("absent");
  });
  it("recognizes an absent server, an unset role, and a renamed claimed session", () => {
    expect(findOverseerSession(ask([failed("no server running on /tmp/disposable-tmux")])).kind).toBe("absent");
    expect(findOverseerSession(ask([listed, { ok: true, out: "-GJD_ROLE\n" }])).kind).toBe("absent");
    expect(findOverseerSession(ask([{ ok: true, out: "$1\tRenamed\n" }, { ok: true, out: "GJD_ROLE=overseer\n" }]))).toEqual({ kind: "present", name: "Renamed" });
  });
  it("does not call a fresh heartbeat healthy when tmux is unreadable", () => {
    expect(assessPacer({ kind: "text", text: iso(NOW) }, { kind: "cannot-tell", why: "permission denied" }, NOW).state).toBe("unknown");
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
    execFileSync("mkdir", [join(other, PACER_HEARTBEAT_FILE)], { stdio: ["ignore", "pipe", "pipe"] });
    expect(readPacerHeartbeat(other).kind).toBe("unreadable");
  });

  it("parses the exact shape the pacer writes, `date -u +%FT%TZ`", () => {
    const text = execFileSync("date", ["-u", "+%FT%TZ"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const check = assessPacer({ kind: "text", text }, { kind: "present", name: "Overseer" }, Date.now());
    expect(check.state).toBe("ok");
  });
});

describe("readReadinessStreak", () => {
  it("does not create an absent readiness store", () => {
    const dir = join(tempRoot(), "missing-store");
    vi.stubEnv("FLEET_READINESS_DIR", dir);
    expect(readReadinessStreak("a".repeat(40), NOW).kind).toBe("unknown");
    expect(existsSync(dir)).toBe(false);
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
  const streakOf = (readings: Reading[], sha: string, unreadable = 0): ReadinessStreak =>
    readinessStreak({ readings, unreadable }, sha, NOW, WINDOW, LOOP_CWD);

  it("is ready when dev's head has passed both required checks", () => {
    expect(streakOf(green(SHA_A, NOW - HOUR), SHA_A)).toEqual({ kind: "known", head: { kind: "ready" }, lastReady: null });
  });

  it("bounds the head's red time by its own evidence, and says when dev last had a ready commit", () => {
    const readings = [...green(SHA_A, NOW - 17 * HOUR), loopReading(SHA_B, "test", "fail", NOW - 16 * HOUR), loopReading(SHA_C, "test", "fail", NOW - HOUR)];
    const streak = streakOf(readings, SHA_C);
    expect(streak).toMatchObject({ kind: "known", head: { kind: "red", sinceMs: NOW - HOUR } });
    // A was ready until dev moved past it: the loop's first run on B started a minute before B's finish.
    if (streak.kind === "known") expect(streak.lastReady).toEqual({ sha: SHA_A, untilMs: NOW - 16 * HOUR - 60_000, how: "moved" });
  });

  it("a commit that stayed ready until it failed a rerun counts as deployable until then", () => {
    // GPT Sol: a pass 17 hours ago and a failure an hour ago do not make 17 hours undeployable.
    const readings = [...green(SHA_C, NOW - 17 * HOUR), loopReading(SHA_C, "test", "fail", NOW - HOUR)];
    expect(streakOf(readings, SHA_C)).toMatchObject({ kind: "known", lastReady: { sha: SHA_C, untilMs: NOW - HOUR, how: "failed" } });
  });

  it("a later failure does not erase that the commit was ready", () => {
    const readings = [...green(SHA_A, NOW - 10 * HOUR), loopReading(SHA_A, "test", "fail", NOW - 9 * HOUR)];
    expect(streakOf(readings, SHA_B)).toMatchObject({ kind: "known", lastReady: { sha: SHA_A, untilMs: NOW - 9 * HOUR } });
  });

  it("a head the loop has not reached is unsettled, not unknown -- it happens after every push", () => {
    const streak = streakOf(green(SHA_A, NOW - 2 * HOUR), SHA_B);
    expect(streak).toMatchObject({ kind: "known", head: { kind: "unsettled" }, lastReady: { sha: SHA_A, how: "last-seen" } });
  });

  it("does not count a green run made outside the readiness loop's checkout", () => {
    const readings = [
      ...green(SHA_A, NOW - 17 * HOUR),
      loopReading(SHA_B, "test", "pass", NOW - 2 * HOUR, "/some/worktree"),
      loopReading(SHA_B, "typecheck", "pass", NOW - 2 * HOUR, "/some/worktree"),
    ];
    expect(streakOf(readings, SHA_B)).toMatchObject({ kind: "known", head: { kind: "unsettled" }, lastReady: { sha: SHA_A } });
  });

  it("starts the red bound with its first observed failure, and invents no ready commit", () => {
    expect(streakOf([loopReading(SHA_B, "test", "fail", NOW - HOUR)], SHA_B)).toEqual({
      kind: "known",
      head: { kind: "red", why: expect.any(String), sinceMs: NOW - HOUR },
      lastReady: null,
    });
  });

  it("resets the red interval after recovery on the same commit", () => {
    const readings = [loopReading(SHA_C, "test", "fail", NOW - 10 * HOUR), ...green(SHA_C, NOW - 5 * HOUR), loopReading(SHA_C, "test", "fail", NOW - HOUR)];
    expect(streakOf(readings, SHA_C)).toMatchObject({ head: { kind: "red", sinceMs: NOW - HOUR } });
  });

  it("keeps a failure sticky during an unsettled rerun", () => {
    const rerun = { ...loopReading(SHA_C, "test", "pass", NOW - HOUR), state: "void" as const, why: "process ended without a verdict" };
    expect(streakOf([loopReading(SHA_C, "test", "fail", NOW - 10 * HOUR), rerun], SHA_C)).toMatchObject({ head: { kind: "red", sinceMs: NOW - 10 * HOUR } });
  });

  it("an unsettled rerun after green is unsettled, without inventing red time", () => {
    const rerun = { ...loopReading(SHA_C, "test", "pass", NOW - HOUR), state: "void" as const, why: "process ended without a verdict" };
    expect(streakOf([...green(SHA_C, NOW - 10 * HOUR), rerun], SHA_C)).toMatchObject({ head: { kind: "unsettled" } });
  });

  it("decomposes whole-check failures using the shared verdict", () => {
    const reading = loopReading(SHA_C, "test", "fail", NOW - HOUR);
    const record: FinishedRecord = { ...(reading.record as FinishedRecord), check: "check", counts: { kind: "check", steps: [{ name: "test", verdict: "failed", gate: "gate", findings: null }, { name: "typecheck", verdict: "clean", gate: "gate", findings: null }] } };
    expect(streakOf([{ ...reading, record }], SHA_C)).toMatchObject({ head: { kind: "red", sinceMs: NOW - HOUR } });
  });

  it("only accepts the exact runner path, not the same suffix in another repository", () => {
    const readings = green(SHA_C, NOW - HOUR).map((r) => ({ ...r, record: { ...r.record, cwd: `/another-repo/${READINESS_RUNNER_WORKTREE}` } }));
    expect(streakOf(readings, SHA_C).kind).toBe("unknown");
  });

  it("is unknown when the loop has no readings at all", () => {
    expect(streakOf([], SHA_A).kind).toBe("unknown");
  });

  it("is unknown when any record could not be read -- the newest may be the one that matters", () => {
    expect(streakOf(green(SHA_A, NOW - HOUR), SHA_A, 1).kind).toBe("unknown");
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
const ready: ReadinessStreak = { kind: "known", head: { kind: "ready" }, lastReady: null };

describe("assessDeployLag", () => {
  it("is ok when production has everything on dev", () => {
    expect(assessDeployLag(knownTrunk(null), ready, NOW).state).toBe("ok");
  });

  it("is ok when the oldest undeployed commit is younger than 12 hours", () => {
    expect(MAX_DEPLOY_LAG_MS).toBe(12 * HOUR);
    expect(assessDeployLag(knownTrunk(11 * HOUR), ready, NOW).state).toBe("ok");
  });

  it("stays ok within the threshold while the loop has not reached dev's new head", () => {
    // After every push, for as long as the loop takes to get there. Calling that
    // unknown would fail the watchdog for half an hour after each push.
    const unsettled: ReadinessStreak = { kind: "known", head: { kind: "unsettled", why: "nobody has run them here" }, lastReady: null };
    expect(assessDeployLag(knownTrunk(HOUR), unsettled, NOW).state).toBe("ok");
  });

  it("is unhealthy past 12 hours, and says how long dev has been undeployable", () => {
    const streak: ReadinessStreak = {
      kind: "known",
      head: { kind: "red", why: "test failed on this commit", sinceMs: NOW - 3 * HOUR },
      lastReady: { sha: SHA_A, untilMs: NOW - 17 * HOUR, how: "moved" },
    };
    const check = assessDeployLag(knownTrunk(17 * HOUR), streak, NOW);
    expect(check.state).toBe("unhealthy");
    expect(check.detail).toContain("17 hours behind");
    expect(check.detail).toContain("dev has been undeployable for about 17 hours");
    expect(check.detail).toContain("red for at least 3.0 hours");
  });

  it("does not report ok with unreadable readiness, even when production caught up", () => {
    for (const lag of [null, HOUR]) {
      expect(assessDeployLag(knownTrunk(lag), { kind: "unknown", why: "corrupt store" }, NOW).state).toBe("unknown");
    }
  });

  it("does not infer 72 hours of red from one failure an hour ago", () => {
    const streak = readinessStreak({ readings: [loopReading(SHA_C, "test", "fail", NOW - HOUR)], unreadable: 0 }, SHA_C, NOW, 72 * HOUR, LOOP_CWD);
    const detail = assessDeployLag(knownTrunk(20 * HOUR), streak, NOW).detail;
    expect(detail).not.toMatch(/undeployable for (about|at least) 72/);
    expect(detail).toContain("passed no dev commit in the last 72 hours");
    expect(detail).toContain("red for at least 1.0 hours");
  });

  it("rounds a red lower bound down so it does not overstate the evidence", () => {
    const streak: ReadinessStreak = { kind: "known", head: { kind: "red", why: "failed", sinceMs: NOW - 14.9 * HOUR }, lastReady: null };
    expect(assessDeployLag(knownTrunk(20 * HOUR), streak, NOW).detail).toContain("at least 14 hours");
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
      stdio: ["ignore", "pipe", "pipe"],
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

  it("refreshes both tracking refs even if remote.origin.fetch only maps main", () => {
    const { clone, work } = setup();
    git(clone, ["config", "remote.origin.fetch", "+refs/heads/main:refs/remotes/origin/main"]);
    git(work, ["checkout", "--quiet", "-b", "dev"]);
    git(work, ["commit", "--quiet", "--allow-empty", "-m", "one"], "2026-10-07T19:00:00Z");
    git(work, ["push", "--quiet", "origin", "dev"]);
    expect(readTrunk(clone)).toMatchObject({ kind: "known", undeployed: 1 });
  });

  it("leaves FETCH_HEAD untouched for other consumers", () => {
    const { clone } = setup();
    const fetched = git(clone, ["rev-parse", "--git-path", "FETCH_HEAD"]);
    const path = join(clone, fetched);
    writeFileSync(path, "another consumer's fetch\n");
    expect(readTrunk(clone).kind).toBe("known");
    expect(readFileSync(path, "utf8")).toBe("another consumer's fetch\n");
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
