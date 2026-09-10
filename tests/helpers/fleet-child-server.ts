/**
 * **The real fleet dashboard, `tools/fleet/server.ts`, as a child process — for
 * tests that must see the composition, not the parts.**
 *
 * WHY THE REAL FILE. A unit test of a guard proves the guard; it cannot see
 * whether `handler()` calls it, or whether a route is mounted above it. That is
 * the class overseer-direction.md § *Built, tested, and called from nothing but
 * its own tests* names, and `applySecurityHeaders` sat in it — deletable from
 * `handler()` with every test staying green. `server.ts` cannot be imported
 * without binding its port and starting its loops, so the honest way to ask it
 * anything is to run it: the file systemd runs, every route in production's
 * order. Plan 260910f § The harness choice; its first user is
 * tests/fleet-composed-access.test.ts. **Reuse this rather than building a
 * second one.**
 *
 * WHAT EACH VARIABLE KEEPS THE CHILD OFF. This box runs the live dashboard and
 * ~40 agents; a child that inherits the test's environment reaches all of it.
 *
 * | variable | keeps the child off |
 * |---|---|
 * | `HOME`, `XDG_CONFIG_HOME` → temp | every `~/.…` store the server defaults to, and whatever reads `~/.config` |
 * | `FLEET_HEALTH_DIR`, `FLEET_HOLDS_DIR`, `FLEET_READINESS_DIR` → temp | the live health, hold/receipt and readiness stores — and their **writer locks**, which a second writer would contend for |
 * | `OVERSEER_STORE_DIR`, `OVERSEER_DECISIONS_DIR`, `OVERSEER_QUEUE_DIR` → temp | the Overseer's files, the describe store, the idea queue |
 * | `TMUX`, `TMUX_PANE` deleted; `TMUX_TMPDIR` → temp | **the live tmux server.** Nothing here passes `-L`/`-S`, so a vitest running inside tmux hands its child the live socket through `TMUX`; with it gone and an empty `TMUX_TMPDIR`, `tmux` finds no server at all |
 * | cwd → a temp dir that is not a repo | the primary checkout: readiness runs `git` and scans worktree logs from cwd |
 * | `FLEET_DESCRIBE_MAX_CALLS=0`, a bogus `OPENROUTER_API_KEY` | OpenRouter. The key is set so the lookup never falls through to a real `.env.local` |
 * | `GJD_REMOTE_*`, `FLEET_NEW_DIR*` deleted | `gjd-remote`, which the new-session route launches agents through |
 * | `accountNeutralEnv` (CLAUDE_CONFIG_DIR and friends) | whichever Claude/Codex account ran the suite |
 * | `FLEET_ACT_ENABLED`, `FLEET_BROADCAST_ENABLED`, `FLEET_ANSWER_ENABLED` = `0` | enacted actions, broadcast and answering, whatever the inherited shell says |
 *
 * **POSITIVE CONTROLS MUST STOP AT VALIDATION.** Isolation covers what the
 * server does on its own; it does not make a request inert. The routes are
 * real: a valid same-origin body to `/api/sessions/new` runs the launcher, and
 * a valid one to `/api/transcribe` calls a provider. Any request you send
 * through this child that passes an origin gate must carry a body the route
 * refuses before it does any work — the composed test uses one that is not
 * JSON, and reads the child's log afterwards for launch and provider lines.
 * GPT Sol's F9 on plan 260910f, a P0.
 *
 * READINESS IS THE CHILD'S OWN LISTEN LINE AND THE CHILD BEING ALIVE, never a
 * 200 from the port. On a box this crowded a port can be answered by somebody
 * else's server, and a test that measured a stranger passes for the wrong
 * reason (the memory is `curling-a-port-cannot-tell-two-servers-apart`).
 *
 * NO BUILD IS A FAILURE, NOT A SKIP. `server.ts` refuses to start without
 * `web/dist/`, and so does this: a skipped security test reads as a passing one
 * in every summary that counts green.
 *
 * IT KILLS ONLY WHAT IT STARTED, AND DIES WITH ITS OWNER. `tsx` runs the script
 * in a node grandchild, so signalling the pid we hold would leave the
 * grandchild holding the port. A tiny owner is spawned `detached`, into a
 * process group of its own, and starts `tsx` inside that group. `stop()` signals
 * the group — which contains nothing of anybody else's. More importantly, the
 * owner watches its Node IPC pipe: if vitest itself is killed, the pipe closes and
 * the owner terminates the whole group rather than leaving a random listener
 * and startup loops behind.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { accountNeutralEnv } from "./account-neutral-env.js";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
export const FLEET_SERVER = path.join(REPO, "tools", "fleet", "server.ts");
export const FLEET_DIST = path.join(REPO, "tools", "fleet", "web", "dist");
/* Resolved HERE, absolutely: the child's cwd is a temp dir, from which a bare
   `tsx` would not resolve and the harness would fail before the server did. */
const TSX_CLI = path.join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
const CHILD_OWNER = path.join(REPO, "tests", "helpers", "fleet-child-owner.mjs");

export type Exit = { code: number | null; signal: NodeJS.Signals | null };

export type FleetChild = {
  port: number;
  baseUrl: string;
  /** PID of the isolated owner/process group; exposed for the parent-death test's emergency cleanup. */
  ownerPid: number;
  /** stdout and stderr interleaved, as the child wrote them. */
  output: () => string;
  /** null while it runs. */
  exited: () => Exit | null;
  /** SIGTERM its group, SIGKILL after 5s, remove its temp dir. Safe to call twice. */
  stop: () => Promise<void>;
};

