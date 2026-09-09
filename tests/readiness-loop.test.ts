/**
 * The periodic readiness runner's decisions, without git, tmux, a database or
 * /proc. Every input is a reading the impure loop can take; this file only asks
 * what those readings mean.
 */
import { describe, expect, it } from "vitest";

import {
  decideAdmission,
  FIXED_RUN_PEAK_BYTES,
  PER_WORKER_PEAK_BYTES,
} from "../vitest-admission.js";
import {
  decideTick,
  MAX_VOID_RETRIES,
  TICK_INTERVAL_MS,
  VOID_RETRY_COOLDOWN_MS,
  type TickInput,
} from "../tools/fleet/readiness-loop.js";
import {
  makeAdmissionRefusalCapture,
  outcomeAfterAdmissionRefusal,
  parseAdmissionRefusal,
} from "../tools/fleet/readiness-parse.js";
import {
  outcomeFromExit,
  resolveRecord,
  type FinishedRecord,
  type Reading,
  type StartedRecord,
  type TreeStamp,
} from "../tools/fleet/readiness.js";

const NOW_MS = Date.parse("2026-09-09T18:00:00.000Z");
const SHA_A = "3333333333333333333333333333333333333333";
const SHA_B = "4444444444444444444444444444444444444444";
const GB = 1024 ** 3;

const clean = (sha = SHA_A): Extract<TreeStamp, { kind: "known" }> => ({
  kind: "known",
  sha,
  branch: "readiness-checks",
  dirty: false,
});

function finished(over: Partial<FinishedRecord> = {}): FinishedRecord {
  return {
    schema: 1,
    runId: "loopfixture01",
    startedAt: new Date(NOW_MS - 31 * 60_000).toISOString(),
    pid: 4242,
    host: "box",
    procStartToken: "12345",
    cwd: "/runner",
    check: "check",
    scope: "full",
    commandLine: "tsx scripts/check.ts",
    treeAtStart: clean(),
    source: "wrapper",
    state: "finished",
    at: new Date(NOW_MS - 5 * 60_000).toISOString(),
    durationMs: 26 * 60_000,
    outcome: "void",
    exit: 70,
    counts: { kind: "check", steps: [] },
    treeAtEnd: clean(),
    logPath: null,
    why: "the box refused the run",
    ...over,
  };
}

function started(over: Partial<StartedRecord> = {}): StartedRecord {
  return {
    schema: 1,
    runId: "loopstarted01",
    startedAt: new Date(NOW_MS - 5 * 60_000).toISOString(),
    pid: 4242,
    host: "box",
    procStartToken: "12345",
    cwd: "/runner",
    check: "check",
    scope: "full",
    commandLine: "tsx scripts/check.ts",
    treeAtStart: clean(),
    source: "wrapper",
    state: "started",
    ...over,
  };
}

const reading = (record: FinishedRecord | StartedRecord, alive = false): Reading =>
  resolveRecord(record, NOW_MS, () => alive);

const healthy = {
  load: { kind: "value", load1: 2, load5: 2, load15: 2, cores: 16, ratio1: 0.125 } as const,
  memory: { kind: "value", totalBytes: 32 * GB, availableBytes: 20 * GB, availableFraction: 0.625 } as const,
  swap: { kind: "value", totalBytes: 16 * GB, usedBytes: 2 * GB, usedFraction: 0.125, areas: 1 } as const,
  disk: { kind: "value", totalKiB: 1000, usedKiB: 400, availableKiB: 600, usePercent: 40 } as const,
  swapActivity: { kind: "skipped" } as const,
};

function input(over: Partial<TickInput> = {}): TickInput {
  return {
    nowMs: NOW_MS,
    fastForwardProblem: null,
    dev: {
      kind: "known",
      devSha: SHA_A,
      primarySha: SHA_A,
      primaryBehind: 0,
      trunkGap: 1,
      observedAt: new Date(NOW_MS).toISOString(),
      caveat: "cached origin/dev",
    },
    runnerTree: clean(),
    history: { readings: [], unreadable: [] },
    admission: {
      nominalWorkers: 3,
      snapshot: { kind: "not-linux", platform: "darwin" },
      reserveBytes: undefined,
    },
    health: healthy,
    databaseProblem: null,
    ...over,
  };
}

