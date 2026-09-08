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
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  classifyRegistration,
  deleteRefIfUnmoved,
  landedProof,
  reachableOids,
  removeWorktree,
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
  const base = { path: "/x", head: "abc", locked: false, prunable: false, present: true, main: false, bare: false };

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
    expect(oids).toContain(stray);
    expect(landedProof(primary, oids, trunk).kind).toBe("not-landed");
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
});
