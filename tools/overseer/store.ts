/**
 * The Overseer's store: an append-only event log, a checkpoint, and one writer.
 *
 * This is the thing nothing on this box has today. Session identity — the
 * `META` fields and the claimed conversation — is pinned into the **tmux
 * environment** at launch, and a reboot takes the tmux server and all of it.
 * The register in `current.json` is the only copy that survives, which is why
 * `meta.dir` is carried whole rather than reconstructed from a transcript path:
 * that path is a slugified cwd and is lossy, and `repo` is not derivable from
 * it at all. docs/project/orchestrator-direction.md § The store.
 *
 * ## It lives OUTSIDE the repo, and that is not tidiness
 *
 * `~/.overseer/`, overridable with `OVERSEER_STORE_DIR`. Every agent works in
 * its own worktree and removes it when the job is done, and `data/` is
 * gitignored — so a clean `git status` says "safe to delete" over the top of a
 * store kept in the tree, and the next agent to finish deletes the history with
 * no copy anywhere. It is also a box-level daemon spanning several checkouts,
 * so a per-checkout store would be one store per worktree, which is not a
 * store.
 *
 * ## Three refusals, and each is about a plausible history rather than a crash
 *
 * **1. Truncate to the last newline on open, before the first append.** A crash
 * mid-write leaves `{"kind":"session-` with no newline. Skipping a bad line on
 * READ is not a repair and this is the trap worth naming: the next append
 * writes a valid object immediately after those bytes, the valid event is now
 * concatenated onto corrupt ones, and after one more append the malformed
 * record is no longer the final line — so a reader either fails or silently
 * loses the first post-restart event. Repair happens once, at open, under the
 * lock, with the file truncated on disk. GPT Sol's F3.
 *
 * **2. The checkpoint is written temp-then-rename.** Rename is atomic within a
 * filesystem, so a reader sees the old file or the new one and never half of
 * either. A half-written `current.json` is the failure that makes recovery
 * worse than no recovery, because a truncation that happens to close its braces
 * parses fine and returns a fleet of thirty-six as thirty-five.
 *
 * **3. One writer, enforced.** Two daemons — a botched restart, or a manual
 * start beside a systemd one — both append the same transitions and both
 * overwrite the checkpoint, and the result reads as a perfectly ordinary
 * afternoon that never happened. `O_APPEND` protects the write position and
 * nothing else. GPT Sol's F4.
 *
 * ## And one permission: the store is DISPOSABLE
 *
 * Greg's ceiling on this work is *"no state that only this process knows how to
 * reconstruct"*, and the fallback for the whole system is ssh and a terminal.
 * So a missing, empty or truncated `~/.overseer/` starts **cold** — no
 * baseline, no history, and it says so — and never refuses to run, never
 * crashes, and never needs a repair step. `foldEvents` is what makes that true
 * rather than aspirational: the register is a fold of the log, so
 * `current.json` is an optimisation and losing it costs a replay. Losing the
 * log costs history and nothing else.
 *
 * The one thing that DOES refuse is a lock this process cannot prove is stale,
 * because there the choice is between "correct and unavailable" and "plausible
 * and up", and being down is one ssh command away from recoverable.
 *
 * ## JSONL, and when to stop
 *
 * One file, no rotation, no dependency. `readEvents` reads the whole log and
 * slices — fine while a day is a few thousand events and a human greps it.
 * **What forces SQLite**, named so nobody re-opens the question: a read that
 * has to scan history to answer a page load, indexed historical queries,
 * transactional multi-record state, concurrent writers, or retention becoming
 * awkward. Refusing concurrent writers is preferable to adopting SQLite in
 * order to tolerate them.
 */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

import type { SessionKind, SessionMeta } from "../../scripts/gjd-remote-tmux.js";
import { statusKey, type OverseerEvent, type SessionKey, type StatusKey } from "./diff.js";
import type { ObservedRow, ParseResult } from "./observation.js";

/**
 * The checkpoint's schema.
 *
 * Bumped when a reader that ignored the change would be WRONG rather than
 * merely poorer — the producer's own rule, adopted here so the two files use
 * one meaning of the word. Adding a field is not a bump; a version that changes
 * on every addition is one nobody checks.
 */
export const STORE_SCHEMA = 1;

export const EVENTS_FILE = "events.jsonl";
export const CHECKPOINT_FILE = "current.json";
export const LOCK_FILE = "overseer.lock";

/** How much of a torn line is kept for the log message. The bytes count is exact regardless. */
const DROPPED_TEXT_CAP = 4096;

/** Who holds the lock, in terms somebody reading it over ssh can act on. */
export type LockHolder = { pid: number; instanceId: string; hostname: string; startedAt: string };

/**
 * Why the store would not open. Never a thrown string: a launcher has to print
 * a sentence saying what a person should do, and an exception gives it nothing
 * to print that is not also a stack trace.
 */
export type StoreRefusal =
  | { reason: "already-running"; holder: LockHolder }
  | { reason: "lock-unreadable"; detail: string }
  | { reason: "lost-the-race"; holder: LockHolder | null }
  | { reason: "unusable-directory"; detail: string };

/** Why there was no checkpoint to resume from. Five arms because five different things go wrong. */
export type ColdReason =
  | "no-store-directory"
  | "no-checkpoint"
  | "checkpoint-empty"
  | "checkpoint-unreadable"
  | "checkpoint-malformed";

