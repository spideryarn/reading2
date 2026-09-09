/**
 * **THE HOLD, WRITTEN DOWN, SO IT OUTLIVES THE PROCESS THAT RECORDED IT.**
 *
 * WHAT WENT WRONG WITHOUT IT. `quarantine.ts` holds a session back after a send
 * nobody could account for: the literal text may be sitting in that agent's
 * input box with no Enter behind it, so nothing else may be delivered there
 * until a person says what is actually in it. That book was memory. **A
 * dashboard restart constructed an empty one**, `next()` then saw no hold, and
 * keystrokes were admitted again with nobody told — while the tmux server, and
 * therefore the half-typed sentence, was still exactly where it had been. The
 * dashboard on this box restarts several times an hour.
 *
 * The release route even said so — *"Holds do not survive a restart"* — which
 * made it documented and no less wrong: **what is lost is not a convenience,
 * it is the only record that a session may be holding text.** Found as U1 by
 * the cross-family review of Stage 4 and filed P0.
 *
 * ## WHAT IS ON DISK, AND WHY IT IS THREE RECORDS RATHER THAN ONE
 *
 * An append-only JSONL file, per the storage contract in
 * docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md — *"JSONL +
 * atomic checkpoints remain sufficient. Do not put host-control state in the
 * product database, or introduce SQLite until a measured query requires it."*
 *
 *  - **`attempt`** — written **BEFORE THE KEYSTROKES GO OUT**, and the window
 *    between that write and the send is the entire point of the file. A crash
 *    inside the transport must leave the record behind, because that is the
 *    case where nobody can say what is in the input box and nothing else knows
 *    to ask.
 *  - **`held`** — written after a send came back ambiguous, carrying the hold
 *    the book opened. It is what lets a rehydrated hold say *what* was read and
 *    *when* it opened; an attempt on its own can say neither.
 *  - **`resolved`** — the record that removes the two above. Written on a
 *    definitive success, on a proven `none`, on a person's release gesture, and
 *    on a proven tmux-generation change. **Nothing else resolves an attempt**:
 *    an exception out of the transport deliberately leaves it standing.
 *
 * ## THE FOLD IS "LAST RECORD PER SESSION WINS", AND THAT IS SOUND RATHER THAN
 * CONVENIENT
 *
 * A session has at most one live attempt at a time, and it is the coordinator
 * that makes it true: `send-coordinator.ts` asks `holding()` first and refuses
 * before writing anything, so a second attempt cannot be recorded while a hold
 * stands. Sends are synchronous (`execFileSync`) in a single-threaded process,
 * so no second send can interleave with a first. That is why the state of a
 * session is simply whatever its last record said.
 *
 * ## BOUNDED BY COMPACTION, NOT BY HOPE
 *
 * An unbounded file is a different bug, and an unstated retention policy is the
 * one this plan refused a stage for. So: the live state is rewritten over the
 * file — atomically, `jsonl.ts`'s `writeAtomically` — whenever the file passes
 * `MAX_LEDGER_BYTES`, and at every open. What survives a compaction is one line
 * per session with something unresolved, which is bounded by the number of live
 * agent sessions (~36 on this box), so the compacted file is a few kilobytes
 * whatever the history was.
 *
 * ## IT NEVER STOPS A SEND
 *
 * A ledger that refused to open, is locked out by another dashboard, or cannot
 * write leaves the fleet exactly where Stage 4 left it: the in-memory book still
 * works for this process's own lifetime. **Failing closed was the alternative
 * and it is worse** — a full disk would make the one tool you reach for when
 * something else is broken unable to type at all. Every such failure is on
 * `status()` and none of them is silent.
 *
 * ## ONE WRITER, AND A SECOND OPENER STILL READS
 *
 * The lock is `tools/overseer/lock.ts`'s, imported rather than copied, for the
 * reason `health-history.ts` gives at length: proving that extraction
 * behaviour-preserving by mutation found that `isProcessAlive`'s `EPERM` branch
 * survived 102 tests when flattened, and that is the branch deciding whether a
 * second writer can steal a LIVE lock. A dashboard that loses the race still
 * **reads** the ledger and still rehydrates: two dashboards both refusing to
 * type into a held session is the safe direction, and two of them appending to
 * one file is not.
 *
 * docs/plans/260908j § Stage 4b.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { truncateToLastLine, writeAll, writeAtomically, type JsonlRepair } from "../overseer/jsonl.js";
import { describeLockRefusal, releaseLock, stillOurs, takeLock, type HeldLock } from "../overseer/lock.js";
import type { UncertainSendOrigin, UncertainSendReading } from "./wire.js";

/* ------------------------------------------------------------------ *
 * Where it lives.
 * ------------------------------------------------------------------ */

