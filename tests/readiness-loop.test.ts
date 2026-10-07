/**
 * The periodic readiness runner's decisions and unattended process boundaries.
 * Decision tests stay pure; the Git-boundary tests use throwaway repositories
 * because a fake cannot prove that inherited location overrides really win.
 */
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  decideAdmission,
  FIXED_RUN_PEAK_BYTES,
  markReadinessAdmissionRefusal,
  PER_WORKER_PEAK_BYTES,
  READINESS_ADMISSION_TOKEN_ENV,
} from "../vitest-admission.js";
import {
  decideTick,
  DEPENDENCY_INPUTS,
  initialPreparationState,
  MAX_VOIDS_PER_WINDOW,
  PREPARATION_PATHSPEC,
  preparationAfterChanges,
  preparationTarget,
  TICK_INTERVAL_MS,
  VOID_RETRY_COOLDOWN_MS,
  type PreparationState,
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
  type Counts,
  type FinishedRecord,
  type Reading,
  type StartedRecord,
  type TreeStamp,
} from "../tools/fleet/readiness.js";
import {
  advanceRunner,
  CHECK_TIMEOUT_MS,
  ensureFleetClient,
  localDatabaseEnv,
  prepareRunner,
  readinessCheckEnv,
  runCommand,
  runnerWorktreeProblem,
  TERMINATION_GRACE_MS,
  type PreparationDeps,
  requireHeldLoopLock,
  waitForReadinessChild,
  worktreeAddArgs,
} from "../scripts/readiness-loop.js";
import { checkChildEnv } from "../scripts/readiness-run.js";
import {
  GIT_LOCATION_ENV,
  gitEnv,
  makeRelationCache,
  runnerChildEnv,
  stampTree,
} from "../tools/fleet/readiness-git.js";
import { BUILD_FILES_FILE, fleetBundleProblem } from "../tools/fleet/build-files.js";
import { BUILD_STAMP_FILE } from "../tools/fleet/build-stamp.js";
import { FIXTURE_FONT, FIXTURE_JS, writeFleetBundle, type FixtureStamp } from "./helpers/fleet-bundle-fixture.js";

const scratchDirectories: string[] = [];

