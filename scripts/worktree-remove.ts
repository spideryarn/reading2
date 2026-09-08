/**
 * `npm run worktree:remove` — **the** way a worktree is removed here.
 *
 * ```
 * npm run worktree:remove                        # inside the worktree — this one
 * npm run worktree:remove -- --branch <name>     # from anywhere — that one
 * npm run worktree:remove -- --branch <name> --dry-run
 * ```
 *
 * One target, named or implied, and **no bulk form** — for the reason
 * `worktree-sweep.ts` already gives: a verdict must not be carried from an
 * earlier decision into a later deletion.
 *
 * Written after 2026-09-08, when the Overseer removed a finished worktree by
 * hand-typing `git worktree unlock`, `git worktree remove`, `git branch -d`. The
 * plan, the measurements and GPT Sol's review of them are in
 * docs/plans/260908k-a-deterministic-worktree-removal-command-and-a-ban-on-hand-typed-branch-deletion.md.
 *
 * ## Why hand-typed git was the only thing left
 *
 * `worktree:sweep -- remove` re-runs `classifyAll`, so it re-earns the 24-hour
 * age floor. Measured that night: **nine worktrees, nine refusals, "nothing to
 * remove."** The floor is a proxy for *is somebody still using this*, and it is
 * wrong in exactly one direction — it refuses the owner who has just finished.
 *
 * So the floor is not weakened. A **proof** is added beside it:
 * `scripts/worktree-inuse.ts` reads the owning session's `(pid, start)` out of the
 * worktree lock and looks for that exact pair in this process's ancestor chain.
 * When it is there, the owner itself is asking, and the floor is waived. When it
 * is not, the floor stands — because *no live process* is not the same fact as
 * *finished*, and `/proc` cannot see intent.
 *
 * ## Three things this file does that hand-typed git does not
 *
 * **A ghost is an ABSENT path, never a present one.** `ghosts()` in
 * `worktree-admin.ts` counts `!present || prunable`, and a ghost is removed with
 * `--force --force`. So a worktree whose directory is still there, full of files,
 * but whose `.git` link is broken, was force-deleted. Here, present-and-prunable
 * is `UNKNOWN` and names `git worktree repair`.
 *
 * **The landed proof is retaken after the removal, and includes the reflogs.**
 * `--is-ancestor` on the tip, taken during `gather()`, proves only that the tip
 * had landed *then*: a peer can resume the tree, commit, and leave it clean again
 * before the deletion. And a branch that once pointed at `U` and was moved back
 * passes a tip test while `U` survives only in the branch and worktree reflogs —
 * both of which removal is about to delete. So every reflog oid goes into the
 * proof, the worktree's own read **before** its directory goes.
 *
 * **The deletion is compare-and-swap.** `git branch -D` deletes whatever the ref
 * points at now. `git update-ref -d <ref> <expected-oid>` fails if it moved.
 *
 * ## And what it does when a step fails halfway
 *
 * A failed unlock **stops** — carrying on would remove a tree somebody locked for
 * a reason we could not read. A failed removal **restores the lock**, so a tree
 * that survives is not left less protected than it was found. And a branch left
 * orphaned by a removal whose deletion failed can be cleaned up by running this
 * command again with the same `--branch`: the orphan path re-earns the same fresh
 * proof. Without that, the hook banning `git branch -d` would leave a stuck state
 * with no sanctioned way out.
 */

import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";

import { TRUNK_BRANCH } from "./deploy-checks.js";
import { forceRemoveThrowawayWorktree, listWorktrees, type WorktreeEntry } from "./worktree-admin.js";
import { blockers, fetchTrunkSha, gather as checkGather, primaryRoot } from "./worktree-check.js";
import {
  ancestry,
  composeInUse,
  cwdUsersUnder,
  type InUse,
  ownerIsAsking,
  type OwnerStanding,
  ownerStanding,
  procTable,
} from "./worktree-inuse.js";

/** A worktree is never removable by a third party while it has been touched this recently. */
export const MIN_IDLE_HOURS = 24;

/* --------------------------------------------------------------- activity -- */

/** Which signal decided `lastActivity`, so a verdict can name its evidence. */
export interface Activity {
  at: number;
  /** Human-readable: "HEAD last moved", "git was last run here". */
  signal: string;
}

