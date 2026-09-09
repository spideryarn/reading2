/**
 * The Overseer's store: an append-only event log, a checkpoint, and one writer.
 *
 * This is the thing nothing on this box has today. Session identity — the
 * `META` fields and the claimed conversation — is pinned into the **tmux
 * environment** at launch, and a reboot takes the tmux server and all of it.
 * The register in `current.json` is the only copy that survives, which is why
 * `meta.dir` is carried whole rather than reconstructed from a transcript path:
 * that path is a slugified cwd and is lossy, and `repo` is not derivable from
 * it at all. docs/project/overseer-direction.md § The store.
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

import { executionTokenText, isExecutionTokenText } from "../fleet/execution-token.js";
import type { AttentionItem, AttentionList, ConversationReading, OverseerWork, PaneJob, PaneWork, StoredUsage } from "../fleet/wire.js";
import { parseAnswerability } from "./attention-memory.js";
import { parseUsageReport } from "./usage.js";
import type { SessionKind, SessionMeta } from "../../scripts/gjd-remote-tmux.js";
import {
  REGISTER_ROW_FIELDS,
  statusKey,
  type JobEvent,
  type OverseerEvent,
  type RegisterRowField,
  type RuleEvent,
  type SessionEvent,
  type SessionIdentity,
  type SessionKey,
  type StatusKey,
} from "./diff.js";
import {
  adoptOccurrence,
  foldOccurrences,
  occurrenceId as occurrenceIdOf,
  type BehaviourHash,
  type JobOutcome,
  type Occurrence,
  type OccurrenceHistory,
  type OccurrenceId,
  type OccurrenceIndex,
} from "./jobs.js";
import type { KillPolicy } from "../fleet/actions.js";
import type { DriftedSession, LaunchModeFinding, RuleFinding, RuleId, RuleOutcome, WedgedProcess, WedgedWorkFinding } from "./rules.js";
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
import { parseExecution } from "./observation.js";
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
 * docs/project/overseer-direction.md § The seam is a file tells it to do
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
  /**
   * WHETHER WHAT HAS ALREADY RUN COULD BE RECONSTRUCTED — the same value the
   * store exposes, repeated here so the start note can say it.
   *
   * Separate from `start` because they answer different questions: `cold` means
   * *there was no baseline to resume from*, which is an ordinary first run, and
   * this means *some of what already happened is unreadable*, which is not.
   */
  occurrenceHistory: OccurrenceHistory;
  /** Present only when this start consumed a `reconcile-occurrences.json`, carrying whatever reason it gave. Absent is the ordinary case. */
  occurrencesReconciled?: string;
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
  /**
   * **THE LAST RUN THIS SESSION WAS VERIFIED TO BE, and whether we can still
   * see one.**
   *
   * The register's other identities (`tmuxId`, `paneId`, `panePid`,
   * `claimedConversationId`) all survive a claude exiting and another starting
   * in the same pane, which is why `OverseerRegister` in wire.ts says in as many
   * words that this register may not be joined onto a fleet row: *"the
   * generation tuple can stay fixed while the process inside it is replaced, so
   * 'blocked for at least 20 minutes' said against a row needs continuity
   * evidence this build does not have."* This is that evidence.
   *
   * **STICKY, AND NULL UNTIL SOMETHING IS VERIFIED.** It moves on a first
   * sighting and on a proven change, and on nothing else — so a collection whose
   * `ps` failed leaves it exactly where it was, and `verified(A) → unknown →
   * verified(A)` stays one unbroken run rather than becoming two. Overwriting it
   * with every reading would make *we could not look* indistinguishable from
   * *it was replaced*, which is the mistake `session-pane-replaced` makes with a
   * null pid and has a long comment about.
   *
   * `since` is when this run was first recorded here, which is a FLOOR on how
   * long it has been running — the same kind of number as `statusSince`'s
   * `lower-bound` arm, and it must be drawn as one. And it is not a claim that
   * the run is alive: `lastSeenAlive` and the checkpoint's snapshot clock are
   * the fields that speak to that.
   *
   * **NO SCHEMA BUMP**, by this file's own rule: a reader that ignores it draws
   * no continuity and is poorer rather than wrong — unlike schema 2's
   * `statusSince`, where a consumer written against schema 1 would have
   * rendered a floor as a reading. A checkpoint written before this field
   * parses to `null`, which says *we have never verified a run for this
   * session*, and that is true of it.
   */
  readonly verifiedExecution: { readonly token: string; readonly since: string } | null;
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
  /**
   * WHAT THE FLEET WAS ACTUALLY DOING at one process-table instant.
   *
   * **No schema bump**, by this file's own rule: a reader that ignores the
   * field draws no work line, which is poorer rather than wrong. The reading's
   * own clock stays inside it, because `writtenAt` may move while a held
   * measurement does not.
   */
  work: OverseerWork;
  /**
   * HOW CLOSE THIS ACCOUNT IS TO A LIMIT, produced by `usage.ts` and rendered by
   * the dashboard, which imports the type from `tools/fleet/wire.ts`.
   *
   * **No schema bump, for the same reason `attention` was not one**: a reader
   * that ignores this draws no usage panel, which is poorer rather than wrong.
   *
   * **The store REMEMBERS and the pass JUDGES, and the split is deliberate.**
   * The report is held whole, exactly as it was collected, and the store never
   * merges two of them. Which of a new report and a stored one should survive is
   * a judgement that needs the current account and the new scan's coverage —
   * both of which the pass has and this file does not:
   *
   *     a report whose scan was COMPLETE always supersedes; one whose scan was
   *     INCOMPLETE supersedes only if what is stored is also incomplete or absent.
   *
   * That is the whole of the carry-forward this field was added for, and it lives
   * in the caller. An earlier design had the store remembering individual
   * rejections with their expiries and re-checking each one's attribution; it was
   * dropped because it needed a second representation of a rejection inside the
   * store and the store would have had to learn what account is logged in now.
   * A held report carries its own `account` and `collectedAt`, so a stale
   * attribution is visible rather than remembered as a fact.
   *
   * **A held report is not a fresh one and says so.** `collectedAt` is inside the
   * report; `writtenAt` on the checkpoint is when it was last written down. Only
   * the first can tell a quiet account from a pass that stopped running, which is
   * why a scan costing 30–45 seconds is not run on every tick.
   */
  usage: StoredUsage;
  /**
   * WHAT THE SCHEDULER HAS RUN, AND WHAT IT CANNOT ACCOUNT FOR.
   *
   * **No schema bump**, by this file's own rule: a reader that ignores this
   * draws no jobs panel, which is poorer rather than wrong — unlike schema 2's
   * `statusSince`, where a consumer written against schema 1 would have rendered
   * `NaN`. A checkpoint written before this field existed parses with an empty
   * list, which is also the truth about it: those logs contain no occurrence
   * events.
   *
   * **A fold, like the register, and not a sample.** These are what
   * `foldOccurrences` holds — every unsettled run, the newest settled run per
   * job, and a bounded tail of the ones nobody can account for. So a run whose
   * `leaseUntil` has passed while it is still `reserved` or `started` is visible
   * to a reader of this file without asking the daemon anything, and that is the
   * point: S6's failure was a job that had silently stopped running while every
   * surface stayed green.
   *
   * **`stuck` itself is deliberately not stored.** It is a state read against a
   * clock, and a boolean written at `writtenAt` would go on saying "fine" for as
   * long as the daemon was dead — which is the shape of the bug rather than a
   * report of it. `stuckOccurrences()` in jobs.ts is the reader's one line.
   */
  jobs: { occurrences: readonly Occurrence[] };
  /**
   * WHETHER THE SCHEDULER IS SWITCHED ON, in the daemon's own words.
   *
   * **A scheduler that is off must not read as a scheduler with nothing to
   * do**, and until this field existed nothing on any surface could tell those
   * apart: both produced an empty `jobs.occurrences` and a green heartbeat. That
   * is the shape of GPT Sol's C1 — an engine that schedules nothing, installed —
   * and it is exactly the conflation docs/reusable/silent-success.md is about.
   *
   * It is written by the daemon rather than read from the environment by
   * whoever runs `overseer status`, because those are two different
   * environments: systemd's unit and a person's shell. Only the running daemon
   * knows what it was actually started with.
   *
   * **No schema bump**, by this file's own rule: a reader that ignores it draws
   * no scheduler line, which is poorer rather than wrong. A checkpoint written
   * before this field existed parses as `unknown`, which is the truth about it.
   */
  scheduler: StoredScheduler;
  /**
   * THE DEADLINE THE DAEMON ITSELF IS USING for "the collector has gone quiet",
   * in milliseconds — or `null` from a daemon that did not say.
   *
   * `scripts/overseer-watchdog.ts` reads this rather than recomputing it. Both
   * already called the same `staleAfterMs`, and GPT Sol's C6 is that sharing a
   * FUNCTION prevents formula drift and not INPUT drift: the daemon passes the
   * snapshot's advertised `refreshMs` (60s → 300,000ms) and the watchdog passed
   * the historical measured constant (65s → 325,000ms), so the two disagreed
   * under the documented normal values and would have diverged further the first
   * time the collector's cadence changed.
   *
   * The computed deadline rather than the cadence, because the deadline is what
   * both sides actually want and deriving it twice is the drift again one level
   * down.
   *
   * **No schema bump**: a reader that ignores it falls back to its own constant,
   * which is what it did before this existed — poorer, not wrong.
   */
  snapshotStaleAfterMs: number | null;
  /**
   * WHETHER THE OCCURRENCE LEDGER IN THIS CHECKPOINT IS THE WHOLE OF IT.
   *
   * **Carried forward, or the protection would last exactly one daemon
   * lifetime.** A start that lost history holds its jobs; it then writes a
   * checkpoint whose cursor is at the end of the log, so the NEXT start replays
   * a clean tail onto an empty ledger and reads as intact — the loss laundered
   * by an automatic write nobody decided. Recording it here means the hold
   * survives until somebody clears it on purpose
   * (`overseer reconcile-jobs`, and `RECONCILE_FILE` below).
   *
   * `null` from a checkpoint written before this field existed, which is
   * treated as *no claim* rather than as `intact` — the same rule
   * `parseStoredScheduler` follows one field up.
   */
  occurrenceHistory: OccurrenceHistory | null;
};

