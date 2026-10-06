/**
 * `scripts/prune-old-screenshots.ts`: which screenshots count as a week old,
 * and what the commit that deletes them may and may not contain.
 *
 * Every test builds a real git repository with dated commits, because the two
 * ways to get this wrong are both about git's own behaviour: a path-limited
 * `git log` skips the merge that brought an old branch in yesterday, and a
 * `git commit` with an empty pathspec commits the index.
 *
 * docs/plans/261006m-box-disk-hygiene-timer-and-a-rebuildable-box.md, stage 2.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { applyPrune, oldScreenshots } from "../scripts/prune-old-screenshots.js";

const DAY = 24 * 60 * 60;
/** A fixed "now", so the dates below read as plain arithmetic. 2026-10-07T00:00:00Z. */
const NOW = 1_791_331_200;
const daysAgo = (n: number) => NOW - n * DAY;

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), "prune-shots-test-"));
  made.push(dir);
  const git = (args: string[], when?: number) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
        ...(when === undefined ? {} : { GIT_AUTHOR_DATE: `${when} +0000`, GIT_COMMITTER_DATE: `${when} +0000` }),
      },
    });
  const write = (file: string, body = "png") => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), body);
  };
  /** Write `files` and commit them, dated `when`. */
  const commit = (files: string[], when: number, body = "png") => {
    for (const file of files) write(file, body);
    git(["add", "--", ...files]);
    git(["commit", "-q", "-m", `add ${files.join(" ")}`, "--", ...files], when);
  };
  git(["init", "-q", "-b", "dev"]);
  commit(["README.md"], daysAgo(60));
  return { dir, git, write, commit };
}

describe("oldScreenshots", () => {
  it("lists an image committed eight days ago and not one committed six days ago", () => {
    const r = repo();
    r.commit(["docs/plans/260920a-shot-old.png"], daysAgo(8));
    r.commit(["docs/plans/261001a-shot-new.png"], daysAgo(6));
    expect(oldScreenshots(r.dir, NOW)).toEqual(["docs/plans/260920a-shot-old.png"]);
  });

  it("looks only in the dated folders, and only at images", () => {
    const r = repo();
    r.commit(
      [
        "docs/plans/a.png",
        "docs/investigations/b.JPG",
        "docs/postmortems/c.webp",
        "docs/research/d.gif",
        "docs/user-feedback/e.jpeg",
        "docs/plans/notes.md",
        "docs/project/diagram.png",
        "docs/tutorials/figure.png",
        "docs/reusable/example.png",
        "src/web/public/logo.png",
      ],
      daysAgo(30),
    );
    expect(oldScreenshots(r.dir, NOW)).toEqual([
      "docs/investigations/b.JPG",
      "docs/plans/a.png",
      "docs/postmortems/c.webp",
      "docs/research/d.gif",
      "docs/user-feedback/e.jpeg",
    ]);
  });

  it("goes by the committer date, not the author date", () => {
    // A cherry-pick or an amended commit keeps the author date it was written
    // with. The screenshot reached this history two days ago.
    const r = repo();
    r.write("docs/plans/shot.png");
    r.git(["add", "--", "docs/plans/shot.png"]);
    execFileSync("git", ["commit", "-q", "-m", "picked", "--", "docs/plans/shot.png"], {
      cwd: r.dir,
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
        GIT_AUTHOR_DATE: `${daysAgo(40)} +0000`,
        GIT_COMMITTER_DATE: `${daysAgo(2)} +0000`,
      },
    });
    expect(oldScreenshots(r.dir, NOW)).toEqual([]);
  });

  it("keeps an image whose old branch was merged yesterday", () => {
    // The commit that added it is 20 days old; `git log -1 -- <file>` says so
    // and is the wrong answer. It arrived on dev yesterday.
    const r = repo();
    r.git(["checkout", "-q", "-b", "side"]);
    r.commit(["docs/plans/260915a-shot-side.png"], daysAgo(20));
    r.git(["checkout", "-q", "dev"]);
    r.commit(["docs/plans/unrelated.md"], daysAgo(15));
    r.git(["merge", "-q", "--no-ff", "-m", "merge side", "side"], daysAgo(1));
    expect(oldScreenshots(r.dir, NOW)).toEqual([]);
  });

  it("does list it once that merge is itself more than a week old", () => {
    const r = repo();
    r.git(["checkout", "-q", "-b", "side"]);
    r.commit(["docs/plans/260915a-shot-side.png"], daysAgo(20));
    r.git(["checkout", "-q", "dev"]);
    r.commit(["docs/plans/unrelated.md"], daysAgo(15));
    r.git(["merge", "-q", "--no-ff", "-m", "merge side", "side"], daysAgo(9));
    expect(oldScreenshots(r.dir, NOW)).toEqual(["docs/plans/260915a-shot-side.png"]);
  });

  it("treats a renamed image as being as new as its rename", () => {
    const r = repo();
    r.commit(["docs/plans/before.png"], daysAgo(30));
    r.git(["mv", "docs/plans/before.png", "docs/plans/after.png"]);
    r.git(["commit", "-q", "-m", "rename", "--", "docs/plans/before.png", "docs/plans/after.png"], daysAgo(3));
    expect(oldScreenshots(r.dir, NOW)).toEqual([]);
  });

  it("keeps an image a merge resolution rewrote yesterday", () => {
    const r = repo();
    r.commit(["docs/plans/shot.png"], daysAgo(30), "original");
    r.git(["checkout", "-q", "-b", "side"]);
    r.commit(["docs/plans/shot.png"], daysAgo(20), "theirs");
    r.git(["checkout", "-q", "dev"]);
    r.commit(["docs/plans/shot.png"], daysAgo(19), "ours");
    try {
      r.git(["merge", "-q", "--no-ff", "-m", "merge side", "side"], daysAgo(1));
    } catch {
      r.write("docs/plans/shot.png", "resolved by hand");
      r.git(["add", "--", "docs/plans/shot.png"]);
      r.git(["commit", "-q", "-m", "merge side"], daysAgo(1));
    }
    expect(oldScreenshots(r.dir, NOW)).toEqual([]);
  });
});

