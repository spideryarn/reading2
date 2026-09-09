#!/usr/bin/env -S npx tsx
/**
 * **Keep the Readiness tab supplied with an answer about origin/dev.**
 *
 *     npx tsx scripts/tmux-job.ts --name readiness-loop npx tsx scripts/readiness-loop.ts
 *     npx tsx scripts/readiness-loop.ts --once
 *
 * This is a plain loop under tmux rather than an Overseer scheduled job for the
 * settled reasons in
 * docs/plans/260909f-readiness-checks-recorded-and-run-periodically.md
 * § "Where the periodic runner lives, and why not the daemon". The cost is no
 * supervision across a reboot or tmux-server exit; the Readiness tab makes that
 * absence visible by returning to unknown when fresh evidence stops arriving.
 *
 * ## What a green here does NOT claim, and it is narrower than it looks
 *
 * A pass says the commit's checks passed **against this box's database**, not
 * against a schema built only from that commit's own migrations. Every worktree
 * on the box shares one local Supabase, and `scripts/db-migrate.ts` passes
 * `allowHistoricalExtras: isLocal` — so a ledger row belonging to no migration
 * in this commit's journal is a warning here, not a refusal. The consequence:
 *
 *   1. `origin/dev` is B, whose code declares a column but whose commit left the
 *      migration out.
 *   2. Another worktree C adds that migration and applies it locally. C is not
 *      on `origin/dev`.
 *   3. This runner prepares B. B's migrator tolerates C's ledger row.
 *   4. `db:check` finds the column, B's tests pass **against C's schema**, and B
 *      is recorded green.
 *
 * GPT Sol's F5, 2026-09-09, established. Not fixed here, deliberately: the two
 * repairs are a database of this runner's own, or holding the migration
 * advisory lock across the whole 26-minute check — which would block every other
 * agent's tests on the box for that long. Both are somebody else's to authorise,
 * so the claim is weakened instead and the choice is with Greg. See
 * docs/plans/260909g-readiness-runner-git-env-and-preparation-latch.md
 * § "The shared local database can be ahead of the commit under test".
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isLocalDatabaseUrl } from "../src/db/ssl.js";
import { parseEnvFile, pinnedNames } from "../src/env.js";
import {
  readMemorySnapshot,
  readReserveBytes,
  resolveParallelWorkers,
} from "../vitest-admission.js";
import {
  decideTick,
  initialPreparationState,
  preparationAfterChanges,
  TICK_INTERVAL_MS,
  type PreparationState,
  type TickDecision,
} from "../tools/fleet/readiness-loop.js";
import {
  GIT_TIMEOUT_MS,
  gitEnv,
  primaryCheckout,
  snapshotDev,
  stampTree,
  type DevSnapshot,
} from "../tools/fleet/readiness-git.js";
import { openReadinessStore, readinessDirFromEnv, type ReadinessStore } from "../tools/fleet/readiness-store.js";
import { WINDOW_HOURS } from "../tools/fleet/readiness-wiring.js";
import type { TreeStamp } from "../tools/fleet/readiness.js";
import { collectHealth } from "../tools/fleet/health.js";
import { describeLockRefusal, releaseLock, stillOurs, takeLock, type HeldLock } from "../tools/overseer/lock.js";

const RUNNER_WORKTREE = path.join(".claude", "worktrees", "readiness-checks");
const RUNNER_BRANCH = "readiness-checks";
const LOOP_LOCK = "readiness-loop.lock";
const RUN_LOG_DIR = path.join("logs", "readiness-runs");
const RUN_LOGS_KEPT = 20;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
/** Four times the longest observed full check, then a short graceful shutdown. */
export const CHECK_TIMEOUT_MS = 2 * 60 * 60 * 1000;
export const TERMINATION_GRACE_MS = 10 * 1000;

export type CommandResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error: Error | null;
};

type ReadinessChildResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  error: Error | null;
  timedOut: boolean;
};

class LostLoopLockError extends Error {}

export function requireHeldLoopLock(
  lock: HeldLock,
  lockPath: string,
  isStillHeld: (lock: HeldLock, path: string) => boolean = stillOurs,
): void {
  if (!isStillHeld(lock, lockPath)) {
    throw new LostLoopLockError(`this process no longer owns ${lockPath}; stopping before two loops can run together`);
  }
}

