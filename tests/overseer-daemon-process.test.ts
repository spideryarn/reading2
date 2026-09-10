/**
 * The Overseer daemon as a real process: SIGKILLed, diagnosed, and replaced.
 * Plan docs/plans/260910f, Stage 4c (GPT Sol's F6).
 *
 * Every other daemon test calls `runOverseer` in-process, and aborting it there
 * is a GRACEFUL stop — the `finally` runs, the note is written, the lock is let
 * go. Only a process can be killed with nothing running afterwards. So this
 * spawns `scripts/overseer.ts run` itself, kills its process group, and asks
 * what a person would ask: does `diagnose` say KILLED, and does the next start
 * take over the dead pid's lock rather than refuse it? Then a second child is
 * stopped with SIGTERM, the systemd path, and must say STOPPED instead.
 *
 * **THE CHILD MUST NEVER TOUCH THE LIVE OVERSEER.** Everything `run` reaches,
 * read off `scripts/overseer.ts` § `case "run"` and the modules it composes:
 *
 *  - the store (`OVERSEER_STORE_DIR`): checkpoint, notes, events, baseline,
 *    lock, `armed.json` (cleared when disarmed), `schedule.json`, recovery,
 *    the report inbox and `reports.jsonl`, and usage history (opened lazily,
 *    only by a usage pass, which is off);
 *  - the decision record (`OVERSEER_DECISIONS_DIR`) and the idea queue
 *    (`OVERSEER_QUEUE_DIR`), read by the report drain's artefact checker;
 *  - `~/.claude/projects` via the recovery view (`recovery-view.ts`
 *    `evidenceDeps`), so `HOME` is scratch;
 *  - the dashboard, `--url`: a stand-in on `listen(0, 127.0.0.1)`;
 *  - READ-ONLY, outside scratch, and allowed: `git -C <this checkout>` for the
 *    start revision and the job documents, `ps` for the process table, and
 *    `/proc/sys/kernel/random/boot_id`.
 *
 * What is NOT reached, and why: the attention pass (paid model) is not built
 * under `--no-attention`; the usage pass (`claude` / Codex usage fetch, and
 * the 2.9 GB transcript scan) is not built under `--no-usage`; gjd-remote
 * dispatch and rule work are built only when `OVERSEER_JOBS_ENABLED` or
 * `OVERSEER_RULES_ENABLED` is exactly `1`, and both are `0`. The child's
 * startup lines are asserted to say all three are off.
 *
 * The environment is BUILT, not inherited — a vitest worker's environment
 * carries `.env.local`. The child is `node --import <tsx loader>` rather than
 * `npx tsx` (which leaves a node grandchild), spawned `detached` so a kill aimed
 * at `-pid` takes exactly what this file started.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { diagnose, diagnoseLines, readDiagnoseInput, type DiagnoseReport } from "../tools/overseer/diagnose.js";
import { readNotes, type DaemonNote } from "../tools/overseer/notes.js";
import { LOCK_FILE, readCheckpoint } from "../tools/overseer/store.js";
import { editableFixture } from "./overseer-fixtures.js";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const OVERSEER = join(REPO, "scripts", "overseer.ts");
/* The package's own entry by absolute path: the child's cwd is scratch, where a bare `tsx` would not resolve. */
const TSX_LOADER = join(REPO, "node_modules", "tsx", "dist", "loader.mjs");
/* The two flags that turn off every paid or heavy pass; the guard refuses a spawn without them. */
const RUN_ARGS = ["run", "--no-attention", "--no-usage", "--tick-ms", "100"] as const;

type Scratch = { root: string; cwd: string; store: string; env: (url: string) => NodeJS.ProcessEnv };
type Running = { child: ChildProcess; output: () => string; exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }> };

const scratchRoots: string[] = [];
const children: ChildProcess[] = [];
const servers: Server[] = [];

function makeScratch(): Scratch {
  const root = mkdtempSync(join(tmpdir(), "odp-"));
  scratchRoots.push(root);
  const dir = (name: string): string => {
    const d = join(root, name);
    mkdirSync(d, { recursive: true });
    return d;
  };
  const home = dir("home");
  const cwd = dir("cwd");
  const store = dir("overseer");
  const stores = { OVERSEER_STORE_DIR: store, OVERSEER_DECISIONS_DIR: dir("decisions"), OVERSEER_QUEUE_DIR: dir("queue") };
  const tmp = dir("tmp");
  const tmux = dir("tmux");
  return {
    root,
    cwd,
    store,
    env: (url) => ({
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      LANG: "C.UTF-8",
      HOME: home,
      TMPDIR: tmp,
      TMUX_TMPDIR: tmux,
      ...stores,
      OVERSEER_FLEET_URL: url,
      OVERSEER_JOBS_ENABLED: "0",
      OVERSEER_RULES_ENABLED: "0",
      OPENROUTER_API_KEY: "test-sentinel-not-a-key",
    }),
  };
}