/**
 * The dashboard's own journal of what it tried to type, and nobody else's.
 *
 * **THREE DIRECTORIES, THREE OWNERS, AND NEVER TWO WRITERS TO ANY OF THEM.**
 * `~/.overseer/` is the daemon's record of what it OBSERVED; `~/.fleet-health/`
 * is the dashboard's record of the BOX; this is the dashboard's record of its
 * own ACTIONS. Sharing a directory would buy nothing and would put a second
 * writer beside a file that already has one — and the failure mode of two
 * writers on an append-only log is not corruption anybody can see, it is a
 * plausible history that never happened (`tools/overseer/lock.ts` § why two
 * daemons are worse than no daemon).
 */
export const DEFAULT_HOLDS_DIR = join(process.env["HOME"] ?? "/home/greg", ".fleet-holds");

export const LEDGER_FILE = "holds.jsonl";
export const LOCK_FILE = "writer.lock";

/**
 * When the file is rewritten to its live records.
 *
 * Small on purpose. A compacted ledger is one line per session with something
 * unresolved — bounded by the number of agent sessions on the box — so the cap
 * is not protecting against the steady state, it is protecting against a
 * dashboard in a crash loop attempting a send every second. At ~300 bytes a
 * record, 256 KiB is roughly 850 records, which is far more history than
 * anything reads and small enough that the rewrite costs nothing.
 */
export const MAX_LEDGER_BYTES = 256 * 1024;

/**
 * The longest description of a payload that goes on disk.
 *
 * `what` is already a description rather than a message — `message (42
 * characters)`, never a word of the text, the same promise steer.ts and
 * drain.ts make — but a bound is what turns "small" into a growth rate the cap
 * above can actually promise anything about. health-history.ts's `MAX_WHY_CHARS`
 * is the same rule for the same reason.
 */
export const MAX_WHAT_CHARS = 200;

export type LedgerDir = { ok: true; dir: string } | { ok: false; why: string };

/**
 * The directory, and `FLEET_HOLDS_DIR` overrides it — **absolutely, or not at
 * all.**
 *
 * health-history.ts's argument, unchanged: every agent on this box works in its
 * own worktree, so a *relative* override resolves to a different directory
 * depending on who started the process. A systemd unit starting from the
 * primary checkout and a person starting from a worktree would then keep two
 * separate, entirely plausible ledgers, and the one holding the record of a
 * half-typed sentence would be whichever nobody read.
 */
export function holdLedgerDir(override: string | undefined = process.env["FLEET_HOLDS_DIR"]): LedgerDir {
  if (override === undefined || override.trim() === "") return { ok: true, dir: DEFAULT_HOLDS_DIR };
  if (!isAbsolute(override)) {
    return {
      ok: false,
      why:
        `FLEET_HOLDS_DIR must be an absolute path, and this is ${JSON.stringify(override)} — ` +
        "a relative one resolves differently for a systemd unit and for a person in a worktree, " +
        "which is two plausible ledgers and no way to tell which one holds the record of a held session",
    };
  }
  return { ok: true, dir: override };
}

/* ------------------------------------------------------------------ *
 * The records.
 * ------------------------------------------------------------------ */

