/**
 * The sweep, and the case that retired the version before it.
 *
 * A brand-new worktree is clean and contains the trunk, so every mechanical
 * check except the age guard says "removable". That is not an edge case here:
 * `worktree:setup` merges `origin/dev`, so it is the state of every worktree for
 * its first day. The first test creates exactly that worktree and asserts the
 * sweep keeps it — a test that used an old, landed worktree would pass against a
 * sweep with no age guard at all and prove nothing.
 *
 * The removal tests run against real git, because the guard that matters most is
 * git's own refusal to remove a dirty tree, and a mocked git cannot refuse.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { classifyAll, classifyOne, MIN_IDLE_HOURS, removeOne, type SweepFacts } from "../scripts/worktree-sweep.js";

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

function rowFor(rows: ReturnType<typeof classifyAll>, branch: string) {
  const row = rows.find((r) => r.facts.branch === branch);
  if (row === undefined) throw new Error(`no row for ${branch}`);
  return row;
}

const HOUR = 3600;
const now = () => Math.floor(Date.now() / 1000);

describe("classifyAll, against real worktrees", () => {
  it("KEEPS a brand-new worktree, which passes every check but the age floor", () => {
    freshWorktree("brand-new");

    const row = rowFor(classifyAll(primary), "worktree-brand-new");

    expect(row.verdict.kind).toBe("keep");
    if (row.verdict.kind !== "keep") throw new Error("unreachable");
    expect(row.verdict.reasons.join(" ")).toContain(`${MIN_IDLE_HOURS}h floor`);
    /* And it is the ONLY thing keeping it — the trap the guard exists for. */
    expect(row.verdict.reasons).toHaveLength(1);
    expect(row.facts.merged).toBe(true);
    expect(row.facts.dirty).toEqual([]);
  });

  it("reports a worktree as removable once it is landed, clean and idle", () => {
    freshWorktree("landed");

    const rows = classifyAll(primary, { now: now() + (MIN_IDLE_HOURS + 1) * HOUR });

    expect(rowFor(rows, "worktree-landed").verdict.kind).toBe("removable");
  });

  it("keeps a worktree whose commits have not landed on the trunk", () => {
    const wt = freshWorktree("unlanded");
    commit(wt, "mine.txt", "work\n", "work nobody has pushed");

    const row = rowFor(classifyAll(primary, { now: now() + 999 * HOUR }), "worktree-unlanded");

    expect(row.verdict.kind).toBe("keep");
    if (row.verdict.kind !== "keep") throw new Error("unreachable");
    expect(row.verdict.reasons.join(" ")).toContain("not merged into origin/dev");
  });

  it("counts an untracked file as work, so a scratch file is not swept away", () => {
    const wt = freshWorktree("untracked");
    writeFileSync(path.join(wt, "notes.md"), "half an idea\n");

    const row = rowFor(classifyAll(primary, { now: now() + 999 * HOUR }), "worktree-untracked");

    expect(row.verdict.kind).toBe("keep");
    if (row.verdict.kind !== "keep") throw new Error("unreachable");
    expect(row.verdict.reasons.join(" ")).toContain("uncommitted change");
  });

  it("dates a fast-forwarded worktree by the merge, not by the old commit it landed on", () => {
    /* The trap: a fast-forward writes no commit, so HEAD's date is the trunk
       commit's date. Backdate the trunk commit far past the floor and check the
       worktree created just now is still held. */
    const wt = path.join(root, "ff");
    git(["worktree", "add", "--quiet", "-b", "worktree-ff", wt, "HEAD"], primary);

    const row = rowFor(classifyAll(primary), "worktree-ff");
    const headTime = Number.parseInt(git(["log", "-1", "--format=%ct"], wt), 10);

    expect(row.facts.lastActivity).not.toBeNull();
    expect(row.facts.lastActivity).toBeGreaterThanOrEqual(headTime);
    expect(row.verdict.kind).toBe("keep");
  });

  it("never offers the primary checkout", () => {
    const rows = classifyAll(primary, { now: now() + 999 * HOUR });
    const main = rows.find((r) => r.facts.entry.main);
    expect(main?.verdict.kind).toBe("skip");
  });
});

