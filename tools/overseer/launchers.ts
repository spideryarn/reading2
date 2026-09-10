/**
 * **THE LAUNCHERS THE PROTOCOL INVOKES, AND THE TMUX EVIDENCE PORT.**
 *
 * Plan 260910f § D6, Stage 2. Each adapter carries the occurrence's correlation
 * id in its FIRST external effect — the session's environment at creation, or
 * the wrapper's `--launch-dir` — and answers the protocol synchronously:
 * `refused-before-effect` only when it can prove nothing external happened,
 * `started` once the effect has begun, and a throw when it cannot tell.
 *
 *  - {@link gjdRemoteLauncher} (`tmux`) — `gjd-remote new-claude … --launch-id
 *    --launch-dir … -p -`: an interactive session, for recovery.
 *  - {@link tmuxHeadlessLauncher} (`tmux-headless`) — a session on the ALREADY
 *    RUNNING tmux server whose command is `run-claude --launch-dir …`: the
 *    scheduled-dispatch seam. `overseer.service` sets no `KillMode`, so a
 *    wrapper spawned by the daemon dies with every restart of the unit; a
 *    session on the existing server lives outside its cgroup. So it REFUSES
 *    when no server is running rather than fork one inside the daemon.
 *  - {@link headlessLauncher} (`headless`) — the wrapper spawned directly: for
 *    tests, and for a caller that is not the daemon.
 *  - {@link socketTmuxLauncher} (`tmux`) — a session on an EXPLICIT socket
 *    running a given command between Stage 2's own artefact lines: the drill's
 *    stand-in for Claude, and the real-tmux tests'.
 *
 * **Nothing outside the protocol's composition imports this file**
 * (`tests/overseer-launch-protocol.test.ts` walks production imports to prove
 * it, F9): a consumer holds `launchOccurrence`, never an adapter. None of them
 * has a prompt parameter (F5): the bytes are the protocol's verified material.
 * The wrapper adapters write THOSE BYTES to an attempt-private `prompt.md` —
 * created exclusively, 0600, fsynced, its directory fsynced — and never hand
 * over the shared `material.txt`, which would reopen the check-then-use window
 * F5 closed (scheduled-dispatch's plan review, F9). The wrapper then re-hashes
 * what it read against `intent.json`'s pin before it spawns the CLI.
 *
 * ## What each cannot rule out, said plainly
 *
 *  - `tmux-headless` checks for a server and then creates the session: a server
 *    that exits in between means `new-session` starts one, inside the cgroup.
 *    The window is one `spawnSync`, and the cost is the restart hazard, not a
 *    double launch.
 *  - `gjd-remote` exiting non-zero after it started cannot be told apart, from
 *    here, from one that created the session and then failed to confirm it; the
 *    launcher answers `started` once gjd-remote has a pid, and reconciliation
 *    finds out from `start.json`, `exit.json` and the tmux probe.
 *  - The probe asks each session's own environment, one `show-environment` per
 *    session; a session that vanishes between the listing and the question is
 *    not running, so it is skipped rather than made a failure to look.
 */