/**
 * Why an attempt stopped being unresolved. **Every arm names its producer**,
 * which is the rule this plan cut three arms under.
 *
 *  - `delivered` — the transport answered `ok`. `send-coordinator.ts`.
 *  - `nothing-was-sent` — `nothingWasSent` certified that no keystroke left the
 *    process, which is the only evidence that nothing is in the input box.
 *  - `released` — a person's gesture. `QuarantineBook.release`.
 *  - `superseded` — a proven tmux-generation change took the pane, and the
 *    input box with it. `QuarantineBook.noteGeneration`.
 *
 * **A THROW OUT OF THE TRANSPORT IS NOT ON THIS LIST**, deliberately: it is the
 * outcome with the least evidence behind it, so its attempt stays unresolved
 * and a restart rehydrates it as a hold.
 */
export type HoldResolution = "delivered" | "nothing-was-sent" | "released" | "superseded";

const RESOLUTIONS: readonly HoldResolution[] = ["delivered", "nothing-was-sent", "released", "superseded"];
const ORIGINS: readonly UncertainSendOrigin[] = ["queued-delivery", "direct-steer", "broadcast"];
const READINGS: readonly UncertainSendReading[] = ["partial", "unknown", "threw", "none-contradicted"];

/** Written before the keystrokes. See the header: the window is the point. */
export type AttemptRecord = {
  schema: 1;
  kind: "attempt";
  /** When this line was written, which is **before** the send rather than after it. */
  at: number;
  sessionId: string;
  paneId: string | null;
  claudeSessionId: string | null;
  origin: UncertainSendOrigin;
  /** The payload described without a word of it. Bounded by `MAX_WHAT_CHARS`. */
  what: string;
  /** The run of the dashboard that was about to type. */
  serverInstanceId: string;
  /** The tmux server it was aimed at, or null if this run had not been told one. */
  tmuxGeneration: number | null;
};

/** Written after a send came back ambiguous, carrying the hold the book opened. */
export type HeldRecord = {
  schema: 1;
  kind: "held";
  at: number;
  sessionId: string;
  /** The id the page was drawing, kept so a phone can still release it after a restart. */
  holdId: string;
  version: number;
  openedAt: number;
  lastSendAt: number;
  incidents: number;
  reading: UncertainSendReading;
  origin: UncertainSendOrigin;
  what: string;
  paneId: string | null;
  claudeSessionId: string | null;
  serverInstanceId: string;
  /**
   * The tmux server the hold was opened against, or null if this run had not
   * been told one.
   *
   * **`firstSeenGeneration` IS NOT STORED BESIDE IT, BECAUSE NOTHING COULD
   * WRITE A NON-NULL ONE HERE.** A hold's first-seen generation is by
   * definition observed after the hold opens, and this line is written the
   * instant it opens — so the field would be null in every record ever
   * produced, which is the sort of decoration this plan has cut three of. A
   * rehydrated hold that knew no generation simply starts that observation
   * again in the new run: the window it re-opens is one refresh cycle wide,
   * which is the width it was designed to have.
   */
  tmuxGeneration: number | null;
};

export type ResolvedRecord = {
  schema: 1;
  kind: "resolved";
  at: number;
  sessionId: string;
  how: HoldResolution;
};

export type HoldLedgerRecord = AttemptRecord | HeldRecord | ResolvedRecord;

/** The two kinds that mean *something about this session is unaccounted for*. */
export type LedgerState = AttemptRecord | HeldRecord;

/**
 * **`why` IS NOT STORED, AND THAT IS DELIBERATE.**
 *
 * The sentence a person decides from is computed from the evidence by
 * `quarantine.ts`, so storing it would freeze one version of the wording into
 * a file that outlives the build that wrote it — and the wording is the part of
 * this feature most likely to improve. What is stored is `reading` and `what`,
 * which is what the sentence is made of.
 */
export function ledgerLine(record: HoldLedgerRecord): string {
  const bounded: HoldLedgerRecord =
    record.kind === "resolved" ? record : { ...record, what: record.what.slice(0, MAX_WHAT_CHARS) };
  return `${JSON.stringify(bounded)}\n`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function millis(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function nullableString(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v === null) return { ok: true, value: null };
  if (typeof v === "string") return { ok: true, value: v };
  return { ok: false };
}

function nullableNumber(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v === null) return { ok: true, value: null };
  if (typeof v === "number" && Number.isFinite(v)) return { ok: true, value: v };
  return { ok: false };
}

