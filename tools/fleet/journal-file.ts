/**
 * The bytes-on-disk half shared by the fleet action journals.
 *
 * Nothing here knows what a record means. Parsing policy, transition rules,
 * folding, retention and the decision to compact all belong to the domain
 * store. This module owns only the physical promises that are otherwise easy
 * to reproduce almost-right: one writer, repair before append, complete writes
 * on an O_APPEND fd, and atomic checkpoint replacement.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { truncateToLastLine, writeAll, writeAtomically, type JsonlRepair } from "../overseer/jsonl.js";
import { describeLockRefusal, releaseLock, stillOurs, takeLock, type HeldLock } from "../overseer/lock.js";

export type SharedJournalLock = {
  /** The one ownership claim shared by every journal, or null for a reader. */
  held: HeldLock | null;
  /** Why this composition is read-only. Null exactly when `held` is present. */
  lockedOutBy: string | null;
};

export type JournalFileStatus = {
  dir: string;
  file: string;
  /** Null when this process holds the writer lock; otherwise why it does not. */
  lockedOutBy: string | null;
  /** The most recent write failure, or null. */
  failure: string | null;
  /** Lines the caller's parser refused. */
  unreadableLines: number;
  /** What the open found at the end of the file. */
  repaired: JsonlRepair;
  /** How many successful atomic replacements this opener has made. */
  compactions: number;
};

/** One physical non-empty line, preserving its place in the file. */
export type JournalFileEntry<R> =
  | { kind: "record"; record: R }
  | { kind: "unreadable"; line: string };

export type JournalFile<R> = {
  dir: string;
  file: string;
  /** Parsed records, in file order. A copy: callers cannot mutate the core. */
  records(): R[];
  /** Every non-empty line the parser refused, byte-for-byte as decoded text. */
  rawUnreadableLines(): string[];
  /** Parsed and unreadable non-empty lines together, in physical file order. */
  entries(): JournalFileEntry<R>[];
  /** True only when the complete serialised record landed on disk. */
  append(record: R): boolean;
  /** Atomically replace the file with exactly these records. */
  replace(records: Iterable<R>): boolean;
  status(): JournalFileStatus;
  /** Releases the lock only when this core took it itself. */
  close(): void;
};

export type OpenJournalFileOptions<R> = {
  file: string;
  lockFile?: string | undefined;
  parse(line: string): R | null;
  serialise(record: R): string;
  /** Absent: take the lock here. Present: use this shared claim or refusal. */
  lock?: SharedJournalLock | undefined;
  writeLine?: ((fd: number, line: string) => void) | undefined;
  onTrouble?: ((why: string) => void) | undefined;
  /** For example, "the hold ledger directory", in an absolute-dir refusal. */
  directoryLabel: string;
  /** Appended to the standard lock-refusal sentence. */
  lockRefusalSuffix: string;
  /** Appended when an attempted write cannot be durable. */
  unavailableSuffix: string;
  /** Wording used after a self-owned journal gives its claim back. */
  closedBy: string;
};

export type OpenedJournalFile<R> =
  | { kind: "open"; journal: JournalFile<R> }
  | { kind: "refused"; why: string };

/**
 * Open one append-only JSONL file, either taking its lock or using a claim the
 * composition already took for several files.
 *
 * ## ONE WRITER, AND A SECOND OPENER STILL READS
 *
 * The lock is `tools/overseer/lock.ts`'s, imported rather than copied. Proving
 * that extraction behaviour-preserving by mutation found that
 * `isProcessAlive`'s `EPERM` branch survived 102 tests when flattened, and that
 * is the branch deciding whether a second writer can steal a LIVE lock. A
 * dashboard that loses the race still reads the journal. Two dashboards both
 * acting conservatively from the same evidence is the safe direction; two of
 * them appending to one file is not.
 */
