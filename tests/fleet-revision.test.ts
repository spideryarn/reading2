/**
 * `readStartRevision`: what a process records, once, about the checkout its
 * code was started from.
 *
 * The fake-`run` tests pin the mapping from git's answers to the stamp. The
 * scratch-repository tests are the ones that matter: they run the real git
 * against a real repository in a temp directory, and prove two things a fake
 * cannot — that `dirty` counts tracked changes and ignores untracked files, and
 * that the value is a SNAPSHOT: a stamp read before HEAD moved still names the
 * old commit afterwards. A getter would pass every other test here.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { readStartRevision } from "../tools/fleet/revision.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SHA_A = "1".repeat(40);
const AT = new Date("2026-09-10T12:00:00.000Z");

type Run = (argv: string[]) => { status: number; stdout: string; stderr: string };

/** A git that gives one answer to whatever it is asked, and records what it was asked. */
function fakeGit(answer: ReturnType<Run>): { run: Run; calls: string[][] } {
  const calls: string[][] = [];
  const run: Run = (argv) => {
    calls.push(argv);
    return answer;
  };
  return { run, calls };
}

const ok = (stdout: string): ReturnType<Run> => ({ status: 0, stdout, stderr: "" });

/** `git status --porcelain=v2 --branch` output: the headers, then one line per change. */
const porcelain = (oid: string, ...changes: string[]): string =>
  [`# branch.oid ${oid}`, "# branch.head main", ...changes].map((line) => `${line}\n`).join("");

const CHANGE = "1 .M N... 100644 100644 100644 0123456789abcdef0123456789abcdef01234567 0123456789abcdef0123456789abcdef01234567 tools/fleet/server.ts";

describe("readStartRevision over a scripted git", () => {
  test("a clean tree is known and not dirty — from ONE git call", () => {
    const git = fakeGit(ok(porcelain(SHA_A)));
    expect(readStartRevision("/some/checkout", { run: git.run, now: () => AT })).toEqual({
      kind: "known",
      sha: SHA_A,
      dirty: false,
      readAt: AT.toISOString(),
    });
    // One invocation, so the sha and the status describe the same moment: two
    // calls let a commit land between them and pair A's sha with B's cleanness.
    // It asks about the directory it was given, and about tracked files only.
    expect(git.calls).toEqual([["git", "-C", "/some/checkout", "status", "--porcelain=v2", "--branch", "--untracked-files=no"]]);
  });

  test("a tracked change makes it dirty, and the sha is the oid from the same output", () => {
    const git = fakeGit(ok(porcelain(SHA_A, CHANGE)));
    const stamp = readStartRevision("/x", { run: git.run, now: () => AT });
    expect(stamp).toEqual({ kind: "known", sha: SHA_A, dirty: true, readAt: AT.toISOString() });
  });

  test("a git failure is unknown, with git's own reason", () => {
    const git = fakeGit({ status: 128, stdout: "", stderr: "fatal: not a git repository (or any of the parent directories): .git\n" });
    const stamp = readStartRevision("/not/a/repo", { run: git.run, now: () => AT });
    expect(stamp.kind).toBe("unknown");
    if (stamp.kind !== "unknown") throw new Error("expected unknown");
    expect(stamp.why).toContain("not a git repository");
    expect(stamp.readAt).toBe(AT.toISOString());
  });

  test("a status that fails is unknown, not clean", () => {
    // Clean is a claim. A status we could not take must not make it.
    const git = fakeGit({ status: 129, stdout: "", stderr: "error: unknown option" });
    const stamp = readStartRevision("/x", { run: git.run, now: () => AT });
    expect(stamp.kind).toBe("unknown");
    if (stamp.kind !== "unknown") throw new Error("expected unknown");
    expect(stamp.why).toContain("unknown option");
  });

  test("a repository with no commit yet is unknown, and says so", () => {
    const stamp = readStartRevision("/x", { run: fakeGit(ok(porcelain("(initial)"))).run, now: () => AT });
    expect(stamp.kind).toBe("unknown");
    if (stamp.kind !== "unknown") throw new Error("expected unknown");
    expect(stamp.why).toContain("no commit yet");
  });

  test("a missing or garbled oid line is unknown, never a clean guess", () => {
    const outputs = [
      "",
      "# branch.head main\n",
      `# branch.head main\n${CHANGE}\n`,
      "# branch.oid HEAD\n# branch.head main\n",
      `# branch.oid ${SHA_A.slice(0, 12)}\n`,
      `#branch.oid ${SHA_A}\n`,
    ];
    for (const stdout of outputs) {
      expect(readStartRevision("/x", { run: fakeGit(ok(stdout)).run, now: () => AT }).kind, JSON.stringify(stdout)).toBe("unknown");
    }
  });

  test("a run that throws is unknown rather than a crash at startup", () => {
    const stamp = readStartRevision("/x", {
      run: () => {
        throw new Error("spawn git ENOENT");
      },
      now: () => AT,
    });
    expect(stamp.kind).toBe("unknown");
    if (stamp.kind !== "unknown") throw new Error("expected unknown");
    expect(stamp.why).toContain("ENOENT");
  });
});

