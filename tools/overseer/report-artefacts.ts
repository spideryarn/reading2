/**
 * **WHETHER WHAT A REPORT POINTS AT EXISTS** — checked once, at receipt, by the
 * daemon's drain. Plan 260910e, Stage 1.
 *
 * A reference to something that is not there is kept, with `not-found`: it is a
 * discrepancy Greg should see, not a reason to lose the claim. What this module
 * must never do is turn *could not look* into *not there* — a git that timed
 * out, or a record that could not be read, is `unchecked` with why, the same
 * line `artefact-ref.ts` draws.
 *
 * ## `on-dev` and `found-locally` are different facts (GPT Sol's WR-P6)
 *
 * `git cat-file -e` proves the object is in this checkout, not that GitHub has
 * it, and only `on-dev` gets a link. So a commit is checked as a commit, then for
 * ancestry of `origin/dev`; a path is looked up in `origin/dev`'s tree, then —
 * realpath and all, so a symlink cannot point the check outside the checkout —
 * as a regular file in the working tree.
 *
 * **Every git call is an argv**, never a shell, with a 2 s deadline. The inputs
 * have already passed `parseArtefactRef` (hex shas, paths of plain segments),
 * but an argv is what makes that belt rather than the braces.
 *
 * ## Git is awaited, through the process's one child owner (plan 261004g)
 *
 * This ran `execFileSync` until 2026-10-04. Its timeout sends one TERM and then
 * waits, so a git stuck on a lock held the daemon's only thread — heartbeat and
 * all — for as long as git liked. `ProbeOwner.run` releases the caller at the
 * deadline plus a short grace whether or not the child has died, and refuses to
 * start a second git while one is unaccounted for. The drain asks one reference
 * at a time, so the one key below is the whole of the exclusion, and a refusal
 * is `unchecked` like any other *could not look*.
 */
import { realpathSync, statSync } from "node:fs";
import path from "node:path";

import { untrustedTextProblem, type ArtefactCheck, type ArtefactRef } from "../fleet/artefact-ref.js";
import { processProbeOwner, type ProbeOwner } from "../fleet/child.js";
import { readDecisions } from "./decisions.js";
import { readQueue } from "./idea-queue.js";

const DEV = "refs/remotes/origin/dev";
const GIT_TIMEOUT_MS = 2_000;
const GIT_PROBE_KEY = "reports:artefact-git";

type GitResult =
  | { kind: "ok" }
  /** Git ran and said no, with its own words — which of the no's it was is in `stderr`. */
  | { kind: "no"; status: number; stderr: string }
  | { kind: "could-not-run"; why: string };

type GitRun = (args: readonly string[]) => Promise<GitResult>;

/** TEST SEAMS, all of them: production passes none and gets `git`, 2 s, and the process's shared owner. */
export type GitProbeOptions = { bin?: string; timeoutMs?: number; graceMs?: number; owner?: ProbeOwner };

/** One line of somebody else's words, short and clean enough to store in a `why`. */
function clip(text: string): string {
  const first = (text.split("\n").find((line) => line.trim() !== "") ?? "").trim();
  return [...first.slice(0, 120)].map((char) => (untrustedTextProblem(char, 1) === null ? char : "?")).join("");
}

function gitIn(repoDir: string, probe: GitProbeOptions = {}): GitRun {
  const timeoutMs = probe.timeoutMs ?? GIT_TIMEOUT_MS;
  return async (args) => {
    const outcome = await (probe.owner ?? processProbeOwner()).run({
      key: GIT_PROBE_KEY,
      cmd: probe.bin ?? "git",
      args,
      timeoutMs,
      cwd: repoDir,
      ...(probe.graceMs === undefined ? {} : { graceMs: probe.graceMs }),
    });
    switch (outcome.kind) {
      case "ok":
        return { kind: "ok" };
      case "failed":
        // GIT RAN AND SAID NO only when it exited by itself with a status. The
        // owner's sentence ends with git's stderr, whole, which is what the
        // callers' patterns read. No status, or a signal, is not an answer.
        if (outcome.exitCode !== null && outcome.signal === null) return { kind: "no", status: outcome.exitCode, stderr: outcome.why };
        return { kind: "could-not-run", why: `git could not be run here: ${clip(outcome.why)}` };
      case "timed-out":
        return { kind: "could-not-run", why: `git did not answer within its ${timeoutMs}ms deadline` };
      case "refused":
        return { kind: "could-not-run", why: "an earlier git check has not exited yet, so no second one was started" };
      case "overflowed":
        return { kind: "could-not-run", why: "git wrote more than a check should and was stopped" };
      default: {
        const never: never = outcome;
        throw new Error(String(never));
      }
    }
  };
}

