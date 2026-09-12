/**
 * The sweep, and the case that retired the version before it.
 *
 * A brand-new worktree is clean and contains the trunk, so every mechanical
 * check says "removable". That is not an edge case here: `worktree:setup` merges
 * `origin/dev`, so it is the state of every worktree for its first day. Until
 * 2026-09-12 a 24-hour age floor kept such a tree off the list; now the question
 * is asked directly — is its session alive, is anything running in it — so the
 * tests below create exactly that fresh tree three times: with nobody in it
 * (removable), with a live session named in its lock, and with a process
 * standing in it (both kept).
 *
 * The removal tests run against real git, because the guard that matters most is
 * git's own refusal to remove a dirty tree, and a mocked git cannot refuse.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { blockers, type CheckFacts } from "../scripts/worktree-check.js";
import { parseStat } from "../scripts/worktree-inuse.js";
import { classifyAll, classifyOne, gatherAll, removeOne, type SweepFacts, type Verdict } from "../scripts/worktree-sweep.js";
import { listWorktrees } from "../scripts/worktree-admin.js";

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

const spawned: number[] = [];

/**
 * A live process that is not this one's ancestor, standing in `cwd` — a peer's
 * session, as far as `/proc` can tell. Detached, so it has a process group of its
 * own: the cwd scan excludes the asker's group, and a plain child would be
 * excluded along with it.
 */
function liveProcess(cwd: string): { pid: number; start: number } {
  const child = spawn("sleep", ["120"], { cwd, detached: true, stdio: "ignore" });
  if (child.pid === undefined) throw new Error("could not spawn sleep");
  spawned.push(child.pid);
  const mine = parseStat(readFileSync(`/proc/${process.pid}/stat`, "utf8"));
  if (mine === null) throw new Error("could not read this process's group");

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const stat = parseStat(readFileSync(`/proc/${child.pid}/stat`, "utf8"));
      const childCwd = readlinkSync(`/proc/${child.pid}/cwd`);
      if (stat !== null && childCwd === path.resolve(cwd) && stat.pgrp !== mine.pgrp) {
        return { pid: child.pid, start: stat.start };
      }
    } catch {
      /* Still starting, or exited; the deadline turns either into a hard fail. */
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  throw new Error("sleep never became a detached process in the requested cwd");
}

afterEach(() => {
  for (const pid of spawned.splice(0)) {
    try {
      process.kill(pid);
    } catch {
      /* Already gone. */
    }
  }
});

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "spideryarn-sweep-"));
  origin = path.join(root, "origin");
  primary = path.join(root, "primary");

  git(["init", "--quiet", "-b", "dev", origin], root);
  git(["config", "user.email", "test@example.com"], origin);
  git(["config", "user.name", "Test"], origin);
  commit(origin, "shared.txt", "one\n", "first");

  git(["clone", "--quiet", origin, primary], root);
  git(["config", "user.email", "test@example.com"], primary);
  git(["config", "user.name", "Test"], primary);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A worktree in the state `worktree:setup` leaves one in: clean, at the trunk. */
function freshWorktree(name: string): string {
  const wt = path.join(root, name);
  git(["worktree", "add", "--quiet", "-b", `worktree-${name}`, wt, "HEAD"], primary);
  return wt;
}

/**
 * The sweep must surface **every** blocker `worktree:check` found, and it must
 * not paraphrase them.
 *
 * Asserted against `blockers()` rather than against the message text, on
 * purpose: those strings belong to worktree-check.ts and get reworded by whoever
 * owns it — one was reworded the same afternoon this landed. A test that pins
 * the prose would go red at that, reporting a defect that is not there, and the
 * contract worth holding is the relay, not the wording.
 */
function expectRelaysEveryBlocker(row: { facts: SweepFacts; verdict: Verdict }): void {
  if (row.verdict.kind !== "keep") throw new Error(`expected a keep, got ${row.verdict.kind}`);
  if ("error" in row.facts.check) throw new Error("expected readable facts");
  const expected = blockers(row.facts.check).map((b) => b.why);
  expect(expected.length).toBeGreaterThan(0);
  expect(row.verdict.reasons).toEqual(expect.arrayContaining(expected));
}

