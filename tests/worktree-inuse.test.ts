/**
 * The two liveness signals, and the composition that must not fail open.
 *
 * Every case here is arranged against a **fake `/proc`**, because each one that
 * matters is a state you cannot reliably produce on a real box inside a test: a
 * pid that has just died, a pid that has been recycled onto the same number, a
 * live process whose cwd will not be read, a process belonging to somebody else.
 * The parsers are exercised against real `/proc` text as well, at the bottom,
 * because a fake that agrees with a wrong parser proves nothing.
 *
 * The shape of the suite is the one the repo's other guards use: **every guard is
 * confirmed by making it refuse**, with a control beside it, because a check that
 * refuses everything passes the same assertions as a check that works.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ancestry,
  composeInUse,
  cwdUsersUnder,
  type CwdScan,
  type OwnerStanding,
  ownerStanding,
  parseLockOwner,
  parseStat,
  type ProcId,
  type ProcTable,
} from "../scripts/worktree-inuse.js";

/* ------------------------------------------------------------ a fake /proc -- */

interface FakeProc {
  ppid?: number;
  start: number;
  cwd?: string | { unreadable: string };
  uid?: number;
  command?: string;
}

/** `/proc/<pid>/stat`, spelled the way the kernel spells it. */
function statLine(pid: number, comm: string, ppid: number, start: number): string {
  /* Fields 3..21 are placeholders; only state, ppid and starttime are read. The
     comm deliberately carries a space and a paren in some tests. */
  const middle = Array.from({ length: 17 }, () => "0").join(" ");
  return `${pid} (${comm}) S ${ppid} ${middle} ${start} 0 0`;
}

function fakeProc(table: Record<number, FakeProc>, self = 1000): ProcTable {
  return {
    stat(pid) {
      const p = table[pid];
      return p === undefined ? null : statLine(pid, "bash", p.ppid ?? 1, p.start);
    },
    cwd(pid) {
      const p = table[pid];
      if (p === undefined || p.cwd === undefined) return { kind: "unreadable", why: "gone" };
      if (typeof p.cwd === "string") return { kind: "path", path: p.cwd };
      return { kind: "unreadable", why: p.cwd.unreadable };
    },
    uid(pid) {
      const p = table[pid];
      return p === undefined ? null : (p.uid ?? self);
    },
    pids: () => Object.keys(table).map((k) => Number.parseInt(k, 10)),
    command: (pid) => table[pid]?.command ?? "some-command",
    self: () => self,
  };
}

const TREE = "/home/greg/code/spideryarn2/.claude/worktrees/demo";

/* ------------------------------------------------------------------ parsing -- */

describe("parseLockOwner", () => {
  it("reads the pid and start time claude --worktree writes", () => {
    expect(parseLockOwner("claude session 260908k-worktree-removal (pid 1097274 start 73180403)")).toEqual({
      session: "260908k-worktree-removal",
      pid: 1097274,
      start: 73180403,
    });
  });

  it("returns null for a lock somebody wrote by hand, rather than guessing at it", () => {
    expect(parseLockOwner("do not touch, I am mid-migration")).toBeNull();
    expect(parseLockOwner("claude session x (pid abc start 1)")).toBeNull();
    expect(parseLockOwner(undefined)).toBeNull();
  });
});

describe("parseStat", () => {
  it("counts from the last ')', so a comm with a space and a paren cannot shift the fields", () => {
    /* `tmux: server` is on the box right now. A whitespace split of the whole
       line puts starttime one field left of where it is, silently. */
    const line = `132280 (tmux: server (x)) S 1 ${Array.from({ length: 17 }, () => "0").join(" ")} 99 0 0`;
    expect(parseStat(line)).toEqual({ ppid: 1, start: 99 });
  });

  it("agrees with the real /proc on this very process", () => {
    const mine = parseStat(readFileSync(`/proc/${process.pid}/stat`, "utf8"));
    expect(mine).not.toBeNull();
    expect(mine?.ppid).toBe(process.ppid);
    expect(mine?.start).toBeGreaterThan(0);
  });

  it("returns null rather than NaN for a line it cannot read", () => {
    expect(parseStat("not a stat line")).toBeNull();
  });
});