function signalReadinessChild(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== "win32" && child.pid !== undefined) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause;
  }
}

/**
 * Wait for one check without letting a hung subprocess hold the loop forever.
 * On Unix the child is a process-group leader, so both signals reach npm,
 * check.ts, Vitest and their workers rather than killing only the wrapper.
 */
export function waitForReadinessChild(
  child: ChildProcess,
  timeoutMs = CHECK_TIMEOUT_MS,
  graceMs = TERMINATION_GRACE_MS,
  signal: (child: ChildProcess, signal: NodeJS.Signals) => void = signalReadinessChild,
): Promise<ReadinessChildResult> {
  return new Promise((resolve) => {
    let spawnError: Error | null = null;
    let closed: Omit<ReadinessChildResult, "timedOut"> | null = null;
    let done = false;
    let timedOut = false;
    const finish = (result: ReadinessChildResult): void => {
      if (done) return;
      done = true;
      resolve(result);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      signal(child, "SIGTERM");
      setTimeout(() => {
        signal(child, "SIGKILL");
        finish(closed === null
          ? { code: null, signal: null, error: new Error(`readiness check exceeded ${elapsed(timeoutMs)}`), timedOut: true }
          : { ...closed, timedOut: true });
      }, graceMs);
    }, timeoutMs);

    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code, childSignal) => {
      closed = { code, signal: childSignal, error: spawnError };
      if (!timedOut) {
        clearTimeout(timeout);
        finish({ ...closed, timedOut: false });
      }
      /* After a timeout, deliberately wait through the grace timer so SIGKILL
         still reaches descendants after the group leader closes. */
    });
  });
}

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function localDatabaseEnv(source: NodeJS.ProcessEnv, envLocalText: string): NodeJS.ProcessEnv {
  const localUrl = parseEnvFile(envLocalText).DATABASE_URL;
  if (localUrl === undefined || !isLocalDatabaseUrl(localUrl)) {
    throw new Error("the runner's .env.local does not name the local database; refusing unattended database work");
  }
  const env = { ...source };
  env.DATABASE_URL = localUrl;
  env.DB_MIGRATE_ALLOW_REMOTE = "no";
  const pinned = pinnedNames(source.SPIDERYARN_ENV_PINNED);
  pinned.add("DATABASE_URL");
  pinned.add("DB_MIGRATE_ALLOW_REMOTE");
  env.SPIDERYARN_ENV_PINNED = [...pinned].join(",");
  return env;
}

function runnerLocalDatabaseEnv(runner: string): NodeJS.ProcessEnv {
  return localDatabaseEnv(process.env, readFileSync(path.join(runner, ".env.local"), "utf8"));
}

/**
 * The environment the expensive check itself is launched with.
 *
 * **A named function rather than an expression inside the `spawn` call**, because
 * this is the caller that was missed. Every other subprocess here goes through
 * {@link runCommand}, which scrubs; this one built its own environment and so
 * handed git's inherited location overrides straight to `npm run check`. GPT
 * Sol's F1, 2026-09-09: `scripts/conflict-markers.ts` takes its tracked-file
 * inventory from git, so a poisoned check reads its file list out of a
 * *different* checkout, misses the file with the conflict markers in it, and
 * passes — and that pass is then recorded as a fact about this commit.
 *
 * Naming it is the point. A scrub spelled out at each call site is a scrub
 * somebody adds a fourth call site without.
 */
export function readinessCheckEnv(runner: string): NodeJS.ProcessEnv {
  return gitEnv(runnerLocalDatabaseEnv(runner));
}

export function runCommand(
  cwd: string,
  command: string,
  args: readonly string[],
  timeout = COMMAND_TIMEOUT_MS,
  sourceEnv: NodeJS.ProcessEnv = process.env,
): CommandResult {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    env: gitEnv(sourceEnv),
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
  };
}

function commandSucceeded(result: CommandResult): boolean {
  return result.error === null && result.status === 0;
}

function usefulOutput(result: CommandResult): string {
  const lines = `${result.stderr}\n${result.stdout}`
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const text = lines.slice(-3).join("; ").replace(/\s+/g, " ");
  if (text !== "") return text.slice(0, 800);
  if (result.error !== null) return result.error.message;
  if (result.signal !== null) return `killed by ${result.signal}`;
  return `exit ${result.status ?? "unknown"}`;
}