function rowFor(rows: ReturnType<typeof classifyAll>, branch: string) {
  const row = rows.find((r) => r.facts.branch === branch);
  if (row === undefined) throw new Error(`no row for ${branch}`);
  return row;
}

describe("classifyAll, against real worktrees", () => {
  it("advertises a brand-new landed tree that nobody owns or is in as REMOVABLE — there is no age floor", () => {
    freshWorktree("fresh-and-done");
    const row = rowFor(classifyAll(primary), "worktree-fresh-and-done");
    expect(row.verdict.kind).toBe("removable");
  });

  it("does NOT advertise a brand-new worktree whose session is still alive", () => {
    /* The case that retired the sibling repo's sweep, and the one the age floor
       used to catch. Every mechanical check passes; only liveness keeps it. The
       session is a live process that is not our ancestor, named in the lock the
       way `claude --worktree` names one, with its cwd outside the tree. */
    const wt = freshWorktree("peer-alive");
    const peer = liveProcess(root);
    git(["worktree", "lock", "--reason", `claude session peer (pid ${peer.pid} start ${peer.start})`, wt], primary);

    const row = rowFor(classifyAll(primary), "worktree-peer-alive");

    expect(row.facts.check).not.toHaveProperty("error");
    expect(row.verdict.kind).toBe("keep");
    if (row.verdict.kind !== "keep") throw new Error("unreachable");
    expect(row.verdict.reasons.join(" ")).toContain("still running");
  });

  it("does NOT advertise a brand-new worktree a process is running inside", () => {
    const wt = freshWorktree("occupied");
    liveProcess(wt);

    const row = rowFor(classifyAll(primary), "worktree-occupied");

    expect(row.verdict.kind).toBe("keep");
    if (row.verdict.kind !== "keep") throw new Error("unreachable");
    expect(row.verdict.reasons.join(" ")).toContain("running inside it");
  });

  it("keeps a worktree whose commits have not landed on the trunk", () => {
    const wt = freshWorktree("unlanded");
    commit(wt, "mine.txt", "work\n", "work nobody has pushed");

    const row = rowFor(classifyAll(primary), "worktree-unlanded");

    expect(row.verdict.kind).toBe("keep");
    if (row.verdict.kind !== "keep") throw new Error("unreachable");
    expectRelaysEveryBlocker(row);
  });

  it("counts an untracked file as work, so a scratch file is not swept away", () => {
    const wt = freshWorktree("untracked");
    writeFileSync(path.join(wt, "notes.md"), "half an idea\n");

    const row = rowFor(classifyAll(primary), "worktree-untracked");

    expect(row.verdict.kind).toBe("keep");
    if (row.verdict.kind !== "keep") throw new Error("unreachable");
    expectRelaysEveryBlocker(row);
  });

  it("never offers the primary checkout", () => {
    const rows = classifyAll(primary);
    const main = rows.find((r) => r.facts.entry.main);
    expect(main?.verdict.kind).toBe("skip");
  });
});

