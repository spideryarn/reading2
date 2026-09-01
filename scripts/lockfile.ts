/**
 * An exclusive lock in a file.
 *
 * `scripts/deploy.ts` had one of these inline and it could be held by two
 * processes at once: `if (!existsSync(file)) return claim()` followed by an
 * `openSync(file, "w")` that never fails. Check, then act, with a gap. Two
 * deploys starting together both saw no file and both proceeded — the one thing
 * that lock exists to prevent, because (its own comment) "drizzle takes no lock
 * of any kind", so the second run reaches a `CREATE TABLE` that now exists.
 *
 * ## Three ways to get this wrong, all of which we did
 *
 * **1. Check, then act.** Fixed by making the claim itself the test. There is no
 * `existsSync` here and there must never be one.
 *
 * **2. A file that exists before it has contents.** `open(…, "wx")` publishes
 * the path and *then* the write happens. A contender reading in that window
 * sees an empty file, parses no pid, and concludes the holder is dead. So the
 * content is written to a private temporary file first and `link(2)` puts it in
 * place — atomic, fails with `EEXIST` if the path is taken, and the lock is
 * never visible without its contents.
 *
 * **3. Stealing a stale lock.** This one survived two rounds of review. Given
 * `read it, decide it is dead, unlink, create`:
 *
 * ```
 *   A: link fails, reads S, S is dead
 *   B: link fails, reads S, S is dead
 *   A: unlink S, create A            ← A holds it
 *   B: unlink — which is now A's —, create B
 *   → A and B both believe they hold the lock
 * ```
 *
 * POSIX has no unlink-if-unchanged, so this cannot be made safe with ordinary
 * file operations, and a bounded retry does not help: the damage is the
 * unconditional `unlink` before it. **So this lock does not steal.** A lock
 * whose holder is gone is reported, with the command to clear it, and the
 * caller refuses.
 *
 * That is affordable because the common deaths already release. `release` is
 * wired to `process.on("exit")`, which runs on a normal exit, an uncaught
 * throw, and the `SIGPIPE` from a deploy piped into `head` that motivated the
 * original stealing. Only `SIGKILL` or losing power leaves a file behind, and
 * then a human sees one clear line telling them what to delete.
 *
 * Used by the deploy gate, and by the database lease in
 * docs/plans/260828r-worktrees.md, where several worktrees share one Supabase stack.
 */
import { randomUUID } from "node:crypto";
import { closeSync, linkSync, openSync, readFileSync, rmSync, statSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";

/** Held lock. `release` is idempotent — calling it twice is not an error. */
export interface Lock {
  release(): void;
}

export interface LockOptions {
  /**
   * Does this pid still exist? Injected so a test can describe a holder that is
   * alive or dead without having to produce one.
   *
   * Only ever used to *describe* an existing lock in the error message. It
   * decides nothing — see "3. Stealing a stale lock".
   */
  isAlive?(pid: number): boolean;
  /** Clock, injected for tests. */
  now?(): Date;
  /** Ownership token. Injected for tests; otherwise a fresh UUID per claim. */
  token?: string;
}

function defaultIsAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    /* ESRCH is no such process. EPERM means it exists and belongs to somebody
       else, which counts as alive — saying "probably dead" wrongly is the worse
       direction, because it invites a human to delete a live lock. */
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Who holds the lock, as recorded in the file. */
export interface LockHolder {
  pid: number;
  since: string;
  /**
   * Unique per claim. A pid is not enough to prove ownership: pids are reused,
   * and one process can hold, release and re-claim the same path.
   */
  token: string;
}

/**
 * Read the holder, or `null` when there is genuinely no lock.
 *
 * **Only `ENOENT` counts as "no lock".** Every other read failure — a
 * permission problem, an I/O error — is thrown. Reporting one of those as
 * "nobody holds this" is the fail-open shape that this file is otherwise about.
 */
export function readLockHolder(file: string): LockHolder | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const [pid = "", since = "", token = ""] = text.split("\n");
  return { pid: Number(pid), since, token };
}