/**
 * A clean environment cannot overrule repository-local `core.worktree`, which
 * can send a merge into another directory despite the requested `cwd`. This is
 * deliberately the narrower filesystem guard: it does not validate a linked
 * worktree's `.git` `gitdir:` pointer. Redirected metadata with the correct
 * work tree can move a branch ref, but cannot write another checkout's files,
 * and nothing in this runner authors that pointer by hand.
 */
export function runnerWorktreeProblem(runner: string): string | null {
  const requestedText = path.resolve(runner);
  let requested: string;
  try {
    requested = realpathSync(requestedText);
  } catch (error) {
    return `runner path ${requestedText}; Git top-level unavailable because the runner path could not be canonicalised: ${(error as Error).message}`;
  }

  const result = runCommand(
    runner,
    "git",
    ["rev-parse", "--path-format=absolute", "--show-toplevel"],
    GIT_TIMEOUT_MS,
  );
  if (!commandSucceeded(result)) {
    return `runner path ${requested}; Git top-level unavailable: ${usefulOutput(result)}`;
  }

  const reportedText = result.stdout.trim();
  let reported: string;
  try {
    reported = realpathSync(reportedText);
  } catch (error) {
    return `runner path ${requested}; Git reported top-level ${reportedText || "<empty>"}, which could not be canonicalised: ${(error as Error).message}`;
  }
  return requested === reported
    ? null
    : `runner path ${requested}; Git reported top-level ${reported}. Refusing to fetch or fast-forward a different work tree`;
}

function requireCommand(
  cwd: string,
  command: string,
  args: readonly string[],
  label: string,
  sourceEnv: NodeJS.ProcessEnv = process.env,
): CommandResult {
  const result = runCommand(cwd, command, args, COMMAND_TIMEOUT_MS, sourceEnv);
  if (!commandSucceeded(result)) throw new Error(`${label} failed: ${usefulOutput(result)}`);
  return result;
}

function requireRunnerAtDev(runner: string, nowIso: string, context: string): void {
  const dev = snapshotDev(runner, nowIso);
  if (dev.kind !== "known") throw new Error(`${context}: origin/dev could not be read: ${dev.why}`);
  const tree = stampTree(runner);
  if (tree.kind !== "known") throw new Error(`${context}: the runner worktree could not be stamped: ${tree.why}`);
  if (tree.sha !== dev.devSha || tree.dirty) {
    throw new Error(
      `${context}: expected a clean runner at ${dev.devSha.slice(0, 12)}, but found ` +
        `${tree.sha.slice(0, 12)}${tree.dirty ? " with uncommitted changes" : ""}. ` +
        "Leave it for a person to inspect.",
    );
  }
}

function setupHasEnv(output: string): boolean {
  return /\bok\s+\.env\.local is here\b/.test(output);
}

function runSetup(runner: string): CommandResult {
  return runCommand(runner, "npx", ["tsx", "scripts/worktree-setup.ts"]);
}

export function worktreeAddArgs(runner: string, branchExists: boolean): string[] {
  return branchExists
    ? ["worktree", "add", runner, RUNNER_BRANCH]
    : ["worktree", "add", "-b", RUNNER_BRANCH, runner, "origin/dev"];
}

function runnerBranchExists(primary: string): boolean {
  const result = runCommand(primary, "git", ["show-ref", "--verify", "--quiet", `refs/heads/${RUNNER_BRANCH}`]);
  if (result.error !== null || result.signal !== null || (result.status !== 0 && result.status !== 1)) {
    throw new Error(`checking for the runner branch failed: ${usefulOutput(result)}`);
  }
  return result.status === 0;
}

