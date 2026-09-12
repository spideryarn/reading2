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
 * ## Anybody may remove a finished tree, on the same evidence
 *
 * > If they are finished successfully and safe to remove, it's fine to do so
 * > immediately. — Greg, 2026-09-12
 *
 * There was a 24-hour age floor here for third parties, waived only for the
 * tree's own session, and it went on 2026-09-12. What it stood in for — *is
 * somebody still using this?* — is asked directly by `scripts/worktree-inuse.ts`:
 * a live session named in the lock, or a process with its cwd inside, refuses,
 * and a question it cannot answer refuses too. The ownership proof survives for
 * one reason only: without it, a session removing its own tree would be vetoed
 * by its own live pid in the lock. Plan, and what the floor's removal gives up:
 * docs/plans/260912a-drop-the-worktree-removal-age-floor.md.
 *
 * ## Three things this file does that hand-typed git does not
 *
 * **A ghost is an ABSENT path, it gets the same proof as a live tree, and nothing
 * here ever passes `--force`.** `ghosts()` in `worktree-admin.ts` counts
 * `!present || prunable` and unregisters with `--force --force`; a *present*
 * prunable registration is a broken admin link over what may be a full directory,
 * so that is `UNKNOWN` here and names `git worktree repair`.
 *
 * The removal itself went the long way round. Dropping `--force` protected an
 * unrelated replacement directory but not the original tree moved back. Switching
 * to `git worktree prune` revalidated at the moment it acted — and takes no path,
 * so clearing one ghost deleted **another** ghost's `.git/worktrees/<name>` and
 * with it the only reflog naming a detached commit. Both reproduced by GPT Sol.
 * So: **scoped** `git worktree remove`, which touches no other registration's
 * metadata, plus the thing no earlier version did — **read the gone tree's HEAD
 * reflog and prove it**, because the directory is gone and the metadata is not.
 *
 * **The landed proof is COMPLETE before anything is destroyed, and it includes
 * the reflogs.** `--is-ancestor` on the tip proves only that the tip has landed:
 * a branch that once pointed at `U` and was moved back passes it while `U`
 * survives only in the branch and worktree reflogs. `git worktree remove` deletes
 * the worktree's HEAD reflog — measured, a detached commit made in there is named
 * by `git reflog --all` before the removal and by nothing after it. So proving
 * *after* the removal is not carefulness, it is announcing a loss you have
 * already caused; the proof runs first, and a refusal costs nothing.
 *
 * The branch deletion then re-reads the branch reflog and re-proves, because a
 * peer can move a branch away and back between the two, leaving the tip equal and
 * the reflog longer.
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
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { TRUNK_BRANCH } from "./deploy-checks.js";
import { listWorktrees, type WorktreeEntry } from "./worktree-admin.js";
import { blockers, fetchTrunkSha, gather as checkGather, primaryRoot } from "./worktree-check.js";
import {
  ancestry,
  classifyPidNamespace,
  composeInUse,
  cwdUsersUnder,
  type InUse,
  type OwnerStanding,
  ownerStanding,
  type ProcTable,
  procTable,
} from "./worktree-inuse.js";

