/**
 * The recovery journal: what was running when the world went away, written down
 * before the removal that would otherwise erase it.
 *
 * docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md
 * is the design. This module is its pure half — the two event arms, the rule
 * for which disappearances deserve one, the id, the fold, the caps, and the
 * one-time derivation over logs that predate the arms. **Nothing here does I/O**
 * and nothing here starts, resumes or offers to resume anything: the next
 * roadmap stage consumes what this one records.
 *
 * ## Why it exists at all
 *
 * The register is *what is running now*: `foldEvents` in store.ts DELETES an
 * entry on `tmux-session-gone`. After a reboot the first accepted collection has
 * no tmux server, so it arrives as `rows: []`, `diff()` closes every session, and
 * the fold deletes all of them in the same append. From that moment nothing in
 * `current.json` says what was interrupted. The facts are still in the log, but
 * scattered, and nothing gathers them back up. So the removal now carries its
 * own evidence: a `recovery-candidate` immediately before the gone, in the same
 * write, holding the register's final entry for that session.
 *
 * ## Why the daemon writes candidates and `diff()` does not
 *
 * `diff()` is pure and knows nothing about the register, on purpose — its whole
 * module is built around comparing two snapshots and nothing else. But the one
 * thing a candidate must carry, the FINAL COMPLETE ENTRY, lives only in
 * `store.register`, and it lives there only until the batch is folded. So the
 * insertion is a separate pure function, `withRecoveryCandidates`, that the
 * daemon calls on the batch it is about to append, with the register as it
 * stood before that batch. Teaching `diff()` about the register would have
 * given it a third input with a clock of its own, which is the shape
 * `KnownExecutions` already had to argue its way past.
 *
 * ## Why the id excludes the arrival time
 *
 * A candidate is re-derived after some crashes, and a re-derived one must fold
 * onto the original rather than beside it. `at` is when the collection ARRIVED,
 * which a restart changes. So the id is the previous RUN — key, tmux generation,
 * start time, last verified token — plus the COLLECTION that removed it (the
 * dashboard run and inventory number when stamped, else its `collectedAt`).
 * Two distinct disappearances of one run therefore get two ids (GPT Sol's F3:
 * keyed on the run alone, a later real reboot hashed onto an earlier dismissed
 * `unknown` and vanished), and one disappearance noticed twice gets one.
 *
 * ## Why a separate file, and a third fold
 *
 * The recovery index is held beside the register and the occurrence index,
 * folded from the same events on every append — but persisted in its own
 * `recovery.json` with its own byte cursor, not in `current.json`. The
 * dashboard parses `current.json` on every poll, and this index only grows until
 * somebody dismisses things. store.ts § `RECOVERY_FILE` has the crash order.
 */
import { createHash } from "node:crypto";

import type { ConversationReading, HarnessKind } from "../fleet/wire.js";
import { executionTokenText } from "../fleet/execution-token.js";
import {
  generationRelation,
  identityOf,
  sessionKey,
  statusKey,
  type GenerationRelation,
  type GoneReason,
  type OverseerEvent,
  type SessionKey,
} from "./diff.js";
import type { ObservedRow, SourceOrdering } from "./observation.js";
import type { RegisterEntry } from "./store.js";

/**
 * A candidate's id. Branded, because the log already carries three kinds of
 * opaque string id and mixing two of them up costs a record, not a crash.
 *
 * `rc-` for one the daemon wrote; `rl-` for one derived from a log that
 * predates the event. The prefix is for a person grepping — the fold never
 * reads it.
 */
export type RecoveryCandidateId = string & { readonly __brand: "overseer-recovery-candidate-id" };

/**
 * Whether the dashboard run changed between the baseline and the removing
 * collection — the 260910d producer stamp. `cannot-tell` when either side is
 * unstamped or unreadable, or there was no baseline.
 */
export type ProducerRunRelation = "same" | "changed" | "cannot-tell";

/**
 * The last thing an accepted observation said about the session, from the
 * baseline row — so from the daemon's own last collection, and never from
 * before a gap it did not watch.
 */
export type RecoveryLastSeen = {
  /** The canonical status key — `working`, `no-claude`, `shell:true` — never the status object. */
  statusKey: string;
  /** For reading only, never a command. Capped at `LAST_SEEN_TITLE_MAX` at construction. */
  title: string | null;
  /** From a verified execution, else null. */
  harness: HarnessKind | null;
  executionToken: string | null;
  /** From a verified execution, else null. A claim alone is not here — see `ConversationReading`. */
  conversation: ConversationReading | null;
  /**
   * The accepted collection this sighting came from, for crash-merge identity.
   * Absent only on a line written by the first Stage 1 implementation.
   */
  observation?: string;
  /** The baseline's clock: when this was last true. */
  collectedAt: string;
};