function ensureRunnerWorktree(primary: string, nowIso: string): string {
  const runner = path.join(primary, RUNNER_WORKTREE);
  if (existsSync(runner)) {
    if (!existsSync(path.join(runner, ".env.local"))) {
      throw new Error(`${runner}/.env.local is missing. Copy it from ${primary}/.env.local, run setup, and inspect the tree.`);
    }
    return runner;
  }

  /* A new branch starts from the ref just fetched; an existing one is attached
     without `-B`, whose reset semantics would violate the fast-forward-only
     contract. setup has its own ordinary merge, so we make that a no-op below
     and still verify equality and cleanliness afterwards. */
  requireCommand(primary, "git", ["fetch", "origin", "dev"], "fetch before creating the runner worktree");
  mkdirSync(path.dirname(runner), { recursive: true });
  requireCommand(
    primary,
    "git",
    worktreeAddArgs(runner, runnerBranchExists(primary)),
    "creating the runner worktree",
  );
  /* An existing dedicated branch may lag origin/dev. Advance it before setup,
     whose reusable freshener permits an ordinary merge; making that merge a
     no-op is how this runner keeps its stricter fast-forward-only contract. */
  requireCommand(runner, "git", ["merge", "--ff-only", "origin/dev"], "advancing the recreated runner branch");

  let setup = runSetup(runner);
  if (!commandSucceeded(setup)) throw new Error(`runner worktree setup failed: ${usefulOutput(setup)}`);
  let setupOutput = `${setup.stdout}\n${setup.stderr}`;
  if (!setupHasEnv(setupOutput)) {
    const sourceEnv = path.join(primary, ".env.local");
    if (!existsSync(sourceEnv)) {
      throw new Error(`setup reported that .env.local is missing, and there is no ${sourceEnv} to copy`);
    }
    copyFileSync(sourceEnv, path.join(runner, ".env.local"));
    setup = runSetup(runner);
    if (!commandSucceeded(setup)) throw new Error(`runner worktree setup after copying .env.local failed: ${usefulOutput(setup)}`);
    setupOutput = `${setup.stdout}\n${setup.stderr}`;
  }
  if (!setupHasEnv(setupOutput)) {
    throw new Error("runner worktree setup did not confirm `ok .env.local is here`; refusing to record a red check about setup");
  }
  requireRunnerAtDev(runner, nowIso, "after creating and setting up the runner worktree");
  return runner;
}

/**
 * **`npm run check` has an undeclared prerequisite, and without this the runner
 * would record a permanent false red.**
 *
 * `tests/fleet-decisions-route.test.ts` imports `tools/fleet/server.ts`, and
 * that module refuses at startup unless `tools/fleet/web/dist/index.html`
 * exists. `check`'s build step is `build:client && build:api` — `build:fleet` is
 * in neither. So the test fails in any checkout where nobody happened to run
 * that by hand, which a machine-made worktree never does. Measured on
 * 2026-09-09: it failed in this runner's first recorded check and passed
 * immediately after `npm run build:fleet`.
 *
 * (This paragraph used to say the test *read* `dist`. It does not, and the
 * difference matters to anyone trying to fix it: nothing rebuilds when the
 * built content is stale, because nothing reads the content at all — an
 * `index.html` from any past build satisfies it. GPT Sol's F8, 2026-09-09.)
 *
 * That is the same class `scripts/check.ts`'s own header says it fixed once for
 * `api-dist` — *"npm run check was red on a clean checkout for everybody who had
 * not happened to run the API build by hand"* — recurring for the fleet client.
 * **The real repair is a step in `check.ts`**, so that every checkout gets it
 * rather than only this one; that file is not this work's to change, and the
 * finding is written up for whoever owns it. This is the local mitigation, and
 * it is deliberately not silent about being one.
 *
 * The output is gitignored (`dist/`, unanchored), so it does not dirty the tree
 * the record is about — verified, not assumed. A failed build aborts this tick
 * and remains pending for the next one; running the known-broken prerequisite
 * into the suite would manufacture the permanent false red this exists to
 * prevent.
 */
function ensureFleetClient(runner: string, rebuild: boolean): void {
  const entry = path.join(runner, "tools", "fleet", "web", "dist", "index.html");
  if (!rebuild && existsSync(entry)) return;
  const built = runCommand(runner, "npm", ["run", "build:fleet"]);
  if (!commandSucceeded(built)) {
    throw new Error(`building the fleet client prerequisite failed: ${usefulOutput(built)}`);
  }
  if (!existsSync(entry)) throw new Error(`build:fleet exited 0 but did not create ${entry}`);
}