function tryGit(args: string[], cwd?: string): string | null {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return r.status === 0 ? `${r.stdout ?? ""}`.trim() : null;
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

export type Oids =
  | { kind: "ok"; oids: string[] }
  /** A source could not be read. Never "we read it and it was empty". */
  | { kind: "cannot-tell"; why: string };

/**
 * Every oid this worktree and its branch are known to have pointed at.
 *
 * **The worktree's own HEAD reflog is the reason this is not just the tip.** It
 * lives in `.git/worktrees/<name>/logs/HEAD` and `git worktree remove` deletes
 * it — measured: a detached commit made in a worktree and then checked away from
 * is named by `git reflog --all` before the removal and by nothing at all after
 * it, surviving only as an unreachable object awaiting gc. So it is collected
 * here, and the proof that uses it runs **before** anything is destroyed.
 *
 * **A read that fails is `cannot-tell`, not an empty list.** The first version
 * folded every failure into `?? ""`, so a `reflog show` that errored was
 * indistinguishable from a branch that had never moved — and the difference is
 * the whole guard.
 *
 * The one degradation it cannot see: with `core.logAllRefUpdates=false`, or after
 * reflog expiry, `reflog show` succeeds and returns nothing, and this correctly
 * reports what it read. The promise is then "every commit named by the tip and by
 * the reflogs that exist", which is what the caller prints — not "everything it
 * ever pointed at", which no amount of care can establish from a repo that did
 * not record it.
 */
export function reachableOids(cwd: string, branch: string | undefined, worktreePath: string | null): Oids {
  const oids = new Set<string>();

  if (branch !== undefined) {
    const tip = tryGit(["rev-parse", "--verify", `refs/heads/${branch}`], cwd);
    if (tip === null) return { kind: "cannot-tell", why: `could not read the tip of ${branch}` };
    oids.add(tip);

    const branchLog = tryGit(["reflog", "show", "--format=%H", `refs/heads/${branch}`], cwd);
    if (branchLog === null) return { kind: "cannot-tell", why: `could not read the reflog of ${branch}` };
    for (const line of branchLog.split("\n")) if (line.trim() !== "") oids.add(line.trim());
  }

  if (worktreePath !== null) {
    const headLog = tryGit(["reflog", "show", "--format=%H", "HEAD"], worktreePath);
    if (headLog === null) return { kind: "cannot-tell", why: `could not read the HEAD reflog of ${worktreePath}` };
    for (const line of headLog.split("\n")) if (line.trim() !== "") oids.add(line.trim());
  }

  return { kind: "ok", oids: [...oids] };
}

export type LandedProof =
  | { kind: "landed"; checked: number }
  | { kind: "not-landed"; count: number }
  | { kind: "cannot-tell"; why: string };

/**
 * **Has everything these oids name already landed on the trunk?**
 *
 * One `rev-list`, not one `merge-base` per oid: the question is "how many commits
 * are reachable from any of these and not from the trunk", and git answers it in
 * a single walk. Measured: all-landed gives 0, one unlanded gives 1.
 *
 * **No `--ignore-missing`, and that is a correction.** The first version passed
 * it, and its documented meaning is to pretend an invalid object was never
 * supplied — measured, a landed oid plus a nonexistent one returns count 0, exit
 * 0. So a corrupt or missing object read out of a reflog would have proved
 * "landed" and deleted the branch. Without the flag, git says `fatal: bad
 * object`, this returns `cannot-tell`, and the branch is left alone. The cost is
 * that a genuinely damaged repository stops auto-deleting branches, which is the
 * direction to fail in.
 *
 * A failure to answer is `cannot-tell`. This is the last guard before a deletion,
 * so it does not get to shrug in the permissive direction.
 */
export function landedProof(cwd: string, oids: readonly string[], trunkSha: string): LandedProof {
  if (oids.length === 0) return { kind: "cannot-tell", why: "no commits could be read for this branch" };
  const r = spawnSync("git", ["rev-list", "--count", ...oids, "--not", trunkSha], { cwd, encoding: "utf8" });
  if (r.status !== 0) return { kind: "cannot-tell", why: `git rev-list failed: ${`${r.stderr ?? ""}`.trim()}` };
  const count = Number.parseInt(`${r.stdout ?? ""}`.trim(), 10);
  if (!Number.isFinite(count)) return { kind: "cannot-tell", why: `git rev-list printed ${`${r.stdout ?? ""}`.trim()}` };
  return count === 0 ? { kind: "landed", checked: oids.length } : { kind: "not-landed", count };
}

/**
 * Delete the ref only if it still points where we proved.
 *
 * `git branch -D` deletes whatever is there now; `update-ref -d <ref> <old>` is
 * the compare-and-swap.
 *
 * **The residual race, stated rather than glossed.** A CAS on the tip cannot see
 * an A→B→A: a peer that moved the branch away and back leaves the tip equal and
 * the reflog longer. That is why the caller re-collects the reflog and re-proves
 * immediately before calling this — so a peer's excursion is caught by the reflog
 * even though the tip looks untouched. What remains is the gap between that final
 * read and this call: two adjacent process spawns, in which a peer would have to
 * move a branch whose worktree has just been removed, twice. Closing it properly
 * needs an `update-ref --stdin` transaction held open across the re-read, which
 * means an async child process in an otherwise synchronous script; that was
 * weighed and not built. GPT Sol raised it, 2026-09-09.
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
}

/**
 * The two signals, read for one tree — and, when `/proc` is the host process
 * table, the whole of what stands between a peer's five-minute-old tree and a
 * removal now that there is no age floor.
 *
 * `pid` is injected so a test can arrange an ancestor chain; in production it is
 * this process. The owner's `(pid,start)` in that chain is what makes its own
 * live lock read as `asking` rather than as a live session in the way.
 *
 * No `/proc` at all — the Mac — is an `unknown`, and an unknown refuses: on the
 * Mac this command removes ghosts and orphaned branches, never a live tree. So
 * is a `/proc` that is not the whole box — a private PID namespace, where a live
 * owner is not unreadable but absent, and would read as stale
 * (`classifyPidNamespace`; GPT Sol's first finding on 260912a).
 *
 * `proc` is injectable so a test can arrange a namespace; an unprivileged
 * `unshare` is refused on the box.
 */
export function liveness(
  worktreePath: string,
  lockReason: string | undefined,
  pid = process.pid,
  proc: ProcTable | null = procTable(),
): Liveness {
  const unmeasured = (why: string): Liveness => {
    const standing: OwnerStanding =
      lockReason === undefined ? { kind: "unlocked" } : { kind: "unrecognised", reason: lockReason };
    return { standing, inUse: { kind: "unknown", why: [why] } };
  };
  if (proc === null) return unmeasured("this platform has no /proc, so nothing could be checked for running processes");
  const scope = classifyPidNamespace(proc.pidNamespace());
  if (scope.kind !== "host") return unmeasured(scope.why);

  const chain = ancestry(proc, pid);
  const standing = ownerStanding(proc, lockReason, chain);
  const scan = cwdUsersUnder(proc, worktreePath, new Set(chain.map((a) => a.pid)), pid);
  return { standing, inUse: composeInUse(standing, scan) };
}

/* --------------------------------------------------------------- removal -- */

export interface RemoveOptions {
  dryRun?: boolean;
  /** The asking process, injected so ancestry can be arranged in a test. */
  pid?: number;
  /**
   * The liveness read, injected so a test can make a peer arrive BETWEEN the two
   * reads — an interleaving real processes in a single-threaded test cannot make.
   * Production leaves it unset.
   */
  liveness?: (worktreePath: string, lockReason: string | undefined) => Liveness;
}

/** Why a liveness answer forbids removal, or `null` when it is `idle`. */
function livenessRefusal(live: Liveness): string[] | null {
  switch (live.inUse.kind) {
    case "in-use":
      return ["refused: this worktree is in use", ...live.inUse.reasons.map((r) => `  ${r}`)];
    case "unknown":
      return ["refused: could not tell whether anything is using this worktree", ...live.inUse.why.map((w) => `  ${w}`)];
    case "idle":
      return null;
    default: {
      const unreachable: never = live.inUse;
      throw new Error(`unhandled liveness ${JSON.stringify(unreachable)}`);
    }
  }
}

export interface RemoveOutcome {
  ok: boolean;
  /** Everything checked and everything done, in order, for printing. */
  steps: string[];
}

/** A refusal: nothing has been touched, and `steps` says why. */
type Refusal = { ok: false; steps: string[] };

function refuse(steps: string[], ...lines: string[]): Refusal {
  for (const l of lines) steps.push(l);
  return { ok: false, steps };
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

/**
 * The oid of a branch, or why we do not have one — **and "absent" is not "could
 * not ask"**.
 *
 * `rev-parse --verify --quiet` exits 1 for a ref that is not there and something
 * else for a failure to look. Folding both into `null` made a transient failure
 * read as "branch does not exist — nothing to delete", which is a success line
 * over a branch that is still sitting there. GPT Sol's seventh finding on the
 * fix round; `reachableOids` had already been corrected for this and this
 * duplicated read had not.
 */
type RefLookup = { kind: "oid"; oid: string } | { kind: "absent" } | { kind: "cannot-tell"; why: string };

function lookupRef(cwd: string, branch: string): RefLookup {
  const r = spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd, encoding: "utf8" });
  const out = `${r.stdout ?? ""}`.trim();
  if (r.status === 0 && out !== "") return { kind: "oid", oid: out };
  if (r.status === 1) return { kind: "absent" };
  return { kind: "cannot-tell", why: `git rev-parse exited ${String(r.status)}: ${`${r.stderr ?? ""}`.trim()}` };
}