export type LogRepair = { torn: false } | { torn: true; droppedBytes: number; droppedText: string };

/**
 * How this daemon came up, in the three ways that are actually different.
 *
 * `cold` has no baseline, so the first snapshot after it yields a
 * `session-seen` for every session — correct, and worth saying out loud,
 * because it looks like the whole fleet just started. `rebuilt` means the
 * checkpoint was unusable and the register came back out of the log instead:
 * the same answer, more slowly. `resumed` is the ordinary restart.
 */
export type StoreStart =
  | { kind: "cold"; why: ColdReason }
  | { kind: "rebuilt"; why: ColdReason }
  | { kind: "resumed"; checkpointWrittenAt: string; lastGoodSnapshotAt: string | null };

export type StoreOpening = {
  start: StoreStart;
  repair: LogRepair;
  /** Events folded at open: the tail past the checkpoint's cursor, or the whole log for a rebuild. */
  eventsReplayed: number;
  /** Lines the reader could not use. Reported rather than swallowed — a silent skip is how a log rots unnoticed. */
  unreadableLines: number;
};

/**
 * One session, as the register holds it. **This is the reboot-resume
 * material**, and every field in it is here because it cannot be recovered
 * afterwards from anywhere else.
 */
export type RegisterEntry = {
  key: SessionKey;
  /** tmux's handle. Meaningless without `tmuxServerPid`, which is why both are here. */
  tmuxId: string;
  /** A CLAIM, not a fact — see `ObservedRow.claimedConversationId`. What `--resume` would be given. */
  claimedConversationId: string | null;
  name: string;
  /** The launcher's metadata whole: `dir` is not reconstructible and `repo` is not derivable from `dir`. */
  meta: SessionMeta;
  repo: string | null;
  worktree: string | null;
  startedAt: string;
  paneId: string | null;
  panePid: number | null;
  tmuxServerPid: number | null;
  /**
   * A FLOOR, NOT A READING, and the difference matters. Events are written when
   * something changes, so a session sitting idle for six hours emits nothing
   * and this stays where it was. It means "alive at least this recently".
   * Whether it is alive NOW is the checkpoint's `lastGoodSnapshotAt`: every
   * session in the register was in that snapshot, because a `tmux-session-gone`
   * would have removed it. Rendering this as "idle for N minutes" without the
   * snapshot clock is the mistake this comment exists to stop.
   */
  lastSeenAlive: string;
  /** The canonical key, never the status object: `waiting.secondsLeft` changes every collection. */
  lastStatusKey: StatusKey;
  /** When it entered that state — the duration attention triage ranks by. */
  statusSince: string;
};

export type SessionRegister = ReadonlyMap<SessionKey, RegisterEntry>;

/**
 * The checkpoint. Two clocks, deliberately, and they come apart exactly when
 * something is wrong: `writtenAt` is when the Overseer last wrote, and
 * `lastGoodSnapshotAt` is the producer's own `collectedAt` from the last
 * accepted observation. One number would hide the case where the Overseer is
 * alive but deaf.
 */
export type Checkpoint = {
  schema: typeof STORE_SCHEMA;
  writtenAt: string;
  lastGoodSnapshotAt: string | null;
  /** Where the fold below got to. `bytes` is the real cursor; `events` is for reading. */
  cursor: { events: number; bytes: number };
  /** So a reader can say *the Overseer is dead* rather than showing a stale register as current. */
  heartbeat: { pid: number; instanceId: string; startedAt: string; lastTickAt: string | null; ticks: number };
  register: readonly RegisterEntry[];
};

export type CheckpointUpdate = { lastGoodSnapshotAt: string | null; tick: boolean };

export type CheckpointRead =
  | { kind: "checkpoint"; checkpoint: Checkpoint }
  | { kind: "absent" }
  | { kind: "unusable"; why: ColdReason; detail: string };

/**
 * A write's outcome.
 *
 * `lock-lost` is a RESULT rather than an exception because it is an
 * environmental fact a daemon has to react to — stop, and say so — where a
 * closed store is a programming mistake and throws.
 */
export type AppendResult =
  | { ok: true; appended: number; cursor: { events: number; bytes: number } }
  | { ok: false; reason: "lock-lost"; holder: LockHolder | null };

export type CheckpointResult =
  | { ok: true; checkpoint: Checkpoint }
  | { ok: false; reason: "lock-lost"; holder: LockHolder | null };

export type ReadEvents = {
  events: readonly OverseerEvent[];
  /** `line` counts from the first line read, so it is absolute only when reading from byte 0. */
  unreadable: readonly { line: number; text: string }[];
  /** The byte to read from next time — the cursor a checkpoint stores. */
  nextByte: number;
};

export type OverseerStore = {
  readonly root: string;
  readonly instanceId: string;
  readonly opening: StoreOpening;
  /** Live: `append` folds into it, so the caller cannot desynchronise it from the log. */
  readonly register: SessionRegister;
  append(events: readonly OverseerEvent[]): AppendResult;
  checkpoint(update: CheckpointUpdate): CheckpointResult;
  readEvents(fromByte?: number): ReadEvents;
  close(): void;
};

