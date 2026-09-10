/**
 * **ONE CRASH PROTOCOL FOR STARTING A SESSION ON GREG'S BEHALF.**
 *
 * Plan 260910f. Two things will want to start a session — the scheduler, when
 * a job comes due, and recovery, when Greg picks an interrupted session to bring
 * back — and starting one is several steps with a durable write at each
 * boundary:
 *
 *     plan ──▶ reserve (owner) ──▶ record reserved ──▶ intent.json + record launching
 *          ──▶ invoke the launcher ONCE ──▶ discover ──▶ record result ──▶ release ──▶ record released
 *
 * The daemon can die between any two. What this file guarantees is that after a
 * restart it can tell *never started* from *started and we lost track*, and that
 * it never starts the same occurrence twice because it could not tell.
 *
 * ## What is claimed, and what is not
 *
 * Claimed: **at most one automatic attempt while the outcome is ambiguous**, one
 * reservation per occurrence, and evidence that outlives the child. A second
 * attempt of an occurrence is possible only when every earlier attempt ended
 * `failed-before-launch` with proof; `launching`, `observed-running` and
 * `outcome-unknown` block it, and only evidence or Greg's `disposed` moves them.
 * **Timeout alone is not proof**: nothing here expires.
 *
 * Not claimed: exactly-once execution. The remaining ambiguity, per launcher:
 *
 *  - **tmux** — a session created and killed before its first line ran leaves
 *    no `start.json`; if the probe also finds no session, the occurrence is
 *    `outcome-unknown`, correctly, and only Greg can say.
 *  - **both** — the recorded pid is the SUPERVISOR (the job shell or the
 *    wrapper), and Claude/Codex run as its children. A supervisor killed with
 *    SIGKILL writes no `exit.json` and its children may outlive it, so on the
 *    same boot its disappearance is `outcome-unknown` and keeps the reservation
 *    (GPT Sol's F1). `completed` needs a correlation-bound `exit.json`, or a
 *    reboot (`other-boot`), which ends every process of the recorded boot.
 *
 * ## Why "the journal says `reserved`" means "nothing was invoked"
 *
 * Because the only code that invokes a launcher is {@link launchOccurrence}, the
 * path from `reserve` to the invocation is ONE SYNCHRONOUS FUNCTION, the owner
 * and the launcher are synchronous, and reconciliation runs in the same event
 * loop, so nothing can interleave with it (F9). A failed `launching` append
 * returns before the launcher is reached. Launchers are handed to
 * {@link composeLaunchProtocol} and are reachable only through it: a consumer
 * holds `launchOccurrence`, never an adapter. **An asynchronous owner or
 * launcher breaks this proof** and would need an explicit current-attempt guard.
 *
 * ## The material is what launches
 *
 * `material.txt` is pinned before `planned`, its size and sha256 are in the
 * record, and immediately before `launching` it is re-read and re-hashed; the
 * launcher is handed those verified bytes and has no prompt parameter of its
 * own (F5). An existing id asked for with a different origin, launcher, class or
 * material is a conflict, never an idempotent return.
 *
 * ## The journal is replayed whole or not at all
 *
 * Every line has an exact parser, and replay checks legality — immutable fields,
 * the id as the hash of its origin, monotonic attempts, legal transitions. An
 * unknown schema, a malformed line, a conflicting duplicate or an illegal
 * transition is `history-lost`, with nothing folded past it (F11). A cold launch
 * journal would read as *nothing is in flight*, which is a licence to launch
 * everything again; so `history-lost` refuses {@link plan} until Greg's
 * attributed resolution starts a fresh journal whose first line is
 * `history-reset` (F2). What the reset carries forward it can only refuse or
 * let Greg dispose, never re-plan.
 *
 * ## Nothing calls this yet, on purpose
 *
 * The scheduler keeps its own `reserved → spawn → started` path this stage
 * (plan § D10); wiring it here would record every launch in two ledgers.
 * `tests/overseer-launch-protocol.test.ts` asserts there is no production caller,
 * so *built but uncalled* is a fact someone has to change deliberately.
 */
import { createHash } from "node:crypto";

import type { BootIdentity } from "../fleet/execution-identity.js";
import type { OccurrenceKey } from "./jobs.js";
import {
  asReservationKey,
  checkResolutionRequest,
  isAdmissionClass,
  type AdmissionClass,
  type AdmissionOwner,
  type Grant,
  type HeldReservation,
  type HistoryResolutionRequest,
  type Lookup,
  type ReleaseEvidence,
  type ReservationKey,
} from "./launch-admission.js";
import type { ArtefactReadings, IdentityReading, LaunchIntent, StartRecord } from "./launch-artefacts.js";

/* ------------------------------------------------------------------ *
 * D2. Identity.
 * ------------------------------------------------------------------ */

/** `lo-<20 hex>`, the sha256 of the canonical origin. */
export type LaunchOccurrenceId = string & { readonly __brand: "launch-occurrence-id" };

/** `<occurrenceId>-a<n>` — safe in an env var, a path and a tmux value without quoting. */
export type CorrelationId = string & { readonly __brand: "launch-correlation-id" };

export const OCCURRENCE_ID_PATTERN = /^lo-[0-9a-f]{20}$/;
export const CORRELATION_ID_PATTERN = /^lo-[0-9a-f]{20}-a[1-9][0-9]{0,2}$/;
/** The largest attempt number the correlation id can spell. */
export const MAX_ATTEMPTS = 999;

export function isLaunchOccurrenceId(u: unknown): u is LaunchOccurrenceId {
  return typeof u === "string" && OCCURRENCE_ID_PATTERN.test(u);
}

export function isCorrelationId(u: unknown): u is CorrelationId {
  return typeof u === "string" && CORRELATION_ID_PATTERN.test(u);
}

export function correlationIdOf(id: LaunchOccurrenceId, attempt: number): CorrelationId {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_ATTEMPTS) throw new RangeError(`attempt ${attempt} is not 1..${MAX_ATTEMPTS}`);
  return `${id}-a${attempt}` as CorrelationId;
}

/** The owner's key for an occurrence. It is the id: one reservation per occurrence, by construction. */
export function reservationKeyOf(id: LaunchOccurrenceId): ReservationKey {
  const key = asReservationKey(id);
  if (key === null) throw new Error(`${id} is not usable as a reservation key`);
  return key;
}

/**
 * Where a launch request came from. Two in v1: the scheduler's existing
 * `OccurrenceKey`, and `recovery-inventory`'s candidate id, taken as an opaque
 * validated string — **one occurrence per candidate**, so two taps, or a tap and
 * a restart, are the same occurrence.
 */
export type LaunchOrigin =
  | { readonly kind: "schedule"; readonly jobId: string; readonly scheduledAt: string; readonly behaviourHash: string }
  | { readonly kind: "recovery"; readonly candidateId: string };

export function scheduleOrigin(key: OccurrenceKey): LaunchOrigin {
  return { kind: "schedule", jobId: key.jobId, scheduledAt: key.scheduledAt, behaviourHash: key.behaviourHash };
}

export function recoveryOrigin(candidateId: string): LaunchOrigin {
  return { kind: "recovery", candidateId };
}

function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** Why an origin is not one this version will launch from, or null. */
export function originProblem(origin: LaunchOrigin): string | null {
  const field = (name: string, value: string): string | null => {
    if (value === "" || value.length > 256) return `${name} must be 1..256 characters`;
    if (hasControlCharacter(value)) return `${name} contains a control character`;
    return null;
  };
  switch (origin.kind) {
    case "schedule":
      if (!isIsoTimestamp(origin.scheduledAt)) return "scheduledAt is not an ISO timestamp";
      return field("jobId", origin.jobId) ?? field("behaviourHash", origin.behaviourHash);
    case "recovery":
      return field("candidateId", origin.candidateId);
    default: {
      const never: never = origin;
      return `unknown origin ${JSON.stringify(never)}`;
    }
  }
}

/**
 * The origin as the bytes that are hashed. Every field named, in a fixed order,
 * with its length in front — for the reason `behaviourHash` gives: a naive join
 * lets two different origins spell one string, and `JSON.stringify` orders keys
 * by insertion.
 */
function canonicalOrigin(origin: LaunchOrigin): string {
  const field = (name: string, value: string): string => `${name}:${value.length}:${value}\n`;
  switch (origin.kind) {
    case "schedule":
      return field("kind", "schedule") + field("jobId", origin.jobId) + field("scheduledAt", origin.scheduledAt) + field("behaviourHash", origin.behaviourHash);
    case "recovery":
      return field("kind", "recovery") + field("candidateId", origin.candidateId);
    default: {
      const never: never = origin;
      throw new Error(`no canonical form for ${JSON.stringify(never)}`);
    }
  }
}

export function occurrenceIdOf(origin: LaunchOrigin): LaunchOccurrenceId {
  return `lo-${createHash("sha256").update(canonicalOrigin(origin), "utf8").digest("hex").slice(0, 20)}` as LaunchOccurrenceId;
}

function sameOrigin(a: LaunchOrigin, b: LaunchOrigin): boolean {
  return canonicalOrigin(a) === canonicalOrigin(b);
}

/* ------------------------------------------------------------------ *
 * D3. The vocabulary a record is made of.
 * ------------------------------------------------------------------ */

export type LauncherKind = "tmux" | "headless";

export function isLauncherKind(u: unknown): u is LauncherKind {
  return u === "tmux" || u === "headless";
}

/** The pinned material: its size and hash, recorded before `planned`. */
export type MaterialPin = { readonly sha256: string; readonly bytes: number };

/** The most material one occurrence may pin. A prompt, not a payload. */
export const MAX_MATERIAL_BYTES = 1024 * 1024;

export function pinOf(bytes: Buffer): MaterialPin {
  return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength };
}

/** The bytes the launcher is handed — read back off the disk and checked against the pin, never the caller's copy. */
export type VerifiedMaterial = { readonly bytes: Buffer; readonly pin: MaterialPin };

export type AttemptRef = { readonly attempt: number; readonly correlationId: CorrelationId; readonly artefactDir: string };

/** How the launched side ended, as its `exit.json` says. Shared with the artefact reader, which is its other half. */
export type ExitEnding =
  | { readonly kind: "exited"; readonly code: number }
  | { readonly kind: "signalled"; readonly signal: string }
  /** The supervisor itself failed (spawn error, a refusal after start) and says so. */
  | { readonly kind: "supervisor-failed"; readonly why: string };