describe("decideTick", () => {
  it("skips first when the fast-forward did not happen, quoting the problem", () => {
    const decision = decideTick(input({
      fastForwardProblem: "git merge --ff-only refused because readiness-checks has diverged",
      dev: { kind: "unknown", why: "also unavailable", observedAt: new Date(NOW_MS).toISOString() },
      runnerTree: { kind: "unknown", why: "also unavailable" },
    }));
    expect(decision).toEqual({
      kind: "skip",
      why: "The runner worktree was not advanced: git merge --ff-only refused because readiness-checks has diverged.",
    });
  });

  it("skips when origin/dev could not be read and never guesses a sha", () => {
    expect(decideTick(input({
      dev: { kind: "unknown", why: "git rev-parse exited 128", observedAt: new Date(NOW_MS).toISOString() },
    }))).toEqual({
      kind: "skip",
      why: "This box could not read origin/dev: git rev-parse exited 128. No check will run against a guessed commit.",
    });
  });

  it("skips when the runner stamp is unknown", () => {
    expect(decideTick(input({ runnerTree: { kind: "unknown", why: "git status timed out" } }))).toEqual({
      kind: "skip",
      why: "The runner worktree could not be stamped: git status timed out. Look at the worktree before running a check from it.",
    });
  });

  it("skips when the runner is not at dev, naming both commits", () => {
    expect(decideTick(input({ runnerTree: clean(SHA_B) }))).toEqual({
      kind: "skip",
      why: "The runner worktree is at 444444444444 while origin/dev is 333333333333; a check there would answer for the wrong commit.",
    });
  });

  it("skips a dirty runner and tells a person to inspect rather than erase it", () => {
    expect(decideTick(input({ runnerTree: { ...clean(), dirty: true } }))).toEqual({
      kind: "skip",
      why: "The runner worktree at 333333333333 has uncommitted changes. Look at it rather than erasing them; it is not the dev tree a record would claim.",
    });
  });

  it("skips when readiness already has an answer for this sha", () => {
    const passed = reading(finished({ outcome: "pass", exit: 0 }));
    expect(decideTick(input({ history: { readings: [passed], unreadable: [] } }))).toEqual({
      kind: "skip",
      why: "Readiness already says ready for 333333333333. This loop only turns unknown into an answer, so there is nothing to run.",
    });
  });

  it("keeps a settled full-wrapper failure sticky instead of retrying it", () => {
    const failed = reading(finished({ outcome: "fail", exit: 1 }));
    expect(decideTick(input({ history: { readings: [failed], unreadable: [] } }))).toEqual({
      kind: "skip",
      why: "A full wrapper check already failed on 333333333333 in the Readiness tab's 24-hour window. That failure is settled, so retrying it would only fish for a different answer.",
    });
  });

  it("observes a manual full-wrapper run without treating its record as the loop lock", () => {
    const running = reading(started(), true);
    expect(decideTick(input({ history: { readings: [running], unreadable: [] } }))).toEqual({
      kind: "skip",
      why: "A full wrapper check for 333333333333 is already running. That observes a manual run; the process lock, not this record, is what keeps loops exclusive.",
    });
  });

  it("retries one void after the cooldown, but skips before it", () => {
    const recent = reading(finished({ at: new Date(NOW_MS - VOID_RETRY_COOLDOWN_MS + 1).toISOString() }));
    expect(decideTick(input({ history: { readings: [recent], unreadable: [] } }))).toEqual({
      kind: "skip",
      why: "The box killed the latest full check for 333333333333 less than 30 minutes ago. Wait for that cooldown before asking the same box again.",
    });

    const cooled = reading(finished({ at: new Date(NOW_MS - VOID_RETRY_COOLDOWN_MS).toISOString() }));
    expect(decideTick(input({ history: { readings: [cooled], unreadable: [] } }))).toEqual({ kind: "run", sha: SHA_A });
  });

  it("stops after three voids for one sha and says the box killed it three times", () => {
    const voids = Array.from({ length: MAX_VOID_RETRIES }, (_, index) =>
      reading(finished({
        runId: `loopvoid0${index}`,
        startedAt: new Date(NOW_MS - (index + 2) * 60 * 60_000).toISOString(),
        at: new Date(NOW_MS - (index + 1) * 60 * 60_000).toISOString(),
      })),
    );
    expect(decideTick(input({ history: { readings: voids, unreadable: [] } }))).toEqual({
      kind: "skip",
      why: "The box has killed this commit's full check 3 times in the Readiness tab's 24-hour window. Stop retrying 333333333333 and inspect the box.",
    });
  });

  it("quotes memory admission's own refusal", () => {
    const admission = {
      nominalWorkers: 3,
      snapshot: { kind: "linux", availableBytes: 2 * GB, swapTotalBytes: 8 * GB, swapFreeBytes: 0 },
      reserveBytes: 4 * GB,
    } as const;
    const message = decideAdmission(admission);
    expect(message.kind).toBe("refuse");
    const decision = decideTick(input({ admission }));
    expect(decision.kind).toBe("skip");
    expect(decision.kind === "skip" && decision.why).toContain("NO TESTS RAN AND NOTHING WAS VERIFIED");
    expect(decision.kind === "skip" && decision.why).toContain("Memory admission refused this check:");
  });

  it("treats not-applicable admission as permission", () => {
    expect(decideTick(input()).kind).toBe("run");
  });

  it("skips when the box's own health verdict is not ok, quoting its reason", () => {
    const strained = {
      ...healthy,
      load: { kind: "value", load1: 48, load5: 40, load15: 32, cores: 16, ratio1: 3 } as const,
    };
    const decision = decideTick(input({ health: strained }));
    expect(decision.kind).toBe("skip");
    expect(decision.kind === "skip" && decision.why).toContain("Box health is strained:");
    expect(decision.kind === "skip" && decision.why).toContain("over 2x the 16 cores");
  });

  it("skips when the database gate failed, quoting the box problem", () => {
    expect(decideTick(input({ databaseProblem: "db:check exited 1: local Supabase is not running" }))).toEqual({
      kind: "skip",
      why: "The database gate did not pass: db:check exited 1: local Supabase is not running. This is a problem with the box, not a red dev commit.",
    });
  });

  it("runs when every gate permits it", () => {
    expect(decideTick(input())).toEqual({ kind: "run", sha: SHA_A });
    expect(TICK_INTERVAL_MS).toBe(10 * 60_000);
  });
});

