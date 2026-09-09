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

/**
 * The same, dated `agoSeconds` in the past.
 *
 * **Age the fixture; do not move the clock.** Every other test in this file
 * pushes `now` forward instead, and that is why none of them could see the bug
 * of 2026-09-07: the sweep was reading a timestamp it had stamped itself a
 * moment earlier, and activity stamped at the real now still reads as a day idle
 * against a `now` a day in the future. An injectable clock looks like the
 * testable design and is the one thing that cannot catch a signal stuck to the
 * present. A backdated commit can.
 */
function commitAged(cwd: string, file: string, body: string, message: string, agoSeconds: number): void {
  writeFileSync(path.join(cwd, file), body);
  git(["add", "--", file], cwd);
  const when = new Date((Date.now() - agoSeconds * 1000)).toISOString();
  execFileSync("git", ["commit", "--quiet", "-m", message], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
  });
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
  it("does NOT advertise a brand-new worktree, which passes every check but the age floor", () => {
    freshWorktree("brand-new");

    const row = rowFor(classifyAll(primary), "worktree-brand-new");

    /* `young` since 2026-09-09, not `keep`: nothing is wrong with it, and the
       report still must not hand a third party a paste-ready removal. Printing it
       as `REMOVABLE` is what this guard exists to prevent, so that is the
       assertion that matters. */
    expect(row.verdict.kind).toBe("young");
    expect(row.verdict.kind).not.toBe("removable");
    if (row.verdict.kind !== "young") throw new Error("unreachable");
    expect(row.verdict.why).toContain(`${MIN_IDLE_HOURS}h floor`);
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

  /**
   * The trap: a worktree created just now, sitting on a commit made days ago.
   * A fast-forward merge writes no commit of its own, so HEAD's date is whatever
   * the trunk commit was dated, and a brand-new tree can be born looking
   * abandoned. It must still be held.
   *
   * **The previous version of this test proved nothing, twice over**, and both
   * ways are worth keeping in view:
   *
   *   - its comment said "backdate the trunk commit far past the floor", and the
   *     code backdated nothing — the `beforeEach` commits at real-now, so the
   *     "old" commit was a second old and the trap could not arise;
   *   - its assertion was `lastActivity >= headTime` where `lastActivity` is
   *     `Math.max(headTime, …)` over that same number. `max(x, …) >= x` holds
   *     for every input, so it could not fail.
   *
   * The commit is now genuinely aged, and the assertion is on the quantity that
   * matters: how idle this tree looks against the **real** clock.
   */
  it("holds a worktree created just now on a commit made days ago", () => {
    const OLD = 5 * 24 * HOUR;
    commitAged(primary, "ancient.txt", "old\n", "a commit from days ago", OLD);

    const wt = path.join(root, "ff");
    git(["worktree", "add", "--quiet", "-b", "worktree-ff", wt, "HEAD"], primary);

    const row = rowFor(classifyAll(primary), "worktree-ff");

    /* Not `>= headTime`: that is the vacuous form. The tree was made moments
       ago, so its activity must be recent in absolute terms, whatever HEAD says. */
    expect(row.facts.lastActivity).not.toBeNull();
    expect(now() - (row.facts.lastActivity?.at ?? 0)).toBeLessThan(HOUR);
    expect(row.verdict.kind).toBe("keep");
  });

  /**
   * The sweep must not be able to keep a worktree alive by looking at it.
   *
   * This is asserted by classifying twice rather than by pinning `lastActivity`
   * to a known instant, because the failure it exists for is *drift*: the
   * classification runs `git status` inside each worktree, which rewrites that
   * worktree's index and so bumps its admin directory's mtime, and
   * `lastActivityAt` read that mtime back as evidence the tree was alive. Every
   * worktree on the box therefore reported "active 1 min ago" — one of them had
   * not been touched for five days — and `worktree:sweep` printed "nothing to
   * remove", which is also what a healthy tree prints.
   *
   * The rest of this file could not catch it, and the reason is worth keeping:
   * these tests move `now` **forward** (`now() + 25 * HOUR`) rather than moving
   * the worktree's activity back, so activity stamped at the real now still
   * reads as a day idle. The clock was the wrong axis.
   *
   * The sleep is real and it is the point — the stamp only shows up once the
   * second hand has moved, since these are whole-second timestamps.
   */
  it("does not count its own reading of a worktree as activity", async () => {
    freshWorktree("read-twice");

    const first = rowFor(classifyAll(primary), "worktree-read-twice").facts.lastActivity;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = rowFor(classifyAll(primary), "worktree-read-twice").facts.lastActivity;

    /* Vacuity guard: two nulls compare equal while measuring nothing at all, and
       "could not tell when it was last active" is itself a keep, so the sweep
       would look fine either way. */
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
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
    lastActivity: { at: 0, signal: "HEAD last moved" },
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
      base({ check: { ...clean, dirty: ["M x"], trunk: { kind: "ahead", commits: ["abc one"] } }, lastActivity: { at: 999 * HOUR, signal: "HEAD last moved" } }),
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
    rmSync(wt, { recursive: true, force: true });

    const out = removeOne(primary, "worktree-ghosted", { now: now() + 999 * HOUR });

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

    const out = removeOne(primary, "worktree-ghosted-unlanded", { now: now() + 999 * HOUR });

    expect(out.ok).toBe(false);
    expect(git(["worktree", "list", "--porcelain"], primary)).toContain(wt);
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