/**
 * Refuse to spawn unless every path the child is handed is inside scratch, the
 * live tmux variables are absent, both schedulers are disarmed, the dashboard
 * is loopback, and both pass-disabling flags are on the command line. `PATH` is
 * the one exception: it names the real `git` and `ps`, which the daemon only reads with.
 */
function assertConfined(env: NodeJS.ProcessEnv, args: readonly string[], root: string, cwd: string): void {
  const inside = (p: string): boolean => p === root || p.startsWith(root + sep);
  const outside: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || name === "PATH") continue;
    if (isAbsolute(value) && !inside(value)) outside.push(`${name}=${value}`);
  }
  if (!inside(cwd)) outside.push(`cwd=${cwd}`);
  for (const name of ["HOME", "TMPDIR", "TMUX_TMPDIR", "OVERSEER_STORE_DIR", "OVERSEER_DECISIONS_DIR", "OVERSEER_QUEUE_DIR"]) {
    if (env[name] === undefined) outside.push(`${name} is unset, so it falls back outside scratch`);
  }
  for (const name of ["TMUX", "TMUX_PANE", "CLAUDE_CONFIG_DIR"]) {
    if (name in env) outside.push(`${name} is set`);
  }
  for (const name of ["OVERSEER_JOBS_ENABLED", "OVERSEER_RULES_ENABLED"]) {
    if (env[name] !== "0") outside.push(`${name} is not "0"`);
  }
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(env["OVERSEER_FLEET_URL"] ?? "")) outside.push("OVERSEER_FLEET_URL is not a loopback stand-in");
  for (const flag of ["--no-attention", "--no-usage"]) {
    if (!args.includes(flag)) outside.push(`${flag} is missing`);
  }
  if (outside.length > 0) throw new Error(`the child would reach outside its scratch root: ${outside.join("; ")}`);
}

function start(scratch: Scratch, url: string): Running {
  const env = scratch.env(url);
  const args = [...RUN_ARGS, "--url", url];
  assertConfined(env, args, scratch.root, scratch.cwd);
  const child = spawn(process.execPath, ["--import", TSX_LOADER, OVERSEER, ...args], {
    cwd: scratch.cwd,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let text = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    text += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    text += chunk.toString("utf8");
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return { child, output: () => text, exited };
}

/** Kill the group this file started — never anything found by name. */
function killGroup(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    /* Already gone. */
  }
}

/** A stand-in for `tools/fleet/server.ts`: the two routes the Overseer reads, from `overseer-source.test.ts`'s `fakeFleet`. */
async function standIn(): Promise<string> {
  const body = (): string => JSON.stringify({ ...editableFixture("session-new-before"), collectedAt: new Date().toISOString() });
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/api/live")) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
      res.flushHeaders();
      res.write(`event: snapshot\ndata: ${body()}\n\n`);
      return;
    }
    if (url.startsWith("/api/state")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body());
      return;
    }
    res.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return `http://127.0.0.1:${address.port}`;
}

function notesIn(store: string): DaemonNote[] {
  const read = readNotes(store);
  if (read.kind === "unreadable") throw new Error(read.cause);
  return read.notes;
}

type Started = Extract<DaemonNote, { kind: "daemon-started" }>;

/** Poll the child's own files with a deadline; fail with its output rather than hang. */
async function waitFor<T>(what: string, running: Running, probe: () => T | null, timeoutMs = 45_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = probe();
    if (found !== null) return found;
    if (running.child.exitCode !== null) throw new Error(`the daemon exited ${running.child.exitCode} before ${what}:\n${running.output()}`);
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}:\n${running.output()}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** This child's start note, and a checkpoint that instance wrote — the pair that says it holds the store. */
async function startedAndCheckpointed(running: Running, store: string): Promise<Started> {
  const pid = running.child.pid;
  const started = await waitFor(`a daemon-started note from pid ${pid}`, running, () => {
    const note = notesIn(store).find((n): n is Started => n.kind === "daemon-started" && n.pid === pid);
    return note ?? null;
  });
  await waitFor(`a checkpoint from instance ${started.instanceId}`, running, () => {
    const read = readCheckpoint(store);
    return read.kind === "checkpoint" && read.checkpoint.heartbeat.instanceId === started.instanceId && read.checkpoint.heartbeat.pid === pid ? true : null;
  });
  return started;
}

function diagnoseStore(store: string): { report: DiagnoseReport; lines: string[] } {
  const read = readDiagnoseInput(store);
  if (!read.ok) throw new Error(read.why);
  const report = diagnose(read.input);
  return { report, lines: diagnoseLines(report) };
}

