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

import { blockers, type CheckFacts } from "../scripts/worktree-check.js";
import {
  classifyAll,
  classifyOne,
  gatherAll,
  MIN_IDLE_HOURS,
  removeOne,
  type SweepFacts,
  type Verdict,
} from "../scripts/worktree-sweep.js";
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
    expect(row.facts.check).not.toHaveProperty("error");
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
    expectRelaysEveryBlocker(row);
  });

  it("counts an untracked file as work, so a scratch file is not swept away", () => {
    const wt = freshWorktree("untracked");
    writeFileSync(path.join(wt, "notes.md"), "half an idea\n");

    const row = rowFor(classifyAll(primary, { now: now() + 999 * HOUR }), "worktree-untracked");

    expect(row.verdict.kind).toBe("keep");
    if (row.verdict.kind !== "keep") throw new Error("unreachable");
    expectRelaysEveryBlocker(row);
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
    lastActivity: 0,
    current: false,
    check: clean,
    ...over,
  });

  it("says UNJUDGEABLE, never removable, when the tree could not be read", () => {
    const v = classifyOne(base({ check: { error: "EACCES walking data/" } }), { now: 999 * HOUR });
    expect(v.kind).toBe("unjudgeable");
    if (v.kind !== "unjudgeable") throw new Error("unreachable");
    expect(v.why).toContain("EACCES");
  });

  it("keeps the worktree you are standing in, however landed", () => {
    const v = classifyOne(base({ current: true }), { now: 999 * HOUR });
    expect(v.kind).toBe("keep");
    if (v.kind !== "keep") throw new Error("unreachable");
    expect(v.reasons.join(" ")).toContain("standing in it");
  });

  it("treats an unknown trunk standing as a keep, not as landed", () => {
    const v = classifyOne(base({ check: { ...clean, trunk: { kind: "unknown", why: "fetch failed" } } }), {
      now: 999 * HOUR,
    });
    expect(v.kind).toBe("keep");
  });

  it("blocks on gitignored strays that git status cannot see — the whole point", () => {
    /* `dirty` is empty and the trunk is landed: every signal the old sweep had
       says removable. Only the ignored-state check disagrees. */
    const stray: CheckFacts = { ...clean, unexplained: ["data/some-article/"] };
    const v = classifyOne(base({ check: stray }), { now: 999 * HOUR });
    expect(v.kind).toBe("keep");
    if (v.kind !== "keep") throw new Error("unreachable");
    /* Whatever worktree-check calls it — the point is that the sweep says the
       thing the check said, and would have said nothing on its own. */
    expect(v.reasons).toEqual(blockers(stray).map((b) => b.why));
  });

  it("calls a registration with no directory a ghost, even when nothing could be read", () => {
    const v = classifyOne(base({ entry: { ...base({}).entry, present: false }, check: { error: "gone" } }), { now: 0 });
    expect(v.kind).toBe("ghost");
  });

  it("gives every reason at once rather than the first", () => {
    const v = classifyOne(
      base({ check: { ...clean, dirty: ["M x"], trunk: { kind: "ahead", commits: ["abc one"] } }, lastActivity: 999 * HOUR }),
      { now: 999 * HOUR },
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
      return { linked: true, branch: "x", inProgress: [], dirty: [], hidden: [], unexplained: [], notes: [], verified: [], disposable: 0, trunk: { kind: "landed" } };
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
    expect(classifyOne(row!, { now: now() + 999 * HOUR }).kind).toBe("unjudgeable");
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
    expect(out.steps.length).toBeGreaterThan(1);
    expect(existsSync(wt)).toBe(true);
  });

  it("refuses a worktree whose work has not landed, and says so", () => {
    const wt = freshWorktree("unlanded");
    commit(wt, "mine.txt", "work\n", "not pushed");

    const out = removeOne(primary, "worktree-unlanded", { now: now() + 999 * HOUR });

    expect(out.ok).toBe(false);
    expect(out.steps.length).toBeGreaterThan(1);
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
