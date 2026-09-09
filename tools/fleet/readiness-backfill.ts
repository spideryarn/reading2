/**
 * **Reconstructing runs from `logs/tmux-jobs/`**, so the tab is not empty on the
 * day it ships and has a day of history behind it on the day after.
 *
 * ## Computed at read time. Never written down.
 *
 * The first draft of the plan persisted these, and that was wrong three
 * separate ways — every one of which disappears when the scan is recomputed per
 * request instead:
 *
 *  - **It duplicated the wrapper on the normal path.** `readiness-run.ts` is
 *    meant to be run *inside* `tmux-job.ts`, so every wrapper run also has a
 *    log; the scan would reconstruct a second, weaker copy with no sha, stamped
 *    a moment later because tmux appends `EXIT=` after the wrapper exits — so
 *    the duplicate would win on recency. (The `readiness-run <runId>` marker
 *    below is the belt to that braces.)
 *  - **It wrote yesterday's runs after today's**, breaking any reader that took
 *    the last record as the newest.
 *  - **It froze a provisional reading for ever.** A log read a second before its
 *    `EXIT=` line lands is *not complete yet*; persisted as `void`, it stays
 *    void after the run succeeds. Recomputed, it simply corrects itself.
 *
 * ## What a log may be asked, and what it may not
 *
 * A tmux-job log records **nothing about the commit it ran on**. So a
 * reconstructed run arrives with `unknown` tree stamps, and
 * `readiness-verdict.ts` refuses it a vote — permanently, by construction, not
 * by a rule somebody has to remember. It is history, and history is worth
 * having; it is not evidence that dev is green.
 */
import { readdirSync, readFileSync, openSync, closeSync, readSync, fstatSync } from "node:fs";
import { basename, join } from "node:path";

import {
  footerRequired,
  joinEnds,
  parseBanner,
  parseExitLine,
  parseOutput,
  scopeOf,
} from "./readiness-parse.js";
import {
  outcomeFromExit,
  type CheckKind,
  type FinishedRecord,
  type Reading,
  type StartedRecord,
  type TreeStamp,
} from "./readiness.js";

/** The tmux-job log directory, relative to a checkout. Mirrors `scripts/tmux-job.ts` § LOG_DIR. */
export const LOG_DIR = "logs/tmux-jobs";

/** At most this many logs are opened per scan, newest first. */
export const MAX_LOGS = 200;

/** The two ends of a log we read. A full-suite log is megabytes; everything we need is here. */
export const HEAD_BYTES = 2 * 1024;
export const TAIL_BYTES = 8 * 1024;

/**
 * How long a log must have been quiet before "no `EXIT=` line" means *killed*
 * rather than *still going*.
 *
 * > scanner reads a currently growing log just before its `EXIT=` append →
 * > records `void` → the run finishes successfully → a later scan adds `pass`,
 * > or no later scan occurs and it remains permanently void.
 * >
 * > — GPT Sol, 2026-09-09
 *
 * Two minutes is longer than any gap a live check leaves between writes (vitest
 * prints per file, `check.ts` per step) and short enough that a killed run is
 * reported while somebody still cares.
 */
export const QUIET_BEFORE_VOID_MS = 2 * 60 * 1000;

/** Why a scanned run can never vote. Stored on the record, so the page can say it. */
export const NO_SHA_IN_LOGS =
  "reconstructed from a tmux-job log, which records nothing about the commit it ran on";

const UNKNOWN_TREE: TreeStamp = { kind: "unknown", why: NO_SHA_IN_LOGS };

export type ScanOptions = {
  /** Checkout roots to scan. Each contributes its own `logs/tmux-jobs/`. */
  roots: readonly string[];
  sinceMs: number;
  nowMs: number;
  /** Run ids already held by the store, so a wrapper's own log is not doubled. */
  knownRunIds: ReadonlySet<string>;
  /** `package.json` script bodies, for telling a full run from a narrowed one. */
  scriptBodies: Readonly<Record<string, string>>;
  maxLogs?: number;
};

export type ScanResult = {
  readings: Reading[];
  /**
   * **What the scan could not account for, counted rather than dropped.**
   *
   * A truncated scan that says nothing turns into "no reading", and a parser
   * broken by a format change silently deletes history. So: how many logs were
   * skipped for want of budget, and every log that looked like a check but
   * would not parse, with its reason. GPT Sol's P1.7 and P2.
   */
  skippedForBudget: number;
  unreadable: { file: string; why: string }[];
  /** Directories that could not be listed at all. Not the same as an empty one. */
  unreadableRoots: { root: string; why: string }[];
  /** How many logs were recognised as this feature's own wrapper runs and left to the store. */
  dedupedAgainstWrapper: number;
};

