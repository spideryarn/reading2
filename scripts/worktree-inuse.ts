/**
 * **Is anybody still using this worktree, and did its owner ask for this?**
 *
 * Two questions, and the difference between them is the whole reason this file
 * exists. `scripts/worktree-check.ts` asks whether deleting a directory would
 * *lose* anything. This asks whether deleting it would *interrupt* anybody — and,
 * separately, whether the session that owns it is the one asking.
 *
 * ## The proof, and the proxy it outlived
 *
 * There was a 24-hour age floor in front of every third-party removal, standing
 * in for "is somebody still using this": a sibling repo's sweep removed live
 * worktrees, because a brand-new tree whose tip equals the trunk passes every
 * mechanical check trivially. This file was written beside it, to let a tree's
 * own session past it. On 2026-09-12 the floor went — Greg: *"If they are
 * finished successfully and safe to remove, it's fine to do so immediately"* —
 * and the two signals below are now the whole answer to that question, for
 * everybody. docs/plans/260912a-drop-the-worktree-removal-age-floor.md.
 *
 * The ownership proof stays, and grants nothing any more. Its one job is to stop
 * signal A vetoing the owner itself: a session removing its own tree is alive
 * and named in the lock. `claude --worktree` writes the owning session's pid
 * *and start time* into the worktree lock:
 *
 * ```
 * locked claude session 260908k-worktree-removal (pid 1097274 start 73180403)
 * ```
 *
 * and field 22 of `/proc/1097274/stat` is `73180403`. **The start time is what
 * makes this safe against pid reuse**: "that pid exists" is not the test, "that
 * pid exists and was started at that instant" is. When that exact pair appears in
 * the **ancestor chain** of the process asking for the removal, the owner itself
 * is asking.
 *
 * **It is cooperative evidence, not an unforgeable capability**, and the
 * difference matters enough to write down. Another same-uid session can read a
 * common ancestor's pid and start time out of `/proc` and write a lock reason
 * naming it; nothing here would tell the difference. It raises the bar from "any
 * agent may delete any tree" to "an agent must deliberately forge a lock", which
 * is the useful part, and it is not a security boundary. In the other direction a
 * legitimate owner can *miss* recognition — a supervisor that detached the
 * session from this process tree leaves its own live pid as a veto, until it
 * leaves the tree and asks from outside. A PID namespace is worse: it can hide
 * the live pid altogether, so it is refused up front — `classifyPidNamespace`.
 * GPT Sol, 2026-09-09 and 2026-09-12.
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
 * "No live process" is still not "finished": an agent can land an intermediate
 * commit, schedule a continuation and exit, leaving a tree that is clean, landed,
 * and still wanted. `/proc` cannot see intent. Since 2026-09-12 that tree is
 * removable anyway, by Greg's decision — nothing in it is lost, because
 * `worktree:check` and the landed proof have already said so.
 *
 * ## The composition is three-valued and fails closed
 *
 * Active → refuse. Otherwise **unknown → refuse**. Clear only when both
 * applicable signals are conclusively clear. "One signal is unknown and the other
 * found nothing" is not clear — that was the shape of the first draft, and it
 * failed open.
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
 * The 575 are handled by not pretending: **UID first**, then readability, and
 * three outcomes rather than two — a foreign uid is ignored, an exited process is
 * an absence, and a same-uid process the kernel will not let us inspect is
 * counted and printed. `cwdUsersUnder` carries the count that settles the last
 * one. All of it assumes `/proc` is the host's process table: a caller in a PID
 * namespace sees a tidy, internally consistent subset and would mistake an owner
 * outside it for a dead pid. `classifyPidNamespace` is the positive control, and
 * anything but the host's namespace is an `unknown`.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
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
  /**
   * `/proc/<pid>/cwd` resolved, or why not — and **"gone" and "opaque" are
   * different facts**. A process that exited between the listing and the read is
   * an absence; one the kernel will not let us inspect is a hole in the answer.
   */
  cwd(pid: number): { kind: "path"; path: string } | { kind: "gone" } | { kind: "opaque"; why: string };
  /** The uid owning `<pid>`, or `null` if it could not be read. */
  uid(pid: number): number | null;
  /** Every pid currently in the table. */
  pids(): number[];
  /** A readable argv, for the refusal message. */
  command(pid: number): string;
  /**
   * `/proc/<pid>/comm` — the short executable name.
   *
   * Readable **even when `cwd` is not**: measured on the box's opaque processes,
   * `comm` gives `systemd`, `(sd-pam)`, `sshd`, `postgrest` while the cwd
   * readlink fails. That is what makes the ambient allowlist possible at all.
   */
  comm(pid: number): string | null;
  /** The uid this process runs as. */
  self(): number;
  /**
   * `readlink /proc/self/ns/pid` — `pid:[4026531836]` in the host's namespace —
   * or `null` if it could not be read. See `classifyPidNamespace`.
   */
  pidNamespace(): string | null;
}