/**
 * Is this branch checked out in some worktree right now?
 *
 * `git update-ref -d` is not `git branch -D`: it does **not** refuse a branch that
 * a worktree has checked out. Reproduced by GPT Sol — a peer creates a worktree on
 * an orphan branch between our resolution and our deletion, the tip never moves so
 * the compare-and-swap is satisfied, and the peer is left with a symbolic HEAD
 * pointing at a ref that is gone and a tree reporting "No commits yet". No A→B→A
 * needed. So the deletion asks this immediately before acting.
 */
function checkedOutSomewhere(cwd: string, branch: string): boolean {
  return listWorktrees(cwd).some((e) => shortBranch(e.branch) === branch);
}

/**
 * `git worktree remove`, with **no `--force`, ever, on any path through this
 * file**.
 *
 * Two things follow from that, and the second was a surprise worth writing down.
 *
 * git refuses a tree with modified or untracked files on its own terms, so our
 * checks have a second pair of eyes that does not share their assumptions. Its
 * limit is that git does not refuse over *ignored* files, which is exactly the
 * case `worktree:check` exists for.
 *
 * And **an absent directory does not need `--force` either** — measured, a plain
 * `git worktree remove` on a ghost exits 0 and clears the registration. So the
 * ghost path uses this too, rather than `forceRemoveThrowawayWorktree`'s
 * `--force --force`. That closes a race GPT Sol reproduced on 2026-09-09: a
 * registration classified as a ghost, whose directory is put back before the
 * removal runs, was force-deleted along with whatever was in it. With no force,
 * git revalidates at the moment it acts and refuses.
 */