/** The `readiness-run <runId>` line the wrapper prints as its first output. */
const MARKER = /^readiness-run ([0-9a-f]{6,32}) (\S+)/m;

/** Read the first and last chunk of a file without pulling the middle through memory. */
function readEnds(path: string): { head: string; text: string; sizeBefore: number; sizeAfter: number; mtimeMs: number } {
  const fd = openSync(path, "r");
  try {
    const before = fstatSync(fd);
    const head = Buffer.alloc(Math.min(HEAD_BYTES, before.size));
    if (head.length > 0) readSync(fd, head, 0, head.length, 0);
    const tailLength = Math.min(TAIL_BYTES, before.size);
    const tail = Buffer.alloc(tailLength);
    if (tailLength > 0) readSync(fd, tail, 0, tailLength, before.size - tailLength);
    /* **Stat again afterwards.** A log being written while we read it can give a
       head and a tail from two different states of the file, and a tail from a
       later state than the head is how a half-written summary reads as a whole
       one. The caller treats a size change as "still moving". */
    const after = fstatSync(fd);
    const headText = head.toString("utf8");
    const tailText = tail.toString("utf8");
    return {
      head: headText,
      /* **Joined by size, not concatenated.** For a log smaller than the two
         windows together these overlap completely, and feeding both to the
         parsers counts every line twice — `joinEnds` is where that is argued. */
      text: joinEnds(headText, tailText, before.size),
      sizeBefore: before.size,
      sizeAfter: after.size,
      mtimeMs: after.mtimeMs,
    };
  } finally {
    closeSync(fd);
  }
}

/**
 * One log to a reading, or a reason it is not one.
 *
 * Exported so the tests can drive it on fixtures without a directory.
 */
export function readingFromLog(
  file: string,
  contents: { head: string; text: string; mtimeMs: number; stillMoving: boolean },
  options: { cwd: string; nowMs: number; scriptBodies: Readonly<Record<string, string>> },
): { reading: Reading } | { skip: "not-a-check" } | { unreadable: string } {
  const banner = parseBanner(contents.head);
  /* **A banner, or nothing.** An overseer daemon log and a codex run are not
     checks and are left alone; guessing from their contents is how something
     that is not a suite becomes "the tests passed". npm's banner gives the
     script AND its arguments; vitest's own gives a test run whose scope is
     unknown, which is worth having as history and can never vote. */
  if (banner === null) return { skip: "not-a-check" };
  if (banner.kind === "other") return { skip: "not-a-check" };

  const check: CheckKind = banner.kind;
  const scope = scopeOf(banner, options.scriptBodies);
  const exit = parseExitLine(contents.text);
  const startedAt = new Date(contents.mtimeMs).toISOString();

  const common = {
    schema: 1 as const,
    /* Deterministic, so rescanning the same log twice produces the same
       identity rather than two runs. */
    runId: `log-${basename(file).replace(/\.log$/, "")}`,
    startedAt,
    pid: null,
    host: null,
    cwd: options.cwd,
    check,
    scope,
    commandLine: banner.commandLine,
    treeAtStart: UNKNOWN_TREE,
    source: "tmux-log" as const,
  };

  if (exit === null) {
    /* No `EXIT=` line means "not complete when I looked", which is not the same
       as "killed" — so a log still being written, or written to recently, is
       RUNNING. Only one that has gone quiet is void. */
    const quiet = options.nowMs - contents.mtimeMs;
    if (contents.stillMoving || quiet < QUIET_BEFORE_VOID_MS) {
      const started: StartedRecord = { ...common, state: "started" };
      return {
        reading: { record: started, state: "running", atMs: contents.mtimeMs, why: null },
      };
    }
    const finished: FinishedRecord = {
      ...common,
      state: "finished",
      at: startedAt,
      durationMs: null,
      outcome: "void",
      exit: null,
      counts: { kind: "none" },
      treeAtEnd: UNKNOWN_TREE,
      logPath: file,
      why:
        `the log has no EXIT= line and has been quiet for ${Math.round(quiet / 60000)} minutes — ` +
        "whatever it printed, nothing recorded how it ended",
    };
    return { reading: { record: finished, state: "void", atMs: contents.mtimeMs, why: finished.why } };
  }

  const read = outcomeFromExit(exit);
  let outcome = read.outcome;
  let why = read.why;
  const { counts, hasFooter } = parseOutput(check, contents.text);

  /* **`EXIT=0` alone is not a pass.** A nested process can die while the outer
     wrapper exits 0. Only ever downgrades. */
  if (outcome === "pass" && footerRequired(check) && !hasFooter) {
    outcome = "void";
    why = `it exited 0, but the log has no ${check} summary in it — nothing shows the run reached a conclusion`;
  }

  const finished: FinishedRecord = {
    ...common,
    state: "finished",
    at: new Date(contents.mtimeMs).toISOString(),
    durationMs: null,
    outcome,
    exit,
    counts,
    treeAtEnd: UNKNOWN_TREE,
    logPath: file,
    why,
  };
  return { reading: { record: finished, state: outcome, atMs: contents.mtimeMs, why } };
}