/**
 * What a checkpoint says about the scheduler.
 *
 * Four arms rather than a boolean. *Nobody has said* is a fact and the most
 * dangerous one to fold into `off`: an old checkpoint would then claim a
 * scheduler is disarmed when what is true is that this build cannot tell. Same
 * reasoning as `StoredUsage`'s `none` arm two fields up.
 *
 * **`blocked` is GPT Sol's S8-7, and it is the arm this design was missing.**
 * The word on the status page came from an environment variable alone, so
 * systemd could be active, the daemon healthy, the headline reading `ARMED` —
 * and both jobs unauthorised, or absent because a document could not be read.
 * A person reading that page would have been told the opposite of the truth by
 * the one line they trusted.
 *
 * So `armed` is now a claim about the **loaded, authorised definitions**: the
 * switch is on AND at least one job could actually run. Switched on with nothing
 * runnable is `blocked`, which is neither of the other two and needs its own
 * word.
 */
export type StoredScheduler =
  | { kind: "armed"; why: string; at: string }
  | { kind: "blocked"; why: string; at: string }
  | { kind: "off"; why: string; at: string }
  | { kind: "unknown"; why: string; at: string };

/** What a checkpoint carries when no daemon in this build has written one. */
export function schedulerNotYetSaid(at: string): StoredScheduler {
  return {
    kind: "unknown",
    why:
      "no daemon in this build has said whether its scheduler is armed. This instant is when the checkpoint " +
      "was written, not when anything was decided.",
    at,
  };
}

/**
 * What a checkpoint carries before any usage pass has run.
 *
 * The `none` arm rather than an empty report, for the reason
 * [`StoredUsage`](../fleet/wire.ts) gives: a report saying *no limits found* is a
 * claim, and it is the most reassuring possible lie for a probe that has never
 * looked.
 */
export function usageNotYetRun(at: string): StoredUsage {
  return {
    kind: "none",
    why:
      "no usage pass has run in this Overseer yet, so no account has been read. This instant is when " +
      "the checkpoint was written, not when anything was scanned.",
    at,
  };
}

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