export function openJournalFile<R>(dir: string, options: OpenJournalFileOptions<R>): OpenedJournalFile<R> {
  if (!isAbsolute(dir)) {
    return {
      kind: "refused",
      why: `the ${options.directoryLabel} must be an absolute path, and this is ${JSON.stringify(dir)}`,
    };
  }
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch (err) {
    return { kind: "refused", why: `could not create ${dir}: ${errorText(err)}` };
  }

  /* THE LOCK BEFORE THE REPAIR, health-history.ts's ordering and its reason:
     `truncateToLastLine` is a WRITE, and a process that will go on to be
     correctly refused must not first cut back the file belonging to the writer
     that owns it. */
  const path = join(dir, options.file);
  const lockPath = join(dir, options.lockFile ?? "writer.lock");
  const ownsLock = options.lock === undefined;
  let held: HeldLock | null;
  let lockedOutBy: string | null;
  if (options.lock === undefined) {
    const taken = takeLock(lockPath, () => new Date());
    held = taken.ok ? taken.lock : null;
    lockedOutBy = taken.ok
      ? null
      : `${describeLockRefusal(taken.refusal, lockPath)} ${options.lockRefusalSuffix}`;
  } else {
    held = options.lock.held;
    lockedOutBy = options.lock.lockedOutBy;
    if (held === null && lockedOutBy === null) {
      lockedOutBy = `no writer claim was handed in for ${lockPath}`;
    }
  }

  const giveUp = (why: string): OpenedJournalFile<R> => {
    if (ownsLock && held !== null) releaseLock(held, lockPath);
    held = null;
    return { kind: "refused", why };
  };

  let repaired: JsonlRepair = { torn: false };
  if (held !== null) {
    if (!stillOurs(held, lockPath)) {
      return giveUp(`another writer took ${lockPath} between claiming it and repairing ${path}`);
    }
    try {
      repaired = truncateToLastLine(path);
    } catch (err) {
      return giveUp(`could not repair ${path}: ${errorText(err)}`);
    }
    if (!stillOurs(held, lockPath)) {
      return giveUp(`another writer took ${lockPath} while ${path} was being repaired`);
    }
  }

  const records: R[] = [];
  const rawUnreadableLines: string[] = [];
  const entries: JournalFileEntry<R>[] = [];
  if (existsSync(path)) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (err) {
      return giveUp(`could not read ${path}: ${errorText(err)}`);
    }
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      const record = options.parse(line);
      if (record === null) {
        rawUnreadableLines.push(line);
        entries.push({ kind: "unreadable", line });
      } else {
        records.push(record);
        entries.push({ kind: "record", record });
      }
    }
  }

  const write = options.writeLine ?? writeAll;
  let failure: string | null = null;
  let compactions = 0;
  let closed = false;

  const trouble = (why: string): void => {
    if (failure === why) return;
    failure = why;
    options.onTrouble?.(why);
  };

  /**
   * **STILL OURS?** Asked of the filesystem before every append. `takeLock` at
   * startup is not a claim that survives the process, and the stale-lock race
   * `lock.ts` names can leave one claimant appending beside the winner for
   * ever. Action journals write rarely enough that the stat is immaterial.
   */
  const mayWrite = (): boolean => {
    if (closed) return false;
    if (held !== null && !stillOurs(held, lockPath)) {
      held = null;
      lockedOutBy = `the writer lock at ${lockPath} is no longer this process's — another writer took it`;
    }
    if (lockedOutBy !== null || held === null) {
      const refusal = lockedOutBy ?? `this process does not hold the writer lock at ${lockPath}`;
      trouble(`${refusal}. ${options.unavailableSuffix}`);
      return false;
    }
    return true;
  };

  const journal: JournalFile<R> = {
    dir,
    file: path,
    records: () => [...records],
    rawUnreadableLines: () => [...rawUnreadableLines],
    entries: () => [...entries],
    append(record): boolean {
      if (!mayWrite()) return false;
      let fd: number;
      try {
        fd = openSync(path, "a", 0o600);
      } catch (err) {
        trouble(`could not open ${path}: ${errorText(err)}`);
        return false;
      }
      try {
        write(fd, options.serialise(record));
      } catch (err) {
        trouble(`could not write to ${path}: ${errorText(err)}`);
        return false;
      } finally {
        closeSync(fd);
      }
      records.push(record);
      entries.push({ kind: "record", record });
      failure = null;
      return true;
    },
    replace(nextRecords): boolean {
      if (!mayWrite()) return false;
      const replacement = [...nextRecords];
      const text = replacement.map((record) => options.serialise(record)).join("");
      try {
        writeAtomically(path, dir, text);
      } catch (err) {
        trouble(`could not compact ${path}: ${errorText(err)}`);
        return false;
      }
      records.splice(0, records.length, ...replacement);
      entries.splice(
        0,
        entries.length,
        ...replacement.map((record): JournalFileEntry<R> => ({ kind: "record", record })),
      );
      compactions += 1;
      failure = null;
      return true;
    },
    status: () => ({
      dir,
      file: path,
      lockedOutBy,
      failure,
      unreadableLines: rawUnreadableLines.length,
      repaired,
      compactions,
    }),
    close(): void {
      /* IDEMPOTENT: `releaseLock` closes the fd and closing it twice is EBADF.
         A handed-in claim belongs to the composition, not either journal. */
      if (closed) return;
      closed = true;
      lockedOutBy = options.closedBy;
      if (!ownsLock || held === null) return;
      const mine = held;
      held = null;
      releaseLock(mine, lockPath);
    },
  };

  return { kind: "open", journal };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