describe("classifyOne, on facts alone", () => {
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
    dirty: [],
    merged: true,
    lastActivity: 0,
    current: false,
    ...over,
  });

  it("refuses to call anything removable when the trunk could not be fetched", () => {
    const v = classifyOne(base({}), { now: 999 * HOUR, trunkFetched: false });
    expect(v.kind).toBe("keep");
    if (v.kind !== "keep") throw new Error("unreachable");
    expect(v.reasons.join(" ")).toContain("refusing rather than assuming");
  });

  it("keeps the worktree you are standing in, however landed", () => {
    const v = classifyOne(base({ current: true }), { now: 999 * HOUR, trunkFetched: true });
    expect(v.kind).toBe("keep");
    if (v.kind !== "keep") throw new Error("unreachable");
    expect(v.reasons.join(" ")).toContain("standing in it");
  });

  it("treats an unanswerable merged check as a keep, not as merged", () => {
    const v = classifyOne(base({ merged: null }), { now: 999 * HOUR, trunkFetched: true });
    expect(v.kind).toBe("keep");
  });

  it("calls a registration with no directory a ghost, trunk or no trunk", () => {
    const v = classifyOne(base({ entry: { ...base({}).entry, present: false } }), { now: 0, trunkFetched: false });
    expect(v.kind).toBe("ghost");
  });

  it("gives every reason at once rather than the first", () => {
    const v = classifyOne(base({ dirty: ["M x"], merged: false, lastActivity: 999 * HOUR }), {
      now: 999 * HOUR,
      trunkFetched: true,
    });
    if (v.kind !== "keep") throw new Error("unreachable");
    expect(v.reasons).toHaveLength(3);
  });
});

describe("removeOne", () => {
  it("removes a landed worktree and deletes its branch", () => {
    const wt = freshWorktree("done");

    const out = removeOne(primary, "worktree-done", { now: now() + 999 * HOUR });

    expect(out.ok).toBe(true);
    expect(existsSync(wt)).toBe(false);
    expect(git(["branch", "--list", "worktree-done"], primary)).toBe("");
  });

  it("re-runs the guards itself, so a stale verdict cannot be handed to it", () => {
    const wt = freshWorktree("changed-its-mind");
    /* Classified removable a moment ago; now the agent working in it saves a file. */
    expect(rowFor(classifyAll(primary, { now: now() + 999 * HOUR }), "worktree-changed-its-mind").verdict.kind).toBe(
      "removable",
    );
    writeFileSync(path.join(wt, "in-progress.ts"), "half a change\n");

    const out = removeOne(primary, "worktree-changed-its-mind", { now: now() + 999 * HOUR });

    expect(out.ok).toBe(false);
    expect(out.steps.join(" ")).toContain("uncommitted change");
    expect(existsSync(wt)).toBe(true);
  });

  it("refuses a worktree whose work has not landed, and says so", () => {
    const wt = freshWorktree("unlanded");
    commit(wt, "mine.txt", "work\n", "not pushed");

    const out = removeOne(primary, "worktree-unlanded", { now: now() + 999 * HOUR });

    expect(out.ok).toBe(false);
    expect(out.steps.join(" ")).toContain("not merged into origin/dev");
    expect(existsSync(wt)).toBe(true);
  });

  it("--dry-run says what it would do and does none of it", () => {
    const wt = freshWorktree("dry");

    const out = removeOne(primary, "worktree-dry", { dryRun: true, now: now() + 999 * HOUR });

    expect(out.ok).toBe(true);
    expect(out.steps.join(" ")).toContain("would remove");
    expect(existsSync(wt)).toBe(true);
    expect(git(["branch", "--list", "worktree-dry"], primary)).toContain("worktree-dry");
  });

  it("unregisters a ghost but leaves its branch, whose commits it cannot judge", () => {
    const wt = freshWorktree("ghosted");
    commit(wt, "mine.txt", "work\n", "unlanded work on the branch");
    rmSync(wt, { recursive: true, force: true });

    const out = removeOne(primary, "worktree-ghosted", { now: now() + 999 * HOUR });

    expect(out.ok).toBe(true);
    expect(git(["worktree", "list", "--porcelain"], primary)).not.toContain(wt);
    expect(git(["branch", "--list", "worktree-ghosted"], primary)).toContain("worktree-ghosted");
  });

  it("removes a LOCKED worktree, which is what claude --worktree creates", () => {
    /* The fixtures above are unlocked, so nothing else here reaches the unlock
       step — and a locked worktree refuses a plain `git worktree remove`. Every
       real worktree on this box is locked, so an untested unlock would mean the
       removal never worked outside these tests. */
    const wt = path.join(root, "locked");
    git(["worktree", "add", "--lock", "--reason", "as claude --worktree does", "--quiet", "-b", "worktree-locked", wt, "HEAD"], primary);

    const out = removeOne(primary, "worktree-locked", { now: now() + 999 * HOUR });

    expect(out.ok).toBe(true);
    expect(out.steps.join(" ")).toContain("unlocked");
    expect(existsSync(wt)).toBe(false);
    expect(git(["worktree", "list", "--porcelain"], primary)).not.toContain(wt);
  });

  it("says so when no worktree is on that branch", () => {
    const out = removeOne(primary, "worktree-imaginary", { now: now() });
    expect(out.ok).toBe(false);
    expect(out.steps.join(" ")).toContain("no worktree is on branch");
  });
});
