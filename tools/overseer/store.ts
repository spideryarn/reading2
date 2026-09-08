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
 * `~/.overseer/`, overridable with `OVERSEER_STORE_DIR` — **and the override
 * must be absolute.** Every agent works in its own worktree and removes it when
 * the job is done, and `data/` is gitignored, so a clean `git status` says
 * "safe to delete" over the top of a store kept in the tree. A *relative*
 * override is the same hazard wearing a config file: systemd starting from the
 * primary checkout and a person starting from a worktree would resolve
 * `.overseer` to two directories, take two locks, and write two separate
 * plausible histories. GPT Sol's S3-07, and the same argument `meta.dir`
 * already makes one level down.
 *
 * ## Four refusals, and each is about a plausible history rather than a crash
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
 * **3. One writer, enforced by the KERNEL.** Two daemons — a botched restart,
 * or a manual start beside a systemd one — both append the same transitions and
 * both overwrite the checkpoint, and the result reads as a perfectly ordinary
 * afternoon that never happened. `O_APPEND` protects the write position and
 * nothing else. The lock is `open(O_CREAT|O_EXCL)`, which either creates the
 * file or fails, in one syscall. **An earlier version wrote its record and read
 * it back to see whether it had won, and that is not exclusion** — it catches
 * only contenders that wrote before the read, so two daemons could each read
 * themselves back and both proceed. GPT Sol's F4 and S3-01.
 *
 * **4. A replay stops at the first hole rather than folding across it.** A log
 * holding `session-seen(A)`, an unreadable line that used to be
 * `tmux-session-gone(A)`, and `session-seen(B)` folds into a register saying A
 * and B are both live. That register is well-formed, plausible, and wrong about
 * which agents are running, and `unreadableLines: 1` in a log line does not
 * make it true. This file is not a hostile-user boundary — we wrote the bytes —
 * but it IS a persistence, version and corruption boundary, so every line in
 * the range being replayed is validated per kind, and one failure means a cold
 * start. GPT Sol's S3-02.
 *
 * ## And one permission: the store is DISPOSABLE
 *
 * Greg's ceiling on this work is *"no state that only this process knows how to
 * reconstruct"*, and the fallback for the whole system is ssh and a terminal.
 * So a missing, empty, truncated or holed `~/.overseer/` starts **cold** — no
 * baseline, no history, and it says so — and never refuses to run, never
 * crashes, and never needs a repair step. `foldEvents` is what makes that true
 * rather than aspirational: the register is a fold of the log, so
 * `current.json` is an optimisation and losing it costs a replay. Losing the
 * log costs history and nothing else.
 *
 * **Cold is the fallback that pays for the strictness above.** Every refusal in
 * this file is affordable precisely because the thing on the other side of it
 * is a working daemon with no memory, rather than a daemon that will not start.
 *
 * The one thing that DOES refuse to start is a lock this process cannot prove
 * is stale, because there the choice is between "correct and unavailable" and
 * "plausible and up", and being down is one ssh command away from recoverable.
 *
 * ## JSONL, and when to stop
 *
 * One file, no rotation, no dependency. **A restart reads only the bytes past
 * the checkpoint's cursor**, and `opening.bytesScanned` says how many that was:
 * a recovery mechanism that has to read a gigabyte before it can recover is
 * what stops the recovery, and this box has hit load 391 with the OOM killer
 * firing. A range too large to replay is a cold start rather than an attempt.
 *
 * **What forces SQLite**, named so nobody re-opens the question: a read that
 * has to scan history to answer a page load, indexed historical queries,
 * transactional multi-record state, concurrent writers, or retention becoming
 * awkward. Refusing concurrent writers is preferable to adopting SQLite in
 * order to tolerate them.
 */
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import type { AttentionItem, AttentionList } from "../fleet/wire.js";
import { parseAnswerability } from "./attention-memory.js";
import type { SessionKind, SessionMeta } from "../../scripts/gjd-remote-tmux.js";
import {
  REGISTER_ROW_FIELDS,
  statusKey,
  type OverseerEvent,
  type RegisterRowField,
  type SessionIdentity,
  type SessionKey,
  type StatusKey,
} from "./diff.js";
import { truncateToLastLine, writeAll, writeAtomically, type JsonlRepair } from "./jsonl.js";
import {
  isProcessAlive,
  readLock,
  releaseLock,
  stillOurs,
  takeLock,
  type HeldLock,
  type LockHolder,
  type LockRefusal,
} from "./lock.js";
import type { ObservedRow, ParseResult } from "./observation.js";

/**
 * Re-exported because this file was where they lived until 2026-09-08, and a
 * moved symbol that also disappears from its old home costs every caller a
 * change for no reason. The lock itself is [`lock.ts`](./lock.js) now — a leaf,
 * so the fleet dashboard's health retention can hold the same discipline
 * instead of writing a simpler third copy of it.
 */
export { isProcessAlive, type LockHolder };

/**
 * The checkpoint's schema.
 *
 * Bumped when a reader that ignored the change would be WRONG rather than
 * merely poorer — the producer's own rule, adopted here so the two files use
 * one meaning of the word. Adding a field is not a bump; a version that changes
 * on every addition is one nobody checks.
 *
 * **2 (2026-09-08): `statusSince` became a `StatusSince` pair.** The rule above
 * decides this rather than taste. A consumer written against schema 1 does
 * `Date.parse(entry.statusSince)`, which on the new shape is `NaN`, and
 * `now - NaN` renders as a blank or a nonsense age rather than as an error —
 * the WRONG half of the rule, not the poorer half. The bump makes that consumer
 * say *I cannot read this*, which is what
 * docs/project/orchestrator-direction.md § The seam is a file tells it to do
 * with a schema it does not know.
 *
 * **Nothing is migrated.** An old checkpoint is refused, the log is replayed,
 * and the register comes back with honest arms — the log holds events rather
 * than durations, so a rebuild cannot inherit the ambiguity a migration would
 * have had to guess at.
 */
export const STORE_SCHEMA = 2;

export const EVENTS_FILE = "events.jsonl";
export const CHECKPOINT_FILE = "current.json";
export const LOCK_FILE = "overseer.lock";

/**
 * How many bytes of log a start is willing to replay before it gives up and
 * starts cold instead.
 *
 * 64 MiB is roughly a hundred thousand events, which is far more than a
 * checkpointing daemon should ever have in front of its cursor — so reaching it
 * means something else is wrong, and the useful response is to come up empty
 * rather than to allocate. Overridable per call so a test can use a number it
 * can write a file to exceed.
 */
const REPLAY_CEILING_BYTES = 64 * 1024 * 1024;

/**
 * Why the store would not open. Never a thrown string: a launcher has to print
 * a sentence saying what a person should do, and an exception gives it nothing
 * to print that is not also a stack trace.
 *
 * **Four of the five arms are `LockRefusal`'s**, declared once in
 * [`lock.ts`](./lock.js) rather than restated here — a superset by
 * construction, so `describeRefusal` below still has to be exhaustive and the
 * compiler still says so if the lock grows an arm.
 */
export type StoreRefusal = LockRefusal | { reason: "relative-store-dir"; path: string };