export type OpenStoreOptions = {
  /** Tests always pass this. Nothing here may touch a real `~/.overseer`. */
  root?: string;
  /** Injected so a test can pin the clock; the daemon takes the default. */
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
};

export type OpenStoreResult = { ok: true; store: OverseerStore } | { ok: false; refusal: StoreRefusal };

export function storeRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env["OVERSEER_STORE_DIR"];
  if (override !== undefined && override.trim() !== "") return override;
  return join(homedir(), ".overseer");
}

/**
 * Whether a pid is running, asked of the kernel rather than of a file.
 *
 * `EPERM` is TRUE, not false: it means the process exists and belongs to
 * somebody else, and reading it as "gone" would let a second daemon take a live
 * lock. `ESRCH` is the only proof of absence.
 *
 * **PID REUSE IS ACCEPTED, KNOWINGLY.** Linux hands pids out again after
 * wrapping, so a lock left by a dead Overseer whose pid has since been reused
 * by anything at all reads as held, and the next start refuses instead of
 * taking over. That is the safe direction — a refusal is one `rm` away from
 * fixed and says exactly which file to remove, where a wrongly-taken lock is
 * two writers producing a plausible history. The opposite mistake, a genuinely
 * live Overseer whose lock we steal, is what the check prevents and is the one
 * worth spending a false refusal on. `hostname` and `startedAt` in the record
 * are there so a person can tell the two apart by hand.
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

/**
 * A timestamp that came from `Date.toISOString()`, checked by round trip.
 *
 * `new Date("2026-09-08").getTime()` is a perfectly good number and means
 * midnight UTC, which is a fact nobody measured. Same reasoning as
 * observation.ts, and the clock a history is ordered by is the one thing in it
 * that must not be approximate.
 */
function isIsoTimestamp(u: unknown): u is string {
  if (typeof u !== "string") return false;
  const parsed = new Date(u);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === u;
}

function isNonNegativeInteger(u: unknown): u is number {
  return typeof u === "number" && Number.isInteger(u) && u >= 0;
}

/** A pid or a tmux server generation. Integer and positive: a fractional pid reads as a CHANGED generation. */
function isPidLike(u: unknown): u is number {
  return typeof u === "number" && Number.isInteger(u) && u > 0;
}

function isNullableString(u: unknown): u is string | null {
  return u === null || typeof u === "string";
}

const SESSION_KINDS: readonly SessionKind[] = ["claude", "shell", "setup"];

/**
 * The launcher's metadata, revalidated on the way back in.
 *
 * `dir` must be ABSOLUTE. GPT Sol's S2-06: a relative one parses happily and a
 * later resumer would restart a real conversation in whatever directory the
 * daemon happened to be sitting in — a working session, in the wrong tree,
 * with nothing to say so.
 */
function parseMeta(u: unknown): ParseResult<SessionMeta> {
  if (!isRecord(u)) return { ok: false, reason: "meta is not an object" };
  const version = u["version"];
  if (version === "legacy") return { ok: true, value: { version: "legacy" } };
  if (version !== 1) return { ok: false, reason: `meta.version ${JSON.stringify(version)} is not 1 or "legacy"` };
  const kind = u["kind"];
  const repo = u["repo"];
  const dir = u["dir"];
  if (typeof kind !== "string" || !SESSION_KINDS.includes(kind as SessionKind)) {
    return { ok: false, reason: `meta.kind ${JSON.stringify(kind)} is not a session kind` };
  }
  if (typeof repo !== "string") return { ok: false, reason: "meta.repo is not a string" };
  if (typeof dir !== "string" || !dir.startsWith("/")) {
    return { ok: false, reason: `meta.dir ${JSON.stringify(dir)} is not an absolute path` };
  }
  return { ok: true, value: { version: 1, kind: kind as SessionKind, repo, dir } };
}

/**
 * One register entry, parsed strictly from `unknown`.
 *
 * **The whole checkpoint fails if any entry does** — see `parseCheckpoint`.
 * This function's job is only to be unforgiving, including about the key: an
 * entry whose `key` does not match its own handle and claim is a file somebody
 * has edited by hand, and keeping it would mean a register indexed by something
 * that does not describe its contents.
 */
