/**
 * **The usage-history store: `~/.overseer/usage.jsonl`, written by the daemon
 * and read by the dashboard.**
 *
 * One line per `collectUsage` pass, roughly 288 a day. The record and its merge
 * contract are in `usage-history-record.ts`; this file is only about bytes on a
 * disk and who is allowed to write them.
 *
 * It mirrors `health-history.ts` closely — same append-only discipline, same
 * repair-on-open, same rotation — and reuses `../overseer/jsonl.js` rather than
 * copying it, exactly as `health-history.ts` does. **Two divergences are
 * deliberate**, both from GPT Sol's second plan review, and both are the kind of
 * thing that would otherwise arrive as a silent copy of a rule that does not
 * apply here.
 *
 * ## 1. No writer lock. The daemon's own lock is the one writer.
 *
 * Health elects its writer with a `writer.lock` because its writer is the
 * dashboard, of which there can be several — one on 8787 and a preview on 8799
 * sharing a directory. This store's writer is the **Overseer daemon**, and there
 * is exactly one of those by contract, enforced by a lock that is already held
 * before anything here opens.
 *
 * A second election is not merely redundant, it is a **deadlock**: process A
 * wins `usage-history/writer.lock`, process B wins the main Overseer lock, A
 * exits because it cannot be the daemon, and B runs for ever with a read-only
 * history handle. Nothing is written until somebody restarts it, and — because
 * the route lives in a different process and cannot see the writer's memory —
 * nothing can explain why. So `openUsageHistoryForWrite` asserts the daemon lock
 * is held and takes none of its own, and `openUsageHistoryForRead` cannot take
 * one at all: it is a different function with no lock code in it, rather than
 * the same one with a flag.
 *
 * ## 2. No `status()` for the route. Recorder health is DERIVED.
 *
 * Health's writer reports on itself and the route carries it, which works
 * because both are in one process. Here the writer is the daemon and the route
 * is the dashboard, so `failure`, `poisoned` and `lastAttemptAt` live in memory
 * the route cannot reach. Carrying them would be a lie by architecture.
 *
 * `status()` therefore exists for the **daemon's** own logging, and the route
 * answers the reader's question — *is anything still being recorded?* — from the
 * records: the last line's source instant plus its own `nextDueMs` against now.
 * That is weaker than health's answer and it is honest, which is the trade the
 * review asked for. The richer alternative (a status sidecar the daemon writes
 * and the dashboard reads) is written down in the plan as a later option, not
 * built.
 *
 * ## What is copied, because it is right
 *
 * Repair-on-open, an `O_APPEND` fd, one write per record, poisoning after a
 * partial write, rotation to a `.prev` file, `0700`/`0600` modes, and a read
 * that spans both files. The reasons are in `../overseer/jsonl.ts` and
 * `health-history.ts`; the one worth restating is **poisoning**, because it is
 * the rule that looks like over-caution and is not: `writeAll` loops over a
 * `writeSync` that can throw partway, and the repair that would fix a torn line
 * runs only at open — so the next append would weld a good record onto corrupt
 * bytes, and one append after that the damage is no longer the last line and is
 * no longer repairable at all.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync } from "node:fs";
import { chmodSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { truncateToLastLine, writeAll } from "../overseer/jsonl.js";
import { storeRoot } from "./attention.js";
import {
  MAX_LINE_BYTES,
  decodeUsageHistoryLine,
  encodeUsageHistoryLine,
  type UsageHistoryLine,
} from "./usage-history-record.js";

export const LIVE_FILE = "usage.jsonl";
export const PREV_FILE = "usage.prev.jsonl";

/**
 * The shortest interval the collector is allowed to run at.
 *
 * The rotation invariant is stated against this and against `MAX_LINE_BYTES`,
 * so it is a **contract**, not a description of today's timer: if the daemon's
 * `USAGE_INTERVAL_MS` is ever lowered below it, `worstCaseRetainedHours()` stops
 * being true and the test below goes red.
 */
export const MIN_PASS_INTERVAL_MS = 300_000;

/**
 * 32 MiB, and the number is derived rather than inherited.
 *
 * Health uses 8 MiB, which its own ~1 MB/day makes about eight days. Copying it
 * here was a bug caught in plan review: this store's contract is stated against
 * the **maximum legal record**, and 288 passes/day at 64 KiB is **18 MiB/day**,
 * so 8 MiB could rotate in under eleven hours — leaving `prev` holding less than
 * half the day it promises, moments after a rotation.
 *
 * A real record measures ~6.8 KB, so in practice this holds months. Sizing the
 * cap to the typical record rather than the legal one is the mistake: it is a
 * cap that works until a record grows, and then fails silently by discarding
 * history rather than by erroring.
 */
export const MAX_FILE_BYTES = 32 * 1024 * 1024;