function git(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env): string {
  const result = spawnSync("git", [...args], { cwd, env, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} exited ${result.status}`);
  return result.stdout.trim();
}

function makeRepo(name: string, branch: string, body: string): { root: string; sha: string } {
  const root = mkdtempSync(path.join(tmpdir(), `readiness-${name}-`));
  scratchDirectories.push(root);
  git(root, ["init", "--quiet", "-b", branch]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  writeFileSync(path.join(root, "fixture.txt"), body);
  git(root, ["add", "--", "fixture.txt"]);
  git(root, ["commit", "--quiet", "-m", `${name} fixture`]);
  return { root, sha: git(root, ["rev-parse", "HEAD"]) };
}

function withGitPoison<T>(elsewhere: string, action: () => T): T {
  const beforeDir = process.env.GIT_DIR;
  const beforeWorkTree = process.env.GIT_WORK_TREE;
  process.env.GIT_DIR = path.join(elsewhere, ".git");
  process.env.GIT_WORK_TREE = elsewhere;
  try {
    return action();
  } finally {
    if (beforeDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = beforeDir;
    if (beforeWorkTree === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = beforeWorkTree;
  }
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const NOW_MS = Date.parse("2026-09-09T18:00:00.000Z");
const SHA_A = "3333333333333333333333333333333333333333";
const SHA_B = "4444444444444444444444444444444444444444";
const SHA_C = "5555555555555555555555555555555555555555";
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
    failedTestFiles: null,
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

function knownDev(sha: string): Extract<TickInput["dev"], { kind: "known" }> {
  return {
    kind: "known",
    devSha: sha,
    primarySha: sha,
    primaryBehind: 0,
    trunkGap: 1,
    observedAt: new Date(NOW_MS).toISOString(),
    caveat: "cached origin/dev",
  };
}

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

type FakeCommandResult = ReturnType<PreparationDeps["exec"]>;

function commandResult(over: Partial<FakeCommandResult> = {}): FakeCommandResult {
  return {
    status: 0,
    signal: null,
    stdout: "",
    stderr: "",
    error: null,
    ...over,
  };
}

function preparedAt(
  sha: string,
  needs: Partial<PreparationState["needs"]> = {},
): PreparationState {
  return {
    preparedFor: sha,
    needs: { dependencies: false, migrations: false, ...needs },
    fleetBuiltFor: { sha, manifest: "fixture manifest" },
  };
}

/** What production asks npm for. Spelt out here, not imported: a test that
    read the flags from the code could not notice one being dropped. */
const NPM_CI = { command: "npm", args: ["ci", "--prefer-offline", "--dry-run=false", "--ignore-scripts=false"] };

/** Runs `action` with extra variables in `process.env`, and puts it back. */
function withEnv<T>(extra: Record<string, string>, action: () => T): T {
  const before = new Map(Object.keys(extra).map((name) => [name, process.env[name]]));
  Object.assign(process.env, extra);
  try {
    return action();
  } finally {
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const npmConfigNames = (env: NodeJS.ProcessEnv): string[] =>
  Object.keys(env).filter((name) => name.toLowerCase().startsWith("npm_config_"));

function fleetDist(runner: string): string {
  return path.join(runner, "tools", "fleet", "web", "dist");
}

type SeenAtBuild = { entry: boolean; stamp: boolean; manifest: boolean };

/**
 * A stand-in for `npm run build:fleet` that **records what was on disk at the
 * moment it was called**, then does whatever `write` says and exits as told.
 * Looking before writing is what makes the pre-build removal testable: a fake
 * that simply overwrites cannot tell whether the old files were cleared first.
 */
function fakeFleetBuild(
  runner: string,
  write: (dist: string, attempt: number) => void,
  exit: (attempt: number) => Partial<FakeCommandResult> = () => ({}),
): { exec: typeof runCommand; seen: SeenAtBuild[] } {
  const dist = fleetDist(runner);
  const seen: SeenAtBuild[] = [];
  const exec: typeof runCommand = (cwd, command, args) => {
    expect({ cwd, command, args }).toEqual({ cwd: runner, command: "npm", args: ["run", "build:fleet"] });
    seen.push({
      entry: existsSync(path.join(dist, "index.html")),
      stamp: existsSync(path.join(dist, BUILD_STAMP_FILE)),
      manifest: existsSync(path.join(dist, BUILD_FILES_FILE)),
    });
    write(dist, seen.length);
    return commandResult(exit(seen.length));
  };
  return { exec, seen };
}

/** The real `runCommand`, with a note of each git subcommand it was asked for. */
function gitSpy(): { exec: typeof runCommand; subcommands: () => string[] } {
  const asked: string[] = [];
  return {
    exec: (cwd, command, args, timeout, sourceEnv) => {
      if (command === "git") asked.push(args[0] ?? "");
      return runCommand(cwd, command, args, timeout, sourceEnv);
    },
    subcommands: () => [...asked],
  };
}

const NOTHING_THERE: SeenAtBuild ={ entry: false, stamp: false, manifest: false };

const cleanBundle = (sha: string): FixtureStamp => ({ kind: "known", sha, dirty: false });

function scratchRunner(name: string): string {
  const runner = mkdtempSync(path.join(tmpdir(), `readiness-${name}-`));
  scratchDirectories.push(runner);
  return runner;
}

/**
 * A package with no dependencies, so `npm ci` needs no network, whose two
 * observable effects are the two ways an install can be hollow: a root
 * `postinstall` that writes a file (lifecycle scripts ran), and a stale file in
 * `node_modules` that a real `npm ci` removes (it was not a dry run).
 */
function npmFixture(name: string): { runner: string; postinstall: string; stale: string } {
  const runner = scratchRunner(name);
  writeFileSync(path.join(runner, "package.json"), JSON.stringify({
    name: "fixture",
    version: "1.0.0",
    scripts: { postinstall: `node -e "require('fs').writeFileSync('postinstall-ran','yes')"` },
  }));
  writeFileSync(path.join(runner, "package-lock.json"), JSON.stringify({
    name: "fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: { "": { name: "fixture", version: "1.0.0", hasInstallScript: true } },
  }));
  mkdirSync(path.join(runner, "node_modules"));
  const stale = path.join(runner, "node_modules", "from-a");
  writeFileSync(stale, "old dependency tree\n");
  return { runner, postinstall: path.join(runner, "postinstall-ran"), stale };
}

/** `prepareRunner`'s real `npm ci` — its own command and arguments, through
    the real `runCommand` — and nothing else real. */
function realNpmCiDeps(sourceEnv: NodeJS.ProcessEnv): PreparationDeps {
  return preparationFakes({
    exec: (cwd, command, args) => {
      if (command === "git" && args[0] === "diff") return commandResult({ stdout: "package-lock.json\n" });
      if (command === "npm" && args[0] === "ci") return runCommand(cwd, command, args, 60_000, sourceEnv);
      return commandResult();
    },
    stamp: () => clean(SHA_B),
  }).deps;
}

function preparationFakes(over: Partial<PreparationDeps> = {}): {
  calls: Array<{ command: string; args: readonly string[] }>;
  builds: ReturnType<typeof vi.fn<PreparationDeps["buildFleetClient"]>>;
  deps: PreparationDeps;
} {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const execImpl = over.exec ?? (() => commandResult());
  const exec = vi.fn<PreparationDeps["exec"]>((cwd, command, args, sourceEnv) => {
    calls.push({ command, args: [...args] });
    return execImpl(cwd, command, args, sourceEnv);
  });
  const builds = vi.fn<PreparationDeps["buildFleetClient"]>(over.buildFleetClient);
  return {
    calls,
    builds,
    deps: {
      exec,
      buildFleetClient: builds,
      databaseEnv: over.databaseEnv ?? (() => ({})),
      stamp: over.stamp ?? (() => clean(SHA_B)),
    },
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
      why: "The latest full check for 333333333333 ended without a verdict less than 30 minutes after its recorded instant. Wait for that spacing before trying again.",
    });

    const cooled = reading(finished({ at: new Date(NOW_MS - VOID_RETRY_COOLDOWN_MS).toISOString() }));
    expect(decideTick(input({ history: { readings: [cooled], unreadable: [] } }))).toEqual({ kind: "run", sha: SHA_A });
  });

  it("retries a newer void after cooldown even when an older pass exists", () => {
    const passed = reading(finished({
      runId: "loopolderpass",
      startedAt: new Date(NOW_MS - 3 * 60 * 60_000).toISOString(),
      at: new Date(NOW_MS - 2 * 60 * 60_000).toISOString(),
      outcome: "pass",
      exit: 0,
    }));
    const killedLater = reading(finished({
      runId: "loopnewervoid",
      startedAt: new Date(NOW_MS - 90 * 60_000).toISOString(),
      at: new Date(NOW_MS - 60 * 60_000).toISOString(),
    }));

    expect(decideTick(input({ history: { readings: [passed, killedLater], unreadable: [] } }))).toEqual({
      kind: "run",
      sha: SHA_A,
    });
  });

  it("stops after three voids for one sha in the rolling window", () => {
    const voids = Array.from({ length: MAX_VOIDS_PER_WINDOW }, (_, index) =>
      reading(finished({
        runId: `loopvoid0${index}`,
        startedAt: new Date(NOW_MS - (index + 2) * 60 * 60_000).toISOString(),
        at: new Date(NOW_MS - (index + 1) * 60 * 60_000).toISOString(),
      })),
    );
    expect(decideTick(input({ history: { readings: voids, unreadable: [] } }))).toEqual({
      kind: "skip",
      why: "This commit's full check ended without a verdict 3 times in the Readiness tab's 24-hour window. Stop for this window and inspect the recorded reasons.",
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

describe("runner preparation follows the checked-out state", () => {
  it("does not prepare derived state from a dirty tree", () => {
    expect(preparationTarget(
      null,
      { kind: "known", sha: SHA_B, branch: "readiness-checks", dirty: true },
      knownDev(SHA_B),
    )).toBeNull();
  });

  it("does not prepare a clean runner commit that is not origin/dev", () => {
    expect(preparationTarget(
      null,
      { kind: "known", sha: SHA_C, branch: "readiness-checks", dirty: false },
      knownDev(SHA_B),
    )).toBeNull();
  });

  it("starts unprepared so a restart repairs an interrupted install or migration", () => {
    expect(initialPreparationState()).toEqual({
      preparedFor: null,
      needs: { dependencies: true, migrations: true },
      fleetBuiltFor: null,
    });
  });

  it("recognises this repo's drizzle migrations, including metadata", () => {
    expect(preparationAfterChanges(
      { dependencies: false, migrations: false },
      ["drizzle/0053_new_table.sql", "drizzle/meta/_journal.json"],
    )).toEqual({ dependencies: false, migrations: true });
  });

  /* One name at a time. Two together cannot tell which of them the classifier
     knows: GPT Sol's R724-04 found `.npmrc` and `npm-shrinkwrap.json` tested as
     a pair, so either could be deleted from the list with the test still green.
     And each is followed through `prepareRunner` to the two places it has to
     reach — the arguments git is given, and the install. */
  it.each([".npmrc", "npm-shrinkwrap.json", "package.json", "package-lock.json"])(
    "treats %s, alone, as a reason to install again — and asks git about it",
    (name) => {
      expect(preparationAfterChanges({ dependencies: false, migrations: false }, [name]))
        .toEqual({ dependencies: true, migrations: false });

      const state = preparedAt(SHA_A);
      const { calls, deps } = preparationFakes({
        exec: (_cwd, command, args) =>
          command === "git" && args[0] === "diff" ? commandResult({ stdout: `${name}\n` }) : commandResult(),
      });
      prepareRunner("/runner", state, SHA_B, deps);

      const diff = calls.find((call) => call.command === "git" && call.args[0] === "diff");
      expect(diff?.args.slice(diff.args.indexOf("--") + 1)).toContain(name);
      expect(calls).toContainEqual(NPM_CI);
      expect(calls).not.toContainEqual({ command: "npm", args: ["run", "db:migrate"] });
    },
  );

  it("asks git about exactly the paths the classifier reads, from one list", () => {
    const state = preparedAt(SHA_A);
    const { calls, deps } = preparationFakes();

    prepareRunner("/runner", state, SHA_B, deps);

    /* Spelt out, so that a name dropped from the shared constant is noticed
       here as well as by the classifier's own cases above. No fleet path is on
       it: the bundle is asked which commit it is, not guessed from a diff. */
    expect(calls[0]).toEqual({
      command: "git",
      args: [
        "diff", "--name-only", SHA_A, SHA_B, "--",
        ".npmrc", "npm-shrinkwrap.json", "package.json", "package-lock.json", "drizzle",
      ],
    });
    expect(PREPARATION_PATHSPEC).toEqual([...DEPENDENCY_INPUTS, "drizzle"]);
  });

  it("keeps an unknown change classification safe by preparing everything", () => {
    const state = preparedAt(SHA_A);
    const { calls, deps } = preparationFakes({
      exec: (_cwd, command, args) =>
        command === "git" && args[0] === "diff"
          ? commandResult({ status: 1, stderr: "fatal: temporary object read failure" })
          : commandResult(),
    });

    prepareRunner("/runner", state, SHA_B, deps);

    expect(calls).toContainEqual(NPM_CI);
    expect(calls).toContainEqual({ command: "npm", args: ["run", "db:migrate"] });
    expect(state.preparedFor).toBe(SHA_B);
  });

  it("does not spend the sha transition when npm ci fails, and retries it next tick", () => {
    const state = preparedAt(SHA_A);
    let diffAttempts = 0;
    let installAttempts = 0;
    const { deps } = preparationFakes({
      exec: (_cwd, command, args) => {
        if (command === "git" && args[0] === "diff") {
          diffAttempts += 1;
          return diffAttempts === 1
            ? commandResult({ status: 1, stderr: "fatal: temporary object read failure" })
            : commandResult({ stdout: "package-lock.json\n" });
        }
        if (command === "npm" && args[0] === "ci") {
          installAttempts += 1;
          return installAttempts === 1
            ? commandResult({ status: 1, stderr: "npm ci failed" })
            : commandResult();
        }
        return commandResult();
      },
    });

    expect(() => prepareRunner("/runner", state, SHA_B, deps)).toThrow(/installing dependencies/);
    expect(state.preparedFor).toBe(SHA_A);

    prepareRunner("/runner", state, SHA_B, deps);
    expect(diffAttempts).toBe(2);
    expect(installAttempts).toBe(2);
    expect(state.preparedFor).toBe(SHA_B);
  });

  it("keeps successful partial work pending when a later preparation step fails", () => {
    const state = preparedAt(SHA_A);
    let installAttempts = 0;
    let buildAttempts = 0;
    let target = SHA_B;
    const { deps } = preparationFakes({
      exec: (_cwd, command, args) => {
        if (command === "git" && args[0] === "diff") {
          return commandResult({ stdout: target === SHA_B ? "package-lock.json\n" : "" });
        }
        if (command === "npm" && args[0] === "ci") installAttempts += 1;
        return commandResult();
      },
      buildFleetClient: () => {
        buildAttempts += 1;
        if (buildAttempts === 1) throw new Error("fleet build failed");
      },
      stamp: () => clean(target),
    });

    expect(() => prepareRunner("/runner", state, SHA_B, deps)).toThrow(/fleet build failed/);
    expect(state.preparedFor).toBe(SHA_A);
    expect(state.needs.dependencies).toBe(true);

    target = SHA_C;
    prepareRunner("/runner", state, SHA_C, deps);
    expect(installAttempts).toBe(2);
    expect(state.preparedFor).toBe(SHA_C);
  });

  it("narrows successful classification to the preparation its paths need", () => {
    const state = preparedAt(SHA_A);
    const { calls, builds, deps } = preparationFakes({
      exec: (_cwd, command, args) =>
        command === "git" && args[0] === "diff"
          ? commandResult({ stdout: "drizzle/0053_new_table.sql\n" })
          : commandResult(),
    });

    prepareRunner("/runner", state, SHA_B, deps);

    expect(calls.some((call) => call.command === "npm" && call.args[0] === "ci")).toBe(false);
    expect(calls).toContainEqual({ command: "npm", args: ["run", "db:migrate"] });
    expect(builds).toHaveBeenCalledWith("/runner", SHA_B, state);
    expect(state.preparedFor).toBe(SHA_B);
  });

  it("does not change preparation without a validated target", () => {
    const state = preparedAt(SHA_A, { dependencies: true });
    const { calls, builds, deps } = preparationFakes();

    prepareRunner("/runner", state, null, deps);

    expect(calls).toEqual([]);
    expect(builds).not.toHaveBeenCalled();
    expect(state).toEqual({
      preparedFor: SHA_A,
      needs: { dependencies: true, migrations: false },
      fleetBuiltFor: { sha: SHA_A, manifest: "fixture manifest" },
    });
  });

  /* A REAL `npm ci`, asked for exactly as production asks, in a fixture that
     needs no network. Each inherited variable below makes npm 11.19.0 exit 0
     having skipped something, measured 2026-10-06: `ignore_scripts` and
     `script_shell=/bin/true` skip the postinstall, `dry_run` leaves
     node_modules alone. `script_shell` is the one no command-line flag here
     answers, so it is the case that dies if `runCommand` stops scrubbing. */
  it.each([
    ["npm_config_ignore_scripts", "true"],
    ["npm_config_script_shell", "/bin/true"],
    ["NPM_CONFIG_SCRIPT_SHELL", "/bin/true"],
    ["npm_config_dry_run", "true"],
  ])("installs for real, lifecycle scripts included, under an inherited %s=%s", (name, value) => {
    const { runner, postinstall, stale } = npmFixture("npm-env");

    prepareRunner(runner, preparedAt(SHA_A), SHA_B, realNpmCiDeps({ ...process.env, [name]: value }));

    expect(existsSync(postinstall), "the root postinstall did not run").toBe(true);
    expect(existsSync(stale), "node_modules was not replaced").toBe(false);
  });

  /* The same two settings from a project `.npmrc`, which is not the
     environment and so is not scrubbed: these are what the two flags on the
     command line are for, and each case dies with its flag. */
  it.each([
    ["ignore-scripts=true", "--ignore-scripts=false"],
    ["dry-run=true", "--dry-run=false"],
  ])("installs for real when .npmrc says %s, because the command says %s", (setting) => {
    const { runner, postinstall, stale } = npmFixture("npm-rc");
    writeFileSync(path.join(runner, ".npmrc"), `${setting}\n`);

    prepareRunner(runner, preparedAt(SHA_A), SHA_B, realNpmCiDeps(runnerChildEnv()));

    expect(existsSync(postinstall), "the root postinstall did not run").toBe(true);
    expect(existsSync(stale), "node_modules was not replaced").toBe(false);
  });
});

describe("the fleet client is built by this process, for this commit, and checked", () => {
  it("clears the entry, the stamp and the manifest before it builds", () => {
    const runner = scratchRunner("fleet-clear");
    writeFleetBundle(fleetDist(runner), cleanBundle(SHA_A));
    const state = preparedAt(SHA_A);
    const build = fakeFleetBuild(runner, (dist) => writeFleetBundle(dist, cleanBundle(SHA_B)));

    ensureFleetClient(runner, SHA_B, state, build.exec);

    /* Three separate facts, so that leaving any one of the three in place is
       its own failure. */
    expect(build.seen).toHaveLength(1);
    expect(build.seen[0]?.entry, "index.html was still there when the build started").toBe(false);
    expect(build.seen[0]?.stamp, "build-stamp.json was still there when the build started").toBe(false);
    expect(build.seen[0]?.manifest, "build-files.json was still there when the build started").toBe(false);
    expect(state.fleetBuiltFor?.sha).toBe(SHA_B);
  });

  it("does not reuse a bundle it found on disk at start, however well stamped", () => {
    const runner = scratchRunner("fleet-found");
    writeFleetBundle(fleetDist(runner), cleanBundle(SHA_B));
    expect(fleetBundleProblem(fleetDist(runner), SHA_B)).toBeNull();
    const state = initialPreparationState();
    const build = fakeFleetBuild(runner, (dist) => writeFleetBundle(dist, cleanBundle(SHA_B)));

    ensureFleetClient(runner, SHA_B, state, build.exec);

    expect(build.seen).toEqual([NOTHING_THERE]);
    expect(state.fleetBuiltFor?.sha).toBe(SHA_B);
  });

  it("builds once per commit: a second look at an intact bundle builds nothing", () => {
    const runner = scratchRunner("fleet-once");
    const state = initialPreparationState();
    const build = fakeFleetBuild(runner, (dist) => writeFleetBundle(dist, cleanBundle(SHA_B)));

    ensureFleetClient(runner, SHA_B, state, build.exec);
    ensureFleetClient(runner, SHA_B, state, build.exec);

    expect(build.seen).toHaveLength(1);
  });

  it("does not reuse a different whole bundle substituted at the same commit", () => {
    const runner = scratchRunner("fleet-replaced");
    const state = initialPreparationState();
    const build = fakeFleetBuild(runner, (dist) => writeFleetBundle(dist, cleanBundle(SHA_B)));
    ensureFleetClient(runner, SHA_B, state, build.exec);
    const original = readFileSync(path.join(fleetDist(runner), BUILD_FILES_FILE), "utf8");

    // A hand-run build can consume an untracked source and still stamp clean.
    // Removing that source afterwards leaves another valid bundle at this SHA.
    writeFleetBundle(fleetDist(runner), cleanBundle(SHA_B), { entry: "<!doctype html><p>different build</p>\n" });
    expect(fleetBundleProblem(fleetDist(runner), SHA_B)).toBeNull();
    expect(readFileSync(path.join(fleetDist(runner), BUILD_FILES_FILE), "utf8")).not.toBe(original);

    ensureFleetClient(runner, SHA_B, state, build.exec);

    expect(build.seen).toHaveLength(2);
    expect(readFileSync(path.join(fleetDist(runner), BUILD_FILES_FILE), "utf8")).toBe(original);
  });

  it.each([
    ["dirty", { ...clean(SHA_B), dirty: true }],
    ["unknown", { kind: "unknown", why: "git status timed out" }],
    ["at another sha", clean(SHA_A)],
  ] as const)("rebuilds after the post-build tree was %s, even if it is later clean at the target", (_name, stamp) => {
    const runner = scratchRunner("fleet-unproven-tree");
    const state = initialPreparationState();
    const build = fakeFleetBuild(runner, (dist) => writeFleetBundle(dist, cleanBundle(SHA_B)));
    const { deps } = preparationFakes({
      buildFleetClient: (cwd, target, preparation) => ensureFleetClient(cwd, target, preparation, build.exec),
      stamp: () => stamp,
    });

    expect(() => prepareRunner(runner, state, SHA_B, deps)).toThrow(/preparation.*not latched/);
    expect(state.preparedFor).toBeNull();
    expect(state.fleetBuiltFor).toBeNull();
    prepareRunner(runner, state, SHA_B, { ...deps, stamp: () => clean(SHA_B) });

    expect(build.seen).toHaveLength(2);
    expect(state.preparedFor).toBe(SHA_B);
  });

  it("checks the tree after rebuilding an already prepared commit", () => {
    const runner = scratchRunner("fleet-rebuild-tree");
    const state = initialPreparationState();
    const build = fakeFleetBuild(runner, (dist) => writeFleetBundle(dist, cleanBundle(SHA_B)));
    const { deps } = preparationFakes({
      buildFleetClient: (cwd, target, preparation) => ensureFleetClient(cwd, target, preparation, build.exec),
    });
    prepareRunner(runner, state, SHA_B, deps);
    rmSync(path.join(fleetDist(runner), FIXTURE_FONT));

    expect(() => prepareRunner(runner, state, SHA_B, {
      ...deps, stamp: () => ({ ...clean(SHA_B), dirty: true }),
    })).toThrow(/preparation.*not latched/);
    expect(state.preparedFor).toBeNull();
    expect(state.fleetBuiltFor).toBeNull();

    prepareRunner(runner, state, SHA_B, deps);
    expect(build.seen).toHaveLength(3);
  });

  it("rebuilds a bundle it built itself once a file of it has gone", () => {
    const runner = scratchRunner("fleet-gone");
    const state = initialPreparationState();
    const build = fakeFleetBuild(runner, (dist) => writeFleetBundle(dist, cleanBundle(SHA_B)));
    ensureFleetClient(runner, SHA_B, state, build.exec);

    rmSync(path.join(fleetDist(runner), FIXTURE_FONT));
    ensureFleetClient(runner, SHA_B, state, build.exec);

    expect(build.seen).toHaveLength(2);
    expect(fleetBundleProblem(fleetDist(runner), SHA_B)).toBeNull();
  });

  /* The case the path list could never get right (GPT Sol's R724-01): the
     commit changed nothing the diff is asked about, and the bundle on disk is
     a perfectly good build — of the previous commit. Through `prepareRunner`,
     because that is where a diff used to decide this. */
  it("rebuilds for a new commit even when the diff between the two is empty", () => {
    const runner = scratchRunner("fleet-a-to-b");
    writeFleetBundle(fleetDist(runner), cleanBundle(SHA_A));
    const state = preparedAt(SHA_A);
    const build = fakeFleetBuild(runner, (dist) => writeFleetBundle(dist, cleanBundle(SHA_B)));
    const { calls, deps } = preparationFakes({
      buildFleetClient: (cwd, target, preparation) => ensureFleetClient(cwd, target, preparation, build.exec),
    });

    prepareRunner(runner, state, SHA_B, deps);

    expect(calls.map((call) => `${call.command} ${call.args[0]}`)).toEqual(["git diff"]);
    expect(build.seen).toEqual([NOTHING_THERE]);
    expect(state).toEqual({
      preparedFor: SHA_B,
      needs: { dependencies: false, migrations: false },
      fleetBuiltFor: { sha: SHA_B, manifest: readFileSync(path.join(fleetDist(runner), BUILD_FILES_FILE), "utf8") },
    });
  });

  /* A build that exits 0 is not a build that worked. Each of these writes
     something different and wrong, and none may be latched. The predicates
     themselves are taken apart one at a time in fleet-build-files.test.ts;
     these show the runner asks. */
  it.each<[string, (dist: string) => void, RegExp]>([
    ["nothing at all", () => undefined, /no build-files\.json/],
    [
      "an index.html and nothing else",
      (dist) => {
        mkdirSync(dist, { recursive: true });
        writeFileSync(path.join(dist, "index.html"), "<!doctype html>\n");
      },
      /no build-files\.json/,
    ],
    [
      "a whole bundle with an empty index.html",
      (dist) => {
        writeFleetBundle(dist, cleanBundle(SHA_B));
        truncateSync(path.join(dist, "index.html"), 0);
      },
      /index\.html is 0 bytes/,
    ],
    [
      "a whole bundle with truncated JavaScript",
      (dist) => {
        writeFleetBundle(dist, cleanBundle(SHA_B));
        truncateSync(path.join(dist, FIXTURE_JS), 10);
      },
      /is 10 bytes/,
    ],
    ["a whole bundle stamped for another commit", (dist) => writeFleetBundle(dist, cleanBundle(SHA_C)), /was built at 5{40}, not 4{40}/],
    [
      "a whole bundle stamped dirty",
      (dist) => writeFleetBundle(dist, { kind: "known", sha: SHA_B, dirty: true }),
      /uncommitted changes/,
    ],
  ])("refuses a build that exits 0 having written %s", (_name, write, expected) => {
    const runner = scratchRunner("fleet-hollow");
    const state = initialPreparationState();
    const build = fakeFleetBuild(runner, write);

    expect(() => ensureFleetClient(runner, SHA_B, state, build.exec)).toThrow(expected);
    expect(() => ensureFleetClient(runner, SHA_B, state, build.exec)).toThrow(/build:fleet exited 0/);

    expect(build.seen).toHaveLength(2);
    expect(state.fleetBuiltFor).toBeNull();
  });

  it("forgets what it built when the next build fails, and trusts nothing that build left", () => {
    const runner = scratchRunner("fleet-partial");
    const dist = fleetDist(runner);
    const state = initialPreparationState();
    const build = fakeFleetBuild(
      runner,
      (target, attempt) => {
        /* The failed attempt leaves a complete, valid-looking bundle behind:
           the worst thing a failed build can leave. */
        writeFleetBundle(target, cleanBundle(attempt === 1 ? SHA_A : SHA_B));
      },
      (attempt) => (attempt === 2 ? { status: 1, stderr: "vite failed" } : {}),
    );
    ensureFleetClient(runner, SHA_A, state, build.exec);
    expect(state.fleetBuiltFor?.sha).toBe(SHA_A);

    expect(() => ensureFleetClient(runner, SHA_B, state, build.exec)).toThrow(/vite failed/);

    expect(state.fleetBuiltFor).toBeNull();
    expect(existsSync(path.join(dist, "index.html"))).toBe(false);
    expect(existsSync(path.join(dist, BUILD_STAMP_FILE))).toBe(false);
    expect(existsSync(path.join(dist, BUILD_FILES_FILE))).toBe(false);

    ensureFleetClient(runner, SHA_B, state, build.exec);
    expect(build.seen).toEqual([NOTHING_THERE, NOTHING_THERE, NOTHING_THERE]);
    expect(state.fleetBuiltFor?.sha).toBe(SHA_B);
  });
});

describe("runner preparation latches only what it prepared", () => {
  it("keeps pending needs when this call did not run dependency or migration preparation", () => {
    const state = preparedAt(SHA_B, { dependencies: true, migrations: true });
    const { calls, deps } = preparationFakes();

    prepareRunner("/runner", state, SHA_B, deps);

    expect(calls).toEqual([]);
    expect(state.needs).toEqual({ dependencies: true, migrations: true });
  });

  it("skips classification when preparation is already latched to the target", () => {
    const state = preparedAt(SHA_B);
    const { calls, builds, deps } = preparationFakes();

    prepareRunner("/runner", state, SHA_B, deps);

    expect(calls.some((call) => call.command === "git" && call.args[0] === "diff")).toBe(false);
    expect(builds).toHaveBeenCalledWith("/runner", SHA_B, state);
  });

  it("distinguishes an unknown classification from no changed paths", () => {
    const needs = { dependencies: false, migrations: true };
    expect(preparationAfterChanges(needs, null)).toEqual({
      dependencies: true,
      migrations: true,
    });
    expect(preparationAfterChanges(needs, [])).toEqual(needs);
  });

  it.each([
    ["dirty", { ...clean(SHA_B), dirty: true }],
    ["unknown", { kind: "unknown", why: "git status timed out" }],
    ["at another sha", clean(SHA_A)],
  ] as const)("does not latch preparation when the post-preparation tree is %s", (_name, stamp) => {
    const state = preparedAt(SHA_A);
    const { deps } = preparationFakes({ stamp: () => stamp });

    expect(() => prepareRunner("/runner", state, SHA_B, deps)).toThrow(/preparation.*not latched/);

    expect(state.preparedFor).toBeNull();
  });

  it("warns with both shas and git's error when classification fails", () => {
    const state = preparedAt(SHA_A);
    const warning = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { deps } = preparationFakes({
      exec: (_cwd, command, args) =>
        command === "git" && args[0] === "diff"
          ? commandResult({ status: 128, stderr: "fatal: bad object bbbb" })
          : commandResult(),
    });

    try {
      prepareRunner("/runner", state, SHA_B, deps);

      expect(warning).toHaveBeenCalledTimes(1);
      expect(warning.mock.calls[0]?.[0]).toContain(SHA_A);
      expect(warning.mock.calls[0]?.[0]).toContain(SHA_B);
      expect(warning.mock.calls[0]?.[0]).toContain("fatal: bad object bbbb");
    } finally {
      warning.mockRestore();
    }
  });
});

describe("the unattended process boundary", () => {
  it("stamps its requested repository when inherited git variables point elsewhere", () => {
    const home = makeRepo("home", "home-branch", "home contents\n");
    const elsewhere = makeRepo("elsewhere", "elsewhere-branch", "different contents\n");
    expect(home.sha).not.toBe(elsewhere.sha);

    withGitPoison(elsewhere.root, () => {
      const poisoned = git(home.root, ["-C", home.root, "rev-parse", "HEAD"]);
      expect(poisoned).toBe(elsewhere.sha);

      expect(stampTree(home.root)).toEqual({
        kind: "known",
        sha: home.sha,
        branch: "home-branch",
        dirty: false,
      });
    });
  });

  it("runs commands in its requested repository despite inherited git variables", () => {
    const home = makeRepo("command-home", "command-home-branch", "command home\n");
    const elsewhere = makeRepo("command-elsewhere", "command-elsewhere-branch", "command elsewhere\n");

    withGitPoison(elsewhere.root, () => {
      const result = runCommand(home.root, "git", ["rev-parse", "HEAD"]);
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(home.sha);
    });
  });

  it("resolves ancestry in its requested repository despite inherited git variables", () => {
    const home = makeRepo("relation-home", "relation-home-branch", "relation one\n");
    const firstSha = home.sha;
    writeFileSync(path.join(home.root, "fixture.txt"), "relation two\n");
    git(home.root, ["add", "--", "fixture.txt"]);
    git(home.root, ["commit", "--quiet", "-m", "second relation fixture"]);
    const secondSha = git(home.root, ["rev-parse", "HEAD"]);
    const elsewhere = makeRepo("relation-elsewhere", "relation-elsewhere-branch", "unrelated\n");

    withGitPoison(elsewhere.root, () => {
      expect(makeRelationCache(home.root).relate(firstSha, secondSha)).toEqual({
        kind: "behind-dev",
        behind: 1,
      });
    });
  });

  it("builds one git environment that removes every location override", () => {
    const source: NodeJS.ProcessEnv = { KEEP_ME: "yes" };
    for (const name of GIT_LOCATION_ENV) source[name] = `poison-${name}`;

    const env = gitEnv(source);

    for (const name of GIT_LOCATION_ENV) expect(env).not.toHaveProperty(name);
    expect(env).toMatchObject({
      KEEP_ME: "yes",
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
    });
    expect(source).toHaveProperty("GIT_DIR", "poison-GIT_DIR");
  });

  it("builds one runner environment that also removes every npm_config variable, in any case", () => {
    const source: NodeJS.ProcessEnv = {
      KEEP_ME: "yes",
      GIT_DIR: "/elsewhere/.git",
      npm_config_ignore_scripts: "true",
      NPM_CONFIG_SCRIPT_SHELL: "/bin/true",
      Npm_Config_Dry_Run: "true",
      npm_config_cache: "/somewhere/.npm",
      npm_package_json: "/repo/package.json",
      npm_lifecycle_event: "readiness",
      NOT_npm_config_x: "kept",
    };

    const env = runnerChildEnv(source);

    expect(npmConfigNames(env)).toEqual([]);
    expect(env).not.toHaveProperty("GIT_DIR");
    expect(env).toMatchObject({
      KEEP_ME: "yes",
      GIT_NO_REPLACE_OBJECTS: "1",
      npm_package_json: "/repo/package.json",
      npm_lifecycle_event: "readiness",
      NOT_npm_config_x: "kept",
    });
    expect(source).toHaveProperty("npm_config_ignore_scripts", "true");
  });

  it("starts every command without the npm configuration its own shell inherited", () => {
    const listed = runCommand(
      process.cwd(),
      process.execPath,
      ["-e", "console.log(JSON.stringify(Object.keys(process.env).filter((k) => /^npm_config_/i.test(k))))"],
      30_000,
      { ...process.env, npm_config_script_shell: "/bin/true", NPM_CONFIG_IGNORE_SCRIPTS: "true" },
    );
    expect(listed.status).toBe(0);
    expect(JSON.parse(listed.stdout)).toEqual([]);
  });

  /**
   * A `refs/replace` ref substitutes one object for another wherever its sha is
   * mentioned, and `refs/replace/` is shared by every linked worktree — so one
   * `git replace` on this box reaches the runner. The tree still stamps the true
   * sha and still reports clean, which is why this needs a test that looks at
   * the bytes on disk rather than at any stamp.
   */
  it("fast-forwards to the commit's real content even when a replace ref substitutes it", () => {
    const origin = makeRepo("replace-origin", "dev", "honest A\n");
    const shaA = origin.sha;
    writeFileSync(path.join(origin.root, "fixture.txt"), "HONEST B CONTENT\n");
    git(origin.root, ["add", "--", "fixture.txt"]);
    git(origin.root, ["commit", "--quiet", "-m", "B"]);
    const shaB = git(origin.root, ["rev-parse", "HEAD"]);

    /* A commit with the same parent and different content, put in B's place. */
    writeFileSync(path.join(origin.root, "fixture.txt"), "SUBSTITUTED CONTENT\n");
    git(origin.root, ["add", "--", "fixture.txt"]);
    const tree = git(origin.root, ["write-tree"]);
    const fake = git(origin.root, ["commit-tree", tree, "-p", shaA, "-m", "substitute"]);
    git(origin.root, ["checkout", "--quiet", "--", "fixture.txt"]);
    git(origin.root, ["replace", shaB, fake]);

    const consumer = mkdtempSync(path.join(tmpdir(), "readiness-replace-consumer-"));
    scratchDirectories.push(consumer);
    git(path.dirname(consumer), ["clone", "--quiet", origin.root, consumer]);
    git(consumer, ["checkout", "--quiet", "-B", "work", shaA]);
    git(consumer, ["fetch", "--quiet", "origin", "+refs/replace/*:refs/replace/*"]);
    git(consumer, ["fetch", "--quiet", "origin", "dev"]);

    const merged = runCommand(consumer, "git", ["merge", "--ff-only", "origin/dev"]);
    expect(merged.status).toBe(0);

    /* The stamp cannot tell the difference — that is the whole point of it. */
    expect(stampTree(consumer)).toEqual({ kind: "known", sha: shaB, branch: "work", dirty: false });
    expect(readFileSync(path.join(consumer, "fixture.txt"), "utf8")).toBe("HONEST B CONTENT\n");
  });

  /* The two spawns that launch the check itself, asked for their real
     environments rather than pattern-matched in the source. Both build it
     through a named function that the spawn call then uses, so what is asserted
     here is what production hands the child. */
  it("scrubs the environment the check itself is launched with", () => {
    const runner = mkdtempSync(path.join(tmpdir(), "readiness-check-env-"));
    scratchDirectories.push(runner);
    writeFileSync(
      path.join(runner, ".env.local"),
      "DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54362/postgres\n",
    );
    const elsewhere = makeRepo("check-env-elsewhere", "check-env-branch", "check env\n");

    withGitPoison(elsewhere.root, () => {
      for (const name of GIT_LOCATION_ENV) {
        expect(readinessCheckEnv(runner)).not.toHaveProperty(name);
        expect(checkChildEnv("0123456789abcdef0123456789abcdef")).not.toHaveProperty(name);
      }
      /* Both must still carry what they exist to carry. */
      expect(readinessCheckEnv(runner).DATABASE_URL).toBe(
        "postgres://postgres:postgres@127.0.0.1:54362/postgres",
      );
      expect(checkChildEnv("0123456789abcdef0123456789abcdef")[READINESS_ADMISSION_TOKEN_ENV]).toBe(
        "0123456789abcdef0123456789abcdef",
      );
      /* The premise: process.env really is poisoned while all that is true. */
      expect(process.env.GIT_DIR).toBe(path.join(elsewhere.root, ".git"));
    });
  });

  /* The same two spawns, for npm's inherited configuration. One assertion per
     function, each on what that function returns, so that either can lose its
     scrub alone and be the one that fails. */
  it("launches the check without the npm configuration this process inherited", () => {
    const runner = scratchRunner("check-npm-env");
    writeFileSync(
      path.join(runner, ".env.local"),
      "DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54362/postgres\n",
    );

    withEnv({ npm_config_script_shell: "/bin/true", NPM_CONFIG_IGNORE_SCRIPTS: "true" }, () => {
      expect(npmConfigNames(process.env)).toEqual(
        expect.arrayContaining(["npm_config_script_shell", "NPM_CONFIG_IGNORE_SCRIPTS"]),
      );
      expect(npmConfigNames(readinessCheckEnv(runner)), "the loop's spawn of readiness-run").toEqual([]);
      expect(npmConfigNames(checkChildEnv("0123456789abcdef0123456789abcdef")), "readiness-run's spawn of npm run check").toEqual([]);
    });
  });

  it("refuses a core.worktree redirect before tick can fetch or merge", () => {
    const home = makeRepo("redirect-home", "redirect-home-branch", "redirect home\n");
    const elsewhere = makeRepo("redirect-elsewhere", "redirect-elsewhere-branch", "redirect elsewhere\n");
    git(home.root, ["config", "core.worktree", elsewhere.root]);
    expect(git(home.root, ["-C", home.root, "rev-parse", "--path-format=absolute", "--show-toplevel"]))
      .toBe(elsewhere.root);

    const problem = runnerWorktreeProblem(home.root);
    expect(problem).toContain("Git reported top-level");
    expect(problem).toContain(home.root);
    expect(problem).toContain(elsewhere.root);

    /* And run, not read: the opening of every tick, handed that checkout,
       attempts neither command the guard exists to hold back. */
    const spy = gitSpy();
    expect(advanceRunner(home.root, home.root, spy.exec)).toBe(problem);
    expect(spy.subcommands()).not.toContain("fetch");
    expect(spy.subcommands()).not.toContain("merge");
  });

  /* The case the source-reading test this replaces could not see (GPT Sol's
     R724-04): a worktree that is internally consistent in every way and
     belongs to another repository. Only the comparison against the expected
     repository refuses it, so only passing that argument through does. */
  it("does not fetch into a worktree of some other repository", () => {
    const intended = makeRepo("advance-intended", "dev", "intended\n");
    const foreign = makeRepo("advance-foreign", "dev", "foreign\n");
    const foreignWorktree = path.join(foreign.root, "linked");
    git(foreign.root, ["worktree", "add", "--quiet", "-b", "foreign-linked", foreignWorktree]);
    /* The premise: on its own terms there is nothing wrong with it. */
    expect(runnerWorktreeProblem(foreignWorktree)).toBeNull();
    const spy = gitSpy();

    const problem = advanceRunner(foreignWorktree, intended.root, spy.exec);

    expect(problem).toContain("does not match expected repository");
    expect(spy.subcommands()).not.toContain("fetch");
    expect(spy.subcommands()).not.toContain("merge");
  });

  it("fetches and then fast-forwards a runner that is the checkout it claims to be", () => {
    const origin = makeRepo("advance-origin", "dev", "one\n");
    const consumer = mkdtempSync(path.join(tmpdir(), "readiness-advance-consumer-"));
    scratchDirectories.push(consumer);
    git(path.dirname(consumer), ["clone", "--quiet", origin.root, consumer]);
    writeFileSync(path.join(origin.root, "fixture.txt"), "two\n");
    git(origin.root, ["add", "--", "fixture.txt"]);
    git(origin.root, ["commit", "--quiet", "-m", "two"]);
    const ahead = git(origin.root, ["rev-parse", "HEAD"]);
    const spy = gitSpy();

    expect(advanceRunner(consumer, consumer, spy.exec)).toBeNull();

    expect(git(consumer, ["rev-parse", "HEAD"])).toBe(ahead);
    expect(spy.subcommands().filter((name) => name !== "rev-parse")).toEqual(["fetch", "merge"]);
  });

  it("does not fast-forward to a stale origin/dev after a fetch that failed", () => {
    const lonely = makeRepo("advance-no-remote", "dev", "no remote\n");
    const spy = gitSpy();

    expect(advanceRunner(lonely.root, lonely.root, spy.exec)).toContain("git fetch origin dev failed");
    expect(spy.subcommands()).toContain("fetch");
    expect(spy.subcommands()).not.toContain("merge");
  });

  /* What is still only read, because `tick` spawns too much to drive from
     here: that it opens with that function, and hands it the repository it was
     given. It will break on an innocent rewording of the line; the message
     says what to look at when it does. */
  it("opens every tick by advancing the runner against the repository it was given", () => {
    const source = readFileSync(new URL("../scripts/readiness-loop.ts", import.meta.url), "utf8");
    const tickStart = source.indexOf("async function tick(");
    const tickSource = source.slice(tickStart, source.indexOf("\n}\n\nconst HELP", tickStart));
    const advance = tickSource.indexOf("advanceRunner(runner, expectedRepository)");
    const prepare = tickSource.indexOf("prepareRunner(");
    expect(
      advance !== -1 && prepare > advance,
      "tick() must call advanceRunner(runner, expectedRepository) before it prepares anything — " +
        `found it at ${advance}, prepareRunner at ${prepare}`,
    ).toBe(true);
    expect(tickSource).not.toMatch(/"fetch"|"merge"/);
  });

  it("validates the primary before fetch and the created runner before merge or setup", () => {
    const source = readFileSync(new URL("../scripts/readiness-loop.ts", import.meta.url), "utf8");
    const start = source.indexOf("function ensureRunnerWorktree(");
    const end = source.indexOf("\n}\n\n/**", start);
    const body = source.slice(start, end);
    const primaryGuard = body.indexOf("runnerWorktreeProblem(primary)");
    const primaryFetch = body.indexOf('requireCommand(primary, "git", ["fetch"');
    const runnerGuard = body.indexOf("runnerWorktreeProblem(runner,", primaryFetch);
    const runnerMerge = body.indexOf('requireCommand(runner, "git", ["merge"');
    expect(primaryGuard).toBeGreaterThan(-1);
    expect(primaryFetch).toBeGreaterThan(primaryGuard);
    expect(runnerGuard).toBeGreaterThan(primaryFetch);
    expect(runnerMerge).toBeGreaterThan(runnerGuard);
  });

  it("treats an empty successful show-toplevel as a problem", () => {
    const result = runnerWorktreeProblem(process.cwd(), () => commandResult({ stdout: " \n" }));
    expect(result).toContain("<empty>");
  });

  it("canonicalises a symlinked runner path before comparing it with Git", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "readiness-runner-link-"));
    scratchDirectories.push(parent);
    const linked = path.join(parent, "runner");
    symlinkSync(process.cwd(), linked, "dir");
    expect(runnerWorktreeProblem(linked, () => commandResult({ stdout: `${process.cwd()}\n` }))).toBeNull();
  });

  it("turns a missing runner directory into a reason", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "readiness-runner-missing-"));
    scratchDirectories.push(parent);
    expect(runnerWorktreeProblem(path.join(parent, "absent"))).toContain("could not be canonicalised");
  });

  it.each([
    ["failure", commandResult({ status: 128, stderr: "fatal: not a repository" })],
    ["timeout", commandResult({ status: null, signal: "SIGTERM", error: new Error("spawnSync git ETIMEDOUT") })],
  ])("turns a Git %s into a reason", (_name, result) => {
    expect(runnerWorktreeProblem(process.cwd(), () => result)).toContain("Git top-level unavailable");
  });

  it("refuses a linked-worktree pointer copied from another repository", () => {
    const home = makeRepo("pointer-home", "home", "home\n");
    const elsewhere = makeRepo("pointer-elsewhere", "elsewhere", "elsewhere\n");
    const homeWorktree = path.join(home.root, "linked");
    const elsewhereWorktree = path.join(elsewhere.root, "linked");
    git(home.root, ["worktree", "add", "--quiet", "-b", "home-linked", homeWorktree]);
    git(elsewhere.root, ["worktree", "add", "--quiet", "-b", "elsewhere-linked", elsewhereWorktree]);
    writeFileSync(path.join(homeWorktree, ".git"), readFileSync(path.join(elsewhereWorktree, ".git")));

    expect(git(homeWorktree, ["rev-parse", "--path-format=absolute", "--show-toplevel"]))
      .toBe(homeWorktree);
    expect(runnerWorktreeProblem(homeWorktree)).toContain("backlink");
  });

  it("refuses a valid worktree belonging to a different repository", () => {
    const intended = makeRepo("intended-repository", "intended", "intended\n");
    const foreign = makeRepo("foreign-repository", "foreign", "foreign\n");
    const foreignWorktree = path.join(foreign.root, "linked");
    git(foreign.root, ["worktree", "add", "--quiet", "-b", "foreign-linked", foreignWorktree]);

    expect(runnerWorktreeProblem(foreignWorktree, undefined, intended.root)).toContain("common directory");
  });

  it("never resets the dedicated branch while recreating its worktree", () => {
    expect(worktreeAddArgs("/repo/runner", false)).toEqual([
      "worktree", "add", "-b", "readiness-checks", "/repo/runner", "origin/dev",
    ]);
    expect(worktreeAddArgs("/repo/runner", true)).toEqual([
      "worktree", "add", "/repo/runner", "readiness-checks",
    ]);
    expect(worktreeAddArgs("/repo/runner", true)).not.toContain("-B");
  });

  it("pins database commands to the runner's local connection despite remote shell values", () => {
    expect(localDatabaseEnv({
      DATABASE_URL: "postgres://production.invalid/db",
      DB_MIGRATE_ALLOW_REMOTE: "yes",
      KEEP_ME: "yes",
      SPIDERYARN_ENV_PINNED: "SUPABASE_URL",
    }, "DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54362/postgres\n")).toEqual({
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:54362/postgres",
      DB_MIGRATE_ALLOW_REMOTE: "no",
      KEEP_ME: "yes",
      SPIDERYARN_ENV_PINNED: "SUPABASE_URL,DATABASE_URL,DB_MIGRATE_ALLOW_REMOTE",
    });
    expect(() => localDatabaseEnv(
      {},
      "DATABASE_URL=postgres://production.invalid/db\nDB_MIGRATE_ALLOW_REMOTE=yes\n",
    )).toThrow(/does not name the local database/);
  });

  it("refuses to keep working after the lifetime lock is replaced", () => {
    const held = { holder: { pid: 1, instanceId: "ours", hostname: "box", startedAt: new Date().toISOString() }, fd: 3 };
    expect(() => requireHeldLoopLock(held, "/tmp/readiness-loop.lock", () => false)).toThrow(
      /no longer owns.*readiness-loop\.lock/,
    );
  });

  it("terminates a hung child process group and escalates after a grace period", async () => {
    vi.useFakeTimers();
    try {
      const child = Object.assign(new EventEmitter(), { pid: 1234 });
      const signal = vi.fn();
      const waiting = waitForReadinessChild(
        child as never,
        CHECK_TIMEOUT_MS,
        TERMINATION_GRACE_MS,
        signal,
      );

      await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
      expect(signal).toHaveBeenCalledWith(child, "SIGTERM");
      child.emit("close", null, "SIGTERM");
      await vi.advanceTimersByTimeAsync(TERMINATION_GRACE_MS);
      expect(signal).toHaveBeenLastCalledWith(child, "SIGKILL");
      await expect(waiting).resolves.toMatchObject({ timedOut: true, signal: "SIGTERM" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns immediately for an ordinary child completion without signalling it", async () => {
    vi.useFakeTimers();
    try {
      const child = Object.assign(new EventEmitter(), { pid: 1234 });
      const signal = vi.fn();
      const waiting = waitForReadinessChild(child as never, 1000, 100, signal);
      child.emit("close", 0, null);
      await expect(waiting).resolves.toEqual({ code: 0, signal: null, error: null, timedOut: false });
      expect(signal).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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
    const token = "0123456789abcdef0123456789abcdef";
    const authenticated = markReadinessAdmissionRefusal(message, token);
    const why = parseAdmissionRefusal(authenticated, token);
    expect(why).toBe(
      "NO TESTS RAN AND NOTHING WAS VERIFIED — this is resource pressure, not a test failure.",
    );
    expect(parseAdmissionRefusal("A gate failed. Fix it and run the suite again.", token)).toBeNull();
    expect(parseAdmissionRefusal(message, token)).toBeNull();
    expect(parseAdmissionRefusal(
      `NO TESTS RAN AND NOTHING WAS VERIFIED — fixture text, not a real refusal.\nREADINESS_ADMISSION_REFUSAL=wrong`,
      token,
    )).toBeNull();

    const exitOne = outcomeFromExit(1);
    expect(outcomeAfterAdmissionRefusal(exitOne, why, "test", { kind: "vitest", files: null, tests: null })).toEqual({
      outcome: "void",
      why: "NO TESTS RAN AND NOTHING WAS VERIFIED — this is resource pressure, not a test failure.",
      counts: { kind: "vitest", files: null, tests: null },
    });
  });

  it("preserves an earlier gate failure when Vitest later refuses admission", () => {
    const counts: Counts = {
      kind: "check" as const,
      steps: [
        { name: "typecheck", gate: "gate", verdict: "failed", findings: null },
        { name: "build", gate: "unknown", verdict: "clean", findings: null },
        { name: "test", gate: "gate", verdict: "failed", findings: null },
      ],
    };
    expect(outcomeAfterAdmissionRefusal(
      outcomeFromExit(1),
      "NO TESTS RAN AND NOTHING WAS VERIFIED — this is resource pressure, not a test failure.",
      "check",
      counts,
    )).toEqual({
      outcome: "fail",
      why: null,
      counts: {
        kind: "check",
        steps: [
          { name: "typecheck", gate: "gate", verdict: "failed", findings: null },
          { name: "build", gate: "unknown", verdict: "clean", findings: null },
          { name: "test", gate: "gate", verdict: "did-not-run", findings: null },
        ],
      },
    });
  });

  it("keeps a full check failed when its summary cannot prove the other gates clean", () => {
    expect(outcomeAfterAdmissionRefusal(
      outcomeFromExit(1),
      "NO TESTS RAN AND NOTHING WAS VERIFIED — this is resource pressure, not a test failure.",
      "check",
      { kind: "none" },
    )).toEqual({ outcome: "fail", why: null, counts: { kind: "none" } });
  });

  it("finds a refusal split across chunks in the discarded middle of a long check log", () => {
    const banner = realRefusal().split("\n").find((line) => line.includes("NO TESTS RAN"));
    if (banner === undefined) throw new Error("the admission fixture has no refusal banner");
    const token = "fedcba9876543210fedcba9876543210";
    const detector = makeAdmissionRefusalCapture(token);
    detector.push("x".repeat(80_000));
    detector.push(`\n  ${banner.slice(0, 24)}`);
    detector.push(`${banner.slice(24)}\nREADINESS_ADMISSION_REFUSAL=${token}\n${"y".repeat(80_000)}`);
    expect(detector.why()).toBe(banner.trim());
  });
});
