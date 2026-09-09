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
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  opendirSync,
  readFileSync,
  readSync,
  statSync,
  type Dir,
  type Dirent,
} from "node:fs";
import { basename, join } from "node:path";

import {
  footerRequired,
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

/** At most this many logs are READ per scan, newest first. */
export const MAX_LOGS = 200;

/**
 * At most this many directory entries are even stat'ed.
 *
 * A separate, larger bound from {@link MAX_LOGS}, because the two protect
 * against different things: that one bounds the reading, this one bounds the
 * *looking*, which used to be unbounded and is what a pathological directory
 * would exploit first.
 */
export const MAX_DISCOVERED = 5000;

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
 * This said two minutes, and claimed to exceed every gap a live check leaves
 * between writes. **Neither half was established.** A database wait, a slow
 * import, or one long test file can go quiet for far longer than two minutes,
 * and the code checked nothing about whether the run was alive — so a healthy
 * suite could be reported as killed.
 *
 * Ten minutes is a bound with some margin, and it is the WEAKER of the two
 * signals: when the caller can say whether the job's tmux session is still
 * alive ({@link ScanOptions.isSessionLive}), that answer wins outright and this
 * is never consulted. GPT Sol's P1.3.
 */
export const QUIET_BEFORE_VOID_MS = 10 * 60 * 1000;

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
  /**
   * `package.json` script bodies **per checkout root**, for telling a full run
   * from a narrowed one.
   *
   * Per root rather than one map for all of them: a branch whose `package.json`
   * differs would otherwise be classified against the wrong script body. It
   * cannot affect readiness — a scanned run never votes — but it can put the
   * wrong scope on somebody's history. GPT Sol's P2.
   */
  scriptBodiesFor: (root: string) => Readonly<Record<string, string>>;
  /**
   * Is the tmux session that produced this log still alive?
   *
   * Optional, and **`undefined` means "we did not look"**, which falls back to
   * the quiet window rather than to a guess. Supplied by the caller rather than
   * looked up here: asking tmux belongs off the request path.
   *
   * It does **not** outrank direct observation — see the ladder in
   * {@link readingFromLog}. A file that is growing right now is being written by
   * something, whatever a session lookup from a moment ago says.
   */
  isSessionLive?: (logPath: string) => boolean | undefined;
  maxLogs?: number;
  /** How many directory entries to consider before giving up and saying so. */
  maxDiscovered?: number;
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
  /**
   * The listing was abandoned at the discovery cap, so the answer may be
   * incomplete.
   *
   * **"May be" is exact.** Reaching the cap sets this without probing for EOF,
   * so a directory holding precisely the cap reports truncation and has in fact
   * lost nothing. Erring that way is deliberate: the alternative is one more
   * `readSync` to find out, and a page that says "possibly incomplete" when it
   * is complete costs a reader nothing, where the reverse costs them the truth.
   *
   * A boolean rather than a count, because once you stop reading a directory you
   * do not know how much is left — and inventing a number would be exactly the
   * confident wrong figure this feature exists to avoid.
   */
  discoveryTruncated: boolean;
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
  /**
   * **`O_NONBLOCK`, and then check what we actually opened.**
   *
   * `Dirent.isFile()` in `discoverLogs` excludes a FIFO that already exists, but
   * there is a window between that listing and this open in which a regular file
   * could be replaced by one — and opening a FIFO with no writer blocks for ever,
   * which on a single-threaded dashboard is the whole page. `O_NONBLOCK` makes
   * the open return immediately whatever it found, and `fstat` on the fd we hold
   * says what it really is. GPT Sol, round 3.
   */
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile()) {
      throw new Error("it is not a regular file — something replaced it between the listing and the read");
    }
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
      /* `before.size` is BYTES and these are JavaScript strings. Passing the
         byte count made a small log full of `✓` — three bytes, one character —
         miss both whole-window branches and get concatenated with itself, which
         is the doubling `joinEnds` exists to prevent, reintroduced through a
         unit mismatch. Decide it here, where the byte bounds are known. */
      text:
        before.size <= HEAD_BYTES
          ? headText
          : before.size <= TAIL_BYTES
            ? tailText
            : `${headText}\n…\n${tailText}`,
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
  options: {
    cwd: string;
    nowMs: number;
    scriptBodies: Readonly<Record<string, string>>;
    /**
     * Is the tmux session behind this log still alive? `undefined` means nobody
     * looked — treated as possibly-alive, because calling a live run void is
     * manufacturing an outage that never happened.
     */
    sessionLive?: boolean | undefined;
  },
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
    /* A reconstructed run has no process to identify: it is finished (or its
       liveness comes from the tmux session, not from a pid we recorded). */
    pid: null,
    host: null,
    procStartToken: null,
    cwd: options.cwd,
    check,
    scope,
    commandLine: banner.commandLine,
    treeAtStart: UNKNOWN_TREE,
    source: "tmux-log" as const,
  };

  if (exit === null) {
    /**
     * **No `EXIT=` line means "not complete when I looked", not "killed".**
     *
     * A ladder, in order of how much each rung actually proves:
     *
     *  1. **The file grew under the read** — running. Direct observation, and it
     *     beats everything below: something is writing to this file *now*,
     *     whatever a session lookup from a moment ago believed.
     *  2. **`sessionLive === true`** — somebody looked and the job is alive.
     *     Running, however long it has been quiet: a suite waiting on a
     *     database, or grinding through one slow file, prints nothing for
     *     minutes at a time.
     *  3. **`sessionLive === false`** — somebody looked and the job is gone.
     *     Void straight away; waiting out a timer to agree with an answer we
     *     already have only delays the truth.
     *  4. **`undefined`** — nobody looked, so fall back to the quiet window.
     *
     * Making `undefined` mean *possibly alive* on its own was the first attempt
     * and it was worse than the bug it fixed: with no caller supplying the hook,
     * no log could ever become void and the killed-run detection vanished
     * silently. The fallback has to stay a real branch.
     */
    const quiet = options.nowMs - contents.mtimeMs;
    const live =
      contents.stillMoving ||
      options.sessionLive === true ||
      (options.sessionLive === undefined && quiet < QUIET_BEFORE_VOID_MS);
    if (live) {
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
        options.sessionLive === false
          ? "the log has no EXIT= line and the tmux session that was writing it is gone — whatever it printed, nothing recorded how it ended"
          : `the log has no EXIT= line and has been quiet for ${Math.round(quiet / 60000)} minutes — ` +
            "whatever it printed, nothing recorded how it ended (nobody checked whether its session is still alive)",
    };
    return { reading: { record: finished, state: "void", atMs: contents.mtimeMs, why: finished.why } };
  }

  /* **A file that grew under the read is still going, whatever it appears to
     end with.** A check that prints its own `EXIT=`-shaped line and carries on
     would otherwise be read as finished. `parseExitLine` already requires the
     terminal line; this is the second half of that guard, and it is the half
     that does not depend on the format. */
  if (contents.stillMoving) {
    const started: StartedRecord = { ...common, state: "started" };
    return { reading: { record: started, state: "running", atMs: contents.mtimeMs, why: null } };
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

type Candidate = { path: string; cwd: string; mtimeMs: number };

/**
 * **Which logs are worth reading — bounded, and opening nothing.**
 *
 * A separate function from {@link scanLogs} because it is a separate job:
 * finding candidates and spending a reading budget on them are answers to
 * different questions, and keeping them in one loop is what let the bound sit in
 * the wrong place.
 *
 * It used to `openSync` every `*.log` in every root before truncating to 200.
 * GPT Sol's P1.6: a directory that has accumulated 100,000 logs makes one
 * request perform 100,000 opens and an unbounded sort — and **a FIFO named
 * `something.log` blocks `openSync` outright**, which on a single-threaded
 * dashboard is the whole page hanging.
 *
 * So: `withFileTypes` to reject anything that is not a regular file (a FIFO
 * never reaches an open), `statSync` rather than an open for the mtime (stat
 * does not block on a FIFO either), and a hard cap on how many entries are
 * considered at all — reported, because a truncated scan that says nothing
 * becomes "no reading".
 */
export function discoverLogs(options: {
  roots: readonly string[];
  sinceMs: number;
  maxDiscovered?: number;
}): {
  candidates: Candidate[];
  /** True when a directory held more entries than the cap, so we stopped early. */
  truncated: boolean;
  unreadable: { file: string; why: string }[];
  unreadableRoots: { root: string; why: string }[];
} {
  const candidates: Candidate[] = [];
  const unreadable: { file: string; why: string }[] = [];
  const unreadableRoots: { root: string; why: string }[] = [];
  const cap = options.maxDiscovered ?? MAX_DISCOVERED;
  let discovered = 0;
  let truncated = false;

  for (const root of options.roots) {
    const dir = join(root, LOG_DIR);
    let handle: Dir;
    try {
      handle = opendirSync(dir);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      /* A checkout with no logs directory has simply never run a job. That is
         not a fault and must not be reported as one. Anything else is. */
      if (code !== "ENOENT") unreadableRoots.push({ root: dir, why: (err as Error).message });
      continue;
    }
    try {
      for (;;) {
        if (discovered >= cap) {
          /* **The cap has to stop the LISTING, not just the stat-ing.** With
             `readdirSync` it did not: that call materialises every entry before
             returning, so a directory holding 100,000 logs was fully read and
             fully walked whatever the cap said, and the bound existed only on
             paper. `opendirSync` hands back a cursor we can abandon. GPT Sol,
             round 2, 2026-09-09. */
          truncated = true;
          break;
        }
        const entry: Dirent | null = handle.readSync();
        if (entry === null) break;
        discovered += 1;
        if (!entry.name.endsWith(".log")) continue;
        /* `isFile()` is false for a FIFO, a socket, a device and a directory.
           Some filesystems report UNKNOWN, in which case this is false too and
           we skip — losing a log rather than risking a blocking open. */
        if (!entry.isFile()) continue;
        const path = join(dir, entry.name);
        try {
          const stat = statSync(path);
          if (stat.mtimeMs < options.sinceMs) continue;
          candidates.push({ path, cwd: root, mtimeMs: stat.mtimeMs });
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          /* Swept away between the listing and the stat: routine, not a hole.
             Anything else — a permission problem, most likely — is reported,
             because the rest of this design insists on explicit unreadable arms. */
          if (code !== "ENOENT") unreadable.push({ file: path, why: (err as Error).message });
        }
      }
    } finally {
      try {
        handle.closeSync();
      } catch {
        /* Already closed, or the directory went away under us. */
      }
    }
  }

  return { candidates, truncated, unreadable, unreadableRoots };
}

export function scanLogs(options: ScanOptions): ScanResult {
  const result: ScanResult = {
    readings: [],
    skippedForBudget: 0,
    discoveryTruncated: false,
    unreadable: [],
    unreadableRoots: [],
    dedupedAgainstWrapper: 0,
  };
  const budget = options.maxLogs ?? MAX_LOGS;

  const found = discoverLogs(options);
  result.discoveryTruncated = found.truncated;
  result.unreadable.push(...found.unreadable);
  result.unreadableRoots.push(...found.unreadableRoots);

  const candidates = found.candidates;
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
      {
        cwd: candidate.cwd,
        nowMs: options.nowMs,
        scriptBodies: options.scriptBodiesFor(candidate.cwd),
        sessionLive: options.isSessionLive?.(candidate.path),
      },
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
 *
 * Bounded, and it reports both a truncation and a listing failure rather than
 * returning a short list either way — "there are no worktrees" and "we could not
 * see the worktrees" are different facts, and only one of them is fine.
 */
export const MAX_ROOTS = 100;

export function checkoutRoots(primary: string): { roots: string[]; truncated: boolean; why: string | null } {
  const roots = [primary];
  const worktrees = join(primary, ".claude", "worktrees");
  let handle: Dir;
  try {
    handle = opendirSync(worktrees);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    /* No worktrees directory is a checkout nobody has branched from — normal,
       and not a fault. Anything else IS a fault, and this used to swallow both
       identically, so a permissions problem read as "no worktrees" and the scan
       quietly covered a fraction of the box. */
    if (code === "ENOENT") return { roots, truncated: false, why: null };
    return { roots, truncated: false, why: (err as Error).message };
  }

  /* **`opendirSync`, for the same reason `discoverLogs` uses it.** This was
     `readdirSync` with the cap applied afterwards — which materialises every
     entry before returning, so the cap bounded the loop and not the listing:
     exactly the bug that had just been fixed one function down, left in place
     here. GPT Sol, round 3. */
  /* **The cap counts entries INSPECTED, not roots accepted.** Counting the
     accepted ones meant a directory of 150 non-directory entries was walked in
     full while `truncated` stayed false — the bound measuring the wrong thing,
     which is the same mistake as putting it after `readdirSync`, one level in.
     GPT Sol, round 4. */
  let truncated = false;
  let inspected = 0;
  try {
    for (;;) {
      if (inspected >= MAX_ROOTS) {
        truncated = true;
        break;
      }
      const entry: Dirent | null = handle.readSync();
      if (entry === null) break;
      inspected += 1;
      if (entry.isDirectory()) roots.push(join(worktrees, entry.name));
    }
  } finally {
    try {
      handle.closeSync();
    } catch {
      /* Already closed, or the directory went away under us. */
    }
  }
  return { roots, truncated, why: null };
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