function parseRegisterEntry(u: unknown): ParseResult<RegisterEntry> {
  if (!isRecord(u)) return { ok: false, reason: "register entry is not an object" };
  const tmuxId = u["tmuxId"];
  if (typeof tmuxId !== "string" || !/^\$\d+$/.test(tmuxId)) {
    return { ok: false, reason: `tmuxId ${JSON.stringify(tmuxId)} is not a tmux session handle` };
  }
  const claimed = u["claimedConversationId"];
  if (!isNullableString(claimed)) return { ok: false, reason: "claimedConversationId is not a string or null" };
  const key = u["key"];
  const expected = keyFor(tmuxId, claimed);
  if (key !== expected) {
    return { ok: false, reason: `key ${JSON.stringify(key)} does not match its own identity (${expected})` };
  }
  const name = u["name"];
  if (typeof name !== "string") return { ok: false, reason: "name is not a string" };
  const meta = parseMeta(u["meta"]);
  if (!meta.ok) return { ok: false, reason: meta.reason };
  const repo = u["repo"];
  if (!isNullableString(repo)) return { ok: false, reason: "repo is not a string or null" };
  const worktree = u["worktree"];
  if (!isNullableString(worktree)) return { ok: false, reason: "worktree is not a string or null" };
  const startedAt = u["startedAt"];
  if (!isIsoTimestamp(startedAt)) return { ok: false, reason: "startedAt is not an ISO timestamp" };
  const paneId = u["paneId"];
  if (!isNullableString(paneId)) return { ok: false, reason: "paneId is not a string or null" };
  const panePid = u["panePid"];
  if (panePid !== null && !isPidLike(panePid)) return { ok: false, reason: "panePid is not a pid or null" };
  const tmuxServerPid = u["tmuxServerPid"];
  if (tmuxServerPid !== null && !isPidLike(tmuxServerPid)) {
    return { ok: false, reason: "tmuxServerPid is not a pid or null" };
  }
  const lastSeenAlive = u["lastSeenAlive"];
  if (!isIsoTimestamp(lastSeenAlive)) return { ok: false, reason: "lastSeenAlive is not an ISO timestamp" };
  const statusSince = u["statusSince"];
  if (!isIsoTimestamp(statusSince)) return { ok: false, reason: "statusSince is not an ISO timestamp" };
  const lastStatusKey = u["lastStatusKey"];
  if (typeof lastStatusKey !== "string" || lastStatusKey === "") {
    return { ok: false, reason: "lastStatusKey is not a status key" };
  }
  return {
    ok: true,
    value: {
      key: key as SessionKey,
      tmuxId,
      claimedConversationId: claimed,
      name,
      meta: meta.value,
      repo,
      worktree,
      startedAt,
      paneId,
      panePid,
      tmuxServerPid,
      lastSeenAlive,
      lastStatusKey: lastStatusKey as StatusKey,
      statusSince,
    },
  };
}

/**
 * The checkpoint, parsed strictly, **failing whole on any bad entry**.
 *
 * That is the decision the "half-written `current.json`" test is about. Keeping
 * the entries that happened to parse is how a fleet of thirty-six comes back as
 * thirty-five, silently, with the missing one indistinguishable from a session
 * that really did end — and the register is precisely the thing there is no
 * second copy of. Failing whole costs a replay of the log, which is cheap and
 * which produces the same answer.
 */
function parseCheckpoint(u: unknown): ParseResult<Checkpoint> {
  if (!isRecord(u)) return { ok: false, reason: "the checkpoint is not an object" };
  if (u["schema"] !== STORE_SCHEMA) {
    return { ok: false, reason: `schema ${JSON.stringify(u["schema"])} is not ${STORE_SCHEMA}` };
  }
  const writtenAt = u["writtenAt"];
  if (!isIsoTimestamp(writtenAt)) return { ok: false, reason: "writtenAt is not an ISO timestamp" };
  const lastGood = u["lastGoodSnapshotAt"];
  if (lastGood !== null && !isIsoTimestamp(lastGood)) {
    return { ok: false, reason: "lastGoodSnapshotAt is not an ISO timestamp or null" };
  }
  const cursor = u["cursor"];
  if (!isRecord(cursor)) return { ok: false, reason: "cursor is not an object" };
  const cursorEvents = cursor["events"];
  const cursorBytes = cursor["bytes"];
  if (!isNonNegativeInteger(cursorEvents) || !isNonNegativeInteger(cursorBytes)) {
    return { ok: false, reason: "cursor is not two byte/event counts" };
  }
  const heartbeat = u["heartbeat"];
  if (!isRecord(heartbeat)) return { ok: false, reason: "heartbeat is not an object" };
  const pid = heartbeat["pid"];
  const instanceId = heartbeat["instanceId"];
  const heartbeatStartedAt = heartbeat["startedAt"];
  const ticks = heartbeat["ticks"];
  if (!isPidLike(pid)) return { ok: false, reason: "heartbeat.pid is not a pid" };
  if (typeof instanceId !== "string") return { ok: false, reason: "heartbeat.instanceId is not a string" };
  if (!isIsoTimestamp(heartbeatStartedAt)) return { ok: false, reason: "heartbeat.startedAt is not an ISO timestamp" };
  const lastTickAt = heartbeat["lastTickAt"];
  if (lastTickAt !== null && !isIsoTimestamp(lastTickAt)) {
    return { ok: false, reason: "heartbeat.lastTickAt is not an ISO timestamp or null" };
  }
  if (!isNonNegativeInteger(ticks)) return { ok: false, reason: "heartbeat.ticks is not a count" };
  const rawRegister = u["register"];
  if (!Array.isArray(rawRegister)) return { ok: false, reason: "register is not an array" };
  const register: RegisterEntry[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of rawRegister.entries()) {
    const entry = parseRegisterEntry(raw);
    if (!entry.ok) return { ok: false, reason: `register[${index}]: ${entry.reason}` };
    if (seen.has(entry.value.key)) return { ok: false, reason: `register has ${entry.value.key} twice` };
    seen.add(entry.value.key);
    register.push(entry.value);
  }
  return {
    ok: true,
    value: {
      schema: STORE_SCHEMA,
      writtenAt,
      lastGoodSnapshotAt: lastGood,
      cursor: { events: cursorEvents, bytes: cursorBytes },
      heartbeat: { pid, instanceId, startedAt: heartbeatStartedAt, lastTickAt, ticks },
      register,
    },
  };
}

