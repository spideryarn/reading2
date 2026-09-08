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
 * **A ghost is an ABSENT path, and nothing here ever passes `--force`.**
 * `ghosts()` in `worktree-admin.ts` counts `!present || prunable`, and unregisters
 * with `--force --force`. Two things were wrong with inheriting that: a *present*
 * prunable registration is a broken admin link over what may be a full directory,
 * and even a genuine ghost can have its directory put back between the listing and
 * the removal — reproduced, and force-deleted with it. Measured: a plain
 * `git worktree remove` clears an absent registration on its own, so there is no
 * case here that needs a force at all, and git revalidates at the moment it acts.
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
import { statSync } from "node:fs";
import path from "node:path";

import { TRUNK_BRANCH } from "./deploy-checks.js";
import { listWorktrees, type WorktreeEntry } from "./worktree-admin.js";
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
    const standing: OwnerStanding =
      lockReason === undefined ? { kind: "unlocked" } : { kind: "unrecognised", reason: lockReason };
    return {
      standing,
      inUse: { kind: "unknown", why: ["this platform has no /proc, so nothing could be checked for running processes"] },
      authorised: false,
    };
  }
  const chain = ancestry(proc, pid);
  const standing = ownerStanding(proc, lockReason, chain);
  const scan = cwdUsersUnder(proc, worktreePath, new Set(chain.map((a) => a.pid)), pid);
  return { standing, inUse: composeInUse(standing, scan), authorised: ownerIsAsking(standing) };
}

/**
 * **May this caller skip the 24-hour floor?**
 *
 * Only when the owner is asking *and* both liveness signals were conclusive.
 * Authorisation alone is not enough: an owner beside a same-uid process whose cwd
 * would not be read is an `unknown`, and an unknown must cost you the floor —
 * otherwise the one branch that skips the floor is also the one that swallows
 * every uncertainty, which is failing open for exactly the caller most likely to
 * be in a hurry. GPT Sol's fifth finding on the code, 2026-09-09.
 *
 * Its own function so it can be tested without arranging an unreadable process.
 */
export function shouldWaiveFloor(live: Liveness): boolean {
  return live.authorised && live.inUse.kind === "idle";
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

function refExists(cwd: string, branch: string): string | null {
  return tryGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], cwd);
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
 * Prove, then delete, one branch — the shared tail of the ordinary path and the
 * orphan one, so orphan cleanup cannot drift into a weaker check.
 *
 * The reflog is re-read here rather than reused from the pre-removal snapshot.
 * That is the difference between "retaken" and "re-read", and the first version
 * only claimed the former: it passed the pre-removal oids straight through, so a
 * peer's A→B→A on the branch left the CAS satisfied and the excursion invisible.
 */
export function proveAndDeleteBranch(primary: string, branch: string, trunkSha: string, steps: string[], dryRun: boolean): boolean {
  const tip = refExists(primary, branch);
  if (tip === null) {
    steps.push(`branch ${branch} does not exist — nothing to delete`);
    return true;
  }

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
  if (refExists(primary, wanted) === null) {
    return { kind: "refused", steps: [`no worktree is on branch ${wanted}, and no such branch exists`] };
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

  if (reg.kind === "ghost") {
    steps.push(`the directory at ${entry.path} is gone; this is a stale registration`);
    if (dryRun) {
      steps.push(`would unregister it, and would leave branch ${branch ?? "(none)"} alone`);
      return { ok: true, steps };
    }
    /* No --force: if the directory came back between the listing and now, git
       revalidates and refuses rather than deleting what is in it. */
    const rm = gitRemoveWorktree(primary, entry.path);
    steps.push(rm.why);
    if (!rm.ok) return { ok: false, steps };
    steps.push(`left branch ${branch ?? "(none)"} alone — the tree is gone, but its commits are not this command's to judge`);
    return { ok: true, steps };
  }

  /* --- a fresh trunk, once, as a sha ----------------------------------- */
  const trunk = fetchTrunkSha(primary);
  if (trunk.kind === "failed") {
    return refuse(steps, `refused: ${trunk.why}`, "  a stale remote-tracking ref answers a question about an hour ago");
  }
  steps.push(`ok   fetched origin/${TRUNK_BRANCH} — ${trunk.sha.slice(0, 8)}`);

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

  /* --- is anybody using it, and did its owner ask? --------------------- */
  const live = liveness(entry.path, entry.lockReason, opts.pid ?? process.pid);
  if (live.inUse.kind === "in-use") {
    steps.push("refused: this worktree is in use");
    for (const r of live.inUse.reasons) steps.push(`  ${r}`);
    return { ok: false, steps };
  }

  /* **Authorised is not enough on its own.** The floor is waived only when the
     owner is asking AND both liveness signals were conclusive. An owner beside a
     same-uid process whose cwd would not be read is an unknown, and an unknown
     costs you the floor — otherwise `unknown` fails open for exactly the caller
     most likely to be in a hurry. GPT Sol's fifth finding on the code. */
  const waived = shouldWaiveFloor(live);
  if (waived) steps.push("ok   its own session is asking, and nothing else is in it — the 24h floor does not apply");
  else if (live.inUse.kind === "idle") for (const n of live.inUse.notes) steps.push(`ok   ${n}`);

  if (!waived) {
    if (live.inUse.kind === "unknown") for (const w of live.inUse.why) steps.push(`·    could not check: ${w}`);
    if (live.authorised) steps.push("·    its own session is asking, but something could not be checked, so the floor still applies");
    const floor = ageFloor(entry.path, branch, opts);
    if (floor !== null) return refuse(steps, ...floor);
    steps.push(`ok   ${idleLine(entry.path, branch, opts)}`);
  }

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

  /* --- unlock, stopping if we cannot ----------------------------------- */
  const originalLock = entry.lockReason;
  if (entry.locked) {
    const un = spawnSync("git", ["worktree", "unlock", entry.path], { cwd: primary, encoding: "utf8" });
    if (un.status !== 0) return refuse(steps, `refused: could not unlock ${entry.path}: ${`${un.stderr ?? ""}`.trim()}`);
    steps.push(`unlocked ${entry.path}${originalLock === undefined ? "" : ` (was: ${originalLock})`}`);
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

/** The refusal lines when a third party is under the floor, or `null` if it is clear. */
function ageFloor(worktreePath: string, branch: string | undefined, opts: RemoveOptions): string[] | null {
  const minIdle = opts.minIdleHours ?? MIN_IDLE_HOURS;
  const activity = lastActivityAt(worktreePath, branch);
  if (activity === null) return ["refused: could not tell when this tree was last active"];
  const idleHours = ((opts.now ?? Math.floor(Date.now() / 1000)) - activity.at) / 3600;
  if (idleHours >= minIdle) return null;
  return [
    `refused: ${activity.signal} ${describeIdle(idleHours)} ago — under the ${minIdle}h floor`,
    "  nothing running in it is not the same as finished. Either its own session removes it,",
    "  or it waits out the floor. See docs/project/worktrees.md § Removing one.",
  ];
}

function idleLine(worktreePath: string, branch: string | undefined, opts: RemoveOptions): string {
  const minIdle = opts.minIdleHours ?? MIN_IDLE_HOURS;
  const activity = lastActivityAt(worktreePath, branch);
  if (activity === null) return "idle for an unknown time";
  const idleHours = ((opts.now ?? Math.floor(Date.now() / 1000)) - activity.at) / 3600;
  return `${activity.signal} ${describeIdle(idleHours)} ago — over the ${minIdle}h floor`;
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
