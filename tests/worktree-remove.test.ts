/**
 * `npm run worktree:remove`, against real git.
 *
 * Real git, not a mock, for the reason the sweep's suite already gives: the guard
 * that matters most is **git's own refusal** to remove a dirty tree, and a mocked
 * git cannot refuse. The same goes for `update-ref -d <ref> <old-oid>` — the whole
 * point of it is that git compares, and a fake that returns "ok" proves the
 * opposite of what is wanted.
 *
 * Two things are faked, and only two, because neither can be *arranged*:
 *
 * - the **ancestor chain**, via `opts.pid` — a test cannot make the worktree lock
 *   name one of its own ancestors without spawning and locking around it;
 * - the **clock**, via `opts.now` — but note the sweep's lesson, kept here: where
 *   a signal could be stuck to the present, the fixture is aged rather than the
 *   clock moved.
 *
 * Every refusal is confirmed by watching it refuse. Every one has a control that
 * differs in exactly the thing being tested, because a command that refuses
 * everything passes the same assertions as one that works.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listWorktrees } from "../scripts/worktree-admin.js";
import { parseStat } from "../scripts/worktree-inuse.js";
import {
  classifyRegistration,
  deleteRefIfUnmoved,
  gitRemoveWorktree,
  landedProof,
  proveAndDeleteBranch,
  reachableOids,
  relock,
  removeWorktree,
  shouldWaiveFloor,
} from "../scripts/worktree-remove.js";

let root: string;
let origin: string;
let primary: string;

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commit(cwd: string, file: string, body: string, message: string): void {
  writeFileSync(path.join(cwd, file), body);
  git(["add", "--", file], cwd);
  git(["commit", "--quiet", "-m", message], cwd);
}

/** A worktree that has landed everything: branched, committed, pushed to dev. */
function landedWorktree(name: string): string {
  const wt = path.join(root, name);
  git(["worktree", "add", "--quiet", "-b", name, wt], primary);
  commit(wt, `${name}.txt`, "work", `work in ${name}`);
  git(["push", "--quiet", "origin", "HEAD:dev"], wt);
  git(["fetch", "--quiet", "origin", "dev"], primary);
  return wt;
}

/** Old enough to clear the age floor without waiting: age the admin dir + reflogs. */
const LONG_AGO = { now: Math.floor(Date.now() / 1000) + 40 * 3600 };

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "spideryarn-wtremove-"));
  origin = path.join(root, "origin.git");
  primary = path.join(root, "primary");

  execFileSync("git", ["init", "--quiet", "--bare", "--initial-branch=dev", origin]);
  execFileSync("git", ["clone", "--quiet", origin, primary]);
  git(["config", "user.email", "t@example.com"], primary);
  git(["config", "user.name", "Test"], primary);
  commit(primary, "README.md", "seed", "seed");
  git(["push", "--quiet", "origin", "HEAD:dev"], primary);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/* ------------------------------------------------------- registrations -- */

describe("classifyRegistration", () => {
  const base = {
    path: "/x",
    head: "abc",
    locked: false,
    prunable: false,
    present: true,
    main: false,
    bare: false,
    detached: false,
  };

  it("REFUSES a prunable registration whose directory is still there", () => {
    /* The one that would have been force-deleted: `ghosts()` counts
       `!present || prunable`, and a ghost is unregistered with --force --force. */
    const v = classifyRegistration({ ...base, prunable: true });
    expect(v.kind).toBe("unknown");
    if (v.kind === "unknown") expect(v.fix).toContain("repair");
  });

  it("control: an ABSENT directory is a ghost", () => {
    expect(classifyRegistration({ ...base, present: false, prunable: true }).kind).toBe("ghost");
  });

  it("the primary and bare entries are never candidates", () => {
    expect(classifyRegistration({ ...base, main: true }).kind).toBe("skip");
    expect(classifyRegistration({ ...base, bare: true }).kind).toBe("skip");
  });
});

/* -------------------------------------------------------------- proof -- */