describe("ancestry", () => {
  it("walks to pid 1 and carries the start time of every step", () => {
    const proc = fakeProc({ 40: { ppid: 30, start: 4 }, 30: { ppid: 20, start: 3 }, 20: { ppid: 1, start: 2 } });
    expect(ancestry(proc, 40)).toEqual([
      { pid: 40, start: 4 },
      { pid: 30, start: 3 },
      { pid: 20, start: 2 },
    ]);
  });

  it("terminates on a circular chain rather than hanging the removal", () => {
    const proc = fakeProc({ 10: { ppid: 11, start: 1 }, 11: { ppid: 10, start: 2 } });
    expect(ancestry(proc, 10, 8)).toHaveLength(8);
  });
});

/* ----------------------------------------------------------------- signal A -- */

describe("ownerStanding", () => {
  const reason = "claude session demo (pid 500 start 777)";

  it("REFUSES: the owning session is alive and is not the process asking", () => {
    const proc = fakeProc({ 500: { start: 777, command: "claude" }, 90: { ppid: 1, start: 9 } });
    const standing = ownerStanding(proc, reason, ancestry(proc, 90));
    expect(standing.kind).toBe("alive");
    expect(composeInUse(standing, { kind: "checked", found: [], unknown: 0 }).kind).toBe("in-use");
  });

  it("ALLOWS: the owner is alive and is in the asker's ancestor chain — the owner is asking", () => {
    const proc = fakeProc({ 500: { ppid: 1, start: 777 }, 90: { ppid: 500, start: 9 } });
    const standing = ownerStanding(proc, reason, ancestry(proc, 90));
    expect(standing.kind).toBe("asking");
    expect(composeInUse(standing, { kind: "checked", found: [], unknown: 0 }).kind).toBe("idle");
  });

  it("ALLOWS: the pid is gone, so the lock is stale", () => {
    const proc = fakeProc({ 90: { ppid: 1, start: 9 } });
    expect(ownerStanding(proc, reason, ancestry(proc, 90)).kind).toBe("stale");
  });

  it("ALLOWS: the pid was recycled — same number, different start time", () => {
    /* Without the start time this reads as "the owner is alive" for ever, and the
       tree could never be removed. It is the whole reason the lock carries one. */
    const proc = fakeProc({ 500: { ppid: 1, start: 999 }, 90: { ppid: 1, start: 9 } });
    const standing = ownerStanding(proc, reason, ancestry(proc, 90));
    expect(standing.kind).toBe("stale");
    if (standing.kind === "stale") expect(standing.why).toContain("reused");
  });

  it("does NOT mistake a recycled pid in the ancestor chain for the owner", () => {
    /* The asker's parent happens to be pid 500 — but a different pid 500. A bare
       pid comparison would grant ownership to a stranger. */
    const proc = fakeProc({ 500: { ppid: 1, start: 999 }, 90: { ppid: 500, start: 9 } });
    expect(ownerStanding(proc, reason, ancestry(proc, 90)).kind).not.toBe("asking");
  });

  it("REFUSES via unknown: a lock it did not write and cannot interpret", () => {
    const proc = fakeProc({ 90: { ppid: 1, start: 9 } });
    const standing = ownerStanding(proc, "do not touch, mid-migration", ancestry(proc, 90));
    expect(standing.kind).toBe("unrecognised");
    expect(composeInUse(standing, { kind: "checked", found: [], unknown: 0 }).kind).toBe("unknown");
  });

  it("an unlocked worktree is not an owned one", () => {
    const proc = fakeProc({ 90: { ppid: 1, start: 9 } });
    expect(ownerStanding(proc, undefined, ancestry(proc, 90)).kind).toBe("unlocked");
  });
});

/* ----------------------------------------------------------------- signal B -- */