import { spawn as spawnChild, spawnSync, type SpawnOptions } from "node:child_process";
import { closeSync, existsSync, fsyncSync, openSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

import { TSX_RELATIVE_PATH, type ChildSpawner } from "./dispatch.js";
import { LAUNCH_DIR_VAR, LAUNCH_ID_VAR, exitArtefactLine, launchDirProblem, shellQuote, startArtefactLine } from "./launch-artefacts.js";
import { isCorrelationId, type CorrelationId, type LaunchInput, type Launcher, type LauncherAnswer, type RunAccess, type RunSpec, type TmuxReading } from "./launch-protocol.js";

/** gjd-remote's own `MAX_PROMPT_BYTES` (scripts/gjd-remote.ts): the ceiling on `-p -`, checked here so a refusal is `refused-before-effect` rather than a gjd-remote that dies. A test pins the two together. */
export const GJD_REMOTE_MAX_PROMPT_BYTES = 96 * 1024;

/** In the attempt directory, beside the three artefacts: what the launcher itself leaves. The reader never reads these. */
export const LAUNCHER_STDIN_FILE = "launcher-stdin.txt";
export const LAUNCHER_LOG_FILE = "launcher.log";
export const JOB_FILE = "job.sh";
/** The wrapper adapters' prompt: the verified bytes, private to this attempt. */
export const PROMPT_FILE = "prompt.md";

export type WrapperName = "run-claude" | "run-codex";

const refused = (why: string): LauncherAnswer => ({ kind: "refused-before-effect", why });

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

const defaultSpawner: ChildSpawner = (command, args, options) => spawnChild(command, [...args], options);

/** Why this input cannot be launched by anything here, or null. */
function inputProblem(input: LaunchInput): string | null {
  if (!isCorrelationId(input.correlationId)) return `${JSON.stringify(input.correlationId)} is not a correlation id`;
  const problem = launchDirProblem(input.artefactDir);
  return problem === null ? null : `the artefact directory ${problem}`;
}

/** A file only this attempt will ever write: created exclusively, never over an existing one. `durable` fsyncs it and then its directory. */
function writeExclusive(path: string, bytes: Buffer, mode = 0o600, options: { readonly durable?: boolean } = {}): void {
  const fd = openSync(path, "wx", mode);
  try {
    let written = 0;
    while (written < bytes.length) {
      const wrote = writeSync(fd, bytes, written, bytes.length - written);
      if (wrote <= 0) throw new Error(`wrote ${wrote} of ${bytes.length - written} remaining bytes`);
      written += wrote;
    }
    if (options.durable === true) fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (options.durable !== true) return;
  const dir = openSync(dirname(path), "r");
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}

/**
 * `<artefactDir>/prompt.md`: the VERIFIED bytes the protocol handed over,
 * durably — created exclusively (never over a file already there), 0600,
 * fsynced, then the directory fsynced. Nothing but this attempt ever writes it,
 * so there is no window between a check and a use for anyone to write into,
 * and the wrapper re-hashes it against the pin regardless.
 */
function writePrompt(input: LaunchInput): { readonly ok: true; readonly path: string } | { readonly ok: false; readonly why: string } {
  const path = join(input.artefactDir, PROMPT_FILE);
  try {
    writeExclusive(path, input.material.bytes, 0o600, { durable: true });
    return { ok: true, path };
  } catch (cause) {
    return { ok: false, why: `${path} could not be written: ${messageOf(cause)} — nothing was started` };
  }
}

const CODEX_SANDBOX: Readonly<Record<RunAccess, string>> = { "read-only": "read-only", review: "review", write: "workspace-write" };

/**
 * The run spec as a wrapper's own flags, and nothing else: `--timeout-minutes`;
 * then `--access` and `--account` (run-claude), or `--sandbox`, access's twin
 * (run-codex). run-codex takes no account flag — the handle names a Claude pool
 * account — so it gets none.
 */
export function wrapperRunArgs(wrapper: WrapperName, run: RunSpec): string[] {
  const timeout = ["--timeout-minutes", String(run.timeoutMinutes)];
  return wrapper === "run-claude" ? [...timeout, "--access", run.access, "--account", run.account] : [...timeout, "--sandbox", CODEX_SANDBOX[run.access]];
}

/** Spawn, with the fds closed in the parent however it goes. A throw from the spawn itself means no process: a refusal. */
function spawnDetached(
  spawnProcess: ChildSpawner,
  command: string,
  args: readonly string[],
  options: SpawnOptions,
  fds: readonly number[],
  what: string,
): LauncherAnswer | { readonly kind: "spawned"; readonly pid: number } {
  let child: ReturnType<ChildSpawner>;
  try {
    child = spawnProcess(command, args, options);
  } catch (cause) {
    return refused(`${what} could not be started: ${messageOf(cause)}`);
  } finally {
    for (const fd of fds) closeSync(fd);
  }
  // Listeners first: an asynchronous spawn failure is an 'error' event, and an
  // unlistened one would take the daemon down with it.
  child.on("error", () => {});
  child.on("exit", () => {});
  if (child.pid === undefined) return refused(`${what} was created with no pid, which means it never started`);
  return { kind: "spawned", pid: child.pid };
}

/* ------------------------------------------------------------------ *
 * tmux: gjd-remote new-claude.
 * ------------------------------------------------------------------ */

export type GjdRemoteLauncherOptions = {
  /** The PRIMARY checkout, as for `dispatch.ts`. */
  readonly repoRoot: string;
  /** A registry handle or `auto`, as `gjd-remote --account` takes it. */
  readonly account?: string;
  /** Injected by tests. Nothing in production passes it. */
  readonly spawnProcess?: ChildSpawner;
};

/**
 * `gjd-remote new-claude <correlationId> --account auto --no-attach
 * --launch-id <id> --launch-dir <dir> -p -`, both new options before the
 * unchanged final `-p -` (F13).
 *
 * **Stdin is a regular file**, holding the verified material plus a newline —
 * never a pipe the daemon writes. A pipe that the daemon was killed halfway
 * through writing would hand gjd-remote a truncated prompt and a clean EOF, and
 * it would start Claude on it. A file ends because it has an end.
 */
export function gjdRemoteLauncher(options: GjdRemoteLauncherOptions): Launcher {
  const spawnProcess = options.spawnProcess ?? defaultSpawner;
  return {
    kind: "tmux",
    launch(input) {
      const bad = inputProblem(input);
      if (bad !== null) return refused(bad);
      const tsx = join(options.repoRoot, TSX_RELATIVE_PATH);
      if (!existsSync(tsx)) return refused(`${tsx} does not exist, so this checkout cannot run gjd-remote — nothing was started`);
      const stdinBytes = Buffer.concat([input.material.bytes, Buffer.from("\n", "utf8")]);
      if (stdinBytes.byteLength > GJD_REMOTE_MAX_PROMPT_BYTES) {
        return refused(`the prompt is ${stdinBytes.byteLength} bytes (${Math.round(stdinBytes.byteLength / 1024)}KB) and gjd-remote takes at most ${GJD_REMOTE_MAX_PROMPT_BYTES / 1024}KB — nothing was started`);
      }
      const stdinPath = join(input.artefactDir, LAUNCHER_STDIN_FILE);
      const fds: number[] = [];
      try {
        writeExclusive(stdinPath, stdinBytes);
        fds.push(openSync(stdinPath, "r"));
        fds.push(openSync(join(input.artefactDir, LAUNCHER_LOG_FILE), "a", 0o600));
      } catch (cause) {
        for (const fd of fds) closeSync(fd);
        return refused(`the launcher's own files could not be written, so gjd-remote was not run: ${messageOf(cause)}`);
      }
      const [stdinFd, logFd] = fds as [number, number];
      const args = [
        "scripts/gjd-remote.ts",
        "new-claude",
        input.correlationId,
        "--account",
        options.account ?? "auto",
        "--no-attach",
        "--launch-id",
        input.correlationId,
        "--launch-dir",
        input.artefactDir,
        "-p",
        "-",
      ];
      const spawned = spawnDetached(spawnProcess, tsx, args, { cwd: options.repoRoot, stdio: [stdinFd, logFd, logFd], detached: true }, fds, "gjd-remote");
      if (spawned.kind !== "spawned") return spawned;
      return { kind: "started", detail: `gjd-remote new-claude ${input.correlationId} (pid ${spawned.pid})` };
    },
  };
}

/* ------------------------------------------------------------------ *
 * headless: a wrapper, spawned directly.
 * ------------------------------------------------------------------ */

export type HeadlessLauncherOptions = {
  readonly repoRoot: string;
  readonly wrapper: WrapperName;
  /** Injected by tests. Nothing in production passes it. */
  readonly spawnProcess?: ChildSpawner;
};

/**
 * `<wrapper> --prompt-file <dir>/prompt.md --launch-dir <dir>` plus the run
 * spec's flags, and nothing else. The answer and the transcript take the
 * wrapper's `--launch-dir` defaults, in the attempt directory.
 */
export function headlessLauncher(options: HeadlessLauncherOptions): Launcher {
  const spawnProcess = options.spawnProcess ?? defaultSpawner;
  return {
    kind: "headless",
    launch(input) {
      const bad = inputProblem(input);
      if (bad !== null) return refused(bad);
      if (input.run === null) return refused("a headless launch needs a run spec, and this one has none — nothing was started");
      const tsx = join(options.repoRoot, TSX_RELATIVE_PATH);
      if (!existsSync(tsx)) return refused(`${tsx} does not exist, so this checkout cannot run ${options.wrapper} — nothing was started`);
      const material = writePrompt(input);
      if (!material.ok) return refused(material.why);
      let logFd: number;
      try {
        logFd = openSync(join(input.artefactDir, LAUNCHER_LOG_FILE), "a", 0o600);
      } catch (cause) {
        return refused(`the launcher's log could not be opened, so ${options.wrapper} was not run: ${messageOf(cause)}`);
      }
      const args = [`scripts/${options.wrapper}.ts`, "--prompt-file", material.path, "--launch-dir", input.artefactDir, ...wrapperRunArgs(options.wrapper, input.run)];
      const spawned = spawnDetached(spawnProcess, tsx, args, { cwd: options.repoRoot, stdio: ["ignore", logFd, logFd], detached: true }, [logFd], options.wrapper);
      if (spawned.kind !== "spawned") return spawned;
      return { kind: "started", detail: `${options.wrapper} --launch-dir ${input.artefactDir} (pid ${spawned.pid})` };
    },
  };
}

/* ------------------------------------------------------------------ *
 * tmux, run synchronously: the shared runner and the server check.
 * ------------------------------------------------------------------ */

/** One synchronous tmux command. Injectable, so every answer tmux can give is testable without a server. */
export type TmuxRun = (args: readonly string[]) => { readonly status: number | null; readonly stdout: string; readonly stderr: string; readonly error?: Error };

export type TmuxTarget = {
  /** An explicit socket (`-S`); the default server when absent. */
  readonly socket?: string;
  readonly tmux?: string;
  readonly timeoutMs?: number;
  /**
   * The tmux CLIENT's environment — and so a new session's. Measured on tmux 3.4 (2026-09-10, a
   * scratch socket): a session created by a second client took that client's PATH, not the
   * server's global one. This process's own environment when absent.
   */
  readonly env?: NodeJS.ProcessEnv;
};

export function tmuxRunner(target: TmuxTarget = {}): TmuxRun {
  return (args) => {
    const r = spawnSync(target.tmux ?? "tmux", [...(target.socket === undefined ? [] : ["-S", target.socket]), ...args], {
      encoding: "utf8",
      timeout: target.timeoutMs ?? 5000,
      stdio: ["ignore", "pipe", "pipe"],
      ...(target.env === undefined ? {} : { env: target.env }),
    });
    return r.error === undefined ? { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" } : { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error };
  };
}

/** "No server" in each of the words tmux 3.4 uses for it: no socket, or a socket nobody is listening on. */
const NO_SERVER = /no server running|error connecting to .*\((No such file or directory|Connection refused)\)/;
const SESSION_ID = /^\$\d+$/;

type ServerReading = { readonly kind: "running"; readonly sessions: readonly string[] } | { readonly kind: "none" } | { readonly kind: "cannot-tell"; readonly why: string };

function listSessions(run: TmuxRun): ServerReading {
  const r = run(["list-sessions", "-F", "#{session_id}"]);
  if (r.error !== undefined) return { kind: "cannot-tell", why: `tmux could not be run: ${r.error.message}` };
  if (r.status !== 0) return NO_SERVER.test(r.stderr) ? { kind: "none" } : { kind: "cannot-tell", why: `tmux list-sessions exited ${r.status}: ${r.stderr.trim() || "no output"}` };
  const sessions = r.stdout.split("\n").filter((line) => line !== "");
  // THE SHAPE IS CHECKED: a reply this was not written against is not a list of sessions.
  if (!sessions.every((one) => SESSION_ID.test(one))) return { kind: "cannot-tell", why: "tmux listed something that is not a session id" };
  return { kind: "running", sessions };
}

/** Create a session, and classify tmux's answer. ENOENT is a proven non-effect; any other failure may or may not have made a session, so it throws. */
function createSession(run: TmuxRun, args: readonly string[], name: string): LauncherAnswer {
  const r = run(args);
  if (r.error !== undefined) {
    if ((r.error as NodeJS.ErrnoException).code === "ENOENT") return refused(`tmux is not installed here: ${r.error.message} — nothing was started`);
    throw new Error(`tmux new-session did not answer (${r.error.message}); the session may or may not exist`);
  }
  if (r.status === 0) return { kind: "started", detail: `tmux session ${name}` };
  // A DUPLICATE NAME IS NOT A REFUSAL. tmux created nothing new, but the name
  // is this attempt's correlation id, so a session carrying it already exists:
  // refusing would release the reservation under a running session. It throws,
  // the attempt stays `launching`, and the tmux probe finds that session.
  throw new Error(`tmux new-session exited ${r.status}: ${r.stderr.trim() || "no output"}; a session may or may not exist, and reconciliation will look`);
}

/* ------------------------------------------------------------------ *
 * tmux-headless: run-claude in a session on the running server.
 * ------------------------------------------------------------------ */

export type TmuxHeadlessLauncherOptions = TmuxTarget & {
  /** The checkout whose `scripts/run-claude.ts` runs, and the session's working directory. */
  readonly repoRoot: string;
  /** The node that runs tsx: the daemon's own by default, named by path rather than found on a PATH. */
  readonly node?: string;
  /** Injected by tests. */
  readonly run?: TmuxRun;
};

/**
 * Unset at the top of a tmux-headless session's command: every variable that
 * picks a Claude or Codex account, or a credential for one.
 * tests/helpers/account-neutral-env.ts keeps the suite's own list, and a test
 * holds this one to at least that.
 */
export const SESSION_UNSET_VARIABLES = ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CODEX_API_KEY", "OPENAI_API_KEY"] as const;

/**
 * `tmux new-session -d -s <id> -e SPIDERYARN_LAUNCH_ID=… -e
 * SPIDERYARN_LAUNCH_DIR=… '<run-claude --prompt-file <dir>/prompt.md
 * --launch-dir <dir> --timeout-minutes N --access A --account H>'` — the id in
 * the session's environment at creation, never set afterwards, and every word
 * of the command through {@link shellQuote}. The prompt is the attempt-private
 * copy {@link writePrompt} makes of the verified bytes, never the shared
 * `material.txt`.
 *
 * **Nothing that routes an account crosses into the session.** The command
 * starts by unsetting {@link SESSION_UNSET_VARIABLES}: a session's variables
 * come from the tmux server's environment as well as the client's, so a daemon
 * routed by `CLAUDE_CONFIG_DIR` — or a server one started — would otherwise put
 * the run on that account. run-claude sets `CLAUDE_CONFIG_DIR` itself, from
 * the run spec's `--account`.
 *
 * **The session's environment is the CREATING CLIENT's — the daemon's own, or
 * `env` when given — not the tmux server's global one.** Measured, tmux 3.4:
 * a session created by a second client took that client's PATH. (The first
 * test of this adapter assumed the opposite, gave the SERVER a stand-in
 * `claude`, and the wrapper found the real one: a real, paid run.) So node is
 * named by path, PATH is only ever APPENDED to so the given order wins and
 * `claude` is still found where the box installs it, and a caller that needs a
 * particular environment passes it rather than relying on the server's.
 */
export function tmuxHeadlessLauncher(options: TmuxHeadlessLauncherOptions): Launcher {
  const run = options.run ?? tmuxRunner(options);
  return {
    kind: "tmux-headless",
    launch(input) {
      const bad = inputProblem(input);
      if (bad !== null) return refused(bad);
      if (input.run === null) return refused("a tmux-headless launch needs a run spec, and this one has none — nothing was started");
      const tsx = join(options.repoRoot, TSX_RELATIVE_PATH);
      if (!existsSync(tsx)) return refused(`${tsx} does not exist, so this checkout cannot run run-claude — nothing was started`);
      const server = listSessions(run);
      if (server.kind === "none") return refused("no tmux server is running; refusing to start one inside the daemon's own cgroup, where the next restart would kill it — nothing was started");
      if (server.kind === "cannot-tell") return refused(`cannot tell whether a tmux server is running (${server.why}) — nothing was started`);
      const material = writePrompt(input);
      if (!material.ok) return refused(material.why);
      const words = [options.node ?? process.execPath, tsx, join(options.repoRoot, "scripts", "run-claude.ts"), "--prompt-file", material.path, "--launch-dir", input.artefactDir, ...wrapperRunArgs("run-claude", input.run)];
      // The wrapper's console goes to the attempt's launcher.log: a session that exits takes its pane with it.
      const log = shellQuote(join(input.artefactDir, LAUNCHER_LOG_FILE));
      const command = [
        `unset ${SESSION_UNSET_VARIABLES.join(" ")}`,
        `export PATH="$PATH:/usr/local/bin:/usr/bin:/bin"`,
        `cd ${shellQuote(options.repoRoot)} || exit 1`,
        `exec ${words.map(shellQuote).join(" ")} >> ${log} 2>&1`,
      ].join("; ");
      return createSession(
        run,
        ["new-session", "-d", "-s", input.correlationId, "-e", `${LAUNCH_ID_VAR}=${input.correlationId}`, "-e", `${LAUNCH_DIR_VAR}=${input.artefactDir}`, command],
        input.correlationId,
      );
    },
  };
}

/* ------------------------------------------------------------------ *
 * The explicit-socket tmux launcher: the drill's and the tests'.
 * ------------------------------------------------------------------ */

export type SocketTmuxLauncherOptions = {
  /** A disposable socket. Never the default server. */
  readonly socket: string;
  /** What runs where Claude would: a command list, given the material plus a newline on stdin. */
  readonly command: string;
  readonly tmux?: string;
};

/**
 * A job script built from the SAME generated artefact lines gjd-remote's job
 * uses — `start.json` first, the command, the status saved, `exit.json` — run
 * as a session on an explicit socket, with the id and directory in `-e` at
 * creation. `-f /dev/null`, so a server it starts reads no one's config.
 */
export function socketTmuxLauncher(options: SocketTmuxLauncherOptions): Launcher {
  const run = tmuxRunner({ socket: options.socket, ...(options.tmux === undefined ? {} : { tmux: options.tmux }) });
  return {
    kind: "tmux",
    launch(input) {
      const bad = inputProblem(input);
      if (bad !== null) return refused(bad);
      const stdinPath = join(input.artefactDir, LAUNCHER_STDIN_FILE);
      const jobPath = join(input.artefactDir, JOB_FILE);
      const correlationId: CorrelationId = input.correlationId;
      const job = [
        "#!/usr/bin/env bash",
        startArtefactLine({ correlationId, dir: input.artefactDir, onFailure: "exit 1" }),
        `{ ${options.command}; } < ${shellQuote(stdinPath)}`,
        "_spya_status=$?",
        exitArtefactLine({ correlationId, dir: input.artefactDir, statusVar: "_spya_status", onFailure: `printf '%s\\n' 'could not write exit.json' >&2` }),
        'exit "$_spya_status"',
        "",
      ].join("\n");
      try {
        writeExclusive(stdinPath, Buffer.concat([input.material.bytes, Buffer.from("\n", "utf8")]));
        writeExclusive(jobPath, Buffer.from(job, "utf8"), 0o700);
      } catch (cause) {
        return refused(`the job could not be written, so no session was created: ${messageOf(cause)}`);
      }
      return createSession(
        run,
        ["-f", "/dev/null", "new-session", "-d", "-s", correlationId, "-e", `${LAUNCH_ID_VAR}=${correlationId}`, "-e", `${LAUNCH_DIR_VAR}=${input.artefactDir}`, `bash ${shellQuote(jobPath)}`],
        correlationId,
      );
    },
  };
}

/* ------------------------------------------------------------------ *
 * D7's tmux port.
 * ------------------------------------------------------------------ */

export type TmuxEvidenceOptions = TmuxTarget & { readonly run?: TmuxRun };

/**
 * `found` when a session's OWN environment carries this correlation id,
 * `absent` when no server is running or none does, `cannot-tell` for every way
 * of failing to look — which reconciliation never promotes to `absent`. The
 * global environment is not asked: a variable set there says nothing about
 * which session it belongs to.
 */
export function tmuxEvidence(options: TmuxEvidenceOptions = {}): (correlationId: CorrelationId) => TmuxReading {
  const run = options.run ?? tmuxRunner(options);
  return (correlationId) => {
    const listed = listSessions(run);
    if (listed.kind === "none") return { kind: "absent" };
    if (listed.kind === "cannot-tell") return { kind: "cannot-tell", why: listed.why };
    const want = `${LAUNCH_ID_VAR}=${correlationId}`;
    for (const sessionId of listed.sessions) {
      const r = run(["show-environment", "-t", sessionId, LAUNCH_ID_VAR]);
      if (r.error !== undefined) return { kind: "cannot-tell", why: `tmux could not be run: ${r.error.message}` };
      if (r.status === 0) {
        if (r.stdout.trim() === want) return { kind: "found", sessionId };
        continue;
      }
      // Not set in this session, or the session went away since the listing: not this one, and not running.
      if (/unknown variable|can't find session|no such session/.test(r.stderr)) continue;
      return { kind: "cannot-tell", why: `tmux show-environment -t ${sessionId} exited ${r.status}: ${r.stderr.trim() || "no output"}` };
    }
    return { kind: "absent" };
  };
}
