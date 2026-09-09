/**
 * **One atomic file per run**, which is the whole storage design and the one
 * thing in this feature that got redesigned rather than tweaked.
 *
 *     ~/.fleet-readiness/runs/<startedAtEpochMs>-<runId>.json
 *
 * Written with `writeAtomically` from `tools/overseer/jsonl.ts`: a sibling temp
 * file, `fsync`, `rename` into place, and a **best-effort** `fsync` of the
 * directory — that last one is swallowed if the platform will not let you open a
 * directory for reading, so what is guaranteed here is that a reader sees either
 * the whole old file or the whole new one, not that the rename survives a power
 * cut. No lock. No rotation. No append. The terminal record **replaces** the
 * pending one at the same path, so there is no pair to join and no window in
 * which both exist.
 *
 * What this store does NOT defend is identity reuse: two `put`s with the same
 * runId and different `startedAt` make two files, and a pending write delayed
 * past its own terminal write would overwrite it. The wrapper mints a random id
 * per run and writes both records from one process in order, so neither is
 * reachable from here — it is written down because the store alone does not
 * enforce it. GPT Sol, 2026-09-09.
 *
 * ## Why not the append-only jsonl this feature's sibling uses
 *
 * `health-history.ts` has ONE writer — the dashboard — and takes an exclusive
 * lock. This store has **many**: every worktree, every agent, several at once,
 * each recording one run and exiting. The first draft of the plan proposed an
 * `O_APPEND` jsonl and argued that a single `writeSync` under 4096 bytes cannot
 * interleave. GPT Sol took that apart on 2026-09-09 and was right twice:
 *
 *  - `PIPE_BUF` is a **pipe** guarantee. It says nothing whatever about the
 *    record size of a regular file.
 *  - And it would not matter if it did, because `writeAll` **loops** over
 *    `writeSync` — deliberately, because a short write is possible — so a
 *    record is several syscalls and record-level atomicity is gone regardless:
 *
 *    > writer A writes the first 100 bytes of JSON and gets a short result →
 *    > writer B appends its complete line → A appends its remainder. The file
 *    > contains `A-prefix + B-line`, followed by `A-suffix`; both readings are
 *    > corrupt.
 *
 * A waiting lock around append-plus-repair-plus-rotation would also be correct.
 * Per-file is chosen over it because it is **smaller**: it removes the
 * torn-line repair, the rotation race, the double-rotation overwrite, the
 * reader-mid-rotation race, the orphaned-lock deadlock and the
 * open-fd-through-a-rename hazard *as a class* rather than defending against
 * each in turn.
 *
 * ## What that costs, weighed rather than waved through
 *
 * **A directory instead of a file.** At ~100 runs a day and 7 days' retention
 * that is ~700 files of ~600 bytes. The window is selected **from the
 * filenames**, before anything is opened, so a read touches only what it uses.
 *
 * **Retention is deletion, not rotation.** A writer opportunistically unlinks
 * records past the retention age, a bounded number per run. `unlink` is
 * idempotent, so two writers racing on the same victim is not an event.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { isAbsolute, join } from "node:path";

import { writeAtomically } from "../overseer/jsonl.js";
import {
  parseRunRecord,
  resolveRecord,
  type IsRunProcessAlive,
  type Reading,
  type RunRecord,
} from "./readiness.js";

/**
 * The default root, and `FLEET_READINESS_DIR` overrides it — **absolutely, or
 * not at all.**
 *
 * The same argument `health-history.ts` and `tools/overseer/store.ts` make:
 * every agent on this box works in its own worktree, so a *relative* override
 * resolves to a different directory depending on who started the process. Two
 * separate, entirely plausible histories, and nothing to say so.
 */
export const DEFAULT_READINESS_DIR = join(process.env["HOME"] ?? "/home/greg", ".fleet-readiness");

export const RUNS_SUBDIR = "runs";

/**
 * The override, read in one place so the wrapper and the dashboard cannot
 * disagree about where the records are.
 *
 * An empty or whitespace-only value is treated as unset rather than as a
 * relative path: `FLEET_READINESS_DIR=` in a shell profile is somebody clearing
 * it, and resolving that to the process's cwd would put a record in whichever
 * worktree happened to run the check.
 */
export function readinessDirFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const given = (env["FLEET_READINESS_DIR"] ?? "").trim();
  return given === "" ? DEFAULT_READINESS_DIR : given;
}

/** How long a record is kept. Long enough that a 24 h window is never the constraint. */
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** At most this many stale files are unlinked per write, so a writer never stalls. */
export const SWEEP_BUDGET = 50;

/**
 * How far before the window's start to look for records.
 *
 * The filename carries the **start** instant and the page plots the **finish**,
 * so a run that began before the window and ended inside it must still be
 * found. Three hours is about seven times the longest check here
 * (`npm run check`, ~26 minutes). Records found this way are then filtered
 * precisely on their parsed contents — this only decides which files are opened.
 */
