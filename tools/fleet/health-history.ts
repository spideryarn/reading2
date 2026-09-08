/**
 * Twenty-four hours of box health, kept on disk, so the page can answer a
 * question the live reading cannot.
 *
 * > Box Health: graphs of recentish history (last 24h) so he can see whether
 * > there were problems/disruptions, plus amount/proportion of swap used
 * >
 * > — Greg, 2026-09-08
 *
 * `health.ts` answers *how is the box now*. Nothing answered *was there a
 * problem while I was not looking*, because nothing was written down: `health`
 * is a module-level variable in server.ts, overwritten once per loop turn, and
 * a restart lost every reading that had ever been taken. This file is the
 * writing down. The plan is
 * docs/plans/260908f-box-health-history-24h-graphs-and-swap-retention.md.
 *
 * ## THE FOUR STATES, WHICH ARE THE WHOLE DESIGN
 *
 * Everything here follows from refusing to merge these. Three of them can be
 * written down and the fourth cannot, and that asymmetry is the reason this
 * file exists rather than a `number[]`.
 *
 *  1. **A number.** A reading whose arm is `value`.
 *  2. **A command failed.** That reading's `unknown` arm, carrying `health.ts`'s
 *     own `why`. NOT a null, and never a zero — the whole of `health.ts`'s
 *     header is about that collapse, and a store that flattened it would undo
 *     the module it stores.
 *  3. **The collector threw.** Its own sample arm, `collector-failed`.
 *  4. **Nothing was written.** *No sample at all* — and it cannot be written
 *     down, because whatever would have written it is the thing that was not
 *     there to write. It is recoverable only by inference, from the spacing of
 *     the samples on either side, which is why `nextDueMs` exists.
 *
 * **(4) IS NOT "NOTHING WAS RUNNING", AND NOTHING HERE MAY SAY IT IS.** This
 * header said exactly that until GPT Sol pointed out it claims more than the
 * evidence supports. A break is the box down, the dashboard down, a collection
 * that hung (the fault `attemptedAt` in state.ts exists to catch), a drain that
 * blocked the loop, an append that failed, or somebody restarting the server —
 * which happens several times an hour on this box. The record is silent; **why**
 * it is silent is not in it.
 *
 * (3) and (4) are the pair most easily merged and the pair that matters most:
 * *the box was up and health collection has been broken for six hours* and *no
 * sample was written for six hours* are different claims, and only one of them
 * is something the record can make.
 *
 * There is a fifth, and it is the one cause the record CAN speak to: **the
 * writer could not write.** See `RetentionStatus` — a monitor that has silently
 * stopped manufactures an outage indistinguishable from the thing it exists to
 * detect.
 *
 * ## `nextDueMs`: TOLD, NOT INFERRED
 *
 * A reader deciding "is this spacing a gap" needs to know what spacing was
 * intended, and it is not one number. The dashboard's loop waits `refreshMs`
 * after a good collection and **five times that** (capped at 300s) after a
 * failed one, so a perfectly healthy backed-off loop and a dead server produce
 * similar-looking spacing. Guessing there would draw a legitimate backoff as an
 * outage — an alarm that is usually wrong, which is the same picture as a quiet
 * page over a dead box. So each sample records what the writer expected next,
 * and the reader compares against that. Same habit as `answeringEnabled` and
 * `attemptedAt` in state.ts: told beats inferred.
 *
 * ## What is NOT here
 *
 * **No collection.** Not one command is run in this file. The samples are
 * exactly what `refreshHealth()` already produced — this box hit load average
 * 391 with the OOM killer firing on 2026-09-08, and a second survey of it would
 * be a real cost rather than untidiness. If something here starts to look like a
 * parser, it is wrong: `health.ts` owns every parser.
 *
 * **No projection.** The `HealthReport` is stored verbatim. A narrow per-metric
 * sample would save about half a megabyte a day on a disk with 145 GB free, and
 * would buy that with a mapping function at the write boundary — the one place
 * where a lossy join is unrecoverable, because what it drops is dropped for
 * ever. Measured: one report is 869 bytes of JSON, so a day is ~1 MB.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { truncateToLastLine, writeAll, type JsonlRepair } from "../overseer/jsonl.js";
import { describeLockRefusal, releaseLock, stillOurs, takeLock, type HeldLock } from "../overseer/lock.js";
import type { HealthReport } from "./health.js";

/* ------------------------------------------------------------------ *
 * Where it lives.
 * ------------------------------------------------------------------ */

/**
 * The default root, and `FLEET_HEALTH_DIR` overrides it — **absolutely, or not
 * at all.**
 *
 * The same argument `tools/overseer/store.ts` makes, for the same reason: every
 * agent on this box works in its own worktree and removes it when the job is
 * done, and a *relative* override resolves to a different directory depending
 * on who started the process. A systemd unit starting from the primary checkout
 * and a person starting from a worktree would then write two separate, entirely
 * plausible histories, and nothing would ever say so.
 *
 * Separate from `~/.overseer/` deliberately: two writers on one file is not a
 * problem worth having, and the Overseer explicitly does not keep health
 * history (`tools/overseer/daemon.ts`, *"there is one collector on this box and
 * it is the dashboard's"*).
 */
