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
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  readMemorySnapshot,
  readReserveBytes,
  resolveParallelWorkers,
} from "../vitest-admission.js";
import {
  decideTick,
  TICK_INTERVAL_MS,
  type TickDecision,
} from "../tools/fleet/readiness-loop.js";
import { primaryCheckout, snapshotDev, stampTree, type DevSnapshot } from "../tools/fleet/readiness-git.js";
import { openReadinessStore, readinessDirFromEnv, type ReadinessStore } from "../tools/fleet/readiness-store.js";
import { WINDOW_HOURS } from "../tools/fleet/readiness-wiring.js";
import { collectHealth } from "../tools/fleet/health.js";
import { describeLockRefusal, releaseLock, takeLock, type HeldLock } from "../tools/overseer/lock.js";

const RUNNER_WORKTREE = path.join(".claude", "worktrees", "readiness-checks");
const RUNNER_BRANCH = "readiness-checks";
const LOOP_LOCK = "readiness-loop.lock";
const RUN_LOG_DIR = path.join("logs", "readiness-runs");
const RUN_LOGS_KEPT = 20;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

type CommandResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error: Error | null;
};

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function run(cwd: string, command: string, args: readonly string[], timeout = COMMAND_TIMEOUT_MS): CommandResult {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
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

function requireCommand(cwd: string, command: string, args: readonly string[], label: string): CommandResult {
  const result = run(cwd, command, args);
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
  return run(runner, "npx", ["tsx", "scripts/worktree-setup.ts"]);
}

function ensureRunnerWorktree(primary: string, nowIso: string): string {
  const runner = path.join(primary, RUNNER_WORKTREE);
  if (existsSync(runner)) {
    if (!existsSync(path.join(runner, ".env.local"))) {
      throw new Error(`${runner}/.env.local is missing. Copy it from ${primary}/.env.local, run setup, and inspect the tree.`);
    }
    return runner;
  }

  /* Creation starts from the ref we just fetched. setup has its own ordinary
     merge, so equality and cleanliness are checked afterwards rather than
     inferred from either command's success. */
  requireCommand(primary, "git", ["fetch", "origin", "dev"], "fetch before creating the runner worktree");
  mkdirSync(path.dirname(runner), { recursive: true });
  requireCommand(
    primary,
    "git",
    ["worktree", "add", "-B", RUNNER_BRANCH, runner, "origin/dev"],
    "creating the runner worktree",
  );

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

function changedPaths(runner: string, before: string, after: string): Set<string> {
  if (before === after) return new Set();
  const diff = requireCommand(
    runner,
    "git",
    ["diff", "--name-only", before, after, "--", "package-lock.json", "supabase/migrations"],
    "reading the files changed by the fast-forward",
  );
  return new Set(diff.stdout.split("\n").map((line) => line.trim()).filter((line) => line !== ""));
}

/**
 * **`npm run check` has an undeclared prerequisite, and without this the runner
 * would record a permanent false red.**
 *
 * `tests/fleet-decisions-route.test.ts` reads `tools/fleet/web/dist`, and
 * `check`'s build step is `build:client && build:api` — `build:fleet` is in
 * neither. So the test fails in any checkout where nobody happened to run that
 * by hand, which a machine-made worktree never does. Measured on 2026-09-09: it
 * failed in this runner's first recorded check and passed immediately after
 * `npm run build:fleet`.
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
 * the record is about — verified, not assumed.
 */
function ensureFleetClient(runner: string): void {
  if (existsSync(path.join(runner, "tools", "fleet", "web", "dist"))) return;
  const built = run(runner, "npm", ["run", "build:fleet"]);
  if (!commandSucceeded(built)) {
    /* Not fatal. If it stays missing the check records a red naming that test,
       which is worse than this line but is still an honest record of what the
       box did — and a throw here would stop the loop for every later commit. */
    console.log(`${new Date().toISOString()} could not build the fleet client: ${usefulOutput(built)}`);
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

  let result: { code: number | null; signal: NodeJS.Signals | null; error: Error | null };
  try {
    const child = spawn("npx", ["tsx", "scripts/readiness-run.ts", "check"], {
      cwd: runner,
      env: process.env,
      stdio: ["ignore", fd, fd],
    });
    activeChild = child;
    result = await new Promise((resolve) => {
      let spawnError: Error | null = null;
      child.once("error", (error) => {
        spawnError = error;
      });
      child.once("close", (code, signal) => resolve({ code, signal, error: spawnError }));
    });
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

async function tick(runner: string, store: ReadinessStore): Promise<void> {
  const tickMs = Date.now();
  const nowIso = new Date(tickMs).toISOString();
  const before = stampTree(runner);

  const fetch = run(runner, "git", ["fetch", "origin", "dev"]);
  let fastForwardProblem: string | null = null;
  if (!commandSucceeded(fetch)) {
    fastForwardProblem = `git fetch origin dev failed: ${usefulOutput(fetch)}`;
  } else {
    const merge = run(runner, "git", ["merge", "--ff-only", "origin/dev"]);
    if (!commandSucceeded(merge)) fastForwardProblem = `git merge --ff-only origin/dev failed: ${usefulOutput(merge)}`;
  }

  const dev = snapshotDev(runner, nowIso);
  let changed = new Set<string>();
  const afterMerge = stampTree(runner);
  if (
    fastForwardProblem === null &&
    before.kind === "known" &&
    afterMerge.kind === "known"
  ) {
    changed = changedPaths(runner, before.sha, afterMerge.sha);
    if (changed.has("package-lock.json")) {
      requireCommand(runner, "npm", ["ci", "--prefer-offline"], "installing dependencies after package-lock.json changed");
    }
    if ([...changed].some((name) => name.startsWith("supabase/migrations/"))) {
      /* db:migrate's own guard refuses a remote target. Do not weaken it here;
         db:check below decides whether this box is now usable. */
      run(runner, "npm", ["run", "db:migrate"]);
    }
  }

  ensureFleetClient(runner);

  const db = run(runner, "npm", ["run", "--silent", "db:check"]);
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
  if (decision.kind === "run") await runReadinessCheck(runner, decision.sha, store);
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
    activeChild?.kill(signal);
    release();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  const onSigint = (): void => stop("SIGINT");
  const onSigterm = (): void => stop("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    const runner = ensureRunnerWorktree(primary.path, new Date().toISOString());
    let anotherTick = true;
    while (anotherTick) {
      const started = Date.now();
      /**
       * **One bad tick must not end the loop.**
       *
       * `tick` throws on a failed `npm ci` or an unreadable diff, and this used
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
        await tick(runner, opened.store);
      } catch (error) {
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