/**
 * Hours of history the store guarantees at the worst legal record size and the
 * fastest permitted cadence — the invariant the plan asks for, computed rather
 * than asserted between two constants.
 *
 * Only `prev` counts. Immediately after a rotation `live` holds one line, so a
 * guarantee that leaned on `live` would be false exactly when it matters.
 */
export function worstCaseRetainedHours(): number {
  const linesPerFile = Math.floor(MAX_FILE_BYTES / MAX_LINE_BYTES);
  return (linesPerFile * MIN_PASS_INTERVAL_MS) / (60 * 60 * 1000);
}

/**
 * Where the store lives: **the Overseer's own store directory**, resolved by the
 * Overseer's own rule.
 *
 * `attention.ts`'s `storeRoot` rather than a fourth copy of the same six lines.
 * It already exists in `tools/overseer/store.ts` and in `attention.ts`, and the
 * rule it encodes is not obvious — a *relative* `OVERSEER_STORE_DIR` throws,
 * because it resolves differently for systemd and for a person in a worktree,
 * which is two stores and two histories that cannot see each other. A fresh copy
 * here would be a fourth place for that rule to drift.
 */
export function defaultUsageHistoryDir(env: NodeJS.ProcessEnv = process.env): string {
  return storeRoot(env);
}

/** A line, an unsupported line kept in place, or a record the store could not write. */
export type UsageHistorySample =
  | { kind: "sample"; sourceAtMs: number; line: UsageHistoryLine }
  | { kind: "omitted"; sourceAtMs: number; recordedAtMs: number; nextDueMs: number; why: string }
  /**
   * Written by a build this one does not understand. It has **no time**, because
   * a future envelope may not put one where this build looks — so it is placed
   * by file position and nothing else, which is exactly enough to break a series
   * across it.
   */
  | { kind: "unsupported"; summarySchema: number | null; why: string };

export type UsageHistoryRead =
  | {
      kind: "read";
      /** Oldest first, so a renderer can walk left to right. */
      samples: UsageHistorySample[];
      /**
       * The last sample BEFORE the window. Without it the left edge cannot be
       * classified: a window opening in the middle of an outage has nothing near
       * its start, and cannot say whether that emptiness is a gap already running
       * or simply where the record begins.
       */
      predecessor: UsageHistorySample | null;
      /** Where the unparseable lines were, not merely how many. A count alone lets a chart join across one. */
      holes: { afterAtMs: number | null; beforeAtMs: number | null }[];
      /** The oldest sample held AT ALL. Null when the store is empty. */
      earliestAt: string | null;
      /** True once a rotation has happened, so `earliestAt` is the oldest RETAINED sample, not the first ever taken. */
      rotated: boolean;
      unreadableLines: number;
      unsupportedLines: number;
      files: number;
    }
  | { kind: "unreadable"; why: string };

export type UsageRetentionStatus = {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  failure: string | null;
  /** Set after an append that may have written PART of a record. Refuses further appends until a restart. */
  poisoned: boolean;
};

export type UsageHistoryWriter = {
  append(line: UsageHistoryLine): void;
  /** For the daemon's own logging. **Not** for the route — see the header. */
  status(): UsageRetentionStatus;
  close(): void;
  path: string;
};

export type UsageHistoryReader = {
  read(options: { sinceMs: number; readFileForTest?: (path: string) => string }): UsageHistoryRead;
};

export type WriteOptions = {
  /**
   * Whether the Overseer's main daemon lock is already held by this process.
   *
   * A predicate rather than a boolean so the caller cannot pass a stale answer
   * captured before the lock was taken.
   */
  daemonLockHeld: () => boolean;
  maxFileBytes?: number;
  /** Tests only: rotate by line count, which is far cheaper than filling 32 MiB. */
  maxLinesPerFileForTest?: number;
  /** Tests only: reach the partial-write arm a healthy filesystem will not produce. */
  writeAllForTest?: (fd: number, text: string) => void;
};

function sourceInstant(line: UsageHistoryLine): string {
  return line.pass.kind === "pass" ? line.pass.collectedAt : line.pass.at;
}