export const DEFAULT_HISTORY_DIR = join(process.env["HOME"] ?? "/home/greg", ".fleet-health");

export const LIVE_FILE = "health.jsonl";
export const PREV_FILE = "health.prev.jsonl";

/**
 * When the live file rotates, and the invariant that fixes the number.
 *
 * **The cap must comfortably exceed a window's worth of samples.** The instant
 * after a rotation the live file holds one line, and the previous file is the
 * only thing covering the window — so a cap that held less than 24h would blank
 * the chart at a moment when nothing was wrong, and a blank chart reads as *the
 * box was down*, which is the one thing this feature must never say by accident.
 *
 * 8 MiB against a measured ~1 MB/day is about eight days of margin on a window
 * of one, and about five days at the pessimistic ~1.4 KB/sample rate a
 * permanently critical box would produce. The store's ceiling is two of these.
 *
 * The pathological case is a dashboard in a crash loop appending a
 * `collector-failed` line every second: ~150 bytes × 86,400 = 13 MB/day, which
 * rotates in about fifteen hours and would leave the window short. That is a
 * real hole and it is accepted knowingly — a box in that state has a much louder
 * problem than a truncated chart, and the chart would be a wall of violet either
 * way. It is written down here so that the day it happens, it is recognised
 * rather than diagnosed.
 */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

/* ------------------------------------------------------------------ *
 * The record.
 * ------------------------------------------------------------------ */

/** What one turn of the loop learned about the box. Built by the caller, not here. */
export type HealthTurn =
  | { kind: "reading"; report: HealthReport }
  /**
   * `collectHealth` itself threw.
   *
   * **NOT synthesised as an all-`unknown` report**, however tempting one arm
   * instead of two looks. "The collector threw" and "the collector ran and every
   * command failed" are different facts, and only the second has six `why`
   * strings somebody actually produced. Manufacturing those would be inventing
   * readings nobody took — the exact move `fleetState` refuses when it declines
   * to substitute `new Date()` for a `collectedAt` nobody recorded.
   */
  | { kind: "collector-failed"; why: string };

/**
 * A stored report is `Record<string, unknown>`, **not `HealthReport`**.
 *
 * The writer takes a real `HealthReport`; the reader gets back whatever was on
 * disk. Those bytes crossed a persistence AND A VERSION boundary — a build from
 * last week wrote some of them, and `health.ts` may have renamed a field since —
 * so typing the read result as the current interface would be a cast asserting
 * something nobody checked, and every consumer downstream would believe it.
 * GPT Sol's finding 8, 2026-09-08.
 *
 * Validating the whole report here instead was the other option, and it is
 * worse: it would be a second copy of `health.ts`'s shape, kept in step by
 * nothing, in a file that is not allowed to have opinions about readings. The
 * consumers already read by name and turn anything they do not recognise into a
 * stated unknown, which is the same discipline `health-view.ts` uses on the
 * live payload.
 */
export type StoredReport = Record<string, unknown>;

/** One line of the file. */
export type HealthSample =
  | {
      schema: 1;
      /** ISO 8601, by the writer's clock. The same format `collectedAt` uses. */
      at: string;
      /** How long after `at` the writer intended to produce the next sample. See the header. */
      nextDueMs: number;
      kind: "reading";
      report: StoredReport;
    }
  | { schema: 1; at: string; nextDueMs: number; kind: "collector-failed"; why: string }
  /**
   * **A reading was taken and could not be kept.** Written in place of a sample
   * whose serialised form exceeded `MAX_LINE_BYTES`.
   *
   * Its own arm rather than an error code, because it is a real record of a real
   * event, and because the alternative — an in-memory flag the next success
   * clears — let a critical turn be erased with nothing anywhere to say a sample
   * had been dropped. It breaks the line where the reading would have been.
   */
  | { schema: 1; at: string; nextDueMs: number; kind: "sample-omitted"; why: string };

/**
 * The longest `why` that goes on disk.
 *
 * An unbounded string in a record makes the file's growth rate unbounded too,
 * which is the assumption GPT Sol's finding 7 breaks: the rotation cap can only
 * promise to cover a window if a record has a size. A `why` is a tool's error
 * message and 2 KB of one is already more than anybody reads; the truncation
 * says so in the text rather than trimming silently.
 */
export const MAX_WHY_CHARS = 2000;

function boundWhy(why: string): string {
  return why.length <= MAX_WHY_CHARS ? why : `${why.slice(0, MAX_WHY_CHARS)}… (truncated for the history)`;
}

