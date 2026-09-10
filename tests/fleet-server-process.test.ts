/**
 * The fleet dashboard as a real process: killed and restarted, started without a
 * client build, and started on a port somebody else holds.
 *
 * Every other fleet test imports modules, or imports `server.ts` with `node:http`
 * mocked out. None of them can see what only a process can: that a SIGKILLed
 * server comes back as a new run with fresh clocks, and that the two startup
 * refusals really do end the process with the exit codes the unit file and the
 * restart script read. Plan docs/plans/260910f, Stage 4.
 *
 * **THE CHILD MUST NEVER TOUCH THE LIVE FLEET.** It runs on this box, beside the
 * real dashboard on 8787, the real `~/.overseer`, and a tmux server full of real
 * agents. So its environment is BUILT, not inherited — a worker's environment
 * carries `.env.local` (tests/setup/unit-no-database.ts loads it) — and every
 * path the server resolves is pointed into one scratch directory:
 *
 *  - `FLEET_PORT` a port just bound and released, `FLEET_BIND=127.0.0.1`;
 *  - `FLEET_HEALTH_DIR`, `FLEET_HOLDS_DIR`, `FLEET_READINESS_DIR`,
 *    `OVERSEER_STORE_DIR` (checkpoint, descriptions, usage history, schedule,
 *    recovery, reports), `OVERSEER_DECISIONS_DIR`, `OVERSEER_QUEUE_DIR`;
 *  - `HOME`, for everything that falls back to `homedir()`: the admission
 *    journal, `~/.config/spideryarn`, `~/.claude/projects` and `~/.claude/sessions`;
 *  - `TMUX_TMPDIR`, with `TMUX` and `TMUX_PANE` absent: the collector has no
 *    socket override, so the default socket then names an empty server;
 *  - the working directory, which `server.ts` hands readiness as the checkout to
 *    scan;
 *  - a `claude` stub first on `PATH`, because the collector's script runs
 *    `claude agents --json`;
 *  - `FLEET_DESCRIBE_MAX_CALLS=0` and a fake `OPENROUTER_API_KEY`, so the
 *    describer can make no model call and the real key in `.env.local` is never
 *    read (the env wins over the file — transcribe.ts `openRouterKey`).
 *
 * The child is `node --import <tsx loader> server.ts` rather than `npx tsx`,
 * because the tsx CLI starts a second node that keeps the port when the first is
 * killed. It is spawned `detached`, so it leads its own process group and a kill
 * aimed at `-pid` takes exactly what this file started and nothing else.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const SERVER = join(REPO, "tools", "fleet", "server.ts");
/* The package's own entry (`exports["."]`), by absolute path: the child's working
   directory is scratch, where a bare `tsx` specifier would not resolve. */
const TSX_LOADER = join(REPO, "node_modules", "tsx", "dist", "loader.mjs");

type Scratch = { root: string; cwd: string; dist: string; emptyDist: string; env: (port: number) => NodeJS.ProcessEnv };

type Running = { child: ChildProcess; output: () => string; exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }> };

const scratchRoots: string[] = [];
const children: ChildProcess[] = [];
const holders: Server[] = [];

function makeScratch(): Scratch {
  /* Short on purpose: tmux's socket path must fit in a sockaddr_un (~108 bytes). */
  const root = mkdtempSync(join(tmpdir(), "fsp-"));
  scratchRoots.push(root);
  const dir = (name: string): string => {
    const d = join(root, name);
    mkdirSync(d, { recursive: true });
    return d;
  };
  const home = dir("home");
  const tmux = dir("tmux");
  const tmp = dir("tmp");
  const bin = dir("bin");
  const cwd = dir("cwd");
  /* A disposable checkout, because server.ts hands readiness `process.cwd()` as
     the primary and it scans that checkout's worktrees and job logs at startup:
     a real (if empty) repository here exercises that path without it ever
     seeing this one. */
  const git = (...args: string[]): void => {
    execFileSync(
      "git",
      ["-c", "user.name=scratch", "-c", "user.email=scratch@invalid", "-c", "commit.gpgsign=false", ...args],
      { cwd, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, GIT_CONFIG_NOSYSTEM: "1" }, stdio: "ignore" },
    );
  };
  writeFileSync(join(cwd, "README"), "scratch checkout for tests/fleet-server-process.test.ts\n");
  git("init", "-q");
  git("add", "README");
  git("commit", "-q", "-m", "scratch");
  const dist = dir("dist");
  const emptyDist = dir("empty-dist");
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>scratch fleet</title>\n");
  const claudeStub = join(bin, "claude");
  writeFileSync(claudeStub, "#!/bin/sh\nexit 1\n");
  chmodSync(claudeStub, 0o755);
  const stores = {
    FLEET_HEALTH_DIR: dir("health"),
    FLEET_HOLDS_DIR: dir("holds"),
    FLEET_READINESS_DIR: dir("readiness"),
    OVERSEER_STORE_DIR: dir("overseer"),
    OVERSEER_DECISIONS_DIR: dir("decisions"),
    OVERSEER_QUEUE_DIR: dir("queue"),
  };
  return {
    root,
    cwd,
    dist,
    emptyDist,
    env: (port) => ({
      PATH: `${bin}:${process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin"}`,
      LANG: "C.UTF-8",
      HOME: home,
      TMPDIR: tmp,
      TMUX_TMPDIR: tmux,
      FLEET_PORT: String(port),
      FLEET_BIND: "127.0.0.1",
      FLEET_DIST: dist,
      ...stores,
      FLEET_NEW_DIR: cwd,
      FLEET_NEW_DIR_ROOTS: cwd,
      FLEET_DESCRIBE_MAX_CALLS: "0",
      FLEET_DESCRIBE_MS: "3600000",
      OPENROUTER_API_KEY: "test-sentinel-not-a-key",
      FLEET_REFRESH_MS: "1000",
      FLEET_READINESS_REFRESH_MS: "3600000",
      FLEET_ACT_ENABLED: "0",
      FLEET_BROADCAST_ENABLED: "0",
      FLEET_ANSWER_ENABLED: "0",
      OVERSEER_JOBS_ENABLED: "0",
    }),
  };
}

