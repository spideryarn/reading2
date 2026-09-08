/**
 * **Is anybody still using this worktree, and did its owner ask for this?**
 *
 * Two questions, and the difference between them is the whole reason this file
 * exists. `scripts/worktree-check.ts` asks whether deleting a directory would
 * *lose* anything. This asks whether deleting it would *interrupt* anybody — and,
 * separately, whether the session that owns it is the one asking.
 *
 * ## The proof, and why a proxy was there instead
 *
 * `scripts/worktree-sweep.ts` has a 24-hour age floor, and its docstring says
 * what it is standing in for: a sibling repo's sweep removed live worktrees,
 * because a brand-new tree whose tip equals the trunk passes every mechanical
 * check trivially. The floor is a proxy for "is somebody still using this", and
 * it is wrong in exactly one direction — it refuses the owner who has just
 * finished, which on 2026-09-08 was every tree on the box.
 *
 * It is not replaced here. A **proof** is added beside it, and the proof waives
 * it. `claude --worktree` writes the owning session's pid *and start time* into
 * the worktree lock:
 *
 * ```
 * locked claude session 260908k-worktree-removal (pid 1097274 start 73180403)
 * ```
 *
 * and field 22 of `/proc/1097274/stat` is `73180403`. **The start time is what
 * makes this safe against pid reuse**: "that pid exists" is not the test, "that
 * pid exists and was started at that instant" is. When that exact pair appears in
 * the **ancestor chain** of the process asking for the removal, the owner itself
 * is asking — evidence no other session on the box can manufacture.
 *
 * ## Vetoes, never permissions
 *
 * Two liveness signals, failing in opposite directions, and a hit from either
 * refuses:
 *
 * - **A — the lock owner is alive**, and is not the authorising ancestor. A lock
 *   outlives the session that wrote it, so a SIGKILLed session leaves one
 *   claiming a dead pid; hence checked against `/proc` rather than believed.
 * - **B — a process has its cwd under the tree**, excluding the asker and its
 *   ancestors. Catches what A cannot: measured 2026-09-08, two live processes sat
 *   in `dock-last-titles`, a worktree that had already been removed.
 *
 * Neither ever *grants* a removal. "No live process" is not "finished": an agent
 * can land an intermediate commit, schedule a continuation for an hour's time and
 * exit because the box is loaded, leaving a tree that is clean, landed, and still
 * wanted. `/proc` cannot see intent, and this file does not pretend to.
 *
 * ## The composition is three-valued and fails closed
 *
 * Active → refuse. Otherwise **unknown → the age floor still applies**. Clear only
 * when both applicable signals are conclusively clear. "One signal is unknown and
 * the other found nothing" is not clear — that was the shape of the first draft,
 * and it failed open.
 *
 * ## Signal B was built once, measured, and thrown away — on purpose
 *
 * `worktree-check.ts`'s `listenersUnder` carries the record: the same cwd sweep
 * was built on 2026-09-08 and discarded, because it fired on 8 of 13 worktrees
 * against 2 that had a server, and because `/proc/<pid>/cwd` is unreadable for 575
 * of the box's 910 processes.
 *
 * It is right here and was wrong there for three reasons. `worktree:check` is
 * asked constantly about the tree you are standing in, so a hit there is your own
 * shell; this is asked rarely about a tree somebody has decided is finished, and a
 * hit is the fact they are missing. Excluding self and ancestors removes the case
 * that was firing. And it is a veto second to an exact signal, not the verdict.
 *
 * The 575 are handled by not pretending: **UID first**, then readability. A
 * confirmed foreign uid is ignored; a stable **same-uid** pid whose cwd cannot be
 * read is an `unknown` that costs you the age floor, not an absence that clears
 * you. Failing closed on all 575 would refuse every removal for ever.
 */

import { readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import path from "node:path";

/** A process identified the way the worktree lock identifies one. */
export interface ProcId {
  pid: number;
  /** `/proc/<pid>/stat` field 22 — start time in clock ticks since boot. */
  start: number;
}

/** The owner named by a worktree's lock reason. */
export interface LockOwner extends ProcId {
  /** The session name, for the report. */
  session: string;
}

/**
 * Everything this file reads about the world, in one injectable place.
 *
 * Injected rather than mocked at the module boundary because every one of these
 * has an awkward case that must be *arranged* to be tested — a pid that is gone,
 * a pid whose start time differs, a cwd that is unreadable, a foreign uid — and
 * none of them can be arranged against the real `/proc` without spawning
 * processes and racing them.
 */
export interface ProcTable {
  /** `/proc/<pid>/stat`, or `null` if there is no such process. */
  stat(pid: number): string | null;
  /** `/proc/<pid>/cwd` resolved, or a reason it could not be. */
  cwd(pid: number): { kind: "path"; path: string } | { kind: "unreadable"; why: string };
  /** The uid owning `<pid>`, or `null` if it could not be read. */
  uid(pid: number): number | null;
  /** Every pid currently in the table. */
  pids(): number[];
  /** A readable argv, for the refusal message. */
  command(pid: number): string;
  /** The uid this process runs as. */
  self(): number;
}

/* --------------------------------------------------------------- parsing -- */

/**
 * `claude session <name> (pid 1097274 start 73180403)` → the owner.
 *
 * `null` for any lock this does not recognise — a hand-written
 * `git worktree lock --reason "do not touch"` included. An unrecognised lock is
 * **not** an absent owner: the caller treats a lock it cannot parse as an
 * `unknown`, because "somebody locked this deliberately and I cannot tell who"
 * is the one case where guessing is worst.
 */
export function parseLockOwner(reason: string | undefined): LockOwner | null {
  if (reason === undefined) return null;
  const m = /^claude session (.+?) \(pid (\d+) start (\d+)\)\s*$/.exec(reason.trim());
  if (m?.[1] === undefined || m[2] === undefined || m[3] === undefined) return null;
  const pid = Number.parseInt(m[2], 10);
  const start = Number.parseInt(m[3], 10);
  if (!Number.isFinite(pid) || !Number.isFinite(start)) return null;
  return { session: m[1], pid, start };
}

/**
 * `ppid` and `starttime` out of a `/proc/<pid>/stat` line.
 *
 * **Everything is counted from the last `)`, not from the start.** Field 2 is the
 * executable name in parentheses and it can contain spaces and parentheses of its
 * own — `tmux: server` is on this box right now, and a `bash -c '(...)'` is not
 * exotic. Splitting the whole line on whitespace puts every later field at an
 * offset that depends on the process's name, which is the kind of bug that works
 * on every machine you test it on.
 *
 * After the last `) `, the fields start at 3 (state), so ppid is the 2nd and
 * starttime the 20th of them.
 */
export function parseStat(line: string): { ppid: number; start: number } | null {
  const at = line.lastIndexOf(") ");
  if (at === -1) return null;
  const f = line.slice(at + 2).trim().split(/\s+/);
  const ppid = Number.parseInt(f[1] ?? "", 10);
  const start = Number.parseInt(f[19] ?? "", 10);
  if (!Number.isFinite(ppid) || !Number.isFinite(start)) return null;
  return { ppid, start };
}

/**
 * The asking process and every ancestor of it, as `(pid,start)` pairs.
 *
 * **Pairs, not bare pids.** A bare pid could in principle be recycled between the
 * walk and the comparison; carrying the start time closes that, and costs one
 * field we have already parsed.
 *
 * Stops at pid 1, at an unreadable stat, and at `maxDepth` — a corrupt or
 * circular chain must terminate rather than hang the removal.
 */
export function ancestry(proc: ProcTable, from: number, maxDepth = 64): ProcId[] {
  const chain: ProcId[] = [];
  let pid = from;
  for (let i = 0; i < maxDepth && pid > 1; i += 1) {
    const line = proc.stat(pid);
    if (line === null) break;
    const parsed = parseStat(line);
    if (parsed === null) break;
    chain.push({ pid, start: parsed.start });
    pid = parsed.ppid;
  }
  return chain;
}

/* ------------------------------------------------------------- signal A -- */

export type OwnerStanding =
  /** No lock, so nothing claims to own it. */
  | { kind: "unlocked" }
  /** A lock we cannot parse. Deliberate and not ours to interpret. */
  | { kind: "unrecognised"; reason: string }
  /** The lock's pid is gone, or was recycled — the session that wrote it is over. */
  | { kind: "stale"; owner: LockOwner; why: string }
  /** The owner is alive, and it is not the process asking. */
  | { kind: "alive"; owner: LockOwner; command: string }
  /** The owner is alive AND is an ancestor of the asker: the owner is asking. */
  | { kind: "asking"; owner: LockOwner };

/**
 * Who holds the lock, and whether they are still here.
 *
 * The `asking` case is the only thing in this file that grants anything, and it
 * grants on evidence rather than on a flag: the exact `(pid,start)` in the lock is
 * in the caller's own ancestor chain, which no other session can arrange.
 */
export function ownerStanding(proc: ProcTable, lockReason: string | undefined, chain: readonly ProcId[]): OwnerStanding {
  if (lockReason === undefined) return { kind: "unlocked" };
  const owner = parseLockOwner(lockReason);
  if (owner === null) return { kind: "unrecognised", reason: lockReason };

  const line = proc.stat(owner.pid);
  if (line === null) return { kind: "stale", owner, why: `pid ${owner.pid} is gone` };
  const parsed = parseStat(line);
  if (parsed === null) return { kind: "stale", owner, why: `pid ${owner.pid} has an unreadable stat line` };
  if (parsed.start !== owner.start) {
    /* The pid exists but is a different process. This is the case the start time
       is in the lock for, and treating it as "alive" would refuse for ever. */
    return { kind: "stale", owner, why: `pid ${owner.pid} was reused — started ${parsed.start}, not ${owner.start}` };
  }

  if (chain.some((a) => a.pid === owner.pid && a.start === owner.start)) return { kind: "asking", owner };
  return { kind: "alive", owner, command: proc.command(owner.pid) };
}

/* ------------------------------------------------------------- signal B -- */

export interface CwdUser {
  pid: number;
  command: string;
}

export type CwdScan =
  | { kind: "checked"; found: CwdUser[]; unknown: number }
  | { kind: "cannot-tell"; why: string };

/**
 * Processes whose cwd is inside `root`, excluding the asker and its ancestors.
 *
 * **The exclusion is ancestors, never descendants of ancestors.** Measured on this
 * box, the ancestor chain of an agent's shell reaches the tmux *server*, which is
 * also the parent of every other agent's pane. Excluding one ancestor pid excludes
 * that pid; the other panes are siblings and stay visible. Verified 2026-09-08:
 * the chain was `bash → bash → claude → bash → tmux: server → init`, and the tmux
 * server's own cwd was `/home/greg`, outside every worktree.
 *
 * **`unknown` counts same-uid processes we could not read**, and it is not the
 * same as `found.length === 0`. A foreign uid is ignored — those are root's and
 * other users', and 575 of the box's 910 processes are unreadable for that reason.
 * A *same-uid* pid we cannot read is a gap in the answer, and the caller falls back
 * to the age floor rather than calling it clear.
 */
export function cwdUsersUnder(proc: ProcTable, root: string, excluded: ReadonlySet<number>): CwdScan {
  let pids: number[];
  try {
    pids = proc.pids();
  } catch (err) {
    return { kind: "cannot-tell", why: `could not enumerate processes: ${(err as Error).message}` };
  }

  const me = proc.self();
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  const found: CwdUser[] = [];
  let unknown = 0;

  for (const pid of pids) {
    if (excluded.has(pid)) continue;
    const uid = proc.uid(pid);
    /* A uid we cannot read is a process that has exited between the listing and
       here, or one we have no business inspecting. Neither is ours to block on. */
    if (uid === null || uid !== me) continue;

    const cwd = proc.cwd(pid);
    if (cwd.kind === "unreadable") {
      unknown += 1;
      continue;
    }
    if (cwd.path !== root && !cwd.path.startsWith(prefix)) continue;
    found.push({ pid, command: proc.command(pid) });
  }

  return { kind: "checked", found, unknown };
}

/* --------------------------------------------------------- composition -- */

export type InUse =
  /** Somebody is using it. Never removable, whoever is asking. */
  | { kind: "in-use"; reasons: string[] }
  /** Nobody is, and both signals were conclusive. */
  | { kind: "idle"; notes: string[] }
  /** At least one signal could not answer. The age floor still applies. */
  | { kind: "unknown"; why: string[] };

/** Did the owner itself ask for this? Separate from `InUse` because it grants. */
export function ownerIsAsking(standing: OwnerStanding): boolean {
  return standing.kind === "asking";
}

/**
 * The two signals, composed so that no combination of them can fail open.
 *
 * Order is deliberate: every reason to refuse is collected before any reason to
 * shrug, and an `unknown` never outranks an `in-use`.
 */
export function composeInUse(standing: OwnerStanding, scan: CwdScan): InUse {
  const reasons: string[] = [];
  const unknowns: string[] = [];
  const notes: string[] = [];

  switch (standing.kind) {
    case "alive":
      reasons.push(
        `its Claude session is still running — ${standing.owner.session}, pid ${standing.owner.pid} (${standing.command})`,
      );
      break;
    case "unrecognised":
      unknowns.push(`the worktree lock was not written by \`claude --worktree\` and says: ${standing.reason}`);
      break;
    case "stale":
      notes.push(`the lock is stale: ${standing.why}`);
      break;
    case "asking":
      notes.push(`its own session is asking — ${standing.owner.session}, pid ${standing.owner.pid}`);
      break;
    case "unlocked":
      notes.push("not locked by any session");
      break;
  }

  if (scan.kind === "cannot-tell") {
    unknowns.push(scan.why);
  } else {
    for (const u of scan.found) reasons.push(`a process is running inside it — pid ${u.pid} (${u.command})`);
    if (scan.unknown > 0) {
      unknowns.push(`${scan.unknown} of your own processes would not say what directory they are in`);
    } else if (scan.found.length === 0) {
      notes.push("no process of yours has its working directory inside it");
    }
  }

  if (reasons.length > 0) return { kind: "in-use", reasons };
  if (unknowns.length > 0) return { kind: "unknown", why: unknowns };
  return { kind: "idle", notes };
}

/* ------------------------------------------------------- the real /proc -- */

/**
 * `/proc`, or the honest absence of it.
 *
 * `null` on anything that is not Linux — the Mac has no `/proc`, so every signal
 * here is permanently unavailable there and the caller falls back to the age
 * floor, which is exactly today's behaviour.
 */
export function procTable(): ProcTable | null {
  try {
    statSync("/proc/self/stat");
  } catch {
    return null;
  }

  const read = (p: string): string | null => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return null;
    }
  };

  return {
    stat: (pid) => read(`/proc/${pid}/stat`),
    cwd: (pid) => {
      try {
        return { kind: "path", path: readlinkSync(`/proc/${pid}/cwd`, "utf8") };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        /* ESRCH/ENOENT is a process that exited between the listing and here, not
           a process hiding from us. Only a live-but-opaque one is an unknown. */
        if (code === "ENOENT" || code === "ESRCH") return { kind: "unreadable", why: "gone" };
        return { kind: "unreadable", why: code ?? "unreadable" };
      }
    },
    uid: (pid) => {
      try {
        return statSync(`/proc/${pid}`).uid;
      } catch {
        return null;
      }
    },
    pids: () => {
      return readdirSync("/proc")
        .filter((n) => /^\d+$/.test(n))
        .map((n) => Number.parseInt(n, 10));
    },
    command: (pid) => {
      const raw = read(`/proc/${pid}/cmdline`);
      if (raw === null) return "(command unreadable)";
      const joined = raw.split("\0").filter((a) => a !== "").join(" ");
      if (joined === "") return "(command unreadable)";
      return joined.length > 120 ? `${joined.slice(0, 117)}...` : joined;
    },
    self: () => process.getuid?.() ?? -1,
  };
}