/** Why there was no checkpoint to resume from. Seven arms because seven different things go wrong. */
export type ColdReason =
  | "no-store-directory"
  | "no-checkpoint"
  | "checkpoint-empty"
  | "checkpoint-unreadable"
  | "checkpoint-malformed"
  | "log-has-holes"
  | "log-too-large-to-replay";

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
  repair: JsonlRepair;
  /** Events folded at open: the tail past the checkpoint's cursor, or the whole log for a rebuild. */
  eventsReplayed: number;
  /** Lines in the scanned range the reader could not use. One is enough to force a cold start. */
  unreadableLines: number;
  /**
   * How many bytes of the log this start had to read.
   *
   * Zero on an ordinary restart, because the cursor is at the end of the file.
   * It is here so that "the cursor saves work" is a number somebody can look
   * at rather than a claim in a comment — the version of this file GPT Sol
   * reviewed read the whole log every time and nothing said so.
   */
  bytesScanned: number;
};

/**
 * WHEN THE STATUS BEGAN — and whether that is a reading or a floor.
 *
 * **The bug this shape exists to make impossible.** `statusSince` used to be a
 * bare timestamp, taken from the `at` of whichever event created the entry, and
 * `overseer status` printed this the first time it was run against a real
 * store:
 *
 *     working  13m  fb2f-dock-always-visible-landscape
 *     working  13m  fb2g-gutter-icons-on-touch
 *     working  13m  get-ready-for-deploy
 *     working  13m  html-ingestion-post-processing-evals
 *
 * The daemon had been up for thirteen minutes. Those sessions had been working
 * for hours. For a session already running when the daemon starts, the event
 * that creates its entry is `session-seen` — **first observation, not the
 * transition** — so the number was the earliest moment we can prove rather than
 * the moment it began: two different quantities with the same units, and
 * nothing in the shape to tell them apart.
 *
 * **It is worst exactly when it matters.** `Restart=always` makes a restart
 * routine, and after one every session's duration resets to zero *together*, so
 * the agent genuinely blocked for three hours ranks equal-last with one blocked
 * for thirty seconds — on the surface whose whole job is that ranking.
 *
 * So: two arms, and the point is that this is not a better comment. A renderer
 * that reaches `.at` has had to walk past the `kind` to get there, and can at
 * worst choose to ignore it.
 *
 *  - `observed` — the state changed BETWEEN TWO OF OUR OBSERVATIONS, in a
 *    `session-status` or a `session-wait-restarted`. On a running daemon those
 *    two are one tick apart, so the age is a measurement: short by at most a
 *    tick, and never long.
 *  - `lower-bound` — the state was already in progress when we first saw it, so
 *    this says only *"in this state at least since"*. It has no upper bound at
 *    all: the true duration may be minutes or days.
 *
 * **One case where `observed` is looser than it sounds, named rather than
 * papered over** (GPT Sol, 2026-09-08, reviewing this change). After a restart
 * the daemon restores `last-snapshot.json` as its differ baseline and diffs the
 * first new snapshot against it, so *"between two of our observations"* brackets
 * the whole downtime rather than one tick. A wait that ended and restarted
 * during three hours of downtime is recorded as `observed` at the moment we came
 * back, and rendered as `0s`. It is the same class of error as the 13m bug and
 * it is bounded by the downtime rather than unbounded, which is why it is a
 * lesser one — but it is not zero.
 *
 * **It is not fixable here**, and that is the reason it is written down instead:
 * the fold cannot see it. Closing it means either the `session-status` event
 * carrying the PREVIOUS snapshot's `collectedAt`, so the arm can hold the whole
 * bracket, or the daemon marking the first diff after a restored baseline — and
 * both of those live in diff.ts and daemon.ts. Recorded in
 * docs/plans/260908b-overseer-store-and-clock.md § S7-04 for whoever takes that
 * stage; the dashboard should know before it builds on `observed`.
 *
 * The names are the READER'S rather than the producer's, because the seam is a
 * file: somebody running `less ~/.overseer/current.json` sees
 * `"kind": "lower-bound"` and knows what the number is worth without opening
 * this one.
 */
export type StatusSince =
  | { readonly kind: "observed"; readonly at: string }
  | { readonly kind: "lower-bound"; readonly at: string };

/**
 * One session, as the register holds it. **This is the reboot-resume
 * material**, and every field in it is here because it cannot be recovered
 * afterwards from anywhere else.
 *
 * Every field is `readonly`, and `meta` is copied on the way in. A
 * `ReadonlyMap` stops `set` and says nothing about the values inside it, so
 * without this a caller could edit an entry through `store.register.get(...)`
 * and the checkpoint would stop agreeing with the log it was folded from. GPT
 * Sol's S3-05.
 */
export type RegisterEntry = {
  readonly key: SessionKey;
  /** tmux's handle. Meaningless without `tmuxServerPid`, which is why both are here. */
  readonly tmuxId: string;
  /** A CLAIM, not a fact — see `ObservedRow.claimedConversationId`. What `--resume` would be given. */
  readonly claimedConversationId: string | null;
  readonly name: string;
  /** The launcher's metadata whole: `dir` is not reconstructible and `repo` is not derivable from `dir`. */
  readonly meta: Readonly<SessionMeta>;
  readonly repo: string | null;
  readonly worktree: string | null;
  readonly startedAt: string;
  readonly paneId: string | null;
  readonly panePid: number | null;
  readonly tmuxServerPid: number | null;
  /**
   * A FLOOR, NOT A READING, and the difference matters. Events are written when
   * something changes, so a session sitting idle for six hours emits nothing
   * and this stays where it was. It means "alive at least this recently".
   * Whether it is alive NOW is the checkpoint's `lastGoodSnapshotAt`: every
   * session in the register was in that snapshot, because a `tmux-session-gone`
   * would have removed it. Rendering this as "idle for N minutes" without the
   * snapshot clock is the mistake this comment exists to stop.
   */
  readonly lastSeenAlive: string;
  /** The canonical key, never the status object: `waiting.secondsLeft` changes every collection. */
  readonly lastStatusKey: StatusKey;
  /**
   * When it entered that state — the duration attention triage ranks by, and a
   * PAIR rather than a timestamp, because for a great many entries it is a
   * floor rather than a reading. `StatusSince` above has the four identical
   * `13m` rows that are the whole story.
   */
  readonly statusSince: StatusSince;
};

/**
 * WHAT IS RUNNING — and deliberately not a snapshot.
 *
 * The tempting move, which a cross-family review proposed and which is wrong:
 * rebuild a differ baseline out of this after a restart. It cannot be done
 * honestly. We keep `lastStatusKey` rather than the status, and have never
 * held `title` or `question`, so anything minted here would carry an invented
 * `collectedAt` for a collection that never happened — plausible wrongness
 * manufactured by the recovery path, which is the one place it survives
 * longest.
 *
 * The register answers "what is running". A baseline answers "what did the
 * producer last say". Only the second is safe to re-derive, and only because
 * the daemon keeps the producer's own bytes and re-blesses them through
 * `parseObservation` + `admissible()` — a snapshot that passed the real gate,
 * not a reconstruction that resembles one.
 *
 * **The fields this drops are dropped on purpose.** That is what makes it safe,
 * so it is a property to preserve rather than a gap to close.
 */
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
  /** Where the fold below got to. `bytes` is the real cursor; `events` is a count for humans. */
  cursor: { events: number; bytes: number };
  /** So a reader can say *the Overseer is dead* rather than showing a stale register as current. */
  heartbeat: { pid: number; instanceId: string; startedAt: string; lastTickAt: string | null; ticks: number };
  register: readonly RegisterEntry[];
  /**
   * WHAT NEEDS GREG — the attention inbox, produced by `attention-pass.ts` and
   * rendered by the dashboard, which imports the type from `tools/fleet/wire.ts`
   * rather than re-declaring it.
   *
   * **NO SCHEMA BUMP, and the file's own rule is what decides it.** A reader that
   * ignored this field draws no inbox, which is POORER rather than WRONG — unlike
   * schema 2's `statusSince`, where a consumer written against schema 1 would
   * `Date.parse` a pair and render `NaN` as a blank age. Adding a field is not a
   * bump, and a version that changes on every addition is one nobody checks.
   *
   * **It carries its own clock**, and that is not redundant with `writtenAt`. The
   * pass costs model calls and does not run on every tick, so the list published
   * here can be older than the checkpoint around it: `scannedAt` says when it was
   * determined, `writtenAt` says when it was last written down, and only the
   * first can tell a calm fleet from a pass that stopped running.
   */
  attention: AttentionList;
};