describe("readStartRevision against a real scratch repository", () => {
  function scratchRepo(): { dir: string; commit(file: string, body: string): string } {
    const dir = mkdtempSync(join(tmpdir(), "fleet-revision-test-"));
    dirs.push(dir);
    const git = (...args: string[]): string => {
      const env = { ...process.env };
      for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) delete env[name];
      const out = spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], {
        encoding: "utf8",
        env,
      });
      if (out.status !== 0) throw new Error(`git ${args.join(" ")}: ${out.stderr}`);
      return out.stdout.trim();
    };
    git("init", "-q");
    return {
      dir,
      commit(file, body) {
        writeFileSync(join(dir, file), body);
        git("add", "--", file);
        git("commit", "-q", "-m", `write ${file}`);
        return git("rev-parse", "HEAD");
      },
    };
  }

  test("the value does not change after HEAD moves: it is a snapshot, not a getter", () => {
    const repo = scratchRepo();
    const first = repo.commit("a.txt", "one\n");
    const atStart = readStartRevision(repo.dir);
    expect(atStart).toMatchObject({ kind: "known", sha: first, dirty: false });
    const frozen = JSON.stringify(atStart);

    const second = repo.commit("a.txt", "two\n");
    expect(second).not.toBe(first);
    // The earlier stamp still names the commit the tree was at when it was read.
    expect(JSON.stringify(atStart)).toBe(frozen);
    // And a fresh read sees the move, so the repository really did change.
    expect(readStartRevision(repo.dir)).toMatchObject({ kind: "known", sha: second });
  });

  test("a tracked change is dirty; an untracked file alone is not", () => {
    const repo = scratchRepo();
    repo.commit("a.txt", "one\n");
    writeFileSync(join(repo.dir, "stranger.txt"), "another agent's scratch file\n");
    expect(readStartRevision(repo.dir)).toMatchObject({ kind: "known", dirty: false });
    writeFileSync(join(repo.dir, "a.txt"), "edited\n");
    expect(readStartRevision(repo.dir)).toMatchObject({ kind: "known", dirty: true });
  });

  test("a repository with no commit yet is unknown, from the real git's output", () => {
    const repo = scratchRepo();
    const stamp = readStartRevision(repo.dir);
    expect(stamp.kind).toBe("unknown");
    if (stamp.kind !== "unknown") throw new Error("expected unknown");
    expect(stamp.why).toContain("no commit yet");
  });

  test("a directory that is not a repository is unknown", () => {
    const dir = mkdtempSync(join(tmpdir(), "fleet-revision-norepo-"));
    dirs.push(dir);
    const stamp = readStartRevision(dir);
    expect(stamp.kind).toBe("unknown");
  });
});
