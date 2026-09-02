/**
 * A worktree that starts stale, against a real git repository.
 *
 * The bug this guards is not a crash: a worktree branched from the primary's
 * `HEAD` while `origin/dev` had moved on, and everything looked fine. So the
 * first test asserts the *number of commits it was missing* rather than merely
 * that a merge ran — a merge of a trunk it already contained would pass a
 * weaker test and prove nothing (docs/reusable/silent-success.md).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { describeFreshen, freshenFromTrunk, freshenIsFatal } from "../scripts/worktree-freshen.js";

let root: string;
/** Stands in for `origin`: a real repo the others fetch from. */
let origin: string;
/** Stands in for the primary checkout, which is behind `origin`. */
let primary: string;

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commit(cwd: string, file: string, body: string, message: string): void {
  writeFileSync(path.join(cwd, file), body);
  git(["add", "--", file], cwd);
  git(["commit", "--quiet", "-m", message], cwd);
}

function identify(cwd: string): void {
  git(["config", "user.email", "test@example.com"], cwd);
  git(["config", "user.name", "Test"], cwd);
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "spideryarn-freshen-"));
  origin = path.join(root, "origin");
  primary = path.join(root, "primary");

  git(["init", "--quiet", "-b", "dev", origin], root);
  identify(origin);
  commit(origin, "shared.txt", "one\n", "first");

  git(["clone", "--quiet", origin, primary], root);
  identify(primary);

  /* origin/dev moves on; the primary does not pull. This is the situation on the
     box: every agent pushes to origin/dev when it finishes. */
  commit(origin, "later.txt", "a\n", "trunk moved");
  commit(origin, "later2.txt", "b\n", "trunk moved again");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A worktree of the primary, branched from its local HEAD — `baseRef: "head"`. */
function worktreeFromPrimaryHead(name: string): string {
  const wt = path.join(root, name);
  git(["worktree", "add", "--quiet", "-b", `worktree-${name}`, wt, "HEAD"], primary);
  return wt;
}

describe("freshenFromTrunk", () => {
  it("pulls in the trunk commits a HEAD-branched worktree never had", () => {
    const wt = worktreeFromPrimaryHead("stale");
    expect(git(["rev-list", "--count", "HEAD"], wt)).toBe("1");

    const r = freshenFromTrunk(wt, "dev");

    expect(r.kind).toBe("merged");
    if (r.kind !== "merged") throw new Error("unreachable");
    expect(r.count).toBe(2);
    expect(git(["rev-list", "--count", "HEAD"], wt)).toBe("3");
    expect(describeFreshen(r, "dev")).toContain("2 commits");
    expect(freshenIsFatal(r)).toBe(false);
  });

  it("keeps a commit the primary has not pushed, rather than branching from the remote", () => {
    commit(primary, "unpushed.txt", "local\n", "primary work not yet pushed");
    const wt = worktreeFromPrimaryHead("both");

    const r = freshenFromTrunk(wt, "dev");

    expect(r.kind).toBe("merged");
    const log = git(["log", "--format=%s"], wt);
    expect(log).toContain("primary work not yet pushed");
    expect(log).toContain("trunk moved again");
  });

  it("says already-level and merges nothing when the trunk is contained", () => {
    const wt = worktreeFromPrimaryHead("level");
    expect(freshenFromTrunk(wt, "dev").kind).toBe("merged");
    const after = git(["rev-parse", "HEAD"], wt);

    const r = freshenFromTrunk(wt, "dev");

    expect(r.kind).toBe("already-level");
    expect(git(["rev-parse", "HEAD"], wt)).toBe(after);
  });

  it("refuses to merge over modified tracked files, and touches nothing", () => {
    const wt = worktreeFromPrimaryHead("dirty");
    writeFileSync(path.join(wt, "shared.txt"), "edited by an agent\n");
    const before = git(["rev-parse", "HEAD"], wt);

    const r = freshenFromTrunk(wt, "dev");

    expect(r.kind).toBe("dirty");
    if (r.kind !== "dirty") throw new Error("unreachable");
    expect(r.files.join(" ")).toContain("shared.txt");
    expect(git(["rev-parse", "HEAD"], wt)).toBe(before);
    expect(freshenIsFatal(r)).toBe(false);
  });

  it("stops the setup on a conflict rather than resolving it", () => {
    /* Both sides touch the same line of the same file. */
    commit(origin, "clash.txt", "from the trunk\n", "trunk edits clash.txt");
    const wt = worktreeFromPrimaryHead("conflict");
    commit(wt, "clash.txt", "from the worktree\n", "worktree edits clash.txt");

    const r = freshenFromTrunk(wt, "dev");

    expect(r.kind).toBe("conflict");
    expect(freshenIsFatal(r)).toBe(true);
    /* Left mid-merge on purpose, for a human to read. */
    expect(git(["status", "--porcelain"], wt)).toContain("clash.txt");
  });

  it("reports a fetch failure instead of pretending it is current", () => {
    const wt = worktreeFromPrimaryHead("offline");
    git(["remote", "set-url", "origin", path.join(root, "no-such-repo")], primary);

    const r = freshenFromTrunk(wt, "dev");

    expect(r.kind).toBe("fetch-failed");
    expect(freshenIsFatal(r)).toBe(false);
    expect(describeFreshen(r, "dev")).toContain("may be behind");
  });
});