/** How the session came to be removed, in the terms the Stage 2 classification needs. */
export type RecoveryDisappearance = {
  goneWhy: GoneReason;
  /** The accepted collection that removed it: `run <instance> collection <inventory>` when stamped, else `collected <collectedAt>`. */
  observation: string;
  /** The entry's world against the snapshot that removed it. `changed` also when the host's boot id changed. */
  generation: GenerationRelation;
  bootChanged: boolean;
  producerRun: ProducerRunRelation;
  /** False when this came from `goneWhileAway`: the daemon had no baseline, so nobody watched it go. */
  watched: boolean;
  /**
   * THE HOST'S BOOT ID WHEN THIS WAS WRITTEN, or null when it could not be
   * read. Not in the plan's sketch, and added for one reason: it is how the fold
   * recovers the boot id a close-out recorded when the process died after the
   * append and before `recovery.json`. Without it that crash leaves the old boot
   * id stored and the next start closes the whole new world out a second time.
   */
  hostBootId: string | null;
};

export type RecoveryCandidateEvent = {
  kind: "recovery-candidate";
  /** The gone event's `at`. */
  at: string;
  id: RecoveryCandidateId;
  /** The FINAL COMPLETE entry, from the register before this batch folds. Never null in the log (Sol's F7). */
  entry: RegisterEntry;
  /** From the baseline row, when the daemon had one; null otherwise. */
  lastSeen: RecoveryLastSeen | null;
  disappearance: RecoveryDisappearance;
};

/**
 * What became of a candidate — each an event, never a mutation. `unresolved`
 * is the default and is never written. Stage 1 folds these; Stage 2 derives
 * `resumed` and `superseded`, and writes `dismissed` from an operator's request.
 */
export type RecoveryDispositionEvent =
  | {
      kind: "recovery-disposition";
      at: string;
      id: RecoveryCandidateId;
      disposition: "resumed";
      /** Both tokens: a resumption is a DIFFERENT run holding the same verified conversation. */
      evidence: { previousToken: string; token: string; conversationId: string };
    }
  | {
      kind: "recovery-disposition";
      at: string;
      id: RecoveryCandidateId;
      disposition: "superseded";
      /** The newer candidate with the same verified conversation. */
      evidence: { by: RecoveryCandidateId };
    }
  | {
      kind: "recovery-disposition";
      at: string;
      id: RecoveryCandidateId;
      disposition: "dismissed";
      /** The operator's sentence, and the request that carried it — so a replayed request is applied once. */
      evidence: { requestId: string; why: string };
    };

/** The two arms, as diff.ts's `OverseerEvent` takes them. There is no replay-done event (Sol's F9). */
export type RecoveryEvent = RecoveryCandidateEvent | RecoveryDispositionEvent;

type ResolutionOf<E> = E extends RecoveryDispositionEvent ? { disposition: E["disposition"]; evidence: E["evidence"]; at: string } : never;

export type RecoveryResolution = { disposition: "unresolved" } | ResolutionOf<RecoveryDispositionEvent>;

type RecordCommon = {
  id: RecoveryCandidateId;
  key: SessionKey;
  name: string;
  /** The disappearance's `at`. */
  at: string;
  /** `journal`: a candidate the daemon wrote. `legacy`: derived from a log written before the event existed. */
  origin: "journal" | "legacy";
  resolution: RecoveryResolution;
};

/**
 * One record in the index.
 *
 * **`entry` is nullable here and nowhere else.** A legacy gone whose session the
 * log never showed us (it began mid-life, or an earlier cold start lost the
 * prefix) is a stub classified `unknown`; inventing an entry for it would be a
 * fabricated register row in the one file recovery trusts (Sol's F7).
 *
 * **The oversize arm keeps the address and drops the body**: the event is in
 * the journal whole, and the view says so.
 */
export type RecoveryRecord =
  | (RecordCommon & {
      oversize: false;
      entry: RegisterEntry | null;
      lastSeen: RecoveryLastSeen | null;
      disappearance: RecoveryDisappearance;
    })
  | (RecordCommon & { oversize: true });