export function openUsageHistoryForWrite(dir: string, options: WriteOptions): UsageHistoryWriter {
  if (!options.daemonLockHeld()) {
    throw new Error(
      "usage history: refusing to open for writing without the Overseer daemon lock. " +
        "There is one writer on this box and it is the daemon; a second election could pick a different winner " +
        "and leave the real daemon with a read-only handle for ever (see this file's header).",
    );
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  /* `recursive: true` does not apply the mode to a directory that already
     exists, and this one usually does — the daemon's store lives there. */
  chmodSync(dir, 0o700);

  const live = join(dir, LIVE_FILE);
  const prev = join(dir, PREV_FILE);
  if (existsSync(live)) truncateToLastLine(live);

  const maxBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
  const maxLines = options.maxLinesPerFileForTest;
  const write = options.writeAllForTest ?? writeAll;
  let fd = openSync(live, "a", 0o600);
  chmodSync(live, 0o600);
  let linesInLive = existsSync(live) ? countLines(live) : 0;

  const status: UsageRetentionStatus = {
    lastAttemptAt: null,
    lastSuccessAt: null,
    failure: null,
    poisoned: false,
  };

  function rotate(): void {
    closeSync(fd);
    renameSync(live, prev);
    fd = openSync(live, "a", 0o600);
    chmodSync(live, 0o600);
    linesInLive = 0;
  }

  return {
    path: live,
    status: () => ({ ...status }),
    close: () => {
      try {
        closeSync(fd);
      } catch {
        /* Already closed. Closing twice is not an error worth propagating. */
      }
    },
    append(line: UsageHistoryLine): void {
      if (status.poisoned) {
        throw new Error(`usage history: refusing to append, the file is poisoned by a partial write (${status.failure})`);
      }
      /* **ASKED ON EVERY APPEND, NOT ONCE AT OPEN.** A daemon that loses its main
         lock to another process while a pass is in flight goes on to finish that
         pass — shutdown deliberately waits for it — and would otherwise append to
         a history the new daemon may already be writing. Two writers can then
         rotate concurrently and drop a retained file with nothing to show for it.
         GPT Sol H12.

         NOTE the predicate at the one production call site is still `() => true`
         (usage-history-wiring.ts): re-asking it here makes the check structural,
         but it can only bite once the daemon exposes real lock ownership. That
         residue is recorded in the plan rather than hidden. */
      if (!options.daemonLockHeld()) {
        status.failure = "the Overseer daemon lock is no longer held by this process";
        throw new Error(`usage history: refusing to append — ${status.failure}`);
      }
      status.lastAttemptAt = new Date().toISOString();

      /* A record too large to write becomes a MARKER standing where it would
         have been, never a silent drop — the chart must not join across a
         reading that existed. `encodeUsageHistoryLine` is the only thing that
         knows the ceiling, so the refusal is caught rather than pre-checked. */
      let text: string;
      try {
        text = encodeUsageHistoryLine(line);
      } catch (error) {
        text = encodeUsageHistoryLine({
          lineSchema: line.lineSchema,
          summarySchema: line.summarySchema,
          recordedAt: line.recordedAt,
          nextDueMs: line.nextDueMs,
          pass: { kind: "omitted", at: sourceInstant(line), why: `the record could not be written: ${String(error)}` },
        });
      }

      const rotateNow =
        maxLines !== undefined
          ? linesInLive >= maxLines
          : maxBytes > 0 && existsSync(live) && statSync(live).size > 0 &&
            statSync(live).size + Buffer.byteLength(text, "utf8") > maxBytes;
      if (rotateNow) rotate();

      try {
        write(fd, text);
        linesInLive += 1;
        status.lastSuccessAt = new Date().toISOString();
        status.failure = null;
      } catch (error) {
        /* It may have written PART of the record. The repair only runs at open,
           so the next append would weld a good record onto corrupt bytes. */
        status.failure = String(error);
        status.poisoned = true;
        throw error;
      }
    },
  };
}

function countLines(path: string): number {
  try {
    const text = readFileSync(path, "utf8");
    return text.length === 0 ? 0 : text.split("\n").filter((l) => l.length > 0).length;
  } catch {
    return 0;
  }
}

type Decoded = {
  all: UsageHistorySample[];
  holes: { afterAtMs: number | null; beforeAtMs: number | null }[];
  unreadableLines: number;
  unsupportedLines: number;
};

/**
 * Turn raw lines into samples, in file order, **placing** the damage as well as
 * counting it.
 *
 * A hole is bracketed by the good samples either side of it (null at the ends of
 * the file). A count alone would let a renderer join its line straight across an
 * unparseable record — the same reconnection an unsupported line must not get.
 */
function decodeAll(lines: readonly string[]): Decoded {
  const all: UsageHistorySample[] = [];
  const holes: { afterAtMs: number | null; beforeAtMs: number | null }[] = [];
  let unreadableLines = 0;
  let unsupportedLines = 0;
  let pendingHole = false;
  let lastGoodMs: number | null = null;

  for (const raw of lines) {
    const decoded = decodeUsageHistoryLine(raw);
    if (decoded.kind === "unreadable") {
      unreadableLines += 1;
      pendingHole = true;
      continue;
    }
    if (decoded.kind === "unsupported") {
      unsupportedLines += 1;
      all.push({ kind: "unsupported", summarySchema: decoded.summarySchema, why: decoded.why });
      continue;
    }
    const at = Date.parse(sourceInstant(decoded.line));
    if (pendingHole) {
      holes.push({ afterAtMs: lastGoodMs, beforeAtMs: at });
      pendingHole = false;
    }
    lastGoodMs = at;
    all.push(
      decoded.line.pass.kind === "omitted"
        ? {
            /* THE CADENCE SURVIVES AN OMISSION. It was dropped here, and the
               consequence was that a store whose newest record was an omission
               reported `expectedEveryMs: null` for ever — so a recorder that
               then stopped could never be seen to be overdue. GPT Sol H3,
               reproduced. */
            kind: "omitted",
            sourceAtMs: at,
            recordedAtMs: Date.parse(decoded.line.recordedAt),
            nextDueMs: decoded.line.nextDueMs,
            why: decoded.line.pass.why,
          }
        : { kind: "sample", sourceAtMs: at, line: decoded.line },
    );
  }
  if (pendingHole) holes.push({ afterAtMs: lastGoodMs, beforeAtMs: null });
  return { all, holes, unreadableLines, unsupportedLines };
}

export function openUsageHistoryForRead(dir: string): UsageHistoryReader {
  return {
    read({ sinceMs, readFileForTest }) {
      const readFile = readFileForTest ?? ((p: string) => readFileSync(p, "utf8"));
      const live = join(dir, LIVE_FILE);
      const prev = join(dir, PREV_FILE);

      /* **A ROTATION DURING THIS READ WOULD LOSE A WHOLE FILE, so it is read
         twice.** The race: we read the old `prev`; the writer renames `live`
         over `prev` and starts an empty `live`; we then read that empty `live`
         and return old-prev + new-live, silently omitting everything that was
         just rotated. On a chart that is a giant hole with no explanation.

         `prev`'s identity before and after is the detector — `health-history.ts`
         does the same, and this omitted it. One retry only: a rotation inside two
         consecutive reads is not a thing that happens, and an unbounded retry on
         a filesystem that keeps changing is worse than a stale answer.
         GPT Sol H11. */
      const prevMark = (): string => {
        try {
          const st = statSync(prev);
          return `${st.ino}:${st.size}:${st.mtimeMs}`;
        } catch {
          return "absent";
        }
      };

      let files = 0;
      let lines: string[] = [];
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const before = prevMark();
          files = 0;
          lines = [];
          /* `prev` first: the read is oldest-first and a rotation moves the
             OLDER half out of the way. */
          for (const path of [prev, live]) {
            if (!existsSync(path)) continue;
            files += 1;
            const text = readFile(path);
            for (const raw of text.split("\n")) {
              if (raw.length > 0) lines.push(raw);
            }
          }
          if (prevMark() === before) break;
        }
      } catch (error) {
        return { kind: "unreadable", why: String(error) };
      }

      const { all, holes, unreadableLines, unsupportedLines } = decodeAll(lines);
      const earliest = all.find(
        (s): s is Extract<UsageHistorySample, { sourceAtMs: number }> => s.kind !== "unsupported",
      );

      /* The window keeps every timed sample at or after `sinceMs`, and every
         UNSUPPORTED entry that falls between the first and last of them by file
         position — an unsupported line has no time of its own, so position is
         the only thing that can place it, and dropping it would let the series
         reconnect across data this build could not read. */
      /* THE WINDOW IS A POSITION, NOT A FILTER — because an unsupported record
         has no time of its own and can only be placed by file order.

         This was `findIndex(timed && >= sinceMs)` and sliced from there, which
         returned NOTHING when no timed sample fell inside the window: a reader
         rolled back to schema 1, looking at a file whose recent records are all
         schema 2, would drop every unsupported marker and report an empty day.
         The page then says "nothing recorded" over a file that is full. GPT Sol
         H5.

         Walking to the last timed sample OLDER than the window and slicing after
         it keeps everything positioned after it, unsupported entries included,
         and yields the predecessor in the same pass. */
      let predIndex = -1;
      for (let i = 0; i < all.length; i += 1) {
        const candidate = all[i];
        if (candidate === undefined || candidate.kind === "unsupported") continue;
        if (candidate.sourceAtMs >= sinceMs) break;
        predIndex = i;
      }
      const samples = all.slice(predIndex + 1);
      const predecessor = predIndex === -1 ? null : (all[predIndex] ?? null);

      return {
        kind: "read",
        samples,
        predecessor,
        holes,
        earliestAt: earliest === undefined ? null : new Date(earliest.sourceAtMs).toISOString(),
        rotated: existsSync(prev),
        unreadableLines,
        unsupportedLines,
        files,
      };
    },
  };
}

/* Kept so a caller that wants to drop the store in a test can, without reaching
   for the filenames. */
export function removeUsageHistory(dir: string): void {
  for (const name of [LIVE_FILE, PREV_FILE]) {
    const path = join(dir, name);
    if (existsSync(path)) unlinkSync(path);
  }
}
