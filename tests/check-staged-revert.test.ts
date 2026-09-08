/**
 * The guard in the commit recipe, which had no test at all until 2026-09-07 —
 * which is why it took a year to notice it could not read a merge, and could be
 * made to approve a merge commit that dropped every incoming change.
 *
 * **These run the real CLI** with `cwd` set to a scratch repository, rather than
 * importing its internals. The alternative was threading a `cwd` parameter
 * through production code so the tests could reach in; GPT Sol's review argued
 * against it and was right — what matters here is the exit code an agent's shell
 * sees, and a test that imports `findings()` cannot check that at all. Nothing
 * in `scripts/check-staged-revert.ts` changed shape to make it testable.
 *
 * Each test is somebody else's control. The two that matter most are the pair
 * around a merge: a clean merge must pass, and a merge whose index has been
 * replaced by `HEAD` must fail. Before this file existed the first was a failure
 * and the second was a `✓`.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "check-staged-revert.ts",
);

let repo: string;

function git(args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
  }).trim();
}

function commit(file: string, body: string, message: string): string {
  writeFileSync(path.join(repo, file), body);
  git(["add", "--", file]);
  git(["commit", "--quiet", "-m", message]);
  return git(["rev-parse", "HEAD"]);
}

interface Run {
  code: number;
  out: string;
}

/** The check, as an agent's shell sees it: an exit code and some words. */
function check(): Run {
  try {
    const out = execFileSync("npx", ["tsx", SCRIPT], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), "staged-revert-"));
  git(["init", "--quiet", "-b", "dev", "."]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("outside a merge", () => {
  it("passes a clean index", () => {
    commit("a.txt", "one\n", "first");

    const r = check();

    expect(r.code).toBe(0);
    expect(r.out).toContain("✓");
  });

  /**
   * The positive control, and the reason the rest of this file is not just a
   * demonstration that the check has been switched off.
   */
  it("catches a staged revert of a commit", () => {
    commit("a.txt", "one\n", "first");
    commit("a.txt", "one\ntwo — the work being undone\n", "adds the second line");
    /* Something else staged, so the index is not itself a clean snapshot of an
       ancestor — otherwise `staleSnapshot()` answers first, correctly but about
       the whole index, and this per-path branch never runs. */
    writeFileSync(path.join(repo, "elsewhere.txt"), "unrelated new work\n");
    git(["add", "--", "elsewhere.txt"]);

    /* Stage exactly what the path held before that commit. */
    git(["checkout", "HEAD~1", "--", "a.txt"]);

    const r = check();

    expect(r.code).toBe(1);
    expect(r.out).toContain("a.txt");
    expect(r.out).toContain("adds the second line");
  });

  it("catches a staged deletion of a file HEAD still has", () => {
    commit("a.txt", "one\n", "first");
    commit("keep.txt", "precious\n", "adds a file");
    writeFileSync(path.join(repo, "elsewhere.txt"), "unrelated new work\n");
    git(["add", "--", "elsewhere.txt"]);

    git(["rm", "--quiet", "--cached", "--", "keep.txt"]);

    const r = check();

    expect(r.code).toBe(1);
    expect(r.out).toContain("keep.txt");
    expect(r.out).toContain("DELETION");
  });

  /**
   * The whole-index case, which answers before the per-path walk because one
   * line naming staleness beats a list of paths that all have the same cause.
   */
  it("names a whole-index stale snapshot rather than listing its paths", () => {
    commit("a.txt", "one\n", "first");
    commit("b.txt", "two\n", "second");

    git(["read-tree", "HEAD~1"]);

    const r = check();

    expect(r.code).toBe(1);
    expect(r.out).toContain("clean snapshot");
    expect(r.out).toContain("1 commit(s) behind HEAD");
  });

  /**
   * "Could not tell" must not exit 0.
   *
   * It did until 2026-09-07: the only-unknowns branch printed a leading `✓` and
   * returned without setting an exit code, so a run that judged nothing looked
   * exactly like a run that found nothing — in the file whose whole subject is
   * that failure shape.
   */
  it("exits non-zero when it ran out of history and could not judge", () => {
    /* More commits touching one path than the 40-commit window. */
    for (let i = 0; i < 45; i++) commit("churn.txt", `v${i}\n`, `change ${i}`);
    writeFileSync(path.join(repo, "churn.txt"), "content from no commit at all\n");
    git(["add", "--", "churn.txt"]);

    const r = check();

    expect(r.code).toBe(1);
    expect(r.out).toContain("could not tell");
    expect(r.out).not.toContain("✓");
  });
});

describe("during a merge", () => {
  /** dev retires something on purpose; this branch never touched it. */
  function mergeWhereTheirSideDeletes(): void {
    commit("a.txt", "one\n", "first");
    commit("tombstone.txt", "obsolete\n", "adds the tombstone");
    git(["branch", "mine"]);

    git(["rm", "--quiet", "--", "tombstone.txt"]);
    git(["commit", "--quiet", "-m", "dev retires the tombstone"]);
    const devTip = git(["rev-parse", "HEAD"]);

    git(["checkout", "--quiet", "mine"]);
    commit("mine.txt", "my work\n", "unrelated work of mine");
    git(["merge", "--no-commit", "--no-ff", devTip]);
  }

  /**
   * The false positive that started this. The incoming side's deliberate
   * deletion used to be reported as a revert, with `git reset -- <path>`
   * attached — advice that mid-merge puts the deleted file back and produces a
   * merge commit undoing their work.
   */
  it("passes a clean merge that deletes a file on the incoming side", () => {
    mergeWhereTheirSideDeletes();

    const r = check();

    expect(r.code).toBe(0);
    expect(r.out).toContain("merge");
    expect(r.out).not.toContain("tombstone.txt");
  });

  /**
   * The one that matters most, and the one no per-path rule can catch.
   *
   * A stale index equal to `HEAD` makes `git diff --cached HEAD` empty, so there
   * are no paths to walk and nothing to report. The commit that follows has two
   * parents and none of the incoming work; the incoming commit becomes an
   * ancestor, so every "did it land?" check says yes while the code is gone.
   */
  it("catches an index that has been reset to HEAD mid-merge, dropping the whole merge", () => {
    commit("a.txt", "one\n", "first");
    git(["branch", "mine"]);
    commit("incoming.txt", "important work from the other side\n", "dev adds a file");
    const devTip = git(["rev-parse", "HEAD"]);
    git(["checkout", "--quiet", "mine"]);
    commit("mine.txt", "my work\n", "unrelated work of mine");
    git(["merge", "--no-commit", "--no-ff", devTip]);

    /* The stale index: a snapshot taken before the merge. */
    git(["read-tree", "HEAD"]);

    /* Nothing differs from HEAD, which is precisely why the old shape was blind. */
    expect(git(["diff", "--cached", "--name-status", "HEAD"])).toBe("");

    const r = check();

    expect(r.code).toBe(1);
    expect(r.out).not.toContain("✓");
    expect(r.out).toContain("merge");
  });

  /** A hand-resolved conflict cannot be judged — and must not be waved through. */
  it("stands aside from a hand-resolved conflict without recommending reset", () => {
    commit("both.txt", "original\n", "first");
    git(["branch", "mine"]);
    commit("both.txt", "their version\n", "dev edits the line");
    const devTip = git(["rev-parse", "HEAD"]);
    git(["checkout", "--quiet", "mine"]);
    commit("both.txt", "my version\n", "I edit the same line");

    try {
      git(["merge", "--no-commit", "--no-ff", devTip]);
    } catch {
      /* expected: a conflict */
    }
    writeFileSync(path.join(repo, "both.txt"), "a considered blend of both\n");
    git(["add", "--", "both.txt"]);

    const r = check();

    expect(r.code).toBe(1);
    expect(r.out).not.toContain("✓");
    /* The advice that would destroy the incoming side must not appear. */
    expect(r.out).not.toMatch(/`git reset -- /);
  });
});