/**
 * The list a checkpoint carries before any pass has run.
 *
 * `scannedAt` is the checkpoint's own instant, and `why` says so in as many
 * words, because the field's contract is *when we tried* and nothing tried. The
 * alternative — a `kind: "list"` with no items — would say *nothing needs Greg*,
 * which is a claim, and the most reassuring possible lie for a probe that has
 * never run.
 */
export function attentionNotYetRun(at: string): AttentionList {
  return {
    kind: "unknown",
    why:
      "no attention pass has run in this Overseer yet, so nothing has been looked at. This instant is " +
      "when the checkpoint was written, not when anything was scanned.",
    scannedAt: at,
  };
}

export type CheckpointUpdate = {
  lastGoodSnapshotAt: string | null;
  tick: boolean;
  /**
   * A new attention list, or omitted to keep the one the store already holds.
   *
   * Omitted is the normal case: the pass is paid for and runs less often than a
   * tick, so most writes carry no new list. Keeping the old one is right — the
   * questions have not gone away because we did not look — and honest, because
   * the list says when it was scanned.
   */
  attention?: AttentionList;
};

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

/** A line that did not survive the trip back, and why — a silent skip is how a log rots unnoticed. */
export type UnreadableLine = { line: number; text: string; reason: string };

export type ReadEvents = {
  events: readonly OverseerEvent[];
  /** `line` counts from the first line read, so it is absolute only when reading from byte 0. */
  unreadable: readonly UnreadableLine[];
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
  /** Bytes of log this start will replay before giving up and starting cold. Defaults to `REPLAY_CEILING_BYTES`. */
  replayCeilingBytes?: number;
  /**
   * A TEST SEAM, and the only one in this file.
   *
   * Called immediately before each attempt to create the lock, so a test can
   * produce the interleaving the whole lock design is about — a competitor
   * claiming between our look and our claim — which cannot otherwise be
   * produced from one process. Nothing in production passes it.
   */
  beforeClaim?: () => void;
};

export type OpenStoreResult = { ok: true; store: OverseerStore } | { ok: false; refusal: StoreRefusal };

/**
 * Where the store is.
 *
 * **Throws on a relative override**, rather than returning something a caller
 * would resolve against a cwd it does not control. This is configuration rather
 * than environment: an operator has written something that cannot mean what
 * they think it means, and there is no sensible value to carry on with.
 * `openStore` turns it into a refusal for the same reason everything else here
 * is one.
 */
export function storeRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env["OVERSEER_STORE_DIR"];
  if (override === undefined || override.trim() === "") return join(homedir(), ".overseer");
  const trimmed = override.trim();
  if (!isAbsolute(trimmed)) {
    throw new Error(
      `OVERSEER_STORE_DIR must be an absolute path; got ${JSON.stringify(override)}. ` +
        "A relative one resolves differently for systemd and for a person in a worktree, " +
        "which is two stores and two histories.",
    );
  }
  return trimmed;
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

function isTmuxHandle(u: unknown): u is string {
  return typeof u === "string" && /^\$\d+$/.test(u);
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
  if (typeof dir !== "string" || !isAbsolute(dir)) {
    return { ok: false, reason: `meta.dir ${JSON.stringify(dir)} is not an absolute path` };
  }
  return { ok: true, value: { version: 1, kind: kind as SessionKind, repo, dir } };
}

/**
 * A status, validated far enough that nothing downstream can throw on it.
 *
 * `statusKey` has a `never` default that THROWS on an arm it does not know, and
 * the day Claude Code reports `compacting` is the day a log line arrives
 * carrying one. A future status must cost a cold start at worst, never a
 * daemon that will not come up.
 *
 * **The `unknown` arm's pairing rule is enforced and its cause list is not.**
 * `reportedStatus` is required on `unrecognised-agent-status` and forbidden
 * everywhere else — the producer's own rule (GPT Sol's S2-04), and two
 * malformed rows would otherwise manufacture a status transition. The cause
 * STRING is only ever key material here, so re-enumerating the seven causes
 * would be a second copy of somebody else's list, drifting, for no gain.
 */
function parseStatus(u: unknown): ParseResult<ObservedRow["status"]> {
  if (!isRecord(u)) return { ok: false, reason: "status is not an object" };
  const kind = u["kind"];
  switch (kind) {
    case "needs-you":
    case "working":
    case "idle":
    case "no-claude":
      return { ok: true, value: { kind } };
    case "waiting": {
      const secondsLeft = u["secondsLeft"];
      if (!isNonNegativeInteger(secondsLeft)) return { ok: false, reason: "waiting.secondsLeft is not a count" };
      return { ok: true, value: { kind, secondsLeft } };
    }
    case "shell": {
      const busy = u["busy"];
      if (busy !== null && typeof busy !== "boolean") return { ok: false, reason: "shell.busy is not a boolean or null" };
      return { ok: true, value: { kind, busy } };
    }
    case "unknown": {
      const why = u["why"];
      const cause = u["cause"];
      const reportedStatus = u["reportedStatus"];
      if (typeof why !== "string") return { ok: false, reason: "unknown.why is not a string" };
      if (typeof cause !== "string" || cause === "") return { ok: false, reason: "unknown.cause is not a cause" };
      if (cause === "unrecognised-agent-status") {
        if (typeof reportedStatus !== "string") {
          return { ok: false, reason: "unrecognised-agent-status carries no reportedStatus" };
        }
        // The cast is the one place this file trusts a string it did not
        // enumerate; `cause` reaches nothing but `statusKey`'s interpolation.
        return { ok: true, value: { kind, why, cause, reportedStatus } as ObservedRow["status"] };
      }
      if (reportedStatus !== undefined) {
        return { ok: false, reason: `cause ${JSON.stringify(cause)} may not carry a reportedStatus` };
      }
      return { ok: true, value: { kind, why, cause } as ObservedRow["status"] };
    }
    default:
      return { ok: false, reason: `status kind ${JSON.stringify(kind)} is not one this version knows` };
  }
}

/**
 * A row, validated far enough to build a register entry from.
 *
 * Not a second copy of observation.ts's parser — that one is about a payload
 * arriving over the wire, this one is about bytes coming back off a disk we
 * wrote — but every field the register keeps is checked, because a
 * `session-seen` with no `row` at all used to pass a shallow check and then
 * throw inside the fold, taking the daemon down over a corrupt line. GPT Sol's
 * S3-02.
 */