export type FleetChildOptions = {
  /** Defaults to a free one. */
  port?: number;
  /** Defaults to 127.0.0.1. The only safe startup refusal this harness needs to vary. */
  bind?: "127.0.0.1" | "0.0.0.0";
};

/** A port nothing holds right now on any interface, so a refusal on another
 *  local address is ours and not a stranger's listener. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "0.0.0.0", () => {
      const addr = probe.address();
      probe.close(() => (typeof addr === "object" && addr !== null ? resolve(addr.port) : reject(new Error("no port"))));
    });
  });
}

function isolatedEnv(root: string, port: number, bind: string): NodeJS.ProcessEnv {
  const env = accountNeutralEnv();
  for (const name of Object.keys(env)) {
    if (name.startsWith("GJD_REMOTE_") || name.startsWith("FLEET_NEW_DIR")) delete env[name];
  }
  delete env["TMUX"];
  delete env["TMUX_PANE"];
  const dir = (name: string): string => {
    const d = path.join(root, name);
    mkdirSync(d, { recursive: true });
    return d;
  };
  return {
    ...env,
    HOME: dir("home"),
    XDG_CONFIG_HOME: dir("xdg-config"),
    TMUX_TMPDIR: dir("tmux"),
    FLEET_HEALTH_DIR: dir("health"),
    FLEET_HOLDS_DIR: dir("holds"),
    FLEET_READINESS_DIR: dir("readiness"),
    OVERSEER_STORE_DIR: dir("overseer"),
    OVERSEER_DECISIONS_DIR: dir("decisions"),
    OVERSEER_QUEUE_DIR: dir("queue"),
    FLEET_PORT: String(port),
    FLEET_BIND: bind,
    FLEET_DESCRIBE_MAX_CALLS: "0",
    OPENROUTER_API_KEY: "not-a-real-key-fleet-child-server",
    FLEET_ACT_ENABLED: "0",
    FLEET_BROADCAST_ENABLED: "0",
    FLEET_ANSWER_ENABLED: "0",
    // Long enough that no loop turns a second time while a test runs.
    FLEET_REFRESH_MS: "3600000",
    FLEET_DESCRIBE_MS: "3600000",
    FLEET_READINESS_REFRESH_MS: "3600000",
  };
}

/**
 * Spawn the child and return at once, WITHOUT waiting for it to listen — for
 * a test about a server that must refuse to start. Most tests want
 * `startFleetChild`.
 */
export async function spawnFleetChild(opts: FleetChildOptions = {}): Promise<FleetChild> {
  for (const [what, file] of [
    ["a built fleet client — run `npm run build:fleet` first", path.join(FLEET_DIST, "index.html")],
    ["tsx — run `npm install`", TSX_CLI],
    ["fleet child owner", CHILD_OWNER],
  ] as const) {
    if (!existsSync(file)) throw new Error(`no ${what} (looked for ${file})`);
  }
  const port = opts.port ?? (await freePort());
  const root = mkdtempSync(path.join(os.tmpdir(), "fleet-child-server-"));
  const cwd = path.join(root, "cwd");
  mkdirSync(cwd);
  const proc: ChildProcess = spawn(process.execPath, [CHILD_OWNER, root, process.execPath, TSX_CLI, FLEET_SERVER], {
    cwd,
    env: isolatedEnv(root, port, opts.bind ?? "127.0.0.1"),
    detached: true,
    // Kept open for the process lifetime. The owner treats disconnect as the test
    // runner's death and tears down its server process group.
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const ownerPid = proc.pid;
  if (ownerPid === undefined) {
    rmSync(root, { recursive: true, force: true });
    throw new Error("the fleet child owner started without a pid");
  }
  let out = "";
  let exit: Exit | null = null;
  const append = (b: Buffer): void => {
    out += b.toString("utf8");
  };
  proc.stdout?.on("data", append);
  proc.stderr?.on("data", append);
  const gone = new Promise<void>((resolve) => {
    proc.on("exit", (code, signal) => {
      exit = { code, signal };
      resolve();
    });
  });

  let stopped = false;
  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    const pid = proc.pid;
    if (pid !== undefined && exit === null) {
      signalGroup(pid, "SIGTERM");
      const timer = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 5_000));
      if ((await Promise.race([gone.then(() => "gone" as const), timer])) === "timeout") {
        signalGroup(pid, "SIGKILL");
        await gone;
      }
    }
    rmSync(root, { recursive: true, force: true });
  }

  return { port, baseUrl: `http://127.0.0.1:${port}`, ownerPid, output: () => out, exited: () => exit, stop };
}

/** The group, never the bare pid — see the header. Only our own group. */
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    /* already gone */
  }
}

/**
 * Spawn the child and resolve once it has printed its own listen line and is
 * still alive. If it exits first, or never says it is listening, it is stopped
 * and this throws with everything it printed.
 */
export async function startFleetChild(opts: FleetChildOptions & { timeoutMs?: number } = {}): Promise<FleetChild> {
  const child = await spawnFleetChild(opts);
  const line = `fleet on http://127.0.0.1:${child.port}`;
  const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
  while (Date.now() < deadline) {
    const exit = child.exited();
    if (exit !== null) {
      await child.stop();
      throw new Error(`the fleet server exited before listening (code=${exit.code} signal=${exit.signal}):\n${child.output()}`);
    }
    if (child.output().includes(line)) return child;
    await new Promise((r) => setTimeout(r, 50));
  }
  await child.stop();
  throw new Error(`no "${line}" within ${opts.timeoutMs ?? 60_000}ms; output so far:\n${child.output()}`);
}