/** What a checkpoint carries before this daemon has read a process table for an inventory. */
export function workNotYetRun(at: string): OverseerWork {
  return {
    kind: "not-yet-run",
    why:
      "no work scan has run in this Overseer yet, so nothing has looked under any pane. This instant is " +
      "when the checkpoint was written, not when any process table was read.",
    at,
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
  /** A new work measurement, or omitted to keep the one the store already holds. */
  work?: OverseerWork;
  /**
   * A new usage report, or omitted to keep the one the store already holds.
   *
   * Omitted is the normal case and more so than for `attention`: a full scan is
   * 30–45 seconds over ~2.9 GB, so it runs on its own slow timer rather than on a
   * tick. **The caller decides whether a new report supersedes a stored one** —
   * see `Checkpoint.usage` — and simply omits this when it should not.
   */
  usage?: StoredUsage;
  /**
   * What to say about the scheduler, or omitted to keep what the store holds.
   *
   * The daemon passes it on the first write and every one after it, because it
   * is one small object and re-deriving it costs nothing; the option is here so
   * that a caller with nothing to say does not blank it.
   */
  scheduler?: StoredScheduler;
  /** The deadline this daemon is using for a quiet collector. See `Checkpoint.snapshotStaleAfterMs`. */
  snapshotStaleAfterMs?: number;
};

/**
 * The file that reconciles a lost occurrence ledger, **consumed once**.
 *
 * Written by `overseer reconcile-jobs` and deleted by the next start that reads
 * it, so it is an ACT rather than a setting: an env var left switched on would
 * turn "somebody decided this once" into "this protection is off for ever",
 * which is the shape of every gate that stops meaning anything.
 *
 * It takes effect on the next start, because the verdict is computed when the
 * store opens. A daemon already running has to be restarted, and the CLI says so.
 */
export const RECONCILE_FILE = "reconcile-occurrences.json";

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
  /**
   * What the store currently holds, so a pass can decide whether its fresh
   * reading should replace it.
   *
   * Exposed because the decision is `chooseUsage`'s and it needs both sides, and
   * the store is the only thing that knows what survived the last restart. Read
   * rather than remembered by the caller: a daemon keeping its own copy would be
   * a second declaration of the same fact, and the two would part company the
   * first time a write was refused.
   */
  readonly usage: StoredUsage;
  /**
   * Live, like `register`: `append` folds into it, so the scheduler cannot hold
   * a view of what has run that disagrees with the log.
   *
   * **This is what the scheduler asks before it dispatches**, rather than a
   * field it keeps for itself. The in-memory overlap guard it replaces was a
   * promise the daemon remembered, and remembering was the defect: nothing
   * survived a restart and nothing released when the work never came back.
   */
  readonly occurrences: OccurrenceIndex;
  /**
   * WHETHER `occurrences` ABOVE IS THE WHOLE OF IT — and the scheduler refuses
   * to dispatch anything when it is not.
   *
   * A cold start is the right answer for the session register: it is a
   * derivation of a live world, and the next snapshot rebuilds it. It is the
   * wrong answer for a ledger of what has already been done, because an empty
   * ledger reads as *nothing has ever run* and that is a licence to run
   * everything again. GPT Sol's C3, and the reason this is a field of the store
   * rather than a sentence in `opening`: the scheduler has to consult it on
   * every tick, and a sentence is not consultable.
   */
  readonly occurrenceHistory: OccurrenceHistory;
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
      // TOTAL, LIKE `parseAttempt`, and it is the one field on a row this
      // reader will not refuse over. A `session-seen` written before the field
      // existed comes back as `unknown`/`not-reported` rather than failing the
      // event and, with it, the fold of the whole log. There is no path from a
      // missing field to `verified`; `observation.ts` owns the rule.
      execution: parseExecution(u["execution"]),
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

/** The common half of every session event: whatever `parseEvent` has already checked. */
type SessionEventCommon = { at: string; key: SessionKey; identity: SessionIdentity; tmuxServerPid: number | null };

/**
 * `session-execution-changed`, off the log.
 *
 * Its own function rather than a case body, because it is four checks and the
 * `parseEvent` switch is already the longest thing in this file.
 *
 * **`token` IS REQUIRED AND WELL-FORMED; `previousToken` MAY BE NULL AND MAY
 * NOT EQUAL IT.** Null is the first-sighting arm — a session the register had
 * never verified — and an event whose two sides are equal is not a change and
 * is one this module never wrote. Both tokens go through
 * {@link isExecutionTokenText}, so "malformed present values are refused" is a
 * property of the parser rather than of the writer's good manners; accepting
 * any non-empty string was GPT Sol's P2-4b.
 */
function parseExecutionChanged(u: Record<string, unknown>, common: SessionEventCommon): ParseResult<OverseerEvent> {
  const rawPrevious = u["previousToken"];
  const token = u["token"];
  if (rawPrevious !== null && !isExecutionTokenText(rawPrevious)) {
    return { ok: false, reason: "previousToken is neither null nor an execution token" };
  }
  const previousToken = rawPrevious as string | null;
  if (!isExecutionTokenText(token)) return { ok: false, reason: "token is not an execution token" };
  if (previousToken === token) {
    return { ok: false, reason: "previousToken and token are equal, which is not a change" };
  }
  const conversation = parseConversationReading(u["conversation"]);
  if (!conversation.ok) return { ok: false, reason: conversation.reason };
  return {
    ok: true,
    value: { kind: "session-execution-changed", ...common, previousToken, token, conversation: conversation.value },
  };
}

/**
 * One conversation verdict off the log.
 *
 * STRICT, unlike `observation.ts`'s reader of the same type. That one parses a
 * live payload from a producer that may be older than the field, so it degrades
 * to `unknown` rather than refusing a snapshot. This parses the Overseer's own
 * append-only log, where every line was written by this module: a line that
 * does not read is a file somebody edited or a bug here, and both should be
 * refused loudly rather than rounded to a shrug.
 */
function parseConversationReading(u: unknown): ParseResult<ConversationReading> {
  if (!isRecord(u)) return { ok: false, reason: "conversation is not an object" };
  const kind = u["kind"];
  if (kind === "not-claimed") return { ok: true, value: { kind: "not-claimed" } };
  if (kind === "verified") {
    const id = u["id"];
    if (typeof id !== "string" || id === "") return { ok: false, reason: "conversation.id is not a conversation id" };
    return { ok: true, value: { kind: "verified", id } };
  }
  if (kind === "conflicting") {
    const claimed = u["claimed"];
    const observed = u["observed"];
    if (typeof claimed !== "string" || typeof observed !== "string") {
      return { ok: false, reason: "conversation.claimed and conversation.observed are not both strings" };
    }
    return { ok: true, value: { kind: "conflicting", claimed, observed } };
  }
  if (kind === "unverifiable") {
    const claimed = u["claimed"];
    const why = u["why"];
    if (typeof claimed !== "string") return { ok: false, reason: "conversation.claimed is not a string" };
    if (typeof why !== "string") return { ok: false, reason: "conversation.why is not a string" };
    return { ok: true, value: { kind: "unverifiable", claimed, why } };
  }
  return { ok: false, reason: `conversation.kind ${JSON.stringify(kind)} is not a conversation reading` };
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
  "session-execution-changed": true,
  "job-occurrence-reserved": true,
  "job-occurrence-started": true,
  "job-occurrence-finished": true,
  "job-occurrence-refused": true,
  "job-occurrence-unknown": true,
  "rule-intended": true,
  "rule-settled": true,
};

/** The watched row fields, as a set, so a `fields` list read off the disk can be checked against it. */
const ROW_FIELDS = new Set<string>(REGISTER_ROW_FIELDS);

const GONE_REASONS = new Set(["absent-from-snapshot", "tmux-server-changed"]);

const JOB_KINDS: Record<JobEvent["kind"], true> = {
  "job-occurrence-reserved": true,
  "job-occurrence-started": true,
  "job-occurrence-finished": true,
  "job-occurrence-refused": true,
  "job-occurrence-unknown": true,
};

function isJobKind(kind: string): kind is JobEvent["kind"] {
  return Object.hasOwn(JOB_KINDS, kind);
}

/**
 * THE THIRD FAMILY, AND THE DISCRIMINATOR THE COMPILER CANNOT DEMAND.
 *
 * GPT Sol's SP-9, and it is the sharp half of that finding. `EVENT_KINDS` being
 * a total `Record` means the *key* for a new arm cannot be forgotten. The
 * *parse branch* can: `parseEvent` below treats every kind that is not a job
 * kind as a session event, and casts to `SessionEvent["kind"]` to do it — so a
 * rule event with no family test here would append perfectly and come back on
 * the next read demanding `key`, `identity` and `tmuxServerPid`, and **nothing
 * would fail to compile.**
 *
 * A write that succeeds and a read that quietly refuses it, in that order,
 * discovered in a different process: docs/reusable/silent-success.md with the
 * halves the inconvenient way round. Hence a second total `Record` rather than
 * a second thing to remember.
 */
const RULE_KINDS: Record<RuleEvent["kind"], true> = {
  "rule-intended": true,
  "rule-settled": true,
};

function isRuleKind(kind: string): kind is RuleEvent["kind"] {
  return Object.hasOwn(RULE_KINDS, kind);
}

/** A field that is a non-empty string. Ids and hashes are opaque here; what makes an id well-formed is `occurrenceId()`, checked below. */
function isName(u: unknown): u is string {
  return typeof u === "string" && u !== "";
}

/**
 * How a run ended, off the disk.
 *
 * Two arms, and neither is a bare number: `exitCode: 0` and "the runner said it
 * broke" must not be able to arrive in one slot, because a zero read out of the
 * second is the most reassuring possible lie about a job that failed.
 */
function parseOutcome(u: unknown): ParseResult<JobOutcome> {
  if (!isRecord(u)) return { ok: false, reason: "outcome is not an object" };
  const kind = u["kind"];
  if (kind === "exited") {
    const code = u["code"];
    if (typeof code !== "number" || !Number.isInteger(code)) {
      return { ok: false, reason: "outcome.code is not an integer" };
    }
    return { ok: true, value: { kind: "exited", code } };
  }
  if (kind === "failed") {
    const why = u["why"];
    if (typeof why !== "string") return { ok: false, reason: "outcome.why is not a string" };
    return { ok: true, value: { kind: "failed", why } };
  }
  return { ok: false, reason: `outcome kind ${JSON.stringify(kind)} is not one this version knows` };
}

/**
 * One occurrence event off the disk.
 *
 * **The id is RECOMPUTED from the key rather than trusted**, on the reservation
 * where the key lives. It is derived data, so a file where the two disagree has
 * been hand-edited or written by something that is not this module — and every
 * later event in the log addresses that run by its id. Accepting a mismatch
 * would attach a whole run's history to an address nothing else uses, which is a
 * plausible history rather than a broken one: the failure this store exists to
 * refuse.
 */
function parseJobEvent(kind: JobEvent["kind"], u: Record<string, unknown>, at: string): ParseResult<JobEvent> {
  const id = u["occurrenceId"];
  if (!isName(id)) return { ok: false, reason: "occurrenceId is not an id" };
  const occurrence = id as OccurrenceId;
  switch (kind) {
    case "job-occurrence-reserved": {
      const jobId = u["jobId"];
      const scheduledAt = u["scheduledAt"];
      // EITHER NAME, and the old one is not a kindness. Lines written before
      // 2026-09-09 spell it `definitionHash`; the field means the same thing and
      // the id it is checked against is byte-identical, so refusing them would
      // turn a rename into a lost ledger — and a lost ledger holds every job.
      const hash = u["behaviourHash"] ?? u["definitionHash"];
      const instanceId = u["instanceId"];
      const leaseUntil = u["leaseUntil"];
      const what = u["what"];
      if (!isName(jobId)) return { ok: false, reason: "jobId is not a job id" };
      if (!isIsoTimestamp(scheduledAt)) return { ok: false, reason: "scheduledAt is not an ISO timestamp" };
      if (!isName(hash)) return { ok: false, reason: "behaviourHash is not a hash" };
      if (!isName(instanceId)) return { ok: false, reason: "instanceId is not an instance id" };
      if (!isIsoTimestamp(leaseUntil)) return { ok: false, reason: "leaseUntil is not an ISO timestamp" };
      if (typeof what !== "string") return { ok: false, reason: "what is not a string" };
      const expected = occurrenceIdOf({ jobId, scheduledAt, behaviourHash: hash as BehaviourHash });
      if (expected !== occurrence) {
        return { ok: false, reason: `occurrenceId ${JSON.stringify(id)} is not the id of its own key (${expected})` };
      }
      return {
        ok: true,
        value: {
          kind,
          at,
          jobId,
          scheduledAt,
          behaviourHash: hash as BehaviourHash,
          occurrenceId: occurrence,
          instanceId,
          leaseUntil,
          what,
        },
      };
    }
    case "job-occurrence-started": {
      const pid = u["pid"];
      const leaseUntil = u["leaseUntil"];
      if (!isPidLike(pid)) return { ok: false, reason: "pid is not a pid" };
      if (!isIsoTimestamp(leaseUntil)) return { ok: false, reason: "leaseUntil is not an ISO timestamp" };
      return { ok: true, value: { kind, at, occurrenceId: occurrence, pid, leaseUntil } };
    }
    case "job-occurrence-finished": {
      const outcome = parseOutcome(u["outcome"]);
      if (!outcome.ok) return { ok: false, reason: outcome.reason };
      return { ok: true, value: { kind, at, occurrenceId: occurrence, outcome: outcome.value } };
    }
    case "job-occurrence-refused":
    case "job-occurrence-unknown": {
      const why = u["why"];
      if (typeof why !== "string") return { ok: false, reason: "why is not a string" };
      return { ok: true, value: { kind, at, occurrenceId: occurrence, why } };
    }
    default: {
      const never: never = kind;
      return { ok: false, reason: `no parser for ${String(never)}` };
    }
  }
}

/** One wedged process off the disk. Every field the finding's arithmetic used, so a replay can redo it rather than take it. */
function parseWedgedProcess(u: unknown): ParseResult<WedgedProcess> {
  if (!isRecord(u)) return { ok: false, reason: "a process is not an object" };
  const pid = u["pid"];
  if (!isPidLike(pid)) return { ok: false, reason: "process.pid is not a pid" };
  const rule = u["rule"];
  if (!isName(rule)) return { ok: false, reason: "process.rule is not a kill rule" };
  for (const field of ["why", "comm", "args"] as const) {
    if (typeof u[field] !== "string") return { ok: false, reason: `process.${field} is not a string` };
  }
  for (const field of ["rssKiB", "etimeSeconds"] as const) {
    const value = u[field];
    // NON-NEGATIVE, because the age is what the threshold was applied to: a
    // negative one read back would make a finding whose own arithmetic cannot
    // be redone, which is the only thing this record is for.
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return { ok: false, reason: `process.${field} is not a count` };
    }
  }
  return {
    ok: true,
    value: {
      pid,
      rule,
      why: u["why"] as string,
      comm: u["comm"] as string,
      args: u["args"] as string,
      rssKiB: u["rssKiB"] as number,
      etimeSeconds: u["etimeSeconds"] as number,
    },
  };
}

/**
 * What a rule found, off the disk — **one parser per rule, chosen by the
 * finding's own `kind`.**
 *
 * Exhaustive on `RuleId`, so a new rule cannot be added without saying how its
 * finding is read back. SP-9's shape: an event kind with no parse branch
 * appends perfectly and comes back on the next read as "not an event this
 * version knows", and the finding inside it is the same hazard one level down.
 */
function parseFinding(u: unknown): ParseResult<RuleFinding> {
  if (!isRecord(u)) return { ok: false, reason: "finding is not an object" };
  const kind = u["kind"];
  if (!isRuleId(kind)) return { ok: false, reason: `finding.kind ${JSON.stringify(kind)} is not a rule this version knows` };
  switch (kind) {
    case "wedged-work":
      return parseWedgedWorkFinding(kind, u);
    case "launch-mode":
      return parseLaunchModeFinding(kind, u);
    default: {
      const never: never = kind;
      return { ok: false, reason: `no finding parser for ${String(never)}` };
    }
  }
}

