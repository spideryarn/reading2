/**
 * Removing a **locked** worktree, which is the case that was broken.
 *
 * scripts/deploy.ts created its gate worktree with `--lock` and removed it with
 * a single `--force`. Git refuses that and says so, the exit code was not
 * checked, and the directory was deleted anyway — leaving a registration
 * pointing at nothing, sixteen times over in four days.
 *
 * So the first test here locks a real worktree before removing it. A test that
 * removed an unlocked one would have passed against the broken code and proved
 * nothing, which is the trap in docs/reusable/silent-success.md.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  devWatchIgnored,
  forceRemoveThrowawayWorktree,
  ghosts,
  parseWorktreeList,
} from "../scripts/worktree-admin.js";

/* ------------------------------------------------------------------ */
/* Against a real repository                                           */
/* ------------------------------------------------------------------ */

let root: string;
let repo: string;

function git(args: string[], cwd = repo): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "spideryarn-wt-test-"));
  repo = path.join(root, "repo");
  git(["init", "--quiet", "-b", "main", repo], root);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  git(["commit", "--quiet", "--allow-empty", "-m", "first"]);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("forceRemoveThrowawayWorktree", () => {
  it("removes a LOCKED worktree — the case a single --force refuses", () => {
    const wt = path.join(root, "locked-tree");
    git(["worktree", "add", "--detach", "--lock", "--reason", "gate is running", "--quiet", wt, "HEAD"]);
    expect(git(["worktree", "list", "--porcelain"])).toContain(wt);

    const r = forceRemoveThrowawayWorktree(wt, repo);

    expect(r.ok).toBe(true);
    expect(git(["worktree", "list", "--porcelain"])).not.toContain(wt);
    expect(existsSync(wt)).toBe(false);
  });

  it("removes an unlocked worktree too", () => {
    const wt = path.join(root, "plain-tree");
    git(["worktree", "add", "--detach", "--quiet", wt, "HEAD"]);
    expect(forceRemoveThrowawayWorktree(wt, repo).ok).toBe(true);
    expect(git(["worktree", "list", "--porcelain"])).not.toContain(wt);
  });

  it("reports failure rather than throwing when the path is not a worktree", () => {
    /* Teardown runs in a `finally`. A throw here would replace whatever real
       failure sent us there. */
    const r = forceRemoveThrowawayWorktree(path.join(root, "never-existed"), repo);
    expect(r.ok).toBe(false);
    expect(r.out).not.toBe("");
  });

  it("leaves a locked worktree registered when git refuses — the old behaviour, shown", () => {
    /* Not a test of our function: a demonstration, against real git, that a
       single --force is refused. This is the fact the fix rests on, so it is
       pinned rather than remembered. */
    const wt = path.join(root, "single-force");
    git(["worktree", "add", "--detach", "--lock", "--reason", "held", "--quiet", wt, "HEAD"]);

    let code = 0;
    try {
      execFileSync("git", ["worktree", "remove", "--force", wt], { cwd: repo, stdio: "pipe" });
    } catch (err) {
      code = (err as { status?: number }).status ?? 0;
    }

    expect(code).not.toBe(0);
    expect(git(["worktree", "list", "--porcelain"])).toContain(wt);

    forceRemoveThrowawayWorktree(wt, repo);
  });
});

/* ------------------------------------------------------------------ */
/* Parsing, against the awkward records                                */
/* ------------------------------------------------------------------ */

describe("parseWorktreeList", () => {
  const sample = [
    "worktree /repo",
    "HEAD abc123",
    "branch refs/heads/main",
    "",
    "worktree /tmp/detached",
    "HEAD def456",
    "detached",
    "",
    "worktree /tmp/held",
    "HEAD 789abc",
    "detached",
    "locked deploy is checking this commit",
    "",
    "worktree /tmp/held-no-reason",
    "HEAD 000fff",
    "detached",
    "locked",
    "",
  ].join("\n");

  it("reads every record, including the locked ones", () => {
    const got = parseWorktreeList(sample, () => true);
    expect(got.map((e) => e.path)).toEqual(["/repo", "/tmp/detached", "/tmp/held", "/tmp/held-no-reason"]);
  });

  it("keeps the branch only where there is one", () => {
    const got = parseWorktreeList(sample, () => true);
    expect(got[0]?.branch).toBe("refs/heads/main");
    expect(got[1]?.branch).toBeUndefined();
  });

  it("distinguishes a bare `locked` from `locked <reason>`", () => {
    const got = parseWorktreeList(sample, () => true);
    expect(got[2]).toMatchObject({ locked: true, lockReason: "deploy is checking this commit" });
    expect(got[3]?.locked).toBe(true);
    expect(got[3]?.lockReason).toBeUndefined();
    expect(got[1]?.locked).toBe(false);
  });

  it("does not drop the last record when there is no trailing blank line", () => {
    const got = parseWorktreeList("worktree /only\nHEAD abc\ndetached", () => true);
    expect(got).toHaveLength(1);
    expect(got[0]?.path).toBe("/only");
  });

  it("returns nothing for empty input", () => {
    expect(parseWorktreeList("", () => true)).toEqual([]);
  });
});

describe("ghosts", () => {
  it("finds the registrations whose directory has gone", () => {
    const entries = parseWorktreeList(
      ["worktree /repo", "branch refs/heads/main", "", "worktree /tmp/gone", "detached", "locked", ""].join("\n"),
      (p) => p === "/repo",
    );
    expect(ghosts(entries).map((e) => e.path)).toEqual(["/tmp/gone"]);
  });

  it("finds none when every path is present", () => {
    const entries = parseWorktreeList("worktree /repo\nbranch refs/heads/main\n", () => true);
    expect(ghosts(entries)).toEqual([]);
  });
});