function parseRow(u: unknown): ParseResult<ObservedRow> {
  if (!isRecord(u)) return { ok: false, reason: "row is not an object" };
  if (!isTmuxHandle(u["id"])) return { ok: false, reason: `row.id ${JSON.stringify(u["id"])} is not a tmux handle` };
  const name = u["name"];
  if (typeof name !== "string") return { ok: false, reason: "row.name is not a string" };
  const title = u["title"];
  if (!isNullableString(title)) return { ok: false, reason: "row.title is not a string or null" };
  const repo = u["repo"];
  if (!isNullableString(repo)) return { ok: false, reason: "row.repo is not a string or null" };
  const worktree = u["worktree"];
  if (!isNullableString(worktree)) return { ok: false, reason: "row.worktree is not a string or null" };
  const meta = parseMeta(u["meta"]);
  if (!meta.ok) return { ok: false, reason: `row.${meta.reason}` };
  const startedAt = u["startedAt"];
  if (!isIsoTimestamp(startedAt)) return { ok: false, reason: "row.startedAt is not an ISO timestamp" };
  const paneId = u["paneId"];
  if (!isNullableString(paneId)) return { ok: false, reason: "row.paneId is not a string or null" };
  const panePid = u["panePid"];
  if (panePid !== null && !isPidLike(panePid)) return { ok: false, reason: "row.panePid is not a pid or null" };
  const claimed = u["claimedConversationId"];
  if (!isNullableString(claimed)) return { ok: false, reason: "row.claimedConversationId is not a string or null" };
  const status = parseStatus(u["status"]);
  if (!status.ok) return { ok: false, reason: `row.${status.reason}` };
  return {
    ok: true,
    value: {
      id: u["id"],
      name,
      title,
      repo,
      worktree,
      meta: meta.value,
      startedAt,
      paneId,
      panePid,
      claimedConversationId: claimed,
      // Volatile prose, kept verbatim and interpreted nowhere — so anything
      // that survived JSON is acceptable, which is what the wire says too.
      question: (u["question"] ?? null) as ObservedRow["question"],
      status: status.value,
    },
  };
}

function parseIdentity(u: unknown): ParseResult<SessionIdentity> {
  if (!isRecord(u)) return { ok: false, reason: "identity is not an object" };
  if (!isTmuxHandle(u["tmuxId"])) return { ok: false, reason: "identity.tmuxId is not a tmux handle" };
  const claimed = u["claimedConversationId"];
  if (!isNullableString(claimed)) return { ok: false, reason: "identity.claimedConversationId is not a string or null" };
  return { ok: true, value: { tmuxId: u["tmuxId"], claimedConversationId: claimed } };
}

/** Every event kind, as a total map so a new arm in diff.ts fails to compile here rather than parsing as junk. */
const EVENT_KINDS: Record<OverseerEvent["kind"], true> = {
  "session-seen": true,
  "session-status": true,
  "tmux-session-gone": true,
  "session-replaced": true,
  "session-wait-restarted": true,
  "session-row-changed": true,
  "session-pane-replaced": true,
};

/** The watched row fields, as a set, so a `fields` list read off the disk can be checked against it. */
const ROW_FIELDS = new Set<string>(REGISTER_ROW_FIELDS);

const GONE_REASONS = new Set(["absent-from-snapshot", "tmux-server-changed"]);

/**
 * One event off the disk, validated per kind.
 *
 * The shallow version of this — kind, `at`, `key`, and a cast — was the right
 * shape for a hostile-input argument and the wrong shape for the argument that
 * applies: this is a **persistence and corruption boundary**, so an event that
 * is only half understood must not reach a fold that will turn it into a
 * register somebody acts on. Everything the fold reads is checked here, and
 * nothing else is.
 */
function parseEvent(u: unknown): ParseResult<OverseerEvent> {
  if (!isRecord(u)) return { ok: false, reason: "not an object" };
  const kind = u["kind"];
  if (typeof kind !== "string" || !(kind in EVENT_KINDS)) {
    return { ok: false, reason: `kind ${JSON.stringify(kind)} is not an event this version knows` };
  }
  const at = u["at"];
  if (!isIsoTimestamp(at)) return { ok: false, reason: "at is not an ISO timestamp" };
  const key = u["key"];
  if (typeof key !== "string" || key === "") return { ok: false, reason: "key is not a session key" };
  const identity = parseIdentity(u["identity"]);
  if (!identity.ok) return { ok: false, reason: identity.reason };
  const tmuxServerPid = u["tmuxServerPid"];
  if (tmuxServerPid !== null && !isPidLike(tmuxServerPid)) {
    return { ok: false, reason: "tmuxServerPid is not a pid or null" };
  }
  const common = { at, key: key as SessionKey, identity: identity.value, tmuxServerPid };

  switch (kind as OverseerEvent["kind"]) {
    case "session-seen": {
      const row = parseRow(u["row"]);
      if (!row.ok) return { ok: false, reason: row.reason };
      return { ok: true, value: { kind: "session-seen", ...common, row: row.value } };
    }
    case "session-replaced": {
      const row = parseRow(u["row"]);
      if (!row.ok) return { ok: false, reason: row.reason };
      const previous = parseIdentity(u["previous"]);
      if (!previous.ok) return { ok: false, reason: `previous ${previous.reason}` };
      const previousKey = u["previousKey"];
      if (typeof previousKey !== "string" || previousKey === "") {
        return { ok: false, reason: "previousKey is not a session key" };
      }
      return {
        ok: true,
        value: {
          kind: "session-replaced",
          ...common,
          row: row.value,
          previous: previous.value,
          previousKey: previousKey as SessionKey,
        },
      };
    }
    case "session-status": {
      const from = u["from"];
      const to = u["to"];
      if (typeof from !== "string" || from === "") return { ok: false, reason: "from is not a status key" };
      if (typeof to !== "string" || to === "") return { ok: false, reason: "to is not a status key" };
      const status = parseStatus(u["status"]);
      if (!status.ok) return { ok: false, reason: status.reason };
      return {
        ok: true,
        value: {
          kind: "session-status",
          ...common,
          from: from as StatusKey,
          to: to as StatusKey,
          status: status.value,
        },
      };
    }
    case "tmux-session-gone": {
      const name = u["name"];
      const why = u["why"];
      if (typeof name !== "string") return { ok: false, reason: "name is not a string" };
      if (typeof why !== "string" || !GONE_REASONS.has(why)) {
        return { ok: false, reason: `why ${JSON.stringify(why)} is not a gone reason` };
      }
      return {
        ok: true,
        value: { kind: "tmux-session-gone", ...common, name, why: why as "absent-from-snapshot" },
      };
    }
    case "session-row-changed": {
      const row = parseRow(u["row"]);
      if (!row.ok) return { ok: false, reason: row.reason };
      const fields = u["fields"];
      // NON-EMPTY, because an empty one is a change that did not happen — the
      // differ never writes it, so a file that has one has been edited or
      // written by something that is not this module.
      if (!Array.isArray(fields) || fields.length === 0) {
        return { ok: false, reason: "fields is not a non-empty array" };
      }
      for (const field of fields) {
        if (typeof field !== "string" || !ROW_FIELDS.has(field)) {
          return { ok: false, reason: `fields contains ${JSON.stringify(field)}, which is not a watched row field` };
        }
      }
      return {
        ok: true,
        value: {
          kind: "session-row-changed",
          ...common,
          fields: fields as RegisterRowField[],
          row: row.value,
        },
      };
    }
    case "session-pane-replaced": {
      const previousPaneId = u["previousPaneId"];
      const previousPanePid = u["previousPanePid"];
      const paneId = u["paneId"];
      const panePid = u["panePid"];
      if (!isNullableString(previousPaneId)) return { ok: false, reason: "previousPaneId is not a string or null" };
      if (previousPanePid !== null && !isPidLike(previousPanePid)) {
        return { ok: false, reason: "previousPanePid is not a pid or null" };
      }
      if (!isNullableString(paneId)) return { ok: false, reason: "paneId is not a string or null" };
      // NOT NULLABLE, and this is the arm's whole rule on disk as well as in
      // memory: a pid that went away is a pane listing that could not be joined,
      // and the differ never turns one into this event.
      if (!isPidLike(panePid)) return { ok: false, reason: "panePid is not a pid" };
      return {
        ok: true,
        value: { kind: "session-pane-replaced", ...common, previousPaneId, previousPanePid, paneId, panePid },
      };
    }
    case "session-wait-restarted": {
      const previousDeadline = u["previousDeadline"];
      const deadline = u["deadline"];
      if (!isIsoTimestamp(previousDeadline)) return { ok: false, reason: "previousDeadline is not an ISO timestamp" };
      if (!isIsoTimestamp(deadline)) return { ok: false, reason: "deadline is not an ISO timestamp" };
      const status = parseStatus(u["status"]);
      if (!status.ok) return { ok: false, reason: status.reason };
      return {
        ok: true,
        value: {
          kind: "session-wait-restarted",
          ...common,
          previousDeadline,
          deadline,
          status: status.value,
        },
      };
    }
    default: {
      const never: never = kind as never;
      return { ok: false, reason: `no parser for ${String(never)}` };
    }
  }
}