/**
 * Whether the one-time derivation over an old log ran, and what it found.
 *
 * `not-run` is shown by the page as it is, and never as an empty list: over the
 * replay ceiling, or across a hole, the index cannot say what the log holds.
 */
export type RecoveryReplayRan = { kind: "ran"; worldChanges: number; derived: number; scannedBytes: number };

export type RecoveryReplay =
  | RecoveryReplayRan
  | {
      kind: "not-run";
      why: string;
      /** Where a later start must retry. Absent only in a file written before this repair metadata existed. */
      retry?: "whole" | "tail";
      /** The legacy-derivation verdict to restore after a refused tail becomes readable. */
      previous?: RecoveryReplayRan | null;
    };

/** The fold's whole state. Mutable, held by the store; readers get `RecoveryIndex`. */
export type RecoveryFold = {
  records: Map<RecoveryCandidateId, RecoveryRecord>;
  /**
   * Candidates past the capacity: in the journal, not in the index. Their ids
   * are kept rather than only counted so that folding one of them twice cannot
   * count it twice.
   */
  overflowIds: Set<RecoveryCandidateId>;
  /**
   * A candidate whose gone has not yet been folded, by session key — the
   * pending-merge rule. The baseline collection distinguishes a replay of that
   * disappearance from a later one after an unchanged sighting, which emits no
   * session event of its own.
   */
  pending: Map<
    SessionKey,
    { id: RecoveryCandidateId; lastSeenObservation: string | null; lastSeenAt: string | null }
  >;
  /** Dismissal requests already applied, so a request replayed after a crash is applied once. */
  appliedRequests: Set<string>;
  /** The host boot id this daemon last recorded, or null when none has been. */
  bootId: string | null;
  replay: RecoveryReplay;
};

export type RecoveryIndex = {
  readonly records: ReadonlyMap<RecoveryCandidateId, RecoveryRecord>;
  /** Candidates in the journal and not in the index. The page puts this at the top. */
  readonly overflow: number;
  readonly bootId: string | null;
  readonly replay: RecoveryReplay;
  /** Dismissal requests already applied — what the inbox drain checks a request id against. */
  readonly appliedRequests: ReadonlySet<string>;
};

/** What the daemon knows about the batch it is about to append, for `withRecoveryCandidates`. */
export type CandidateContext = {
  /** `observationOf` the accepted collection that produced the batch. */
  observation: string;
  /** That collection's tmux generation. */
  tmuxServerPid: number | null;
  /** The world it was compared against: rows and clock. Null when the daemon had none (`goneWhileAway`). */
  baseline: { rows: readonly ObservedRow[]; collectedAt: string; observation: string } | null;
  producerRun: ProducerRunRelation;
  /** The host's boot id differs from the one recorded — every entry is being closed out of the old world. */
  bootChanged: boolean;
  hostBootId: string | null;
};

/**
 * A guard, not a path we expect to hit: `RegisterEntry` is bounded and the
 * title is capped, so a real candidate is about 1.5 KB. Past this the index
 * holds a stub and the journal holds the event.
 */
export const RECOVERY_RECORD_MAX_BYTES = 16 * 1024;

/**
 * Unresolved records the index holds. Past it, new candidates still go into the
 * journal and are counted in `overflow`. **Nothing unresolved is evicted to make
 * room** — that would be exactly the silent expiry the spec forbids.
 */
export const RECOVERY_UNRESOLVED_CAPACITY = 500;

export const LAST_SEEN_TITLE_MAX = 200;

function digest(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 20);
}

/**
 * The id of a live candidate: the previous execution plus the removing
 * collection — and NOT the arrival time. The module comment says why.
 */
export function recoveryCandidateId(input: {
  key: SessionKey;
  tmuxServerPid: number | null;
  startedAt: string;
  executionToken: string | null;
  observation: string;
}): RecoveryCandidateId {
  return `rc-${digest([
    "recovery-candidate",
    1,
    input.key,
    input.tmuxServerPid,
    input.startedAt,
    input.executionToken ?? "none",
    input.observation,
  ])}` as RecoveryCandidateId;
}

/**
 * A legacy record's id: the original gone event and its position within its
 * same-`at` batch. Deterministic, so a rebuild after `recovery.json` is lost
 * derives the same ids and later dispositions reattach to them.
 */
function legacyCandidateId(gone: Extract<OverseerEvent, { kind: "tmux-session-gone" }>, position: number): RecoveryCandidateId {
  return `rl-${digest(["legacy-recovery-candidate", 1, gone.key, gone.at, gone.tmuxServerPid, gone.why, position])}` as RecoveryCandidateId;
}