describe("classifyOne, on facts alone", () => {
  const clean: CheckFacts = {
    linked: true,
    branch: "worktree-x",
    inProgress: [],
    dirty: [],
    hidden: [],
    unexplained: [],
    notes: [],
    verified: [],
    disposable: 0,
    trunk: { kind: "landed" },
    listeners: { kind: "checked", found: [] },
  };

  const base = (over: Partial<SweepFacts>): SweepFacts => ({
    branch: "worktree-x",
    entry: {
      path: "/tmp/wt",
      branch: "refs/heads/worktree-x",
      head: "abc",
      detached: false,
      locked: true,
      prunable: false,
      bare: false,
      main: false,
      present: true,
    },
    inUse: { kind: "idle", notes: [] },
    current: false,
    check: clean,
    ...over,
  });

  it("control: clean, landed, nobody in it — removable", () => {
    expect(classifyOne(base({})).kind).toBe("removable");
  });

  it("keeps a tree somebody is in, and says who", () => {
    const v = classifyOne(base({ inUse: { kind: "in-use", reasons: ["its Claude session is still running — x"] } }));
    expect(v.kind).toBe("keep");
    if (v.kind !== "keep") throw new Error("unreachable");
    expect(v.reasons).toContain("its Claude session is still running — x");
  });

  it("keeps a tree when it could not tell whether anybody is in it", () => {
    /* The removal refuses on this, so the report must not advertise it. */
    const v = classifyOne(base({ inUse: { kind: "unknown", why: ["pid 9 (python3) hides its working directory"] } }));
    expect(v.kind).toBe("keep");
    if (v.kind !== "keep") throw new Error("unreachable");
    expect(v.reasons.join(" ")).toContain("could not tell whether anybody is in it");
  });

  it("keeps a tree whose liveness was never read", () => {
    expect(classifyOne(base({ inUse: null })).kind).toBe("keep");
  });

  it("says UNJUDGEABLE, never removable, when the tree could not be read", () => {
    const v = classifyOne(base({ check: { error: "EACCES walking data/" } }));
    expect(v.kind).toBe("unjudgeable");
    if (v.kind !== "unjudgeable") throw new Error("unreachable");
    expect(v.why).toContain("EACCES");
  });

  it("keeps the worktree you are standing in, however landed", () => {
    const v = classifyOne(base({ current: true }));
    expect(v.kind).toBe("keep");
    if (v.kind !== "keep") throw new Error("unreachable");
    expect(v.reasons.join(" ")).toContain("standing in it");
  });

  it("treats an unknown trunk standing as a keep, not as landed", () => {
    const v = classifyOne(base({ check: { ...clean, trunk: { kind: "unknown", why: "fetch failed" } } }));
    expect(v.kind).toBe("keep");
  });

  it("blocks on gitignored strays that git status cannot see — the whole point", () => {
    /* `dirty` is empty and the trunk is landed: every signal the old sweep had
       says removable. Only the ignored-state check disagrees. */
    const stray: CheckFacts = { ...clean, unexplained: ["data/some-article/"] };
    const v = classifyOne(base({ check: stray }));
    expect(v.kind).toBe("keep");
    if (v.kind !== "keep") throw new Error("unreachable");
    /* Whatever worktree-check calls it — the point is that the sweep says the
       thing the check said, and would have said nothing on its own. */
    expect(v.reasons).toEqual(blockers(stray).map((b) => b.why));
  });

  it("calls a registration with no directory a ghost, even when nothing could be read", () => {
    const v = classifyOne(base({ entry: { ...base({}).entry, present: false }, check: { error: "gone" } }));
    expect(v.kind).toBe("ghost");
  });

  it("gives every reason at once rather than the first", () => {
    const v = classifyOne(
      base({
        check: { ...clean, dirty: ["M x"], trunk: { kind: "ahead", commits: ["abc one"] } },
        inUse: { kind: "in-use", reasons: ["a process is running inside it — pid 9 (sleep)"] },
      }),
    );
    if (v.kind !== "keep") throw new Error("unreachable");
    expect(v.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe("gatherAll", () => {
  it("does not let one tree's failure cost the others their answers", () => {
    const wtA = freshWorktree("survivor-a");
    freshWorktree("thrower");
    const entries = listWorktrees(primary);

    const facts = gatherAll(primary, entries, { kind: "sha", sha: "HEAD" }, (root) => {
      if (root.includes("thrower")) throw new Error("EACCES walking data/");
      return { linked: true, branch: "x", inProgress: [], dirty: [], hidden: [], unexplained: [], notes: [], verified: [], disposable: 0, trunk: { kind: "landed" }, listeners: { kind: "checked", found: [] } };
    });

    const thrower = facts.find((f) => f.branch === "worktree-thrower");
    const survivor = facts.find((f) => f.branch === "worktree-survivor-a");
    expect(thrower?.check).toEqual({ error: expect.stringContaining("EACCES") });
    expect(survivor?.check).not.toHaveProperty("error");
    expect(existsSync(wtA)).toBe(true);
  });

  it("marks every tree unjudgeable when the one central fetch failed", () => {
    freshWorktree("no-trunk");
    const facts = gatherAll(primary, listWorktrees(primary), { kind: "failed", why: "offline" });
    const row = facts.find((f) => f.branch === "worktree-no-trunk");
    expect(row?.check).toEqual({ error: "offline" });
    expect(classifyOne(row!).kind).toBe("unjudgeable");
  });
});

describe("removeOne", () => {
  it("removes a landed worktree and deletes its branch", () => {
    const wt = freshWorktree("done");

    const out = removeOne(primary, "worktree-done");

    expect(out.ok).toBe(true);
    expect(existsSync(wt)).toBe(false);
    expect(git(["branch", "--list", "worktree-done"], primary)).toBe("");
  });

  it("re-runs the guards itself, so a stale verdict cannot be handed to it", () => {
    const wt = freshWorktree("changed-its-mind");
    /* Classified removable a moment ago; now the agent working in it saves a file. */
    expect(rowFor(classifyAll(primary), "worktree-changed-its-mind").verdict.kind).toBe(
      "removable",
    );
    writeFileSync(path.join(wt, "in-progress.ts"), "half a change\n");

    const out = removeOne(primary, "worktree-changed-its-mind");

    expect(out.ok).toBe(false);
    expect(out.steps.length).toBeGreaterThan(1);
    expect(existsSync(wt)).toBe(true);
  });

  it("refuses a worktree whose work has not landed, and says so", () => {
    const wt = freshWorktree("unlanded");
    commit(wt, "mine.txt", "work\n", "not pushed");

    const out = removeOne(primary, "worktree-unlanded");

    expect(out.ok).toBe(false);
    expect(out.steps.length).toBeGreaterThan(1);
    expect(existsSync(wt)).toBe(true);
  });

  it("--dry-run says what it would do and does none of it", () => {
    const wt = freshWorktree("dry");

    const out = removeOne(primary, "worktree-dry", { dryRun: true });

    expect(out.ok).toBe(true);
    expect(out.steps.join(" ")).toContain("would remove");
    expect(existsSync(wt)).toBe(true);
    expect(git(["branch", "--list", "worktree-dry"], primary)).toContain("worktree-dry");
  });

  it("unregisters a ghost but leaves its branch, whose commits it cannot judge", () => {
    const wt = freshWorktree("ghosted");
    rmSync(wt, { recursive: true, force: true });

    const out = removeOne(primary, "worktree-ghosted");

    expect(out.ok).toBe(true);
    expect(git(["worktree", "list", "--porcelain"], primary)).not.toContain(wt);
    expect(git(["branch", "--list", "worktree-ghosted"], primary)).toContain("worktree-ghosted");
  });

  it("REFUSES a ghost whose gone tree's reflog names work the trunk does not have", () => {
    /* This test used to make exactly this unlanded commit and assert the ghost
       was unregistered anyway — which unregisters the admin directory holding the
       only reflog that names it. Since 2026-09-09 a ghost gets the same landed
       proof a live tree gets: the directory is gone, the metadata is not, and
       reading it is the difference between a stale registration and a loss.
       docs/project/worktrees.md § Sweeping them up. */
    const wt = freshWorktree("ghosted-unlanded");
    commit(wt, "mine.txt", "work\n", "unlanded work on the branch");
    rmSync(wt, { recursive: true, force: true });

    const out = removeOne(primary, "worktree-ghosted-unlanded");

    expect(out.ok).toBe(false);
    expect(git(["worktree", "list", "--porcelain"], primary)).toContain(wt);
  });

  it("removes a LOCKED worktree, which is what claude --worktree creates", () => {
    /* The fixtures above are unlocked, so nothing else here reaches the unlock
       step — and a locked worktree refuses a plain `git worktree remove`. Every
       real worktree on this box is locked, so an untested unlock would mean the
       removal never worked outside these tests. */
    const wt = path.join(root, "locked");
    /* In the shape `claude --worktree` writes, naming a session that is gone: an
       unrecognised reason is an unknown, and an unknown refuses. */
    git(
      ["worktree", "add", "--lock", "--reason", "claude session x (pid 999999 start 1)", "--quiet", "-b", "worktree-locked", wt, "HEAD"],
      primary,
    );

    const out = removeOne(primary, "worktree-locked");

    expect(out.ok).toBe(true);
    expect(out.steps.join(" ")).toContain("unlocked");
    expect(existsSync(wt)).toBe(false);
    expect(git(["worktree", "list", "--porcelain"], primary)).not.toContain(wt);
  });

  it("says so when no worktree is on that branch", () => {
    const out = removeOne(primary, "worktree-imaginary");
    expect(out.ok).toBe(false);
    expect(out.steps.join(" ")).toContain("no worktree is on branch");
  });
});