export function gitRemoveWorktree(primary: string, worktreePath: string): { ok: boolean; why: string } {
  const rm = spawnSync("git", ["worktree", "remove", worktreePath], { cwd: primary, encoding: "utf8" });
  if (rm.status === 0) return { ok: true, why: `removed ${worktreePath}` };
  return { ok: false, why: `refused by git: ${`${rm.stdout ?? ""}${rm.stderr ?? ""}`.trim()}` };
}

/**
 * The `.git/worktrees/<name>` directory backing one registration, or `null`.
 *
 * Found by matching `gitdir` files rather than by guessing the name from the
 * path: `git worktree add` derives the admin name from the basename but
 * de-duplicates it, so `<basename>` is a guess and this is the fact.
 *
 * Worth having because **a ghost's HEAD reflog is still readable** — the
 * directory is gone, the metadata is not. Measured:
 * `git --git-dir=.git/worktrees/<name> reflog show HEAD` lists a detached commit
 * made in a worktree that no longer exists.
 */
function adminDirFor(primary: string, worktreePath: string): string | null {
  const common = tryGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], primary);
  if (common === null) return null;
  const root = path.join(common, "worktrees");
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return null;
  }
  for (const name of names) {
    const dir = path.join(root, name);
    try {
      const gitdir = readFileSync(path.join(dir, "gitdir"), "utf8").trim();
      if (path.dirname(gitdir) === worktreePath) return dir;
    } catch {
      /* Raced away, or not a worktree admin dir. Neither is ours. */
    }
  }
  return null;
}

/**
 * Clear ONE stale registration, having first proved what its reflog names.
 *
 * Two mistakes are behind this, and the second is mine rather than inherited.
 *
 * **It is not `git worktree prune`.** Prune was the previous fix, chosen because
 * it revalidates at the moment it acts. It also **takes no path**: it clears every
 * stale registration, and clearing one deletes `.git/worktrees/<name>` including
 * that worktree's HEAD reflog. GPT Sol reproduced the consequence — removing ghost
 * A destroyed ghost B's admin directory, and a detached commit that only B's
 * reflog named became unreachable. Measured beside it: a **scoped**
 * `git worktree remove` on the absent path clears A and leaves B's reflog intact.
 * So the scope matters more than the revalidation, and the doc claim that prune
 * "cannot delete a file at all" was wrong — it deletes git's own files, which is
 * exactly where the last name for a commit lives.
 *
 * **And a ghost gets the same proof as a live tree**, which no earlier version
 * did. The directory is gone but the reflog is not, so there is no excuse for
 * removing the registration without reading it: if it names something the trunk
 * does not have, this refuses and the metadata stays.
 *
 * Unlock first, because `git worktree remove` refuses a locked entry and a real
 * Claude worktree is always locked; unlocking a registration whose directory is
 * gone cannot lose anything, and the lock is restored if the removal then fails.
 *
 * The residual, named rather than left: between the listing and the call the
 * original tree could be moved back, and a restored tree that is clean would be
 * removed. Git refuses over modified and untracked files, so what that costs is
 * gitignored files in a tree somebody restored in the last few milliseconds.
 */