export type PreparationDeps = {
  exec: (cwd: string, command: string, args: readonly string[], sourceEnv?: NodeJS.ProcessEnv) => CommandResult;
  buildFleetClient: (runner: string, rebuild: boolean) => void;
  databaseEnv: (runner: string) => NodeJS.ProcessEnv;
  /** A sha only names the prepared files when the clean tree is still there. */
  stamp: (cwd: string) => TreeStamp;
};

function preparationChanges(
  runner: string,
  preparedFor: string | null,
  target: string,
  exec: PreparationDeps["exec"],
): readonly string[] | null {
  if (preparedFor === null) return null;
  const diff = exec(runner, "git", [
    "diff", "--name-only", preparedFor, target, "--",
    "package.json", "package-lock.json", "drizzle", "tools/fleet/web", "vite.fleet.config.ts",
  ]);
  if (commandSucceeded(diff)) {
    return diff.stdout.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  }
  console.error(
    `readiness-loop: could not classify preparation changes from ${preparedFor} to ${target}: ` +
      `${usefulOutput(diff)}; preparing everything`,
  );
  return null;
}

function latchPreparation(
  preparation: PreparationState,
  target: string,
  tree: TreeStamp,
): boolean {
  if (tree.kind === "known" && !tree.dirty && tree.sha === target) {
    /* The sha is evidence only after every preparation step succeeded and
       the files they read are still a clean checkout of that exact sha. */
    preparation.preparedFor = target;
    return true;
  }
  preparation.preparedFor = null;
  const found = tree.kind === "unknown"
    ? `the tree could not be stamped: ${tree.why}`
    : `the tree was at ${tree.sha}${tree.dirty ? " and dirty" : ""}`;
  console.error(`readiness-loop: preparation for ${target} was not latched because ${found}; everything will be prepared next time`);
  return false;
}

export function prepareRunner(
  runner: string,
  preparation: PreparationState,
  /** The sha to prepare for, or null when a failed fast-forward or unknown
      stamp means this tick must not advance the latch. */
  target: string | null,
  deps: PreparationDeps = {
    exec: (cwd, command, args, sourceEnv) =>
      runCommand(cwd, command, args, COMMAND_TIMEOUT_MS, sourceEnv),
    buildFleetClient: ensureFleetClient,
    databaseEnv: runnerLocalDatabaseEnv,
    stamp: stampTree,
  },
): void {
  const shouldPrepare = target !== null && preparation.preparedFor !== target;
  if (target !== null && shouldPrepare) {
    const changed = preparationChanges(runner, preparation.preparedFor, target, deps.exec);
    preparation.needs = preparationAfterChanges(preparation.needs, changed);
    if (preparation.needs.dependencies) {
      const installed = deps.exec(runner, "npm", ["ci", "--prefer-offline"]);
      if (!commandSucceeded(installed)) {
        throw new Error(`installing dependencies for the runner checkout failed: ${usefulOutput(installed)}`);
      }
    }
    if (preparation.needs.migrations) {
      /* This deterministic runner is local-only: the injected environment
         strips the shell values that can select and authorise a remote
         database. A failed migration stays pending because the migrator's own
         ledger preflight is the authority on whether retrying may change it. */
      const migrated = deps.exec(runner, "npm", ["run", "db:migrate"], deps.databaseEnv(runner));
      if (!commandSucceeded(migrated)) {
        throw new Error(`applying local database migrations failed: ${usefulOutput(migrated)}`);
      }
    }
  }

  deps.buildFleetClient(runner, preparation.needs.fleetClient);

  if (target !== null && shouldPrepare) {
    if (latchPreparation(preparation, target, deps.stamp(runner))) {
      /* Keep every classified need pending until the whole attempt latches.
         Otherwise B can install successfully, fail later, then leave its
         modules under an A latch; an A..C diff that happens to be empty would
         wrongly bless C without repairing B's partial derived state. */
      preparation.needs = { dependencies: false, migrations: false, fleetClient: false };
    }
  } else {
    preparation.needs.fleetClient = false;
  }
}

function databaseProblem(result: CommandResult): string | null {
  return commandSucceeded(result) ? null : `npm run --silent db:check ${usefulOutput(result)}`;
}