describe("cwdUsersUnder", () => {
  it("REFUSES: a peer's process is sitting in the tree", () => {
    const proc = fakeProc({ 700: { start: 1, cwd: `${TREE}/src`, command: "vitest" } });
    const scan = cwdUsersUnder(proc, TREE, new Set());
    expect(scan).toMatchObject({ kind: "checked", unknown: 0 });
    if (scan.kind === "checked") expect(scan.found.map((f) => f.pid)).toEqual([700]);
  });

  it("does not count the asker or its ancestors — that is what makes self-removal work", () => {
    const proc = fakeProc({
      90: { ppid: 80, start: 9, cwd: TREE },
      80: { ppid: 1, start: 8, cwd: TREE },
    });
    const chain = ancestry(proc, 90).map((a: ProcId) => a.pid);
    const scan = cwdUsersUnder(proc, TREE, new Set(chain));
    expect(scan).toMatchObject({ kind: "checked", unknown: 0 });
    if (scan.kind === "checked") expect(scan.found).toEqual([]);
  });

  it("excludes ancestors WITHOUT excluding their other descendants", () => {
    /* The tmux server is an ancestor of this shell AND the parent of every other
       agent's pane. Excluding it must not hide the peer hanging off it. */
    const proc = fakeProc({
      90: { ppid: 5, start: 9, cwd: TREE },
      5: { ppid: 1, start: 5, cwd: "/home/greg" },
      71: { ppid: 5, start: 7, cwd: TREE, command: "a peer's shell" },
    });
    const chain = ancestry(proc, 90).map((a: ProcId) => a.pid);
    expect(chain).toContain(5);
    const scan = cwdUsersUnder(proc, TREE, new Set(chain));
    if (scan.kind === "checked") expect(scan.found.map((f) => f.pid)).toEqual([71]);
  });

  it("REFUSES via unknown: our own process whose cwd will not be read", () => {
    /* Not `found`, and emphatically not an absence. It costs the caller the age
       floor rather than clearing it. */
    const proc = fakeProc({ 700: { start: 1, cwd: { unreadable: "EACCES" } } });
    const scan = cwdUsersUnder(proc, TREE, new Set());
    expect(scan).toMatchObject({ kind: "checked", unknown: 1 });
    expect(composeInUse({ kind: "unlocked" }, scan).kind).toBe("unknown");
  });

  it("ignores other users' processes — 575 of the box's 910 are not ours to block on", () => {
    const proc = fakeProc({ 700: { start: 1, cwd: { unreadable: "EACCES" }, uid: 0 } });
    const scan = cwdUsersUnder(proc, TREE, new Set());
    expect(scan).toMatchObject({ kind: "checked", found: [], unknown: 0 });
  });

  it("does not match a sibling directory whose name starts with the tree's", () => {
    const proc = fakeProc({ 700: { start: 1, cwd: `${TREE}-other/src` } });
    const scan = cwdUsersUnder(proc, TREE, new Set());
    if (scan.kind === "checked") expect(scan.found).toEqual([]);
  });

  it("matches the tree root itself, not only paths below it", () => {
    const proc = fakeProc({ 700: { start: 1, cwd: TREE } });
    const scan = cwdUsersUnder(proc, TREE, new Set());
    if (scan.kind === "checked") expect(scan.found.map((f) => f.pid)).toEqual([700]);
  });
});

/* -------------------------------------------------------------- composition -- */

describe("composeInUse", () => {
  const clear: CwdScan = { kind: "checked", found: [], unknown: 0 };
  const stale: OwnerStanding = { kind: "stale", owner: { session: "demo", pid: 1, start: 1 }, why: "pid 1 is gone" };

  it("is idle only when BOTH signals are conclusively clear", () => {
    expect(composeInUse(stale, clear).kind).toBe("idle");
  });

  it("one signal unknown and the other empty is NOT clear", () => {
    /* The shape the first draft got wrong: "fall back only if neither could be
       read" let a half-answer through as a whole one. */
    expect(composeInUse(stale, { kind: "cannot-tell", why: "no /proc" }).kind).toBe("unknown");
    expect(composeInUse({ kind: "unrecognised", reason: "x" }, clear).kind).toBe("unknown");
  });

  it("an active signal outranks an unknown one", () => {
    const busy: CwdScan = { kind: "checked", found: [{ pid: 7, command: "vitest" }], unknown: 3 };
    const verdict = composeInUse({ kind: "unrecognised", reason: "x" }, busy);
    expect(verdict.kind).toBe("in-use");
  });

  it("names the pid and the command, so the refusal can be acted on", () => {
    const busy: CwdScan = { kind: "checked", found: [{ pid: 7, command: "npm run dev" }], unknown: 0 };
    const verdict = composeInUse(stale, busy);
    if (verdict.kind !== "in-use") throw new Error("expected in-use");
    expect(verdict.reasons.join(" ")).toContain("pid 7");
    expect(verdict.reasons.join(" ")).toContain("npm run dev");
  });
});