describe("parseWorktreeList, the records the first version ignored", () => {
  it("marks bare, detached and prunable", () => {
    const got = parseWorktreeList(
      [
        "worktree /bare",
        "bare",
        "",
        "worktree /tmp/pruney",
        "HEAD abc",
        "detached",
        "prunable gitdir file points to non-existent location",
        "",
      ].join("\n"),
      () => true,
    );
    expect(got[0]).toMatchObject({ bare: true, main: true });
    expect(got[1]).toMatchObject({
      detached: true,
      prunable: true,
      prunableReason: "gitdir file points to non-existent location",
    });
  });

  it("keeps HEAD", () => {
    const got = parseWorktreeList("worktree /a\nHEAD deadbeef\nbranch refs/heads/x\n", () => true);
    expect(got[0]?.head).toBe("deadbeef");
  });

  it("marks only the first record as main", () => {
    const got = parseWorktreeList("worktree /a\n\nworktree /b\n\nworktree /c\n", () => true);
    expect(got.map((e) => e.main)).toEqual([true, false, false]);
  });

  it("does not trim a path, because a trailing space is part of it", () => {
    const got = parseWorktreeList("worktree /tmp/trailing \u0000\u0000", () => true);
    expect(got[0]?.path).toBe("/tmp/trailing ");
  });

  it("parses real `git worktree list --porcelain -z` output", () => {
    /* The fixtures above are hand-written and could agree with a parser that is
       wrong about the real format. This one asks git. */
    const wt = path.join(root, "real-z");
    git(["worktree", "add", "--detach", "--lock", "--reason", "a reason with spaces", "--quiet", wt, "HEAD"]);
    const raw = execFileSync("git", ["worktree", "list", "--porcelain", "-z"], { cwd: repo, encoding: "utf8" });

    const got = parseWorktreeList(raw);

    /* realpath, because on macOS `tmpdir()` is /var/folders/… while git reports
       the /private/var/folders/… it resolves to. Comparing the two raw would
       fail for a reason that has nothing to do with parsing. */
    const real = realpathSync(wt);
    expect(got.map((e) => e.path)).toContain(real);
    const entry = got.find((e) => e.path === real);
    expect(entry).toMatchObject({ locked: true, lockReason: "a reason with spaces", detached: true, main: false });
    expect(got[0]?.main).toBe(true);
    forceRemoveThrowawayWorktree(wt, repo);
  });
});

describe("ghosts, the exclusions", () => {
  it("never offers the main worktree, even when its path is missing", () => {
    /* A missing primary checkout is a much bigger problem than a stale
       registration, and offering to remove it is the wrong answer to it. */
    const entries = parseWorktreeList("worktree /repo\nbranch refs/heads/main\n", () => false);
    expect(ghosts(entries)).toEqual([]);
  });

  it("never offers a bare entry, which has no working tree to miss", () => {
    const entries = parseWorktreeList("worktree /repo\n\nworktree /bare\nbare\n", (p) => p === "/repo");
    expect(ghosts(entries)).toEqual([]);
  });

  it("offers a prunable entry even though its path still exists", () => {
    /* existsSync alone misses these: git knows the registration is dead while
       the directory is still sitting there. */
    const entries = parseWorktreeList("worktree /repo\n\nworktree /tmp/here\nprunable gitdir gone\n", () => true);
    expect(ghosts(entries).map((e) => e.path)).toEqual(["/tmp/here"]);
  });
});

/**
 * **The dev server that could not see its own source.**
 *
 * `vite.config.ts` ignores `**​/.claude/worktrees/**` so the primary's page does
 * not reload on a peer's every keystroke. Chokidar matches that against absolute
 * paths, so inside a worktree it matches the server's *own* tree and the watcher
 * ignores everything. The server still starts and the app still works; it just
 * serves the source it read at boot for the rest of its life.
 *
 * These are the two cases, written with the directory handed in, because the
 * broken one cannot be reached from the primary checkout and the only other way
 * to find it is to lose an afternoon to it — which is how it was found.
 */
describe("what the dev server's file watcher ignores", () => {
  it("ignores the other worktrees when it is the primary checkout", () => {
    const got = devWatchIgnored("/home/greg/code/spideryarn2/");
    expect(got).toContain("**/.claude/worktrees/**");
  });

  it("does not ignore its own tree when it is running inside a worktree", () => {
    /* The regression. With this pattern present, every file under the worktree
       matches it, the module graph is never invalidated, and an agent measuring
       its own change in a browser is shown the code from before the change. */
    const got = devWatchIgnored("/home/greg/code/spideryarn2/.claude/worktrees/some-agent/");
    expect(got).not.toContain("**/.claude/worktrees/**");
  });

  it("ignores the three noisy directories either way", () => {
    /* data/, docs/ and evals/ are written by agents while somebody is reading,
       and none of them is imported by the client. Losing those to this change
       would trade one reload storm for another. */
    for (const dir of ["/repo/", "/repo/.claude/worktrees/x/"]) {
      expect(devWatchIgnored(dir)).toEqual(
        expect.arrayContaining(["**/data/**", "**/docs/**", "**/evals/**"]),
      );
    }
  });
});