/**
 * One line back into a record, or null.
 *
 * **STRICT, AND A REFUSAL IS COUNTED RATHER THAN THROWN.** A line this build
 * does not understand — a future schema, a field that changed shape — must not
 * take the rest of the file with it, because the rest of the file is what says
 * which sessions are held. `status().unreadableLines` is how a reader finds out
 * that something was dropped, which is the difference between a gap and a gap
 * nobody knows about.
 */
export function parseLedgerLine(line: string): HoldLedgerRecord | null {
  const text = line.trim();
  if (text === "") return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(json)) return null;
  if (json["schema"] !== 1) return null;
  const at = millis(json["at"]);
  const sessionId = json["sessionId"];
  if (at === null || typeof sessionId !== "string" || sessionId === "") return null;

  if (json["kind"] === "resolved") {
    const how = json["how"];
    if (typeof how !== "string" || !RESOLUTIONS.includes(how as HoldResolution)) return null;
    return { schema: 1, kind: "resolved", at, sessionId, how: how as HoldResolution };
  }

  const origin = json["origin"];
  const what = json["what"];
  const paneId = nullableString(json["paneId"]);
  const claudeSessionId = nullableString(json["claudeSessionId"]);
  const serverInstanceId = json["serverInstanceId"];
  const tmuxGeneration = nullableNumber(json["tmuxGeneration"]);
  if (typeof origin !== "string" || !ORIGINS.includes(origin as UncertainSendOrigin)) return null;
  if (typeof what !== "string") return null;
  if (!paneId.ok || !claudeSessionId.ok || !tmuxGeneration.ok) return null;
  if (typeof serverInstanceId !== "string") return null;

  const common = {
    schema: 1 as const,
    at,
    sessionId,
    paneId: paneId.value,
    claudeSessionId: claudeSessionId.value,
    origin: origin as UncertainSendOrigin,
    what: what.slice(0, MAX_WHAT_CHARS),
    serverInstanceId,
    tmuxGeneration: tmuxGeneration.value,
  };

  if (json["kind"] === "attempt") return { ...common, kind: "attempt" };

  if (json["kind"] === "held") {
    const holdId = json["holdId"];
    const version = millis(json["version"]);
    const openedAt = millis(json["openedAt"]);
    const lastSendAt = millis(json["lastSendAt"]);
    const incidents = millis(json["incidents"]);
    const reading = json["reading"];
    if (typeof holdId !== "string" || holdId === "") return null;
    if (version === null || openedAt === null || lastSendAt === null || incidents === null) return null;
    if (typeof reading !== "string" || !READINGS.includes(reading as UncertainSendReading)) return null;
    return {
      ...common,
      kind: "held",
      holdId,
      version,
      openedAt,
      lastSendAt,
      incidents,
      reading: reading as UncertainSendReading,
    };
  }

  return null;
}

/**
 * What is unresolved, per session, after reading every line in order.
 *
 * **THE LAST RECORD FOR A SESSION DECIDES** — see the header for why that is a
 * sound rule here rather than a convenient one. Ordering is file order, which
 * is write order, because `O_APPEND` makes the seek and the write one step in
 * the kernel.
 */
export function foldLedger(records: Iterable<HoldLedgerRecord>): Map<string, LedgerState> {
  const live = new Map<string, LedgerState>();
  for (const record of records) {
    if (record.kind === "resolved") live.delete(record.sessionId);
    else live.set(record.sessionId, record);
  }
  return live;
}

/* ------------------------------------------------------------------ *
 * The store.
 * ------------------------------------------------------------------ */