/**
 * The checkpoint as anybody may read it — the dashboard included, which reads
 * and never writes. No lock is taken: the file is replaced by rename, so a
 * reader sees one version or the other and never half of one.
 */
export function readCheckpoint(root: string = storeRoot()): CheckpointRead {
  const path = join(root, CHECKPOINT_FILE);
  if (!existsSync(path)) return { kind: "absent" };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    return { kind: "unusable", why: "checkpoint-unreadable", detail: String(cause) };
  }
  if (text.trim() === "") return { kind: "unusable", why: "checkpoint-empty", detail: `${CHECKPOINT_FILE} is empty` };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    return { kind: "unusable", why: "checkpoint-malformed", detail: String(cause) };
  }
  const parsed = parseCheckpoint(json);
  if (!parsed.ok) return { kind: "unusable", why: "checkpoint-malformed", detail: parsed.reason };
  return { kind: "checkpoint", checkpoint: parsed.value };
}

/** The key, spelled the way `sessionKey` in diff.ts spells it, for validating one we read back. */
function keyFor(tmuxId: string, claimedConversationId: string | null): string {
  return `${tmuxId} ${claimedConversationId === null ? "none" : `claims:${claimedConversationId}`}`;
}

/**
 * Truncate the log to its last complete line, **on disk**, before anything
 * appends to it.
 *
 * Scanning backwards in chunks rather than reading the file, because this runs
 * at every start and the file only grows. A file with no newline at all
 * truncates to empty — that is a single torn line and there is nothing in it to
 * keep.
 */
function repairEventLog(path: string): LogRepair {
  if (!existsSync(path)) return { torn: false };
  const fd = openSync(path, "r+");
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return { torn: false };

    const CHUNK = 64 * 1024;
    let end = size;
    let lastNewline = -1;
    while (end > 0) {
      const start = Math.max(0, end - CHUNK);
      const buffer = Buffer.alloc(end - start);
      readSync(fd, buffer, 0, buffer.length, start);
      const index = buffer.lastIndexOf(0x0a);
      if (index !== -1) {
        lastNewline = start + index;
        break;
      }
      end = start;
    }
    if (lastNewline === size - 1) return { torn: false };

    const keep = lastNewline + 1;
    const droppedBytes = size - keep;
    const dropped = Buffer.alloc(Math.min(droppedBytes, DROPPED_TEXT_CAP));
    readSync(fd, dropped, 0, dropped.length, keep);
    ftruncateSync(fd, keep);
    fsyncSync(fd);
    return { torn: true, droppedBytes, droppedText: dropped.toString("utf8") };
  } finally {
    closeSync(fd);
  }
}

/**
 * Write, flush, then rename over the target.
 *
 * The `fsync` before the rename is what makes the new file's CONTENT durable;
 * the directory `fsync` after it is what makes the rename itself durable, and
 * it is best-effort because opening a directory for reading is a Linux
 * affordance rather than a portable one. The temp file is a sibling on purpose:
 * a rename across filesystems is not atomic and is not even the same syscall.
 */
/**
 * Write every byte, because `writeSync` does not promise to.
 *
 * It returns a COUNT, and a short write on a regular file is rare rather than
 * impossible — a signal, a full disk. Trusting the count without looking at it
 * would produce exactly the torn line this module opens by repairing, except
 * with nothing having gone wrong at the time and no error anywhere. The loop
 * costs nothing and removes the class.
 */
function writeAll(fd: number, text: string): void {
  const buffer = Buffer.from(text, "utf8");
  let written = 0;
  while (written < buffer.length) {
    const wrote = writeSync(fd, buffer, written, buffer.length - written);
    if (wrote <= 0) throw new Error(`wrote ${wrote} of ${buffer.length - written} remaining bytes`);
    written += wrote;
  }
}