/**
 * `statusSince`, parsed — **and a bare string is refused rather than adopted.**
 *
 * Every `current.json` written before 2026-09-08 has a bare timestamp here, so
 * this is a real input rather than a hypothetical. Accepting one would have to
 * decide which arm it is, and there is no honest answer: the two quantities are
 * indistinguishable in the old shape, and the reading that looks best —
 * `"observed"` — is the one that manufactures the 13m bug inside the recovery
 * path, which is where a wrong number survives longest and is questioned least.
 *
 * Refusing costs a replay of the log, which is cheap and produces the honest
 * arms. `STORE_SCHEMA` means the refusal normally happens one level up, at the
 * schema check; this is the same decision for the file somebody has edited by
 * hand, and it names the field so the person reading `overseer status` after a
 * cold start knows which shape change did it.
 */
function parseStatusSince(u: unknown): ParseResult<StatusSince> {
  if (typeof u === "string") {
    return {
      ok: false,
      reason:
        "statusSince is a bare timestamp, which is the pre-schema-2 shape: it cannot say whether " +
        "the daemon watched the transition or merely found the session already in that state. " +
        "Replaying the log rebuilds it.",
    };
  }
  if (!isRecord(u)) return { ok: false, reason: "statusSince is not an object" };
  const at = u["at"];
  if (!isIsoTimestamp(at)) return { ok: false, reason: "statusSince.at is not an ISO timestamp" };
  const kind = u["kind"];
  if (kind !== "observed" && kind !== "lower-bound") {
    return { ok: false, reason: `statusSince.kind ${JSON.stringify(kind)} is neither observed nor lower-bound` };
  }
  return { ok: true, value: { kind, at } };
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
  if (!isTmuxHandle(tmuxId)) {
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
  const statusSince = parseStatusSince(u["statusSince"]);
  if (!statusSince.ok) return { ok: false, reason: statusSince.reason };
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
      statusSince: statusSince.value,
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
      attention: parseAttentionList(u["attention"], writtenAt),
    },
  };
}

/**
 * Read the attention list back, **degrading rather than failing the checkpoint**.
 *
 * The opposite decision from the register above, and the difference is whether
 * there is a second copy. The register is the thing there is none of — losing an
 * entry silently turns a fleet of thirty-six into thirty-five — so a bad entry
 * fails the whole checkpoint and the log is replayed. The attention list is
 * regenerated by the next pass at the cost of a few model calls, so a malformed
 * one that forced a full replay would be paying the expensive remedy for the
 * cheap problem.
 *
 * **What it must not do is come back as an empty list.** Absent, malformed and
 * *nothing needs you* are three different facts, and the third is a claim. So
 * every failure lands in the `unknown` arm carrying the reason, which is what
 * the dashboard renders as "could not tell" rather than as a calm fleet.
 *
 * **EXHAUSTIVE, and it used not to be.** GPT Sol's finding 3: the first version
 * checked the evidence discriminant, two ids and a timestamp, and then cast the
 * rest. `{"id":"x","sessionId":"$1","waitingSince":"…","evidence":{"kind":
 * "dialog"}}` was written into a real checkpoint, came back as a valid
 * `kind:"list"`, and `inboxLines()` threw on the missing `duplicates`. A dialog
 * arm with no question and no options also crossed the evidence boundary — the
 * one boundary this whole design is built to hold. So every field and every
 * union arm is parsed, and the first mismatch degrades the whole list.
 */
function parseAttentionList(u: unknown, writtenAt: string): AttentionList {
  if (u === undefined) {
    return {
      kind: "unknown",
      why: "this checkpoint carries no attention list: it was written before the Overseer had one.",
      scannedAt: writtenAt,
    };
  }
  const bad = (why: string): AttentionList => ({ kind: "unknown", why: `the stored list was unusable: ${why}`, scannedAt: writtenAt });
  if (!isRecord(u)) return bad("it is not an object");
  const scannedAt = u["scannedAt"];
  if (!isIsoTimestamp(scannedAt)) return bad("scannedAt is not an ISO timestamp");
  if (u["kind"] === "unknown") {
    return typeof u["why"] === "string"
      ? { kind: "unknown", why: u["why"], scannedAt }
      : bad("an unknown list with no reason");
  }
  if (u["kind"] !== "list") return bad(`kind ${JSON.stringify(u["kind"])} is neither "list" nor "unknown"`);
  if (!isNonNegativeInteger(u["sessionsScanned"])) return bad("sessionsScanned is not a count");
  // Absent on a list written before the field existed. Read as 0 rather than
  // refused: the field says how much we FAILED to judge, and a producer that
  // never had it made no claim either way — refusing the whole list over it would
  // pay the expensive remedy for the cheap problem, which is this parser's rule.
  const unreadable = u["sessionsUnreadable"];
  if (unreadable !== undefined && !isNonNegativeInteger(unreadable)) return bad("sessionsUnreadable is not a count");
  const rawItems = u["items"];
  if (!Array.isArray(rawItems)) return bad("items is not an array");
  const items: AttentionItem[] = [];
  for (const raw of rawItems) {
    const item = parseAttentionItem(raw);
    if (item === null) return bad("an item is not one this build can read");
    items.push(item);
  }
  return {
    kind: "list",
    items,
    sessionsScanned: u["sessionsScanned"],
    sessionsUnreadable: typeof unreadable === "number" ? unreadable : 0,
    scannedAt,
  };
}