export function scanLogs(options: ScanOptions): ScanResult {
  const result: ScanResult = {
    readings: [],
    skippedForBudget: 0,
    unreadable: [],
    unreadableRoots: [],
    dedupedAgainstWrapper: 0,
  };
  const budget = options.maxLogs ?? MAX_LOGS;

  /* Everything in the window from every root first, so the budget is spent on
     the newest logs across the box rather than on whichever directory was
     listed first. */
  const candidates: { path: string; cwd: string; mtimeMs: number }[] = [];
  for (const root of options.roots) {
    const dir = join(root, LOG_DIR);
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      /* A checkout with no logs directory has simply never run a job. That is
         not a fault and must not be reported as one. */
      if (code !== "ENOENT") {
        result.unreadableRoots.push({ root: dir, why: (err as Error).message });
      }
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".log")) continue;
      const path = join(dir, name);
      try {
        const fd = openSync(path, "r");
        try {
          const stat = fstatSync(fd);
          if (stat.mtimeMs < options.sinceMs) continue;
          candidates.push({ path, cwd: root, mtimeMs: stat.mtimeMs });
        } finally {
          closeSync(fd);
        }
      } catch {
        /* Gone between listing and opening, or not ours to read. Neither is
           worth a line: the next scan will find out. */
      }
    }
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (candidates.length > budget) {
    result.skippedForBudget = candidates.length - budget;
    candidates.length = budget;
  }

  for (const candidate of candidates) {
    let ends: ReturnType<typeof readEnds>;
    try {
      ends = readEnds(candidate.path);
    } catch (err) {
      result.unreadable.push({ file: candidate.path, why: (err as Error).message });
      continue;
    }

    /* The wrapper's own log. Its record is already in the store, with a sha and
       both instants; this reconstruction would be a strictly weaker duplicate,
       stamped later because tmux appends EXIT= after the wrapper exits. */
    const marker = MARKER.exec(ends.head);
    if (marker !== null && options.knownRunIds.has(marker[1] ?? "")) {
      result.dedupedAgainstWrapper += 1;
      continue;
    }

    const outcome = readingFromLog(
      candidate.path,
      {
        head: ends.head,
        text: ends.text,
        mtimeMs: ends.mtimeMs,
        stillMoving: ends.sizeAfter !== ends.sizeBefore,
      },
      { cwd: candidate.cwd, nowMs: options.nowMs, scriptBodies: options.scriptBodies },
    );
    if ("reading" in outcome) {
      if (outcome.reading.atMs >= options.sinceMs) result.readings.push(outcome.reading);
    } else if ("unreadable" in outcome) {
      result.unreadable.push({ file: candidate.path, why: outcome.unreadable });
    }
  }

  result.readings.sort((a, b) => a.atMs - b.atMs);
  return result;
}

/**
 * The checkouts to scan: the primary, and every worktree under it.
 *
 * Worktrees are where most of the box's suites actually run, so a scan of the
 * primary alone would show a nearly empty day on a night when a dozen agents
 * were testing continuously.
 */
export function checkoutRoots(primary: string): string[] {
  const roots = [primary];
  const worktrees = join(primary, ".claude", "worktrees");
  try {
    for (const name of readdirSync(worktrees, { withFileTypes: true })) {
      if (name.isDirectory()) roots.push(join(worktrees, name.name));
    }
  } catch {
    /* No worktrees directory: a checkout nobody has branched from. */
  }
  return roots;
}

/** `package.json` script bodies for a checkout, or `{}` when it has none we can read. */
export function scriptBodiesFor(root: string): Record<string, string> {
  try {
    const pkg: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const scripts = (pkg as { scripts?: unknown }).scripts;
    if (typeof scripts !== "object" || scripts === null) return {};
    const out: Record<string, string> = {};
    for (const [name, body] of Object.entries(scripts as Record<string, unknown>)) {
      if (typeof body === "string") out[name] = body;
    }
    return out;
  } catch {
    return {};
  }
}