/**
 * Refuse to spawn unless every filesystem target handed to the child is inside
 * the scratch root. Any value that is an absolute path counts — so a path
 * variable added here later is checked without anyone remembering to list it —
 * and `PATH` only by its first entry, the stub directory that must shadow the
 * real `claude`. The tmux variables that would name the LIVE server must be
 * absent, not merely empty.
 */
function assertConfined(env: NodeJS.ProcessEnv, root: string, cwd: string): void {
  const inside = (p: string): boolean => p === root || p.startsWith(root + sep);
  const outside: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (name === "PATH") {
      const first = value.split(":")[0] ?? "";
      if (!inside(first)) outside.push(`PATH starts with ${first}`);
      continue;
    }
    for (const part of value.split(",")) {
      if (isAbsolute(part) && !inside(part)) outside.push(`${name}=${part}`);
    }
  }
  if (!inside(cwd)) outside.push(`cwd=${cwd}`);
  for (const name of ["HOME", "TMPDIR", "TMUX_TMPDIR", "OVERSEER_STORE_DIR", "FLEET_HOLDS_DIR", "FLEET_DIST"]) {
    if (env[name] === undefined) outside.push(`${name} is unset, so it falls back outside scratch`);
  }
  for (const name of ["TMUX", "TMUX_PANE", "CLAUDE_CONFIG_DIR"]) {
    if (name in env) outside.push(`${name} is set`);
  }
  /* A thrown sentence rather than `expect(...).toEqual([])`, whose message
     truncates the list and would hide all but the first way out. */
  if (outside.length > 0) throw new Error(`the child would reach outside its scratch root: ${outside.join("; ")}`);
}