describe("the landed proof", () => {
  it("REFUSES: a commit the branch has pointed at is not on the trunk, though its tip is", () => {
    /* The reflog case. The branch reached U, then was moved back to a landed
       commit, so `--is-ancestor` on the tip says "landed" while U exists only in
       the reflogs this removal is about to delete. */
    const wt = landedWorktree("worktree-moved-back");
    const landed = git(["rev-parse", "HEAD"], wt);
    commit(wt, "unlanded.txt", "not pushed", "a commit that never landed");
    const stray = git(["rev-parse", "HEAD"], wt);
    git(["reset", "--hard", "--quiet", landed], wt);

    const trunk = git(["rev-parse", "origin/dev"], primary);
    const oids = reachableOids(primary, "worktree-moved-back", wt);
    if (oids.kind !== "ok") throw new Error(`expected ok, got ${oids.why}`);
    expect(oids.oids).toContain(stray);
    expect(landedProof(primary, oids.oids, trunk).kind).toBe("not-landed");
  });

  it("REFUSES: a BRANCH reflog it could not read is `cannot-tell`, never an empty history", () => {
    /* The first version folded every read failure into `?? ""`, so a reflog that
       errored was indistinguishable from a branch that had never moved — and
       that difference is the whole guard. */
    const oids = reachableOids(primary, "no-such-branch-at-all", null);
    expect(oids.kind).toBe("cannot-tell");
  });

  it("REFUSES: a WORKTREE HEAD reflog it could not read is `cannot-tell` too", () => {
    /* Added because a mutation that dropped exactly this check left all 36 other
       tests green — the branch-side test above covered its own half and nothing
       covered this one. This is the half that guards detached work. */
    const wt = landedWorktree("worktree-head-unreadable");
    const notAWorktree = path.join(root, "not-a-git-tree");
    mkdirSync(notAWorktree);

    expect(reachableOids(primary, "worktree-head-unreadable", wt).kind).toBe("ok");
    expect(reachableOids(primary, "worktree-head-unreadable", notAWorktree).kind).toBe("cannot-tell");
  });

  it("REFUSES: a missing object is `cannot-tell`, not `landed`", () => {
    /* `--ignore-missing` pretends an invalid object was never supplied — measured,
       a landed oid plus a nonexistent one returns count 0, exit 0. So it is not
       passed, and a corrupt reflog entry now leaves the branch alone. */
    const trunk = git(["rev-parse", "origin/dev"], primary);
    const proof = landedProof(primary, [trunk, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"], trunk);
    expect(proof.kind).toBe("cannot-tell");
  });

  it("REFUSES an A→B→A branch: the tip is back where we proved, the reflog is not", () => {
    /* The ABA the compare-and-swap alone cannot see. `proveAndDeleteBranch`
       re-reads the reflog rather than reusing a snapshot, which is what catches
       the excursion. */
    const wt = landedWorktree("worktree-aba");
    const landed = git(["rev-parse", "HEAD"], wt);
    commit(wt, "excursion.txt", "unlanded", "an excursion");
    git(["reset", "--hard", "--quiet", landed], wt);
    expect(git(["rev-parse", "refs/heads/worktree-aba"], primary)).toBe(landed);

    const trunk = git(["rev-parse", "origin/dev"], primary);
    const steps: string[] = [];
    expect(proveAndDeleteBranch(primary, "worktree-aba", trunk, steps, false)).toBe(false);
    expect(git(["rev-parse", "--verify", "refs/heads/worktree-aba"], primary)).toBe(landed);
  });

  it("control: the same branch, judged on its tip alone, looks landed", () => {
    const wt = landedWorktree("worktree-tip-only");
    const landed = git(["rev-parse", "HEAD"], wt);
    commit(wt, "unlanded.txt", "not pushed", "never landed");
    git(["reset", "--hard", "--quiet", landed], wt);
    const trunk = git(["rev-parse", "origin/dev"], primary);
    expect(landedProof(primary, [landed], trunk).kind).toBe("landed");
  });

  it("says cannot-tell rather than landed when it has nothing to judge", () => {
    const trunk = git(["rev-parse", "origin/dev"], primary);
    expect(landedProof(primary, [], trunk).kind).toBe("cannot-tell");
  });
});

describe("deleteRefIfUnmoved", () => {
  it("REFUSES to delete a branch that moved after the proof was taken", () => {
    const wt = landedWorktree("worktree-moved");
    const proved = git(["rev-parse", "HEAD"], wt);
    commit(wt, "later.txt", "a peer resumed and committed", "a peer's commit");

    const r = deleteRefIfUnmoved(primary, "worktree-moved", proved);
    expect(r.ok).toBe(false);
    expect(git(["rev-parse", "--verify", "refs/heads/worktree-moved"], primary)).not.toBe("");
  });

  it("control: deletes it when it is still where we proved", () => {
    const wt = landedWorktree("worktree-still");
    const proved = git(["rev-parse", "HEAD"], wt);
    expect(deleteRefIfUnmoved(primary, "worktree-still", proved).ok).toBe(true);
    const check = spawnSync("git", ["rev-parse", "--verify", "refs/heads/worktree-still"], { cwd: primary });
    expect(check.status).not.toBe(0);
  });
});

/* ------------------------------------------------------------ removal -- */

describe("removeWorktree", () => {
  it("REFUSES a tree with uncommitted work, and says what it found", () => {
    const wt = landedWorktree("worktree-dirty");
    writeFileSync(path.join(wt, "scratch.txt"), "not committed");

    const out = removeWorktree(primary, "worktree-dirty", LONG_AGO);
    expect(out.ok).toBe(false);
    expect(out.steps.join("\n")).toContain("refused");
    expect(existsSync(wt)).toBe(true);
  });

  it("REFUSES a tree holding gitignored data git has no copy of", () => {
    /* The case a `git status` cannot see and `git worktree remove` will not
       refuse on — the only guard is worktree:check, called here. The ignore rule
       goes in before the worktree exists, so this test is about the ignored file
       rather than about who pushed to dev last. */
    commit(primary, ".gitignore", "/paid-run/\n", "ignore paid-run");
    git(["push", "--quiet", "origin", "HEAD:dev"], primary);
    const wt = landedWorktree("worktree-ignored");
    mkdirSync(path.join(wt, "paid-run"));
    writeFileSync(path.join(wt, "paid-run", "results.json"), "{}");

    const out = removeWorktree(primary, "worktree-ignored", LONG_AGO);
    expect(out.ok).toBe(false);
    expect(existsSync(path.join(wt, "paid-run", "results.json"))).toBe(true);
  });

  it("REFUSES a branch whose work has not landed", () => {
    const wt = path.join(root, "unlanded");
    git(["worktree", "add", "--quiet", "-b", "worktree-unlanded", wt], primary);
    commit(wt, "mine.txt", "not pushed anywhere", "unlanded work");

    const out = removeWorktree(primary, "worktree-unlanded", LONG_AGO);
    expect(out.ok).toBe(false);
    expect(existsSync(wt)).toBe(true);
  });

  it("REFUSES a young tree when a third party asks", () => {
    landedWorktree("worktree-young");
    const out = removeWorktree(primary, "worktree-young", {});
    expect(out.ok).toBe(false);
    expect(out.steps.join("\n")).toContain("floor");
  });

  it("control: the same tree, once it is over the floor, is removed", () => {
    const wt = landedWorktree("worktree-old-enough");
    const out = removeWorktree(primary, "worktree-old-enough", LONG_AGO);
    expect(out.ok).toBe(true);
    expect(existsSync(wt)).toBe(false);
    const branch = spawnSync("git", ["rev-parse", "--verify", "refs/heads/worktree-old-enough"], { cwd: primary });
    expect(branch.status).not.toBe(0);
  });

  it("REFUSES a prunable registration whose directory is still full of files", () => {
    /* How this state is actually reached, measured rather than imagined: the tree
       is moved away and something else is put back at its path. Git then reports
       `prunable gitdir file points to non-existent location` for a path that
       exists and holds files. `ghosts()` calls that a ghost.
       What it does NOT do — checked — is destroy them: `git worktree remove
       --force --force` refuses with "validation failed … '<path>/.git' does not
       exist". So this is a misclassification that ends in a confusing failure,
       not the data loss it looks like. The fix is worth having anyway: the
       operator is told `git worktree repair`, which is the thing that works. */
    const wt = landedWorktree("worktree-broken-link");
    const moved = `${wt}-moved`;
    renameSync(wt, moved);
    mkdirSync(wt);
    writeFileSync(path.join(wt, "somebody-elses-file.txt"), "the only copy");

    const out = removeWorktree(primary, "worktree-broken-link", LONG_AGO);
    expect(out.ok).toBe(false);
    expect(out.steps.join("\n")).toContain("repair");
    expect(existsSync(path.join(wt, "somebody-elses-file.txt"))).toBe(true);
  });

  it("REFUSES to touch the primary checkout", () => {
    const out = removeWorktree(primary, "dev", LONG_AGO);
    expect(out.ok).toBe(false);
    expect(existsSync(path.join(primary, "README.md"))).toBe(true);
  });

  it("a --dry-run removes nothing and says what it would do", () => {
    const wt = landedWorktree("worktree-dry");
    const out = removeWorktree(primary, "worktree-dry", { ...LONG_AGO, dryRun: true });
    expect(out.ok).toBe(true);
    expect(out.steps.join("\n")).toContain("would remove");
    expect(existsSync(wt)).toBe(true);
    expect(git(["rev-parse", "--verify", "refs/heads/worktree-dry"], primary)).not.toBe("");
  });

  it("unlocks a locked worktree, and removes it", () => {
    const wt = landedWorktree("worktree-locked");
    git(["worktree", "lock", "--reason", "claude session locked (pid 999999 start 1)", wt], primary);

    const out = removeWorktree(primary, "worktree-locked", LONG_AGO);
    expect(out.ok).toBe(true);
    expect(out.steps.join("\n")).toContain("unlocked");
    expect(existsSync(wt)).toBe(false);
  });

  it("REFUSES when the lock was written by hand and cannot be read", () => {
    /* Somebody locked it deliberately for a reason we cannot parse. That is an
       unknown, and an unknown costs the caller the age floor rather than being
       treated as an absent owner. Under the floor, that refuses. */
    const wt = landedWorktree("worktree-handlocked");
    git(["worktree", "lock", "--reason", "mid-migration, do not touch", wt], primary);

    const out = removeWorktree(primary, "worktree-handlocked", {});
    expect(out.ok).toBe(false);
    expect(existsSync(wt)).toBe(true);
  });

  it("unregisters a ghost and leaves its branch alone", () => {
    const wt = landedWorktree("worktree-ghost");
    rmSync(wt, { recursive: true, force: true });

    const out = removeWorktree(primary, "worktree-ghost", LONG_AGO);
    expect(out.ok).toBe(true);
    expect(out.steps.join("\n")).toContain("left branch worktree-ghost alone");
    expect(git(["rev-parse", "--verify", "refs/heads/worktree-ghost"], primary)).not.toBe("");
  });

  it("cleans up an orphaned branch, so a half-finished removal is not a stuck state", () => {
    const wt = landedWorktree("worktree-orphan");
    /* The state a removal whose branch deletion failed leaves behind. */
    git(["worktree", "remove", wt], primary);
    expect(git(["rev-parse", "--verify", "refs/heads/worktree-orphan"], primary)).not.toBe("");

    const out = removeWorktree(primary, "worktree-orphan", LONG_AGO);
    expect(out.ok).toBe(true);
    const branch = spawnSync("git", ["rev-parse", "--verify", "refs/heads/worktree-orphan"], { cwd: primary });
    expect(branch.status).not.toBe(0);
  });

  it("REFUSES an orphaned branch that has not landed", () => {
    const wt = path.join(root, "orphan-unlanded");
    git(["worktree", "add", "--quiet", "-b", "worktree-orphan-unlanded", wt], primary);
    commit(wt, "mine.txt", "never pushed", "unlanded");
    git(["worktree", "remove", "--force", wt], primary);

    const out = removeWorktree(primary, "worktree-orphan-unlanded", LONG_AGO);
    expect(out.ok).toBe(false);
    expect(git(["rev-parse", "--verify", "refs/heads/worktree-orphan-unlanded"], primary)).not.toBe("");
  });

  it("says so, rather than failing obscurely, when the branch does not exist at all", () => {
    const out = removeWorktree(primary, "worktree-never-existed", LONG_AGO);
    expect(out.ok).toBe(false);
    expect(out.steps.join("\n")).toContain("no such branch");
  });

  /* ------------------------------------------------------------------ *
   * The ordering. These are the tests that would have caught a proof    *
   * that ran AFTER the destructive call and "refused" a loss it had     *
   * already caused.                                                     *
   * ------------------------------------------------------------------ */

  it("REFUSES, WITHOUT REMOVING, work reachable only from the worktree's own HEAD reflog", () => {
    /* Measured: `git worktree remove` deletes `.git/worktrees/<name>/logs/HEAD`,
       and a detached commit made in there is then named by nothing at all —
       `git reflog --all` loses it, `git fsck --unreachable` is all that is left.
       So the proof must be COMPLETE before the removal, and this asserts that the
       tree, the branch and the reflog are all still there afterwards. */
    const wt = landedWorktree("worktree-detached-work");
    git(["checkout", "--quiet", "--detach"], wt);
    commit(wt, "detached.txt", "made on a detached head, never pushed", "detached unlanded work");
    const stray = git(["rev-parse", "HEAD"], wt);
    git(["checkout", "--quiet", "worktree-detached-work"], wt);

    const out = removeWorktree(primary, "worktree-detached-work", LONG_AGO);

    expect(out.ok).toBe(false);
    expect(existsSync(wt)).toBe(true);
    expect(git(["rev-parse", "--verify", "refs/heads/worktree-detached-work"], primary)).not.toBe("");
    /* The point of the whole test: the only name for that commit survives. */
    expect(git(["reflog", "show", "--format=%H", "HEAD"], wt).split("\n")).toContain(stray);
  });

  it("REFUSES a detached worktree whose only work is in its HEAD reflog", () => {
    /* No branch at all, so a branch-shaped proof has nothing to look at and the
       first version skipped the proof entirely. */
    const wt = landedWorktree("worktree-fully-detached");
    git(["checkout", "--quiet", "--detach"], wt);
    commit(wt, "loose.txt", "never landed", "loose work on a detached head");
    const entries = listWorktrees(primary).filter((e) => !e.main);
    expect(entries.some((e) => e.branch === undefined)).toBe(true);

    /* Named by path is not supported, so drive it the way a session would: from
       inside the tree, with no --branch. */
    const out = removeWorktree(wt, undefined, LONG_AGO);
    expect(out.ok).toBe(false);
    expect(existsSync(wt)).toBe(true);
  });

  it("a --dry-run refuses the same unlanded reflog a real run would", () => {
    /* The dry run used to return before the proof, so it promised a removal that
       the real run would refuse — after already destroying the worktree. */
    const wt = landedWorktree("worktree-dry-unlanded");
    const landed = git(["rev-parse", "HEAD"], wt);
    commit(wt, "u.txt", "unlanded", "unlanded");
    git(["reset", "--hard", "--quiet", landed], wt);

    const out = removeWorktree(primary, "worktree-dry-unlanded", { ...LONG_AGO, dryRun: true });
    expect(out.ok).toBe(false);
    expect(out.steps.join("\n")).not.toContain("would remove");
  });

  it("the OWNER removes its own tree under the floor — the whole point of the command", () => {
    /* The one path no other test reached: `opts.pid` unused meant the ownership
       proof was never exercised end to end. The lock names THIS process, with its
       real start time out of /proc, so `ancestry` finds it and the floor lifts. */
    const wt = landedWorktree("worktree-owned");
    const mine = parseStat(readFileSync(`/proc/${process.pid}/stat`, "utf8"));
    if (mine === null) throw new Error("could not read this process's start time");
    git(["worktree", "lock", "--reason", `claude session owned (pid ${process.pid} start ${mine.start})`, wt], primary);

    /* No LONG_AGO: this tree was made seconds ago and a third party would be
       refused. The control below proves that. */
    const out = removeWorktree(primary, "worktree-owned", { pid: process.pid });

    expect(out.steps.join("\n")).toContain("its own session is asking");
    expect(out.ok).toBe(true);
    expect(existsSync(wt)).toBe(false);
  });

  it("control: the same young tree, asked for by anyone else, is refused", () => {
    const wt = landedWorktree("worktree-not-owned");
    git(["worktree", "lock", "--reason", "claude session other (pid 999999 start 1)", wt], primary);

    const out = removeWorktree(primary, "worktree-not-owned", {});
    expect(out.ok).toBe(false);
    expect(out.steps.join("\n")).toContain("floor");
    expect(existsSync(wt)).toBe(true);
  });
});

describe("shouldWaiveFloor", () => {
  const owner = { session: "x", pid: 1, start: 1 };

  it("REFUSES to waive when the owner is asking but something could not be checked", () => {
    /* Authorisation alone was enough in the first version, so the one branch that
       skips the floor also swallowed every uncertainty. */
    expect(
      shouldWaiveFloor({
        standing: { kind: "asking", owner },
        inUse: { kind: "unknown", why: ["a process would not say where it is"] },
        authorised: true,
      }),
    ).toBe(false);
  });

  it("control: waives when the owner is asking and both signals were conclusive", () => {
    expect(
      shouldWaiveFloor({ standing: { kind: "asking", owner }, inUse: { kind: "idle", notes: [] }, authorised: true }),
    ).toBe(true);
  });

  it("never waives for a third party, however idle the tree looks", () => {
    expect(
      shouldWaiveFloor({ standing: { kind: "unlocked" }, inUse: { kind: "idle", notes: [] }, authorised: false }),
    ).toBe(false);
  });
});

describe("relock", () => {
  it("restores a lock that had NO reason, which is still a lock", () => {
    /* The restore used to be conditional on there being a reason, so
       `git worktree lock <path>` was silently downgraded to unlocked by a failed
       removal. */
    const wt = landedWorktree("worktree-reasonless");
    git(["worktree", "lock", wt], primary);
    git(["worktree", "unlock", wt], primary);
    expect(listWorktrees(primary).find((e) => e.path === wt)?.locked).toBe(false);

    const steps: string[] = [];
    relock(primary, wt, undefined, steps);

    expect(steps.join("\n")).toContain("restored the lock");
    expect(listWorktrees(primary).find((e) => e.path === wt)?.locked).toBe(true);
  });
});

describe("the ghost path", () => {
  it("does NOT delete a worktree that was moved back before the removal ran", () => {
    /* The race dropping `--force` did not close, reproduced by GPT Sol: plain
       `git worktree remove` on a registered path removes *whatever is there*, and
       the ORIGINAL tree restored at that path is valid, so git accepts it and
       deletes it — taking an ignored only-copy file and any detached commit named
       only by that tree's HEAD reflog. `git worktree prune` asks the other
       question — is the registration STILL stale — and a restored tree is not. */
    const wt = landedWorktree("worktree-comes-back");
    writeFileSync(path.join(wt, "only-copy.json"), "{}");
    renameSync(wt, `${wt}-away`);
    /* Classified while it is genuinely absent... */
    const entries = listWorktrees(primary);
    expect(entries.find((e) => e.path === wt)?.present).toBe(false);
    /* ...and back before the removal acts. */
    renameSync(`${wt}-away`, wt);

    const out = removeWorktree(primary, "worktree-comes-back", LONG_AGO);

    expect(existsSync(path.join(wt, "only-copy.json"))).toBe(true);
    expect(out.ok).toBe(false);
  });

  it("control: a genuinely absent registration is cleared", () => {
    const wt = landedWorktree("worktree-really-gone");
    rmSync(wt, { recursive: true, force: true });

    const out = removeWorktree(primary, "worktree-really-gone", LONG_AGO);
    expect(out.ok).toBe(true);
    expect(listWorktrees(primary).some((e) => e.path === wt)).toBe(false);
  });

  it("clears an absent registration that is still LOCKED", () => {
    /* `prune` exempts locked entries by design — the note in worktree-admin.ts
       says that is how they reached sixteen — and a real Claude worktree is
       always locked, so without unlocking first the command could not clear the
       ghosts it will actually meet. Unlocking a registration whose directory is
       gone cannot lose anything. */
    const wt = landedWorktree("worktree-locked-ghost");
    git(["worktree", "lock", "--reason", "claude session x (pid 999999 start 1)", wt], primary);
    rmSync(wt, { recursive: true, force: true });

    const out = removeWorktree(primary, "worktree-locked-ghost", LONG_AGO);
    expect(out.ok).toBe(true);
    expect(listWorktrees(primary).some((e) => e.path === wt)).toBe(false);
    /* And its branch is not this command's to judge. */
    expect(git(["rev-parse", "--verify", "refs/heads/worktree-locked-ghost"], primary)).not.toBe("");
  });
});

describe("branch deletion, when somebody else took the branch", () => {
  it("REFUSES to delete a branch a worktree has checked out, even at the proved tip", () => {
    /* No A→B→A needed, and the tip CAS cannot see it: `update-ref -d` does not
       refuse a checked-out branch the way `git branch -D` does. Reproduced by GPT
       Sol — the peer was left with a symbolic HEAD pointing at a missing ref and a
       tree reporting "No commits yet".
       Tested at `proveAndDeleteBranch` rather than through `removeWorktree`,
       because the race is a peer creating the worktree AFTER the target was
       resolved as an orphan, and that interleaving cannot be arranged in one
       process — resolution would simply find the peer's tree. This is the guard
       itself, at the point where it has to hold. */
    const wt = landedWorktree("worktree-taken");
    const trunk = git(["rev-parse", "origin/dev"], primary);
    expect(git(["rev-parse", "refs/heads/worktree-taken"], primary)).not.toBe("");

    const steps: string[] = [];
    const ok = proveAndDeleteBranch(primary, "worktree-taken", trunk, steps, false);

    expect(ok).toBe(false);
    expect(steps.join("\n")).toContain("checked out");
    expect(git(["rev-parse", "--verify", "refs/heads/worktree-taken"], primary)).not.toBe("");
    expect(existsSync(path.join(wt, "worktree-taken.txt"))).toBe(true);
  });

  it("control: the same branch, once no worktree holds it, is deleted", () => {
    const wt = landedWorktree("worktree-released");
    const trunk = git(["rev-parse", "origin/dev"], primary);
    git(["worktree", "remove", wt], primary);

    const steps: string[] = [];
    expect(proveAndDeleteBranch(primary, "worktree-released", trunk, steps, false)).toBe(true);
    const check = spawnSync("git", ["rev-parse", "--verify", "refs/heads/worktree-released"], { cwd: primary });
    expect(check.status).not.toBe(0);
  });
});

describe("lookupRef, via the paths that use it", () => {
  it("does not turn a failed read into 'nothing to delete'", () => {
    /* `tryGit` conflated "no such ref" with "could not ask", so a transient
       failure printed a success line over a branch still sitting there. Arranged
       by pointing the lookup at a directory that is not a repository at all. */
    const notARepo = path.join(root, "not-a-repo");
    mkdirSync(notARepo);
    const steps: string[] = [];
    const ok = proveAndDeleteBranch(notARepo, "anything", "0".repeat(40), steps, false);
    expect(ok).toBe(false);
    expect(steps.join("\n")).not.toContain("nothing to delete");
  });
});

describe("gitRemoveWorktree", () => {
  it("clears an ABSENT registration without any --force at all", () => {
    /* Measured, and it is what lets the ghost path drop `--force --force`: a
       ghost whose directory came back between the listing and the removal was
       force-deleted with whatever was in it. */
    const wt = landedWorktree("worktree-absent");
    rmSync(wt, { recursive: true, force: true });

    expect(gitRemoveWorktree(primary, wt).ok).toBe(true);
    expect(listWorktrees(primary).some((e) => e.path === wt)).toBe(false);
  });

  it("REFUSES a directory that came back at a registered path, rather than deleting it", () => {
    /* The ghost race, as far as it can be arranged in one process: the
       registration is stale, the path holds somebody else's files, and with no
       force git revalidates and refuses. */
    const wt = landedWorktree("worktree-restored");
    renameSync(wt, `${wt}-away`);
    mkdirSync(wt);
    writeFileSync(path.join(wt, "the-only-copy.json"), "{}");

    expect(gitRemoveWorktree(primary, wt).ok).toBe(false);
    expect(existsSync(path.join(wt, "the-only-copy.json"))).toBe(true);
  });
});