describe("a Vitest admission refusal is not a red tree", () => {
  function realRefusal(): string {
    const decision = decideAdmission({
      nominalWorkers: 3,
      snapshot: {
        kind: "linux",
        availableBytes: FIXED_RUN_PEAK_BYTES + PER_WORKER_PEAK_BYTES - 1,
        swapTotalBytes: 0,
        swapFreeBytes: 0,
      },
      reserveBytes: 1,
    });
    if (decision.kind !== "refuse") throw new Error("the fixture was expected to refuse admission");
    return decision.message;
  }

  it("extracts the box's own refusal sentence and ignores an ordinary failure", () => {
    const message = realRefusal();
    const why = parseAdmissionRefusal(message);
    expect(why).toBe(
      "NO TESTS RAN AND NOTHING WAS VERIFIED — this is resource pressure, not a test failure.",
    );
    expect(parseAdmissionRefusal("A gate failed. Fix it and run the suite again.")).toBeNull();

    const exitOne = outcomeFromExit(1);
    expect(exitOne.outcome).toBe("fail");
    expect(outcomeAfterAdmissionRefusal(exitOne, why)).toEqual({
      outcome: "void",
      why: "NO TESTS RAN AND NOTHING WAS VERIFIED — this is resource pressure, not a test failure.",
    });
  });

  it("finds a refusal split across chunks in the discarded middle of a long check log", () => {
    const banner = realRefusal().split("\n").find((line) => line.includes("NO TESTS RAN"));
    if (banner === undefined) throw new Error("the admission fixture has no refusal banner");
    const detector = makeAdmissionRefusalCapture();
    detector.push("x".repeat(80_000));
    detector.push(`\n  ${banner.slice(0, 24)}`);
    detector.push(`${banner.slice(24)}\n${"y".repeat(80_000)}`);
    expect(detector.why()).toBe(banner.trim());
  });
});