export type LedgerStatus = {
  dir: string;
  /** Null when this process holds the writer lock; otherwise why it does not. */
  lockedOutBy: string | null;
  /** The most recent write failure, or null. Never silent: see the header. */
  failure: string | null;
  /** Lines the read could not parse. A dropped record somebody can count. */
  unreadableLines: number;
  /** What the open found at the end of the file. */
  repaired: JsonlRepair;
  /** How many times the file has been rewritten to its live records. */
  compactions: number;
};

export type HoldLedger = {
  dir: string;
  /**
   * Every session with something unaccounted for, as the file now says.
   *
   * Read at open and maintained by the writes, so a compaction is a rewrite of
   * this rather than a re-read of the file.
   */
  live(): LedgerState[];
  /** **Before the keystrokes.** The whole reason this module exists. */
  noteAttempt(record: Omit<AttemptRecord, "schema" | "kind">): void;
  /** After an ambiguous send, carrying the hold the book opened or extended. */
  noteHold(record: Omit<HeldRecord, "schema" | "kind">): void;
  /** The one thing that takes a session off the list. */
  noteResolved(record: Omit<ResolvedRecord, "schema" | "kind">): void;
  status(): LedgerStatus;
  /** Give the writer lock back. A dashboard never does; a test that reopens must. */
  close(): void;
};

export type OpenedHoldLedger = { kind: "open"; ledger: HoldLedger } | { kind: "refused"; why: string };

export type OpenLedgerOptions = {
  /**
   * How a line reaches the fd. Injected ONLY by tests, to reach the arm a
   * healthy filesystem will not produce — a write that fails — because the
   * behaviour under it (record the failure, do not throw, do not pretend the
   * record is there) is the behaviour a full disk gets.
   */
  writeLine?: ((fd: number, line: string) => void) | undefined;
  /**
   * Called once per new trouble, with a sentence. Wired to the dashboard's log
   * by the composition. **A ledger that has quietly stopped writing looks
   * exactly like one that is working**, which is the failure class
   * docs/reusable/silent-success.md is about.
   */
  onTrouble?: ((why: string) => void) | undefined;
};