/** The accepted collection's identity, as the id and the page name it. */
export function observationOf(ordering: SourceOrdering, collectedAt: string): string {
  if (ordering.kind === "stamped" && ordering.inventory !== null) {
    return `run ${ordering.instance} collection ${ordering.inventory}`;
  }
  return `collected ${collectedAt}`;
}

/** Did the dashboard run change between two observations? Only two readable stamps can say. */
export function producerRunOf(before: SourceOrdering | null, after: SourceOrdering): ProducerRunRelation {
  if (before?.kind !== "stamped" || after.kind !== "stamped") return "cannot-tell";
  return before.instance === after.instance ? "same" : "changed";
}

/**
 * **Every disappearance gets a candidate except a watched, same-world close.**
 *
 * A close the daemon watched, under a readable and unchanged tmux generation,
 * with the dashboard run not known to have changed, is an ordinary close: its
 * gone event already records it and recovery cannot act on it. A candidate on
 * every close would be ~280 records a day nobody reads (the plan, § 1).
 *
 * **`cannot-tell` counts as not changed here, and that is a decision the plan
 * left implicit.** Its rule reads *"the producer run is `same`"*, which taken
 * literally writes a candidate on every close from an unstamped dashboard: a
 * producer from before 260910d, or a rollback to one. That producer is ordered
 * exactly as well as it was before stamps existed, the tmux generation is
 * readable and unchanged, and the boot id (which forces `generation: changed`)
 * is checked separately — so the close is as ordinary as it ever was, and
 * turning every one into an `unknown` record would bury the ones that matter.
 */
export function needsCandidate(d: Pick<RecoveryDisappearance, "generation" | "producerRun" | "watched">): boolean {
  return !(d.generation === "same" && d.producerRun !== "changed" && d.watched);
}

function capTitle(title: string | null): string | null {
  if (title === null) return null;
  // By code point, so a cap never splits a surrogate pair into a lone half.
  const points = Array.from(title);
  return points.length <= LAST_SEEN_TITLE_MAX ? title : points.slice(0, LAST_SEEN_TITLE_MAX).join("");
}

function lastSeenOf(row: ObservedRow, collectedAt: string, observation: string): RecoveryLastSeen {
  const verified = row.execution.kind === "verified" ? row.execution : null;
  return {
    statusKey: statusKey(row.status),
    title: capTitle(row.title),
    harness: verified?.harness ?? null,
    executionToken: verified === null ? null : executionTokenText(verified.token),
    conversation: verified?.conversation ?? null,
    observation,
    collectedAt,
  };
}

/**
 * The batch `take()` is about to append, with a candidate immediately before
 * each gone that needs one — so the candidate and its removal go into the log
 * in one `write` + `fsync`.
 *
 * `register` is the register BEFORE this batch folds, so `register.get(key)` is
 * still the final complete entry. **A candidate is only ever built from an entry
 * the register still holds**: after a crash that left the gone in the log, the
 * re-derived gone finds no entry and brings no second candidate.
 */
export function withRecoveryCandidates(
  events: readonly OverseerEvent[],
  register: ReadonlyMap<SessionKey, RegisterEntry>,
  context: CandidateContext,
): OverseerEvent[] {
  const baselineRows = new Map<SessionKey, ObservedRow>();
  for (const row of context.baseline?.rows ?? []) baselineRows.set(sessionKey(identityOf(row)), row);
  const out: OverseerEvent[] = [];
  for (const event of events) {
    if (event.kind === "tmux-session-gone") {
      const entry = register.get(event.key);
      if (entry !== undefined) {
        const disappearance: RecoveryDisappearance = {
          goneWhy: event.why,
          observation: context.observation,
          generation: context.bootChanged ? "changed" : generationRelation(entry.tmuxServerPid, context.tmuxServerPid),
          bootChanged: context.bootChanged,
          producerRun: context.producerRun,
          watched: context.baseline !== null,
          hostBootId: context.hostBootId,
        };
        if (needsCandidate(disappearance)) {
          const row = baselineRows.get(event.key);
          out.push({
            kind: "recovery-candidate",
            at: event.at,
            id: recoveryCandidateId({
              key: entry.key,
              tmuxServerPid: entry.tmuxServerPid,
              startedAt: entry.startedAt,
              executionToken: entry.verifiedExecution?.token ?? null,
              observation: context.observation,
            }),
            entry,
            lastSeen:
              row === undefined || context.baseline === null
                ? null
                : lastSeenOf(row, context.baseline.collectedAt, context.baseline.observation),
            disappearance,
          });
        }
      }
    }
    out.push(event);
  }
  return out;
}

