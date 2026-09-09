/**
 * **How a due job becomes a Claude session on the box.**
 *
 * `scheduler.ts` decides *whether*; this decides *what actually happens*, and it
 * is the piece GPT Sol's C1 found missing — there was no `SpawnJob`
 * implementation anywhere outside the tests, so the engine had nothing to drive.
 *
 * The invocation is the one docs/project/overseer.md § Dispatching agents and
 * docs/project/feedback-reports.md § The run both name, and it is deliberately
 * the same one a person would type:
 *
 *     gjd-remote new-claude <name> --no-attach -p -      # the prompt on stdin
 *
 * `-p -` because the prompt then needs no shell quoting at all, `--no-attach`
 * because nothing here has a terminal to be handed.
 *
 * ## WHAT THE OCCURRENCE ACTUALLY MEASURES, said plainly
 *
 * `gjd-remote new-claude` **creates the session and returns**; the Claude
 * session it starts outlives it by hours. So the occurrence this file settles is
 * the *dispatch*, not the work: `exited 0` means a session was started, and says
 * nothing about whether the sweep it is running succeeded. The interval
 * therefore means "start one of these every three hours", and two sweeps CAN
 * overlap if one runs longer than its interval.
 *
 * That is the simplest thing that works, and the alternative — waiting on a tmux
 * session for six hours from inside the daemon — would put a long-lived promise
 * back in the loop whose whole design is not to hold one. What guards the
 * overlap instead is the job's own doc: the feedback sweep checks `gjd-remote
 * ls` for its claim prefix before dispatching anything, which is the register
 * that fails in the safe direction.
 *
 * ## Nothing here decides whether the scheduler runs at all
 *
 * That is `scripts/overseer.ts`, and it is off unless `OVERSEER_JOBS_ENABLED=1`.
 * This module is inert until somebody hands it to a daemon.
 */
import { spawn as spawnChild, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { JobOutcome, OccurrenceKey } from "./jobs.js";
import type { JobSpawn, SpawnJob } from "./jobs.js";

/** The env var that arms the scheduler. Named here so the CLI and the status page cannot disagree about it. */
export const JOBS_ENABLED_VAR = "OVERSEER_JOBS_ENABLED";

/** Same spirit as `FLEET_ACT_ENABLED`: exactly "1", nothing else, and off by default. */
export function jobsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[JOBS_ENABLED_VAR] === "1";
}

/** The checkout's own tsx, for the reason `infra/hetzner/systemd/overseer.service` gives: `npx` with no local install goes to the network and fetches SOME tsx. */
export const TSX_RELATIVE_PATH = join("node_modules", ".bin", "tsx");

/**
 * A tmux session name for one occurrence.
 *
 * `gjd-remote` refuses anything but lower-case letters, digits and hyphens, up
 * to 41 characters, and refuses a name that already exists — so the instant is
 * in it. **To the minute rather than the second**: two dispatches of one job a
 * minute apart would be a bug, and a collision refusing loudly is better than
 * two sweeps quietly running side by side.
 *
 * The job id leads, because docs/project/overseer.md's rule is *name a session
 * after what claims it* — a name is how a later run, or a person, tells whose
 * session this is.
 */