/**
 * Thrown when the lock is held. Carries the holder, and whether its process
 * still appears to be running, so the caller can tell the two situations apart.
 */
export class LockHeldError extends Error {
  readonly holder: LockHolder;
  readonly file: string;
  /** False means the recorded pid is gone: a leftover, needing manual removal. */
  readonly holderAlive: boolean;

  constructor(file: string, holder: LockHolder, holderAlive: boolean) {
    const who = Number.isFinite(holder.pid) && holder.pid > 0 ? `pid ${holder.pid}` : "an unreadable holder";
    super(
      holderAlive
        ? `Lock held by ${who}, started ${holder.since || "?"}.`
        : `Lock left behind by ${who} (started ${holder.since || "?"}), which is no longer running.\n` +
            "  Nothing holds it, but removing it automatically is not safe — two processes\n" +
            "  finding the same leftover would both take it. Clear it by hand:\n" +
            `    rm ${file}`,
    );
    this.name = "LockHeldError";
    this.file = file;
    this.holder = holder;
    this.holderAlive = holderAlive;
  }
}

/**
 * Put `body` at `file` atomically, or return null if something is already
 * there. On success returns the inode, so `release` can tell our file from a
 * later one at the same path.
 *
 * **Exported for `scripts/worktree-port.ts`, which needs this primitive without
 * the lock around it.** A port reservation has to outlive the process that made
 * it — `worktree:setup` claims a port and exits, and the worktree keeps that
 * port for its whole life — so it cannot use `takeLockFile`, whose exit hook is
 * the entire point of a lock and exactly wrong for a reservation. What it does
 * need is this: a file that appears only once, with its contents already in it.
 * Reimplementing that would duplicate the `linkSync`-a-written-temp subtlety
 * described above, and getting it wrong looks like working.
 */
export function publishExclusive(file: string, body: string): { ino: number } | null {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  const fd = openSync(tmp, "wx");
  try {
    writeSync(fd, body);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(tmp, file);
    return { ino: statSync(file).ino };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw err;
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Take the lock, or throw `LockHeldError`. Never steals; see the header. */
export function takeLockFile(file: string, opts: LockOptions = {}): Lock {
  const isAlive = opts.isAlive ?? defaultIsAlive;
  const now = opts.now ?? (() => new Date());
  const token = opts.token ?? randomUUID();
  const body = `${process.pid}\n${now().toISOString()}\n${token}\n`;

  const mine = publishExclusive(file, body);
  if (!mine) {
    const holder = readLockHolder(file);
    /* Vanished between the failed link and the read — released just now.
       Reported as held-and-alive so the caller retries rather than being told
       about a holder we cannot name. */
    if (!holder) throw new LockHeldError(file, { pid: 0, since: "", token: "" }, true);
    throw new LockHeldError(file, holder, isAlive(holder.pid));
  }

  /**
   * **Only ever unlink our own lock.**
   *
   * `release` is wired to process exit, and that hook outlives the lock it was
   * made for. Take, release, let another process claim the same path, then
   * exit: an unconditional unlink deletes *their* lock, and a third process
   * could then claim a path two others believe they hold. So both the inode and
   * the token are checked first.
   *
   * Not atomic — POSIX has no unlink-if-inode — but the remaining window needs
   * another process to claim the path in the microseconds between our check and
   * our unlink, *after* we have already released. Bounded and rare, where the
   * unconditional version was neither.
   */
  let done = false;
  const release = () => {
    if (done) return;
    done = true;
    process.off("exit", release);
    try {
      if (statSync(file).ino !== mine.ino) return;
      if (readLockHolder(file)?.token !== token) return;
      unlinkSync(file);
    } catch {
      /* Gone already, or unreadable. Either way it is not ours to remove, and a
         release that throws would mask whatever sent us here. */
    }
  };

  /* Released on the way out, however we leave. `finally` does not run when the
     process is killed, so the exit hook is the one that matters. */
  process.on("exit", release);
  return { release };
}