function start(scratch: Scratch, env: NodeJS.ProcessEnv): Running {
  assertConfined(env, scratch.root, scratch.cwd);
  const child = spawn(process.execPath, ["--import", TSX_LOADER, SERVER], {
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

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

/** Pids listening on 127.0.0.1:`port`, as `ss` sees them. */
function listenerPids(port: number): number[] {
  const out = execFileSync("ss", ["-ltnpH", `sport = :${port}`], { encoding: "utf8" });
  return [...out.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]));
}

function listening(port: number): boolean {
  return execFileSync("ss", ["-ltnH", `sport = :${port}`], { encoding: "utf8" }).trim() !== "";
}

/** `node:http`, not `fetch`: the unit lane's setup watches `fetch` for provider calls. */
function getJson(port: number, route: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = get({ host: "127.0.0.1", port, path: route, timeout: 2_000 }, (res) => {
      let raw = "";
      res.on("data", (chunk: Buffer) => {
        raw += chunk.toString("utf8");
      });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
        } catch (cause) {
          reject(cause);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
  });
}

type StateSeen = {
  producer: { instance: string; publication: number; inventory: number | null };
  attemptedAt: string | null;
  collectedAt: string | null;
  rows: unknown[];
  tmuxServerPid: number | null;
  error: string | null;
};

/**
 * Wait until `/api/state` answers 200 from THIS child and a collection has been
 * attempted. A bare 200 proves nothing on a box with thirty dev servers: the
 * child must have logged binding this port, and `ss` must name its pid as the
 * listener.
 */
async function waitForState(running: Running, port: number, deadlineMs: number): Promise<StateSeen> {
  const deadline = Date.now() + deadlineMs;
  let last = "no answer yet";
  while (Date.now() < deadline) {
    if (running.child.exitCode !== null) {
      throw new Error(`the server exited ${running.child.exitCode} before answering:\n${running.output()}`);
    }
    if (running.output().includes(`fleet on http://127.0.0.1:${port}`)) {
      try {
        const answer = await getJson(port, "/api/state");
        const body = answer.body as StateSeen;
        if (answer.status === 200 && body.attemptedAt !== null && body.producer.publication > 0) {
          expect(listenerPids(port)).toEqual([running.child.pid]);
          return body;
        }
        last = `status ${answer.status}, attemptedAt ${String(body.attemptedAt)}`;
      } catch (cause) {
        last = cause instanceof Error ? cause.message : String(cause);
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no fresh /api/state within ${deadlineMs} ms (${last}):\n${running.output()}`);
}

async function exitWithin(running: Running, ms: number): Promise<{ code: number | null; signal: NodeJS.Signals | null } | "still running"> {
  return Promise.race([
    running.exited,
    new Promise<"still running">((r) => setTimeout(() => r("still running"), ms).unref()),
  ]);
}

afterEach(async () => {
  for (const child of children.splice(0)) killGroup(child);
  for (const holder of holders.splice(0)) await new Promise<void>((r) => holder.close(() => r()));
  for (const root of scratchRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("the fleet server as a process, on scratch state", () => {
  it("will not spawn over an environment that reaches outside scratch", () => {
    /* The guard below every spawn, seen to refuse — a confinement check that
       has never failed is not evidence that the others are confined. */
    const scratch = makeScratch();
    const env = scratch.env(1);
    expect(() => assertConfined(env, scratch.root, scratch.cwd)).not.toThrow();
    expect(() => assertConfined({ ...env, HOME: "/var/empty" }, scratch.root, scratch.cwd)).toThrow(/HOME=\/var\/empty/);
    expect(() => assertConfined({ ...env, TMUX: "/tmp/tmux-1000/default,1,0" }, scratch.root, scratch.cwd)).toThrow(
      /TMUX is set/,
    );
    const { OVERSEER_STORE_DIR: _dropped, ...withoutStore } = env;
    expect(() => assertConfined(withoutStore, scratch.root, scratch.cwd)).toThrow(/OVERSEER_STORE_DIR is unset/);
    expect(() => assertConfined(env, scratch.root, REPO)).toThrow(/cwd=/);
  });

  it("comes back from SIGKILL as a new run, with fresh clocks and no sight of the live tmux", async () => {
    const scratch = makeScratch();
    const port = await freePort();

    const first = start(scratch, scratch.env(port));
    const before = await waitForState(first, port, 30_000);
    expect(before.producer.instance).toMatch(/^[0-9a-f]{8}$/);

    killGroup(first.child);
    expect(await exitWithin(first, 10_000)).toEqual({ code: null, signal: "SIGKILL" });
    expect(listening(port)).toBe(false);

    const respawnedAt = Date.now();
    const second = start(scratch, scratch.env(port));
    const after = await waitForState(second, port, 30_000);

    expect(after.producer.instance).toMatch(/^[0-9a-f]{8}$/);
    expect(after.producer.instance).not.toBe(before.producer.instance);
    expect(Date.parse(after.attemptedAt ?? "")).toBeGreaterThanOrEqual(respawnedAt);

    /* The scratch TMUX_TMPDIR names a socket with no server behind it, so the
       collector must fail on THAT socket — the error names the path it tried,
       which is the proof it never asked the live server. A populated fleet here
       would mean it read the live one. */
    expect(after.rows).toEqual([]);
    expect(after.tmuxServerPid).toBeNull();
    expect(after).toMatchObject({ collectedAt: null });
    expect(after.error ?? "").toContain(`error connecting to ${join(scratch.root, "tmux")}/`);
  }, 90_000);

  it("refuses to start without a built client, exiting 2 and naming the missing index.html", async () => {
    const scratch = makeScratch();
    const port = await freePort();
    const running = start(scratch, { ...scratch.env(port), FLEET_DIST: scratch.emptyDist });

    const result = await exitWithin(running, 20_000);
    expect(result).toEqual({ code: 2, signal: null });
    expect(running.output()).toContain(`no built client at ${scratch.emptyDist}`);
    expect(listening(port)).toBe(false);
  }, 40_000);

  it("refuses a relative FLEET_DIST rather than resolving it against its working directory", async () => {
    const scratch = makeScratch();
    const port = await freePort();
    const running = start(scratch, { ...scratch.env(port), FLEET_DIST: "dist" });

    const result = await exitWithin(running, 20_000);
    expect(result).toEqual({ code: 2, signal: null });
    expect(running.output()).toContain('FLEET_DIST must be an absolute path; got "dist"');
  }, 40_000);

  it("exits 1, naming the bind error, when its port is already held", async () => {
    const scratch = makeScratch();
    const port = await freePort();
    const holder = createServer();
    holders.push(holder);
    await new Promise<void>((resolve) => holder.listen(port, "127.0.0.1", resolve));

    const running = start(scratch, scratch.env(port));
    const result = await exitWithin(running, 15_000);
    expect(result).toEqual({ code: 1, signal: null });
    expect(running.output()).toContain(`could not bind 127.0.0.1:${port}`);
    expect(running.output()).toContain("EADDRINUSE");
  }, 40_000);
});