/** Every count `decideRule` used, so a replay can redo its arithmetic rather than take its conclusion. */
function parseCounts(u: Record<string, unknown>, fields: readonly string[]): ParseResult<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const field of fields) {
    const value = u[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return { ok: false, reason: `finding.${field} is not a count` };
    }
    counts[field] = value;
  }
  return { ok: true, value: counts };
}

/** One drifted session off the disk — the address a person would use to go and relaunch it. */
function parseDriftedSession(u: unknown): ParseResult<DriftedSession> {
  if (!isRecord(u)) return { ok: false, reason: "a session is not an object" };
  for (const field of ["id", "name", "mode"] as const) {
    const value = u[field];
    if (typeof value !== "string" || (field !== "name" && value === "")) {
      return { ok: false, reason: `session.${field} is not a name` };
    }
  }
  return { ok: true, value: { id: u["id"] as string, name: u["name"] as string, mode: u["mode"] as string } };
}

/**
 * Rule 1's finding, off the disk.
 *
 * **The four arms are read as four counts.** A parser that summed them, or
 * defaulted a missing one to zero, would turn "two sessions we could not read"
 * into "two sessions that were fine" on the way back out — which is the same
 * collapse the rule refuses to make on the way in, and the reason this is a
 * round trip rather than an append.
 */
function parseLaunchModeFinding(kind: "launch-mode", u: Record<string, unknown>): ParseResult<LaunchModeFinding> {
  const counts = parseCounts(u, ["minSessions", "maxCollectionAgeSeconds", "collectionAgeSeconds", "auto", "notAuto", "cannotTell", "notApplicable", "rows"]);
  if (!counts.ok) return { ok: false, reason: counts.reason };
  const raw = u["sessions"];
  if (!Array.isArray(raw)) return { ok: false, reason: "finding.sessions is not an array" };
  const sessions: DriftedSession[] = [];
  for (const item of raw) {
    const session = parseDriftedSession(item);
    if (!session.ok) return { ok: false, reason: `finding.${session.reason}` };
    sessions.push(session.value);
  }
  return {
    ok: true,
    value: {
      kind,
      minSessions: counts.value["minSessions"] as number,
      maxCollectionAgeSeconds: counts.value["maxCollectionAgeSeconds"] as number,
      collectionAgeSeconds: counts.value["collectionAgeSeconds"] as number,
      auto: counts.value["auto"] as number,
      notAuto: counts.value["notAuto"] as number,
      cannotTell: counts.value["cannotTell"] as number,
      notApplicable: counts.value["notApplicable"] as number,
      rows: counts.value["rows"] as number,
      sessions,
    },
  };
}

/** Rule 2's finding, off the disk. */
function parseWedgedWorkFinding(kind: "wedged-work", u: Record<string, unknown>): ParseResult<WedgedWorkFinding> {
  const policy = u["policy"];
  // Keyed by `KillPolicy`, so a third policy is a compile error here rather than
  // a value this parser silently refuses off the disk. The two-literal `!==`
  // pair it replaces was the same not-exhaustive shape as `RULE_IDS`.
  if (!isKillPolicy(policy)) {
    return { ok: false, reason: `finding.policy ${JSON.stringify(policy)} is not a kill policy` };
  }
  const counts = parseCounts(u, ["minAgeSeconds", "matched", "candidates", "scanned"]);
  if (!counts.ok) return { ok: false, reason: counts.reason };
  const raw = u["processes"];
  if (!Array.isArray(raw)) return { ok: false, reason: "finding.processes is not an array" };
  const processes: WedgedProcess[] = [];
  for (const item of raw) {
    const process = parseWedgedProcess(item);
    if (!process.ok) return { ok: false, reason: `finding.${process.reason}` };
    processes.push(process.value);
  }
  return {
    ok: true,
    value: {
      kind,
      policy,
      minAgeSeconds: counts.value["minAgeSeconds"] as number,
      matched: counts.value["matched"] as number,
      candidates: counts.value["candidates"] as number,
      scanned: counts.value["scanned"] as number,
      processes,
    },
  };
}

/**
 * The rule ids this version knows.
 *
 * **A `Record<RuleId, true>` rather than an array**, so adding a rule without
 * teaching the parser about it does not compile. It was
 * `["wedged-work"] satisfies RuleId[]`, which checks that the members ARE rule
 * ids and says nothing about whether they are ALL of them — the same
 * not-exhaustive hole as the destructure SC-4 was about, in a different
 * costume. Found while adding the second rule, which is the only moment it
 * could have been found.
 */
const RULE_IDS: Record<RuleId, true> = { "wedged-work": true, "launch-mode": true };

/** The kill policies this version can read back. Keyed by the type, for the reason `RULE_IDS` gives. */
const KILL_POLICIES: Record<KillPolicy, true> = { "safe-to-kill": true, "test-suites": true };

function isKillPolicy(u: unknown): u is KillPolicy {
  return typeof u === "string" && Object.hasOwn(KILL_POLICIES, u);
}

function isRuleId(u: unknown): u is RuleId {
  return typeof u === "string" && Object.hasOwn(RULE_IDS, u);
}

/**
 * How a rule's run ended, off the disk.
 *
 * **Every arm is named**, and a kind this version does not know is refused
 * rather than flattened into `failed`: "the rule was refused" and "the rule
 * broke" are the two a reader must not confuse, and a parser with a permissive
 * fallback is where that confusion would be introduced.
 */
/**
 * WHICH SENTENCE EACH ENDING CARRIES — a table keyed by the arm, so a sixth
 * outcome does not compile until somebody says how it is read back.
 *
 * It was a `switch` on a raw string, which the compiler does not tie to
 * `RuleOutcome["kind"]` at all: a new arm would have appended fine and come back
 * as *"not one this version knows"*, taking the whole event with it. Same
 * not-exhaustive shape as the `satisfies` array below it used to be, and GPT
 * Sol found both in one pass.
 */
const RULE_OUTCOME_FIELDS: Record<RuleOutcome["kind"], "why" | "what"> = {
  "nothing-to-do": "why",
  refused: "why",
  failed: "why",
  proposed: "what",
  sent: "what",
};

function isRuleOutcomeKind(u: unknown): u is RuleOutcome["kind"] {
  return typeof u === "string" && Object.hasOwn(RULE_OUTCOME_FIELDS, u);
}

function parseRuleOutcome(u: unknown): ParseResult<RuleOutcome> {
  if (!isRecord(u)) return { ok: false, reason: "outcome is not an object" };
  const kind = u["kind"];
  if (!isRuleOutcomeKind(kind)) return { ok: false, reason: `outcome kind ${JSON.stringify(kind)} is not one this version knows` };
  const field = RULE_OUTCOME_FIELDS[kind];
  const sentence = u[field];
  if (typeof sentence !== "string") return { ok: false, reason: `outcome.${field} is not a string` };
  // The cast is the mapped table's own guarantee written out: `kind` and
  // `field` came from one entry, so the pair is exactly one arm of the union,
  // which TypeScript cannot see through a computed key.
  return { ok: true, value: { kind, [field]: sentence } as RuleOutcome };
}

/** One rule event off the disk. The occurrence id is opaque here: the run it belongs to is addressed by it, and `parseJobEvent` is what checks the id against its own key. */
function parseRuleEvent(kind: RuleEvent["kind"], u: Record<string, unknown>, at: string): ParseResult<RuleEvent> {
  const id = u["occurrenceId"];
  if (!isName(id)) return { ok: false, reason: "occurrenceId is not an id" };
  const occurrenceId = id as OccurrenceId;
  const ruleId = u["ruleId"];
  if (!isRuleId(ruleId)) return { ok: false, reason: `ruleId ${JSON.stringify(ruleId)} is not a rule this version knows` };
  switch (kind) {
    case "rule-intended": {
      const what = u["what"];
      if (typeof what !== "string") return { ok: false, reason: "what is not a string" };
      const finding = parseFinding(u["finding"]);
      if (!finding.ok) return { ok: false, reason: finding.reason };
      // **THE TWO DISCRIMINANTS HAVE TO AGREE**, and checking each on its own
      // did not make them (GPT Sol's finding 5 on 3b). An event claiming
      // `ruleId: "launch-mode"` with a `wedged-work` finding parsed perfectly
      // and came back as a launch-mode run whose numbers are another rule's
      // arithmetic — a record that reads plausibly and is false, which is the
      // one thing a durable log must not produce.
      if (finding.value.kind !== ruleId) {
        return { ok: false, reason: `ruleId ${JSON.stringify(ruleId)} carries a ${JSON.stringify(finding.value.kind)} finding, so the event contradicts itself` };
      }
      return { ok: true, value: { kind, at, occurrenceId, ruleId, what, finding: finding.value } };
    }
    case "rule-settled": {
      const outcome = parseRuleOutcome(u["outcome"]);
      if (!outcome.ok) return { ok: false, reason: outcome.reason };
      return { ok: true, value: { kind, at, occurrenceId, ruleId, outcome: outcome.value } };
    }
    default: {
      const never: never = kind;
      return { ok: false, reason: `no parser for ${String(never)}` };
    }
  }
}

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

  // THE JOB FAMILY BRANCHES FIRST, and it has to: those arms carry no session
  // key, identity or tmux generation, so the three checks below would refuse
  // every one of them. Inventing a session identity to satisfy a common parser
  // is the alternative, and it would put a fabricated tmux handle into a log
  // whose whole value is that a person can grep it and believe what it says.
  if (isJobKind(kind)) return parseJobEvent(kind, u, at);
  // AND THE RULE FAMILY, FOR THE SAME REASON AND WITH ONE MORE. A rule event
  // carries no session key either — but unlike the job branch above, nothing
  // would have failed to compile if this line were missing, because the switch
  // below casts. See `RULE_KINDS`.
  if (isRuleKind(kind)) return parseRuleEvent(kind, u, at);

  const key = u["key"];
  if (typeof key !== "string" || key === "") return { ok: false, reason: "key is not a session key" };
  const identity = parseIdentity(u["identity"]);
  if (!identity.ok) return { ok: false, reason: identity.reason };
  const tmuxServerPid = u["tmuxServerPid"];
  if (tmuxServerPid !== null && !isPidLike(tmuxServerPid)) {
    return { ok: false, reason: "tmuxServerPid is not a pid or null" };
  }
  const common = { at, key: key as SessionKey, identity: identity.value, tmuxServerPid };

  switch (kind as SessionEvent["kind"]) {
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
    case "session-execution-changed":
      return parseExecutionChanged(u, common);
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
  const verifiedExecution = parseVerifiedExecution(u["verifiedExecution"]);
  if (!verifiedExecution.ok) return { ok: false, reason: verifiedExecution.reason };
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
      verifiedExecution: verifiedExecution.value,
    },
  };
}