function removeGhost(primary: string, entry: WorktreeEntry, trunkSha: string, steps: string[]): boolean {
  const admin = adminDirFor(primary, entry.path);
  if (admin === null) {
    steps.push(`refused: could not find the admin directory backing ${entry.path}, so its reflog cannot be read`);
    return false;
  }

  const headLog = tryGit(["--git-dir", admin, "reflog", "show", "HEAD", "--format=%H"]);
  if (headLog === null) {
    steps.push(`refused: could not read the HEAD reflog in ${admin}`);
    return false;
  }
  const oids = [...new Set(headLog.split("\n").map((l) => l.trim()).filter((l) => l !== ""))];
  if (oids.length > 0) {
    const proof = landedProof(primary, oids, trunkSha);
    if (proof.kind !== "landed") {
      steps.push(
        proof.kind === "not-landed"
          ? `refused: ${proof.count} commit${proof.count === 1 ? "" : "s"} named only by this gone tree's HEAD reflog are not on origin/${TRUNK_BRANCH}`
          : `refused: could not prove what this gone tree's reflog names — ${proof.why}`,
      );
      return false;
    }
    steps.push(`ok   the ${oids.length} commits its HEAD reflog still names are all on origin/${TRUNK_BRANCH}`);
  }

  const originalLock = entry.lockReason;
  if (entry.locked) {
    const un = spawnSync("git", ["worktree", "unlock", entry.path], { cwd: primary, encoding: "utf8" });
    if (un.status !== 0) {
      steps.push(`refused: could not unlock the stale registration: ${`${un.stderr ?? ""}`.trim()}`);
      return false;
    }
    steps.push("unlocked the stale registration");
  }

  /* Scoped, and no --force: git revalidates the path as it acts, and touches no
     other registration's metadata. */
  const rm = gitRemoveWorktree(primary, entry.path);
  steps.push(rm.why);
  if (!rm.ok && entry.locked) relock(primary, entry.path, originalLock, steps);
  return rm.ok;
}

/**
 * Prove, then delete, one branch — the shared tail of the ordinary path and the
 * orphan one, so orphan cleanup cannot drift into a weaker check.
 *
 * The reflog is re-read here rather than reused from the pre-removal snapshot.
 * That is the difference between "retaken" and "re-read", and the first version
 * only claimed the former: it passed the pre-removal oids straight through, so a
 * peer's A→B→A on the branch left the CAS satisfied and the excursion invisible.
 */
export function proveAndDeleteBranch(primary: string, branch: string, trunkSha: string, steps: string[], dryRun: boolean): boolean {
  const found = lookupRef(primary, branch);
  if (found.kind === "cannot-tell") {
    steps.push(`left branch ${branch}: could not read it — ${found.why}`);
    return false;
  }
  if (found.kind === "absent") {
    steps.push(`branch ${branch} does not exist — nothing to delete`);
    return true;
  }
  const tip = found.oid;

  const oids = reachableOids(primary, branch, null);
  if (oids.kind === "cannot-tell") {
    steps.push(`left branch ${branch}: could not read its history — ${oids.why}`);
    return false;
  }
  const proof = landedProof(primary, oids.oids, trunkSha);
  if (proof.kind === "cannot-tell") {
    steps.push(`left branch ${branch}: could not prove it landed — ${proof.why}`);
    return false;
  }
  if (proof.kind === "not-landed") {
    steps.push(
      `left branch ${branch}: ${proof.count} commit${proof.count === 1 ? "" : "s"} it has pointed at are not on origin/${TRUNK_BRANCH}`,
    );
    steps.push("  the tip and every reflog entry are in that count — a branch that was moved back still counts");
    return false;
  }
  steps.push(`ok   every commit ${branch} names (${proof.checked} checked, tip and reflog) is on origin/${TRUNK_BRANCH}`);

  if (dryRun) {
    steps.push(`would delete branch ${branch}`);
    return true;
  }

  /* Last thing before the delete, because a peer can create a worktree on this
     branch at any point and the tip CAS would not notice. */
  if (checkedOutSomewhere(primary, branch)) {
    steps.push(`left branch ${branch}: a worktree has it checked out now — deleting it would strand that tree`);
    return false;
  }

  const del = deleteRefIfUnmoved(primary, branch, tip);
  steps.push(del.why);
  return del.ok;
}