const ATTENTION_KINDS: readonly string[] = ["irreversible", "product", "technical", "other"];

/** Every field, every arm. `null` on the first mismatch — see `parseAttentionList`. */
function parseAttentionItem(u: unknown): AttentionItem | null {
  if (!isRecord(u)) return null;
  const id = u["id"];
  const sessionId = u["sessionId"];
  const sessionName = u["sessionName"];
  const kind = u["kind"];
  if (typeof id !== "string" || typeof sessionId !== "string" || typeof sessionName !== "string") return null;
  if (typeof kind !== "string" || !ATTENTION_KINDS.includes(kind)) return null;
  const waitingSince = u["waitingSince"];
  if (!isIsoTimestamp(waitingSince)) return null;
  const evidence = parseAttentionEvidence(u["evidence"]);
  if (evidence === null) return null;
  const answerability = parseAnswerability(u["answerability"]);
  if (answerability === null) return null;
  const rawDuplicates = u["duplicates"];
  if (!Array.isArray(rawDuplicates)) return null;
  const duplicates: { sessionId: string; sessionName: string; waitingSince: string }[] = [];
  for (const d of rawDuplicates) {
    if (!isRecord(d)) return null;
    if (typeof d["sessionId"] !== "string" || typeof d["sessionName"] !== "string") return null;
    if (!isIsoTimestamp(d["waitingSince"])) return null;
    duplicates.push({ sessionId: d["sessionId"], sessionName: d["sessionName"], waitingSince: d["waitingSince"] });
  }
  return {
    id,
    sessionId,
    sessionName,
    waitingSince,
    kind: kind as AttentionItem["kind"],
    evidence,
    answerability,
    duplicates,
  };
}

/**
 * The evidence union, both arms in full.
 *
 * **This is the boundary the whole design is built to hold**, so a `dialog` with
 * no question and no options must not cross it: it would arrive at a renderer as
 * something observed and enumerable, and that is the arm that gets the easy
 * affordance.
 */
function parseAttentionEvidence(u: unknown): AttentionItem["evidence"] | null {
  if (!isRecord(u)) return null;
  if (u["kind"] === "dialog") {
    const question = u["question"];
    const options = u["options"];
    if (typeof question !== "string" || !Array.isArray(options)) return null;
    if (!options.every((o) => typeof o === "string")) return null;
    return { kind: "dialog", question, options: options as string[] };
  }
  if (u["kind"] === "prose") {
    const excerpt = u["excerpt"];
    const why = u["why"];
    if (typeof excerpt !== "string" || typeof why !== "string") return null;
    return { kind: "prose", excerpt, why };
  }
  return null;
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
 * Read a file from a byte offset, and only from there.
 *
 * `readFileSync` then `subarray` allocates the whole file to hand back its
 * tail, which on a log this never rotates is the difference between a restart
 * and a restart loop. GPT Sol's S3-06.
 */
function readSlice(path: string, from: number): Buffer {
  if (!existsSync(path)) return Buffer.alloc(0);
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.min(Math.max(from, 0), size);
    const length = size - start;
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const got = readSync(fd, buffer, read, length - read, start + read);
      if (got <= 0) break;
      read += got;
    }
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
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
 *
 * **It must only ever be handed events that parsed**, whole: a fold that steps
 * over a hole produces a register rather than an error — see the module comment
 * and `openStore`, which refuses to call this across one.
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
          // OBSERVED: the differ produced this by comparing two collections it
          // made, so the transition happened between them and `at` is a
          // measurement rather than a floor. This arm and `entryOf` are the
          // only two producers of a `statusSince`, which is what keeps the
          // distinction to one line each.
          into.set(event.key, {
            ...was,
            lastSeenAlive: event.at,
            lastStatusKey: event.to,
            statusSince: { kind: "observed", at: event.at },
          });
        }
        break;
      }
      case "session-wait-restarted": {
        // The state is unchanged and the CLOCK is not: a wait that restarted is
        // a new wait, so a triage view ranking by "waiting longest" must start
        // again here rather than report an hour that ended.
        const was = into.get(event.key);
        // OBSERVED, for the same reason as `session-status` and worth checking
        // rather than assuming: diff.ts emits this only after comparing the
        // previous deadline with this one, so the daemon watched the wait
        // restart. A wait that restarted is a new wait, and the clock with it.
        if (was !== undefined) {
          into.set(event.key, { ...was, lastSeenAlive: event.at, statusSince: { kind: "observed", at: event.at } });
        }
        break;
      }
      case "session-row-changed": {
        // THE ROW MATERIAL AND NOTHING ELSE. `entryOf(event.row, …)` is the
        // tempting one-liner and it is wrong: it rebuilds the whole entry, so a
        // session renamed after forty minutes of waiting comes back as having
        // waited none — `statusSince` belongs to the STATUS, and a rename is not
        // a status. Same reason `lastStatusKey` is not recomputed from
        // `event.row.status`: the row carries a status because the event carries
        // a whole row, not because this arm has an opinion about it.
        //
        // A row change for a session the register has never seen is DROPPED, the
        // same rule and for the same reason as `session-status`.
        const was = into.get(event.key);
        if (was !== undefined) into.set(event.key, { ...was, ...rowMaterialOf(event.row), lastSeenAlive: event.at });
        break;
      }
      case "session-pane-replaced": {
        // The pane, and the same rule about the clock as above.
        const was = into.get(event.key);
        if (was !== undefined) {
          into.set(event.key, {
            ...was,
            paneId: event.paneId,
            panePid: event.panePid,
            lastSeenAlive: event.at,
          });
        }
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
    ...rowMaterialOf(row),
    paneId: row.paneId,
    panePid: row.panePid,
    tmuxServerPid,
    lastSeenAlive: at,
    lastStatusKey: key,
    // A LOWER BOUND, always. Everything that reaches here — `session-seen` and
    // `session-replaced` — is a FIRST SIGHTING: the session was in this state
    // when we looked, and how long it had been there is not something this
    // process can know. Minting `"observed"` here is the 13m bug, and it is one
    // word away at all times.
    statusSince: { kind: "lower-bound", at },
  };
}

/**
 * The fields `session-row-changed` is allowed to move, taken off a row.
 *
 * **ONE FUNCTION FOR BOTH FOLDS**, because the alternative is two copies of the
 * same seven assignments that drift: `entryOf` builds an entry from scratch and
 * the row-changed arm patches one, and a field added to one and not the other is
 * a register that is correct at first sight and stale afterwards — which is the
 * defect this whole change is about.
 *
 * `Pick<RegisterEntry, RegisterRowField>` is the type that ties the two modules
 * together: a name in `REGISTER_ROW_FIELDS` that is not a register field, or a
 * register field the differ watches and this does not copy, is a compile error
 * here.
 */
function rowMaterialOf(row: ObservedRow): Pick<RegisterEntry, RegisterRowField> {
  return {
    name: row.name,
    repo: row.repo,
    worktree: row.worktree,
    // COPIED, not referenced. The row belongs to the caller, and an entry that
    // shares its `meta` object lets a later edit to that row rewrite a
    // checkpoint describing events already on disk. GPT Sol's S3-05.
    meta: structuredClone(row.meta),
    startedAt: row.startedAt,
  };
}

