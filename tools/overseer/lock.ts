/**
 * ONE WRITER, ENFORCED BY THE KERNEL.
 *
 * A lock file whose claim is `open(O_CREAT|O_EXCL)` and whose *diagnosis* is
 * the JSON record inside it. Extracted from `store.ts` on 2026-09-08 when a
 * second consumer arrived — the fleet dashboard's health retention, which needs
 * exactly this and whose GPT Sol review said so — for the same reason
 * [`jsonl.ts`](./jsonl.ts) exists: **this rule had been written twice and was
 * about to be written a third time**, and the third copy would have been the
 * simplified one, which is the copy that is wrong in the way nobody notices.
 *
 * It imports nothing but node builtins and `jsonl.ts`, so it stays importable
 * from anywhere. It knows nothing about stores, checkpoints or health samples;
 * it takes a path and answers whether you may write there.
 *
 * ## Why two daemons are worse than no daemon
 *
 * Two writers on one history do not corrupt it in a way anybody can see. They
 * both append plausible transitions and both overwrite the checkpoint, and the
 * result **reads as a perfectly ordinary afternoon that never happened**.
 * `O_APPEND` protects the write position and nothing else.
 *
 * ## The claim is one syscall, and that is the whole design
 *
 * `openSync(path, "wx")` is `O_CREAT|O_EXCL`: it either creates the file or
 * fails, with the kernel deciding. **Nothing built out of read-then-write can
 * do this.** An earlier version of this code wrote its record and read it back
 * to see whether it had won, and that is not exclusion — it catches only
 * contenders that wrote *before* the read, so two daemons could each read
 * themselves back and both proceed. GPT Sol's F4 and S3-01.
 *
 * ## Two checks for "do I still hold it", because each is blind to the other
 *
 * [`stillOurs`](#stillOurs) compares the INODE (dev and ino) *and* the record.
 * The inode catches a competitor that unlinked our lock and created its own —
 * the contents may be byte-identical and it is still not our file. The record
 * catches a lock overwritten in place, which keeps the inode and changes who it
 * says is running.
 *
 * ## The residual race is named rather than hidden
 *
 * Clearing a lock left by a **provably dead** process cannot be made atomic
 * without a primitive Node does not expose, so two starts can both prove the
 * same corpse dead and both proceed to claim. That is why a caller must
 * re-check `stillOurs` after any step that could have been raced — see how
 * `store.ts` re-checks it around the log repair — rather than trusting the
 * original claim forever.
 */
import { closeSync, existsSync, fstatSync, openSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { fsyncSync } from "node:fs";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

import { writeAll } from "./jsonl.js";

/** How many times to retry after clearing a lock that named a dead process. */
const STALE_LOCK_ATTEMPTS = 3;

/**
 * Who holds the lock, as written inside it.
 *
 * `hostname` and `startedAt` are not decoration: pid reuse is accepted
 * knowingly (see `isProcessAlive`), and they are how a person tells a
 * genuinely-live holder from a recycled pid by hand.
 */
export type LockHolder = { pid: number; instanceId: string; hostname: string; startedAt: string };

/**
 * Why the lock was refused. **Never a thrown string**: a launcher has to print
 * a sentence saying what a person should do, and an exception gives it nothing
 * to print that is not also a stack trace.
 */
export type LockRefusal =
  | { reason: "already-running"; holder: LockHolder }
  | { reason: "lock-unreadable"; detail: string }
  | { reason: "lost-the-race"; holder: LockHolder | null }
  | { reason: "unusable-directory"; detail: string };

/** The lock, held as an open file descriptor: the fd is the claim, the record inside it is the diagnosis. */
export type HeldLock = { holder: LockHolder; fd: number };

export type LockRead =
  | { kind: "absent" }
  | { kind: "held"; holder: LockHolder }
  | { kind: "unreadable"; detail: string };

/**
 * Whether a pid is running, asked of the kernel rather than of a file.
 *
 * `EPERM` is TRUE, not false: it means the process exists and belongs to
 * somebody else, and reading it as "gone" would let a second writer take a live
 * lock. `ESRCH` is the only proof of absence.
 *
 * **PID REUSE IS ACCEPTED, KNOWINGLY.** Linux hands pids out again after
 * wrapping, so a lock left by a dead holder whose pid has since been reused by
 * anything at all reads as held, and the next start refuses instead of taking
 * over. That is the safe direction — a refusal is one `rm` away from fixed and
 * says exactly which file to remove, where a wrongly-taken lock is two writers
 * producing a plausible history. The opposite mistake, a genuinely live holder
 * whose lock we steal, is what the check prevents and is the one worth spending
 * a false refusal on.
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "EPERM";
  }
}

function isRecord(u: unknown): u is Record<string, unknown> {
  return typeof u === "object" && u !== null && !Array.isArray(u);
}

/** Integer and positive: a fractional pid is not a pid. */
function isPidLike(u: unknown): u is number {
  return typeof u === "number" && Number.isInteger(u) && u > 0;
}

/**
 * Read the record inside a lock file.
 *
 * **An unreadable lock is not proof of anything**, which is why it gets its own
 * arm rather than being treated as absent: a stale unreadable lock is one `rm`
 * away from fixed, and stealing one is two writers away from a history nobody
 * can tell is wrong.
 */
export function readLock(path: string): LockRead {
  if (!existsSync(path)) return { kind: "absent" };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    return { kind: "unreadable", detail: String(cause) };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    return { kind: "unreadable", detail: String(cause) };
  }
  if (!isRecord(json)) return { kind: "unreadable", detail: "the lock is not an object" };
  const { pid, instanceId, hostname: host, startedAt } = json;
  if (!isPidLike(pid) || typeof instanceId !== "string" || typeof host !== "string" || typeof startedAt !== "string") {
    return { kind: "unreadable", detail: "the lock does not name a pid and an instance" };
  }
  return { kind: "held", holder: { pid, instanceId, hostname: host, startedAt } };
}