/** Resolved target, or the reason there isn't one. */
type Target =
  | { kind: "worktree"; entry: WorktreeEntry; branch: string | undefined }
  | { kind: "orphan-branch"; branch: string }
  | { kind: "refused"; steps: string[] };

function resolveTarget(cwd: string, primary: string, wanted: string | undefined, entries: readonly WorktreeEntry[]): Target {
  if (wanted === undefined) {
    const here = currentToplevel(cwd);
    const entry = entries.find((e) => here !== null && path.resolve(e.path) === here);
    if (entry === undefined) {
      return { kind: "refused", steps: ["could not tell which worktree you are in; name one with --branch <name>"] };
    }
    if (entry.main) {
      return {
        kind: "refused",
        steps: [
          "refused: you are in the primary checkout, which is not a worktree",
          "  name the one you mean: npm run worktree:remove -- --branch <name>",
        ],
      };
    }
    return { kind: "worktree", entry, branch: shortBranch(entry.branch) };
  }

  const entry = entries.find((e) => shortBranch(e.branch) === wanted);
  if (entry !== undefined) return { kind: "worktree", entry, branch: shortBranch(entry.branch) };

  const found = lookupRef(primary, wanted);
  if (found.kind === "absent") {
    return { kind: "refused", steps: [`no worktree is on branch ${wanted}, and no such branch exists`] };
  }
  if (found.kind === "cannot-tell") {
    return { kind: "refused", steps: [`could not tell whether branch ${wanted} exists — ${found.why}`] };
  }
  return { kind: "orphan-branch", branch: wanted };
}

/**
 * Remove one worktree, or clean up one orphaned `worktree-*` branch.
 *
 * **The order is the safety property.** Everything that could refuse runs, and
 * the landed proof is *completed*, before the first destructive call. The first
 * version proved after removing the worktree, which reads as more careful and is
 * the opposite: `git worktree remove` deletes the tree's HEAD reflog, so a proof
 * that then noticed an unlanded detached commit was announcing a loss it had
 * already caused. Measured, and GPT Sol's first finding on the code.
 *
 * Every refusal returns `ok: false` with its reasons in `steps`; every check that
 * passed is in `steps` too, so the output says what was looked at rather than
 * only what went wrong.
 */