/* --------------------------------------------------------- pid namespace -- */

/**
 * The inode of the kernel's initial PID namespace. Fixed, not allocated:
 * `PROC_PID_INIT_INO` in `include/linux/proc_ns.h` since Linux 3.8, so
 * `pid:[4026531836]` is the host on every box this runs on. Measured on the
 * Hetzner box, 2026-09-12.
 */
export const INIT_PID_NAMESPACE_INODE = 4026531836;

export type PidScope =
  /** `/proc` is the whole box's process table. */
  | { kind: "host" }
  /** A private namespace: `/proc` is a subset that looks complete. */
  | { kind: "private"; link: string; why: string }
  | { kind: "cannot-tell"; why: string };

/**
 * **Is the `/proc` we are about to believe the whole box?** The positive control
 * both signals below need, and did not have until GPT Sol's review of 260912a.
 *
 * Inside a private PID namespace — Sol's own Codex sandbox, measured 2026-09-12 —
 * `/proc` lists the namespace's handful of processes and nothing else. A live
 * session outside it is not *unreadable*, it is *absent*: its pid in the lock
 * reads as gone, so the lock reads as stale, and no process sits in the tree.
 * Every answer is internally consistent and wrong, which is the one kind of
 * wrong the three-valued composition cannot see. While the age floor stood
 * behind it that cost nothing; without it, it removes a live tree.
 *
 * So the namespace is asked first, and anything but the host's is `unknown`.
 */