/**
 * The largest a single line may be, in BYTES.
 *
 * **Bounding one `why` was not bounding the record**, and GPT Sol produced the
 * proof: a type-valid `HealthReport` whose *readings'* own `why` strings were
 * long — `parseAttribution` and friends each carry one, and `verdict.reasons` is
 * an array of them — wrote a **40,000,420-byte** live file against a claimed
 * 8,388,608-byte cap. The rotation invariant depends on a record having a size,
 * so the bound has to be on the record, not on one field of it.
 *
 * 64 KiB is about seventy-five times the measured 869-byte sample, so nothing a
 * healthy collector produces comes close; what it catches is the pathological
 * case, and it catches it as a **reported retention failure rather than
 * silently**, because a sample quietly dropped is a hole with no explanation.
 */
export const MAX_LINE_BYTES = 64 * 1024;

/** The clock and the expectation, which the store does not invent for itself. */
export type SampleStamp = { at: string; nextDueMs: number };

/** One sample as it is written: compact JSON, one line, newline-terminated. */
export function sampleLine(sample: HealthSample): string {
  return `${JSON.stringify(sample)}\n`;
}

/* ------------------------------------------------------------------ *
 * Reading a line back.
 * ------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * One line to a sample, or null when it is not one.
 *
 * **Validated per arm rather than cast.** These bytes crossed a persistence and
 * a version boundary — we wrote them, but a build from last week wrote some of
 * them — so a `JSON.parse` result is a `unknown` until something has looked at
 * it. What is checked is only what this file promises: the envelope, and that
 * the arm's own required field is there. The `report` inside a `reading` is NOT
 * re-validated field by field, because `health.ts` owns that shape and a second
 * opinion about it here would be a second copy to keep in step; a consumer that
 * cannot read a reading draws it as unreadable, which is a state it already has.
 */