/**
 * The last verified run, off a checkpoint.
 *
 * **AN ABSENT FIELD IS `null`, AND THAT IS THE ONE PLACE THIS PARSER IS
 * FORGIVING.** Everything else in `parseRegisterEntry` fails the whole
 * checkpoint, because a malformed field means a file somebody edited. This one
 * is different for one reason and one only: a checkpoint written by the daemon
 * that was running before this field existed has no `verifiedExecution`, and
 * refusing it would throw away the register on the first restart after the
 * deploy — the register being the thing there is no second copy of.
 *
 * **A PRESENT-BUT-WRONG FIELD STILL FAILS.** Absent is an old writer; malformed
 * is a broken one, and the two must not share an outcome. And `null` here means
 * *no run has been verified for this session*, which cannot be mistaken for a
 * verified one however it is read.
 */
function parseVerifiedExecution(u: unknown): ParseResult<RegisterEntry["verifiedExecution"]> {
  if (u === undefined || u === null) return { ok: true, value: null };
  if (!isRecord(u)) return { ok: false, reason: "verifiedExecution is not an object or null" };
  // THE REAL SHAPE, not merely non-empty. Accepting any string made the claim
  // "a present-but-malformed value fails whole" false for every value except
  // `""` — GPT Sol's P2-4b — and this is the register, so a token that parses
  // and means nothing would be compared against real ones for ever.
  const token = u["token"];
  if (!isExecutionTokenText(token)) return { ok: false, reason: "verifiedExecution.token is not an execution token" };
  const since = u["since"];
  if (!isIsoTimestamp(since)) return { ok: false, reason: "verifiedExecution.since is not an ISO timestamp" };
  return { ok: true, value: { token, since } };
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
  const jobs = parseJobs(u["jobs"]);
  if (!jobs.ok) return { ok: false, reason: jobs.reason };
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
      work: parseWork(u["work"], writtenAt),
      usage: parseStoredUsage(u["usage"], writtenAt),
      jobs: { occurrences: jobs.value },
      scheduler: parseStoredScheduler(u["scheduler"], writtenAt),
      occurrenceHistory: parseOccurrenceHistory(u["occurrenceHistory"]),
      // TOLERANT, and `null` rather than a guess: a reader that invented a
      // deadline here would be doing exactly the independent-tuning this field
      // exists to stop.
      snapshotStaleAfterMs: typeof u["snapshotStaleAfterMs"] === "number" && Number.isFinite(u["snapshotStaleAfterMs"]) && u["snapshotStaleAfterMs"] > 0
        ? u["snapshotStaleAfterMs"]
        : null,
    },
  };
}

/**
 * The scheduler's occurrences out of a checkpoint.
 *
 * **STRICT, where `attention` and `usage` beside it are tolerant**, and the
 * asymmetry is the rule rather than an oversight. Those two are judgements
 * about the world and a missing one is honestly reported as *nobody looked*. An
 * occurrence is a claim that something either did or did not run, and quietly
 * dropping a malformed `reserved` would delete the only record that a job was in
 * flight — after which the scheduler would cheerfully start a second one. So a
 * `jobs` block that will not parse refuses the whole checkpoint, which costs a
 * replay of the log and rebuilds the index from the events themselves.
 *
 * ABSENT is not malformed: a checkpoint written before this field existed has no
 * occurrences to lose, because its log has no occurrence events in it.
 */
function parseJobs(u: unknown): ParseResult<Occurrence[]> {
  if (u === undefined) return { ok: true, value: [] };
  if (!isRecord(u)) return { ok: false, reason: "jobs is not an object" };
  const raw = u["occurrences"];
  if (!Array.isArray(raw)) return { ok: false, reason: "jobs.occurrences is not an array" };
  const occurrences: Occurrence[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of raw.entries()) {
    const parsed = parseOccurrence(entry);
    if (!parsed.ok) return { ok: false, reason: `jobs.occurrences[${index}]: ${parsed.reason}` };
    if (seen.has(parsed.value.id)) return { ok: false, reason: `jobs.occurrences has ${parsed.value.id} twice` };
    seen.add(parsed.value.id);
    occurrences.push(parsed.value);
  }
  return { ok: true, value: occurrences };
}

/** One folded occurrence off the disk. Every field the scheduler reads is checked; the id is recomputed from the key, as it is for the event. */
function parseOccurrence(u: unknown): ParseResult<Occurrence> {
  if (!isRecord(u)) return { ok: false, reason: "not an object" };
  const key = u["key"];
  if (!isRecord(key)) return { ok: false, reason: "key is not an object" };
  const jobId = key["jobId"];
  const scheduledAt = key["scheduledAt"];
  // Either name, for the reason `parseJobEvent` gives: a checkpoint written
  // before the 2026-09-09 rename says `definitionHash` and means this.
  const hash = key["behaviourHash"] ?? key["definitionHash"];
  if (!isName(jobId)) return { ok: false, reason: "key.jobId is not a job id" };
  if (!isIsoTimestamp(scheduledAt)) return { ok: false, reason: "key.scheduledAt is not an ISO timestamp" };
  if (!isName(hash)) return { ok: false, reason: "key.behaviourHash is not a hash" };
  const parsedKey = { jobId, scheduledAt, behaviourHash: hash as BehaviourHash };
  const id = u["id"];
  const expected = occurrenceIdOf(parsedKey);
  if (id !== expected) return { ok: false, reason: `id ${JSON.stringify(id)} is not the id of its own key (${expected})` };
  const reservedAt = u["reservedAt"];
  const instanceId = u["instanceId"];
  const what = u["what"];
  if (!isIsoTimestamp(reservedAt)) return { ok: false, reason: "reservedAt is not an ISO timestamp" };
  if (!isName(instanceId)) return { ok: false, reason: "instanceId is not an instance id" };
  if (typeof what !== "string") return { ok: false, reason: "what is not a string" };
  const common = { id: expected, key: parsedKey, reservedAt, instanceId, what };
  const kind = u["kind"];
  switch (kind) {
    case "reserved":
    case "started": {
      const leaseUntil = u["leaseUntil"];
      if (!isIsoTimestamp(leaseUntil)) return { ok: false, reason: "leaseUntil is not an ISO timestamp" };
      if (kind === "reserved") return { ok: true, value: { kind, ...common, leaseUntil } };
      const startedAt = u["startedAt"];
      const pid = u["pid"];
      if (!isIsoTimestamp(startedAt)) return { ok: false, reason: "startedAt is not an ISO timestamp" };
      if (!isPidLike(pid)) return { ok: false, reason: "pid is not a pid" };
      return { ok: true, value: { kind, ...common, leaseUntil, startedAt, pid } };
    }
    case "finished": {
      const finishedAt = u["finishedAt"];
      if (!isIsoTimestamp(finishedAt)) return { ok: false, reason: "finishedAt is not an ISO timestamp" };
      const outcome = parseOutcome(u["outcome"]);
      if (!outcome.ok) return { ok: false, reason: outcome.reason };
      return { ok: true, value: { kind, ...common, finishedAt, outcome: outcome.value } };
    }
    case "refused": {
      const refusedAt = u["refusedAt"];
      const why = u["why"];
      if (!isIsoTimestamp(refusedAt)) return { ok: false, reason: "refusedAt is not an ISO timestamp" };
      if (typeof why !== "string") return { ok: false, reason: "why is not a string" };
      return { ok: true, value: { kind, ...common, refusedAt, why } };
    }
    case "unknown": {
      const why = u["why"];
      if (typeof why !== "string") return { ok: false, reason: "why is not a string" };
      const source = u["source"];
      if (!isRecord(source)) return { ok: false, reason: "source is not an object" };
      if (source["kind"] === "derived") {
        return { ok: true, value: { kind, ...common, why, source: { kind: "derived" } } };
      }
      const noticedAt = source["noticedAt"];
      if (source["kind"] !== "recorded" || !isIsoTimestamp(noticedAt)) {
        return { ok: false, reason: "source is neither derived nor recorded-with-an-instant" };
      }
      return { ok: true, value: { kind, ...common, why, source: { kind: "recorded", noticedAt } } };
    }
    default:
      return { ok: false, reason: `kind ${JSON.stringify(kind)} is not an occurrence state this version knows` };
  }
}