function nominalWorkers(): number {
  /* resolveParallelWorkers deliberately consumes the env override because the
     Vitest config must hide it from its serial lane. This is only a preview of
     that later decision, so put it back for the child that will make the real
     one. */
  const override = process.env.VITEST_MAX_WORKERS;
  try {
    return resolveParallelWorkers();
  } finally {
    if (override !== undefined) process.env.VITEST_MAX_WORKERS = override;
  }
}

function decisionLine(nowIso: string, dev: DevSnapshot, decision: TickDecision): string {
  const sha = dev.kind === "known" ? dev.devSha.slice(0, 12) : "unknown-sha";
  const sentence =
    decision.kind === "skip"
      ? decision.why
      : "Readiness is unknown for this clean dev tree, and the box gates permit a full check.";
  return `${nowIso} ${sha} ${decision.kind}: ${sentence.replace(/\s+/g, " ")}`;
}

function pruneRunLogs(dir: string): void {
  const logs = readdirSync(dir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}T.*-[0-9a-f]{12}\.log$/.test(name))
    .sort()
    .reverse();
  for (const name of logs.slice(RUN_LOGS_KEPT)) unlinkSync(path.join(dir, name));
}

function elapsed(durationMs: number): string {
  const seconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds % 60}s`;
}

let activeChild: ChildProcess | null = null;

async function runReadinessCheck(runner: string, sha: string, store: ReadinessStore): Promise<void> {
  const startedMs = Date.now();
  const logDir = path.join(runner, RUN_LOG_DIR);
  mkdirSync(logDir, { recursive: true });
  const timestamp = new Date(startedMs).toISOString();
  const logPath = path.join(logDir, `${timestamp}-${sha.slice(0, 12)}.log`);
  const fd = openSync(logPath, "w");

  let result: ReadinessChildResult;
  try {
    const child = spawn("npx", ["tsx", "scripts/readiness-run.ts", "check"], {
      cwd: runner,
      env: readinessCheckEnv(runner),
      stdio: ["ignore", fd, fd],
      detached: process.platform !== "win32",
    });
    activeChild = child;
    result = await waitForReadinessChild(child);
  } finally {
    activeChild = null;
    closeSync(fd);
  }

  const readAt = Date.now();
  const latest = store
    .read({ sinceMs: startedMs - 1000, nowMs: readAt })
    .readings.filter((reading) => {
      const record = reading.record;
      return (
        record.source === "wrapper" &&
        record.check === "check" &&
        record.cwd === runner &&
        record.treeAtStart.kind === "known" &&
        record.treeAtStart.sha === sha &&
        Date.parse(record.startedAt) >= startedMs - 1000
      );
    })
    .sort((a, b) => b.atMs - a.atMs)[0];
  const outcome =
    latest?.state ??
    (result.error !== null
      ? `not started (${result.error.message})`
      : result.signal !== null
        ? `killed by ${result.signal}`
        : `not recorded (exit ${result.code ?? "unknown"})`);
  pruneRunLogs(logDir);
  console.log(
    `${new Date(readAt).toISOString()} ${sha.slice(0, 12)} outcome: ${outcome}; ` +
      `duration ${elapsed(readAt - startedMs)}; log ${logPath}`,
  );
}

async function tick(
  runner: string,
  store: ReadinessStore,
  preparation: PreparationState,
  assertLock: () => void,
): Promise<void> {
  assertLock();
  const tickMs = Date.now();
  const nowIso = new Date(tickMs).toISOString();
  let fastForwardProblem = runnerWorktreeProblem(runner);

  if (fastForwardProblem === null) {
    const fetch = runCommand(runner, "git", ["fetch", "origin", "dev"]);
    if (!commandSucceeded(fetch)) {
      fastForwardProblem = `git fetch origin dev failed: ${usefulOutput(fetch)}`;
    } else {
      const merge = runCommand(runner, "git", ["merge", "--ff-only", "origin/dev"]);
      if (!commandSucceeded(merge)) fastForwardProblem = `git merge --ff-only origin/dev failed: ${usefulOutput(merge)}`;
    }
  }

  const dev = snapshotDev(runner, nowIso);
  const afterMerge = stampTree(runner);
  const target = fastForwardProblem === null && afterMerge.kind === "known" ? afterMerge.sha : null;
  prepareRunner(runner, preparation, target);

  const db = runCommand(
    runner,
    "npm",
    ["run", "--silent", "db:check"],
    COMMAND_TIMEOUT_MS,
    runnerLocalDatabaseEnv(runner),
  );
  const tree = stampTree(runner);
  const history = store.read({
    sinceMs: tickMs - WINDOW_HOURS * 3_600_000,
    nowMs: tickMs,
  });
  const health = collectHealth();
  const decision = decideTick({
    nowMs: tickMs,
    fastForwardProblem,
    dev,
    runnerTree: tree,
    history,
    admission: {
      nominalWorkers: nominalWorkers(),
      snapshot: readMemorySnapshot(),
      reserveBytes: readReserveBytes(),
    },
    health,
    databaseProblem: databaseProblem(db),
  });
  console.log(decisionLine(nowIso, dev, decision));
  if (decision.kind === "run") {
    assertLock();
    await runReadinessCheck(runner, decision.sha, store);
  }
}

const HELP = [
  "readiness-loop — periodically record a full readiness check for origin/dev",
  "",
  "  npx tsx scripts/readiness-loop.ts",
  "  npx tsx scripts/readiness-loop.ts --once",
].join("\n");

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return 0;
  }
  if (argv.some((arg) => arg !== "--once") || argv.filter((arg) => arg === "--once").length > 1) {
    console.error(HELP);
    return 1;
  }
  const once = argv.includes("--once");

  const root = repoRoot();
  const primary = primaryCheckout(root);
  if ("why" in primary) {
    console.error(`readiness-loop: could not find the primary checkout: ${primary.why}`);
    return 1;
  }

  const readinessDir = readinessDirFromEnv();
  const opened = openReadinessStore(readinessDir);
  if (opened.kind !== "open") {
    console.error(`readiness-loop: ${opened.why}`);
    return 1;
  }

  const lockPath = path.join(readinessDir, LOOP_LOCK);
  const claimed = takeLock(lockPath, () => new Date());
  if (!claimed.ok) {
    console.error(describeLockRefusal(claimed.refusal, lockPath));
    return 1;
  }

  let held: HeldLock | null = claimed.lock;
  const release = (): void => {
    if (held === null) return;
    const lock = held;
    held = null;
    releaseLock(lock, lockPath);
  };
  const stop = (signal: NodeJS.Signals): void => {
    if (activeChild !== null) signalReadinessChild(activeChild, signal);
    release();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  const onSigint = (): void => stop("SIGINT");
  const onSigterm = (): void => stop("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    const runner = ensureRunnerWorktree(primary.path, new Date().toISOString());
    const preparation = initialPreparationState();
    const assertLock = (): void => {
      if (held === null) throw new LostLoopLockError(`this process no longer holds ${lockPath}`);
      requireHeldLoopLock(held, lockPath);
    };
    let anotherTick = true;
    while (anotherTick) {
      const started = Date.now();
      /**
       * **One bad tick must not end the loop.**
       *
       * `tick` throws on failed preparation such as `npm ci`, and this used
       * to let that reach the outer catch — which returns, so a single
       * transient failure would stop the runner *for every later commit* and
       * leave the tab silently ageing into `unknown` with nothing to say why.
       * A periodic runner that stops on the first hiccup is worse than none,
       * because its output looks the same as one that is simply idle.
       *
       * So a throw is logged and the loop waits for the next tick. Setup and
       * the lock stay fatal, deliberately: those say this box cannot host a
       * runner at all, which is a different claim from *this tick did not
       * work*. Under `--once` it still surfaces as a non-zero exit, because a
       * person who asked for one tick wants its status.
       */
      try {
        await tick(runner, opened.store, preparation, assertLock);
      } catch (error) {
        if (error instanceof LostLoopLockError) throw error;
        if (once) throw error;
        console.error(`${new Date().toISOString()} tick failed, carrying on: ${(error as Error).message}`);
      }
      anotherTick = !once;
      if (!anotherTick) break;
      const waitMs = Math.max(0, started + TICK_INTERVAL_MS - Date.now());
      if (waitMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
    return 0;
  } catch (error) {
    console.error(`readiness-loop: ${(error as Error).message}`);
    return 1;
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    release();
  }
}

function isMain(): boolean {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  return path.resolve(invoked) === path.resolve(fileURLToPath(import.meta.url));
}

if (isMain()) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
