/**
 * **Where the release lock lives, and whether a live process holds it.**
 *
 * One lock, three readers: `scripts/deploy.ts` takes it for a whole deploy,
 * `scripts/changelog/release-notes.ts` takes it for `prepare` and `promote`, and
 * `vitest-admission.ts` only *looks* at it, so that every other test run on the
 * box can make room while a deploy's own suite runs
 * (docs/plans/261010g-deploy-test-run-claims-the-box.md).
 *
 * Its own module, rather than a constant in `deploy-checks.ts`, because the
 * vitest config imports it on every run and must not drag the deploy's checks
 * (and their dependencies) in with it. Node built-ins and `lockfile.ts` only.
 *
 * **In the shared git directory**, `git rev-parse --git-common-dir`, which is the
 * primary's `.git` from every worktree — the readiness runner and the deploy's
 * own gate worktree included. One lock per worktree would let a worktree and the
 * primary deploy at once.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

import { isProcessAlive, readLockHolder, type LockHolder } from "./lockfile.js";

/**
 * The lock's file name, inside the shared git directory. Also held by
 * `release-notes.ts`, so that notes are never planned against a history that a
 * deploy finishing underneath them is about to promote onto (GPT Sol on 261001q,
 * round 2, finding 4).
 */
export const RELEASE_LOCK_FILE = "spideryarn-deploy.lock";

/** The lock's path for the checkout containing `cwd`. Throws when git cannot answer. */
export function releaseLockPath(cwd: string): string {
  const r = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd, encoding: "utf8" });
  const out = (r.stdout ?? "").trim();
  if (r.status !== 0 || out === "") {
    throw new Error(`git rev-parse --git-common-dir failed in ${cwd}: ${(r.stderr ?? r.error?.message ?? "").trim()}`);
  }
  return path.join(path.resolve(cwd, out), RELEASE_LOCK_FILE);
}

/**
 * Who holds the release lock right now, if the holder is still running.
 *
 * A leftover from a SIGKILLed deploy names a pid that is gone, and counts as
 * nobody — so a dead deploy cannot hold every later test run at one worker
 * until somebody deletes a file. (The deploy itself still refuses to start over
 * it; that decision is `takeLockFile`'s, and is unchanged.)
 */
export function liveReleaseLockHolder(
  file: string,
  isAlive: (pid: number) => boolean = isProcessAlive,
): LockHolder | null {
  const holder = readLockHolder(file);
  if (holder === null) return null;
  return isAlive(holder.pid) ? holder : null;
}