export type ExitAnswer = { readonly path: string; readonly bytes: number; readonly sha256: string; readonly usable: boolean };

export type RunningEvidence =
  | { readonly kind: "start-artefact"; readonly pid: number; readonly startTicks: number; readonly bootId: string }
  | { readonly kind: "tmux-session"; readonly sessionId: string };

/** F1: an exit record, or a reboot. There is deliberately no `vanished` arm. */
export type CompletionEvidence =
  | { readonly kind: "exit-record"; readonly ending: ExitEnding; readonly timedOut: boolean; readonly answer: ExitAnswer | null }
  | { readonly kind: "rebooted"; readonly recordedBootId: string; readonly currentBootId: string };

/** Which proof licensed a `failed-before-launch`. Each names why no external effect can have happened. */
export type FailedProof =
  /** The owner refused; no slot was held and nothing ran. */
  | "admission-refused"
  /** The journal ended at `reserved`: `launching` is written before any invocation, so none happened. */
  | "restarted-before-launching"
  /** `material.txt` no longer matched its pin, so the launcher was not reached. */
  | "material-mismatch"
  /** `intent.json` could not be written, so `launching` was not, so the launcher was not reached. */
  | "intent-not-written"
  /** The launcher answered that it refused before any effect. */
  | "launcher-refused";

export type OwnerAnswer = "released" | "was-not-held" | "none-on-lookup";

export type DispositionDecision = "not-running" | "ended";

export type Disposition = {
  readonly actor: string;
  readonly requestId: string;
  readonly decision: DispositionDecision;
  readonly why: string;
  readonly at: string;
};

/* ------------------------------------------------------------------ *
 * The journal's lines.
 * ------------------------------------------------------------------ */

export const LAUNCH_SCHEMA = 1;

type Common = { readonly v: 1; readonly occurrenceId: LaunchOccurrenceId; readonly at: string };

export type LaunchEvent =
  | (Common & {
      readonly kind: "planned";
      readonly origin: LaunchOrigin;
      readonly material: MaterialPin;
      readonly launcherKind: LauncherKind;
      readonly admissionClass: AdmissionClass;
    })
  | (Common & { readonly kind: "waiting-admission"; readonly why: string })
  | (Common & {
      readonly kind: "reserved";
      readonly reservationKey: ReservationKey;
      readonly slot: string;
      readonly ownerId: string;
      /** `granted` by a reserve this process made; `found-on-lookup` when reconciliation recovered a lost reply. */
      readonly how: "granted" | "found-on-lookup";
    })
  | (Common & { readonly kind: "launching"; readonly attempt: number; readonly correlationId: CorrelationId; readonly artefactDir: string })
  | (Common & { readonly kind: "observed-running"; readonly attempt: number; readonly evidence: RunningEvidence })
  | (Common & { readonly kind: "completed"; readonly attempt: number; readonly evidence: CompletionEvidence })
  | (Common & { readonly kind: "failed-before-launch"; readonly attempt: number | null; readonly proof: FailedProof; readonly why: string })
  | (Common & { readonly kind: "outcome-unknown"; readonly attempt: number; readonly why: string; readonly looked: readonly string[] })
  | (Common & { readonly kind: "released"; readonly licence: ReleaseEvidence; readonly ownerSaid: OwnerAnswer })
  | (Common & {
      readonly kind: "disposed";
      readonly actor: string;
      readonly requestId: string;
      readonly decision: DispositionDecision;
      readonly why: string;
    });

/** What a history reset carries forward: an occurrence it can still see, and whether the owner holds a slot for it. */
export type CarriedEntry = {
  readonly occurrenceId: LaunchOccurrenceId;
  /** The last kind any parseable line said for it, or null when only the owner or the artefacts know it. */
  readonly lastSeen: LaunchEvent["kind"] | null;
  readonly ownerHeld: { readonly slot: string } | null;
};

/** F2's fresh start. Only ever the first line of a journal. */
export type HistoryResetEvent = {
  readonly v: 1;
  readonly kind: "history-reset";
  readonly at: string;
  readonly actor: string;
  readonly requestId: string;
  readonly why: string;
  readonly preservedAs: string;
  readonly lostAt: { readonly line: number; readonly why: string };
  /** Said in the record rather than implied: the hole may hide a launch nobody can enumerate. */
  readonly acknowledgement: string;
  /** Every occurrence still visible — in a parseable line, in the owner's inventory, or as a directory under `o/` (F15). */
  readonly carried: readonly CarriedEntry[];
};

export type JournalLine = LaunchEvent | HistoryResetEvent;

export const HIDDEN_LAUNCH_ACKNOWLEDGEMENT =
  "the preserved journal had a hole; it may conceal a launch nobody can enumerate, and Greg accepted that risk by name";

/* ------------------------------------------------------------------ *
 * The fold: one record per occurrence, a union per state.
 * ------------------------------------------------------------------ */

/** Whether the reservation is held — orthogonal to the state, and the thing a release settles. */
export type ReservationFact =
  | { readonly kind: "none" }
  | { readonly kind: "held"; readonly key: ReservationKey; readonly slot: string; readonly ownerId: string; readonly since: string }
  | {
      readonly kind: "released";
      readonly key: ReservationKey;
      readonly slot: string;
      readonly ownerId: string;
      readonly licence: ReleaseEvidence;
      readonly ownerSaid: OwnerAnswer;
      readonly at: string;
    };

type RecordCommon = {
  readonly id: LaunchOccurrenceId;
  readonly origin: LaunchOrigin;
  readonly material: MaterialPin;
  readonly launcherKind: LauncherKind;
  readonly admissionClass: AdmissionClass;
  readonly plannedAt: string;
  readonly updatedAt: string;
  readonly attempts: readonly AttemptRef[];
  readonly reservation: ReservationFact;
  readonly disposition: Disposition | null;
};

/** The roadmap's eight states, each with only the fields it can have. */
export type LaunchState =
  | { readonly state: "planned" }
  | { readonly state: "waiting-admission"; readonly why: string }
  | { readonly state: "reserved" }
  | { readonly state: "launching"; readonly current: AttemptRef }
  | { readonly state: "observed-running"; readonly current: AttemptRef; readonly evidence: RunningEvidence }
  | { readonly state: "completed"; readonly current: AttemptRef; readonly evidence: CompletionEvidence }
  | { readonly state: "failed-before-launch"; readonly attempt: AttemptRef | null; readonly proof: FailedProof; readonly why: string }
  | { readonly state: "outcome-unknown"; readonly current: AttemptRef; readonly why: string; readonly looked: readonly string[] };

export type LaunchRecord = RecordCommon & LaunchState;

/** An occurrence a history reset carried forward. Not one of the eight states: its history is gone, so only Greg moves it. */
export type CarriedOccurrence = CarriedEntry & {
  readonly disposition: Disposition | null;
  readonly released: { readonly ownerSaid: OwnerAnswer; readonly at: string } | null;
};

export type LaunchFold = {
  readonly occurrences: ReadonlyMap<LaunchOccurrenceId, LaunchRecord>;
  readonly carried: ReadonlyMap<LaunchOccurrenceId, CarriedOccurrence>;
  readonly requestIds: ReadonlySet<string>;
  readonly reset: HistoryResetEvent | null;
  readonly lines: number;
};

/** The fold as a replay builds it. Mutable only here; everyone else gets {@link LaunchFold}. */
export type FoldBuilder = {
  occurrences: Map<LaunchOccurrenceId, LaunchRecord>;
  carried: Map<LaunchOccurrenceId, CarriedOccurrence>;
  requestIds: Set<string>;
  reset: HistoryResetEvent | null;
  lines: number;
};

export function emptyFold(): FoldBuilder {
  return { occurrences: new Map(), carried: new Map(), requestIds: new Set(), reset: null, lines: 0 };
}

/** Terminal for the state; the reservation and a disposition may still be settling. */
export function isTerminal(record: LaunchRecord): boolean {
  return record.state === "completed" || record.state === "failed-before-launch";
}

/** A `failed-before-launch` that may try again: nothing held, nobody disposed it, and an attempt number left to spell. */
function retryable(record: LaunchRecord): boolean {
  return record.state === "failed-before-launch" && record.reservation.kind !== "held" && record.disposition === null && record.attempts.length < MAX_ATTEMPTS;
}

/** States from which a reservation may be asked for. */
function admissible(record: LaunchRecord): boolean {
  return record.state === "planned" || record.state === "waiting-admission" || retryable(record);
}

/** What licenses a release of this record's held reservation, or null. F7: a terminal record, or a disposition. */
export function licenceOf(record: LaunchRecord): ReleaseEvidence | null {
  if (record.disposition !== null) return { kind: "disposed", requestId: record.disposition.requestId };
  if (record.state === "completed" || record.state === "failed-before-launch") return { kind: "terminal", state: record.state };
  return null;
}

function artefactDirFits(dir: string, id: LaunchOccurrenceId, attempt: number): boolean {
  return dir.startsWith("/") && dir.endsWith(`/o/${id}/a${attempt}`);
}

type Step = { ok: true; record: LaunchRecord } | { ok: false; why: string };

const illegal = (why: string): Step => ({ ok: false, why });

function commonOf(prev: LaunchRecord, at: string): RecordCommon {
  return {
    id: prev.id,
    origin: prev.origin,
    material: prev.material,
    launcherKind: prev.launcherKind,
    admissionClass: prev.admissionClass,
    plannedAt: prev.plannedAt,
    updatedAt: at,
    attempts: prev.attempts,
    reservation: prev.reservation,
    disposition: prev.disposition,
  };
}

/** The current attempt, when `prev` is in one of `states`, has no disposition, and `attempt` names it. */
function liveAttempt(prev: LaunchRecord, attempt: number, states: readonly LaunchRecord["state"][]): AttemptRef | string {
  if (!states.includes(prev.state)) return `${prev.id} is ${prev.state}, not ${states.join(" or ")}`;
  if (prev.disposition !== null) return `${prev.id} was disposed by ${prev.disposition.actor}; only a release may follow`;
  if (prev.state !== "launching" && prev.state !== "observed-running" && prev.state !== "outcome-unknown") return `${prev.id} has no live attempt`;
  if (prev.current.attempt !== attempt) return `attempt ${attempt} is not ${prev.id}'s current attempt ${prev.current.attempt}`;
  return prev.current;
}

/**
 * **ONE EVENT AGAINST ONE RECORD — the transition relation, all of it.**
 *
 * Every arm answers *could this line have been written after that one?* A
 * line that could not is `history-lost` on replay and a refused append when
 * live, so the relation is the same in both places by construction.
 */