export function classifyPidNamespace(link: string | null): PidScope {
  if (link === null) {
    return { kind: "cannot-tell", why: "could not read which PID namespace this process is in, so /proc may not be the whole box" };
  }
  const m = /^pid:\[(\d+)\]$/.exec(link.trim());
  if (m?.[1] === undefined) {
    return { kind: "cannot-tell", why: `/proc/self/ns/pid reads ${link}, which is not a PID namespace link` };
  }
  if (Number.parseInt(m[1], 10) === INIT_PID_NAMESPACE_INODE) return { kind: "host" };
  return {
    kind: "private",
    link,
    why: `this process is in a private PID namespace (${link}), whose /proc can hide a live session outside it — run this from the host session`,
  };
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
export function parseStat(line: string): { ppid: number; pgrp: number; start: number } | null {
  const at = line.lastIndexOf(") ");
  if (at === -1) return null;
  const f = line.slice(at + 2).trim().split(/\s+/);
  const ppid = Number.parseInt(f[1] ?? "", 10);
  const pgrp = Number.parseInt(f[2] ?? "", 10);
  const start = Number.parseInt(f[19] ?? "", 10);
  if (!Number.isFinite(ppid) || !Number.isFinite(pgrp) || !Number.isFinite(start)) return null;
  return { ppid, pgrp, start };
}

/**
 * The process group of one pid, or `null` if it could not be read.
 *
 * Used to exclude **this invocation's own job**, and ancestors are not enough for
 * that. Measured on a real run: `npx tsx scripts/worktree-remove.ts | tail -20`
 * refused, and among its reasons was `a process is running inside it — pid 1817223
 * (tail -20)`. `tail` is a *sibling* of the node process in the pipeline, not an
 * ancestor, so nothing excluded it. A refusal carrying an obviously bogus reason
 * is how refusals stop being read, which is the failure this whole file exists
 * downstream of.
 *
 * A process group is the right unit for *which* job, and not enough on its own:
 * a non-interactive shell has no job control, so `npm run dev & npm run
 * worktree:sweep` puts the dev server in the sweep's group too. GPT Sol
 * reproduced the Mac version of that on 261009v (F2). So a same-group process is
 * excluded only when it is also a **pipeline filter** — `isPipelineFilter` — which
 * is the case this exclusion was written for, and which a server never is.
 *
 * What the group used to cover besides: **the asker's own descendants**. tsx
 * starts an esbuild service that inherits the cwd, so a removal run from inside
 * its tree refused over its own esbuild once the group stopped excluding it —
 * measured on the Mac. Descendants of the *asker* (never of its ancestors, which
 * would be every pane on the box) are excluded by walking each candidate's
 * parents, and only for a candidate already found inside the tree and still
 * in the asker's group. A detached child is an independent job, not a helper.
 * Bulk scans disable the filter-name exemption: they keep the caller's tree
 * anyway, and an independent same-group `tail -f` must still veto elsewhere.
 */
function pgrpOf(proc: ProcTable, pid: number): number | null {
  const line = proc.stat(pid);
  if (line === null) return null;
  return parseStat(line)?.pgrp ?? null;
}

/**
 * The commands that sit at the far end of a pipe — `… | tail -20` — and nothing
 * else. Named rather than inferred, the same shape as `AMBIENT_OPAQUE_COMMS`:
 * adding a name is a decision, not a default.
 */
export const PIPELINE_FILTERS: readonly string[] = [
  "tail", "head", "grep", "tee", "cat", "less", "more", "sed", "awk", "sort", "uniq", "wc", "cut", "tr", "jq",
];

/** Is this executable name (or path, or command line) one of `PIPELINE_FILTERS`? */
export function isPipelineFilter(name: string | null | undefined): boolean {
  if (name === null || name === undefined) return false;
  const first = name.trim().split(/\s+/)[0] ?? "";
  return PIPELINE_FILTERS.includes(path.basename(first));
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
  /** The pid exists, but its identity could not be read. Never evidence of exit. */
  | { kind: "unreadable"; owner: LockOwner; why: string }
  /** The owner is alive, and it is not the process asking. */
  | { kind: "alive"; owner: LockOwner; command: string }
  /** The owner is alive AND is an ancestor of the asker: the owner is asking. */
  | { kind: "asking"; owner: LockOwner };

/**
 * Who holds the lock, and whether they are still here. `asking` only exempts the
 * owner from its own signal-A veto: it grants no removal and skips no other
 * check.
 */
export function ownerStanding(proc: ProcTable, lockReason: string | undefined, chain: readonly ProcId[]): OwnerStanding {
  if (lockReason === undefined) return { kind: "unlocked" };
  const owner = parseLockOwner(lockReason);
  if (owner === null) return { kind: "unrecognised", reason: lockReason };

  const line = proc.stat(owner.pid);
  if (line === null) return { kind: "stale", owner, why: `pid ${owner.pid} is gone` };
  const parsed = parseStat(line);
  if (parsed === null) return { kind: "unreadable", owner, why: `pid ${owner.pid} has an unreadable stat line` };
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

/**
 * Processes whose cwd the kernel hides and whose `comm` is a known ambient
 * daemon — the ones that are there on every run and have never been in a
 * worktree.
 *
 * **This list is the whole reason the scan is usable, and the whole reason it is
 * still safe.** Blocking on every opaque process is operationally impossible:
 * measured on the box, six are opaque on every single run, so no live tree could
 * ever be removed. But "they are all daemons" is not
 * a fact about opaqueness, it is a fact about *this box on that afternoon*. GPT
 * Sol disproved the general claim by construction: a same-uid Python process
 * chdir'd into a worktree, called `prctl(PR_SET_DUMPABLE, 0)`, and its cwd went
 * unreadable while genuinely being the worktree.
 *
 * So the shape is the one `worktree-check.ts` already uses for gitignored paths:
 * **the known ones are named, and anything else is a blocker.** An opaque process
 * called `python3` is an unknown and refuses the removal; an opaque `sshd` is
 * counted and printed. Adding a name here is a decision somebody makes on
 * purpose, not a default.
 *
 * `box-tidy` was added on 2026-10-07. It is the hourly disk tidy
 * (infra/hetzner/box-tidy.mjs), which holds two capabilities to read `/proc`
 * and is therefore not dumpable for the seconds it runs. It names itself with
 * `process.title`, and its unit runs it with `WorkingDirectory=/`.
 */
export const AMBIENT_OPAQUE_COMMS: readonly string[] = ["systemd", "(sd-pam)", "sshd", "postgrest", "box-tidy"];

/** A process we could not see into, and could not place. */
export interface OpaqueUser {
  pid: number;
  comm: string;
}

export type CwdScan =
  | {
      kind: "checked";
      found: CwdUser[];
      /** Opaque, and recognised as ambient. Reported, never blocking. */
      ambient: number;
      /** Opaque and NOT recognised. Each one is a hole in the answer. */
      unplaceable: OpaqueUser[];
    }
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
 * **Three outcomes per process, not two, and the third one was measured rather
 * than reasoned about.** A foreign uid is ignored: those are root's and other
 * users', and 575 of the box's 910 processes are unreadable for that reason. A
 * same-uid process that has *exited* is an absence. What is left is the same-uid
 * process the kernel will not let us inspect, and the honest question is whether
 * that is a hole worth blocking on.
 *
 * **It is not, and here is the count.** Walked on this box, 2026-09-09: of 208
 * same-uid processes, 202 readable, 1 gone mid-walk, and **6 permanently opaque —
 * `systemd --user`, `(sd-pam)`, two `sshd`, two `postgrest`**. Every one is a
 * daemon whose credentials or dumpable flag make the kernel refuse, none of them
 * has ever been in a worktree, and they are there on every run. Treating them as
 * an unknown made the scan report one every single time — an alarm that can
 * never be cleared, which is precisely the
 * `/logs/` mistake `worktree-check.ts` already tells at length.
 *
 * So they are **counted and printed**, not blocked on. GPT Sol argued the other
 * way (its fifth finding, 2026-09-09: *"a stable same-UID PID whose cwd is
 * unreadable is an unknown"*) and the argument is right in general; the count is
 * what settles it here. What remains genuinely unknown — no `/proc` at all, or a
 * listing that failed — is still `cannot-tell`, and still refuses.
 */
export function cwdUsersUnder(
  proc: ProcTable,
  root: string,
  excluded: ReadonlySet<number>,
  askingPid?: number,
  excludePipelineFilters = true,
): CwdScan {
  /* This invocation's own job — see `pgrpOf`. `null` excludes nothing extra. */
  const myPgrp = askingPid === undefined ? null : pgrpOf(proc, askingPid);
  let pids: number[];
  try {
    pids = proc.pids();
  } catch (err) {
    return { kind: "cannot-tell", why: `could not enumerate processes: ${(err as Error).message}` };
  }

  const me = proc.self();
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  const found: CwdUser[] = [];
  const unplaceable: OpaqueUser[] = [];
  let ambient = 0;

  for (const pid of pids) {
    if (excluded.has(pid)) continue;
    if (excludePipelineFilters && myPgrp !== null && pgrpOf(proc, pid) === myPgrp && isPipelineFilter(proc.comm(pid))) continue;
    const uid = proc.uid(pid);
    /* A uid we cannot read is a process that has exited between the listing and
       here, or one we have no business inspecting. Neither is ours to block on. */
    if (uid === null || uid !== me) continue;

    const cwd = proc.cwd(pid);
    /* Exited between the listing and here. An absence, not a hole: a process
       that no longer exists is not using this directory. Counting it as an
       unknown made the scan report one on almost every run — measured, and
       would have refused nearly every removal. */
    if (cwd.kind === "gone") continue;
    if (cwd.kind === "opaque") {
      /* Named ambient daemon, or a hole. `comm` is readable when cwd is not. */
      const comm = proc.comm(pid);
      if (comm !== null && AMBIENT_OPAQUE_COMMS.includes(comm)) ambient += 1;
      else unplaceable.push({ pid, comm: comm ?? "(name unreadable)" });
      continue;
    }
    if (cwd.path !== root && !cwd.path.startsWith(prefix)) continue;
    /* tsx's esbuild service inherits both cwd and group. A detached child
       would have vetoed the old group rule too, and must still veto. */
    if (askingPid !== undefined && myPgrp !== null && pgrpOf(proc, pid) === myPgrp && ancestry(proc, pid).some((a) => a.pid === askingPid)) continue;
    found.push({ pid, command: proc.command(pid) });
  }

  return { kind: "checked", found, ambient, unplaceable };
}

/* --------------------------------------------------------- composition -- */

export type InUse =
  /** Somebody is using it. Never removable, whoever is asking. */
  | { kind: "in-use"; reasons: string[] }
  /** Nobody is, and both signals were conclusive. */
  | { kind: "idle"; notes: string[] }
  /** At least one signal could not answer. Refuses, whoever is asking. */
  | { kind: "unknown"; why: string[] };

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
    case "unreadable":
      unknowns.push(`the worktree lock names ${standing.why}`);
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
    for (const u of scan.unplaceable) {
      unknowns.push(`pid ${u.pid} (${u.comm}) is yours and hides its working directory, and is not a daemon we recognise`);
    }
    if (scan.found.length === 0 && scan.unplaceable.length === 0) {
      notes.push(
        scan.ambient === 0
          ? "no process of yours has its working directory inside it"
          : `no process of yours has its working directory inside it (${scan.ambient} ambient daemons hide theirs)`,
      );
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
 * `null` on anything that is not Linux. The Mac has no `/proc`, and asks the
 * same two questions through `ps` and `lsof` instead — `readDarwinSnapshot`
 * below. Anything that is neither is an `unknown`.
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
        /* ENOENT/ESRCH is a process that exited between the listing and here.
           EACCES/EPERM is one the kernel will not let us inspect — a different
           fact, and the caller must not confuse them. */
        if (code === "ENOENT" || code === "ESRCH") return { kind: "gone" };
        return { kind: "opaque", why: code ?? "unreadable" };
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
    comm: (pid) => {
      const raw = read(`/proc/${pid}/comm`);
      return raw === null ? null : raw.trim();
    },
    self: () => process.getuid?.() ?? -1,
    pidNamespace: () => {
      try {
        return readlinkSync("/proc/self/ns/pid", "utf8");
      } catch {
        return null;
      }
    },
  };
}

/* ---------------------------------------------------------------- macOS -- */

/**
 * **The same two signals on the Mac, which has no `/proc`.** Added 2026-10-09:
 * until then every live tree on the Mac read `unknown`, and `worktree:remove`
 * refused all of them.
 * docs/plans/261009v-worktree-removal-on-macos-and-an-automatic-sweep.md.
 *
 * Three reads, in this order, and the order is what lets "gone" be told from
 * "hidden":
 *
 * 1. `ps` — the whole machine's process table. macOS has no PID namespaces, so
 *    there is no `classifyPidNamespace` to ask.
 * 2. `lsof -d cwd` — every cwd lsof can read. Measured on the Mac, 2026-10-09:
 *    one second, exit 0, 876 of 878 same-uid processes listed; the two missing
 *    were a zombie and one that exited mid-walk. None was hidden.
 * 3. `ps -p <the same-uid pids 2 did not list>` — still there and not a zombie
 *    means lsof could not see it: a hole, and an `unknown`.
 *
 * A process that started after read 1 and is listed by read 2 is still matched
 * by its cwd; it only lacks a ps row, which the cwd match does not need.
 *
 * Two differences from Linux, both deliberate:
 *
 * - **A foreign uid's cwd is believed, not ignored.** On Linux it is unreadable,
 *   so ignoring it was the only option; lsof shows it when it can, and a root
 *   process sitting in the tree is in it.
 * - **The lock's start time cannot be checked.** It is `/proc` field 22, clock
 *   ticks since boot, which the Mac has no equivalent of. So signal A is
 *   pid-only: gone → stale; in the asker's ancestor chain → asking (a live pid is
 *   exactly one process, so if the owner died and our ancestor reused its pid the
 *   owner is gone anyway); alive otherwise → alive, which over-refuses on a
 *   recycled pid — the safe direction.
 *
 * No ambient-daemon allowlist: none was needed on the Mac, so any hidden
 * same-uid process is an `unknown`.
 */
export interface PsRow {
  pid: number;
  ppid: number;
  pgid: number;
  uid: number;
  /** `ps -o stat`, e.g. `Ss`, `R+`, `Z`. */
  stat: string;
  command: string;
}

const PS_COLUMNS = "pid=,ppid=,pgid=,uid=,stat=,command=";

/** `ps -o pid=,ppid=,pgid=,uid=,stat=,command=` → rows, or `null` if any line does not parse. */
export function parsePs(text: string): PsRow[] | null {
  const rows: PsRow[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    /* The uid can be negative: `nobody` is -2 on macOS, and dhcp6d runs as it. */
    const m = /^(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\S+)\s*(.*)$/.exec(line);
    if (m?.[1] === undefined || m[2] === undefined || m[3] === undefined || m[4] === undefined || m[5] === undefined) {
      return null;
    }
    rows.push({
      pid: Number.parseInt(m[1], 10),
      ppid: Number.parseInt(m[2], 10),
      pgid: Number.parseInt(m[3], 10),
      uid: Number.parseInt(m[4], 10),
      stat: m[5],
      command: m[6] ?? "",
    });
  }
  return rows;
}

/**
 * `lsof -F pn -d cwd` → pid → cwd, or `null` if the output is not that shape.
 *
 * `-F` output is one field per line, each prefixed by its letter: `p<pid>`
 * starts a process, `f<fd>` and `n<name>` follow. Only `cwd` was selected, so a
 * process has at most one name. Anything else is a format we did not ask for,
 * and is refused rather than guessed at.
 */
export function parseLsofCwds(text: string): Map<number, string> | null {
  const cwds = new Map<number, string>();
  let pid: number | null = null;
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const tag = line[0];
    const rest = line.slice(1);
    if (tag === "p") {
      if (!/^\d+$/.test(rest)) return null;
      pid = Number.parseInt(rest, 10);
    } else if (tag === "f") {
      if (rest !== "cwd") return null;
    } else if (tag === "n") {
      if (pid === null || cwds.has(pid)) return null;
      cwds.set(pid, rest);
    } else {
      return null;
    }
  }
  return cwds;
}

/** Everything the macOS path reads, gathered by `readDarwinSnapshot`. */
export interface DarwinSnapshot {
  /** Read 1. */
  ps: PsRow[];
  /** Read 2. */
  cwds: Map<number, string>;
  /** Read 3: the same-uid pids from read 1 that read 2 did not list, as they are now. */
  recheck: PsRow[];
  /** This process's uid. */
  self: number;
  /**
   * The pids of the commands this reader spawned. Excluded like the asker's own
   * job: `lsof` starts after read 1, so it has no ps row to put it in our
   * process group, and its cwd is ours — measured, run from inside a tree, the
   * first version refused that tree over its own lsof.
   */
  helpers: number[];
}

/** The asker and its ancestors, from a ps table. Stops at pid 1, a missing row, or a cycle. */
export function darwinAncestry(ps: readonly PsRow[], from: number, maxDepth = 64): number[] {
  const byPid = new Map(ps.map((r) => [r.pid, r]));
  const chain: number[] = [];
  let pid = from;
  for (let i = 0; i < maxDepth && pid > 1; i += 1) {
    const row = byPid.get(pid);
    if (row === undefined || chain.includes(pid)) break;
    chain.push(pid);
    pid = row.ppid;
  }
  return chain;
}

/** Signal A on the Mac: pid-only, see the section header. */
export function darwinOwnerStanding(
  ps: readonly PsRow[],
  lockReason: string | undefined,
  chain: readonly number[],
): OwnerStanding {
  if (lockReason === undefined) return { kind: "unlocked" };
  const owner = parseLockOwner(lockReason);
  if (owner === null) return { kind: "unrecognised", reason: lockReason };
  const row = ps.find((r) => r.pid === owner.pid);
  if (row === undefined || row.stat.startsWith("Z")) return { kind: "stale", owner, why: `pid ${owner.pid} is gone` };
  if (chain.includes(owner.pid)) return { kind: "asking", owner };
  return {
    kind: "alive",
    owner,
    command: `${row.command} — on macOS only the pid can be checked, so a reused pid also refuses`,
  };
}

/** The same-uid pids from read 1 that read 2 did not list — what read 3 asks about. */
export function unlistedPids(ps: readonly PsRow[], cwds: ReadonlyMap<number, string>, self: number): number[] {
  return ps.filter((r) => r.uid === self && !r.stat.startsWith("Z") && !cwds.has(r.pid)).map((r) => r.pid);
}

/**
 * lsof's `n` field with its escapes undone: `\b \f \n \r \t`, `\xNN` (bytes,
 * then read as UTF-8) and `^X` for a control character.
 *
 * **Best effort, and the caller tries both spellings.** lsof does not escape a
 * backslash or a caret that is really in the name, so `\n` in its output is
 * either a newline or a backslash and an `n`, and nothing in the output says
 * which. Matching on either, and calling it inside if either is, over-matches —
 * the safe direction.
 */
export function decodeLsofName(raw: string): string {
  const bytes: number[] = [];
  const simple: Record<string, number> = { b: 8, f: 12, n: 10, r: 13, t: 9 };
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i] ?? "";
    const next = raw[i + 1] ?? "";
    if (ch === "\\" && next in simple) {
      bytes.push(simple[next] ?? 0);
      i += 1;
    } else if (ch === "\\" && next === "x" && /^[0-9a-fA-F]{2}$/.test(raw.slice(i + 2, i + 4))) {
      bytes.push(Number.parseInt(raw.slice(i + 2, i + 4), 16));
      i += 3;
    } else if (ch === "^" && /^[@-_?]$/.test(next)) {
      bytes.push(next === "?" ? 127 : next.charCodeAt(0) - 64);
      i += 1;
    } else {
      /* Iterating UTF-16 units separately corrupts literal emoji alongside
         escapes, so copy one complete Unicode code point. */
      const literal = String.fromCodePoint(raw.codePointAt(i) ?? 0);
      for (const b of Buffer.from(literal, "utf8")) bytes.push(b);
      i += literal.length - 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

export type Placement = "inside" | "outside" | "unknown";
/** Where one process's cwd, as lsof printed it, is relative to the tree. */
export type Containment = (cwd: string) => Placement;

export interface FsId {
  dev: number;
  ino: number;
}

/** Missing physical paths can be deleted cwds; other read failures prove nothing. */
type IdRead = FsId | "missing" | null;

function realStatId(p: string): IdRead {
  try {
    const s = statSync(p);
    return { dev: s.dev, ino: s.ino };
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : null;
  }
}

/**
 * Is a cwd inside the tree? **Spelling first, then filesystem identity**, and
 * spelling alone was not enough — GPT Sol's F3 on 261009v, both reproduced on
 * the Mac:
 *
 * - The default Mac volume is case-insensitive. A shell that `cd`s to
 *   `…/worktrees/demo` when the directory is `Demo` has a cwd lsof prints one way
 *   and `realpath` another. So the prefix match is case-insensitive — on a
 *   case-sensitive volume that over-matches, which is the safe direction.
 * - lsof escapes unprintable bytes, so `decodeLsofName` and both spellings.
 *
 * When neither spelling matches, each ancestor of the cwd is `stat`ed and its
 * `(dev, ino)` compared with the tree's — which also catches a cwd reached
 * through any alias the spelling did not anticipate. An unreadable alias is
 * `unknown`. For an unescaped physical lsof path, ENOENT alone can be a deleted
 * cwd: walk its surviving ancestors, as before. An unresolved escaped spelling
 * is ambiguous and cannot establish outside. Deleted directories under a known
 * spelling still match above. **A name that is not an absolute path is `unknown`**: the
 * first version accepted lsof's `nunknown` as a place and called the tree idle.
 *
 * `null` from the root's own realpath or stat is an error for the caller, never
 * a quiet fallback to the unresolved spelling.
 */
export function containmentFor(
  root: string,
  real: (p: string) => string = (p) => realpathSync(p),
  statId: (p: string) => IdRead = realStatId,
): Containment | { error: string } {
  let resolved: string;
  try {
    resolved = real(root);
  } catch (err) {
    return { error: `could not resolve ${root}: ${(err as Error).message}` };
  }
  const rootId = statId(resolved);
  if (rootId === null || rootId === "missing") return { error: `could not stat ${resolved}` };
  const spellings = [...new Set([root, resolved].map((s) => s.replace(/\/+$/, "").toLowerCase()))];
  const ids = new Map<string, IdRead>();
  const idOf = (p: string): IdRead => {
    if (!ids.has(p)) ids.set(p, statId(p));
    return ids.get(p) ?? null;
  };

  const placeOne = (cwd: string, ambiguous: boolean): Placement => {
    if (!cwd.startsWith("/")) return "unknown";
    const lower = cwd.toLowerCase();
    if (spellings.some((s) => lower === s || lower.startsWith(`${s}/`))) return "inside";
    let p = path.normalize(cwd);
    for (let depth = 0; depth < 256; depth += 1) {
      const id = idOf(p);
      if (id === null || (id === "missing" && ambiguous)) return "unknown";
      if (id !== "missing" && id.dev === rootId.dev && id.ino === rootId.ino) return "inside";
      if (p === "/") return "outside";
      p = path.dirname(p);
    }
    return "unknown";
  };

  return (cwd) => {
    const decoded = decodeLsofName(cwd);
    const tries = [...new Set([cwd, decoded])].map((p) => placeOne(p, cwd !== decoded));
    if (tries.includes("inside")) return "inside";
    if (tries.includes("unknown")) return "unknown";
    if (tries.includes("outside")) return "outside";
    return "unknown";
  };
}

/**
 * Signal B on the Mac.
 *
 * Excluded, as on Linux: the asker, its ancestors, a pipeline filter in its own
 * process group (`pgrpOf`), and the `ps`/`lsof` this reader itself spawned.
 */
export function darwinCwdUsersUnder(
  snap: DarwinSnapshot,
  contains: Containment,
  excluded: ReadonlySet<number>,
  askingPid: number,
  excludePipelineFilters = true,
): CwdScan {
  const byPid = new Map(snap.ps.map((r) => [r.pid, r]));
  const myPgid = byPid.get(askingPid)?.pgid ?? null;
  const ours = (pid: number): boolean => {
    if (excluded.has(pid) || snap.helpers.includes(pid)) return true;
    const row = byPid.get(pid);
    return excludePipelineFilters && myPgid !== null && row?.pgid === myPgid && isPipelineFilter(row.command);
  };

  const found: CwdUser[] = [];
  const unplaceable: OpaqueUser[] = [];
  for (const [pid, cwd] of snap.cwds) {
    if (ours(pid)) continue;
    const where = contains(cwd);
    const command = byPid.get(pid)?.command ?? "a command that started after the process listing";
    /* Only children still in our job: a detached service is independent. */
    if (where === "inside" && myPgid !== null && byPid.get(pid)?.pgid === myPgid && darwinAncestry(snap.ps, pid).includes(askingPid)) continue;
    if (where === "inside") found.push({ pid, command });
    else if (where === "unknown") unplaceable.push({ pid, comm: `${command}, whose working directory lsof gave as "${cwd}"` });
  }

  for (const row of snap.recheck) {
    if (ours(row.pid) || row.uid !== snap.self || row.stat.startsWith("Z") || snap.cwds.has(row.pid)) continue;
    unplaceable.push({ pid: row.pid, comm: row.command === "" ? "(name unreadable)" : row.command });
  }

  return { kind: "checked", found, ambient: 0, unplaceable };
}

/** The macOS liveness answer for one tree, from a snapshot. Pure but for `contains`. */
export function darwinInUse(
  snap: DarwinSnapshot,
  contains: Containment,
  lockReason: string | undefined,
  askingPid: number,
  excludePipelineFilters = true,
): { standing: OwnerStanding; scan: CwdScan } {
  const chain = darwinAncestry(snap.ps, askingPid);
  const standing = darwinOwnerStanding(snap.ps, lockReason, chain);
  const scan = darwinCwdUsersUnder(snap, contains, new Set(chain), askingPid, excludePipelineFilters);
  return { standing, scan };
}

/** One command's result. Injected so every failure can be arranged in a test. */
export interface RunResult {
  /** `null` when it could not be started at all — lsof not installed, say. */
  status: number | null;
  stdout: string;
  stderr: string;
  /** The child's pid, when it was started. */
  pid?: number;
}

export type Runner = (cmd: string, args: readonly string[]) => RunResult;

export const spawnRunner: Runner = (cmd, args) => {
  const r = spawnSync(cmd, [...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error !== undefined) return { status: null, stdout: "", stderr: r.error.message };
  return { status: r.status, stdout: `${r.stdout ?? ""}`, stderr: `${r.stderr ?? ""}`, pid: r.pid };
};

function failed(cmd: string, r: RunResult): string {
  const said = r.stderr.trim().slice(0, 200);
  if (r.status === null) return `${cmd} could not be run${said === "" ? "" : `: ${said}`}`;
  return `${cmd} exited ${r.status}${said === "" ? "" : `: ${said}`}`;
}

/**
 * The three reads, or why they could not all be made. **Every failure is an
 * error, and the caller turns an error into `unknown`**: lsof missing, a
 * non-zero exit, output that does not parse, an empty listing.
 *
 * Read 3 is the one exception to "non-zero is a failure". `ps -p <list>` exits 1
 * when *none* of the listed pids exist, which is the ordinary answer "they all
 * exited", so an exit of 1 with nothing on stderr and empty output is
 * accepted. Anything on stderr is refused.
 */
export function readDarwinSnapshot(run: Runner = spawnRunner, self: number = process.getuid?.() ?? -1): DarwinSnapshot | { error: string } {
  const helpers: number[] = [];
  const note = (r: RunResult): RunResult => {
    if (r.pid !== undefined) helpers.push(r.pid);
    return r;
  };
  const ps1 = note(run("ps", ["-A", "-ww", "-o", PS_COLUMNS]));
  if (ps1.status !== 0) return { error: failed("ps", ps1) };
  const ps = parsePs(ps1.stdout);
  if (ps === null || ps.length === 0) return { error: "ps printed a process table this could not read" };

  const lsof = note(run("lsof", ["-n", "-P", "-w", "-d", "cwd", "-F", "pn"]));
  if (lsof.status !== 0) return { error: failed("lsof", lsof) };
  const cwds = parseLsofCwds(lsof.stdout);
  if (cwds === null || cwds.size === 0) return { error: "lsof printed a cwd listing this could not read" };

  const missing = unlistedPids(ps, cwds, self);
  let recheck: PsRow[] = [];
  if (missing.length > 0) {
    const r = note(run("ps", ["-ww", "-o", PS_COLUMNS, "-p", missing.join(",")]));
    if ((r.status !== 0 && r.status !== 1) || r.stderr.trim() !== "") return { error: failed("ps -p", r) };
    const parsed = parsePs(r.stdout);
    if (parsed === null) return { error: "ps -p printed something this could not read" };
    if (r.status === 1 && parsed.length !== 0) return { error: "ps -p failed with partial output" };
    if (r.status === 0 && parsed.length === 0) return { error: "ps -p reported success without any process rows" };
    if (parsed.some((row) => !missing.includes(row.pid))) return { error: "ps -p printed a process that was not requested" };
    recheck = parsed;
  }
  return { ps, cwds, recheck, self, helpers };
}