export function emptyRecoveryFold(replay: RecoveryReplay, bootId: string | null): RecoveryFold {
  return { records: new Map(), overflowIds: new Set(), pending: new Map(), appliedRequests: new Set(), bootId, replay };
}

export function recoveryIndexOf(fold: RecoveryFold): RecoveryIndex {
  return {
    records: fold.records,
    overflow: fold.overflowIds.size,
    bootId: fold.bootId,
    replay: fold.replay,
    appliedRequests: fold.appliedRequests,
  };
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function unresolvedCount(fold: RecoveryFold): number {
  let count = 0;
  for (const record of fold.records.values()) if (record.resolution.disposition === "unresolved") count += 1;
  return count;
}

/** Into the index, or into `overflow`. Keep-first by id: a record already held is never replaced. */
function insertRecord(fold: RecoveryFold, record: Extract<RecoveryRecord, { oversize: false }>, measured: unknown): boolean {
  if (fold.records.has(record.id) || fold.overflowIds.has(record.id)) return false;
  if (unresolvedCount(fold) >= RECOVERY_UNRESOLVED_CAPACITY) {
    fold.overflowIds.add(record.id);
    return true;
  }
  if (byteLength(measured) > RECOVERY_RECORD_MAX_BYTES) {
    fold.records.set(record.id, {
      id: record.id,
      key: record.key,
      name: record.name,
      at: record.at,
      origin: record.origin,
      resolution: record.resolution,
      oversize: true,
    });
    return true;
  }
  fold.records.set(record.id, record);
  return true;
}

/**
 * The third fold, beside `foldEvents` and `foldOccurrences`. Returns whether
 * anything in the fold changed, so the store knows whether `recovery.json` needs
 * writing.
 *
 * **The pending-merge rule.** A candidate for a session key whose previous
 * candidate has not yet been followed by its gone is the same disappearance, and
 * the first record, with its id, is kept. That is the crash where the candidate
 * line is whole and the gone after it was torn and truncated: the register
 * still holds the entry, so the restart re-derives the gone — possibly from a
 * LATER collection, and so under a different id. **Any other event for that key
 * ends the wait** (the session was seen alive, so that removal never happened),
 * which keeps an orphaned candidate from swallowing a real disappearance weeks
 * later. An unchanged accepted sighting emits no session event, so the next
 * candidate's `lastSeen.observation` is the second way to end the wait: if it
 * differs, the session was observed again and this is a distinct disappearance.
 * The orphan stays in the index: it is evidence, and Stage 2 classifies it
 * against the live inventory like any other.
 */
export function foldRecovery(events: readonly OverseerEvent[], into: RecoveryFold): boolean {
  let changed = false;
  for (const event of events) {
    switch (event.kind) {
      case "recovery-candidate": {
        const key = event.entry.key;
        if (event.disappearance.hostBootId !== null && into.bootId !== event.disappearance.hostBootId) {
          into.bootId = event.disappearance.hostBootId;
          changed = true;
        }
        const lastSeenObservation = event.lastSeen?.observation ?? null;
        const lastSeenAt = event.lastSeen?.collectedAt ?? null;
        const previous = into.pending.get(key);
        const sameSighting =
          previous !== undefined &&
          (previous.lastSeenObservation !== null && lastSeenObservation !== null
            ? previous.lastSeenObservation === lastSeenObservation
            : previous.lastSeenAt === lastSeenAt);
        if (sameSighting) break;
        into.pending.set(key, { id: event.id, lastSeenObservation, lastSeenAt });
        changed = true;
        insertRecord(
          into,
          {
            id: event.id,
            key,
            name: event.entry.name,
            at: event.at,
            origin: "journal",
            resolution: { disposition: "unresolved" },
            oversize: false,
            entry: event.entry,
            lastSeen: event.lastSeen,
            disappearance: event.disappearance,
          },
          event,
        );
        break;
      }
      case "recovery-disposition": {
        const record = into.records.get(event.id);
        if (record === undefined || record.resolution.disposition !== "unresolved") break;
        if (event.disposition === "dismissed") {
          if (into.appliedRequests.has(event.evidence.requestId)) break;
          into.appliedRequests.add(event.evidence.requestId);
        }
        const resolution = { disposition: event.disposition, evidence: event.evidence, at: event.at } as RecoveryResolution;
        into.records.set(event.id, { ...record, resolution });
        changed = true;
        break;
      }
      // EVERY SESSION ARM ENDS A PENDING WAIT FOR ITS KEY — the gone that was
      // expected, or any sign the session is still there. See the pending-merge
      // rule above.
      case "session-replaced":
        if (into.pending.delete(event.previousKey)) changed = true;
        if (into.pending.delete(event.key)) changed = true;
        break;
      case "session-seen":
      case "session-status":
      case "tmux-session-gone":
      case "session-wait-restarted":
      case "session-row-changed":
      case "session-pane-replaced":
      case "session-execution-changed":
        if (into.pending.delete(event.key)) changed = true;
        break;
      // Not about any session, and so about no disappearance.
      case "job-occurrence-reserved":
      case "job-occurrence-started":
      case "job-occurrence-finished":
      case "job-occurrence-refused":
      case "job-occurrence-unknown":
      case "rule-intended":
      case "rule-settled":
        break;
      default: {
        const never: never = event;
        throw new Error(`no recovery fold for event ${JSON.stringify(never)}`);
      }
    }
  }
  return changed;
}

type GoneEvent = Extract<OverseerEvent, { kind: "tmux-session-gone" }>;

function isGoneRunMember(event: OverseerEvent | undefined, at: string): boolean {
  return event !== undefined && (event.kind === "tmux-session-gone" || event.kind === "recovery-candidate") && event.at === at;
}

/**
 * The one-time derivation over a whole log, for a store that has no
 * `recovery.json` (a log from before this stage, or the file was lost).
 *
 * It folds `session-*` events through a scratch register — `foldSession`, which
 * is store.ts's `foldEvents` passed in so this module keeps no runtime import of
 * the store — so each gone can be joined to the entry it removed. Every
 * `recovery-candidate` and `recovery-disposition` already in the log is folded
 * as usual. Then:
 *
 *  - **A legacy candidate is derived only where the log itself proves a world
 *    change**: a gone with `why: "tmux-server-changed"`, which means the daemon
 *    compared two readable generations and so may carry `watched: true`; or a
 *    batch of `absent-from-snapshot` gones sharing one `at` that emptied the
 *    scratch register, where the next `session-seen` names a different, readable
 *    `tmuxServerPid`. The second is exactly what `goneWhileAway` writes, so it
 *    proves a world change and not an interruption: **always `watched: false`**
 *    (Sol's F6).
 *  - Missing evidence becomes an `entry: null` stub, never a fabricated entry.
 *  - A gone already preceded by its live candidate is never derived again.
 *  - Legacy records go into the fold only — never appended to `events.jsonl` —
 *    and there is no replay-done event (Sol's F9).
 */
export function deriveRecovery(
  events: readonly OverseerEvent[],
  foldSession: (event: OverseerEvent, into: Map<SessionKey, RegisterEntry>) => void,
  scannedBytes: number,
): RecoveryFold {
  // THE BOOT ID IS NOT RECOVERED HERE, deliberately. A candidate's
  // `hostBootId` is the boot its writer ran on, which is not necessarily the
  // boot the daemon last recorded: a reboot with an empty register writes no
  // candidate. Carrying the last one forward from a whole-log rebuild could
  // then close a live new world out as if it were the old one. Null concludes
  // nothing, and the daemon records the current boot on its next collection.
  const fold = emptyRecoveryFold({ kind: "ran", worldChanges: 0, derived: 0, scannedBytes }, null);
  const scratch = new Map<SessionKey, RegisterEntry>();
  let worldChanges = 0;
  let derived = 0;
  // The tmux generation of the first `session-seen` at or after each index, in
  // one pass from the end — so the derivation stays linear on a log the ceiling
  // lets be a hundred thousand events long. `undefined`: none follows.
  const nextSeenPidFrom: (number | null | undefined)[] = new Array<number | null | undefined>(events.length + 1).fill(undefined);
  for (let j = events.length - 1; j >= 0; j -= 1) {
    const later = events[j];
    nextSeenPidFrom[j] = later?.kind === "session-seen" ? later.tmuxServerPid : nextSeenPidFrom[j + 1];
  }
  let i = 0;
  while (i < events.length) {
    const first = events[i];
    if (first === undefined) break;
    if (!isGoneRunMember(first, first.at)) {
      foldRecovery([first], fold);
      foldSession(first, scratch);
      i += 1;
      continue;
    }
    let end = i;
    while (isGoneRunMember(events[end], first.at)) end += 1;
    const run = events.slice(i, end);
    const gones = run.filter((e): e is GoneEvent => e.kind === "tmux-session-gone");
    const goneKeys = new Set(gones.map((g) => g.key));
    const emptied = scratch.size > 0 && [...scratch.keys()].every((key) => goneKeys.has(key));
    const nextSeenPid = nextSeenPidFrom[end];
    const absent = gones.filter((g) => g.why === "absent-from-snapshot");
    const absentProvesAWorldChange =
      emptied &&
      absent.length > 0 &&
      typeof nextSeenPid === "number" &&
      absent.every((g) => g.tmuxServerPid !== null && g.tmuxServerPid !== nextSeenPid);
    if (absentProvesAWorldChange || gones.some((g) => g.why === "tmux-server-changed")) worldChanges += 1;

    let position = 0;
    let previous: OverseerEvent | undefined;
    for (const event of run) {
      if (event.kind === "tmux-session-gone") {
        const live = previous?.kind === "recovery-candidate" && previous.entry.key === event.key;
        const proven = event.why === "tmux-server-changed" || absentProvesAWorldChange;
        if (!live && proven) {
          const entry = scratch.get(event.key) ?? null;
          const record: Extract<RecoveryRecord, { oversize: false }> = {
            id: legacyCandidateId(event, position),
            key: event.key,
            name: event.name,
            at: event.at,
            origin: "legacy",
            resolution: { disposition: "unresolved" },
            oversize: false,
            entry,
            lastSeen: null,
            disappearance: {
              goneWhy: event.why,
              observation: `not recorded: the gone arrived at ${event.at}, before candidates existed`,
              generation: "changed",
              bootChanged: false,
              producerRun: "cannot-tell",
              watched: event.why === "tmux-server-changed",
              hostBootId: null,
            },
          };
          if (insertRecord(fold, record, record)) derived += 1;
        }
        position += 1;
      }
      foldRecovery([event], fold);
      foldSession(event, scratch);
      previous = event;
    }
    i = end;
  }
  fold.replay = { kind: "ran", worldChanges, derived, scannedBytes };
  // Folding the live candidates above moved it; see the comment at the top.
  fold.bootId = null;
  return fold;
}

// ═══ Stage 2: the derived dispositions, and retention ═════════════════════════

/**
 * A CANDIDATE'S VERIFIED CONVERSATION — the only conversation recovery matches on.
 *
 * `verified` gives its id and `conflicting` gives the one OBSERVED in the pane.
 * Nothing else counts, and the stored `claimedConversationId` least of all: the
 * tmux environment is written once and outlives its conversation
 * (observation.ts), so a claim would match a pane that has long since moved on
 * (Sol's F2). The view still SHOWS a claim, labelled as one.
 */
export function verifiedConversationOf(lastSeen: RecoveryLastSeen | null): string | null {
  const conversation = lastSeen?.conversation ?? null;
  if (conversation === null) return null;
  switch (conversation.kind) {
    case "verified":
      return conversation.id;
    case "conflicting":
      return conversation.observed;
    case "not-claimed":
    case "unverifiable":
      return null;
    default: {
      const never: never = conversation;
      throw new Error(`no conversation rule for ${JSON.stringify(never)}`);
    }
  }
}

/** A live row's verified run, and the conversation it verifiably holds — or null when it proves neither. */
export function liveExecutionOf(row: ObservedRow): { conversationId: string; token: string } | null {
  if (row.execution.kind !== "verified") return null;
  const conversationId = verifiedConversationOf({
    statusKey: "",
    title: null,
    harness: row.execution.harness,
    executionToken: null,
    conversation: row.execution.conversation,
    collectedAt: "",
  });
  return conversationId === null ? null : { conversationId, token: executionTokenText(row.execution.token) };
}

/**
 * THE TWO DISPOSITIONS THE DAEMON DERIVES — the plan, § 2 as revised by Sol's F2.
 *
 *  - **`resumed`**: a live verified execution in an ACCEPTED, TRUSTED inventory
 *    holds the candidate's verified conversation under a DIFFERENT token. The
 *    same conversation under the same token is the same run, which was never
 *    gone: the view calls that `already-live` and nothing is written. A
 *    candidate with no verified conversation can never be resumed.
 *  - **`superseded`**: a strictly newer candidate has the same verified
 *    conversation. A claim alone never supersedes.
 *
 * `liveRows` is null when the inventory cannot be trusted, and then nothing is
 * resumed: an empty list from a failed collection is not evidence either way.
 *
 * **Idempotent by construction, not by bookkeeping**: only unresolved records
 * produce an event, and the fold resolves them — so a second pass after the
 * append derives nothing. At most one event per record, `resumed` first,
 * because it is the stronger evidence.
 */
export function deriveDispositions(
  index: RecoveryIndex,
  liveRows: readonly ObservedRow[] | null,
  at: string,
): RecoveryDispositionEvent[] {
  type Full = Extract<RecoveryRecord, { oversize: false }>;
  const full = [...index.records.values()].filter((record): record is Full => !record.oversize);
  const newest = new Map<string, Full>();
  for (const record of full) {
    const conversation = verifiedConversationOf(record.lastSeen);
    if (conversation === null) continue;
    const held = newest.get(conversation);
    if (held === undefined || Date.parse(record.at) > Date.parse(held.at)) newest.set(conversation, record);
  }
  const live = new Map<string, Set<string>>();
  for (const row of liveRows ?? []) {
    const execution = liveExecutionOf(row);
    if (execution === null) continue;
    const tokens = live.get(execution.conversationId) ?? new Set<string>();
    tokens.add(execution.token);
    live.set(execution.conversationId, tokens);
  }
  const events: RecoveryDispositionEvent[] = [];
  for (const record of full) {
    if (record.resolution.disposition !== "unresolved") continue;
    const conversationId = verifiedConversationOf(record.lastSeen);
    if (conversationId === null) continue;
    const previousToken = record.lastSeen?.executionToken ?? null;
    const tokens = live.get(conversationId);
    // A row still holding the PREVIOUS token means the same run is live, which
    // is not a resumption, whatever else is holding the conversation.
    if (tokens !== undefined && previousToken !== null && !tokens.has(previousToken)) {
      const [token] = [...tokens].sort();
      if (token !== undefined) {
        events.push({ kind: "recovery-disposition", at, id: record.id, disposition: "resumed", evidence: { previousToken, token, conversationId } });
        continue;
      }
    }
    const newer = newest.get(conversationId);
    if (newer !== undefined && newer.id !== record.id && Date.parse(newer.at) > Date.parse(record.at)) {
      events.push({ kind: "recovery-disposition", at, id: record.id, disposition: "superseded", evidence: { by: newer.id } });
    }
  }
  return events;
}

/** How long a RESOLVED record stays in the index after it was resolved. */
export const RECOVERY_RESOLVED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * THE RETENTION RULE Stage 1 deferred: resolved records whose resolution is
 * older than 30 days leave the INDEX, and stay in the journal. Returns whether
 * anything left.
 *
 * **Unresolved records never leave** — expiring one would be the silent expiry
 * the spec forbids — and nothing in `overflowIds` is touched, for the same
 * reason. **`pending` is not touched either**: it is the crash-merge rule's
 * state, keyed by session, and a pruned record's pending entry still has to
 * swallow the re-derived candidate of the disappearance it names.
 *
 * Measured from the RESOLUTION, not the disappearance, so a record resolved
 * today is shown as resolved for a month whatever its age.
 *
 * A later replay from before the pruned candidate (a lost `recovery.json`, or
 * a tail behind the cursor) folds it back in with its disposition, and the next
 * checkpoint prunes it again: the journal is the authority, and the index
 * only a view of it.
 */
export function pruneResolved(fold: RecoveryFold, nowMs: number): boolean {
  let changed = false;
  for (const [id, record] of fold.records) {
    if (!isRetained(record, nowMs)) {
      fold.records.delete(id);
      changed = true;
    }
  }
  return changed;
}

/**
 * The retention predicate, ONE copy of it: `pruneResolved` drops what this
 * refuses, and the view pass (recovery-view.ts § `buildRecoveryView`) leaves out
 * the same records before it sorts. Two copies could disagree, and then
 * `recovery.json` would show a record on the page that its own `records` no
 * longer holds (Sol's F24).
 */
export function isRetained(record: RecoveryRecord, nowMs: number): boolean {
  if (record.resolution.disposition === "unresolved") return true;
  return nowMs - Date.parse(record.resolution.at) <= RECOVERY_RESOLVED_RETENTION_MS;
}