function nextRecord(prev: LaunchRecord | undefined, event: LaunchEvent): Step {
  if (event.kind === "planned") {
    if (prev !== undefined) return illegal(`${event.occurrenceId} was planned twice`);
    const expected = occurrenceIdOf(event.origin);
    if (expected !== event.occurrenceId) return illegal(`${event.occurrenceId} is not the id of its own origin (${expected})`);
    return {
      ok: true,
      record: {
        id: event.occurrenceId,
        origin: event.origin,
        material: event.material,
        launcherKind: event.launcherKind,
        admissionClass: event.admissionClass,
        plannedAt: event.at,
        updatedAt: event.at,
        attempts: [],
        reservation: { kind: "none" },
        disposition: null,
        state: "planned",
      },
    };
  }
  if (prev === undefined) return illegal(`${event.kind} for ${event.occurrenceId}, which was never planned`);
  const base = commonOf(prev, event.at);
  switch (event.kind) {
    case "waiting-admission":
      if (!admissible(prev)) return illegal(`${prev.id} is ${prev.state} and cannot wait for admission`);
      return { ok: true, record: { ...base, state: "waiting-admission", why: event.why } };
    case "reserved":
      if (!admissible(prev)) return illegal(`${prev.id} is ${prev.state} and cannot be reserved`);
      if (event.reservationKey !== reservationKeyOf(prev.id)) return illegal(`reservation key ${event.reservationKey} is not ${prev.id}'s`);
      return {
        ok: true,
        record: { ...base, reservation: { kind: "held", key: event.reservationKey, slot: event.slot, ownerId: event.ownerId, since: event.at }, state: "reserved" },
      };
    case "launching": {
      if (prev.state !== "reserved") return illegal(`${prev.id} is ${prev.state}; launching needs reserved`);
      const attempt = prev.attempts.length + 1;
      if (event.attempt !== attempt) return illegal(`attempt ${event.attempt} is not ${prev.id}'s next attempt ${attempt}`);
      if (attempt > MAX_ATTEMPTS || event.correlationId !== correlationIdOf(prev.id, attempt)) return illegal(`correlation id ${event.correlationId} is not ${prev.id}'s attempt ${attempt}`);
      if (!artefactDirFits(event.artefactDir, prev.id, attempt)) return illegal(`artefact dir ${event.artefactDir} is not ${prev.id}'s attempt ${attempt}`);
      const current: AttemptRef = { attempt, correlationId: event.correlationId, artefactDir: event.artefactDir };
      return { ok: true, record: { ...base, attempts: [...prev.attempts, current], state: "launching", current } };
    }
    case "observed-running": {
      const current = liveAttempt(prev, event.attempt, ["launching", "outcome-unknown"]);
      if (typeof current === "string") return illegal(current);
      return { ok: true, record: { ...base, state: "observed-running", current, evidence: event.evidence } };
    }
    case "completed": {
      const current = liveAttempt(prev, event.attempt, ["launching", "observed-running", "outcome-unknown"]);
      if (typeof current === "string") return illegal(current);
      return { ok: true, record: { ...base, state: "completed", current, evidence: event.evidence } };
    }
    case "outcome-unknown": {
      const current = liveAttempt(prev, event.attempt, ["launching", "observed-running"]);
      if (typeof current === "string") return illegal(current);
      return { ok: true, record: { ...base, state: "outcome-unknown", current, why: event.why, looked: event.looked } };
    }
    case "failed-before-launch": {
      if (prev.disposition !== null) return illegal(`${prev.id} was disposed; only a release may follow`);
      if (event.attempt === null) {
        if (event.proof === "admission-refused") {
          if (!admissible(prev)) return illegal(`${prev.id} is ${prev.state}; an admission refusal needs a record asking for admission`);
        } else if (event.proof === "launcher-refused") {
          return illegal("a launcher refusal must name its attempt");
        } else if (prev.state !== "reserved") {
          return illegal(`${prev.id} is ${prev.state}; ${event.proof} needs reserved`);
        }
        return { ok: true, record: { ...base, state: "failed-before-launch", attempt: null, proof: event.proof, why: event.why } };
      }
      if (event.proof !== "launcher-refused") return illegal(`${event.proof} cannot name an attempt: the launcher was never reached`);
      if (prev.state !== "launching" || prev.current.attempt !== event.attempt) return illegal(`${prev.id} is not launching attempt ${event.attempt}`);
      return { ok: true, record: { ...base, state: "failed-before-launch", attempt: prev.current, proof: event.proof, why: event.why } };
    }
    case "released": {
      if (prev.reservation.kind !== "held") return illegal(`${prev.id} holds no reservation to release`);
      const licence = licenceOf(prev);
      if (licence === null) return illegal(`${prev.id} is ${prev.state} with no disposition, so nothing licenses a release`);
      if (JSON.stringify(licence) !== JSON.stringify(event.licence)) return illegal(`the release's licence ${JSON.stringify(event.licence)} is not ${prev.id}'s (${JSON.stringify(licence)})`);
      const held = prev.reservation;
      return {
        ok: true,
        record: { ...prev, updatedAt: event.at, reservation: { kind: "released", key: held.key, slot: held.slot, ownerId: held.ownerId, licence: event.licence, ownerSaid: event.ownerSaid, at: event.at } },
      };
    }
    case "disposed": {
      if (prev.state !== "launching" && prev.state !== "observed-running" && prev.state !== "outcome-unknown") return illegal(`${prev.id} is ${prev.state}; only an unsettled launch can be disposed`);
      if (prev.disposition !== null) return illegal(`${prev.id} was already disposed`);
      return { ok: true, record: { ...prev, updatedAt: event.at, disposition: { actor: event.actor, requestId: event.requestId, decision: event.decision, why: event.why, at: event.at } } };
    }
    default: {
      const never: never = event;
      return illegal(`no transition for ${JSON.stringify(never)}`);
    }
  }
}

/**
 * One line against the whole fold: a commit to apply, or why it is illegal.
 * **Nothing is mutated until `commit` is called**, so a live append can ask
 * first, write the bytes, and only then fold them.
 */
export function stepLine(fold: LaunchFold, line: JournalLine): { ok: true; commit: (builder: FoldBuilder) => void } | { ok: false; why: string } {
  if (line.kind === "history-reset") {
    if (fold.lines !== 0) return { ok: false, why: "a history reset appears after the first line" };
    return {
      ok: true,
      commit: (builder) => {
        builder.reset = line;
        builder.requestIds.add(line.requestId);
        for (const entry of line.carried) builder.carried.set(entry.occurrenceId, { ...entry, disposition: null, released: null });
        builder.lines += 1;
      },
    };
  }
  if (line.kind === "disposed" && fold.requestIds.has(line.requestId)) return { ok: false, why: `request ${line.requestId} was already applied` };

  const carried = fold.carried.get(line.occurrenceId);
  if (carried !== undefined) {
    // A CARRIED OCCURRENCE'S HISTORY IS GONE. Only Greg's disposition and the
    // release it licenses can move it; anything else — a re-plan above all —
    // would be acting on a past nobody can read.
    if (line.kind === "disposed") {
      if (carried.disposition !== null) return { ok: false, why: `${line.occurrenceId} was already disposed` };
      const disposition: Disposition = { actor: line.actor, requestId: line.requestId, decision: line.decision, why: line.why, at: line.at };
      return {
        ok: true,
        commit: (builder) => {
          builder.carried.set(line.occurrenceId, { ...carried, disposition });
          builder.requestIds.add(line.requestId);
          builder.lines += 1;
        },
      };
    }
    if (line.kind === "released") {
      if (carried.ownerHeld === null || carried.released !== null) return { ok: false, why: `${line.occurrenceId} holds no carried reservation to release` };
      if (carried.disposition === null || line.licence.kind !== "disposed" || line.licence.requestId !== carried.disposition.requestId) {
        return { ok: false, why: `${line.occurrenceId}'s carried reservation is released only by its own disposition` };
      }
      return {
        ok: true,
        commit: (builder) => {
          builder.carried.set(line.occurrenceId, { ...carried, released: { ownerSaid: line.ownerSaid, at: line.at } });
          builder.lines += 1;
        },
      };
    }
    return { ok: false, why: `${line.occurrenceId} was carried over a history reset; only a disposition or its release may follow` };
  }

  const step = nextRecord(fold.occurrences.get(line.occurrenceId), line);
  if (!step.ok) return step;
  return {
    ok: true,
    commit: (builder) => {
      builder.occurrences.set(line.occurrenceId, step.record);
      if (line.kind === "disposed") builder.requestIds.add(line.requestId);
      builder.lines += 1;
    },
  };
}

/* ------------------------------------------------------------------ *
 * The exact parser, one per kind.
 * ------------------------------------------------------------------ */

export type Parsed<T> = { ok: true; value: T } | { ok: false; why: string };

export function isRecord(u: unknown): u is Record<string, unknown> {
  return typeof u === "object" && u !== null && !Array.isArray(u);
}

export function isIsoTimestamp(u: unknown): u is string {
  if (typeof u !== "string") return false;
  const parsed = new Date(u);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === u;
}

export function isText(u: unknown): u is string {
  return typeof u === "string" && u.trim() !== "";
}

export function isNonNegativeInteger(u: unknown): u is number {
  return typeof u === "number" && Number.isSafeInteger(u) && u >= 0;
}