export function sessionName(key: OccurrenceKey): string {
  const at = new Date(key.scheduledAt);
  const stamp = Number.isNaN(at.getTime())
    ? "unknown"
    : `${String(at.getUTCMonth() + 1).padStart(2, "0")}${String(at.getUTCDate()).padStart(2, "0")}-${String(at.getUTCHours()).padStart(2, "0")}${String(at.getUTCMinutes()).padStart(2, "0")}`;
  return `${key.jobId}-${stamp}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 41);
}

/**
 * The subset of `child_process.spawn` this needs, so a test can watch the argv
 * and the stdin without starting anything.
 *
 * Narrow deliberately: a seam wide enough to pass arbitrary options is a seam
 * that lets a test prove something the real call would not do.
 */
export type ChildSpawner = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => {
  readonly pid?: number | undefined;
  readonly stdin: { end(text: string): void } | null;
  readonly stderr: { on(event: "data", listener: (chunk: unknown) => void): void } | null;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  on(event: "error", listener: (cause: Error) => void): void;
};

export type DispatchOptions = {
  /** The PRIMARY checkout, never a worktree — the same rule the systemd unit follows, and for the same reason. */
  readonly repoRoot: string;
  /** Injected by tests. Nothing in production passes it. */
  readonly spawnProcess?: ChildSpawner;
  /** Where gjd-remote's own stderr goes. A dispatch that failed is a sentence somebody has to be able to read. */
  readonly log?: (line: string) => void;
};

/**
 * A `SpawnJob` that starts one `gjd-remote new-claude` session per occurrence.
 *
 * **It returns `refused` rather than throwing wherever it can tell**, because
 * the two are different facts to the scheduler: `refused` is *this did not
 * start, and I know it*, which settles the occurrence; a throw is a runner that
 * broke its contract and produces `unknown`, which is never retried. A missing
 * `tsx` is knowable, so it is a refusal.
 */
export function gjdRemoteDispatch(options: DispatchOptions): SpawnJob {
  const spawnProcess: ChildSpawner = options.spawnProcess ?? ((command, args, spawnOptions) => spawnChild(command, [...args], spawnOptions));
  const log = options.log ?? ((line: string) => console.log(line));
  return (definition, key): JobSpawn => {
    const tsx = join(options.repoRoot, TSX_RELATIVE_PATH);
    if (!existsSync(tsx)) {
      return {
        kind: "refused",
        why: `${tsx} does not exist, so this checkout cannot run gjd-remote — nothing was started`,
      };
    }
    const name = sessionName(key);
    const args = ["scripts/gjd-remote.ts", "new-claude", name, "--no-attach", "-p", "-"];

    let child: ReturnType<ChildSpawner>;
    try {
      child = spawnProcess(tsx, args, { cwd: options.repoRoot, stdio: ["pipe", "ignore", "pipe"] });
    } catch (cause) {
      // The spawn ITSELF failing (EACCES, ENOENT past the check above) is
      // knowable: no process exists. A refusal, not an unknown.
      return { kind: "refused", why: `gjd-remote could not be started: ${cause instanceof Error ? cause.message : String(cause)}` };
    }

    const pid = child.pid;
    if (pid === undefined) {
      return { kind: "refused", why: "the child was created with no pid, which means it never started" };
    }

    // THE PROMPT DOWN STDIN, and the pipe closed straight after: `-p -` reads to
    // EOF, so a stdin left open is a gjd-remote that waits for ever and a job
    // that is `stuck` six hours later for no reason at all.
    child.stdin?.end(`${definition.behaviour.what}\n`);

    let stderr = "";
    child.stderr?.on("data", (chunk: unknown) => {
      // Bounded: a runaway child must not put the daemon's memory on the line.
      if (stderr.length < 4000) stderr += String(chunk);
    });

    const done = new Promise<JobOutcome>((resolve) => {
      child.on("exit", (code, signal) => {
        if (stderr.trim() !== "") log(`job ${definition.behaviour.id}: gjd-remote said: ${stderr.trim().slice(0, 2000)}`);
        if (code === null) {
          // Killed rather than exited. `failed` rather than an invented code —
          // a signal is not an exit status and the two must not share a slot.
          resolve({ kind: "failed", why: `gjd-remote was killed by ${signal ?? "an unknown signal"}` });
          return;
        }
        resolve({ kind: "exited", code });
      });
      child.on("error", (cause: Error) => {
        // An asynchronous spawn failure. It settles the occurrence rather than
        // rejecting, because we DO know what happened: no session was created.
        resolve({ kind: "failed", why: `gjd-remote could not be run: ${cause.message}` });
      });
    });

    log(`job ${definition.behaviour.id}: gjd-remote new-claude ${name} (pid ${pid})`);
    return { kind: "spawned", pid, done };
  };
}