function writeAtomically(path: string, directory: string, text: string): void {
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const fd = openSync(temp, "w");
  try {
    writeAll(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
  try {
    const dir = openSync(directory, "r");
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  } catch {
    /* Not every platform lets you fsync a directory. The rename still happened. */
  }
}

type LockRead =
  | { kind: "absent" }
  | { kind: "held"; holder: LockHolder }
  | { kind: "unreadable"; detail: string };

function readLock(path: string): LockRead {
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
 * Take the lock, or refuse.
 *
 * Three outcomes and only one of them takes over: no lock at all, or a lock
 * whose pid is **provably** gone. A lock that cannot be parsed is not proof of
 * anything, so it refuses and names the file — a stale unreadable lock is one
 * `rm` away from fixed, and stealing one is two daemons away from a history
 * nobody can tell is wrong.
 *
 * **The read-back is not decoration.** Two processes that both prove the same
 * holder dead would both write; the rename is atomic, so exactly one record
 * survives, and reading it back is how the loser finds out. The residual window
 * — the loser reading its own record before the winner's rename lands — is
 * closed by `Store.ownership()`, which re-checks before every write, so a
 * second writer stops at its next tick rather than running beside the first.
 */
function acquireLock(
  root: string,
  now: () => Date,
): { ok: true; holder: LockHolder } | { ok: false; refusal: StoreRefusal } {
  const path = join(root, LOCK_FILE);
  const existing = readLock(path);
  switch (existing.kind) {
    case "held":
      if (isProcessAlive(existing.holder.pid)) return { ok: false, refusal: { reason: "already-running", holder: existing.holder } };
      break;
    case "unreadable":
      return { ok: false, refusal: { reason: "lock-unreadable", detail: existing.detail } };
    case "absent":
      break;
    default: {
      const never: never = existing;
      throw new Error(String(never));
    }
  }

  const holder: LockHolder = {
    pid: process.pid,
    instanceId: randomUUID(),
    hostname: hostname(),
    startedAt: now().toISOString(),
  };
  writeAtomically(path, root, `${JSON.stringify(holder)}\n`);

  const after = readLock(path);
  if (after.kind !== "held" || after.holder.instanceId !== holder.instanceId) {
    return { ok: false, refusal: { reason: "lost-the-race", holder: after.kind === "held" ? after.holder : null } };
  }
  return { ok: true, holder };
}

/**
 * Which sessions the log says are there.
 *
 * **This is what makes the checkpoint disposable**, and the reason it is
 * exported: the register is a fold of the events, so `current.json` is an
 * optimisation rather than the only copy. Greg's ceiling — *"no state that only
 * this process knows how to reconstruct"* — is a property of this function
 * existing, not of a promise in a doc.
 *
 * `tmux-session-gone` REMOVES rather than marking closed, so the register is
 * always "what is there now". The history of what left is the log's job.
 */
export function foldEvents(
  events: readonly OverseerEvent[],
  into: Map<SessionKey, RegisterEntry>,
): Map<SessionKey, RegisterEntry> {
  for (const event of events) {
    switch (event.kind) {
      case "session-seen":
        into.set(event.key, entryOf(event.row, event.at, event.tmuxServerPid, statusKey(event.row.status)));
        break;
      case "session-replaced":
        // BOTH HALVES. The old identity is retired here rather than by a
        // `tmux-session-gone` that never comes: the tmux session did not go
        // anywhere, only the conversation in it changed.
        into.delete(event.previousKey);
        into.set(event.key, entryOf(event.row, event.at, event.tmuxServerPid, statusKey(event.row.status)));
        break;
      case "tmux-session-gone":
        into.delete(event.key);
        break;
      case "session-status": {
        // A status for a session the register has never seen is DROPPED rather
        // than invented into an entry: half a row is not a session, and the
        // fields a reboot needs are only on `session-seen`.
        const was = into.get(event.key);
        if (was !== undefined) {
          into.set(event.key, { ...was, lastSeenAlive: event.at, lastStatusKey: event.to, statusSince: event.at });
        }
        break;
      }
      case "session-wait-restarted": {
        // The state is unchanged and the CLOCK is not: a wait that restarted is
        // a new wait, so a triage view ranking by "waiting longest" must start
        // again here rather than report an hour that ended.
        const was = into.get(event.key);
        if (was !== undefined) into.set(event.key, { ...was, lastSeenAlive: event.at, statusSince: event.at });
        break;
      }
      default: {
        const never: never = event;
        throw new Error(`no fold for event ${JSON.stringify(never)}`);
      }
    }
  }
  return into;
}

function entryOf(row: ObservedRow, at: string, tmuxServerPid: number | null, key: StatusKey): RegisterEntry {
  return {
    key: keyFor(row.id, row.claimedConversationId) as SessionKey,
    tmuxId: row.id,
    claimedConversationId: row.claimedConversationId,
    name: row.name,
    meta: row.meta,
    repo: row.repo,
    worktree: row.worktree,
    startedAt: row.startedAt,
    paneId: row.paneId,
    panePid: row.panePid,
    tmuxServerPid,
    lastSeenAlive: at,
    lastStatusKey: key,
    statusSince: at,
  };
}

export function describeOpening(opening: StoreOpening): string {
  const repair = opening.repair.torn
    ? ` A torn final line of ${opening.repair.droppedBytes} bytes was truncated.`
    : "";
  const unreadable = opening.unreadableLines > 0 ? ` ${opening.unreadableLines} log lines were unreadable.` : "";
  switch (opening.start.kind) {
    case "cold":
      return `Started COLD (${opening.start.why}): no baseline and no history, so the next snapshot will look like the whole fleet starting at once.${repair}${unreadable}`;
    case "rebuilt":
      return `Rebuilt the register from the event log (${opening.start.why}): ${opening.eventsReplayed} events replayed.${repair}${unreadable}`;
    case "resumed":
      return `Resumed from a checkpoint written ${opening.start.checkpointWrittenAt}, ${opening.eventsReplayed} events replayed past its cursor.${repair}${unreadable}`;
    default: {
      const never: never = opening.start;
      throw new Error(String(never));
    }
  }
}

export function describeRefusal(refusal: StoreRefusal): string {
  switch (refusal.reason) {
    case "already-running":
      return `An Overseer is already running (pid ${refusal.holder.pid} on ${refusal.holder.hostname}, since ${refusal.holder.startedAt}). Refusing to start a second one.`;
    case "lock-unreadable":
      return `${LOCK_FILE} exists and names nobody (${refusal.detail}), so this cannot prove no Overseer is running. Check, then remove ${LOCK_FILE}.`;
    case "lost-the-race":
      return `Another Overseer took ${LOCK_FILE} at the same moment${refusal.holder === null ? "" : ` (pid ${refusal.holder.pid})`}. Refusing to run beside it.`;
    case "unusable-directory":
      return `The store directory is unusable: ${refusal.detail}`;
    default: {
      const never: never = refusal;
      throw new Error(String(never));
    }
  }
}

/** Every event kind, as a total map so a new arm in diff.ts fails to compile here rather than parsing as junk. */
const EVENT_KINDS: Record<OverseerEvent["kind"], true> = {
  "session-seen": true,
  "session-status": true,
  "tmux-session-gone": true,
  "session-replaced": true,
  "session-wait-restarted": true,
};

/**
 * A shallow check, and the shallowness is deliberate.
 *
 * **This is not a trust boundary** — the daemon wrote these bytes itself, and
 * the failure being defended against is a truncation or a disk, not a hostile
 * writer. Validating a whole `ObservedRow` here would mean a second copy of
 * observation.ts's parser drifting from the first, which is a worse bug than
 * the one it would catch. What it does catch is the class that matters: a line
 * that is not an object, not JSON, or not one of the kinds this version knows.
 */
function looksLikeEvent(u: unknown): u is OverseerEvent {
  if (!isRecord(u)) return false;
  const kind = u["kind"];
  if (typeof kind !== "string" || !(kind in EVENT_KINDS)) return false;
  return typeof u["at"] === "string" && typeof u["key"] === "string" && isRecord(u["identity"]);
}

/**
 * `fromByte` must be a LINE BOUNDARY, and every cursor this module hands out is
 * one: `nextByte` is the file's size and a checkpoint's `cursor.bytes` is the
 * size at the moment it was written, both taken after a newline-terminated
 * append. A byte in the middle of a line would make the first line read look
 * like garbage — reported as unreadable rather than silently dropped, but wrong
 * either way, so do not invent one.
 */
function parseEventLog(raw: Buffer, fromByte: number): ReadEvents {
  const slice = raw.subarray(Math.min(Math.max(fromByte, 0), raw.length)).toString("utf8");
  const events: OverseerEvent[] = [];
  const unreadable: { line: number; text: string }[] = [];
  for (const [index, text] of slice.split("\n").entries()) {
    if (text === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      unreadable.push({ line: index + 1, text });
      continue;
    }
    if (!looksLikeEvent(parsed)) {
      unreadable.push({ line: index + 1, text });
      continue;
    }
    events.push(parsed);
  }
  return { events, unreadable, nextByte: raw.length };
}

class Store implements OverseerStore {
  readonly root: string;
  readonly instanceId: string;
  readonly opening: StoreOpening;
  private readonly registerMap: Map<SessionKey, RegisterEntry>;
  private readonly holder: LockHolder;
  private readonly nowFn: () => Date;
  private readonly fd: number;
  private bytes: number;
  private events: number;
  /** THIS INSTANCE'S ticks, reset by a restart on purpose: a counter that survives one cannot tell a day of smooth running from two hundred restarts. `instanceId` and `startedAt` beside it say which instance is counting. */
  private ticks = 0;
  private lastTickAt: string | null = null;
  private closed = false;

  constructor(input: {
    root: string;
    holder: LockHolder;
    now: () => Date;
    opening: StoreOpening;
    register: Map<SessionKey, RegisterEntry>;
    fd: number;
    bytes: number;
    events: number;
  }) {
    this.root = input.root;
    this.holder = input.holder;
    this.instanceId = input.holder.instanceId;
    this.nowFn = input.now;
    this.opening = input.opening;
    this.registerMap = input.register;
    this.fd = input.fd;
    this.bytes = input.bytes;
    this.events = input.events;
  }

  get register(): SessionRegister {
    return this.registerMap;
  }

  /**
   * Whether this process still holds the lock, asked of the file rather than
   * remembered.
   *
   * Checked before EVERY write, which is once a tick and costs a 150-byte read.
   * It is the backstop for the one window `acquireLock` cannot close by itself,
   * and it turns "two daemons writing forever" into "the loser stops at its
   * next tick and says why".
   */
  private ownership(): { ours: true } | { ours: false; holder: LockHolder | null } {
    const read = readLock(join(this.root, LOCK_FILE));
    if (read.kind === "held" && read.holder.instanceId === this.holder.instanceId) return { ours: true };
    return { ours: false, holder: read.kind === "held" ? read.holder : null };
  }

  private assertOpen(): void {
    // A THROW, not a result: a closed store is a mistake in the caller, where a
    // lost lock is a fact about the box.
    if (this.closed) throw new Error("this Overseer store is closed");
  }

  append(events: readonly OverseerEvent[]): AppendResult {
    this.assertOpen();
    const owned = this.ownership();
    if (!owned.ours) return { ok: false, reason: "lock-lost", holder: owned.holder };
    if (events.length > 0) {
      // ONE WRITE for the whole batch: the fd is `O_APPEND`, so a single write
      // lands at the end whatever else is happening, and a batch split into one
      // write per event is a batch that can be interrupted half way through.
      writeAll(this.fd, events.map((event) => `${JSON.stringify(event)}\n`).join(""));
      fsyncSync(this.fd);
      // MEASURED, not accumulated. The file's real size is the cursor; a
      // running total is a second copy of it that can be wrong without saying
      // so, and the checkpoint's whole job is to be right about this number.
      this.bytes = fstatSync(this.fd).size;
      this.events += events.length;
      foldEvents(events, this.registerMap);
    }
    return { ok: true, appended: events.length, cursor: { events: this.events, bytes: this.bytes } };
  }

  checkpoint(update: CheckpointUpdate): CheckpointResult {
    this.assertOpen();
    const owned = this.ownership();
    if (!owned.ours) return { ok: false, reason: "lock-lost", holder: owned.holder };
    const at = this.nowFn().toISOString();
    if (update.tick) {
      this.ticks += 1;
      this.lastTickAt = at;
    }
    const checkpoint: Checkpoint = {
      schema: STORE_SCHEMA,
      writtenAt: at,
      lastGoodSnapshotAt: update.lastGoodSnapshotAt,
      cursor: { events: this.events, bytes: this.bytes },
      heartbeat: {
        pid: this.holder.pid,
        instanceId: this.holder.instanceId,
        startedAt: this.holder.startedAt,
        lastTickAt: this.lastTickAt,
        ticks: this.ticks,
      },
      // The register is taken from the fold rather than from the caller, so a
      // caller cannot hand in a register that disagrees with the log.
      register: [...this.registerMap.values()],
    };
    writeAtomically(join(this.root, CHECKPOINT_FILE), this.root, `${JSON.stringify(checkpoint, null, 2)}\n`);
    return { ok: true, checkpoint };
  }

  readEvents(fromByte = 0): ReadEvents {
    const path = join(this.root, EVENTS_FILE);
    return parseEventLog(existsSync(path) ? readFileSync(path) : Buffer.alloc(0), fromByte);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    closeSync(this.fd);
    // Only OUR lock is released. If somebody has taken it in the meantime,
    // removing it would hand the box to a third daemon.
    if (this.ownership().ours) {
      try {
        unlinkSync(join(this.root, LOCK_FILE));
      } catch {
        /* Gone already, which is the state we wanted. */
      }
    }
  }
}

/**
 * Open the store, taking the lock, repairing the log and rebuilding the
 * register — in that order, because each step needs the one before it.
 *
 * Everything after `acquireLock` is inside a `try` that releases the lock: a
 * throw between taking it and returning a store would otherwise leave a lock
 * with a live pid on it, held by a process that has forgotten it exists, and
 * that is the deadlock this whole area is supposed to be immune to.
 */
export function openStore(options: OpenStoreOptions = {}): OpenStoreResult {
  const now = options.now ?? (() => new Date());
  const root = options.root ?? storeRoot(options.env ?? process.env);
  const hadDirectory = existsSync(root);
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 });
  } catch (cause) {
    return { ok: false, refusal: { reason: "unusable-directory", detail: String(cause) } };
  }

  const lock = acquireLock(root, now);
  if (!lock.ok) return { ok: false, refusal: lock.refusal };

  try {
    const eventsPath = join(root, EVENTS_FILE);
    // BEFORE the append handle is opened, so nothing can land after the torn
    // bytes. This is the whole of design call 1.
    const repair = repairEventLog(eventsPath);
    const fd = openSync(eventsPath, "a");
    const size = fstatSync(fd).size;
    const raw = readFileSync(eventsPath);
    const whole = parseEventLog(raw, 0);

    const read = readCheckpoint(root);
    const register = new Map<SessionKey, RegisterEntry>();
    let start: StoreStart;
    let replayed: number;
    let events: number;

    // A cursor past the end of the log is a checkpoint describing a file that
    // has since shrunk — a truncation, a hand-edit, a restored backup. It is
    // not resumable and it is not half-resumable: rebuild.
    if (read.kind === "checkpoint" && read.checkpoint.cursor.bytes <= size) {
      for (const entry of read.checkpoint.register) register.set(entry.key, entry);
      const tail = parseEventLog(raw, read.checkpoint.cursor.bytes);
      foldEvents(tail.events, register);
      replayed = tail.events.length;
      events = read.checkpoint.cursor.events + replayed;
      start = {
        kind: "resumed",
        checkpointWrittenAt: read.checkpoint.writtenAt,
        lastGoodSnapshotAt: read.checkpoint.lastGoodSnapshotAt,
      };
    } else {
      const why: ColdReason = !hadDirectory
        ? "no-store-directory"
        : read.kind === "absent"
          ? "no-checkpoint"
          : read.kind === "unusable"
            ? read.why
            : "checkpoint-malformed";
      foldEvents(whole.events, register);
      replayed = whole.events.length;
      events = whole.events.length;
      // COLD means there was nothing to rebuild FROM, not merely that the
      // checkpoint was missing: a daemon that replayed a thousand events has a
      // baseline and should not announce itself as having none.
      start = replayed > 0 ? { kind: "rebuilt", why } : { kind: "cold", why };
    }

    const opening: StoreOpening = {
      start,
      repair,
      eventsReplayed: replayed,
      unreadableLines: whole.unreadable.length,
    };
    return {
      ok: true,
      store: new Store({ root, holder: lock.holder, now, opening, register, fd, bytes: size, events }),
    };
  } catch (cause) {
    try {
      unlinkSync(join(root, LOCK_FILE));
    } catch {
      /* Nothing better to do, and the throw below is the news. */
    }
    throw cause;
  }
}