export const WINDOW_LOOKBACK_MS = 3 * 60 * 60 * 1000;

/**
 * A file bigger than this is not one of ours.
 *
 * A record is ~600 bytes. The cap exists so that a directory somebody points
 * `FLEET_READINESS_DIR` at by mistake cannot make a request read a gigabyte.
 */
export const MAX_RECORD_BYTES = 64 * 1024;

export type OpenedStore =
  | { kind: "open"; store: ReadinessStore; dir: string }
  | { kind: "refused"; why: string };

export type ReadOptions = {
  /** Include runs that finished at or after this instant. */
  sinceMs: number;
  nowMs: number;
  /**
   * Is the process that wrote a pending record still running? Injected so a test
   * can drive the resolution without spawning anything.
   *
   * The default is {@link processStillAlive}.
   */
  isAlive?: IsRunProcessAlive;
};

export type StoreRead = {
  /** Oldest first, so a renderer can walk left to right. */
  readings: Reading[];
  /**
   * Files that would not parse. **Counted and surfaced, never skipped in
   * silence** — a corrupt latest record that is merely dropped exposes the
   * *previous* pass as the newest reading, which is the one lie this feature is
   * built to prevent. The route carries this and the verdict degrades to
   * unknown when it is non-zero.
   */
  unreadable: { file: string; why: string }[];
  /** How many files were in the window at all, before parsing. Diagnostic. */
  filesInWindow: number;
};

export type ReadinessStore = {
  /** Write (or replace) one run's record. Throws if it cannot — see the wrapper's contract. */
  put(record: RunRecord): void;
  read(options: ReadOptions): StoreRead;
  /** Delete records past {@link RETENTION_MS}. Bounded; safe to race. */
  sweep(nowMs: number): number;
  dir: string;
};

/** `<startedAtEpochMs>-<runId>.json`, zero-padded so lexical order is time order. */
export function recordFileName(startedAtMs: number, runId: string): string {
  return `${String(startedAtMs).padStart(15, "0")}-${runId}.json`;
}

/**
 * The start instant a filename encodes, or null when it is not one of ours.
 *
 * Parsed rather than trusted: this directory is on a real disk that a person
 * can put anything in, and the whole point of selecting on filenames is to
 * avoid opening files we are not going to use.
 */
export function startedAtFromFileName(name: string): number | null {
  const match = /^(\d{15})-([A-Za-z0-9_-]{4,64})\.json$/.exec(name);
  if (match === null) return null;
  const ms = Number(match[1]);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/**
 * The kernel's start time for a pid — field 22 of `/proc/<pid>/stat`, in clock
 * ticks since boot.
 *
 * **A pid is not an identity; the pair (pid, start time) is.** Field 22 is
 * counted from the END of the line rather than the start, because field 2 is the
 * executable name in parentheses and it may itself contain spaces and brackets —
 * splitting from the left is the classic way to parse this file wrong.
 *
 * Null off Linux, or when `/proc` cannot be read; callers fall back to the pid
 * alone and to `PENDING_TRUST_MS`.
 */
export function procStartToken(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    if (close === -1) return null;
    /* After the ")" the fields are: state, ppid, … — field 3 onwards. Field 22
       is therefore index 19 of what follows. */
    const rest = stat.slice(close + 2).trim().split(/\s+/);
    return rest[19] ?? null;
  } catch {
    return null;
  }
}

/**
 * Is the process behind a pending record still there?
 *
 * Three questions, and it takes the whole record because none of them can be
 * answered from a bare number:
 *
 *  - **The same box?** A pid recorded elsewhere means nothing here. (There is
 *    one box today; the field exists so that stops being an assumption.)
 *  - **Does the pid exist?** Signal 0. `EPERM` counts as alive — the process is
 *    there and simply not ours to signal, and reading that as dead would turn
 *    another agent's running suite into a void reading.
 *  - **Is it the SAME process?** The start-time token. Without it, a recycled
 *    pid makes a dead run read as running for ever, and the tab reports a suite
 *    in progress that nobody is running. GPT Sol's P1.2.
 */