/**
 * Whether this process still holds the lock — **both the file and the record**.
 *
 * Two checks because there are two ways to lose it, and each check is blind to
 * the other's case. The INODE catches a competitor that unlinked our lock and
 * created its own: the contents may be byte-identical and it is still not our
 * file. The RECORD catches a lock overwritten in place, which keeps the inode
 * and changes who it says is running. `dev` as well as `ino`, because inode
 * numbers are unique only within a filesystem.
 *
 * Cheap enough to call on every tick — it costs a `stat` — and a caller that
 * writes forever without ever asking again is a caller that will keep writing
 * beside the winner.
 */
export function stillOurs(lock: HeldLock, path: string): boolean {
  let onDisk: ReturnType<typeof statSync>;
  try {
    onDisk = statSync(path);
  } catch {
    return false;
  }
  const ours = fstatSync(lock.fd);
  if (onDisk.ino !== ours.ino || onDisk.dev !== ours.dev) return false;
  const read = readLock(path);
  return read.kind === "held" && read.holder.instanceId === lock.holder.instanceId;
}

/** Remove a lock we have just proved dead — and only if it is still the same dead record. */
function clearStaleLock(path: string, expected: LockHolder): void {
  const again = readLock(path);
  if (again.kind !== "held" || again.holder.instanceId !== expected.instanceId) return;
  try {
    unlinkSync(path);
  } catch {
    /* Somebody else cleared it first, which is the outcome we wanted. */
  }
}

/**
 * Take the lock at `path`, or refuse.
 *
 * `now` is injected rather than read, so a test can pin `startedAt`; `beforeClaim`
 * is the seam a test uses to plant a competitor between the retry and the claim,
 * and it is the only way to exercise the race deterministically.
 */
export function takeLock(
  path: string,
  now: () => Date,
  beforeClaim?: () => void,
): { ok: true; lock: HeldLock } | { ok: false; refusal: LockRefusal } {
  for (let attempt = 0; attempt < STALE_LOCK_ATTEMPTS; attempt += 1) {
    beforeClaim?.();
    let fd: number;
    try {
      fd = openSync(path, "wx");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") {
        return { ok: false, refusal: { reason: "unusable-directory", detail: String(cause) } };
      }
      const existing = readLock(path);
      if (existing.kind === "unreadable") {
        return { ok: false, refusal: { reason: "lock-unreadable", detail: existing.detail } };
      }
      if (existing.kind === "held") {
        if (isProcessAlive(existing.holder.pid)) {
          return { ok: false, refusal: { reason: "already-running", holder: existing.holder } };
        }
        clearStaleLock(path, existing.holder);
      }
      // `absent` means it went away between the failed create and the read, so
      // the next attempt simply tries again.
      continue;
    }

    const holder: LockHolder = {
      pid: process.pid,
      instanceId: randomUUID(),
      hostname: hostname(),
      startedAt: now().toISOString(),
    };
    try {
      writeAll(fd, `${JSON.stringify(holder)}\n`);
      fsyncSync(fd);
    } catch (cause) {
      closeSync(fd);
      try {
        unlinkSync(path);
      } catch {
        /* Leaving an empty lock is a refusal next time, which is the safe direction. */
      }
      return { ok: false, refusal: { reason: "unusable-directory", detail: String(cause) } };
    }
    return { ok: true, lock: { holder, fd } };
  }
  return { ok: false, refusal: { reason: "lost-the-race", holder: null } };
}

/**
 * Release a lock we hold — **and only if we still hold it**.
 *
 * The `stillOurs` check is not tidiness. If somebody has taken the lock in the
 * meantime, unlinking it hands the resource to a third writer while the second
 * still believes it is alone.
 */
export function releaseLock(lock: HeldLock, path: string): void {
  try {
    if (stillOurs(lock, path)) unlinkSync(path);
  } catch {
    /* Gone already, which is the state we wanted. */
  }
  closeSync(lock.fd);
}

/**
 * A sentence a launcher can print, naming the file and what to do about it.
 *
 * Exported because the wording is the useful part: every one of these ends with
 * an action, since a refusal a person cannot act on is a crash with better
 * manners.
 */
export function describeLockRefusal(refusal: LockRefusal, path: string): string {
  switch (refusal.reason) {
    case "already-running":
      return `Another writer holds ${path} (pid ${refusal.holder.pid}, started ${refusal.holder.startedAt} on ${refusal.holder.hostname}). Refusing to run beside it.`;
    case "lock-unreadable":
      return `${path} exists and names nobody (${refusal.detail}), so this cannot prove nobody is running. Check, then remove ${path}.`;
    case "lost-the-race":
      return `Another writer took ${path} at the same moment${refusal.holder === null ? "" : ` (pid ${refusal.holder.pid})`}. Refusing to run beside it.`;
    case "unusable-directory":
      return `Could not take ${path}: ${refusal.detail}`;
  }
}