/**
 * Read the usage report back, **degrading rather than failing the checkpoint** —
 * the same decision as `parseAttentionList` below and for the same reason: the
 * report is regenerated by the next scan, so a malformed one that forced a full
 * log replay would pay the expensive remedy for the cheap problem.
 *
 * **The body is parsed by `usage.ts`, not here, and that is deliberate.** A
 * `UsageReport` is an account, a cache reading union, a scan union carrying an
 * array of rejections, and a verdict whose `activeLimit` is a nullable one of
 * those. Every arm of that is knowledge the producer has and this file does not,
 * and a consumer-written parser is a second hand-written declaration of one type
 * — the class this whole seam exists to refuse. It fails in the quiet direction
 * too: a field silently absent reads as a report that merely says less. Same
 * argument that put `RateLimitHit.id` on the producer rather than having this
 * file compose a key by hand.
 *
 * So this function owns exactly two things — that the wrapper is well-formed, and
 * that **every failure becomes `none` with a reason** rather than a report that
 * says nothing is wrong.
 */
function parseStoredUsage(u: unknown, writtenAt: string): StoredUsage {
  if (u === undefined) {
    return {
      kind: "none",
      why: "this checkpoint carries no usage report: it was written before the Overseer had one.",
      at: writtenAt,
    };
  }
  const bad = (why: string): StoredUsage => ({ kind: "none", why: `the stored usage report was unusable: ${why}`, at: writtenAt });
  if (!isRecord(u)) return bad("it is not an object");
  if (u["kind"] === "none") {
    return typeof u["why"] === "string" && isIsoTimestamp(u["at"])
      ? { kind: "none", why: u["why"], at: u["at"] }
      : bad("a none arm with no reason or no instant");
  }
  if (u["kind"] !== "report") return bad(`kind ${JSON.stringify(u["kind"])} is neither "report" nor "none"`);
  const report = parseUsageReport(u["report"]);
  // `null` on the FIRST mismatch rather than a partial report: a half-parsed
  // reading is the one thing worse than no reading, because it is indistinguishable
  // from a complete one that found less.
  return report === null ? bad("the report is not one this build can read") : { kind: "report", report };
}

/**
 * Read the scheduler block back, **degrading rather than failing the
 * checkpoint** — the same rule `attention` and `usage` follow, and for the same
 * reason: this is one sentence for a person, and losing the whole register over
 * it would be wildly out of proportion.
 *
 * What it degrades TO is `unknown`, never `off`. "Nobody said" and "somebody
 * said no" are different claims, and only one of them is safe to invent.
 */
function parseStoredScheduler(u: unknown, writtenAt: string): StoredScheduler {
  if (u === undefined) {
    return {
      kind: "unknown",
      why: "this checkpoint carries no scheduler block: it was written before the Overseer had a scheduler.",
      at: writtenAt,
    };
  }
  const bad = (why: string): StoredScheduler => ({ kind: "unknown", why: `the stored scheduler block was unusable: ${why}`, at: writtenAt });
  if (!isRecord(u)) return bad("it is not an object");
  const kind = u["kind"];
  if (kind !== "armed" && kind !== "blocked" && kind !== "off" && kind !== "unknown") return bad(`kind ${JSON.stringify(kind)} is not one this build knows`);
  const why = u["why"];
  const at = u["at"];
  if (typeof why !== "string") return bad("it has no reason");
  if (!isIsoTimestamp(at)) return bad("it has no instant");
  return { kind, why, at };
}

/**
 * Read a stored occurrence-history verdict back.
 *
 * **`null` for anything it cannot read, never `intact`.** Inventing `intact`
 * would clear a hold on the strength of a field this build could not parse,
 * which is the failure the field exists to prevent; `null` means *this
 * checkpoint makes no claim*, and the opening recomputes from the log.
 */
function parseOccurrenceHistory(u: unknown): OccurrenceHistory | null {
  if (!isRecord(u)) return null;
  if (u["kind"] === "intact") return { kind: "intact" };
  if (u["kind"] === "lost" && typeof u["why"] === "string") return { kind: "lost", why: u["why"] };
  return null;
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
  // ABSENT IS NOT ZERO, and reading it as zero was the bug a cross-family review
  // of the dashboard's half found here. The first version reasoned correctly that
  // a producer which never had this field "made no claim either way" — and then
  // substituted 0, which is a positive claim that every session it scanned was
  // judged. That is the completeness claim this field exists to WITHHOLD, arriving
  // through the parser rather than from anything that looked.
  //
  // So the list degrades to `unknown` rather than being invented or refused
  // outright. It keeps this parser's proportionality rule — the whole checkpoint
  // survives, and the register with it — and it self-clears on the next pass two
  // minutes later. The items are lost, which is the honest cost: they are real,
  // but a list that cannot say how much it failed to read is not a list anybody
  // can act on. See docs/project/overseer-direction.md and the same principle in
  // `absenceGap` and the dashboard's `unknown` band.
  const unreadable = u["sessionsUnreadable"];
  if (unreadable === undefined) {
    return bad("sessionsUnreadable is absent, and a list that does not say how much it failed to judge cannot be read as having judged everything");
  }
  if (!isNonNegativeInteger(unreadable)) return bad("sessionsUnreadable is not a count");
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
    sessionsUnreadable: unreadable,
    scannedAt,
  };
}

/**
 * Read a work measurement back, degrading rather than failing the checkpoint.
 *
 * The register has no second copy, so one bad entry takes the checkpoint down
 * and the log is replayed. This field is regenerated by the next accepted
 * inventory for the price of one `ps`, so replay would be the expensive remedy
 * for the cheap problem. Every malformed value becomes `not-yet-run` with the
 * cause; it must never become an empty scan, which would claim the probe looked.
 */
function parseWork(u: unknown, writtenAt: string): OverseerWork {
  const bad = (why: string): OverseerWork => ({
    kind: "not-yet-run",
    why: `the stored work reading was unusable: ${why}. Nothing has been inferred from it.`,
    at: writtenAt,
  });
  if (u === undefined) return bad("this checkpoint was written before the Overseer carried one");
  if (!isRecord(u)) return bad("it is not an object");
  const kind = u["kind"];
  if (kind === "not-yet-run") {
    const why = u["why"];
    const at = u["at"];
    if (typeof why !== "string") return bad("a not-yet-run reading has no reason");
    if (!isIsoTimestamp(at)) return bad("a not-yet-run reading has no ISO instant");
    return { kind, why, at };
  }
  if (kind === "probe-failed") {
    const why = u["why"];
    const attemptedAt = u["attemptedAt"];
    const sourceCollectedAt = u["sourceCollectedAt"];
    if (typeof why !== "string") return bad("a failed probe has no reason");
    if (!isIsoTimestamp(attemptedAt)) return bad("attemptedAt is not an ISO timestamp");
    if (!isIsoTimestamp(sourceCollectedAt)) return bad("sourceCollectedAt is not an ISO timestamp");
    return { kind, why, attemptedAt, sourceCollectedAt };
  }
  if (kind !== "scan") return bad(`kind ${JSON.stringify(kind)} is not one this build knows`);
  const scannedAt = u["scannedAt"];
  const sourceCollectedAt = u["sourceCollectedAt"];
  if (!isIsoTimestamp(scannedAt)) return bad("scannedAt is not an ISO timestamp");
  if (!isIsoTimestamp(sourceCollectedAt)) return bad("sourceCollectedAt is not an ISO timestamp");
  const rawPanes = u["panes"];
  if (!Array.isArray(rawPanes)) return bad("panes is not an array");
  const panes: { key: string; work: PaneWork }[] = [];
  const seen = new Set<string>();
  for (const [index, rawPane] of rawPanes.entries()) {
    if (!isRecord(rawPane)) return bad(`panes[${index}] is not an object`);
    const key = rawPane["key"];
    if (typeof key !== "string") return bad(`panes[${index}].key is not a string`);
    if (seen.has(key)) return bad(`panes has ${key} twice`);
    seen.add(key);
    const work = parsePaneWork(rawPane["work"]);
    if (!work.ok) return bad(`panes[${index}].work: ${work.reason}`);
    panes.push({ key, work: work.value });
  }
  return { kind, scannedAt, sourceCollectedAt, panes };
}

