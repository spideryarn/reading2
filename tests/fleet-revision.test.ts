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

/** A git that answers by subcommand, and records what it was asked. */
function fakeGit(answers: { revParse: ReturnType<Run>; status: ReturnType<Run> }): { run: Run; calls: string[][] } {
  const calls: string[][] = [];
  const run: Run = (argv) => {
    calls.push(argv);
    if (argv.includes("rev-parse")) return answers.revParse;
    if (argv.includes("status")) return answers.status;
    throw new Error(`unexpected git call: ${argv.join(" ")}`);
  };
  return { run, calls };
}

const ok = (stdout: string): ReturnType<Run> => ({ status: 0, stdout, stderr: "" });

describe("readStartRevision over a scripted git", () => {
  test("a clean tree is known and not dirty", () => {
    const git = fakeGit({ revParse: ok(`${SHA_A}\n`), status: ok("") });
    expect(readStartRevision("/some/checkout", { run: git.run, now: () => AT })).toEqual({
      kind: "known",
      sha: SHA_A,
      dirty: false,
      readAt: AT.toISOString(),
    });
    // It asks about the directory it was given, and about tracked files only.
    expect(git.calls).toContainEqual(["git", "-C", "/some/checkout", "rev-parse", "HEAD"]);
    expect(git.calls).toContainEqual(["git", "-C", "/some/checkout", "status", "--porcelain", "--untracked-files=no"]);
  });

  test("a tracked change makes it dirty", () => {
    const git = fakeGit({ revParse: ok(SHA_A), status: ok(" M tools/fleet/server.ts\n") });
    const stamp = readStartRevision("/x", { run: git.run, now: () => AT });
    expect(stamp).toMatchObject({ kind: "known", sha: SHA_A, dirty: true });
  });

  test("a git failure is unknown, with git's own reason", () => {
    const git = fakeGit({
      revParse: { status: 128, stdout: "", stderr: "fatal: not a git repository (or any of the parent directories): .git\n" },
      status: ok(""),
    });
    const stamp = readStartRevision("/not/a/repo", { run: git.run, now: () => AT });
    expect(stamp.kind).toBe("unknown");
    if (stamp.kind !== "unknown") throw new Error("expected unknown");
    expect(stamp.why).toContain("not a git repository");
    expect(stamp.readAt).toBe(AT.toISOString());
  });

  test("a status that fails is unknown, not clean", () => {
    // Clean is a claim. A status we could not take must not make it.
    const git = fakeGit({ revParse: ok(SHA_A), status: { status: 129, stdout: "", stderr: "error: unknown option" } });
    const stamp = readStartRevision("/x", { run: git.run, now: () => AT });
    expect(stamp.kind).toBe("unknown");
    if (stamp.kind !== "unknown") throw new Error("expected unknown");
    expect(stamp.why).toContain("unknown option");
  });

  test("something that is not a sha is unknown", () => {
    const git = fakeGit({ revParse: ok("HEAD\n"), status: ok("") });
    expect(readStartRevision("/x", { run: git.run, now: () => AT }).kind).toBe("unknown");
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

  test("a directory that is not a repository is unknown", () => {
    const dir = mkdtempSync(join(tmpdir(), "fleet-revision-norepo-"));
    dirs.push(dir);
    const stamp = readStartRevision(dir);
    expect(stamp.kind).toBe("unknown");
  });
});