export function openHoldLedger(dir: string, options: OpenLedgerOptions = {}): OpenedHoldLedger {
  if (!isAbsolute(dir)) {
    return { kind: "refused", why: `the hold ledger directory must be an absolute path, and this is ${JSON.stringify(dir)}` };
  }
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch (err) {
    return { kind: "refused", why: `could not create ${dir}: ${err instanceof Error ? err.message : String(err)}` };
  }

  /* THE LOCK BEFORE THE REPAIR, health-history.ts's ordering and its reason:
     `truncateToLastLine` is a WRITE, and a process that will go on to be
     correctly refused must not first cut back the file belonging to the writer
     that owns it. */
  const path = join(dir, LEDGER_FILE);
  const lockPath = join(dir, LOCK_FILE);
  const taken = takeLock(lockPath, () => new Date());
  const lock = taken.ok ? taken.lock : null;
  const lockedOutBy = taken.ok
    ? null
    : `${describeLockRefusal(taken.refusal, lockPath)} This dashboard is reading the hold ledger but not adding to it.`;

  let repaired: JsonlRepair = { torn: false };
  if (lock !== null) {
    const giveUp = (why: string): OpenedHoldLedger => {
      releaseLock(lock, lockPath);
      return { kind: "refused", why };
    };
    if (!stillOurs(lock, lockPath)) return giveUp(`another writer took ${lockPath} between claiming it and repairing ${path}`);
    try {
      repaired = truncateToLastLine(path);
    } catch (err) {
      return giveUp(`could not repair ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!stillOurs(lock, lockPath)) return giveUp(`another writer took ${lockPath} while ${path} was being repaired`);
  }

  let unreadableLines = 0;
  const records: HoldLedgerRecord[] = [];
  if (existsSync(path)) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (err) {
      if (lock !== null) releaseLock(lock, lockPath);
      return { kind: "refused", why: `could not read ${path}: ${err instanceof Error ? err.message : String(err)}` };
    }
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      const record = parseLedgerLine(line);
      if (record === null) unreadableLines += 1;
      else records.push(record);
    }
  }

  return {
    kind: "open",
    ledger: makeLedger(dir, lock, lockedOutBy, foldLedger(records), { repaired, unreadableLines }, options),
  };
}

function makeLedger(
  dir: string,
  lock: HeldLock | null,
  refusal: string | null,
  live: Map<string, LedgerState>,
  read: { repaired: JsonlRepair; unreadableLines: number },
  options: OpenLedgerOptions,
): HoldLedger {
  const path = join(dir, LEDGER_FILE);
  const lockPath = join(dir, LOCK_FILE);
  const write = options.writeLine ?? writeAll;
  let held: HeldLock | null = lock;
  let lockedOutBy = refusal;
  let failure: string | null = null;
  let compactions = 0;

  const trouble = (why: string): void => {
    if (failure === why) return;
    failure = why;
    options.onTrouble?.(why);
  };

  /**
   * **STILL OURS?** — asked of the filesystem before every write, for
   * `health-history.ts`'s reason: `takeLock` at startup is not a claim that
   * survives the process, and the stale-lock race `lock.ts` names can leave one
   * claimant appending beside the winner for ever. Sends are rare, so this is a
   * `stat` per keystroke-attempt rather than per second.
   */
  const mayWrite = (): boolean => {
    if (held !== null && !stillOurs(held, lockPath)) {
      held = null;
      lockedOutBy = `the writer lock at ${lockPath} is no longer this process's — another writer took it`;
    }
    if (lockedOutBy !== null) {
      trouble(`${lockedOutBy}. Holds opened here will not survive a restart.`);
      return false;
    }
    return true;
  };

  /**
   * Append one record, then keep the file bounded.
   *
   * **THE IN-MEMORY MAP IS UPDATED ONLY IF THE BYTES WENT DOWN.** A `live()`
   * that counted a record the disk never took would be this module's own
   * version of the bug it exists to close: something reporting success while
   * doing nothing, and the obvious check agreeing because it shares the
   * assumption.
   */
  const append = (record: HoldLedgerRecord): void => {
    if (!mayWrite()) return;
    const line = ledgerLine(record);
    let fd: number;
    try {
      fd = openSync(path, "a", 0o600);
    } catch (err) {
      trouble(`could not open ${path}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    try {
      write(fd, line);
    } catch (err) {
      trouble(`could not write to ${path}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    } finally {
      closeSync(fd);
    }
    failure = null;
    if (record.kind === "resolved") live.delete(record.sessionId);
    else live.set(record.sessionId, record);
    compact();
  };

  /**
   * Rewrite the file as its live records, when it has grown past the cap.
   *
   * `writeAtomically` — temp file, `fsync`, rename — because this is the one
   * write here that is not append-only, and a reader must never see half of it.
   * A compaction that failed leaves the append-only file exactly as it was,
   * which is correct and merely larger.
   */
  const compact = (): void => {
    let size: number;
    try {
      size = existsSync(path) ? statSync(path).size : 0;
    } catch {
      return;
    }
    if (size <= MAX_LEDGER_BYTES) return;
    const text = [...live.values()].map((record) => ledgerLine(record)).join("");
    try {
      writeAtomically(path, dir, text);
      compactions += 1;
    } catch (err) {
      trouble(`could not compact ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return {
    dir,
    live: () => [...live.values()],
    noteAttempt: (record) => append({ schema: 1, kind: "attempt", ...record }),
    noteHold: (record) => append({ schema: 1, kind: "held", ...record }),
    noteResolved: (record) => append({ schema: 1, kind: "resolved", ...record }),
    status: () => ({
      dir,
      lockedOutBy,
      failure,
      unreadableLines: read.unreadableLines,
      repaired: read.repaired,
      compactions,
    }),
    close(): void {
      /* IDEMPOTENT, health-history.ts's reason: `releaseLock` closes the fd and
         closing it twice is `EBADF` — a throw out of a cleanup path. */
      if (held === null) return;
      const mine = held;
      held = null;
      releaseLock(mine, lockPath);
      lockedOutBy = "this ledger has been closed and has given up the writer lock";
    },
  };
}