function parsePaneWork(u: unknown): ParseResult<PaneWork> {
  if (!isRecord(u)) return { ok: false, reason: "it is not an object" };
  const kind = u["kind"];
  if (kind === "cannot-tell") {
    const cause = u["cause"];
    const why = u["why"];
    if (typeof cause !== "string") return { ok: false, reason: "cannot-tell.cause is not a string" };
    if (typeof why !== "string") return { ok: false, reason: "cannot-tell.why is not a string" };
    return { ok: true, value: { kind, cause, why } };
  }
  if (kind !== "none" && kind !== "work") {
    return { ok: false, reason: `kind ${JSON.stringify(kind)} is neither cannot-tell, none nor work` };
  }
  const inspected = u["inspected"];
  const paneCommand = u["paneCommand"];
  const paneStartedAt = u["paneStartedAt"];
  if (!isNonNegativeInteger(inspected)) return { ok: false, reason: "inspected is not a count" };
  if (typeof paneCommand !== "string") return { ok: false, reason: "paneCommand is not a string" };
  if (!isIsoTimestamp(paneStartedAt)) return { ok: false, reason: "paneStartedAt is not an ISO timestamp" };
  if (kind === "none") return { ok: true, value: { kind, inspected, paneCommand, paneStartedAt } };
  const rawJobs = u["jobs"];
  if (!Array.isArray(rawJobs) || rawJobs.length === 0) {
    return { ok: false, reason: "work.jobs is not a non-empty array" };
  }
  const jobs: PaneJob[] = [];
  for (const [index, rawJob] of rawJobs.entries()) {
    const job = parsePaneJob(rawJob);
    if (!job.ok) return { ok: false, reason: `jobs[${index}]: ${job.reason}` };
    jobs.push(job.value);
  }
  const [first, ...rest] = jobs;
  // The length check above already refused an empty array; this is how that fact
  // reaches the TYPE, so the wire's non-empty tuple needs no cast to be satisfied.
  if (first === undefined) return { ok: false, reason: "work.jobs is not a non-empty array" };
  return { ok: true, value: { kind, jobs: [first, ...rest], inspected, paneCommand, paneStartedAt } };
}

function parsePaneJob(u: unknown): ParseResult<PaneJob> {
  if (!isRecord(u)) return { ok: false, reason: "it is not an object" };
  const recogniser = u["recogniser"];
  const label = u["label"];
  const startedAt = u["startedAt"];
  const ranForMs = u["ranForMs"];
  const pid = u["pid"];
  const depth = u["depth"];
  const command = u["command"];
  if (typeof recogniser !== "string") return { ok: false, reason: "recogniser is not a string" };
  if (typeof label !== "string") return { ok: false, reason: "label is not a string" };
  if (startedAt !== null && !isIsoTimestamp(startedAt)) {
    return { ok: false, reason: "startedAt is not an ISO timestamp or null" };
  }
  if (ranForMs !== null && (typeof ranForMs !== "number" || !Number.isFinite(ranForMs) || ranForMs < 0)) {
    return { ok: false, reason: "ranForMs is not a non-negative duration or null" };
  }
  if (!isPidLike(pid)) return { ok: false, reason: "pid is not an integer process id" };
  if (!isNonNegativeInteger(depth) || depth === 0) return { ok: false, reason: "depth is not a positive integer" };
  if (typeof command !== "string") return { ok: false, reason: "command is not a string" };
  return { ok: true, value: { recogniser, label, startedAt, ranForMs, pid, depth, command } };
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
      case "session-execution-changed": {
        const was = into.get(event.key);
        if (was !== undefined) {
          into.set(event.key, {
            ...was,
            verifiedExecution: { token: event.token, since: event.at },
            lastSeenAlive: event.at,
            // **THE AGE RESETS ON EVERY ARM, INCLUDING A FIRST SIGHTING**, and
            // the version that did not was GPT Sol's second-round P1.
            //
            // It read: a null `previousToken` is the one-time migration case, so
            // preserve the age rather than wiping every duration on the box at
            // deploy. That is true of the migration and **false of the other
            // case null covers** — a session registered while its execution was
            // unknown, whose harness was replaced during the blind interval, and
            // whose first verified reading is therefore already the NEW run. One
            // null cannot carry both decisions, and preserving the age there
            // hands run B the age of run A: the original failure class, narrowed
            // to sessions we could not see for a while.
            //
            // So it resets unconditionally. What that costs is real and is a
            // one-off: on the first collection after this ships, every session
            // learns its token and its measured age becomes a floor. What it
            // buys is that `statusSince` after this stage means *how long THIS
            // RUN has been in this state*, with no arm where it silently means
            // something else. The measured age we would have kept was a fact
            // about the SESSION, and this field stopped being about the session
            // the moment execution identity existed.
            statusSince: { kind: "lower-bound", at: event.at },
          });
        }
        break;
      }
      // THE SCHEDULER'S ARMS, NAMED AND DECIDED RATHER THAN DEFAULTED. The
      // register is sessions and an occurrence is not one, so nothing happens
      // here — and it says so, because a `default:` would absorb them and would
      // absorb the next arm anybody adds. Occurrences fold in `foldOccurrences`
      // (jobs.ts), out of the same events, into a different index; `Store` calls
      // both on every append.
      case "job-occurrence-reserved":
      case "job-occurrence-started":
      case "job-occurrence-finished":
      case "job-occurrence-refused":
      case "job-occurrence-unknown":
      // AND THE RULES'. A rule's finding is about the fleet and not about one
      // session, so it moves no register entry — the arms are named here so
      // that stays a decision somebody took rather than something a `default:`
      // absorbed.
      case "rule-intended":
      case "rule-settled":
        break;
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
    // A FLOOR TOO, and for exactly the same reason: this run was already going
    // when we first saw it, so `since` is when the register learned about it
    // rather than when the process started. The token itself is exact; the
    // clock beside it is not.
    verifiedExecution: row.execution.kind === "verified" ? { token: executionTokenText(row.execution.token), since: at } : null,
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
 *  - `execution` — `session-execution-changed`, and a first sighting. Its own
 *    class rather than folded into `pane`, because the whole point of the field
 *    is that a run can be replaced while the pane is not: sharing an owner with
 *    `paneId`/`panePid` would say the opposite of what it is for. It is the one
 *    field whose arm ALSO writes a `clock` field — `statusSince` back to a
 *    floor, because a new run has not been in its state for its predecessor's
 *    hours.
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
  verifiedExecution: "execution",
} as const satisfies Record<keyof RegisterEntry, "identity" | "row" | "pane" | "clock" | "execution">;