async function exitWithin(running: Running, ms: number): Promise<{ code: number | null; signal: NodeJS.Signals | null } | "still running"> {
  return Promise.race([running.exited, new Promise<"still running">((r) => setTimeout(() => r("still running"), ms).unref())]);
}

afterEach(async () => {
  for (const child of children.splice(0)) killGroup(child);
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
  for (const root of scratchRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("the Overseer daemon as a process, on scratch state", () => {
  it("will not spawn over an environment that reaches outside scratch", () => {
    /* The guard below every spawn, seen to refuse — a guard that never failed is not evidence. */
    const scratch = makeScratch();
    const env = scratch.env("http://127.0.0.1:1");
    const args = [...RUN_ARGS];
    expect(() => assertConfined(env, args, scratch.root, scratch.cwd)).not.toThrow();
    expect(() => assertConfined({ ...env, HOME: "/home/greg" }, args, scratch.root, scratch.cwd)).toThrow(/HOME=\/home\/greg/);
    expect(() => assertConfined({ ...env, OVERSEER_STORE_DIR: undefined }, args, scratch.root, scratch.cwd)).toThrow(/OVERSEER_STORE_DIR is unset/);
    expect(() => assertConfined({ ...env, TMUX: "/tmp/tmux-1000/default,1,0" }, args, scratch.root, scratch.cwd)).toThrow(/TMUX is set/);
    expect(() => assertConfined({ ...env, OVERSEER_JOBS_ENABLED: "1" }, args, scratch.root, scratch.cwd)).toThrow(/OVERSEER_JOBS_ENABLED/);
    expect(() => assertConfined(env, ["run", "--no-attention"], scratch.root, scratch.cwd)).toThrow(/--no-usage is missing/);
    expect(() => assertConfined({ ...env, OVERSEER_FLEET_URL: "http://127.0.0.1:8787/" }, args, scratch.root, scratch.cwd)).toThrow(/loopback/);
    expect(() => assertConfined(env, args, scratch.root, "/home/greg")).toThrow(/cwd=/);
  });

  it("a SIGKILLed daemon reads KILLED, the next start takes its stale lock, and a SIGTERMed one reads STOPPED", async () => {
    const scratch = makeScratch();
    const url = await standIn();

    // ── FIRST CHILD: started, holding the store, then killed with nothing after.
    const first = start(scratch, url);
    const one = await startedAndCheckpointed(first, scratch.store);
    // The passes really are off — the child said so, rather than us assuming the flags parse.
    expect(first.output()).toContain("attention: off (--no-attention)");
    expect(first.output()).toContain("usage: off (--no-usage)");
    expect(first.output()).toMatch(/scheduler: OFF/);

    killGroup(first.child);
    expect(await exitWithin(first, 10_000)).toEqual({ code: null, signal: "SIGKILL" });

    // It left what a crash leaves: no stopping note, and a lock naming a dead pid.
    expect(notesIn(scratch.store).some((n) => n.kind === "daemon-stopped")).toBe(false);
    const lock = JSON.parse(readFileSync(join(scratch.store, LOCK_FILE), "utf8")) as { pid: number; instanceId: string };
    expect(lock.pid).toBe(first.child.pid);

    const killed = diagnoseStore(scratch.store);
    expect(killed.report.daemon.instanceId).toBe(one.instanceId);
    expect(killed.report.daemon.standing.state).toBe("killed");
    expect(killed.lines.find((line) => line.startsWith("daemon"))).toMatch(/^daemon\s+KILLED/);

    // ── SECOND CHILD, same root: the dead pid's lock must not stop it.
    const second = start(scratch, url);
    const two = await startedAndCheckpointed(second, scratch.store);
    expect(two.instanceId).not.toBe(one.instanceId);
    const relock = JSON.parse(readFileSync(join(scratch.store, LOCK_FILE), "utf8")) as { pid: number; instanceId: string };
    expect(relock).toMatchObject({ pid: second.child.pid, instanceId: two.instanceId });
    expect(diagnoseStore(scratch.store).report.daemon.standing.state).toBe("running");

    // ── SIGTERM, the systemd path: a graceful stop, the note written, the lock let go.
    if (second.child.pid === undefined) throw new Error("no pid");
    process.kill(second.child.pid, "SIGTERM");
    expect(await exitWithin(second, 20_000)).toEqual({ code: 0, signal: null });
    const last = notesIn(scratch.store).at(-1);
    expect(last).toMatchObject({ kind: "daemon-stopped", instanceId: two.instanceId });
    expect(existsSync(join(scratch.store, LOCK_FILE))).toBe(false);

    const stopped = diagnoseStore(scratch.store);
    expect(stopped.report.daemon.instanceId).toBe(two.instanceId);
    expect(stopped.report.daemon.standing.state).toBe("stopped");
    expect(stopped.lines.find((line) => line.startsWith("daemon"))).toMatch(/^daemon\s+STOPPED/);
  }, 120_000);
});