async function checkCommit(git: GitRun, sha: string, stillWanted: () => boolean): Promise<ArtefactCheck> {
  const exists = await git(["cat-file", "-e", `${sha}^{commit}`]);
  if (exists.kind === "could-not-run") return { state: "unchecked", why: exists.why };
  if (exists.kind === "no") {
    if (/not a valid object name|bad object|does not exist/i.test(exists.stderr)) return { state: "not-found" };
    return { state: "unchecked", why: `git could not say whether ${sha} is a commit: ${clip(exists.stderr)}` };
  }
  // BETWEEN THE TWO CALLS, because the first was awaited: the daemon may have
  // lost its lock or been told to stop meanwhile, and a second git would be a
  // child started on the way out and a second deadline for the exit to wait on.
  // The drain discards this answer — it asks the same question when it resumes.
  if (!stillWanted()) return { state: "unchecked", why: "the daemon was stopping before this could be looked for on origin/dev" };
  const ancestor = await git(["merge-base", "--is-ancestor", sha, DEV]);
  if (ancestor.kind === "ok") return { state: "on-dev" };
  // Exit 1 is git's "no"; anything else (no origin/dev, say) is not an answer.
  if (ancestor.kind === "no" && ancestor.status === 1) return { state: "found-locally" };
  return {
    state: "unchecked",
    why:
      ancestor.kind === "could-not-run"
        ? ancestor.why
        : `the commit is here, but whether origin/dev contains it could not be read: ${clip(ancestor.stderr)}`,
  };
}

async function checkPath(git: GitRun, repoDir: string, relative: string): Promise<ArtefactCheck> {
  const onDev = await git(["cat-file", "-e", `${DEV}:${relative}`]);
  if (onDev.kind === "ok") return { state: "on-dev" };
  // "not in the tree" is an answer; "no origin/dev", or no git at all, is not.
  const devUnknown =
    onDev.kind === "could-not-run"
      ? onDev.why
      : /does not exist in|exists on disk, but not in/i.test(onDev.stderr)
        ? null
        : `origin/dev could not be read: ${clip(onDev.stderr)}`;
  try {
    const base = realpathSync(repoDir);
    const real = realpathSync(path.join(repoDir, relative));
    if ((real === base || real.startsWith(`${base}${path.sep}`)) && statSync(real).isFile()) {
      return devUnknown === null ? { state: "found-locally" } : { state: "unchecked", why: devUnknown };
    }
  } catch {
    /* Not in the working tree either. */
  }
  return devUnknown === null ? { state: "not-found" } : { state: "unchecked", why: devUnknown };
}

function checkDecision(root: string, id: string): ArtefactCheck {
  const read = readDecisions(root);
  if (read.kind === "never-written") return { state: "not-found" };
  if (read.kind === "unreadable") return { state: "unchecked", why: "the decision record could not be read" };
  return read.view.records.some((record) => record.id === id) ? { state: "found" } : { state: "not-found" };
}

function checkQueueItem(root: string, id: string): ArtefactCheck {
  const read = readQueue(root);
  if (read.kind === "never-written") return { state: "not-found" };
  if (read.kind === "unreadable") return { state: "unchecked", why: "the idea queue could not be read" };
  const known = [...read.view.items, ...read.view.settled].some((item) => item.id === id);
  return known ? { state: "found" } : { state: "not-found" };
}

/** The real checker the daemon's drain is given. `repoDir` is the checkout the daemon runs from. */
export function makeArtefactChecker(options: {
  repoDir: string;
  decisionsRoot: string;
  queueRoot: string;
  git?: GitProbeOptions;
}): (ref: ArtefactRef, stillWanted: () => boolean) => Promise<ArtefactCheck> {
  const git = gitIn(options.repoDir, options.git);
  return async (ref, stillWanted) => {
    switch (ref.kind) {
      case "commit":
        return checkCommit(git, ref.sha, stillWanted);
      case "path":
        return checkPath(git, options.repoDir, ref.path);
      case "decision":
        return checkDecision(options.decisionsRoot, ref.id);
      case "queue-item":
        return checkQueueItem(options.queueRoot, ref.id);
    }
  };
}