export function parseSampleLine(line: string): HealthSample | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed["schema"] !== 1) return null;
  const at = parsed["at"];
  if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) return null;
  const nextDueMs = parsed["nextDueMs"];
  if (typeof nextDueMs !== "number" || !Number.isFinite(nextDueMs)) return null;

  if (parsed["kind"] === "reading") {
    const report = parsed["report"];
    if (!isRecord(report)) return null;
    /* No cast to `HealthReport`. See `StoredReport`: this is the version
       boundary, and the honest type for what came off it is the loose one. */
    return { schema: 1, at, nextDueMs, kind: "reading", report };
  }
  if (parsed["kind"] === "collector-failed" || parsed["kind"] === "sample-omitted") {
    const why = parsed["why"];
    if (typeof why !== "string") return null;
    return { schema: 1, at, nextDueMs, kind: parsed["kind"], why };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * The store.
 * ------------------------------------------------------------------ */

/**
 * What a read found.
 *
 * `unreadable` is a separate arm rather than an empty `samples`, because **an
 * empty history and a history that could not be read are opposite claims** and
 * the second one drawn as the first is a 24h chart confidently reporting a day
 * of nothing. Same rule state.ts states for `collectedAt: null`.
 */
export type HistoryRead =
  | {
      kind: "read";
      /** Oldest first, so a renderer can walk it left to right. */
      samples: HealthSample[];
      /**
       * The last sample BEFORE the window, when there is one.
       *
       * **Without it the left edge cannot be classified.** A window that opens
       * in the middle of a four-hour outage has no sample near its start, and
       * nothing in `samples` can say whether that emptiness is a gap already in
       * progress or simply where the record begins. The predecessor answers it:
       * a sample three hours before `sinceMs` with a `nextDueMs` of 73 seconds
       * says the outage was already running. GPT Sol's finding 1.
       */
      predecessor: HealthSample | null;
      /**
       * **Where** the lines that would not parse were, not merely how many.
       *
       * A count alone lets a renderer join a line straight across a hole, which
       * is the same reconnection a gap must never get — GPT Sol's finding 6, and
       * the good half of the objection the Overseer's store raised. A hole is
       * positional: it is bracketed by the timestamps of the good samples on
       * either side of it (null at the ends of the file), and a renderer breaks
       * its segment there.
       */
      holes: { afterAtMs: number | null; beforeAtMs: number | null }[];
      /**
       * The oldest sample the store holds AT ALL, window or no window — which is
       * what lets a page tell *nothing was recorded before this* apart from *the
       * record has a hole in it*. Null when the store is empty.
       */
      earliestAt: string | null;
      /**
       * True when a rotation has happened, so `earliestAt` is **the oldest
       * RETAINED sample, not the first ever taken.**
       *
       * The distinction is a sentence on the page: "collecting since 09:14" is a
       * claim about when we started looking, and after a rotation it would be
       * false. GPT Sol's finding 7.
       */
      rotated: boolean;
      /** Lines that would not parse. Counted as well as placed. */
      unreadableLines: number;
      /** How many of the two files existed. Diagnostic; a fresh store has 1 or 0. */
      files: number;
    }
  | { kind: "unreadable"; why: string };

export type ReadOptions = {
  /** Samples at or after this instant, in epoch ms. `0` for everything held. */
  sinceMs: number;
  /** Injected only by tests, to reach the arm a healthy filesystem will not produce. */
  readFile?: (path: string) => string;
};

/**
 * **How the WRITER is doing**, which is a different question from what it wrote.
 *
 * If appends start failing — a full disk, a directory that became unwritable —
 * the live page carries on, the old file stays perfectly readable, and the chart
 * grows a fresh hole at its right-hand edge that looks exactly like the box
 * having gone down. That is a fabricated outage, produced by the monitoring
 * rather than observed by it, and it is the worst thing in this feature's blast
 * radius. GPT Sol's finding 3.
 *
 * So the writer reports on itself, the route carries it, and the page draws
 * "nothing is being recorded" as its own state rather than as silence.
 */
export type RetentionStatus = {
  /** When an append was last tried, and when one last worked. Apart, they are the diagnosis. */
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  /** The most recent append failure, or null. */
  failure: string | null;
  /**
   * Set after an append that may have written PART of a record.
   *
   * `writeAll` loops over a `writeSync` that can throw partway, and the repair
   * that would fix a torn line only runs at process start — so the next append
   * would weld a valid record onto corrupt bytes, and one append after that the
   * damage is no longer the last line and is no longer repairable at all.
   * Refusing further appends until a restart is the containment. **A later
   * successful write must never quietly imply recovery.** GPT Sol's finding 4.
   */
  poisoned: boolean;
  /** Null when this process holds the writer lock; otherwise why it does not. */
  lockedOutBy: string | null;
};

export type HealthHistory = {
  /**
   * Append one sample.
   *
   * Synchronous and sub-millisecond (measured: 0.017 ms median, 0.5 ms worst, at
   * load 17.5). It may throw, and the caller guards it — but it also records the
   * failure on itself, because a caught-and-logged exception is invisible to the
   * page that is drawing the consequences.
   */
  append(turn: HealthTurn, stamp: SampleStamp): void;
  read(options: ReadOptions): HistoryRead;
  /** How the writer itself is doing. See `RetentionStatus`. */
  status(): RetentionStatus;
  /** Release the writer lock. The dashboard never needs this; a test that reopens does. */
  close(): void;
  /** Where it is writing, for the log line at startup. */
  dir: string;
};

export type OpenedHistory =
  | { kind: "open"; store: HealthHistory; repaired: JsonlRepair; dir: string }
  | { kind: "refused"; why: string };

/**
 * Open the store, repairing a torn tail before anything appends to it.
 *
 * **THE REPAIR HAPPENS ONCE, AT OPEN, NOT ON EVERY READ**, and that ordering is
 * `tools/overseer/jsonl.ts`'s rule rather than a preference: a process killed
 * mid-write leaves a line with no newline, the next append lands immediately
 * after those bytes, and one append later the malformed record is no longer the
 * last line — so nothing a reader does can recover it. Cutting the file back
 * before the first append can.
 *
 * **A LOCK, AND THE ARGUMENT FOR NOT HAVING ONE WAS WRONG.** This used to say
 * that two dashboards cannot coexist because `server.ts` treats a failed bind
 * as fatal and port 8787 is taken. That does not hold: a second dashboard can
 * run on a different `FLEET_PORT` while sharing `FLEET_HEALTH_DIR`, and two
 * starts can race before either observes an asynchronous bind failure. GPT
 * Sol's finding 9.
 *
 * Being locked out is **not** a refusal to open. The store still reads, so the
 * page still draws the day; it simply stops writing and says so through
 * `status().lockedOutBy`. A dashboard that would not start because another one
 * held a lock file would be the tool being unavailable exactly when somebody is
 * trying to find out what went wrong.
 *
 * The lock here is a deliberately smaller thing than `tools/overseer/store.ts`'s:
 * `O_CREAT|O_EXCL`, a pid inside, stolen only from a pid the kernel says is
 * gone, and no per-write re-check. The Overseer's is the careful one and the
 * right one to share; `orchestrator-setup` has been asked to export it, and
 * when it does this should be deleted rather than kept beside it. The residual
 * race — two starts both proving the same corpse dead — is bounded here in a way
 * it is not there: two writers interleave individually valid `O_APPEND` lines,
 * so the chart shows double density rather than a corrupt fold. The sharp edge
 * is rotation, where two concurrent renames can drop a file.
 */
export type OpenOptions = {
  /**
   * How a line reaches the fd. Injected ONLY by tests, to reach the arm a
   * healthy filesystem will not produce: a failure PART WAY THROUGH a write,
   * which is the one that poisons the writer. Every other failure mode can be
   * produced with a permission bit; this one cannot, and it is the one whose
   * consequence is unrepairable.
   */
  writeLine?: ((fd: number, line: string) => void) | undefined;
};

export function openHealthHistory(dir: string = DEFAULT_HISTORY_DIR, options: OpenOptions = {}): OpenedHistory {
  if (!isAbsolute(dir)) {
    return {
      kind: "refused",
      why:
        `the health history directory must be an absolute path, and this is ${JSON.stringify(dir)} — ` +
        "a relative one resolves differently for a systemd unit and for a person in a worktree, " +
        "which is two plausible histories and no way to tell",
    };
  }
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch (err) {
    return { kind: "refused", why: `could not create ${dir}: ${err instanceof Error ? err.message : String(err)}` };
  }

  /**
   * **THE LOCK COMES FIRST, AND THIS ORDER USED TO BE THE OTHER WAY ROUND.**
   *
   * `truncateToLastLine` is a WRITE: it cuts the file back on disk. Running it
   * before the lock meant a second process — one that would go on to be
   * correctly refused, and correctly report itself read-only — had already
   * truncated the live file belonging to the writer that owned it. GPT Sol
   * measured it: opening a second store took the first writer's file from 105
   * bytes to 100. If the owner happened to be mid-write, that is damage to an
   * active record, done by a process that never believed it was writing at all.
   *
   * So: claim the right to write, and only then exercise it. **A reader repairs
   * nothing.** A torn tail left by a dead process is the live writer's to fix at
   * its own next start, and until then a reader simply sees one line it cannot
   * parse — which this store already reports as a positional hole.
   */
  const live = join(dir, LIVE_FILE);
  const { lock, lockedOutBy } = lockRefusalFor(dir);

  const lockPath = join(dir, LOCK_FILE);
  let repaired: JsonlRepair = { torn: false };
  if (lock !== null) {
    /**
     * **`stillOurs` AROUND THE REPAIR, AND THE LOCK GIVEN BACK IF IT FAILS.**
     *
     * Two separate faults, both GPT Sol's second round. The repair is a write,
     * so it needs the same ownership check every append got — the stale-lock
     * race can leave two claimants, and the loser must not cut the winner's
     * file back. And if the repair throws, returning `refused` while still
     * holding the lock **leaves a lock file naming a process that then does
     * nothing**, so the next opener is locked out by a writer that does not
     * exist. Reproduced with `health.jsonl` as a directory.
     *
     * `openStore` in tools/overseer/store.ts has the same shape for the same
     * reason: release on every post-claim failure.
     */
    const giveUp = (why: string): OpenedHistory => {
      releaseLock(lock, lockPath);
      return { kind: "refused", why };
    };
    if (!stillOurs(lock, lockPath)) {
      return giveUp(`another writer took ${lockPath} between claiming it and repairing ${live}`);
    }
    try {
      repaired = truncateToLastLine(live);
    } catch (err) {
      return giveUp(`could not repair ${live}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!stillOurs(lock, lockPath)) {
      return giveUp(`another writer took ${lockPath} while ${live} was being repaired`);
    }
  }

  return { kind: "open", dir, repaired, store: makeStore(dir, lock, lockedOutBy, options.writeLine ?? writeAll) };
}

/* ------------------------------------------------------------------ *
 * One writer.
 * ------------------------------------------------------------------ */

export const LOCK_FILE = "writer.lock";

/**
 * **The lock is `tools/overseer/lock.ts`'s, imported, not a copy.**
 *
 * A hand-written second version was in this file for about an hour, and the
 * `orchestrator-setup` session's extraction pass is why it is not any more —
 * along with the reason it would have been a bad idea. Proving that extraction
 * behaviour-preserving by MUTATION rather than by reading found that
 * `isProcessAlive`'s `EPERM` branch — *a live process belonging to somebody
 * else reads as running* — survived all 102 tests when flattened to `return
 * false`. That is the single branch that decides whether a second writer can
 * steal a LIVE lock, and it is the exact line I had copied by hand. Nothing in
 * this repo would have told me if I had mistyped it.
 *
 * **What the lock is really buying, which is narrower than it looks.** Two
 * writers on this file interleave individually valid `O_APPEND` lines: the
 * chart would show double sample density, which is visible and recoverable.
 * The failure that is neither is **rotation** — two concurrent renames can drop
 * a whole file, silently, and what is left looks like an ordinary shorter
 * history. That is the same family as everything else here: the failure that
 * looks like data.
 */
function lockRefusalFor(dir: string): { lock: HeldLock | null; lockedOutBy: string | null } {
  const path = join(dir, LOCK_FILE);
  const taken = takeLock(path, () => new Date());
  if (taken.ok) return { lock: taken.lock, lockedOutBy: null };
  return {
    lock: null,
    /* **Degrade, do not refuse.** A dashboard that would not start because
       another process held a lock file would be unavailable exactly when
       somebody is trying to find out what went wrong. So the store still reads
       — the page still draws the day — and it stops writing and says so. */
    lockedOutBy: `${describeLockRefusal(taken.refusal, path)} This dashboard is reading the history but not adding to it.`,
  };
}

function makeStore(
  dir: string,
  lock: HeldLock | null,
  refusal: string | null,
  write: (fd: number, line: string) => void,
): HealthHistory {
  let held: HeldLock | null = lock;
  let lockedOutBy: string | null = refusal;
  const live = join(dir, LIVE_FILE);
  const prev = join(dir, PREV_FILE);
  let lastAttemptAt: string | null = null;
  let lastSuccessAt: string | null = null;
  let failure: string | null = null;
  let poisoned = false;

  /**
   * One line onto the end of the live file. The only place bytes are written.
   *
   * Extracted so the oversized-sample path can put its own small
   * `sample-omitted` record down through exactly the same discipline — the
   * `O_APPEND` fd, `writeAll`'s short-write loop, and the poison-on-partial
   * rule. A second inline copy of those three would be a second place to get
   * them wrong, and the whole reason they exist is that they were got wrong
   * elsewhere first.
   */
  const writeLine = (line: string): void => {
    const fd = openSync(live, "a", 0o600);
    try {
      write(fd, line);
    } catch (err) {
      poisoned = true;
      throw err;
    } finally {
      closeSync(fd);
    }
  };

  /**
   * **THE REASONS THIS WRITER MAY NOT WRITE**, in one place and ahead of the
   * writing, so `append` is about appending.
   *
   * None of them is silent: every one is visible through `status()` and reaches
   * the page, because a writer that has quietly stopped grows a hole in the
   * chart that reads as the box having gone down — an outage manufactured by the
   * monitoring rather than observed by it.
   */
  const mayNotWrite = (): boolean => {
    /* **DO NOT OVERWRITE `failure` HERE.** It holds the ORIGINAL cause — the
       `EACCES`, the `ENOSPC` — and replacing it with this refusal's own
       boilerplate would leave the page saying "an earlier write may have been
       partial" over a problem that was really a permission bit. The refusal is
       carried by `poisoned`; the reason is carried by `failure`, and they are
       two different facts. Found by making the file read-only on a running
       server and reading the payload. */
    if (poisoned) return true;

    /**
     * **STILL OURS?** — asked of the filesystem, before every write.
     *
     * `takeLock` at startup is not a claim that survives the process. The
     * stale-lock race `lock.ts` names — two starts that both prove the same
     * corpse dead, both unlink, both create — leaves one of them holding a file
     * that is no longer at the path, and without this check that loser appends
     * beside the winner for ever, silently, producing a history with two sample
     * densities and no way to tell. `stillOurs` compares dev+ino AND the record
     * inside, so it catches both a competitor that replaced the file and one
     * that overwrote it in place. One `stat` per ~73 seconds.
     */
    if (held !== null && !stillOurs(held, join(dir, LOCK_FILE))) {
      held = null;
      lockedOutBy =
        `the writer lock at ${join(dir, LOCK_FILE)} is no longer this process's — another writer took it. ` +
        "This dashboard is reading the history but has stopped adding to it.";
    }
    if (lockedOutBy !== null) {
      failure = lockedOutBy;
      return true;
    }
    return false;
  };

  return {
    dir,

    status: () => ({ lastAttemptAt, lastSuccessAt, failure, poisoned, lockedOutBy }),

    /**
     * Hand the lock back.
     *
     * The dashboard never calls this — it holds the lock for its whole life and
     * a dead process's lock is stolen by the pid check at the next start. It
     * exists because **a test that opens the same directory twice in one
     * process would otherwise lock itself out**, which is not a hypothetical:
     * it is what happened the first time the lock landed, and the symptom was
     * a torn-line test whose second append silently did nothing. `releaseLock`
     * does the `stillOurs` check itself, so releasing a lock somebody else has
     * since taken does not hand the file to a third writer.
     */
    close(): void {
      /* IDEMPOTENT. `releaseLock` closes the fd, and closing it twice is
         `EBADF` — a throw, from a cleanup path, which is the worst place for
         one. Found by a test that closed a store and then let its own teardown
         close it again, which is exactly what a shutdown handler beside a
         signal handler would do. */
      if (held === null) return;
      const lock = held;
      held = null;
      releaseLock(lock, join(dir, LOCK_FILE));
      lockedOutBy = "this store has been closed and has given up the writer lock";
    },

    append(turn, stamp): void {
      lastAttemptAt = stamp.at;
      if (mayNotWrite()) return;

      const sample: HealthSample =
        turn.kind === "reading"
          ? { schema: 1, at: stamp.at, nextDueMs: stamp.nextDueMs, kind: "reading", report: turn.report }
          : { schema: 1, at: stamp.at, nextDueMs: stamp.nextDueMs, kind: "collector-failed", why: boundWhy(turn.why) };
      const line = sampleLine(sample);
      /* **BYTES, NOT CHARACTERS.** `statSync().size` is bytes and `String.length`
         is UTF-16 code units, so comparing them was a unit mismatch of exactly
         the kind health.ts's `totalBytes` rename exists to stop — and here it
         made the rotation cap advisory rather than real. GPT Sol's finding 7. */
      const lineBytes = Buffer.byteLength(line, "utf8");

      if (lineBytes > MAX_LINE_BYTES) {
        /**
         * **AN OMISSION HAS TO GO ON DISK, or it is not an omission — it is a
         * gap that closes behind itself.**
         *
         * The first version set an in-memory `failure` and returned. GPT Sol
         * reproduced what that costs: healthy sample, oversized CRITICAL sample,
         * healthy sample. The next success clears `failure`, the two healthy
         * lines are 146 seconds apart — inside the coverage allowance — and the
         * chart joins them. **The one turn the box was in trouble is erased, and
         * nothing anywhere says a sample was dropped.**
         *
         * So a `sample-omitted` line is written in its place: small, bounded,
         * and carrying the size it refused. It is a real record of a real event
         * (we looked, and could not keep what we saw), which makes it the fourth
         * arm rather than an error code — and it breaks the line where the
         * reading would have been.
         */
        const why =
          `a sample serialised to ${lineBytes} bytes, over the ${MAX_LINE_BYTES}-byte per-record limit, ` +
          "so the reading was taken but not kept";
        failure = why;
        try {
          writeLine(
            sampleLine({ schema: 1, at: stamp.at, nextDueMs: stamp.nextDueMs, kind: "sample-omitted", why }),
          );
        } catch (err) {
          /* If even the small line will not go down, the ordinary failure path
             owns it — and `poisoned` is not set, because nothing partial can
             have been written by a failure to open. */
          failure = err instanceof Error ? err.message : String(err);
        }
        return;
      }

      try {
        /* Rotate BEFORE the write that would overflow, so the cap is a ceiling
           on the file rather than a line it crosses once per rotation.
           `statSync` each time rather than a counter in memory, because a
           counter is wrong the moment anything else touches the file, and a
           stat costs ~10µs. */
        const size = existsSync(live) ? statSync(live).size : 0;
        if (size > 0 && size + lineBytes > MAX_FILE_BYTES) renameSync(live, prev);

        /* `openSync(…, "a")` per append rather than one long-lived fd: at one
           write per ~73 seconds the open costs nothing, and it means a file that
           somebody deletes or rotates underneath us is recreated on the next
           turn instead of being appended to a ghost inode for ever.

           `writeAll` rather than `writeSync` because `writeSync` returns a COUNT
           and does not promise to have written everything — the short write is
           rare rather than impossible, and trusting the count produces exactly
           the torn line the repair at open exists to fix, with nothing having
           gone wrong at the time. jsonl.ts § rule 3.

           NO `fsync`. Measured on this box at load 17.5: 0.017 ms median
           without, 0.98 ms with. The cost is not the reason — the reason is that
           what `fsync` would protect is the last few samples in the page cache,
           and losing those renders as a break in the record, which is a truthful
           drawing of a machine that stopped. */
        /**
         * **`opened` IS WHAT DECIDES WHETHER TO POISON**, and the distinction is
         * worth the extra variable.
         *
         * A throw from `openSync` — `EACCES`, `ENOENT`, a directory where the
         * file should be — happened BEFORE any byte could be written, so the
         * file is intact and a later attempt is free to succeed. A throw from
         * `writeAll` may have written part of a record, and the repair that
         * would cut a torn line back only runs at process start: appending again
         * would weld a valid record onto corrupt bytes, and one append after
         * that the damage is no longer the last line and is no longer repairable
         * at all. GPT Sol's finding 4, narrowed by a browser pass — the first
         * version poisoned on a read-only file and then refused to resume when
         * the permission bit was put back, which is a self-inflicted outage in
         * the record.
         */
        writeLine(line);
        failure = null;
        lastSuccessAt = stamp.at;
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err);
        throw err;
      }
    },

    read(options): HistoryRead {
      /**
       * **A ROTATION UNDER A READER'S FEET LOSES A WHOLE FILE, ONCE.**
       *
       * The two files are read by pathname, so a read-only dashboard can take
       * the old `prev`, the owner can then rename `live → prev` and start a new
       * `live`, and the reader ends up with the old `prev` and the new, nearly
       * empty `live` — the entire just-rotated file missing, drawn as a large
       * false break for one poll. Rare (a rotation is roughly weekly) and
       * self-healing on the next poll, but "a large false break" is the one
       * thing this panel must not produce, so it is worth ten lines. GPT Sol's
       * second round.
       *
       * Detect rather than lock: if `prev`'s identity changed while we were
       * reading, the snapshot was torn, so take it again. Once — a second
       * rotation inside two consecutive reads is not a thing that happens, and
       * an unbounded retry on a filesystem that keeps changing is worse than a
       * stale answer.
       */
      const identity = (path: string): string => {
        try {
          const stat = statSync(path);
          return `${stat.dev}:${stat.ino}:${stat.size}`;
        } catch {
          return "absent";
        }
      };
      const before = identity(prev);
      const first = readOnce(options);
      if (identity(prev) === before) return first;
      return readOnce(options);
    },
  };

  function readOnce(options: ReadOptions): HistoryRead {
      const readFile = options.readFile ?? ((path: string) => readFileSync(path, "utf8"));
      /* Previous file first: it holds the older half, and `samples` must come
         out oldest first. */
      const scan = newScan(options.sinceMs);
      let files = 0;
      for (const path of [prev, live]) {
        if (!existsSync(path)) continue;
        files += 1;
        let text: string;
        try {
          text = readFile(path);
        } catch (err) {
          return {
            kind: "unreadable",
            why: `could not read ${path}: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
        scanLines(scan, text);
      }
      return finishScan(scan, existsSync(prev), files);
  }
}

/* ------------------------------------------------------------------ *
 * Walking the lines.
 * ------------------------------------------------------------------ */

/**
 * The accumulator a scan builds up, extracted from `read` because that function
 * measured 43 cognitive complexity in one body — and because **the interesting
 * decisions are all in here**: which sample is the predecessor, where a hole
 * goes, and what counts as one hole rather than three.
 */
type Scan = {
  sinceMs: number;
  samples: HealthSample[];
  holes: { afterAtMs: number | null; beforeAtMs: number | null }[];
  unreadableLines: number;
  earliestAt: string | null;
  predecessor: HealthSample | null;
  /** The most recent good sample seen, so a bad line can be PLACED between its neighbours. */
  lastGoodAtMs: number | null;
  /** The hole currently being opened by a run of bad lines, if any. */
  openHole: { afterAtMs: number | null; beforeAtMs: number | null } | null;
};

function newScan(sinceMs: number): Scan {
  return {
    sinceMs,
    samples: [],
    holes: [],
    unreadableLines: 0,
    earliestAt: null,
    predecessor: null,
    lastGoodAtMs: null,
    openHole: null,
  };
}

function scanLines(scan: Scan, text: string): void {
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const sample = parseSampleLine(line);
    if (sample === null) {
      scan.unreadableLines += 1;
      /* ONE HOLE PER RUN of bad lines: two adjacent corrupt records are one
         place the record is broken, not two. */
      if (scan.openHole === null) {
        scan.openHole = { afterAtMs: scan.lastGoodAtMs, beforeAtMs: null };
        scan.holes.push(scan.openHole);
      }
      continue;
    }
    const atMs = Date.parse(sample.at);
    if (scan.openHole !== null) {
      scan.openHole.beforeAtMs = atMs;
      scan.openHole = null;
    }
    scan.lastGoodAtMs = atMs;
    if (scan.earliestAt === null || sample.at < scan.earliestAt) scan.earliestAt = sample.at;
    if (atMs >= scan.sinceMs) scan.samples.push(sample);
    /* KEEP THE LAST ONE BEFORE THE WINDOW. It is what tells the left edge "a
       break was already running" from "this is where the record starts" — see
       `predecessor`. */
    else scan.predecessor = sample;
  }
}

function finishScan(scan: Scan, rotated: boolean, files: number): HistoryRead {
  return {
    kind: "read",
    samples: scan.samples,
    predecessor: scan.predecessor,
    /* Holes entirely before the window are somebody else's problem; a hole
       bracketing the window's start still matters, because it is what the left
       edge is made of. */
    holes: scan.holes.filter((hole) => (hole.beforeAtMs ?? Number.POSITIVE_INFINITY) >= scan.sinceMs),
    earliestAt: scan.earliestAt,
    rotated,
    unreadableLines: scan.unreadableLines,
    files,
  };
}

/**
 * Why an unparseable line is COUNTED here and REFUSED in `tools/overseer/store.ts`.
 *
 * Kept as prose rather than a comment on the loop because it is the one place
 * this file knowingly departs from a rule a peer session asked for, and the next
 * reader deserves the argument rather than the outcome.
 *
 * The Overseer stops at the first hole and cold-starts, and it is right to: its
 * log FOLDS. A log holding `session-seen(A)`, an unreadable line that used to be
 * `tmux-session-gone(A)`, and `session-seen(B)` folds into a register saying A
 * and B are both live — well-formed, plausible, and wrong about which agents are
 * running.
 *
 * A time series has no fold. Each line stands alone, and a lost one is a missing
 * sample — which is a hole roughly 73 seconds wide in a chart that already draws
 * holes honestly and says so in words underneath. Refusing the whole window over
 * one torn byte would blank a chart that is otherwise fine, and **a blank chart
 * reads as "the box was down"**, which is the specific lie this feature exists
 * not to tell. So it is counted rather than fatal.
 *
 * It is never silent: `unreadableLines` rides on every read and reaches the page.
 */
/* There used to be an exported `UNREADABLE_LINE_POLICY` const here, holding
   that paragraph again as a string. Nothing read it — not the product, not a
   test — and an exported constant whose only content is prose is a comment
   wearing code's clothes: it looks like something the program depends on, so a
   reader spends time working out who consumes it, and the answer is nobody.
   Found by running 260908b's own Class A check ("who calls this?") over this
   feature before pushing it. */