/**
 * WHO IS ALLOWED TO MOVE EACH FIELD OF A REGISTER ENTRY.
 *
 * A census rather than a mechanism, and it is worth being exact about what that
 * buys, because two cross-family reviews read this comment in opposite ways and
 * each was half right.
 *
 * **A MISSING field is a compile error.** `satisfies Record<keyof
 * RegisterEntry, …>` is total, so a field added to `RegisterEntry` does not
 * compile until somebody says which of the four it is. That much is the forcing
 * function S3-03 asked for — `name` was only ever the instance somebody
 * noticed, and the class is a register field that nothing keeps current.
 *
 * **A MISCLASSIFIED field is not.** Writing `"clock"` beside a field the row
 * material owns compiles perfectly, and the field then goes stale silently:
 * the original defect, wearing the census as cover. Two of the four arms are
 * pinned by tests instead — `row` against `REGISTER_ROW_FIELDS` and the fold,
 * `pane` against what a `session-pane-replaced` really moves, both in
 * `tests/overseer-store.test.ts`. **`identity` against `clock` is pinned by
 * nothing**, and is recorded here as a KNOWN UNCOVERED CASE rather than left
 * reading as guarded: swapping those two survives the suite. A census is a
 * prompt to think, and the thinking is still the reader's.
 *
 *  - `identity` — the pair the register is keyed on, plus the tmux generation
 *    those handles belong to. It cannot change without the entry being a
 *    different entry, which is `session-replaced`.
 *  - `row` — `session-row-changed`, via `rowMaterialOf` above. Exactly
 *    `REGISTER_ROW_FIELDS`; `tests/overseer-store.test.ts` walks that list and
 *    checks each one really reaches the register.
 *  - `pane` — `session-pane-replaced`. Separate because a null there is a join
 *    miss rather than a change; see the arm in diff.ts.
 *  - `clock` — the store's own bookkeeping, written by every arm and by none of
 *    the row material. `statusSince` in particular belongs to the STATUS: a
 *    rename that reset it would turn forty minutes of waiting into none.
 */
export const ENTRY_FIELD_OWNERS = {
  key: "identity",
  tmuxId: "identity",
  claimedConversationId: "identity",
  tmuxServerPid: "identity",
  name: "row",
  repo: "row",
  worktree: "row",
  meta: "row",
  startedAt: "row",
  paneId: "pane",
  panePid: "pane",
  lastSeenAlive: "clock",
  lastStatusKey: "clock",
  statusSince: "clock",
} as const satisfies Record<keyof RegisterEntry, "identity" | "row" | "pane" | "clock">;

export function describeOpening(opening: StoreOpening): string {
  const repair = opening.repair.torn
    ? ` A torn final line of ${opening.repair.droppedBytes} bytes was truncated.`
    : "";
  const unreadable = opening.unreadableLines > 0 ? ` ${opening.unreadableLines} log lines were unreadable.` : "";
  const scanned = ` Read ${opening.bytesScanned} bytes of the log.`;
  switch (opening.start.kind) {
    case "cold":
      return `Started COLD (${opening.start.why}): no baseline and no history, so the next snapshot will look like the whole fleet starting at once.${repair}${unreadable}${scanned}`;
    case "rebuilt":
      return `Rebuilt the register from the event log (${opening.start.why}): ${opening.eventsReplayed} events replayed.${repair}${unreadable}${scanned}`;
    case "resumed":
      return `Resumed from a checkpoint written ${opening.start.checkpointWrittenAt}, ${opening.eventsReplayed} events replayed past its cursor.${repair}${unreadable}${scanned}`;
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
    case "relative-store-dir":
      return `The store directory ${JSON.stringify(refusal.path)} is relative, so it names a different directory for every process that starts here. Give an absolute path.`;
    case "unusable-directory":
      return `The store directory is unusable: ${refusal.detail}`;
    default: {
      const never: never = refusal;
      throw new Error(String(never));
    }
  }
}

/**
 * `fromByte` must be a LINE BOUNDARY, and every cursor this module hands out is
 * one: `nextByte` is the file's size and a checkpoint's `cursor.bytes` is the
 * size at the moment it was written, both taken after a newline-terminated
 * append. A byte in the middle of a line would make the first line read look
 * like garbage — reported as unreadable rather than silently dropped, but wrong
 * either way, so do not invent one.
 */
function parseEventLines(slice: Buffer): { events: OverseerEvent[]; unreadable: UnreadableLine[] } {
  const events: OverseerEvent[] = [];
  const unreadable: UnreadableLine[] = [];
  for (const [index, text] of slice.toString("utf8").split("\n").entries()) {
    if (text === "") continue;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (cause) {
      unreadable.push({ line: index + 1, text, reason: String(cause) });
      continue;
    }
    const parsed = parseEvent(json);
    if (!parsed.ok) {
      unreadable.push({ line: index + 1, text, reason: parsed.reason });
      continue;
    }
    events.push(parsed.value);
  }
  return { events, unreadable };
}

class Store implements OverseerStore {
  readonly root: string;
  readonly instanceId: string;
  readonly opening: StoreOpening;
  private readonly registerMap: Map<SessionKey, RegisterEntry>;
  private readonly lock: HeldLock;
  private readonly nowFn: () => Date;
  private readonly fd: number;
  private bytes: number;
  private events: number;
  /** THIS INSTANCE'S ticks, reset by a restart on purpose: a counter that survives one cannot tell a day of smooth running from two hundred restarts. `instanceId` and `startedAt` beside it say which instance is counting. */
  private ticks = 0;
  private lastTickAt: string | null = null;
  /**
   * The last attention list a caller handed in, held so a write that carries no
   * new one does not blank the inbox.
   *
   * **Not restored across a restart, deliberately.** It could be — the previous
   * checkpoint holds one — and it must not be: the durations in it are
   * first-seen instants for questions that may have been answered while we were
   * down, and republishing them would report a wait we cannot vouch for. That is
   * the `13m` bug in `StatusSince` above, one level up, and the honest answer is
   * the same as the one the register gives: say we do not know, and look again.
   */
  private attention: AttentionList;
  private closed = false;

  constructor(input: {
    root: string;
    lock: HeldLock;
    now: () => Date;
    opening: StoreOpening;
    register: Map<SessionKey, RegisterEntry>;
    fd: number;
    bytes: number;
    events: number;
  }) {
    this.root = input.root;
    this.lock = input.lock;
    this.instanceId = input.lock.holder.instanceId;
    this.nowFn = input.now;
    this.opening = input.opening;
    this.registerMap = input.register;
    this.fd = input.fd;
    this.bytes = input.bytes;
    this.events = input.events;
    this.attention = attentionNotYetRun(input.now().toISOString());
  }

  get register(): SessionRegister {
    return this.registerMap;
  }

