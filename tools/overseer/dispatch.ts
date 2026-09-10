/**
 * **The switch that arms the scheduler — and the two things the launchers
 * share.**
 *
 * This file used to hold `gjdRemoteDispatch`, the `SpawnJob` that started a
 * session job by running `gjd-remote new-claude … -p -` and recording the pid of
 * the short-lived launcher. That measured the dispatch, not the work: "finished,
 * exit 0" meant a tmux session had been created, and a daemon that died between
 * the spawn and `started` left nothing anybody could later reconcile.
 *
 * **Since plan 260910f (scheduled dispatch) a session job starts through the
 * launch protocol and nothing else**, on the `tmux-headless` launcher with a
 * pinned run spec and pinned material, and its result is observed from the
 * wrapper's own `exit.json`. The old dispatcher was deleted rather than left
 * beside the new path: two ways to start a session job is the thing that stage
 * removed.
 *
 * What stays is the arming switch, and `TSX_RELATIVE_PATH` and `ChildSpawner`,
 * which the protocol's launchers (`launchers.ts`) import.
 *
 * ## Nothing here decides whether the scheduler runs at all
 *
 * That is `scripts/overseer.ts`, and it is off unless `OVERSEER_JOBS_ENABLED=1`.
 */
import type { SpawnOptions } from "node:child_process";
import { join } from "node:path";

/** The env var that arms the scheduler. Named here so the CLI and the status page cannot disagree about it. */
export const JOBS_ENABLED_VAR = "OVERSEER_JOBS_ENABLED";

/** Same spirit as `FLEET_ACT_ENABLED`: exactly "1", nothing else, and off by default. */
export function jobsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[JOBS_ENABLED_VAR] === "1";
}

/** The checkout's own tsx, for the reason `infra/hetzner/systemd/overseer.service` gives: `npx` with no local install goes to the network and fetches SOME tsx. */
export const TSX_RELATIVE_PATH = join("node_modules", ".bin", "tsx");

/**
 * The subset of `child_process.spawn` a launcher needs, so a test can watch the
 * argv and the stdin without starting anything.
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