export function describeOpening(opening: StoreOpening): string {
  const repair = opening.repair.torn
    ? ` A torn final line of ${opening.repair.droppedBytes} bytes was truncated.`
    : "";
  const unreadable = opening.unreadableLines > 0 ? ` ${opening.unreadableLines} log lines were unreadable.` : "";
  const scanned = ` Read ${opening.bytesScanned} bytes of the log.`;
  // SAID EVERY TIME IT IS TRUE, and never left to the reader to infer from
  // `cold`: a held scheduler that nobody was told about is a scheduler that
  // silently stopped running, which is the thing this field exists to prevent.
  const ledger =
    opening.occurrenceHistory.kind === "lost"
      ? ` SCHEDULED JOBS ARE HELD: ${opening.occurrenceHistory.why}.`
      : opening.occurrencesReconciled === undefined
        ? ""
        : ` A held occurrence ledger was reconciled by hand and the hold is cleared: ${opening.occurrencesReconciled}.`;
  switch (opening.start.kind) {
    case "cold":
      return `Started COLD (${opening.start.why}): no baseline and no history, so the next snapshot will look like the whole fleet starting at once.${repair}${unreadable}${scanned}${ledger}`;
    case "rebuilt":
      return `Rebuilt the register from the event log (${opening.start.why}): ${opening.eventsReplayed} events replayed.${repair}${unreadable}${scanned}${ledger}`;
    case "resumed":
      return `Resumed from a checkpoint written ${opening.start.checkpointWrittenAt}, ${opening.eventsReplayed} events replayed past its cursor.${repair}${unreadable}${scanned}${ledger}`;
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
  readonly occurrenceHistory: OccurrenceHistory;
  private readonly registerMap: Map<SessionKey, RegisterEntry>;
  /** The second fold over the same events. See `OverseerStore.occurrences`. */
  private readonly occurrenceMap: Map<OccurrenceId, Occurrence>;
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
  /**
   * The last work measurement a caller handed in, held only across writes in
   * this process and never restored across a restart. A process-tree reading is
   * true of one instant; republishing a pre-restart one would claim an
   * observation this daemon never took. This is `attention`'s rule, not
   * `usageHeld`'s durable-text rule.
   */
  private work: OverseerWork;
  /**
   * The last usage report, **restored from the previous checkpoint** — the
   * opposite of `attention` above, and the contrast is the rule rather than an
   * inconsistency.
   *
   * A wait is about **continuous observation**: `waitingSince` is a first-seen
   * instant, and a gap we were absent for is a gap in which the question may have
   * been answered, so republishing it claims a wait nobody watched. A rate-limit
   * rejection is about **text**, and carries its own machine-readable
   * `resetsAt`: it was true before the restart and it is true after it. Throwing
   * it away would mean re-reading 2.9 GB to learn something we already knew.
   *
   * What it is NOT is fresh. `collectedAt` inside the report says when it was
   * taken and `account` says whose it was, so a restored report that is now stale
   * or belongs to a different login is visible as such rather than remembered as
   * a fact — the judgement is the pass's, which has both halves.
   */
  private usageHeld: StoredUsage;
  /**
   * What the last write said about the scheduler.
   *
   * **NOT restored from the previous checkpoint**, unlike `usageHeld` above and
   * for the opposite reason to it: a usage reading was true before the restart
   * and is true after it, while "the scheduler is armed" is a fact about a
   * process that no longer exists. Inheriting it would let a dead daemon's
   * arming vouch for this one's.
   */
  private schedulerHeld: StoredScheduler;
  /** The last deadline a caller declared, or null if none has. Held like the two above so a write that omits it does not blank it. */
  private snapshotStaleAfterMsHeld: number | null = null;
  private closed = false;

  constructor(input: {
    root: string;
    lock: HeldLock;
    now: () => Date;
    opening: StoreOpening;
    register: Map<SessionKey, RegisterEntry>;
    occurrences: Map<OccurrenceId, Occurrence>;
    occurrenceHistory: OccurrenceHistory;
    fd: number;
    bytes: number;
    events: number;
    /** From the previous checkpoint when there was a readable one; absent on a cold or rebuilt start. */
    usage?: StoredUsage;
  }) {
    this.root = input.root;
    this.lock = input.lock;
    this.instanceId = input.lock.holder.instanceId;
    this.nowFn = input.now;
    this.opening = input.opening;
    this.registerMap = input.register;
    this.occurrenceMap = input.occurrences;
    this.occurrenceHistory = input.occurrenceHistory;
    this.fd = input.fd;
    this.bytes = input.bytes;
    this.events = input.events;
    this.attention = attentionNotYetRun(input.now().toISOString());
    this.work = workNotYetRun(input.now().toISOString());
    this.usageHeld = input.usage ?? usageNotYetRun(input.now().toISOString());
    this.schedulerHeld = schedulerNotYetSaid(input.now().toISOString());
  }

  get register(): SessionRegister {
    return this.registerMap;
  }

  get occurrences(): OccurrenceIndex {
    return this.occurrenceMap;
  }

  /** What a usage pass has to compare its fresh reading against. See `OverseerStore.usage`. */
  get usage(): StoredUsage {
    return this.usageHeld;
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
      // BOTH FOLDS, OVER THE SAME BATCH AND AFTER THE SAME `fsync`. The second
      // one is why the scheduler can ask the store what has run instead of
      // remembering it: an occurrence reaches the index only once its event is
      // on the disk, so a reservation that is visible is a reservation that
      // survived the crash it was written for.
      foldOccurrences(events, this.occurrenceMap, this.instanceId);
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
      // A measurement held across ordinary writes keeps its own scan clock, so
      // it cannot pass itself off as having been refreshed by the heartbeat.
      work: update.work ?? this.work,
      // Same rule as the list above, and it matters more here because the scan
      // is 30-45 seconds rather than a few model calls: most writes carry no new
      // report, and holding the last one is right because an account has not
      // stopped being rate-limited just because nobody looked.
      usage: update.usage ?? this.usageHeld,
      // FROM THE FOLD, like the register and for the same reason: a caller
      // cannot hand in a list of occurrences that disagrees with the log it was
      // folded from.
      jobs: { occurrences: [...this.occurrenceMap.values()] },
      // From the caller like `attention` and `usage`, and for the same reason:
      // whether a scheduler was armed is a fact about how the daemon was
      // started, which this file cannot see.
      scheduler: update.scheduler ?? this.schedulerHeld,
      snapshotStaleAfterMs: update.snapshotStaleAfterMs ?? this.snapshotStaleAfterMsHeld,
      // FROM THE STORE, never from the caller: whether the ledger is whole is
      // this file's own finding, and a caller able to overwrite it could clear a
      // hold it did not resolve.
      occurrenceHistory: this.occurrenceHistory,
    };
    if (update.attention !== undefined) this.attention = update.attention;
    if (update.work !== undefined) this.work = update.work;
    if (update.usage !== undefined) this.usageHeld = update.usage;
    if (update.scheduler !== undefined) this.schedulerHeld = update.scheduler;
    if (update.snapshotStaleAfterMs !== undefined) this.snapshotStaleAfterMsHeld = update.snapshotStaleAfterMs;
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
    // THE SECOND FOLD, AND THE INSTANCE ID IS THE POINT. `lock.holder.instanceId`
    // belongs to the daemon starting right now, so every reservation in the log
    // written by an earlier one derives as `unknown` — which is the honest
    // reading of "reserved, and then the daemon that reserved it stopped
    // existing". A fold that did not know whose instance it was would read those
    // as runs in flight and hold their jobs for ever.
    const occurrences = new Map<OccurrenceId, Occurrence>();
    let events: number;
    // THE LEDGER'S OWN VERDICT ON THIS START, separate from `start` because the
    // two answer different questions. `cold` says *there was no baseline to
    // resume from*, which is a perfectly ordinary first run; this says *some of
    // what has already happened is unreadable*, which is not, and the scheduler
    // refuses to dispatch on it (GPT Sol's C3). Only the paths that actually
    // lose history say so:
    //
    //  - a refused replay (a hole in the log, or a range too large to read) —
    //    those bytes contain occurrence events nobody can account for;
    //  - a checkpoint whose cursor is past the end of the log, which means the
    //    log SHRANK under it: a truncation, a hand-edit, a restored backup.
    //
    // A first start with no log at all is `intact`: there is nothing to have
    // lost. So is a rebuild from a full, readable log, because the checkpoint it
    // could not use was only ever a fold of those same bytes.
    let occurrenceHistory: OccurrenceHistory = { kind: "intact" };
    if (replayed.kind === "refused") {
      occurrenceHistory = {
        kind: "lost",
        why:
          `the event log could not be replayed (${replayed.why}), so what has already run cannot be reconstructed; ` +
          "scheduled jobs are held rather than dispatched, because an empty ledger reads as \"nothing has ever run\"",
      };
    } else if (read.kind === "checkpoint" && read.checkpoint.cursor.bytes > size) {
      occurrenceHistory = {
        kind: "lost",
        why:
          `the checkpoint's cursor is ${read.checkpoint.cursor.bytes} bytes into a log that is only ${size} long, ` +
          "so the log has been truncated or replaced under it and part of what has already run is gone; " +
          "scheduled jobs are held rather than dispatched",
      };
    } else if (read.kind === "checkpoint" && read.checkpoint.occurrenceHistory?.kind === "lost") {
      // INHERITED, and this is the line that makes the hold worth anything. An
      // earlier start lost history and then wrote a perfectly ordinary
      // checkpoint whose cursor sits at the end of the log — so this start
      // replays a clean tail onto an empty ledger and would otherwise read as
      // intact. The loss would be laundered by a write nobody decided.
      occurrenceHistory = {
        kind: "lost",
        why: `${read.checkpoint.occurrenceHistory.why} (carried forward from an earlier start; \`overseer reconcile-jobs\` clears it)`,
      };
    }

    // THE ONE WAY OUT, AND IT IS SOMEBODY'S DECISION. Consumed rather than
    // read: a file left in place would turn a decision taken once into a
    // protection permanently off, which is how a gate stops meaning anything.
    let reconciled: string | null = null;
    if (occurrenceHistory.kind === "lost") {
      const reconcilePath = join(root, RECONCILE_FILE);
      if (existsSync(reconcilePath)) {
        let why = "no reason was given";
        try {
          const parsed: unknown = JSON.parse(readFileSync(reconcilePath, "utf8"));
          if (isRecord(parsed) && typeof parsed["why"] === "string") why = parsed["why"];
        } catch {
          /* An unreadable reconcile file still reconciles: somebody put it there on purpose, and refusing it would leave them with no way out at all. */
        }
        try {
          unlinkSync(reconcilePath);
        } catch {
          /* Gone already, which is the state we wanted. */
        }
        reconciled = why;
        occurrenceHistory = { kind: "intact" };
      }
    }

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
      // THROUGH `adoptOccurrence`, not straight in: the checkpoint stores a fold,
      // and the fold called it `reserved` because the instance that wrote it was
      // the one folding. Restoring that verbatim would carry "in flight" across
      // the restart that disproves it.
      for (const occurrence of usable.jobs.occurrences) {
        const adopted = adoptOccurrence(occurrence, lock.holder.instanceId);
        occurrences.set(adopted.id, adopted);
      }
      foldEvents(replayed.events, register);
      foldOccurrences(replayed.events, occurrences, lock.holder.instanceId);
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
      foldOccurrences(replayed.events, occurrences, lock.holder.instanceId);
      events = replayed.events.length;
      // COLD means there was nothing to rebuild FROM, not merely that the
      // checkpoint was missing: a daemon that replayed a thousand events has a
      // baseline and should not announce itself as having none.
      start = replayed.events.length > 0 ? { kind: "rebuilt", why } : { kind: "cold", why };
    }

    const opening: StoreOpening = {
      start,
      occurrenceHistory,
      ...(reconciled === null ? {} : { occurrencesReconciled: reconciled }),
      repair,
      eventsReplayed: replayed.kind === "read" ? replayed.events.length : 0,
      unreadableLines: replayed.unreadable,
      bytesScanned: replayed.bytesScanned,
    };
    return {
      ok: true,
      store: new Store({
        root,
        lock,
        now,
        opening,
        register,
        occurrences,
        occurrenceHistory,
        fd,
        bytes: size,
        events,
        // RESTORED ACROSS A RESTART, which is the opposite of what `attention`
        // does two fields away — and the contrast is the rule, not an
        // inconsistency. A wait is about CONTINUOUS OBSERVATION: a question's
        // first-seen instant cannot survive a gap in which it may have been
        // answered. A rate-limit rejection is about TEXT, with a machine-readable
        // `resetsAt`: it was true before the restart, it is true after it, and
        // re-finding it costs 30-45 seconds of reading 2.9 GB.
        //
        // Only from a checkpoint we could actually read. A rebuilt or cold start
        // has no report and must say so rather than inherit one. Spread rather
        // than `: undefined`, so the key is ABSENT rather than present-and-empty —
        // `exactOptionalPropertyTypes` is on precisely so those two cannot be
        // confused, and this is the case it is guarding.
        ...(read.kind === "checkpoint" ? { usage: read.checkpoint.usage } : {}),
      }),
    };
  } catch (cause) {
    release();
    throw cause;
  }
}