  /**
   * Whether this process still holds the lock, asked of the filesystem rather
   * than remembered.
   *
   * Checked before EVERY write, which is once a tick and costs a `stat`. It is
   * the backstop for the one step `takeLock` cannot make atomic — clearing a
   * dead process's lock — and it turns "two daemons writing forever" into "the
   * loser stops at its next tick and says why". It is a second line and not the
   * first: a check before a write is a TOCTOU check, which is exactly why the
   * claim itself is `O_EXCL`.
   */
  private ownership(): { ours: true } | { ours: false; holder: LockHolder | null } {
    const path = join(this.root, LOCK_FILE);
    if (stillOurs(this.lock, path)) return { ours: true };
    const read = readLock(path);
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
        pid: this.lock.holder.pid,
        instanceId: this.lock.holder.instanceId,
        startedAt: this.lock.holder.startedAt,
        lastTickAt: this.lastTickAt,
        ticks: this.ticks,
      },
      // The register is taken from the fold rather than from the caller, so a
      // caller cannot hand in a register that disagrees with the log.
      register: [...this.registerMap.values()],
      // The attention list DOES come from the caller, and that is the difference
      // between the two: the register is folded from events this store owns,
      // while the list is a judgement made outside it. Held across writes that
      // carry no new one, because the questions have not gone away because we
      // did not look — and the list says when it was scanned, so a held one
      // cannot pass itself off as fresh.
      attention: update.attention ?? this.attention,
    };
    if (update.attention !== undefined) this.attention = update.attention;
    writeAtomically(join(this.root, CHECKPOINT_FILE), this.root, `${JSON.stringify(checkpoint, null, 2)}\n`);
    return { ok: true, checkpoint };
  }

  readEvents(fromByte = 0): ReadEvents {
    const path = join(this.root, EVENTS_FILE);
    const slice = readSlice(path, fromByte);
    const { events, unreadable } = parseEventLines(slice);
    return { events, unreadable, nextByte: Math.max(fromByte, 0) + slice.byteLength };
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
    closeSync(this.lock.fd);
  }
}

/** Everything a start needs to know about the range of log it has not folded yet. */
type Replay =
  | { kind: "read"; events: readonly OverseerEvent[]; bytesScanned: number; unreadable: 0 }
  | { kind: "refused"; why: ColdReason; bytesScanned: number; unreadable: number };

/**
 * Read the range that has not been folded already — or refuse to.
 *
 * ALL OR NOTHING. One unreadable line in the range means the whole range is
 * refused, because the alternative is a register built by stepping over the
 * event that would have contradicted it. The caller decides what to fold it
 * onto; this only decides whether there is anything trustworthy to fold.
 */
function replay(path: string, from: number, size: number, ceiling: number): Replay {
  if (size - from > ceiling) {
    return { kind: "refused", why: "log-too-large-to-replay", bytesScanned: 0, unreadable: 0 };
  }
  const slice = readSlice(path, from);
  const { events, unreadable } = parseEventLines(slice);
  if (unreadable.length > 0) {
    return { kind: "refused", why: "log-has-holes", bytesScanned: slice.byteLength, unreadable: unreadable.length };
  }
  return { kind: "read", events, bytesScanned: slice.byteLength, unreadable: 0 };
}

/**
 * Open the store, taking the lock, repairing the log and rebuilding the
 * register — in that order, because each step needs the one before it.
 *
 * Everything after `takeLock` is inside a `try` that releases the lock: a
 * throw between taking it and returning a store would otherwise leave a lock
 * with a live pid on it, held by a process that has forgotten it exists, and
 * that is the deadlock this whole area is supposed to be immune to.
 */
export function openStore(options: OpenStoreOptions = {}): OpenStoreResult {
  const now = options.now ?? (() => new Date());
  const ceiling = options.replayCeilingBytes ?? REPLAY_CEILING_BYTES;
  let root: string;
  if (options.root === undefined) {
    try {
      root = storeRoot(options.env ?? process.env);
    } catch {
      return {
        ok: false,
        refusal: { reason: "relative-store-dir", path: String((options.env ?? process.env)["OVERSEER_STORE_DIR"]) },
      };
    }
  } else {
    root = options.root;
  }
  // BEFORE `mkdir`, so a relative path does not leave a directory behind in
  // whatever tree the caller happened to be standing in.
  if (!isAbsolute(root)) return { ok: false, refusal: { reason: "relative-store-dir", path: root } };

  const hadDirectory = existsSync(root);
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 });
  } catch (cause) {
    return { ok: false, refusal: { reason: "unusable-directory", detail: String(cause) } };
  }

  const lockPath = join(root, LOCK_FILE);
  const acquired = takeLock(lockPath, now, options.beforeClaim);
  if (!acquired.ok) return { ok: false, refusal: acquired.refusal };
  const lock = acquired.lock;
  const release = (): void => releaseLock(lock, lockPath);

  try {
    const eventsPath = join(root, EVENTS_FILE);
    // The checkpoint FIRST and it is small, so the cursor is known before
    // anything decides how much of the log to read.
    const read = readCheckpoint(root);

    // Re-checked because clearing a dead process's lock is the one step that
    // cannot be atomic: a start that lost that race must not truncate a log the
    // winner is already appending to.
    if (!stillOurs(lock, lockPath)) {
      closeSync(lock.fd);
      return { ok: false, refusal: { reason: "lost-the-race", holder: null } };
    }
    // BEFORE the append handle is opened, so nothing can land after the torn
    // bytes. This is the whole of design call 1.
    const repair = truncateToLastLine(eventsPath);
    if (!stillOurs(lock, lockPath)) {
      closeSync(lock.fd);
      return { ok: false, refusal: { reason: "lost-the-race", holder: null } };
    }

    const fd = openSync(eventsPath, "a");
    const size = fstatSync(fd).size;

    // A cursor past the end of the log is a checkpoint describing a file that
    // has since shrunk — a truncation, a hand-edit, a restored backup. It is
    // not resumable and it is not half-resumable: rebuild.
    const usable = read.kind === "checkpoint" && read.checkpoint.cursor.bytes <= size ? read.checkpoint : null;
    const from = usable === null ? 0 : usable.cursor.bytes;
    const replayed = replay(eventsPath, from, size, ceiling);

    let start: StoreStart;
    let register: Map<SessionKey, RegisterEntry>;
    let events: number;

    if (replayed.kind === "refused") {
      // The strictness above is affordable only because of this line: no
      // baseline, a working daemon, and a sentence saying which of the two
      // things went wrong.
      start = { kind: "cold", why: replayed.why };
      register = new Map();
      events = 0;
    } else if (usable !== null) {
      // The tail folds ONTO the checkpoint's register rather than replacing it.
      register = new Map();
      for (const entry of usable.register) register.set(entry.key, entry);
      foldEvents(replayed.events, register);
      events = usable.cursor.events + replayed.events.length;
      start = {
        kind: "resumed",
        checkpointWrittenAt: usable.writtenAt,
        lastGoodSnapshotAt: usable.lastGoodSnapshotAt,
      };
    } else {
      const why: ColdReason = !hadDirectory
        ? "no-store-directory"
        : read.kind === "absent"
          ? "no-checkpoint"
          : read.kind === "unusable"
            ? read.why
            : "checkpoint-malformed";
      register = foldEvents(replayed.events, new Map());
      events = replayed.events.length;
      // COLD means there was nothing to rebuild FROM, not merely that the
      // checkpoint was missing: a daemon that replayed a thousand events has a
      // baseline and should not announce itself as having none.
      start = replayed.events.length > 0 ? { kind: "rebuilt", why } : { kind: "cold", why };
    }

    const opening: StoreOpening = {
      start,
      repair,
      eventsReplayed: replayed.kind === "read" ? replayed.events.length : 0,
      unreadableLines: replayed.unreadable,
      bytesScanned: replayed.bytesScanned,
    };
    return {
      ok: true,
      store: new Store({ root, lock, now, opening, register, fd, bytes: size, events }),
    };
  } catch (cause) {
    release();
    throw cause;
  }
}