export function isPositiveInteger(u: unknown): u is number {
  return typeof u === "number" && Number.isSafeInteger(u) && u > 0;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function isSha256(u: unknown): u is string {
  return typeof u === "string" && SHA256_PATTERN.test(u);
}

/** EXACT: a field this version does not know is a line it does not understand. Missing fields are caught by the type checks that follow. */
export function unexpectedField(u: Record<string, unknown>, fields: readonly string[]): string | null {
  for (const key of Object.keys(u)) if (!fields.includes(key)) return `unexpected field ${JSON.stringify(key)}`;
  return null;
}

function object(u: unknown, name: string, fields: readonly string[]): Parsed<Record<string, unknown>> {
  if (!isRecord(u)) return { ok: false, why: `${name} is not an object` };
  const extra = unexpectedField(u, fields);
  if (extra !== null) return { ok: false, why: `${name}: ${extra}` };
  return { ok: true, value: u };
}

function parseOrigin(u: unknown): Parsed<LaunchOrigin> {
  if (!isRecord(u)) return { ok: false, why: "origin is not an object" };
  let origin: LaunchOrigin;
  if (u["kind"] === "schedule") {
    const o = object(u, "origin", ["kind", "jobId", "scheduledAt", "behaviourHash"]);
    if (!o.ok) return o;
    const { jobId, scheduledAt, behaviourHash } = o.value;
    if (typeof jobId !== "string" || typeof scheduledAt !== "string" || typeof behaviourHash !== "string") return { ok: false, why: "a schedule origin is three strings" };
    origin = { kind: "schedule", jobId, scheduledAt, behaviourHash };
  } else if (u["kind"] === "recovery") {
    const o = object(u, "origin", ["kind", "candidateId"]);
    if (!o.ok) return o;
    const { candidateId } = o.value;
    if (typeof candidateId !== "string") return { ok: false, why: "a recovery origin's candidateId is not a string" };
    origin = { kind: "recovery", candidateId };
  } else {
    return { ok: false, why: `origin kind ${JSON.stringify(u["kind"])} is not one this version knows` };
  }
  const problem = originProblem(origin);
  return problem === null ? { ok: true, value: origin } : { ok: false, why: `origin: ${problem}` };
}

export function parseMaterialPin(u: unknown): Parsed<MaterialPin> {
  const o = object(u, "material", ["sha256", "bytes"]);
  if (!o.ok) return o;
  const { sha256, bytes } = o.value;
  if (!isSha256(sha256)) return { ok: false, why: "material.sha256 is not a sha256" };
  if (!isNonNegativeInteger(bytes) || bytes > MAX_MATERIAL_BYTES) return { ok: false, why: "material.bytes is not a size" };
  return { ok: true, value: { sha256, bytes } };
}

export function parseExitEnding(u: unknown): Parsed<ExitEnding> {
  if (!isRecord(u)) return { ok: false, why: "ending is not an object" };
  switch (u["kind"]) {
    case "exited": {
      const o = object(u, "ending", ["kind", "code"]);
      if (!o.ok) return o;
      const code = o.value["code"];
      if (typeof code !== "number" || !Number.isInteger(code)) return { ok: false, why: "ending.code is not an integer" };
      return { ok: true, value: { kind: "exited", code } };
    }
    case "signalled": {
      const o = object(u, "ending", ["kind", "signal"]);
      if (!o.ok) return o;
      const signal = o.value["signal"];
      if (!isText(signal)) return { ok: false, why: "ending.signal is not a signal name" };
      return { ok: true, value: { kind: "signalled", signal } };
    }
    case "supervisor-failed": {
      const o = object(u, "ending", ["kind", "why"]);
      if (!o.ok) return o;
      const why = o.value["why"];
      if (!isText(why)) return { ok: false, why: "ending.why is not a reason" };
      return { ok: true, value: { kind: "supervisor-failed", why } };
    }
    default:
      return { ok: false, why: `ending kind ${JSON.stringify(u["kind"])} is not one this version knows` };
  }
}

export function parseExitAnswer(u: unknown): Parsed<ExitAnswer | null> {
  if (u === null) return { ok: true, value: null };
  const o = object(u, "answer", ["path", "bytes", "sha256", "usable"]);
  if (!o.ok) return o;
  const { path, bytes, sha256, usable } = o.value;
  if (!isText(path)) return { ok: false, why: "answer.path is not a path" };
  if (!isNonNegativeInteger(bytes)) return { ok: false, why: "answer.bytes is not a size" };
  if (!isSha256(sha256)) return { ok: false, why: "answer.sha256 is not a sha256" };
  if (typeof usable !== "boolean") return { ok: false, why: "answer.usable is not a boolean" };
  return { ok: true, value: { path, bytes, sha256, usable } };
}

function parseRunning(u: unknown): Parsed<RunningEvidence> {
  if (!isRecord(u)) return { ok: false, why: "evidence is not an object" };
  if (u["kind"] === "start-artefact") {
    const o = object(u, "evidence", ["kind", "pid", "startTicks", "bootId"]);
    if (!o.ok) return o;
    const { pid, startTicks, bootId } = o.value;
    if (!isPositiveInteger(pid) || !isNonNegativeInteger(startTicks) || !isText(bootId)) return { ok: false, why: "start-artefact evidence is a pid, a tick count and a boot id" };
    return { ok: true, value: { kind: "start-artefact", pid, startTicks, bootId } };
  }
  if (u["kind"] === "tmux-session") {
    const o = object(u, "evidence", ["kind", "sessionId"]);
    if (!o.ok) return o;
    const sessionId = o.value["sessionId"];
    if (!isText(sessionId)) return { ok: false, why: "tmux-session evidence names no session" };
    return { ok: true, value: { kind: "tmux-session", sessionId } };
  }
  return { ok: false, why: `running evidence kind ${JSON.stringify(u["kind"])} is not one this version knows` };
}

function parseCompletion(u: unknown): Parsed<CompletionEvidence> {
  if (!isRecord(u)) return { ok: false, why: "evidence is not an object" };
  if (u["kind"] === "exit-record") {
    const o = object(u, "evidence", ["kind", "ending", "timedOut", "answer"]);
    if (!o.ok) return o;
    const ending = parseExitEnding(o.value["ending"]);
    if (!ending.ok) return ending;
    const answer = parseExitAnswer(o.value["answer"]);
    if (!answer.ok) return answer;
    const timedOut = o.value["timedOut"];
    if (typeof timedOut !== "boolean") return { ok: false, why: "evidence.timedOut is not a boolean" };
    return { ok: true, value: { kind: "exit-record", ending: ending.value, timedOut, answer: answer.value } };
  }
  if (u["kind"] === "rebooted") {
    const o = object(u, "evidence", ["kind", "recordedBootId", "currentBootId"]);
    if (!o.ok) return o;
    const { recordedBootId, currentBootId } = o.value;
    if (!isText(recordedBootId) || !isText(currentBootId) || recordedBootId === currentBootId) return { ok: false, why: "rebooted evidence is two different boot ids" };
    return { ok: true, value: { kind: "rebooted", recordedBootId, currentBootId } };
  }
  return { ok: false, why: `completion evidence kind ${JSON.stringify(u["kind"])} is not one this version knows` };
}

function parseLicence(u: unknown): Parsed<ReleaseEvidence> {
  if (!isRecord(u)) return { ok: false, why: "licence is not an object" };
  if (u["kind"] === "terminal") {
    const o = object(u, "licence", ["kind", "state"]);
    if (!o.ok) return o;
    const state = o.value["state"];
    if (state !== "completed" && state !== "failed-before-launch") return { ok: false, why: "licence.state is not a terminal state" };
    return { ok: true, value: { kind: "terminal", state } };
  }
  if (u["kind"] === "disposed") {
    const o = object(u, "licence", ["kind", "requestId"]);
    if (!o.ok) return o;
    const requestId = o.value["requestId"];
    if (!isText(requestId)) return { ok: false, why: "licence.requestId is not a request id" };
    return { ok: true, value: { kind: "disposed", requestId } };
  }
  return { ok: false, why: `licence kind ${JSON.stringify(u["kind"])} is not one this version knows` };
}

const FAILED_PROOFS: readonly FailedProof[] = ["admission-refused", "restarted-before-launching", "material-mismatch", "intent-not-written", "launcher-refused"];
const OWNER_ANSWERS: readonly OwnerAnswer[] = ["released", "was-not-held", "none-on-lookup"];
const EVENT_KINDS: readonly LaunchEvent["kind"][] = [
  "planned",
  "waiting-admission",
  "reserved",
  "launching",
  "observed-running",
  "completed",
  "failed-before-launch",
  "outcome-unknown",
  "released",
  "disposed",
];

function parseCarried(u: unknown): Parsed<CarriedEntry> {
  const o = object(u, "carried entry", ["occurrenceId", "lastSeen", "ownerHeld"]);
  if (!o.ok) return o;
  const { occurrenceId, lastSeen, ownerHeld } = o.value;
  if (!isLaunchOccurrenceId(occurrenceId)) return { ok: false, why: "carried occurrenceId is not an occurrence id" };
  if (lastSeen !== null && !(EVENT_KINDS as readonly unknown[]).includes(lastSeen)) return { ok: false, why: "carried lastSeen is not an event kind" };
  let held: { slot: string } | null = null;
  if (ownerHeld !== null) {
    const h = object(ownerHeld, "ownerHeld", ["slot"]);
    if (!h.ok) return h;
    if (!isText(h.value["slot"])) return { ok: false, why: "ownerHeld.slot is not a slot" };
    held = { slot: h.value["slot"] };
  }
  return { ok: true, value: { occurrenceId, lastSeen: lastSeen as LaunchEvent["kind"] | null, ownerHeld: held } };
}

function parseReset(u: Record<string, unknown>, at: string): Parsed<HistoryResetEvent> {
  const o = object(u, "history-reset", ["v", "kind", "at", "actor", "requestId", "why", "preservedAs", "lostAt", "acknowledgement", "carried"]);
  if (!o.ok) return o;
  const { actor, requestId, why, preservedAs, lostAt, acknowledgement, carried } = o.value;
  if (!isText(actor) || !isText(requestId) || !isText(why) || !isText(preservedAs)) return { ok: false, why: "a history reset names its actor, request, reason and preserved file" };
  if (acknowledgement !== HIDDEN_LAUNCH_ACKNOWLEDGEMENT) return { ok: false, why: "a history reset must carry the hidden-launch acknowledgement" };
  const lost = object(lostAt, "lostAt", ["line", "why"]);
  if (!lost.ok) return lost;
  const line = lost.value["line"];
  const lostWhy = lost.value["why"];
  if (!isPositiveInteger(line) || !isText(lostWhy)) return { ok: false, why: "lostAt is a line number and a reason" };
  if (!Array.isArray(carried)) return { ok: false, why: "carried is a list" };
  const entries: CarriedEntry[] = [];
  for (const one of carried) {
    const entry = parseCarried(one);
    if (!entry.ok) return entry;
    if (entries.some((e) => e.occurrenceId === entry.value.occurrenceId)) return { ok: false, why: `${entry.value.occurrenceId} is carried twice` };
    entries.push(entry.value);
  }
  return {
    ok: true,
    value: { v: 1, kind: "history-reset", at, actor, requestId, why, preservedAs, lostAt: { line, why: lostWhy }, acknowledgement, carried: entries },
  };
}

/** One journal line off the disk, exactly. Anything it does not recognise completely is refused. */
export function parseJournalLine(text: string): Parsed<JournalLine> {
  let u: unknown;
  try {
    u = JSON.parse(text);
  } catch (cause) {
    return { ok: false, why: `not JSON: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  if (!isRecord(u)) return { ok: false, why: "not an object" };
  if (u["v"] !== LAUNCH_SCHEMA) return { ok: false, why: `schema ${JSON.stringify(u["v"])} is not one this version reads` };
  const at = u["at"];
  if (!isIsoTimestamp(at)) return { ok: false, why: "at is not an ISO timestamp" };
  if (u["kind"] === "history-reset") return parseReset(u, at);
  const occurrenceId = u["occurrenceId"];
  if (!isLaunchOccurrenceId(occurrenceId)) return { ok: false, why: "occurrenceId is not an occurrence id" };
  const common = { v: 1 as const, occurrenceId, at };
  const fields = (...more: string[]): string | null => unexpectedField(u, ["v", "kind", "occurrenceId", "at", ...more]);
  const kind = u["kind"];
  switch (kind) {
    case "planned": {
      const extra = fields("origin", "material", "launcherKind", "admissionClass");
      if (extra !== null) return { ok: false, why: extra };
      const origin = parseOrigin(u["origin"]);
      if (!origin.ok) return origin;
      const material = parseMaterialPin(u["material"]);
      if (!material.ok) return material;
      const launcherKind = u["launcherKind"];
      const admissionClass = u["admissionClass"];
      if (!isLauncherKind(launcherKind)) return { ok: false, why: "launcherKind is not a launcher" };
      if (!isAdmissionClass(admissionClass)) return { ok: false, why: "admissionClass is not an admission class" };
      return { ok: true, value: { ...common, kind, origin: origin.value, material: material.value, launcherKind, admissionClass } };
    }
    case "waiting-admission": {
      const extra = fields("why");
      if (extra !== null) return { ok: false, why: extra };
      const why = u["why"];
      if (!isText(why)) return { ok: false, why: "why is not a reason" };
      return { ok: true, value: { ...common, kind, why } };
    }
    case "reserved": {
      const extra = fields("reservationKey", "slot", "ownerId", "how");
      if (extra !== null) return { ok: false, why: extra };
      const reservationKey = asReservationKey(u["reservationKey"]);
      const { slot, ownerId, how } = u;
      if (reservationKey === null) return { ok: false, why: "reservationKey is not a reservation key" };
      if (!isText(slot) || !isText(ownerId)) return { ok: false, why: "a reservation names its slot and owner" };
      if (how !== "granted" && how !== "found-on-lookup") return { ok: false, why: "how is not granted or found-on-lookup" };
      return { ok: true, value: { ...common, kind, reservationKey, slot, ownerId, how } };
    }
    case "launching": {
      const extra = fields("attempt", "correlationId", "artefactDir");
      if (extra !== null) return { ok: false, why: extra };
      const { attempt, correlationId, artefactDir } = u;
      if (!isPositiveInteger(attempt)) return { ok: false, why: "attempt is not an attempt number" };
      if (!isCorrelationId(correlationId)) return { ok: false, why: "correlationId is not a correlation id" };
      if (!isText(artefactDir)) return { ok: false, why: "artefactDir is not a path" };
      return { ok: true, value: { ...common, kind, attempt, correlationId, artefactDir } };
    }
    case "observed-running": {
      const extra = fields("attempt", "evidence");
      if (extra !== null) return { ok: false, why: extra };
      const attempt = u["attempt"];
      if (!isPositiveInteger(attempt)) return { ok: false, why: "attempt is not an attempt number" };
      const evidence = parseRunning(u["evidence"]);
      if (!evidence.ok) return evidence;
      return { ok: true, value: { ...common, kind, attempt, evidence: evidence.value } };
    }
    case "completed": {
      const extra = fields("attempt", "evidence");
      if (extra !== null) return { ok: false, why: extra };
      const attempt = u["attempt"];
      if (!isPositiveInteger(attempt)) return { ok: false, why: "attempt is not an attempt number" };
      const evidence = parseCompletion(u["evidence"]);
      if (!evidence.ok) return evidence;
      return { ok: true, value: { ...common, kind, attempt, evidence: evidence.value } };
    }
    case "failed-before-launch": {
      const extra = fields("attempt", "proof", "why");
      if (extra !== null) return { ok: false, why: extra };
      const { attempt, proof, why } = u;
      if (attempt !== null && !isPositiveInteger(attempt)) return { ok: false, why: "attempt is not an attempt number or null" };
      if (!(FAILED_PROOFS as readonly unknown[]).includes(proof)) return { ok: false, why: "proof is not one this version knows" };
      if (!isText(why)) return { ok: false, why: "why is not a reason" };
      return { ok: true, value: { ...common, kind, attempt, proof: proof as FailedProof, why } };
    }
    case "outcome-unknown": {
      const extra = fields("attempt", "why", "looked");
      if (extra !== null) return { ok: false, why: extra };
      const { attempt, why, looked } = u;
      if (!isPositiveInteger(attempt)) return { ok: false, why: "attempt is not an attempt number" };
      if (!isText(why)) return { ok: false, why: "why is not a reason" };
      if (!Array.isArray(looked) || !looked.every((one) => typeof one === "string")) return { ok: false, why: "looked is not a list of strings" };
      return { ok: true, value: { ...common, kind, attempt, why, looked } };
    }
    case "released": {
      const extra = fields("licence", "ownerSaid");
      if (extra !== null) return { ok: false, why: extra };
      const licence = parseLicence(u["licence"]);
      if (!licence.ok) return licence;
      const ownerSaid = u["ownerSaid"];
      if (!(OWNER_ANSWERS as readonly unknown[]).includes(ownerSaid)) return { ok: false, why: "ownerSaid is not an owner answer" };
      return { ok: true, value: { ...common, kind, licence: licence.value, ownerSaid: ownerSaid as OwnerAnswer } };
    }
    case "disposed": {
      const extra = fields("actor", "requestId", "decision", "why");
      if (extra !== null) return { ok: false, why: extra };
      const { actor, requestId, decision, why } = u;
      if (!isText(actor) || !isText(requestId) || !isText(why)) return { ok: false, why: "a disposition names its actor, request and reason" };
      if (decision !== "not-running" && decision !== "ended") return { ok: false, why: "decision is not not-running or ended" };
      return { ok: true, value: { ...common, kind, actor, requestId, decision, why } };
    }
    default:
      return { ok: false, why: `kind ${JSON.stringify(kind)} is not one this version knows` };
  }
}

export type JournalStatus = { readonly kind: "whole" } | { readonly kind: "history-lost"; readonly atLine: number; readonly why: string };

/**
 * Replay a journal's complete lines. Stops at the first line that does not
 * parse or is not legal — **nothing past a hole is folded** — and says where.
 */
export function replayJournal(texts: readonly string[]): { fold: FoldBuilder; status: JournalStatus } {
  const fold = emptyFold();
  for (let index = 0; index < texts.length; index += 1) {
    const parsed = parseJournalLine(texts[index] ?? "");
    const step = parsed.ok ? stepLine(fold, parsed.value) : parsed;
    if (!step.ok) return { fold, status: { kind: "history-lost", atLine: index + 1, why: step.why } };
    step.commit(fold);
  }
  return { fold, status: { kind: "whole" } };
}

/* ------------------------------------------------------------------ *
 * The ports: what the protocol needs from the store, the owner, the launchers and the world.
 * ------------------------------------------------------------------ */

export type Written = { readonly ok: true } | { readonly ok: false; readonly why: string };

/** What the protocol needs from the launch store. Structural, so a test can wrap the real one to die at a named point. */
export type LaunchJournal = {
  status(): JournalStatus;
  fold(): LaunchFold;
  /** Validated against the fold before a byte is written, fsynced before it answers. */
  append(event: LaunchEvent): Written;
  writeMaterial(id: LaunchOccurrenceId, bytes: Buffer): Written;
  readMaterial(id: LaunchOccurrenceId): { readonly ok: true; readonly bytes: Buffer } | { readonly ok: false; readonly why: string };
  attemptDir(id: LaunchOccurrenceId, attempt: number): string;
  /** Creates the attempt directory at 0700 and writes `intent.json` into it durably. */
  writeIntent(id: LaunchOccurrenceId, attempt: number, intent: LaunchIntent): Written;
};

/** The store's F2 operation, which the protocol drives with the owner's inventory. */
export type ResettableJournal = LaunchJournal & {
  resetHistory(input: { request: HistoryResolutionRequest; at: string; ownerReservations: readonly HeldReservation[] }): { ok: true; reset: HistoryResetEvent } | { ok: false; why: string };
};

export type LaunchInput = {
  readonly occurrenceId: LaunchOccurrenceId;
  readonly attempt: number;
  readonly correlationId: CorrelationId;
  readonly artefactDir: string;
  /** The verified bytes. There is no other prompt parameter (F5). */
  readonly material: VerifiedMaterial;
};

/**
 * What a launcher says, SYNCHRONOUSLY. `refused-before-effect` claims nothing
 * external happened and is a settled outcome; `started` claims the first effect
 * happened. **A throw is neither**: it is a launcher that may have done
 * something, and the attempt stays `launching` for reconciliation to find out.
 */
export type LauncherAnswer = { readonly kind: "started"; readonly detail: string } | { readonly kind: "refused-before-effect"; readonly why: string };

export type Launcher = { readonly kind: LauncherKind; launch(input: LaunchInput): LauncherAnswer };

export type TmuxReading = { readonly kind: "found"; readonly sessionId: string } | { readonly kind: "absent" } | { readonly kind: "cannot-tell"; readonly why: string };

/** D7's ports. Reads only; nothing here may start or stop anything. */
export type EvidencePorts = {
  readonly artefacts: (dir: string, correlationId: CorrelationId) => ArtefactReadings;
  readonly identity: (start: StartRecord) => IdentityReading;
  readonly boot: () => BootIdentity;
  /** Asked only about tmux launches. */
  readonly tmux: (correlationId: CorrelationId) => TmuxReading;
};

export type LaunchParts = {
  readonly journal: LaunchJournal;
  readonly owner: AdmissionOwner;
  /** The launch capability. A kind with no launcher here is refused before anything is reserved. */
  readonly launchers: Partial<Readonly<Record<LauncherKind, Launcher>>>;
  readonly evidence: EvidencePorts;
  /** Injected, always. Nothing in this area reads the wall clock for itself. */
  readonly now: () => Date;
};

/* ------------------------------------------------------------------ *
 * plan().
 * ------------------------------------------------------------------ */

export type PlanRequest = {
  readonly origin: LaunchOrigin;
  /** The exact prompt the child will be given. Pinned to disk before `planned`. */
  readonly material: string;
  readonly launcherKind: LauncherKind;
  readonly admissionClass: AdmissionClass;
};

export type PlanResult =
  | { readonly kind: "planned"; readonly record: LaunchRecord; readonly created: boolean }
  /** An existing id asked for with different inputs (F5). Nothing was written. */
  | { readonly kind: "conflict"; readonly existing: LaunchRecord; readonly why: string }
  | { readonly kind: "refused"; readonly why: string };

function guarded<T>(what: string, run: () => T, onThrow: (why: string) => T): T {
  try {
    return run();
  } catch (cause) {
    return onThrow(`${what} threw: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function appendGuarded(journal: LaunchJournal, event: LaunchEvent): Written {
  return guarded(`appending ${event.kind}`, () => journal.append(event), (why) => ({ ok: false, why }));
}

function lostWhy(status: JournalStatus): string | null {
  return status.kind === "history-lost" ? `the launch journal lost its history at line ${status.atLine} (${status.why}); nothing is planned until Greg resolves it` : null;
}

/**
 * Pin the material and record the occurrence, or return the one already there.
 * Idempotent for the same inputs; a conflict for different ones.
 */
export function plan(parts: Pick<LaunchParts, "journal" | "now">, request: PlanRequest): PlanResult {
  const { journal } = parts;
  const status = guarded("reading the journal status", () => journal.status(), (why): JournalStatus => ({ kind: "history-lost", atLine: 0, why }));
  const lost = lostWhy(status);
  if (lost !== null) return { kind: "refused", why: lost };
  const problem = originProblem(request.origin);
  if (problem !== null) return { kind: "refused", why: `the origin is not launchable: ${problem}` };
  if (!isLauncherKind(request.launcherKind) || !isAdmissionClass(request.admissionClass)) return { kind: "refused", why: "unknown launcher kind or admission class" };
  const bytes = Buffer.from(request.material, "utf8");
  if (bytes.byteLength === 0) return { kind: "refused", why: "the material is empty, so there is nothing to launch" };
  if (bytes.byteLength > MAX_MATERIAL_BYTES) return { kind: "refused", why: `the material is ${bytes.byteLength} bytes, over the ${MAX_MATERIAL_BYTES} limit` };
  const pin = pinOf(bytes);
  const id = occurrenceIdOf(request.origin);
  const fold = journal.fold();
  if (fold.carried.has(id)) return { kind: "refused", why: `${id} was carried over a history reset; it may already have launched, so it is never planned again` };

  const existing = fold.occurrences.get(id);
  if (existing !== undefined) {
    const differences: string[] = [];
    if (!sameOrigin(existing.origin, request.origin)) differences.push("origin");
    if (existing.launcherKind !== request.launcherKind) differences.push("launcher kind");
    if (existing.admissionClass !== request.admissionClass) differences.push("admission class");
    if (existing.material.bytes !== pin.bytes || existing.material.sha256 !== pin.sha256) differences.push("material");
    if (differences.length > 0) return { kind: "conflict", existing, why: `${id} already exists with a different ${differences.join(", ")}` };
    return { kind: "planned", record: existing, created: false };
  }

  const pinned = guarded("pinning the material", () => journal.writeMaterial(id, bytes), (why): Written => ({ ok: false, why }));
  if (!pinned.ok) return { kind: "refused", why: `the material could not be pinned, so nothing was planned: ${pinned.why}` };
  const wrote = appendGuarded(journal, {
    v: 1,
    kind: "planned",
    occurrenceId: id,
    at: parts.now().toISOString(),
    origin: request.origin,
    material: pin,
    launcherKind: request.launcherKind,
    admissionClass: request.admissionClass,
  });
  if (!wrote.ok) return { kind: "refused", why: `the plan could not be recorded: ${wrote.why}` };
  const record = journal.fold().occurrences.get(id);
  if (record === undefined) return { kind: "refused", why: "the plan was recorded and the fold does not show it" };
  return { kind: "planned", record, created: true };
}

/* ------------------------------------------------------------------ *
 * D4. The ordered steps.
 * ------------------------------------------------------------------ */

export type LaunchOutcome =
  | { readonly kind: "refused"; readonly why: string }
  | { readonly kind: "conflict"; readonly occurrenceId: LaunchOccurrenceId; readonly why: string }
  /** Already in flight or ended; nothing was asked of anybody. */
  | { readonly kind: "not-launchable"; readonly occurrenceId: LaunchOccurrenceId; readonly state: LaunchRecord["state"]; readonly why: string }
  | { readonly kind: "waiting"; readonly occurrenceId: LaunchOccurrenceId; readonly why: string }
  | { readonly kind: "failed-before-launch"; readonly occurrenceId: LaunchOccurrenceId; readonly proof: FailedProof; readonly why: string }
  /** A write before the invocation did not land. **Nothing was invoked**; reconciliation settles what the journal shows. */
  | { readonly kind: "not-launched"; readonly occurrenceId: LaunchOccurrenceId; readonly why: string }
  /** The launcher was invoked. `threw` means it may or may not have had its effect; the attempt stays `launching`. */
  | {
      readonly kind: "invoked";
      readonly occurrenceId: LaunchOccurrenceId;
      readonly correlationId: CorrelationId;
      readonly launcher: "started" | "threw";
      readonly detail: string;
    };

/**
 * **THE ENTRY POINT A CONSUMER HOLDS.** Plan (idempotently), then drive the
 * occurrence as far as the launcher, in one synchronous call.
 *
 * Two calls for one origin are one occurrence: the second finds it in flight
 * and answers `not-launchable` without asking the owner or the launcher
 * anything — Gradual recovery's duplicate-tap test, by construction.
 */
export function launchOccurrence(parts: LaunchParts, request: PlanRequest): LaunchOutcome {
  const planned = plan(parts, request);
  if (planned.kind === "refused") return planned;
  if (planned.kind === "conflict") return { kind: "conflict", occurrenceId: planned.existing.id, why: planned.why };
  return drive(parts, planned.record.id);
}

/**
 * The prefix: reserve → record reserved → verify material → intent.json →
 * record launching → invoke once. **Synchronous and non-yielding from the
 * first line to the invocation** (F9); every early return is before the
 * launcher and says what the journal now shows.
 */
function drive(parts: LaunchParts, id: LaunchOccurrenceId): LaunchOutcome {
  const { journal, owner } = parts;
  const lost = lostWhy(journal.status());
  if (lost !== null) return { kind: "refused", why: lost };
  const record = journal.fold().occurrences.get(id);
  if (record === undefined) return { kind: "refused", why: `${id} is not in the journal` };

  if (!(admissible(record) || record.state === "reserved")) {
    return { kind: "not-launchable", occurrenceId: id, state: record.state, why: `${id} is ${record.state}${record.disposition === null ? "" : " and disposed"}; it is not launched again` };
  }
  // THE CAPABILITY, checked before anything is reserved: a process that holds
  // no launcher of this kind must not take a slot it cannot use.
  const launcher = parts.launchers[record.launcherKind];
  if (launcher === undefined) return { kind: "refused", why: `this process holds no ${record.launcherKind} launcher` };

  const key = reservationKeyOf(id);
  const at = (): string => parts.now().toISOString();

  // (1) THE RESERVATION. A throw is not an answer: whether a slot was taken is
  // for reconciliation's lookup to find out.
  const grant = guarded<Grant | { readonly kind: "threw"; readonly why: string }>(
    "the admission owner",
    () => owner.reserve(key, record.admissionClass),
    (why) => ({ kind: "threw", why }),
  );
  switch (grant.kind) {
    case "threw":
      return { kind: "not-launched", occurrenceId: id, why: `${grant.why}; reconciliation will look the key up` };
    case "wait": {
      // ONCE PER DISTINCT REASON, not per tick.
      if (record.state !== "waiting-admission" || record.why !== grant.why) {
        const wrote = appendGuarded(journal, { v: 1, kind: "waiting-admission", occurrenceId: id, at: at(), why: grant.why });
        if (!wrote.ok) return { kind: "not-launched", occurrenceId: id, why: `the owner said wait (${grant.why}) and that could not be recorded: ${wrote.why}` };
      }
      return { kind: "waiting", occurrenceId: id, why: grant.why };
    }
    case "refused": {
      if (record.state === "reserved") return { kind: "not-launched", occurrenceId: id, why: `the owner refused a key the journal says is reserved: ${grant.why}` };
      const wrote = appendGuarded(journal, { v: 1, kind: "failed-before-launch", occurrenceId: id, at: at(), attempt: null, proof: "admission-refused", why: grant.why });
      if (!wrote.ok) return { kind: "not-launched", occurrenceId: id, why: `the owner refused (${grant.why}) and that could not be recorded: ${wrote.why}` };
      return { kind: "failed-before-launch", occurrenceId: id, proof: "admission-refused", why: grant.why };
    }
    case "reserved": {
      if (record.state !== "reserved") {
        const wrote = appendGuarded(journal, { v: 1, kind: "reserved", occurrenceId: id, at: at(), reservationKey: key, slot: grant.slot, ownerId: grant.ownerId, how: "granted" });
        if (!wrote.ok) return { kind: "not-launched", occurrenceId: id, why: `the owner granted ${grant.slot} and it could not be recorded (${wrote.why}); reconciliation will find it by lookup` };
      }
      break;
    }
    default: {
      const never: never = grant;
      throw new Error(`no step for grant ${JSON.stringify(never)}`);
    }
  }

  // (2) THE MATERIAL, re-read and re-hashed immediately before `launching` (F5).
  const failBeforeLaunch = (proof: FailedProof, why: string): LaunchOutcome => {
    const wrote = appendGuarded(journal, { v: 1, kind: "failed-before-launch", occurrenceId: id, at: at(), attempt: null, proof, why });
    if (!wrote.ok) return { kind: "not-launched", occurrenceId: id, why: `${why}, and that could not be recorded: ${wrote.why}` };
    releaseIfLicensed(parts, id);
    return { kind: "failed-before-launch", occurrenceId: id, proof, why };
  };
  const read = guarded("reading the material", () => journal.readMaterial(id), (why) => ({ ok: false as const, why }));
  if (!read.ok) return failBeforeLaunch("material-mismatch", `material.txt could not be read back: ${read.why}`);
  const pin = pinOf(read.bytes);
  if (pin.sha256 !== record.material.sha256 || pin.bytes !== record.material.bytes) {
    return failBeforeLaunch("material-mismatch", `material.txt is ${pin.bytes} bytes / ${pin.sha256.slice(0, 12)}, not the pinned ${record.material.bytes} / ${record.material.sha256.slice(0, 12)}`);
  }

  // (3) THE INTENT, then (4) `launching`. The attempt number is the fold's.
  const attempt = record.attempts.length + 1;
  const correlationId = correlationIdOf(id, attempt);
  const artefactDir = journal.attemptDir(id, attempt);
  const boot = guarded("reading the boot id", () => parts.evidence.boot(), (why): BootIdentity => ({ read: false, cause: "boot-identity-unreadable", why }));
  const intent: LaunchIntent = {
    v: 1,
    kind: "intent",
    correlationId,
    occurrenceId: id,
    attempt,
    launcherKind: record.launcherKind,
    material: record.material,
    bootId: boot.read ? boot.id : null,
    at: at(),
  };
  const intended = guarded("writing intent.json", () => journal.writeIntent(id, attempt, intent), (why): Written => ({ ok: false, why }));
  if (!intended.ok) return failBeforeLaunch("intent-not-written", `intent.json could not be written: ${intended.why}`);
  const launching = appendGuarded(journal, { v: 1, kind: "launching", occurrenceId: id, at: at(), attempt, correlationId, artefactDir });
  // A FAILED `launching` APPEND INVOKES NOTHING. The journal says `reserved`,
  // which reconciliation reads as "never launched" — true, because of this line.
  if (!launching.ok) return { kind: "not-launched", occurrenceId: id, why: `launching could not be recorded, so the launcher was not invoked: ${launching.why}` };

  // (5) THE INVOCATION, exactly once.
  let answer: LauncherAnswer;
  try {
    answer = launcher.launch({ occurrenceId: id, attempt, correlationId, artefactDir, material: { bytes: read.bytes, pin } });
  } catch (cause) {
    return { kind: "invoked", occurrenceId: id, correlationId, launcher: "threw", detail: cause instanceof Error ? cause.message : String(cause) };
  }
  if (answer.kind === "refused-before-effect") {
    const wrote = appendGuarded(journal, { v: 1, kind: "failed-before-launch", occurrenceId: id, at: at(), attempt, proof: "launcher-refused", why: answer.why });
    if (!wrote.ok) return { kind: "invoked", occurrenceId: id, correlationId, launcher: "started", detail: `the launcher refused (${answer.why}) and that could not be recorded: ${wrote.why}` };
    releaseIfLicensed(parts, id);
    return { kind: "failed-before-launch", occurrenceId: id, proof: "launcher-refused", why: answer.why };
  }
  return { kind: "invoked", occurrenceId: id, correlationId, launcher: "started", detail: answer.detail };
}

/* ------------------------------------------------------------------ *
 * D7. Reconciliation.
 * ------------------------------------------------------------------ */

export type ReconcilePorts = EvidencePorts & { readonly lookup: (key: ReservationKey) => Lookup };

export type ReconcileDecision =
  | { readonly kind: "record"; readonly occurrenceId: LaunchOccurrenceId; readonly event: LaunchEvent }
  | { readonly kind: "release"; readonly occurrenceId: LaunchOccurrenceId; readonly key: ReservationKey; readonly licence: ReleaseEvidence }
  /** Looked, and could not conclude. Reported; nothing written. */
  | { readonly kind: "hold"; readonly occurrenceId: LaunchOccurrenceId; readonly why: string };

function lookupGuarded(ports: ReconcilePorts, key: ReservationKey): Lookup {
  return guarded("the owner's lookup", () => ports.lookup(key), (why): Lookup => ({ kind: "unavailable", why }));
}

/** F7: a held reservation whose record licenses a release. Released at the owner, or recorded if the owner already says none. */
function releaseDecision(id: LaunchOccurrenceId, licence: ReleaseEvidence, ports: ReconcilePorts, at: string): ReconcileDecision {
  const key = reservationKeyOf(id);
  const found = lookupGuarded(ports, key);
  switch (found.kind) {
    case "reserved":
      return { kind: "release", occurrenceId: id, key, licence };
    case "none":
      return { kind: "record", occurrenceId: id, event: { v: 1, kind: "released", occurrenceId: id, at, licence, ownerSaid: "none-on-lookup" } };
    case "unavailable":
      return { kind: "hold", occurrenceId: id, why: `a release is licensed and the owner cannot answer: ${found.why}` };
    default: {
      const never: never = found;
      throw new Error(`no release step for ${JSON.stringify(never)}`);
    }
  }
}

/**
 * **EVIDENCE BY PRECEDENCE** (F4) for an attempt that may have launched:
 *
 *  1. a valid, correlation-bound `exit.json` → `completed`;
 *  2. otherwise a different boot from the one recorded → `completed` (rebooted);
 *  3. otherwise a matching live identity or a tmux session carrying the id → `observed-running`;
 *  4. otherwise, if any input the remaining decision needs is unavailable → no change;
 *  5. otherwise absence is inconclusive → `outcome-unknown`, reservation held.
 *
 * A same-boot supervisor that is gone is a step-5 fact, not a completion (F1).
 */
function evidenceDecision(record: LaunchRecord & { readonly current: AttemptRef }, ports: ReconcilePorts, at: string): ReconcileDecision | null {
  const { current } = record;
  const common = { v: 1 as const, occurrenceId: record.id, at, attempt: current.attempt };
  const looked: string[] = [];
  const unavailable: string[] = [];
  const art = guarded(
    "reading the artefacts",
    () => ports.artefacts(current.artefactDir, current.correlationId),
    (why): ArtefactReadings => ({ intent: { kind: "unreadable", why }, start: { kind: "unreadable", why }, exit: { kind: "unreadable", why } }),
  );

  // 1. The exit record.
  if (art.exit.kind === "present") {
    const exit = art.exit.record;
    return { kind: "record", occurrenceId: record.id, event: { ...common, kind: "completed", evidence: { kind: "exit-record", ending: exit.ending, timedOut: exit.timedOut, answer: exit.answer } } };
  }
  if (art.exit.kind === "unreadable") unavailable.push(`exit.json unreadable: ${art.exit.why}`);
  else looked.push("no exit.json");

  // 2. The boot.
  const recordedBoot = art.start.kind === "present" ? art.start.record.bootId : art.intent.kind === "present" ? art.intent.record.bootId : null;
  const boot = guarded("reading the boot id", () => ports.boot(), (why): BootIdentity => ({ read: false, cause: "boot-identity-unreadable", why }));
  if (boot.read && recordedBoot !== null && boot.id !== recordedBoot) {
    return { kind: "record", occurrenceId: record.id, event: { ...common, kind: "completed", evidence: { kind: "rebooted", recordedBootId: recordedBoot, currentBootId: boot.id } } };
  }
  if (!boot.read) unavailable.push(`boot id unreadable: ${boot.why}`);
  else if (recordedBoot === null) unavailable.push("neither start.json nor intent.json names the launch's boot");

  // 3. Anything running.
  let running: RunningEvidence | null = null;
  if (art.start.kind === "present") {
    const start = art.start.record;
    const identity = guarded("checking the process", () => ports.identity(start), (why): IdentityReading => ({ kind: "cannot-tell", why }));
    switch (identity.kind) {
      case "alive":
        running = { kind: "start-artefact", pid: start.pid, startTicks: start.startTicks, bootId: start.bootId };
        break;
      case "other-boot":
        if (boot.read) {
          return { kind: "record", occurrenceId: record.id, event: { ...common, kind: "completed", evidence: { kind: "rebooted", recordedBootId: start.bootId, currentBootId: boot.id } } };
        }
        unavailable.push("the process check says another boot and the current boot id is unreadable");
        break;
      case "gone":
        looked.push(`supervisor pid ${start.pid} is gone on this boot (${identity.why}) and wrote no exit.json`);
        break;
      case "cannot-tell":
        unavailable.push(`process check: ${identity.why}`);
        break;
      default: {
        const never: never = identity;
        throw new Error(`no step for identity ${JSON.stringify(never)}`);
      }
    }
  } else if (art.start.kind === "unreadable") {
    unavailable.push(`start.json unreadable: ${art.start.why}`);
  } else {
    looked.push("no start.json");
  }
  if (running === null && record.launcherKind === "tmux") {
    const tmux = guarded("probing tmux", () => ports.tmux(current.correlationId), (why): TmuxReading => ({ kind: "cannot-tell", why }));
    if (tmux.kind === "found") running = { kind: "tmux-session", sessionId: tmux.sessionId };
    else if (tmux.kind === "cannot-tell") unavailable.push(`tmux: ${tmux.why}`);
    else looked.push("no tmux session carries the id");
  }
  if (running !== null) {
    if (record.state === "observed-running") return null;
    return { kind: "record", occurrenceId: record.id, event: { ...common, kind: "observed-running", evidence: running } };
  }

  // 4. Something we needed could not be read: no change.
  if (unavailable.length > 0) return { kind: "hold", occurrenceId: record.id, why: `cannot conclude: ${unavailable.join("; ")}` };

  // 5. Conclusive absence, which is still not proof of anything.
  if (record.state === "outcome-unknown") return null;
  return {
    kind: "record",
    occurrenceId: record.id,
    event: { ...common, kind: "outcome-unknown", why: "no evidence the launch ended and none that it is running; held until evidence or Greg", looked },
  };
}

function decide(record: LaunchRecord, ports: ReconcilePorts, at: string): ReconcileDecision | null {
  // F7 FIRST: a terminal or disposed record whose reservation is still held.
  const licence = licenceOf(record);
  if (record.reservation.kind === "held" && licence !== null) return releaseDecision(record.id, licence, ports, at);
  if (record.disposition !== null) return null;
  // THE LOST REPLY: a record that was asking for admission may hold a slot the
  // journal never heard about. Found → recorded, and no second slot is taken.
  if (admissible(record)) {
    const found = lookupGuarded(ports, reservationKeyOf(record.id));
    if (found.kind === "reserved") {
      return {
        kind: "record",
        occurrenceId: record.id,
        event: { v: 1, kind: "reserved", occurrenceId: record.id, at, reservationKey: reservationKeyOf(record.id), slot: found.slot, ownerId: found.ownerId, how: "found-on-lookup" },
      };
    }
    if (found.kind === "unavailable") return { kind: "hold", occurrenceId: record.id, why: `the owner cannot say whether a slot is held: ${found.why}` };
    return null;
  }
  switch (record.state) {
    case "reserved":
      // NOTHING EXTERNAL HAPPENED. `launching` is durable before any invocation,
      // and no invocation can be in progress while this runs (F9).
      return {
        kind: "record",
        occurrenceId: record.id,
        event: {
          v: 1,
          kind: "failed-before-launch",
          occurrenceId: record.id,
          at,
          attempt: null,
          proof: "restarted-before-launching",
          why: "the journal ends at reserved, and the launcher is invoked only after launching is durable, so nothing was started",
        },
      };
    case "launching":
    case "observed-running":
    case "outcome-unknown":
      return evidenceDecision(record, ports, at);
    case "planned":
    case "waiting-admission":
    case "completed":
    case "failed-before-launch":
      return null;
    default: {
      const never: never = record;
      throw new Error(`no reconciliation for ${JSON.stringify(never)}`);
    }
  }
}

function decideCarried(carried: CarriedOccurrence, ports: ReconcilePorts, at: string): ReconcileDecision | null {
  if (carried.disposition === null || carried.ownerHeld === null || carried.released !== null) return null;
  return releaseDecision(carried.occurrenceId, { kind: "disposed", requestId: carried.disposition.requestId }, ports, at);
}

/**
 * **THE ONLY THING THAT MOVES `launching`, `observed-running` OR
 * `outcome-unknown`**, and it never invokes a launcher. Reads through the
 * ports; decides; writes nothing itself — {@link reconcileAll} applies.
 */
export function reconcile(fold: LaunchFold, ports: ReconcilePorts, at: string): readonly ReconcileDecision[] {
  const decisions: ReconcileDecision[] = [];
  for (const record of fold.occurrences.values()) {
    const decision = decide(record, ports, at);
    if (decision !== null) decisions.push(decision);
  }
  for (const carried of fold.carried.values()) {
    const decision = decideCarried(carried, ports, at);
    if (decision !== null) decisions.push(decision);
  }
  return decisions;
}

export type ReconcileReport = {
  readonly occurrenceId: LaunchOccurrenceId;
  readonly did: "recorded" | "released" | "held" | "failed";
  readonly what: string;
};

/** Release at the owner, then record it. The owner's release is idempotent, so a crash between the two is settled by the next pass. */
function applyRelease(parts: LaunchParts, id: LaunchOccurrenceId, key: ReservationKey, licence: ReleaseEvidence): ReconcileReport {
  const answer = guarded("the owner's release", () => parts.owner.release(key, licence), (why) => ({ kind: "unavailable" as const, why }));
  if (answer.kind === "unavailable") return { occurrenceId: id, did: "failed", what: `the owner could not release ${key}: ${answer.why}` };
  const wrote = appendGuarded(parts.journal, { v: 1, kind: "released", occurrenceId: id, at: parts.now().toISOString(), licence, ownerSaid: answer.kind });
  if (!wrote.ok) return { occurrenceId: id, did: "failed", what: `released at the owner (${answer.kind}) and not recorded: ${wrote.why}` };
  return { occurrenceId: id, did: "released", what: `owner said ${answer.kind}` };
}

function applyDecision(parts: LaunchParts, decision: ReconcileDecision): ReconcileReport {
  switch (decision.kind) {
    case "record": {
      const wrote = appendGuarded(parts.journal, decision.event);
      return wrote.ok
        ? { occurrenceId: decision.occurrenceId, did: "recorded", what: decision.event.kind }
        : { occurrenceId: decision.occurrenceId, did: "failed", what: `${decision.event.kind} could not be recorded: ${wrote.why}` };
    }
    case "release":
      return applyRelease(parts, decision.occurrenceId, decision.key, decision.licence);
    case "hold":
      return { occurrenceId: decision.occurrenceId, did: "held", what: decision.why };
    default: {
      const never: never = decision;
      throw new Error(`no application for ${JSON.stringify(never)}`);
    }
  }
}

function portsOf(parts: LaunchParts): ReconcilePorts {
  return { ...parts.evidence, lookup: (key) => parts.owner.lookup(key) };
}

/** Settle one occurrence's licensed release now, rather than on the next pass. Used after a `failed-before-launch` and a `disposed`. */
function releaseIfLicensed(parts: LaunchParts, id: LaunchOccurrenceId): ReconcileReport | null {
  const fold = parts.journal.fold();
  const record = fold.occurrences.get(id);
  const carried = fold.carried.get(id);
  const at = parts.now().toISOString();
  let decision: ReconcileDecision | null = null;
  if (record !== undefined) {
    const licence = licenceOf(record);
    if (record.reservation.kind === "held" && licence !== null) decision = releaseDecision(id, licence, portsOf(parts), at);
  } else if (carried !== undefined) {
    decision = decideCarried(carried, portsOf(parts), at);
  }
  return decision === null ? null : applyDecision(parts, decision);
}

export type ReconcileRun =
  | { readonly kind: "reconciled"; readonly reports: readonly ReconcileReport[] }
  /** The journal cannot be written; what reconciliation would have done is reported, and nothing is. */
  | { readonly kind: "history-lost"; readonly why: string; readonly wouldDecide: readonly ReconcileDecision[] };

/** How many passes one reconciliation makes. A record moves at most a few steps (reserved → failed → released). */
const MAX_PASSES = 4;

/** Reconcile until nothing moves, a bounded number of passes. Runs at start and on every checkpoint tick. */
export function reconcileAll(parts: LaunchParts): ReconcileRun {
  const status = parts.journal.status();
  if (status.kind === "history-lost") {
    return { kind: "history-lost", why: lostWhy(status) ?? status.why, wouldDecide: reconcile(parts.journal.fold(), portsOf(parts), parts.now().toISOString()) };
  }
  const reports: ReconcileReport[] = [];
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const decisions = reconcile(parts.journal.fold(), portsOf(parts), parts.now().toISOString());
    const applied = decisions.map((decision) => applyDecision(parts, decision));
    reports.push(...applied);
    if (!applied.some((one) => one.did === "recorded" || one.did === "released")) break;
  }
  return { kind: "reconciled", reports };
}

/* ------------------------------------------------------------------ *
 * D8 / F2 / F7. Greg's controls, as operations on the journal.
 * ------------------------------------------------------------------ */

export type DisposeRequest = {
  readonly occurrenceId: LaunchOccurrenceId;
  readonly actor: string;
  readonly requestId: string;
  readonly decision: DispositionDecision;
  readonly why: string;
};

export type DisposeResult =
  | { readonly kind: "disposed"; readonly release: ReconcileReport | null }
  | { readonly kind: "already-applied"; readonly requestId: string }
  | { readonly kind: "refused"; readonly why: string };

/**
 * Greg's attributed decision on a stuck occurrence: append `disposed`, then
 * release. A crash between the two is settled by reconciliation, because the
 * disposition itself licenses the release (F7). A replayed request id is
 * already applied, and says so.
 */
export function dispose(parts: LaunchParts, request: DisposeRequest): DisposeResult {
  const lost = lostWhy(parts.journal.status());
  if (lost !== null) return { kind: "refused", why: lost };
  const fold = parts.journal.fold();
  if (fold.requestIds.has(request.requestId)) return { kind: "already-applied", requestId: request.requestId };
  if (!isText(request.actor) || !isText(request.requestId) || !isText(request.why)) return { kind: "refused", why: "a disposition names its actor, request and reason" };
  const record = fold.occurrences.get(request.occurrenceId);
  const carried = fold.carried.get(request.occurrenceId);
  if (record === undefined && carried === undefined) return { kind: "refused", why: `${request.occurrenceId} is not in the journal` };
  if (record !== undefined && !(record.state === "launching" || record.state === "observed-running" || record.state === "outcome-unknown")) {
    return { kind: "refused", why: `${request.occurrenceId} is ${record.state}; only an unsettled launch can be disposed` };
  }
  if ((record?.disposition ?? carried?.disposition ?? null) !== null) return { kind: "refused", why: `${request.occurrenceId} was already disposed` };
  const wrote = appendGuarded(parts.journal, {
    v: 1,
    kind: "disposed",
    occurrenceId: request.occurrenceId,
    at: parts.now().toISOString(),
    actor: request.actor,
    requestId: request.requestId,
    decision: request.decision,
    why: request.why,
  });
  if (!wrote.ok) return { kind: "refused", why: `the disposition could not be recorded: ${wrote.why}` };
  return { kind: "disposed", release: releaseIfLicensed(parts, request.occurrenceId) };
}

/**
 * F2: the way out of `history-lost`. The owner's inventory is read first — an
 * owner that cannot say what it holds cannot have its reservations carried —
 * and the store preserves the old journal and starts a fresh one.
 */
export function resolveHistory(
  parts: { readonly journal: ResettableJournal; readonly owner: AdmissionOwner; readonly now: () => Date },
  request: HistoryResolutionRequest,
): { ok: true; reset: HistoryResetEvent } | { ok: false; why: string } {
  const bad = checkResolutionRequest(request);
  if (bad !== null) return { ok: false, why: bad };
  const inventory = guarded("the owner's inventory", () => parts.owner.inventory(), (why) => ({ kind: "unavailable" as const, why }));
  if (inventory.kind === "unavailable") return { ok: false, why: `resolve the admission owner's history first: ${inventory.why}` };
  return parts.journal.resetHistory({ request, at: parts.now().toISOString(), ownerReservations: inventory.reservations });
}

/* ------------------------------------------------------------------ *
 * The composition: the only place a launcher is handed over.
 * ------------------------------------------------------------------ */

export type LaunchProtocol = {
  readonly plan: (request: PlanRequest) => PlanResult;
  readonly launchOccurrence: (request: PlanRequest) => LaunchOutcome;
  readonly reconcile: () => ReconcileRun;
  readonly dispose: (request: DisposeRequest) => DisposeResult;
};

/**
 * Close over the parts, so a consumer is handed functions and never a
 * launcher. The scheduler and recovery get `launchOccurrence` from this, and
 * nothing else (F9).
 */
export function composeLaunchProtocol(parts: LaunchParts): LaunchProtocol {
  return {
    plan: (request) => plan(parts, request),
    launchOccurrence: (request) => launchOccurrence(parts, request),
    reconcile: () => reconcileAll(parts),
    dispose: (request) => dispose(parts, request),
  };
}