function tryGit(args: string[], cwd?: string): string | null {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return r.status === 0 ? `${r.stdout ?? ""}`.trim() : null;
}

/**
 * The reflog **entry's own timestamp**, in unix seconds — `null` if there is none.
 *
 * `git log -g --format=%ct` looks like the way to ask this and is not: `%ct` is
 * the *committer date of the commit the entry points at*. On a worktree created
 * this second from a month-old commit it returns the month-old date. `%gd` with
 * `--date=unix` prints `HEAD@{1788807113}`, which is the entry's own time.
 */
function reflogEntryAt(wt: string, ref: string): number | null {
  const out = tryGit(["log", "-g", "-1", "--date=unix", "--format=%gd", ref], wt);
  const at = out === null ? null : /@\{(\d+)\}/.exec(out);
  if (at?.[1] === undefined) return null;
  const n = Number.parseInt(at[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * When this tree was last touched: the **latest** of three independent signals,
 * because each one alone reports a live worktree as long idle.
 *
 * - **The HEAD reflog entry** — the only one that moves on a fast-forward, which
 *   writes no commit.
 * - **The branch reflog entry**, which `git update-ref` from elsewhere moves
 *   without touching this worktree's HEAD reflog.
 * - **The admin directory's mtime** — crude, and kept because it is crude and
 *   independent: a reflog entry inherits `GIT_COMMITTER_DATE` and can be
 *   backdated; an mtime cannot.
 *
 * `null` only when all three fail, which is itself a keep.
 */
export function lastActivityAt(wt: string, branch: string | undefined): Activity | null {
  const seen: Activity[] = [];

  const head = reflogEntryAt(wt, "HEAD");
  if (head !== null) seen.push({ at: head, signal: "HEAD last moved" });

  if (branch !== undefined) {
    const onBranch = reflogEntryAt(wt, branch);
    if (onBranch !== null) seen.push({ at: onBranch, signal: `${branch} last moved` });
  }

  const adminDir = tryGit(["rev-parse", "--absolute-git-dir"], wt);
  if (adminDir !== null) {
    try {
      seen.push({ at: Math.floor(statSync(adminDir).mtimeMs / 1000), signal: "git was last run here" });
    } catch {
      /* Gone or unreadable; the other signals stand, and no signal is a keep. */
    }
  }

  return seen.reduce<Activity | null>((best, s) => (best === null || s.at > best.at ? s : best), null);
}

export function describeIdle(hours: number): string {
  if (hours < 0) return "in the future";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  return `${hours.toFixed(1)} h`;
}

/* ------------------------------------------------------------ registration -- */

export type Registration =
  /** Not a candidate, ever. */
  | { kind: "skip"; why: string }
  /** The directory is gone. Removable, and it owns no work. */
  | { kind: "ghost" }
  /** A live worktree. */
  | { kind: "live" }
  /**
   * The directory is THERE and git calls it prunable — a broken admin link over
   * a tree that may be full of files. Emphatically not a ghost.
   */
  | { kind: "unknown"; why: string; fix: string };

/**
 * What kind of registration this is, before anything is read out of the tree.
 *
 * **The split between `ghost` and `unknown` is the point.** `worktree-admin.ts`'s
 * `ghosts()` and the sweep's `classifyOne` both fold `prunable` in with "the
 * directory is missing", and a ghost is unregistered with `--force --force`,
 * which git documents as discarding modified and untracked files. A prunable
 * registration whose directory still exists is the one case where those two
 * flags meet real files.
 */
export function classifyRegistration(entry: WorktreeEntry): Registration {
  if (entry.main) return { kind: "skip", why: "the primary checkout" };
  if (entry.bare) return { kind: "skip", why: "a bare entry, which has no working tree" };
  if (!entry.present) return { kind: "ghost" };
  if (entry.prunable) {
    return {
      kind: "unknown",
      why: `git calls this registration prunable, but ${entry.path} is still there — its admin link is broken, not its directory`,
      fix: `git worktree repair ${entry.path}   # then run this again`,
    };
  }
  return { kind: "live" };
}

/* ------------------------------------------------------------------ proof -- */

/** Every oid this branch is known to have pointed at, tip and reflogs alike. */
export function reachableOids(cwd: string, branch: string, worktreePath: string | null): string[] {
  const oids = new Set<string>();

  const tip = tryGit(["rev-parse", "--verify", `refs/heads/${branch}`], cwd);
  if (tip !== null) oids.add(tip);

  /* The branch's own reflog: every commit this ref has pointed at. */
  const branchLog = tryGit(["reflog", "show", "--format=%H", `refs/heads/${branch}`], cwd);
  for (const line of (branchLog ?? "").split("\n")) if (line.trim() !== "") oids.add(line.trim());

  /* The worktree's HEAD reflog lives in `.git/worktrees/<name>/logs/HEAD` and is
     deleted along with the worktree, so it MUST be read before removal. It is the
     only record of a commit reached by a detached checkout in there. */
  if (worktreePath !== null) {
    const headLog = tryGit(["reflog", "show", "--format=%H", "HEAD"], worktreePath);
    for (const line of (headLog ?? "").split("\n")) if (line.trim() !== "") oids.add(line.trim());
  }

  return [...oids];
}

export type LandedProof =
  | { kind: "landed" }
  | { kind: "not-landed"; count: number }
  | { kind: "cannot-tell"; why: string };

/**
 * **Has everything these oids name already landed on the trunk?**
 *
 * One `rev-list`, not one `merge-base` per oid: the question is "how many commits
 * are reachable from any of these and not from the trunk", and git answers it in
 * a single walk. `--ignore-missing` because a reflog can name a commit that has
 * already been garbage-collected, and a missing object is not an unlanded one.
 *
 * A failure to answer is `cannot-tell`, which leaves the branch alone. This is the
 * last guard before a deletion, so it does not get to shrug in the permissive
 * direction.
 */
export function landedProof(cwd: string, oids: readonly string[], trunkSha: string): LandedProof {
  if (oids.length === 0) return { kind: "cannot-tell", why: "no commits could be read for this branch" };
  const r = spawnSync("git", ["rev-list", "--ignore-missing", "--count", ...oids, "--not", trunkSha], {
    cwd,
    encoding: "utf8",
  });
  if (r.status !== 0) return { kind: "cannot-tell", why: `git rev-list failed: ${`${r.stderr ?? ""}`.trim()}` };
  const count = Number.parseInt(`${r.stdout ?? ""}`.trim(), 10);
  if (!Number.isFinite(count)) return { kind: "cannot-tell", why: `git rev-list printed ${`${r.stdout ?? ""}`.trim()}` };
  return count === 0 ? { kind: "landed" } : { kind: "not-landed", count };
}

/**
 * Delete the ref only if it still points where we proved.
 *
 * `git branch -D` deletes whatever is there now. `update-ref -d <ref> <old>` is
 * the compare-and-swap, and it is the difference between "the branch we proved"
 * and "the branch that happens to have this name".
 */
export function deleteRefIfUnmoved(cwd: string, branch: string, expected: string): { ok: boolean; why: string } {
  const r = spawnSync("git", ["update-ref", "-d", `refs/heads/${branch}`, expected], { cwd, encoding: "utf8" });
  if (r.status === 0) return { ok: true, why: `deleted branch ${branch} (was ${expected.slice(0, 8)})` };
  return { ok: false, why: `left branch ${branch}: ${`${r.stderr ?? ""}${r.stdout ?? ""}`.trim()}` };
}

/* --------------------------------------------------------------- liveness -- */

export interface Liveness {
  standing: OwnerStanding;
  inUse: InUse;
  /** The owner itself asked for this, proved by its `(pid,start)` in our ancestry. */
  authorised: boolean;
}

/**
 * The two signals, read for one tree.
 *
 * `pid` is injected so a test can arrange an ancestor chain; in production it is
 * this process. No `/proc` at all — the Mac — is an `unknown`, which costs the
 * caller the age floor and is exactly today's behaviour there.
 */
export function liveness(worktreePath: string, lockReason: string | undefined, pid = process.pid): Liveness {
  const proc = procTable();
  if (proc === null) {
    const standing: OwnerStanding = lockReason === undefined ? { kind: "unlocked" } : { kind: "unrecognised", reason: lockReason };
    return {
      standing,
      inUse: { kind: "unknown", why: ["this platform has no /proc, so nothing could be checked for running processes"] },
      authorised: false,
    };
  }
  const chain = ancestry(proc, pid);
  const standing = ownerStanding(proc, lockReason, chain);
  const scan = cwdUsersUnder(proc, worktreePath, new Set(chain.map((a) => a.pid)));
  return { standing, inUse: composeInUse(standing, scan), authorised: ownerIsAsking(standing) };
}

/* --------------------------------------------------------------- removal -- */

export interface RemoveOptions {
  dryRun?: boolean;
  /** Unix seconds. Injected so the age floor is testable. */
  now?: number;
  minIdleHours?: number;
  /** The asking process, injected so ancestry can be arranged in a test. */
  pid?: number;
}

export interface RemoveOutcome {
  ok: boolean;
  /** Everything checked and everything done, in order, for printing. */
  steps: string[];
}

function shortBranch(ref: string | undefined): string | undefined {
  if (ref === undefined) return undefined;
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

/** The worktree the process is standing in, resolved the way git reports paths. */
function currentToplevel(cwd: string): string | null {
  const top = tryGit(["rev-parse", "--show-toplevel"], cwd);
  return top === null ? null : path.resolve(top);
}

function refExists(cwd: string, branch: string): string | null {
  return tryGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], cwd);
}

/**
 * Remove one worktree, or clean up one orphaned `worktree-*` branch.
 *
 * Every refusal returns `ok: false` with the reasons in `steps`; every check that
 * passed is in `steps` too, so the output says what was looked at rather than only
 * what went wrong.
 */
export function removeWorktree(cwd: string, wanted: string | undefined, opts: RemoveOptions = {}): RemoveOutcome {
  const steps: string[] = [];
  const dryRun = opts.dryRun === true;
  const primary = primaryRoot(cwd);
  const entries = listWorktrees(cwd);

  /* --- 1. which tree? ------------------------------------------------- */
  let entry: WorktreeEntry | undefined;
  if (wanted === undefined) {
    const here = currentToplevel(cwd);
    entry = entries.find((e) => here !== null && path.resolve(e.path) === here);
    if (entry === undefined) {
      steps.push("could not tell which worktree you are in; name one with --branch <name>");
      return { ok: false, steps };
    }
    if (entry.main) {
      steps.push("refused: you are in the primary checkout, which is not a worktree");
      steps.push("  name the one you mean: npm run worktree:remove -- --branch <name>");
      return { ok: false, steps };
    }
  } else {
    entry = entries.find((e) => shortBranch(e.branch) === wanted);
  }

  const branch = entry === undefined ? wanted : shortBranch(entry.branch);

  /* --- 1b. an orphaned branch with no worktree ------------------------ */
  if (entry === undefined) {
    if (wanted === undefined) {
      steps.push("no worktree and no --branch: nothing to do");
      return { ok: false, steps };
    }
    if (refExists(primary, wanted) === null) {
      steps.push(`no worktree is on branch ${wanted}, and no such branch exists`);
      return { ok: false, steps };
    }
    steps.push(`no worktree is on branch ${wanted} — treating it as an orphaned branch`);
    return { ...finishBranch(primary, wanted, null, steps, dryRun), steps };
  }

  /* --- 2. what kind of registration is it? ---------------------------- */
  const reg = classifyRegistration(entry);
  if (reg.kind === "skip") {
    steps.push(`refused: ${reg.why}`);
    return { ok: false, steps };
  }
  if (reg.kind === "unknown") {
    steps.push(`refused: ${reg.why}`);
    steps.push(`  ${reg.fix}`);
    return { ok: false, steps };
  }
  if (reg.kind === "ghost") {
    steps.push(`the directory at ${entry.path} is gone; this is a stale registration`);
    if (dryRun) {
      steps.push(`would unregister it, and would leave branch ${branch ?? "(none)"} alone`);
      return { ok: true, steps };
    }
    const r = forceRemoveThrowawayWorktree(entry.path, primary);
    steps.push(r.ok ? `unregistered the ghost at ${entry.path}` : `FAILED to unregister ${entry.path}: ${r.out}`);
    steps.push(`left branch ${branch ?? "(none)"} alone — the tree is gone, but its commits are not this command's to judge`);
    return { ok: r.ok, steps };
  }

  /* --- 3. a fresh trunk, once, as a sha ------------------------------- */
  const trunk = fetchTrunkSha(primary);
  if (trunk.kind === "failed") {
    steps.push(`refused: ${trunk.why}`);
    steps.push("  a stale remote-tracking ref answers a question about an hour ago");
    return { ok: false, steps };
  }
  steps.push(`ok   fetched origin/${TRUNK_BRANCH} — ${trunk.sha.slice(0, 8)}`);

  /* --- 4. would deleting this directory lose anything? ---------------- */
  let found: ReturnType<typeof blockers>;
  try {
    found = blockers(checkGather(entry.path, trunk.sha));
  } catch (err) {
    steps.push(`refused: worktree:check could not judge this tree: ${(err as Error).message}`);
    return { ok: false, steps };
  }
  if (found.length > 0) {
    steps.push(`refused, re-checked just now — ${found.length} blocker${found.length === 1 ? "" : "s"}:`);
    for (const b of found) {
      steps.push(`  FAIL ${b.why}`);
      for (const d of b.detail) steps.push(`       ${d}`);
    }
    return { ok: false, steps };
  }
  steps.push("ok   nothing here that is not also on the trunk (npm run worktree:check's whole judgement)");

  /* --- 5/6. is anybody using it, and did its owner ask? --------------- */
  const live = liveness(entry.path, entry.lockReason, opts.pid ?? process.pid);
  if (live.inUse.kind === "in-use") {
    steps.push("refused: this worktree is in use");
    for (const r of live.inUse.reasons) steps.push(`  ${r}`);
    return { ok: false, steps };
  }
  if (live.authorised) steps.push("ok   its own session is asking — the 24h floor does not apply");
  else if (live.inUse.kind === "idle") for (const n of live.inUse.notes) steps.push(`ok   ${n}`);

  /* --- 7. the age floor, for everybody but the owner ------------------ */
  if (!live.authorised) {
    if (live.inUse.kind === "unknown") for (const w of live.inUse.why) steps.push(`·    could not check: ${w}`);
    const minIdle = opts.minIdleHours ?? MIN_IDLE_HOURS;
    const activity = lastActivityAt(entry.path, branch);
    if (activity === null) {
      steps.push("refused: could not tell when this tree was last active");
      return { ok: false, steps };
    }
    const now = opts.now ?? Math.floor(Date.now() / 1000);
    const idleHours = (now - activity.at) / 3600;
    if (idleHours < minIdle) {
      steps.push(`refused: ${activity.signal} ${describeIdle(idleHours)} ago — under the ${minIdle}h floor`);
      steps.push("  nothing running in it is not the same as finished. Either its own session removes it,");
      steps.push(`  or it waits out the floor. See docs/project/worktrees.md § Removing one.`);
      return { ok: false, steps };
    }
    steps.push(`ok   ${activity.signal} ${describeIdle(idleHours)} ago — over the ${minIdle}h floor`);
  }

  /* --- 8. the proof, read while the worktree still exists ------------- */
  const oids = branch === undefined ? [] : reachableOids(primary, branch, entry.path);
  const tip = branch === undefined ? null : refExists(primary, branch);

  if (dryRun) {
    steps.push(`would remove ${entry.path}`);
    steps.push(
      branch === undefined
        ? "  detached HEAD — there would be no branch to delete"
        : `  and would prove and delete branch ${branch} (${oids.length} oid${oids.length === 1 ? "" : "s"} in the proof)`,
    );
    return { ok: true, steps };
  }

  /* --- 9. unlock, stopping if we cannot -------------------------------- */
  const originalLock = entry.lockReason;
  if (entry.locked) {
    const un = spawnSync("git", ["worktree", "unlock", entry.path], { cwd: primary, encoding: "utf8" });
    if (un.status !== 0) {
      steps.push(`refused: could not unlock ${entry.path}: ${`${un.stderr ?? ""}`.trim()}`);
      return { ok: false, steps };
    }
    steps.push(`unlocked ${entry.path}${originalLock === undefined ? "" : ` (was: ${originalLock})`}`);
  }

  /* --- 10. git's own judgement, on its own terms ----------------------- */
  const rm = spawnSync("git", ["worktree", "remove", entry.path], { cwd: primary, encoding: "utf8" });
  if (rm.status !== 0) {
    steps.push(`refused by git: ${`${rm.stdout ?? ""}${rm.stderr ?? ""}`.trim()}`);
    if (entry.locked && originalLock !== undefined) {
      const re = spawnSync("git", ["worktree", "lock", "--reason", originalLock, entry.path], {
        cwd: primary,
        encoding: "utf8",
      });
      steps.push(re.status === 0 ? "restored the lock" : `could NOT restore the lock: ${`${re.stderr ?? ""}`.trim()}`);
    }
    return { ok: false, steps };
  }
  steps.push(`removed ${entry.path}`);

  /* --- 11. and only now, the branch ------------------------------------ */
  if (branch === undefined) {
    steps.push("detached HEAD — no branch to delete");
    return { ok: true, steps };
  }
  return { ...finishBranch(primary, branch, { oids, tip, trunkSha: trunk.sha }, steps, false), steps };
}

/**
 * Prove and delete a branch. Shared by the ordinary path and the orphan one, so
 * the orphan cleanup cannot drift into a weaker check than the removal's.
 *
 * `pre` is what was read before the worktree went; `null` means there was no
 * worktree, so the trunk is fetched here instead.
 */
function finishBranch(
  primary: string,
  branch: string,
  pre: { oids: string[]; tip: string | null; trunkSha: string } | null,
  steps: string[],
  dryRun: boolean,
): { ok: boolean } {
  let oids: string[];
  let tip: string | null;
  let trunkSha: string;

  if (pre === null) {
    const trunk = fetchTrunkSha(primary);
    if (trunk.kind === "failed") {
      steps.push(`refused: ${trunk.why}`);
      return { ok: false };
    }
    steps.push(`ok   fetched origin/${TRUNK_BRANCH} — ${trunk.sha.slice(0, 8)}`);
    trunkSha = trunk.sha;
    oids = reachableOids(primary, branch, null);
    tip = refExists(primary, branch);
  } else {
    ({ oids, tip } = pre);
    trunkSha = pre.trunkSha;
  }

  if (tip === null) {
    steps.push(`branch ${branch} does not exist — nothing to delete`);
    return { ok: true };
  }

  /* Retaken here, not re-read from the earlier gather: a peer can commit to this
     branch between that check and this deletion. */
  const proof = landedProof(primary, oids, trunkSha);
  if (proof.kind === "cannot-tell") {
    steps.push(`left branch ${branch}: could not prove it landed — ${proof.why}`);
    return { ok: false };
  }
  if (proof.kind === "not-landed") {
    steps.push(
      `left branch ${branch}: ${proof.count} commit${proof.count === 1 ? "" : "s"} it has pointed at are not on origin/${TRUNK_BRANCH}`,
    );
    steps.push("  the tip and every reflog entry are in that count — a branch that was moved back still counts");
    return { ok: false };
  }
  steps.push(`ok   every commit ${branch} has pointed at (${oids.length} checked) is on origin/${TRUNK_BRANCH}`);

  if (dryRun) {
    steps.push(`would delete branch ${branch}`);
    return { ok: true };
  }

  const del = deleteRefIfUnmoved(primary, branch, tip);
  steps.push(del.why);
  return { ok: del.ok };
}

/* ------------------------------------------------------------------- cli -- */

function isMain(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && path.resolve(entry).endsWith(path.join("scripts", "worktree-remove.ts"));
}

if (isMain()) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--branch");
  const named = at === -1 ? undefined : argv[at + 1];

  if (at !== -1 && (named === undefined || named.startsWith("--"))) {
    console.log("\nusage: npm run worktree:remove [-- --branch <name>] [--dry-run]");
    console.log("with no --branch it removes the worktree you are standing in.\n");
    process.exit(2);
  }

  /* Both read BEFORE the removal. Afterwards `process.cwd()` throws ENOENT when
     you removed the tree you were standing in, which is the case this message is
     for — computing the path to suggest would fail exactly when it is needed. */
  const here = process.cwd();
  const primaryHere = primaryRoot(here);

  const out = removeWorktree(here, named, { dryRun: argv.includes("--dry-run") });
  console.log("");
  for (const s of out.steps) console.log(`  ${s}`);
  console.log("");
  if (out.ok && named === undefined && !argv.includes("--dry-run")) {
    console.log("  Your shell is now in a directory that no longer exists.");
    console.log(`  cd ${primaryHere} — or, from a Claude session, ExitWorktree({action: "keep"}).\n`);
  }
  process.exit(out.ok ? 0 : 1);
}