describe("applyPrune", () => {
  const noGuard = () => null;

  it("commits the deletion of exactly the old screenshots, and leaves a peer's staged work staged", () => {
    const r = repo();
    r.commit(["docs/plans/old.png", "docs/plans/also-old.png"], daysAgo(30));
    r.commit(["docs/plans/new.png", "src/peer.ts"], daysAgo(2));
    // A peer has staged an edit and left another unstaged. Neither is ours.
    r.write("src/peer.ts", "staged by a peer");
    r.git(["add", "--", "src/peer.ts"]);
    r.write("README.md", "edited, unstaged");

    const result = applyPrune(r.dir, NOW, noGuard);

    expect(result).toMatchObject({ kind: "committed", files: 2 });
    expect(r.git(["show", "--name-status", "--format=", "HEAD"]).trim().split("\n").sort()).toEqual([
      "D\tdocs/plans/also-old.png",
      "D\tdocs/plans/old.png",
    ]);
    expect(existsSync(path.join(r.dir, "docs/plans/new.png"))).toBe(true);
    expect(r.git(["status", "--porcelain"]).trimEnd().split("\n").sort()).toEqual([" M README.md", "M  src/peer.ts"]);
  });

  it("makes no commit at all when nothing is old enough, even with a peer's work staged", () => {
    // An empty pathspec would turn `git commit` into an index commit, and the
    // peer's staged file would go out under this script's message.
    const r = repo();
    r.commit(["docs/plans/new.png", "src/peer.ts"], daysAgo(2));
    r.write("src/peer.ts", "staged by a peer");
    r.git(["add", "--", "src/peer.ts"]);
    const before = r.git(["rev-parse", "HEAD"]);

    expect(applyPrune(r.dir, NOW, noGuard)).toEqual({ kind: "nothing-to-do" });

    expect(r.git(["rev-parse", "HEAD"])).toBe(before);
    expect(r.git(["status", "--porcelain"]).trim()).toBe("M  src/peer.ts");
  });

  it("refuses, deleting nothing, when an old screenshot has an uncommitted change", () => {
    const r = repo();
    r.commit(["docs/plans/old.png", "docs/plans/edited.png"], daysAgo(30));
    r.write("docs/plans/edited.png", "somebody is redoing this one");
    const before = r.git(["rev-parse", "HEAD"]);

    const result = applyPrune(r.dir, NOW, noGuard);

    expect(result.kind).toBe("refused");
    expect(existsSync(path.join(r.dir, "docs/plans/old.png"))).toBe(true);
    expect(r.git(["rev-parse", "HEAD"])).toBe(before);
  });

  it("refuses when the staged-revert guard objects, and during a merge", () => {
    const r = repo();
    r.commit(["docs/plans/old.png"], daysAgo(30));
    expect(applyPrune(r.dir, NOW, () => "the index is stale")).toEqual({ kind: "refused", why: "the index is stale" });

    r.git(["checkout", "-q", "-b", "side"]);
    r.commit(["conflict.txt"], daysAgo(5), "theirs");
    r.git(["checkout", "-q", "dev"]);
    r.commit(["conflict.txt"], daysAgo(4), "ours");
    expect(() => r.git(["merge", "-q", "-m", "m", "side"])).toThrow();
    expect(applyPrune(r.dir, NOW, noGuard)).toMatchObject({ kind: "refused", why: expect.stringContaining("merge is in progress") });
    expect(existsSync(path.join(r.dir, "docs/plans/old.png"))).toBe(true);
  });

  it("handles a file name with a space and one that looks like a pathspec", () => {
    const r = repo();
    r.commit(["docs/plans/a shot.png", "docs/plans/odd*.png", "docs/plans/oddball.png"], daysAgo(30));
    r.commit(["docs/plans/oddball.png"], daysAgo(1), "touched again");
    // A peer is part way through redoing the recent one, which the `*` in the
    // second name would match if it were read as a glob. This pins the outcome
    // only: git 2.43 was seen to commit just the exact name with or without
    // GIT_LITERAL_PATHSPECS, so removing that setting does not turn this red.
    r.write("docs/plans/oddball.png", "a peer's unfinished edit");

    expect(applyPrune(r.dir, NOW, noGuard)).toMatchObject({ kind: "committed", files: 2 });
    expect(r.git(["status", "--porcelain"]).trimEnd()).toBe(" M docs/plans/oddball.png");
  });
});
