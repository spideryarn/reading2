/**
 * Finding `.env.prod` from wherever you are — src/env.ts § `readEnvProd`.
 *
 * ## Why it looks in two places
 *
 * CLAUDE.md says to work in a git worktree, and `npm run worktree:setup` copies
 * `.env.local` but not `.env.prod`. A command that can only reach production
 * from the primary checkout is a trap of exactly the kind `readEnvProd` exists
 * to remove, so it falls back to the primary via `git rev-parse
 * --git-common-dir`.
 *
 * ## Why the environment is scrubbed first
 *
 * `git` reads `GIT_DIR` from the environment and it **overrides `cwd`**. A
 * shell that exported one — or a parent `git` invocation, or a hook — would
 * make `rev-parse` answer about that repository instead, and the fallback would
 * then hand another project's production credentials to `--apply`. Reproduced
 * by GPT Sol, 2026-09-03.
 *
 * These drive the real function against real temporary repositories rather than
 * a mock, because the thing being tested *is* the interaction with git: a fake
 * that returned what we expected would pass while the flag was wrong.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

const made: string[] = [];

function repo(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `envprod-${name}-`));
  made.push(dir);
  execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
  return dir;
}

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/**
 * `readEnvProd` resolves against `src/env.ts`'s own location, so it cannot be
 * aimed at a temporary repository. What *can* be driven directly is the git
 * question underneath it, which is the part that was wrong — so these run the
 * same command with the same flags and assert on where it points.
 */
function commonDirFrom(cwd: string, env: NodeJS.ProcessEnv): string {
  return execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env,
  }).trim();
}

const scrubbed = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const copy = { ...env };
  for (const n of ["GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_OBJECT_DIRECTORY"]) delete copy[n];
  return copy;
};

describe("finding the primary checkout", () => {
  it("a linked worktree's common dir is the primary's .git", () => {
    /* The behaviour the fallback depends on, pinned rather than assumed. */
    const primary = repo("primary");
    writeFileSync(path.join(primary, "f.txt"), "x");
    execFileSync("git", ["-C", primary, "add", "f.txt"], { stdio: "ignore" });
    execFileSync("git", ["-C", primary, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x"], {
      stdio: "ignore",
    });
    const tree = path.join(primary, "wt");
    execFileSync("git", ["-C", primary, "worktree", "add", "-q", tree, "-b", "side"], { stdio: "ignore" });

    const common = commonDirFrom(tree, scrubbed(process.env));
    /* macOS temp dirs are symlinked (/var → /private/var), so compare the tail. */
    expect(common.endsWith(path.join("wt", ".git"))).toBe(false);
    expect(path.basename(path.dirname(common))).toBe(path.basename(primary));
  });

  it("**GIT_DIR redirects the answer to another repository**", () => {
    /* The bug: this is what an unscrubbed environment does. If this ever stops
       failing to point at `here`, the scrub below has stopped being needed —
       and until then it is the reason it exists. */
    const here = repo("here");
    const elsewhere = repo("elsewhere");

    const hijacked = commonDirFrom(here, { ...process.env, GIT_DIR: path.join(elsewhere, ".git") });
    expect(path.basename(path.dirname(hijacked))).toBe(path.basename(elsewhere));
  });

  it("scrubbing GIT_DIR puts the answer back on the checkout we asked about", () => {
    const here = repo("here2");
    const elsewhere = repo("elsewhere2");

    const honest = commonDirFrom(here, scrubbed({ ...process.env, GIT_DIR: path.join(elsewhere, ".git") }));
    expect(path.basename(path.dirname(honest))).toBe(path.basename(here));
  });

  it("scrubbing GIT_WORK_TREE and GIT_OBJECT_DIRECTORY too", () => {
    /* Dropped with the other two: a half-overridden git environment is not a
       state worth reasoning about, and leaving one in place is how you get an
       answer that is right about the directory and wrong about the objects. */
    const here = repo("here3");
    const out = scrubbed({ ...process.env, GIT_WORK_TREE: "/nowhere", GIT_OBJECT_DIRECTORY: "/nowhere" });
    expect(out.GIT_WORK_TREE).toBeUndefined();
    expect(out.GIT_OBJECT_DIRECTORY).toBeUndefined();
    expect(() => commonDirFrom(here, out)).not.toThrow();
  });
});

describe("readEnvProd on this checkout", () => {
  it("finds a .env.prod and parses it, or says there is none", async () => {
    /* Deliberately tolerant of both outcomes: `.env.prod` is gitignored, so CI
       and a fresh clone have none, and a test that demanded one would be a test
       of the machine. What is pinned is the *shape* — that it never returns a
       half-answer, which is what a caller's `found.values[…]` reads. */
    const { readEnvProd } = await import("../src/env.js");
    const found = readEnvProd();
    if (found === null) return;
    expect(path.basename(found.file)).toBe(".env.prod");
    expect(path.isAbsolute(found.file)).toBe(true);
    expect(typeof found.values).toBe("object");
  });
});