export function removeWorktree(cwd: string, wanted: string | undefined, opts: RemoveOptions = {}): RemoveOutcome {
  const steps: string[] = [];
  const dryRun = opts.dryRun === true;
  const primary = primaryRoot(cwd);
  const target = resolveTarget(cwd, primary, wanted, listWorktrees(cwd));

  if (target.kind === "refused") return { ok: false, steps: target.steps };

  /* --- an orphaned branch: no tree to judge, same proof and same CAS ---- */
  if (target.kind === "orphan-branch") {
    steps.push(`no worktree is on branch ${target.branch} — treating it as an orphaned branch`);
    const trunk = fetchTrunkSha(primary);
    if (trunk.kind === "failed") return refuse(steps, `refused: ${trunk.why}`);
    steps.push(`ok   fetched origin/${TRUNK_BRANCH} — ${trunk.sha.slice(0, 8)}`);
    const ok = proveAndDeleteBranch(primary, target.branch, trunk.sha, steps, dryRun);
    return { ok, steps };
  }

  const { entry, branch } = target;

  /* --- what kind of registration is it? -------------------------------- */
  const reg = classifyRegistration(entry);
  if (reg.kind === "skip") return refuse(steps, `refused: ${reg.why}`);
  if (reg.kind === "unknown") return refuse(steps, `refused: ${reg.why}`, `  ${reg.fix}`);

  /* --- a fresh trunk, once, as a sha ----------------------------------- */
  const trunk = fetchTrunkSha(primary);
  if (trunk.kind === "failed") {
    return refuse(steps, `refused: ${trunk.why}`, "  a stale remote-tracking ref answers a question about an hour ago");
  }
  steps.push(`ok   fetched origin/${TRUNK_BRANCH} — ${trunk.sha.slice(0, 8)}`);

  if (reg.kind === "ghost") {
    steps.push(`the directory at ${entry.path} is gone; this is a stale registration`);
    if (dryRun) {
      steps.push(`would prove its HEAD reflog, unregister it, and leave branch ${branch ?? "(none)"} alone`);
      return { ok: true, steps };
    }
    if (!removeGhost(primary, entry, trunk.sha, steps)) return { ok: false, steps };
    steps.push(`left branch ${branch ?? "(none)"} alone — the tree is gone, but its commits are not this command's to judge`);
    return { ok: true, steps };
  }

  /* --- would deleting this directory lose anything? -------------------- */
  let found: ReturnType<typeof blockers>;
  try {
    found = blockers(checkGather(entry.path, trunk.sha));
  } catch (err) {
    return refuse(steps, `refused: worktree:check could not judge this tree: ${(err as Error).message}`);
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

  /* --- is anybody using it? ------------------------------------------- *
     The same question for the owner and for anyone else. An unknown refuses
     for both: there is no longer a floor for it to fall back to, and "could not
     tell whether a session is in there" is not an answer to remove on. */
  const readLiveness = opts.liveness ?? ((p: string, r: string | undefined) => liveness(p, r, opts.pid ?? process.pid));
  const live = readLiveness(entry.path, entry.lockReason);
  const notLive = livenessRefusal(live);
  if (notLive !== null) return refuse(steps, ...notLive);
  if (live.inUse.kind === "idle") for (const n of live.inUse.notes) steps.push(`ok   ${n}`);

  /* --- THE PROOF, COMPLETED BEFORE ANYTHING IS DESTROYED --------------- */
  const oids = reachableOids(primary, branch, entry.path);
  if (oids.kind === "cannot-tell") {
    return refuse(steps, `refused: could not read this tree's history — ${oids.why}`);
  }
  const proof = landedProof(primary, oids.oids, trunk.sha);
  if (proof.kind === "cannot-tell") {
    return refuse(steps, `refused: could not prove this tree's commits have landed — ${proof.why}`);
  }
  if (proof.kind === "not-landed") {
    return refuse(
      steps,
      `refused: ${proof.count} commit${proof.count === 1 ? "" : "s"} this tree names are not on origin/${TRUNK_BRANCH}`,
      "  that counts the branch tip, the branch reflog, and THIS WORKTREE'S HEAD reflog —",
      "  which `git worktree remove` deletes, so a detached commit made in here and",
      "  checked away from would otherwise become unreachable with nothing naming it.",
    );
  }
  steps.push(`ok   every commit this tree names (${proof.checked} checked, incl. its HEAD reflog) is on origin/${TRUNK_BRANCH}`);

  if (dryRun) {
    steps.push(`would remove ${entry.path}`);
    steps.push(branch === undefined ? "  detached HEAD — there would be no branch to delete" : `  and would delete branch ${branch}`);
    return { ok: true, steps };
  }

  /* --- the lock we are about to lift must be the lock we judged ---------
     A peer that resumed this tree since the listing may have re-locked it under
     its own live session. Unlocking would take that lock off, and the late
     liveness read below would then be asked about the old, stale owner. So the
     registration is read again, and any change to the lock refuses untouched.
     GPT Sol, the namespace-fix review of 260912a. */
  const now = listWorktrees(primary).find((e) => path.resolve(e.path) === path.resolve(entry.path));
  if (now === undefined || now.locked !== entry.locked || now.lockReason !== entry.lockReason) {
    return refuse(
      steps,
      "refused: the worktree's lock changed since it was read — somebody may have come back to it",
      `  was: ${entry.locked ? (entry.lockReason ?? "(locked, no reason)") : "(unlocked)"}`,
      `  now: ${now === undefined ? "(no longer registered)" : now.locked ? (now.lockReason ?? "(locked, no reason)") : "(unlocked)"}`,
    );
  }

  /* --- unlock, stopping if we cannot ----------------------------------- */
  const originalLock = entry.lockReason;
  if (entry.locked) {
    const un = spawnSync("git", ["worktree", "unlock", entry.path], { cwd: primary, encoding: "utf8" });
    if (un.status !== 0) return refuse(steps, `refused: could not unlock ${entry.path}: ${`${un.stderr ?? ""}`.trim()}`);
    steps.push(`unlocked ${entry.path}${originalLock === undefined ? "" : ` (was: ${originalLock})`}`);
  }

  /* --- the proof again, as the last thing before the destructive call ---
     The first one happened before the unlock, and the unlock is a process spawn
     wide enough for `git -C <tree>` from anywhere on the box to make a detached
     commit and check away from it — which our cwd scan cannot see, since that
     process never enters the directory. Repeating it here does not close the
     window, it narrows it to the gap between these two calls; GPT Sol named this
     as the cheapest useful narrowing and it is one `rev-list`.

     **No test covers this, and that is not an oversight.** It only ever differs
     from the first proof when something changes BETWEEN them, which needs a
     second process interleaved at an exact point; mutating it away leaves all 45
     tests green, because the first proof catches everything a single-threaded
     test can arrange. Named here so the next reader knows it is unguarded rather
     than assuming the suite has their back. */
  const again = reachableOids(primary, branch, entry.path);
  const stillLanded = again.kind === "ok" ? landedProof(primary, again.oids, trunk.sha) : null;
  if (again.kind !== "ok" || stillLanded === null || stillLanded.kind !== "landed") {
    steps.push("refused: this tree changed between the first proof and the removal");
    steps.push(`  ${again.kind === "ok" ? (stillLanded?.kind === "not-landed" ? `${stillLanded.count} commits are not on the trunk now` : "the proof could not be retaken") : again.why}`);
    if (entry.locked) relock(primary, entry.path, originalLock, steps);
    return { ok: false, steps };
  }

  /* --- and liveness again, for the same reason -------------------------
     One read is not a lease: a peer can resume a clean, landed tree with a stale
     lock after the first read, and without this it was unlocked and removed with
     the peer inside (GPT Sol's P1 on the namespace-fix review of 260912a). Read
     after the unlock. Git refuses a peer lock it observes before its own lock
     check, but that check is not a lease either: the lease review of c87ceec8
     reproduced a lock succeeding after `git worktree remove` started while the
     removal also succeeded. What is left is any peer that enters after the last
     observation here, whether its lock loses that race or it enters without one;
     closing that needs an exclusion shared with EnterWorktree, which is not ours. */
  const lateRefusal = livenessRefusal(readLiveness(entry.path, originalLock));
  if (lateRefusal !== null) {
    steps.push(lateRefusal[0] === undefined ? "refused" : `${lateRefusal[0]} (read again, just before the removal)`, ...lateRefusal.slice(1));
    if (entry.locked) relock(primary, entry.path, originalLock, steps);
    return { ok: false, steps };
  }

  /* --- git's own judgement, on its own terms --------------------------- */
  const rm = gitRemoveWorktree(primary, entry.path);
  if (!rm.ok) {
    steps.push(rm.why);
    if (entry.locked) relock(primary, entry.path, originalLock, steps);
    return { ok: false, steps };
  }
  steps.push(rm.why);

  /* --- and only now, the branch ---------------------------------------- */
  if (branch === undefined) {
    steps.push("detached HEAD — no branch to delete");
    return { ok: true, steps };
  }
  return { ok: proveAndDeleteBranch(primary, branch, trunk.sha, steps, false), steps };
}

/**
 * Put the lock back after a failed removal, so a tree that survives is not left
 * less protected than it was found.
 *
 * **A lock with no reason is still a lock.** The first version restored only when
 * there was a reason to restore, so `git worktree lock <path>` with no `--reason`
 * — which is a real state — was silently downgraded to unlocked. GPT Sol's
 * seventh finding.
 */
export function relock(primary: string, worktreePath: string, reason: string | undefined, steps: string[]): void {
  const args = reason === undefined ? ["worktree", "lock", worktreePath] : ["worktree", "lock", "--reason", reason, worktreePath];
  const re = spawnSync("git", args, { cwd: primary, encoding: "utf8" });
  steps.push(re.status === 0 ? "restored the lock" : `could NOT restore the lock: ${`${re.stderr ?? ""}`.trim()}`);
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