export function processStillAlive(record: RunRecord): boolean {
  if (record.pid === null) return false;
  if (record.host !== null && record.host !== hostname()) return false;
  try {
    process.kill(record.pid, 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  /* A record written without a token, or a box with no readable `/proc`, falls
     back to the pid alone — weaker, and bounded by `PENDING_TRUST_MS`. What must
     not happen is treating an ABSENT token as a MISMATCH, which would call every
     live run void. */
  const now = procStartToken(record.pid);
  if (record.procStartToken === null || now === null) return true;
  return record.procStartToken === now;
}

export function openReadinessStore(dir: string = DEFAULT_READINESS_DIR): OpenedStore {
  if (!isAbsolute(dir)) {
    return {
      kind: "refused",
      why:
        `the readiness directory must be an absolute path, and this is ${JSON.stringify(dir)} — ` +
        "a relative one resolves differently for a systemd unit and for an agent in a worktree, " +
        "which is two plausible histories and no way to tell them apart",
    };
  }
  const runs = join(dir, RUNS_SUBDIR);
  try {
    mkdirSync(runs, { recursive: true });
  } catch (err) {
    return { kind: "refused", why: `could not create ${runs}: ${(err as Error).message}` };
  }

  const store: ReadinessStore = {
    dir: runs,

    put(record) {
      const startedMs = Date.parse(record.startedAt);
      if (Number.isNaN(startedMs)) {
        throw new Error(`a record whose startedAt is ${JSON.stringify(record.startedAt)} has nowhere to live`);
      }
      /* **A name this store's own reader would skip is a record that vanishes.**
         `put` and `startedAtFromFileName` have to agree, and when they did not
         the write succeeded, the file appeared on disk, and every subsequent
         read silently ignored it — a run recorded and lost, with the wrapper
         exiting 0 to say all was well. Found by the store's own round-trip
         test, which is the only place it could have been found. */
      const name = recordFileName(startedMs, record.runId);
      if (startedAtFromFileName(name) !== startedMs) {
        throw new Error(
          `runId ${JSON.stringify(record.runId)} does not make a filename this store can read back — ` +
            "it must be 4 to 64 characters of letters, digits, dash or underscore",
        );
      }
      writeAtomically(join(runs, name), runs, `${JSON.stringify(record, null, 2)}\n`);
    },

    read(options) {
      const isAlive = options.isAlive ?? processStillAlive;
      const readings: Reading[] = [];
      const unreadable: { file: string; why: string }[] = [];
      let filesInWindow = 0;

      let names: string[];
      try {
        names = readdirSync(runs);
      } catch (err) {
        /* An unreadable directory is reported as one unreadable entry rather
           than as an empty history: "we could not look" and "there is nothing
           there" must not draw the same. */
        return {
          readings: [],
          unreadable: [{ file: runs, why: `could not list the directory: ${(err as Error).message}` }],
          filesInWindow: 0,
        };
      }

      const floor = options.sinceMs - WINDOW_LOOKBACK_MS;
      for (const name of names) {
        const startedMs = startedAtFromFileName(name);
        /* Not one of ours: not an error, and not counted as a hole either. A
           temp file mid-rename looks exactly like this for a few microseconds. */
        if (startedMs === null) continue;
        if (startedMs < floor) continue;
        filesInWindow += 1;

        const path = join(runs, name);
        let text: string;
        try {
          const size = statSync(path).size;
          if (size > MAX_RECORD_BYTES) {
            unreadable.push({ file: name, why: `${size} bytes is far larger than any record we write` });
            continue;
          }
          text = readFileSync(path, "utf8");
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          /* Swept out from under us between the listing and the read. That is
             the retention sweep working, not a hole. */
          if (code === "ENOENT") continue;
          unreadable.push({ file: name, why: `could not read it: ${(err as Error).message}` });
          continue;
        }

        const record = parseRunRecord(text);
        if (record === null) {
          unreadable.push({ file: name, why: "the file is not a readiness record this build understands" });
          continue;
        }
        const reading = resolveRecord(record, options.nowMs, isAlive);
        if (reading.atMs >= options.sinceMs) readings.push(reading);
      }

      /* **Sorted by semantic time, not by directory order.** Once a backfill
         exists, "the last one listed" is not "the most recent" — a scan can
         produce yesterday's runs after today's, and a reader modelled on the
         health store's append order would call yesterday the latest. */
      readings.sort((a, b) => a.atMs - b.atMs);
      return { readings, unreadable, filesInWindow };
    },

    sweep(nowMs) {
      let removed = 0;
      let names: string[];
      try {
        names = readdirSync(runs);
      } catch {
        return 0;
      }
      for (const name of names) {
        if (removed >= SWEEP_BUDGET) break;
        const startedMs = startedAtFromFileName(name);
        if (startedMs === null || nowMs - startedMs <= RETENTION_MS) continue;
        try {
          rmSync(join(runs, name));
          removed += 1;
        } catch {
          /* Somebody else swept it, or it is not ours to delete. Neither is
             worth a word: the next sweep will find out. */
        }
      }
      return removed;
    },
  };

  return { kind: "open", store, dir: runs };
}

/** Is there a store there at all? For the route's "nothing has ever been recorded" sentence. */
export function readinessDirExists(dir: string = DEFAULT_READINESS_DIR): boolean {
  return existsSync(join(dir, RUNS_SUBDIR));
}
